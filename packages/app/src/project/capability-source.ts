import type { 内核技能 } from "@/ai-assets/enable-api"

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
 * ## 顺序
 *
 * 库内条目按 `enabled` 的迭代顺序（服务端给什么就什么顺序），自带条目按内核返回顺序排在后面。
 * 两个来源各自有序，合并时**不重排**——重排等于替用户决定「哪个更重要」。
 */
export interface 库内条目 {
  readonly kind: "library"
  readonly assetId: string
  readonly name: string
  readonly description?: string
  readonly loaded: boolean
}

export interface 自带条目 {
  readonly kind: "local"
  readonly name: string
  readonly description?: string
}

export type 能力条目 = 库内条目 | 自带条目

export interface 合并输入 {
  readonly enabled: ReadonlySet<string>
  readonly skills: readonly 内核技能[] | undefined
}

export function 合并能力(输入: 合并输入): 能力条目[] | undefined {
  const 清单 = 输入.skills
  if (清单 === undefined) return undefined

  const 内核在某资产 = new Map<string, 内核技能>()
  const 自带: 自带条目[] = []
  for (const 条 of 清单) {
    if (条.assetId !== undefined && 输入.enabled.has(条.assetId)) {
      内核在某资产.set(条.assetId, 条)
      continue
    }
    自带.push({
      kind: "local",
      name: 条.name,
      ...(条.description === undefined ? {} : { description: 条.description }),
    })
  }

  const 库内: 库内条目[] = []
  for (const assetId of 输入.enabled) {
    const 命中 = 内核在某资产.get(assetId)
    库内.push({
      kind: "library",
      assetId,
      // 中文名优先取库里标题；内核没加载到它时只有 assetId 可用（不编一个名字出来）。
      name: 命中?.assetName ?? 命中?.name ?? assetId,
      ...(命中?.description === undefined ? {} : { description: 命中.description }),
      loaded: 命中 !== undefined,
    })
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
