export * as OpenhiveCaseMapping from "./case-mapping"

import { Hash } from "@opencode-ai/core/util/hash"

/**
 * 表格列识别（设计 §6.1 的前两层）。
 *
 * 第三层（模型兜底）**不在本计划**：它要一套 AI 调用与预算控制，属于计划 4。
 * 认不出的列在这里一律进 `unknownColumns`，落库时原样进 `extras`（§6.3）。
 */
export const FACT_FIELDS = [
  "caller",
  "callee",
  "startedAt",
  "durationSec",
  "amount",
  "balance",
  "counterparty",
] as const
export type FactField = (typeof FACT_FIELDS)[number]

export interface MappingResult {
  /** 列下标 → 标准字段。只含认得出的列。 */
  columns: Record<number, FactField>
  method: "词典" | "特征"
  /**
   * 认不出的列下标，**以 `header` 长度为界**。前提：`rows` 不比 `header` 宽
   * （`readSheets` 产出的 `RawSheet` 满足这条——宽度恒等于 `!ref` 的列跨度）。
   * 直接拿别的数据源调本函数时，多出来的数据列既不会进 `columns` 也不会进这里。
   */
  unknownColumns: number[]
}

/**
 * 单位冲突词（R25b）。
 *
 * `规范化` 会剥掉括号后缀，裸数字又按**默认单位**解释：括号里的单位不是默认那个时，
 * 「通话时长（分钟）」的 5 会落成 5 秒（60 倍错）、「交易金额（万元）」的 10000
 * 会落成 10000 元（10000 倍错）。因此原表头命中冲突词时，该列对**该字段**直接不认
 * （照常进 `unknownColumns` → extras），由前端手工映射。
 *
 * 只看**原始表头**：规范化串里已经没有括号单位了。`秒` / `元` 是默认单位，放行。
 */
const 单位冲突: Partial<Record<FactField, RegExp>> = {
  durationSec: /分钟|小时|毫秒/,
  amount: /万|亿|千元/,
  balance: /万|亿|千元/,
}

/**
 * 括号单位的**白名单**（I1）。黑名单是漏的：`分` / `角` / `美元` / `含手续费` 都不在
 * 词表里，规范化剥掉括号后按默认单位解释 ⇒ 静默错 60 / 10 / 汇率倍，而且因为解析「成功」，
 * 原文连 extras 都进不去。所以对**有默认单位**的三个字段：表头带括号时，只放行默认单位。
 *
 * 只看**原始表头**：规范化串里已经没有括号了。`秒` / `元` / `人民币` / `RMB` 是默认单位。
 */
const 单位白名单: Partial<Record<FactField, RegExp>> = {
  durationSec: /^(秒|s|sec)$/i,
  amount: /^(元|人民币|rmb)$/i,
  balance: /^(元|人民币|rmb)$/i,
}

/** 只有这三个字段有「默认单位」概念；caller / 时间等表头里的括号不是单位，不套白名单。 */
const 有默认单位: ReadonlySet<FactField> = new Set(["durationSec", "amount", "balance"])

/** 表头的括号内容（全角 `（）` 与半角 `()` 都算）；没有括号 ⇒ `null`。 */
function 括号内容(raw: string | null): string | null {
  const m = /[（(]([^）)]*)[）)]/.exec(raw ?? "")
  return m === null ? null : (m[1] ?? "").trim()
}

/**
 * 表头对该字段的单位声明是否放行。同一道闸被词典精确 / 词典后缀 / 特征层三处共用
 * （`#002-06`：同一前提的落点一次清完）。
 *
 * - 带括号 ⇒ 括号内容必须是该字段的默认单位；不是单位（如「金额（含手续费）」）也不认——
 *   宁可进 extras 保留原文，也不静默错倍。
 * - 没括号 ⇒ 沿用旧的黑名单（万元 / 分钟 / 小时 / 毫秒）。
 */
function 单位闸放行(field: FactField, raw: string | null): boolean {
  if (!有默认单位.has(field)) return true
  const 括号 = 括号内容(raw)
  if (括号 !== null) return 单位白名单[field]?.test(括号) ?? false
  return !(单位冲突[field]?.test(raw ?? "") ?? false)
}

/** 表头词典。比较前先 `规范化`（去空白、去括号后缀、转小写）。 */
const DICTIONARY: Record<FactField, string[]> = {
  caller: ["主叫号码", "主叫", "主叫号", "呼叫号码", "发起方号码", "本机号码", "通话号码"],
  callee: ["被叫号码", "被叫", "被叫号", "对方号码", "接收方号码", "对方电话"],
  startedAt: ["通话时间", "交易时间", "发生时间", "起始时间", "开始时间", "日期时间", "时间"],
  // 刻意不收「通话分钟」：parseDuration 对裸数字只能按秒解释，表头明说「分钟」时
  // 5 会落成 5 秒（差 60 倍）。误认比漏认糟——不认该列，原值进 extras（R24）。
  durationSec: ["通话时长", "时长", "通话秒数", "持续时长"],
  amount: ["交易金额", "金额", "发生额", "交易额", "收入金额", "支出金额"],
  balance: ["余额", "账户余额", "交易后余额", "当前余额"],
  counterparty: ["对方账号", "对方账户", "对方卡号", "交易对方", "对方户名", "对手账号", "对手户名"],
}

