export * as OpenhiveCaseRemarkFacts from "./case-remark-facts"

import { 解析备注段 } from "./case-purpose"

/**
 * 备注事实抽取（06 §6.8 / §6.9）：商户、车牌、手机号、摘要。
 *
 * **纯函数**：与 `case-purpose.ts` 同一条纪律——不碰库、不读时钟、不调模型。
 * 这些都是②层「取出来的」事实（06 §6.2）：用途变了不该重抽车牌，抽取出错也不该污染 `purpose`。
 */

export interface 备注事实 {
  /** 仅消费行、过值闸、解码成功才有值。 */
  商户: string | null
  /** 大写归一、按首次出现去重。 */
  车辆: string[]
  /** 11 位手机号，按首次出现去重。 */
  号码: string[]
  /** 给人工看的一行字：主体清洗 → 回退链 → 60 码点截断；回退链末级是用途，故恒非空。 */
  摘要: string | null
}

export interface 抽取备注事实输入 {
  备注: string | null
  /** 用途闸看一级；摘要回退末级用 `二级 ?? 一级`。 */
  用途: { 一级: string; 二级: string | null }
  /** `counterpartyName ?? counterparty`；摘要回退第二级。 */
  对手名: string | null
}

/**
 * 渠道/用途词冒充「子商户名称」的名单（2026-11-14 真数据实测）：
 * 生活缴费 1,005 行、手机充值 143 行、信用卡还款 67 行、零钱通 168 行、微信转账到QQ 2 行。
 */
export const 商户值闸词们 = ["生活缴费", "信用卡还款", "零钱通", "微信转账到QQ"] as const

/** 备注首段以这些键开头 = 元数据段，不是人话。 */
export const 摘要元数据键们 = ["网银联单号类型", "相关方", "title", "receiver", "子商户名称"] as const

const 通用摘要词们 = new Set(["微信转账", "微信红包", "微信支付", "财付通", "零钱通"])

/** 省份汉字 + 发牌机关字母 + 4~5 位 + 可选尾字；前后不许紧邻字母数字（防从长串里截）。 */
const 车牌形状 =
  /(?:^|[^A-Za-z0-9])([京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{4,5}[A-Z0-9挂学警港澳]?)(?![A-Za-z0-9])/g

/** 中国大陆手机号；前后不许紧邻数字。 */
const 手机号形状 = /(?:^|\D)(1[3-9]\d{9})(?!\d)/g

export function 抽取备注事实(input: 抽取备注事实输入): 备注事实 {
  const 备注 = (input.备注 ?? "").trim()
  const { 首段, 段 } = 解析备注段(备注)
  const 商户 = 取商户(段["子商户名称"], input.用途.一级)
  return {
    商户,
    车辆: 取匹配(备注, 车牌形状),
    号码: 取匹配(备注, 手机号形状),
    摘要: 取摘要({ 首段, 商户, 对手名: input.对手名, 用途: input.用途 }),
  }
}

function 解码(原值: string): string | null {
  if (!原值.startsWith("UTF8#")) return 原值.trim() === "" ? null : 原值.trim()
  try {
    const 值 = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(原值.slice(5), "base64")).trim()
    return 值 === "" ? null : 值
  } catch {
    // 解码失败不伪造：宁可没有商户，也不把 base64 当商户名落库（设计 §7）。
    return null
  }
}

function 取商户(原值: string | undefined, 一级: string): string | null {
  if (一级 !== "消费" || 原值 === undefined) return null
  const 值 = 解码(原值)
  if (值 === null || 值 === "-" || 值 === "#|#") return null
  if ((商户值闸词们 as readonly string[]).includes(值)) return null
  if (值.startsWith("手机充值")) return null
  return 值
}

function 取匹配(文本: string, 形状: RegExp): string[] {
  if (文本 === "") return []
  形状.lastIndex = 0
  const 出: string[] = []
  const 已见 = new Set<string>()
  for (const m of 文本.matchAll(形状)) {
    const 值 = (m[1] ?? "").toUpperCase()
    if (值 === "" || 已见.has(值)) continue
    已见.add(值)
    出.push(值)
  }
  return 出
}

function 去后缀(值: string | null): string | null {
  if (值 === null) return null
  const 净 = 值.replace(/\((商户|个人)\)$/u, "").trim()
  return 净 === "" ? null : 净
}

function 摘要可用(折: string): boolean {
  if (折 === "" || 折 === "-" || 折 === "#|#") return false
  if (摘要元数据键们.some((键) => 折.startsWith(键))) return false
  // 整句只剩「微信转账；微信红包」这类渠道/类型词 ⇒ 没有信息量。
  return !折.split("；").every((词) => 通用摘要词们.has(词))
}

function 取摘要(input: {
  首段: string
  商户: string | null
  对手名: string | null
  用途: { 一级: string; 二级: string | null }
}): string {
  const 段们 = input.首段
    .split(/[;；]/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x !== "")
  const 已见 = new Set<string>()
  const 留: string[] = []
  for (const 一 of 段们) {
    if (已见.has(一)) continue
    已见.add(一)
    留.push(一)
  }
  const 折 = 留.join("；")
  const 候选 = 摘要可用(折)
    ? 折
    : (input.商户 ?? 去后缀(input.对手名) ?? input.用途.二级 ?? input.用途.一级)
  const 码点 = Array.from(候选)
  return 码点.length <= 60 ? 候选 : `${码点.slice(0, 60).join("")}…`
}
