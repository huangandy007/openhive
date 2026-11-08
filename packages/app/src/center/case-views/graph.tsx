import { createEffect, createMemo, createSignal, For, Index, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import type { CaseDetailApi, 图边, 图节点, 关系图结果 } from "../case-detail-api"
import { 复制文本 } from "@/utils/copy-text"
import { 发到会话 } from "../ask-ai"
import { showToast } from "@/utils/toast"
import { 金额文本 } from "./format"
import { 图标图形, 图标边长, 节点图标, 节点图标组 } from "./graph-icons"

export interface GraphProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
  readonly onOpenEntity: (点: 图节点) => void
  /**
   * 「以此为中心」**不在这里收口**：它是这张图自己的事（原地换中心，见 `以下钻`）。
   * 交给上层就等于开一条新 tab——那正是 2026-11-07 被否掉的做法。
   */
}

/**
 * 画布是**固定逻辑坐标**（viewBox），由 SVG 自己等比缩放到容器。
 * 环半径从画布尺寸推出来（而不是写死 250），这是「视口外那半个图」那处缺陷的根治：
 * 旧的 `viewBox 0 0 640 420` + 外环半径 250 ⇒ 单节点落在 `cy = 210 - 250 = -40`，屏幕外，
 * 图上只剩 2 个点。边距 40 是给节点标题（画在节点下方 14px）留的。
 */
export const 画布 = { 宽: 760, 高: 680 } as const

/** 检视面板浮在画布右侧的宽度与留白——宽度必须与面板 class 的 `w-[280px]` 一致（测试钉着）。 */
const 面板宽 = 280
const 面板边距 = 24

export interface 画布尺寸 {
  readonly 宽: number
  readonly 高: number
}

export interface 位点 extends 图节点 {
  readonly x: number
  readonly y: number
}

/**
 * 环状布局：中心固定，1 跳内环、2 跳外环。
 * 排序先按类型再按 id——同一份数据每次画得一样（民警截图对照时，位置跳来跳去会被当成「图变了」），
 * 同类型的节点也挨在一起，一眼能看出「这三个都是号码」。
 */
export function 布局(图: 关系图结果, 尺寸: 画布尺寸 = 画布): { 中心: 位点[]; 一层: 位点[]; 二层: 位点[] } {
  // 半径从**实际画布**推出来：宽 390 时按 760 的固定半径画，图会缩成一片看不清的小点
  //（真栈 1100 宽实测）；半径随容器走，1 单位 = 1 像素，节点与字号恒定。
  // 留边 70/55 是给节点标题（画在节点下方 14px、最长 12 个字）的。
  const 中 = { x: 尺寸.宽 / 2, y: 尺寸.高 / 2 }
  const 半宽 = Math.max(60, 尺寸.宽 / 2 - 70)
  const 半高 = Math.max(60, 尺寸.高 / 2 - 55)
  const 环 = { 1: { rx: 半宽 * 0.55, ry: 半高 * 0.55 }, 2: { rx: 半宽, ry: 半高 } } as const
  const 排 = (点们: readonly 图节点[], 半径: { readonly rx: number; readonly ry: number }) => {
    const 有序 = [...点们].sort((甲, 乙) => 甲.type.localeCompare(乙.type) || 甲.id.localeCompare(乙.id))
    // 半格错开：只有 1 个节点时放在正上方；有 2 个就从「上、下」改成「右、左」。
    // 不错开的话，真实数据的「1 个号码 + 2 个外围号码」会画成 甲乙丙 三点一条竖线（实测就是这张图）。
    const 偏 = 有序.length >= 2 ? Math.PI / 有序.length : 0
    return 有序.map((点, 序号): 位点 => {
      const 角 = (Math.PI * 2 * 序号) / Math.max(有序.length, 1) - Math.PI / 2 + 偏
      return { ...点, x: 中.x + Math.cos(角) * 半径.rx, y: 中.y + Math.sin(角) * 半径.ry }
    })
  }
  return {
    中心: 图.节点.filter((点) => 点.中心).map((点): 位点 => ({ ...点, x: 中.x, y: 中.y })),
    一层: 排(图.节点.filter((点) => !点.中心 && 点.跳数 < 2), 环[1]),
    二层: 排(图.节点.filter((点) => !点.中心 && 点.跳数 >= 2), 环[2]),
  }
}

export type 排列模式 = "环形" | "力导向" | "分层" | "网格"

export const 排列模式们 = ["环形", "力导向", "分层", "网格"] as const

const 按类型排 = (甲: 图节点, 乙: 图节点) => 甲.type.localeCompare(乙.type) || 甲.id.localeCompare(乙.id)

/** 网格：等分画布、按类型/id 顺序填格子。适合「只想一眼数清有多少个、都是什么」的时候。 */
function 网格位置(点们: readonly 图节点[], 尺寸: 画布尺寸): 位点[] {
  const 有序 = [...点们].sort(按类型排)
  const 列数 = Math.max(1, Math.ceil(Math.sqrt(有序.length)))
  const 行数 = Math.max(1, Math.ceil(有序.length / 列数))
  // 边距卡住上下限：窄画布不留 90 的边距，否则格子宽度被挤成负数。
  const 边距x = Math.min(90, 尺寸.宽 / 4)
  const 边距y = Math.min(80, 尺寸.高 / 5)
  const 格宽 = Math.max(1, (尺寸.宽 - 边距x * 2) / 列数)
  const 格高 = Math.max(1, (尺寸.高 - 边距y * 2) / 行数)
  return 有序.map((点, 序) => ({
    ...点,
    x: 边距x + ((序 % 列数) + 0.5) * 格宽,
    y: 边距y + (Math.floor(序 / 列数) + 0.5) * 格高,
  }))
}

/** 分层（跳数分列）：中心｜1 跳｜2 跳 三列。看「谁在几度圈子里」比环状更直接。 */
function 分层位置(图: 关系图结果, 尺寸: 画布尺寸): 位点[] {
  const 列 = (点们: readonly 图节点[], x: number): 位点[] => {
    const 有序 = [...点们].sort(按类型排)
    // 一列里放得越多人越挤；纵向间距随人数收缩，再夹回画布内（55 = 节点＋标题的边距）。
    const 间距 = 有序.length > 1 ? Math.min(84, (尺寸.高 - 130) / (有序.length - 1)) : 0
    const 中y = 尺寸.高 / 2
    return 有序.map((点, 序) => ({
      ...点,
      x,
      y: Math.min(尺寸.高 - 55, Math.max(55, 中y + (序 - (有序.length - 1) / 2) * 间距)),
    }))
  }
  const 边距 = Math.min(100, 尺寸.宽 / 3)
  return [
    ...列(图.节点.filter((点) => 点.中心), 边距),
    ...列(图.节点.filter((点) => !点.中心 && 点.跳数 < 2), 尺寸.宽 / 2),
    ...列(图.节点.filter((点) => !点.中心 && 点.跳数 >= 2), 尺寸.宽 - 边距),
  ]
}

/**
 * 力导向（Fruchterman–Reingold）：斥力把点推开、边像弹簧把相连的点拉近。
 * 起始位置用环状布局、迭代过程没有随机数——同一份数据每次算出来一模一样，
 * 否则民警每刷新一次，整张图都在抖，位置变了会被当成「关系变了」。
 */
