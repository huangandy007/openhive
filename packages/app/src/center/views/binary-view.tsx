import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js"
import { decodeBytes, type FileContent, type LoadFileContent } from "@/center/file-content"
import { DegradedView, type DegradedReason } from "@/center/degraded-view"
import { 是哪种看不了 } from "./unsupported-format"

/**
 * 视图的呈现状态。`empty` / `unsupported` / `encrypted` / `load-failed` / `error`
 * 另配用户可见的降级提示（见文件末尾的返回）。
 */
export type BinaryViewState = "pending" | "ready" | "empty" | "unsupported" | "encrypted" | "load-failed" | "error"

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
 * 渲染器能报的**进度**（2026-10-29，用户实报「大文件打开像假死」）。
 *
 * 壳只出兜底文案（读取中 / 排版中）与不确定态的条；**具体说法由渲染器给**——
 * 它才知道自己走到哪一步（PDF 报得出「第 3 / 180 页」，Word 只能说「正在解析」）。
 */
export interface 渲染进度 {
  /** 给人看的一句话。 */
  文字: string
  /**
   * 已完成的单位数。**必须与 `共` 成对、且 `共 > 0` 才画确定宽度**——
   * 只有一个数时不猜另一个，退回不确定态（`file-transfer-dialog.tsx` 同一条口径）。
   */
  已?: number
  共?: number
}

export type 报进度 = (进度: 渲染进度) => void

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
 *
 * 第三个参数 `报进度` 是**可选**的：不接它的渲染器（Word / 图片 / 文本……）行为一个字节都不用改，
 * 壳仍会给出「读取中 → 排版中」两段兜底进度；接它的（今天的 PDF）能把真数报上来。
 */
export type BytesRenderer = (
  bytes: Uint8Array<ArrayBuffer>,
  container: HTMLElement,
  报进度?: 报进度,
) => Promise<void | RenderCleanup>

/**
 * 进度条**出现前要等多久**（毫秒）。
 *
 * 绝大多数文件几百毫秒内就打开了，条一闪而过比没有更糟（看着像「界面卡了一下」）。
 * 200ms 是「人能感到停顿」的下沿：短于它什么都不该画。
 */
const 出条延迟 = 200

export interface BinaryViewProps {
  /** 要渲染的文件（内容由 `load` 取，视图不自行取数）。 */
  path: string
  /** 取内容；省略 = 没有内容来源，视图停在 `empty`。 */
  load?: LoadFileContent
  /** 该格式的渲染器——视图的差异**只在**这一个函数里。 */
  render: BytesRenderer
  /** 根元素上的 `data-component` 标识（T017 真实浏览器核对时的定位锚点）。 */
  name: string
  /**
   * 内容**读回来之后**回报一次（`undefined` = 没读到）。省略 = 没人关心。
   *
   * 存在的理由只有一条：可编辑的视图要拿「**读回来那份原样**」当存盘时的底本
   * （服务端按它比对「盘上这份变过没有」，见 `@/center/file-content` 的 `SaveFileContent`）。
   * 而**取数只发生在这一处**（`load` 由本壳调用）——让视图自己再读一遍就变成两次请求，
   * 且两次之间盘上可能已经变了，底本与画面对不上。
   *
   * ⚠️ 只在**这一份还有效**时回报（迟到的、卸载后到点的一律不报）：否则切文件的瞬间
   * 上一个文件的内容会把底本盖掉，而症状是「保存永远说文件被改过」——离现场很远。
   */
  onContent?: (content: FileContent | undefined) => void
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
  /** 当前进度（`undefined` ＝ 没在打开）。 */
  const [进度, set进度] = createSignal<渲染进度 | undefined>()
  /** 条露不露——过了 `出条延迟` 才真；小文件的全过程它都是 `false`。 */
  const [露条, set露条] = createSignal(false)
  /** 知道总数才给百分比；否则 `undefined` ＝ 不确定态（不写宽度）。 */
  const 百分比 = (): number | undefined => {
    const 现在 = 进度()
    if (!现在 || 现在.已 === undefined || 现在.共 === undefined || 现在.共 <= 0) return undefined
    return Math.min(100, Math.floor((现在.已 / 现在.共) * 100))
  }
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

    /**
     * 进度条的起落都挂在**这一条 effect** 上：换文件时上一次的定时器必须撤掉，
     * 否则它会在下一个文件已经 ready 之后把条又推出来——而那时再没有谁去收它。
     */
    let 条定时: ReturnType<typeof setTimeout> | undefined
    const 收起进度 = () => {
      if (条定时 !== undefined) clearTimeout(条定时)
      条定时 = undefined
      set露条(false)
      set进度(undefined)
    }
    onCleanup(() => {
      if (条定时 !== undefined) clearTimeout(条定时)
    })

    setState("pending")
    set进度({ 文字: "正在读取文件…" })
    set露条(false)
    条定时 = setTimeout(() => set露条(true), 出条延迟)

