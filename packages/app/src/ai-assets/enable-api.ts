/**
 * 项目级 skill 启用的客户端（2026-10-27）。
 *
 * 出口的分工见 `packages/opencode/src/server/openhive/project-assets.ts` 文件头。
 * 这里只做四件事：拼 URL、发请求、把**成功/失败**收成三态、把服务端的 `code` 原样带回去。
 *
 * 四个出口：读状态、单条启用、单条停用、**一键开关自动送达**（需求 5a——它回的是整份状态，
 * 与读状态同形，因为关掉之后「还有哪些自动项」只有服务端知道）。
 *
 * **失败不抛**：调用方（`enable-state.ts`）把它变成一条给人看的错误，再决定是否回滚乐观态。
 * 与服务端回包同口径：`{ error }` 就是那句人话。
 *
 * ## `enabledCount` 不是 `enabled.length`
 *
 * `enabled` 只含**当前读者可见**的 id；`enabledCount` 是**项目真相**（含读者看不见的）。
 * 两者不等是刻意的——配额按项目算，不是按「我看得见几个」算。故这里整份原样解析，
 * **不用数组长度重算计数**。
 *
 * ## 与其它客户端同一套范式
 *
 * 同源相对路径、可注入的 `send`、10 秒超时（理由见 `account-api.ts` 文件头）。
 */

import { ASSET_STATUSES, type AssetStatus } from "@opencode-ai/asset-service/metadata"

export const PATH = {
  state: "/openhive/project/assets",
  enable: "/openhive/project/assets/enable",
  disable: "/openhive/project/assets/disable",
  autoDelivery: "/openhive/project/assets/auto-delivery",
} as const

export const TIMEOUT_MS = 10_000

/**
 * 内核视角的一条技能（与后端 `project-assets.ts` 的 `内核技能` 逐字对应）。
 *
 * **刻意各写一份**：字段是跨进程契约，写字面量（同 `#003-05` 的纪律）；但类型/常量可以
 * import——`@opencode-ai/asset-service/metadata` 是前端运行时常量来源，不是内核源码。
 *
 * `assetId` 取自 `location` 倒数第二段目录名——**本项目自带的技能同样有**（就是它的目录名）；
 * `assetName` 只是库里的标题，不能当「在不在库里」的判据（自带条目可能碰巧撞名）。
 *
 * **「在不在库里」只认 `assetStatus` 有没有这个键**（2026-11-01）：`assetId` 自带条目也有，
 * `enabled` 又漏掉草稿——草稿链进项目时不写启用行，但它是库里的条目。
 */
export interface 内核技能 {
  readonly name: string
  readonly description?: string
  readonly location: string
  readonly assetId?: string
  readonly assetName?: string
  /** 库里那一行的状态；**键缺席 = 未入库**（权威判据，见上）。 */
  readonly assetStatus?: AssetStatus
  /** 库里那行的属主；「是不是我的」靠它判，不靠名字。 */
  readonly assetOwnerId?: string
  /** 最近一次业务驳回的理由；缺行 = 没被驳回过，不要编理由。 */
  readonly assetRejectReason?: string
  /**
   * 技能目录相对项目目录的路径（Task 6.5），正斜杠；`"."` = 技能目录就是项目根。
   * 「一键入库」拿它调 `POST /openhive/assets/draft`——相对路径只能由服务端算，
   * 前端反推要靠沙箱根，那是服务端 env，还会在换落盘根时错（`#010-04`）。
   */
  readonly skillPath?: string
}

/**
 * 已启用、却被一份同名技能盖掉的资产（与后端 `project-assets.ts` 的 `被覆盖技能` 逐字对应）。
 *
 * 「库里有、内核没看见」有两种成因：链接真丢了，或者链接完好但内核按 frontmatter name 去重时
 * 留了另一份。只报前者会把后者说成「快捷方式可能丢了」（2026-10-28 真栈实测）。
 * `location` 是**赢家**的 SKILL.md 落点。
 */
export interface 被覆盖技能 {
  readonly assetId: string
  readonly name: string
  readonly location: string
}

