export * as OpenhiveCaseIngestRoutes from "./case-ingest-routes"

/**
 * 016 T016 · 入库新出口：扫描 / 重跑 / 设置 / 报告。
 *
 * ## 权限只有一处
 *
 * 五个出口全部走 `case-ui-routes.ts` 的 `过门`（本任务只给它加了 `export`，实现零改）：
 * 成员口判 `成员角色`，写设置口再加 `要属主`。身份、`projectId` 合法性、成员判定、
 * 属主拒绝文案都不在本文件里重写（`#002-06` / `#005-24`）。
 *
 * ## 写口：401 在体之前
 *
 * `projectId` 只能从请求体拿（契约 §3 / §5），所以顺序是：先 `身份`（无凭证 401）→ 读体 →
 * `过门(…, { 已知身份 })` → 字段校验 → 写。这样既满足「401 不因坏体变成 400」，
 * 也保证权限判定在**任何副作用之前**（`#004-09`）。读口直接 `过门` 即可。
 *
 * ## 扫描目录恒按**属主**拼（Ruling AR）
 *
 * 共享项目的文件在属主沙箱里（`project-actor.ts` 的 `项目属主`；同 `case-parse.ts:193`、
 * `hgraph-ops.ts:276-283`、`file.ts` 的 `sourcePath`）。按请求者拼，成员会落到一个不存在的
 * 目录（`realPath` 是 orDie ⇒ 500），重跑的 `source_path` 也会指错、worker 读不到盘。
 * scan / rerun 共用同一个 `建扫描依赖`，只在这里取一次属主（`#002-06`）。
 *
 * ## 服务在构造期取
 *
 * `LocationServiceMap` 与 `FSUtil` 必须在 `HttpRouter.use` 构造期 `yield`（同 `project-tree.ts`
 * 的实测：请求 fiber 里没有 app 层服务，请求期取会 `Service not found: @opencode/FileSystem`）。
 * 每次请求只 `locations.get(...)` 一次，读完 `建项目读目录` 再交给 T015 的扫描。
 */

import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LayerMap } from "effect"
import { LocationServiceMap, type LocationServices } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { User } from "@opencode-ai/core/user"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { sep } from "node:path"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { 读设置, 写设置 } from "./case-ingest-settings"
import { 最新报告, 报告历史, type 报告行 } from "./case-material-report"
import { 批量入队, 扫候选, type 扫描范围, type 扫描依赖 } from "./case-rerun-scan"
import { 过门, type Deps as 过门依赖 } from "./case-ui-routes"
import { OpenhivePg } from "./pg"
import { 项目属主 } from "./project-actor"
import { 建项目读目录 } from "./project-tree"

export const PREFIX = "/openhive/case/ingest"

export const PATH = {
  scan: `${PREFIX}/scan`,
  rerun: `${PREFIX}/rerun`,
  settings: `${PREFIX}/settings`,
  report: `${PREFIX}/report`,
} as const

/** 闭集只有三个值（与 T015 的 `扫描范围` 一一对应）。 */
const 范围闭集 = ["目录独有", "未入队", "未识别"] as const

interface Deps extends 过门依赖 {
  /** 沙箱根（`AnchorWorkspace.Config.root`，构造期取）。 */
  readonly root: string
  /** 项目服务图（构造期取；请求期 `get`，理由见文件头）。 */
  readonly locations: LayerMap.LayerMap<Location.Ref, LocationServices>
  /** 全局文件工具（构造期取；读 `.gitignore` 用）。 */
  readonly raw: FSUtil.Interface
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const database = yield* Database.Service
    const config = yield* AnchorWorkspace.Config
    const locations = yield* LocationServiceMap.Service
    const raw = yield* FSUtil.Service
    const deps: Deps = { pg: openhivePg.pg, database, root: config.root, locations, raw }

