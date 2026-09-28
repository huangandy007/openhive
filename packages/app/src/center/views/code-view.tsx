import { Icon } from "@opencode-ai/ui/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createEffect, createMemo, createSignal, onCleanup, Show, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DegradedView } from "@/center/degraded-view"
import type { ViewProps } from "@/center/view-registry"

/**
 * 代码编辑器本体的入参：**只要一份文本**。
 *
 * 收这么窄是有意的——编辑器是**别人的**（上游 `@pierre/diffs` 驱动的 `File`），我们只负责
 * 「什么时候把它挂出来」，不参与它怎么渲染。窄接口也让测试能塞一个假编辑器进来
 * （真编辑器要 worker + 高亮器，happy-dom 里跑不了）。
 */
export interface CodeEditorProps {
  /** 文件名——编辑器按它推断语法高亮语言，故给**最后一段**而不是全路径。 */
  name: string
  contents: string
}

export type CodeEditorComponent = Component<CodeEditorProps>
export type CodeEditorLoader = () => Promise<CodeEditorComponent>

/**
 * 生产用的编辑器：上游 `@opencode-ai/session-ui/file`（FR-009 明言「非重写编辑器本体」）。
 *
 * **必须是动态 `import`，且在点击时才走**：`@pierre/diffs` 拖着一整套 worker / 高亮器，
 * 静态引进来会让「代码文件」这个视图模块连同它一起被拉进测试进程与首屏——而按 FR-009，
 * 绝大多数时候这个编辑器根本不该出场。
 */
export const 加载代码编辑器: CodeEditorLoader = async () => {
  const { File } = await import("@opencode-ai/session-ui/file")
  return (props) => <File mode="text" file={{ name: props.name, contents: props.contents }} />
}

/** 路径的最后一段。`\` 也认——同一条路径在 Windows 侧可能带着反斜杠过来。 */
const 文件名 = (path: string) => path.split(/[\\/]/).pop() || path

type 状态 =
  | { kind: "closed" }
  | { kind: "opening" }
  | { kind: "open"; 编辑器: CodeEditorComponent; contents: string }
  | { kind: "no-content" }
  | { kind: "open-failed" }

export interface CodeViewProps extends ViewProps {
  /**
   * 编辑器加载器。留这个口子同 `load`：视图要能**单独挂起来测**——真编辑器在 happy-dom 里
   * 跑不起来（worker / 高亮器），不注入就只能测「有个按钮」，测不到「点了真的打开」。
   */
  editor?: CodeEditorLoader
}

/**
 * 代码文件视图：**默认不进入代码编辑器**（FR-009 / US4「用户不写代码，也不面对代码」）。
 *
 * 打开一份 `.ts` 先看到的不是编辑器，而是一句「这是代码文件」+ 一个**显式**的开启按钮。
 * 编辑器因此降级为「少数技术用户的可选工作区」：够得着，但不挡在民警面前。
 *
 * 读内容是**点了才读**的：不打开编辑器时没有任何理由去取这份文件的正文。
 * 读不到给 `empty`、编辑器没加载出来给 `load-failed`——这两种「看不了」沿用 T015 的说法，
 * 不让这里变成一个什么都不说的白板。
 */
export const CodeView = (props: CodeViewProps) => {
  const [状态, set状态] = createSignal<状态>({ kind: "closed" })
  /**
   * 竞态令牌：`path` 一变就作废**进行中的那次打开**。
   *
   * 取内容是异步的（生产里是网络），民警点开「台账.ts」又立刻切走，那次读取会在**换完文件之后**
   * 才到点，把旧文件的正文挂到新文件的标题下——同一个壳上叫「上一份卷宗」的那类错。
   */
  let token = 0

  // 换一份文件 = 回到「未开启」。「默认」是每打开一份文件都成立，不是一次性开关：
  // 若不重置，从 `a.ts` 切到 `b.ts` 会直接呈现已打开的编辑器，第二份文件就不受 FR-009 约束了。
  createEffect(() => {
    props.path
    token++
    set状态({ kind: "closed" })
  })

  // 卸载时同样作废：迟到的结果若还认为自己有效，会往一个没人再看的树上写状态。
  onCleanup(() => {
    token++
  })

  const 名字 = () => 文件名(props.path)
  /** 只有「已开启」这一档带着东西，单独取出来给渲染用——免得在 JSX 里对联合类型做断言。 */
  const 已打开 = createMemo(() => {
    const 此刻 = 状态()
    return 此刻.kind === "open" ? 此刻 : undefined
  })

  const 打开 = async () => {
    const mine = ++token
    const 还在 = () => mine === token
    set状态({ kind: "opening" })
    try {
      const content = props.load ? await props.load(props.path) : undefined
      if (!还在()) return
      // 只认服务端判成 text 的：binary 的 `content` 是 base64，塞进代码编辑器是一屏乱码，
      // 不如老实说「没取到内容」。
      if (content?.type !== "text") {
        set状态({ kind: "no-content" })
        return
      }
      const 编辑器 = await (props.editor ?? 加载代码编辑器)()
      if (!还在()) return
      set状态({ kind: "open", 编辑器, contents: content.content })
    } catch {
      if (!还在()) return
      set状态({ kind: "open-failed" })
    }
  }

  return (
    <>
      <Show when={已打开()} keyed>
        {(opened) => <Dynamic component={opened.编辑器} name={名字()} contents={opened.contents} />}
      </Show>

      <Show when={状态().kind === "no-content"}>
        <DegradedView reason="empty" name={名字()} />
      </Show>

      <Show when={状态().kind === "open-failed"}>
        <DegradedView reason="load-failed" name={名字()} />
      </Show>

      {/* 「未开启」与「开启中」是同一块面板，只是按钮不可再点 */}
      <Show when={状态().kind === "closed" || 状态().kind === "opening"}>
        <div
          data-component="code-view"
          data-state={状态().kind}
          class="flex min-h-40 w-full flex-col items-center justify-center gap-2 p-6 text-center"
        >
          {/* 图标颜色来自**祖先**提供的 `--icon-base`（`icon.css` 给图标自己写了
              `color: var(--icon-base)`，父级的 `text-v2-*` 到不了它）——同 `degraded-view`。 */}
          <span
            data-slot="code-icon"
            class="mb-1 flex items-center"
            style={{ "--icon-base": "var(--v2-icon-icon-muted)" }}
          >
            <Icon name="terminal" />
          </span>
          <p data-slot="code-title" class="text-[14px] font-[530] text-v2-text-text-base">
            这是代码文件
          </p>
          {/* 文件名是**不可信输入**：走 `textContent`，永不进 HTML */}
          <p data-slot="code-detail" class="text-[13px] font-[440] text-v2-text-text-muted">
            「{名字()}」默认不用代码编辑器打开。
          </p>
          <ButtonV2
            data-slot="code-open"
            variant="neutral"
            disabled={状态().kind === "opening"}
            onClick={() => void 打开()}
          >
            用代码编辑器打开
          </ButtonV2>
        </div>
      </Show>
    </>
  )
}
