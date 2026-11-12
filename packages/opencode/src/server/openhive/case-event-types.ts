export * as OpenhiveCaseEventTypes from "./case-event-types"

/**
 * 事件类型：第四份受控词表（01 §14.1 Q17）。
 *
 * 另外三份是字段词表（`case-field-registry`）、角色词表（§3.3）、实体类型词表（§3.5 那 8 种）。
 * 与角色词表同理，**写成代码常量、不写数据库 CHECK**：业务类型会增长，写进 CHECK 就等于
 * 「加一种类型改一次迁移」（`0031` 的 `case_relation.type` 就是这么被卡住的）。
 *
 * 谁消费：
 * - 卡片翻译（本期）：`资金/v1` 产出 `资金交易`；
 * - 模板编辑器下拉（P4，§4.7.3）：只能从本词表选，改词表 = 改代码；
 * - 「申请新类型」入口（P4）人工确认后加进本数组。
 *
 * 为什么不许各叫各的（`#010-05`）：AI 按类型查 `case_event.type`，同一种事叫两个名字，
 * 查询就会漏掉一半。
 */
export const 事件类型们 = [
  "资金交易",
  "通话",
  "消费",
  "乘车",
  "乘机",
  "住宿",
  "见面",
  "抓获",
  "其他",
] as const

export type 事件类型 = (typeof 事件类型们)[number]

/**
 * 资金交易的类型值（Q17 词表的**唯一消费入口**）。
 *
 * 生产代码（翻译、关系聚合）与测试都引用它；各写一遍字面量时，改词表不会让任何地方变红
 * （M4 / `#010-05`）。
 */
export const 资金交易: 事件类型 = "资金交易"

export function 是事件类型(值: unknown): 值 is 事件类型 {
  return typeof 值 === "string" && (事件类型们 as readonly string[]).includes(值)
}
