export * as OpenhiveCaseHeaderAi from "./case-header-ai"

import { Schema } from "effect"
import type { LanguageModel } from "ai"
import { 是属性列 } from "./case-attribute-registry"
import { 建调用模型 } from "./case-extract-ai"
import {
  候选字段集,
  单位闸放行,
  字段目录,
  是识别字段,
  形状命中率,
  是无信息列,
  type 识别字段,
} from "./case-field-registry"
import { 待确认原因们, type MappingResult, type 待确认原因 } from "./case-mapping"

/**
 * 触发模型调用的待确认原因：**显式白名单**。
 *
 * 不用 `待确认原因们` 的排除式派生：将来新增原因会被静默当成「模型可裁决」，等于给模型
 * 悄悄放了新权限。调用是按**整表**发的，所以「别名跨字段集」也算值得——那一列模型填不了，
 * 但同表别的未知列可能填得上。
 *
 * 不触发清单（写清楚为什么）：`形状不符` 合并层用同一 0.9 阈值，注定过不了；
 * `单位冲突` / `表头重名` 必须人工裁决，模型帮不上。
 */
const 模型可裁决原因们: readonly 待确认原因[] = ["多列争抢", "候选不唯一", "别名跨字段集"]

/**
 * 必须人工裁决的原因：模型不许填这些列，它们的待确认也不许删（fail-closed）。
 *
 * `别名跨字段集` 尤其不能放给模型：别名是**用户自己下发**的判断，模型顺手改掉它等于静默
 * 覆盖人的决定（`case-mapping.ts`「待确认的列不许被后面的层再猜一次」）。
 */
const 须人工原因们: ReadonlySet<string> = new Set(
  待确认原因们.filter(
    (原因) => 原因 === "单位冲突" || 原因 === "表头重名" || 原因 === "别名跨字段集",
  ),
)

/**
 * 能提供形状证据的 5 个字段：账号 / 手机号 / 时间 / 金额 / 余额这几类形状彼此可区分；
 * 其余字段（direction / 户名等）形状过宽或与别的字段重叠，拿来当证据会误认（`#002-06`）。
 */
const 形状字段们 = ["amount", "startedAt", "callee", "counterparty", "ownerAccount"] as const

/**
 * 表头模型识别（四层召回之后的兜底层）。
 *
 * 复用 `case-extract-ai` 的 `建调用模型` seam：超时、错误详情、json_object 的「json 字样」
 * 都在那一层维护（`#002-06`），这里不再写第二份 `generateObject`。
 */

export interface 表头识别输入 {
  工作表: { 名: string; 表头: (string | null)[]; 样例: (string | null)[][] }[]
  候选字段: string[]
}
export interface 表头识别结果 {
  工作表: Record<string, { 列: Record<number, string> }>
}
export type 表头识别器 = (输入: 表头识别输入) => Promise<表头识别结果>

const 表头输出 = Schema.Struct({
  工作表: Schema.Record(
    Schema.String,
    Schema.Struct({ 列: Schema.Record(Schema.String, Schema.String) }),
  ),
})

/** DeepSeek 见到请求里没有「json」字样会 400（同 case-extract-ai 的注释）。 */
const 表头要求 = `
只输出一个 JSON 对象：{"工作表":{"<sheet 名>":{"列":{"<列号>":"<字段名或 unknown>"}}}}。
列号是 0 开始的下标（第 1 列写 0）。
字段名只能从用户给出的候选字段里选；认不出的列写 "unknown"，不许编造字段名。`

/**
 * 脱敏是**尽力而为**，默认关闭（前提：模型内网/自部署）。
 *
 * 数字（先剥空白/横线与 `+86` 国码，6 位起）按长度分三档：
 * - `n ≥ 12`：首 4 + `****` + 末 4；
 * - `9 ≤ n < 12`：首 3 + `****` + 末 2；
 * - `n ≤ 8`：整串 `****`（首末四位会重叠/接壤，按原位留等于泄漏位数）。
 * 另外：1–6 个汉字（含 `·`，覆盖少数民族姓名）→ 首字 + `**`；两位小数金额 → `*N位`。
 *
 * **残余不覆盖**（会原样外发）：英文名、地址、自由文本、非两位小数的数字、带其它分隔符
 * 的号码。不能把本函数当合规脱敏用。
 */
const 账号脱敏 = (v: string) => {
  const s = v.replace(/[\s-]/g, "").replace(/^\+?86/, "")
  if (!/^\d{6,}$/.test(s)) return v
  if (s.length >= 12) return `${s.slice(0, 4)}****${s.slice(-4)}`
  if (s.length >= 9) return `${s.slice(0, 3)}****${s.slice(-2)}`
  return "****"
}
const 姓名脱敏 = (v: string) => {
  const t = v.trim()
  return /^[一-龥][一-龥·]{0,5}$/.test(t) ? `${t.slice(0, 1)}**` : v
}
/**
 * 金额脱敏牺牲了「两位小数」这个形状证据（只留 `*N位`）：脱敏模式下模型判断金额列会变弱。
 * 这是有意的权衡——送出去的原文不可撤销，形状判错可以靠人工/待确认补，泄露不行。
 */
