import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { createSignal, Show, type JSX, type ParentProps } from "solid-js"

/** 左项目侧栏默认宽度（DESIGN.md §4.1：280px）。 */
export const LEFT_PANE_DEFAULT = 280

/** 右栏（AI 会话）默认宽度（DESIGN.md §4.1：360px）。 */
export const RIGHT_PANE_DEFAULT = 360

/** 左栏拖拽下限（DESIGN.md §4.1：160px ~ 视口 50%）。 */
const LEFT_PANE_MIN = 160

/** 右栏拖拽下限（DESIGN.md §4.1：240px ~ 视口 2/3）。 */
const RIGHT_PANE_MIN = 240

export interface ThreePaneProps {
  /** 左栏内容。不传则左栏（含其手柄）不渲染——挂载对既有布局零影响。 */
  left?: JSX.Element
  /** 右栏内容。不传则右栏（含其手柄）不渲染。 */
  right?: JSX.Element
  /** 左栏折叠。折叠时左栏与其手柄一起让位，中栏占满。 */
  leftCollapsed?: boolean
  /** 右栏折叠。 */
  rightCollapsed?: boolean
}

/**
 * openhive 三栏工作台骨架：左导航 / 中浏览 / 右 AI 会话。
 *
 * 只负责几何与槽位——三栏各放什么由调用方通过 `left` / `right` / `children` 决定。
 * 挂载点见 `pages/layout-new.tsx` 的 `<main>`。
 */
export function ThreePane(props: ParentProps<ThreePaneProps>) {
  const [leftWidth, setLeftWidth] = createSignal(LEFT_PANE_DEFAULT)
  const [rightWidth, setRightWidth] = createSignal(RIGHT_PANE_DEFAULT)
  const viewport = () => window.innerWidth
  const leftMax = () => Math.round(viewport() * 0.5)
  const rightMax = () => Math.round((viewport() * 2) / 3)

  return (
    // 每一栏各包一层 `relative` 的包裹，**手柄放进自己那一栏的包裹里**——这不是排版需要，
    // 是给手柄当定位祖先。`resize-handle.css` 给手柄写死了 `position: absolute`，且只用
    // **包含块的边缘**定位（`inset-inline-end: 0`；`edge="start"` 时换成 `inset-inline-start: 0`）
    // ——它自己**不按 `size` 做偏移**（`size` 只参与拖拽算数）。所以手柄落在哪条缝上完全由
    // 定位祖先决定：若把手柄直接挂到下面这具容器上，容器横跨三栏，左栏手柄就跑到容器**最右边**、
    // 右栏手柄跑到**最左边**（压住图标栏），手柄与它要拖的那条缝分家，在缝上按下去拖不动。
    // 一句话的不变量：**包裹的边界 == 那一栏的边界**，手柄才落在缝上。
    //
    // ⚠️ 这层包裹**不许加 `overflow-hidden`**（准确说：不许换成任何会裁掉溢出内容的盒子）。
    // 手柄是 `width: 8px` + `translateX(±50%)`——**有一半探在包裹外面**去压那条缝，裁了就只剩 4px
    // （`resize-handle.css:20-27`）。也**不能把 `<ResizeHandle>` 挪进 `aside`**：`aside` 自己有
    // `overflow-hidden`，同样裁一半。上游各调用点形状不一、**别照抄**：干净的例子是 `layout.tsx`
    // 那个 `w-0 overflow-visible` 的零宽层；另有把手柄放进带 `overflow:hidden` 的窗格里、再靠
    // `-top-1` 之类的负偏移把它挪出来的写法（`terminal-panel-v2.tsx`）——那是另一种补偿，
    // 照搬形状只会把手柄裁掉一半。
    // happy-dom 没有 CSS 引擎、量不出几何，故由 `three-pane.test.tsx` 里那条结构不变量钉住。
    <div data-component="three-pane" class="flex-1 min-h-0 min-w-0 w-full flex">
      <Show when={props.left !== undefined && !props.leftCollapsed}>
        <div data-slot="three-pane-left-group" class="relative flex shrink-0 min-h-0">
          <aside
            data-slot="three-pane-left"
            class="shrink-0 min-h-0 overflow-hidden"
            style={{ width: `${leftWidth()}px` }}
          >
            {props.left}
          </aside>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={leftWidth()}
            min={LEFT_PANE_MIN}
            max={leftMax()}
            onResize={setLeftWidth}
          />
        </div>
      </Show>
      {/* 中栏原样复刻挂载点 `<main>`（layout-new.tsx）的 flex 上下文：子路由此前直接挂在
          它下面，若这里换了 `items-start` / `flex-col`，既有页面的布局会静默改变。 */}
      <div data-slot="three-pane-center" class="flex-1 min-h-0 min-w-0 flex flex-col items-start">
        {props.children}
      </div>
      <Show when={props.right !== undefined && !props.rightCollapsed}>
        <div data-slot="three-pane-right-group" class="relative flex shrink-0 min-h-0">
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={rightWidth()}
            min={RIGHT_PANE_MIN}
            max={rightMax()}
            onResize={setRightWidth}
          />
          <aside
            data-slot="three-pane-right"
            class="shrink-0 min-h-0 overflow-hidden"
            style={{ width: `${rightWidth()}px` }}
          >
            {props.right}
          </aside>
        </div>
      </Show>
    </div>
  )
}
