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
 * ⚠️ **「立即生效」只对操作者自己的沙箱成立**（R8）：启停改的是操作者自己那份项目目录；
 * 其他成员要「自己的 GET 对账」**且**「自己的实例重建」两件事都发生，才看得见 / 看不见。
 * 不做成员广播——那会打断别人正在跑的会话，需要单独的产品决策。
 *
 * ⚠️ 丢缓存会打断在跑实例：正在生成的会话会经历一次实例重建（表现为前端收到
 * `server.instance.disposed` 后重拉该目录的状态）。所以它只落在**目录真的变了**的时候：
 * 显式启停各一次，以及 `GET` 对账里 `created/removed > 0` 的那次（需求 5a：自动送达
 * 第一次建链接、关掉开关摘链接）。**不要**改成「每次 GET 都丢」——那会打断别人正在跑的会话。
 *
 * ## 自动送达（需求 5a，2026-10-27 用户裁定）
 *
 * 审核通过的 skill **不用点启用**：读者打开自己的项目时，`对账并读()` 把他读得到的
 * 已发布 skill 一并链进沙箱。规则细节在 `auto-delivery.ts`（候选集）与这里的三句话：
 *
 * - 预算是 `ENABLEMENT_LIMIT` **减去**该项目已手动启用的条数——手动装满就不再自动送；
 * - 自动送达**不写启用行**：它不是「替用户点了启用」，关掉开关时靠目录对账还原；
 * - 关掉后立刻摘链接（`对账并读()` 重算 `desired` 时不再含自动候选并丢缓存）。
 *
 * `global` 档不在候选集：它走内核配置的 `skills.paths`（`/assets/global/skills`），
 * 一份配置全单位生效，不吃个人预算。
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
import {
  autoDeliverableAssets,
  autoDeliveryOf,
  setAutoDelivery,
} from "@opencode-ai/asset-service/auto-delivery"
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
import { SHARED_STATUSES } from "@opencode-ai/asset-service/readable-sql"
import { assetsRoot } from "@opencode-ai/asset-service/storage"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { rolesOf } from "@opencode-ai/auth/project-member"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { User } from "@opencode-ai/core/user"
import { InstanceStore } from "@/project/instance-store"
import { ConfigMarkdown } from "@/config/markdown"
import { AnchorWorkspace } from "@/server/routes/instance/httpapi/middleware/anchor-workspace"
import { Skill } from "@/skill"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { 记治理 } from "./audit"
import { disposeInstanceDirectory } from "./instance-cache"
import { OpenhivePg } from "./pg"

export const PREFIX = "/openhive/project/assets"

export const PATH = {
  state: PREFIX,
  enable: `${PREFIX}/enable`,
  disable: `${PREFIX}/disable`,
  /** 需求 5a：自动送达开关（按「人 × 项目」记）。 */
  autoDelivery: `${PREFIX}/auto-delivery`,
} as const

/**
 * 内核视角的一条技能。
 *
 * **不含 `content`**：`Skill.Info.content` 是 SKILL.md 全文，进 HTTP 回包既浪费又是泄露面。
 *
 * `assetId` = `location` 倒数第二段目录名，本项目自带的技能同样有（就是它的目录名）；
 * `assetName` 才是「库里确有这份资产」的标记——③「本项目自带」的条目只有 `assetId`，
 * 没有 `assetName`。前端**不得**用 `assetId !== undefined` 判「是不是库里的」，只能比 `enabled`。
 */
export interface 内核技能 {
  readonly name: string
  readonly description?: string
  readonly location: string
  readonly assetId?: string
  readonly assetName?: string
}

interface 状态基 {
  readonly enabled: readonly string[]
  readonly enabledCount: number
  readonly limit: number
}

/**
 * 把内核清单并进返回体。
 *
 * `内核 === undefined` ⇒ **整个 `skills` 键缺席**，不是空数组。空数组会被前端读成
 * 「内核一条都没看见」⇒ 把每条技能都标成「没生效」，而事实只是「这次没读到」（`#002-02`）。
 */
export function 带内核清单<T extends 状态基>(
  base: T,
  内核: readonly 内核技能[] | undefined,
): T & { skills?: readonly 内核技能[] } {
  if (内核 === undefined) return base
  return { ...base, skills: 内核 }
}

