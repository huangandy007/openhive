import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { decodeBytes, type LoadFileContent } from "@/center/file-content"
import { DegradedView, type DegradedReason } from "@/center/degraded-view"
import { 是哪种看不了 } from "./unsupported-format"

/** 视图的呈现状态。`empty` / `unsupported` / `encrypted` / `error` 另配用户可见的降级提示（见文件末尾的返回）。 */
export type BinaryViewState = "pending" | "ready" | "empty" | "unsupported" | "encrypted" | "error"

/**
 * 只有 `pending` 与 `ready` 不画降级提示——其余每个状态都**必须**是 `DegradedReason` 里的一档
 * （写成「排除法」而不是「枚举可画的」：后者多加一个状态时编译得过、界面上却会静默什么都不说，
 * `state` 的联合类型在这里替我们兜住了这件事）。
 */
const 降级原因 = (state: BinaryViewState): DegradedReason | undefined =>
  state === "pending" || state === "ready" ? undefined : state

// 「认得出但不支持」的**机制**在 `unsupported-format.ts`（壳只负责按结果分支）。
// 它当初长在这里，后来搬走：抛它的不只有渲染器，`zip-entry.ts`（一个跟视图无关的字节工具）
// 也要抛——让「读 zip 的工具」反向依赖「视图壳」是把依赖方向弄反了，且标记串会有两份。

/** 归还渲染时占用的资源（如图片的 object URL）。 */
export type RenderCleanup = () => void

/**
 * 降级提示里只放**文件名**，不放整条路径。
 *
 * `D:\案件\2026-0912\卷宗.pdf` 那种前缀对民警是噪音：那句话要回答的是「是哪个文件看不了」，
 * 塞进一整条路径反而更难一眼认出。中栏那条路给的是 tab 标题（本来就是文件名），字节型视图
 * 这一路对齐成同一形状（DESIGN §4.6 的说明模板只写文件名）。
 *
 * 两种分隔符都切——公安那台机器上跑的是 Windows；切不出分隔符时原样交回。
 */
const 文件名 = (path: string) => path.split(/[/\\]/).pop() || path

/**
 * 把一份文件的字节渲染进容器。
 *
 * 失败以 rejection 传出——壳据此标 `error`，**渲染器自己不许静默吞掉**：
 * 一个坏文件在界面上「什么都没发生」是最难查的那类故障。
 * 认得出「这不是我能渲染的写法」时改抛分类标记错——`格式不支持(...)` 落 `unsupported`、
 * `需要密码(...)` 落 `encrypted`（见 `unsupported-format.ts`）。
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
  /**
   * 当前这份渲染占着的资源，由渲染器交回；换内容 / 卸载时归还。
   * **连文件名一起存**：清理函数多半是迟到几步才跑的（换内容时、卸载时），
   * 那时 `props.path` 已经指向下一份文件了——报错信息里挂错文件名比不挂更误导。
   */
  let 待归还: { 还: RenderCleanup; 文件: string } | undefined
  const 归还 = () => {
    // 先清空再调：清理函数本身若抛错，不至于让「待归还」永远指着一个已经还过的东西。
    const 持有 = 待归还
    待归还 = undefined
    if (!持有) return
    try {
      持有.还()
    } catch (原因) {
      // 清理函数是渲染器交来的三方代码，**它抛错不该把「换内容」这件事本身搞砸**：
      // 漏归还顶多占着一份内存，而任它抛出去，异常会穿到下面那条 async 链的 `.catch` 上——
      // 「换了一份文件」被记成「这份文件渲染失败」，视图落 error，真正的故障还被顶替了。
      console.warn(`[openhive] ${props.name} 的清理函数抛错，已忽略（${持有.文件}）`, 原因)
    }
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
      待归还 = 本次 ? { 还: 本次, 文件: path } : undefined // 渲染器不持资源时它回 `void`，别把 `void` 塞进「待归还」
      setState("ready")
    })().catch((原因: unknown) => {
      if (!还在()) return
      // 渲染器可能已经写了一半才抛（取内容失败时容器里则还留着上一个文件的画面）：
      // 残片不跟提示同屏，一并收掉。
      清空()
      const 看不了 = 是哪种看不了(原因)
      // 「这种格式我不认」「这份文件是加密的」都是**已知边界**、不是故障：前者换个工具打开就行，
      // 后者去要密码就行——控制台不必替民警喊。要留痕的是「本该渲染得出来却炸了」——那种在界面上
      // 只变成一句降级提示，最难查；带上是哪个文件：民警截图求助时不会有控制台，排障的那一头要有。
      if (!看不了) console.warn(`[openhive] ${props.name} 渲染失败（${path}）`, 原因)
      setState(看不了 ?? "error")
    })
  })

  return (
    <>
      <div data-component={props.name} data-state={state()} class="w-full min-h-0 overflow-auto" ref={container} />
      {/* 看不了的时候内容区得说话（FR-007 / US3 AC3）。提示与渲染结果**各占各的位置**：
          渲染器往容器里就地写 DOM，容器仍是那个容器、`data-state` 仍可观测，提示紧跟其后。 */}
      <Show when={降级原因(state())}>{(reason) => <DegradedView reason={reason()} name={文件名(props.path)} />}</Show>
    </>
  )
}
