import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import type { Cell, ColumnType, SheetMeta, 列筛选 } from "./sheet-model"

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
  filter?: 列筛选
  rows: readonly Cell[][]
  start: number
  onSort(): void
  onHide(): void
  onResizeStart(event: PointerEvent): void
  onAutoFit(): void
  onApplyFilter(filter: 列筛选 | undefined): void
}

export interface 列筛选浮层Props {
  column: 列状态
  rows: readonly Cell[][]
  start: number
  initial?: 列筛选
  onApply(filter: 列筛选 | undefined): void
}

/** 单列筛选浮层：值清单（带计数/搜索）、包含、等于、为空。 */
export function 列筛选浮层(props: 列筛选浮层Props): JSX.Element {
  type 模式 = "values" | "contains" | "equals" | "blank"
  const 初模式: 模式 = props.initial?.kind ?? "values"
  const [模式, set模式] = createSignal<模式>(初模式)
  const [文本, set文本] = createSignal(
    props.initial?.kind === "contains" || props.initial?.kind === "equals" ? props.initial.text : "",
  )
  const [搜索, set搜索] = createSignal("")
  const [选中, set选中] = createSignal(new Set(props.initial?.kind === "values" ? props.initial.values : []))
  const [含空白, set含空白] = createSignal(props.initial?.kind === "values" ? props.initial.includeBlank : false)

  const 值 = createMemo(() => {
    const counts = new Map<string, number>()
    for (const row of props.rows.slice(props.start)) {
      const key = row[props.column.index] ?? ""
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const 全部 = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN", { numeric: true }))
    const 命中 = 搜索().trim().toLowerCase()
    return 全部.filter(([value]) => value.toLowerCase().includes(命中)).slice(0, 1000)
  })

  const 应用 = () => {
    const mode = 模式()
    if (mode === "blank") return props.onApply({ kind: "blank", column: props.column.index })
    if (mode === "contains" || mode === "equals") {
      const value = 文本().trim()
      return props.onApply(value ? { kind: mode, column: props.column.index, text: value } : undefined)
    }
    const values = [...选中()]
    if (values.length === 0 && !含空白()) return props.onApply(undefined)
    props.onApply({ kind: "values", column: props.column.index, values, includeBlank: 含空白() })
  }

  return (
    <div data-slot="column-filter" data-column={props.column.index} class="w-72 p-2">
      <div class="mb-2 flex flex-wrap gap-2 text-12-regular">
        <label>
          <input type="radio" name="filter-mode" checked={模式() === "values"} onChange={() => set模式("values")} /> 值
        </label>
        <label>
          <input type="radio" name="filter-mode" checked={模式() === "contains"} onChange={() => set模式("contains")} />{" "}
          包含
        </label>
        <label>
          <input type="radio" name="filter-mode" checked={模式() === "equals"} onChange={() => set模式("equals")} /> 等于
        </label>
        <label>
          <input type="radio" name="filter-mode" checked={模式() === "blank"} onChange={() => set模式("blank")} /> 为空
        </label>
      </div>

      <Show
        when={模式() === "values"}
        fallback={
          <Show when={模式() !== "blank"}>
            <input
              data-slot="column-filter-text"
              class="mb-2 w-full rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
              value={文本()}
              onInput={(event) => set文本(event.currentTarget.value)}
              placeholder={模式() === "contains" ? "包含文本" : "完全等于"}
            />
          </Show>
        }
      >
        <input
          data-slot="column-filter-search"
          class="mb-1 w-full rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
          value={搜索()}
          onInput={(event) => set搜索(event.currentTarget.value)}
          placeholder="搜索值"
        />
        <div class="max-h-52 overflow-auto">
          <For each={值()}>
            {([value, count]) => (
              <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-12-regular hover:bg-v2-overlay-simple-overlay-hover">
                <input
                  type="checkbox"
                  checked={value === "" ? 含空白() : 选中().has(value)}
                  onChange={(event) => {
                    if (value === "") {
                      set含空白(event.currentTarget.checked)
                      return
                    }
                    const next = new Set(选中())
                    if (event.currentTarget.checked) next.add(value)
                    else next.delete(value)
                    set选中(next)
                  }}
                />
                <span class="min-w-0 flex-1 truncate">{value === "" ? "（空白）" : value}</span>
                <span class="text-v2-text-text-muted">{count}</span>
              </label>
            )}
          </For>
        </div>
      </Show>

      <div class="mt-2 flex justify-end gap-2">
        <button type="button" class="text-12-regular underline" onClick={() => props.onApply(undefined)}>
          清除本列
        </button>
        <button type="button" class="rounded bg-v2-background-bg-layer-02 px-2 py-1 text-12-medium" onClick={应用}>
          应用
        </button>
      </div>
    </div>
  )
}

/** 表头格：列标 + 列名 + 排序箭头 + 筛选 + 隐藏入口 + 拖拽热区。 */
export function 表头格(props: 表头格Props): JSX.Element {
  const [筛选开, set筛选开] = createSignal(false)
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
      <Popover
        open={筛选开()}
        onOpenChange={set筛选开}
        trigger={
          <button
            type="button"
            data-slot="sheet-col-filter"
            class={`ml-1 shrink-0 rounded px-1 text-12-regular ${props.filter ? "text-v2-text-text-base" : "text-v2-text-text-muted"} hover:bg-v2-overlay-simple-overlay-hover`}
            aria-label={`筛选 ${props.column.name} 列`}
          >
            {props.filter ? "▼" : "▽"}
          </button>
        }
      >
        <列筛选浮层
          column={props.column}
          rows={props.rows}
          start={props.start}
          initial={props.filter}
          onApply={(filter) => {
            props.onApplyFilter(filter)
            set筛选开(false)
          }}
        />
      </Popover>
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

export interface 查找状态 {
  open: boolean
  query: string
  index: number
  total: number
  hiddenHit: boolean
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
  filters: 列筛选[]
  onRemoveFilter(index: number): void
  onClearFilters(): void
  find: 查找状态
  onFindQuery(query: string): void
  onFindNext(delta: 1 | -1): void
  onCloseFind(): void
}

/** 筛选条：每条条件一枚可单独删除的标签，外加「清除全部」。隐藏列的条件照常列出并标注。 */
function 筛选条(props: {
  columns: 列状态[]
  filters: 列筛选[]
  onRemove(index: number): void
  onClear(): void
}) {
  const 描述 = (filter: 列筛选) => {
    const column = props.columns[filter.column]
    const name = column ? `${column.letter} ${column.name}` : `第 ${filter.column + 1} 列`
    const 隐藏 = column?.hidden ? "（该列已隐藏）" : ""
    if (filter.kind === "blank") return `${name} 为空${隐藏}`
    if (filter.kind === "values") return `${name}：${filter.values.length} 个值${filter.includeBlank ? " + 空白" : ""}${隐藏}`
    return `${name} ${filter.kind === "contains" ? "包含" : "="} "${filter.text}"${隐藏}`
  }
  return (
    <Show when={props.filters.length > 0}>
      <div data-slot="sheet-filter-chips" class="flex flex-wrap items-center gap-1 px-3 pb-1">
        <For each={props.filters}>
          {(filter, index) => (
            <span class="inline-flex items-center gap-1 rounded bg-v2-background-bg-layer-02 px-2 py-0.5 text-11-regular">
              {描述(filter)}
              <button type="button" aria-label="删除这条筛选" onClick={() => props.onRemove(index())}>
                ×
              </button>
            </span>
          )}
        </For>
        <button type="button" class="text-11-regular underline" onClick={() => props.onClear()}>
          清除全部
        </button>
      </div>
    </Show>
  )
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

/** 查找条：输入去抖后的命中计数、上/下一处、筛选外提示。 */
function 查找条(props: {
  find: 查找状态
  onQuery(query: string): void
  onNext(delta: 1 | -1): void
  onClose(): void
}) {
  let 输入: HTMLInputElement | undefined
  createEffect(() => {
    if (props.find.open) queueMicrotask(() => 输入?.focus())
  })
  return (
    <Show when={props.find.open}>
      <div
        data-slot="sheet-find"
        class="flex flex-wrap items-center gap-2 border-b border-v2-border-border-muted px-3 py-1"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          props.onClose()
        }}
      >
        <input
          ref={输入}
          data-slot="sheet-find-input"
          class="w-56 rounded border border-v2-border-border-muted px-2 py-1 text-12-regular"
          placeholder="查找（已加载数据、可见列）"
          value={props.find.query}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              props.onNext(event.shiftKey ? -1 : 1)
            }
          }}
        />
        <span data-slot="sheet-find-count" class="text-12-regular text-v2-text-text-muted">
          {props.find.total ? `第 ${props.find.index + 1} / 共 ${props.find.total} 个` : "共 0 个"}
        </span>
        <button type="button" class="text-12-regular underline" onClick={() => props.onNext(-1)}>
          上一处
        </button>
        <button type="button" class="text-12-regular underline" onClick={() => props.onNext(1)}>
          下一处
        </button>
        <button type="button" class="text-12-regular underline" onClick={() => props.onClose()}>
          关闭
        </button>
        <Show when={props.find.hiddenHit}>
          <span data-slot="sheet-find-hidden" class="text-11-regular text-v2-text-text-muted">
            该命中已被筛选隐藏
          </span>
        </Show>
      </div>
    </Show>
  )
}

/** 工具栏：表头开关、列清单、行数摘要、筛选条、查找条。 */
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
      <筛选条
        columns={props.columns}
        filters={props.filters}
        onRemove={(index) => props.onRemoveFilter(index)}
        onClear={() => props.onClearFilters()}
      />
      <button
        type="button"
        data-slot="sheet-find-trigger"
        class="rounded px-2 py-1 text-12-regular hover:bg-v2-overlay-simple-overlay-hover"
        onClick={() => props.onFindQuery(props.find.query)}
      >
        查找
      </button>
      <查找条
        find={props.find}
        onQuery={(query) => props.onFindQuery(query)}
        onNext={(delta) => props.onFindNext(delta)}
        onClose={() => props.onCloseFind()}
      />
    </div>
  )
}
