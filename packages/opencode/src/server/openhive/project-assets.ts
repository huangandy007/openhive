export * as OpenhiveProjectAssets from "./project-assets"

/**
 * 项目级 skill 启用（2026-10-27，用户裁定）。
 *
 * ## 它补的是哪一段
 *
 * 「发布」把 skill 复制进共享卷，但内核从不读共享卷（`skill/index.ts` 的扫描根只有
 * 项目 `.opencode`、全局配置目录、`.claude/skills`、`.agents/skills`）⇒ 发布 ≠ 能用。
 * 本模块把「启用」落成两件事：**库里的关系行** ＋ **项目目录里的一条链接**。
 *
 * ## 顺序：先写库、再改链接、最后丢缓存
 *
 * 库是事实、目录是投影。反过来（先链接后写库）一旦写库失败，就留下一条对不上的链接，
 * 而没有任何记录说它该存在。今天这个顺序的残余是「库有、链接没建」（磁盘故障），
 * 由下一次 `GET` 的对账（`reconcileSkillLinks`）自动补上。
 *
 * ## 丢缓存：`InstanceStore.disposeDirectory`
 *
 * 内核的 skill 清单是 `InstanceState` 按**目录**缓存一次（`skill/index.ts:259-266`）。
 * 不丢缓存，这次启用在本进程内**永远**不生效——用户会看到「点了启用、问了还是不会用」。
 * 丢缓存后下一次请求重建实例、重扫目录 ⇒ **下一条消息生效**。
 *
 * ⚠️ 这是本模块唯一一处会打断在跑实例的调用：正在生成的会话会经历一次实例重建
 * （表现为前端收到 `server.instance.disposed` 后重拉该目录的状态）。启用是显式的用户动作，
 * 这个代价可以接受；**不要**把它加进任何自动路径。
 *
 * ## 谁能启用
 *
 * 项目**成员**（owner 或 member）都能启用/停用（本计划 R2）：启用是干活不是治理。
 * 判定只调 `rolesOf()`（`#002-06`：成员判定只该有一份）。
 *
 * ## 能启用哪一份
 *
 * 必须**同时**满足：`type='skill'`、`status='published'`、当前读者 `canReadAsset()` 放行
 * ⇒ 否则 409 / 403。前者是没有可链接的落点（草稿停在作者沙箱，`publishDirectory` 直接拒），
 * 后者是「不能看的东西不能装」。
 *
 * 个人空间的资产**也**不可启用：它的文件留在作者沙箱，没有共享发布目录
 * （`publishDirectory` 对 personal 直接抛 `PersonalAssetDirectoryError`）。拦截必须发生在
 * 调 `skillLinkTarget` 之前，否则出口以 500 收场；对账与同名比对两处也各跳过一份
 * （历史遗留行 / 直接写库的兜底）。
 */

import { assetById } from "@opencode-ai/asset-service/asset"
import { canReadAsset } from "@opencode-ai/asset-service/authorization"
import {
  disableAsset,
  enabledAssetIds,
  enableAsset,
  enablementOf,
  ENABLEMENT_LIMIT,
} from "@opencode-ai/asset-service/enablement"
import {
  linkSkill,
  reconcileSkillLinks,
  skillLinkTarget,
  unlinkSkill,
} from "@opencode-ai/asset-service/project-skill-link"
import { assetsRoot } from "@opencode-ai/asset-service/storage"
import { rolesOf } from "@opencode-ai/auth/project-member"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { User } from "@opencode-ai/core/user"
import { InstanceStore } from "@/project/instance-store"
import { ConfigMarkdown } from "@/config/markdown"
import { AnchorWorkspace } from "@/server/routes/instance/httpapi/middleware/anchor-workspace"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { 记治理 } from "./audit"
import { OpenhivePg } from "./pg"

export const PREFIX = "/openhive/project/assets"

