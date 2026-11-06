export * as OpenhiveCaseParse from "./case-parse"

import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { Hash } from "@opencode-ai/core/util/hash"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { 取消排队作业 } from "./case-ingest"
// `可解析扩展名` 仍要给 GET /case/materials 返回，别在替换时丢掉它。
import { 可解析扩展名, 可解析材料 } from "./case-parseable"
import { applyParseAction, createMaterial, getMaterial, getMaterialByPath, inTransaction, 解析冲突 } from "./case-store"
import { 人工解析动作, 该动作可用, isRunning, nextStatus } from "./case-status"
import { 入队材料, inside, LINK_ESCAPE, realInside } from "./file"
import { 材料视图 } from "./case-materials"
import { OpenhivePg } from "./pg"
import { 成员角色 as 成员角色共享 } from "./project-actor"

/**
 * 材料解析的两个出口（设计 §5.2 / §5.3 / §8.1）。
 *
 * ## 为什么写出口收「动作」而不是收目标状态
 *
 * 界面上的五个菜单项是**动作**（入队 / 重新解析 / 取消 / 跳过），落点由状态机决定：
 * 排队中取消回「未入队」、解析中取消落「有问题」。让前端算目标状态，等于把状态机抄进
 * 前端第二份，两边一漂就会出现「界面说未入队、库里还是解析中」。
 */
export const PREFIX = "/openhive/case"

export const PATH = {
  materials: `${PREFIX}/materials`,
  parse: `${PREFIX}/parse`,
} as const

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  /** 每用户 SQLite：`成员角色` 判「老项目属主」那一道来源要用（见 `project-actor.ts`）。 */
  readonly database: Database.Interface
  readonly root: string
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config
    const database = yield* Database.Service
    const deps: Deps = { pg: openhivePg.pg, database, root: config.root }

    yield* router.add("GET", PATH.materials, (request) => handleMaterials(request, deps))
    yield* router.add("POST", PATH.parse, (request) => handleParse(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 身份 = Effect.serviceOption(User.Service)

/** 判据只有一份，住在 `./project-actor`（`LEARNINGS #002-06` / `#010-06`）。 */
const 成员角色 = (deps: Deps, userId: string, projectId: string) =>
  成员角色共享({ pg: deps.pg(), database: deps.database }, userId, projectId)

function 是合法段(value: string | null): value is string {
  return value !== null && value !== "" && User.isSafePathSegment(value)
}

function handleMaterials(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const projectId = new URL(request.url, "http://localhost").searchParams.get("projectId")
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")

    const materials = yield* Effect.promise(() => 材料视图(deps.pg(), projectId))
    return ok({ materials, parseableExtensions: [...可解析扩展名] })
  })
}

type 动作 = 人工解析动作

const 是动作 = (value: unknown): value is 动作 =>
  typeof value === "string" && (人工解析动作 as readonly string[]).includes(value)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 体不是 JSON 对象 ⇒ `undefined`（同 `project-assets.ts` 的 `读体`）。 */
function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (value: unknown) => (isRecord(value) ? value : undefined) }),
  )
}

/** 项目内相对路径的基本形状。语义闸（`inside` / `realInside`）在下面，按动作需要才跑。 */
function 是项目内相对路径(path: string): boolean {
  if (path === "" || path.includes("\0") || path.includes("\\")) return false
  if (path.startsWith("/") || path.startsWith("//") || /^[a-zA-Z]:/.test(path)) return false
  const 段 = path.split("/")
  return 段.every((片) => 片 !== "" && 片 !== "." && 片 !== "..")
}

interface 磁盘文件 {
  readonly 绝对: string
  readonly 字节: Buffer
  readonly 文件名: string
}

/**
 * 按需读盘：只有「入队 / 重新解析 / 跳过一份还没有记录的文件」需要字节。
 *
 * 取消与「跳过已有记录」**不碰盘**：文件已经被删了，用户仍然要能取消排队、仍然要能把
 * 一条旧记录标成跳过——把读盘放在动作之前会让这两种操作凭空失败。
 */
