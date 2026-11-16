import { type ParseError, parse as 解析JSONC } from "jsonc-parser"
import { 解析出处 } from "./citation"

/**
 * `.hgraph` 图文件的解析与序列化（012 data-model §1–§5 / contracts/hgraph-format §1、§3）。
 * 纯函数：不写盘、不发 HTTP、不碰数据库。
 *
 * ## 读是**放宽**的
 *
 * 契约 §1 只把四类情况当读失败：坏 JSON、版本不认识 / 更新、顶层形状不对。开放词表
 * （`类型`）、`来源.kind`、`性质` 的取值和悬空边都**不在读时拒绝**——语义校验归写入口
 * （T004 的 `校验来源`）。所以这里只做「形状闸」，不做「语义闸」。
 *
 * ## 未知键怎么保真（V-08 / FR-010）
 *
 * `文档` 只是 `原文树` 的**已知键投影**；序列化时以 `原文树` 为底、按已知键覆盖，
 * 没见过的键（顶层或嵌套对象里）原样留在输出里。禁止「解析成类型化对象再整体序列化」
 * ——那样必丢字段（08 §4.4）。数组按身份键配对（节点/边/文字按 `id`，属性按 `键`，
 * 证据按 `关系`），所以重排、增删都不会把未知键贴到别的对象上。
 *
 * 已知键为 `undefined` **或 `null`** ⇒ 视为删除该键（契约 §3.1：`补丁[键] = null` 就是
 * 删键，T005 按这个编码发删除）；**已知键**的 `null` 不会被写进文件（未知键的原值 `null`
 * 仍按保真要求原样写回）。
 */

export interface 设置 {
  线宽度量: "按类型默认" | "按金额" | "按次数"
  次数阈值: number[]
  金额阈值: number[]
  外环阈值: number[]
}

export interface 时间 {
  首: string
  末: string
}

export interface 来源 {
  kind: "实体" | "关系" | "推断" | "手写" | "事件"
  实体?: string
  值?: string
  库类型?: string
  可信?: string
  关系们?: string[]
  依据?: string
  并入?: string[]
}

export interface 属性 {
  键: string
  值: string
  出处?: string[]
}

export interface 外环 {
  档?: number
  颜色?: string
}

export interface 样式 {
  颜色?: string
  形状?: string
}

export interface 节点 {
  id: string
  名称: string
  类型: string
  细类?: string
  来源: 来源
  可信度?: "高" | "中" | "低"
  属性?: 属性[]
  出处?: string[]
  时间: 时间
  备注?: string
  x: number
  y: number
  外环?: 外环
  出现序?: number
  链接?: string
  锁定?: true
  样式?: 样式
}

export interface 证据 {
  关系: string
  出处: string
}

export interface 金额 {
  值: string
  单位: string
}

export interface 边 {
  id: string
  从: string
  到: string
  标签: string
  性质: "事实" | "推断"
  方向: "有向" | "无向"
  来源: 来源
  /** `性质 = 推断` 时必填（data-model §4.1 / V-05、V-06）；与节点同名同义。 */
  可信度?: "高" | "中" | "低"
  证据?: 证据[]
  出处?: string[]
  时间: 时间
  次数?: number
  金额?: 金额
  备注?: string
  线宽档?: number
  出现序?: number
}

export interface 文字 {
  id: string
  内容: string
  x: number
  y: number
  字号: "小" | "中" | "大"
  加粗?: boolean
  颜色?: string
  对齐?: "左" | "中" | "右"
  宽度?: number
  出现序?: number
}

export interface 图文件 {
  格式: 1
  标题: string
  创建于: string
  更新于: string
  设置: 设置
  节点: 节点[]
  边: 边[]
  文字: 文字[]
}

export type 解析失败码 = "BAD_JSON" | "BAD_VERSION" | "NEWER_VERSION" | "BAD_SHAPE"

export type 解析结果 =
  | { ok: true; 文档: 图文件; 原文树: unknown }
  | { ok: false; code: 解析失败码; 说明: string }

/** 冻结只做兜底：调用方取 `默认设置` 时必须复制（`补全设置` / `空骨架` 都复制）。 */
function 冻结数组(值: number[]): number[] {
  return Object.freeze(值) as number[]
}