const BOARD = "asset-governance"

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  readonly root: string
  readonly store: Option.Option<InstanceStore.Interface>
  /**
   * 内核技能服务：**必须在层构造期取**，不能等到请求期再 `yield* Skill.Service`。
   *
   * `InstanceStore.provide()` 只往作用域里补 `InstanceRef`，**不补**实例服务：请求期的
   * environment 里没有 `Skill.Service`（实测 `Service not found: @opencode/Skill`），
   * 于是 `读内核清单` 每次都被 catch 折成「不知道」⇒ `skills` 键永远缺席、面板永远
   * 说「暂时读不到」。这与上游 handler 的写法一致（服务在层构造期捕获，请求体只跑副作用）。
   */
  readonly skill: Option.Option<Skill.Interface>
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config
    // 测试里可能没有内核实例层（只挂路由的子集）：缺席时丢弃缓存这一步跳过并告警，不静默
    // 假装做了（`#002-02`）。
    const store = yield* Effect.serviceOption(InstanceStore.Service)
    // 同上：只挂路由子集的测试可能没有内核层；缺席时 `skills` 键整份缺席（「不知道」）。
    const skill = yield* Effect.serviceOption(Skill.Service)
    const deps: Deps = { pg: openhivePg.pg, root: config.root, store, skill }

    yield* router.add("GET", PATH.state, (request) => handleState(request, deps))
    yield* router.add("POST", PATH.enable, (request) => handleToggle(request, deps, "enable"))
    yield* router.add("POST", PATH.disable, (request) => handleToggle(request, deps, "disable"))
    yield* router.add("POST", PATH.autoDelivery, (request) => handleAutoDelivery(request, deps))
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
  return disposeInstanceDirectory(deps.store, directory, "实例层缺席，跳过缓存丢弃；启用在重启前不生效")
}

/** 从内核技能的 location 里取最后一级目录名（= assetId，或用户自己的目录名）。 */
function 目录名(location: string): string | undefined {
  const 段 = location.split(/[\\/]/).filter((s) => s.length > 0)
  // 期望形态：<沙箱>/.opencode/(skill|skills)/<名>/SKILL.md —— 取倒数第二段。
  if (段.length < 2) return undefined
  return 段[段.length - 2]
}

/** `location` 是否落在本项目沙箱内。全局 / 内置技能一律落在外面，不该进「本项目自带」。 */
export function 属于项目(location: string, 目录: string): boolean {
  // 前缀比较只在 **win32** 忽略大小写：`项目目录()` 与内核 `location` 虽同源，win32 盘符
  // 大小写（`D:\` vs `d:\`）或 env 拼出的根可能不同形；不忽略就会把整个清单筛空 ⇒
  // 前端把每条已启用技能都误标成「没生效」。
  //
  // POSIX 下路径**大小写敏感**：在那边也折小写，会把 `/w/u/P` 与 `/w/u/p`（两个真目录）
  // 当成同一个根，把别人项目里的技能并进「本项目自带」（终审 M1）。
  //
  // ⚠️ 大小写**按平台判定**，不是按文件系统：macOS 默认 APFS 大小写不敏感但 `process.platform`
  // 是 `darwin`，在那里不折小写同样能匹配（同一路径的两种写法本来就指向同一个 inode）。
  // 反过来的坑在这儿：**若将来给 `location` 加 `realpath` 之类的归一化**，在「大小写不敏感但
  // 非 win32」的文件系统上，内核给回的盘符/目录大小写可能与 `项目目录()` 拼出来的不同形 ⇒
  // 前缀比较静默失败、整片清单被筛空（面板把每条已启用技能都标成「没生效」，正是 #002-02 里
  // 「不知道 ≠ 没有」最坏的那种误报）。真要做，归一化必须**同时**处理大小写，别再各改各的。
  const 规整 = (s: string) => {
    const 正斜杠 = s.replace(/\\/g, "/").replace(/\/+$/, "")
    return process.platform === "win32" ? 正斜杠.toLowerCase() : 正斜杠
  }
  const 根 = 规整(目录)
  const 文 = 规整(location)
  // 带分隔符比较：`/w/u/p` 不能吞下 `/w/u/p2/...`。
  return 文 === 根 || 文.startsWith(根 + "/")
}

/** 把内核返回的技能列表筛成「本项目内的」，并映射成回包形状。 */
export function 映射内核清单(
  列表: readonly { name: string; description?: string; location: string }[],
  目录: string,
  标题: ReadonlyMap<string, string>,
): 内核技能[] {
  return 列表
    .filter((info) => 属于项目(info.location, 目录))
    .map((info) => {
      // 查表用原样的目录名（大小写敏感）：assetId 是库里的真实 id。
      const id = 目录名(info.location)
      const 名 = id === undefined ? undefined : 标题.get(id)
      return {
        name: info.name,
        ...(info.description === undefined ? {} : { description: info.description }),
        location: info.location,
        ...(id === undefined ? {} : { assetId: id }),
        ...(名 === undefined ? {} : { assetName: 名 }),
      }
    })
}