function 力导向位置(图: 关系图结果, 尺寸: 画布尺寸): 位点[] {
  const 环 = 布局(图, 尺寸)
  const 序 = [...环.中心, ...环.一层, ...环.二层].sort(按类型排)
  const n = 序.length
  if (n === 0) return []
  const 位 = new Map(序.map((点) => [点.id, { x: 点.x, y: 点.y }]))
  // 理想间距 k：把可用面积均分给 n 个点。太大会把相连的点也推开，太小全挤成一团。
  const k = Math.max(24, Math.sqrt(((尺寸.宽 - 170) * (尺寸.高 - 120)) / n))
  const 邻 = 图.边.filter((边) => 位.has(边.from) && 位.has(边.to))
  let 步 = Math.min(尺寸.宽, 尺寸.高) * 0.12
  for (let 轮 = 0; 轮 < 200; 轮 += 1) {
    const 加 = new Map(序.map((点) => [点.id, { x: 0, y: 0 }]))
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const 甲 = 位.get(序[i]!.id)!
        const 乙 = 位.get(序[j]!.id)!
        let dx = 甲.x - 乙.x
        let dy = 甲.y - 乙.y
        let d = Math.hypot(dx, dy)
        // 完全重合时按序号给一个确定的偏移方向，别拿随机数（随机数会让结果漂）。
        if (d < 0.5) {
          dx = 0.5 + i * 0.1
          dy = 0.5 + j * 0.1
          d = Math.hypot(dx, dy)
        }
        const f = (k * k) / d
        const 力甲 = 加.get(序[i]!.id)!
        const 力乙 = 加.get(序[j]!.id)!
        力甲.x += (dx / d) * f
        力甲.y += (dy / d) * f
        力乙.x -= (dx / d) * f
        力乙.y -= (dy / d) * f
      }
    }
    for (const 边 of 邻) {
      const 甲 = 位.get(边.from)!
      const 乙 = 位.get(边.to)!
      const dx = 甲.x - 乙.x
      const dy = 甲.y - 乙.y
      const d = Math.hypot(dx, dy) || 0.5
      const f = (d * d) / k
      const 力甲 = 加.get(边.from)!
      const 力乙 = 加.get(边.to)!
      力甲.x -= (dx / d) * f
      力甲.y -= (dy / d) * f
      力乙.x += (dx / d) * f
      力乙.y += (dy / d) * f
    }
    for (const 点 of 序) {
      const 力 = 加.get(点.id)!
      const 长 = Math.hypot(力.x, 力.y) || 1
      const 移 = Math.min(长, 步)
      const 座 = 位.get(点.id)!
      座.x += (力.x / 长) * 移
      座.y += (力.y / 长) * 移
    }
    步 *= 0.985
  }
  // 收敛后按包围盒等比收进画布：力导向不管容器多大都会散开，不缩回来就出界。
  const xs = 序.map((点) => 位.get(点.id)!.x)
  const ys = 序.map((点) => 位.get(点.id)!.y)
  const 最左 = Math.min(...xs)
  const 最右 = Math.max(...xs)
  const 最上 = Math.min(...ys)
  const 最下 = Math.max(...ys)
  const 宽 = Math.max(1, 最右 - 最左)
  const 高 = Math.max(1, 最下 - 最上)
  const 比 = Math.min(1, (尺寸.宽 - 170) / 宽, (尺寸.高 - 120) / 高)
  const 中x = (最左 + 最右) / 2
  const 中y = (最上 + 最下) / 2
  return 序.map((点) => {
    const 座 = 位.get(点.id)!
    return {
      ...点,
      x: 尺寸.宽 / 2 + (座.x - 中x) * 比,
      y: 尺寸.高 / 2 + (座.y - 中y) * 比,
    }
  })
}

/** 各排列模式的自动坐标。`环形` 复用 `布局()`（它那份中点/内环/外环的排法已有测试钉着）。 */
export function 自动位置(图: 关系图结果, 尺寸: 画布尺寸 = 画布, 模式: 排列模式 = "环形"): 位点[] {
  if (模式 === "环形") {
    const 位 = 布局(图, 尺寸)
    return [...位.中心, ...位.一层, ...位.二层]
  }
  if (模式 === "网格") return 网格位置(图.节点, 尺寸)
  if (模式 === "分层") return 分层位置(图, 尺寸)
  return 力导向位置(图, 尺寸)
}

const 节点半径 = (点: 图节点) => (点.中心 ? 20 : 15)

type 形 = "circle" | "rect" | "hexagon" | "diamond"

function 形状(类型: string): 形 {
  if (类型 === "号码" || 类型 === "组织") return "rect"
  if (类型 === "账户") return "hexagon"
  if (类型 === "地点") return "diamond"
  return "circle"
}

function 填充(点: 图节点): string {
  if (点.中心) return "var(--v2-background-bg-accent-soft)"
  if (点.type === "号码") return "var(--v2-state-bg-info)"
  if (点.type === "账户") return "var(--v2-state-bg-success)"
  if (点.type === "地点") return "var(--v2-state-bg-warning)"
  if (点.type === "组织") return "var(--v2-background-bg-layer-03)"
  return "var(--v2-background-bg-layer-02)"
}

/** 需要再看一眼的两态。`已确认` 是可信态——把它也算进来，整张图会全是虚线圈。 */
const 待复核 = new Set(["存疑", "已排除"])

function 描边(点: 图节点): string {
  if (点.中心) return "var(--v2-brand-gold-deep)"
  if (待复核.has(点.trust_state)) return "var(--v2-state-border-warning)"
  if (点.trust_state === "已确认") return "var(--v2-state-border-success)"
  return "var(--v2-border-border-strong)"
}

/**
 * 节点描边色（点选时换品牌金深）。**图标也读这一份**：点选后边框换了色、图标还是灰的，
 * 看上去像两个节点各画了一半。
 */
function 描边色(点: 图节点, 焦点: boolean): string {
  return 焦点 ? "var(--v2-brand-gold-deep)" : 描边(点)
}

/** 关系类型配色：只用语义槽位（暗色主题会自己翻），不新造色。 */
function 边颜色(类型: string): string {
  if (类型 === "通话") return "var(--v2-state-border-info)"
  if (类型 === "转账") return "var(--v2-brand-gold)"
  if (类型 === "实际使用") return "var(--v2-text-text-muted)"
  return "var(--v2-border-border-strong)"
}

/** 次数分三档：个位数的细线、两位数的中线、更多为粗线——粗到能直接比大小。 */
function 边宽(次数: number): number {
  if (次数 <= 3) return 2
  if (次数 <= 10) return 3
  return 4
}

const 截断 = (值: string, 上限 = 12) => (值.length > 上限 ? `${值.slice(0, 上限)}…` : 值)

function 多边形(点: 位点, 半径: number, 角数: number, 起始角: number): string {
  return Array.from({ length: 角数 }, (_, 序) => {
    const 角 = 起始角 + (Math.PI * 2 * 序) / 角数
    return `${(点.x + Math.cos(角) * 半径).toFixed(1)},${(点.y + Math.sin(角) * 半径).toFixed(1)}`
  }).join(" ")
}

/**
 * `焦点` = 这个节点正被点选。点选必须**在节点本身上看得出来**（真栈实测改前点前点后
 * fill/stroke/线宽三项一模一样，只有右侧面板变了）：换成品牌高亮填充＋深金描边，
 * 点选时外面再加一圈金环（见 `graph-node-focus`）。
 */
function 图形(props: { readonly 点: 位点; readonly 焦点: boolean }): JSX.Element {
  // 做成组件、只换属性：焦点色一变就重建元素的话，点选当场把被点的那个图形换掉，
  // 同一事件的冒泡链里它的 target 已脱离文档（真栈实测 isConnected=false），
  // svg 那层「点空白 ⇒ 取消选中」认不出它，选中又被打回去。
  const 半 = () => 节点半径(props.点)
  // 焦点色不能复用「中心节点」那组值：中心本来就是高亮填充＋深金描边，沿用同一组时
  // 点它只有线宽 2.5→3 和一圈淡环，看不出焦点落在谁身上。统一换成品牌金填充。
  const 填充色 = () => (props.焦点 ? "var(--v2-brand-gold)" : 填充(props.点))
  const 边色 = () => 描边色(props.点, props.焦点)
  const 线宽 = () => (props.焦点 ? 3 : props.点.中心 ? 2.5 : 1.5)
  const 虚线 = () => (待复核.has(props.点.trust_state) ? "4 3" : undefined)
  return (
    <Switch>
      <Match when={形状(props.点.type) === "rect"}>
        {/* 号码/组织：圆角方块，与「人」的圆形一眼分开。 */}
        <rect
          data-slot="graph-node-shape"
          x={props.点.x - 半() + 1}
          y={props.点.y - 半() + 1}
          width={(半() - 1) * 2}
          height={(半() - 1) * 2}
          rx={半() * 0.45}
          fill={填充色()}
          stroke={边色()}
          stroke-width={线宽()}
          stroke-dasharray={虚线()}
        />
      </Match>
      <Match when={形状(props.点.type) === "hexagon"}>
        <polygon
          data-slot="graph-node-shape"
          points={多边形(props.点, 半(), 6, -Math.PI / 2)}
          fill={填充色()}
          stroke={边色()}
          stroke-width={线宽()}
          stroke-dasharray={虚线()}
        />
      </Match>
      <Match when={形状(props.点.type) === "diamond"}>
        <polygon
          data-slot="graph-node-shape"
          points={多边形(props.点, 半(), 4, -Math.PI / 2)}
          fill={填充色()}
          stroke={边色()}
          stroke-width={线宽()}
          stroke-dasharray={虚线()}
        />
      </Match>
      <Match when={形状(props.点.type) === "circle"}>
        <circle
          data-slot="graph-node-shape"
          cx={props.点.x}
          cy={props.点.y}
          r={半()}
          fill={填充色()}
          stroke={边色()}
          stroke-width={线宽()}
          stroke-dasharray={虚线()}
        />
      </Match>
    </Switch>
  )
}

type 选中项 = { readonly kind: "node" | "edge"; readonly id: string }

