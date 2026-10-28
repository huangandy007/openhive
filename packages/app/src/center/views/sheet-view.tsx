import { createEffect, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { ViewComponent } from "@/center/view-registry"
import { 当前重载代 } from "@/center/session-edits"
import { currentProject } from "@/project/current-project"
import { BinaryView, type RenderCleanup } from "./binary-view"
import { 规模, type 工作表项, type 解析限制, type SheetMeta, type Cell } from "./sheet/sheet-model"
import { 解析表格 } from "./sheet/sheet-parse"
import { createSheetStore, SheetGrid, type SheetStore, type SheetUiState } from "./sheet/sheet-grid"
import { SheetTabs } from "./sheet/sheet-tabs"
import {
  缓存键,
  表键,
  记上次表,
  读上次表,
  读UI状态,
  写UI状态,
  读数据,
  写数据,
  数据格数,
} from "./sheet/sheet-state-cache"

export { 行上界, 列上界, 是加密工作簿 } from "./sheet/sheet-model"

export interface SheetRenderOptions {
  缓存键?: string
  limits?: 解析限制
  /** 测试用：跳过 Worker。生产不传。 */
  强制主线程?: boolean
}

interface WorkbookProps {
  bytes: Uint8Array<ArrayBuffer>
  /** 文件级键（项目 + 路径 + 重载代）；单表的键是它 + 表名。 */
  基键?: string
  limits?: 解析限制
  强制主线程?: boolean
  /** 首屏 meta 到达：把控制权交回 `renderSheet`（壳可以落 ready）。 */
  onReady(): void
  /** 首屏 meta 之前就失败（加密/损坏/表名不存在）：壳按错误分档。 */
  onFail(原因: unknown): void
}

interface 当前视图 {
  store: SheetStore
  ui?: SheetUiState
  表: string
}

/**
 * 一本工作簿 = 一条底部标签栏 + 一个网格。
 *
 * 换表的动作是「改 `请求表`」：effect 只跟踪它，所以
 * ① `onMeta` 里回填表清单/视图**不会**再触发一次解析（写信号不构成依赖）；
 * ② 换表时上一趟解析被 `onCleanup` 终止（`任务.cancel()`），不会有两趟并行往同一个网格追 chunk；
 * ③ 网格靠 `<Show keyed>` 按视图对象身份重建，列宽/筛选/滚动位置从**该表自己的**缓存键恢复。
 */
function WorkbookView(props: WorkbookProps): JSX.Element {
  const [清单, set清单] = createSignal<readonly 工作表项[]>([])
  /** `undefined` = 还没定表（打开时不知道第一张叫什么），按第一张解析。 */
  const [请求表, set请求表] = createSignal(props.基键 ? 读上次表(props.基键) : undefined)
  const [视图, set视图] = createSignal<当前视图>()
  const [提示, set提示] = createSignal("正在读取…")
  let 首次 = true

  const 完成首次 = () => {
    if (!首次) return
    首次 = false
    props.onReady()
  }

  /** 把一份 meta（来自解析或缓存）挂成当前视图；`rows` 有值表示整份数据来自缓存。 */
  const 挂上 = (
    meta: SheetMeta,
    mode: "full" | "preview",
    truncated: { rows: number; cols: number },
    rows: Cell[][] | undefined,
    表: string,
  ) => {
    const store = createSheetStore(meta, mode, truncated)
    if (rows) {
      const 首屏行数 = meta.preview.length
      if (rows.length > 首屏行数) store.appendChunk(首屏行数, rows.slice(首屏行数))
    }
    set清单(meta.sheets)
    set视图({
      store,
      ui: props.基键 ? 读UI状态(表键(props.基键, 表)) : undefined,
      表,
    })
  }

  createEffect(() => {
    const 表 = 请求表() // ← 本 effect 唯一的依赖；换表就是改它
    const 键 = (名: string) => (props.基键 ? 表键(props.基键, 名) : undefined)

    // 已知表名就先看缓存：这一路连解析都不用起。
    const 缓存的键 = 表 === undefined ? undefined : 键(表)
    if (缓存的键) {
      const 缓存 = 读数据(缓存的键)
      if (缓存) {
        挂上(缓存.meta, 缓存.mode, 缓存.truncated, 缓存.rows, 缓存.meta.sheetName)
        完成首次()
        return
      }
    }

    const 任务 = 解析表格(
      props.bytes,
      {
        onMeta(meta) {
          挂上(meta, "full", { rows: 0, cols: 0 }, undefined, meta.sheetName)
          if (props.基键) 记上次表(props.基键, meta.sheetName)
          完成首次()
        },
        onChunk(start, rows) {
          视图()?.store.appendChunk(start, rows)
        },
        onDone(mode, truncated) {
          const 当前 = 视图()
          if (!当前) return
          当前.store.setDone(mode, truncated)
          const 单表键 = 键(当前.表)
          if (!单表键) return
          const 数据 = { meta: 当前.store.meta, rows: [...当前.store.rows], mode, truncated }
          if (数据格数(数据.rows) <= 规模.缓存格上限) 写数据(单表键, 数据)
        },
        onError(_kind, message) {
          // 首屏 meta 之前的那次由 `任务.ready` reject 交给壳；这里只在「换表失败」时落到网格里。
          set提示(message)
          视图()?.store.setError(message)
        },
      },
      { limits: props.limits, 强制主线程: props.强制主线程, sheetName: 表 },
    )

    任务.ready.catch((原因) => {
      if (!首次) return
      // 打开时用的是「上次看的那张表」，而它可能已经不在这个文件里了（文件被换过而重载代没变）。
      // 这是我们自己的记忆、不是用户点名的请求 ⇒ 退回第一张重来一次；真坏了（加密/损坏）再抛给壳。
      if (表 !== undefined && 原因 instanceof Error && 原因.message.includes("工作表不存在")) {
        set请求表(undefined)
        return
      }
      首次 = false
      props.onFail(原因)
    })

    onCleanup(() => 任务.cancel())
  })

  const 切表 = (name: string) => {
    if (name === (视图()?.表 ?? 请求表())) return
    // 先清屏再解析：绝不能把上一张表的数据留在屏上冒充新表（读得慢时那是最容易骗过人的一刻）。
    set视图(undefined)
    set提示(`正在读取「${name}」…`)
    set请求表(name)
  }

  return (
    <div data-slot="sheet-workbook" class="flex h-full min-h-0 w-full flex-col">
      <div class="min-h-0 flex-1">
        <Show
          when={视图()}
          keyed
          fallback={
            <div
              data-slot="sheet-loading"
              class="flex h-full items-center justify-center p-6 text-13-regular text-v2-text-text-muted"
            >
              {提示()}
            </div>
          }
        >
          {(当前) => (
            <SheetGrid
              store={当前.store}
              initial={当前.ui}
              onChange={(state) => {
                if (props.基键) 写UI状态(表键(props.基键, 当前.表), state)
              }}
            />
          )}
        </Show>
      </div>
      <SheetTabs sheets={清单()} current={视图()?.表 ?? ""} onSelect={切表} />
    </div>
  )
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
 * 字节 → 工作簿视图（标签栏 + 网格）。
 *
 * 等**首屏 meta** 就 resolve（不等全量，也不等用户切表）；加密/损坏在 meta 之前 reject，
 * 交给 BinaryView 的壳分档。返回的 cleanup 卸载 Solid 根并终止在跑的解析。
 */
export const renderSheet: SheetRenderer = async (bytes, container, options) => {
  let 就绪!: { resolve(): void; reject(原因: unknown): void }
  const 首屏 = new Promise<void>((resolve, reject) => {
    就绪 = { resolve, reject }
  })
  const dispose = render(
    () => (
      <WorkbookView
        bytes={bytes}
        基键={options?.缓存键}
        limits={options?.limits}
        强制主线程={options?.强制主线程}
        onReady={() => 就绪.resolve()}
        onFail={(原因) => 就绪.reject(原因)}
      />
    ),
    container,
  )
  try {
    await 首屏
  } catch (原因) {
    dispose()
    throw 原因
  }
  return () => dispose()
}

export const SheetView: ViewComponent = (props) => (
  <BinaryView
    name="sheet-view"
    path={props.path}
    load={props.load}
    render={(bytes, container) =>
      renderSheet(bytes, container, {
        // 项目身份必须在键里：换项目会把重载代重置为 0（`清空会话改过`），只按 path+代
        // 做键会让项目 B 的同相对路径文件命中项目 A 的数据。项目与代都用 `untrack` 读，
        // 不把它们挂进 render 回调外层的响应式依赖。
        缓存键: 缓存键(
          untrack(() => currentProject()?.id ?? ""),
          props.path,
          untrack(() => 当前重载代(props.path)),
        ),
      })
    }
  />
)