/**
 * 在算好的项目目录上读内核技能清单（`Skill.Service.available()`）。
 *
 * `store` / `skill` 缺席（只挂路由子集的测试）⇒ 返回 `undefined`：**不知道**，不谎报为空。
 * 读失败同理——告警并返回 `undefined`，让前端说「暂时读不到」，而不是把每条技能标成没生效。
 *
 * ⚠️ `skill` 是层构造期捕获的（见 `Deps.skill`）：请求期取不到它。
 *
 * ⚠️ 必须在对账**之后**调（见 `对账并读` 末尾）。反过来的话，新成员第一次进项目时
 * 沙箱里还没有链接，全部技能都会被误报成「没生效」。
 */
function 读内核清单(deps: Deps, directory: string, 标题: ReadonlyMap<string, string>) {
  const store = deps.store
  const skill = deps.skill
  if (Option.isNone(store) || Option.isNone(skill))
    return Effect.succeed<readonly 内核技能[] | undefined>(undefined)
  return store.value
    .provide({ directory }, skill.value.available())
    .pipe(
      Effect.map((list) => 映射内核清单(list, directory, 标题)),
      Effect.catchCause((cause) =>
        Effect.logWarning("读内核技能清单失败，本次不回报（不谎报为空）", { directory, cause }).pipe(
          Effect.as<readonly 内核技能[] | undefined>(undefined),
        ),
      ),
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
    // R6：授权组（「指定人员」档）的读权**只**来自授权行。不把读者命中的 grant 传进
    // `canReadAsset()`，就会「列表看得见、送达/启用全无」——判据仍只有那一份。
    const grants = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
    const 可见: string[] = []
    /** 内核清单里的中文名来源：与 `可见` 同一批资产，不额外查库。 */
    const 标题 = new Map<string, string>()
    let 收回 = 0

    const desired = new Map<string, string>()
    for (const assetId of state.enabled) {
      const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
      // 真的**不可送达**的行：资产已删 / 不是 skill / 个人空间（没有共享发布目录）/ 不在
      // 共享状态集。留着它们，计数条会显示 N/20 而卡片一张都点不到，攒到 20 就永久卡死。
      // R7：GET 顺手自愈——先删行、再记审计（`asset.disable` + `reason = "asset_unavailable"`）。
      if (
        asset === undefined ||
        asset.type !== "skill" ||
        asset.visibility === "personal" ||
        !SHARED_STATUSES.has(asset.status)
      ) {
        const 删了 = yield* Effect.promise(() => disableAsset(deps.pg(), { projectId, assetId })).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("收回不可送达的启用行失败，配额待下次自愈", { projectId, assetId, cause }).pipe(
              Effect.as(undefined),
            ),
          ),
        )
        // 删失败不记审计（没有「已收回」这件事可说），更不能把 GET 变成 500。
        if (删了 === undefined) continue
        收回 += 1
        yield* 记治理(deps, userId, {
          board: BOARD,
          action: "asset.disable",
          targetType: "asset",
          targetId: assetId,
          result: "ok",
          detail: { projectId, reason: "asset_unavailable" },
        })
        continue
      }
      // 读者读不到 ⇒ 不链、也不回给前端。只影响 `enabled`，不影响库里的启用事实。
      if (!canReadAsset(viewer, asset, grants)) continue
      // 先记「看得见」再判目录：`enabled` 的语义是**授权**，不是「文件齐不齐」。
      // 发布目录缺失时链接照样建不了（下面 `continue`），但前端仍要能把那份资产标成「已启用」，
      // 否则会出现「已占 1/20 但列表里一份都标不出来」——用户既看不见也点不掉。
      可见.push(assetId)
      标题.set(assetId, asset.name)
      const target = skillLinkTarget(根, asset)
      if (!(yield* Effect.promise(() => 路径存在(target)))) continue
      desired.set(assetId, target)
    }

    // 收回过行 ⇒ 配额已经变了，重读一次库（服务端权威），别把旧计数回给前端。
    const 最新 = 收回 > 0 ? yield* Effect.promise(() => enablementOf(deps.pg(), projectId)) : state

    // ---- 需求 5a：自动送达（2026-10-27，用户裁定）----
    //
    // 预算 = 20 − 该项目已手动启用的条数（**项目真相**，不是「我看得见几个」）：
    // 手动装满就不再自动送，避免「自动一送就超 20」。
    const 自动开关 = yield* Effect.promise(() => autoDeliveryOf(deps.pg(), { userId, projectId }))
    const auto: string[] = []
    if (自动开关.enabled) {
      const 预算 = ENABLEMENT_LIMIT - 最新.enabledCount
      if (预算 > 0) {
        // 候选集读失败不能把 GET 变成 500：手动那部分状态仍要能读出来。
        const 候选 = yield* Effect.promise(() =>
          autoDeliverableAssets(deps.pg(), viewer, { limit: 预算, exclude: state.enabled }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("自动送达候选集读取失败，本次不送", { projectId, cause }).pipe(Effect.as([])),
          ),
        )
        // 同名只留第一份：内核按 SKILL.md 的 frontmatter name 去重，第二份会被静默丢掉
        // ——那正是「说好了自动送、会话里却少一份」的成因（`#005-47` 的同一类）。
        const 已用名字 = new Set<string>()
        for (const assetId of 可见) {
          const 已链 = desired.get(assetId)
          if (已链 === undefined) continue
          const name = yield* 读名字(已链)
          if (name !== undefined) 已用名字.add(name)
        }
        for (const 候选项 of 候选) {
          const target = skillLinkTarget(根, {
            id: 候选项.id,
            visibility: 候选项.visibility,
            department: 候选项.department,
          })
          // 没有落点（发布目录缺失）⇒ 不送、也不回显：`auto` 的含义是「这次真的会出现」。
          if (!(yield* Effect.promise(() => 路径存在(target)))) continue
          const name = yield* 读名字(target)
          if (name !== undefined && 已用名字.has(name)) continue
          if (name !== undefined) 已用名字.add(name)
          auto.push(候选项.id)
          desired.set(候选项.id, target)
        }
      }
    }

    // 对账失败不能把整个 GET 变成 500：库里的启用状态仍要能读出来，目录留到下次自愈。
    const 结果 = yield* Effect.promise(() => reconcileSkillLinks(目录, desired, 根)).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("对账失败，目录状态待下次修复", { projectId, 目录, cause }).pipe(
          Effect.as(undefined),
        ),
      ),
    )
    if (结果 !== undefined && 结果.skipped.length > 0) {
      yield* Effect.logWarning("项目目录里有不是链接的 skill 目录，未动", { skipped: 结果.skipped })
    }
    // 目录真的变了才丢缓存：自动送达第一次建链接 / 关掉开关时都靠这一下让内核重扫。
    // 没变就不打断在跑实例——「立即生效」的代价只付在真正改了目录的那一次。
    if (结果 !== undefined && (结果.created > 0 || 结果.removed > 0)) {
      yield* 丢缓存(deps, 目录)
    }
    // `enabled` 只回**当前读者可见**的 id，而 `enabledCount` 保持项目真相（库里的启用条数）。
    // 两者不等是刻意的：配额按项目算，不是按「我看得见几个」算。
    // 顺序是设计的一部分：先对账（上面已做完）再读内核。反了会把「沙箱还没同步」
    // （新成员第一次进项目）误报成「已启用但没生效」。
    //
    // ⚠️ 对账失败（`结果 === undefined`）⇒ 清单传 `undefined`（键缺席），**不读**内核。
    // 此刻目录还是旧状态：读出来的是一份「缺链接」的清单，前端会把每条已启用 skill 画成
    // 「已启用但 AI 没加载到——停用后可在资产中心重新启用」，在一次临时文件系统故障上
    // 引导用户做破坏性操作。读不到就说读不到，让用户点重试。
    const 内核 = 结果 === undefined ? undefined : yield* 读内核清单(deps, 目录, 标题)
    // 两条定制的交叉点：`auto` / `autoDelivery` 来自 5a（自动送达），`带内核清单` 来自
    // 能力面板。两者都长在同一份回包上，所以合成一个 return，谁都不许吞掉另一边。
    return 带内核清单({ ...最新, enabled: 可见, auto, autoDelivery: 自动开关.enabled }, 内核)
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

