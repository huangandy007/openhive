import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { RAIL_ENTRIES } from "../rail/entries"
import { moduleColorVar } from "./module-color"
import { splitTabOverflow } from "./tab-overflow"
import { contentTabKey, type ContentTab } from "./tab-store"

/** tab 高 40px（DESIGN §3.2）。 */
export const TAB_HEIGHT = 40
/** 单张 tab 的估算宽度，用于溢出判定（DESIGN §4.5 未定宽度，取与 front 参考件 `max-w-[220px]` 同量级）。 */
const TAB_WIDTH = 180
/** 行末「⋯」自身占宽。 */
const OVERFLOW_WIDTH = 40

/** 模块图标沿用图标栏那套（`entries.ts`），tab 上就不再另立一份选型。 */
const MODULE_ICONS: Record<string, IconProps["name"]> = Object.fromEntries(
  RAIL_ENTRIES.map((entry) => [entry.id, entry.icon] as const),
)
/** 未登记模块（F6/F7 新增、或上游带进来的 id）的兜底图标，与 `module-color.ts` 的兜底同义。 */
const FALLBACK_ICON: IconProps["name"] = "folder"

export interface TabBarProps {
  /** 已打开的 tab，顺序即显示顺序（FR-004 跨模块累积）。 */
  tabs: readonly ContentTab[]
  /** 当前激活 tab 的 key（`contentTabKey` 形态）。 */
  active?: string
  onActivate: (key: string) => void
  onClose: (key: string) => void
  /**
   * 可用宽度（px）；省略 = 组件自己量。
   * 留这个口子是因为 happy-dom 没有 CSS 引擎、`clientWidth` 恒为 0，量不出真实宽度
   * （沿用 T008 给顶栏留 `titlebarRight` 注入缝的同一范式）。
   */
  availableWidth?: number
}

function Tab(props: { tab: ContentTab; active: boolean; onActivate: () => void; onClose: () => void }) {
  return (
    <div
      data-slot="tab"
      data-module={props.tab.module}
      role="tab"
      aria-selected={props.active}
      onClick={props.onActivate}
      class="relative flex h-full max-w-44 shrink-0 cursor-pointer items-center gap-2 rounded-t-md px-3 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
      classList={{ "bg-v2-background-bg-base font-semibold text-v2-text-text-base": props.active }}
    >
      <Show when={props.active}>
        {/* 激活态顶边条：除底色外再用「形状」表达（DESIGN §3.2 / §4.3），与 rail 的选中竖条同法 */}
        <span data-slot="tab-active-bar" class="absolute inset-x-0 top-0 h-0.5 bg-v2-background-bg-accent" />
      </Show>
      {/* Icon 取的是继承来的 --icon-base（见 icon.css），故身份色必须由这层 wrapper 提供 */}
      <span
        data-slot="tab-icon"
        class="flex shrink-0 items-center"
        style={{ "--icon-base": `var(${moduleColorVar(props.tab.module)})` }}
      >
        <Icon name={MODULE_ICONS[props.tab.module] ?? FALLBACK_ICON} />
      </span>
      <span data-slot="tab-title" class="truncate">
        {props.tab.title}
      </span>
      {/* 悬停提示：关闭钮只有一枚 `×`，鼠标用户看不见 `aria-label`。
          ⚠️ `TooltipV2` 会插一层自己的 `<div>`（实测），故原先挂在按钮上的 `shrink-0`
          要由这层接过去——否则宽 tab 被 `max-w-44` 截断时，先被压掉的会是这颗按钮。 */}
      <TooltipV2 value={`关闭 ${props.tab.title}`} class="flex shrink-0">
        <button
          type="button"
          data-slot="tab-close"
          aria-label={`关闭 ${props.tab.title}`}
          onClick={(event) => {
            // 关按钮长在 tab 上，不拦一下会连带把这张 tab 也激活
            event.stopPropagation()
            props.onClose()
          }}
          class="group flex size-4 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-v2-overlay-simple-overlay-hover"
        >
          {/* 图标颜色必须由这层 wrapper 注入 `--icon-base`：写在按钮上的 `text-v2-icon-*`
              到不了图标（`icon.css` 给图标自身写了 `color: var(--icon-base)`），不注入就静默恒灰、
              连悬停提亮一起失效——与本文件的模块图标、rail、topbar 是同一套做法。

              这里写**类**而不是内联 style：关闭按钮只有「默认 / 悬停」两档**固定**色，走类才有
              `group-hover:` 提亮的余地。上面那个模块图标反过来用内联——因为它的色是
              `moduleColorVar()` **运行时算出来**的身份色，拼不出类名。两处取舍不同是**这个区别**
              造成的（算得出来的只能内联，固定档位才轮到类），不是漏了一处。 */}
          <span
            data-slot="tab-close-icon"
            class="flex items-center [--icon-base:var(--v2-icon-icon-muted)] group-hover:[--icon-base:var(--v2-icon-icon-base)]"
          >
            <Icon name="close" />
          </span>
        </button>
      </TooltipV2>
    </div>
  )
}

