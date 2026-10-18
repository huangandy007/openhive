import { createSignal, For, Show, type JSX } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import type { ColumnType, SheetMeta } from "./sheet-model"

export const 表头高 = 32

export interface 列状态 {
  index: number
  letter: string
  name: string
  type: ColumnType
  width: number
  hidden: boolean
}

export interface 表头格Props {
  column: 列状态
  sort?: { column: number; dir: "asc" | "desc" }
  onSort(): void
  onHide(): void
  onResizeStart(event: PointerEvent): void
  onAutoFit(): void
}

/** 表头格：列标 + 列名 + 排序箭头 + 隐藏入口 + 拖拽热区。筛选/菜单在后续任务补。 */
export function 表头格(props: 表头格Props): JSX.Element {
  return (
    <div
      role="columnheader"
      data-column={props.column.index}
      class="relative flex h-full min-w-0 items-center border-r border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2"
      title={props.column.name}
    >
      <button
        type="button"
        data-slot="sheet-sort"
        class="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={() => props.onSort()}
      >
        <span class="shrink-0 text-11-regular text-v2-text-text-muted">{props.column.letter}</span>
        <span class="truncate text-12-medium text-v2-text-text-base">{props.column.name}</span>
        <Show when={props.sort}>
          {(sort) => <span class="shrink-0 text-10-regular">{sort().dir === "asc" ? "▲" : "▼"}</span>}
        </Show>
      </button>
      <button
        type="button"
        data-slot="sheet-hide-column"
        class="ml-1 shrink-0 rounded px-1 text-12-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
        aria-label={`隐藏 ${props.column.name} 列`}
        onClick={(event) => {
          event.stopPropagation()
          props.onHide()
        }}
      >
        ⋯
      </button>
      <span
        data-slot="sheet-col-resize"
        class="absolute right-0 top-0 h-full w-[5px] cursor-col-resize"
        onPointerDown={(event) => props.onResizeStart(event)}
        onDblClick={() => props.onAutoFit()}
      />
    </div>
  )
}

export interface SheetControlsProps {
  meta: SheetMeta
  columns: 列状态[]
  headerIsFirstRow: boolean
  mode: "full" | "preview"
  truncated: { rows: number; cols: number }
  loadedRows: number
  filteredRows: number
  onToggleHeader(value: boolean): void
  onToggleColumn(index: number, hidden: boolean): void
  onShowAllColumns(): void
  onResetColumns(): void
}

/** 全部列复选清单：搜索列名、全部显示、重置列宽。 */
function 列清单(props: {
  columns: 列状态[]
  onToggle(index: number, hidden: boolean): void
  onShowAll(): void
  onReset(): void
}) {
  const [搜索, set搜索] = createSignal("")
  const 过滤后 = () => props.columns.filter((column) => column.name.toLowerCase().includes(搜索().trim().toLowerCase()))
  return (
    <div data-slot="sheet-column-list" class="max-h-80 w-64 overflow-auto p-2">
      <input
        data-slot="sheet-column-search"
        class="mb-2 w-full rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
        placeholder="搜索列名"
        value={搜索()}
        onInput={(event) => set搜索(event.currentTarget.value)}
      />
      <div class="mb-2 flex gap-2">
        <button type="button" class="text-12-regular underline" onClick={() => props.onShowAll()}>
          全部显示
        </button>
        <button type="button" class="text-12-regular underline" onClick={() => props.onReset()}>
          重置列宽
        </button>
      </div>
      <For each={过滤后()}>
        {(column) => (
          <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-12-regular hover:bg-v2-overlay-simple-overlay-hover">
            <input
              type="checkbox"
              checked={!column.hidden}
              onChange={(event) => props.onToggle(column.index, !event.currentTarget.checked)}
            />
            <span class="text-v2-text-text-muted">{column.letter}</span>
            <span class="truncate">{column.name}</span>
          </label>
        )}
      </For>
    </div>
  )
}

/** 工具栏：表头开关、列清单、行数摘要。筛选条/查找条在后续任务补。 */
export function SheetControls(props: SheetControlsProps): JSX.Element {
  const 数据总行 = () => Math.max(0, props.meta.totalRows - (props.headerIsFirstRow ? 1 : 0))
  return (
    <div
      data-slot="sheet-controls"
      class="flex shrink-0 flex-wrap items-center gap-3 border-b border-v2-border-border-muted px-3 py-1.5"
    >
      <label class="flex items-center gap-1 text-12-regular text-v2-text-text-base">
        <input
          type="checkbox"
          data-slot="sheet-header-toggle"
          checked={props.headerIsFirstRow}
          onChange={(event) => props.onToggleHeader(event.currentTarget.checked)}
        />
        首行是表头
      </label>
      <span class="text-12-regular text-v2-text-text-muted" data-slot="sheet-row-summary">
        筛选后 {props.filteredRows} 行 / 共 {数据总行()} 行
      </span>
      <Popover
        trigger={
          <button
            type="button"
            data-slot="sheet-columns-trigger"
            class="rounded px-2 py-1 text-12-regular hover:bg-v2-overlay-simple-overlay-hover"
          >
            列（显示 {props.columns.filter((column) => !column.hidden).length} / {props.columns.length} 列）
          </button>
        }
      >
        <列清单
          columns={props.columns}
          onToggle={(index, hidden) => props.onToggleColumn(index, hidden)}
          onShowAll={() => props.onShowAllColumns()}
          onReset={() => props.onResetColumns()}
        />
      </Popover>
    </div>
  )
}
