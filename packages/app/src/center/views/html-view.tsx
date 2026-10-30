import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DegradedView } from "@/center/degraded-view"
import { decodeBytes } from "@/center/file-content"
import type { ViewProps } from "@/center/view-registry"
import { 加载代码编辑器, type CodeEditorComponent, type CodeEditorLoader } from "./code-view"

export interface HtmlViewProps extends ViewProps {
  /** 源码模式的编辑器加载器。留这个口子同 `code-view`：真编辑器要 worker + 高亮器，happy-dom 里跑不起来。 */
  editor?: CodeEditorLoader
}

/** 路径的最后一段。`\` 也认——同一条路径在 Windows 侧可能带着反斜杠过来。 */
const 文件名 = (path: string) => path.split(/[\\/]/).pop() || path

/** 服务端按 UTF-8 可解性判 text / binary，故这里也按 UTF-8 解——解不出的字节落成替换字符。 */
const 解码 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

type 状态 =
  | { kind: "loading" }
  | { kind: "ready"; html: string }
  | { kind: "empty" }
  | { kind: "failed" }

/**
 * HTML 预览视图（2026-10-30）：把 `.html` / `.htm` **渲染成网页**，另给「预览 / 源码」切换。
 *
 * 从代码视图分出来的理由：代码视图只显示「这是代码文件」+ 一个打开编辑器的按钮，
 * 对网页文件来说等于什么都没看到——民警要的是页面本身，不是源码。
 *
 * **安全线**：页面里的脚本允许执行，但只能在一个 `sandbox="allow-scripts"` 的 iframe 里。
 * 不给 `allow-same-origin`——加了它，不可信页面就拿到了应用的来源，能读 cookie、碰宿主 DOM，
 * 沙箱等于不存在（文件内容是不可信输入：卷宗可能来自别的单位、别的系统）。
 *
 * **已知缺口（本轮不做）**：只支持单文件自包含的 HTML——`<img src="同目录/图.png">` 这类相对
 * 资源在 `srcdoc` 里没有基地址，加载不到；外链点了不跳（没有 `allow-top-navigation` /
 * `allow-popups`）；页面仍可向外部发请求（没有 `Content-Security-Policy` 兜底）。
 */