/**
 * 认时间用的文本形状：`case-time.ts` 的四种格式里**只认前三种**（到秒/到分/到日）。
 * 紧凑 14 位（`yyyyMMddHHmmss`）**故意不认**：它和长数字串（流水号、账号）在文本上
 * 长得一样，特征层拿它当时间就会把号码列写进 `startedAt`。漏认可接受（进 extras），误认不可接受。
 */
const 时间形状 = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/
/** 金额形状：**必须带两位小数**。整数列（号码、行号）因此不会被误认成金额。 */
const 金额形状 = /^-?\d+\.\d{2}$/

/** 去空白（含全角）、去括号后缀、转小写。`"金额（元）"` → `"金额"`。 */
function 规范化(raw: string | null): string {
  return (raw ?? "")
    .replace(/[（(【[].*?[）)】\]]/g, "")
    .replace(/[\s　]/g, "")
    .toLowerCase()
}

/** 非空值里命中 `形状` 的比例。全空 ⇒ 0（不认）。 */
function 命中率(values: (string | null)[], 形状: RegExp): number {
  const filled = values.filter((v): v is string => v !== null && v.trim() !== "")
  if (filled.length === 0) return 0
  const hit = filled.filter((v) => 形状.test(v.trim())).length
  return hit / filled.length
}

function 列(values: (string | null)[][], c: number): (string | null)[] {
  return values.map((row) => row[c] ?? null)
}

export function detectMapping(header: (string | null)[], rows: (string | null)[][]): MappingResult {
  const columns: Record<number, FactField> = {}
  const 已占 = new Set<number>()
  /** 靠**表头词典**认走的列。`method` 靠它判定：有列不在里面 ⇒ 至少用了特征层。 */
  const 词典命中 = new Set<number>()

  // 第一层：表头词典。精确相等优先，其次「以该词结尾且全表唯一」。
  //
  // 为什么是**后缀**而不是包含：中文表头是「修饰语 ＋ 中心词」，中心词在末尾。
  // 「主叫通话时长」按包含会被 caller 的「主叫」抢走（时长列静默变成主叫号码），
  // 按后缀则命中 durationSec 的「通话时长」——修饰语再长也不会改变它是什么列。
  const 规范表头 = header.map(规范化)
  // 单位闸按**原始表头**判（R25b / I1）：规范化会把括号里的单位剥掉。
  const 单位冲突了 = (field: FactField, i: number): boolean => !单位闸放行(field, header[i] ?? null)
  for (const field of FACT_FIELDS) {
    const 词 = DICTIONARY[field].map(规范化)
    let hit = 规范表头.findIndex((h, i) => !已占.has(i) && !单位冲突了(field, i) && h !== "" && 词.includes(h))
    if (hit < 0) {
      const 候选 = 规范表头.flatMap((h, i) =>
        !已占.has(i) && !单位冲突了(field, i) && h !== "" && 词.some((w) => h.endsWith(w)) ? [i] : [],
      )
      if (候选.length === 1) hit = 候选[0]
    }
    if (hit >= 0) {
      columns[hit] = field
      已占.add(hit)
      词典命中.add(hit)
    }
  }

  // 第二层：数据特征。只认两种**形状唯一**的列，其余留给计划 4 的模型兜底。
  if (!Object.values(columns).includes("startedAt")) {
    const 候选 = header.flatMap((_, i) => (!已占.has(i) && 命中率(列(rows, i), 时间形状) >= 0.9 ? [i] : []))
    if (候选.length === 1) {
      columns[候选[0]] = "startedAt"
      已占.add(候选[0])
    }
  }
  if (!Object.values(columns).includes("amount")) {
    // 单位冲突闸也要覆盖特征层（R25b）：词典层被拦下的万元列，若整列是两位小数，
    // 形状仍会把它认回 amount（10000 倍错）。前提是「单位写在表头里」，与哪一层认出无关。
    const 候选 = header.flatMap((_, i) =>
      !已占.has(i) && !单位冲突了("amount", i) && 命中率(列(rows, i), 金额形状) >= 0.9 ? [i] : [],
    )
    // 两列都像金额 ⇒ 认不出到底哪列是金额哪列是余额，不猜。
    if (候选.length === 1) {
      columns[候选[0]] = "amount"
      已占.add(候选[0])
    }
  }

  const unknownColumns = header.flatMap((_, i) => (columns[i] === undefined ? [i] : []))
  const method: MappingResult["method"] = Object.keys(columns).every((k) => 词典命中.has(Number(k)))
    ? "词典"
    : "特征"
  return { columns, method, unknownColumns }
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
 */
const 识别版本 = "2"

/**
 * 格式指纹：**识别版本 ＋ 表头 ＋ 每列的数据形状**，与具体取值无关（设计 §6.2）。
 * 同一家运营商每个月的文件内容全变，列的形状不变 ⇒ 指纹相同。
 */
export function formatFingerprint(header: (string | null)[], rows: (string | null)[][]): string {
  return Hash.sha256(JSON.stringify([识别版本, header.map(规范化), 列形状(rows)]))
}

/** 材料类型（`case_material.kind` 偏表格的那三个）。产物与其它类型由调用方给。 */
export function classifyMaterialType(columns: Record<number, FactField>): "话单" | "资金" | "其他" {
  const fields = Object.values(columns)
  if (fields.includes("caller") || fields.includes("callee") || fields.includes("durationSec")) return "话单"
  if (fields.includes("amount") || fields.includes("balance")) return "资金"
  return "其他"
}
