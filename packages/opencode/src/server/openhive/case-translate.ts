export * as OpenhiveCaseTranslate from "./case-translate"

import { Hash } from "@opencode-ai/core/util/hash"
import { 归一化值, 是账户形状 } from "./case-field-registry"
import { 解析属性列, type 属性归属 } from "./case-attribute-registry"
import { 资金交易, type 事件类型 } from "./case-event-types"
import { 判定用途, type 用途 } from "./case-purpose"
import { 抽取备注事实, type 备注事实 } from "./case-remark-facts"
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

export type 实体类型 = "账户" | "组织" | "车辆" | "号码"

export interface 卡片参与者 {
  /** 归一化后的账号 / 商户名 / 车牌 / 手机号。 */
  规范值: string
  角色: "付款方" | "收款方" | "商户" | "车辆" | "号码"
  /** 明细行里的原文；商户用解码后的值（`UTF8#` 编码串不给人看）。 */
  提及: string
  /** 0/1 恒为付款方/收款方；②层事实从 2 起递增。 */
  ordinal: number
  /** false = 源文件自带掩码或位数不足，不建实体（§4.0.5 坑 1）。 */
  实体: boolean
  实体类型: 实体类型
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
  participants: [卡片参与者, 卡片参与者, ...卡片参与者[]]
  /** 备注事实摘要（17：给人看的一行字；回退链保证非空）。 */
  摘要: string | null
  sheet: string
  rowNo: number
  /**
   * 用途判定结果（01 §3.11）。必填而不是可选：可选会让「漏判用途」在类型层静默通过，
   * 落库时三列一起变 null 却没人发现（判定引擎自己兜底「未分类」）。
   */
  用途: 用途
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
  /** 多 sheet 材料里只用 `rowNo` 定位不了（设计 :1006「跳过的必须能点开看是哪几行」）。 */
  sheet: string
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
 * 留下两张卡。拍板改为：id 只由来源键（材料 + 表 + 行号 + 槽）决定。版本**只**记在
 * 模板行 `case_card_template.version` 上：`case_event.template_id` 是固定行 id
 * （`内置:资金/v1`），不随版本变 ⇒ 单张卡片**追溯不到**产它的映射版本（Q15 待定项，
 * 登记不改）。重放靠 `case_citation(material_id, locator)` 定位人工结论。
 * 槽是给「一行多卡」的类型（住宿的入住/退房合成）留的判别位。
 */
export function 卡片id(projectId: string, materialId: string, sheet: string, rowNo: number, 槽: string): string {
  return Hash.sha256([projectId, materialId, sheet, String(rowNo), 槽].join("\u0000")).slice(0, 32)
}

/**
 * 实体缓存键：`<类型>\u0000<规范值>`。
 *
 * 写入器建 Map、关系重建取 id、属性按实体分组三处共用——**只此一份**（`#002-06`）。
 * 各写一遍字面量，改了键格式却漏改一处，表现是「实体建了但关系/属性静默丢失」。
 */
export function 实体键(类型: 实体类型, 规范值: string): string {
  return `${类型}\u0000${规范值}`
}

/** 账户专用薄别名：属性分组只挂账户，调用点不必重复写类型字面量。 */
export function 账户键(规范值: string): string {
  return 实体键("账户", 规范值)
}

/**
 * 合计/小计行：把标记写在对户名或备注里，**整格匹配**、不做前缀匹配。
 *
 * 设计 :1000-1006 只规定「哪些行不产卡片」，未规定判法；这里按评审核定的「宁漏不误」定：
 * 前缀匹配会把备注为 `合计转入的货款` 的真实流水当成合计行静默丢掉（丢一笔资金，人工不会
 * 发现）；漏判一张合计行只是多一张可见、可点开纠正的假卡片。
 *
 * `合计金额` 在旧的前缀正则里是冗余分支（`^合计` 已覆盖），改成整格匹配后它是**必需**的
 * 一条：`合计金额` 整格不带金额也要认。
 */
const 合计形状 = /^(本页)?合\s*计(金额)?\s*[:：]?\s*[\d,，]*(\.\d{1,2})?\s*$/
const 小计形状 = /^(本页)?小\s*计(金额)?\s*[:：]?\s*[\d,，]*(\.\d{1,2})?\s*$/

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

/**
 * 判定输入只取两样：备注原文（extras["备注"]）与①层字段事实（extras["交易类型"]）。
 * 两个键都不在字段目录里（字段目录没有备注/交易类型），所以必然在 extras（01 §4.0.5 坑 3）。
 */
function 备注文本(row: FactRowInput): string | null {
  const v = row.extras?.["备注"]
  return typeof v === "string" ? v : null
}

function 交易类型文本(row: FactRowInput): string | null {
  const v = row.extras?.["交易类型"]
  return typeof v === "string" ? v : null
}

/** ②层事实 → 追加参与者。前两位恒为付款方/收款方（属性分组按位置取值）；顺序：商户→车辆→号码。 */
function 备注事实参与者(事实: 备注事实): 卡片参与者[] {
  const 出: 卡片参与者[] = []
  const 加 = (规范值: string, 角色: "商户" | "车辆" | "号码", 实体类型: "组织" | "车辆" | "号码") => {
    出.push({ 规范值, 角色, 提及: 规范值, ordinal: 2 + 出.length, 实体: true, 实体类型 })
  }
  if (事实.商户 !== null) 加(事实.商户, "商户", "组织")
  for (const 牌 of 事实.车辆) 加(牌, "车辆", "车辆")
  for (const 号 of 事实.号码) 加(号, "号码", "号码")
  return 出
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
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "空行" })
      continue
    }
    const 文本 = 文本值(row)
    if (文本.some((v) => 小计形状.test(v.trim()))) {
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "小计行" })
      continue
    }
    if (文本.some((v) => 合计形状.test(v.trim()))) {
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "合计行" })
      continue
    }
    // 方向必须在映射表内：映射之外的取值 = 不知道该谁付谁，宁可不出卡片（§4.4）。
    if (row.direction !== "收" && row.direction !== "付") {
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "方向不明" })
      continue
    }
    if (row.amount == null) {
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "金额无法解析" })
      continue
    }
    if (row.startedAt == null) {
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "时间无法解析" })
      continue
    }
    // 跳过判定仍用归一化列：它们才是「这一格有没有账号」的准绳。
    const 本方原 = (row.ownerAccount ?? "").trim()
    if (本方原 === "") {
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "缺本方账号" })
      continue
    }
    const 对方原 = (row.counterparty ?? "").trim()
    if (对方原 === "") {
      跳过们.push({ sheet: row.sheet, rowNo: row.rowNo, 原因: "缺对方账号" })
      continue
    }
    // 提及要的是**该格的原文**（设计 `01:800`）：优先旁路字段，旧调用方没给时退回归一化值。
    const 本方提及 = (row.ownerAccountRaw ?? row.ownerAccount ?? "").trim()
    const 对方提及 = (row.counterpartyRaw ?? row.counterparty ?? "").trim()

    const 本方 = 归一化值("ownerAccount", 本方原)
    const 对方 = 归一化值("counterparty", 对方原)
    const 本方可建 = 是账户形状(本方)
    const 对方可建 = 是账户形状(对方)
    const 主体角色 = row.direction === "付" ? "付款方" : "收款方"
    const 对手角色 = row.direction === "付" ? "收款方" : "付款方"

    const attrs: Record<string, unknown> = {}
    if (row.balance != null) attrs["余额"] = row.balance

    // 设计 :856：金额**永远存正数**（负数会让 `sum(amount)` 把收支相抵，看起来像没交易）。
    // 方向只用角色表达，**不从负号反推方向**——那会与 `direction` 列冲突（`#002-06`）。
    // 用字符串去负号而不是 `Number()`：`numeric(18,2)` 的整数位可到 16 位，超过
    // Number 的安全整数范围；去负号还能原样保留两位小数。
    const 金额 = row.amount.replace(/^-/, "")

    const 用途 = 判定用途({ 备注: 备注文本(row), 交易类型: 交易类型文本(row), 方向: row.direction })
    const 备注事实 = 抽取备注事实({
      备注: 备注文本(row),
      用途,
      对手名: row.counterpartyName ?? row.counterparty ?? null,
    })

    卡片们.push({
      id: 卡片id(input.projectId, input.materialId, row.sheet, row.rowNo, "资金"),
      type: 资金交易,
      occurredAt: row.startedAt,
      occurredRaw: row.startedRaw ?? "",
      precision: row.precision ?? "到日",
      amount: 金额,
      currency: row.currency ?? "CNY",
      attrs,
      participants: [
        { 规范值: 本方, 角色: 主体角色, 提及: 本方提及, ordinal: 0, 实体: 本方可建, 实体类型: "账户" },
        { 规范值: 对方, 角色: 对手角色, 提及: 对方提及, ordinal: 1, 实体: 对方可建, 实体类型: "账户" },
        ...备注事实参与者(备注事实),
      ],
      sheet: row.sheet,
      rowNo: row.rowNo,
      用途,
      摘要: 备注事实.摘要,
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
      // 属性挂在实体上，去重粒度按**每个实体内部**（设计 :553-557「先有明细 → 对手/本方实体
      // 这一步，属性才有挂载点」）。缺账户维度会让第二个账户永远拿不到同键同值的属性——
      // T8 靠「出处 → 卡片 → 实体」回填，没有第二次机会。
      const 实体规范值 = 属性.归属 === "本方" ? 本方 : 对方
      const 去重键 = `${实体规范值}\u0000${属性.归属}\u0000${属性.键}\u0000${值}`
      if (属性已见.has(去重键)) continue
      属性已见.add(去重键)
      属性们.push({ 归属: 属性.归属, 键: 属性.键, 值, 出处 })
    }
  }

  return { 卡片们, 别名们, 属性们, 跳过们 }
}