    void (async () => {
      const 内容 = load ? await load(path) : undefined
      if (!还在()) return
      // 回报**在解字节之前**：可编辑的视图要的是**原样那份文本**（服务端的 `base` 判据就是这么
      // 算的），不是解出来的字节。晚报一步也无害——顺序只是让「底本」早于画面就位。
      // ⚠️ 必须 `untrack`：没有 `load` 时上面那次三目**不 await**，这句就落在 effect 的**同步**
      // 段里——`props.onContent` 会被收进依赖图，调用方每换一次函数身份就重跑这个 effect
      // （文件重读一遍、画面重画一遍），而那件事**不报错、只是变慢**。
      untrack(() => props.onContent?.(内容))
      const bytes = decodeBytes(内容)
      清空() // 无论这一份有没有内容，都先把上一份收干净
      if (!bytes) {
        收起进度()
        setState("empty")
        return
      }
      // 字节到手 ⇒ 从「读取」切到「排版」；接这个回调的渲染器会把它替换成真数（PDF 的页数）。
      set进度({ 文字: "正在排版…" })
      const 本次 = await render(bytes, 容器, (新) => {
        // 迟到的渲染不许改当前这份的进度：那是别人文件的页数。
        if (还在()) set进度(新)
      })
      if (!还在()) {
        // 迟到的那一份（或卸载后才到点的）：它自己占的资源立刻还掉。
        // **不入 `待归还`**，否则会把当前那份的清理函数挤掉，造成真正的漏。
        本次?.()
        return
      }
      收起进度()
      待归还 = 本次 ? { 还: 本次, 文件: path } : undefined // 渲染器不持资源时它回 `void`，别把 `void` 塞进「待归还」
      setState("ready")
    })().catch((原因: unknown) => {
      if (!还在()) return
      收起进度()
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
      {/*
        打开进度条（2026-10-29，用户实报「大文件打开像假死」）。

        ## 为什么是「零高度 + 绝对定位」

        中栏是 `flex-col`，这层要是占几像素的盒高，条消失的那一刻下面的内容会**跳一下**——
        打开完成的瞬间最不该晃。`h-0` 让它不占位，里面的条与标签绝对定位浮在内容上缘。

        ## 为什么放在**滚动容器外面**

        渲染器往容器里**就地**写 DOM，PDF 每页重画还会 `replaceChildren` 整个容器——
        放里面就会被一起抹掉。放外面，它就不归任何渲染器管。

        ## 不确定态不写宽度

        知道 `已/共` 才画确定宽度；否则 `animate-pulse` 走满宽——与
        `file-transfer-dialog.tsx` / `minio-bar.tsx` 同一套语言。假百分比（卡 90%、
        来回跳）比没有进度条更伤信任。
      */}
      <Show when={露条() && 进度()}>
        <div data-slot="open-progress" class="pointer-events-none relative h-0 w-full shrink-0">
          <span
            role="progressbar"
            aria-label="打开进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={百分比()}
            data-indeterminate={百分比() === undefined ? "true" : "false"}
            class="absolute inset-x-0 top-0 block h-[3px] overflow-hidden bg-v2-overlay-simple-overlay-hover"
          >
            <span
              data-slot="open-progress-fill"
              class={
                百分比() === undefined
                  ? "block h-full w-full animate-pulse bg-v2-text-text-base"
                  : "block h-full bg-v2-text-text-base transition-[width]"
              }
              style={百分比() === undefined ? undefined : { width: `${百分比()}%` }}
            />
          </span>
          <span
            data-slot="open-progress-label"
            class="absolute top-2 left-4 rounded bg-v2-overlay-simple-overlay-hover px-2 py-1 text-[11px] text-v2-text-text-base"
          >
            正在打开 {文件名(props.path)}
            <span class="ml-2 text-v2-text-text-faint">{进度()?.文字}</span>
          </span>
        </div>
      </Show>
      {/*
        `p-4`（16px）＝ 内容区的内边距，与 tab 栏文字的缩进同值（`tab-bar.tsx` 的 `px-1` ＋ tab 的 `px-3`）
        ⇒ 正文左缘与正上方那个 tab 标题的左缘落在同一条竖线上。
        没它时正文贴卡片左缘站（2026-10-12 用户实报「左侧 padding 没有设置」；真栈实测正文左缘
        与卡片左缘同为 340）。同一片内容区的另外两张脸也都留着白：`degraded-view.tsx` /
        `code-view.tsx` 的 `p-6`。
        ⚠️ 内边距写在**这个容器**上（而不是中栏那一层）：它自己 `overflow-auto`，
        留白要跟着它一起滚；写在外层会让滚动条与留白错位。

        `select-text`（2026-10-12 用户实报「打开的文件现在不能复制」）：工作区那一层挂着
        `select-none`（`layout-new.tsx:87`），白名单只开了输入类三处。**文档是第四类**——
        正文挂在这个容器里，`user-select` 被一路继承成 `none` ⇒ 一个字都选不中 ⇒ 复制无从谈起。
        这里把它翻回来，是**往那份白名单补一类**，不是推翻工作区那条规则：
        tab 标题、侧栏那类界面文字仍随工作区不可选（它们不是文档）。
        ⚠️ 落在**这个容器**上（而不是工作区那一行）：那一行是顶栏改造的定制行，
        改它给同步上游多一个冲突点（`CLAUDE.md` 定制化三原则第 1 条）；而且这一层正好是
        「文档内容」与「界面」的分界——以后新视图只要经这个壳，就自动接上。
      */}
      <div
        data-component={props.name}
        data-state={state()}
        class="w-full min-h-0 overflow-auto p-4 select-text"
        ref={container}
      />
      {/* 看不了的时候内容区得说话（FR-007 / US3 AC3）。提示与渲染结果**各占各的位置**：
          渲染器往容器里就地写 DOM，容器仍是那个容器、`data-state` 仍可观测，提示紧跟其后。 */}
      <Show when={降级原因(state())}>{(reason) => <DegradedView reason={reason()} name={文件名(props.path)} />}</Show>
    </>
  )
}
