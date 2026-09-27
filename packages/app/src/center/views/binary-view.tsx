import { createEffect, createSignal } from "solid-js"
import { decodeBytes, type LoadFileContent } from "@/center/file-content"

/** 视图的呈现状态。`empty` / `error` 的**用户可见**降级呈现归 T015，这里只保证状态可观测。 */
export type BinaryViewState = "pending" | "ready" | "empty" | "error"

/**
 * 把一份文件的字节渲染进容器。
 *
 * 失败以 rejection 传出——壳据此标 `error`，**渲染器自己不许静默吞掉**：
 * 一个坏文件在界面上「什么都没发生」是最难查的那类故障。
 */
export type BytesRenderer = (bytes: Uint8Array, container: HTMLElement) => Promise<void>

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
      容器.replaceChildren()
      await render(bytes, 容器)
      if (!还在()) return
      setState("ready")
    })().catch(() => {
      if (还在()) setState("error")
    })
  })

  return <div data-component={props.name} data-state={state()} class="w-full min-h-0 overflow-auto" ref={container} />
}
