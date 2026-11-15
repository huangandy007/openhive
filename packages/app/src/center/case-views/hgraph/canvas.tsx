/**
 * `.hgraph` 画布（012 · T009b）。
 *
 * 只做**渲染 + 指针/键盘事件**：文档、保存、撤销栈都在 `editor.tsx`；本组件收到
 * `{ 文档, 选中, 模式, 动作 }`，把用户意图翻译成 `动作` 回调，不自己改文档。几何一律调
 * `geometry.ts`（`连线目标` / `框选命中`），不在这里另算一份（`#002-06`）。
 *
 * ## 两条交互口径（FR-019 / FR-020 / FR-022）
 *
 * - **指针模式**：拖节点 = 移动，永不建边；拖空白 = 平移画布；Shift + 拖空白 = 框选。
 * - **连线模式**：从节点拖到另一节点 = 加边；拖到空白**不建边**（`连线目标` 返回 `null`）。
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
import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import type { 边, 图文件, 节点, 文字 } from "./file"
import { 框选命中, 连线目标, type 矩形, type 视口变换, type 对齐边, type 等距轴 } from "./geometry"
import type { 排列模式 } from "../graph-layout"

/** 服务端放置的同一块画布（`hgraph-edit.ts` 760×680）；节点半径同源 15。 */
const 画布宽 = 760
const 画布高 = 680
const 节点半径 = 15
/** 手抖 1px 不算拖动（同 `graph.tsx` 的死区），否则「点一下看选中」会变成「挪半步」。 */
const 拖动阈值 = 3

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
  readonly 加文字: (x: number, y: number) => void
  readonly 改字段: (类别: "节点" | "边" | "文字", id: string, 补丁: Record<string, unknown>) => void
  readonly 删对象: (目标: readonly { readonly 类别: "节点" | "边" | "文字"; readonly id: string }[]) => void
  readonly 撤销: () => void
  readonly 重做: () => void
  readonly 切换模式: (模式: 模式) => void
  /** 省略位置 ⇒ 编辑器按画布中心 + 既有节点数做阶梯偏移（R29）。 */
  readonly 加节点: (位置?: { readonly x: number; readonly y: number }) => void
  readonly 删除所选: () => void
  /** `undefined` = 收起改名输入框（Esc / 提交后），不产生操作。 */
  readonly 重命名: (id: string | undefined) => void
  readonly 锁定切换: (ids: readonly string[]) => void
  readonly 对齐: (边: 对齐边, ids: readonly string[]) => void
  readonly 等距: (轴: 等距轴, ids: readonly string[]) => void
  readonly 自动布局: (模式?: 排列模式) => void
}

export interface 画布Props {
  readonly 文档: 图文件
  readonly 选中: readonly string[]
  readonly 模式: 模式
  readonly 坐标换算?: 坐标换算
  readonly 动作: 画布动作
  /** 正在内联改名的节点 id；由编辑器的 `重命名` 动作设置。 */
  readonly 重命名id?: string
  /**
   * 递增即收起右键菜单。由编辑器的共同父容器在点到菜单外时驱动——画布自己的
   * `pointerdown` 只覆盖画布内部，工具栏 / 检查器上的点击收不到（I1）。
   * 仍是组件内监听：不挂 `window`（FR-040）。
   */
  readonly 收起菜单?: number
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

/** pointerdown 落点元素上读属性（`closest` 覆盖节点组内的圆/文字）。 */
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
  | { 类型: "框选"; 起点屏x: number; 起点屏y: number; 起点x: number; 起点y: number; 移动: boolean }
  | { 类型: "连线"; 从: string; 起点屏x: number; 起点屏y: number; 移动: boolean }

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
  const [编辑id, set编辑id] = createSignal<string | undefined>()
  const [编辑值, set编辑值] = createSignal("")
  const [菜单, set菜单] = createSignal<菜单目标 | undefined>()

  let 指针: 指针态 | undefined
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
    上次边提交 = undefined
    const 目标 = 事件.target
    if (目标 instanceof Element && 目标.closest("[data-slot='hgraph-menu']") !== null) return
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

  const 节点表 = createMemo(() => new Map(props.文档.节点.map((点) => [点.id, 点])))
  const 节点位 = (点: 节点) => 拖影().get(点.id) ?? { x: 数(点.x), y: 数(点.y) }
  const 文字位 = (行: 文字) => 拖影().get(行.id) ?? { x: 数(行.x), y: 数(行.y) }