    yield* router.add("GET", PATH.scan, (request) => handleScan(request, deps))
    yield* router.add("POST", PATH.rerun, (request) => handleRerun(request, deps))
    yield* router.add("GET", PATH.settings, (request) => handleSettingsRead(request, deps))
    yield* router.add("POST", PATH.settings, (request) => handleSettingsWrite(request, deps))
    yield* router.add("GET", PATH.report, (request) => handleReport(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 身份 = Effect.serviceOption(User.Service)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 出口统一正斜杠。库内材料路径是 `/`，而 `扫树` 在 win32 上给 `\`——不归一，同一份响应会
 * 混两种分隔符（契约示例与既有材料视图都是 `/`）。只改展示，不改正斜杠以外的任何字符。
 */
const 正斜杠 = (path: string) => path.split(sep).join("/")

function 对外扫描(结果: Awaited<ReturnType<typeof 扫候选>>) {
  return {
    合计: 结果.合计,
    候选: {
      目录独有: 结果.候选.目录独有.map((项) => ({ path: 正斜杠(项.path) })),
      未入队: 结果.候选.未入队.map((项) => ({ materialId: 项.materialId, path: 正斜杠(项.path) })),
      未识别: 结果.候选.未识别.map((项) => ({
        materialId: 项.materialId,
        path: 正斜杠(项.path),
        原因码: 项.原因码,
      })),
    },
    样本: 结果.样本.map(正斜杠),
    截断: 结果.截断,
    // AR12：触顶时 `截断: true` 只说明「没看全」，`已扫` 才说清看了多少条。
    已扫: 结果.已扫,
  }
}

function 对外批量(结果: Awaited<ReturnType<typeof 批量入队>>) {
  return {
    已入队: 结果.已入队,
    跳过: 结果.跳过.map((项) => ({ path: 正斜杠(项.path), 原因: 项.原因 })),
    失败: 结果.失败.map((项) => ({ path: 正斜杠(项.path), 原因: 项.原因 })),
  }
}

/** 体不是 JSON 对象 ⇒ `undefined`（同 `case-fact-routes.ts` 的 `读体`）。 */
function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (value: unknown) => (isRecord(value) ? value : undefined) }),
  )
}

const 是范围 = (value: unknown): value is 扫描范围 =>
  typeof value === "string" && (范围闭集 as readonly string[]).includes(value)

/**
 * 缺省 = 全部三类；非数组 / 空数组 / 含闭集外的值 ⇒ `undefined`（调用方回 400，不静默忽略）。
 * 空数组单独判：回 200「已入队 0」会让调用方以为真扫过一遍（AR12），语义上它是坏请求。
 */
function 读范围(value: unknown): 扫描范围[] | undefined {
  if (value === undefined) return [...范围闭集]
  if (!Array.isArray(value)) return undefined
  if (value.length === 0) return undefined
  if (!value.every(是范围)) return undefined
  return value
}

/**
 * 组 T015 的扫描依赖（Ruling AQ：`沙箱前缀` 显式传 `{userId}/{projectId}`，不依赖缺省推导）。
 * 目录读不到 ⇒ `undefined`，由调用方回 500「读取文件树失败」。
 */
const 建扫描依赖 = (deps: Deps, userId: string, projectId: string) =>
  Effect.gen(function* () {
    // Ruling AR：目录与 `sourcePath` 前缀都按**落点属主**（`过门` 已验过成员，退化分支回本人）。
    const 属主 = yield* Effect.promise(() => 项目属主(deps.pg(), userId, projectId))
    const 根目录 = projectDirectory(deps.root, 属主, projectId)
    const 层 = deps.locations.get(Location.Ref.make({ directory: AbsolutePath.make(根目录) }))
    const 读 = yield* 建项目读目录({ 层, raw: deps.raw })
    if (读 === undefined) return undefined
    return {
      根目录,
      读目录: 读,
      读文件字节: async (绝对路径: string) => {
        try {
          return new Uint8Array(await Bun.file(绝对路径).arrayBuffer())
        } catch {
          // 读不到就是读不到：T015 会跳过（歧义裁定 2，不报失败）。
          return undefined
        }
      },
      沙箱前缀: `${属主}/${projectId}`,
    } satisfies 扫描依赖
  })

function handleScan(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const projectId = new URL(request.url, "http://localhost").searchParams.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    // `过门` 已对 null 回 400；这一句只为把类型收窄（运行时到不了）。
    if (projectId === null) return fail(400, "projectId 非法", "bad_request")

    const 依赖 = yield* 建扫描依赖(deps, 门.user.id, projectId)
    if (依赖 === undefined) return fail(500, "读取文件树失败")

    // `算候选` 在 `扫树` 取不到时 reject（`Effect.promise` 的 reject 是 defect，`Effect.catch`
    // 接不住）⇒ 在 promise 内收成 `undefined`，回契约错误体而不是通用 500（`project-tree.ts:183` 同形）。
    // 留 warn：SQL / 连接错误也会走到这里，不记日志现场无从分辨。
    const 结果 = yield* Effect.promise(() =>
      扫候选(deps.pg(), { projectId, 范围: [...范围闭集], 依赖 }).catch((error: unknown) => {
        console.warn("[openhive] 扫描候选失败", error)
        return undefined
      }),
    )
    if (结果 === undefined) return fail(500, "读取文件树失败")
    return ok(对外扫描(结果))
  })
}

function handleRerun(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    // 401 在读体之前（R51）；权限判定在任何副作用之前（`#004-09`）。
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const 体 = yield* 读体(request)
    if (体 === undefined) return fail(400, "请求体必须是 JSON 对象", "bad_request")

    const projectId = typeof 体.projectId === "string" ? 体.projectId : undefined
    const 门 = yield* 过门(deps, projectId ?? null, { 已知身份: user.value })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    if (projectId === undefined) return fail(400, "projectId 非法", "bad_request")

    const 范围 = 读范围(体.范围)
    if (范围 === undefined)
      return fail(400, "范围 必须是非空数组，且每项只能是 目录独有 / 未入队 / 未识别", "bad_request")

    const 依赖 = yield* 建扫描依赖(deps, 门.user.id, projectId)
    if (依赖 === undefined) return fail(500, "读取文件树失败")

    const 结果 = yield* Effect.promise(() =>
      批量入队(deps.pg(), { projectId, 范围, userId: 门.user.id, 依赖 }).catch((error: unknown) => {
        console.warn("[openhive] 批量入队失败", error)
        return undefined
      }),
    )
    if (结果 === undefined) return fail(500, "读取文件树失败")
    return ok(对外批量(结果))
  })
}

