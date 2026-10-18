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
  查找命中,
  type Cell,
  type ColumnType,
  type SheetMeta,
  type 列筛选,
  type 查找命中项,
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
  const [filters, setFilters] = createSignal(props.initial?.filters ?? [])
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

  // 零数据优先于筛选无结果（两者同时成立时说明表本身就是空的）；解析中断时保留已加载行，不出空态。
  const 空态 = () => {
    if (props.store.error()) return undefined
    if (首行是表头() && 已载行数() <= 1) return "这张表没有数据"
    if (!首行是表头() && 已载行数() === 0) return "这张表没有数据"
    if (filters().length > 0 && 显示行().length === 0) return "没有符合筛选条件的行"
    return undefined
  }

  const [查找开, set查找开] = createSignal(false)
  const [查找词, set查找词] = createSignal("")
  const [查找序号, set查找序号] = createSignal(0)
  const [查找结果, set查找结果] = createSignal<查找命中项[]>([])
  const [查找在筛选外, set查找在筛选外] = createSignal(false)

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

  const onFindKey = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return
    const root = scrollEl()
    const active = document.activeElement
    if (active && active !== document.body && !root?.contains(active)) return
    event.preventDefault()
    set查找开(true)
  }

  /**
   * 待恢复的滚动位置。大表挂载时只有首屏 201 行（`sheet-view` 的 >20 万格不缓存也会重解析），
   * 内容还不够高 ⇒ 此时直接赋值会被浏览器钳位；把钳位值写回缓存就把真实位置永久丢了。
   * 所以先记账，等分块让目标位置可达后再应用一次。
   */
  const 初始滚动顶 = props.initial?.scrollTop ?? 0
  const 初始滚动左 = props.initial?.scrollLeft ?? 0
  let 待恢复: { top?: number; left?: number } | undefined =
    初始滚动顶 > 0 || 初始滚动左 > 0
      ? {
          top: 初始滚动顶 > 0 ? 初始滚动顶 : undefined,
          left: 初始滚动左 > 0 ? 初始滚动左 : undefined,
        }
      : undefined
  /** 程序设置滚动期间为 true：此时到来的 scroll 事件不得被当成用户主动滚动。 */
  let 正在恢复 = false
  let 恢复帧: number | undefined

  const 尝试恢复 = (element: HTMLDivElement) => {
    if (!待恢复) return
    const 可滚顶 = Math.max(0, element.scrollHeight - element.clientHeight)
    const 可滚左 = Math.max(0, element.scrollWidth - element.clientWidth)
    let 应用顶: number | undefined
    let 应用左: number | undefined
    if (待恢复.top !== undefined && 可滚顶 >= 待恢复.top) {
      应用顶 = 待恢复.top
      delete 待恢复.top
    }
    if (待恢复.left !== undefined && 可滚左 >= 待恢复.left) {
      应用左 = 待恢复.left
      delete 待恢复.left
    }
    if (待恢复.top === undefined && 待恢复.left === undefined) 待恢复 = undefined
    if (应用顶 === undefined && 应用左 === undefined) return
    正在恢复 = true
    if (应用顶 !== undefined) element.scrollTop = 应用顶
    if (应用左 !== undefined) element.scrollLeft = 应用左
    // 程序赋值引发的 scroll 事件在本帧内到达；下一帧再放开，用户之后的滚动才算主动滚动。
    requestAnimationFrame(() => {
      正在恢复 = false
    })
  }

  const 安排恢复 = () => {
    if (!待恢复 || 恢复帧 !== undefined) return
    恢复帧 = requestAnimationFrame(() => {
      恢复帧 = undefined
      const element = scrollEl()
      if (element && 待恢复) 尝试恢复(element)
    })
  }

  const 取消待恢复 = () => {
    待恢复 = undefined
    if (恢复帧 !== undefined) {
      cancelAnimationFrame(恢复帧)
      恢复帧 = undefined
    }
  }

  onMount(() => {
    // 首帧后尝试一次：内容已够高（小表/命中缓存的大表）就原位恢复；不够高则继续等分块。
    if (待恢复) 安排恢复()
    window.addEventListener("keydown", onFindKey)
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onFindKey)
    if (恢复帧 !== undefined) cancelAnimationFrame(恢复帧)
  })

  // 分块追加 / setDone 都推进 rowsVersion：每次推进都再看看目标位置是否已可达。
  createEffect(() => {
    props.store.rowsVersion()
    if (待恢复) 安排恢复()
  })

  const 滚到行 = (row: number) => {
    const at = 显示行().indexOf(row)
    if (at >= 0) virtualizer.scrollToIndex(at, { align: "center" })
  }

  /** 纵向滚到命中行后，把命中列也带进视口（spec §7.4「命中项滚动到视口」）。 */
  const 滚到命中 = (hit: 查找命中项) => {
    滚到行(hit.row)
    const element = scrollEl()
    if (!element) return
    const 可见 = 可见列()
    const 位置 = 可见.findIndex((column) => column.index === hit.col)
    if (位置 < 0) return // 隐藏列不占位，也无需横向滚动
    const 起点 = 规模.行号列宽 + 可见.slice(0, 位置).reduce((sum, column) => sum + column.width, 0)
    const 右 = 起点 + 可见[位置].width
    // 冻结行号列贴在视口左侧、盖住内容坐标 [scrollLeft, scrollLeft + 行号列宽)：
    // 可见左界要从它右缘算起，否则命中格头几像素会被压在行号列下面仍被判「已可见」。
    const 可见左 = element.scrollLeft + 规模.行号列宽
    if (起点 >= 可见左 && 右 <= element.scrollLeft + element.clientWidth) return
    const 最大左 = Math.max(0, element.scrollWidth - element.clientWidth)
    const 目标 = 起点 + 可见[位置].width / 2 - (element.clientWidth + 规模.行号列宽) / 2
    element.scrollLeft = Math.max(0, Math.min(最大左, 目标))
  }

  createEffect(() => {
    const query = 查找词()
    props.store.rowsVersion()
    // ⚠️ 依赖必须在 effect 体内读、在定时器里用（定时器里的读不参与追踪，
    // 否则「隐藏列/新分块」不会触发重算）。
    const columns = 可见列().map((column) => column.index)
    const rows = 全部数据行()
    const timer = setTimeout(() => {
      const result = 查找命中(props.store.rows, rows, columns, query)
      set查找结果(result)
      set查找序号(0)
      if (result[0]) 滚到命中(result[0])
    }, 150)
    onCleanup(() => clearTimeout(timer))
  })

  const 当前命中 = createMemo(() => 查找结果()[查找序号()])

  createEffect(() => {
    const hit = 当前命中()
    set查找在筛选外(!!hit && !显示行().includes(hit.row))
  })

  const 下一处 = (delta: 1 | -1) => {
    const total = 查找结果().length
    if (!total) return
    const next = (查找序号() + delta + total) % total
    set查找序号(next)
    const hit = 查找结果()[next]
    滚到命中(hit)
  }

  const 关闭查找 = () => {
    set查找开(false)
    set查找词("")
    set查找结果([])
    set查找序号(0)
  }

  const 命中键 = createMemo(() => new Set(查找结果().map((hit) => `${hit.row}:${hit.col}`)))
  const 当前键 = createMemo(() => {
    const hit = 当前命中()
    return hit ? `${hit.row}:${hit.col}` : ""
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
        error={props.store.error()}
        onToggleHeader={set首行是表头}
        onToggleColumn={(index, hidden) => set列(index, "hidden", hidden)}
        onShowAllColumns={() => 列.forEach((_, index) => set列(index, "hidden", false))}
        onResetColumns={() =>
          列.forEach((column, index) => {
            const start = 首行是表头() ? 1 : 0
            const 样本 = props.store.rows.slice(start, start + 200).map((row) => row[index] ?? null)
            set列(index, "width", 估算列宽(column.name, 样本))
          })
        }
        filters={filters()}
        onRemoveFilter={(index) => setFilters((当前) => 当前.filter((_, i) => i !== index))}
        onClearFilters={() => setFilters([])}
        find={{
          open: 查找开(),
          query: 查找词(),
          index: 查找序号(),
          total: 查找结果().length,
          hiddenHit: 查找在筛选外(),
        }}
        onFindQuery={(query) => {
          set查找开(true)
          set查找词(query)
        }}
        onFindNext={下一处}
        onCloseFind={关闭查找}
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
          onScroll={(event) => {
            // 恢复赋值引发的 scroll 不是用户主动滚动：既不写缓存，也不取消待恢复目标。
            if (正在恢复) return
            // 用户主动滚动 ⇒ 放弃待恢复，别在后续分块落地时把用户拽回旧位置。
            if (待恢复) 取消待恢复()
            setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })
          }}
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
                    filter={filters().find((filter) => filter.column === column.index)}
                    rows={props.store.rows}
                    start={首行是表头() ? 1 : 0}
                    onSort={() => 切换排序(column.index)}
                    onHide={() => set列(column.index, "hidden", true)}
                    onResizeStart={(event) => 开始拖列宽(event, column.index)}
                    onAutoFit={() => 自适应(column.index)}
                    onApplyFilter={(filter) =>
                      setFilters((当前) => {
                        const 其余 = 当前.filter((item) => item.column !== column.index)
                        return filter ? [...其余, filter] : 其余
                      })
                    }
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
                              class={`truncate border-r border-b border-v2-border-border-muted px-2 py-0 leading-7 text-12-regular text-v2-text-text-base ${右对齐 ? "text-right" : "text-left"} ${
                                当前键() === `${原始行()}:${column.index}`
                                  ? "bg-v2-background-bg-layer-02 ring-1 ring-inset ring-v2-border-border-strong"
                                  : 命中键().has(`${原始行()}:${column.index}`)
                                    ? "bg-v2-overlay-simple-overlay-hover"
                                    : ""
                              }`}
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
          <Show when={空态()}>
            {(文案) => (
              <div
                data-slot={文案() === "没有符合筛选条件的行" ? "sheet-filter-empty" : "sheet-empty"}
                class="flex items-center justify-center gap-2 p-6 text-13-regular text-v2-text-text-muted"
              >
                {文案()}
                <Show when={文案() === "没有符合筛选条件的行"}>
                  <button type="button" class="underline" onClick={() => setFilters([])}>
                    清除筛选
                  </button>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