export const PATH = {
  state: PREFIX,
  enable: `${PREFIX}/enable`,
  disable: `${PREFIX}/disable`,
} as const

const BOARD = "asset-governance"

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  readonly root: string
  readonly store: Option.Option<InstanceStore.Interface>
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config
    // 测试里可能没有内核实例层（只挂路由的子集）：缺席时丢弃缓存这一步跳过并告警，不静默
    // 假装做了（`#002-02`）。
    const store = yield* Effect.serviceOption(InstanceStore.Service)
    const deps: Deps = { pg: openhivePg.pg, root: config.root, store }

    yield* router.add("GET", PATH.state, (request) => handleState(request, deps))
    yield* router.add("POST", PATH.enable, (request) => handleToggle(request, deps, "enable"))
    yield* router.add("POST", PATH.disable, (request) => handleToggle(request, deps, "disable"))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 身份 = Effect.serviceOption(User.Service)

/** 这个人在这个项目里是什么角色；`undefined` = 不是成员（含项目不存在）。 */
function 成员角色(deps: Deps, userId: string, projectId: string) {
  return Effect.promise(async () => {
    const roles = await rolesOf(deps.pg(), { userId, projectIds: [projectId] })
    return roles.get(projectId)
  })
}

function 是合法段(value: unknown): value is string {
  return typeof value === "string" && value !== "" && User.isSafePathSegment(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 体不是 JSON / 不是对象 ⇒ `undefined`（客户端的事，不是服务端故障；同 `member.ts` 的 `bodyOf`）。 */
function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (value: unknown) => (isRecord(value) ? value : undefined) }),
  )
}

function 项目目录(deps: Deps, userId: string, projectId: string): string {
  return projectDirectory(deps.root, userId, projectId)
}

/** 丢掉该项目的实例缓存：让下一次请求重扫 skill 目录（见文件头「丢缓存」）。 */
function 丢缓存(deps: Deps, directory: string) {
  const store = deps.store
  if (Option.isNone(store)) {
    return Effect.logWarning("实例层缺席，跳过缓存丢弃；启用在重启前不生效", { directory })
  }
  return Effect.promise(() => Effect.runPromise(store.value.disposeDirectory(directory))).pipe(
    Effect.catchCause((cause) => Effect.logError("实例缓存丢弃失败", { directory, cause })),
  )
}

/** 读者部门（`AssetViewer` 要它判部门/个人空间）。 */
function 取部门(deps: Deps, userId: string) {
  return Effect.promise(async (): Promise<string> => {
    const rows = rowsOf(await deps.pg().execute(sql`select dept from auth.user where id = ${userId}`))
    const 部门 = rows[0]?.["dept"]
    return typeof 部门 === "string" ? 部门 : ""
  })
}

/** 发布目录在不在。**只把 ENOENT 当「不在」**：权限 / IO 故障要暴露，不折成「文件缺失」。 */
async function 路径存在(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return false
    throw error
  }
}

/**
 * 读 SKILL.md frontmatter 的 `name`（内核也按它去重）。
 *
 * 读不到（文件缺失 / 解析失败）⇒ `undefined`，并**告警**——没有名字就做不了同名拦截，
 * 那意味着「两个同名 skill 可能同时装进项目」，不该安静地当没这回事（`#002-02`）。
 */
function 读名字(target: string) {
  return Effect.promise(() => ConfigMarkdown.parse(join(target, "SKILL.md"))).pipe(
    Effect.map((md) => {
      const name: unknown = md.data["name"]
      return typeof name === "string" ? name : undefined
    }),
    Effect.catchCause((cause) =>
      Effect.logWarning("读不到 SKILL.md 的 name，跳过同名检查", { target, cause }).pipe(Effect.as(undefined)),
    ),
  )
}

