/**
 * `.hgraph` 画布（012 · T009b）。
 *
 * 只做**渲染 + 指针/键盘事件**：文档、保存、撤销栈都在 `editor.tsx`；本组件收到
 * `{ 文档, 选中, 模式, 动作 }`，把用户意图翻译成 `动作` 回调，不自己改文档。几何一律调
 * `geometry.ts`（`连线目标` / `框选命中`），不在这里另算一份（`#002-06`）。
 *
 * ## 两条交互口径（FR-019 / FR-020 / FR-022）
 *
 * - **指针模式**：拖节点 = 移动，永不建边；拖空白 = 框选（`Shift` = 追加选中）。
 * - **平移画布**：空格 + 拖 / 中键拖 / 双指（触控板**横向分量占优**的滚动，设计 §5.15）；
 *   空白拖**不再**平移（FR-020）。空格按住 = 容器光标 `grab`，拖动中 `grabbing`。
 * - **连线模式**：从节点拖到另一节点 = 加边；拖到空白**不建边**（`连线目标` 返回 `null`）；
 *   空白拖同样是框选（平移仍走空格 / 中键 / 双指）。
 * - 锁定节点（`锁定: true`）：不可拖动、不被框选命中（后者由 `框选命中` 保证）、也不进
 *   整组拖动；点选与删除这类显式命令仍可用（data-model §3）。
 * - 拖动中只改本地 `拖影`，**松手时才**发一次 `移动`（T009「拖动只在 dragend 进待发」）。
 *
 * ## 键盘只挂画布容器（FR-040）
 *
 * 容器 `tabindex="0"`；**不** `window.addEventListener`。焦点在输入框（文字编辑）时整段
 * 提前返回，画布快捷键不生效（contracts/ui.md §4）。
 *
 * ## 坐标换算可注入
 *
 * happy-dom 没有真实布局：`getBoundingClientRect()` 恒 0（`#005-32` / `#006-30` /
 * `#006-06`）。因此「屏幕坐标 → 画布坐标」是入参 `坐标换算`；默认实现读容器矩形 +
 * 当前视口，测试注入恒等/线性映射。注意注入函数的返回值是**内容坐标**（已逆过视口变换）。
 */
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { 是事件节点, type 边, type 图文件, type 节点, type 文字 } from "./file"
import { 边线型 } from "./edge"
import {
  适配视口,
  截断标签,
  标签取舍,
  框选命中,
  连线目标,
  边档,
  边偏移,
  平行边序 as 算平行边序,
  线宽像素,
  外环档表,
  type 矩形,
  type 视口变换,
  type 对齐边,
  type 等距轴,
} from "./geometry"
import { 图例 } from "./legend"
import { 字号像素, 折行行们 } from "./text-fold"
import { 形状, 多边形, 面板让位平移x, 面板宽, 面板边距, type 位点 } from "../graph"
import type { 排列模式 } from "../graph-layout"

/** 服务端放置的同一块画布（`hgraph-edit.ts` 760×680）；节点半径同源 15。 */
const 画布宽 = 760
const 画布高 = 680
const 节点半径 = 15
/** 手抖 1px 不算拖动（同 `graph.tsx` 的死区），否则「点一下看选中」会变成「挪半步」。 */
const 拖动阈值 = 3

/**
 * 事件卡（FR-056）：尺寸**固定 96×34、rx=6**，不做随名伸缩——几何与命中测试都按这个
 * 固定盒子算，伸缩会让两者一起漂。`data-node-shape="event-card"` 是契约槽位。
 */
const 事件卡宽 = 96
const 事件卡高 = 34
const 事件卡圆角 = 6

/** 读保留属性键（`金额` / `时间精度`）；空串按缺失处理，不把空值拼进文案。 */
const 属性值 = (点: 节点, 键: string): string | undefined => {
  const 值 = (点.属性 ?? []).find((行) => 行.键 === 键)?.值
  return typeof 值 === "string" && 值 !== "" ? 值 : undefined
}

/**
 * 事件卡第一行：`类型首字 · 金额`；无金额 ⇒ 只显示类型首字（FR-056）。
 * 首字按码点取（同节点首字：`Array.from`，`slice` 会劈开补充平面字符）。
 */
function 事件卡首行(点: 节点): string {
  const 首字 = Array.from(点.类型 ?? "")[0] ?? ""
  const 金额 = 属性值(点, "金额")
  return 金额 === undefined ? 首字 : `${首字} · ${金额}`
}

/**
 * 事件卡第二行：`时间.首` 按 `时间精度` 渲染——日 → `MM-DD`；时 → `MM-DD HH时`；
 * 分 / 未标 → `MM-DD HH:mm`（FR-056）。
 *
 * 只切字符串、不走 `Date`：后者会把时间按本地时区挪一遍（同 `format.ts` 的口径），
 * 卡片上显示的必须就是文件里那个时刻。原文连日期都认不出 ⇒ 原样吐回，不编时刻；
 * 精度要时分而原文只到日 ⇒ 只出日期（补 `00:00` 等于替数据编一个时刻）。
 */
function 事件卡次行(点: 节点): string {
  const 原文 = (点.时间?.首 ?? "").trim()
  const 匹配 = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(原文)
  if (匹配 === null) return 原文
  const [, , 月, 日, 时, 分] = 匹配
  const 日期 = `${月}-${日}`
  const 精度 = 属性值(点, "时间精度")
  if (精度 === "日") return 日期
  if (时 === undefined || 分 === undefined) return 日期
  if (精度 === "时") return `${日期} ${时}时`
  return `${日期} ${时}:${分}`
}

/**
 * `多边形` 只读 `x/y`，但入参类型是完整 `位点`（`图节点` + 坐标）；节点组已平移到中心，
 * 这里只需一个原点壳。`graph.tsx` 只加 export、不改签名（`#002-06`：形状映射唯一出处）。
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 多边形 只读 x/y；上游签名要完整 图节点，没有值可收窄
const 原点壳 = { x: 0, y: 0 } as 位点

/**
 * 画布内嵌界面（菜单 / 图例 / 表单控件）：指针与双击落到它们身上都不算「点空白画布」。
 * 图例的折叠入口是 `<g role="button">`，`button` 选择器匹配不到，必须按 `data-slot` 认；
 * 漏掉它会让点图例清空选中、双击图例真加一个节点、拖图例平移画布。
 */
const 内嵌界面 = "[data-slot='hgraph-menu'], [data-slot='hgraph-legend'], button, input, textarea, select"

/** 事件目标是否落在内嵌界面里（按下与双击共用这一处判断，`#002-06`）。 */
const 落在内嵌界面 = (目标: EventTarget | null) =>
  目标 instanceof Element && 目标.closest(内嵌界面) !== null

/**
 * 滚轮是否来自触控板双指平移（设计 §5.15）：平移 = 空格 + 拖 / 中键拖 / **双指**。
 * 判据：没有 Ctrl（Ctrl + 滚轮是捏合缩放），且**横向分量占优**
 * （`|deltaX| > |deltaY|`）——触控板纵向滑动（含精密触控板的 3.75 这类小数档）归缩放，
 * 不能因为「纵向不是整数」就被误判成平移。真机触控板无法在本机自动化验证，单测只钉判定式。
 */
export function 是双指平移(事件: { readonly deltaX: number; readonly deltaY: number; readonly ctrlKey?: boolean }): boolean {
  return 事件.ctrlKey !== true && Math.abs(事件.deltaX) > Math.abs(事件.deltaY)
}

/**
 * 文字预设色表（data-model §4：`颜色` 存的是**预设色名**，不是 CSS 值）。
 * 检查器「文字」段的颜色下拉复用这一份（`#002-06`：色名 → 主题槽位只写一处）。
 * 查不到（含空 / 自由色名）⇒ 默认色，与 `外环色表` 同一兜底口径。
 */
const 默认文字色 = "var(--v2-text-text-base)"
export const 文字色表: Readonly<Record<string, string>> = {
  默认: 默认文字色,
  黑: 默认文字色,
  红: "var(--v2-state-fg-danger)",
  橙: "var(--v2-state-fg-warning)",
  绿: "var(--v2-state-fg-success)",
  蓝: "var(--v2-state-fg-info)",
  金: "var(--v2-brand-gold-deep)",
  灰: "var(--v2-text-text-muted)",
}

/** 预设色名 → CSS 值；未知 / 空 ⇒ 默认色（不把色名直接当 CSS 值填进 `fill`）。 */
export function 文字色(颜色: string | undefined): string {
  return 文字色表[颜色 ?? ""] ?? 默认文字色
}

export type 模式 = "指针" | "连线"

export type 坐标换算 = (屏幕: { readonly clientX: number; readonly clientY: number }) => {
  readonly x: number
  readonly y: number
}

export interface 移动目标 {
  readonly 类别: "节点" | "文字"
  readonly id: string
  readonly x: number
  readonly y: number
}

/**
 * 动作表（contracts/ui.md §3）：工具栏 / 右键菜单 / 快捷键 / 检查器**共用这一个对象**。
 * 画布只会调用它，不自己拼 `操作[]`、不直接写盘（T010 的单一出口）。
 *
 * T010 在 T009b 的最小表（拖拽/连线/文字）之上**追加**条目，既有条目名字与语义不动；
 * `改字段` 的类别从「文字」放宽到三类，仍是一张表里的一条（契约 §3 的 `改字段(类别, id, 补丁)`）。
 */
