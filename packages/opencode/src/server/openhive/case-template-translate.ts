export * as OpenhiveCaseTemplateTranslate from "./case-template-translate"

import { 实体类型们, type 实体类型 } from "./case-extract"
import { 默认角色, 是角色, 槽条目们, type 槽条目, type 角色, type 模板行 } from "./case-card-template"
import { 归一化值, 可建实体, 字段目录, 字段显示名, 是标准列, type 识别字段 } from "./case-field-registry"
import { parseTime } from "./case-time"
import { 判定用途 } from "./case-purpose"
import {
  卡片id,
  汇总行原因,
  是空行,
  type 跳过原因,
  type 卡片草稿,
  type 卡片参与者,
  type 翻译结果,
} from "./case-translate"
import type { FactRowInput } from "./case-store"

/**
 * 通用翻译引擎（§8）：模板 + 明细行 → 卡片草稿。**纯函数**，不碰库、不读时钟、不调模型。
 *
 * 资金通路（`翻译资金`）继续走自己的算法：方向、户名兜底、备注事实都是代码规则，
 * 模板只负责「表格 + 用户配置」这一类（§4 偏差 3）。
 */

export interface 翻译模板输入 {
  projectId: string
  materialId: string
  template: 模板行
  rows: readonly FactRowInput[]
}

const 摘要上限 = 200
const 实体类型集: ReadonlySet<string> = new Set(实体类型们)

function 是实体类型(值: string | undefined): 值 is 实体类型 {
  return 值 !== undefined && 实体类型集.has(值)
}

/** 单元格原文。标准列取已解析/归一化值；`startedAt`/账号走原文旁路（`01:800`）。 */
function 原值(row: FactRowInput, 字段: 识别字段): string {
  // `startedAt` 优先原文（`mention_text` 要原文）；没有原文但有已解析值时就取解析值——
  // 否则「列已认出、时间已解析」的行会被必填检查判成「必填槽为空」。
  if (字段 === "startedAt") return row.startedRaw ?? (row.startedAt == null ? "" : String(row.startedAt))
  if (字段 === "ownerAccount") return row.ownerAccountRaw ?? row.ownerAccount ?? ""
  if (字段 === "counterparty") return row.counterpartyRaw ?? row.counterparty ?? ""
  if (是标准列(字段)) {
    const 值 = row[字段]
    return 值 === null || 值 === undefined ? "" : String(值)
  }
  const 值 = row.extras?.[字段]
  return typeof 值 === "string" ? 值 : ""
}

function 有值(row: FactRowInput, 字段: 识别字段): boolean {
  return 原值(row, 字段).trim() !== ""
}

interface 取时结果 {
  值: number | null
  原文: string
  精度: "到日" | "到分" | "到秒" | null
}

/** 时间槽取值：`startedAt` 直接用已解析结果（含精度），其他字段走 `parseTime`。 */
function 取时间(row: FactRowInput, 条目们: readonly 槽条目[]): 取时结果 {
  const 填 = 条目们.find((条目) => 有值(row, 条目.字段))
  if (填 === undefined) return { 值: null, 原文: "", 精度: null }
  if (填.字段 === "startedAt") {
    return { 值: row.startedAt ?? null, 原文: row.startedRaw ?? "", 精度: row.precision ?? null }
  }
  const 原文 = 原值(row, 填.字段)
  const 解析 = parseTime(原文)
  return { 值: 解析?.seconds ?? null, 原文, 精度: 解析?.precision ?? null }
}

/** 字段种类 → 实体类型（§8.2 的表）。`其他` 字段（地址/商户/姓名…）按此表推导。 */
function 按种类推导(字段: 识别字段): 实体类型 {
  switch (字段目录[字段].种类) {
    case "账号":
      return "账户"
    case "号码":
      return "号码"
    case "商户":
      return "组织"
    case "地点":
      return "地点"
    default:
      return "人"
  }
}

/** 槽位没写角色（或写了词表外的东西）⇒ 用默认角色。`是角色` 是唯一判定（`#002-06`）。 */
function 取角色(给: string | undefined, 缺省: 角色): 角色 {
  return 是角色(给) ? 给 : 缺省
}

function 造参与者(row: FactRowInput, 填: 槽条目, ordinal: number, 角色: 角色, 强制类型?: 实体类型): 卡片参与者 {
  const 原文 = 原值(row, 填.字段)
  const 规范值 = 归一化值(填.字段, 原文)
  return {
    规范值,
    角色,
    提及: 原文,
    ordinal,
    实体: 可建实体(填.字段, 规范值),
    实体类型: 强制类型 ?? (是实体类型(填.实体类型) ? 填.实体类型 : 按种类推导(填.字段)),
  }
}

function 玩家(参与者: 卡片参与者): string {
  return 参与者.提及.trim() === "" ? 参与者.规范值 : 参与者.提及
}