/**
 * 中栏 tab 栏（FR-005 / DESIGN §4.5）：跨模块累积的内容视图 tab。
 *
 * 与顶栏的 session tab 条（`titlebar.tsx` 的 `TitlebarTabStrip`）是两套东西，分工见 §4.5：
 * 顶栏管 opencode 会话 tab、溢出走横向滚动；这里管「内容视图 tab」、溢出把尾部收进行末「⋯」。
 * 两者不共享状态、不互相搬运。
 *
 * 只负责「显示哪些、点了通知谁」——tab 的增删改与激活态由 `tab-store.ts` 持有，
 * T010 起挂在中栏顶部（`ThreePane` 的 center 槽）。根元素带 `w-full` 是必需的：中栏容器是
 * `flex flex-col items-start`（复刻挂载点 `<main>` 的 flex 上下文），缺了它这条栏会缩到内容宽度。
 */
export function TabBar(props: TabBarProps) {
  let strip: HTMLDivElement | undefined
  const [measured, setMeasured] = createSignal(0)
  const [menuOpen, setMenuOpen] = createSignal(false)

  onMount(() => {
    if (typeof ResizeObserver === "undefined" || !strip) return
    const observer = new ResizeObserver(() => setMeasured(strip?.clientWidth ?? 0))
    observer.observe(strip)
    onCleanup(() => observer.disconnect())
  })

  // `measured()` 为 0 = **还没量到**（首帧，或 happy-dom 这类无 CSS 引擎的环境），不是「宽度为零」。
  // 判成 0 会把全部 tab 一股脑塞进「⋯」——凭空隐藏比暂时多显示更糟，故当作「不限宽」先全显示。
  const available = () => props.availableWidth ?? (measured() || Number.POSITIVE_INFINITY)
  const split = () => splitTabOverflow(props.tabs.length, available(), { tabWidth: TAB_WIDTH, overflowWidth: OVERFLOW_WIDTH })
  const visible = () => props.tabs.slice(0, split().visibleCount)
  const hidden = () => props.tabs.slice(split().visibleCount)

  const activate = (tab: ContentTab) => {
    props.onActivate(contentTabKey(tab))
    setMenuOpen(false)
  }

  return (
    <div
      ref={strip}
      data-component="tab-bar"
      style={{ height: `${TAB_HEIGHT}px` }}
      class="flex w-full shrink-0 items-stretch gap-0.5 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 px-1"
    >
      <For each={visible()}>
        {(tab) => (
          <Tab
            tab={tab}
            active={contentTabKey(tab) === props.active}
            onActivate={() => props.onActivate(contentTabKey(tab))}
            onClose={() => props.onClose(contentTabKey(tab))}
          />
        )}
      </For>
      <Show when={hidden().length > 0}>
        <div class="relative flex items-center">
          {/* 悬停提示：`⋯` 只有字形，说不出「还有几个」。
              `aria-expanded` 就挂在这颗按钮上，于是菜单一展开，`TooltipV2` 的 `sync()` 会顺带
              把提示压住——提示与下拉不同屏出现，正是想要的那条（免得两层浮层打架）。 */}
          <TooltipV2 value={`还有 ${hidden().length} 个标签页`} class="flex shrink-0">
            <button
              type="button"
              data-slot="tab-overflow"
              aria-label={`还有 ${hidden().length} 个标签页`}
              aria-expanded={menuOpen()}
              onClick={() => setMenuOpen(!menuOpen())}
              class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base"
            >
              {/* 原生图标集没有 ellipsis / more 一档，用字面字形 U+22EF 顶（同 §5.3 的线性风格） */}
              ⋯
            </button>
          </TooltipV2>
          <Show when={menuOpen()}>
            <div
              data-slot="tab-overflow-menu"
              class="absolute top-full right-0 z-50 mt-1 flex min-w-40 flex-col rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1 shadow-lg"
            >
              <For each={hidden()}>
                {(tab) => (
                  <button
                    type="button"
                    data-slot="tab-overflow-item"
                    onClick={() => activate(tab)}
                    class="cursor-pointer truncate rounded px-2 py-1.5 text-left text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  >
                    {tab.title}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