/** data-model §2：阈值只影响渲染档位。常量本身冻结，别直接往常量里 push。 */
export const 默认设置: 设置 = Object.freeze({
  线宽度量: "按类型默认",
  次数阈值: 冻结数组([1, 2, 5, 10, 50]),
  金额阈值: 冻结数组([10000, 50000, 200000, 1000000]),
  外环阈值: 冻结数组([1, 2, 4, 8]),
})

// ---------------------------------------------------------------------------
// 已知键表：`data-model.md` §1–§5 的字段是唯一来源，别在这里加没写过的键。
// ---------------------------------------------------------------------------

interface 对象形状 {
  readonly 键们: readonly string[]
  readonly 子?: Readonly<Record<string, 对象形状>>
  /** 元素是对象的数组：`键` 是身份键（重排/增删时据此配回原文对象），缺省按位置。 */
  readonly 数组?: Readonly<Record<string, { readonly 键?: string; readonly 元素: 对象形状 }>>
}

const 来源形状: 对象形状 = { 键们: ["kind", "实体", "值", "库类型", "可信", "关系们", "依据", "并入"] }
const 属性形状: 对象形状 = { 键们: ["键", "值", "出处"] }
const 证据形状: 对象形状 = { 键们: ["关系", "出处"] }
const 金额形状: 对象形状 = { 键们: ["值", "单位"] }
const 时间形状: 对象形状 = { 键们: ["首", "末"] }
const 外环形状: 对象形状 = { 键们: ["档", "颜色"] }
const 样式形状: 对象形状 = { 键们: ["颜色", "形状"] }
const 设置形状: 对象形状 = { 键们: ["线宽度量", "次数阈值", "金额阈值", "外环阈值"] }

const 节点形状: 对象形状 = {
  键们: [
    "id",
    "名称",
    "类型",
    "细类",
    "来源",
    "可信度",
    "属性",
    "出处",
    "时间",
    "备注",
    "x",
    "y",
    "外环",
    "出现序",
    "链接",
    "锁定",
    "样式",
  ],
  子: { 来源: 来源形状, 时间: 时间形状, 外环: 外环形状, 样式: 样式形状 },
  数组: { 属性: { 键: "键", 元素: 属性形状 } },
}

const 边形状: 对象形状 = {
  键们: [
    "id",
    "从",
    "到",
    "标签",
    "性质",
    "方向",
    "来源",
    "可信度",
    "证据",
    "出处",
    "时间",
    "次数",
    "金额",
    "备注",
    "线宽档",
    "出现序",
  ],
  子: { 来源: 来源形状, 时间: 时间形状, 金额: 金额形状 },
  数组: { 证据: { 键: "关系", 元素: 证据形状 } },
}

const 文字形状: 对象形状 = {
  键们: ["id", "内容", "x", "y", "字号", "加粗", "颜色", "对齐", "宽度", "出现序"],
}

const 图文件形状: 对象形状 = {
  键们: ["格式", "标题", "创建于", "更新于", "设置", "节点", "边", "文字"],
  子: { 设置: 设置形状 },
  数组: {
    节点: { 键: "id", 元素: 节点形状 },
    边: { 键: "id", 元素: 边形状 },
    文字: { 键: "id", 元素: 文字形状 },
  },
}

// ---------------------------------------------------------------------------
// 投影（原文树 → 只含已知键的文档）与贴回（原文树 ← 文档，未知键留着）
// ---------------------------------------------------------------------------

function 是普通对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 投影(原: unknown, 形状: 对象形状): unknown {
  // 已知键位置上出现非对象（如 `来源: "手写"`）：原样留着，序列化时再原样写回，
  // 不在这里把它变成 `{}`（那等于悄悄删数据）。
  if (!是普通对象(原)) return 原
  const 结果: Record<string, unknown> = {}
  for (const 键 of 形状.键们) {
    const 值 = 原[键]
    if (值 === undefined) continue
    const 子 = 形状.子?.[键]
    const 数组 = 形状.数组?.[键]
    if (子 !== undefined) 结果[键] = 投影(值, 子)
    else if (数组 !== undefined) 结果[键] = 投影数组(值, 数组)
    else 结果[键] = 值
  }
  return 结果
}

function 投影数组(原: unknown, 形状: { readonly 键?: string; readonly 元素: 对象形状 }): unknown {
  if (!Array.isArray(原)) return 原
  return 原.map((元素) => 投影(元素, 形状.元素))
}