const 金额脱敏 = (v: string) => (/^-?\d+\.\d{2}$/.test(v.trim()) ? `*${v.trim().length}位` : v)

function 脱敏样例(样例: (string | null)[][]): (string | null)[][] {
  return 样例.map((行) => 行.map((v) => (v === null ? null : 金额脱敏(姓名脱敏(账号脱敏(v))))))
}

/** 单元格截断：行数已由调用方限制（20），这里再兜住超长单元格（M5）。 */
const 截断单元格 = (v: string | null) => (v === null ? null : v.slice(0, 200))

/** 模型输出是**不可信数据**：非对象、非数字键都要挡住，别让 `null` / `NaN` 进结果（M7）。 */
const 是对象 = (值: unknown): 值 is Record<string, unknown> =>
  typeof 值 === "object" && 值 !== null

export function 建表头识别器(模型: LanguageModel, 选项: { 脱敏: boolean }): 表头识别器 {
  const 调用 = 建调用模型<{ 工作表: Record<string, { 列: Record<string, string> }> }>(模型, {
    结构: 表头输出,
    系统后缀: 表头要求,
  })
  return async (输入) => {
    const 样例们 = 选项.脱敏
      ? 输入.工作表.map((s) => ({ ...s, 样例: 脱敏样例(s.样例) }))
      : 输入.工作表
    // 列号显式放进 payload（0 基，提示词里也写明）：只给表头顺序时，模型输出 1 基会整体
    // 错位一列，而 `amount` / `balance` 形状相同，错位也过得了闸（M2）。
    const 用户 = JSON.stringify({
      候选字段: 输入.候选字段,
      工作表: 样例们.map((s) => ({
        名: s.名,
        // 属性列不送模型（05 §4.3）：表头与样例都不外发。**列号必须保持原始下标**——
        // 它是模型输出的唯一定位键，过滤后重新编号会让建议整体错位。
        列: s.表头.flatMap((标题, i) =>
          是属性列(标题)
            ? []
            : [
                {
                  列号: i,
                  表头: 标题,
                  样例: s.样例.map((行) => 截断单元格(行[i] ?? null)),
                },
              ],
        ),
      })),
    })
    const 结果 = await 调用({
      系统: "你是表格表头识别器。表头可能换名、带修饰语或单位后缀；按列的数据形状判断它是什么字段。",
      用户,
    })
    const 标准化: 表头识别结果 = { 工作表: {} }
    for (const [名, 值] of Object.entries(结果.工作表 ?? {})) {
      const 列: Record<number, string> = {}
      if (是对象(值) && 是对象(值.列)) {
        for (const [k, v] of Object.entries(值.列)) {
          if (!/^\d+$/.test(k) || typeof v !== "string") continue
          列[Number(k)] = v
        }
      }
      标准化.工作表[名] = { 列 }
    }
    return 标准化
  }
}

/**
 * 触发判定：四层召回漏掉了**有形状证据**的列时，才值得花一次模型调用。
 *
 * 两条口径（设计阈值，不许改）：
 * - 关键字段缺失：`startedAt` / `amount` 一个都没认出来，但整表里确实有一列形状像它；
 * - 有形状未认领的列占比 > 30%。`总列` 排除「名称为空」与备注/摘要/网点/说明/用途/序号
 *   这类无信息列 —— 它们进模型也认不出字段，只会把分母撑大、把触发压下去。
 *
 * 「有形状未认领」只统计**本表候选集里**的字段：候选集外的列（资金表里的 `callee`）、
 * extras 字段，合并层都会拒绝 —— 为它们触发一次调用纯属浪费（I2）。
 * 「其他」表同理：候选集是 `startedAt` + extras，而模型本期只落标准列 ⇒ 只有 `startedAt`
 * 可填，这是有意的。
 */
export function 需要模型(
  每表: readonly MappingResult[],
  表头们: readonly (string | null)[][],
  行们: readonly (string | null)[][][],
): boolean {
  let 有形状未认领 = 0
  let 总列 = 0
  for (let s = 0; s < 每表.length; s++) {
    const 结果 = 每表[s]
    const 表头 = 表头们[s] ?? []
    const 行 = 行们[s] ?? []
    const 字段们 = Object.values(结果.columns)
    const 候选 = 候选字段集(表头, 行)
    if (!字段们.includes("startedAt") && 有形状列("startedAt", 表头, 行)) return true
    // amount 必须先在本表候选集里：话单 / 其他表的金额形状列模型填不进去，触发是空转（R27）。
    // startedAt 三分支候选集都含，不必加同一前置。
    if (!字段们.includes("amount") && 候选.has("amount") && 有形状列("amount", 表头, 行)) return true
    if (结果.待确认.some((项) => 模型可裁决原因们.includes(项.原因))) return true
    for (let i = 0; i < 表头.length; i++) {
      const 名 = (表头[i] ?? "").trim()
      // 属性列不是字段、模型也填不进去（05 §4.3）：计入分母只会把触发压下去、把属性值白送出去。
      if (是属性列(表头[i] ?? null)) continue
      if (是无信息列(名)) continue
      总列++
      if (结果.columns[i] !== undefined) continue
      const 像某种形状 = 形状字段们.some(
        (f) => 候选.has(f) && 形状命中率(f, 行.map((r) => r[i] ?? null)) >= 0.9,
      )
      if (像某种形状) 有形状未认领++
    }
  }
  return 总列 > 0 && 有形状未认领 / 总列 > 0.3
}