function 读盘文件(
  deps: Deps,
  userId: string,
  projectId: string,
  path: string,
): Effect.Effect<磁盘文件 | { readonly 错误: string; readonly code: string; readonly status: number }> {
  return Effect.gen(function* () {
    const 项目 = projectDirectory(deps.root, userId, projectId)
    const 绝对 = inside(项目, path)
    if (绝对 === undefined) return { 错误: "path 越出了项目目录", code: "bad_request", status: 400 }

    const 信息 = yield* Effect.promise(() => stat(绝对).catch(() => undefined))
    if (信息 === undefined || !信息.isFile())
      return { 错误: "盘上找不到这个文件", code: "file_missing", status: 404 }

    if (!(yield* realInside(项目, 绝对)))
      return { 错误: LINK_ESCAPE, code: "bad_request", status: 400 }

    const 字节 = yield* Effect.promise(() => readFile(绝对).catch(() => undefined))
    if (字节 === undefined) return { 错误: "盘上找不到这个文件", code: "file_missing", status: 404 }
    return { 绝对, 字节, 文件名: basename(path) }
  })
}

/** 把 `解析冲突` 收成一句话，其余错误照常抛成 500（不吞）。 */
async function 收冲突<T>(fn: () => Promise<T>): Promise<T | 解析冲突> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof 解析冲突) return error
    throw error
  }
}

