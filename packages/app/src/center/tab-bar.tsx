import { Icon, type IconProps } from "@opencode-ai/ui/icon"
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
      <button
        type="button"
        data-slot="tab-close"
        aria-label={`关闭 ${props.tab.title}`}
        onClick={(event) => {
          // 关按钮长在 tab 上，不拦一下会连带把这张 tab 也激活
          event.stopPropagation()
          props.onClose()
        }}
        class="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base"
      >
        <Icon name="close" />
      </button>
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
