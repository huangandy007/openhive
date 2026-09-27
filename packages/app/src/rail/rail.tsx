import { Icon } from "@opencode-ai/ui/icon"
import { For, Show } from "solid-js"
import { RAIL_ENTRIES, SETTINGS_ENTRY, visibleEntries, type RailEntry } from "./entries"

/** 图标栏宽度（DESIGN.md §4.1：56px）。 */
export const RAIL_WIDTH = 56

export interface RailProps {
  /** 会话签到能力位；省略 = 尚未接签发方，不设限（语义见 `entries.ts`）。 */
  capabilities?: ReadonlySet<string>
  /** 当前高亮入口的 id（= 左栏正停留的模块）。 */
  active?: string
  onSelect: (id: string) => void
}

function RailEntryButton(props: { entry: RailEntry; active: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      data-slot="rail-entry"
      aria-label={props.entry.label}
      aria-current={props.active ? "page" : undefined}
      onClick={() => props.onSelect(props.entry.id)}
      class="relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base"
      classList={{ "bg-v2-overlay-simple-overlay-pressed text-v2-icon-icon-accent": props.active }}
    >
      <Show when={props.active}>
        {/* 选中态的左侧竖条：除了底色，还用「形状」表达选中（DESIGN §4.1 / §4.3） */}
        <span
          data-slot="rail-entry-bar"
          class="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-v2-background-bg-accent"
        />
      </Show>
      <Icon name={props.entry.icon} />
    </button>
  )
}

/**
 * 左侧图标栏（FR-002 / DESIGN.md §4.1）：顶部五个业务入口 + 底部「系统设置」。
 *
 * 只负责「显示哪些、点了通知谁」——入口可见性按 capability 过滤，但真正的鉴权在
 * 下游执行层（宪法 IV）。
 *
 * 视觉取自 `design-reference`（front 的 `LeftIconBar`，**仅视觉参考、非代码移植**）：
 * 白底 + 右侧分隔线、40px 方形图标按钮、选中态浅金底 + 左侧金色竖条、
 * 设置项以一条细分隔线隔开并吸底。
 */
export function Rail(props: RailProps) {
  return (
    <div
      data-component="rail"
      style={{ width: `${RAIL_WIDTH}px` }}
      class="flex h-full shrink-0 select-none flex-col items-center gap-3 border-r border-v2-border-border-muted bg-v2-background-bg-base py-4"
    >
      <For each={visibleEntries(RAIL_ENTRIES, props.capabilities)}>
        {(entry) => (
          <RailEntryButton entry={entry} active={entry.id === props.active} onSelect={props.onSelect} />
        )}
      </For>
      <div class="mt-auto flex flex-col items-center gap-3">
        <span class="my-1 h-px w-8 bg-v2-border-border-muted" />
        <RailEntryButton
          entry={SETTINGS_ENTRY}
          active={SETTINGS_ENTRY.id === props.active}
          onSelect={props.onSelect}
        />
      </div>
    </div>
  )
}
