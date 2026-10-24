import { createEffect, createMemo, createSignal, For, on, Show, splitProps, type JSX } from "solid-js"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { flattenFileTreeV2, type FileTreeV2Node } from "@/components/file-tree-v2-model"
import { buildProjectFileTreeModel } from "@/project/file-tree-model"
import { FileCreateDialog } from "@/project/file-create-dialog"
import { FileDeleteDialog } from "@/project/file-delete-dialog"
import type { ArchiveKind } from "@/project/archive-name"
import { FileOpError } from "./file-op-error"
import { 就地改名输入 } from "@/components/inline-rename-input"
import { 复制文本 } from "@/utils/copy-text"
import { showToast } from "@/utils/toast"
import { 能落到 } from "./file-tree-dnd"

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
 * 右键菜单的标识——顺序与分组即 `2026-09-11-项目管理-design.md` §6.2 那张表的四行
 * （表里一行＝菜单里一组，组间一个分隔符），**外加本仓自己的两组**（最前的「打开」与最下的
 * `copy-path` / `refresh`，各见其成员注释）。
 *
 * ⚠️ **`copy-path` 与 `refresh` 都不是设计表那十项里的**：
 *
 * - `copy-path`（2026-10-11 用户提出）＝「把这一行的**路径**放进剪贴板」，给用户贴到右栏会话框里
 *   指路用。设计表里的 `copy` 说的是「把文件复制到另一个目录」——两者都叫「复制」，但**宾语不同**
 *   （一个复制**文件**、一个复制**那串字**）。
 * - `refresh`（2026-10-10 用户提出）＝「重取一次文件清单」。AI 在沙箱里建/删了文件之后界面今天
 *   不会自己变——重取的闸门只由**我们自己的**文件动作拨（见 `workspace-entry.tsx` 的 `清单重取`）。
 *
 * ⚠️ **这两项自成一组、落在菜单最下**（2026-10-10 用户裁定）：它们的共同点是**不改动任何东西**
 * ——`copy-path` 只往剪贴板写、`refresh` 只重新取一遍；上面四组的九项**都会写盘或写云**。
 * `copy-path` 原先紧跟 `copy`（当时的理由是「两个『复制』排一起才好分辨」），现在挪下来是因为
 * 分组轴换成了一条更说得通的：**改东西的在上、看一眼的在下**。那个「好分辨」的顾虑由它自己的
 * 名字兜着——它叫「文件路径」，不叫「复制路径」。
 */
export type FileTreeMenuItem =
  /**
   * 2026-10-12 追加的**第一组第一项**：打开（把这一行交给中栏）。
   *
   * 为什么自成一组、且压在菜单最上：它是 Windows 资源管理器、macOS 访达、几乎所有 IDE 里
   * 右键文件时的**第一个动作**——「打开」排第一是跨平台的习惯，不是本仓发明的次序。它与
   * 末尾第六组的 `copy-path` / `refresh` 一样**不写盘、不写云**（同属「看一眼」那一档），
   * 差别只在它最常用、故由它领头、压到菜单最上。
   */
  | "open"
  | "create-file"
  | "create-dir"
  | "rename"
  | "copy"
  | "move"
  | "delete"
  | "upload"
  | "upload-folder"
  | "download"
  | "backup"
  | "restore"
  | "copy-path"
  | "refresh"

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
/**
 * 搜索框的**尺寸覆盖**（2026-10-11 用户下达：改成设计系统那颗输入框的样式，图 `images/screen/2026-10-10_192210.png`）。
 *
 * 外观（白底 / 圆角 / 放大镜）全部由设计系统 `TextInputV2` 自带，这里只压两处**尺寸**：
 *
 * - `!h-6`：设计系统只有 28px(`base`) / 32px(`large`) 两档，而工具栏那五颗钮是 **24px** ——
 *   用户裁定「保持 24px 与钮齐平」，故用 `!` 覆盖它的高度（这是本组件唯一一处逆着设计系统默认写的地方）。
 * - `!w-full`：组件默认 `width:280px`（给弹窗里单用备的），这里要它**撑满工具栏**——
 *   外面包了一层 `flex-1` 的壳（见工具栏那段），宽度由那层决定。
 *
 * ⚠️ 这两条都是**class 覆盖**，不是在设计系统件上改源码（`CLAUDE.md` 定制化三原则：侵入是「加」不是「改」）。
 */
const SEARCH_INPUT = "!h-6 !w-full"
/**
 * 一行。`min-h-6` 而不是 `h-6`、并允许换行：**重命名失败时那一行要长出一句话**
 * （`FileOpError` 带 `w-full` ⇒ 换到第二行、整行变高）。
 * ⚠️ 对**没有**失败话的行，两者算出来的高度相同：单行内容不足 24px ⇒ `min-h-6` 与 `h-6`
 * 都落到 24px（`#005-07`：happy-dom 量不了 CSS，这条是**推理**，不是实测）。故这不是一次
 * 视觉改动——那 24px 是既有真栈读数（原 `context-menu-dismiss-probe.spec.ts` 注释里的行坐标，
 * 该 spec 已删、读数收在 `docs/superpowers/specs/005-project-management/state.md`）赖以成立的
 * 前提，别拿掉 `min-h-6`。
 */