export const HtmlView = (props: HtmlViewProps) => {
  const [状态, set状态] = createSignal<状态>({ kind: "loading" })
  /** 预览 / 源码二选一。**按文件重置**：上一份文件停在源码模式不该带到下一份（见下方 effect）。 */
  const [看源码, set看源码] = createSignal(false)
  const [编辑器, set编辑器] = createSignal<CodeEditorComponent | undefined>(undefined)
  const [编辑器加载中, set编辑器加载中] = createSignal(false)
  const [编辑器加载失败, set编辑器加载失败] = createSignal(false)

  /**
   * 竞态令牌：`path` 一变就作废**进行中的那次读取**（写法同 `code-view.tsx`）。
   *
   * 取内容是异步的，民警点开「甲.html」又立刻切到「乙.html」，那次读取会在换完文件之后才到点，
   * 把旧页面的正文挂到新文件名下——同一个壳上叫「上一份卷宗」的那类错。
   */
  let token = 0

  const 名字 = () => 文件名(props.path)
  /** 只有「已取到」这一档带着正文，单独取出来给渲染用——免得在 JSX 里对联合类型做断言。 */
  const 正文 = createMemo(() => {
    const 此刻 = 状态()
    return 此刻.kind === "ready" ? 此刻.html : undefined
  })

  createEffect(() => {
    // 两个 prop 都必须在 effect 里读：否则换 `path` 或换注入的 `load` 都不会触发重取（`#006-21`）。
    const path = props.path
    const load = props.load
    token++
    const mine = token

    // 「每打开一份文件都从预览开始」：不重置的话，从 `甲.html` 切到 `乙.html`
    // 会直接呈现乙的源码——而民警刚才看的明明是甲的网页。
    set看源码(false)
    set状态({ kind: "loading" })

    if (!load) {
      // 省略 `load` 是合法的注入形态（数据轴视图自带内容），但对文件视图等于没有内容来源。
      set状态({ kind: "empty" })
      return
    }

    void (async () => {
      try {
        const content = await load(path)
        if (mine !== token) return
        // 解不出字节（损坏的 base64）与「没取到」同属「没有内容可看」。
        const bytes = decodeBytes(content)
        if (!bytes) {
          set状态({ kind: "empty" })
          return
        }
        set状态({ kind: "ready", html: 解码(bytes) })
      } catch {
        if (mine !== token) return
        set状态({ kind: "failed" })
      }
    })()
  })

  // 卸载时同样作废：迟到的结果若还认为自己有效，会往一个没人再看的树上写状态。
  onCleanup(() => {
    token++
  })

  /**
   * 第一次切到源码时才加载编辑器（同 `code-view`：`@pierre/diffs` 拖着 worker / 高亮器，
   * 没理由为「可能永远不会点的切换」提前拉）。加载失败给 `load-failed`，可再点重试。
   */
  const 切到源码 = async () => {
    set看源码(true)
    if (编辑器() || 编辑器加载中()) return
    set编辑器加载中(true)
    set编辑器加载失败(false)
    try {
      const 组件 = await (props.editor ?? 加载代码编辑器)()
      // ⚠️ Solid 的 setter 见到函数会当成 updater：直接 `set编辑器(组件)` 会把组件当 updater
      //    调用、静默存不进去。包一层 `() => 组件` 才是「把组件本身存进去」。
      set编辑器(() => 组件)
    } catch {
      set编辑器加载失败(true)
    } finally {
      set编辑器加载中(false)
    }
  }

  return (
    <div
      data-component="html-view"
      data-mode={看源码() ? "source" : "preview"}
      class="flex h-full w-full flex-col"
    >
      <div
        data-slot="html-toolbar"
        class="flex shrink-0 items-center justify-between gap-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 px-3 py-2"
      >
        {/* 文件名是**不可信输入**：走 `textContent`，永不进 HTML */}
        <span data-slot="html-name" class="truncate text-[13px] font-[440] text-v2-text-text-muted">
          {名字()}
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <ButtonV2
            data-slot="html-tab-preview"
            variant="neutral"
            aria-pressed={!看源码()}
            onClick={() => set看源码(false)}
          >
            预览
          </ButtonV2>
          <ButtonV2
            data-slot="html-tab-source"
            variant="neutral"
            // 没有正文时切源码只能看到一个空编辑器，不如让这扇门关着。
            disabled={正文() === undefined}
            aria-pressed={看源码()}
            onClick={() => void 切到源码()}
          >
            源码
          </ButtonV2>
        </div>
      </div>

      <div class="min-h-0 flex-1">
        <Show when={!看源码()}>
          <Show when={正文()} keyed>
            {(html) => (
              /**
               * 只写 `allow-scripts` 这一个词：**不加** `allow-same-origin` / `allow-popups` /
               * `allow-modals` / `allow-top-navigation`（理由见组件头注释）。
               * `srcdoc` 原样交给浏览器——这里的「原样」本身就是需求（页面不能被改写）。
               */
              <iframe
                data-slot="html-preview"
                title={名字()}
                sandbox="allow-scripts"
                referrerpolicy="no-referrer"
                srcdoc={html}
                class="h-full w-full border-0"
              />
            )}
          </Show>
        </Show>

        <Show when={看源码()}>
          <Show when={编辑器()} keyed>
            {(组件) => <Dynamic component={组件} name={名字()} contents={正文() ?? ""} />}
          </Show>
          <Show when={编辑器加载中()}>
            <p
              data-slot="html-source-loading"
              class="p-6 text-center text-[13px] font-[440] text-v2-text-text-muted"
            >
              正在加载源码视图…
            </p>
          </Show>
          <Show when={编辑器加载失败()}>
            <DegradedView reason="load-failed" name={名字()} />
          </Show>
        </Show>

        <Show when={状态().kind === "empty"}>
          <DegradedView reason="empty" name={名字()} />
        </Show>

        <Show when={状态().kind === "failed"}>
          <DegradedView reason="error" name={名字()} />
        </Show>
      </div>
    </div>
  )
}
