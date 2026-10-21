import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { extensionOf } from "@/center/view-registry"
import { 请求文件清单, projectFiles } from "@/project/project-files"

/**
 * 从**当前项目的文件清单**里挑一个，插成引用。
 *
 * 为什么不走系统文件对话框：Markdown 里要写的是**项目内相对路径**，系统对话框给的是本机绝对
 * 路径——两者对不上。上传新文件（把本机文件搬进项目）是 P1，本期只引用已经在项目里的文件。
 *
 * 图片只列图片扩展名；附件列全部（附件可以是任何东西）。
 */
/** 拖入时也用它判类型，所以导出。 */
export const 图片扩展 = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"])

export function 引用文件选择(props: {
  类型: "image" | "attachment"
  选好: (path: string) => void
  关掉: () => void
}) {
  const [找, set找] = createSignal("")
  /**
   * 按需取数（2026-10-21）：文件清单只在「有人要看」时才取，而本选择器**看不见左栏页签**
   * ——用户停「会话」页签打开它时，清单可能还没取过。挂载即拨一下，免得把它饿成空列表。
   */
  onMount(请求文件清单)
  const 候选 = createMemo(() => {
    // 目录在文件树里要可见，但不能被插入 Markdown——在两个分支的共同入口过滤掉。
    const 全部 = (projectFiles() ?? []).filter((路径) => !/[\\/]$/.test(路径))
    const 过滤 =
      props.类型 === "image" ? 全部.filter((路径) => 图片扩展.has(extensionOf(路径) ?? "")) : 全部
    const 词 = 找().trim().toLowerCase()
    return 词 === "" ? 过滤 : 过滤.filter((路径) => 路径.toLowerCase().includes(词))
  })

  return (
    <div
      data-slot="richtext-file-picker"
      class="flex w-full flex-col gap-1 rounded-md border border-v2-border-border-strong bg-v2-background-bg-base p-2"
    >
      <div class="flex items-center gap-1">
        <input
          data-slot="richtext-file-search"
          value={找()}
          onInput={(事件) => set找(事件.currentTarget.value)}
          aria-label={props.类型 === "image" ? "搜索项目里的图片" : "搜索项目里的文件"}
          placeholder={props.类型 === "image" ? "搜索项目里的图片" : "搜索项目里的文件"}
          class="h-7 min-w-0 flex-1 rounded bg-transparent px-2 text-[13px] text-v2-text-text-base outline-none"
        />
        <button
          type="button"
          data-slot="richtext-file-cancel"
          onClick={props.关掉}
          onMouseDown={(事件) => 事件.preventDefault()}
          class="flex h-7 cursor-pointer items-center rounded px-2 text-[13px] text-v2-text-text-muted hover:text-v2-text-text-base"
        >
          取消
        </button>
      </div>
      <div class="max-h-56 overflow-auto">
        <For each={候选()}>
          {(路径) => (
            <button
              type="button"
              data-slot="richtext-file-option"
              data-path={路径}
              onClick={() => props.选好(路径)}
              onMouseDown={(事件) => 事件.preventDefault()}
              class="flex w-full cursor-pointer items-center rounded px-2 py-1 text-left text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
            >
              {路径}
            </button>
          )}
        </For>
        <Show when={候选().length === 0}>
          <div data-slot="richtext-file-empty" class="px-2 py-1 text-[12px] text-v2-text-text-muted">
            没有匹配的文件
          </div>
        </Show>
      </div>
    </div>
  )
}