/**
 * 需求 5a：自动送达开关（按「人 × 项目」记）。
 *
 * 关掉之后**立刻摘链接**：`对账并读()` 重算 `desired` 时不再包含自动候选，
 * `reconcileSkillLinks()` 会把上次的链接摘掉并丢缓存。打开则反过来。
 */
function handleAutoDelivery(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    const userId = user.value.id

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = body["projectId"]
    const enabled = body["enabled"]
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if (typeof enabled !== "boolean") return fail(400, "enabled 必须是布尔", "bad_request")

    if ((yield* 成员角色(deps, userId, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")

    yield* Effect.promise(() => setAutoDelivery(deps.pg(), { userId, projectId, enabled }))
    const state = yield* 对账并读(deps, userId, projectId)
    yield* 记治理(deps, userId, {
      board: BOARD,
      action: "asset.auto_delivery",
      targetType: "project",
      targetId: projectId,
      result: "ok",
      detail: { enabled },
    })
    return ok(state)
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
      const viewer = { userId, department: 部门 }
      // R6：授权组必须进可见性判定（否则「列表看得见、启用 403」）。判据仍只有
      // `canReadAsset()` 一份，`对账并读` 那边传的是同一批 grant。
      const grants = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
      if (!canReadAsset(viewer, asset, grants)) return fail(403, "无权使用该资产", "forbidden")

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
        // R6：读不到的不拿来比名——否则会把无权读者看不到的资产名回显给他。
        if (!canReadAsset(viewer, 另一份, grants)) continue
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