function 有形状列(field: 识别字段, 表头: (string | null)[], 行: (string | null)[][]): boolean {
  return 表头.some(
    (_, i) => !是属性列(表头[i] ?? null) && 形状命中率(field, 行.map((r) => r[i] ?? null)) >= 0.9,
  )
}

/**
 * 合并模型建议：只填**未认领**的列，规则/别名已认领的不许覆盖。
 *
 * 模型层与四层召回受**同一前提**约束（`#002-06`）：
 * - 字段必须在该表的候选字段集里：资金表里的「联系电话」形状像 `callee` 也不能认，
 *   否则话单字段会静默填进资金标准列；
 * - 一列必须过单位闸：`交易金额（万元）` 被规则层拒了，模型也不能按「元」认成 `amount`
 *   （否则静默 10000 倍，`#011-01` / `#011-02`）；
 * - 单位冲突 / 表头重名的列只能人工裁决，模型不许碰；
 * - 一个字段只能占一列：同一字段被建议到多列时只落第一列，否则后一列的数据会覆盖前一列，
 *   而且没有任何待确认提示。
 *
 * 模型填上的列，其「待确认」条目一并移除：那一条对应的就是这次被解决掉的歧义；否则角度标
 * 会对着已经认出来的列一直亮着。没填上的列，待确认原样保留 —— 模型不替人做决定。
 *
 * `method` 不动：方法由 `来源` 判定（缓存里也按来源重算），合并层不该按「有没有模型参与」
 * 改写四层召回的结论。
 */
export function 合并模型结果(
  表头: (string | null)[],
  行: (string | null)[][],
  基础: MappingResult,
  建议: Record<number, string>,
): MappingResult {
  const columns = { ...基础.columns }
  const 来源 = { ...基础.来源 }
  const 候选 = 候选字段集(表头, 行)
  const 已用 = new Set<识别字段>(Object.values(columns))
  const 须人工列 = new Set(基础.待确认.filter((项) => 须人工原因们.has(项.原因)).map((项) => 项.列号))
  const 模型已解决 = new Set<number>()
  for (const [键, 字段名] of Object.entries(建议)) {
    const i = Number(键)
    if (!Number.isInteger(i) || i < 0 || i >= 表头.length) continue
    if (columns[i] !== undefined) continue // 规则/别名已认领，模型不许覆盖
    // 属性列只进 `已定`、不在 `columns` 里 ⇒ 上面那条守卫对它无效（05 §4.3）。
    if (是属性列(表头[i] ?? null)) continue
    if (!是识别字段(字段名)) continue
    // extras 字段没有可验证的形状证据：靠模型自由发挥会污染 extras（本期模型只认标准列）。
    if (字段目录[字段名].落点 !== "列") continue
    // 类型不对的字段不参与本表认领（`候选字段集` 的同一前提）。
    if (!候选.has(字段名)) continue
    // 单位声明必须放行：模型层没有豁免理由（`#011-02` 的同一道闸）。
    if (!单位闸放行(字段名, 表头[i] ?? null)) continue
    // 单位冲突 / 表头重名：只能人工看一眼（按位置 / 按原文）。
    if (须人工列.has(i)) continue
    if (已用.has(字段名)) continue
    if (!形状命中(字段名, 行.map((r) => r[i] ?? null))) continue
    columns[i] = 字段名
    来源[i] = "模型"
    已用.add(字段名)
    模型已解决.add(i)
  }
  const 待确认 = 基础.待确认.filter((项) => !模型已解决.has(项.列号))
  // 按合并后的 columns 重算：否则模型认出的列还被算作「未知列」（I1）。
  // 属性列不是「未认出」列（05 §4.3）：它们本来就不进四层召回，不能按 columns 缺失计成未知。
  const unknownColumns = 表头.flatMap((_, i) =>
    columns[i] === undefined && !是属性列(表头[i] ?? null) ? [i] : [],
  )
  return { ...基础, columns, 来源, 待确认, unknownColumns }
}

function 形状命中(field: 识别字段, 值们: (string | null)[]): boolean {
  return 字段目录[field].形状 === undefined || 形状命中率(field, 值们) >= 0.9
}
