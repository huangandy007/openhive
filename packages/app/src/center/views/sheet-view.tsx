import { untrack } from "solid-js"
import { render } from "solid-js/web"
import type { ViewComponent } from "@/center/view-registry"
import { 当前重载代 } from "@/center/session-edits"
import { BinaryView, type RenderCleanup } from "./binary-view"
import { 规模, type 解析限制 } from "./sheet/sheet-model"
import { 解析表格 } from "./sheet/sheet-parse"
import { createSheetStore, SheetGrid, type SheetUiState } from "./sheet/sheet-grid"
import { 缓存键, 读UI状态, 写UI状态, 读数据, 写数据, 数据格数 } from "./sheet/sheet-state-cache"

export { 行上界, 列上界, 是加密工作簿 } from "./sheet/sheet-model"

export interface SheetRenderOptions {
  缓存键?: string
  limits?: 解析限制
  /** 测试用：跳过 Worker。生产不传。 */
  强制主线程?: boolean
}

function 挂载(
  container: HTMLElement,
  store: ReturnType<typeof createSheetStore>,
  初始: SheetUiState | undefined,
  保存: ((state: SheetUiState) => void) | undefined,
): RenderCleanup {
  return render(() => <SheetGrid store={store} initial={初始} onChange={保存} />, container)
}

/**
 * `renderSheet` 自己比 `BytesRenderer` 多一个可选参数（限制注入 / 强制主线程），
 * 且返回的 cleanup 恒存在。这个类型可赋值给 `BinaryView` 的 `render` 槽位；当前经包装箭头传入
 * （补缓存键），并允许测试传第三参（若标成 `BytesRenderer`，测试传三参会 TS 报错）。
 */
export type SheetRenderer = (
  bytes: Uint8Array<ArrayBuffer>,
  container: HTMLElement,
  options?: SheetRenderOptions,
) => Promise<RenderCleanup>

/**
 * 字节 → 网格。
 *
 * 先用 `解析表格` 等首屏 meta（加密/损坏会在这里 reject，交给 BinaryView 的壳分档）；
 * meta 一到就挂载网格并 resolve，后续 chunk 由 store 追加——**不等全量**。
 * 返回的 cleanup 卸载 Solid 根并终止解析/Worker。
 */
export const renderSheet: SheetRenderer = async (bytes, container, options) => {
  const key = options?.缓存键
  const 初始 = key ? 读UI状态(key) : undefined
  const 保存 = key ? (state: SheetUiState) => 写UI状态(key, state) : undefined
  const 缓存 = key ? 读数据(key) : undefined

  if (缓存) {
    const store = createSheetStore(缓存.meta, 缓存.mode, 缓存.truncated)
    const 首屏行数 = 缓存.meta.preview.length
    if (缓存.rows.length > 首屏行数) store.appendChunk(首屏行数, 缓存.rows.slice(首屏行数))
    const dispose = 挂载(container, store, 初始, 保存)
    return () => dispose()
  }

  let store: ReturnType<typeof createSheetStore> | undefined
  let dispose: RenderCleanup | undefined
  let 已挂载 = false

  const 任务 = 解析表格(
    bytes,
    {
      onMeta(meta) {
        store = createSheetStore(meta, "full", { rows: 0, cols: 0 })
        dispose = 挂载(container, store, 初始, 保存)
        已挂载 = true
      },
      onChunk(start, rows) {
        store?.appendChunk(start, rows)
      },
      onDone(mode, truncated) {
        store?.setDone(mode, truncated)
        if (!store || !key) return
        const 数据 = { meta: store.meta, rows: [...store.rows], mode, truncated }
        if (数据格数(数据.rows) <= 规模.缓存格上限) 写数据(key, 数据)
      },
      onError(_kind, message) {
        if (!已挂载) return // ready 会 reject，交给 renderSheet 抛出
        store?.setError(message)
      },
    },
    { limits: options?.limits, 强制主线程: options?.强制主线程 },
  )

  try {
    await 任务.ready
  } catch (原因) {
    任务.cancel()
    dispose?.()
    throw 原因
  }

  return () => {
    任务.cancel()
    dispose?.()
  }
}

export const SheetView: ViewComponent = (props) => (
  <BinaryView
    name="sheet-view"
    path={props.path}
    load={props.load}
    render={(bytes, container) =>
      renderSheet(bytes, container, {
        缓存键: 缓存键(props.path, untrack(() => 当前重载代(props.path))),
      })
    }
  />
)