interface 提示内容 {
  readonly x: number
  readonly y: number
  readonly 行1: string
  readonly 行2: string
}

const 提示宽 = 168

/**
 * 把新取回来的一圈**并进**现有的图（2026-11-07 用户要求「原来已有的点一并显示」）。
 *
 * - 节点/边按 id 并集，**新的覆盖旧的**：同一个点在不同圈里带的跳数/关联数，以最新那一圈为准；
 * - 缺口去重（同一条上限提示不该叠两遍）；
 * - 中心标记一律重算，只认 `中心id`。⚠️ 不重算，环形布局会把几个旧中心**摞在正中间**
 *   （`布局()` 把所有 `中心: true` 放在同一个点上），半径与配色也跟着错。
 */
function 并图(旧: 关系图结果 | undefined, 新: 关系图结果, 中心id: string): 关系图结果 {
  const 节点 = new Map<string, 图节点>()
  for (const 点 of 旧?.节点 ?? []) 节点.set(点.id, 点)
  for (const 点 of 新.节点) 节点.set(点.id, 点)
  const 边 = new Map<string, 图边>()
  for (const 条 of 旧?.边 ?? []) 边.set(条.id, 条)
  for (const 条 of 新.边) 边.set(条.id, 条)
  return {
    节点: [...节点.values()].map((点) => ({ ...点, 中心: 点.id === 中心id })),
    边: [...边.values()],
    缺口: [...new Set([...(旧?.缺口 ?? []), ...新.缺口])],
  }
}

/**
 * 实体关系图（2026-11-07 视觉改版，方向 A：聚焦画布 ＋ 右侧检视面板）。
 *
 * 四条口径：
 * ① 画布按容器等比缩放，环半径从画布尺寸推出来——节点永远在视野里；
 * ② 图的编码自己说话：形状=类型，粗细=次数，颜色=关系类型，虚线=非自动抽取；
 * ③ 悬停只做「暂时聚焦」，点击才把详情钉到右侧面板（hover 做状态会被误判成选中）；
 * ④ 缩放平移是纯视图变换（`translate() scale()`），不改布局，双击/「适应」可复位。
 */
