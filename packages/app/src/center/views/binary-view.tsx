import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { decodeBytes, type LoadFileContent } from "@/center/file-content"
import { DegradedView, type DegradedReason } from "@/center/degraded-view"

/** 视图的呈现状态。`empty` / `error` 另配用户可见的降级提示（见文件末尾的返回）。 */
export type BinaryViewState = "pending" | "ready" | "empty" | "error"

/** 只有这两种状态要画降级提示：`pending` 是「还没好」，`ready` 是「好了」。 */
const 降级原因 = (state: BinaryViewState): DegradedReason | undefined =>
  state === "empty" || state === "error" ? state : undefined

/** 归还渲染时占用的资源（如图片的 object URL）。 */
export type RenderCleanup = () => void

/**
 * 把一份文件的字节渲染进容器。
 *
 * 失败以 rejection 传出——壳据此标 `error`，**渲染器自己不许静默吞掉**：
 * 一个坏文件在界面上「什么都没发生」是最难查的那类故障。
 *
 * 可以返回一个清理函数：持有需要归还的资源的渲染器用它（图片的 `URL.createObjectURL`
 * 不 `revokeObjectURL` 就整份占着内存），壳会在**换内容前**与**卸载时**调用它。
 * 不持有资源的渲染器照旧 `Promise<void>` 即可。
 *
 * `bytes` 的 `ArrayBuffer` 参数（而不是裸 `Uint8Array`）与 `decodeBytes` 同源——见那里的说明。
 */
export type BytesRenderer = (bytes: Uint8Array<ArrayBuffer>, container: HTMLElement) => Promise<void | RenderCleanup>

export interface BinaryViewProps {
  /** 要渲染的文件（内容由 `load` 取，视图不自行取数）。 */
  path: string
  /** 取内容；省略 = 没有内容来源，视图停在 `empty`。 */
  load?: LoadFileContent
  /** 该格式的渲染器——视图的差异**只在**这一个函数里。 */
  render: BytesRenderer
  /** 根元素上的 `data-component` 标识（T017 真实浏览器核对时的定位锚点）。 */
  name: string
}

/**
 * Word / PDF / 图片这类「字节 → 画面」视图的公共壳。
 *
 * 只做四件事：按 path 取内容 → 解成字节 → 交给格式自己的渲染器 → 把结果标在容器上。
 * 格式差异（docx-preview / pdfjs / …）全在 `render` 里，故新增一种字节格式不必再写一遍
 * 取数、竞态、失败处理。
 */
export function BinaryView(props: BinaryViewProps) {
  const [state, setState] = createSignal<BinaryViewState>("pending")
  let container!: HTMLDivElement
  /**
   * 竞态令牌：`path` 一变就作废上一次的异步链。
   * 没有它，快速连点两张 document tab 时先发起的那次可能在后完成，把内容盖回旧的。
   */
  let token = 0
  /** 当前这份渲染占着的资源，由渲染器交回；换内容 / 卸载时归还。 */
  let 待归还: RenderCleanup | undefined
  const 归还 = () => {
    // 先清空再调：清理函数本身若抛错，不至于让「待归还」永远指着一个已经还过的东西。
    const 还 = 待归还
    待归还 = undefined
    还?.()
  }

  // 卸载时也要归还——**并作废令牌**：卸载后到点的渲染若还认为自己「有效」，
  // 它会把清理函数重新挂到 `待归还` 上，而那时已经没有人会再来归还了。
  onCleanup(() => {
    token++
    归还()
  })

  createEffect(() => {
    const path = props.path
    const load = props.load
    const render = props.render
    const mine = ++token
    const 还在 = () => mine === token
    const 容器 = container
    if (!容器) return

    /**
     * 把容器收干净，连同上一份占的资源。
     *
     * 渲染器是往容器里**就地**写 DOM 的，故**每次换内容都得先收**——包括换成「看不了」。
     * 少收一次，屏幕上就会留着上一个文件的画面：民警点开「无.docx」却看着上一份卷宗，
     * 比白屏更糟（白屏至少说明「这里没有东西」）。
     */
    const 清空 = () => {
      归还()
      容器.replaceChildren()
    }

    setState("pending")
    void (async () => {
      const bytes = decodeBytes(load ? await load(path) : undefined)
      if (!还在()) return
      清空() // 无论这一份有没有内容，都先把上一份收干净
      if (!bytes) {
        setState("empty")
        return
      }
      const 本次 = await render(bytes, 容器)
      if (!还在()) {
        // 迟到的那一份（或卸载后才到点的）：它自己占的资源立刻还掉。
        // **不入 `待归还`**，否则会把当前那份的清理函数挤掉，造成真正的漏。
        本次?.()
        return
      }
      待归还 = 本次 ?? undefined // 渲染器不持资源时它回 `void`，别把 `void` 塞进「待归还」
      setState("ready")
    })().catch(() => {
      if (!还在()) return
      // 渲染器可能已经写了一半才抛（取内容失败时容器里则还留着上一个文件的画面）：
      // 残片不跟提示同屏，一并收掉。
      清空()
      setState("error")
    })
  })

  return (
    <>
      <div data-component={props.name} data-state={state()} class="w-full min-h-0 overflow-auto" ref={container} />
      {/* 看不了的时候内容区得说话（FR-007 / US3 AC3）。提示与渲染结果**各占各的位置**：
          渲染器往容器里就地写 DOM，容器仍是那个容器、`data-state` 仍可观测，提示紧跟其后。 */}
      <Show when={降级原因(state())}>{(reason) => <DegradedView reason={reason()} name={props.path} />}</Show>
    </>
  )
}