export interface 画布动作 {
  readonly 选择: (ids: readonly string[], 追加: boolean) => void
  readonly 移动: (目标: readonly 移动目标[]) => void
  readonly 加边: (从: string, 到: string) => void
  /**
   * 给已有边补依据（R-F12 / R-F1 的 UI 一半）：检查器把一条缺依据/可信度的边改成推断时，
   * 走连线浮层收必填项——**不直接发 `改字段`**（否则必被 `校验来源` 拒）。省略 = 这个壳
   * 没有浮层（拼装测试）；检查器据此置灰并说明，不半成品执行。
   */
  readonly 补依据?: (边id: string) => void
  readonly 加文字: (x: number, y: number) => void
  readonly 改字段: (类别: "节点" | "边" | "文字", id: string, 补丁: Record<string, unknown>) => void
  readonly 删对象: (目标: readonly { readonly 类别: "节点" | "边" | "文字"; readonly id: string }[]) => void
  readonly 撤销: () => void
  readonly 重做: () => void
  readonly 切换模式: (模式: 模式) => void
  /** 省略位置 ⇒ 编辑器按画布中心 + 既有节点数做阶梯偏移（R29）。 */
  readonly 加节点: (位置?: { readonly x: number; readonly y: number }) => void
  /**
   * 加手写事件（T012 / FR-025）：工具栏与右键空白是**同一个动作**，只差落点
   * （工具栏省略位置 ⇒ 画布中心；右键传右键点的内容坐标）。
   */
  readonly 加事件?: (位置?: { readonly x: number; readonly y: number }) => void
  readonly 删除所选: () => void
  /** `undefined` = 收起改名输入框（Esc / 提交后），不产生操作。 */
  readonly 重命名: (id: string | undefined) => void
  readonly 锁定切换: (ids: readonly string[]) => void
  readonly 对齐: (边: 对齐边, ids: readonly string[]) => void
  readonly 等距: (轴: 等距轴, ids: readonly string[]) => void
  readonly 自动布局: (模式?: 排列模式) => void
  /**
   * 演示态是**本地展示态**（T011）：切换信号在编辑器，不产生任何 `操作[]`、不进撤销栈。
   * 工具栏「演示」按钮与 `Esc` 都落这一条（contracts/ui.md §3）。
   */
  readonly 演示切换: () => void
  /**
   * 打开「从库加入」选择器（T014）：也是本地动作——开的是编辑器里的覆盖面板，
   * 只有真正「加入」时才经 `应用` 进一个批次。省略 = 这个壳没有库接缝（拼装测试）。
   */
  readonly 从库加入?: () => void
  /**
   * 导出面板（T015）：同样是本地动作——开的是编辑器里的选项面板，不写文件、不进撤销栈。
   * 真正出图在编辑器点「导出」时经 `导出PNG`（R64）。
   */
  readonly 导出面板切换?: () => void
  /**
   * 合并所选节点（T016b）：只弹编辑器里的确认条，真正写盘在「确定」之后。选中节点 < 2
   * 时编辑器自己忽略；工具栏按钮也按同一判据 disabled。
   */
  readonly 合并?: () => void
  /** `Ctrl+C`（T016b）：把当前选中节点（与两端都在选区内的边）记成实例内快照，不写盘。 */
  readonly 复制?: () => void
  /** `Ctrl+V`（T016b）：粘贴剪贴板快照，偏移 24；剪贴板为空/源对象已不存在 ⇒ 不发。 */
  readonly 粘贴?: () => void
  /**
   * `Ctrl+D` 与 `Alt+拖`（T016b）：复制当前选中（偏移 0 或调用方给的偏移），返回新节点的
   * **临时 id**（按文档顺序，供画布把拖动目标切到副本）；复制不出来返回空数组。
   */
  readonly 复制所选?: (偏移?: number) => readonly string[]
  /**
   * 隔离（T017b / R72）：把选区扩成「1 跳邻居」集合并只渲染它。工具栏 / 右键菜单都只调
   * 这一条，画布不自己算可见集合。
   */
  readonly 只看邻居?: (ids: readonly string[]) => void
  /** 退出隔离（R103）：隔离覆盖全图时角落条（N=0）不渲染，工具栏是唯一退出入口。 */
  readonly 退出隔离?: () => void
  /** 查找路径（T017b / R72）：选中恰 2 节点时本地 BFS，结果只改选中与面板，不写盘。 */
  readonly 查找路径?: () => void
  /** 适配全部（T017b / R70）：递增 `适配请求`，视口仍在画布里落地。 */
  readonly 适配全部?: () => void
  /** 「显示全部标签」开关（T017b / R71）：>800 节点时工具栏提供，强制打开标签。 */
  readonly 显示全部标签切换?: () => void
}

export interface 画布Props {
  readonly 文档: 图文件
  readonly 选中: readonly string[]
  readonly 模式: 模式
  readonly 坐标换算?: 坐标换算
  /**
   * 屏幕坐标 → 命中元素（T007 / FR-013 测试缝）。默认 `document.elementFromPoint`；
   * happy-dom 无布局、它恒返回 `null`（20.12.0 实测），组件测试只能注入。
   */
  readonly 屏幕命中?: (x: number, y: number) => Element | null
  readonly 动作: 画布动作
  /** 正在内联改名的节点 id；由编辑器的 `重命名` 动作设置。 */
  readonly 重命名id?: string
  /**
   * 递增即收起右键菜单。由编辑器的共同父容器在点到菜单外时驱动——画布自己的
   * `pointerdown` 只覆盖画布内部，工具栏 / 检查器上的点击收不到（I1）。
   * 仍是组件内监听：不挂 `window`（FR-040）。
   */
  readonly 收起菜单?: number
  /**
   * 只读（T011 演示态）：忽略 pointerdown / keydown / dblclick / contextmenu，且不渲染
   * 画布 chrome 按钮。演示键盘归舞台容器（`hgraph-stage`，FR-040：快捷键只挂容器）。
   */
  readonly 只读?: true
  /**
   * 可见集合（`演示步进` / 编辑器隔离·筛选的输出）：渲染按它过滤；编辑态的框选
   * **也按它求交**（R72/T017b 修复轮 1）——否则隔离后能框选到几何上落在框内但不可见
   * 的节点，随后 Delete/对齐会作用到用户看不见的对象。命中与连线目标仍按文档计算
   * （点在节点的可见几何上，隐藏节点不参与命中）。不传 = 全显。`文字` 不参与（R35）。
   */
  readonly 可见?: { readonly 节点: ReadonlySet<string>; readonly 边: ReadonlySet<string> }
  /**
   * 递增即把焦点还给画布容器（I1）。退出演示时由编辑器驱动，恢复编辑快捷键的落点；
   * 仍是组件内监听/组件自身聚焦：不挂 `window`（FR-040）。
   */
  readonly 聚焦请求?: number
  /**
   * 居中 / 适配请求（T017b / R70）：视口归画布，编辑器只递增序号驱动，**不**把视口状态
   * 提上去（T011 已确认同一画布实例是视口保持的唯一机制）。
   * - `居中请求` 序号变化 ⇒ 该节点落 viewBox 中心，缩放不变；
   * - `适配请求` 序号变化 ⇒ `适配视口(适配目标 ?? 全部节点, {宽:760, 高:680})`。
   */
  readonly 居中请求?: { readonly id: string; readonly 序号: number }
  readonly 适配请求?: number
  readonly 适配目标?: readonly string[]
  /**
   * 检查器让位（T008 / FR-015）：编辑器在**选中变化**时递增 `序号`，画布只在序号变化时
   * 平移一次——拖动改的是文档坐标，不改请求，所以视口不会持续跟随。
   * 对象本来就落在未覆盖区 ⇒ 不动画面。
   */
  readonly 让位请求?: { readonly id: string; readonly 序号: number }
  /**
   * 检查器当前在**屏幕上**占用的宽度（CSS px，T008 / FR-015）：编辑器按状态给值
   * （展开 320 / 收起 40 / 未选中 0）。视口是 viewBox 单位，画布按容器缩放比换算，
   * 不再假定「1 CSS px = 1 viewBox 单位」。省略 = 320（历史行为）。
   */
  readonly 检查器宽?: number
  /**
   * 容器尺寸测试缝（T008 fix1）：happy-dom 无布局、`getBoundingClientRect()` 恒 0，
   * 量不出 viewBox → 容器的缩放比。省略时量真实容器；量不到按 1:1。
   */
  readonly 容器尺寸?: { readonly 宽: number; readonly 高: number }
  /**
   * 标签分级的 `开`（T017b / R71）：`false` ⇒ 只留选中与悬停（>800 节点默认关标签的落点）；
   * `undefined` ⇒ 按缩放档位取舍。`true` = 工具栏强制打开。
   */
  readonly 标签开?: boolean
  /**
   * 运动帧（拖动 / 滚轮 / 平移）停止后恢复标签的延迟（毫秒），默认 200（R71）。
   * 测试缝：用真实计时会让用例等到 200ms 以上。
   */
  readonly 恢复毫秒?: number
  /**
   * 外环自动档表（T018 / R105）：节点 id → 档（0..4）。编辑器用 `外环档表` 算好传入。
   * 它同时决定外环粗细与 0.3–0.6 缩放下的标签放行（R75）；环另有一条自算兜底（导出 /
   * 演示直接挂画布时也要有环），标签放行只认这个入参。算法唯一定义在 `geometry.ts`
   * 的 `外环档表`（`#002-06`），不要在这里另写「度数 → 档」。
   */
  readonly 档表?: ReadonlyMap<string, number>
  /**
   * 图例初始收起（T018 / R74）：编辑器演示态传 `true`（设计 §5.14 演示态隐藏图例）；
   * T015 的隐藏只读渲染不传 ⇒ 导出永远含展开图例。
   */
  readonly 图例初始收起?: boolean
}

