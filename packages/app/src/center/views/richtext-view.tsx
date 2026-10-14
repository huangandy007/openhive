import DOMPurify from "dompurify"
import { marked } from "marked"
import { createEffect, createSignal, Show } from "solid-js"
import type { FileContent } from "@/center/file-content"
import { extensionOf, type ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
import { 阅读字号, 设阅读字号, 步进, 最大字号, 最小字号 } from "./reading-size"

/**
 * 白名单只放 **Markdown 真能产出的**标签（外加 GFM 任务列表的 `input`）——比「先全放再删黑的」稳：
 * 新的危险标签出现时，白名单是默认拒绝的。
 */
const 允许的标签 = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "img",
  "span",
  "input",
]

const 允许的属性 = ["href", "src", "alt", "title", "class", "align", "start", "type", "checked", "disabled"]

/**
 * 净化一段 HTML。**文件内容是不可信输入**——民警打开的卷宗可能来自别的单位、别的系统，
 * 文件里写什么由不得我们。只要走 `innerHTML` 就必须先过这里。
 *
 * ⚠️ 这里没有复用 `@opencode-ai/session-ui/markdown-cache` 的 `sanitizeMarkdown`，两个原因：
 * ① 那个模块静态 import 了 `markdown.worker.ts?worker&url`，引它就把 worker 机制拖进预览的 chunk，
 *    而且 Bun 测试环境解不了 `?worker&url`，视图会连测都测不了；
 * ② 那份配置是给聊天消息调的（要 SVG / MathML），**预览要的更窄**。
 * 两者都基于 DOMPurify，策略分叉是有意的，不是漏抄。
 *
 * ⚠️ **测试环境测不满**：happy-dom 的 `NodeIterator` 在遍历中删掉一个节点后会**停摆**
 * （真浏览器按规范继续走下一个兄弟），而 DOMPurify 正是靠它逐节点净化。后果是「某个被禁节点
 * **之后**的内容」在本环境走不到，断言会假红。故测试一律**一条输入只喂一个被禁标签**；
 * 「含有 script 的长文档整体被净化」这件事本环境验不了，留真实浏览器核对（见 state.md）。
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: 允许的标签,
    ALLOWED_ATTR: 允许的属性,
    ALLOW_DATA_ATTR: false,
  })
}

/** 服务端按 UTF-8 可解性判 text / binary，所以这里按 UTF-8 解——解不出的字节落成替换字符。 */
const 解码 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/**
 * 容器上那个 `data-format` 记号 —— `index.css` 里给 `.md` 的元素级样式（标题分级、列表符号、
 * 代码块底色…）是按它分流的。
 *
 * **两个渲染器都必须写**，两个理由：
 * ① `.txt` 的正文本身就是一个 `<pre>`，而 `.md` 里同一个标签名是**代码块**——两个渲染器往同一只
 *    容器里写，光看标签名分不出来；
 * ② `BinaryView` 换文件时**不重挂容器**（它那个 effect 就地为新的 path 再跑一遍，只
 *    `replaceChildren()`，**属性不会被清掉**）⇒ 记号必须每次渲染都重写，否则 `.md` 的样式会留在
 *    随后打开的 `.txt` 正文上（`LEARNINGS #005-48` 同族：状态留在宿主身上、没人清）。
 */
const 标 = (format: "markdown" | "text", container: HTMLElement) => {
  container.dataset.format = format
}

/** 把 Markdown 渲成 HTML 挂进容器。导出仅供测试直接驱动——生产路径是 `RichtextView`。 */
export const renderMarkdown: BytesRenderer = async (bytes, container) => {
  标("markdown", container)
  container.innerHTML = sanitizeHtml(await marked.parse(解码(bytes)))
}

/**
 * 纯文本：**用 `textContent` 而不是 `innerHTML`**——压根不经 HTML 解析，就没有注入面，
 * 连转义都不必写。换行与缩进靠 `<pre>` 保住（话单摘录是一行一行对着看的）。
 */
export const renderPlainText: BytesRenderer = async (bytes, container) => {
  标("text", container)
  const pre = document.createElement("pre")
  pre.className = "font-sans whitespace-pre-wrap break-words"
  pre.textContent = 解码(bytes)
  container.appendChild(pre)
}