/** 已启用集合 + 把目录对账到与库一致。`GET` 也顺手对账：用户换机器 / 目录被清理都靠它自愈。 */
function 对账并读(deps: Deps, userId: string, projectId: string) {
  return Effect.gen(function* () {
    const state = yield* Effect.promise(() => enablementOf(deps.pg(), projectId))
    const 目录 = 项目目录(deps, userId, projectId)
    const 根 = assetsRoot(process.env)
    const 部门 = yield* 取部门(deps, userId)
    // 「启用」是项目级事实（库里的行），「送达」是读者级授权：每个读者只把**自己读得到**的资产
    // 链进自己的沙箱。否则甲部门发布的 skill 会被乙部门成员的 GET 顺手对账进乙的沙箱，
    // 且 `enabled` 还会泄露项目启用了哪些 id。故这里先按读者判可见性，再建链接。
    const viewer = { userId, department: 部门 }
    const 可见: string[] = []

    const desired = new Map<string, string>()
    for (const assetId of state.enabled) {
      const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
      // 已下线 / 被删掉的资产：不再链（对账时会被摘掉）
      if (asset === undefined || asset.status !== "published" || asset.type !== "skill") continue
      // 个人空间没有共享目录 ⇒ 算不出 target（`skillLinkTarget` 会抛）。启用入口已经拦了，
      // 这里再挡一次是给「历史遗留行 / 直接写库」兜底：不挡就是每次打开资产中心都 500。
      if (asset.visibility === "personal") continue
      // 读者读不到 ⇒ 不链、也不回给前端。只影响 `enabled`，不影响库里的启用事实。
      if (!canReadAsset(viewer, asset)) continue
      // 先记「看得见」再判目录：`enabled` 的语义是**授权**，不是「文件齐不齐」。
      // 发布目录缺失时链接照样建不了（下面 `continue`），但前端仍要能把那份资产标成「已启用」，
      // 否则会出现「已占 1/20 但列表里一份都标不出来」——用户既看不见也点不掉。
      可见.push(assetId)
      const target = skillLinkTarget(根, asset)
      if (!(yield* Effect.promise(() => 路径存在(target)))) continue
      desired.set(assetId, target)
    }

    // 对账失败不能把整个 GET 变成 500：库里的启用状态仍要能读出来，目录留到下次自愈。
    const 结果 = yield* Effect.promise(() => reconcileSkillLinks(目录, desired)).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("对账失败，目录状态待下次修复", { projectId, 目录, cause }).pipe(
          Effect.as(undefined),
        ),
      ),
    )
    if (结果 !== undefined && 结果.skipped.length > 0) {
      yield* Effect.logWarning("项目目录里有不是链接的 skill 目录，未动", { skipped: 结果.skipped })
    }
    // `enabled` 只回**当前读者可见**的 id，而 `enabledCount` 保持项目真相（库里的启用条数）。
    // 两者不等是刻意的：配额按项目算，不是按「我看得见几个」算。
    return { ...state, enabled: 可见 }
  })
}

function handleState(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const params = new URL(request.url, "http://localhost").searchParams
    const projectId = params.get("projectId") ?? ""
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")
    return ok(yield* 对账并读(deps, user.value.id, projectId))
  })
}