/** 默认换算：容器矩形 → viewBox（`xMidYMid meet`）→ 逆视口变换。 */
function 默认换算(容器: HTMLElement | undefined, 视口: 视口变换): 坐标换算 {
  return (屏幕) => {
    const 矩 = 容器?.getBoundingClientRect()
    const 比 = 矩 !== undefined && 矩.width > 0 && 矩.height > 0 ? Math.min(矩.width / 画布宽, 矩.height / 画布高) : 0
    const 视x = 比 > 0 ? (屏幕.clientX - (矩!.left + (矩!.width - 画布宽 * 比) / 2)) / 比 : 屏幕.clientX
    const 视y = 比 > 0 ? (屏幕.clientY - (矩!.top + (矩!.height - 画布高 * 比) / 2)) / 比 : 屏幕.clientY
    return { x: (视x - 视口.x) / 视口.缩放, y: (视y - 视口.y) / 视口.缩放 }
  }
}

/**
 * 指针落点元素上读属性（`closest` 覆盖节点组内的圆 / 首字 / 名字标签）。
 * 按下取事件目标、松手取 `elementFromPoint` 的结果——**同一处判据**（T007 / FR-013）。
 */
function 读属性(目标: EventTarget | null, 名: string): string | undefined {
  if (!(目标 instanceof Element)) return undefined
  return 目标.closest(`[${名}]`)?.getAttribute(名) ?? undefined
}

/**
 * 坐标兜底：`解析图` 是**读放宽**的（只做版本闸 + 形状闸），缺 `x/y` 的文件也打得开。
 * 画布不能因为缺字段就整块崩掉，落在 0 上照显、由检查器补值。
 */
function 数(值: unknown): number {
  return typeof 值 === "number" && Number.isFinite(值) ? 值 : 0
}

type 对象拖 = {
  类型: "对象"
  类别: "节点" | "文字"
  id: string
  起点屏x: number
  起点屏y: number
  起点x: number
  起点y: number
  shift: boolean
  已选中: boolean
  可拖: boolean
  组: readonly { readonly id: string; readonly x: number; readonly y: number }[]
  移动: boolean
}

type 指针态 =
  | 对象拖
  | { 类型: "画布"; 起点屏x: number; 起点屏y: number; 起点x: number; 起点y: number; 原视口: 视口变换; 移动: boolean }
  | {
      类型: "框选"
      起点屏x: number
      起点屏y: number
      起点x: number
      起点y: number
      /** FR-020：按下时按住 Shift = 与已有选中取并集（追加），否则替换。 */
      追加: boolean
      移动: boolean
    }
  | { 类型: "连线"; 从: string; 起点屏x: number; 起点屏y: number; 移动: boolean }
  /**
   * 边点选（R-F12 前置）：边不可拖、不平移，`移动中` 只置标记；`松开` 才落选中
   * （Shift = 在选中集里切换）。与节点/文字共用「按下—松开」的阈值判定。
   */
  | { 类型: "边选"; id: string; shift: boolean; 移动: boolean }

/** 右键菜单的落点：四类入口（FR-025）；空白额外带内容坐标（加节点用）。 */
type 菜单目标 =
  | { readonly 类型: "节点" | "边" | "文字"; readonly id: string; readonly x: number; readonly y: number }
  | {
      readonly 类型: "空白"
      readonly x: number
      readonly y: number
      readonly 内容x: number
      readonly 内容y: number
    }

