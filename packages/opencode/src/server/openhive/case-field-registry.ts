export * as OpenhiveCaseFieldRegistry from "./case-field-registry"

import { 是属性列 } from "./case-attribute-registry"

/**
 * 字段目录：识别引擎的唯一字段来源。
 *
 * 同义词只是其中一层——「表头文本」不再等于「字段身份」。落点决定写标准列还是 extras 键；
 * 形状是证据层（整列命中率 ≥ 0.9 才算数）；归一化**只作用于写进标准列的值**，
 * 不参与别名键与格式指纹（`#011-01`：归一化丢语义会让缓存命中绕过校验）。
 */

export const 标准列字段们 = [
  "caller",
  "callee",
  "startedAt",
  "durationSec",
  "amount",
  "balance",
  "counterparty",
  "counterpartyName",
  "ownerAccount",
  "direction",
  "currency",
] as const
export type 标准列字段 = (typeof 标准列字段们)[number]

export const extras字段们 = ["address", "merchant", "contactPhone", "personName", "deliveredAt", "ownerName"] as const
export type ExtrasField = (typeof extras字段们)[number]

export type 识别字段 = 标准列字段 | ExtrasField

export type 字段种类 = "账号" | "户名" | "号码" | "金额" | "余额" | "时间" | "时长" | "地点" | "商户" | "方向" | "文本"

export interface 字段定义 {
  readonly 落点: "列" | "extras"
  readonly 种类: 字段种类
  readonly 同义词: readonly string[]
  /** 证据层：整列命中率 ≥ 0.9 才认。没有形状的字段只能靠词典/别名/人工。 */
  readonly 形状?: (值: string) => boolean
  /** 只作用于写进标准列的值；原文另进 extras。 */
  readonly 归一化?: (原值: string) => string
}

const 两位小数 = (v: string) => /^-?\d+\.\d{2}$/.test(v.trim())
const 时间形状 = (v: string) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(v.trim())
const 手机号 = (v: string) => /^1[3-9]\d{9}$/.test(v.replace(/[\s+]/g, "").replace(/^86/, ""))
const 账号形状 = (v: string) => /^\d{6,32}$/.test(v.replace(/[\s-]/g, ""))
/**
 * 账号形状（`^\d{6,32}$`）。
 *
 * 两处共用同一份（`#002-06`）：识别层判「是不是账号列」用 `账号形状`；翻译层判
 * 「能不能建账户实体」也用这一条（§4.0.5 坑 1：含 `*` 或位数不足 ⇒ 只留 mention_text）。
 * 两处各写一条正则，就会出现「识别认了、实体建不出来」或反之的静默错位。
 */
export function 是账户形状(值: string): boolean {
  return 账号形状(值)
}
/**
 * 户名（对方户名 / 商户名）的形状：**只要是非空文本、且不像纯号码**。
 *
 * 曾经限制 ≤60 字。微信支付导出里「间连交易，实际收款商户名称联系间连收单机构：【…】通过…查询」
 * 这类说明常常超过 60 字，20 行样例里只要占 10% 就把命中率压到 0.9 以下 ⇒ 形状闸把模型给出的
 * 正确答案（以及人工写的别名）判成「不像户名」扔掉。同表头的两份文件一份认得出、一份认不出，
 * 差别只在样例值的长度——长度不是户名与否的证据，去掉。
 *
 * 下限保留：纯数字 / 纯空白横线不是户名。放宽只影响「别名层」与「模型合并层」的这道闸
 * （形状层 `detectMapping` ④ 只认 startedAt / amount / callee），不会让备注列被自动认领。
 */