function 贴(原: unknown, 新: unknown, 形状: 对象形状): unknown {
  if (!是普通对象(新)) return 新
  const 结果: Record<string, unknown> = 是普通对象(原) ? { ...原 } : {}
  for (const 键 of 形状.键们) {
    const 值 = 新[键]
    // 契约 §3.1 / data-model §7：`补丁[键] = null` 表示删该键，T005 的删除就按这个编码发；
    // 缺键（`undefined`）与 `null` 同义——**绝不能**把 `null` 写进文件。
    if (值 === undefined || 值 === null) {
      delete 结果[键]
      continue
    }
    const 子 = 形状.子?.[键]
    const 数组 = 形状.数组?.[键]
    if (子 !== undefined) 结果[键] = 贴(结果[键], 值, 子)
    else if (数组 !== undefined) 结果[键] = 贴数组(结果[键], 值, 数组)
    else 结果[键] = 值
  }
  return 结果
}

function 贴数组(原: unknown, 新: unknown, 形状: { readonly 键?: string; readonly 元素: 对象形状 }): unknown {
  if (!Array.isArray(新)) return 新
  const 原数组 = Array.isArray(原) ? 原 : []
  const 身份键 = 形状.键
  const 原表 = new Map<string, unknown>()
  if (身份键 !== undefined) {
    for (const 元素 of 原数组) {
      if (!是普通对象(元素)) continue
      const id = 元素[身份键]
      if (typeof id === "string") 原表.set(id, 元素)
    }
  }
  return 新.map((元素, 序) => {
    if (身份键 === undefined) return 贴(原数组[序], 元素, 形状.元素)
    const id = 是普通对象(元素) ? 元素[身份键] : undefined
    const 原元素 = typeof id === "string" ? 原表.get(id) : undefined
    return 贴(原元素, 元素, 形状.元素)
  })
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function 消息(错误: unknown): string {
  return 错误 instanceof Error ? 错误.message : String(错误)
}

function 描述值(值: unknown): string {
  if (值 === undefined) return "缺失"
  return JSON.stringify(值) ?? "缺失"
}

function 取线宽度量(值: unknown): 设置["线宽度量"] | undefined {
  return 值 === "按类型默认" || 值 === "按金额" || 值 === "按次数" ? 值 : undefined
}

function 类型名(值: unknown): string {
  if (值 === undefined) return "缺失"
  if (值 === null) return "null"
  if (Array.isArray(值)) return "数组"
  return typeof 值 === "object" ? "对象" : typeof 值
}

/**
 * 错误位置：Bun 的 `JSON.parse` 只报「缺什么」不报位置，jsonc-parser 的 `ParseError.offset`
 * 能补上行列。两边的严格度在这里对齐：关注释、关尾逗号 ⇒ 比 JSON 宽松的写法不会再被漏过。
 */
function 定位(原文: string): string {
  const 错误们: ParseError[] = []
  解析JSONC(原文, 错误们, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false })
  const 首 = 错误们[0]
  if (首 === undefined) return "某处"
  const 之前的行 = 原文.slice(0, 首.offset).split("\n")
  return `第 ${之前的行.length} 行第 ${之前的行[之前的行.length - 1].length + 1} 列`
}

function 补全设置(值: unknown): 设置 {
  const 视图 = 是普通对象(值) ? 值 : {}
  return {
    线宽度量: 取线宽度量(视图.线宽度量) ?? 默认设置.线宽度量,
    次数阈值: Array.isArray(视图.次数阈值) ? (视图.次数阈值 as number[]) : [...默认设置.次数阈值],
    金额阈值: Array.isArray(视图.金额阈值) ? (视图.金额阈值 as number[]) : [...默认设置.金额阈值],
    外环阈值: Array.isArray(视图.外环阈值) ? (视图.外环阈值 as number[]) : [...默认设置.外环阈值],
  }
}

/**
 * 缺省字段的**读放宽**是显式选择：`设置`、`标题`、`创建于`、`更新于` 缺失或类型不对时补
 * 默认值，下次写回会把这些默认落盘。data-model §1 的「必填」约束的是**写入**；读侧若因
 * 一个缺字段就 `BAD_SHAPE`，用户连图都打不开（手写/老文件也无从救）。
 */