export function 画布(props: 画布Props): JSX.Element {
  let 容器: HTMLDivElement | undefined
  const [视口, set视口] = createSignal<视口变换>({ 缩放: 1, x: 0, y: 0 })
  const [拖影, set拖影] = createSignal<ReadonlyMap<string, { readonly x: number; readonly y: number }>>(new Map())
  const [框, set框] = createSignal<矩形 | undefined>()
  const [连线落点, set连线落点] = createSignal<{ 从: string; x: number; y: number } | undefined>()
  /** 连线松手落空提示（T007 / FR-013）：下次按下或成功连边时清掉，不常驻。 */
  const [松手提示, set松手提示] = createSignal<string | undefined>()
  const [编辑id, set编辑id] = createSignal<string | undefined>()
  const [编辑值, set编辑值] = createSignal("")
  const [菜单, set菜单] = createSignal<菜单目标 | undefined>()

  let 指针: 指针态 | undefined
  /**
   * 空格按住 = 平移态（FR-020 / 设计 §5.15）。用信号：按下瞬间要读它决定平移还是框选，
   * 同时它也是容器光标的输入（`grab`）。键抬起（`onKeyUp`）与容器失焦（`onBlur`）
   * 都清零，避免空格丢在别处后永久平移。
   */
  const [空格按下, set空格按下] = createSignal(false)
  /** 空格式平移正在进行（pointerdown → pointerup）：光标 `grabbing`，松手回 `grab`。 */
  const [平移中, set平移中] = createSignal(false)
  /** 容器光标：平移中 `grabbing` > 空格按住 `grab` > 默认。 */
  const 光标 = () => (平移中() ? "grabbing" : 空格按下() ? "grab" : "default")
  /** 改名输入的收尾锁：Enter 提交后移除输入框会再触发一次 blur，不能提交两遍。 */
  let 改名收尾 = false
  createEffect(() => {
    props.重命名id
    改名收尾 = false
  })

  /** 外部（共同父容器）点到菜单外 ⇒ 收起；递增计数变化即触发。 */
  createEffect(() => {
    props.收起菜单
    set菜单(undefined)
  })

  /**
   * 退出演示时把焦点还给画布（I1）：`聚焦请求` 由编辑器在退出时递增。
   * `queueMicrotask` 等同一轮更新把 `tabindex` 落回容器（只读时容器不可聚焦）再 focus。
   * 只在请求值变化时执行，避免挂载时抢焦点；不挂 `window`（FR-040）。
   */
  let 上次聚焦 = props.聚焦请求
  /**
   * 退出演示后的第一次 Esc 可能是「退出那下」的按键重复 / 快速连按：此刻焦点刚回到画布，
   * 照常走 Escape 分支会把进入演示前的编辑态选中清掉。一次性吞掉紧随其后的 Esc。
   */
  let 忽略退出键 = false
  createEffect(() => {
    const 请求 = props.聚焦请求
    if (请求 === undefined || 请求 === 上次聚焦) return
    上次聚焦 = 请求
    忽略退出键 = true
    queueMicrotask(() => {
      if (props.只读 !== true) 容器?.focus()
    })
  })

  // --- T017b（R70/R71）：视口请求 + 标签分级 + 运动帧 -----------------------------------------

  /** 悬停节点（R71）：低缩放下悬停也显示它自己的标签。 */
  const [悬停id, set悬停id] = createSignal<string | undefined>()
  /** 运动帧（拖动 / 滚轮 / 平移中）：标签全隐，停下后 `恢复毫秒` 再恢复。 */
  const [运动中, set运动中] = createSignal(false)
  let 恢复计时: ReturnType<typeof setTimeout> | undefined
  const 开始运动 = () => {
    if (恢复计时 !== undefined) {
      clearTimeout(恢复计时)
      恢复计时 = undefined
    }
    set运动中(true)
  }
  const 结束运动 = () => {
    if (恢复计时 !== undefined) clearTimeout(恢复计时)
    恢复计时 = setTimeout(() => {
      恢复计时 = undefined
      set运动中(false)
    }, props.恢复毫秒 ?? 200)
  }
  // `#005-03`：卸载后别让定时器再去写信号。
  onCleanup(() => {
    if (恢复计时 !== undefined) clearTimeout(恢复计时)
  })

  /** 居中：只平移，缩放不变；序号相同不重放（滚轮/平移改了视口也不重跑）。 */
  let 上次居中: number | undefined
  createEffect(() => {
    const 请求 = props.居中请求
    if (请求 === undefined || 请求.序号 === 上次居中) return
    上次居中 = 请求.序号
    const 点 = props.文档.节点.find((行) => 行.id === 请求.id)
    if (点 === undefined) return
    const 缩放 = 视口().缩放
    set视口({ 缩放, x: 画布宽 / 2 - 数(点.x) * 缩放, y: 画布高 / 2 - 数(点.y) * 缩放 })
  })

  /** 适配：`适配视口` 口径与留白归 geometry.ts；空目标 = 全部节点。 */
  let 上次适配: number | undefined
  createEffect(() => {
    const 请求 = props.适配请求
    if (请求 === undefined || 请求 === 上次适配) return
    上次适配 = 请求
    const 目标 = props.适配目标
    const 点们 = 目标 === undefined ? props.文档.节点 : props.文档.节点.filter((点) => 目标.includes(点.id))
    set视口(适配视口(点们, { 宽: 画布宽, 高: 画布高 }))
  })

  /** 选中对象的画布锚点（T008）：节点 / 文字用自己的坐标，边取两端中点。 */
  const 选中锚点 = (id: string) => {
    const 点 = props.文档.节点.find((行) => 行.id === id)
    if (点 !== undefined) return { x: 数(点.x), y: 数(点.y) }
    const 文 = props.文档.文字.find((行) => 行.id === id)
    if (文 !== undefined) return { x: 数(文.x), y: 数(文.y) }
    const 边行 = props.文档.边.find((行) => 行.id === id)
    if (边行 === undefined) return undefined
    const 甲 = props.文档.节点.find((行) => 行.id === 边行.从)
    const 乙 = props.文档.节点.find((行) => 行.id === 边行.到)
    if (甲 === undefined || 乙 === undefined) return undefined
    return { x: (数(甲.x) + 数(乙.x)) / 2, y: (数(甲.y) + 数(乙.y)) / 2 }
  }

  /**
   * viewBox → 容器的缩放比（`preserveAspectRatio="xMidYMid meet"` 取较小的那一维）。
   * 容器测不到尺寸（happy-dom）时按 1:1——与 `默认换算` 的退化口径一致。
   */
  const 视图缩放比 = () => {
    const 矩 =
      props.容器尺寸 === undefined
        ? 容器?.getBoundingClientRect()
        : { width: props.容器尺寸.宽, height: props.容器尺寸.高 }
    if (矩 === undefined || 矩.width <= 0 || 矩.height <= 0) return 1
    return Math.min(矩.width / 画布宽, 矩.height / 画布高) || 1
  }

  /**
   * 检查器让位（T008 / FR-015）：**只在请求序号变化时**平移一次——拖动改的是节点坐标，
   * 不改请求，视口因此不会持续跟随。目标 = 未覆盖区中心；对象本来没被盖住就不动画面。
   *
   * 面板宽度是**屏幕 CSS px**，视口是 viewBox 单位：先按容器缩放比换算，否则窄容器下
   * 320 会被当成 320 个 viewBox 单位、右界算大而完全不触发（T008 fix1 / D1）。
   */
  let 上次让位: number | undefined
  createEffect(() => {
    const 请求 = props.让位请求
    if (请求 === undefined || 请求.序号 === 上次让位) return
    上次让位 = 请求.序号
    const 锚 = 选中锚点(请求.id)
    if (锚 === undefined) return
    const 视 = 视口()
    const 比 = 视图缩放比()
    const 新x = 面板让位平移x(
      锚,
      { 缩放: 视.缩放, x: 视.x },
      画布宽,
      (props.检查器宽 ?? 面板宽) / 比,
      面板边距 / 比,
      true,
    )
    if (新x === undefined) return
    set视口({ ...视, x: 新x })
  })

  const 提交改名 = (id: string, 值: string) => {
    // 输入框被移除（Enter/Esc 已收尾）后浏览器可能再补一次 blur：此时编辑器里的
    // `重命名id` 已经不是它了，不能再提交（否则 Esc 会变成保存）。
    if (改名收尾 || props.重命名id !== id) return
    改名收尾 = true
    const 点 = props.文档.节点.find((行) => 行.id === id)
    // 名称是必填键：清空不发 `null`（服务端会拒），只收起输入框。
    if (点 !== undefined && 值.trim() !== "" && 值 !== (点.名称 ?? "")) {
      props.动作.改字段("节点", id, { 名称: 值 })
    }
    props.动作.重命名(undefined)
  }

  const 取消改名 = () => {
    if (改名收尾) return
    改名收尾 = true
    props.动作.重命名(undefined)
  }

  const 关闭菜单 = () => set菜单(undefined)

  /** 右键：先把落点选中（节点/文字），菜单项只调动作表（FR-025）。 */
  const 右键 = (事件: MouseEvent) => {
    事件.preventDefault()
    if (props.只读 === true) return
    上次边提交 = undefined
    const 目标 = 事件.target
    // 菜单 / 图例 / 内嵌控件上右键不弹「空白画布」菜单：那里的「加节点 / 加文字」是写入口。
    if (落在内嵌界面(目标)) return
    const 矩 = 容器?.getBoundingClientRect()
    const 屏x = 事件.clientX - (矩?.left ?? 0)
    const 屏y = 事件.clientY - (矩?.top ?? 0)

    const 节点id = 读属性(目标, "data-node-id")
    if (节点id !== undefined) {
      if (!props.选中.includes(节点id)) props.动作.选择([节点id], false)
      set菜单({ 类型: "节点", id: 节点id, x: 屏x, y: 屏y })
      return
    }
    const 边id = 读属性(目标, "data-edge-id")
    if (边id !== undefined) {
      set菜单({ 类型: "边", id: 边id, x: 屏x, y: 屏y })
      return
    }
    const 文字id = 读属性(目标, "data-text-id")
    if (文字id !== undefined) {
      if (!props.选中.includes(文字id)) props.动作.选择([文字id], false)
      set菜单({ 类型: "文字", id: 文字id, x: 屏x, y: 屏y })
      return
    }
    const 内容 = 到内容(事件)
    set菜单({ 类型: "空白", x: 屏x, y: 屏y, 内容x: Math.round(内容.x), 内容y: Math.round(内容.y) })
  }

  const 到内容 = (点: { readonly clientX: number; readonly clientY: number }, 用视口: 视口变换 = 视口()) =>
    props.坐标换算 === undefined ? 默认换算(容器, 用视口)(点) : props.坐标换算(点)

  /**
   * 松手点 → 命中元素（T007 / FR-013）。默认问 `elementFromPoint`；happy-dom 没有布局，
   * 它恒返回 `null`（20.12.0 实测），此时由调用方回退数学命中（`连线目标`）。
   */
  const 屏幕命中元素 = (x: number, y: number): Element | null =>
    props.屏幕命中 !== undefined ? props.屏幕命中(x, y) : (容器?.ownerDocument?.elementFromPoint?.(x, y) ?? null)

  const 节点表 = createMemo(() => new Map(props.文档.节点.map((点) => [点.id, 点])))
  /**
   * 悬空边角标（R-F4 / contracts/hgraph-format §1）：端点在 `节点` 里缺失的边画不出线，
   * 但**文件不动**（读时不丢弃、不静默改）——界面只报条数。用现成的 `节点表()`，不另建索引；
   * 这是读侧事实，只读态也显示。隐藏（可见集过滤）不算悬空。
   */
  const 悬空数 = createMemo(() => {
    const 表 = 节点表()
    return props.文档.边.filter((行) => !表.has(行.从) || !表.has(行.到)).length
  })
  // 演示态过滤（T011）：`可见` 不传 = 全显。文字不过滤（R35）。
  const 可见节点们 = createMemo(() =>
    props.可见 === undefined ? props.文档.节点 : props.文档.节点.filter((点) => props.可见!.节点.has(点.id)),
  )
  const 可见边们 = createMemo(() =>
    props.可见 === undefined ? props.文档.边 : props.文档.边.filter((行) => props.可见!.边.has(行.id)),
  )
  // --- T018：视觉规格（形状 / 边几何 / 外环） --------------------------------------------

  /**
   * 平行边编号（R73）：无向端点对分组、组内按 id 升序。同一份编号同时决定边的偏移
   * 与「双向两条平行带」的次序；不按传入顺序编号（同输入同输出）。
   */
  const 平行序 = createMemo(() => 算平行边序(props.文档.边))
  /** 外环粗细的兜底档表（只在调用方没传 `档表` 时被读，导出 / 演示直接挂画布用）。 */
  const 自动档表 = createMemo(() => 外环档表(props.文档.节点, props.文档.边, props.文档.设置.外环阈值))
  const 环档表 = () => props.档表 ?? 自动档表()
  const 环档 = (点: 节点) => 环档表().get(点.id) ?? 0

  /**
   * 外环预设色名 → 主题槽位（设计只写「预设色名」没给清单；T018 协调者裁定，R74）。
   * 查不到（含空 / 自定义色名）⇒ 默认描边色，不猜用户意图。
   */
  const 外环色表: Readonly<Record<string, string>> = {
    红: "var(--v2-state-border-danger)",
    橙: "var(--v2-state-border-warning)",
    黄: "var(--v2-state-border-warning)",
    绿: "var(--v2-state-border-success)",
    蓝: "var(--v2-state-border-info)",
    金: "var(--v2-brand-gold-deep)",
    灰: "var(--v2-text-text-muted)",
  }
  const 外环色 = (点: 节点) => 外环色表[点.外环?.颜色 ?? ""] ?? "var(--v2-border-border-strong)"

  /**
   * 标签分级（R71）：`标签取舍` 由画布调用——缩放只有这里知道；`选中` / `悬停` / `开` /
   * 边度数都从 props 传入。运动帧直接给空集：省掉每帧一次重叠取舍，也保证「运动中全隐」。
   */
  const 保留标签 = createMemo(() => {
    if (运动中()) return new Set<string>()
    return new Set(
      标签取舍(可见节点们(), {
        缩放: 视口().缩放,
        选中: props.选中,
        悬停id: 悬停id(),
        开: props.标签开,
        // T018 / R75：自动外环档不在文件里；不传档表时 0.3–0.6 缩放会把自动档节点误隐。
        档表: props.档表,
        边们: props.文档.边,
      }),
    )
  })
  /** 边标签：只在缩放 ≥ 0.8 且不在运动帧时渲染（R71，无悬停例外）。 */
  const 边标签可见 = () => !运动中() && 视口().缩放 >= 0.8
  const 节点位 = (点: 节点) => 拖影().get(点.id) ?? { x: 数(点.x), y: 数(点.y) }
  const 文字位 = (行: 文字) => 拖影().get(行.id) ?? { x: 数(行.x), y: 数(行.y) }

  const 按下 = (事件: PointerEvent) => {
    if (props.只读 === true) return
    const 目标 = 事件.target
    // 菜单内部的点击交给菜单项自己；点外面则收起菜单。
    if (目标 instanceof Element && 目标.closest("[data-slot='hgraph-menu']") !== null) return
    set菜单(undefined)
    set松手提示(undefined)
    // 中键（button === 1）是平移入口（设计 §5.15）；其它非左键不处理。
    if (事件.button !== 0 && 事件.button !== 1) return
    if (落在内嵌界面(目标)) return
    if (目标 instanceof HTMLElement && 目标.isContentEditable) return
    容器?.focus()
    // 指针捕获：拖出 overflow-hidden 容器后仍在画布上收到 move/up（FR-040 只禁键盘的
    // window 监听；指针用捕获，不用全局监听）。
    容器?.setPointerCapture(事件.pointerId)

    const 中键 = 事件.button === 1
    // 中键按下默认会进「自动滚动」，那会抢走 pointermove；显式拦掉。
    if (中键) 事件.preventDefault()

    const 内容 = 到内容(事件)
    const 节点id = 读属性(目标, "data-node-id")
    const 文字id = 读属性(目标, "data-text-id")

    // 中键无论在节点还是空白上都是平移（不是拖动节点 / 不是连线）。
    if (中键) {
      指针 = {
        类型: "画布",
        起点屏x: 事件.clientX,
        起点屏y: 事件.clientY,
        起点x: 内容.x,
        起点y: 内容.y,
        原视口: 视口(),
        移动: false,
      }
      return
    }

    if (props.模式 === "连线" && 节点id !== undefined) {
      指针 = { 类型: "连线", 从: 节点id, 起点屏x: 事件.clientX, 起点屏y: 事件.clientY, 移动: false }
      set连线落点({ 从: 节点id, x: 内容.x, y: 内容.y })
      return
    }

    if (节点id !== undefined) {
      const 点 = 节点表().get(节点id)
      if (点 === undefined) return
      const 已选中 = props.选中.includes(节点id)
      const 可拖 = 点.锁定 !== true && !事件.shiftKey

      // Alt+拖（T016b / R97）：先复制所选（偏移 0），再把拖动目标切到副本；复制不出来
      // 就不进入拖动（不制造一次空拖）。
      if (事件.altKey && 可拖) {
        const 复制 = props.动作.复制所选
        if (复制 !== undefined) {
          if (!已选中) props.动作.选择([节点id], false)
          // 复制范围与编辑器一致：整份选中；按在未选中的节点上时只复制它。
          const 用于复制 = 已选中 ? props.选中 : [节点id]
          const 原id们 = props.文档.节点.filter((行) => 用于复制.includes(行.id)).map((行) => 行.id)
          const 副本id们 = 复制(0)
          const 序 = 原id们.indexOf(节点id)
          if (序 >= 0 && 副本id们.length === 原id们.length) {
            // 副本偏移 0 ⇒ 与原节点同坐标；锁定节点的副本不参与这次拖动。
            const 副本组 = 原id们.flatMap((原id, 位) => {
              const 行 = 节点表().get(原id)
              if (行 === undefined || 行.锁定 === true) return []
              return [{ id: 副本id们[位]!, x: 数(行.x), y: 数(行.y) }]
            })
            if (副本组.length > 0) {
              指针 = {
                类型: "对象",
                类别: "节点",
                id: 副本id们[序]!,
                起点屏x: 事件.clientX,
                起点屏y: 事件.clientY,
                起点x: 内容.x,
                起点y: 内容.y,
                shift: false,
                已选中: true,
                可拖: true,
                组: 副本组,
                移动: false,
              }
              return
            }
          }
          return
        }
      }

      // 整组拖动：按在已选中的解锁节点上 ⇒ 所有选中的**解锁**节点一起走；否则只走这一颗。
      const 组 =
        已选中 && 可拖
          ? props.文档.节点
              .filter((行) => props.选中.includes(行.id) && 行.锁定 !== true)
              // 读放宽：缺 x/y 的行按 0 起算，否则整组会拖出 NaN。
              .map((行) => ({ id: 行.id, x: 数(行.x), y: 数(行.y) }))
          : [{ id: 点.id, x: 数(点.x), y: 数(点.y) }]
      指针 = {
        类型: "对象",
        类别: "节点",
        id: 节点id,
        起点屏x: 事件.clientX,
        起点屏y: 事件.clientY,
        起点x: 内容.x,
        起点y: 内容.y,
        shift: 事件.shiftKey,
        已选中,
        可拖,
        组,
        移动: false,
      }
      return
    }

    if (文字id !== undefined) {
      const 行 = props.文档.文字.find((文) => 文.id === 文字id)
      if (行 === undefined) return
      const 已选中 = props.选中.includes(文字id)
      指针 = {
        类型: "对象",
        类别: "文字",
        id: 文字id,
        起点屏x: 事件.clientX,
        起点屏y: 事件.clientY,
        起点x: 内容.x,
        起点y: 内容.y,
        shift: 事件.shiftKey,
        已选中,
        可拖: !事件.shiftKey,
        组: [{ id: 行.id, x: 数(行.x), y: 数(行.y) }],
        移动: false,
      }
      return
    }

    // 边点选（R-F12 前置）：节点/文字都未命中才轮到边。边不可拖、不平移，
    // 松开才落选中（Shift = 切换）；双击边不建节点仍由 `双击` 里的 data-edge-id 拦截。
    const 边id = 读属性(目标, "data-edge-id")
    if (边id !== undefined) {
      指针 = { 类型: "边选", id: 边id, shift: 事件.shiftKey, 移动: false }
      return
    }

    // 空白按下：空格按住 ⇒ 平移；否则框选（Shift = 追加，FR-020）。
    if (空格按下()) {
      set平移中(true)
      指针 = {
        类型: "画布",
        起点屏x: 事件.clientX,
        起点屏y: 事件.clientY,
        起点x: 内容.x,
        起点y: 内容.y,
        原视口: 视口(),
        移动: false,
      }
      return
    }
    指针 = {
      类型: "框选",
      起点屏x: 事件.clientX,
      起点屏y: 事件.clientY,
      起点x: 内容.x,
      起点y: 内容.y,
      追加: 事件.shiftKey,
      移动: false,
    }
    set框({ x0: 内容.x, y0: 内容.y, x1: 内容.x, y1: 内容.y })
  }

  const 移动中 = (事件: PointerEvent) => {
    const 现 = 指针
    if (现 === undefined) return
    // 捕获失效 / 浏览器在容器外松手：move 的 buttons 已经是 0，按松手收尾，别把这次拖动
    // 永远挂在半路（指针残留会让下次进入画布不按键也继续拖）。
    if (事件.buttons === 0) {
      松开(事件)
      return
    }
    // 边不可拖：移动中只置标记，松手仍按「点选」落选中（R-F12 前置）。
    if (现.类型 === "边选") {
      现.移动 = true
      return
    }
    const 屏距 = Math.hypot(事件.clientX - 现.起点屏x, 事件.clientY - 现.起点屏y)

    if (现.类型 === "对象") {
      if (!现.可拖) return
      if (!现.移动 && 屏距 <= 拖动阈值) return
      现.移动 = true
      开始运动()
      const 内容 = 到内容(事件)
      const 新 = new Map(拖影())
      for (const 项 of 现.组) {
        新.set(项.id, {
          x: Math.round(项.x + 内容.x - 现.起点x),
          y: Math.round(项.y + 内容.y - 现.起点y),
        })
      }
      set拖影(新)
      return
    }

    if (现.类型 === "框选") {
      if (!现.移动 && 屏距 <= 拖动阈值) return
      现.移动 = true
      开始运动()
      const 内容 = 到内容(事件)
      set框({ x0: 现.起点x, y0: 现.起点y, x1: 内容.x, y1: 内容.y })
      return
    }

    if (现.类型 === "画布") {
      if (!现.移动 && 屏距 <= 拖动阈值) return
      现.移动 = true
      开始运动()
      // 用**按下时的视口**取内容坐标：平移过程中视口在变，拿新视口算会自己追自己。
      const 内容 = 到内容(事件, 现.原视口)
      set视口({
        缩放: 现.原视口.缩放,
        x: 现.原视口.x + (内容.x - 现.起点x) * 现.原视口.缩放,
        y: 现.原视口.y + (内容.y - 现.起点y) * 现.原视口.缩放,
      })
      return
    }

    现.移动 = true
    const 内容 = 到内容(事件)
    set连线落点({ 从: 现.从, x: 内容.x, y: 内容.y })
  }

  const 松开 = (事件: PointerEvent) => {
    const 现 = 指针
    指针 = undefined
    // 平移结束（含 pointercancel / 捕获失效）：光标从 `grabbing` 回到 `grab`（空格仍按住的语义）。
    set平移中(false)
    if (容器 !== undefined && 容器.hasPointerCapture?.(事件.pointerId)) 容器.releasePointerCapture(事件.pointerId)
    if (现 === undefined) return
    // 运动帧收尾（R71）：拖动 / 平移 / 框选停下后延迟恢复标签；单纯点选不动视口就不触发。
    if (现.移动 && (现.类型 === "对象" || 现.类型 === "画布" || 现.类型 === "框选")) 结束运动()

    if (现.类型 === "对象") {
      if (现.移动) {
        const 影 = 拖影()
        const 目标 = 现.组.map((项) => {
          const 落 = 影.get(项.id)
          return { 类别: 现.类别, id: 项.id, x: 落?.x ?? 项.x, y: 落?.y ?? 项.y }
        })
        set拖影(new Map())
        props.动作.移动(目标)
        return
      }
      if (现.shift) {
        const 下 = 现.已选中 ? props.选中.filter((id) => id !== 现.id) : [...props.选中, 现.id]
        props.动作.选择(下, false)
      } else if (!现.已选中) {
        props.动作.选择([现.id], false)
      }
      return
    }

    if (现.类型 === "框选") {
      const 框现 = 框()
      set框(undefined)
      if (现.移动 && 框现 !== undefined) {
        // `框选命中` 的 `已选` 是并集口径：Shift 追加时传当前选中，否则传空数组（替换）。
        // 只框可见节点：隔离/筛选后不可见的节点不能被选中（否则 Delete/对齐会作用到看不见的对象）。
        props.动作.选择(框选命中(框现, 可见节点们(), 现.追加 ? props.选中 : []), false)
      } else {
        props.动作.选择([], false)
      }
      return
    }

    if (现.类型 === "画布") {
      if (!现.移动) props.动作.选择([], false)
      return
    }

    if (现.类型 === "边选") {
      if (现.shift) {
        // 切换：已在选中里 ⇒ 移除，否则追加（与节点 Shift 点选同一口径）。
        const 下 = props.选中.includes(现.id)
          ? props.选中.filter((id) => id !== 现.id)
          : [...props.选中, 现.id]
        props.动作.选择(下, false)
      } else {
        props.动作.选择([现.id], false)
      }
      return
    }

    const 内容 = 到内容(事件)
    // T007 / FR-013：松手与按下用**同一套** DOM 命中（`读属性` 的 `closest`，覆盖名字标签）。
    // 释放事件的 target 是被指针捕获的容器，不能当命中元素，按坐标问 DOM；DOM 给不出元素
    // （happy-dom 无布局 / 环境没有 `elementFromPoint`）才回退数学命中（`连线目标`）。
    const 命中 = 屏幕命中元素(事件.clientX, 事件.clientY)
    const 命中id = 命中 === null ? undefined : 读属性(命中, "data-node-id")
    const 到 =
      命中 === null ? (连线目标({ 从: 现.从, x: 内容.x, y: 内容.y }, props.文档.节点)?.到 ?? undefined) : 命中id
    set连线落点(undefined)
    if (到 !== undefined && 到 !== 现.从) {
      set松手提示(undefined)
      props.动作.加边(现.从, 到)
      return
    }
    // 未命中（空白 / 预览线）⇒ 不建边并提示；命中起点自身只按「不建自环」静默（FR-019）。
    if (到 === undefined) set松手提示("松手不在节点上，未建立连线")
  }

  const 按键 = (事件: KeyboardEvent) => {
    // 演示态画布是只读的：编辑快捷键必须完全静默（空格/Backspace/Esc 归舞台容器）。
    if (props.只读 === true) return
    // 输入框判定按 tagName 读，**不能**用 `instanceof HTMLElement`：画布内文字编辑框
    // 在 `<foreignObject>` 里，happy-dom 下它是 SVG 命名空间节点（HTMLElement 为 false），
    // 旧守卫会漏掉它 ⇒ 选中非空时在输入框里按 Delete 会删节点（M1 实测）。
    const 目标 = 事件.target
    if (目标 !== null && "tagName" in 目标) {
      const 名 = String(目标.tagName).toUpperCase()
      const 可编辑 = "isContentEditable" in 目标 && 目标.isContentEditable === true
      if (名 === "INPUT" || 名 === "TEXTAREA" || 名 === "SELECT" || 可编辑) return
    }
    // 除 Esc 之外的任何键都解除「退出后首个 Esc 抑制」。
    if (事件.key !== "Escape") 忽略退出键 = false
    // 空格 = 平移修饰键（FR-020）：只记状态、不产生动作；拦掉默认行为（页面滚动）。
    if (事件.key === " ") {
      事件.preventDefault()
      set空格按下(true)
      return
    }
    const 主键 = 事件.ctrlKey || 事件.metaKey
    if (主键 && (事件.key === "z" || 事件.key === "Z")) {
      事件.preventDefault()
      if (事件.shiftKey) props.动作.重做()
      else props.动作.撤销()
      return
    }
    // 复制粘贴（T016b / R97）：只挂画布容器（上面的输入框守卫已提前返回）。
    if (主键 && (事件.key === "c" || 事件.key === "C")) {
      事件.preventDefault()
      props.动作.复制?.()
      return
    }
    if (主键 && (事件.key === "v" || 事件.key === "V")) {
      事件.preventDefault()
      props.动作.粘贴?.()
      return
    }
    if (主键 && (事件.key === "d" || 事件.key === "D")) {
      事件.preventDefault()
      props.动作.复制所选?.(0)
      return
    }
    // Delete 不在这里处理（T005）：它监听在编辑器根容器上——焦点在工具栏 / 检查器时
    // 画布收不到键，两份并存还会双删。判据与入口见 `editor.tsx` 的 `命中删除键`。
    if (事件.key === "F2") {
      const 节点们 = props.选中.filter((id) => props.文档.节点.some((行) => 行.id === id))
      if (节点们.length === 1) {
        事件.preventDefault()
        props.动作.重命名(节点们[0])
      }
      return
    }
    if (事件.key === "Escape") {
      if (忽略退出键) {
        忽略退出键 = false
        事件.preventDefault()
        return
      }
      set菜单(undefined)
      set框(undefined)
      set编辑id(undefined)
      if (props.重命名id !== undefined) props.动作.重命名(undefined)
      指针 = undefined
      set平移中(false)
      props.动作.选择([], false)
    }
  }

  const 滚轮 = (事件: WheelEvent) => {
    事件.preventDefault()
    const 旧 = 视口()
    // 触控板双指 = 平移（设计 §5.15）：按滚动量移动视口，缩放不变。
    if (是双指平移(事件)) {
      set视口({ 缩放: 旧.缩放, x: 旧.x - 事件.deltaX, y: 旧.y - 事件.deltaY })
      开始运动()
      结束运动()
      return
    }
    const 内容 = 到内容(事件)
    const 新缩放 = Math.min(3, Math.max(0.5, 旧.缩放 * (事件.deltaY < 0 ? 1.15 : 1 / 1.15)))
    // 光标下的内容点保持不动：p = c·s + t ⇒ t' = t + c·(s − s')。
    set视口({ 缩放: 新缩放, x: 旧.x + 内容.x * (旧.缩放 - 新缩放), y: 旧.y + 内容.y * (旧.缩放 - 新缩放) })
    // 运动帧（R71）：每次滚轮重置恢复计时 ⇒ 滚轮停 200ms 后才恢复标签。
    开始运动()
    结束运动()
  }

  const 双击 = (事件: MouseEvent) => {
    if (props.只读 === true) return
    const 目标 = 事件.target
    // 菜单 / 图例 / 画布内按钮与输入框不算「双击空白」：否则双击 chrome 或图例会额外加一个节点（M2）。
    if (落在内嵌界面(目标)) return
    const 文字id = 读属性(目标, "data-text-id")
    if (文字id !== undefined) {
      const 行 = props.文档.文字.find((文) => 文.id === 文字id)
      if (行 === undefined) return
      set编辑值(行.内容)
      set编辑id(文字id)
      return
    }
    const 节点id = 读属性(目标, "data-node-id")
    if (节点id !== undefined) {
      props.动作.重命名(节点id)
      return
    }
    // 双击边不建节点（只有空白才是「在点处加节点」）。
    if (读属性(目标, "data-edge-id") !== undefined) return
    const 内容 = 到内容(事件)
    props.动作.加节点({ x: Math.round(内容.x), y: Math.round(内容.y) })
  }

  const 提交文字 = () => {
    const id = 编辑id()
    set编辑id(undefined)
    if (id === undefined) return
    const 行 = props.文档.文字.find((文) => 文.id === id)
    if (行 === undefined) return
    const 值 = 编辑值()
    if (值 === 行.内容) return
    props.动作.改字段("文字", id, { 内容: 值 })
  }

  const 加文字 = () => props.动作.加文字(画布宽 / 2, 画布高 / 2 + props.文档.文字.length * 28)

  const 菜单节点 = () => {
    const 现 = 菜单()
    return 现?.类型 === "节点" ? props.文档.节点.find((行) => 行.id === 现.id) : undefined
  }
  const 菜单边 = () => {
    const 现 = 菜单()
    return 现?.类型 === "边" ? props.文档.边.find((行) => 行.id === 现.id) : undefined
  }
  /**
   * 边菜单的字段编辑：显式失焦/回车才提交（不逐字写）。
   * 一次性收尾锁：Enter 提交并卸载输入框后，浏览器可能再补一次 blur——
   * 同一 (id, 键, 值) 只提交一次（M5）。换菜单 / 换字段仍是新提交。
   */
  let 上次边提交: string | undefined
  const 提交边字段 = (id: string, 键: "标签" | "性质", 值: string) => {
    const 指纹 = `${id}:${键}:${值}`
    if (上次边提交 === 指纹) return
    const 行 = props.文档.边.find((边) => 边.id === id)
    if (行 === undefined || 行[键] === 值) return
    上次边提交 = 指纹
    props.动作.改字段("边", id, { [键]: 值 })
  }

  const 菜单项 =
    "block w-full rounded px-2 py-1 text-left text-12-regular text-v2-text-text-base hover:bg-v2-background-bg-layer-03"

  const 模式键 = (目标: 模式) =>
    `rounded border px-2 py-0.5 text-12-regular ${
      目标 === props.模式
        ? "border-v2-brand-gold-deep bg-v2-background-bg-layer-03 text-v2-text-text-base"
        : "border-v2-border-border-muted text-v2-text-text-muted"
    }`

  return (
    <div
      ref={(元素) => (容器 = 元素)}
      data-slot="hgraph-canvas"
      data-mode={props.模式}
      data-readonly={props.只读 === true ? "true" : undefined}
      tabindex={props.只读 === true ? undefined : "0"}
      role="application"
      aria-label="关系图画布"
      class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-v2-background-bg-base outline-none"
      style={{ cursor: 光标() }}
      onPointerDown={按下}
      onPointerMove={移动中}
      onPointerUp={松开}
      onPointerCancel={松开}
      onKeyDown={按键}
      onKeyUp={(事件) => {
        if (事件.key === " ") set空格按下(false)
      }}
      onBlur={() => set空格按下(false)}
      onWheel={滚轮}
      onDblClick={双击}
      onContextMenu={右键}
    >
      <Show when={props.只读 !== true}>
        <div data-slot="hgraph-canvas-chrome" class="absolute left-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          data-slot="hgraph-mode-pointer"
          aria-label="指针模式"
          title="指针模式：拖动移动节点"
          class={模式键("指针")}
          onClick={() => props.动作.切换模式("指针")}
        >
          指针
        </button>
        <button
          type="button"
          data-slot="hgraph-mode-connect"
          aria-label="连线模式"
          title="连线模式：从节点拖到另一节点成边"
          class={模式键("连线")}
          onClick={() => props.动作.切换模式("连线")}
        >
          连线
        </button>
        <button
          type="button"
          data-slot="hgraph-add-text"
          aria-label="加文字"
          title="加文字"
          class="rounded border border-v2-border-border-muted px-2 py-0.5 text-12-regular text-v2-text-text-muted"
          onClick={加文字}
        >
          加文字
        </button>
        </div>
      </Show>

      {/* 悬空边角标（R-F4）：右上角，读侧事实，只读态也显示。 */}
      <Show when={悬空数() > 0}>
        <div
          data-slot="hgraph-dangling-badge"
          title={`有 ${悬空数()} 条边指向不存在的节点：读时不丢弃、不静默改文件`}
          class="absolute right-2 top-2 z-10 text-12-regular text-v2-text-text-muted"
        >
          {悬空数()} 条边指向不存在的节点
        </div>
      </Show>

      {/* 松手落空提示（T007 / FR-013）：本地瞬态，不写盘、不进撤销栈。 */}
      <Show when={松手提示()}>
        <div
          data-slot="hgraph-connect-hint"
          role="status"
          class="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded border border-v2-border-border-strong bg-v2-background-bg-layer-03 px-2 py-1 text-12-regular text-v2-text-text-base"
        >
          {松手提示()}
        </div>
      </Show>

      <svg
        data-slot="hgraph-svg"
        viewBox={`0 0 ${画布宽} ${画布高}`}
        preserveAspectRatio="xMidYMid meet"
        class="block h-full w-full select-none"
      >
        <g data-slot="hgraph-viewport" transform={`translate(${视口().x} ${视口().y}) scale(${视口().缩放})`}>
          <For each={可见边们()}>
            {(行: 边) => {
              const 甲 = () => props.文档.节点.find((点) => 点.id === 行.从)
              const 乙 = () => props.文档.节点.find((点) => 点.id === 行.到)
              const 偏移 = () => 边偏移(平行序().get(行.id) ?? 0)
              const 档 = () => 边档(行, props.文档.设置)
              // 线型只由 `edge.ts` 判一次（T012 裁定二），这里仅翻译成 SVG 虚线样式。
              const 线型 = () => 边线型(行, 甲(), 乙())
              const 边虚线 = () => {
                switch (线型()) {
                  case "虚线":
                    return "4 3"
                  case "点线":
                    return "1 3"
                  default:
                    return undefined
                }
              }
              const 线色 = () =>
                行.性质 === "事实" ? "var(--v2-border-border-strong)" : "var(--v2-text-text-muted)"
              /**
               * 边几何（R73/R74）：中心到中心取方向，起终点退到节点边缘外
               * （起 +17、终 −20，仿 `graph.tsx:1049-1095`），再沿法线错开平行带。
               * 长度为 0（自环 / 两节点重合）⇒ 不画线（没有方向，箭头也没有意义）。
               */
              const 几何 = createMemo(() => {
                const 甲点 = 甲()
                const 乙点 = 乙()
                if (甲点 === undefined || 乙点 === undefined) return undefined
                const 甲位 = 节点位(甲点)
                const 乙位 = 节点位(乙点)
                const dx = 乙位.x - 甲位.x
                const dy = 乙位.y - 甲位.y
                const 长 = Math.hypot(dx, dy)
                if (长 < 0.001) return undefined
                const ux = dx / 长
                const uy = dy / 长
                const 法x = -uy
                const 法y = ux
                const 偏 = 偏移()
                const 起 = { x: 甲位.x + ux * 17 + 法x * 偏, y: 甲位.y + uy * 17 + 法y * 偏 }
                const 终 = { x: 乙位.x - ux * 20 + 法x * 偏, y: 乙位.y - uy * 20 + 法y * 偏 }
                const 基 = { x: 终.x - ux * 9, y: 终.y - uy * 9 }
                return {
                  起,
                  终,
                  中: { x: (起.x + 终.x) / 2, y: (起.y + 终.y) / 2 },
                  箭头: [
                    `${终.x.toFixed(1)},${终.y.toFixed(1)}`,
                    `${(基.x + 法x * 4.5).toFixed(1)},${(基.y + 法y * 4.5).toFixed(1)}`,
                    `${(基.x - 法x * 4.5).toFixed(1)},${(基.y - 法y * 4.5).toFixed(1)}`,
                  ].join(" "),
                }
              })
              return (
                <Show when={甲() !== undefined && 乙() !== undefined}>
                  {/* 组本身总在（边数/右键菜单按 id 找组）；零长度边只是不画线。 */}
                  <g
                    data-slot="hgraph-edge"
                    data-edge-id={行.id}
                    data-edge-offset={String(偏移())}
                    data-edge-tier={String(档())}
                    data-selected={props.选中.includes(行.id) ? "true" : undefined}
                  >
                    <Show when={几何()}>
                      {(几) => (
                        <>
                          <line
                            data-slot="hgraph-edge-line"
                            x1={几().起.x}
                            y1={几().起.y}
                            x2={几().终.x}
                            y2={几().终.y}
                            stroke={线色()}
                            stroke-width={线宽像素(档())}
                            stroke-opacity={档() <= 1 ? "0.55" : undefined}
                            stroke-dasharray={边虚线()}
                            class="cursor-pointer"
                          />
                          {/* 只有有向边画箭头（方向是唯一被表达的信息；无向画了会误导）。 */}
                          <Show when={行.方向 === "有向"}>
                            <polygon data-slot="hgraph-edge-arrow" points={几().箭头} fill={线色()} />
                          </Show>
                          {/* R71：边标签只在缩放 ≥ 0.8 显示（运动帧也隐）。 */}
                          <Show when={边标签可见()}>
                            <text
                              data-slot="hgraph-edge-label"
                              x={几().中.x}
                              y={几().中.y - 4}
                              text-anchor="middle"
                              font-size="11"
                              fill="var(--v2-text-text-muted)"
                              class="cursor-pointer"
                            >
                              {行.标签}
                            </text>
                          </Show>
                        </>
                      )}
                    </Show>
                  </g>
                </Show>
              )
            }}
          </For>

          <For each={可见节点们()}>
            {(点: 节点) => {
              const 位 = () => 节点位(点)
              const 选中 = () => props.选中.includes(点.id)
              // 形状映射只此一份（`graph.tsx` 的 `形状`，R74/#002-06）。
              const 形 = () => 形状(点.类型 ?? "")
              // 对象类别 > 类型→形状：事件不进那个映射（FR-056）。
              const 是事件 = () => 是事件节点(点)
              const 填充色 = () => (选中() ? "var(--v2-brand-gold)" : "var(--v2-background-bg-layer-02)")
              const 描边色 = () => (选中() ? "var(--v2-brand-gold-deep)" : "var(--v2-border-border-strong)")
              const 描边宽 = () => (选中() ? 3 : 1.5)
              const 虚线 = () => (点.锁定 === true ? "3 2" : undefined)
              return (
                <g
                  data-slot="hgraph-node"
                  data-node-id={点.id}
                  data-node-shape={形()}
                  data-selected={选中() ? "true" : undefined}
                  data-locked={点.锁定 === true ? "true" : undefined}
                  transform={`translate(${位().x} ${位().y})`}
                  class="cursor-pointer"
                  onPointerEnter={() => set悬停id(点.id)}
                  onPointerLeave={() => set悬停id((旧) => (旧 === 点.id ? undefined : 旧))}
                >
                  {/* 外环（T018）：档 = 外环档表（自动 or 手动冻结）；先画环、形状盖在上面。 */}
                  <Show when={环档(点) >= 1}>
                    <circle
                      data-slot="hgraph-node-ring"
                      data-ring-tier={String(环档(点))}
                      r={18}
                      fill="none"
                      stroke={外环色(点)}
                      stroke-width={环档(点)}
                    />
                  </Show>
                  {/* 类型用形状 + 首字双通道，颜色不是唯一通道（FR-048）。 */}
                  <Switch fallback={<circle r={节点半径} fill={填充色()} stroke={描边色()} stroke-width={描边宽()} stroke-dasharray={虚线()} data-slot="hgraph-node-shape" />}>
                    {/* 事件卡（FR-056）：两行文字属卡片自身，所以首字槽由下面的 Show 让开。 */}
                    <Match when={是事件()}>
                      <g>
                        <rect
                          data-slot="hgraph-node-shape"
                          data-node-shape="event-card"
                          x={-事件卡宽 / 2}
                          y={-事件卡高 / 2}
                          width={事件卡宽}
                          height={事件卡高}
                          rx={事件卡圆角}
                          fill={填充色()}
                          stroke={描边色()}
                          stroke-width={描边宽()}
                          stroke-dasharray={虚线()}
                        />
                        <text
                          data-slot="hgraph-event-card-line1"
                          text-anchor="middle"
                          y={-2}
                          font-size="12"
                          font-weight="600"
                          fill="var(--v2-text-text-base)"
                        >
                          {事件卡首行(点)}
                        </text>
                        <text
                          data-slot="hgraph-event-card-line2"
                          text-anchor="middle"
                          y={11}
                          font-size="10"
                          fill="var(--v2-text-text-muted)"
                        >
                          {事件卡次行(点)}
                        </text>
                      </g>
                    </Match>
                    <Match when={形() === "rect"}>
                      <rect
                        data-slot="hgraph-node-shape"
                        x={-14}
                        y={-14}
                        width={28}
                        height={28}
                        rx={6.75}
                        fill={填充色()}
                        stroke={描边色()}
                        stroke-width={描边宽()}
                        stroke-dasharray={虚线()}
                      />
                    </Match>
                    <Match when={形() === "hexagon"}>
                      <polygon
                        data-slot="hgraph-node-shape"
                        points={多边形(原点壳, 15, 6, -Math.PI / 2)}
                        fill={填充色()}
                        stroke={描边色()}
                        stroke-width={描边宽()}
                        stroke-dasharray={虚线()}
                      />
                    </Match>
                    <Match when={形() === "diamond"}>
                      <polygon
                        data-slot="hgraph-node-shape"
                        points={多边形(原点壳, 15, 4, -Math.PI / 2)}
                        fill={填充色()}
                        stroke={描边色()}
                        stroke-width={描边宽()}
                        stroke-dasharray={虚线()}
                      />
                    </Match>
                  </Switch>
                  {/* 首字按码点取：`slice` 会把补充平面字符劈成孤立代理项。
                      事件卡的第一行已含类型首字，圆心的首字槽让开（同一 DOM 结构，不复制分支）。 */}
                  <Show when={!是事件()}>
                    <text text-anchor="middle" y={4} font-size="11" fill="var(--v2-text-text-base)">
                      {Array.from(点.类型 ?? "")[0] ?? ""}
                    </text>
                  </Show>
                  {/* R71：标签分级（缩放 / 选中 / 悬停 / 遮挡）由 `标签取舍` 定，超 12 字截断。 */}
                  <Show when={保留标签().has(点.id)}>
                    <text
                      data-slot="hgraph-node-label"
                      text-anchor="middle"
                      y={27}
                      font-size="12"
                      fill="var(--v2-text-text-base)"
                    >
                      {截断标签(点.名称 ?? "")}
                    </text>
                  </Show>
                </g>
              )
            }}
          </For>

          <For each={props.文档.文字}>
            {(行: 文字) => {
              const 位 = () => 文字位(行)
              return (
                <text
                  data-slot="hgraph-text"
                  data-text-id={行.id}
                  data-selected={props.选中.includes(行.id) ? "true" : undefined}
                  x={位().x}
                  y={位().y}
                  font-size={`${字号像素(行.字号)}`}
                  font-weight={行.加粗 === true ? "700" : "400"}
                  text-anchor={行.对齐 === "左" ? "start" : 行.对齐 === "右" ? "end" : "middle"}
                  fill={文字色(行.颜色)}
                  class="cursor-pointer"
                >
                  {/*
                    FR-024 / R-F11：按 `宽度` 折行（估算，见 `text-fold.ts`）。每行一个
                    `tspan`；`x` 在每行重设（居中/右对齐逐行生效），`dy` 第一行为 0（基线
                    就是元素 y），后续按 字号 × 1.35 下移。
                  */}
                  <For each={折行行们(行.内容, 行.宽度, 行.字号)}>
                    {(行文, 序) => (
                      <tspan x={位().x} dy={序() === 0 ? 0 : 字号像素(行.字号) * 1.35}>
                        {行文}
                      </tspan>
                    )}
                  </For>
                </text>
              )
            }}
          </For>

          <Show when={框()}>
            {(框现) => (
              <rect
                data-slot="hgraph-marquee"
                x={Math.min(框现().x0, 框现().x1)}
                y={Math.min(框现().y0, 框现().y1)}
                width={Math.abs(框现().x1 - 框现().x0)}
                height={Math.abs(框现().y1 - 框现().y0)}
                fill="var(--v2-background-bg-layer-02)"
                fill-opacity="0.4"
                stroke="var(--v2-brand-gold-deep)"
                stroke-dasharray="4 3"
              />
            )}
          </Show>

          <Show when={连线落点()}>
            {(落) => {
              const 起 = () => props.文档.节点.find((点) => 点.id === 落().从)
              return (
                <Show when={起()}>
                  {(点) => {
                    const 位 = () => 节点位(点())
                    // T007 / FR-013：预览线不参与命中，松手点落到它上面时看到的是下层。
                    return (
                      <line
                        data-slot="hgraph-connect"
                        pointer-events="none"
                        x1={位().x}
                        y1={位().y}
                        x2={落().x}
                        y2={落().y}
                        stroke="var(--v2-brand-gold-deep)"
                        stroke-width="1.5"
                        stroke-dasharray="4 3"
                      />
                    )
                  }}
                </Show>
              )
            }}
          </Show>

          <Show when={编辑id()}>
            {(id) => {
              const 行 = () => props.文档.文字.find((文) => 文.id === id())
              return (
                <Show when={行()}>
                  {(文) => (
                    <foreignObject x={文().x - 60} y={文().y - 34} width={240} height={30}>
                      <input
                        data-slot="hgraph-text-editor"
                        aria-label="编辑文字"
                        class="w-full rounded border border-v2-border-border-strong px-1 text-13-regular"
                        value={编辑值()}
                        ref={(元素) => 元素.focus()}
                        onInput={(事件) => set编辑值(事件.currentTarget.value)}
                        onKeyDown={(事件) => {
                          if (事件.key === "Enter") {
                            事件.preventDefault()
                            提交文字()
                          } else if (事件.key === "Escape") {
                            事件.preventDefault()
                            set编辑id(undefined)
                          }
                        }}
                        onBlur={提交文字}
                      />
                    </foreignObject>
                  )}
                </Show>
              )
            }}
          </Show>

          <Show when={props.重命名id === undefined ? undefined : props.文档.节点.find((行) => 行.id === props.重命名id)}>
            {(点) => {
              const 位 = () => 节点位(点())
              return (
                <foreignObject x={位().x - 70} y={位().y - 44} width={180} height={30}>
                  <input
                    data-slot="hgraph-rename-editor"
                    aria-label="重命名节点"
                    class="w-full rounded border border-v2-border-border-strong px-1 text-13-regular"
                    value={点().名称 ?? ""}
                    ref={(元素) => 元素.focus()}
                    onKeyDown={(事件) => {
                      if (事件.key === "Enter") {
                        事件.preventDefault()
                        提交改名(点().id, 事件.currentTarget.value)
                      } else if (事件.key === "Escape") {
                        事件.preventDefault()
                        取消改名()
                      }
                    }}
                    onBlur={(事件) => 提交改名(点().id, 事件.currentTarget.value)}
                  />
                </foreignObject>
              )
            }}
          </Show>
        </g>
        {/*
          T018 图例：放 svg 内、viewport 之后（T015 只序列化这个 svg）——固定屏幕坐标，
          不吃缩放/平移；演示态由「初始收起」收掉，导出（不传）永远含展开图例。
        */}
        <图例 初始收起={props.图例初始收起} />
      </svg>

      <Show when={菜单()}>
        {(现) => (
          <div
            data-slot="hgraph-menu"
            role="menu"
            aria-label="画布菜单"
            class="absolute z-20 min-w-40 rounded border border-v2-border-border-strong bg-v2-background-bg-layer-02 p-1 shadow"
            style={{ left: `${现().x}px`, top: `${现().y}px` }}
          >
            <Show when={菜单节点()}>
              {(点) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    data-slot="hgraph-menu-rename"
                    class={菜单项}
                    onClick={() => {
                      关闭菜单()
                      props.动作.重命名(点().id)
                    }}
                  >
                    重命名（F2）
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-slot="hgraph-menu-lock"
                    class={菜单项}
                    onClick={() => {
                      关闭菜单()
                      props.动作.锁定切换([点().id])
                    }}
                  >
                    {点().锁定 === true ? "解锁" : "锁定"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-slot="hgraph-menu-neighbors"
                    class={菜单项}
                    onClick={() => {
                      关闭菜单()
                      props.动作.只看邻居?.([点().id])
                    }}
                  >
                    只看邻居
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-slot="hgraph-menu-delete"
                    class={菜单项}
                    onClick={() => {
                      关闭菜单()
                      props.动作.删除所选()
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </Show>

            <Show when={菜单边()}>
              {(边) => (
                <>
                  <label class="flex items-center gap-1 px-2 py-1 text-12-regular text-v2-text-text-muted">
                    标签
                    <input
                      data-slot="hgraph-menu-edge-label"
                      aria-label="改标签"
                      class="min-w-0 flex-1 rounded border border-v2-border-border-muted px-1 text-12-regular"
                      value={边().标签 ?? ""}
                      onKeyDown={(事件) => {
                        if (事件.key === "Enter") {
                          事件.preventDefault()
                          提交边字段(边().id, "标签", 事件.currentTarget.value)
                          关闭菜单()
                        }
                      }}
                      onBlur={(事件) => 提交边字段(边().id, "标签", 事件.currentTarget.value)}
                    />
                  </label>
                  <label class="flex items-center gap-1 px-2 py-1 text-12-regular text-v2-text-text-muted">
                    性质
                    <select
                      data-slot="hgraph-menu-edge-kind"
                      aria-label="改性质"
                      class="rounded border border-v2-border-border-muted text-12-regular"
                      value={边().性质}
                      onChange={(事件) => {
                        提交边字段(边().id, "性质", 事件.currentTarget.value)
                        关闭菜单()
                      }}
                    >
                      <option value="事实">事实</option>
                      <option value="推断">推断</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    role="menuitem"
                    data-slot="hgraph-menu-delete"
                    class={菜单项}
                    onClick={() => {
                      关闭菜单()
                      props.动作.删对象([{ 类别: "边", id: 边().id }])
                    }}
                  >
                    删除这条边
                  </button>
                </>
              )}
            </Show>

            <Show when={现().类型 === "文字"}>
              <button
                type="button"
                role="menuitem"
                data-slot="hgraph-menu-delete"
                class={菜单项}
                onClick={() => {
                  关闭菜单()
                  props.动作.删除所选()
                }}
              >
                删除
              </button>
            </Show>

            <Show when={现().类型 === "空白"}>
              <button
                type="button"
                role="menuitem"
                data-slot="hgraph-menu-add-node"
                class={菜单项}
                onClick={() => {
                  const 位 = 现()
                  if (位.类型 !== "空白") return
                  关闭菜单()
                  props.动作.加节点({ x: 位.内容x, y: 位.内容y })
                }}
              >
                加节点
              </button>
              <button
                type="button"
                role="menuitem"
                data-slot="hgraph-menu-add-event"
                class={菜单项}
                onClick={() => {
                  const 位 = 现()
                  if (位.类型 !== "空白") return
                  关闭菜单()
                  props.动作.加事件?.({ x: 位.内容x, y: 位.内容y })
                }}
              >
                加事件
              </button>
              <button
                type="button"
                role="menuitem"
                data-slot="hgraph-menu-layout"
                class={菜单项}
                onClick={() => {
                  关闭菜单()
                  props.动作.自动布局()
                }}
              >
                自动布局
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