function handleParse(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")

    const projectId = body["projectId"]
    const path = body["path"]
    const action = body["action"]
    if (typeof projectId !== "string" || projectId === "" || !User.isSafePathSegment(projectId))
      return fail(400, "projectId 非法", "bad_request")
    if (typeof path !== "string" || !是项目内相对路径(path))
      return fail(400, "path 必须是项目内的相对路径（/ 分隔）", "bad_request")
    if (!是动作(action)) return fail(400, "action 只能是 入队 / 重新解析 / 取消 / 跳过", "bad_request")

    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")

    const 当前 = yield* Effect.promise(() => getMaterialByPath(deps.pg(), projectId, path))

    // 产物硬边界在**状态机之前**：产物连「重新解析」都不该收到，回一句说得清的话。
    // 「取消」不在硬边界里——它不推进解析，产物本来也不会在排队；真点了会先落到下面的
    // 取消分支，由 `该动作可用` 判掉（产物不在「排队中 / 解析中」）⇒ illegal_transition。
    //
    // `跳过` 对产物同样必须回 `artifact_not_parseable`（Task 4 的验收点之一），所以
    // 这条守卫对「取消」以外的解析动作都生效。
    if (当前?.kind === "产物" && action !== "取消")
      return fail(409, "产物只登记不解析", "artifact_not_parseable")

    // ⚠️ `isRunning` 只拦「再排一次」（入队 / 重新解析）。取消**必须**放过排队中与解析中，
    // 否则右键「取消解析」永远回 409——这正是 Task 4 头两条用例要钉的。
    if (
      当前 !== undefined &&
      (action === "入队" || action === "重新解析") &&
      isRunning(当前.parseStatus)
    )
      return fail(409, "这份文件已经在排队或解析中", "already_running")
    if (当前 !== undefined && !该动作可用(当前.parseStatus, action))
      return fail(409, `现在（${当前.parseStatus}）不能「${action}」`, "illegal_transition")

    if (action === "取消") {
      if (当前 === undefined) return fail(404, "这份文件还没有解析记录", "material_not_found")
      if (!该动作可用(当前.parseStatus, "取消"))
        return fail(409, `现在（${当前.parseStatus}）不能取消`, "illegal_transition")

      const 下一个 = nextStatus(当前.parseStatus, "取消")
      if (下一个 === undefined) return fail(409, "这个状态不能取消", "illegal_transition")

      const 冲突 = yield* Effect.promise(() =>
        收冲突(() =>
          inTransaction(deps.pg(), async (tx) => {
            await 取消排队作业(tx, projectId, 当前.id)
            await applyParseAction(tx, {
              projectId,
              materialId: 当前.id,
              action: "取消",
              by: user.value.id,
            })
          }),
        ),
      )
      if (冲突 instanceof 解析冲突) return fail(409, 冲突.message, 冲突.code)
      return ok({ ok: true, status: 下一个 })
    }

    if (action === "跳过") {
      if (当前 !== undefined) {
        const 冲突 = yield* Effect.promise(() =>
          收冲突(() =>
            applyParseAction(deps.pg(), {
              projectId,
              materialId: 当前.id,
              action: "跳过",
              by: user.value.id,
            }),
          ),
        )
        if (冲突 instanceof 解析冲突) return fail(409, 冲突.message, 冲突.code)
        return ok({ ok: true, status: "已跳过" })
      }

      const 读 = yield* 读盘文件(deps, user.value.id, projectId, path)
      if ("错误" in 读) return fail(读.status, 读.错误, 读.code)

      const 冲突 = yield* Effect.promise(() =>
        收冲突(() =>
          inTransaction(deps.pg(), async (tx) => {
            const materialId = await createMaterial(tx, {
              id: crypto.randomUUID(),
              projectId,
              fileName: 读.文件名,
              kind: "其他",
              fingerprint: Hash.sha256(读.字节),
              path,
            })
            await applyParseAction(tx, {
              projectId,
              materialId,
              action: "跳过",
              by: user.value.id,
            })
          }),
        ),
      )
      if (冲突 instanceof 解析冲突) return fail(409, 冲突.message, 冲突.code)
      return ok({ ok: true, status: "已跳过" })
    }

    if (action === "重新解析" && 当前 === undefined)
      return fail(404, "这份文件还没有解析记录", "material_not_found")
    // PDF / 图片 / 音视频仍不在这里（R1）；文本类从计划 4 起走同一个入口。
    if (!可解析材料(path)) return fail(409, "这类文件的解析在后续计划", "not_parseable")

    const 读 = yield* 读盘文件(deps, user.value.id, projectId, path)
    if ("错误" in 读) return fail(读.status, 读.错误, 读.code)

    const 结果 = yield* Effect.promise(() =>
      收冲突(() =>
        入队材料(deps.pg(), {
          root: deps.root,
          project: projectDirectory(deps.root, user.value.id, projectId),
          target: 读.绝对,
          bytes: 读.字节,
          fileName: 读.文件名,
          by: user.value.id,
          ...(action === "重新解析" ? { force: true } : {}),
          // 人工「解析入库」置顶；「重新解析」与上传自动入队保持 FIFO（终审阻塞 3）。
          ...(action === "入队" ? { 置顶: true } : {}),
        }),
      ),
    )
    if (结果 instanceof 解析冲突) return fail(409, 结果.message, 结果.code)
    if (结果 === undefined) return fail(400, "这个文件不在项目沙箱内，无法入队", "bad_request")
    if (!结果.enqueued) {
      // 「没入队」不等于「刚被别的作业改掉」：最常见的是同一内容（指纹相同）的那一行
      // 在别处已经解析过，`该走哪个动作` 按**它的**状态回了「不排队」。读回真实状态
      // 再说原因（`LEARNINGS #010-06`：判据只能有一份，别在这里把状态机重写一遍）。
      // `state_changed` 仍由 `收冲突` 收下的乐观并发冲突产生，不在这里。
      const 实际 = yield* Effect.promise(() => getMaterial(deps.pg(), projectId, 结果.materialId))
      if (实际 !== undefined && isRunning(实际.parseStatus))
        return fail(409, "这份文件已经在排队或解析中", "already_running")
      return fail(409, `现在（${实际?.parseStatus ?? "未知"}）不能「${action}」`, "illegal_transition")
    }

    return ok({ ok: true, status: "排队中" })
  })
}
