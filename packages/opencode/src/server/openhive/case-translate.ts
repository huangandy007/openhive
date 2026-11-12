export * as OpenhiveCaseTranslate from "./case-translate"

import { Hash } from "@opencode-ai/core/util/hash"
import { 归一化值, 是账户形状 } from "./case-field-registry"
import { 解析属性列, type 属性归属 } from "./case-attribute-registry"
import type { 事件类型 } from "./case-event-types"
import type { FactRowInput } from "./case-store"

/**
 * 翻译层：明细行 → 卡片 / 别名 / 属性 / 跳过（01 §4.0）。
 *
 * **纯函数**：不碰库、不读时钟、不调模型。所有「能不能建实体」「方向怎么映射」「时间认不认」
 * 的判断都在这里，写入器只负责落库（`case-translate-store.ts`）。
 *
 * 为什么先做纯函数：§4.3 的四级判据（C1–C4）要能离线跑金标准集；把 SQL 混进来，
 * 每条用例都得起库，覆盖变体就没人愿意加了。
 */

export const 跳过原因们 = [
  "空行",
  "合计行",
  "小计行",
  "方向不明",
  "金额无法解析",
  "时间无法解析",
  "缺本方账号",
  "缺对方账号",
] as const
export type 跳过原因 = (typeof 跳过原因们)[number]

export interface 卡片参与者 {
  /** 归一化后的账号（`去横线` + 全角转半角）。 */
  规范值: string
  角色: "付款方" | "收款方"
  /** 该格在原文里的写法，永不改写（§4.0.5 坑 1）。 */
  提及: string
  /** 0 固定为主体（本方账户），1 为对手（§3.3）。 */
  ordinal: 0 | 1
  /** false = 源文件自带掩码或位数不足，不建账户实体（§4.0.5 坑 1）。 */
  实体: boolean
}

export interface 卡片草稿 {
  id: string
  type: 事件类型
  occurredAt: number
  occurredRaw: string
  precision: "到日" | "到分" | "到秒"
  /** `numeric(18,2)` 一律字符串传（`#002-01`）。永远正数（§4.0.5 坑 2）。 */
  amount: string
  currency: string
  /** 只放不参与过滤的属性（余额）。 */
  attrs: Record<string, unknown>
  participants: [卡片参与者, 卡片参与者]
  sheet: string
  rowNo: number
}

export interface 别名观察 {
  规范值: string
  /** `kind='户名'`：挂在账户上的一条「登记在谁名下」，不是人名实体（§3.2）。 */
  值: string
  出处: string
}

export interface 属性观察 {
  归属: 属性归属
  键: string
  值: string
  出处: string
}

export interface 跳过 {
  rowNo: number
  原因: 跳过原因
}

export interface 翻译结果 {
  卡片们: 卡片草稿[]
  别名们: 别名观察[]
  属性们: 属性观察[]
  跳过们: 跳过[]
}

export interface 翻译资金输入 {
  projectId: string
  materialId: string
  rows: readonly FactRowInput[]
}

/**
 * 卡片 id（Q13：**去版本**）。
 *
 * 原来 §3.7 写「id 含规则版本与模板版本」，那会让每次改规则都换一批 id，而人工确认过的
 * 旧卡不在 `删除本材料的事实` 的删除范围（它按 `fact_id` 判、只删机器态）⇒ 同一行材料
 * 留下两张卡。拍板改为：id 只由来源键（材料 + 表 + 行号 + 槽）决定，版本进
 * `case_event.template_id` 与模板行 `version`；重放靠 `case_citation(material_id, locator)`
 * 定位人工结论。槽是给「一行多卡」的类型（住宿的入住/退房合成）留的判别位。
 */
export function 卡片id(projectId: string, materialId: string, sheet: string, rowNo: number, 槽: string): string {
  return Hash.sha256([projectId, materialId, sheet, String(rowNo), 槽].join("\u0000")).slice(0, 32)
}

/**
 * 实体缓存键：`账户\u0000<规范值>`。
 *
 * 三处要用（写入器建 Map、关系重建取 id、属性按实体分组）——**只此一份**（`#002-06`）。
 * 各写一遍字面量，改了键格式却漏改一处，表现是「实体建了但关系/属性静默丢失」，
 * 而且测试各自只覆盖自己那条路径，谁也发现不了。
 */
export function 账户键(规范值: string): string {
  return `账户\u0000${规范值}`
}

/** 合计/小计行：银行导出的这类行把标记写在对户名或备注里。整格匹配，不做子串匹配。 */
const 合计形状 = /^(合\s*计|本页合计|合\s*计金额)/
const 小计形状 = /^(小\s*计|本页小\s*计)/

function 文本值(row: FactRowInput): string[] {
  const 值: (string | null | undefined)[] = [
    row.caller,
    row.callee,
    row.counterparty,
    row.counterpartyName,
    row.ownerAccount,
    ...Object.values(row.extras ?? {}).filter((v): v is string => typeof v === "string"),
  ]
  return 值.filter((v): v is string => typeof v === "string" && v.trim() !== "")
}