export interface EnablementState {
  readonly enabled: readonly string[]
  readonly enabledCount: number
  readonly limit: number
  /**
   * 【保留的定制 · 同步上游时不要丢】自动送达（需求 5a，2026-10-27）。
   *
   * `enabled` 是**手动启用**（库里真有启用行）；`auto` 是服务端按「读得到的已发布 skill，
   * 按发布时间倒序、占满剩余预算」自动链进项目的那些。两者都在项目目录里、都对内核可见，
   * 区别只在「下次对账还算不算你」——故分开报，不合并成一个数组。
   *
   * `autoDelivery` 是项目级开关（无行 = 开）：关掉后服务端不再新增自动项。
   *
   * 下面两项是内核视角的技能清单（服务端在自己算好的沙箱目录上读的）。
   *
   * **`undefined` = 服务端没读到**（实例层缺席 / 读取失败），与 `[]`（明确一条都没有）
   * 是两件事。渲染层据此决定说「暂时读不到」还是「一条都没装」（`#002-02`）。
   */
  readonly auto: readonly string[]
  readonly autoDelivery: boolean
  readonly skills?: readonly 内核技能[]
  /**
   * 已启用却被同名技能盖掉的资产（2026-10-28）。**键缺席** = 没有被盖的（或这次没读到内核），
   * 与 `skills` 同一条纪律：不拿空数组冒充「没有」以外的含义，也不拿旧值解释新一次读。
   */
  readonly shadowed?: readonly 被覆盖技能[]
}

export type EnableOutcome =
  | { readonly kind: "ok"; readonly value: EnablementState }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export type EnableFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface EnableApi {
  readonly read: (projectId: string) => Promise<EnableOutcome>
  readonly enable: (input: { readonly projectId: string; readonly assetId: string }) => Promise<EnableOutcome>
  readonly disable: (input: { readonly projectId: string; readonly assetId: string }) => Promise<EnableOutcome>
  /** 一键开关自动送达（需求 5a）。回包与 `read` 同形：关掉后 `auto` 就是空的。 */
  readonly setAutoDelivery: (input: {
    readonly projectId: string
    readonly enabled: boolean
  }) => Promise<EnableOutcome>
}

