export * as OpenhiveCaseMatch from "./case-match"

import { 金额分 } from "./case-row-query"

/**
 * 同一笔转账的判定（10 §3.2）。
 *
 * 匹配键 = 对齐后的（付款方, 收款方）+ 币种 CNY + 金额 + **UTC+8 日历日**。
 * human 关系只有日期精度（笔录「2026年2月10日」），事件到秒；所以按日历日分桶，
 * 不按绝对时间相等。
 *
 * 一一匹配：同桶内关系与事件各按 (时间, id) 排序，只排除「前 N 个」事件（N = 关系数）。
 * 多出来的事件正常进机器聚合；多出来的关系不覆盖任何事件——宁可多算也不吞（fail-closed）。
 *
 * 两遍：
 * 1. `自动抽取` / `存疑`：桶键含金额（精确匹配）。
 * 2. `已确认` / `已修正`：桶键只含「对 + 日」，**忽略金额**。人工改过金额的关系若还按金额
 *    匹配，原事件会重新计入 —— 那是双算（D-4）。
 *
 * 时区固定 UTC+8（与 `case-time.ts` 同款约定），不随进程时区漂。
 */
const 时区偏移秒 = 8 * 3600
const 一天秒 = 86400

function 日历日(秒: number): number {
  return Math.floor((秒 + 时区偏移秒) / 一天秒)
}

export interface 关系候选 {
  readonly id: string
  readonly from代表: string
  readonly to代表: string
  readonly amount: string | null
  readonly firstAt: number | null
  readonly trustState: string
}

export interface 事件候选 {
  readonly id: string
  readonly from代表: string
  readonly to代表: string
  readonly amount: string
  readonly occurredAt: number | null
  readonly currency: string
}

function 先后(甲: { id: string }, 乙: { id: string }): number {
  return 甲.id < 乙.id ? -1 : 甲.id > 乙.id ? 1 : 0
}

function 分桶<项>(项们: readonly 项[], 键函数: (项: 项) => string): Map<string, 项[]> {
  const 桶 = new Map<string, 项[]>()
  for (const 项 of 项们) {
    const k = 键函数(项)
    const 列 = 桶.get(k)
    if (列 === undefined) 桶.set(k, [项])
    else 列.push(项)
  }
  return 桶
}

export function 匹配覆盖事件(
  关系们: readonly 关系候选[],
  事件们: readonly 事件候选[],
): Set<string> {
  const 可用 = 事件们
    .filter((e) => e.currency === "CNY" && e.occurredAt !== null)
    .sort((甲, 乙) => (甲.occurredAt! - 乙.occurredAt!) || 先后(甲, 乙))
  const 已用 = new Set<string>()
  const 覆盖 = new Set<string>()

  /** 从桶里取第一个未用事件；退化成线性扫描，桶内条数就是同日同额笔数，量很小。 */
  const 取 = (列: readonly 事件候选[] | undefined): 事件候选 | undefined => {
    if (列 === undefined) return undefined
    for (const e of 列) if (!已用.has(e.id)) return e
    return undefined
  }
  const 用 = (e: 事件候选): void => {
    已用.add(e.id)
    覆盖.add(e.id)
  }

  const 对日 = (f: string, t: string, 秒: number) => `${f}\u0000${t}\u0000${日历日(秒)}`
  // 日期与金额之间必须有分隔符：少了它，`10000`+`1` 与 `1000`+`01` 会撞键。
  const 精确桶 = 分桶(可用, (e) => `${对日(e.from代表, e.to代表, e.occurredAt!)}|${金额分(e.amount)}`)
  const 宽松桶 = 分桶(可用, (e) => 对日(e.from代表, e.to代表, e.occurredAt!))

  const 有效 = 关系们.filter((r) => r.trustState !== "已排除" && r.firstAt !== null)
  const 时间序 = (甲: 关系候选, 乙: 关系候选) => (甲.firstAt! - 乙.firstAt!) || 先后(甲, 乙)
  const 精确 = 有效
    .filter((r) => r.trustState !== "已确认" && r.trustState !== "已修正" && r.amount !== null)
    .sort(时间序)
  const 宽松 = 有效.filter((r) => r.trustState === "已确认" || r.trustState === "已修正").sort(时间序)

  for (const r of 精确) {
    const k = `${对日(r.from代表, r.to代表, r.firstAt!)}|${金额分(r.amount!)}`
    const 命中 = 取(精确桶.get(k))
    if (命中 !== undefined) 用(命中)
  }
  for (const r of 宽松) {
    const 命中 = 取(宽松桶.get(对日(r.from代表, r.to代表, r.firstAt!)))
    if (命中 !== undefined) 用(命中)
  }
  return 覆盖
}