export function Graph(props: GraphProps): JSX.Element {
  const [图, set图] = createSignal<关系图结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)
  /**
   * 这张图**当前的中心**。下钻就在原地换它（2026-11-07 用户裁定：不新开 tab）。
   * 初值来自上层；只有 `props.id` 变了（换实体）才回到它。
   */
  const [中心, set中心] = createSignal(props.id)
  /** 下钻来路。存名字是为了「返回」按钮说得出来「回哪儿」。 */
  const [来路, set来路] = createSignal<readonly { readonly id: string; readonly 名字: string }[]>([])
  /**
   * 下一回取回来的图是**并进**现有图，还是**替换**它。
   * 换中心（下钻/返回）⇒ 并入（旧点留着，2026-11-07 用户要求）；
   * 换跳数/筛选/实体 ⇒ 替换（用户裁定「清空重来」，图上一定符合当前口径）。
   */
  let 本次并入 = false
  const [跳数, set跳数] = createSignal<1 | 2>(1)
  const [选中类型, set选中类型] = createSignal<readonly string[]>([])
  /** 见过的每种关系类型出现过的最大条数：服务端按类型过滤后别的类型会消失，计数得留着（否则按钮跟着没了）。 */
  const [类型计数, set类型计数] = createSignal<Record<string, number>>({})
  const [悬停点, set悬停点] = createSignal<string | undefined>()
  const [悬停边, set悬停边] = createSignal<string | undefined>()
  const [选中, set选中] = createSignal<选中项 | null>(null)
  /**
   * 多选（2026-11-07 用户下达：「框选多个节点后整体移动」）。
   *
   * 与 `选中` 是**两件事**：`选中` 决定右侧检视面板看谁，多选只决定「拖动时一起动的是谁」。
   * 所以框选不弹面板、Shift 点节点也不弹——否则框一下就把面板挤出来，正是要避免的事。
   */
  const [多选, set多选] = createSignal<readonly string[]>([])
  /** 正在拉的框（**节点坐标**，与 `全部点()` / `手动位置` 同一套）；`undefined` = 没在拉，也就不画。 */
  const [拉框, set拉框] = createSignal<{ readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | undefined>()
  /**
   * 刚复制成功的是**哪一条节点**。存 id 而不是布尔：1.5 秒里用户点开另一条，
   * 那颗钮不能替新节点冒充「已复制」。
   */
  const [复制了, set复制了] = createSignal<string | undefined>()
  /**
   * 右键菜单的作用对象（**整条节点**，不是 id：上层取图与拼标题都要 `value` / `type`）。
   * 收起时清空；空白处右键也会清空并拦下事件（见 `记右键`）。
   */
  const [菜单点, set菜单点] = createSignal<图节点 | undefined>()
  const [缩放, set缩放] = createSignal(1)
  const [平移, set平移] = createSignal({ x: 0, y: 0 })
  /** viewBox 的实际尺寸 = 画布容器的像素尺寸；测不到（组件测试）时退回默认画布。 */
  const [尺寸, set尺寸] = createSignal<画布尺寸>(画布)
  const [排列, set排列] = createSignal<排列模式>("环形")
  /** 手动拖过的节点坐标（viewBox 坐标）。只在下一次「重排」或换排列模式时清空。 */
  const [手动位置, set手动位置] = createSignal<Record<string, { readonly x: number; readonly y: number }>>({})

  let svg元素: SVGSVGElement | undefined
  let 画布元素: HTMLDivElement | undefined

  const 量画布 = () => {
    const 矩 = 画布元素?.getBoundingClientRect()
    if (矩 === undefined || 矩.width < 1 || 矩.height < 1) return
    set尺寸({ 宽: Math.round(矩.width), 高: Math.round(矩.height) })
  }

  // 换实体 = 换一张图：跳数、筛选、选中、视口全部回到初始态（上一张图的选中项在这张图里不存在）。
  createEffect(
    (上一个: string | undefined) => {
      const 键 = `${props.projectId}|${props.id}`
      if (上一个 !== undefined && 上一个 !== 键) {
        // 换实体 = 换一份数据：中心回到上层给的那个，来路作废，累积全部清掉。
        本次并入 = false
        set中心(props.id)
        set来路([])
        set跳数(1)
        set选中类型([])
        set类型计数({})
        set选中(null)
        set多选([])
        set拉框(undefined)
        set悬停点(undefined)
        set悬停边(undefined)
        set缩放(1)
        set平移({ x: 0, y: 0 })
        set排列("环形")
        set手动位置({})
      }
      return 键
    },
    undefined as string | undefined,
  )

  createEffect(() => {
    const projectId = props.projectId
    // 取的是**当前中心**：下钻换了中心就重新取，同一张图换个中心重画。
    const id = 中心()
    // 这一回的并入/替换决定按**发起时**的信号定，别读回包那一刻的值（那时可能已经被下一回改了）。
    const 并入这圈 = 本次并入
    const api = props.api
    const 当前跳数 = 跳数()
    const 当前类型 = 选中类型()
    // 并入这一回**不清旧图**：清了 `并图` 收到 `旧 = undefined`，旧点就在「载入中」被抹掉，
    // 回包再怎么并也只剩新中心这一圈。替换（换跳数/筛选/换实体）才清空。
    if (!并入这圈) set图(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    onCleanup(() => {
      作废 = true
    })
    void api.graph(projectId, id, 当前跳数, 当前类型)
      .then((回) => {
        if (作废) return
        set载入(false)
        if (回.kind === "error") {
          set错误(回.message)
          return
        }
        const 本条: Record<string, number> = {}
        for (const 边 of 回.value.边) 本条[边.type] = (本条[边.type] ?? 0) + 1
        const 累计 = { ...类型计数() }
        for (const [类, 数] of Object.entries(本条)) 累计[类] = Math.max(累计[类] ?? 0, 数)
        set类型计数(累计)
        set图((旧) => 并图(并入这圈 ? 旧 : undefined, 回.value, id))
      })
      // 注入的 api 若**抛**（不是回 `{kind:"error"}`），不接住就会一直停在「载入中」，
      // 同时留下一条没人看的 unhandled rejection。
      .catch((错: unknown) => {
        if (作废) return
        set载入(false)
        set错误(错 instanceof Error ? 错.message : String(错))
      })
  })

  const 中点 = createMemo(() => ({ x: 尺寸().宽 / 2, y: 尺寸().高 / 2 }))
  // 自动布局是纯函数；手动拖过的点覆盖在上面。数据刷新（换跳数/筛选）不手动位置，
  // 只有「重排」和换排列模式才回到纯自动布局（这是和用户谈定的口径）。
  const 全部点 = createMemo(() => {
    const 当前 = 图()
    if (当前 === undefined) return []
    const 手动 = 手动位置()
    return 自动位置(当前, 尺寸(), 排列()).map((点) => {
      const 位 = 手动[点.id]
      return 位 === undefined ? 点 : { ...点, x: 位.x, y: 位.y }
    })
  })
  const 点 = (id: string) => 全部点().find((行) => 行.id === id)
  const 边 = (id: string) => (图()?.边 ?? []).find((行) => 行.id === id)

  /** 当前中心那条节点：头部标出来，只从这里取「返回」要说的名字。 */
  const 中心节点 = createMemo(() => 图()?.节点.find((行) => 行.中心))

  /**
   * 换中心 = 在**同一张图里**换个中心（2026-11-07 用户裁定）：
   * 旧节点/旧边都留着，新中心那一圈并进来。既然节点不消失，选中、视口、手动位置、类型计数
   * 也都不作废——把它们清掉会让用户刚看清的东西自己跳走。**跳数与类型筛选**同样留着。
   */
  const 换中心到 = (id: string) => {
    本次并入 = true
    set中心(id)
  }

  /** 「以此为中心」（右键菜单与右侧面板**同一个出口**）：压一层来路，原地换中心。 */
  const 以下钻 = (点: 图节点) => {
    set来路((旧) => [...旧, { id: 中心(), 名字: 中心节点()?.value ?? "" }])
    换中心到(点.id)
  }

  /** 「返回」：回到上一个中心；来路为空时按钮根本不渲染。 */
  const 返回上一中心 = () => {
    const 栈 = 来路()
    const 上一个 = 栈.at(-1)
    if (上一个 === undefined) return
    set来路(栈.slice(0, -1))
    换中心到(上一个.id)
  }

  /**
   * 右键：记下指针底下那个节点，并**同时选中它**（2026-11-07 用户下达）。
   *
   * 两件事必须一起做：菜单的对象、图上的高亮、右侧面板必须指向同一个节点，否则会出现
   * 「菜单说的是 A、圈亮在 B」。
   *
   * 空白处（落点不在任何节点上）**不给我们这套菜单**：两项都只对节点有意义，摆出来只能是
   * 两个禁用项。`stopPropagation` 让事件到不了 `Trigger`（机关见 JSX 那处注释）；
   * **不** `preventDefault`：没有可干的事就别把浏览器自带的菜单也收走（`#006-32`，
   * 同 `content-menu.tsx` 的取舍）。
   */
  const 记右键 = (事件: MouseEvent) => {
    const 目标 = 事件.target
    const 组 = 目标 instanceof Element ? 目标.closest("[data-slot='graph-node']") : null
    const id = 组?.getAttribute("data-node-id") ?? undefined
    const 命中 = id === undefined ? undefined : 点(id)
    if (命中 === undefined) {
      set菜单点(undefined)
      事件.stopPropagation()
      return
    }
    set菜单点(命中)
    set选中({ kind: "node", id: 命中.id })
  }

  // 数据刷新后选中项可能已经不在了（换跳数、换筛选都会走到这里）——面板不能继续显示一个图里没有的节点。
  createEffect(() => {
    const 当前 = 选中()
    if (当前 === null) return
    const 还在 = 当前.kind === "node" ? (图()?.节点 ?? []).some((行) => 行.id === 当前.id) : (图()?.边 ?? []).some((行) => 行.id === 当前.id)
    if (!还在) set选中(null)
  })

  // 多选同理：换跳数/筛选后点了不在了的点必须从组里掉出去，否则「整组拖动」会拖一串鬼影。
  createEffect(() => {
    const 旧 = 多选()
    if (旧.length === 0) return
    const 有 = new Set((图()?.节点 ?? []).map((行) => 行.id))
    const 留 = 旧.filter((id) => 有.has(id))
    if (留.length !== 旧.length) set多选(留)
  })

  const 选中点 = createMemo(() => {
    const 当前 = 选中()
    return 当前?.kind === "node" ? 点(当前.id) : undefined
  })
  const 选中边 = createMemo(() => {
    const 当前 = 选中()
    return 当前?.kind === "edge" ? 边(当前.id) : undefined
  })

  /** 「已复制」的复位计时器；重新复制、组件卸载都要把它收掉（否则旧计时器会替新一次提前复位）。 */
  let 复制计时: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(复制计时))

  /**
   * 面板标题旁「复制」（2026-11-07 用户下达）：图上节点标签是**截断**的（`4301231967...`），
   * 全文只在面板里 ⇒ 要能一键拿走。
   *
   * 只复制**值本身**（用户裁定），不带类型/跳数——它多半要粘去公安系统或 Excel。
   * 成功由按钮自己变「已复制」说话；**失败必须另吭一声**：复制不改变屏幕上任何东西，
   * 不吭声的话「复制成了」与「根本没复制」长得一样（同 `file-tree` 那条取舍）。
   */
  const 复制值 = (点: 图节点) => {
    void 复制文本(点.value).then((成) => {
      if (!成) {
        showToast({ variant: "error", title: "复制失败", description: 点.value })
        return
      }
      set复制了(点.id)
      clearTimeout(复制计时)
      复制计时 = setTimeout(() => set复制了((当前) => (当前 === 点.id ? undefined : 当前)), 1500)
    })
  }

  /**
   * 右键菜单里「复制 / 发送到会话」要带走谁（2026-11-08 用户下达）。
   *
   * 多选 ≥2 颗且右键的那颗在里面 ⇒ 整组（每行一条）；否则只这一颗。
   * 图里拖拽已经是「整组移动」，复制与发送跟着同一个多选走，才不用再选一遍。
   */
  const 带走们 = (目标: 图节点): readonly 图节点[] => {
    const 组 = 多选()
    if (组.length < 2 || !组.includes(目标.id)) return [目标]
    return 组.flatMap((id) => 点(id) ?? [])
  }
  /** 每行格式与面板标题同一套：`类型 · 细类 · 值`（细类没有就省掉）。 */
  const 带走文本 = (目标: 图节点) =>
    带走们(目标)
      .map((行) => [行.type, 行.subtype, 行.value].filter((段): 段 is string => 段 !== undefined && 段 !== "").join(" · "))
      .join("\n")

  const 复制带走 = (目标: 图节点) => {
    const 文本 = 带走文本(目标)
    void 复制文本(文本).then((成) => {
      if (!成) {
        showToast({ variant: "error", title: "复制失败", description: 文本 })
        return
      }
      showToast({ variant: "success", title: "已复制" })
    })
  }

  /** 悬停节点时它的邻居集合；`null` = 没有悬停（谁都不降透明度）。 */
  const 邻居集 = createMemo<ReadonlySet<string> | null>(() => {
    const 号 = 悬停点()
    if (号 === undefined) return null
    const 集 = new Set<string>([号])
    for (const 行 of 图()?.边 ?? []) {
      if (行.from === 号) 集.add(行.to)
      if (行.to === 号) 集.add(行.from)
    }
    return 集
  })
  const 节点透明 = (id: string) => (邻居集() !== null && !邻居集()!.has(id) ? "0.25" : undefined)
  const 边透明 = (行: 图边) => {
    const 号 = 悬停点()
    if (号 === undefined) return undefined
    return 行.from === 号 || 行.to === 号 ? undefined : "0.25"
  }
  const 边亮 = (id: string) => 悬停边() === id || (选中()?.kind === "edge" && 选中()!.id === id)

  const 悬停内容 = createMemo<提示内容 | undefined>(() => {
    const 点id = 悬停点()
    if (点id !== undefined) {
      const 行 = 点(点id)
      if (行 === undefined) return undefined
      const 左 = 行.x + 22 + 提示宽 > 尺寸().宽 - 8 ? 行.x - 22 - 提示宽 : 行.x + 22
      return {
        x: 左,
        y: Math.max(8, Math.min(尺寸().高 - 52, 行.y - 36)),
        行1: `${截断(行.value, 14)} · ${行.type}`,
        // 细类放第二行：第一行已经贴着提示框宽度，再拼「· 手机号」会溢出框外。
        行2: `${行.subtype === undefined ? "" : `${行.subtype} · `}${行.trust_state} · 关联 ${行.关联数}`,
      }
    }
    const 边id = 悬停边()
    if (边id !== undefined) {
      const 行 = 边(边id)
      if (行 === undefined) return undefined
      const 甲 = 点(行.from)
      const 乙 = 点(行.to)
      if (甲 === undefined || 乙 === undefined) return undefined
      const 中 = { x: (甲.x + 乙.x) / 2, y: (甲.y + 乙.y) / 2 }
      return {
        x: Math.max(8, Math.min(尺寸().宽 - 提示宽 - 8, 中.x - 提示宽 / 2)),
        y: Math.max(8, Math.min(尺寸().高 - 52, 中.y - 52)),
        行1: `${行.type} · ${行.times} 次`,
        行2: `${金额文本(行.amount)} · ${甲.value} → ${乙.value}`,
      }
    }
    return undefined
  })

  const 类型们 = createMemo(() => Object.keys(类型计数()).sort((甲, 乙) => 甲.localeCompare(乙)))

  const 拨类型 = (类型: string) => {
    // 换筛选 = 换一份数据 ⇒ 下一回取到的是**替换**而不是并进来（用户裁定：清空重来）。
    本次并入 = false
    const 当前 = 选中类型()
    set选中类型(当前.includes(类型) ? 当前.filter((条) => 条 !== 类型) : [...当前, 类型])
  }

  const 缩放到 = (目标: number, 围绕: { readonly x: number; readonly y: number }) => {
    const 新 = Math.min(3, Math.max(0.5, 目标))
    const k = 新 / 缩放()
    const 原 = 平移()
    set平移({ x: 围绕.x + k * (原.x - 围绕.x), y: 围绕.y + k * (原.y - 围绕.y) })
    set缩放(新)
  }
  const 复位视图 = () => {
    set缩放(1)
    set平移({ x: 0, y: 0 })
  }

  /**
   * 检视面板浮在画布右边缘（`w-[280px]`），底下那一列节点点不到也拖不到——真栈实操时
   * 在面板正下方起手拖动，按到的是面板按钮（误触「以此为中心」开了新关系图）。
   * 点选就把它让出来：平移画布，不改布局坐标。
   */
  const 让出面板 = (行: 位点) => {
    const 右界 = 尺寸().宽 - 面板宽 - 面板边距
    const 屏x = 行.x * 缩放() + 平移().x
    if (屏x <= 右界) return
    const 新 = 平移().x - (屏x - 右界)
    // 让得太多会把节点自己顶出左边界：以「节点仍在画布内」为下限。
    set平移({ ...平移(), x: Math.max(新, 面板边距 - 行.x * 缩放()) })
  }

  /**
   * 屏幕坐标 → viewBox **内容坐标**（未变换）。`preserveAspectRatio="xMidYMid meet"` 的
   * letterbox 偏置算在里面，所以 devtools 里看到的、和节点 `x/y` 用的是同一把尺子。
   *
   * 测不到尺寸（组件测试里 `getBoundingClientRect` 全 0）时给 `undefined`：**不在这里编一个坐标**，
   * 退化的口径归调用方（滚轮围着画布中心，拉框退回「屏幕坐标即内容坐标」）。
   */
  const 到内容 = (clientX: number, clientY: number) => {
    const 矩 = svg元素?.getBoundingClientRect()
    if (矩 === undefined || 矩.width <= 0 || 矩.height <= 0) return undefined
    const 比例 = Math.min(矩.width / 尺寸().宽, 矩.height / 尺寸().高) || 1
    return {
      x: (clientX - (矩.left + (矩.width - 尺寸().宽 * 比例) / 2)) / 比例,
      y: (clientY - (矩.top + (矩.height - 尺寸().高 * 比例) / 2)) / 比例,
      比例,
    }
  }

  /** 屏幕坐标 → **节点坐标**（`全部点()` / `手动位置` 那一套）：内容坐标再逆掉视口变换。 */
  const 到节点 = (clientX: number, clientY: number) => {
    const 内 = 到内容(clientX, clientY) ?? { x: clientX, y: clientY }
    return { x: (内.x - 平移().x) / 缩放(), y: (内.y - 平移().y) / 缩放() }
  }

  const 滚轮 = (事件: WheelEvent) => {
    事件.preventDefault()
    // 缩放公式要的是「光标此刻指着的内容点」在变换前的坐标。
    const 游标 = 到内容(事件.clientX, 事件.clientY) ?? 中点()
    缩放到(缩放() * (事件.deltaY < 0 ? 1.15 : 1 / 1.15), 游标)
  }

  let 拖: { 起x: number; 起y: number; 原x: number; 原y: number; 比例: number } | undefined

  /** 拉框（Shift + 拖空白）。`节点x/y` 是起点的**节点坐标**，框按节点坐标画、按节点坐标判归属。 */
  let 拉: { 起x: number; 起y: number; 节点x: number; 节点y: number; 移动: boolean } | undefined

  /**
   * 节点拖动：mousedown 落在节点上时接管，走「移动节点」而不是「平移画布」。
   *
   * `组` 是**一起移动的点**（含被按住的那个）：按在已选中的节点上是整组，否则只有它自己——
   * 后一种还会清空多选（用户 2026-11-07 谈定：拖没选中的就是「换成只拖它」）。
   */
  let 拖节点:
    | {
        readonly 起x: number
        readonly 起y: number
        readonly 比例: number
        readonly 组: readonly { readonly id: string; readonly x: number; readonly y: number }[]
        移动: boolean
      }
    | undefined
  /** 拖动结束浏览器还会补一个 click；用它把「拖」和「点选」分开（面板不该在拖完时弹出来）。 */
  let 刚拖过 = false
  /** 同上，给拉框用：拉完那一下的 click 不能再把刚选出来的多选清掉。 */
  let 刚拉过 = false

  const 开始拖节点 = (事件: MouseEvent, 行: 位点) => {
    if (事件.button !== 0) return
    刚拖过 = false
    // Shift + 点节点 = 加入/移出多选（在 click 里做），这里不接管拖动：
    // 否则手一抖就把整个图挪了，而用户只是想把这一颗加进选。
    if (事件.shiftKey) {
      拖节点 = undefined
      return
    }
    const 选了这 = 多选().includes(行.id)
    if (!选了这 && 多选().length > 0) set多选([])
    const 组 = 选了这
      ? 多选()
          .map((id) => 点(id))
          .filter((条): 条 is 位点 => 条 !== undefined)
          .map((条) => ({ id: 条.id, x: 条.x, y: 条.y }))
      : [{ id: 行.id, x: 行.x, y: 行.y }]
    拖节点 = {
      起x: 事件.clientX,
      起y: 事件.clientY,
      比例: 到内容(事件.clientX, 事件.clientY)?.比例 ?? 1,
      组,
      移动: false,
    }
  }

  const 开始拖 = (事件: MouseEvent) => {
    if (事件.button !== 0) return
    const 目标 = 事件.target
    if (目标 instanceof Element && 目标.closest("[data-slot='graph-node'],[data-slot='graph-edge'],[data-slot='graph-zoom-bar'],[data-slot='graph-legend']")) return
    // Shift + 拖空白 = 拉框多选；普通左键拖空白仍然是平移画布（用户 2026-11-07 谈定）。
    if (事件.shiftKey) {
      const 起 = 到节点(事件.clientX, 事件.clientY)
      拉 = { 起x: 事件.clientX, 起y: 事件.clientY, 节点x: 起.x, 节点y: 起.y, 移动: false }
      set拉框({ x0: 起.x, y0: 起.y, x1: 起.x, y1: 起.y })
      return
    }
    const 原 = 平移()
    拖 = {
      起x: 事件.clientX,
      起y: 事件.clientY,
      原x: 原.x,
      原y: 原.y,
      比例: 到内容(事件.clientX, 事件.clientY)?.比例 ?? 1,
    }
  }

  onMount(() => {
    // 画布随容器改变（开/收右侧面板、窗口缩放）：viewBox 就是容器像素尺寸，图始终铺满而不是缩成小点。
    量画布()
    const 观察 = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => 量画布())
    if (观察 !== undefined && 画布元素 !== undefined) 观察.observe(画布元素)
    onCleanup(() => 观察?.disconnect())

    const 移 = (事件: MouseEvent) => {
      const 节点 = 拖节点
      if (节点 !== undefined) {
        const 屏x = 事件.clientX - 节点.起x
        const 屏y = 事件.clientY - 节点.起y
        // 3px 死区：手抖 1px 不算拖动，否则「点一下看详情」会变成「挪半步再选中」。
        if (!节点.移动 && Math.hypot(屏x, 屏y) > 3) 节点.移动 = true
        if (!节点.移动) return
        // 屏幕位移 ÷（画布缩放 × 视图缩放）= viewBox 位移。整组共用同一个位移 ⇒ 相对位置不变。
        const 比 = 节点.比例 * 缩放()
        const 新 = { ...手动位置() }
        for (const 条 of 节点.组) 新[条.id] = { x: 条.x + 屏x / 比, y: 条.y + 屏y / 比 }
        set手动位置(新)
        return
      }
      if (拉 !== undefined) {
        if (!拉.移动 && Math.hypot(事件.clientX - 拉.起x, 事件.clientY - 拉.起y) > 3) 拉.移动 = true
        if (!拉.移动) return
        const 终 = 到节点(事件.clientX, 事件.clientY)
        set拉框({ x0: 拉.节点x, y0: 拉.节点y, x1: 终.x, y1: 终.y })
        return
      }
      if (拖 === undefined) return
      set平移({
        x: 拖.原x + (事件.clientX - 拖.起x) / 拖.比例,
        y: 拖.原y + (事件.clientY - 拖.起y) / 拖.比例,
      })
    }
    const 松 = () => {
      if (拖节点 !== undefined) {
        刚拖过 = 拖节点.移动
        拖节点 = undefined
      }
      if (拉 !== undefined) {
        刚拉过 = 拉.移动
        const 框 = 拉框()
        if (拉.移动 && 框 !== undefined) {
          // 判归属按**圆心在框内**（用户谈定的口径）：擦到边的半颗不算，免得选进一大片。
          const 左 = Math.min(框.x0, 框.x1)
          const 右 = Math.max(框.x0, 框.x1)
          const 上 = Math.min(框.y0, 框.y1)
          const 下 = Math.max(框.y0, 框.y1)
          set多选(
            全部点()
              .filter((条) => 条.x >= 左 && 条.x <= 右 && 条.y >= 上 && 条.y <= 下)
              .map((条) => 条.id),
          )
        }
        拉 = undefined
        set拉框(undefined)
      }
      拖 = undefined
    }
    const 按键 = (事件: KeyboardEvent) => {
      if (事件.key !== "Escape") return
      set选中(null)
      set多选([])
      set悬停点(undefined)
      set悬停边(undefined)
      // 拉到一半按 Esc：把框也收掉，别留一个松不开的虚框。
      拉 = undefined
      set拉框(undefined)
    }
    window.addEventListener("mousemove", 移)
    window.addEventListener("mouseup", 松)
    window.addEventListener("keydown", 按键)
    onCleanup(() => {
      window.removeEventListener("mousemove", 移)
      window.removeEventListener("mouseup", 松)
      window.removeEventListener("keydown", 按键)
    })
  })

  return (
    <div data-component="graph" class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header data-slot="graph-head" class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-v2-border-border-muted px-3 py-2">
        <h1 class="text-[15px] font-semibold text-v2-text-text-base">关系图</h1>
        {/* 下钻是原地换中心 ⇒ tab 标题还是外面那条，得在图上把「现在中心是谁」说出来。 */}
        <Show when={中心节点()}>
          {(点) => (
            <span data-slot="graph-center" class="text-[13px] text-v2-text-text-base">
              {点().value} · {点().type}
            </span>
          )}
        </Show>
        <Show when={来路().at(-1)}>
          {(上一个) => (
            <button
              type="button"
              data-slot="graph-back"
              onClick={返回上一中心}
              class="h-6 cursor-pointer rounded-[4px] border border-v2-border-border-muted px-2 text-[12px] text-v2-text-text-base transition-colors hover:bg-v2-background-bg-layer-02"
            >
              ← 返回「{上一个().名字}」
            </button>
          )}
        </Show>
        <Show when={图()}>
          <span data-slot="graph-summary" class="text-[12px] tabular-nums text-v2-text-text-muted">
            {图()!.节点.length} 个节点 · {图()!.边.length} 条关系 · {跳数()} 跳
          </span>
        </Show>
        <div class="ml-2 flex items-center gap-1">
          <For each={[1, 2] as const}>
            {(层) => (
              <button
                type="button"
                data-slot="graph-hop"
                data-hop={层}
                aria-pressed={跳数() === 层}
                onClick={() => {
                  // 换跳数 = 换一份数据 ⇒ 下一回取到的是替换而不是并进来（用户裁定：清空重来）。
                  本次并入 = false
                  set跳数(层)
                }}
                class={
                  跳数() === 层
                    ? "h-6 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-[var(--v2-brand-gold-deep)]"
                    : "h-6 cursor-pointer rounded-[4px] px-2 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                }
              >
                {层} 跳
              </button>
            )}
          </For>
        </div>
        <div class="ml-2 flex items-center gap-1">
          <For each={排列模式们}>
            {(模式) => (
              <button
                type="button"
                data-slot="graph-layout"
                data-layout={模式}
                aria-pressed={排列() === 模式}
                onClick={() => {
                  set排列(模式)
                  // 换排列 = 换一套自动布局，手动掰过的位置不再成立（谈定口径）。
                  set手动位置({})
                }}
                class={
                  排列() === 模式
                    ? "h-6 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-[var(--v2-brand-gold-deep)]"
                    : "h-6 cursor-pointer rounded-[4px] px-2 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                }
              >
                {模式}
              </button>
            )}
          </For>
          <button
            type="button"
            data-slot="graph-relayout"
            title="回到自动布局"
            onClick={() => set手动位置({})}
            class="h-6 cursor-pointer rounded-[4px] border border-v2-border-border-muted px-2 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-layer-02"
          >
            重排
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <For each={类型们()}>
            {(类型) => (
              <button
                type="button"
                data-slot="graph-type"
                data-type={类型}
                aria-pressed={选中类型().includes(类型)}
                onClick={() => 拨类型(类型)}
                class={
                  选中类型().includes(类型)
                    ? "h-6 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-[var(--v2-brand-gold-deep)]"
                    : "h-6 cursor-pointer rounded-[4px] px-2 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                }
              >
                {`${类型} ${类型计数()[类型] ?? 0}`}
              </button>
            )}
          </For>
        </div>
      </header>

      <ContextMenu
        modal={false}
        onOpenChange={(开) => {
          // 收：作用对象一并清掉，下次右键前它不该还指向上一次那个节点。
          if (!开) set菜单点(undefined)
        }}
      >
        <ContextMenu.Trigger as="div" class="relative flex min-h-0 flex-1">
          {/* ⚠️ 门控必须挂在 Trigger **里面**这一层（同 `content-menu.tsx`）：`Trigger` 自己的
              右键处理会无条件 `preventDefault` ＋ 开菜单；`ContextMenu` 的 `open` / `defaultOpen`
              又被 Kobalte 从根 props 里 `Omit` 掉了（`ContextMenuRootOptions` 只剩
              `onOpenChange`）⇒ 没有受控开关可拦。`onContextMenu` 是 Solid 的**委托**事件
              （`web.js` 的 `DelegatedEvents` 里有 `contextmenu`），它的派发逐级上走、每级看过
              `cancelBubble`（`web.js:494`）⇒ 在这里 `stopPropagation()`，Trigger 的 handler
              就不会被调用。`contents` 不生成盒子，排布不变。 */}
          <div class="contents" onContextMenu={记右键}>
        <div
          ref={(元素) => (画布元素 = 元素)}
          data-slot="graph-canvas"
          class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-v2-background-bg-base"
        >
          <Show when={错误()}>
            {(话) => <p data-slot="graph-error" role="alert" class="p-3 text-[13px] text-v2-state-fg-danger">{话()}</p>}
          </Show>
          <Show when={载入() && 图() === undefined}>
            <p class="p-3 text-[13px] text-v2-text-text-muted">正在读取关系…</p>
          </Show>
          <Show when={图() && 图()!.边.length === 0 && 错误() === undefined}>
            <p data-slot="graph-empty" class="p-3 text-[13px] text-v2-text-text-muted">还没有关系</p>
          </Show>

          <Show when={图() && 图()!.边.length > 0}>
            <svg
              ref={(元素) => (svg元素 = 元素)}
              viewBox={`0 0 ${尺寸().宽} ${尺寸().高}`}
              preserveAspectRatio="xMidYMid meet"
              class="block h-full w-full cursor-grab select-none"
              onMouseDown={开始拖}
              onWheel={滚轮}
              onDblClick={复位视图}
              onClick={(事件) => {
                const 目标 = 事件.target
                if (目标 instanceof Element && 目标.closest("[data-slot='graph-node'],[data-slot='graph-edge']")) return
                // 拉完框浏览器还会补一个 click：那一下不能把刚选出来的多选清掉。
                if (刚拉过) {
                  刚拉过 = false
                  return
                }
                set选中(null)
                set多选([])
              }}
            >
              <g data-slot="graph-viewport" transform={`translate(${平移().x} ${平移().y}) scale(${缩放()})`}>
                <For each={图()!.边}>
                  {(行) => {
                    const 几何 = () => {
                      const 甲 = 点(行.from)
                      const 乙 = 点(行.to)
                      if (甲 === undefined || 乙 === undefined) return undefined
                      const dx = 乙.x - 甲.x
                      const dy = 乙.y - 甲.y
                      const 长 = Math.hypot(dx, dy)
                      if (长 < 0.001) return undefined
                      const ux = dx / 长
                      const uy = dy / 长
                      // 线从节点边缘起、到节点边缘止：箭头要看得见，不能埋进圆里。
                      const 起 = { x: 甲.x + ux * (节点半径(甲) + 2), y: 甲.y + uy * (节点半径(甲) + 2) }
                      const 终 = { x: 乙.x - ux * (节点半径(乙) + 5), y: 乙.y - uy * (节点半径(乙) + 5) }
                      const 基 = { x: 终.x - ux * 9, y: 终.y - uy * 9 }
                      const 法 = { x: -uy, y: ux }
                      return {
                        起,
                        终,
                        中: { x: (起.x + 终.x) / 2, y: (起.y + 终.y) / 2 },
                        箭头: [
                          `${终.x.toFixed(1)},${终.y.toFixed(1)}`,
                          `${(基.x + 法.x * 4.5).toFixed(1)},${(基.y + 法.y * 4.5).toFixed(1)}`,
                          `${(基.x - 法.x * 4.5).toFixed(1)},${(基.y - 法.y * 4.5).toFixed(1)}`,
                        ].join(" "),
                        色: 边颜色(行.type),
                        宽: 边宽(行.times),
                      }
                    }
                    return (
                      <Show when={几何()}>
                        {(几) => (
                          <g
                            data-slot="graph-edge"
                            data-edge-id={行.id}
                            opacity={边透明(行)}
                            class="cursor-pointer"
                            onClick={() => set选中({ kind: "edge", id: 行.id })}
                            onMouseEnter={() => set悬停边(行.id)}
                            onMouseLeave={() => set悬停边(undefined)}
                          >
                            <line
                              data-slot="graph-edge-line"
                              x1={几().起.x}
                              y1={几().起.y}
                              x2={几().终.x}
                              y2={几().终.y}
                              stroke={几().色}
                              stroke-width={几().宽 + (边亮(行.id) ? 1.5 : 0)}
                              stroke-opacity={边亮(行.id) ? 1 : 0.9}
                              stroke-linecap="round"
                            />
                            <polygon data-slot="graph-edge-arrow" points={几().箭头} fill={几().色} />
                            {/* 12px 的透明命中带：1px 的线用鼠标点不中。 */}
                            <line
                              data-slot="graph-edge-hit"
                              x1={几().起.x}
                              y1={几().起.y}
                              x2={几().终.x}
                              y2={几().终.y}
                              stroke="transparent"
                              stroke-width="12"
                            />
                          </g>
                        )}
                      </Show>
                    )
                  }}
                </For>

                {/* `Index` 而不是 `For`：手动位置每次 mousemove 都会产出新的对象引用，
                    `For` 按引用比对会把整排节点拆了重建（拖动的那个元素在指针底下被换掉）。 */}
                <Index each={全部点()}>
                  {(行) => (
                    <g
                      data-slot="graph-node"
                      data-node-id={行().id}
                      data-hop={行().跳数}
                      data-center={行().中心 ? "true" : "false"}
                      data-node-shape={形状(行().type)}
                      data-node-x={行().x.toFixed(1)}
                      data-node-y={行().y.toFixed(1)}
                      data-selected={多选().includes(行().id) ? "true" : "false"}
                      opacity={节点透明(行().id)}
                      class="cursor-pointer"
                      onMouseDown={(事件) => 开始拖节点(事件, 行())}
                      onClick={(事件) => {
                        // Shift + 点 = 加入/移出多选（用户 2026-11-07 谈定）：不弹面板——
                        // 要加一颗进组时不该把右侧检视面板挤出来。
                        if (事件.shiftKey) {
                          set多选((旧) =>
                            旧.includes(行().id) ? 旧.filter((条) => 条 !== 行().id) : [...旧, 行().id],
                          )
                          return
                        }
                        // 拖动后浏览器补发的 click 不是「选中」；吞掉它并把标志复位，
                        // 否则下一次真正的点击也会被误吞。
                        if (刚拖过) {
                          刚拖过 = false
                          return
                        }
                        // 点一颗 = 多选收拢成这一颗：之后拖它只动它自己。
                        set多选([])
                        set选中({ kind: "node", id: 行().id })
                        让出面板(行())
                      }}
                      onMouseEnter={() => set悬停点(行().id)}
                      onMouseLeave={() => set悬停点(undefined)}
                    >
                      <title>{行().value}</title>
                      <Show when={选中()?.kind === "node" && 选中()!.id === 行().id}>
                        <circle
                          data-slot="graph-node-focus"
                          cx={行().x}
                          cy={行().y}
                          r={节点半径(行()) + 6}
                          fill="none"
                          stroke="var(--v2-brand-gold-deep)"
                          stroke-width="1.5"
                          stroke-opacity="0.55"
                        />
                      </Show>
                      {/* 多选环比单选焦点环**紧一点、实一点**：两个环都在时要一眼分得出「组里的」和「面板在看的那颗」。 */}
                      <Show when={多选().includes(行().id)}>
                        <circle
                          data-slot="graph-node-selected"
                          cx={行().x}
                          cy={行().y}
                          r={节点半径(行()) + 3.5}
                          fill="none"
                          stroke="var(--v2-brand-gold-deep)"
                          stroke-width="2"
                          stroke-opacity="0.85"
                        />
                      </Show>
                      <图形 点={行()} 焦点={选中()?.kind === "node" && 选中()!.id === 行().id} />
                      {/* 图标压在形状正中：形状/颜色说「大类」，图标说「具体是什么」。
                          认不出类型的节点没有图标（`节点图标` 回 undefined）——形状照旧，不画空框。 */}
                      <Show when={节点图标(行())}>
                        {(名) => (
                          <节点图标组
                            名={名()}
                            x={行().x}
                            y={行().y}
                            边长={图标边长(行().中心)}
                            色={描边色(行(), 选中()?.kind === "node" && 选中()!.id === 行().id)}
                          />
                        )}
                      </Show>
                      <text
                        x={行().x}
                        y={行().y + 节点半径(行()) + 14}
                        text-anchor="middle"
                        font-size="12"
                        fill="var(--v2-text-text-base)"
                      >
                        {截断(行().value)}
                      </text>
                    </g>
                  )}
                </Index>

                {/* 拉框画在视口组里 ⇒ 用节点坐标，平移缩放时框跟着图走（否则放大后框会飘到别处）。 */}
                <Show when={拉框()}>
                  {(框) => (
                    <rect
                      data-slot="graph-marquee"
                      pointer-events="none"
                      x={Math.min(框().x0, 框().x1)}
                      y={Math.min(框().y0, 框().y1)}
                      width={Math.abs(框().x1 - 框().x0)}
                      height={Math.abs(框().y1 - 框().y0)}
                      fill="var(--v2-brand-gold-deep)"
                      fill-opacity="0.08"
                      stroke="var(--v2-brand-gold-deep)"
                      stroke-width="1"
                      stroke-dasharray="4 3"
                    />
                  )}
                </Show>

                <Show when={悬停内容()}>
                  {(详) => (
                    <g data-slot="graph-tip" class="pointer-events-none">
                      <rect
                        x={详().x}
                        y={详().y}
                        width={提示宽}
                        height={44}
                        rx="6"
                        fill="var(--v2-background-bg-base)"
                        stroke="var(--v2-border-border-base)"
                      />
                      <text x={详().x + 10} y={详().y + 18} font-size="12" font-weight="600" fill="var(--v2-text-text-base)">
                        {详().行1}
                      </text>
                      <text x={详().x + 10} y={详().y + 34} font-size="11" fill="var(--v2-text-text-muted)">
                        {详().行2}
                      </text>
                    </g>
                  )}
                </Show>
              </g>
            </svg>

            <div
              data-slot="graph-legend"
              class="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-2 gap-y-1 rounded-[4px] bg-v2-background-bg-base/90 px-2 py-1 text-[10px] text-v2-text-text-muted"
            >
              {/* 图例的图标与画布节点读同一个 `节点图标()`（只给类型名、不带细类 ⇒ 拿大类兜底那一档），
                  免得图例教一套、画布画另一套。 */}
              <span class="inline-flex items-center gap-1">
                <i class="inline-block h-2 w-2 rounded-full" style={{ background: "var(--v2-brand-gold-deep)" }} />
                中心
              </span>
              <For each={[
                ["人", "var(--v2-border-border-strong)"],
                ["号码", "var(--v2-state-border-info)"],
                ["账户", "var(--v2-state-border-success)"],
                ["虚拟身份", "var(--v2-border-border-strong)"],
                ["地点", "var(--v2-state-border-warning)"],
                ["组织", "var(--v2-border-border-strong)"],
              ] as const}>
                {([名, 色]) => {
                  const 图标 = () => 节点图标({ type: 名 })
                  return (
                    <span
                      data-slot="graph-legend-type"
                      data-type={名}
                      data-icon={图标()}
                      class="inline-flex items-center gap-1"
                    >
                      <i class="inline-block h-2 w-2 rounded-full" style={{ background: 色 }} />
                      <Show when={图标()}>
                        {(名) => (
                          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            {图标图形(名())}
                          </svg>
                        )}
                      </Show>
                      {名}
                    </span>
                  )
                }}
              </For>
            </div>

            {/* 面板浮在画布右侧（不挤画布）；缩放条跟着让开，否则被面板盖住点不到。 */}
            <div
              data-slot="graph-zoom-bar"
              class="absolute bottom-2 flex gap-1 transition-[right]"
              style={{ right: 选中() === null ? "8px" : "292px" }}
            >
              <For each={[["out", "−"], ["in", "＋"], ["fit", "适应"]] as const}>
                {([种, 标签]) => (
                  <button
                    type="button"
                    data-slot="graph-zoom"
                    data-zoom={种}
                    onClick={() => (种 === "fit" ? 复位视图() : 缩放到(缩放() * (种 === "in" ? 1.25 : 0.8), 中点()))}
                    class="h-6 cursor-pointer rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 text-[11px] text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-layer-02"
                  >
                    {标签}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={选中点()}>
          {(点) => (
            <aside
              data-slot="graph-panel"
              data-panel-kind="node"
              class="absolute inset-y-0 right-0 z-10 flex w-[280px] flex-col gap-2 overflow-y-auto border-l border-v2-border-border-muted bg-v2-background-bg-base p-3"
            >
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <div data-slot="graph-panel-title" class="truncate text-[13px] font-semibold text-v2-text-text-base">
                    {点().value}
                  </div>
                  <div data-slot="graph-panel-subtitle" class="mt-0.5 text-[11px] text-v2-text-text-muted">
                    {`${点().type}${点().subtype === undefined ? "" : ` · ${点().subtype}`} · ${点().trust_state}`}
                  </div>
                </div>
                <button
                  type="button"
                  data-slot="graph-copy-value"
                  aria-label="复制这个值"
                  onClick={() => 复制值(点())}
                  class="h-6 shrink-0 cursor-pointer rounded-[4px] px-1.5 text-[11px] transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                  classList={{
                    "text-[var(--v2-brand-gold-deep)]": 复制了() === 点().id,
                    "text-v2-text-text-muted": 复制了() !== 点().id,
                  }}
                >
                  {复制了() === 点().id ? "已复制" : "复制"}
                </button>
                <button
                  type="button"
                  data-slot="graph-panel-close"
                  aria-label="收起"
                  onClick={() => set选中(null)}
                  class="h-6 w-6 shrink-0 cursor-pointer rounded-[4px] text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                >
                  ✕
                </button>
              </div>
              <div class="text-[12px]">
                <div class="flex items-baseline justify-between gap-2 border-b border-dashed border-v2-border-border-muted py-1">
                  <span class="text-[11px] text-v2-text-text-muted">跳数</span>
                  <span class="text-v2-text-text-base">{点().中心 ? "中心" : `${点().跳数} 跳`}</span>
                </div>
                <div class="flex items-baseline justify-between gap-2 border-b border-dashed border-v2-border-border-muted py-1">
                  <span class="text-[11px] text-v2-text-text-muted">关联</span>
                  <span class="text-v2-text-text-base">{点().关联数} 条</span>
                </div>
              </div>
              <Show when={!点().中心}>
                <button
                  type="button"
                  data-slot="graph-panel-focus"
                  onClick={() => 以下钻(点())}
                  class="h-7 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-[var(--v2-brand-gold-deep)]"
                >
                  以此为中心
                </button>
              </Show>
              <button
                type="button"
                data-slot="graph-panel-open"
                data-entity-id={点().id}
                onClick={() => props.onOpenEntity(点())}
                class="h-7 cursor-pointer rounded-[4px] border border-v2-border-border-muted px-2 text-[12px] text-v2-text-text-base transition-colors hover:bg-v2-background-bg-layer-02"
              >
                打开档案
              </button>
            </aside>
          )}
        </Show>

        <Show when={选中边()}>
          {(行) => {
            const 甲 = () => 点(行().from)
            const 乙 = () => 点(行().to)
            return (
              <aside
                data-slot="graph-panel"
                data-panel-kind="edge"
                class="absolute inset-y-0 right-0 z-10 flex w-[280px] flex-col gap-2 overflow-y-auto border-l border-v2-border-border-muted bg-v2-background-bg-base p-3"
              >
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <div data-slot="graph-panel-title" class="text-[13px] font-semibold text-v2-text-text-base">
                      {行().type}
                    </div>
                    <div class="mt-0.5 text-[11px] text-v2-text-text-muted">
                      {甲()?.value ?? 行().from} → {乙()?.value ?? 行().to}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-slot="graph-panel-close"
                    aria-label="收起"
                    onClick={() => set选中(null)}
                    class="h-6 w-6 shrink-0 cursor-pointer rounded-[4px] text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                  >
                    ✕
                  </button>
                </div>
                <div class="text-[12px]">
                  <div class="flex items-baseline justify-between gap-2 border-b border-dashed border-v2-border-border-muted py-1">
                    <span class="text-[11px] text-v2-text-text-muted">次数</span>
                    <span class="text-v2-text-text-base">{`${行().times} 次`}</span>
                  </div>
                  <div class="flex items-baseline justify-between gap-2 border-b border-dashed border-v2-border-border-muted py-1">
                    <span class="text-[11px] text-v2-text-text-muted">金额</span>
                    <span class="text-v2-text-text-base">{金额文本(行().amount)}</span>
                  </div>
                  <div class="flex items-baseline justify-between gap-2 border-b border-dashed border-v2-border-border-muted py-1">
                    <span class="text-[11px] text-v2-text-text-muted">可信</span>
                    <span class="text-v2-text-text-base">{行().trust_state}</span>
                  </div>
                </div>
                <For each={[甲, 乙]}>
                  {(端) => (
                    <Show when={端()}>
                      {(头) => (
                        <button
                          type="button"
                          data-slot="graph-panel-open"
                          data-entity-id={头().id}
                          onClick={() => props.onOpenEntity(头())}
                          class="h-7 cursor-pointer truncate rounded-[4px] border border-v2-border-border-muted px-2 text-[12px] text-v2-text-text-base transition-colors hover:bg-v2-background-bg-layer-02"
                        >
                          打开档案：{头().value}
                        </button>
                      )}
                    </Show>
                  )}
                </For>
              </aside>
            )
          }}
        </Show>
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          {/* `excludedElements={[]}` 与 `session-list.tsx` / `file-tree.tsx` 是同一条：
              Kobalte 默认把触发器当成「里面」，在画布里点任何一处都收不掉菜单。 */}
          <ContextMenu.Content excludedElements={[]} data-slot="graph-node-menu">
            {/* 两项都与右侧面板那两个按钮**同源**：不新开出口，只是把路径缩短到右键。
                禁用只有一条理由：没有作用对象，或者作用对象**已经是中心**（没有可钻的下一层）。 */}
            <ContextMenu.Item
              data-action="graph-node-menu-recenter"
              disabled={菜单点() === undefined || 菜单点()!.中心}
              onSelect={() => {
                const 当前 = 菜单点()
                if (当前 !== undefined) 以下钻(当前)
              }}
            >
              <ContextMenu.ItemLabel>以此为中心</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item
              data-action="graph-node-menu-open"
              disabled={菜单点() === undefined}
              onSelect={() => {
                const 当前 = 菜单点()
                if (当前 !== undefined) props.onOpenEntity(当前)
              }}
            >
              <ContextMenu.ItemLabel>打开档案</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            {/* 「同一个手势每页都能用」（2026-11-08 用户下达）：图里的拖拽已经是整组移动，
                所以复制 / 发送落在这里。多选 ≥2 颗时带走整组，见 `带走们`。 */}
            <ContextMenu.Item
              data-action="graph-node-menu-copy"
              disabled={菜单点() === undefined}
              onSelect={() => {
                const 当前 = 菜单点()
                if (当前 !== undefined) 复制带走(当前)
              }}
            >
              <ContextMenu.ItemLabel>复制</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item
              data-action="graph-node-menu-ask"
              disabled={菜单点() === undefined}
              onSelect={() => {
                const 当前 = 菜单点()
                if (当前 !== undefined) 发到会话(带走文本(当前))
              }}
            >
              <ContextMenu.ItemLabel>发送到会话</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>

      <For each={图()?.缺口 ?? []}>
        {(话) => (
          <p data-slot="graph-gap" class="shrink-0 border-t border-v2-border-border-muted px-3 py-1 text-[12px] text-v2-state-fg-warning">
            {话}
          </p>
        )}
      </For>
    </div>
  )
}