async function 默认发送(input: string, init?: RequestInit): Promise<Response> {
  const 控制器 = new AbortController()
  const 定时器 = setTimeout(() => 控制器.abort(), TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: 控制器.signal })
  } finally {
    clearTimeout(定时器)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 闭集守卫：与本项目其它前端出口同一套（不认的值当形状错误，不当「某个阶段」）。 */
const 是状态 = (value: unknown): value is AssetStatus =>
  typeof value === "string" && ASSET_STATUSES.some((状态) => 状态 === value)

function 解析状态(body: unknown): EnablementState | undefined {
  if (!isRecord(body)) return undefined
  const 值 = body
  const 启用 = 值["enabled"]
  if (!Array.isArray(启用)) return undefined
  // 元素必须是字符串：不再 `String()` 把 `[1]` 洗成 `["1"]`——形状不对就说形状不对。
  if (!启用.every((item): item is string => typeof item === "string")) return undefined
  if (typeof 值["enabledCount"] !== "number") return undefined
  if (typeof 值["limit"] !== "number") return undefined
  // 需求 5a 的两个字段同样是硬形状：缺了不能退化成「没有自动送达」——那与「服务端没升级」
  // 长得一模一样（`#002-02`）。
  const 自动 = 值["auto"]
  if (!Array.isArray(自动)) return undefined
  if (!自动.every((item): item is string => typeof item === "string")) return undefined
  if (typeof 值["autoDelivery"] !== "boolean") return undefined
  // 不能整体当作「可选、解析失败就丢掉」：那会把「服务端说了一条」悄悄改成「一条都没有」。
  // 形状不对就整份回包判错（`#002-02`：不知道 ≠ 空）。
  const 技能原 = 值["skills"]
  let 技能: readonly 内核技能[] | undefined
  if (技能原 !== undefined) {
    if (!Array.isArray(技能原)) return undefined
    const 逐条: 内核技能[] = []
    for (const 项 of 技能原) {
      if (!isRecord(项)) return undefined
      if (typeof 项["name"] !== "string") return undefined
      if (typeof 项["location"] !== "string") return undefined
      if (项["description"] !== undefined && typeof 项["description"] !== "string") return undefined
      if (项["assetId"] !== undefined && typeof 项["assetId"] !== "string") return undefined
      if (项["assetName"] !== undefined && typeof 项["assetName"] !== "string") return undefined
      // 三个新字段同一条严格度：认不出的状态整份判错，不把它降级成「未入库」——
      // 那会把「服务端升级了、前端不认识」画成「库里没有」（`#002-02`）。
      if (项["assetStatus"] !== undefined && !是状态(项["assetStatus"])) return undefined
      if (项["assetOwnerId"] !== undefined && typeof 项["assetOwnerId"] !== "string") return undefined
      if (项["assetRejectReason"] !== undefined && typeof 项["assetRejectReason"] !== "string") return undefined
      // Task 6.5：与非空规则同一处。类型不对 ⇒ 整份判错（不降级成「缺席」）；
      // 空串 ⇒ 视为缺席——调用方拿空串拼请求，等于把「算不出来」当成「项目根」。
      if (项["skillPath"] !== undefined && typeof 项["skillPath"] !== "string") return undefined
      逐条.push({
        name: 项["name"],
        location: 项["location"],
        ...(项["description"] === undefined ? {} : { description: 项["description"] }),
        ...(项["assetId"] === undefined ? {} : { assetId: 项["assetId"] }),
        ...(项["assetName"] === undefined ? {} : { assetName: 项["assetName"] }),
        ...(项["assetStatus"] === undefined ? {} : { assetStatus: 项["assetStatus"] }),
        ...(项["assetOwnerId"] === undefined ? {} : { assetOwnerId: 项["assetOwnerId"] }),
        ...(项["assetRejectReason"] === undefined ? {} : { assetRejectReason: 项["assetRejectReason"] }),
        ...(typeof 项["skillPath"] === "string" && 项["skillPath"] !== "" ? { skillPath: 项["skillPath"] } : {}),
      })
    }
    技能 = 逐条
  }
  // 同 `skills` 的严格度：形状不对就整份判错，不把「说不清」降级成「没被盖」——
  // 那会让面板回到「快捷方式可能丢了」的诬告上（`#002-02`）。
  const 覆盖原 = 值["shadowed"]
  let 覆盖: readonly 被覆盖技能[] | undefined
  if (覆盖原 !== undefined) {
    if (!Array.isArray(覆盖原)) return undefined
    const 逐条: 被覆盖技能[] = []
    for (const 项 of 覆盖原) {
      if (!isRecord(项)) return undefined
      if (typeof 项["assetId"] !== "string") return undefined
      if (typeof 项["name"] !== "string") return undefined
      if (typeof 项["location"] !== "string") return undefined
      逐条.push({ assetId: 项["assetId"], name: 项["name"], location: 项["location"] })
    }
    覆盖 = 逐条
  }
  return {
    enabled: 启用,
    enabledCount: 值["enabledCount"],
    limit: 值["limit"],
    auto: 自动,
    autoDelivery: 值["autoDelivery"],
    // 键整个缺席 = 不知道；不写 `skills: undefined`（那会让「有键但值为 undefined」也成立，
    // 区分靠的是键在不在，与后端 `带内核清单` 对齐）。
    ...(技能 === undefined ? {} : { skills: 技能 }),
    ...(覆盖 === undefined ? {} : { shadowed: 覆盖 }),
  }
}

async function 解包(response: Response): Promise<EnableOutcome> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: "error", message: `服务端回了非 JSON（${response.status}）` }
  }
  if (!response.ok) {
    const 值: Record<string, unknown> = isRecord(body) ? body : {}
    const message = typeof 值["error"] === "string" ? 值["error"] : `请求失败（${response.status}）`
    const code = typeof 值["code"] === "string" ? 值["code"] : undefined
    return code === undefined ? { kind: "error", message } : { kind: "error", message, code }
  }
  const 状态 = 解析状态(body)
  if (状态 === undefined) return { kind: "error", message: "服务端回包形状不对" }
  return { kind: "ok", value: 状态 }
}

export function createEnableApi(send: EnableFetch = 默认发送): EnableApi {
  const 发送 = async (url: string, init?: RequestInit): Promise<EnableOutcome> => {
    try {
      return await 解包(await send(url, init))
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : "网络请求失败" }
    }
  }

  const 切换 = (url: string, input: { projectId: string; assetId: string }) =>
    发送(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: input.projectId, assetId: input.assetId }),
    })

  return {
    read: (projectId) => 发送(`${PATH.state}?projectId=${encodeURIComponent(projectId)}`),
    enable: (input) => 切换(PATH.enable, input),
    disable: (input) => 切换(PATH.disable, input),
    setAutoDelivery: (input) =>
      发送(PATH.autoDelivery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: input.projectId, enabled: input.enabled }),
      }),
  }
}
