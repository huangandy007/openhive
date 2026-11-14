export * as OpenhiveCaseMapping from "./case-mapping"

import { Hash } from "@opencode-ai/core/util/hash"
import { 是属性列 } from "./case-attribute-registry"
import {
  候选字段集,
  规范化,
  单位闸放行,
  字段目录,
  是识别字段,
  是标准列,
  标准列字段们,
  形状命中率,
  type 识别字段,
  type 标准列字段,
} from "./case-field-registry"

/**
 * 表格列识别（设计 §3.2 的四层）。
 *
 * 字段目录是**唯一**的字段来源：同义词、形状证据、落点都从 `case-field-registry` 取，
 * 本文件不再维护第二份清单（`#002-06`）。
 *
 * 四层召回顺序固定为 别名 → 词典精确 → 词典后缀 → 形状；后三层里「已定」的列
 * （已认领**或**已进待确认）不再改判——待确认是交给人的，不许被自动层覆盖。
 * 第五层（模型兜底）不在本计划。
 */
export const FACT_FIELDS = 标准列字段们
export type FactField = 标准列字段

export type 待确认原因 = "多列争抢" | "形状不符" | "别名跨字段集" | "候选不唯一" | "单位冲突" | "表头重名"

/**
 * 待确认原因的值域守卫。
 *
 * 读格式缓存（`parse_detail.mapping` / `case_table_format.result`）时要用它逐条校验：
 * 缓存是**库里的数据**，脏行 / 其它版本写进来的自由字符串不能直接进前端。
 * 一处维护（`#002-06`）——别在消费侧再抄一份六值清单。
 */
export const 待确认原因们: readonly 待确认原因[] = [
  "多列争抢",
  "形状不符",
  "别名跨字段集",
  "候选不唯一",
  "单位冲突",
  "表头重名",
]

export function 是待确认原因(值: unknown): 值 is 待确认原因 {
  return typeof 值 === "string" && (待确认原因们 as readonly string[]).includes(值)
}

export interface 待确认项 {
  列号: number
  表头: string | null
  /** 建议字段：证据指向的那个字段；`null` 表示没有可建议的（如纯形状不符）。 */
  建议字段: 识别字段 | null
  原因: 待确认原因
}

export interface DetectOptions {
  /** 全局别名库：键是**原始表头**（trim 后），值是字段目录里的名。 */
  readonly 别名?: ReadonlyMap<string, string>
  /** 候选字段集；不传则由 `候选字段集(header, rows)` 推断。 */
  readonly 候选字段?: ReadonlySet<识别字段>
}

/** 来源联合现在就把 "模型" 写进来：Task 7 只填值、不改类型。 */
export type 识别来源 = "别名库" | "词典" | "特征" | "模型" | "档案"

/**
 * 识别来源的值域守卫（一处维护，`#002-06`）。
 *
 * 缓存 `result.来源` 的值同样来自库，可能是脏值 / 其它版本的写法；消费侧（`读格式`）
 * 必须按这个守卫过滤，别在那边再列一遍四个字面量。
 */
export function 是识别来源(值: unknown): 值 is 识别来源 {
  return (
    值 === "别名库" || 值 === "词典" || 值 === "特征" || 值 === "模型" || 值 === "档案"
  )
}

export interface MappingResult {
  /** 列下标 → 字段。只含认得出的列（标准列或 extras 字段）。 */
  columns: Record<number, 识别字段>
  method: "词典" | "特征" | "别名"
  /** 每个已认领列的来源，与 `columns` 同键。 */
  来源: Record<number, 识别来源>
  /** 认不出 / 证据冲突的列，交给人工确认。 */
  待确认: 待确认项[]
  /**
   * 认不出的列下标，**以 `header` 长度为界**。前提：`rows` 不比 `header` 宽
   * （`readSheets` 产出的 `RawSheet` 满足这条——宽度恒等于 `!ref` 的列跨度）。
   * 直接拿别的数据源调本函数时，多出来的数据列既不会进 `columns` 也不会进这里。
   * 属性列**排除在外**（05 §4.3）：它们不是「未认出」，不进待确认弹窗也不计未知列。
   */
  unknownColumns: number[]
}

/**
 * 认时间用的文本形状：`case-time.ts` 的四种格式里**只认前三种**（到秒/到分/到日）。
 * 紧凑 14 位（`yyyyMMddHHmmss`）**故意不认**：它和长数字串（流水号、账号）在文本上
 * 长得一样，特征层拿它当时间就会把号码列写进 `startedAt`。漏认可接受（进 extras），误认不可接受。
 */
