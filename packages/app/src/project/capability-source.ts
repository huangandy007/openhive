import type { AssetStatus } from "@opencode-ai/asset-service/metadata"
import type { 内核技能, 被覆盖技能 } from "@/ai-assets/enable-api"

/**
 * 「这个项目现在能用什么」的三态合并（`2026-10-27-项目能力面板-design.md` §4）。
 *
 * ## 三态
 *
 * - `library` ＋ `loaded: true` —— 库里有记录、内核也加载到了（正常）
 * - `library` ＋ `loaded: false` —— 库里有、内核没看见（**服务端已先对过账**，所以这是真问题）
 * - `local` —— 内核看得见、库里没有（用户自己在项目文件夹里写的）
 *
 * ## 为什么没有内核数据就返回 `undefined`
 *
 * 只有库侧数据时，无法区分「没生效」与「只是没读到」。返回空数组会把这些技能全画成
 * 「一条都没装」，那是假话（`#002-02`）。
 *
 * ## 来源判定只看 `assetStatus`（2026-11-01）
 *
 * 「在不在库里」的权威判据是内核清单里**有没有 `assetStatus` 这个键**。
 * `assetId` 不行——本项目自带的技能也有（它就是目录名）；`enabled` 也不行——草稿链进项目时
 * **不写启用行**，可它确实是库里的条目。`enabled` 只用来补「库里有、内核这次没看见」的第二态
 * 与旧版服务端缺 `assetStatus` 时的兜底。`status` 缺席 = **阶段未知**，不要断言缺席的成因。
 *
 * ## 顺序
 *
 * 库内条目先按 `enabled` 的迭代顺序（服务端给什么就什么顺序），再补「有 `assetStatus`、但不在
 * `enabled` 里」的那些（草稿，按内核返回顺序）；自带条目按内核返回顺序排在最后。
 * 两个来源各自有序，合并时**不重排**——重排等于替用户决定「哪个更重要」。
 */
export interface 库内条目 {
  readonly kind: "library"
  readonly assetId: string
  readonly name: string
  readonly description?: string
  readonly loaded: boolean
  /**
   * `loaded === false` 的成因之二：被一份**同名**技能盖掉（2026-10-28）。
   *
   * 缺席 = 「进程里没有它，且服务端没说被谁盖了」——那才该说「快捷方式可能丢了」。
   * `name` 是撞上的 frontmatter name，`location` 是赢家的 SKILL.md 落点（可能在本项目内，
   * 也可能在项目外，如全局 `skills.paths`）。
   */
  readonly 覆盖者?: { readonly name: string; readonly location: string }
  /**
   * 库里那一行的状态（2026-11-01）。**缺席 = 阶段未知**，不是「未入库」（`#002-02`）。
   */
  readonly status?: AssetStatus
  /**
   * 库里那行的属主（`owner_id`）；「是不是我的」靠它判，不靠名字。
   *
   * 全链已贯通到这一层，但**本期前端不消费**：`currentUser` 只有 `policeId`，它与
   * `owner_id` 不是同一套标识、不可比。留给 009「我的创作」——到那时再接判断，别在这里猜等价。
   */
  readonly ownerId?: string
  /** 最近一次业务驳回的理由；缺行 = 没被驳回过，不要编理由。 */
  readonly rejectReason?: string
}

export interface 自带条目 {
  readonly kind: "local"
  readonly name: string
  readonly description?: string
  /**
   * 技能目录相对项目目录的路径（Task 6.5），由内核条目原样透传；缺席 = 服务端算不出来。
   *
   * 「未入库 → 入库并提交」拿它当 `POST /openhive/assets/draft` 的 `skillPath` 入参。
   * **库内条目不带**：库里的条目已经入库了，这个字段只服务「未入库」那一档。
   */
  readonly skillPath?: string
}

export type 能力条目 = 库内条目 | 自带条目

export interface 合并输入 {
  readonly enabled: ReadonlySet<string>
  readonly skills: readonly 内核技能[] | undefined
  /** 服务端点名的「被同名技能盖掉的启用资产」；缺席 = 没有被盖的（或这次没读到内核）。 */
  readonly shadowed?: readonly 被覆盖技能[] | undefined
}

