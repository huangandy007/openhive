import { createMemo, createSignal, For, Show } from "solid-js"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
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

/**
 * 右键菜单十项的标识——顺序与分组即 `2026-09-11-项目管理-design.md` §6.2 那张表的四行
 * （表里一行＝菜单里一组，组间一个分隔符）。
 */
export type FileTreeMenuItem =
  | "create-file"
  | "create-dir"
  | "rename"
  | "copy"
  | "move"
  | "delete"
  | "upload"
  | "download"
  | "backup"
  | "restore"

/** 每层缩进（设计 §6.4：16px 层级缩进）。 */
const INDENT_STEP = 16

/** 空态两句**不同**文案——「一个文件都没有」与「搜不到」不是一件事（同 T006 两个空态的处理）。 */
const EMPTY_TREE = "还没有文件"
const EMPTY_SEARCH = "没有匹配的文件"

const TOOL_BUTTON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-03 hover:text-v2-text-text-base disabled:pointer-events-none disabled:text-v2-text-text-faint"

/**
 * 🗑 **点亮**时的那条（设计 §6.1：「删除：选中后点亮（红色）」）。
 *
 * 另起一条而不是在原 class 上追加 `text-v2-state-fg-danger`：`TOOL_BUTTON` 里已经写死了
 * `text-v2-text-text-muted`，两个同权重的文本色类同时挂在元素上时，谁生效取决于 **CSS 里的先后**，
 * 不看 class 属性的顺序 ⇒ 那会是一个「看着该红、实际不一定红」的写法。
 */
const TOOL_BUTTON_DANGER =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-state-fg-danger hover:bg-v2-background-bg-layer-03 hover:text-v2-state-fg-danger disabled:pointer-events-none disabled:text-v2-text-text-faint"
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
  /** 重命名**选中项**（工具栏）／**右键那一项**（菜单）。省略 = 还没接线，按钮与菜单项都禁用。 */
  onRename?: (path: string) => void
  /** 删除**选中项**（工具栏）／**右键那一项**（菜单）。省略 = 还没接线，按钮与菜单项都禁用。（二次确认属 T009。） */
  onDelete?: (path: string) => void

  /**
   * 设计 §6.2 第二～四组的那六个动作。**一律收「被右键那个节点」的路径**——包括上传：
   * 「传到哪 / 从哪传」由接收方按节点是文件还是目录自己判，本组件不替它先阉一刀。
   *
   * 六个**各自独立**接线：菜单里一项一项地亮（备份归 T011/T012，其余四项目前无人认领），
   * 不是「全接上才一起亮」。省略 = 该项禁用。
   */
  onCopy?: (path: string) => void
  onMove?: (path: string) => void
  onUpload?: (path: string) => void
  onDownload?: (path: string) => void
  onBackup?: (path: string) => void
  onRestore?: (path: string) => void

  /**
   * 行是否可拖（设计 §6.3 拖拽 B「沙箱 ↔ MinIO」里**上树**那一侧）。只有**文件行**会被标上
   * `draggable`——§5 划的是「文件级」备份，把目录整个拖下去不是一个动作。
   *
   * 本组件**只**负责「让行可拖」；拖起来之后往哪儿去、放到谁身上，由**容器**
   * （`dual-file-tree.tsx`）在自己那层做事件委托——树不必知道「MinIO」这种东西存在
   * （同「六个动作一律走 props」的口径）。
   *
   * 省略 ＝ 不可拖。今天由 `DualFileTree` 按「有没有接 `onBackup`」决定（未接线即禁用）。
   */
  draggable?: boolean
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
 * ## 两套「当前项」，别弄混（T008 起的约定）
 *
 * - **工具栏**的重命名 / 删除作用于**选中项**（`selected`）——图标栏里没有「指着谁」这回事，
 *   只能靠选中。
 * - **右键菜单**作用于**被右键的那一行**（`菜单对象`）——与选中项**可以不是同一行**：
 *   用户完全可能选中着甲、去右键乙。菜单不去改选中态，免得「右键即改选中」这种副作用
 *   在别处冒出来。
 *
 * 所以菜单里的重命名 / 删除和工具栏里那两个是**同一个回调**（`onRename` / `onDelete`），
 * 只是**作用对象来源不同**——两个入口、一个动作，不另起一套。
 *
 * ## 与 T009 的边界
 *
 * 本组件今天**不**在「没选中」时禁用重命名 / 删除——按钮是活的，只是没有作用对象就不喊回调；
 * 「选中后点亮、未选中置灰」的视觉门禁与删除二次确认归 **T009**。
 *
 * ## 右键菜单的接线状态（T008）
 *
 * 十项里**只有三项接得上**：新建两项走 `onCreate`、重命名/删除走 T007 就有的回调。
 * 其余六项（复制 / 移动 / 上传 / 下载 / 备份 / 拉回）**今天都没有接收方**——按「未接线即禁用」
 * 一律置灰（备份 / 拉回等 T011/T012，复制 / 移动 / 上传 / 下载**尚无 task 认领**，已挂进
 * `tasks.md` 的欠账）。菜单先把**入口与形状**做齐，接线时只补 props，不改菜单结构。
 */
