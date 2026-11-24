/**
 * `.hgraph` 导出（012 · T015）。
 *
 * ## 为什么用「隐藏只读渲染」，而不是序列化实时画布（R64）
 *
 * 实时画布带选中描边、框选、连线预览、改名输入框；逐属性擦洗等于在导出模块里重抄一份
 * `canvas.tsx` 的样式（同一前提两处写，`#002-06`）。这里在离屏容器里用 `render()` 挂一份
 * **只读、选中为空、可见集不传、动作全空**的 `画布`，再序列化它的 `<svg>`——结构上不可能
 * 带出交互态，也没有第二套渲染器。导出完立刻 `dispose()` 并移除容器（`#005-03`）。
 *
 * ## 主题色与字体必须内联（R65）
 *
 * 画布里的颜色写的是 `var(--v2-…)`；脱离页面的 SVG 解析不了这些变量，导出会是黑块/空心。
 * 序列化后把每个 `var(--x)` 换成 `getComputedStyle(document.documentElement)` 的解析值
 * （测试注入固定表）。**解析不到的变量保留原样并记进 `缺口`**，由真栈验收（T019）看现场。
 * `font-family` 内联到 `<svg>` 根上。中文字体是否掉字，happy-dom 验不了——只进缺口表。
 *
 * ## 尺寸与取景（2026-11-24 修复）
 *
 * 三档纸张：屏幕 1520×1360、A4 2480×3508、A3 3508×4961（竖版基准，300 DPI）。
 * A4/A3 **按内容宽高比自动换横竖**：宽图出横版（如 A3 4961×3508），其余竖版。
 *
 * 取景框是**内容包围盒**，不是固定的逻辑画布 760×680。旧实现拿 760×680 当取景框，
 * 节点被拖到窗口外就整块裁掉（2026-11-24 现场：22 个节点里 6 个 x>760、9 个 y>680，
 * 导出图右侧与底部缺人）；而且缩放基准也错，图既铺不满也不居中。现在按节点/文字/标签的
 * 真实范围算盒，等比装进纸张、居中；纸张四周留 **2cm 页边距**（300 DPI ⇒ 236px，用户裁定），
 * 图例并进内容组跟着同一个缩放走（旧实现钉在页面 (12,48)，A3 上小到不可读）。
 * 空图没有可量的内容 ⇒ 退回旧的 760×680 取景，行为不变。
 *
 * ## 顺序固定（R67）
 *
 * `许可` → `渲染` → `光栅化` → `下载`；许可失败即停，零渲染零下载，话术直接用接口 message。
 * 文件名以许可返回为准，同页会话内由 `去重文件名` 追加 `-2` / `-3`。
 *
 * ## 光栅化可注入
 *
 * happy-dom 没有 canvas / Image（`happydom.ts` 只 mock 了 `getContext` 的一部分），故
 * `光栅化?(svg, 宽, 高)` 是依赖缝。纯逻辑（SVG 串、尺寸、文件名、附录、排序）全部可单测。
 */
import { createComponent } from "solid-js"
import { render } from "solid-js/web"
import type { 结果 } from "@/project/entity-api"
import { 画布, type 画布动作 } from "./canvas"
import { 是事件节点, type 边, type 图文件, type 节点, type 来源 } from "./file"
import { 截断标签 } from "./geometry"
import { 图例高, 图例宽 } from "./legend"
import { 文字盒 } from "./text-fold"

const SVGNS = "http://www.w3.org/2000/svg"

/** 三档输出尺寸（设计 §8 / research R10；A4 于 2026-11-24 加入）。竖版是基准，横版在组装时由 `出纸尺寸` 换算。 */
export const 尺寸表 = {
  屏幕: { 宽: 1520, 高: 1360 },
  A4: { 宽: 2480, 高: 3508 },
  A3: { 宽: 3508, 高: 4961 },
} as const

export type 导出尺寸 = keyof typeof 尺寸表