function 是空行(row: FactRowInput): boolean {
  return (
    row.startedAt == null &&
    row.amount == null &&
    row.balance == null &&
    row.durationSec == null &&
    文本值(row).length === 0
  )
}

function 户名字段(row: FactRowInput): string {
  const v = row.extras?.["ownerName"]
  return typeof v === "string" ? v.trim() : ""
}

export function 翻译资金(input: 翻译资金输入): 翻译结果 {
  const 卡片们: 卡片草稿[] = []
  const 别名们: 别名观察[] = []
  const 属性们: 属性观察[] = []
  const 跳过们: 跳过[] = []
  /** 同键同值只留一条、出处取首次（05 §5.1-3）。 */
  const 别名已见 = new Set<string>()
  const 属性已见 = new Set<string>()

  for (const row of input.rows) {
    const 出处 = `${input.materialId}#${row.sheet}#${row.rowNo}`

    if (是空行(row)) {
      跳过们.push({ rowNo: row.rowNo, 原因: "空行" })
      continue
    }
    const 文本 = 文本值(row)
    if (文本.some((v) => 小计形状.test(v.trim()))) {
      跳过们.push({ rowNo: row.rowNo, 原因: "小计行" })
      continue
    }
    if (文本.some((v) => 合计形状.test(v.trim()))) {
      跳过们.push({ rowNo: row.rowNo, 原因: "合计行" })
      continue
    }
    // 方向必须在映射表内：映射之外的取值 = 不知道该谁付谁，宁可不出卡片（§4.4）。
    if (row.direction !== "收" && row.direction !== "付") {
      跳过们.push({ rowNo: row.rowNo, 原因: "方向不明" })
      continue
    }
    if (row.amount == null) {
      跳过们.push({ rowNo: row.rowNo, 原因: "金额无法解析" })
      continue
    }
    if (row.startedAt == null) {
      跳过们.push({ rowNo: row.rowNo, 原因: "时间无法解析" })
      continue
    }
    const 本方原 = (row.ownerAccount ?? "").trim()
    if (本方原 === "") {
      跳过们.push({ rowNo: row.rowNo, 原因: "缺本方账号" })
      continue
    }
    const 对方原 = (row.counterparty ?? "").trim()
    if (对方原 === "") {
      跳过们.push({ rowNo: row.rowNo, 原因: "缺对方账号" })
      continue
    }

    const 本方 = 归一化值("ownerAccount", 本方原)
    const 对方 = 归一化值("counterparty", 对方原)
    const 本方可建 = 是账户形状(本方)
    const 对方可建 = 是账户形状(对方)
    const 主体角色 = row.direction === "付" ? "付款方" : "收款方"
    const 对手角色 = row.direction === "付" ? "收款方" : "付款方"

    const attrs: Record<string, unknown> = {}
    if (row.balance != null) attrs["余额"] = row.balance

    卡片们.push({
      id: 卡片id(input.projectId, input.materialId, row.sheet, row.rowNo, "资金"),
      type: "资金交易",
      occurredAt: row.startedAt,
      occurredRaw: row.startedRaw ?? "",
      precision: row.precision ?? "到日",
      amount: row.amount,
      currency: row.currency ?? "CNY",
      attrs,
      participants: [
        { 规范值: 本方, 角色: 主体角色, 提及: 本方原, ordinal: 0, 实体: 本方可建 },
        { 规范值: 对方, 角色: 对手角色, 提及: 对方原, ordinal: 1, 实体: 对方可建 },
      ],
      sheet: row.sheet,
      rowNo: row.rowNo,
    })

    const 本户 = 户名字段(row)
    if (本方可建 && 本户 !== "" && !别名已见.has(`${本方}\u0000${本户}`)) {
      别名已见.add(`${本方}\u0000${本户}`)
      别名们.push({ 规范值: 本方, 值: 本户, 出处 })
    }
    const 对户 = (row.counterpartyName ?? "").trim()
    if (对方可建 && 对户 !== "" && !别名已见.has(`${对方}\u0000${对户}`)) {
      别名已见.add(`${对方}\u0000${对户}`)
      别名们.push({ 规范值: 对方, 值: 对户, 出处 })
    }

    for (const [键, 原始] of Object.entries(row.extras ?? {})) {
      const 属性 = 解析属性列(键)
      if (属性 === undefined) continue
      if (typeof 原始 !== "string") continue
      const 值 = 原始.trim()
      if (值 === "") continue
      if (属性.归属 === "本方" && !本方可建) continue
      if (属性.归属 === "对方" && !对方可建) continue
      const 去重键 = `${属性.归属}\u0000${属性.键}\u0000${值}`
      if (属性已见.has(去重键)) continue
      属性已见.add(去重键)
      属性们.push({ 归属: 属性.归属, 键: 属性.键, 值, 出处 })
    }
  }

  return { 卡片们, 别名们, 属性们, 跳过们 }
}