  const 按下 = (事件: PointerEvent) => {
    const 目标 = 事件.target
    // 菜单内部的点击交给菜单项自己；点外面则收起菜单。
    if (目标 instanceof Element && 目标.closest("[data-slot='hgraph-menu']") !== null) return
    set菜单(undefined)
    if (事件.button !== 0) return
    if (目标 instanceof Element && 目标.closest("button,input,textarea,select")) return
    if (目标 instanceof HTMLElement && 目标.isContentEditable) return
    容器?.focus()
    // 指针捕获：拖出 overflow-hidden 容器后仍在画布上收到 move/up（FR-040 只禁键盘的
    // window 监听；指针用捕获，不用全局监听）。
    容器?.setPointerCapture(事件.pointerId)

    const 内容 = 到内容(事件)
    const 节点id = 读属性(目标, "data-node-id")
    const 文字id = 读属性(目标, "data-text-id")

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

    if (事件.shiftKey) {
      指针 = { 类型: "框选", 起点屏x: 事件.clientX, 起点屏y: 事件.clientY, 起点x: 内容.x, 起点y: 内容.y, 移动: false }
      set框({ x0: 内容.x, y0: 内容.y, x1: 内容.x, y1: 内容.y })
      return
    }
    指针 = {
      类型: "画布",
      起点屏x: 事件.clientX,
      起点屏y: 事件.clientY,
      起点x: 内容.x,
      起点y: 内容.y,
      原视口: 视口(),
      移动: false,
    }
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
    const 屏距 = Math.hypot(事件.clientX - 现.起点屏x, 事件.clientY - 现.起点屏y)

    if (现.类型 === "对象") {
      if (!现.可拖) return
      if (!现.移动 && 屏距 <= 拖动阈值) return
      现.移动 = true
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
      const 内容 = 到内容(事件)
      set框({ x0: 现.起点x, y0: 现.起点y, x1: 内容.x, y1: 内容.y })
      return
    }

    if (现.类型 === "画布") {
      if (!现.移动 && 屏距 <= 拖动阈值) return
      现.移动 = true
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
    if (容器 !== undefined && 容器.hasPointerCapture?.(事件.pointerId)) 容器.releasePointerCapture(事件.pointerId)
    if (现 === undefined) return

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
        // `框选命中` 已经把 `已选` 取并集（Shift 追加口径），这里直接落成新选集。
        props.动作.选择(框选命中(框现, props.文档.节点, props.选中), false)
      } else {
        props.动作.选择([], false)
      }
      return
    }

    if (现.类型 === "画布") {
      if (!现.移动) props.动作.选择([], false)
      return
    }

