export * as OpenhiveCaseEnvelope from "./case-envelope"

/**
 * 工具返回的公共约定：**限制档位**与**空原因枚举**只在这里定义一份。
 *
 * ## 为什么空原因要落成联合类型
 *
 * `09` §3.5 的总表给 16 个值排了序（越靠近「数据缺失」越靠前），规矩是**一个返回只报一个**、
 * 多个同时成立时按表序取第一个。枚举一旦散成各处字面量，「表序」就没有承载物，
 * 措辞也会开始漂（`#010-06`：同一判据别开第二个出处）。
 *
 * ## 为什么不在这里定义整个七字段信封
 *
 * 七字段信封的落地在 `09` 的 P1（工具层）。`01` §7.11 的 P1 只用明细那五个字段；
 * 先定一个没人校验的大类型，等于给下一个人一个「照着填就行」的假模板。
 */

/** 单次返回上限：默认 50、上限 200（`09` §3.4）。超上限是**截断**，不是报错。 */
export const 默认限制 = 50
export const 最大限制 = 200

/**
 * 单次返回 `数据` 的序列化字节上限（`09` §3.4）。
 *
 * 工具自限（`query_rows` 按这个预算取页）与服务端兜底（`截断数据`）共用这一个出处：
 * 两处各写一个 `30 * 1024`，改一处就会让「工具认为交付得下、服务端还要再截」重新出现（`#002-06`）。
 */
export const 数据预算字节 = 30 * 1024

/** `数据` 的测量口径：`Buffer.byteLength(JSON.stringify(值))`，与 §3.4 逐字一致。 */
export function 序列化字节(值: unknown): number {
  // `JSON.stringify(undefined)` 返回 `undefined`，`Buffer.byteLength` 会抛——必须兜成空串。
  return Buffer.byteLength(JSON.stringify(值) ?? "")
}

/** `09` §3.5 总表。**顺序即优先级**：只报第一个成立的原因，其余进 `缺口`。 */
export const 空原因枚举 = [
  "无此实体",
  "实体存在但无任何事实",
  "材料未解析",
  "确实没有交易",
  "实体没有关联账户",
  "账户未在材料中出现",
  "项目内资金材料未翻译",
  "外币行全部未计入",
  "无事件",
  "对象未登记",
  "时间全部缺失",
  "能力未就绪",
  "材料未入库",
  "该材料未解析",
  "无匹配行",
  "用途未结构化",
] as const

export type 空原因值 = (typeof 空原因枚举)[number]

/** 一条出处：`代表` 是行级定位（`材料#工作表#行号`）或事实 id。 */
export interface 出处项 {
  /** 支撑的是摘要里的哪个数字或结论。 */
  readonly 事实: string
  readonly 代表: string
  /** 能下钻到哪；`null` = 没有更细的出口。 */
  readonly 可下钻: string | null
}

/** 一条「下一步」建议：给工具、给参数、给一句人话理由。**不自动执行**（`09` §3.2）。 */
export interface 下一步项 {
  readonly 工具: string
  readonly 参数: Record<string, unknown>
  readonly 为什么: string
}

/**
 * 「空」的唯一定义（`09` §3.4 双向镜像的依据）。
 *
 * `null` 与「长度为 0 的数组」算空；**对象不算空**——所以对象型结果（`aggregate_money`
 * / `find_crossings`）在无命中时**必须返回 `null`**，不许返回一个全是空数组的对象。
 * 这条写在一处，server 校验与工具实现都引用它（`#002-06`：同一判据别开第二个出处）。
 */
export function 数据为空(数据: unknown): boolean {
  if (数据 === null || 数据 === undefined) return true
  return Array.isArray(数据) && 数据.length === 0
}
