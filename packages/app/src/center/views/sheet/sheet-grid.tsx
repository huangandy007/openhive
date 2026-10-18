import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createVirtualizer } from "@tanstack/solid-virtual"
import {
  估算列宽,
  拖拽后列宽,
  列标,
  规模,
  排序行,
  筛选行,
  type Cell,
  type ColumnType,
  type SheetMeta,
  type 列筛选,
} from "./sheet-model"
import { SheetControls, 表头格, 表头高, type 列状态 } from "./sheet-controls"

export interface SheetStore {
  readonly meta: SheetMeta
  readonly rows: Cell[][]
  rowsVersion(): number
  loadedRows(): number
  error(): string | undefined
  readonly mode: "full" | "preview"
  readonly truncated: { rows: number; cols: number }
  appendChunk(start: number, rows: Cell[][]): void
  setDone(mode: "full" | "preview", truncated: { rows: number; cols: number }): void
  setError(message: string): void
}

export function createSheetStore(
  meta: SheetMeta,
  mode: "full" | "preview",
  truncated: { rows: number; cols: number },
): SheetStore {
  const rows: Cell[][] = [...meta.preview]
  const [版本, set版本] = createSignal(0)
  const [已载, set已载] = createSignal(rows.length)
  const [错误, set错误] = createSignal<string>()
  const [档, set档] = createSignal(mode)
  const [截断, set截断] = createSignal(truncated)
  return {
    meta,
    rows,
    rowsVersion: 版本,
    loadedRows: 已载,
    error: 错误,
    get mode() {
      return 档()
    },
    get truncated() {
      return 截断()
    },
    appendChunk(start, chunk) {
      for (let i = 0; i < chunk.length; i++) rows[start + i] = chunk[i]
      set已载(start + chunk.length)
      set版本((value) => value + 1)
    },
    setDone(nextMode, nextTruncated) {
      set档(nextMode)
      set截断(nextTruncated)
      set版本((value) => value + 1)
    },
    setError(message) {
      set错误(message)
    },
  }
}

export interface SheetUiState {
  headerIsFirstRow: boolean
  columns: 列状态[]
  filters: 列筛选[]
  sort?: { column: number; dir: "asc" | "desc" }
  scrollTop: number
  scrollLeft: number
}

export interface SheetGridProps {
  store: SheetStore
  initial?: SheetUiState
  onChange?(state: SheetUiState): void
}

function 初始列(meta: SheetMeta, saved?: SheetUiState): 列状态[] {
  // 与「自适应」同一前提：首行是表头才跳过第 0 行；否则第 0 行也是数据。
  const 起点 = (saved?.headerIsFirstRow ?? true) ? 1 : 0
  const 样本 = meta.preview.slice(起点, 起点 + 200)
  return Array.from({ length: meta.header.length }, (_, index) => {
    const 存过 = saved?.columns.find((column) => column.index === index)
    const letter = 列标(meta.startCol + index)
    const name = meta.header[index] || letter
    return {
      index,
      letter,
      name,
      type: meta.columnTypes[index] ?? ("text" as ColumnType),
      width:
        存过?.width ??
        估算列宽(
          name,
          样本.map((row) => row[index] ?? null),
        ),
      hidden: 存过?.hidden ?? false,
    }
  })
}