function 成文档(树: Record<string, unknown>): 图文件 {
  const 视图 = 投影(树, 图文件形状) as Record<string, unknown>
  return {
    格式: 1,
    标题: typeof 视图.标题 === "string" ? 视图.标题 : "",
    创建于: typeof 视图.创建于 === "string" ? 视图.创建于 : "",
    更新于: typeof 视图.更新于 === "string" ? 视图.更新于 : "",
    设置: 补全设置(视图.设置),
    节点: 视图.节点 as 节点[],
    边: 视图.边 as 边[],
    文字: 视图.文字 as 文字[],
  }
}

const 量词: Readonly<Record<string, string>> = { 节点: "个节点", 边: "条边", 文字: "个文字" }

/**
 * 读只做**版本闸 + 形状闸**：id 文件内唯一、`从`/`到` 指向存在的节点都不在这里判——
 * 那两件在**写入校验**（T005/T006）里判；悬空边读时**不丢弃、不自动修**，由前端画成
 * 灰色虚线（契约 §1）。读侧也不校验开放词表（`类型`）与 `来源.kind`/`性质` 的取值。
 */
export function 解析图(原文: string): 解析结果 {
  let 树: unknown
  try {
    树 = JSON.parse(原文)
  } catch (错误) {
    return {
      ok: false,
      code: "BAD_JSON",
      说明: `这份图打不开：${定位(原文)}附近不是合法 JSON（${消息(错误)}）`,
    }
  }

  if (!是普通对象(树)) {
    return { ok: false, code: "BAD_SHAPE", 说明: `顶层不是对象（读到 ${类型名(树)}）：图文件的根必须是 { … }` }
  }

  const 格式 = 树.格式
  if (typeof 格式 === "number" && 格式 > 1) {
    return {
      ok: false,
      code: "NEWER_VERSION",
      说明: `这份图的格式版本比本程序新（读到 ${格式}），请升级后再打开`,
    }
  }
  if (格式 !== 1) {
    return {
      ok: false,
      code: "BAD_VERSION",
      说明: `这份图的格式版本不认识（读到 ${描述值(格式)}），请升级后再打开`,
    }
  }

  for (const 键 of ["节点", "边", "文字"] as const) {
    if (!Array.isArray(树[键])) {
      return {
        ok: false,
        code: "BAD_SHAPE",
        说明: `\`${键}\` 必须是数组（读到 ${类型名(树[键])}）`,
      }
    }
    const 数组 = 树[键] as unknown[]
    for (let 序 = 0; 序 < 数组.length; 序++) {
      const 元素 = 数组[序]
      // 两种失败分开报：`null`/字符串 不是「缺 id」，是整条不是对象（定位话术要能照做）。
      if (!是普通对象(元素)) {
        return {
          ok: false,
          code: "BAD_SHAPE",
          说明: `第 ${序 + 1} ${量词[键]}不是对象（读到 ${类型名(元素)}）`,
        }
      }
      if (typeof 元素.id !== "string" || 元素.id.trim() === "") {
        return {
          ok: false,
          code: "BAD_SHAPE",
          说明: `第 ${序 + 1} ${量词[键]}缺了 id（id 必须是非空字符串）`,
        }
      }
    }
  }

  return { ok: true, 文档: 成文档(树), 原文树: 树 }
}

/**
 * 序列化：以 `原文树` 为底，只覆盖已知键（未知键原样贴回）。契约 §3：UTF-8 无 BOM、
 * LF、末尾一个换行——字符串本身不带 BOM，换行由 `JSON.stringify` 与末尾 `"\n"` 保证。
 */
export function 序列化图(原文树: unknown, 文档: 图文件): string {
  return JSON.stringify(贴(原文树, 文档, 图文件形状), null, 2) + "\n"
}

export type 校验失败码 =
  | "FACTS_NEED_SOURCE"
  | "INFERENCE_NEEDS_BASIS"
  | "INFERENCE_NEEDS_CONFIDENCE"
  | "BAD_CITATION"
  | "BAD_SHAPE"

export type 校验结果 = { ok: true } | { ok: false; code: 校验失败码; 话术: string }