const ROW = "flex flex-wrap min-h-6 min-w-0 w-full shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"

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
   * 清单**取数**的状态（2026-10-21 用户实报「打开大项目 2.9 秒里一直显示『还没有文件』」）。
   *
   * `paths` 的 `undefined` 今天同时意味着「加载中 / 取不到 / 没项目」三件事，而空态把它们
   * 一律说成「还没有文件」——那 2.9 秒是在**说谎**。接收方知道真相，就由它说：
   *
   * - `"loading"` ⇒ 「正在加载文件…」；
   * - `"failed"` ⇒ 「文件清单加载失败」＋ 重试（`onRetry`）。
   *
   * ⚠️ **有一份旧清单时不遮它**（见下面那个空态 fallback 的渲染优先级）——刷新是「再取一遍」，
   * 不是「把树抹掉」。省略 = 维持原空态（`paths` 省略 / `[]` 都是「还没有文件」）。
   */
  status?: "loading" | "failed"
  /** 取不到时那颗「重试」——只在本组件**没有旧清单**且 `status === "failed"` 时出现。省略 = 不画那颗钮。 */
  onRetry?: () => void
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
  onCreate?: (input: { kind: "file" | "directory"; parent: string; name: string }) =>
    | string
    | undefined
    | Promise<string | undefined>
    | void
  /**
   * 重命名**选中项**（工具栏）／**右键那一项**（菜单），`name` 是**新的单段名**。
   *
   * ⚠️ 同样**不立刻喊**（T018 起）：先把那一行的名字就地换成输入条（见 `改名的`），
   * Enter 才把新名字喊出去。`path` 仍是**旧路径**——服务的责任是拿它反推所在目录（同 `renameEntry`）。
   *
   * 回话约定（与 `ProjectPanel.onCreate` 逐字相同）：**回一句字符串 = 没办成**，那句话落在
   * **被改名的这一行**上；`undefined` / 不回 = 收工。
   *
   * 省略 = 还没接线，按钮与菜单项都禁用。
   */
  onRename?: (path: string, name: string) => string | undefined | Promise<string | undefined> | void
  /** 删除**选中项**（工具栏）／**右键那一项**（菜单）。省略 = 还没接线，按钮与菜单项都禁用。回话约定同 `onCreate`。 */
  onDelete?: (path: string) => string | undefined | Promise<string | undefined> | void

  /**
   * 设计 §6.2 第二～四组的那六个动作。**除上传外**一律收「被右键那个节点」的路径。
   *
   * 六个**各自独立**接线：菜单里一项一项地亮（备份／拉回归 T011/T012；其余四项由 T020 接上），
   * 不是「全接上才一起亮」。省略 = 该项禁用。
   *
   * ⚠️ `onCopy` 多一条**类型**上的禁用理由（见 `要文件`）：服务端复制只认单文件，菜单里这一项
   * 因此**只画在文件行上**。`onMove` **没有**这条——服务端移动认文件也认目录（2026-10-11），
   * 整棵搬走是 `rename` 的天然语义。其余三项也没这条：`onDownload` / `onBackup` / `onRestore`
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
  /**
   * 上传**整个文件夹**（2026-10-24 用户下达：右键上传只能选文件）。
   *
   * `dir` 的规则与 `onUpload` **逐字相同**（右键目录 ⇒ 它自己、右键文件 ⇒ 它所在的目录、
   * 空白 ⇒ 根）：两条入口问的都是「往哪儿放」，落点规则只能有一份（`LEARNINGS #002-06`）。
   *
   * 本组件只交出落点——文件夹里有什么、要建哪些子目录、每个文件发几次请求，都是接收方的事。
   * 省略 ＝ 该项禁用（同其余各项「未接线即置灰」的口径）。
   */
  onUploadFolder?: (dir: string) => void
  onDownload?: (path: string) => void
  /**
   * 打包下载（2026-10-20）：交出去的是**选中集**，不是单个路径。
   *
   * `kind` 由本层判（它手里有 `节点表`）：`folder` ＝ 右键的就是一个文件夹；`selection` ＝ 右键的
   * 是选中集里的一行、且选中集大于 1。接收方只负责算名字与发请求。
   */
  onArchive?: (paths: readonly string[], kind: ArchiveKind) => void
  onBackup?: (path: string) => void
  onRestore?: (path: string) => void

  /**
   * 打开一个**文件**（2026-10-12 用户下达）：把它交给中栏（新开一张 tab，或切到已开的那张）。
   *
   * ⚠️ **单击仍然是「选中」**（用户 2026-10-12 裁定）：单击在本组件里有既成含义（选中那一行，
   * 供工具栏与右键菜单用），把「打开」压上去会让「想选中」变成「总是打开」。两个入口是
   * **右键菜单第一项**与**文件行双击**。
   *
   * 本组件**不知道**中栏、更不知道「打开」之后发生什么（大小闸门、弹窗都在中栏那一侧）
   * ——同「六个动作一律走 props」的口径：未接线即置灰。
   */
  onOpen?: (path: string) => void

  /**
   * 刷新文件清单（本仓加的，2026-10-10 用户下达）——重取一遍「这个项目里有哪些文件」。
   *
   * ⚠️ **它不写任何东西**，只让接收方再取一次清单：AI 在沙箱里建/删了文件之后，界面今天
   * 不会自己变（重取的闸门只由**我们自己的**文件动作拨，见 `workspace-entry.tsx` 的 `清单重取`）。
   *
   * ⚠️ **禁用判据只有 `!props.onRefresh`**——刻意**不**并 `要对象`：这一项右键**空白处**也
   * 该亮、也该点得动（它作用于**整份清单**，不针对某一行）。菜单里其余十一项都要作用对象，
   * 只有它是全局的。
   *
   * ⚠️ 重取的是**清单**（有哪些文件），**不是文件内容**——AI 改了某文件的**内容**而它正开在
   * 中栏，刷新看不到（那是 `file-content` 另一条链）。这条边界见 `docs/` 里的缺口表。
   *
   * 省略 ＝ 该项禁用（同其余各项「未接线即置灰」的口径）。
   */
  onRefresh?: () => void

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
   * 同树批量移动（2026-10-15 用户下达）：把这一批路径搬进那个目录。收参数而不是收单个路径，
   * 因为拖拽一次可能带上好几行；`目录` 用的是 `落点` 那套规则（目录 ⇒ 它自己、文件 ⇒ 它所在
   * 的目录、空白 ⇒ 项目根 `""`）——与 `onUpload` / `onDropFiles` **同一套语言**。
   *
   * 本组件只交出「哪一批、往哪儿」，请求怎么发、失败怎么报都是**接收方**的事
   * （同「六个动作一律走 props」的口径）。省略 ＝ 同树拖拽不接管（浏览器给禁止光标）。
   *
   * ⚠️ 它经 `DualFileTreeProps extends FileTreeProps` ＋ `{...rest}` 自动流到上树，
   * `dual-file-tree.tsx` 一行不用改。
   */
  onMoveTo?: (路径们: readonly string[], 目录: string) => void

  /**
   * 行是否可拖（设计 §6.3 拖拽 B「沙箱 ↔ MinIO」里**上树**那一侧；2026-10-13 起兼作「拖路径引用」）。
   *
   * **文件与目录行都会被标上** `draggable`（2026-10-13 用户裁定：从文件 tab 把行拖到右栏会话框、
   * 自动填路径——拖目录是拖「文件夹路径的引用」，与「整目录备份」是两回事，别混）。
   *
   * 本组件**只**负责「让行可拖」；拖起来之后往哪儿去、放到谁身上，由**容器**
   * （`dual-file-tree.tsx`）在自己那层做事件委托——树不必知道「MinIO」这种东西存在
   * （同「六个动作一律走 props」的口径）。payload 形状由容器定（`file:<相对路径>`）。
   *
   * 省略 ＝ 不可拖。`DualFileTree` 现在给**上树**恒传 `true`（行可拖与「备份有没有接线」**无关**：
   * 拖出去的是引用，不是备份）；下树（MinIO）仍只文件可拖、且按「有没有接 `onRestore`」开关。
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
 * 设计表那十项里**八项接得上**：新建两项走 `onCreate`、重命名/删除走 T007 就有的回调、
 * 复制 / 移动 / 上传走 T020 的回调；下载 2026-10-20 起按目标分两路（单文件 `onDownload`、
 * 文件夹 / 多选 `onArchive`）。**只剩备份 / 拉回**没有接收方（T011/T012），
 * 按「未接线即禁用」置灰。菜单先把**入口与形状**做齐，接线只补 props，不改菜单结构——
 * T020 正是这样接的。本仓自己那三项里：`open` 走 `onOpen`（把这一行交给中栏，见它的 doc）、
 * `copy-path` **不出组件**（往剪贴板写，本组件内自己办）、
 * `refresh` 走 `onRefresh`（谁接谁负责重取，见它的 doc）。
 *
 * ⚠️ **复制**多了一条类型上的禁用理由（`要文件`）：服务端复制只认单文件，对目录弹「搬到哪儿」
 * 的面板本身就是错的。这是本文件里唯一一处「接上了线、菜单项却仍可能灰着」的地方，故没有沿用
 * T008 那句「接线即点亮」。
 *
 * ⚠️ **2026-10-11 起移动不再跟着灰**：服务端放开目录之后，「移动」与「复制」在**目录行上**
 * 分了家（移动亮、复制灰）。两项**刻意不对称**，直到复制也支持目录为止——钉这条分家的用例在
 * `file-tree.test.tsx` 的「复制只画在文件行上，移动文件与目录都画」那一组。
 */
