export * as OpenhiveCaseExtract from "./case-extract"

import { Schema } from "effect"
import { parseTime, type Precision } from "./case-time"
import { 号码归一, 实体规范值, 形近命中, 文本包含, 金额元 } from "./case-value"

/**
 * 非结构化材料的抽取契约。
 *
 * ## 只收原文（R4）
 *
 * 模型输出里的 `取值` / `金额原文` / `时间原文` 都是**原文照抄**；规范值（号码、金额、时间、
 * 实体规范值）由这里算。模型一旦被允许「顺手归一」，回读就退化成「模型自己跟自己一致」，
 * 设计 §7.4 那句「28 万可能是编的」就挡不住了。
 *
 * ## 回读的顺序
 *
 * 出处整句 → 这一片原文（**整条事实的生死**）；原子值 → 出处整句（**该值的生死**）。
 * 出处都对不上，说明这条事实根本不是从这段文本里来的，直接丢；原子值对不上，按设计
 * 「置空 ＋ 存疑」，事实本身留下。
 *
 * ## 金额只有一条通路（别和表格那条混用）
 *
 * AI 抽取的金额**只经 `金额元`**（认万/亿/中文/会计写法，畸形一律 undefined）；
 * 表格那一路是 `case-rows.ts` 的 `parseAmount`（严格数字串，单位由列名单位闸整列拒收）。
 * 两者**不许交叉复用**：`parseAmount` 的输出是 `numeric` 字符串、认不出就拒整行，
 * 而这里要的是「认不出就置空 ＋ 存疑」。落库统一由 `case-fact-store.ts` 的金额参数
 * 转成两位小数字符串（`#002-01`）。
 */
export const 实体类型们 = ["人", "号码", "账户", "虚拟身份", "车辆", "物品", "地点", "组织"] as const
export type 实体类型 = (typeof 实体类型们)[number]

export const 关系类型们 = ["通话", "转账", "实名登记", "实际使用", "同案", "持有", "同行"] as const
export type 关系类型 = (typeof 关系类型们)[number]

/** 这几种关系是数据直接记录的，库里不要求 `basis`；其余必须给认定依据（0031 的 CHECK）。 */
const 数据直记 = new Set<关系类型>(["通话", "转账", "实名登记"])

