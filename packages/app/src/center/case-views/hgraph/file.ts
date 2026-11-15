/**
 * `.hgraph` 的前端解析与序列化（012 data-model §1–§5）。
 *
 * **镜像后端**（`packages/opencode/src/server/openhive/hgraph-file.ts` 的 `解析图` /
 * `序列化图`）：同一份文件在前端和后端必须得到同一类结论。读只做**版本闸 + 形状闸**
 * ——语义校验（来源硬闸、悬空边、必填字段）归写入口，前端不重判；否则「后端能存、
 * 前端打不开」这类分叉迟早出现。
 *
 * ## 未知键怎么保真（data-model §1）
 *
 * `文档` 只是 `原文树` 的**已知键投影**；序列化时以 `原文树` 为底、按已知键覆盖，
 * 没见过的键（顶层或嵌套对象里）原样留在输出里。禁止「解析成类型化对象再整体序列化」
 * ——那样必丢字段。数组按身份键配对（节点/边/文字按 `id`，属性按 `键`，证据按 `关系`），
 * 所以重排、增删都不会把未知键贴到别的对象上。
 *
 * 已知键为 `undefined` **或 `null`** ⇒ 视为删除该键（与后端契约 §3.1 一致）。
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
  kind: "实体" | "关系" | "推断" | "手写"
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
  | { readonly ok: true; readonly 文档: 图文件; readonly 原文树: unknown }
  | { readonly ok: false; readonly code: 解析失败码; readonly 说明: string }

/** data-model §2 的默认值（阈值只影响渲染档位）。 */
const 默认设置: 设置 = {
  线宽度量: "按类型默认",
  次数阈值: [1, 2, 5, 10, 50],
  金额阈值: [10000, 50000, 200000, 1000000],
  外环阈值: [1, 2, 4, 8],
}

// ---------------------------------------------------------------------------
// 已知键表：`data-model.md` §1–§5 是唯一来源。
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
    // `补丁[键] = null` 表示删该键（契约 §3.1）；缺键与 `null` 同义——绝不能写进文件。
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

function 类型名(值: unknown): string {
  if (值 === undefined) return "缺失"
  if (值 === null) return "null"
  if (Array.isArray(值)) return "数组"
  return typeof 值 === "object" ? "对象" : typeof 值
}

function 取线宽度量(值: unknown): 设置["线宽度量"] | undefined {
  return 值 === "按类型默认" || 值 === "按金额" || 值 === "按次数" ? 值 : undefined
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
 * 缺省字段的**读放宽**与后端一致：`设置`、`标题`、`创建于`、`更新于` 缺失或类型不对时补
 * 默认值。data-model §1 的「必填」约束的是**写入**；读侧因一个缺字段就 `BAD_SHAPE`，用户
 * 连图都打不开。
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

export function 解析图(原文: string): 解析结果 {
  let 树: unknown
  try {
    树 = JSON.parse(原文)
  } catch (错误) {
    return {
      ok: false,
      code: "BAD_JSON",
      说明: `这份图打不开：不是合法 JSON（${消息(错误)}）`,
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
      return { ok: false, code: "BAD_SHAPE", 说明: `\`${键}\` 必须是数组（读到 ${类型名(树[键])}）` }
    }
    const 数组 = 树[键] as unknown[]
    for (let 序 = 0; 序 < 数组.length; 序++) {
      const 元素 = 数组[序]
      if (!是普通对象(元素)) {
        return {
          ok: false,
          code: "BAD_SHAPE",
          说明: `第 ${序 + 1} ${量词[键]}不是对象（读到 ${类型名(元素)}）`,
        }
      }
      if (typeof 元素.id !== "string" || 元素.id.trim() === "") {
        return { ok: false, code: "BAD_SHAPE", 说明: `第 ${序 + 1} ${量词[键]}缺了 id（id 必须是非空字符串）` }
      }
    }
  }

  return { ok: true, 文档: 成文档(树), 原文树: 树 }
}

/**
 * 序列化：以 `原文树` 为底，只覆盖已知键（未知键原样贴回）。UTF-8 无 BOM、LF、末尾一个换行
 * ——字符串本身不带 BOM，换行由 `JSON.stringify` 与末尾 `"\n"` 保证。
 */
export function 序列化图(原文树: unknown, 文档: 图文件): string {
  return JSON.stringify(贴(原文树, 文档, 图文件形状), null, 2) + "\n"
}
