import { createEffect, createSignal, onCleanup } from "solid-js"
import { decodeBytes, type LoadFileContent } from "@/center/file-content"

/** 视图的呈现状态。`empty` / `error` 的**用户可见**降级呈现归 T015，这里只保证状态可观测。 */
export type BinaryViewState = "pending" | "ready" | "empty" | "error"

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

    setState("pending")
    void (async () => {
      const bytes = decodeBytes(load ? await load(path) : undefined)
      if (!还在()) return
      if (!bytes) {
        setState("empty")
        return
      }
      归还() // 上一份的资源先还掉，再铺新的
      容器.replaceChildren()
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
      if (还在()) setState("error")
    })
  })

  return <div data-component={props.name} data-state={state()} class="w-full min-h-0 overflow-auto" ref={container} />
}