function 拼摘要(input: {
  type: string
  主体: 卡片参与者
  和谁们: readonly 卡片参与者[]
  何时: 取时结果
  何时止: 取时结果
  何地们: readonly 卡片参与者[]
  金额: string | null
  币种: string
  attrs: Record<string, unknown>
}): string {
  let 摘要 = `${input.type}：${玩家(input.主体)}`
  if (input.和谁们.length > 0) 摘要 += ` 与 ${input.和谁们.map(玩家).join("、")}`
  if (input.何时.原文 !== "") 摘要 += `，${input.何时.原文}`
  if (input.何时止.原文 !== "") 摘要 += ` 至 ${input.何时止.原文}`
  if (input.何地们.length > 0) 摘要 += `，${input.何地们.map(玩家).join("、")}`
  if (input.金额 !== null) 摘要 += `，${input.金额} ${input.币种}`
  for (const [键, 值] of Object.entries(input.attrs)) 摘要 += `，${键} ${String(值)}`
  if (摘要.length > 摘要上限) 摘要 = `${摘要.slice(0, 摘要上限)}…`
  return 摘要
}

export function 翻译模板(input: 翻译模板输入): 翻译结果 {
  const 卡片们: 卡片草稿[] = []
  const 跳过们: { sheet: string; rowNo: number; 原因: 跳过原因 }[] = []
  for (const row of input.rows) {
    const 原因 = 逐行(input, row, 卡片们)
    if (原因 !== undefined) 跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因 })
  }
  // 模板卡只产卡片：别名（户名挂账户）与实体属性属于资金通路，本引擎不产（§4 偏差 4）。
  return { 卡片们, 别名们: [], 属性们: [], 跳过们 }
}

function 逐行(input: 翻译模板输入, row: FactRowInput, 卡片们: 卡片草稿[]): 跳过原因 | undefined {
  if (是空行(row)) return "空行"
  const 汇总 = 汇总行原因(row)
  if (汇总 !== null) return 汇总

  const { slots, required, event_type: type } = input.template
  for (const 槽名 of required) {
    if (!槽条目们(slots, 槽名).some((条目) => 有值(row, 条目.字段))) return "必填槽为空"
  }

  const 何时 = 取时间(row, 槽条目们(slots, "何时"))
  if (何时.原文 !== "" && 何时.值 === null) return "时间无法解析"
  const 何时止 = 取时间(row, 槽条目们(slots, "何时止"))
  if (何时止.原文 !== "" && 何时止.值 === null) return "时间无法解析"
  if (何时.值 !== null && 何时止.值 !== null && 何时止.值 < 何时.值) return "时间区间倒置"

  const 主体填 = 槽条目们(slots, "谁").find((条目) => 有值(row, 条目.字段))
  if (主体填 === undefined) return "必填槽为空" // 谁 恒必填（校验层保证），这里只是兜底
  const 主体 = 造参与者(row, 主体填, 0, 取角色(主体填.角色, 默认角色.谁))

  const 和谁们: 卡片参与者[] = []
  for (const 填 of 槽条目们(slots, "和谁")) {
    if (!有值(row, 填.字段)) continue
    和谁们.push(造参与者(row, 填, 1 + 和谁们.length, 取角色(填.角色, 默认角色.和谁)))
  }
  const 何地们: 卡片参与者[] = []
  for (const 填 of 槽条目们(slots, "何地")) {
    if (!有值(row, 填.字段)) continue
    何地们.push(造参与者(row, 填, 1 + 和谁们.length + 何地们.length, 取角色(填.角色, 默认角色.何地), "地点"))
  }

  const 金额填 = 槽条目们(slots, "多少钱").find((条目) => 有值(row, 条目.字段))
  const 金额 = 金额填 === undefined ? null : 原值(row, 金额填.字段).trim().replace(/^-/, "")

  const attrs: Record<string, unknown> = {}
  for (const 填 of 槽条目们(slots, "其他")) {
    const 原文 = 原值(row, 填.字段)
    if (原文.trim() === "") continue
    attrs[字段显示名[填.字段]] = 填.字段 === "durationSec" ? (row.durationSec ?? 原文) : 原文
  }

  const 币种 = row.currency ?? "CNY"
  卡片们.push({
    id: 卡片id(input.projectId, input.materialId, row.sheet, row.rowNo, input.template.id),
    type,
    occurredAt: 何时.值,
    occurredRaw: 何时.原文 === "" ? null : 何时.原文,
    precision: 何时.精度,
    amount: 金额,
    currency: 币种,
    attrs,
    participants: [主体, ...和谁们, ...何地们],
    摘要: 拼摘要({ type, 主体, 和谁们, 何时, 何时止, 何地们, 金额, 币种, attrs }),
    sheet: row.sheet,
    rowNo: row.rowNo,
    用途: 判定用途({ 备注: null, 交易类型: null, 方向: null }),
    模板id: input.template.id,
    occurredEnd: 何时止.值,
  })
  return undefined
}