function handleSettingsRead(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const projectId = new URL(request.url, "http://localhost").searchParams.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    if (projectId === null) return fail(400, "projectId 非法", "bad_request")

    const 设置 = yield* Effect.promise(() => 读设置(deps.pg(), projectId))
    return ok(设置)
  })
}

function handleSettingsWrite(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const 体 = yield* 读体(request)
    if (体 === undefined) return fail(400, "请求体必须是 JSON 对象", "bad_request")

    const projectId = typeof 体.projectId === "string" ? 体.projectId : undefined
    const 门 = yield* 过门(deps, projectId ?? null, {
      要属主: true,
      已知身份: user.value,
      属主拒绝文案: "只有项目属主能修改入库设置",
    })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    if (projectId === undefined) return fail(400, "projectId 非法", "bad_request")

    const autoEnqueue = 体.autoEnqueue
    if (autoEnqueue !== undefined && typeof autoEnqueue !== "boolean")
      return fail(400, "autoEnqueue 必须是布尔值", "bad_request")
    const autoEnableTrusted = 体.autoEnableTrusted
    if (autoEnableTrusted !== undefined && typeof autoEnableTrusted !== "boolean")
      return fail(400, "autoEnableTrusted 必须是布尔值", "bad_request")

    const 结果 = yield* Effect.promise(() =>
      写设置(deps.pg(), {
        projectId,
        userId: 门.user.id,
        操作人是属主: true,
        autoEnqueue,
        autoEnableTrusted,
      }),
    )
    if (!结果.ok) return fail(403, "只有项目属主能修改入库设置", 结果.code)
    return ok(结果.设置)
  })
}

/**
 * 报告出口的行映射：DAO 用驼峰 `convertedRows`，契约 §4 的对外字段是 `转换行数`（D2）。
 * 改名只在这一层做一次，不让内部字段名泄漏到线路上（`#002-06`）。
 */
function 对外报告(行: 报告行) {
  const { convertedRows, ...其余 } = 行
  return { ...其余, 转换行数: convertedRows }
}

function handleReport(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const 门 = yield* 过门(deps, 参数.get("projectId"))
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const projectId = 参数.get("projectId")
    if (projectId === null) return fail(400, "projectId 非法", "bad_request")
    const materialId = 参数.get("materialId")
    if (typeof materialId !== "string" || materialId === "")
      return fail(400, "materialId 不能为空", "bad_request")

    if (参数.get("历史") === "1") {
      const 行们 = yield* Effect.promise(() => 报告历史(deps.pg(), projectId, materialId))
      return ok({ reports: 行们.map(对外报告) })
    }

    const 报告 = yield* Effect.promise(() => 最新报告(deps.pg(), projectId, materialId))
    // 「还没跑完」是正常态：200 + null，不是 404（契约 §4 的歧义裁定）。
    return ok({ report: 报告 === undefined ? null : 对外报告(报告) })
  })
}
