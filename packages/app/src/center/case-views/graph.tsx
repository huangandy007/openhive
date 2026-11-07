import { createEffect, createMemo, createSignal, For, Index, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import type { CaseDetailApi, 图边, 图节点, 关系图结果 } from "../case-detail-api"
import { 金额文本 } from "./format"

export interface GraphProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
  readonly onOpenEntity: (点: 图节点) => void
  /** 「以此为中心」：上层换一张 graph 视图（`arg` = 新实体 id）。省略则不出这个按钮。 */
  readonly onRecenter?: (点: 图节点) => void
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

/** 关系类型配色：只用语义槽位（暗色主题会自己翻），不新造色。 */
function 边颜色(类型: string): string {
  if (类型 === "通话") return "var(--v2-state-border-info)"
  if (类型 === "转账") return "var(--v2-brand-gold)"
  if (类型 === "实际使用") return "var(--v2-text-text-muted)"
  return "var(--v2-border-border-strong)"
}

/** 次数分三档：不写次数的细线、个位数的中线、两位以上的粗线——粗到能直接比大小。 */
function 边宽(次数: number | null): number {
  if (次数 === null) return 1.5
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
  const 填充色 = () => (props.焦点 ? "var(--v2-background-bg-accent-soft)" : 填充(props.点))
  const 描边色 = () => (props.焦点 ? "var(--v2-brand-gold-deep)" : 描边(props.点))
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
          stroke={描边色()}
          stroke-width={线宽()}
          stroke-dasharray={虚线()}
        />
      </Match>
      <Match when={形状(props.点.type) === "hexagon"}>
        <polygon
          data-slot="graph-node-shape"
          points={多边形(props.点, 半(), 6, -Math.PI / 2)}
          fill={填充色()}
          stroke={描边色()}
          stroke-width={线宽()}
          stroke-dasharray={虚线()}
        />
      </Match>
      <Match when={形状(props.点.type) === "diamond"}>
        <polygon
          data-slot="graph-node-shape"
          points={多边形(props.点, 半(), 4, -Math.PI / 2)}
          fill={填充色()}
          stroke={描边色()}
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
          stroke={描边色()}
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
  const [跳数, set跳数] = createSignal<1 | 2>(1)
  const [选中类型, set选中类型] = createSignal<readonly string[]>([])
  /** 见过的每种关系类型出现过的最大条数：服务端按类型过滤后别的类型会消失，计数得留着（否则按钮跟着没了）。 */
  const [类型计数, set类型计数] = createSignal<Record<string, number>>({})
  const [悬停点, set悬停点] = createSignal<string | undefined>()
  const [悬停边, set悬停边] = createSignal<string | undefined>()
  const [选中, set选中] = createSignal<选中项 | null>(null)
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
        set跳数(1)
        set选中类型([])
        set类型计数({})
        set选中(null)
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
    const id = props.id
    const api = props.api
    const 当前跳数 = 跳数()
    const 当前类型 = 选中类型()
    set图(undefined)
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
        set图(回.value)
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

  // 数据刷新后选中项可能已经不在了（换跳数、换筛选都会走到这里）——面板不能继续显示一个图里没有的节点。
  createEffect(() => {
    const 当前 = 选中()
    if (当前 === null) return
    const 还在 = 当前.kind === "node" ? (图()?.节点 ?? []).some((行) => 行.id === 当前.id) : (图()?.边 ?? []).some((行) => 行.id === 当前.id)
    if (!还在) set选中(null)
  })

  const 选中点 = createMemo(() => {
    const 当前 = 选中()
    return 当前?.kind === "node" ? 点(当前.id) : undefined
  })
  const 选中边 = createMemo(() => {
    const 当前 = 选中()
    return 当前?.kind === "edge" ? 边(当前.id) : undefined
  })

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
        行2: `${行.trust_state} · 关联 ${行.关联数}`,
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
        行1: `${行.type}${行.times === null ? "" : ` · ${行.times} 次`}`,
        行2: `${金额文本(行.amount)} · ${甲.value} → ${乙.value}`,
      }
    }
    return undefined
  })

  const 类型们 = createMemo(() => Object.keys(类型计数()).sort((甲, 乙) => 甲.localeCompare(乙)))

  const 拨类型 = (类型: string) => {
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

  const 滚轮 = (事件: WheelEvent) => {
    事件.preventDefault()
    const 矩 = svg元素?.getBoundingClientRect()
    const 有尺寸 = 矩 !== undefined && 矩.width > 0 && 矩.height > 0
    const 比例 = 有尺寸 ? Math.min(矩.width / 尺寸().宽, 矩.height / 尺寸().高) || 1 : 1
    const 偏x = 有尺寸 ? 矩.left + (矩.width - 尺寸().宽 * 比例) / 2 : 0
    const 偏y = 有尺寸 ? 矩.top + (矩.height - 尺寸().高 * 比例) / 2 : 0
    // viewBox 里的坐标（未变换）：缩放公式要的是「光标此刻指着的内容点」在变换前的坐标。
    const 游标 = 有尺寸 ? { x: (事件.clientX - 偏x) / 比例, y: (事件.clientY - 偏y) / 比例 } : 中点()
    缩放到(缩放() * (事件.deltaY < 0 ? 1.15 : 1 / 1.15), 游标)
  }

  let 拖: { 起x: number; 起y: number; 原x: number; 原y: number; 比例: number } | undefined

  /** 节点拖动：mousedown 落在节点上时接管，走「移动该节点」而不是「平移画布」。 */
  let 拖节点:
    | { id: string; 起x: number; 起y: number; 原x: number; 原y: number; 比例: number; 移动: boolean }
    | undefined
  /** 拖动结束浏览器还会补一个 click；用它把「拖」和「点选」分开（面板不该在拖完时弹出来）。 */
  let 刚拖过 = false

  const 开始拖节点 = (事件: MouseEvent, 行: 位点) => {
    if (事件.button !== 0) return
    const 矩 = svg元素?.getBoundingClientRect()
    const 比例 = 矩 !== undefined && 矩.width > 0 && 矩.height > 0 ? Math.min(矩.width / 尺寸().宽, 矩.height / 尺寸().高) || 1 : 1
    刚拖过 = false
    拖节点 = { id: 行.id, 起x: 事件.clientX, 起y: 事件.clientY, 原x: 行.x, 原y: 行.y, 比例, 移动: false }
  }

  const 开始拖 = (事件: MouseEvent) => {
    if (事件.button !== 0) return
    const 目标 = 事件.target
    if (目标 instanceof Element && 目标.closest("[data-slot='graph-node'],[data-slot='graph-edge'],[data-slot='graph-zoom-bar'],[data-slot='graph-legend']")) return
    const 矩 = svg元素?.getBoundingClientRect()
    const 比例 = 矩 !== undefined && 矩.width > 0 && 矩.height > 0 ? Math.min(矩.width / 尺寸().宽, 矩.height / 尺寸().高) || 1 : 1
    const 原 = 平移()
    拖 = { 起x: 事件.clientX, 起y: 事件.clientY, 原x: 原.x, 原y: 原.y, 比例 }
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
        // 屏幕位移 ÷（画布缩放 × 视图缩放）= viewBox 位移。
        const 比 = 节点.比例 * 缩放()
        set手动位置({
          ...手动位置(),
          [节点.id]: { x: 节点.原x + 屏x / 比, y: 节点.原y + 屏y / 比 },
        })
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
      拖 = undefined
    }
    const 按键 = (事件: KeyboardEvent) => {
      if (事件.key !== "Escape") return
      set选中(null)
      set悬停点(undefined)
      set悬停边(undefined)
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
                onClick={() => set跳数(层)}
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

      <div class="relative flex min-h-0 flex-1">
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
                set选中(null)
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
                      opacity={节点透明(行().id)}
                      class="cursor-pointer"
                      onMouseDown={(事件) => 开始拖节点(事件, 行())}
                      onClick={() => {
                        // 拖动后浏览器补发的 click 不是「选中」；吞掉它并把标志复位，
                        // 否则下一次真正的点击也会被误吞。
                        if (刚拖过) {
                          刚拖过 = false
                          return
                        }
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
                      <图形 点={行()} 焦点={选中()?.kind === "node" && 选中()!.id === 行().id} />
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
              <For each={[["中心", "var(--v2-brand-gold-deep)"], ["人", "var(--v2-border-border-strong)"], ["号码", "var(--v2-state-border-info)"], ["账户", "var(--v2-state-border-success)"], ["地点", "var(--v2-state-border-warning)"]] as const}>
                {([名, 色]) => (
                  <span class="inline-flex items-center gap-1">
                    <i class="inline-block h-2 w-2 rounded-full" style={{ background: 色 }} />
                    {名}
                  </span>
                )}
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
                  <div class="mt-0.5 text-[11px] text-v2-text-text-muted">
                    {点().type} · {点().trust_state}
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
                  <span class="text-[11px] text-v2-text-text-muted">跳数</span>
                  <span class="text-v2-text-text-base">{点().中心 ? "中心" : `${点().跳数} 跳`}</span>
                </div>
                <div class="flex items-baseline justify-between gap-2 border-b border-dashed border-v2-border-border-muted py-1">
                  <span class="text-[11px] text-v2-text-text-muted">关联</span>
                  <span class="text-v2-text-text-base">{点().关联数} 条</span>
                </div>
              </div>
              <Show when={!点().中心 && props.onRecenter !== undefined}>
                <button
                  type="button"
                  data-slot="graph-panel-focus"
                  onClick={() => props.onRecenter?.(点())}
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
                    <span class="text-v2-text-text-base">{行().times === null ? "—" : `${行().times} 次`}</span>
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