const 时间形状 = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/
/** 金额形状：**必须带两位小数**。整数列（号码、行号）因此不会被误认成金额。 */
const 金额形状 = /^-?\d+\.\d{2}$/

/** 字段目录里的同义词，比较前统一 `规范化`。 */
function 同义词(field: 识别字段): string[] {
  return 字段目录[field].同义词.map(规范化)
}

function 列(values: (string | null)[][], c: number): (string | null)[] {
  return values.map((row) => row[c] ?? null)
}

function 形状达标(field: 识别字段, 值们: (string | null)[]): boolean {
  if (字段目录[field].形状 === undefined) return true
  return 形状命中率(field, 值们) >= 0.9
}

const 对手修饰 = /对方|对手|交易对方|收方|付方/
const 本方修饰 = /本方|查询|客户|本人/
const 户名词尾 = /(名称|户名)$/
const 账号词尾 = /(账号|帐号|卡号|账户)$/

/**
 * 修饰语优先（两轮制解决不了「后缀抢后缀」）：
 * - 带对手修饰的表头只许归对手方字段：账号类词尾 → `counterparty`，户名类词尾 → `counterpartyName`；
 * - 带本方修饰的表头只许归 `ownerAccount`；
 * - 其余表头里，`counterparty` 必须由账号类词尾兜底（「交易对方」归户名，不归账号）。
 *
 * **R11**：这套裁决只对账号/户名三个字段生效。对其它字段硬套会把「对方通话时间」
 * 「客户交易金额」这类正常表头整列挡在后缀轮之外——静默进 unknown（连待确认都没有），
 * 材料照样标「已解析」而对应标准列全空。
 */
function 需修饰裁决(field: 识别字段): boolean {
  return field === "counterparty" || field === "counterpartyName" || field === "ownerAccount"
}

function 修饰语放行(field: 识别字段, h: string): boolean {
  if (对手修饰.test(h)) {
    const 允许: readonly 识别字段[] = 户名词尾.test(h)
      ? ["counterpartyName"]
      : 账号词尾.test(h)
        ? ["counterparty"]
        : []
    if (!允许.includes(field)) return false
  } else if (本方修饰.test(h)) {
    if (field !== "ownerAccount") return false
  }
  return field !== "counterparty" || 账号词尾.test(h)
}

/**
 * 「修饰语 ＋ 通用词尾」的**合成候选**（R11）。
 *
 * `交易对方银行卡号` / `本方银行账户` 这类真实资金表头里，`银行卡号` / `银行账户` 不是任何
 * 字段的同义词 ⇒ 后缀轮召不回。只在账号/户名三个字段上、且修饰语与正确词尾**同时**成立时
 * 合成；不做无修饰的通用词尾猜测，否则「账号」「卡号」这类通用词会到处乱认。
 */
function 合成词长(field: 识别字段, h: string): number | undefined {
  if (field === "counterparty" || field === "counterpartyName") {
    if (!对手修饰.test(h)) return undefined
    return (field === "counterparty" ? 账号词尾 : 户名词尾).exec(h)?.[0].length
  }
  if (field === "ownerAccount") {
    if (!本方修饰.test(h)) return undefined
    return 账号词尾.exec(h)?.[0].length
  }
  return undefined
}

interface 候选列 {
  readonly i: number
  /** 命中的同义词长度；后缀轮先比它（更长的中心词是更强的证据）。 */
  readonly 词长: number
  readonly 率: number
}

type 裁决 = { 选中: 候选列 } | { 争抢: 候选列[] }

/**
 * 同一字段的多个候选列里选一个：词长最长优先，同长按形状命中率降序（再按下标稳定排序）。
 * 前两名命中率差距 < 5% ⇒ 证据分不开，不猜，交给待确认（设计 §3.2 证据规则 3）。
 */
function 挑唯一(项们: 候选列[]): 裁决 {
  const 最长 = Math.max(...项们.map((x) => x.词长))
  const 顶 = 项们.filter((x) => x.词长 === 最长)
  const 排 = [...顶].sort((a, b) => b.率 - a.率 || a.i - b.i)
  const 第一 = 排[0]
  if (第一 === undefined) return { 争抢: 项们 }
  const 第二 = 排[1]
  if (第二 !== undefined && 第一.率 - 第二.率 < 0.05) return { 争抢: 顶 }
  return { 选中: 第一 }
}