export function 合并能力(输入: 合并输入): 能力条目[] | undefined {
  const 清单 = 输入.skills
  if (清单 === undefined) return undefined

  const 库里 = new Map<string, 内核技能>()
  const 自带: 自带条目[] = []
  for (const 条 of 清单) {
    // 【保留的定制 · 同步上游时不要丢】来源判定按 assetStatus（2026-11-01）。
    // 不能用 enabled：草稿链进项目时不写启用行，但它确实在库里。
    if (条.assetStatus !== undefined) {
      // 服务端今天必给 assetId；这里的 `?? 条.name` 与下面组装库内条目时的 `?? id` 只是兜底，
      // 只为不造出 undefined 键。
      库里.set(条.assetId ?? 条.name, 条)
      continue
    }
    // 兜底：`enabled` 里有这个 id，就仍按库内算（内核清单缺 `assetStatus` 时保住旧判据）。
    if (条.assetId !== undefined && 输入.enabled.has(条.assetId)) {
      // 重复 assetId 时后一条覆盖前一条、前一条整体消失：有意取舍——库内清单来自 enabled 这个 Set，不受影响；内核侧同名目录属极端形状，不为此加去重。
      库里.set(条.assetId, 条)
      continue
    }
    自带.push({
      kind: "local",
      name: 条.name,
      ...(条.description === undefined ? {} : { description: 条.description }),
      ...(条.skillPath === undefined ? {} : { skillPath: 条.skillPath }),
    })
  }

  // 只认**本项目已启用**的那些：服务端可能多报（别的项目 / 不是这次 enabled 的），
  // 凭空造一条条目或覆盖者都是替服务端补话（`#002-02`）。
  const 覆盖表 = new Map<string, { name: string; location: string }>()
  for (const 项 of 输入.shadowed ?? []) {
    if (!输入.enabled.has(项.assetId)) continue
    覆盖表.set(项.assetId, { name: 项.name, location: 项.location })
  }

  // 中文名优先取库里标题；内核没加载到它时只有 assetId 可用（不编一个名字出来）。
  const 造库内 = (
    assetId: string,
    命中: 内核技能 | undefined,
    覆盖者: { name: string; location: string } | undefined,
  ): 库内条目 => ({
    kind: "library",
    assetId,
    name: 命中?.assetName ?? 命中?.name ?? assetId,
    ...(命中?.description === undefined ? {} : { description: 命中.description }),
    loaded: 命中 !== undefined,
    ...(覆盖者 === undefined ? {} : { 覆盖者 }),
    ...(命中?.assetStatus === undefined ? {} : { status: 命中.assetStatus }),
    ...(命中?.assetOwnerId === undefined ? {} : { ownerId: 命中.assetOwnerId }),
    ...(命中?.assetRejectReason === undefined ? {} : { rejectReason: 命中.assetRejectReason }),
  })

  const 库内: 库内条目[] = []
  const 已出 = new Set<string>()
  for (const assetId of 输入.enabled) {
    const 命中 = 库里.get(assetId)
    已出.add(assetId)
    库内.push(造库内(assetId, 命中, 命中 === undefined ? 覆盖表.get(assetId) : undefined))
  }
  // 有 `assetStatus`、但不在 `enabled` 里的（草稿链进项目时不写启用行）：按内核返回顺序补在后面。
  for (const [id, 条] of 库里) {
    if (已出.has(id)) continue
    库内.push(造库内(条.assetId ?? id, 条, undefined))
  }

  return [...库内, ...自带]
}

/**
 * 数「我能用的」= 库内条目数（含没生效的 ②）。
 *
 * 自带的 ③ 不数：它不在配额账上，算进去会出现「3/20」却只能再装 18 个（设计 §6）。
 */
export function 计数(条目: readonly 能力条目[]): number {
  return 条目.filter((条) => 条.kind === "library").length
}

/**
 * 一条技能处在哪一步。`未入库` 是自带条目的唯一阶段。
 *
 * 返回 `undefined` = 阶段未知（`status` 缺席的成因不唯一），**不要冒充「未入库」**
 * （`#002-02`：把「读不到」画成「没入库」会诱导用户重复入库）。
 */
export function 阶段(条: 能力条目): AssetStatus | "未入库" | undefined {
  return 条.kind === "local" ? "未入库" : 条.status
}