function handleToggle(request: HttpServerRequest.HttpServerRequest, deps: Deps, 动作: "enable" | "disable") {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const userId = user.value.id

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = body["projectId"]
    const assetId = body["assetId"]
    if (!是合法段(projectId) || !是合法段(assetId)) return fail(400, "projectId / assetId 非法", "bad_request")

    if ((yield* 成员角色(deps, userId, projectId)) === undefined) return fail(403, "不是该项目成员", "forbidden")

    if (动作 === "enable") {
      const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
      if (asset === undefined) return fail(404, "资产不存在", "not_found")
      if (asset.type !== "skill") return fail(409, "只有 skill 能装进项目", "asset_not_skill")
      if (asset.status !== "published") return fail(409, "只有已发布的 skill 能启用", "asset_not_published")
      // 个人空间的资产**留在作者沙箱**，没有共享发布目录：`publishDirectory` 对 personal 直接抛
      // `PersonalAssetDirectoryError`（`storage.ts:98-100`）。不在这里拦住，就会以 500 收场，
      // 而产品口径要的是可读的 409。等「个人资产也进共享卷」那天再放开。
      if (asset.visibility === "personal")
        return fail(409, "个人空间的 skill 还不能装进项目，请先发布到部门或全局", "personal_not_linkable")

      const 部门 = yield* 取部门(deps, userId)
      // `canReadAsset` 的第三个参数是新版授权组（`readable-sql.ts:81-91` 的 grant 行）。它今天
      // **没有任何生产写入口**，所以这里沿用默认的 `[]`。等授权组上线时**必须**把该读者命中的
      // grant 一并传进来，否则资产列表（按 grant 判可见）与启用（不认 grant）会漂移成
      // 「列表看得见、启用返回 403」。对账里的可见性判定（`对账并读`）要同步改。
      if (!canReadAsset({ userId, department: 部门 }, asset)) return fail(403, "无权使用该资产", "forbidden")

      const target = skillLinkTarget(assetsRoot(process.env), asset)
      if (!(yield* Effect.promise(() => 路径存在(target))))
        return fail(409, "资产文件缺失，请重新发布", "asset_files_missing")

      // 同名拦截：以 SKILL.md 的 frontmatter name 为准（内核也按它去重）
      const 新名 = yield* 读名字(target)
      const 已启用 = yield* Effect.promise(() => enabledAssetIds(deps.pg(), projectId))
      for (const 已有 of 已启用) {
        if (已有 === assetId) continue
        const 另一份 = yield* Effect.promise(() => assetById(deps.pg(), 已有))
        if (另一份 === undefined || 另一份.visibility === "personal") continue
        const 另一名 = yield* 读名字(skillLinkTarget(assetsRoot(process.env), 另一份))
        if (新名 !== undefined && 新名 === 另一名)
          return fail(409, `项目里已启用同名 skill：${新名}`, "duplicate_skill_name")
      }

      // 上限是 `ENABLEMENT_LIMIT` 常量，由库层自己带（`enablement.ts`），这里不传
      const 结果 = yield* Effect.promise(() => enableAsset(deps.pg(), { projectId, assetId, userId }))
      if (结果 === "limit_reached")
        return fail(409, `每个项目最多启用 ${ENABLEMENT_LIMIT} 个 skill，请先停用一个`, "enablement_limit")

      const 目录 = 项目目录(deps, userId, projectId)
      yield* Effect.promise(() => linkSkill(目录, assetId, target)).pipe(
        Effect.catchCause((cause) => Effect.logError("链接失败，等待下一次对账修复", { projectId, assetId, cause })),
      )
      yield* 丢缓存(deps, 目录)
      yield* 记治理(deps, userId, {
        board: BOARD,
        action: "asset.enable",
        targetType: "asset",
        targetId: assetId,
        result: "ok",
        detail: { projectId },
      })
    } else {
      // 停用对「库里没有这条」的 assetId 也回 200 + 审计，这是刻意的幂等：用户连点两次、
      // 或两台机器同时点，不该第二次报错。幽灵 id 也留一条审计，便于追「谁按了什么」。
      yield* Effect.promise(() => disableAsset(deps.pg(), { projectId, assetId }))
      const 目录 = 项目目录(deps, userId, projectId)
      yield* Effect.promise(() => unlinkSkill(目录, assetId)).pipe(
        Effect.catchCause((cause) => Effect.logError("摘链接失败，等待下一次对账修复", { projectId, assetId, cause })),
      )
      yield* 丢缓存(deps, 目录)
      yield* 记治理(deps, userId, {
        board: BOARD,
        action: "asset.disable",
        targetType: "asset",
        targetId: assetId,
        result: "ok",
        detail: { projectId },
      })
    }

    return ok(yield* 对账并读(deps, userId, projectId))
  })
}
