import { For, Show, type JSX } from "solid-js"
import type { 工作表项 } from "./sheet-model"

export interface SheetTabsProps {
  sheets: readonly 工作表项[]
  /** 当前**正在显示**的那张表。换表要等解析回来，所以高亮跟着已显示的数据走，不跟着点击走。 */
  current: string
  onSelect(name: string): void
}

/**
 * 工作簿底部的表标签栏（Excel 风格）。
 *
 * - 只有一张表时不渲染：没有可切的东西，多一条横条只白占版面。
 * - 隐藏工作表照样列出、照样可点，名字后缀「（隐藏）」并带 `data-hidden`。
 * - 表多时可横向滚动（`overflow-x-auto`）；←/→ 切换并在两端回绕。
 */
export function SheetTabs(props: SheetTabsProps): JSX.Element {
  let 条: HTMLDivElement | undefined

  const 移 = (delta: 1 | -1) => {
    const 位置 = props.sheets.findIndex((表) => 表.name === props.current)
    if (位置 < 0 || props.sheets.length < 2) return
    const 下一个 = (位置 + delta + props.sheets.length) % props.sheets.length
    props.onSelect(props.sheets[下一个].name)
    // 焦点跟着选中项走：连按方向键才不用每次先 Tab 回标签栏。
    queueMicrotask(() => 条?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[下一个]?.focus())
  }

  return (
    <Show when={props.sheets.length > 1}>
      <div
        ref={条}
        role="tablist"
        aria-label="工作表"
        data-slot="sheet-tabs"
        class="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-v2-border-border-muted px-2 pt-1"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault()
            移(1)
          } else if (event.key === "ArrowLeft") {
            event.preventDefault()
            移(-1)
          }
        }}
      >
        <For each={props.sheets}>
          {(表) => {
            const 选中 = () => 表.name === props.current
            return (
              <button
                type="button"
                role="tab"
                aria-selected={选中()}
                tabIndex={选中() ? 0 : -1}
                data-slot="sheet-tab"
                data-sheet={表.name}
                data-hidden={表.hidden ? "true" : undefined}
                title={表.hidden ? `${表.name}（工作表已在 Excel 里隐藏）` : 表.name}
                onClick={() => props.onSelect(表.name)}
                class={`shrink-0 whitespace-nowrap rounded-t px-3 py-1 text-12-regular ${
                  选中()
                    ? "border-b-2 border-v2-border-border-strong bg-v2-background-bg-layer-02 text-v2-text-text-base"
                    : "border-b-2 border-transparent text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                }`}
              >
                {表.name}
                {表.hidden ? "（隐藏）" : ""}
              </button>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