const 户名形状 = (v: string) => {
  const t = v.trim()
  return t !== "" && !/^[\d\s-]+$/.test(t)
}
const 方向形状 = (v: string) => /^(收|付|进|出|借|贷|转入|转出|收入|支出)$/.test(v.trim())
/** 全角数字 / 字母 / 加号 / 斜杠转半角。设计 §4.0.3a 要求账号「全角转半角」。 */
const 全角转半角 = (v: string) =>
  v.replace(/[０-９Ａ-Ｚａ-ｚ＋－／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
const 去横线 = (v: string) => 全角转半角(v).replace(/[\s　-]/g, "")
const 去国码 = (v: string) => v.replace(/[\s　]/g, "").replace(/^\+?86/, "")

export const 字段目录: Record<识别字段, 字段定义> = {
  caller: {
    落点: "列",
    种类: "号码",
    同义词: ["主叫号码", "主叫", "主叫号", "呼叫号码", "发起方号码", "本机号码", "通话号码", "主叫用户号码"],
    形状: 手机号,
    归一化: 去国码,
  },
  callee: {
    落点: "列",
    种类: "号码",
    同义词: ["被叫号码", "被叫", "被叫号", "对方号码", "接收方号码", "对方电话", "对方手机号", "被叫用户号码"],
    形状: 手机号,
    归一化: 去国码,
  },
  startedAt: {
    落点: "列",
    种类: "时间",
    同义词: ["通话时间", "交易时间", "发生时间", "起始时间", "开始时间", "日期时间", "时间", "通话开始时间", "下单时间", "交易日期"],
    形状: 时间形状,
  },
  durationSec: {
    落点: "列",
    种类: "时长",
    同义词: ["通话时长", "时长", "通话秒数", "持续时长"],
    形状: (v) => /^\d+$/.test(v.trim()),
  },
  amount: {
    落点: "列",
    种类: "金额",
    同义词: ["交易金额", "金额", "发生额", "交易额", "收入金额", "支出金额"],
    形状: 两位小数,
  },
  balance: {
    落点: "列",
    种类: "余额",
    同义词: ["余额", "账户余额", "交易后余额", "当前余额"],
    形状: 两位小数,
  },
  counterparty: {
    落点: "列",
    种类: "账号",
    同义词: ["对方账号", "对方账户", "对方卡号", "交易对方账卡号", "对手账号", "对方卡账号"],
    形状: 账号形状,
    归一化: 去横线,
  },
  counterpartyName: {
    落点: "列",
    种类: "户名",
    同义词: [
      "交易对方名称",
      "对方名称",
      "对方户名",
      "对手户名",
      "收方名称",
      "付方名称",
      "交易对方",
      // 微信支付导出（tenpay）的常见写法：收款方＝对手方，后缀是商户名/户名。写成整串同义词
      // 而不是扩大 `对手修饰`：「收款方支付帐号」/「收款方银行卡号」在 tenpay 里大多是「-」，
      // 认成 counterparty 会用空串把用户名的兜底挤掉（`case-rows.ts` 的对手账号优先）。
      "收款方名称",
      "收款方户名",
      "收款方商户名称",
      "收款方的商户名称",
      "收款人名称",
      "收款人户名",
    ],
    形状: 户名形状,
  },
  ownerAccount: {
    落点: "列",
    种类: "账号",
    同义词: ["查询账号", "本方账号", "本方账户", "账号", "卡号", "客户账号"],
    形状: 账号形状,
    归一化: 去横线,
  },
  direction: {
    落点: "列",
    种类: "方向",
    同义词: ["借贷标志", "收付标志", "资金方向", "交易方向", "收付类型"],
    形状: 方向形状,
  },
  /**
   * 币种（`09` §4.5 第 2 条）：只用于把外币行隔离开，不参与合计。
   *
   * **刻意不声明 `归一化`**：为匹配而做的归一化不许进格式指纹（`#011-01`）；币种归一化
   * （`CNY` / `RMB` / `人民币` / `元` ⇒ `CNY`，其余原样大写）放在写入口 `case-rows.ts` 的
   * `解析币种`。也不加 `形状`：任何文本都可能是币种，形状区分度不足。
   */
  currency: {
    落点: "列",
    种类: "文本",
    同义词: ["币种", "货币", "币别", "交易币种"],
  },

  address: { 落点: "extras", 种类: "地点", 同义词: ["收货地址", "收件地址", "送餐地址", "地址"], 形状: (v) => v.trim() !== "" },
  merchant: { 落点: "extras", 种类: "商户", 同义词: ["商户名称", "商家名称", "店铺名称", "商户"], 形状: (v) => v.trim() !== "" },
  contactPhone: { 落点: "extras", 种类: "号码", 同义词: ["联系电话", "联系人电话", "收件人电话", "手机号", "电话"], 形状: 手机号, 归一化: 去国码 },
  personName: { 落点: "extras", 种类: "文本", 同义词: ["收货人", "收件人", "联系人", "姓名"], 形状: 户名形状 },
  deliveredAt: { 落点: "extras", 种类: "时间", 同义词: ["送达时间", "完成时间", "签收时间"], 形状: 时间形状 },
  ownerName: { 落点: "extras", 种类: "户名", 同义词: ["本方户名", "客户名称", "查询户名", "账户名称"], 形状: 户名形状 },
}

const 识别字段集: ReadonlySet<string> = new Set([...标准列字段们, ...extras字段们])

export function 是识别字段(值: unknown): 值 is 识别字段 {
  return typeof 值 === "string" && 识别字段集.has(值)
}

export function 是标准列(字段: 识别字段): 字段 is 标准列字段 {
  return 字段目录[字段].落点 === "列"
}

export function 归一化值(字段: 识别字段, 原值: string): string {
  const 归一化 = 字段目录[字段].归一化
  return 归一化 === undefined ? 原值.trim() : 归一化(原值)
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
const 单位冲突: Partial<Record<识别字段, RegExp>> = {
  durationSec: /分钟|小时|毫秒/,
  amount: /万|亿|千元/,
  balance: /万|亿|千元/,
}

/**
 * 括号单位的**白名单**（I1）。黑名单是漏的：`分` / `角` / `美元` / `含手续费` 都不在
 * 词表里，规范化剥掉括号后按默认单位解释 ⇒ 静默错 60 / 10 / 汇率倍，而且因为解析「成功」，
 * 原文连 extras 都进不去。所以对**有默认单位**的三个字段：表头带括号时，只放行默认单位。
 *
 * 只看**原始表头**：规范化串里已经没有括号与单位后缀了。`秒` / `元` / `人民币` / `RMB` /
 * `CNY` 是默认单位。
 */
const 单位白名单: Partial<Record<识别字段, RegExp>> = {
  durationSec: /^(秒|s|sec)$/i,
  amount: /^(元|人民币|rmb|cny)$/i,
  balance: /^(元|人民币|rmb|cny)$/i,
}

/**
 * 「可能是单位」的词尾，用于从**无括号**的表头里剥出裸后缀（`金额美元` / `金额USD`）。
 *
 * 长词排前面：`万元` 必须先于 `元`、`分钟` 必须先于 `分` 命中，否则 `千元` 会被剥成
 * 「千」＋「元」，把一个非默认单位误判成默认单位。剥出来的每个 token 仍走白名单判定——
 * 这里只是「哪儿是单位」，不是「什么单位合法」。
 */
const 单位词尾 = ["人民币", "分钟", "毫秒", "小时", "美元", "万元", "千元", "usd", "cny", "rmb", "sec", "秒", "元", "角", "分", "万", "亿", "s"].sort(
  (a, b) => b.length - a.length,
)

/** 表头的全部括号内容：`（）` `()` `【】` `[]` `〔〕`；同一表头可有多组。 */
const 括号对 = /[（(【[〔]([^）)】\]〕]*)[）)】\]〕]/g

function 全部括号内容(raw: string | null): string[] {
  return [...(raw ?? "").matchAll(括号对)].map((m) => (m[1] ?? "").trim())
}

/** 从末尾反复剥单位词；返回去掉它们之后的剩余串与该字段声明的 token 列表。 */
function 剥末尾单位词(text: string): { 剩余: string; tokens: string[] } {
  const tokens: string[] = []
  let 剩余 = text
  for (;;) {
    const 词 = 单位词尾.find((w) => 剩余.endsWith(w))
    if (词 === undefined) return { 剩余, tokens }
    tokens.push(词)
    剩余 = 剩余.slice(0, -词.length)
  }
}

/**
 * 非默认币种（第四轮）：命中即不能按默认人民币解释。
 *
 * 币种可能写在词典词**前面**或中间（`美元金额` / `USD金额` / `$金额` / `金额美元金额`），
 * 只在末尾剥单位词看不出来 ⇒ 汇率级错误（USD≈7 倍、JPY≈20 倍）。
 * 用显式词表而**不用** `[a-z]{3}`：三字母通配会把 Europe / Basic 这类正常表头误伤。
 * 默认币种（人民币 / RMB / CNY / 元）刻意不在表里，`人民币金额` 照旧认；
 * `外币` / `原币` 没指明币种，同样不能按人民币落库，一并拦。
 * 不带 `g`，`test` 无状态（会被三个字段、三层认路反复调用）。
 */
const 非默认币种 =
  /美元|美金|欧元|港币|港元|日元|英镑|澳元|加元|新加坡元|台币|新台币|韩元|卢布|里拉|泰铢|外币|原币|折美元|usd|eur|gbp|hkd|mop|jpy|chf|aud|cad|sgd|krw|twd|rub|thb|[$€£¥円]/i

/** 只有这三个字段有「默认单位」概念；caller / 时间等表头里的括号不是单位，不套白名单。 */
const 有默认单位: ReadonlySet<识别字段> = new Set(["durationSec", "amount", "balance"])

/** 去空格与括号后的原始串（保留大小写信息无所谓，白名单本身不区分大小写）。 */
function 去括号与空白(raw: string | null): string {
  return (raw ?? "").replace(括号对, "").replace(/[\s　]/g, "").toLowerCase()
}

/**
 * 去空白（含全角）、去括号后缀、**剥裸单位后缀**、转小写。
 * `"金额（元）"` → `"金额"`；`"金额USD"` → `"金额"`；`"通话时长sec"` → `"通话时长"`。
 *
 * 剥单位是为了让词典在「单位写在括号外」时仍能命中（I1 残余）。单位合不合法由
 * `单位闸放行` 按原始表头判，规范化只负责把表头还原成词典里的词。
 */
export function 规范化(raw: string | null): string {
  return 剥末尾单位词(去括号与空白(raw)).剩余
}

/**
 * 表头对该字段的单位声明是否放行。同一道闸被别名 / 词典精确 / 词典后缀 / 特征层 / 模型层
 * 五处共用（`#002-06`：同一前提的落点一次清完）。
 *
 * 单位声明有三种写法，必须**全部**判定：
 * - 括号：`（）` `()` `【】` `[]` `〔〕`，同一表头多组时逐组判，任一组不是默认单位就
 *   不认（`金额（元）（分）` ⇒ 不认）；
 * - 裸后缀：`金额美元` / `金额USD`，从末尾反复剥 token 逐个判；
 * - 都没有：沿用旧的黑名单（万元 / 分钟 / 小时 / 毫秒），覆盖 `万元金额` 这类不在末尾的写法。
 * - 兜底 fail-closed：表头里出现了该字段的词典词时，剥完括号与单位 token 后必须仍以
 *   词典词结尾；否则说明单位后面黏着认不出的东西（`金额欧元` / `金额$` / 孤立右括号）。
 *
 * 不是单位（如「金额（含手续费）」）也不认——宁可进 extras 保留原文，也不静默错倍。
 */
export function 单位闸放行(field: 识别字段, raw: string | null): boolean {
  if (!有默认单位.has(field)) return true
  const 白名单 = 单位白名单[field]
  const 括号们 = 全部括号内容(raw)
  if (括号们.some((c) => !(白名单?.test(c) ?? false))) return false

  const { 剩余, tokens } = 剥末尾单位词(去括号与空白(raw))
  if (tokens.some((t) => !(白名单?.test(t) ?? false))) return false
  // 黑名单在**剩余串**上判（不因剥过单位就跳过）：`万元金额` 这类单位不在末尾的写法也要拦。
  // `单位冲突` 不带 g，test 无状态。
  if (单位冲突[field]?.test(剩余) ?? false) return false

  // 非默认币种与「表头里有没有词典词」无关：`EUR` / `Amt EUR` / `Amount CHF` 这类不含
  // 词典词的列也要拦，否则特征层会按两位小数的形状把它认成 amount。放在「含词典词才判」
  // 之前 ⇒ 对三个有默认单位的字段无条件生效。
  if (非默认币种.test(去括号与空白(raw))) return false

  // fail-closed（N2/N3）：表头里明明有该字段的词典词，剥完括号与单位 token 后却不再以
  // 词典词结尾 ⇒ 单位后面还黏着认不出的东西。典型：`金额欧元`（欧元只剩「欧」）、
  // `金额EUR` / `金额MOP` / `金额HKD` / `金额$`、孤立右括号 `金额美元)`。
  // **完全没有词典词的表头**（如「B」）不套这条：特征层就是为「表头不认识、形状像金额」
  // 的列准备的，套上会把整层废掉。
  const 词们 = 字段目录[field].同义词.map(规范化)
  if (词们.some((w) => 剩余.includes(w)) && !词们.some((w) => 剩余.endsWith(w))) return false
  return true
}

function 列(rows: (string | null)[][], i: number): (string | null)[] {
  return rows.map((r) => r[i] ?? null)
}

export function 形状命中率(字段: 识别字段, 值们: (string | null)[]): number {
  const 形状 = 字段目录[字段].形状
  if (形状 === undefined) return 0
  const 非空 = 值们.filter((v): v is string => v !== null && v.trim() !== "")
  if (非空.length === 0) return 0
  return 非空.filter(形状).length / 非空.length
}

export type 表类型 = "资金" | "话单" | "其他"

const 话单词 = /通话|主叫|被叫|呼叫|短信|时长|响铃/
const 交易词 = /交易|金额|余额|账|卡|借贷|收付|摘要|用途|币种|费/

/** 按「表头词投票优先、列形状兜底」推断表类型；只用于挑候选字段集，不改 `kind`。 */
export function 推断表类型(header: (string | null)[], rows: (string | null)[][]): 表类型 {
  let 宽 = header.length
  for (const 行 of rows) if (行.length > 宽) 宽 = 行.length
  let 话单分 = 0
  let 交易分 = 0
  let 号码列 = 0
  let 金额列 = 0
  for (let i = 0; i < 宽; i++) {
    // 属性列不参与表类型投票（05 §4.3）：表头词与形状都会把整表带偏，连累别的列识别。
    if (是属性列(header[i] ?? null)) continue
    const 值 = 列(rows, i)
    const 非空 = 值.filter((v) => v !== null && v.trim() !== "")
    const 名 = (header[i] ?? "").trim()
    if (话单词.test(名)) 话单分++
    if (交易词.test(名)) 交易分++
    // 少于 3 个非空值的列不投票：一两个格子撑不起一个类型判断。
    if (非空.length < 3) continue
    if (形状命中率("callee", 值) >= 0.9) 号码列++
    if (形状命中率("amount", 值) >= 0.9) 金额列++
  }
  if (话单分 > 交易分) return "话单"
  if (交易分 > 话单分) return "资金"
  if (金额列 > 0) return "资金"
  if (号码列 > 0) return "话单"
  return "其他"
}

/** 候选字段集：类型对应的一组；别的类型字段在本表里不参与认领。 */
export function 候选字段集(
  header: (string | null)[],
  rows: (string | null)[][],
): ReadonlySet<识别字段> {
  const 类型 = 推断表类型(header, rows)
  if (类型 === "资金")
    return new Set<识别字段>([
      "startedAt",
      "amount",
      "balance",
      "counterparty",
      "counterpartyName",
      "ownerAccount",
      "direction",
      "currency",
      "ownerName",
    ])
  if (类型 === "话单")
    return new Set<识别字段>(["startedAt", "caller", "callee", "durationSec", "personName"])
  return new Set<识别字段>(["startedAt", ...extras字段们])
}

/**
 * 「无信息列」：备注 / 摘要 / 网点 / 说明 / 用途 / 序号（以及空表头）。
 *
 * 两处共用同一份判据（`#002-06`）：`需要模型` 的触发分母、`parse_detail.未认出` 的确认清单。
 * 它们既不像任何字段，人工也没有可选的字段可给 —— 摆进弹窗只会把真正要确认的列挤下去。
 */
export function 是无信息列(名: string): boolean {
  const t = 名.trim()
  return t === "" || /备注|摘要|网点|说明|用途|序号/.test(t)
}