export function SheetGrid(props: SheetGridProps): JSX.Element {
  const [首行是表头, set首行是表头] = createSignal(props.initial?.headerIsFirstRow ?? true)
  const [列, set列] = createStore(初始列(props.store.meta, props.initial))
  const [filters] = createSignal(props.initial?.filters ?? [])
  const [sort, setSort] = createSignal(props.initial?.sort)
  const [scroll, setScroll] = createSignal({ top: props.initial?.scrollTop ?? 0, left: props.initial?.scrollLeft ?? 0 })
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()

  const 可见列 = createMemo(() => 列.filter((column) => !column.hidden))
  const 模板 = createMemo(
    () =>
      `${规模.行号列宽}px ${可见列()
        .map((column) => `${column.width}px`)
        .join(" ")}`,
  )
  const 总宽 = createMemo(() => 规模.行号列宽 + 可见列().reduce((sum, column) => sum + column.width, 0))

  // `rows` 是普通数组、`rowsVersion` 才是信号：凡是要跟着分块追加刷新的读，都必须先读版本。
  const 已载行数 = createMemo(() => {
    props.store.rowsVersion()
    return props.store.rows.length
  })

  const 全部数据行 = createMemo(() => {
    const start = 首行是表头() ? 1 : 0
    const result: number[] = []
    for (let index = start; index < 已载行数(); index++) result.push(index)
    return result
  })

  const 显示行 = createMemo(() => {
    let result = 全部数据行()
    if (filters().length) result = 筛选行(props.store.rows, result, filters())
    const 当前排序 = sort()
    if (当前排序)
      result = 排序行(props.store.rows, result, 当前排序.column, 当前排序.dir, 列[当前排序.column]?.type ?? "text")
    return result
  })

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return 显示行().length
    },
    getScrollElement: () => scrollEl() ?? null,
    initialRect: { width: 800, height: 600 },
    estimateSize: () => 规模.行高,
    overscan: 8,
    get getItemKey() {
      const current = 显示行()
      return (index: number) => current[index] ?? index
    },
  })

  onMount(() => {
    const element = scrollEl()
    if (!element) return
    element.scrollTop = props.initial?.scrollTop ?? 0
    element.scrollLeft = props.initial?.scrollLeft ?? 0
  })

  const 当前状态 = (): SheetUiState => ({
    headerIsFirstRow: 首行是表头(),
    columns: 列.map((column) => ({ ...column })),
    filters: filters(),
    sort: sort(),
    scrollTop: scroll().top,
    scrollLeft: scroll().left,
  })

  createEffect(() => {
    const state = 当前状态()
    untrack(() => props.onChange?.(state))
  })

  const 切换排序 = (index: number) => {
    const 当前 = sort()
    if (!当前 || 当前.column !== index) setSort({ column: index, dir: "asc" })
    else if (当前.dir === "asc") setSort({ column: index, dir: "desc" })
    else setSort(undefined)
  }

  // 拖拽的 window 监听在 pointerup/pointercancel 时拆；组件若在拖拽中途卸载，
  // 靠这个句柄在 onCleanup 里拆（`onCleanup` 必须在组件 setup 期注册，不能放进事件回调）。
  let 停止拖拽: (() => void) | undefined
  onCleanup(() => 停止拖拽?.())

  const 开始拖列宽 = (event: PointerEvent, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    停止拖拽?.()
    const 起点 = event.clientX
    const 起始 = 列[index].width
    const move = (moveEvent: PointerEvent) => set列(index, "width", 拖拽后列宽(起始, moveEvent.clientX - 起点))
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      if (停止拖拽 === stop) 停止拖拽 = undefined
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    停止拖拽 = stop
  }

  const 自适应 = (index: number) => {
    const 起点 = 首行是表头() ? 1 : 0
    const 样本 = props.store.rows.slice(起点, 起点 + 1000).map((row) => row[index] ?? null)
    set列(index, "width", 估算列宽(列[index].name, 样本))
  }

  return (
    <div
      data-slot="sheet-grid"
      data-loaded-rows={已载行数()}
      data-total-rows={props.store.meta.totalRows}
      data-mode={props.store.mode}
      data-visible-rows={显示行().length}
      class="flex h-full min-h-0 w-full flex-col"
    >
      <SheetControls
        meta={props.store.meta}
        columns={列.map((column) => ({ ...column }))}
        headerIsFirstRow={首行是表头()}
        mode={props.store.mode}
        truncated={props.store.truncated}
        loadedRows={props.store.loadedRows()}
        filteredRows={显示行().length}
        onToggleHeader={set首行是表头}
      />
      <Show
        when={可见列().length > 0}
        fallback={
          <div
            data-slot="sheet-no-columns"
            class="flex flex-1 items-center justify-center p-6 text-13-regular text-v2-text-text-muted"
          >
            所有列都已隐藏。
            <button
              type="button"
              class="ml-2 underline"
              onClick={() => 列.forEach((_, index) => set列(index, "hidden", false))}
            >
              全部显示
            </button>
          </div>
        }
      >
        <div
          ref={setScrollEl}
          data-slot="sheet-scroll"
          class="min-h-0 flex-1 overflow-auto"
          onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
        >
          {/* ARIA 的 rowcount 含表头行；数据行从第 2 行起。行号列里显示的仍是原始 Excel 行号。 */}
          <div
            role="grid"
            aria-rowcount={Math.max(0, props.store.meta.totalRows - (首行是表头() ? 1 : 0)) + 1}
            aria-colcount={可见列().length}
            style={{ width: `${总宽()}px` }}
          >
            <div
              role="row"
              aria-rowindex={1}
              data-slot="sheet-header"
              class="sticky top-0 z-20 grid bg-v2-background-bg-layer-02"
              style={{ "grid-template-columns": 模板(), height: `${表头高}px` }}
            >
              <div
                role="columnheader"
                class="sticky left-0 z-30 flex items-center justify-center border-r border-b border-v2-border-border-strong bg-v2-background-bg-layer-02 text-11-regular text-v2-text-text-muted"
              >
                #
              </div>
              <For each={可见列()}>
                {(column) => (
                  <表头格
                    column={column}
                    sort={sort()?.column === column.index ? sort() : undefined}
                    onSort={() => 切换排序(column.index)}
                    onHide={() => set列(column.index, "hidden", true)}
                    onResizeStart={(event) => 开始拖列宽(event, column.index)}
                    onAutoFit={() => 自适应(column.index)}
                  />
                )}
              </For>
            </div>
            <div style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}>
              <For each={virtualizer.getVirtualItems()}>
                {(item) => {
                  const 原始行 = () => 显示行()[item.index]
                  return (
                    <div
                      role="row"
                      data-slot="sheet-row"
                      data-row={原始行()}
                      aria-rowindex={item.index + 2}
                      class="absolute left-0 top-0 grid hover:bg-v2-overlay-simple-overlay-hover"
                      style={{
                        transform: `translateY(${item.start}px)`,
                        height: `${规模.行高}px`,
                        "grid-template-columns": 模板(),
                      }}
                    >
                      <div
                        role="rowheader"
                        class="sticky left-0 z-10 flex items-center justify-center border-r border-b border-v2-border-border-muted bg-v2-background-bg-base text-11-regular text-v2-text-text-muted"
                      >
                        {props.store.meta.startRow + 原始行() + 1}
                      </div>
                      <For each={可见列()}>
                        {(column) => {
                          // ⚠️ 必须是 getter：排序/筛选/分块会让同一个行位换内容，写成 `const value = ...`
                          // 只在建 DOM 时读一次，之后不会更新（`LEARNINGS #005-48`：读口要读整份/现读）。
                          const value = () => props.store.rows[原始行()]?.[column.index] ?? null
                          const 右对齐 =
                            column.type === "number" || column.type === "date" || column.type === "datetime"
                          return (
                            <div
                              role="gridcell"
                              title={value() ?? ""}
                              class={`truncate border-r border-b border-v2-border-border-muted px-2 py-0 leading-7 text-12-regular text-v2-text-text-base ${右对齐 ? "text-right" : "text-left"}`}
                            >
                              {value() ?? ""}
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