/**
 * 四层召回：别名 → 词典精确（全字段先落定）→ 词典后缀（修饰语优先）→ 形状。
 *
 * 两轮制的理由：若边遍历字段边做后缀，「对方账号」可能被 ownerAccount 的通用词「账号」
 * 先抢走。先让所有精确命中落定，再做后缀轮，且后缀轮里带修饰语的表头只许归对应字段。
 *
 * 复杂度上界恒为「列数 × 字段数 × 同义词数」，没有任何回溯或重试。
 */
export function detectMapping(
  header: (string | null)[],
  rows: (string | null)[][],
  选项: DetectOptions = {},
): MappingResult {
  const 候选 = 选项.候选字段 ?? 候选字段集(header, rows)
  const 候选们 = [...候选]
  const 规范 = header.map(规范化)
  const columns: Record<number, 识别字段> = {}
  const 来源: Record<number, 识别来源> = {}
  /**
   * 已落定的列：认领或待确认。待确认的列**不许**被后面的层再猜一次——
   * 那等于把「交给人的判断」静默改掉（别名冲突 / 单位冲突尤其如此）。
   */
  const 已定 = new Set<number>()
  // 属性列不是字段词表的一员，不进四层召回、也不进待确认（05 §4.3）。判据复用
  // `是属性列` 一处（`#002-06`）；`case-ingest` 的「未认出」清单用同一处。
  for (let i = 0; i < header.length; i++) if (是属性列(header[i])) 已定.add(i)
  /** 已被认领的字段。每个字段最多一列（R2）。 */
  const 已认字段 = new Set<识别字段>()
  const 待确认: 待确认项[] = []
  const 列表头 = header.map((h) => (h ?? "").trim())
  const 表头计数 = new Map<string, number>()
  for (const h of 列表头) if (h !== "") 表头计数.set(h, (表头计数.get(h) ?? 0) + 1)

  const 认领 = (i: number, field: 识别字段, 从: 识别来源) => {
    columns[i] = field
    来源[i] = 从
    已定.add(i)
    已认字段.add(field)
  }
  const 记待确认 = (i: number, 原因: 待确认原因, 建议字段: 识别字段 | null = null) => {
    待确认.push({ 列号: i, 表头: header[i] ?? null, 建议字段, 原因 })
    已定.add(i)
  }

  // ① 别名：原始表头精确命中；别名不提供证据，单位闸与形状仍要过
  for (let i = 0; i < header.length; i++) {
    // 与 ② 精确层同形：已落定（含属性列）的列不许被别名再认一次（05 §4.3）。
    if (已定.has(i)) continue
    const 原 = 列表头[i] ?? ""
    if (原 === "") continue
    const 目标 = 选项.别名?.get(原)
    if (目标 === undefined || !是识别字段(目标)) continue
    // §4.3：同表重名时键区分不出是哪一列，别名不生效，按位置交给人工。
    if ((表头计数.get(原) ?? 0) > 1) {
      记待确认(i, "表头重名", 目标)
      continue
    }
    if (!候选.has(目标)) {
      记待确认(i, "别名跨字段集", 目标)
      continue
    }
    if (!单位闸放行(目标, header[i] ?? null)) {
      记待确认(i, "单位冲突", 目标)
      continue
    }
    if (!形状达标(目标, 列(rows, i))) {
      记待确认(i, "形状不符", 目标)
      continue
    }
    if (已认字段.has(目标)) {
      记待确认(i, "候选不唯一", 目标)
      continue
    }
    认领(i, 目标, "别名库")
  }

  // ② 精确：先把**所有字段**的精确命中收集齐，再按字段做候选唯一性裁决。
  // 边遍历边认领会让「先到先得」变成隐式规则，同字段第二列被静默丢弃。
  const 精确认领 = new Map<识别字段, 候选列[]>()
  for (let i = 0; i < header.length; i++) {
    if (已定.has(i)) continue
    const h = 规范[i] ?? ""
    if (h === "") continue
    const 命中 = 候选们.filter((f) => 同义词(f).includes(h))
    if (命中.length === 0) continue
    const 过闸 = 命中.filter((f) => 单位闸放行(f, header[i] ?? null))
    if (过闸.length === 0) {
      记待确认(i, "单位冲突", 命中[0] ?? null)
      continue
    }
    if (过闸.length > 1) {
      记待确认(i, "多列争抢", 过闸[0] ?? null)
      continue
    }
    const field = 过闸[0]
    if (field === undefined) continue
    const 组 = 精确认领.get(field) ?? []
    // 精确轮不比词长：整串相等就是同一个证据强度，只让形状命中率区分候选。
    组.push({ i, 词长: 0, 率: 形状命中率(field, 列(rows, i)) })
    精确认领.set(field, 组)
  }
  for (const [field, 组] of 精确认领) {
    const 剩 = 组.filter((x) => !已定.has(x.i))
    if (剩.length === 0) continue
    if (已认字段.has(field)) {
      for (const x of 剩) 记待确认(x.i, "候选不唯一", field)
      continue
    }
    const 裁决 = 挑唯一(剩)
    if ("选中" in 裁决) {
      认领(裁决.选中.i, field, "词典")
      continue
    }
    for (const x of 裁决.争抢) 记待确认(x.i, "候选不唯一", field)
  }

  // ③ 后缀：按「同义词是表头后缀」召回，字段内再按 (词长 desc, 形状命中率 desc) 裁决。
  //    账号/户名三字段另接受「修饰语 ＋ 通用词尾」的合成候选（R11），与词典后缀并进同一份
  //    候选集，后面的「差距 <5% 不猜」照旧适用。
  const 后缀候选 = new Map<识别字段, 候选列[]>()
  const 加后缀候选 = (field: 识别字段, i: number, 词长: number) => {
    const 组 = 后缀候选.get(field) ?? []
    组.push({ i, 词长, 率: 形状命中率(field, 列(rows, i)) })
    后缀候选.set(field, 组)
  }
  for (let i = 0; i < header.length; i++) {
    if (已定.has(i)) continue
    const h = 规范[i] ?? ""
    if (h === "") continue
    for (const field of 候选们) {
      if (!单位闸放行(field, header[i] ?? null)) continue
      const 需裁决 = 需修饰裁决(field)
      if (需裁决 && !修饰语放行(field, h)) continue
      const 词们 = 同义词(field).filter((w) => w !== "" && h !== w && h.endsWith(w))
      if (词们.length > 0) {
        加后缀候选(field, i, Math.max(...词们.map((w) => w.length)))
        continue
      }
      if (!需裁决) continue
      const 合成长 = 合成词长(field, h)
      if (合成长 !== undefined) 加后缀候选(field, i, 合成长)
    }
  }
  const 已认字段的后缀 = new Map<识别字段, 候选列[]>()
  for (const [field, 组] of 后缀候选) {
    const 剩 = 组.filter((x) => !已定.has(x.i))
    if (剩.length === 0) continue
    // 已认过的字段再有后缀命中 ⇒ 候选不唯一。先挂起，等未认领字段裁决完再记，
    // 否则同一列可能既是这里冲突项、又是别的字段唯一候选（会误挡）。
    if (已认字段.has(field)) {
      已认字段的后缀.set(field, 剩)
      continue
    }
    const 裁决 = 挑唯一(剩)
    if ("选中" in 裁决) {
      认领(裁决.选中.i, field, "词典")
      continue
    }
    for (const x of 裁决.争抢) 记待确认(x.i, "候选不唯一", field)
  }
  for (const [field, 组] of 已认字段的后缀) {
    for (const x of 组) if (!已定.has(x.i)) 记待确认(x.i, "候选不唯一", field)
  }

  // ④ 形状：只认 startedAt / amount / callee（其余字段的形状区分度不足，留给模型/人工）。
  if (!已认字段.has("startedAt") && 候选.has("startedAt")) {
    const 列们 = header.flatMap((_, i) =>
      已定.has(i) || 形状命中率("startedAt", 列(rows, i)) < 0.9 ? [] : [i],
    )
    const 唯一 = 列们[0]
    if (列们.length === 1 && 唯一 !== undefined) 认领(唯一, "startedAt", "特征")
    else if (列们.length > 1) for (const i of 列们) 记待确认(i, "候选不唯一", "startedAt")
  }
  if (!已认字段.has("amount") && 候选.has("amount")) {
    const 列们 = header.flatMap((_, i) =>
      已定.has(i) || !单位闸放行("amount", header[i] ?? null) || 形状命中率("amount", 列(rows, i)) < 0.9
        ? []
        : [i],
    )
    const 唯一 = 列们[0]
    if (列们.length === 1 && 唯一 !== undefined) 认领(唯一, "amount", "特征")
    else if (列们.length > 1) for (const i of 列们) 记待确认(i, "候选不唯一", "amount")
  }
  if (!已认字段.has("callee") && 候选.has("callee")) {
    const 列们 = header.flatMap((_, i) =>
      已定.has(i) || 形状命中率("callee", 列(rows, i)) < 0.9 ? [] : [i],
    )
    const 唯一 = 列们[0]
    if (列们.length === 1 && 唯一 !== undefined) 认领(唯一, "callee", "特征")
    else if (列们.length > 1) for (const i of 列们) 记待确认(i, "候选不唯一", "callee")
  }

  // 属性列不是「未认出」列（05 §4.3）：它们只进 `已定`，不能按 columns 缺失计成未知。
  const unknownColumns = header.flatMap((_, i) =>
    columns[i] === undefined && !是属性列(header[i] ?? null) ? [i] : [],
  )
  const 用了别名 = Object.values(来源).includes("别名库")
  const method: MappingResult["method"] = 用了别名
    ? "别名"
    : Object.keys(columns).every((k) => 来源[Number(k)] === "词典")
      ? "词典"
      : "特征"
  return { columns, method, 来源, 待确认, unknownColumns }
}