const 校验话术: Readonly<Record<校验失败码, string>> = {
  FACTS_NEED_SOURCE: "这条标了事实但没给出处：要么补出处，要么改成推断并写明依据",
  INFERENCE_NEEDS_BASIS: "标了推断但没写依据：推断必须写明依据",
  INFERENCE_NEEDS_CONFIDENCE: "推断必须给可信度（高/中/低）",
  BAD_CITATION: "出处要写成 材料#工作表#行号，比如 mat_x#Sheet1#12",
  BAD_SHAPE:
    "字段写法不对：来源必须是 {kind: 实体/关系/推断/手写/事件} 的对象，可信度只能是 高/中/低，出处要是数组，证据要是 {关系, 出处} 的数组",
}

/** 第二参只给「同一个码要分几种拒因」用（T009 的事件闸），缺省走码的通用话术。 */
function 拒(code: 校验失败码, 话术?: string): 校验结果 {
  return { ok: false, code, 话术: 话术 ?? 校验话术[code] }
}

function 非空串(值: unknown): 值 is string {
  return typeof 值 === "string" && 值.trim() !== ""
}

/**
 * 单条出处写法：调全仓唯一的 `解析出处`，不另写正则。
 *
 * 区间裁定：`起 > 末` 才是坏数据；`m#t#12-12` 与单行 `m#t#12` 等价，**接受**——
 * 「区间两端相等」不是非法写法，只看起末是否反向。`解析出处` 对反向区间已返回 `null`，
 * 这里仍显式判一次，把这条裁定与实现放在同一处。
 */
function 出处合法(串: unknown): boolean {
  if (typeof 串 !== "string") return false
  const 解析 = 解析出处(串)
  return 解析 !== null && 解析.起 <= 解析.末
}

/** 缺失 / 不是数组归形状闸管，不归「出处写法」管；是数组就逐项判。 */
function 出处们合法(值: unknown): boolean {
  if (!Array.isArray(值)) return true
  return 值.every(出处合法)
}

/**
 * 形状闸（T004 审查遗留，2026-11-15）：`出处` 必须是数组或缺失；`证据` 必须是对象数组或缺失。
 *
 * 为什么排在图省事的地方：`证据: [null]` 曾经满足「`证据` 是数组且非空」⇒ **绕过**
 * `FACTS_NEED_SOURCE`；`出处: "m#t#1"` 则从旧的 `出处们合法`（非数组一律 `true`）里混过去。
 * 形状是那两条语义闸的**前提**，所以先判形状、再判语义（`BAD_SHAPE` 先于 FACTS/INFERENCE）。
 */
function 出处证据形状合法(出处: unknown, 证据: unknown): boolean {
  if (出处 !== undefined && 出处 !== null && !Array.isArray(出处)) return false
  if (证据 === undefined || 证据 === null) return true
  if (!Array.isArray(证据)) return false
  return 证据.every(是普通对象)
}

/** R-F3 取值闸的枚举（写侧；读侧仍放宽，见 `解析图`）。 */
const 来源类别们 = new Set(["实体", "关系", "推断", "手写", "事件"])
const 可信度取值们 = new Set(["高", "中", "低"])
const 性质取值们 = new Set(["事实", "推断"])
const 方向取值们 = new Set(["有向", "无向"])

/**
 * 取值闸（R-F3，2026-11-16）：形状合法之外，**取值**也要合法。
 *
 * 只在写侧强制（本函数只被写入口调用；`解析图` 读侧保持放宽，坏值不会让文件打不开）。
 * - `来源` 存在时必须是普通对象，且 `kind` ∈ `来源类别们` 之一；
 * - `可信度` 存在且非空时 ∈ {高,中,低}（空串等同缺省：推断仍由 `INFERENCE_NEEDS_CONFIDENCE` 拒）；
 * - `性质` / `方向` 存在时 ∈ 各自两值（纵深防御；`加边`/`改字段` 的枚举校验仍在 `hgraph-edit.ts`）。
 *
 * 判据是「键存在」（`!== undefined`）：`null` 也算存在，不是普通对象 ⇒ BAD_SHAPE。改字段删
 * `来源`/`时间`（节点必填）在更早的必填键闸就被拒，这里的 null 只接盘上坏数据或绕过入口的写入。
 */