/** 编辑态的按钮。几处按钮长相一样，只有动作与文案不同（`禁用` / `说明` 只有字号那两颗用）。 */
function 动作钮(props: { 动作: string; 文案: string; 点: () => void; 禁用?: boolean; 说明?: string }) {
  return (
    <button
      type="button"
      data-action={props.动作}
      onClick={props.点}
      disabled={props.禁用}
      aria-label={props.说明}
      title={props.说明}
      class="flex h-7 cursor-pointer items-center rounded px-2 text-[13px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-v2-text-text-muted"
    >
      {props.文案}
    </button>
  )
}

/** 存盘这件事**自己抛**（组网断了、出口写错）时那句兜底。服务端说得出为什么时用服务端那句。 */
const 存不上 = "保存文件失败"

/**
 * 图文视图（FR-007 的 ⑥ 图文混排：`.md` / `.txt`）。
 *
 * 两个扩展名**必须分开渲**：拿 Markdown 渲染一段话单，里面的 `#` `*` 会被吃掉变成标题和强调，
 * 内容就走样了。而渲染器拿不到路径（`BytesRenderer` 只有字节），所以由视图按扩展名挑渲染器
 * ——这个三元表达式在 Solid 里是响应式的，换文件会重新求值。
 *
 * ## 2026-10-12：能改、能存（用户实报「打开的文件不能编辑修改和保存」）
 *
 * ### 工具栏只在**给了 `save`** 时渲染
 *
 * `save` 从 `layout-new.tsx` 一路注入下来（`workspace-entry` → `CenterSplit` → `CenterContent`
 * → 视图）。省略它的宿主（storybook、以及将来只读的宿主）DOM 一字不动，也就不存在
 * 「点了编辑什么都没发生」这种半接上的状态。Office / PDF 那族视图压根不接这个口。
 *
 * ### 「底本」只有一条来路：`load` 读回来那份
 *
 * 服务端按 `base` 比对「你打开之后盘上这份被改过没有」（`packages/opencode/.../openhive/file.ts`
 * 的 `handleWrite`），而它比对的是 `TextDecoder("utf-8").decode(盘上字节).trim()`——上读取出口
 * 回的正是这个值（`handlers/file.ts` 的 `content`：`text.value.trim()`）。所以底本**直接用
 * `load` 回来的 `content`，一个字都不动**：这里若顺手 trim 一下，或拿用户改过的正文去当底本，
 * 服务端会永远判「这份文件被改过」⇒ 一次也存不成。
 * ⚠️ 只有**判成 text** 的才给改：判成 binary 的（含 NUL / 非 UTF-8）回的是 base64，
 * 拿它当底本与盘上那份对不上，而**更糟的是**存下去会把一个二进制文件按文本重写一遍
 * ——那是在毁数据，不是「存不上」。所以那种文件的工具栏只剩一条空的带子，一颗钮都没有。
 *
 * ### 底本由**取数那一层**回报，不由本视图再读一遍
 *
 * `load` 只该被调一次（画面与底本必须是同一次读到的结果：读两次之间盘上可能已经变了）。
 * 故走 `BinaryView` 的 `onContent` 回报口，见那个 prop 上那段注释。
 *
 * ### 存完之后底本**先作废**，等重读回来再给
 *
 * 存成功 ⇒ 回预览 ⇒ `BinaryView` 重挂、读第二次（这也是「预览里是新正文」的来路：不复用旧画面）。
 * 而「盘上现在是新正文」这件事要等那次重读回来才算数 ⇒ 这中间不让再进编辑态（编辑钮此时不渲染）。
 * 少了这一步，紧接着的第二次保存会拿**刚被自己改掉的旧底本**去比对，服务端判「文件被改过」
 * 而那句话是错的——它其实是我们自己刚存的。
 *
 * ## 2026-10-12 · 正文字号（③ 用户实报「文字字号较小，不适合阅读」）
 *
 * **正文有三个面**，`index.css` 的 `@layer components` 里**一条规则**管住其中两个：
 * `.md` 预览（`marked` 渲出的 `<p>`…）与 `.txt` 预览（`<pre>`）——两者都长在
 * `BinaryView` 那个 `[data-component="richtext-view"]` 容器里；第三个面是编辑框
 * （`[data-slot="richtext-editor"]`，本视图自己画的）。值走 `--richtext-size` 这个 CSS 变量，
 * 由下面那个 effect 贴在**根**上——理由在 effect 那段注释里。
 *
 * ⚠️ **两个面都不能再挂 `text-[Npx]` / `text-sm` 这类字号 utility**：utilities 层排在 components 层
 * 之后，utility 会盖掉那条规则（本文件的编辑框就从 `text-[13px] leading-6` 里交出来了）。
 * 三个面的真栈判据在 `e2e/real-stack/richtext-reading-size-real.spec.ts`（算出来的字号只有真浏览器量得到）。
 *
 * ## 2026-10-14 · `.md` 的元素级版面（用户实报「没有进行很好的渲染，一些格式展现不出来」）
 *
 * 上一段管「正文那一档多大」，`index.css` 里紧跟其后那一段管「标题 / 列表 / 表格长什么样」。
 * 后者**只认带 `data-format="markdown"` 记号的容器**（两个渲染器各自写，见 `标`），因为 `.txt` 的
 * 正文本身就是一个 `<pre>`、而 `.md` 里同一个标签名是**代码块**。判据在
 * `e2e/real-stack/richtext-markdown-format-real.spec.ts`。编辑框是 `<textarea>`（编辑的是源文本、
 * 没有渲染出的元素），不参与这一段。
 */
