import { createMemo, createSignal, For, Show, splitProps, type JSX } from "solid-js"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { flattenFileTreeV2, type FileTreeV2Node } from "@/components/file-tree-v2-model"
import { buildProjectFileTreeModel } from "@/project/file-tree-model"
import { FileCreateDialog } from "@/project/file-create-dialog"
import { FileDeleteDialog } from "@/project/file-delete-dialog"
import { 就地改名输入 } from "@/components/inline-rename-input"

/** 工具栏六入口的标识——顺序即 `2026-09-11-项目管理-design.md` §6.1 的表格顺序。 */
export type FileTreeAction = "search" | "collapse-all" | "expand-all" | "create" | "rename" | "delete"

/**
 * 工具栏上那**五颗钮**（搜索框不算）——顺序即设计 §6.1 的优先级，
 * `图标` / `标签` / `禁用` / `点` 都按它取值。
 */
const 工具栏五颗 = ["collapse-all", "expand-all", "create", "rename", "delete"] as const

/** 五颗钮里的一颗。 */
type 工具栏动作 = (typeof 工具栏五颗)[number]

/** 一份图标名映射，集中于此便于与设计 §6.1 的表格逐行对照。 */
const 图标: Record<工具栏动作, "collapse" | "expand" | "plus" | "pencil-line" | "trash"> = {
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
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:pointer-events-none disabled:text-v2-text-text-faint"

/**
 * 🗑 **点亮**时的那条（设计 §6.1：「删除：选中后点亮（红色）」）。
 *
 * 另起一条而不是在原 class 上追加 `text-v2-state-fg-danger`：`TOOL_BUTTON` 里已经写死了
 * `text-v2-text-text-muted`，两个同权重的文本色类同时挂在元素上时，谁生效取决于 **CSS 里的先后**，
 * 不看 class 属性的顺序 ⇒ 那会是一个「看着该红、实际不一定红」的写法。
 */
const TOOL_BUTTON_DANGER =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-state-fg-danger hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger disabled:pointer-events-none disabled:text-v2-text-text-faint"
const SEARCH_INPUT =
  "h-6 min-w-0 flex-1 rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 text-[13px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
const ROW = "flex h-6 min-w-0 w-full shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"

/**
 * **选中态**＝品牌浅金 `--v2-background-bg-accent-soft`（`DESIGN.md` §1.3「选中态」＝`#FEF3C7`，
 * `plan.md` §2 同款；先例＝同栏 `rail/rail.tsx` 的 `bg-[var(--v2-background-bg-accent-soft)]`）。
 *
 * ⚠️ **不是** `hover` 的那个 overlay token——选中和 hover 必须是**两种颜色**，否则鼠标移开后
 * 分不清哪一行还选着（005 Step 5 审查 **X5-1**：改之前两者都是 `layer-03`，同一个值）。
 */
const ROW_SELECTED = "bg-[var(--v2-background-bg-accent-soft)]"

export interface FileTreeProps {
  /**
   * 树的路径清单——形状与上游 `buildFileTreeV2Model` 收的**同**（`readonly string[]`），
   * 故调用方不必先建树。省略 / 空都走空态（两者都是「今天没有东西可看」，不必在 UI 上区分）。
   *
   * ⚠️ 比上游多认一类值：**空目录**（`资料\`，带尾分隔符——`openhive-files.ts` 补的那种）。
   * 建树的活落在 `@/project/file-tree-model`（不是上游那个函数），两种来源共用它。
   */
  paths?: readonly string[]
  /**
   * 新建文件 / 文件夹。`parent` 是**落点目录**（`""` = 根）：选中目录 ⇒ 它自己，
   * 选中文件 ⇒ 它所在的目录，什么都没选 ⇒ 根。`name` 是用户在**弹窗**里敲的名字。
   *
   * ⚠️ **点了「新建文件」不会立刻喊这个回调**（T018 起）：先问名字，敲定之后才把 `name` 一起
   * 喊出去。改之前是「点一下 ⇒ 服务端凭空建一个没名字的条目」——那在建文件这件事上根本不成立
   * （`file.ts` 的 `name` 是必填）。
   *
   * ⚠️ 问名字这一步 2026-10-11 从**行内输入条**换成了**弹窗**（`FileCreateDialog`，用户下达：
   * 「在图标下方显示输入框……与日常习惯不符」）。换的只是「在哪儿问」——本回调的入参
   * （`{ kind, parent, name }`）与喊的时机（用户确认那一下）**逐字未变** ⇒ 接线方
   * （`dual-file-tree` → `workspace-entry`）一处都不用动。
   *
   * 省略 = 还没接线：**＋ 本身禁用**，下拉都打不开（同 T005 三个按钮、T006 两个新建键）。
   * 一个点了没反应的按钮是对用户的谎——「看起来能点」比「少个按钮」更难查。
   */
  onCreate?: (input: { kind: "file" | "directory"; parent: string; name: string }) => void
  /**
   * 重命名**选中项**（工具栏）／**右键那一项**（菜单），`name` 是**新的单段名**。
   *
   * ⚠️ 同样**不立刻喊**（T018 起）：先把那一行的名字就地换成输入条（见 `改名的`），
   * Enter 才把新名字喊出去。`path` 仍是**旧路径**——服务的责任是拿它反推所在目录（同 `renameEntry`）。
   *
   * 省略 = 还没接线，按钮与菜单项都禁用。
   */
  onRename?: (path: string, name: string) => void
  /** 删除**选中项**（工具栏）／**右键那一项**（菜单）。省略 = 还没接线，按钮与菜单项都禁用。（二次确认属 T009。） */
  onDelete?: (path: string) => void

  /**
   * 设计 §6.2 第二～四组的那六个动作。**除上传外**一律收「被右键那个节点」的路径。
   *
   * 六个**各自独立**接线：菜单里一项一项地亮（备份／拉回归 T011/T012；其余四项由 T020 接上），
   * 不是「全接上才一起亮」。省略 = 该项禁用。
   *
   * ⚠️ `onCopy` / `onMove` 多一条**类型**上的禁用理由（见 `要文件`）：服务端只搬单文件，
   * 菜单里这两项因此**只画在文件行上**。其余三项没这条——`onDownload` / `onBackup` / `onRestore`
   * 对着目录是**说得出话**的（服务端会拒，界面据此报一句）。
   */
  onCopy?: (path: string) => void
  onMove?: (path: string) => void
  /**
   * 上传：收的是**落点目录**（同 `onCreate` 的 `parent`），不是被右键那一行的路径——
   * 右键目录 ⇒ 它自己、右键文件 ⇒ 它所在的目录、空白 ⇒ 根。
   *
   * `File` 是**文件系统里的东西**，本组件一个都拿不到（那是 `onDropFiles` 与文件选择器的事）：
   * 这一项只交出「往哪儿放」。
   *
   * ⚠️ 判类型只有本组件做得了（它手里有 `节点表`）：接收方那一侧只有一份**扁平的**文件清单，
   * 目录根本不在里面——把同一条「路径 → 落点目录」的规则推给每个接收方各写一遍，就是
   * `LEARNINGS #002-06` 那种会各漂一半的两份。
   */
  onUpload?: (dir: string) => void
  onDownload?: (path: string) => void
  onBackup?: (path: string) => void
  onRestore?: (path: string) => void

  /**
   * 从**桌面**拖一批文件进来（设计 §6.3 拖拽 A 的「拖回」那一半；§6.2 里「上传」的替代入口）。
   *
   * `dir` 与 `onUpload` 同一套规则（目录 ⇒ 它自己、文件 ⇒ 它所在的目录、空白 ⇒ 根）。
   * **一批一起喊**、不逐个喊：拖进来的那一刻它们是一件事，拆成几个请求是**接收方**的事
   * （服务端一次只收一个文件，而「几个成了几个没成」那句话只有接收方说得出来）。
   *
   * 本组件只认**跨进程**的拖拽——判据是 `dataTransfer.types` 里有 `"Files"`。同页面内的拖拽
   * （`DualFileTree` 的 MinIO 备份 / 拉回）也在冒泡路上经过这里，但它们的 payload 里没有文件，
   * 不该被当成上传吃掉。省略 ＝ 不接受拖入（悬停也不拦）。
   */
  onDropFiles?: (files: readonly File[], dir: string) => void

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
 * `components/file-tree-v2-model.ts` 的 `flattenFileTreeV2`（上游文件**一字未改**），
 * 展开态由本组件自持，于是能像 `ProjectPanel` 一样脱 provider 单测。
 *
 * 建树那一半 2026-10-10 起落在 `@/project/file-tree-model`：上游的
 * `buildFileTreeV2Model` 认不出**空目录**（它只从「这条路径还有下一段」认目录），
 * 而空文件夹在树上是真实存在的（用户实报「新建的文件夹建完就看不见」）。那一层只补这一件事。
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
 * ## 右键菜单的接线状态
 *
 * 十项里**七项接得上**：新建两项走 `onCreate`、重命名/删除走 T007 就有的回调、
 * 复制 / 移动 / 上传 / 下载走 T020 的四个回调。**只剩备份 / 拉回**没有接收方（T011/T012），
 * 按「未接线即禁用」置灰。菜单先把**入口与形状**做齐，接线只补 props，不改菜单结构——
 * T020 正是这样接的（唯一的例外见下一条）。
 *
 * ⚠️ T020 给复制 / 移动**加了一条类型上的禁用理由**（`要文件`）：服务端只搬单文件，
 * 对目录弹「搬到哪儿」的面板本身就是错的。这是本文件里唯一一处「接上了线、菜单项却仍可能灰着」
 * 的地方，故没有沿用 T008 那句「接线即点亮」。
 */
export function FileTree(props: FileTreeProps) {
  /**
   * 弹窗宿主（`app.tsx` 那层 `DialogProvider`）——新建走它。没有 Provider 时它会**抛错**
   * （`context/dialog.tsx` 刻意如此，不是静默 `undefined`）：那条链要断就当场断。
   */
  const dialog = useDialog()
  const [keyword, setKeyword] = createSignal("")
  /** 收起态**存反向**（收起集合而不是展开集合）：默认全展开是常态，空集合即默认。 */
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = createSignal<string>()
  /**
   * 「正在改名的那一行」的**旧路径**——非空即那一行的名字就地换成了输入条（T018）。
   *
   * 存**旧路径**而不是新名字：改名的唯一判据是「用户敲完之后的名字与原样不同吗」，那是
   * `就地改名输入` 的 `改名草稿` 说了算的（一份实现，见那个文件）；本组件只负责记住**改的是哪一行**，
   * 好把 `onRename(旧路径, 新名字)` 的两样凑齐。存新名字的中间态则要在本文件里再写一遍草稿判据。
   */
  const [改名的, set改名的] = createSignal<string>()
  /**
   * 右键点在哪个节点上（`undefined` = 没点在行上：空态、或行以外的空白）。
   *
   * **不是** `selected`：菜单的作用对象是「右键那一行」，选中态是工具栏的作用对象，
   * 两者可以不是同一行（详见文件头）。
   */
  const [菜单对象, set菜单对象] = createSignal<string>()

  const 全部 = () => props.paths ?? []
  const 词 = () => keyword().trim().toLowerCase()

  const 全模型 = createMemo(() => buildProjectFileTreeModel(全部()))
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
    const 模型 = k ? buildProjectFileTreeModel(全部().filter((path) => path.toLowerCase().includes(k))) : 全模型()
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
    /* ⚠️ `flex-1 min-h-0` 一路往下（本层 → 触发器 → `file-tree-region`），**不是装饰**：
       要让「页签里树之下的空白」也归右键触发区（2026-10-11，用户实报「空白处右键呼不出
       菜单」）。配套改动在 `@/project/sidebar-tabs`（files pane 成为 flex 容器）与
       `@/project/dual-file-tree`（`dual-file-tree` 早已写着 `flex-1`，父级变成 flex 容器后
       它才真的生效）。滚动容器随之从页签下移到 `file-tree-region`：工具栏钉住、只有树滚。 */
    <div data-component="file-tree" class="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1">
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
        <For each={工具栏五颗}>
          {(action) => (
            /* 悬停提示（设计 §6.1 最后一条「悬停给 tooltip 提示动作名」）：五颗都只有一枚图形，
               文案与 `aria-label` 同源。
               早先这里挂的是原生 `title=`（浏览器自带的慢速气泡）——2026-10-09 统一成 `TooltipV2`
               后**必须摘掉**，否则同一颗按钮上会前后冒出两层气泡。
               ⚠️ `TooltipV2` 会插一层自己的 `<div>`（实测），故 `shrink-0` 要由这层接过去，
               工具栏（`input` 占 `flex-1`）收窄时才不会先挤掉图标。
               ⚠️ 禁用态那颗带 `disabled:pointer-events-none`（`TOOL_BUTTON`）——**它照样弹得出来**：
               指针穿透按钮、落到包着它的触发壳 `<div>` 上，Kobalte 收到的是那一层的 `pointerenter`。
               2026-10-09 真浏览器实测：`file-tree-action-create`（`disabled=true`）悬停 ⇒ 浮层「新建」、
               `…-delete` ⇒ 「删除」。（别按直觉写「禁用就不弹」——那是**没实测**的假前提。） */
            <TooltipV2 value={标签[action]} class="flex shrink-0">
              <Show
                when={action === "create"}
                fallback={<工具钮 action={action} 禁用={禁用(action)} onClick={() => 点(action)} />}
              >
                {/* ＋ 的浮层菜单（设计 §6.1「两项收进下拉，不占两个图标位」；2026-10-11 改形态）。
                    改之前那两块**长在工具栏流里**：`position: static`、与工具栏同宽同左，点开就把树
                    整体往下推 58px，且点界面任何地方都不关（真栈探针读数见 `state.md` ⑦-②）。
                    用户原话是「**滑出**新建文件、新建文件夹的列表…走对应的新建链路」——功能上一版
                    就对，错的是形式：它读起来像「树上多长出来两块内容」，不像一个菜单。

                    ⚠️ 这里**不加** `modal={false}`，用 Kobalte 的默认 `modal: true`。理由不是口味，
                    是量出来的 —— 曾经照着下面右键菜单那段注释加过 `modal={false}`（「默认会在卸载
                    那一刻把焦点归还/抢走，与下游 `autofocus` 的弹窗互抢」），本轮**两臂对照把它证伪**：

                    同一份 spec（`modal-focus-probe.spec.ts`，真栈、走完即删）、**每臂 5 轮**、
                    只差 `modal` 这一个变量 —— 两臂的「裸键盘打进去的字」**都是 5/5 进得去**；
                    而**默认臂的焦点更早更稳**：默认臂 `+0ms` 起 `activeElement` 就是
                    `INPUT[fileName]`（5 轮一直如此），`modal={false}` 臂要到**打字那一刻**才补回来，
                    `+100/+400/+1000ms` 一路读 `BODY`。

                    「点外面就关」（树里一行 / 下方空白 / 搜索框，三种都实测关掉）与「不把树推下去」
                    （首行 y 恒 145）**两臂逐字一致** —— 那些是 `DismissableLayer` 的事，跟 `modal`
                    无关（这一点下面那段注释自己也写了）。

                    ⇒ 右键菜单那段的前提是**行内输入条**（它的下游是 `inline-rename-input.tsx`，
                    会被焦点归还机制自杀）；这一处的下游是**弹窗**（自己管 `autofocus`）。
                    两条链的下游不是同一个东西，理由不能搬。

                    ⚠️ 组件测试里这个参数**没有守护者**：变异（给 `DropdownMenu` 加回
                    `modal={false}`）跑 89 条全绿。它只有在真栈里量得出来。

                    同仓对齐：全仓 10 处 `<DropdownMenu>`，**8 处不传 `modal`**（用默认）；另两处各有
                    自己的理由（`windows-app-menu.tsx` 传 `false`、`layout.tsx` 传
                    `modal={!sidebarHovering()}`）。 */}
                <DropdownMenu gutter={4} placement="bottom-start">
                  <DropdownMenu.Trigger as={工具钮} action="create" 禁用={禁用("create")} disabled={禁用("create")} />
                  <DropdownMenu.Portal>
                    {/* `data-slot` 落下得了：`Content` 包的是 `data-component`，两个名字不撞 */}
                    <DropdownMenu.Content data-slot="file-tree-create-menu">
                      {/* ⚠️ 菜单项这里**只能用 `data-create-kind`**：`DropdownMenuItem` 把
                          `data-slot="dropdown-menu-item"` 写在 `{...rest}` **之后** ⇒ 调用方传的
                          `data-slot` 被静默覆盖，那个名字在 DOM 里从来不存在（`#005-22` 同病）。 */}
                      <DropdownMenu.Item data-create-kind="file" onSelect={() => 新建("file", selected())}>
                        <Icon name="open-file" size="small" />
                        <DropdownMenu.ItemLabel>新建文件</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item data-create-kind="directory" onSelect={() => 新建("directory", selected())}>
                        <Icon name="folder" size="small" />
                        <DropdownMenu.ItemLabel>新建文件夹</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </Show>
            </TooltipV2>
          )}
        </For>
      </div>

      {/* ⚠️ `modal={false}` **不是可选项**：默认 `modal: true` 会让 Kobalte 的 `createFocusScope`
          在菜单开着时锁焦点，并在**菜单卸载那一刻**把焦点**归还**给「打开菜单时容器外的聚焦元素」
          ——也就是被右键的那一行 `div[file-tree-row]`。实测焦点时间线（菜单 ⇒「重命名」）：
          `inline-rename-input.tsx:40` 的 rAF 让输入条先拿到焦点，紧接着被菜单项的
          `onFocusOut`(`7A3GDF4Y.jsx:146`) / `onFocusIn`(`QZDH5R5B.jsx:391`) **互抢两轮**，
          最后 `7A3GDF4Y.jsx:113` 把焦点归还给那一行 ⇒ 输入条 blur ⇒ 就地改名「提交」时草稿
          没变（同值）⇒ 自己收掉。**症状**：「走菜单的重命名/新建：输入条看得见、字进不去、
          磁盘不动」，而工具栏那两条好好的。
          同仓对照：`ai-session/session-list.tsx` 的 `<ContextMenu modal={false}>` 拿得到焦点。

          ⚠️ 这一处是**竞态**，不是确定性失败：不加 `modal={false}` 时「菜单 ⇒ 新建」**多数时候坏、
          偶尔碰巧好**（1ms 级胜负）。所以回归网里守护它的是 `file-tree-menu-focus-real.spec.ts`
          的**重命名**那条（输入条会自杀，结构性、稳定红），新建那条在变异下可能**假绿**。 */}
      <ContextMenu modal={false}>
        {/* 右键落在哪儿就算哪儿：这一层是**树区域**（行 ＋ 空态），工具栏**不在**里面——
            右键搜索框弹出「新建文件」是说不通的。「把菜单开出来」是 Kobalte 的事。 */}
        <ContextMenu.Trigger as="div" data-slot="file-tree-area" class="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          {/* ⚠️ `onContextMenu` **不能挂在 `ContextMenu.Trigger` 上**——Kobalte 的触发器把它整个
              收走了（`context-menu-trigger.tsx` 里 `splitProps` 掉它，非 `disabled` 分支
              `preventDefault()` ＋ `stopPropagation()` 之后**不调用**外部传进来的那个），
              挂上去会**静默失效**：菜单照开，作用对象永远是「没有」。挂在内层：冒泡时我们先跑，
              它再接着开菜单。 */}
          <div
            data-slot="file-tree-region"
            class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto"
            onContextMenu={记对象}
            onDragOver={拖过}
            onDrop={放开}
          >
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
                        {/* 悬停提示：箭头朝向只说得出「现在开/关着」，说不出点它做什么；文案与 `aria-label` 同源。
                            ⚠️ `TooltipV2` 插的那层 `<div>` 顶替了原先长在按钮上的 `shrink-0`（同工具栏）。
                            文案**随展开态变**（「收起」/「展开」），与 `aria-label` 逐帧同源。 */}
                        <TooltipV2 value={展开(row.node.path) ? "收起" : "展开"} class="flex shrink-0">
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
                        </TooltipV2>
                      </Show>
                      <FileIcon
                        node={{ path: row.node.path, type: row.node.type }}
                        expanded={展开(row.node.path)}
                        class="h-4 w-4 shrink-0"
                      />
                      {/* 改名态就地换掉**名字那一格**（T018）：图钉、箭头、缩进都还在原处，
                          用户看得见自己在改哪一行。图标与箭头不重画——它们与名字是同一行的三个独立格子。 */}
                      <Show
                        when={改名的() === row.node.path}
                        fallback={
                          <span data-slot="file-tree-name" class="min-w-0 truncate">
                            <高亮 name={row.node.name} keyword={词()} />
                          </span>
                        }
                      >
                        <就地改名输入
                          槽位="file-tree-rename-input"
                          可访问名称="条目名称"
                          原名={row.node.name}
                          on提交={(name) => {
                            // 先收编辑态再喊回调——同上面新建那条，理由一样。
                            set改名的(undefined)
                            props.onRename?.(row.node.path, name)
                          }}
                          on取消={() => set改名的(undefined)}
                        />
                      </Show>
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
              onSelect={() => 改名(菜单对象() ?? "")}
            />
            <菜单项
              action="copy"
              文案="复制"
              禁用={要文件(props.onCopy)}
              onSelect={() => props.onCopy?.(菜单对象() ?? "")}
            />
            <菜单项
              action="move"
              文案="移动"
              禁用={要文件(props.onMove)}
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
              onSelect={() => props.onUpload?.(落点(菜单对象()))}
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
    // 「＋」不在这儿：它现在是 `DropdownMenu.Trigger`，开关归 Kobalte 自己管
    // （`menu-trigger` 收到 `pointerdown` 就 `context.toggle(true)`）——再在这儿存一份
    // 「开没开」的信号，就是 `#002-06` 那句「同一个判断在两处各写一份」。
    const path = selected()
    if (!path) return // 没有作用对象就不动作（不猜「大概是指根」）
    if (action === "rename") return 改名(path)
    点删(path)
  }

  /**
   * 删除**永远**先开确认弹窗，绝不直接喊 `onDelete`（FR-006：文件删除 MUST 二次确认）——
   * 工具栏与右键菜单都走这一个函数，所以「不分入口」是结构上成立的，不是靠两处各写一遍留意着。
   *
   * 与 `新建` 同一条约定：作用对象（`path`）在**开弹窗那一刻**就定下、作为 prop 交给弹窗，
   * 回调只回「删或不删」——所以确认的**永远**是弹窗开出来的那一项，用户之后再怎么点行、
   * 选中态怎么变都改不了它（弹窗是模态的，本来也点不到树）。
   */
  function 点删(path: string | undefined) {
    const 交 = props.onDelete
    if (!path || !交) return
    // `void`：`show()` 交回来的是 `startTransition` 那个返回值（不是真 promise，弹窗是**同步**
    // 排进栈、下一拍渲染）。`no-floating-promises` 认的是形状，这里标一下「有意丢弃」（同 `新建`）。
    void dialog.show(() => <FileDeleteDialog path={path} onConfirm={() => 交(path)} />)
  }

  /**
   * 点「新建文件 / 新建文件夹」——**只是把弹窗开出来**，一个请求都不发（T018）。
   *
   * 落点在**这一刻**算好、作为 prop 交给弹窗：之后用户再怎么点行、选中态怎么变，都不影响它
   * （弹窗是模态的，本来也点不到树）。这也是本函数收 `path` 而不读 `selected()` 的原因——
   * 工具栏从选中项取、菜单从右键对象取，规则同一份（同 `落点`）。
   */
  function 新建(kind: "file" | "directory", path: string | undefined) {
    const 交 = props.onCreate
    if (!交) return
    const parent = 落点(path)
    // `void`：`show()` 交回来的是 `startTransition` 那个返回值（不是真 promise，弹窗是**同步**
    // 排进栈、下一拍渲染）。`no-floating-promises` 认的是形状，这里标一下「有意丢弃」。
    void dialog.show(() => (
      <FileCreateDialog kind={kind} parent={parent} onConfirm={(name) => 交({ kind, parent, name })} />
    ))
  }

  /** 点重命名（工具栏 / 菜单）——同样只是把那一行换成输入条。 */
  function 改名(path: string) {
    set改名的(path)
  }

  /**
   * 菜单里**要作用对象**的那七项的共同前置：没接线、或没右键到任何节点，都禁用。
   *
   * 新建两项与上传不适用——它们要的是**落点目录**，没有对象时落点＝根，是合理的
   * （正如工具栏的 ＋）。其余七项对着「根」是说不通的：复制根、删除根都不是一个动作。
   */
  function 要对象(接: ((...名字: string[]) => void) | undefined) {
    return !接 || !菜单对象()
  }

  /**
   * 复制 / 移动要的**不只是**「有对象」，还得是**普通文件**——比上面那条多一个理由。
   *
   * 服务端只搬单文件（`file.ts` 递进来的目录回 400：不做递归是 T020 的范围裁定），
   * 所以对着一个目录画这两项，就是画了一个**点了必然失败**的入口。禁用态是长在**类型**上、
   * 不是长在「有没有接线」上，所以它得单起一个谓词，不能塞进 `要对象`。
   *
   * ⚠️ 其余「要对象」的项**不**跟着走这条：下载/备份/拉回对着目录都是**说得出话**的
   * （目录会被服务端拒掉，界面据此报一句），而复制/移动在界面上会先弹一个「搬到哪儿」的面板
   * ——对着目录弹那个面板本身就是错的。
   */
  function 要文件(接: ((path: string) => void) | undefined) {
    const path = 菜单对象()
    // `节点表` 里只有**清单里真实存在**的路径；表格查不到就当不是文件（不猜）。
    return !接 || !path || 节点表().get(path)?.type !== "file"
  }

  /**
   * 右键时记下**指针底下那一行**。挂在这一层（而不是每行各挂一个）：落在行以外的空白
   * 自然就记成「没有对象」，不必再写一条「清空」的分支。
   */
  function 记对象(event: MouseEvent) {
    set菜单对象(指针行(event))
  }

  /**
   * 指针底下那一行的 `data-path`（不在任何行上 ⇒ `undefined`）。
   *
   * 右键与拖入共用一份：两处问的是**同一个问题**（「指针现在落在哪个节点上」），
   * 而它们真的会各漂一半——右键那处写 `event.target`、拖入那处写成 `currentTarget`，
   * 症状是拖到行上却落到根（`LEARNINGS #002-06`）。
   */
  function 指针行(event: Event) {
    const target = event.target
    if (!(target instanceof Element)) return undefined
    return target.closest<HTMLElement>("[data-slot='file-tree-row']")?.getAttribute("data-path") ?? undefined
  }

  /**
   * 这一次拖拽是不是**从桌面拖文件进来**。
   *
   * 判据只能是 `dataTransfer.types`：跨进程的拖拽里，文件**在 `drop` 之前读不出来**
   * （`dataTransfer.files` 那时是空的，浏览器只在 `drop` 才把它填上）——所以「有没有文件」
   * 这件事在悬停阶段就得从 `types` 里问。
   *
   * 两处 `?.` / `?? []` 是刻意的：happy-dom 里拖拽事件是**裸 `Event`**（没有 `DragEvent`），
   * 产品码在这里多依赖一笔，组件测试就再也进不来了（同 `dual-file-tree.tsx` 的 `起拖`）。
   */
  function 从桌面(event: DragEvent) {
    return props.onDropFiles !== undefined && (event.dataTransfer?.types ?? []).includes("Files")
  }

  /** 悬停：**不 `preventDefault` 就不会触发 `drop`**（HTML5 拖拽的规矩，不是可选的优化）。 */
  function 拖过(event: DragEvent) {
    if (从桌面(event)) event.preventDefault()
  }

  function 放开(event: DragEvent) {
    if (!从桌面(event)) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return
    props.onDropFiles?.(files, 落点(指针行(event)))
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
 * 工具栏那**五颗钮共用的一份外形**（2026-10-11 抽出来）。
 *
 * 抽它只为「＋」那一颗：它得从光秃秃的 `<button>` 变成 `DropdownMenu.Trigger` 的**宿主**
 * （`as={工具钮}`），而五颗钮的 `data-action` / `data-slot` / `aria-label` / 图标 / 禁用态配色
 * **只有一份**——拆成两处写法就是 `#002-06` 那句「同一个判断在两处各写一份，然后各自长」。
 *
 * ⚠️ `{...rest}` 排在**自定义属性之前**，与 `#005-22` 里 `ContextMenuTrigger` 的顺序正好相反，
 * 而且是**必须**的：Kobalte 往触发器上落的 `aria-expanded` / `aria-haspopup` / `onPointerDown`
 * 是**它自己的契约**——盖掉 `onPointerDown` 菜单当场打不开；反过来 `data-slot` 必须我们说了算，
 * 否则它会被 `DropdownMenuTrigger` 写成 `dropdown-menu-trigger`，「⑥ 步那批落点」全查不到。
 *
 * ⚠️ `disabled` 也由这里落（而不是交给 `ButtonRoot`）：`ButtonRoot` 认标签名是在挂载**之后**
 * （`createTagName` 要等 `ref`），它写下的 `disabled` 会晚一拍、在禁用态上是个竞态；
 * 我们自己写死，`禁用("create")` 是什么就是什么。
 */
function 工具钮(props: { action: 工具栏动作; 禁用: boolean; class?: string } & JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["action", "禁用", "class"])
  return (
    <button
      {...rest}
      type="button"
      data-action={local.action}
      data-slot={`file-tree-action-${local.action}`}
      aria-label={标签[local.action]}
      class={local.action === "delete" && !local.禁用 ? TOOL_BUTTON_DANGER : TOOL_BUTTON}
      disabled={local.禁用}
    >
      <Icon name={图标[local.action]} size="small" />
    </button>
  )
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