function 取值合法(视图: Record<string, unknown>): boolean {
  const 来源 = 视图.来源
  if (来源 !== undefined) {
    if (!是普通对象(来源)) return false
    if (!(typeof 来源.kind === "string" && 来源类别们.has(来源.kind))) return false
  }

  const 可信度 = 视图.可信度
  if (可信度 !== undefined && 可信度 !== null) {
    if (typeof 可信度 !== "string") return false
    if (可信度.trim() !== "" && !可信度取值们.has(可信度)) return false
  }

  if (视图.性质 !== undefined && 视图.性质 !== null) {
    if (!(typeof 视图.性质 === "string" && 性质取值们.has(视图.性质))) return false
  }
  if (视图.方向 !== undefined && 视图.方向 !== null) {
    if (!(typeof 视图.方向 === "string" && 方向取值们.has(视图.方向))) return false
  }
  return true
}

/**
 * `证据` 的元素是 `{ 关系, 出处 }`：`出处` 必须是**单行**（data-model §5.3/§5.6：一条证据
 * 对应一条库关系，出处单串、不做区间）。R9 的判据是「起 !== 末」——`12-12`（区间写法但两端
 * 相等）与单行 `12` 等价，接受；反向区间已由 `解析出处` 返回 `null`。
 */
function 证据出处们合法(值: unknown): boolean {
  if (!Array.isArray(值)) return true
  return 值.every((证据) => {
    if (!是普通对象(证据)) return false
    if (typeof 证据.出处 !== "string") return false
    const 解析 = 解析出处(证据.出处)
    return 解析 !== null && 解析.起 === 解析.末
  })
}

/**
 * 写入前的来源硬闸（contracts/hgraph-format §2 / data-model §6 V-04、V-05、V-06、V-09）：
 * **全仓唯一实现**，HTTP 手工、AI 工具、检查器改性质三条入口都只调它，不各写一份。
 *
 * 检查顺序，**首个不通过即返回**：`BAD_SHAPE`（`出处`/`证据` 的形状，随后是 R-F3 的取值，
 * 最后是「事件」的两道绑定闸）→ `FACTS_NEED_SOURCE` → `INFERENCE_NEEDS_BASIS`
 * → `INFERENCE_NEEDS_CONFIDENCE` → `BAD_CITATION`。
 * 形状排最前：它是后两条语义闸的前提（`证据: [null]` 否则能绕过事实闸）。
 * 推断的判据有两处入口、同一组码：`来源.kind = 推断` 与边 `性质 = 推断`（R56：`改字段`
 * 只改性质时不能绕过）。节点、边、文字都能传（`文字` 没有来源字段，天然通过）。
 *
 * 只判「来源相关」：缺必填字段、id 唯一、悬空边、批量上限、路径都不在这里管（T005/T006）。
 * 什么都不写的空闲对象 ⇒ 通过——本函数不替必填校验兜底。
 */
export function 校验来源(对象: unknown): 校验结果 {
  const 视图 = 是普通对象(对象) ? 对象 : {}
  const 出处 = 视图.出处
  const 证据 = 视图.证据

  if (!出处证据形状合法(出处, 证据)) return 拒("BAD_SHAPE")
  // R-F3：形状之后、语义闸之前判取值（枚举）——形状是取值的前提，语义闸再压在合法取值上。
  if (!取值合法(视图)) return 拒("BAD_SHAPE")

  const 来源视图 = 是普通对象(视图.来源) ? 视图.来源 : {}
  // 014 事件来源两道闸（contracts/hgraph-format §2 / FR-017、FR-023）：绑定事件既要有库事件
  // id（`来源.实体` 复用「所绑库对象 id」槽位 = `case_event.id`，不许存半绑定态），也要有非空
  // `出处`（无法回指库里原始记录的事件不能上图）。两道都 fail-closed，且**只认 kind = "事件"**
  // ——手写事件（kind = "手写"）不要求出处；都不要求 `依据`（那是推断的闸）。
  // 排在事实/推断闸之前：它们是「这块来源自身是否成形」的前提，先于任何依赖来源的语义判定。
  if (来源视图.kind === "事件") {
    if (!非空串(来源视图.实体)) return 拒("BAD_SHAPE", "事件必须绑定库事件 id")
    if (!(Array.isArray(出处) && 出处.length > 0)) return 拒("BAD_SHAPE", "这条事件没有出处，不能上图")
    // FR-037 / contracts hgraph-format §2.2：事件必须有时间。`时间` 缺键归写盘前的
    // `必填字段` 闸（话术点名字段名，别在这里抢）；本闸只拦「形状在、首末都空」的半成品
    // ——此前 `{首:"",末:""}` 能一路落盘，回读后事件卡没有时间。只填一端算有时间（单点事件）。
    const 时间 = 视图.时间
    if (是普通对象(时间) && !非空串(时间.首) && !非空串(时间.末)) return 拒("BAD_SHAPE", "事件必须填时间")
  }

  // 只对边生效：节点没有 `性质` 字段；`事实` 的硬闸只压在标了事实的边上（V-04）。
  if (视图.性质 === "事实" && !(Array.isArray(出处) && 出处.length > 0) && !(Array.isArray(证据) && 证据.length > 0)) {
    return 拒("FACTS_NEED_SOURCE")
  }

  // 推断的判据对节点与边一致（data-model §5.1 / V-05、V-06）。`可信度` 的枚举值归上面的取值闸。
  if (来源视图.kind === "推断") {
    if (!非空串(来源视图.依据)) return 拒("INFERENCE_NEEDS_BASIS")
    if (!非空串(视图.可信度)) return 拒("INFERENCE_NEEDS_CONFIDENCE")
  }

  // R56：边 `性质 = 推断` 本身就是判据（data-model §5.1 / V-05、V-06；contracts/mcp-tools §4）。
  // `改字段` 把性质改成推断时**不动 `来源.kind`**，只判 kind 会让模型从这条路绕过去。
  // 节点没有 `性质` 字段，所以这里天然只对边生效；依据仍读 `来源.依据`（与上一分支同出处）。
  if (视图.性质 === "推断") {
    if (!非空串(来源视图.依据)) return 拒("INFERENCE_NEEDS_BASIS")
    if (!非空串(视图.可信度)) return 拒("INFERENCE_NEEDS_CONFIDENCE")
  }

  if (!出处们合法(出处) || !证据出处们合法(证据)) return 拒("BAD_CITATION")
  return { ok: true }
}