export const RichtextView: ViewComponent = (props) => {
  /** 读回来那份**原样**（存盘时的底本）。`undefined` ＝ 还没读到 / 读不到 / 判成 binary。 */
  const [底本, set底本] = createSignal<string | undefined>(undefined)
  /** 编辑框里那份（用户手上正在改的）。与底本**是两个值**，别合并。 */
  const [草稿, set草稿] = createSignal("")
  const [改着, set改着] = createSignal(false)
  /** 问着「丢掉吗」——问句期间草稿一个字节都不动。 */
  const [问着, set问着] = createSignal(false)
  /** 出错时那句话说给谁听（服务端拒绝的原因 / 我们的兜底）。 */
  const [说法, set说法] = createSignal<string | undefined>(undefined)
  /** 一次存盘在飞。**只在守卫里读**——见下面 `存` 的头一条注释。 */
  const [存着, set存着] = createSignal(false)

  const 收到内容 = (内容: FileContent | undefined) => set底本(内容?.type === "text" ? 内容.content : undefined)

  /**
   * 字号**贴在根上**，由 `index.css` 那条规则读走。
   *
   * 为什么不在这两个面上各写一个 inline style：预览容器是 `BinaryView` 画的、不归本视图
   * （改它＝往一个共用组件上加道具），而**一条规则管两个面**才不会「改了预览忘编辑框」。
   * 为什么不给本视图包一层带变量的盒子：多一层盒就多一处「父级是什么」的约定，而这个视图的
   * 兄弟关系（工具栏 `shrink-0` ＋ 内容区撑开）正是 `#005-16` 那族坑的高发地；
   * 往根上贴 `--font-family-*` 也已是本仓的先例（`context/settings.tsx`）。
   */
  createEffect(() => {
    document.documentElement.style.setProperty("--richtext-size", `${阅读字号()}px`)
  })

  const 开始改 = () => {
    const 原样 = 底本()
    if (原样 === undefined) return
    set草稿(原样)
    set说法(undefined)
    set问着(false)
    set改着(true)
  }

  const 存 = async () => {
    // ⚠️ **重入守卫，不是优化**：第一下还没回来时再点一下（民警按了没看见动静很自然会再按），
    // 两下会拿**同一个底本**各发一次——第二下必然撞服务端「这份文件被改过」，而那句话是错的
    // （改动其实已经存上了）。守卫写在**事件处理器**里而不是把钮置灰：置灰的钮在 happy-dom
    // 里连事件都不派，那句守卫就永远走不到、拆掉也不变红（`LEARNINGS #006-16`）。
    if (存着()) return
    const 原样 = 底本()
    const 存盘 = props.save
    if (原样 === undefined || !存盘) return
    set存着(true)
    set说法(undefined)
    try {
      const 结论 = await 存盘(props.path, 草稿(), 原样)
      if (!结论.ok) {
        // 服务端拒了：**留在编辑态、草稿保留**。翻回预览等于把民警刚写的那段字当着面丢掉。
        set说法(结论.message)
        return
      }
      set底本(undefined) // 见文件头「存完之后底本先作废」
      set草稿("")
      set问着(false)
      set改着(false)
    } catch (原因) {
      // 这一支是「我们这边坏了」（替身写错、存盘口自己抛）。**不静默**：静默失败时民警
      // 按了保存就以为存上了。原样记在控制台——界面那句要短。
      console.warn(`[openhive] 存盘没走通（${props.path}）`, 原因)
      set说法(存不上)
    } finally {
      set存着(false)
    }
  }

  const 取消 = () => {
    // 一个字没改 ⇒ 没什么可丢的，再问一句就是骚扰（设计文档 §4.6 的「不打扰」）。
    if (草稿() === 底本()) {
      set问着(false)
      set改着(false)
      return
    }
    set问着(true)
  }

  /** 问句里点「丢掉」——草稿到这里才真的没了。 */
  const 丢掉 = () => {
    set问着(false)
    set草稿("")
    set改着(false)
  }

  return (
    <>
      <Show when={props.save}>
        {/* `shrink-0` ＋ 正常流：这条带子是内容区的**兄弟**，不是盖在上面的浮层
            ——正文永远不会被工具栏压住。`px-4` 与内容区的 `p-4` 同值 ⇒ 钮的文字左缘
            与正文左缘落在同一条竖线上（同 `binary-view.tsx` 那条注释）。 */}
        <div data-slot="richtext-editor-bar" class="flex w-full shrink-0 flex-col gap-1 px-4 pt-3 pb-1">
          <div class="flex items-center gap-1">
            {/* ⚠️ 底本没到位时**一颗钮都不给**（见文件头那条 binary / 还没读到）。 */}
            <Show when={底本() !== undefined}>
              <Show when={!改着()} fallback={<><动作钮 动作="save" 文案="保存" 点={() => void 存()} /><动作钮 动作="cancel" 文案="取消" 点={取消} /></>}>
                <动作钮 动作="edit" 文案="编辑" 点={开始改} />
              </Show>
            </Show>
            {/*
              字号两颗钮**不在**上面那个「底本到位没」的 `Show` 里：它调的是**读者**的偏好，
              不是这一份文件的性质——二进制 / 还没读到的文件上也该调得动（它们同样有正文这一面）。
              到端点就置灰：最后一档再点是什么都不会发生的，给一颗看着能按却没反应的钮不如给一颗灰的。
            */}
            <div data-slot="richtext-reading-size" class="ml-auto flex items-center gap-1">
              <动作钮
                动作="smaller"
                文案="A-"
                说明="把正文调小一号"
                禁用={阅读字号() === 最小字号}
                点={() => 设阅读字号(步进(阅读字号(), -1))}
              />
              <动作钮
                动作="larger"
                文案="A+"
                说明="把正文调大一号"
                禁用={阅读字号() === 最大字号}
                点={() => 设阅读字号(步进(阅读字号(), 1))}
              />
            </div>
          </div>
          <Show when={说法()}>
            <div data-slot="richtext-editor-note" class="text-[12px] leading-5 text-v2-text-text-muted">
              {说法()}
            </div>
          </Show>
          <Show when={问着()}>
            <div
              data-slot="richtext-editor-confirm"
              class="flex items-center gap-1 text-[12px] leading-5 text-v2-text-text-muted"
            >
              这段改动还没保存，确定丢掉吗？
              <动作钮 动作="keep" 文案="继续改" 点={() => set问着(false)} />
              <动作钮 动作="discard" 文案="丢掉" 点={丢掉} />
            </div>
          </Show>
        </div>
      </Show>
      {/*
        ⚠️ 编辑态**换掉**预览（`Show` 的 fallback），不是叠一层：退出编辑时 `BinaryView` 重挂、
        于是自动重读一次盘上那份 —— 「预览里是新正文」是这么来的，不是另写一段刷新逻辑。
        代价照实说：**每次进出编辑态都会重读一次文件**（一次 GET，几百字节），
        换来的是「画面一定是盘上那份」这条不需要维护的保证。
      */}
      <Show
        when={改着()}
        fallback={
          <BinaryView
            name="richtext-view"
            path={props.path}
            load={props.load}
            render={extensionOf(props.path) === ".md" ? renderMarkdown : renderPlainText}
            onContent={收到内容}
          />
        }
      >
        <div class="flex w-full min-h-0 flex-1 flex-col p-4">
          <textarea
            data-slot="richtext-editor"
            value={草稿()}
            onInput={(事件) => set草稿(事件.currentTarget.value)}
            spellcheck={false}
            class="min-h-0 w-full flex-1 resize-none rounded-md border border-v2-border-border-strong bg-v2-background-bg-base p-3 font-sans text-v2-text-text-base outline-none"
          />
        </div>
      </Show>
    </>
  )
}