/** 纸张四周页边距：2cm @300 DPI（2 ÷ 2.54 × 300 ≈ 236.2，取 236）。用户 2026-11-24 裁定。 */
export const 纸张页边距 = 236
/** 屏幕档不是纸，只留一圈小边距。 */
const 屏幕边距 = 24
/** 内容坐标里的额外留量：边标签、角标、线宽外沿（节点本体按外沿另计）。 */
const 内容留白 = 24
/** 节点外沿：外环 r18 + 最粗描边 4/2。 */
const 节点外沿 = 20
/** 事件卡 96×34（canvas.tsx 同一组常量；导出只用来算包围盒）。 */
const 事件卡半宽 = 48
const 事件卡半高 = 17
/** 节点标签：基线 y=32、12px 字，下沿留到 36。 */
const 标签下沿 = 36

export interface 导出选项 {
  readonly 尺寸: 导出尺寸
  readonly 标题块: boolean
  readonly 附附录: boolean
}

/** 默认选项（工具栏面板首次打开；文件树右键直接用这一份）。 */
export const 默认导出选项: 导出选项 = { 尺寸: "屏幕", 标题块: false, 附附录: false }

export type 光栅化 = (svg: string, 宽: number, 高: number) => Promise<Blob>
export type 下载 = (文件名: string, blob: Blob) => void

export interface 导出依赖 {
  /** 主题 CSS 变量解析；返回空串/undefined = 解析不到（保留原样并记缺口）。 */
  readonly 解析变量?: (名: string) => string | undefined
  /** 内联到 `<svg>` 根的字体栈。 */
  readonly 根字体?: () => string
  readonly 光栅化?: 光栅化
  readonly 下载?: 下载
  /** 导出时间（标题块）；测试注入固定时刻。 */
  readonly 现在?: () => Date
}

export interface 导出输入 {
  readonly 文档: 图文件
  readonly 选项: 导出选项
  readonly 项目名: string
  readonly 导出人?: string
  /**
   * 先取许可。调用方绑定 `HgraphApi.导出许可({ projectId, path })`——
   * 服务端校验成员并留痕，前端拿到文件名后才出图（R67 / 契约 hgraph-ops §6）。
   */
  readonly 许可: () => Promise<结果<{ readonly 允许: true; readonly 文件名: string }>>
  readonly 依赖?: 导出依赖
}

export type 导出结果 =
  | {
      readonly kind: "ok"
      readonly png: Blob
      readonly 附录?: Blob
      readonly 文件名: string
      /** 解析不到、原样保留在 SVG 串里的主题变量名（去重、按出现序）。 */
      readonly 缺口: readonly string[]
    }
  | { readonly kind: "error"; readonly message: string }

// ---------------------------------------------------------------------------
// 文件名
// ---------------------------------------------------------------------------

/** 同页会话内已经用过的文件名（`导出PNG` 成功后记账；`重置导出记录` 只给用例用）。 */
const 已用文件名 = new Set<string>()

/** 只给用例：清空会话内的文件名记录，让 `-2` / `-3` 从干净状态开始。 */
export function 重置导出记录() {
  已用文件名.clear()
}

/**
 * 同名不覆盖：`a.png` 在 `已用` 里 ⇒ `a-2.png`，再撞 ⇒ `a-3.png`。
 * 序数插在**最后一个扩展名之前**（`a.png` 不是 `a.png-2`）。
 */
export function 去重文件名(候选: string, 已用: ReadonlySet<string>): string {
  if (!已用.has(候选)) return 候选
  const 点 = 候选.lastIndexOf(".")
  const 基 = 点 > 0 ? 候选.slice(0, 点) : 候选
  const 扩 = 点 > 0 ? 候选.slice(点) : ""
  let 序 = 2
  while (已用.has(`${基}-${序}${扩}`)) 序 += 1
  return `${基}-${序}${扩}`
}

/** 记一次导出：返回真正要下载的名字（已去重）并加入会话记录。 */
function 记录导出名(候选: string): string {
  const 名 = 去重文件名(候选, 已用文件名)
  已用文件名.add(名)
  return 名
}

// ---------------------------------------------------------------------------
// 附录（同名 .md，纯函数）
// ---------------------------------------------------------------------------

type 有序行 = { readonly id: string; readonly 出现序?: number }

