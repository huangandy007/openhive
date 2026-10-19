import { For, Show } from "solid-js"
import type { 草稿状态 } from "./richtext/draft-store"
import type { 编辑动作 } from "./richtext/markdown-actions"

/**
 * 中栏文档的编辑工具栏。
 *
 * 纯展示：每个按钮只报「用户按了哪个动作」，正文与选区怎么变全在
 * `markdown-actions.ts`（纯函数）与视图里。这样工具栏自己不需要 DOM，也不会偷偷改草稿。
 *
 * ⚠️ 按钮的 `mousedown` 一律 `preventDefault`：不这么做，按下按钮会先把焦点从编辑框抢走，
 * 选区在 `click` 之前就已经塌掉——加粗的会是「光标处」而不是「选中的那段」（`#005-17` 同族）。
 */

const 钮类 =
  "flex h-7 cursor-pointer items-center rounded px-2 text-[13px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-v2-text-text-muted"

export function 工具栏钮(props: {
  动作: string
  文案: string
  说明?: string
  点: () => void
  禁用?: boolean
}) {
  return (
    <button
      type="button"
      data-action={props.动作}
      title={props.说明}
      aria-label={props.说明}
      disabled={props.禁用}
      onMouseDown={(事件) => 事件.preventDefault()}
      onClick={props.点}
      class={钮类}
    >
      {props.文案}
    </button>
  )
}

const 行内: Array<{ 动作: 编辑动作; 文案: string; 说明: string }> = [
  { 动作: "bold", 文案: "B", 说明: "粗体（Ctrl+B）" },
  { 动作: "italic", 文案: "I", 说明: "斜体（Ctrl+I）" },
  { 动作: "strike", 文案: "S", 说明: "删除线" },
  { 动作: "code", 文案: "`", 说明: "行内代码" },
  { 动作: "link", 文案: "链接", 说明: "插入链接" },
]

const 行块: Array<{ 动作: 编辑动作; 文案: string; 说明: string }> = [
  { 动作: "ul", 文案: "• 列表", 说明: "无序列表" },
  { 动作: "ol", 文案: "1. 列表", 说明: "有序列表" },
  { 动作: "quote", 文案: "引用", 说明: "引用" },
  { 动作: "hr", 文案: "分隔线", 说明: "水平分隔线" },
  { 动作: "code-block", 文案: "代码块", 说明: "代码块" },
  { 动作: "table", 文案: "表格", 说明: "插入表格" },
]

const 状态话 = (状态: 草稿状态, 提示?: string, savedAt?: number): string => {
  switch (状态) {
    case "clean": {
      if (savedAt === undefined) return ""
      const 时 = new Date(savedAt)
      const 两 = (值: number) => String(值).padStart(2, "0")
      return `已保存 ${两(时.getHours())}:${两(时.getMinutes())}`
    }
    case "dirty":
      return "未保存"
    case "saving":
      return "保存中…"
    case "error":
      return `保存失败：${提示 ?? "未知原因"}`
    case "conflict":
      return "盘上已改动，自动保存已暂停"
  }
}

export function 编辑工具栏(props: {
  模式: "edit" | "preview"
  markdown: boolean
  状态: 草稿状态
  提示?: string
  savedAt?: number
  动作: (动作: 编辑动作) => void
  编辑: () => void
  保存: () => void
  重试: () => void
  预览: () => void
  载入盘上: () => void
  图片: () => void
  附件: () => void
  撤销: () => void
  重做: () => void
}) {
  return (
    <Show
      when={props.模式 === "edit"}
      fallback={<工具栏钮 动作="edit" 文案="编辑" 说明="进入编辑" 点={props.编辑} />}
    >
      <div class="flex flex-1 flex-wrap items-center gap-1">
        <工具栏钮 动作="undo" 文案="撤销" 说明="撤销（Ctrl+Z）" 点={props.撤销} />
        <工具栏钮 动作="redo" 文案="重做" 说明="重做（Ctrl+Shift+Z）" 点={props.重做} />

        <Show when={props.markdown}>
          <select
            data-action="heading"
            aria-label="标题级别"
            class="h-7 cursor-pointer rounded bg-transparent px-1 text-[13px] text-v2-text-text-muted outline-none hover:text-v2-text-text-base"
            onChange={(事件) => {
              const 值 =事件.currentTarget.value
              事件.currentTarget.value = ""
              if (值 !== "") props.动作(值 as 编辑动作)
            }}
          >
            <option value="">标题</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
            <option value="h4">H4</option>
            <option value="h5">H5</option>
            <option value="h6">H6</option>
          </select>

          <For each={行内}>
            {(项) => <工具栏钮 动作={项.动作} 文案={项.文案} 说明={项.说明} 点={() => props.动作(项.动作)} />}
          </For>
          <For each={行块}>
            {(项) => <工具栏钮 动作={项.动作} 文案={项.文案} 说明={项.说明} 点={() => props.动作(项.动作)} />}
          </For>

          <工具栏钮 动作="image" 文案="图片" 说明="插入项目里的图片" 点={props.图片} />
          <工具栏钮 动作="attachment" 文案="附件" 说明="插入项目里的附件" 点={props.附件} />
        </Show>

        <工具栏钮 动作="save" 文案="保存" 说明="立即保存（Ctrl+S）" 点={props.保存} />
        <工具栏钮 动作="preview" 文案="预览" 说明="保存并回到预览" 点={props.预览} />

        <Show when={props.状态 === "conflict"}>
          <工具栏钮 动作="retry" 文案="重试" 说明="再存一次（盘上确实变了就仍会冲突）" 点={props.重试} />
          <工具栏钮 动作="load-disk" 文案="载入盘上版本" 说明="放弃我的改动，载入盘上那份" 点={props.载入盘上} />
        </Show>

        <span
          data-slot="richtext-save-state"
          data-status={props.状态}
          class="ml-auto text-[12px] leading-5 text-v2-text-text-muted"
        >
          {状态话(props.状态, props.提示, props.savedAt)}
        </span>
      </div>
    </Show>
  )
}