/** 列的数据形状，用于指纹。只取前 20 行做样本（够区分，也不怕大表）。 */
function 列形状(values: (string | null)[][]): string[] {
  const sample = values.slice(0, 20)
  const width = Math.max(0, ...sample.map((r) => r.length))
  const out: string[] = []
  for (let c = 0; c < width; c++) {
    const v = 列(sample, c).filter((x): x is string => x !== null && x.trim() !== "")
    if (v.length === 0) out.push("空")
    else if (v.every((x) => 时间形状.test(x.trim()))) out.push("时间")
    else if (v.every((x) => 金额形状.test(x.trim()))) out.push("金额")
    else if (v.every((x) => /^-?\d+$/.test(x.trim()))) out.push("整数")
    else out.push("文本")
  }
  return out
}

/**
 * 识别版本：参与格式指纹。
 *
 * 改词典 / 单位闸 / 特征层规则就 **+1**。指纹一变，旧行自然成了不可达缓存（没有迁移负担，
 * 也不需要回填）：否则已导入过的格式仍命中旧缓存、`detectMapping` 被短路，修复对存量材料
 * 不生效（I6）。
 *
 * "6"：Task 5 把召回整轮重写（四层 ＋ 两轮制），旧指纹必须不可达。
 * "7"：户名形状去掉 60 字上限 + 词典补「收款方…名称」系列。
 * "8"：资金表补 `currency` 字段（09 §4.5 第 2 条）；旧缓存里没有币种列映射，必须重识别。
 * "9"：属性列退出表类型投票、候选字段集与模型合并（05 §4.3）；旧缓存可能把属性列认成标准字段。
 * "10"：direction 词典补「收/付」斜杠写法；旧缓存里该列仍是未认出（整表「方向不明」被跳过）。
 */