export const 抽取结构 = Schema.Struct({
  实体: Schema.Array(
    Schema.Struct({
      类型: Schema.Literals(实体类型们),
      取值: Schema.String,
      别名: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  关系: Schema.Array(
    Schema.Struct({
      类型: Schema.Literals(关系类型们),
      从: Schema.String,
      到: Schema.String,
      金额原文: Schema.optional(Schema.String),
      依据: Schema.optional(Schema.String),
      原文: Schema.String,
    }),
  ),
  事件: Schema.Array(
    Schema.Struct({
      类型: Schema.String,
      时间原文: Schema.optional(Schema.String),
      参与人: Schema.Array(Schema.String),
      简述: Schema.optional(Schema.String),
      原文: Schema.String,
    }),
  ),
})
export type 抽取结果 = Schema.Schema.Type<typeof 抽取结构>

export const PROMPT版本 = "2026-11-06.1"

/**
 * 抽取口径。**版本号进 parse_detail**，改口径必须同时改版本号——否则「同一份材料两次
 * 结果不一样」会说不清是哪一环变的（设计 §7.4 留痕层）。
 */
export function 系统提示(): string {
  return `你是公安案件材料的抽取器（口径版本 ${PROMPT版本}）。

只做一件事：从给定的一段材料原文里，抽出**明确写出来的**人、号码、账户、车辆、物品、地点、组织，以及它们之间的关系和发生的事。

规则（逐条遵守）：
1. 只抽这一段原文里写到的内容。没写的、要靠推理补的、别的段落里的，一律不抽。
2. 所有取值照抄原文：人名写原文里的人名，号码写原文里的号码，金额写原文里的金额（例如「28万」「1,234.50元」），时间写原文里的时间（例如「2026年3月5日下午」）。
   **不要换算**：不要自己把「28万」算成 280000，不要自己把「下午3点」算成 15:00，不要补年份。
3. 每一条关系、每一个事件都必须给「原文」：从这一段里**逐字复制**的、能说明这条事实的完整句子或分句。出处不能改写、不能拼接、不能省略。
4. 抽取不出人名、号码、金额、时间时，**不知道就留空**（省略该字段或给空字符串），绝不猜、绝不编。
5. 关系类型只能是：通话、转账、实名登记、实际使用、同案、持有、同行。除通话、转账、实名登记外，必须在「依据」里写认定依据（供述指认 / 扣押实物 / 技侦 / 登录或使用日志 / 资金闭环 / 推断），否则不要输出这条关系。
6. 事件类型写一句短语（例如「见面」「转账」「通话」「抓获」），不要写成长句。
7. 这一段里没有可抽的事实，就返回空的三个数组。`
}

export function 用户提示(input: {
  fileName: string
  片序号: number
  片数: number
  起: number
  止: number
  文本: string
}): string {
  return `材料：${input.fileName}
片段：第 ${input.片序号}/${input.片数} 片（全文第 ${input.起}–${input.止} 字）

<原文>
${input.文本}
</原文>`
}

export interface 实体输入 {
  type: 实体类型
  canonicalValue: string
  aliases: string[]
}

export interface 关系输入 {
  type: 关系类型
  /** 实体**规范值**（调用方据此 upsert 并取 id）。 */
  from: string
  to: string
  amount: number | null
  basis: string | null
  原文: string
  存疑: boolean
}

export interface 事件输入 {
  type: string
  occurredRaw: string | null
  occurredAt: number | null
  precision: Precision | null
  participants: string[]
  summary: string | null
  存疑: boolean
}

export interface 回读输出 {
  实体: 实体输入[]
  关系: 关系输入[]
  事件: 事件输入[]
  问题: string[]
}

/** 数字串按号码判，其余按人判——只用于「关系/事件里出现、但实体清单没列」的角色。 */
function 推断实体类型(value: string): 实体类型 {
  return /^[\d\s\-()+]+$/.test(value) && 号码归一(value) !== undefined ? "号码" : "人"
}

/**
 * 「这段文字里有没有这串数字」——**只做包含判断，不产出规范值**。
 *
 * 别拿 `号码归一(出处)` 来比：`号码归一` 只对标识符成立（见 `case-value.ts` 的注释），
 * 喂整段原文会得到一串把日期、金额、号码拼在一起的数字，跨边界的幻觉值也能命中（`#011-01` 同族）。
 */
function 数字串(s: string): string {
  return s.replace(/\D/g, "")
}

function 命中(出处: string, 值: string): boolean {
  if (文本包含(出处, 值)) return true
  const 值号码 = 号码归一(值)
  if (值号码 !== undefined && 值号码.length >= 5) {
    if (数字串(出处).includes(数字串(值号码))) return true
  }
  return 形近命中(出处, 值)
}

export function 回读(结果: 抽取结果, 片文本: string): 回读输出 {
  const 问题: string[] = []
  const 实体 = new Map<string, 实体输入>()

  const 加实体 = (类型: 实体类型, 原文值: string, 别名: readonly string[]): 实体输入 | undefined => {
    const 规范 = 实体规范值(类型, 原文值)
    if (规范 === undefined) {
      问题.push(`「${原文值}」不是一个可用的${类型}`)
      return undefined
    }
    const 键 = `${类型}\u0000${规范}`
    const 既有 = 实体.get(键)
    if (既有) {
      for (const 名 of 别名) if (名 !== 规范 && !既有.aliases.includes(名)) 既有.aliases.push(名)
      return 既有
    }
    const 项: 实体输入 = { type: 类型, canonicalValue: 规范, aliases: 别名.filter((名) => 名 !== 规范) }
    实体.set(键, 项)
    return 项
  }

  for (const 项 of 结果.实体) {
    if (!命中(片文本, 项.取值)) {
      问题.push(`实体「${项.取值}」在这段原文里找不到`)
      continue
    }
    加实体(项.类型, 项.取值, 项.别名 ?? [])
  }

  const 关系: 关系输入[] = []
  for (const 项 of 结果.关系) {
    if (!文本包含(片文本, 项.原文)) {
      问题.push(`关系「${项.从} → ${项.到}」的出处在这段原文里找不到`)
      continue
    }
    if (!数据直记.has(项.类型) && (项.依据 === undefined || 项.依据.trim() === "")) {
      问题.push(`关系「${项.从} → ${项.到}」是「${项.类型}」，但没有给认定依据`)
      continue
    }
    const 缺角色 = [项.从, 项.到].filter((值) => !命中(项.原文, 值))
    if (缺角色.length > 0) {
      问题.push(`关系「${项.从} → ${项.到}」的${缺角色.join("、")}在出处里找不到`)
      continue
    }
    // 不写 `实体规范值(...)!`：`!` 只会把 `undefined` 静默当成真值带下去，写库时变成一条
    // 指向 `undefined` 的关系。这条守卫**实测走不到**（角色串经 `推断实体类型` 只会是「人」或
    // 「号码」，纯空白角色更早在上面按「出处里找不到」被丢），留着是因为它花的代价只有一次
    // `=== undefined`，而丢掉 `!` 之后任何一条将来新增的「认不出」通路都不会静默继续。
    // 同一守卫真正会命中的落点是 `结果.实体`：模型给 `类型: "号码", 取值: "abc"` 时
    // `加实体` 返回 `undefined` 并记「不是一个可用的号码」。
    const 从项 = 加实体(推断实体类型(项.从), 项.从, [])
    const 到项 = 加实体(推断实体类型(项.到), 项.到, [])
    if (从项 === undefined || 到项 === undefined) continue

    let amount: number | null = null
    let 存疑 = false
    if (项.金额原文 !== undefined && 项.金额原文.trim() !== "") {
      if (!文本包含(项.原文, 项.金额原文)) {
        问题.push(`关系「${项.从} → ${项.到}」的金额「${项.金额原文}」在出处里找不到，已置空`)
        存疑 = true
      } else {
        const 值 = 金额元(项.金额原文)
        if (值 === undefined) {
          问题.push(`关系「${项.从} → ${项.到}」的金额「${项.金额原文}」认不出，已置空`)
          存疑 = true
        } else amount = 值
      }
    }

    关系.push({
      type: 项.类型,
      from: 从项.canonicalValue,
      to: 到项.canonicalValue,
      amount,
      basis: 项.依据 ?? null,
      原文: 项.原文,
      存疑,
    })
  }

  const 事件: 事件输入[] = []
  for (const 项 of 结果.事件) {
    if (!文本包含(片文本, 项.原文)) {
      问题.push(`事件「${项.类型}」的出处在这段原文里找不到`)
      continue
    }
    let 存疑 = false
    let occurredRaw: string | null = null
    let occurredAt: number | null = null
    let precision: Precision | null = null
    if (项.时间原文 !== undefined && 项.时间原文.trim() !== "") {
      occurredRaw = 项.时间原文
      if (!文本包含(项.原文, 项.时间原文)) {
        问题.push(`事件「${项.类型}」的时间「${项.时间原文}」在出处里找不到，已置空`)
        存疑 = true
      } else {
        const 时间 = parseTime(项.时间原文)
        if (时间 === undefined) {
          问题.push(`事件「${项.类型}」的时间「${项.时间原文}」认不出，已置空`)
          存疑 = true
        } else {
          occurredAt = 时间.seconds
          precision = 时间.precision
        }
      }
    }

    const 参与人: string[] = []
    for (const 人 of 项.参与人) {
      if (!命中(项.原文, 人)) {
        问题.push(`事件「${项.类型}」的参与人「${人}」在出处里找不到，已移除`)
        存疑 = true
        continue
      }
      const 项实体 = 加实体(推断实体类型(人), 人, [])
      if (项实体 === undefined) continue
      参与人.push(项实体.canonicalValue)
    }

    事件.push({
      type: 项.类型.slice(0, 40),
      occurredRaw,
      occurredAt,
      precision,
      participants: 参与人,
      summary: 项.简述 ?? null,
      存疑,
    })
  }

  return { 实体: [...实体.values()], 关系, 事件, 问题 }
}