    const 内容 = 到内容(事件)
    set连线落点(undefined)
    const 目标 = 连线目标({ 从: 现.从, x: 内容.x, y: 内容.y }, props.文档.节点)
    // 拖到空白 ⇒ `null` ⇒ **不建边**（FR-019）。
    if (目标 !== null) props.动作.加边(目标.从, 目标.到)
  }

  const 按键 = (事件: KeyboardEvent) => {
    // 输入框判定按 tagName 读，**不能**用 `instanceof HTMLElement`：画布内文字编辑框
    // 在 `<foreignObject>` 里，happy-dom 下它是 SVG 命名空间节点（HTMLElement 为 false），
    // 旧守卫会漏掉它 ⇒ 选中非空时在输入框里按 Delete 会删节点（M1 实测）。
    const 目标 = 事件.target
    if (目标 !== null && "tagName" in 目标) {
      const 名 = String(目标.tagName).toUpperCase()
      const 可编辑 = "isContentEditable" in 目标 && 目标.isContentEditable === true
      if (名 === "INPUT" || 名 === "TEXTAREA" || 名 === "SELECT" || 可编辑) return
    }
    const 主键 = 事件.ctrlKey || 事件.metaKey
    if (主键 && (事件.key === "z" || 事件.key === "Z")) {
      事件.preventDefault()
      if (事件.shiftKey) props.动作.重做()
      else props.动作.撤销()
      return
    }
    if (事件.key === "Delete") {
      // 选中到类型的翻译归编辑器（同一个出口只认 `删除所选`）。
      if (props.选中.length > 0) {
        事件.preventDefault()
        props.动作.删除所选()
      }
      return
    }
    if (事件.key === "F2") {
      const 节点们 = props.选中.filter((id) => props.文档.节点.some((行) => 行.id === id))
      if (节点们.length === 1) {
        事件.preventDefault()
        props.动作.重命名(节点们[0])
      }
      return
    }
    if (事件.key === "Escape") {
      set菜单(undefined)
      set框(undefined)
      set编辑id(undefined)
      if (props.重命名id !== undefined) props.动作.重命名(undefined)
      指针 = undefined
      props.动作.选择([], false)
    }
  }

  const 滚轮 = (事件: WheelEvent) => {
    事件.preventDefault()
    const 旧 = 视口()
    const 内容 = 到内容(事件)
    const 新缩放 = Math.min(3, Math.max(0.5, 旧.缩放 * (事件.deltaY < 0 ? 1.15 : 1 / 1.15)))
    // 光标下的内容点保持不动：p = c·s + t ⇒ t' = t + c·(s − s')。
    set视口({ 缩放: 新缩放, x: 旧.x + 内容.x * (旧.缩放 - 新缩放), y: 旧.y + 内容.y * (旧.缩放 - 新缩放) })
  }

  const 双击 = (事件: MouseEvent) => {
    const 目标 = 事件.target
    // 菜单与画布内的按钮 / 输入框不算「双击空白」：否则双击 chrome 按钮会额外加一个节点（M2）。
    if (目标 instanceof Element && 目标.closest("[data-slot='hgraph-menu'], button, input, textarea, select") !== null)
      return
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
      tabindex="0"
      role="application"
      aria-label="关系图画布"
      class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-v2-background-bg-base outline-none"
      onPointerDown={按下}
      onPointerMove={移动中}
      onPointerUp={松开}
      onKeyDown={按键}
      onWheel={滚轮}
      onDblClick={双击}
      onContextMenu={右键}
    >
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

      <svg
        data-slot="hgraph-svg"
        viewBox={`0 0 ${画布宽} ${画布高}`}
        preserveAspectRatio="xMidYMid meet"
        class="block h-full w-full select-none"
      >
        <g data-slot="hgraph-viewport" transform={`translate(${视口().x} ${视口().y}) scale(${视口().缩放})`}>
          <For each={props.文档.边}>
            {(行: 边) => {
              const 甲 = () => props.文档.节点.find((点) => 点.id === 行.从)
              const 乙 = () => props.文档.节点.find((点) => 点.id === 行.到)
              return (
                <Show when={甲() !== undefined && 乙() !== undefined}>
                  <g data-slot="hgraph-edge" data-edge-id={行.id}>
                    {(() => {
                      const 起 = 节点位(甲()!)
                      const 终 = 节点位(乙()!)
                      return (
                        <>
                          <line
                            data-slot="hgraph-edge-line"
                            x1={起.x}
                            y1={起.y}
                            x2={终.x}
                            y2={终.y}
                            stroke={行.性质 === "事实" ? "var(--v2-border-border-strong)" : "var(--v2-text-text-muted)"}
                            stroke-width="1.5"
                            stroke-dasharray={行.性质 === "推断" ? "4 3" : undefined}
                          />
                          <text
                            data-slot="hgraph-edge-label"
                            x={(起.x + 终.x) / 2}
                            y={(起.y + 终.y) / 2 - 4}
                            text-anchor="middle"
                            font-size="11"
                            fill="var(--v2-text-text-muted)"
                          >
                            {行.标签}
                          </text>
                        </>
                      )
                    })()}
                  </g>
                </Show>
              )
            }}
          </For>

          <For each={props.文档.节点}>
            {(点: 节点) => {
              const 位 = () => 节点位(点)
              const 选中 = () => props.选中.includes(点.id)
              return (
                <g
                  data-slot="hgraph-node"
                  data-node-id={点.id}
                  data-selected={选中() ? "true" : undefined}
                  data-locked={点.锁定 === true ? "true" : undefined}
                  transform={`translate(${位().x} ${位().y})`}
                  class="cursor-pointer"
                >
                  <circle
                    r={节点半径}
                    fill={选中() ? "var(--v2-brand-gold)" : "var(--v2-background-bg-layer-02)"}
                    stroke={选中() ? "var(--v2-brand-gold-deep)" : "var(--v2-border-border-strong)"}
                    stroke-width={选中() ? 3 : 1.5}
                    stroke-dasharray={点.锁定 === true ? "3 2" : undefined}
                  />
                  {/* 类型同时用形状/首字区分，颜色不是唯一通道（FR-048）。 */}
                  <text text-anchor="middle" y={4} font-size="11" fill="var(--v2-text-text-base)">
                    {(点.类型 ?? "").slice(0, 1)}
                  </text>
                  <text
                    data-slot="hgraph-node-label"
                    text-anchor="middle"
                    y={27}
                    font-size="12"
                    fill="var(--v2-text-text-base)"
                  >
                    {点.名称 ?? ""}
                  </text>
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
                  font-size={行.字号 === "小" ? "11" : 行.字号 === "大" ? "22" : "16"}
                  font-weight={行.加粗 === true ? "700" : "400"}
                  text-anchor={行.对齐 === "左" ? "start" : 行.对齐 === "右" ? "end" : "middle"}
                  fill={行.颜色 ?? "var(--v2-text-text-base)"}
                  class="cursor-pointer"
                >
                  {行.内容}
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
                    return (
                      <line
                        data-slot="hgraph-connect"
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