export function FileTree(props: FileTreeProps) {
  /**
   * 弹窗宿主（`app.tsx` 那层 `DialogProvider`）——新建走它。没有 Provider 时它会**抛错**
   * （`context/dialog.tsx` 刻意如此，不是静默 `undefined`）：那条链要断就当场断。
   */
  const dialog = useDialog()
  const [keyword, setKeyword] = createSignal("")
  /**
   * 展开态**存正向**（展开集合）：**默认全收缩**，空集合即默认（用户第 5 条，2026-10-11）。
   *
   * 改之前存的是**反向**（`collapsed`，空集合 ＝ 全展开，镜像上游静态树的缺省）。用户原话：
   * 「开始进入文件 Tab 页面时，默认全部收缩」——深层目录一进来就全摊开，一屏只放得下几条，
   * 而绝大多数时候用户要的是顶层的轮廓。所以默认值反过来，`展开` 的判据也跟着翻面。
   */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = createSignal<string>()
  /**
   * 多选集（2026-10-15 用户下达：同级多选后拖到目标文件夹＝批量移动）。
   *
   * ## 为什么不复用 `selected`
   *
   * `selected` 是**焦点行**，它今天有 7 个消费者（新建的 parent、工具栏禁用、Enter 打开…），
   * 改它的语义会连带改那七处。这里**只加不减**：焦点行语义一字不动，多选集另养一只，
   * 单击路径下两者恰好同值（`选中集 === {焦点行}`）⇒ 表现与今日**逐字相同**。
   *
   * ## 为什么存 `ReadonlySet`
   *
   * 「在不在里面」是唯一的问法（渲染高亮、起拖时判「这一行在不在批里」），
   * 顺序由**可见行序**（`行列表()`）现算——集合本身不该记住一个会随折叠漂的顺序。
   */
  const [选中集, set选中集] = createSignal<ReadonlySet<string>>(new Set())
  /**
   * 连选的锚点（`Shift` 那一支的起点）。**单击与 Ctrl 点都不动它**——这是标准选择模型的规矩：
   * 锚点只在「重新开始一段连选」时才换。
   */
  const [锚点, set锚点] = createSignal<string>()
  /**
   * 正在被同树拖走的那一批路径（`undefined` = 没在拖）。只在 `dragstart` 立、`dragend`/有效落点
   * 清——悬停阶段它**不变**，`拖过` 全靠它判「这是不是一次同树拖」。
   *
   * ⚠️ 别在 `dragstart` 里直接把它设成 `选中集`：一次拖拽可能带的是**没进选中集的一行**，
   * `起拖` 会先 `单选` 把它补进去——所以这里的值是「拖那**一刻**的可见选中批」，不是一条活引用。
   */
  const [拖源, set拖源] = createSignal<readonly string[]>()
  /**
   * 悬停中、**本行可以被这一批落下**的那一行的路径（`undefined` = 悬停在行外空白＝项目根）。
   * 落点判据见 `能落到`，这里只记「判过了、可以」的那一行。
   */
  const [悬停行, set悬停行] = createSignal<string>()
  /**
   * 悬停是否落在**行以外的空白**（＝项目根）。与 `悬停行` 互补：`undefined` 只表示「没悬在行上」，
   * 而「悬在空白且合法」与「悬在空白但这次拖不合法」都要单独区分，所以得有一只布尔。
   */
  const [悬停根, set悬停根] = createSignal(false)
  /**
   * 「正在改名的那一行」的**旧路径**——非空即那一行的名字就地换成了输入条（T018）。
   *
   * 存**旧路径**而不是新名字：改名的唯一判据是「用户敲完之后的名字与原样不同吗」，那是
   * `就地改名输入` 的 `改名草稿` 说了算的（一份实现，见那个文件）；本组件只负责记住**改的是哪一行**，
   * 好把 `onRename(旧路径, 新名字)` 的两样凑齐。存新名字的中间态则要在本文件里再写一遍草稿判据。
   */
  const [改名的, set改名的] = createSignal<string>()
  /**
   * 「上一次重命名没办成」的那句话 ＋ 它属于**哪一行**（按**旧路径**记）。
   *
   * ## 为什么存**路径**而不是「当前那一行」
   *
   * 渲染时只在**当前仍存在**的那一行上画 —— 行没了，话自然不画，**不需要**在卸载时去清
   * （少一处遗漏的机会）。显式清掉只发生在两处：① 该行**开始下一次改名**（见 `改名`）；
   * ② **清单重取**（`props.paths` 换了新数据，见下面那个 `createEffect`）。两处都在本文件里，不跨层。
   */
  const [行话, set行话] = createSignal<{ 路径: string; 话: string }>()
  // 清单换了新数据 ⇒ 上一轮那句话过期（树上的真相永远是重取那一份）。
  // `defer: true`：挂载那一次不算「换了新数据」。
  createEffect(on(() => props.paths, () => set行话(undefined), { defer: true }))
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
  /** 路径 → 节点：给「选中项是目录还是文件」这一问（落点要用）与「全部展开」那一档（要按 `type` 筛出目录）。 */
  const 节点表 = createMemo(() => {
    const map = new Map<string, FileTreeV2Node>()
    for (const list of 全模型().children.values()) for (const node of list) map.set(node.path, node)
    return map
  })

  /** 右键的这行是不是「多选里的那一行」——判目标与菜单文案共用这一份判据（`#002-06`）。 */
  const 是选中集 = (path: string) => {
    const 批 = 选中集()
    return 批.size > 1 && 批.has(path)
  }

  /**
   * 「点下载」这一次到底作用于什么。
   *
   * 规则（设计 §4.1 / §7.1）：
   * - 右键的行**在选中集里**且选中集 > 1 ⇒ 整个选中集（`selection`）；
   * - 否则只看右键这一行：文件 ⇒ `file`（走原单文件下载）；文件夹 ⇒ `folder`。
   *
   * ⚠️ 判据是「右键行在不在选中集里」，不是「选中集大小」：选中两项后右键第三行，
   * 用户要的是**第三行**，不是那两项（`#006-31` 同族：别拿另一份状态替换这一次的对象）。
   */
  const 判下载目标 = (
    path: string,
  ):
    | { kind: "file"; path: string }
    | { kind: "folder"; paths: readonly string[] }
    | { kind: "selection"; paths: readonly string[] } => {
    if (是选中集(path)) return { kind: "selection", paths: [...选中集()] }
    if (节点表().get(path)?.type === "file") return { kind: "file", path }
    return { kind: "folder", paths: [path] }
  }

  /** 菜单文案：只有「右键行在选中集里且多选」时才带 N。 */
  const 下载文案 = () => {
    const path = 菜单对象()
    return path !== undefined && 是选中集(path) ? `下载选中的 ${选中集().size} 项` : "下载"
  }

  /** 菜单禁用：单文件看 `onDownload`，其余看 `onArchive`。 */
  function 要下载() {
    const path = 菜单对象()
    if (!path) return true
    if (判下载目标(path).kind === "file") return !props.onDownload
    return !props.onArchive
  }

  const 展开 = (path: string) => expanded().has(path)
  const 切换 = (path: string) => {
    const next = new Set(expanded())
    if (!next.delete(path)) next.add(path)
    setExpanded(next)
  }

  /**
   * 把某条路径**连同它上面每一层**打开——新建成功那一刻用（用户第 5 条的配套）。
   *
   * 默认全收缩之后，「在深层目录里新建」会「建完看不见」：落点那一支本来收着。所以提交那一刻
   * 只把**落点这一条链**打开——**只加不减**，别的目录保持原样（「开得刚好够看见」，
   * 不是一个「重置展开态」的动作）。
   *
   * `path` 用的是 `落点()` 交出来的那个串，与 `节点表()` 里的是同一套写法（`/` 分隔、无前后斜杠，
   * 由 `normalizeFileTreeV2Path` 归一化）——不在这里另立一套切分规则（`LEARNINGS #006-23`）。
   */
  function 展开链(path: string) {
    if (!path) return
    const 下一份 = new Set(expanded())
    let 段 = ""
    for (const 片 of path.split("/")) {
      段 = 段 ? `${段}/${片}` : 片
      下一份.add(段)
    }
    setExpanded(下一份)
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

  /**
   * 单选：焦点行、选中集、锚点三样一起落到它身上。
   *
   * 单击与键盘回车/空格**共用这一份**——同一个动作不许两处各写一份（`LEARNINGS #002-06`）。
   */
  const 单选 = (path: string) => {
    setSelected(path)
    set选中集(new Set([path]))
    set锚点(path)
  }

  /** Ctrl/⌘ 加选与取消：只拨这一行的成员资格。焦点行跟着走，**锚点不动**。 */
  const 拨一位 = (path: string) => {
    const 下一份 = new Set(选中集())
    if (!下一份.delete(path)) 下一份.add(path)
    set选中集(下一份)
  }

  /**
   * `Shift` 连选：锚点到它之间**可见的**行（含两端）。
   *
   * 范围按 `行列表()` 取——**折叠着的子孙不在里面**，正是用户眼睛看到的那一段。
   * 没有锚点时拿焦点行当锚点（并把它**升成**锚点，好让第二次 Shift 还连得上）；连焦点行也没有
   * （刚挂载就被 Shift 点）就退化成单选。
   */
  const 连选到 = (path: string) => {
    const 序 = 行列表().map((row) => row.node.path)
    const 起 = 锚点() ?? selected()
    const 头 = 起 === undefined ? -1 : 序.indexOf(起)
    const 尾 = 序.indexOf(path)
    if (头 === -1 || 尾 === -1) {
      单选(path)
      return
    }
    const [低, 高] = 头 <= 尾 ? [头, 尾] : [尾, 头]
    set选中集(new Set(序.slice(低, 高 + 1)))
    set锚点(起)
  }

  /** 行被点了一下：按修饰键分流。三种手势都先把焦点行落到它身上。 */
  const 点行 = (path: string, event: MouseEvent) => {
    if (event.shiftKey) {
      连选到(path) // F4（最终评审 #4）：先连选、再落焦点行——顺序不能反：`连选到` 的兜底是
      setSelected(path) // `锚点() ?? selected()`，先 `setSelected` 会把兜底读到的那一行换成刚 Shift
      return // 点的这行 ⇒ 头 === 尾 ⇒ 结果恒 {该行}；先连选才读得到「上一个焦点行」当锚点。
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected(path)
      拨一位(path)
      return
    }
    单选(path)
  }

  /**
   * 点在**行以外**的空白上：清空选中集与锚点，焦点行**不动**。
   *
   * 判据用 `指针行`（与右键共用那一份，`LEARNINGS #002-06`）而不是「点到谁身上」：行上的点击
   * 会冒泡到这一层，靠 `指针行` 才分得开「点在行上」与「点在行之间的空白」。
   */
  const 点空白 = (event: MouseEvent) => {
    if (指针行(event) !== undefined) return
    set选中集(new Set<string>())
    set锚点(undefined)
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
        {/* 搜索框（2026-10-11 用户下达：换成设计系统 `TextInputV2` 的样式）。
            ⚠️ `data-action` / `data-slot` / `aria-label` / `value` / `onInput` 都**透传到内部那个真
            `<input>`** 上——`TextInputV2` 只 `splitProps` 掉它自己那几个 prop，其余原样 spread 给 input
            （同 `⑦-7` 记的 `ButtonV2` 那条 `{...rest}`）。所以「必须是个真 INPUT」「按 data-action 取」
            这些既有钩子**一个字都不用改**。
            ⚠️ `class` 走的是**外壳**（在 `splitProps` 的 local 名单里）——`SEARCH_INPUT` 压的是外壳的尺寸。
            ⚠️ 外面包一层 `flex-1` 的壳：设计系统件的根是 `flex:none; width:280px`（给弹窗单用备的），
            要它撑满工具栏得由这层决定宽度。
            ⚠️ `data-slot='file-tree-search'` 挂在**这层壳**上、**不**透传给 input：`TextInputV2` 在
            `{...inputProps}` **之后**写死自己的 `data-slot="text-input-v2-input"`，传下去会被覆盖掉
            （`LEARNINGS #005-22` 那条 `data-slot` 被 `{...rest}` 盖住的老账）——实测过：传下去之后
            `槽(host,"file-tree-search")` 读成 `null`，`左键点工具栏搜索框` 那条用例当场红。
            `data-action` **不受影响**（宿主只写死 `data-slot` 这一个），故它留在真 input 上。 */}
        <div data-slot="file-tree-search" class="flex min-w-0 flex-1">
          <TextInputV2
            data-action="search"
            aria-label="搜索文件"
            placeholder="搜索文件"
            class={SEARCH_INPUT}
            leadingIcon={<IconV2 name="magnifying-glass" size="small" />}
            value={keyword()}
            onInput={(event) => setKeyword(event.currentTarget.value)}
          />
        </div>
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
          {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- `点空白` 是真动作（点行之间的空白清空选中集与锚点），不是观察；它的键盘等价物属于整个「键盘多选」（Ctrl 连选 / Shift 连选 / 键盘清空）那一件事，而本 feature 明确**不做**键盘多选（spec 已登记为本轮之外）；给这个 div 补一个空 `onKeyDown` 只是哄门、不是补能力。按本仓 `oxlint-disable-next-line -- 理由` 的惯例据实标注。 */}
          <div
            data-slot="file-tree-region"
            class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto"
            data-drop-target={悬停根() ? "true" : undefined}
            onContextMenu={记对象}
            onClick={点空白}
            onDragStart={起拖}
            onDragEnd={拖完}
            onDragOver={拖过}
            onDrop={放开}
          >
            <Show
              when={行列表().length > 0}
              fallback={
                // 优先级：**旧清单 > 加载中 > 取不到 > 确实空**。
                // 前两条都要「有旧清单就不遮」——刷新失败 / 刷新中把整棵树抹成一句话，
                // 等于每点一次刷新就丢一次视野（见 `FileTreeProps.status`）。
                props.status === "loading" ? (
                  <div data-slot="file-tree-loading" class="px-1 py-2 text-[13px] text-v2-text-text-faint">
                    正在加载文件…
                  </div>
                ) : props.status === "failed" ? (
                  <div class="flex items-center gap-2 px-1 py-2">
                    <div data-slot="file-tree-failed" class="text-[13px] text-v2-text-text-faint">
                      文件清单加载失败
                    </div>
                    <Show when={props.onRetry}>
                      <button
                        data-slot="file-tree-retry"
                        type="button"
                        class="h-6 shrink-0 rounded-[4px] px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                        onClick={() => props.onRetry?.()}
                      >
                        重试
                      </button>
                    </Show>
                  </div>
                ) : (
                  <div data-slot="file-tree-empty" class="px-1 py-2 text-[13px] text-v2-text-text-faint">
                    {词() ? EMPTY_SEARCH : EMPTY_TREE}
                  </div>
                )
              }
            >
              <div
                data-slot="file-tree-body"
                role="tree"
                aria-multiselectable="true"
                class="flex w-full min-w-0 flex-col"
              >
                <For each={行列表()}>
                  {(row) => (
                    <div
                      data-slot="file-tree-row"
                      data-path={row.node.path}
                      data-type={row.node.type}
                      data-level={row.level}
                      data-selected={选中集().has(row.node.path) ? "true" : undefined}
                      data-drop-target={悬停行() === row.node.path ? "true" : undefined}
                      // ARIA 那份要**恒有值**（`"false"` 是有效值），与 `data-selected` 同源不同形
                      aria-selected={选中集().has(row.node.path) ? "true" : "false"}
                      // 展开态走 `aria-expanded`，不只靠箭头朝向（DESIGN §4.3：不单以图形传意）
                      aria-expanded={
                        row.node.type === "directory" ? (展开(row.node.path) ? "true" : "false") : undefined
                      }
                      role="treeitem"
                      // 可聚焦 + `onKeyDown`：鼠标不是唯一的路（`click-events-have-key-events` 要的正是这两样）。
                      // 每一行都可 Tab 到，而不是 roving tabindex——后者若不补齐 ↑↓ 区间导航，键盘用户反而
                      // 出不了这一行，比「多几个 Tab 停靠点」更糟。
                      tabindex="0"
                      // 行可拖 ＝ 由容器的 `draggable` 开关说了算（见那条注释）。**文件与目录都可拖**
                      // （2026-10-13 用户裁定：目录也要拖出去当「文件夹路径的引用」）。拖起来往哪儿去、
                      // 放到谁身上，仍由**容器**判；这里只交出「这一行可以拖」这一个事实。
                      draggable={props.draggable === true}
                      style={{ "padding-left": `${row.level * INDENT_STEP}px` }}
                      classList={{ [ROW]: true, [ROW_SELECTED]: 选中集().has(row.node.path) }}
                      onClick={(event) => 点行(row.node.path, event)}
                      onKeyDown={(event) => 按键(event, row.node.path, row.node.type)}
                      onDblClick={() => 双击(row.node.path, row.node.type)}
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
                      {/* ⚠️ 名字那格上的 `flex-1` 不能省（2026-10-17 用户实报）：行的 `flex-wrap` 是给
                          `FileOpError` 占整行用的，而名字是 `nowrap` 的、`auto` basis 让它的假设尺寸
                          等于整串文字的宽度 ⇒ 长名会**被换到第二行**（图标与名字上下分家，行高 24→44px）。
                          `flex-1`（basis 0）让它先按「可压缩」参与第一行的排布，再用 `truncate` 收成
                          省略号。`min-w-0` 仍然要——basis 0 也要能缩到 0。 */}
                      <Show
                        when={改名的() === row.node.path}
                        fallback={
                          <span data-slot="file-tree-name" class="min-w-0 flex-1 truncate">
                            <高亮 name={row.node.name} keyword={词()} />
                          </span>
                        }
                      >
                        <就地改名输入
                          槽位="file-tree-rename-input"
                          可访问名称="条目名称"
                          原名={row.node.name}
                          on提交={async (name) => {
                            // 先收编辑态再喊回调——同上面新建那条，理由一样（`inline-rename-input.tsx`
                            // 「一次编辑只结一次账」那条真栈实测出来的守卫不放开）。
                            set改名的(undefined)
                            const 回话 = await props.onRename?.(row.node.path, name)
                            if (typeof 回话 === "string") set行话({ 路径: row.node.path, 话: 回话 })
                          }}
                          on取消={() => set改名的(undefined)}
                        />
                      </Show>
                      {/* 重命名失败的话落在**这一行**上（spec §3：失败回到发起它的那个面）。
                          ⚠️ 它是行的**子节点**（不是行的兄弟）——行的 `role="treeitem"` 里允许任意内容，
                          摆在 `role="tree"` 下当一个无角色的 `<div>` 则是无效的 ARIA 结构。
                          占一整行靠的是 `FileOpError` 根自己那条 `w-full`（`file-op-error.tsx:53`），
                          别在外面再包一层——见 `ROW` 的 `flex-wrap`。 */}
                      <Show when={行话()?.路径 === row.node.path}>
                        <FileOpError 话={行话()?.话 ?? ""} />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </ContextMenu.Trigger>

        {/* 设计 §6.2 的那张表——十项、四组、组间一个分隔符（顺序即表里的行序），
            最前接「打开」（2026-10-12 加的**第一组**），末尾再接本仓自己的一组两项
            （`copy-path` / `refresh`）——共六组十三项。 */}
        <ContextMenu.Portal>
          {/* ⚠️ `excludedElements={[]}` **不是可选的**（用户第 4 条：左键点菜单以外的地方要收掉）。
              Kobalte 的 `DismissableLayer` 默认把**触发器**排除在「外面」之外
              （`chunk/LEK3K6R3.jsx:700`：`excludedElements={[context.triggerRef]}`）——而这里的
              触发器是**整片树区域**（盒子与 `file-tree-region` 逐字相同，真栈实测
              `{69,145,262,696}`，`context-menu-dismiss-probe.spec.ts` 读数落 `state.md` ⑦-④）
              ⇒ 在树里任何地方左键都**不算点外面**，只有点到树栏之外才关（实测：工具栏搜索框
              `(135,129)` 关、树内另一行 `(200,829)` 不关）。
              传空数组把这份豁免撤掉：菜单项之外一律算外面。（该属性没写进 Kobalte 的
              `MenuContentBaseOptions`，但它落在 `{...others}` 里、由本仓 `packages/ui` 的包装层
              透传，`bun run typecheck` 实测通过；`LEARNINGS #005-22` 讲的 `data-slot` 被覆盖
              是同一处 `{...rest}` 顺序的另一面。） */}
          <ContextMenu.Content excludedElements={[]}>
            {/* 第一组（2026-10-12）：看一眼。它与末尾第六组的 copy-path / refresh 同为
                「不写盘、不写云」的一项，只是最常用、故压到菜单最上。 */}
            <菜单项
              action="open"
              文案="打开"
              禁用={要文件(props.onOpen)}
              onSelect={() => props.onOpen?.(菜单对象() ?? "")}
            />
            <ContextMenu.Separator />
            {/* 第二组：同工具栏「＋」 */}
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
            {/* 第三组：完整文件操作 */}
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
            {/* 第四组：沙箱 ↔ 本地电脑（§6.3 拖拽 A 的替代入口） */}
            <菜单项
              action="upload"
              文案="上传"
              禁用={!props.onUpload}
              onSelect={() => props.onUpload?.(落点(菜单对象()))}
            />
            {/* 2026-10-24：右键上传只能选文件，不能选文件夹（用户实报）。落点规则与上面逐字相同。 */}
            <菜单项
              action="upload-folder"
              文案="上传文件夹"
              禁用={!props.onUploadFolder}
              onSelect={() => props.onUploadFolder?.(落点(菜单对象()))}
            />
            <菜单项
              action="download"
              文案={下载文案()}
              禁用={要下载()}
              onSelect={() => 点下载(菜单对象())}
            />
            <ContextMenu.Separator />
            {/* 第五组：沙箱 ↔ MinIO（§6.3 拖拽 B 的替代入口） */}
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
            <ContextMenu.Separator />
            {/* 第六组（本仓自己的一组，2026-10-10）：**不改动任何东西**的两项。
                上面四组九项都会写盘或写云；这两项一个只往剪贴板写、一个只重新取一遍。
                因这个共同点另起一组、落在菜单**最下**（用户裁定）。

                组内次序：`copy-path` 在前（它仍要一个作用对象——右键的那一行）、
                `refresh` 在后。这样上面九项「要作用对象」的行内动作连成一片，
                唯一作用于**整份清单**的 `refresh` 压在绝对最下。 */}
            {/* 「文件路径」：把这一行的**项目内相对路径**放进剪贴板。
                ⚠️ 它与上面 `复制` 的区别只在**宾语**：`复制` 复制的是**文件**（复制到别处去），
                这一项复制的是**路径这串字**（贴给右栏的 AI 会话框指路）。
                ⚠️ 判据是 `!菜单对象()`，**不是** `要文件(...)`：目录**也有**路径、也要抄
                （目录的路径补尾斜杠），而 `要文件` 会把目录判成禁用——那正是本项最常用的场合之一。 */}
            <菜单项
              action="copy-path"
              文案="文件路径"
              禁用={!菜单对象()}
              onSelect={() => 复制路径(菜单对象() ?? "")}
            />
            {/* 「刷新」：重取一遍清单（AI 建/删了文件之后界面不会自己变）。
                ⚠️ 禁用判据**只有** `!props.onRefresh`——**不并** `要对象`：右键空白处也该亮、
                也该点得动（它作用于整份清单，不针对某一行；见 props 的 doc）。 */}
            <菜单项
              action="refresh"
              文案="刷新"
              禁用={!props.onRefresh}
              onSelect={() => props.onRefresh?.()}
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
    if (action === "collapse-all") return setExpanded(new Set<string>())
    // 只放**目录**：把文件路径塞进展开集合是死数据（文件行不读 `展开`），
    // 而「展开所有目录」这句话按字面就该只有目录（`#002-06`：一句话只留一个说法）。
    if (action === "expand-all")
      return setExpanded(
        new Set([...节点表().values()].filter((node) => node.type === "directory").map((node) => node.path)),
      )
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
   * 点「下载」——**先判目标，再决定喊谁**（2026-10-20）。
   *
   * 单文件仍走 `onDownload`（行为逐字不变）；文件夹与多选走 `onArchive`。
   * 类型判断只在本层做得了：`节点表` 长在这里，而接线那头只有一份扁平清单。
   *
   * ⚠️ 未接线时菜单项已被 `要下载` 置灰；这里再判一次是兜底，不让「点了没反应」变成静默空转。
   */
  function 点下载(path: string | undefined) {
    if (!path) return
    const 目标 = 判下载目标(path)
    if (目标.kind === "file") {
      props.onDownload?.(目标.path)
      return
    }
    props.onArchive?.(目标.paths, 目标.kind)
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
      <FileCreateDialog
        kind={kind}
        parent={parent}
        onConfirm={(name) => {
          // 默认全收缩（用户第 5 条）之下，不打开落点这一条链，用户建完就**看不见自己刚建的东西**
          // ——所以提交那一刻先开链，再喊回调。
          // ⚠️ 时机仍是「用户提交了」，不是「服务端回了成功」：这条取舍的代价只是「失败时多展开了
          // 几个目录」。
          展开链(parent)
          // 把回话**原样**交回弹窗（`string` = 没办成 ⇒ 弹窗不关、就地报）。
          return 交({ kind, parent, name })
        }}
      />
    ))
  }

  /** 点重命名（工具栏 / 菜单）——同样只是把那一行换成输入条。**顺带清掉那一行上旧的失败话**。 */
  function 改名(path: string) {
    set行话(undefined)
    set改名的(path)
  }

  /**
   * 菜单里**要作用对象**的那八项的共同前置：没接线、或没右键到任何节点，都禁用。
   *
   * 新建两项与上传不适用——它们要的是**落点目录**，没有对象时落点＝根，是合理的
   * （正如工具栏的 ＋）。其余八项对着「根」是说不通的：复制根、删除根都不是一个动作。
   */
  function 要对象(接: ((...名字: string[]) => void) | undefined) {
    return !接 || !菜单对象()
  }

  /**
   * **复制**要的**不只是**「有对象」，还得是**普通文件**——比上面那条多一个理由。
   *
   * 服务端复制只认单文件（`file.ts` 递进来的目录回 400：递归复制要另答「深树里有一层是链接
   * 怎么办」，是 T020 之后仍未做的那一轮），所以对着一个目录画这一项，就是画了一个
   * **点了必然失败**的入口。禁用态是长在**类型**上、不是长在「有没有接线」上，
   * 所以它得单起一个谓词，不能塞进 `要对象`。
   *
   * ⚠️ **2026-10-11 起这条只服务复制一项**：移动那侧服务端放开了目录（`rename` 对目录天然是
   * 整棵搬走，用户裁定「支持移动文件夹」），所以「移动」回到 `要对象`。两项**刻意不对称**，
   * 直到复制也支持目录为止（`file-tree.test.tsx` 里那一组就是钉这条分家的线）。
   *
   * ⚠️ 其余「要对象」的项**不**跟着走这条：备份/拉回对着目录是**说得出话**的（目录会被服务端
   * 拒掉，界面据此报一句）；下载 2026-10-20 起由 `要下载` 单独判（单文件看 `onDownload`、
   * 文件夹 / 多选看 `onArchive`，见该函数）；而复制在界面上会先弹一个「搬到哪儿」的面板
   * ——对着目录弹那个面板本身就是错的。
   */
  function 要文件(接: ((path: string) => void) | undefined) {
    const path = 菜单对象()
    // `节点表` 里只有**清单里真实存在**的路径；表格查不到就当不是文件（不猜）。
    return !接 || !path || 节点表().get(path)?.type !== "file"
  }

  /**
   * 双击一个**文件**行 ＝ 打开。
   *
   * 目录双击**什么都不做**：目录已经有单击（选中）与点箭头（开合）两个动作，
   * 再挂一个只会让「双击目录」变成一个语义未定的手势（要展开还是要打开？谁都说得通，
   * 于是谁都猜错一半）。要开合就点箭头、或键盘 ←/→。
   */
  function 双击(path: string, type: "file" | "directory") {
    if (type !== "file") return
    props.onOpen?.(path)
  }

  /**
   * 把某一行的路径放进剪贴板（菜单「文件路径」，第五组两项里的前一项）。
   *
   * 复制的是**项目内相对路径**（`资料/8·17/话单.csv`），因为会话的工作目录就是项目目录
   * （`ai-session/session-actions.ts` 那侧），贴进右栏会话框**直接可用**；绝对路径长、带盘符、
   * 还有空格歧义。**目录补一个尾斜杠**（`资料/8·17/`）——路径自己说清「这是目录」，沿用仓里
   * 已有的记号（上游 `fs.list` 对目录就是这么标的）而不发明第二种写法（`#005-20`）。
   *
   * **成功不吭声、失败才吭声**（2026-10-13 用户裁定）：成功那声提示会**盖住右栏会话框**、且要
   * 手动点掉，而「复制了什么」用户本来就看得见（就是他刚点的那一行）——吭声的收益盖不过遮挡的代价。
   * 失败仍要说：复制**不改变屏幕上任何东西**，不吭声的话「复制成了」与「压根没复制」长得一样。
   * ⚠️ 这翻转了本函数此前「成功 / 失败都要吭一声」的结论（原据 `#005-28`）——那条理由只算了「不说就
   * 分不清」，没算**遮挡**这个真实代价；两者相抵时取用户的实际感受（`#006-32` 同族：去掉的是负担还是
   * 好处，得用户拍板，不能自己写在「代价」里就了事）。
   */
  async function 复制路径(path: string) {
    if (!path) return
    const 是目录 = 节点表().get(path)?.type === "directory"
    const 文本 = 是目录 ? `${path}/` : path
    if (await 复制文本(文本)) return
    showToast({ variant: "error", title: "复制失败", description: 文本 })
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

  /**
   * 擦掉这一拍的高亮。悬停行与悬停根**成对清**（它们互为补集、且都由 `拖过` 一个入口写），
   * 单独清哪一只都会留下一只「幽灵高亮」。
   */
  function 清悬停() {
    set悬停行(undefined)
    set悬停根(false)
  }

  /**
   * `dragstart`：记下这一拖带走的**那一批路径**。
   *
   * 顺序是「先补进选中集、再取批」——`单选(path)` 之后 `选中集().has(path)` 恒真，
   * 于是这一行必定进批；而「选中集里在**可见行**上的全部路径」跟在后面，自然凑成
   * 「这一行 + 其它已选中行」的并集（`行列表()` 只吐可见行，折叠行不跟着走）。
   *
   * 不 `preventDefault`（本组件不需要自定义拖拽图像），也**不** `stopPropagation`
   * （`DualFileTree` 的跨树拖要监听冒泡上来的 `dragstart`——拦了它那双树就聋了，见 `dual-file-tree.tsx`）。
   */
  function 起拖(event: DragEvent) {
    // F3（最终评审 #3）：注释承诺「省略 onMoveTo ＝ 同树拖拽不接管」就得真不接管。不判它，
    // `draggable` 而无 `onMoveTo` 的树会把合法落点 preventDefault、光标显示可放，松手却什么都不
    // 发生。守卫在 `起拖` ⇒ `拖源` 恒 undefined ⇒ `拖过`/`放开` 自然早退，不给禁止光标以外的反应。
    if (!props.onMoveTo) return
    const path = 指针行(event)
    if (!path) return
    if (!选中集().has(path)) 单选(path)
    set拖源(
      选中集().has(path)
        ? 行列表()
            .map((row) => row.node.path)
            .filter((p) => 选中集().has(p))
        : [path],
    )
  }

  /** `dragend`：清掉拖源与悬停高亮——无论这次拖是有效落下、取消还是拖出窗外，都得擦干净。 */
  function 拖完() {
    set拖源(undefined)
    清悬停()
  }

  /** 悬停：**不 `preventDefault` 就不会触发 `drop`**（HTML5 拖拽的规矩，不是可选的优化）。 */
  function 拖过(event: DragEvent) {
    if (从桌面(event)) {
      event.preventDefault()
      return
    }
    const 源 = 拖源()
    if (!源) return
    const 行 = 指针行(event)
    if (!能落到(源, 落点(行))) {
      清悬停()
      return
    }
    event.preventDefault()
    set悬停行(行)
    set悬停根(行 === undefined)
  }

  function 放开(event: DragEvent) {
    if (从桌面(event)) {
      event.preventDefault()
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      props.onDropFiles?.(files, 落点(指针行(event)))
      return
    }
    const 源 = 拖源()
    if (!源) return
    event.preventDefault()
    const 目标 = 落点(指针行(event))
    set拖源(undefined)
    清悬停()
    if (!能落到(源, 目标)) return
    set选中集(new Set<string>())
    props.onMoveTo?.(源, 目标)
  }

  /** 行上的键盘动作：回车 / 空格＝选中，←/→＝目录开合（与点箭头同一个意思）。 */
  function 按键(event: KeyboardEvent, path: string, type: "file" | "directory") {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault() // 空格默认会滚页面，这不是我们想要的
      单选(path)
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
 * 十三项各写一整块同样的 JSX，分组与顺序就淹没在样板里了。禁用态由调用处各自给：
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