const 识别版本 = "10"

/**
 * 格式指纹：**识别版本 ＋ 别名库版本 ＋ 表头 ＋ 每列的数据形状**，与具体取值无关（设计 §6.2）。
 * 同一家运营商每个月的文件内容全变，列的形状不变 ⇒ 指纹相同。
 *
 * `aliasVersion` 是 DB 里的 `case_field_alias_version.version`（源码常量 `识别版本` 改不了它）：
 * 别名一变，旧指纹全部不可达，缓存必须重识别一次（§4.2-4）。
 */
export function formatFingerprint(
  header: (string | null)[],
  rows: (string | null)[][],
  aliasVersion: number,
): string {
  // ⚠️ 表头用**原始文本**（只 trim），**不许**再走 `规范化`（N1）：规范化会把括号与
  // 裸单位词剥掉，`金额` / `金额万元` / `金额USD` 因此指纹相同；缓存命中时 `columns`
  // 直接取缓存、`detectMapping` 不跑 ⇒ 单位闸被整个绕过（静默 60 / 10000 倍错）。
  // 指纹必须区分单位声明。改识别规则时靠 `识别版本` 让旧指纹成为不可达缓存。
  return Hash.sha256(
    JSON.stringify([识别版本, aliasVersion, header.map((h) => (h ?? "").trim()), 列形状(rows)]),
  )
}

/** 材料类型（`case_material.kind` 偏表格的那三个）。产物与其它类型由调用方给。 */
export function classifyMaterialType(columns: Record<number, 识别字段>): "话单" | "资金" | "其他" {
  // extras 字段不是「明细事实」，不参与材料类型判定。
  // 先过 `是识别字段`：columns 可能来自格式缓存（旧版本 / 脏行），`是标准列` 会直接取
  // `字段目录[字段].落点`，非法字段名在那里是 TypeError（`#002-06`）。
  const fields = Object.values(columns).filter((f) => 是识别字段(f) && 是标准列(f))
  if (fields.includes("caller") || fields.includes("callee") || fields.includes("durationSec")) return "话单"
  if (fields.includes("amount") || fields.includes("balance")) return "资金"
  return "其他"
}
