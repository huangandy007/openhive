export * as OpenhiveCaseFieldRegistry from "./case-field-registry"

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
const 户名形状 = (v: string) => {
  const t = v.trim()
  return t !== "" && !/^[\d\s-]+$/.test(t) && t.length <= 60
}
const 方向形状 = (v: string) => /^(收|付|进|出|借|贷|转入|转出|收入|支出)$/.test(v.trim())
const 去横线 = (v: string) => v.replace(/[\s　-]/g, "")
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
    同义词: ["交易对方名称", "对方名称", "对方户名", "对手户名", "收方名称", "付方名称", "交易对方"],
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
      "ownerName",
    ])
  if (类型 === "话单")
    return new Set<识别字段>(["startedAt", "caller", "callee", "durationSec", "personName"])
  return new Set<识别字段>(["startedAt", ...extras字段们])
}
