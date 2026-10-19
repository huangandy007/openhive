import DOMPurify from "dompurify"
import { marked } from "marked"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { decodeBytes, type FileContent, type LoadFileContent } from "@/center/file-content"
import { extensionOf, type ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
import { 阅读字号, 设阅读字号, 步进, 最大字号, 最小字号 } from "./reading-size"
import {
  取草稿,
  改草稿,
  开始编辑,
  立即保存,
  切预览,
  记盘上版本,
  载入盘上版本,
  登记出口,
} from "./richtext/draft-store"
import {
  包裹,
  切行首,
  插入代码块,
  插入分隔线,
  插入表格,
  插入引用,
  type 编辑动作,
  type 编辑快照,
} from "./richtext/markdown-actions"
import { 编辑工具栏, 工具栏钮 } from "./richtext-toolbar"
import { 引用文件选择, 图片扩展 } from "./richtext/file-picker"
import { 相对引用, 引用路径 } from "./richtext/richtext-path"

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

/**
 * 造一个 Markdown 渲染器。
 *
 * 不给 `path` / `load` 时就是原来的纯渲染（只读宿主、单元测试用它）。给了之后多两件事：
 * ① 相对图片路径经 `load` 取字节、换成 object URL（`<img src="附件/图.png">` 原样交给浏览器会
 *    去请求前门，而不是项目文件）；清理函数负责 revoke。
 * ② 点相对链接**不整页跳走**——这个工作区是一张 SPA，跳到别处等于把民警正在做的事丢了。
 *
 * 图片取不到**不许**让整篇渲染失败：一篇纪要配图丢了，剩下几千字还得能看。
 */
export function 造Markdown渲染器(选项: { path?: string; load?: LoadFileContent } = {}): BytesRenderer {
  return async (bytes, container) => {
    标("markdown", container)
    container.innerHTML = sanitizeHtml(await marked.parse(解码(bytes)))

    // 点击监听必须在**图片加载之前**挂上：图片可能读得很慢，那个窗口里用户点链接
    // 仍然要拦住（否则整页跳走）。但也不能提到 `marked.parse` 之前——解析抛错时
    // 监听会留在容器上没人摘。
    const 点击 = (事件: MouseEvent) => {
      // 慢图窗口里可能同时挂着 A/B 两份渲染的监听（`BinaryView` 换内容前才调清理）；
      // 前一个已经 `preventDefault` 并开过标签页了，后一个再跑一遍会开两个。
      if (事件.defaultPrevented) return
      const 链接 = (事件.target as Element | null)?.closest("a")
      if (!链接) return
      const href = 链接.getAttribute("href")
      if (href === null || href.startsWith("#")) return // 页内锚点交给浏览器
      事件.preventDefault()
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
        window.open(href, "_blank", "noopener,noreferrer")
        return
      }
      // 相对链接的基准是「当前文件所在目录」，不是页面 URL——打开它要另一条路由，
      // 这里先不猜：拦住跳转，控制台留一句。
      console.warn(`[openhive] 预览里的相对链接没有打开（${href}）`)
    }
    container.addEventListener("click", 点击)

    const 回收: string[] = []
    // 迟到的渲染（图片还没回来就被换掉）由 `BinaryView` 的 token 分支负责 revoke。
    if (选项.path && 选项.load) await 装图片(container, 选项.path, 选项.load, 回收)

    return () => {
      container.removeEventListener("click", 点击)
      for (const url of 回收) URL.revokeObjectURL(url)
    }
  }
}

/** 既有的纯渲染入口：只读宿主与单测继续用它。 */
export const renderMarkdown: BytesRenderer = 造Markdown渲染器()

const 图片类型: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
}