export function FileTree(props: FileTreeProps) {
  const [keyword, setKeyword] = createSignal("")
  /** 收起态**存反向**（收起集合而不是展开集合）：默认全展开是常态，空集合即默认。 */
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = createSignal<string>()
  const [createOpen, setCreateOpen] = createSignal(false)
  /**
   * 「待确认删除」的那一项——非空即**确认条开着**（FR-006：文件删除 MUST 二次确认）。
   *
   * 存**路径**而不是布尔：确认条上要写出「删的是谁」（用户得看得出对象），取消 / 确认之后
   * 还得原样把路径喊回 `onDelete`。工具栏与右键菜单共用这一个信号 ⇒ 两个入口天然是**同一条**确认。
   */
  const [待删, set待删] = createSignal<string>()
  /**
   * 右键点在哪个节点上（`undefined` = 没点在行上：空态、或行以外的空白）。
   *
   * **不是** `selected`：菜单的作用对象是「右键那一行」，选中态是工具栏的作用对象，
   * 两者可以不是同一行（详见文件头）。
   */
  const [菜单对象, set菜单对象] = createSignal<string>()

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

  /**
   * 新建的落点目录（见 `onCreate`）：给一个节点，回它该往哪儿建——
   * 目录＝它自己，文件＝它所在的目录，没有节点（`undefined`）＝根。
   *
   * 收参数而不读 `selected()`：工具栏从选中项取、菜单从右键对象取，规则同一份。
   */
  const 落点 = (path: string | undefined) => {
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
              // 悬停给 tooltip 提示动作名（设计 §6.1 最后一条）
              title={标签[action]}
              class={action === "delete" && !禁用("delete") ? TOOL_BUTTON_DANGER : TOOL_BUTTON}
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
          <button
            data-slot="file-tree-create-file"
            type="button"
            class={MENU_ITEM}
            onClick={() => 新建("file", selected())}
          >
            <Icon name="open-file" size="small" />
            新建文件
          </button>
          <button
            data-slot="file-tree-create-dir"
            type="button"
            class={MENU_ITEM}
            onClick={() => 新建("directory", selected())}
          >
            <Icon name="folder" size="small" />
            新建文件夹
          </button>
        </div>
      </Show>

      <ContextMenu>
        {/* 右键落在哪儿就算哪儿：这一层是**树区域**（行 ＋ 空态），工具栏**不在**里面——
            右键搜索框弹出「新建文件」是说不通的。「把菜单开出来」是 Kobalte 的事。 */}
        <ContextMenu.Trigger as="div" data-slot="file-tree-area" class="flex w-full min-w-0 flex-col">
          {/* ⚠️ `onContextMenu` **不能挂在 `ContextMenu.Trigger` 上**——Kobalte 的触发器把它整个
              收走了（`context-menu-trigger.tsx` 里 `splitProps` 掉它，非 `disabled` 分支
              `preventDefault()` ＋ `stopPropagation()` 之后**不调用**外部传进来的那个），
              挂上去会**静默失效**：菜单照开，作用对象永远是「没有」。挂在内层：冒泡时我们先跑，
              它再接着开菜单。 */}
          <div data-slot="file-tree-region" class="flex w-full min-w-0 flex-col" onContextMenu={记对象}>
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
                      // 拖拽只在**文件**行上开（见 `draggable` 那条注释）。拖起来的 payload 与
                      // 「放到哪棵树」都由容器判，这里只交出「这一行可以拖」这一个事实。
                      draggable={props.draggable === true && row.node.type === "file"}
                      style={{ "padding-left": `${row.level * INDENT_STEP}px` }}
                      classList={{ [ROW]: true, [ROW_SELECTED]: selected() === row.node.path }}
                      onClick={() => setSelected(row.node.path)}
                      onKeyDown={(event) => 按键(event, row.node.path, row.node.type)}
                    >
                      <Show when={row.node.type === "directory"} fallback={<span class="w-4 shrink-0" />}>
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
        </ContextMenu.Trigger>

        {/* 设计 §6.2 的那张表——十项、四组、组间一个分隔符。顺序即表里的行序。 */}
        <ContextMenu.Portal>
          <ContextMenu.Content>
             {/* 第一行：同工具栏「＋」 */}
            <菜单项
              action="create-file"
              文案="新建文件"
              禁用={!props.onCreate}
              onSelect={() => 新建("file", 菜单对象())}
            />
            <菜单项
              action="create-dir"
              文案="新建文件夹"
              禁用={!props.onCreate}
              onSelect={() => 新建("directory", 菜单对象())}
            />
            <ContextMenu.Separator />
            {/* 第二行：完整文件操作 */}
            <菜单项
              action="rename"
              文案="重命名"
              禁用={要对象(props.onRename)}
              onSelect={() => props.onRename?.(菜单对象() ?? "")}
            />
            <菜单项
              action="copy"
              文案="复制"
              禁用={要对象(props.onCopy)}
              onSelect={() => props.onCopy?.(菜单对象() ?? "")}
            />
            <菜单项
              action="move"
              文案="移动"
              禁用={要对象(props.onMove)}
              onSelect={() => props.onMove?.(菜单对象() ?? "")}
            />
            <菜单项
              action="delete"
              文案="删除"
              禁用={要对象(props.onDelete)}
              onSelect={() => 点删(菜单对象())}
            />
            <ContextMenu.Separator />
            {/* 第三行：沙箱 ↔ 本地电脑（§6.3 拖拽 A 的替代入口） */}
            <菜单项
              action="upload"
              文案="上传"
              禁用={!props.onUpload}
              onSelect={() => props.onUpload?.(菜单对象() ?? "")}
            />
            <菜单项
              action="download"
              文案="下载"
              禁用={要对象(props.onDownload)}
              onSelect={() => props.onDownload?.(菜单对象() ?? "")}
            />
            <ContextMenu.Separator />
            {/* 第四行：沙箱 ↔ MinIO（§6.3 拖拽 B 的替代入口） */}
            <菜单项
              action="backup"
              文案="备份到 MinIO"
              禁用={要对象(props.onBackup)}
              onSelect={() => props.onBackup?.(菜单对象() ?? "")}
            />
            <菜单项
              action="restore"
              文案="从 MinIO 拉回"
              禁用={要对象(props.onRestore)}
              onSelect={() => props.onRestore?.(菜单对象() ?? "")}
            />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>

      {/* 删除的二次确认（FR-006）——**内联**一条，不用 `Dialog`：树是用户眼睛已经在的地方，
          再叠一层跨模块的模态还得让人多解释一步「这是在删哪儿」。`role="alert"` 让屏幕阅读器
          在条冒出来时读一遍（不是模态，不需要焦点管理）。 */}
      <Show when={待删()}>
        {(path) => (
          <div
            data-slot="file-tree-delete-confirm"
            role="alert"
            class="flex w-full min-w-0 items-center gap-1 rounded-[4px] bg-v2-background-bg-layer-01 px-1 py-0.5 text-[13px] text-v2-text-text-base"
          >
            <span class="min-w-0 truncate">
              确定删除「<span data-slot="file-tree-delete-name">{path()}</span>」？
            </span>
            <button
              data-slot="file-tree-delete-cancel"
              type="button"
              class={MENU_ITEM}
              onClick={() => set待删(undefined)}
            >
              取消
            </button>
            <button data-slot="file-tree-delete-ok" type="button" class={MENU_ITEM} onClick={确认删}>
              删除
            </button>
          </div>
        )}
      </Show>
    </div>
  )

  function 禁用(action: Exclude<FileTreeAction, "search">) {
    if (action === "collapse-all" || action === "expand-all") return false
    if (action === "create") return !props.onCreate
    // 重命名 / 删除作用于**选中项**：没接线**与**没选中是两条**独立**的禁用理由（FR-006
    // 「未选中置灰」／US2 AC4「置灰不可点」）。写了 `|| !selected()` 之后，`点` 里那句
    // 「没有作用对象就不动作」仍然是必要的兜底——禁用只是不让点，不是不许调。
    if (action === "rename") return !props.onRename || !selected()
    return !props.onDelete || !selected()
  }

  function 点(action: Exclude<FileTreeAction, "search">) {
    if (action === "collapse-all") return setCollapsed(new Set(节点表().keys()))
    if (action === "expand-all") return setCollapsed(new Set<string>())
    if (action === "create") return setCreateOpen((open) => !open)
    const path = selected()
    if (!path) return // 没有作用对象就不动作（不猜「大概是指根」）
    if (action === "rename") return props.onRename?.(path)
    点删(path)
  }

  /**
   * 删除**永远**先开确认条，绝不直接喊 `onDelete`（FR-006：文件删除 MUST 二次确认）——
   * 工具栏与右键菜单都走这一个函数，所以「不分入口」是结构上成立的，不是靠两处各写一遍留意着。
   */
  function 点删(path: string | undefined) {
    if (path) set待删(path)
  }

  /** 确认条上那个「删除」——到这里才真正喊回调，同时把条收掉。 */
  function 确认删() {
    const path = 待删()
    if (!path) return
    set待删(undefined)
    props.onDelete?.(path)
  }

  function 新建(kind: "file" | "directory", path: string | undefined) {
    props.onCreate?.({ kind, parent: 落点(path) })
    setCreateOpen(false)
  }

  /**
   * 菜单里**要作用对象**的那七项的共同前置：没接线、或没右键到任何节点，都禁用。
   *
   * 新建两项与上传不适用——它们要的是**落点目录**，没有对象时落点＝根，是合理的
   * （正如工具栏的 ＋）。其余七项对着「根」是说不通的：复制根、删除根都不是一个动作。
   */
  function 要对象(接: ((path: string) => void) | undefined) {
    return !接 || !菜单对象()
  }

  /**
   * 右键时记下**指针底下那一行**。挂在这一层（而不是每行各挂一个）：落在行以外的空白
   * 自然就记成「没有对象」，不必再写一条「清空」的分支。
   */
  function 记对象(event: MouseEvent) {
    const target = event.target
    const row = target instanceof Element ? target.closest<HTMLElement>("[data-slot='file-tree-row']") : null
    set菜单对象(row?.getAttribute("data-path") ?? undefined)
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

/**
 * 一个右键菜单项。抽出来只为让上面那张「设计 §6.2 的表」一眼可读——
 * 十项各写一整块同样的 JSX，分组与顺序就淹没在样板里了。禁用态由调用处各自给：
 * 「未接线」与「没有作用对象」是**两条不同的理由**，混在一个函数里就看不出来了。
 */
function 菜单项(props: {
  action: FileTreeMenuItem
  文案: string
  禁用: boolean
  onSelect: () => void
}) {
  return (
    <ContextMenu.Item data-action={props.action} disabled={props.禁用} onSelect={props.onSelect}>
      <ContextMenu.ItemLabel>{props.文案}</ContextMenu.ItemLabel>
    </ContextMenu.Item>
  )
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
