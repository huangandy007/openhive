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
    // `relative` 是给两个拖拽手柄当定位祖先用的，不是排版需要：`resize-handle.css` 给手柄写死
    // 了 `position: absolute`（上游 5 个调用点无一例外都自带定位祖先）。少了它，手柄会沿定位链
    // 一直上溯到 `<main>`（`layout-new.tsx` 带 `contain: strict`，本身即包含块）——左侧手柄跑到
    // 窗口最右边、右侧手柄压到图标栏上。happy-dom 没有 CSS 引擎，测不出几何，故只能靠这行与
    // 浏览器核对兜住。
    <div data-component="three-pane" class="relative flex-1 min-h-0 min-w-0 w-full flex">
      <Show when={props.left !== undefined && !props.leftCollapsed}>
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
      </Show>
      {/* 中栏原样复刻挂载点 `<main>`（layout-new.tsx）的 flex 上下文：子路由此前直接挂在
          它下面，若这里换了 `items-start` / `flex-col`，既有页面的布局会静默改变。 */}
      <div data-slot="three-pane-center" class="flex-1 min-h-0 min-w-0 flex flex-col items-start">
        {props.children}
      </div>
      <Show when={props.right !== undefined && !props.rightCollapsed}>
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
      </Show>
    </div>
  )
}