async function 装图片(
  container: HTMLElement,
  当前文件: string,
  load: LoadFileContent,
  回收: string[],
): Promise<void> {
  const 图们 = [...container.querySelectorAll<HTMLImageElement>("img[src]")]
  await Promise.all(
    图们.map(async (img) => {
      const href = img.getAttribute("src")
      if (!href) return
      const 路径 = 引用路径(当前文件, href)
      if (!路径) return
      // 一张图读不到只影响它自己（见函数上那条注释）。
      const 内容 = await load(路径).catch(() => undefined)
      const 字节 = decodeBytes(内容)
      if (!字节) return
      const 下缀 = 路径.slice(路径.lastIndexOf(".")).toLowerCase()
      // 落点必须是图片：`decodeBytes` 能解出字节的也可能是被误判成 binary 的文本，
      // 塞进 `<img>` 只会让整篇多一个破图（spec §13 风险表）。
      // 服务端给的 `mimeType` 笼统（如 application/octet-stream）时按扩展名回退。
      const 类型 = 内容?.mimeType?.startsWith("image/") ? 内容.mimeType : 图片类型[下缀]
      if (!类型 || !类型.startsWith("image/")) return

      const url = URL.createObjectURL(new Blob([字节], { type: 类型 }))
      回收.push(url)
      img.src = url
      img.removeAttribute("srcset")
    }),
  )
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

/**
 * 图文视图（`.md` / `.txt`）。
 *
 * ## 2026-10-19：从「按一下编辑」改成「永远可编辑的记事本」
 *
 * 用户实报四条：换文件 / 分屏会丢没保存的字、点保存就退出编辑态、没有自动保存、没有
 * Markdown 编辑功能。前三条是同一个根因：草稿与保存状态长在**组件**上，而中栏换文件是
 * **重挂**组件。现在草稿按路径存在 `draft-store`，组件重挂不影响它；保存成功也不再退出
 * 编辑态（要回预览请点「预览」）。
 *
 * ## 底本只有一条来路
 *
 * 预览里的 `BinaryView` 读回来的文本经 `收到内容` 交给 `记盘上版本`；保存成功后用**服务端
 * 回包里的 base**，不再自己拿 `content.trim()` 算（CRLF 文件上那会假冲突）。
 *
 * ## 二进制文件仍然不给改
 *
 * `load` 判成 binary 的文件不建草稿：拿 base64 当正文存回去是在毁数据，不是「存不上」。
 */
export const RichtextView: ViewComponent = (props) => {
  /** 这份文件是不是可编辑的文本（binary / 还没读到 ⇒ false）。 */
  const [可编辑, set可编辑] = createSignal(取草稿(props.path) !== undefined)
  const [选文件, set选文件] = createSignal<"image" | "attachment" | undefined>()
  let 框: HTMLTextAreaElement | undefined

  const 项 = () => (props.save ? 取草稿(props.path) : undefined)
  const 改着 = () => 项()?.mode === "edit"

  createEffect(() => {
    登记出口(props.path, { save: props.save, load: props.load })
  })

  createEffect(() => {
    document.documentElement.style.setProperty("--richtext-size", `${阅读字号()}px`)
  })

  /** 预览那一侧读回来的盘上版本（`BinaryView` 只在这一态挂载）。 */
  const 收到内容 = (内容: FileContent | undefined) => {
    const 文本 = 内容?.type === "text" ? 内容.content : undefined
    set可编辑(文本 !== undefined)
    if (文本 === undefined) return
    记盘上版本(props.path, { content: 文本, base: 文本 })
  }

  const 渲染器 = createMemo<BytesRenderer>(() =>
    extensionOf(props.path) === ".md" ? 造Markdown渲染器({ path: props.path, load: props.load }) : renderPlainText,
  )

  const 开始 = () => {
    const 当前 = 项()
    if (!当前) return
    开始编辑(props.path, { content: 当前.content, base: 当前.base })
  }

  /** 把纯函数的结论写回 store，并把焦点与选区交还编辑框。 */
  const 落结论 = (结论: 编辑快照) => {
    const 框引用 = 框
    改草稿(props.path, 结论.value, { start: 结论.start, end: 结论.end })
    queueMicrotask(() => {
      框引用?.focus()
      框引用?.setSelectionRange(结论.start, 结论.end)
    })
  }

  const 快照 = (): 编辑快照 | undefined => {
    const 当前 = 项()
    const 框引用 = 框
    if (!当前 || !框引用) return undefined
    return { value: 当前.content, start: 框引用.selectionStart, end: 框引用.selectionEnd }
  }

  const 做动作 = (动作: 编辑动作) => {
    const 前 = 快照()
    if (!前) return
    if (动作 === "hr") return 落结论(插入分隔线(前))
    if (动作 === "code-block") return 落结论(插入代码块(前))
    if (动作 === "table") return 落结论(插入表格(前))
    if (动作 === "bold" || 动作 === "italic" || 动作 === "strike" || 动作 === "code" || 动作 === "link") {
      return 落结论(包裹(前, 动作))
    }
    落结论(切行首(前, 动作))
  }

  const 插引用 = (路径: string, 类型: "image" | "attachment") => {
    set选文件(undefined)
    const 前 = 快照()
    if (!前) return
    // 文件树 / 文件选择弹层给的是**项目根相对**路径；写进 Markdown 前换成
    // 「相对当前文件所在目录」的写法，否则预览会按当前目录再拼一层（见 `相对引用`）。
    落结论(插入引用(前, 类型, 相对引用(props.path, 路径)))
  }

  /**
   * 撤销 / 重做交给浏览器的原生栈（`execCommand`）：textarea 的撤销历史由浏览器维护，
   * 自己再存一份会和输入法、粘贴、拖放打架。`execCommand` 在真浏览器里会派发 `input`，
   * 这里再同步一次是为了在它不派发的环境里也不丢状态。
   */
  const 同步框 = () => {
    const 框引用 = 框
    if (!框引用) return
    改草稿(props.path, 框引用.value, { start: 框引用.selectionStart, end: 框引用.selectionEnd })
  }
  const 撤销 = () => {
    框?.focus()
    document.execCommand?.("undo")
    同步框()
  }
  const 重做 = () => {
    框?.focus()
    document.execCommand?.("redo")
    同步框()
  }

  const 按键 = (事件: KeyboardEvent) => {
    if (!(事件.ctrlKey || 事件.metaKey)) return
    const 键 = 事件.key.toLowerCase()
    if (键 === "s") {
      事件.preventDefault()
      // 用户按的保存是**明确动作**：冲突态下也照存（仍会被服务端判 STALE，但那是用户的意图）。
      void 立即保存(props.path, true)
      return
    }
    // Ctrl/Cmd+Z / Shift+Z **不拦截**（spec §7.3）：textarea 的原生撤销栈比我们自己的可靠，
    // 撤销后浏览器会派 `input`，`onInput` 顺手把新值同步进 store。
    // `.txt` 不是 Markdown 文档：b / i / k 这些写标记的快捷键不生效，也不拦默认行为。
    // 判据与工具栏的 `markdown` prop 是同一口径（扩展名为 `.md`）。
    if (extensionOf(props.path) !== ".md") return
    if (键 === "b") {
      事件.preventDefault()
      做动作("bold")
      return
    }
    if (键 === "i") {
      事件.preventDefault()
      做动作("italic")
      return
    }
    if (键 === "k") {
      事件.preventDefault()
      做动作("link")
    }
  }

  return (
    <>
      <Show when={props.save}>
        <div data-slot="richtext-editor-bar" class="flex w-full shrink-0 flex-col gap-1 px-4 pt-3 pb-1">
          <div class="flex items-start gap-1">
            <Show when={可编辑()}>
              <编辑工具栏
                模式={改着() ? "edit" : "preview"}
                markdown={extensionOf(props.path) === ".md"}
                状态={项()?.status ?? "clean"}
                提示={项()?.message}
                savedAt={项()?.savedAt}
                动作={做动作}
                编辑={开始}
                保存={() => void 立即保存(props.path, true)}
                重试={() => void 立即保存(props.path, true)}
                预览={() => void 切预览(props.path)}
                载入盘上={() => void 载入盘上版本(props.path)}
                图片={() => set选文件("image")}
                附件={() => set选文件("attachment")}
                撤销={撤销}
                重做={重做}
              />
            </Show>
            {/*
              字号两颗钮不在「可编辑」的 Show 里：它调的是**读者**的偏好，不是这份文件的性质
              ——二进制 / 还没读到的文件上也该调得动。
            */}
            <div data-slot="richtext-reading-size" class="ml-auto flex shrink-0 items-center gap-1">
              <工具栏钮
                动作="smaller"
                文案="A-"
                说明="把正文调小一号"
                禁用={阅读字号() === 最小字号}
                点={() => 设阅读字号(步进(阅读字号(), -1))}
              />
              <工具栏钮
                动作="larger"
                文案="A+"
                说明="把正文调大一号"
                禁用={阅读字号() === 最大字号}
                点={() => 设阅读字号(步进(阅读字号(), 1))}
              />
            </div>
          </div>
          {/*
            冲突那句话单独一行：它不是状态栏的一句灰字，而是「盘上已经不同」的告知
            ——继续打字不会解除它，只有「载入盘上版本」能。
          */}
          <Show when={项()?.status === "conflict"}>
            <div data-slot="richtext-editor-note" class="text-[12px] leading-5 text-v2-text-text-muted">
              {项()?.message}
            </div>
          </Show>
          <Show when={项()?.status === "error"}>
            <div data-slot="richtext-editor-note" class="text-[12px] leading-5 text-v2-text-text-muted">
              {项()?.message}
            </div>
          </Show>
          <Show when={选文件()}>
            {(类型) => (
              <引用文件选择 类型={类型()} 选好={(路径) => 插引用(路径, 类型())} 关掉={() => set选文件(undefined)} />
            )}
          </Show>
        </div>
      </Show>
      {/*
        ⚠️ 编辑态仍然**换掉**预览：预览由 `BinaryView` 画，它只在预览态挂载、只在那一态读盘。
        草稿在 store 里，所以「换掉」不再意味着丢字。
      */}
      <Show
        when={改着()}
        fallback={
          <BinaryView
            name="richtext-view"
            path={props.path}
            load={props.load}
            render={渲染器()}
            onContent={收到内容}
          />
        }
      >
        <div class="flex w-full min-h-0 flex-1 flex-col p-4">
          <textarea
            data-slot="richtext-editor"
            aria-label="文档正文"
            ref={(el) => {
              框 = el
              const 选区 = 项()?.selection ?? { start: 0, end: 0 }
              // `value` 是动态属性、在 ref 之后才落到元素上；在这里直接设选区会被随后的
              // `el.value = …` 冲掉（光标落到末尾）。等这一轮 props 应用完再交还选区。
              queueMicrotask(() => {
                el.focus()
                el.setSelectionRange(选区.start, 选区.end)
              })
            }}
            value={项()?.content ?? ""}
            onInput={(事件) => {
              const el = 事件.currentTarget
              改草稿(props.path, el.value, { start: el.selectionStart, end: el.selectionEnd })
            }}
            onSelect={(事件) => {
              const el = 事件.currentTarget
              const 当前 = 项()
              if (!当前) return
              改草稿(props.path, 当前.content, { start: el.selectionStart, end: el.selectionEnd })
            }}
            onKeyDown={按键}
            onDragOver={(事件) => 事件.preventDefault()}
            onDrop={(事件) => {
              事件.preventDefault()
              // 左栏文件树给的载荷是 `file:<项目内路径>`（`file-tree.tsx`），**不是** `File` 对象
              // ——树上的文件本来就在项目里，不存在「从本机拖进来」这回事，读 `files` 只会拿到空。
              const 载荷 = 事件.dataTransfer?.getData("text/plain") ?? ""
              if (!载荷.startsWith("file:")) return
              const 路径 = 载荷.slice("file:".length)
              if (路径 === "") return
              // 目录的载荷带尾分隔符（`file:卷宗/资料/`）——目录不是文件，插成引用预览必然
              // 按目录路径去读、读不到。
              if (/[\\/]$/.test(路径)) return
              // `.txt` 不插 Markdown 引用（与工具栏 `markdown` prop 同一口径）。
              if (extensionOf(props.path) !== ".md") return
              // 只插引用、不写盘：上传是 P1。
              插引用(路径, 图片扩展.has(extensionOf(路径) ?? "") ? "image" : "attachment")
            }}
            spellcheck={false}
            class="min-h-0 w-full flex-1 resize-none rounded-md border border-v2-border-border-strong bg-v2-background-bg-base p-3 font-sans text-v2-text-text-base outline-none"
          />
        </div>
      </Show>
    </>
  )
}
