import { createMemo, createSignal, For, Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import {
  buildFileTreeV2Model,
  flattenFileTreeV2,
  type FileTreeV2Node,
} from "@/components/file-tree-v2-model"

/** 工具栏六入口的标识——顺序即 `2026-09-11-项目管理-design.md` §6.1 的表格顺序。 */
export type FileTreeAction = "search" | "collapse-all" | "expand-all" | "create" | "rename" | "delete"

/** 一份图标名映射，集中于此便于与设计 §6.1 的表格逐行对照。 */
const 图标: Record<Exclude<FileTreeAction, "search">, "collapse" | "expand" | "plus" | "pencil-line" | "trash"> = {
  "collapse-all": "collapse",
  "expand-all": "expand",
  create: "plus",
  rename: "pencil-line",
  delete: "trash",
}

/** 每层缩进（设计 §6.4：16px 层级缩进）。 */
const INDENT_STEP = 16

/** 空态两句**不同**文案——「一个文件都没有」与「搜不到」不是一件事（同 T006 两个空态的处理）。 */
const EMPTY_TREE = "还没有文件"
const EMPTY_SEARCH = "没有匹配的文件"

const TOOL_BUTTON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-03 hover:text-v2-text-text-base disabled:pointer-events-none disabled:text-v2-text-text-faint"
const SEARCH_INPUT =
  "h-6 min-w-0 flex-1 rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 text-[13px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
const ROW = "flex h-6 min-w-0 w-full shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1 text-[13px] text-v2-text-text-base hover:bg-v2-background-bg-layer-03"
const ROW_SELECTED = "bg-v2-background-bg-layer-03"
const MENU_ITEM =
  "flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[4px] px-1.5 text-left text-[13px] text-v2-text-text-base hover:bg-v2-background-bg-layer-03 disabled:pointer-events-none disabled:text-v2-text-text-faint"

export interface FileTreeProps {
  /**
   * 树的路径清单——形状与上游 `buildFileTreeV2Model` 收的完全一致（`readonly string[]`），
   * 故调用方不必先建树。省略 / 空都走空态（两者都是「今天没有东西可看」，不必在 UI 上区分）。
   */
  paths?: readonly string[]
  /**
   * 新建文件 / 文件夹。`parent` 是**落点目录**（`""` = 根）：选中目录 ⇒ 它自己，
   * 选中文件 ⇒ 它所在的目录，什么都没选 ⇒ 根。
   *
   * 省略 = 还没接线：**＋ 本身禁用**，下拉都打不开（同 T005 三个按钮、T006 两个新建键）。
   * 一个点了没反应的按钮是对用户的谎——「看起来能点」比「少个按钮」更难查。
   */
  onCreate?: (input: { kind: "file" | "directory"; parent: string }) => void
  /** 重命名**选中项**。省略 = 还没接线，按钮禁用。 */
  onRename?: (path: string) => void
  /** 删除**选中项**。省略 = 还没接线，按钮禁用。（二次确认属 T009，本 task 只到接缝。） */
  onDelete?: (path: string) => void
}

/**
 * 文件树（FR-005 / `2026-09-11-项目管理-design.md` §6）：工具栏 ＋ 树本体。
 *
 * ## 为什么不是直接用上游那棵树
 *
 * 上游 `components/file-tree-v2.tsx` 要 `useFile()`（六层 provider），组件测试整个拖不进来。
 * D0-2 裁定「包一层、底座取 v2 **纯函数** model」——本组件底座就是
 * `components/file-tree-v2-model.ts` 的 `buildFileTreeV2Model` / `flattenFileTreeV2`（上游文件**一字未改**），
 * 展开态由本组件自持，于是能像 `ProjectPanel` 一样脱 provider 单测。
 *
 * ## 状态归属
 *
 * 展开 / 搜索 / 选中是**纯 UI 状态**，落在组件内部（同 `ProjectPanel` 的 tab）；
 * 路径与三个动作走 props。**唯一一处设计取舍**：目录行的**箭头**管开合、**行本身**管选中——
 * 若点行即开合，则「选中目录 ⇒ 在它下面新建」会把落点当场收起来，用户看不见自己在哪建。
 *
 * ## 与 T009 / T008 的边界
 *
 * 本 task 交付**选中机制本身**与三个动作的接缝。「选中后点亮、未选中置灰」的视觉门禁、
 * 删除二次确认归 **T009**；复制 / 移动 / 上传 / 下载 / 备份 / 拉回归 **T008**。
 * 故本组件今天**不**在「没选中」时禁用重命名 / 删除——按钮是活的，只是没有作用对象就不喊回调。
 */
export function FileTree(props: FileTreeProps) {
  const [keyword, setKeyword] = createSignal("")
  /** 收起态**存反向**（收起集合而不是展开集合）：默认全展开是常态，空集合即默认。 */
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = createSignal<string>()
  const [createOpen, setCreateOpen] = createSignal(false)

  const 全部 = () => props.paths ?? []
  const 词 = () => keyword().trim().toLowerCase()

  const 全模型 = createMemo(() => buildFileTreeV2Model(全部()))
  /** 路径 → 节点，只为「选中项是目录还是文件」这一问（落点要用）。 */
  const 节点表 = createMemo(() => {
    const map = new Map<string, FileTreeV2Node>()
    for (const list of 全模型().children.values()) for (const node of list) map.set(node.path, node)
    return map
  })

  const 展开 = (path: string) => !collapsed().has(path)
  const 切换 = (path: string) => {
    const next = new Set(collapsed())
    if (!next.delete(path)) next.add(path)
    setCollapsed(next)
  }

  /** 搜索态下模型只含命中项及其祖先 ⇒ 全部展开即「父级路径自动展开」（设计 §6.1 原话）。 */
  const 行列表 = createMemo(() => {
    const k = 词()
    const 模型 = k ? buildFileTreeV2Model(全部().filter((path) => path.toLowerCase().includes(k))) : 全模型()
    return flattenFileTreeV2(模型, k ? () => true : 展开)
  })

  /** 新建的落点目录（见 `onCreate`）。 */
  const 落点 = () => {
    const path = selected()
    if (!path) return ""
    if (节点表().get(path)?.type === "directory") return path
    const index = path.lastIndexOf("/")
    return index === -1 ? "" : path.slice(0, index)
  }

  return (
    <div data-component="file-tree" class="flex w-full min-w-0 flex-col gap-1">
      {/* 设计 §6.1 的六入口，顺序即优先级：搜索 → ⊟ → ⊞ → ＋ → ✏️ → 🗑 */}
      <div data-slot="file-tree-toolbar" class="flex w-full min-w-0 items-center gap-0.5">
        <input
          data-action="search"
          data-slot="file-tree-search"
          aria-label="搜索文件"
          placeholder="搜索"
          class={SEARCH_INPUT}
          value={keyword()}
          onInput={(event) => setKeyword(event.currentTarget.value)}
        />
        <For each={["collapse-all", "expand-all", "create", "rename", "delete"] as const}>
          {(action) => (
            <button
              data-action={action}
              data-slot={`file-tree-action-${action}`}
              type="button"
              aria-label={标签[action]}
              class={TOOL_BUTTON}
              disabled={禁用(action)}
              onClick={() => 点(action)}
            >
              <Icon name={图标[action]} size="small" />
            </button>
          )}
        </For>
      </div>

      <Show when={createOpen()}>
        {/* ＋ 的文件夹下拉（设计 §6.1：两项收进下拉，不占两个图标位） */}
        <div data-slot="file-tree-create-menu" class="flex w-full min-w-0 flex-col gap-0.5 rounded-[4px] bg-v2-background-bg-layer-01 p-0.5">
          <button data-slot="file-tree-create-file" type="button" class={MENU_ITEM} onClick={() => 新建("file")}>
            <Icon name="open-file" size="small" />
            新建文件
          </button>
          <button data-slot="file-tree-create-dir" type="button" class={MENU_ITEM} onClick={() => 新建("directory")}>
            <Icon name="folder" size="small" />
            新建文件夹
          </button>
        </div>
      </Show>

      <Show
        when={行列表().length > 0}
        fallback={
          <div data-slot="file-tree-empty" class="px-1 py-2 text-[13px] text-v2-text-text-faint">
            {词() ? EMPTY_SEARCH : EMPTY_TREE}
          </div>
        }
      >
        <div data-slot="file-tree-body" role="tree" class="flex w-full min-w-0 flex-col">
          <For each={行列表()}>
            {(row) => (
              <div
                data-slot="file-tree-row"
                data-path={row.node.path}
                data-type={row.node.type}
                data-level={row.level}
                data-selected={selected() === row.node.path ? "true" : undefined}
                // 展开态走 `aria-expanded`，不只靠箭头朝向（DESIGN §4.3：不单以图形传意）
                aria-expanded={
                  row.node.type === "directory" ? (展开(row.node.path) ? "true" : "false") : undefined
                }
                role="treeitem"
                // 可聚焦 + `onKeyDown`：鼠标不是唯一的路（`click-events-have-key-events` 要的正是这两样）。
                // 每一行都可 Tab 到，而不是 roving tabindex——后者若不补齐 ↑↓ 区间导航，键盘用户反而
                // 出不了这一行，比「多几个 Tab 停靠点」更糟。
                tabindex="0"
                style={{ "padding-left": `${row.level * INDENT_STEP}px` }}
                classList={{ [ROW]: true, [ROW_SELECTED]: selected() === row.node.path }}
                onClick={() => setSelected(row.node.path)}
                onKeyDown={(event) => 按键(event, row.node.path, row.node.type)}
              >
                <Show
                  when={row.node.type === "directory"}
                  fallback={<span class="w-4 shrink-0" />}
                >
                  <button
                    data-slot="file-tree-chevron"
                    type="button"
                    aria-label={展开(row.node.path) ? "收起" : "展开"}
                    class="flex h-4 w-4 shrink-0 items-center justify-center text-v2-text-text-muted"
                    onClick={(event) => {
                      // 箭头只管开合，别把点击冒泡给行——否则会连带切换选中（设计取舍见文件头）
                      event.stopPropagation()
                      切换(row.node.path)
                    }}
                  >
                    <Icon name={展开(row.node.path) ? "chevron-down" : "chevron-right"} size="small" />
                  </button>
                </Show>
                <FileIcon
                  node={{ path: row.node.path, type: row.node.type }}
                  expanded={展开(row.node.path)}
                  class="h-4 w-4 shrink-0"
                />
                <span data-slot="file-tree-name" class="min-w-0 truncate">
                  <高亮 name={row.node.name} keyword={词()} />
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )

  function 禁用(action: Exclude<FileTreeAction, "search">) {
    if (action === "collapse-all" || action === "expand-all") return false
    if (action === "create") return !props.onCreate
    if (action === "rename") return !props.onRename
    return !props.onDelete
  }

  function 点(action: Exclude<FileTreeAction, "search">) {
    if (action === "collapse-all") return setCollapsed(new Set(节点表().keys()))
    if (action === "expand-all") return setCollapsed(new Set<string>())
    if (action === "create") return setCreateOpen((open) => !open)
    const path = selected()
    if (!path) return // 没有作用对象就不动作（不猜「大概是指根」）
    if (action === "rename") return props.onRename?.(path)
    props.onDelete?.(path)
  }

  function 新建(kind: "file" | "directory") {
    props.onCreate?.({ kind, parent: 落点() })
    setCreateOpen(false)
  }

  /** 行上的键盘动作：回车 / 空格＝选中，←/→＝目录开合（与点箭头同一个意思）。 */
  function 按键(event: KeyboardEvent, path: string, type: "file" | "directory") {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault() // 空格默认会滚页面，这不是我们想要的
      setSelected(path)
      return
    }
    if (type !== "directory") return
    if (event.key === "ArrowRight" && !展开(path)) {
      event.preventDefault()
      切换(path)
      return
    }
    if (event.key === "ArrowLeft" && 展开(path)) {
      event.preventDefault()
      切换(path)
    }
  }
}

const 标签: Record<Exclude<FileTreeAction, "search">, string> = {
  "collapse-all": "全部收缩",
  "expand-all": "全部展开",
  create: "新建",
  rename: "重命名",
  delete: "删除",
}

/** 命中处套 `<mark>`——设计 §6.1 的「关键词高亮」。 */
function 高亮(props: { name: string; keyword: string }) {
  const 段 = createMemo(() => {
    const k = props.keyword
    if (!k) return [{ text: props.name, hit: false }]
    const lower = props.name.toLowerCase()
    const out: { text: string; hit: boolean }[] = []
    let index = 0
    while (index < props.name.length) {
      const at = lower.indexOf(k, index)
      if (at === -1) {
        out.push({ text: props.name.slice(index), hit: false })
        break
      }
      if (at > index) out.push({ text: props.name.slice(index, at), hit: false })
      out.push({ text: props.name.slice(at, at + k.length), hit: true })
      index = at + k.length
    }
    return out
  })

  return (
    <For each={段()}>
      {(piece) =>
        piece.hit ? (
          <mark data-slot="file-tree-hit" class="bg-transparent text-v2-text-text-contrast">
            {piece.text}
          </mark>
        ) : (
          <>{piece.text}</>
        )
      }
    </For>
  )
}