/** 出现序升序，空值排最后，同序按 id 升序（与 T011 `演示步进` 同口径）。 */
function 排序<T extends 有序行>(行们: readonly T[]): T[] {
  return [...行们].sort((甲, 乙) => {
    const 甲序 = typeof 甲.出现序 === "number" && Number.isFinite(甲.出现序) ? 甲.出现序 : Number.POSITIVE_INFINITY
    const 乙序 = typeof 乙.出现序 === "number" && Number.isFinite(乙.出现序) ? 乙.出现序 : Number.POSITIVE_INFINITY
    if (甲序 < 乙序) return -1
    if (甲序 > 乙序) return 1
    return 甲.id < 乙.id ? -1 : 甲.id > 乙.id ? 1 : 0
  })
}

/** Markdown 表格单元格：竖线转义、换行压成空格（`不编`：空值就留空）。 */
function 格(值: string): string {
  return 值.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function 行(列: readonly string[]): string {
  return `| ${列.map(格).join(" | ")} |`
}

function 分隔(列数: number): string {
  return `| ${Array.from({ length: 列数 }, () => "---").join(" | ")} |`
}

function 列表(值: readonly string[] | undefined): string {
  return 值 === undefined || 值.length === 0 ? "—" : 值.join("；")
}

function 来源文本(来源: 来源 | undefined): string {
  if (来源 === undefined) return "—"
  const 值 = 来源.值 ?? 来源.实体
  return 值 === undefined || 值 === "" ? 来源.kind : `${来源.kind} ${值}`
}

function 证据文本(行: 边): string {
  if (行.证据 !== undefined && 行.证据.length > 0) {
    return 行.证据.map((条) => `${条.关系} ${条.出处}`).join("；")
  }
  return 列表(行.出处)
}

function 金额文本(行: 边): string {
  return 行.金额 === undefined ? "—" : `${行.金额.值} ${行.金额.单位}`
}

/**
 * 证据附录（设计 §8.2：同名 `.md`，不是第二张图）。
 *
 * 节点表：id / 名称 / 类型 / 来源 / 出处；边表：从 / 到 / 标签 / 性质 / 方向 / 次数 /
 * 金额 / 证据。两张表都按 `出现序` 排（空值最后、同序按 id）。证据列 = 「关系 + 空格 +
 * 出处」逐条；没有证据时退回 `出处` 数组；两者都空写 `—`（不编）。
 */
export function 附录Markdown(文档: 图文件): string {
  const 标题 = 文档.标题.trim() === "" ? "关系图" : 文档.标题.trim()
  const 节点们 = 排序(文档.节点)
  const 边们 = 排序(文档.边)
  return [
    `# 证据附录 · ${标题}`,
    "",
    "## 节点",
    "",
    行(["id", "名称", "类型", "来源", "出处"]),
    分隔(5),
    ...节点们.map((点: 节点) =>
      行([点.id, 点.名称 ?? "", 点.类型 ?? "", 来源文本(点.来源), 列表(点.出处)]),
    ),
    "",
    "## 边",
    "",
    行(["从", "到", "标签", "性质", "方向", "次数", "金额", "证据"]),
    分隔(8),
    ...边们.map((边行: 边) =>
      行([
        边行.从,
        边行.到,
        边行.标签 ?? "",
        边行.性质,
        边行.方向,
        边行.次数 === undefined ? "—" : String(边行.次数),
        金额文本(边行),
        证据文本(边行),
      ]),
    ),
    "",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// 主题变量与字体
// ---------------------------------------------------------------------------

function 默认解析变量(名: string): string | undefined {
  if (typeof document === "undefined") return undefined
  const 值 = getComputedStyle(document.documentElement).getPropertyValue(名).trim()
  return 值 === "" ? undefined : 值
}

function 默认根字体(): string {
  if (typeof document === "undefined") return ""
  return getComputedStyle(document.documentElement).fontFamily
}

/** 把 `var(--x)` 换成解析值；解析不到的原样保留并去重记缺口。 */
export function 替换主题变量(
  原文: string,
  解析变量: (名: string) => string | undefined,
): { readonly 串: string; readonly 缺口: readonly string[] } {
  const 缺口: string[] = []
  const 见过 = new Set<string>()
  const 串 = 原文.replace(/var\((--[A-Za-z0-9_-]+)\)/g, (原样, 名: string) => {
    const 值 = 解析变量(名)
    if (值 === undefined || 值.trim() === "") {
      if (!见过.has(名)) {
        见过.add(名)
        缺口.push(名)
      }
      return 原样
    }
    return 值.trim()
  })
  return { 串, 缺口 }
}

// ---------------------------------------------------------------------------
// SVG 组装
// ---------------------------------------------------------------------------

function 时间文本(时: Date): string {
  const 补 = (值: number) => String(值).padStart(2, "0")
  return `${时.getFullYear()}-${补(时.getMonth() + 1)}-${补(时.getDate())} ${补(时.getHours())}:${补(时.getMinutes())}`
}

function 建元素(名: string): SVGElement {
  return document.createElementNS(SVGNS, 名)
}

/** 读原画布 viewBox 的宽高（760×680）；缺省按画布常量的既有值兜底。 */
function 原尺寸(svg: SVGSVGElement): { readonly 宽: number; readonly 高: number } {
  const 段 = (svg.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number)
  const 宽 = Number.isFinite(段[2]) && 段[2] > 0 ? 段[2] : 760
  const 高 = Number.isFinite(段[3]) && 段[3] > 0 ? 段[3] : 680
  return { 宽, 高 }
}

/** 内容坐标里的轴对齐包围盒。 */
interface 盒 {
  readonly 最小x: number
  readonly 最小y: number
  readonly 最大x: number
  readonly 最大y: number
}

const 盒宽 = (盒: 盒) => 盒.最大x - 盒.最小x
const 盒高 = (盒: 盒) => 盒.最大y - 盒.最小y

function 并(甲: 盒, 乙: 盒): 盒 {
  return {
    最小x: Math.min(甲.最小x, 乙.最小x),
    最小y: Math.min(甲.最小y, 乙.最小y),
    最大x: Math.max(甲.最大x, 乙.最大x),
    最大y: Math.max(甲.最大y, 乙.最大y),
  }
}

/**
 * 内容包围盒（内容坐标）。空图 ⇒ `undefined`（走旧的 760×680 取景）。
 *
 * 覆盖：节点外沿、事件卡、节点标签（12px、≤12 字，宽按画布同一份 `截断标签` 估）、
 * 自由文字（`文字盒`），最后外扩 `内容留白` 盖住边标签与线宽外沿。
 */
function 内容盒(文档: 图文件): 盒 | undefined {
  let 最小x = Number.POSITIVE_INFINITY
  let 最小y = Number.POSITIVE_INFINITY
  let 最大x = Number.NEGATIVE_INFINITY
  let 最大y = Number.NEGATIVE_INFINITY
  let 有 = false
  const 纳 = (左: number, 上: number, 右: number, 下: number) => {
    if (![左, 上, 右, 下].every(Number.isFinite)) return
    有 = true
    最小x = Math.min(最小x, 左)
    最小y = Math.min(最小y, 上)
    最大x = Math.max(最大x, 右)
    最大y = Math.max(最大y, 下)
  }

  for (const 点 of 文档.节点) {
    const 事件 = 是事件节点(点)
    const 标半 = (Array.from(截断标签(点.名称 ?? "")).length * 12) / 2
    const 半宽 = Math.max(事件 ? 事件卡半宽 : 节点外沿, 标半)
    const 半高 = 事件 ? 事件卡半高 : 节点外沿
    纳(点.x - 半宽, 点.y - 半高, 点.x + 半宽, 点.y + 标签下沿)
  }
  for (const 行 of 文档.文字 ?? []) {
    const 盒 = 文字盒({
      ...行,
      x: Number.isFinite(行.x) ? 行.x : 0,
      y: Number.isFinite(行.y) ? 行.y : 0,
    })
    纳(盒.x, 盒.y, 盒.x + 盒.width, 盒.y + 盒.height)
  }
  if (!有) return undefined
  return { 最小x: 最小x - 内容留白, 最小y: 最小y - 内容留白, 最大x: 最大x + 内容留白, 最大y: 最大y + 内容留白 }
}

/**
 * 实际出纸尺寸：A4/A3 按**内容宽高比**自动换横竖（内容更宽 ⇒ 横版），屏幕档固定。
 * 空图没有方向依据 ⇒ 竖版。
 */
function 出纸尺寸(尺寸: 导出尺寸, 内容: 盒 | undefined): { readonly 宽: number; readonly 高: number } {
  const 纸 = 尺寸表[尺寸]
  if (尺寸 === "屏幕" || 内容 === undefined) return 纸
  return 盒宽(内容) > 盒高(内容) ? { 宽: 纸.高, 高: 纸.宽 } : 纸
}

/**
 * 把盒子等比装进纸张（扣掉页边距）并居中。允许放大——画布「适配」那条 ≤1 的上限
 * 是屏幕语义，导出要铺满纸张，不适用。2cm 是**最小**边距；宽高比不符时另一侧会多于 2cm。
 */
function 出图变换(盒: 盒, 纸: { readonly 宽: number; readonly 高: number }, 边距: number) {
  const 可用宽 = Math.max(1, 纸.宽 - 2 * 边距)
  const 可用高 = Math.max(1, 纸.高 - 2 * 边距)
  const 缩放 = Math.min(可用宽 / Math.max(1, 盒宽(盒)), 可用高 / Math.max(1, 盒高(盒)))
  return {
    缩放,
    x: 边距 + (可用宽 - 盒宽(盒) * 缩放) / 2 - 盒.最小x * 缩放,
    y: 边距 + (可用高 - 盒高(盒) * 缩放) / 2 - 盒.最小y * 缩放,
  }
}

/** 变换数字落成属性串：保留 3 位小数，避免浮点尾巴进 SVG。 */
const 数 = (值: number) => String(Math.round(值 * 1000) / 1000)

/**
 * 在离屏 `<svg>` 上组装导出画面：目标尺寸、白底、等比内容、可选标题块。
 * 返回序列化后的串与未解析主题变量（替换在最后一步做）。
 */
function 组装SVG(
  svg: SVGSVGElement,
  文档: 图文件,
  选项: 导出选项,
  项目名: string,
  导出人: string | undefined,
  现在: Date,
  解析变量: (名: string) => string | undefined,
  根字体: string,
): { readonly 串: string; readonly 缺口: readonly string[]; readonly 宽: number; readonly 高: number } {
  const 原 = 原尺寸(svg)
  const 内容 = 内容盒(文档)
  const { 宽, 高 } = 出纸尺寸(选项.尺寸, 内容)

  svg.setAttribute("width", String(宽))
  svg.setAttribute("height", String(高))
  svg.setAttribute("viewBox", `0 0 ${宽} ${高}`)
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet")
  if (根字体.trim() !== "") svg.setAttribute("font-family", 根字体)

  // 白底：显式插在 viewport 之前（设计 §8 / R64），A3 的留白也是白的。
  const 白底 = 建元素("rect")
  白底.setAttribute("data-slot", "hgraph-export-background")
  白底.setAttribute("x", "0")
  白底.setAttribute("y", "0")
  白底.setAttribute("width", String(宽))
  白底.setAttribute("height", String(高))
  白底.setAttribute("fill", "#ffffff")
  svg.insertBefore(白底, svg.firstChild)

  // 内容按包围盒等比铺进纸张（空图退回 760×680 窗口），图例并进同一个组一起缩放。
  const 视口 = svg.querySelector<SVGGElement>('[data-slot="hgraph-viewport"]')
  if (视口 !== null) {
    const 图例 = svg.querySelector<SVGGElement>('[data-slot="hgraph-legend"]')
    let 变换: { readonly 缩放: number; readonly x: number; readonly y: number }
    let 图例位: { readonly x: number; readonly y: number } | undefined
    if (内容 !== undefined) {
      // 图例放在内容左上角上方（与屏幕观感一致），占位计入包围盒，跟着同一个缩放走。
      const 图例盒: 盒 = {
        最小x: 内容.最小x,
        最小y: 内容.最小y - 12 - 图例高,
        最大x: 内容.最小x + 图例宽,
        最大y: 内容.最小y - 12,
      }
      变换 = 出图变换(并(内容, 图例盒), { 宽, 高 }, 选项.尺寸 === "屏幕" ? 屏幕边距 : 纸张页边距)
      图例位 = { x: 图例盒.最小x, y: 图例盒.最小y }
    } else {
      const 比 = Math.min(宽 / 原.宽, 高 / 原.高)
      变换 = { 缩放: 比, x: (宽 - 原.宽 * 比) / 2, y: (高 - 原.高 * 比) / 2 }
    }
    const 外 = 建元素("g")
    外.setAttribute("data-slot", "hgraph-export-content")
    外.setAttribute(
      "transform",
      `translate(${数(变换.x)} ${数(变换.y)}) scale(${数(变换.缩放)})`,
    )
    视口.replaceWith(外)
    外.appendChild(视口)
    if (图例 !== null && 图例位 !== undefined) {
      图例.setAttribute("transform", `translate(${数(图例位.x)} ${数(图例位.y)})`)
      外.appendChild(图例)
    }
  }

  // 标题块（可选、默认关）：一排文字，画在顶部新增的条带上；不进文档、不写盘。
  if (选项.标题块) {
    const 字号 = Math.max(16, Math.min(32, Math.round(宽 / 80)))
    const 条高 = Math.round(字号 * 2.2)
    const 组 = 建元素("g")
    组.setAttribute("data-slot", "hgraph-export-title")

    const 带 = 建元素("rect")
    带.setAttribute("x", "0")
    带.setAttribute("y", "0")
    带.setAttribute("width", String(宽))
    带.setAttribute("height", String(条高))
    带.setAttribute("fill", "#ffffff")
    带.setAttribute("opacity", "0.92")
    组.appendChild(带)

    const 文 = 建元素("text")
    文.setAttribute("x", String(字号))
    文.setAttribute("y", String(Math.round(字号 * 1.5)))
    文.setAttribute("font-size", String(字号))
    文.setAttribute("fill", "#111111")
    文.textContent = [
      项目名.trim() === "" ? "—" : 项目名.trim(),
      文档.标题.trim() === "" ? "关系图" : 文档.标题.trim(),
      时间文本(现在),
      导出人 === undefined || 导出人.trim() === "" ? "—" : 导出人.trim(),
    ].join(" · ")
    组.appendChild(文)
    svg.appendChild(组)
  }

  const 序列化 = new XMLSerializer().serializeToString(svg)
  return { ...替换主题变量(序列化, 解析变量), 宽, 高 }
}

// ---------------------------------------------------------------------------
// 默认光栅化 / 下载
// ---------------------------------------------------------------------------

/**
 * SVG 串 → `Blob` → `Image` → `<canvas>.drawImage` → `toBlob("image/png")`。
 * 真实浏览器路径；happy-dom 没有 canvas/Image，用例一律注入 `光栅化`。
 */
async function 默认光栅化(svg: string, 宽: number, 高: number): Promise<Blob> {
  const 源 = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(源)
  try {
    const 图 = new Image()
    await new Promise<void>((解, 拒) => {
      图.onload = () => 解()
      图.onerror = () => 拒(new Error("图片渲染失败"))
      图.src = url
    })
    const 画布 = document.createElement("canvas")
    画布.width = 宽
    画布.height = 高
    const 上下文 = 画布.getContext("2d")
    if (上下文 === null) throw new Error("浏览器不支持 canvas")
    上下文.drawImage(图, 0, 0, 宽, 高)
    const png = await new Promise<Blob | null>((解) => 画布.toBlob(解, "image/png"))
    if (png === null) throw new Error("生成 PNG 失败")
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

function 默认下载(文件名: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const 链 = document.createElement("a")
  链.href = url
  链.download = 文件名
  document.body.appendChild(链)
  链.click()
  document.body.removeChild(链)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// 导出主流程
// ---------------------------------------------------------------------------

/** 隐藏渲染用的空动作表：只读画布不会调用任何一条，存在只为满足 props 形状。 */
const 空动作: 画布动作 = {
  选择: () => {},
  移动: () => {},
  加边: () => {},
  加文字: () => {},
  改字段: () => {},
  删对象: () => {},
  撤销: () => {},
  重做: () => {},
  切换模式: () => {},
  加节点: () => {},
  删除所选: () => {},
  重命名: () => {},
  锁定切换: () => {},
  对齐: () => {},
  等距: () => {},
  自动布局: () => {},
  演示切换: () => {},
}

function 消息(错误: unknown): string {
  return 错误 instanceof Error ? 错误.message : String(错误)
}

/**
 * 在离屏容器里只读渲染一份文档并组装 SVG。返回串与缺口；容器/渲染根在 `finally` 里清掉。
 */
function 渲染SVG(
  文档: 图文件,
  选项: 导出选项,
  项目名: string,
  导出人: string | undefined,
  现在: Date,
  解析变量: (名: string) => string | undefined,
  根字体: string,
): { readonly 串: string; readonly 缺口: readonly string[]; readonly 宽: number; readonly 高: number } {
  const 容器 = document.createElement("div")
  容器.setAttribute("data-slot", "hgraph-export-offscreen")
  容器.setAttribute("aria-hidden", "true")
  容器.style.position = "fixed"
  容器.style.left = "-100000px"
  容器.style.top = "0"
  容器.style.width = "760px"
  容器.style.height = "680px"
  容器.style.pointerEvents = "none"
  document.body.appendChild(容器)

  let 释放: (() => void) | undefined
  try {
    释放 = render(
      () =>
        createComponent(画布, {
          文档,
          选中: [],
          模式: "指针",
          动作: 空动作,
          只读: true,
        }),
      容器,
    )
    const svg = 容器.querySelector<SVGSVGElement>('[data-slot="hgraph-svg"]')
    if (svg === null) throw new Error("导出渲染没有产出画布")
    return 组装SVG(svg, 文档, 选项, 项目名, 导出人, 现在, 解析变量, 根字体)
  } finally {
    释放?.()
    容器.remove()
  }
}

/**
 * 导出 PNG（可选同名 `.md` 附录）。顺序固定：许可 → 渲染 → 光栅化 → 下载（R67）。
 *
 * 与 tasks.md 签名的**有意差异**：不接收实时 `画布` 元素——改为内部隐藏只读渲染（R64）；
 * 多一个 `许可` 入参，用来把「先许可后出图」变成结构上不可绕过的一步。
 */
export async function 导出PNG(输入: 导出输入): Promise<导出结果> {
  const 依赖 = 输入.依赖 ?? {}

  // ① 许可：失败即停。零渲染、零下载；话术直接用接口 message。
  // 许可实现本身抛出（网络 / 客户端异常）也收成 error——编辑器以 `void 执行导出()`
  // 调用，不兜底会变成没有提示的 unhandled rejection。
  let 许可: 结果<{ readonly 允许: true; readonly 文件名: string }>
  try {
    许可 = await 输入.许可()
  } catch (错误) {
    return { kind: "error", message: `导出失败：${消息(错误)}` }
  }
  if (许可.kind === "error") return { kind: "error", message: 许可.message }

  // ② 渲染与组装（离屏容器在 渲染SVG 的 finally 里清掉）。
  const 现在 = (依赖.现在 ?? (() => new Date()))()
  const 解析变量 = 依赖.解析变量 ?? 默认解析变量
  const 根字体 = (依赖.根字体 ?? 默认根字体)()
  let 组装: { readonly 串: string; readonly 缺口: readonly string[]; readonly 宽: number; readonly 高: number }
  try {
    组装 = 渲染SVG(输入.文档, 输入.选项, 输入.项目名, 输入.导出人, 现在, 解析变量, 根字体)
  } catch (错误) {
    return { kind: "error", message: `导出失败：${消息(错误)}` }
  }

  // ③ 光栅化。宽高取组装时定下的**实际纸张**（A4/A3 可能已按内容换成横版）。
  const { 宽, 高 } = 组装
  let png: Blob
  try {
    png = await (依赖.光栅化 ?? 默认光栅化)(组装.串, 宽, 高)
  } catch (错误) {
    return { kind: "error", message: `导出失败：${消息(错误)}` }
  }

  // ④ 下载（PNG 与附录同一次调用里先后发出；不写回项目目录）。
  const 下载 = 依赖.下载 ?? 默认下载
  const 文件名 = 记录导出名(许可.value.文件名)
  const 附录 =
    输入.选项.附附录
      ? new Blob([附录Markdown(输入.文档)], { type: "text/markdown;charset=utf-8" })
      : undefined
  // 下载是 DOM 同步操作；浏览器拦截 / 用户取消可能抛出，同样收成 error（不冒泡）。
  try {
    下载(文件名, png)
    if (附录 !== undefined) 下载(记录导出名(`${文件名.replace(/\.png$/i, "")}.md`), 附录)
  } catch (错误) {
    return { kind: "error", message: `导出失败：${消息(错误)}` }
  }

  return { kind: "ok", png, 附录, 文件名, 缺口: 组装.缺口 }
}