/** 读保留属性键（`金额` / `时长`）；空串按缺失处理，不把空值拼进文案。 */
function 属性值(点: 节点, 键: string): string | undefined {
  const 值 = (点.属性 ?? []).find((行) => 行.键 === 键)?.值
  return 非空串(值) ? 值 : undefined
}

/**
 * FR-037 / contracts hgraph-format §2.3：事件节点名称为空时，落盘前兜底成
 * `<类型> · <金额|时长> · <时间>`，**不编造**——只拼真实存在的字段：
 *
 * - 金额优先，其次时长（都读保留属性键，空串按缺失）；
 * - 两者都没有时只出 `类型 · 时间`（不拿时间重复填第二个槽）；
 * - 时间取 `首`，缺失再取 `末`（单点事件）；
 * - 三段都为空的极端情况返回空串——不替用户发明名字，交给上层/界面继续提示。
 */
export function 事件兜底名称(点: 节点): string {
  const 量 = 属性值(点, "金额") ?? 属性值(点, "时长")
  const 时间 = 非空串(点.时间?.首) ? 点.时间.首 : 非空串(点.时间?.末) ? 点.时间.末 : undefined
  return [点.类型, 量, 时间].filter((段): 段 is string => 非空串(段)).join(" · ")
}

/**
 * 写入时的**必填字段集**（data-model §3、§4.1、§4.2）——**只此一份**。
 *
 * 与 `hgraph-edit.ts` 的 `必填键` **不是**同一件事：那边管「`改字段` 的 `null` 补丁不许删这些
 * 键」，所以不含 `id`；这边管「一个刚落盘的对象必须带哪些键」，所以含 `id`。两个概念各自一份
 * 白名单，刻意不强行合并（合并会让其中一边多出一个它不关心的 `id` 语义）。
 */
export const 必填字段: Readonly<Record<"节点" | "边" | "文字", readonly string[]>> = Object.freeze({
  节点: Object.freeze(["id", "名称", "类型", "来源", "x", "y", "时间"]),
  边: Object.freeze(["id", "从", "到", "标签", "性质", "方向", "来源", "时间"]),
  文字: Object.freeze(["id", "内容", "x", "y", "字号"]),
})

/** `init` 用的空骨架（contracts/hgraph-ops §4）：`创建于` 与 `更新于` 都写 `now`。 */
export function 空骨架(标题: string, now: string): 图文件 {
  return {
    格式: 1,
    标题,
    创建于: now,
    更新于: now,
    设置: 补全设置(undefined),
    节点: [],
    边: [],
    文字: [],
  }
}
