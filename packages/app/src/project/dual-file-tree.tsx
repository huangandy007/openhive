import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createMemo, createSignal, For, Show, splitProps } from "solid-js"
import { flattenFileTreeV2 } from "@/components/file-tree-v2-model"
import { buildProjectFileTreeModel } from "@/project/file-tree-model"
import { FileTree, type FileTreeProps } from "@/project/file-tree"
import { 格式化字节 } from "@/project/format-bytes"
import type { BackupSnapshot } from "@/project/openhive-backup"

/** 每层缩进（设计 §6.4 的 16px 层级缩进）——**与 `file-tree.tsx` 同值**：两棵树并排出现，缩进不一致会看得出来。 */
const INDENT_STEP = 16

/**
 * MinIO 窗口高度上下限（设计 §5.2「按需调整两树比例」，2026-10-17 起量的是**窗口自身**）。
 *
 * 默认高度不在这里——是**文件区高度的 1/3**（用户 2026-10-17 下达，见 `MinioTree` 的 `style`）：
 * 写成比例而不是常量，窗口跟着左栏高度走，不必在别处再维护一个「默认高度」。
 */
const 最小窗高 = 72

const ROW =
  "flex h-6 min-w-0 w-full shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"

/** 标题行里图标钮的公共尺寸——与 `file-tree.tsx` 的 `TOOL_BUTTON` 同形（同一种钮不该两种高矮）。 */
const 工具钮 =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"

/** 恢复点类型徽标：手动比自动更「重」一点——它是一次用户动作，自动只是后台在跑。 */
function 徽标(kind: BackupSnapshot["kind"]): string {
  return kind === "auto"
    ? "shrink-0 rounded-[10px] border border-v2-border-border-muted px-1.5 text-[10px] text-v2-text-text-faint"
    : "shrink-0 rounded-[10px] border border-v2-border-border-muted px-1.5 text-[10px] text-v2-text-text-base"
}

/**
 * 下树的空态**四句不同**文案——「没有来源」「来源说了没有」「还没选恢复点」「选中的恢复点里没有文件」
 * 是四件事（同 `file-tree.tsx` 两个空态、同 `minio-backups.ts` 的 `undefined` / `[]` 之分）。
 * 第四句很要紧：对着一个**已选中、但本身为空**的恢复点说「选一个恢复点查看文件」是假话。
 */
const EMPTY_NO_SOURCE = "备份清单未接入"
const EMPTY_NONE = "还没有备份"
const EMPTY_PICK = "选一个恢复点查看文件"
const EMPTY_EMPTY = "这个恢复点里没有文件"
const EMPTY_PAUSED = "已超出容量上限，自动备份已暂停"

/**
 * 「什么时候该把用量摆出来」——**只有快满的时候**（2026-10-18 用户裁定，`minio-keep-first-box.html`）。
 *
 * 5.9 MB / 10 GB 是 0.06%，它不是「我正在看什么」的信息；80% 才是「你会不会爆」的决策点。
 * 与窄条的 `minio-bar-paused` 分工不同：那条说「已经暂停了」，这条只说「快满了」。
 */
const 用量告警线 = 0.8

function 该报用量(usage: { usedBytes: number; limitBytes: number } | undefined): boolean {
  return usage !== undefined && usage.limitBytes > 0 && usage.usedBytes / usage.limitBytes >= 用量告警线
}

/** 恢复点的「月-日 时:分」（选择器与列表项共用；同一分钟的两份要看得出先后）。 */
function 时间戳(ms: number): string {
  const d = new Date(ms)
  const 补 = (n: number) => String(n).padStart(2, "0")
  return `${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}`
}

function 类型名(kind: BackupSnapshot["kind"]): string {
  return kind === "auto" ? "自动" : "手动"
}

/**
 * 历史遗留的**局部恢复点**（2026-10-18 起手动备份一律整项目，`scope` 恒为 `""`）。
 *
 * 旧口径按右键 / 拖拽的选中项收窄快照范围 ⇒ 这些恢复点在下树里**只列当时那部分文件**。
 * 不标出来，用户回看时会以为项目丢了文件（2026-10-18 用户实报）。
 */
function 是局部(snapshot: BackupSnapshot | undefined): boolean {
  return snapshot !== undefined && snapshot.scope !== ""
}

/** 「局部」徽标——只挂在历史遗留的恢复点上（新建的恢复点不会出现）。 */
function 局部徽标() {
  return (
    <span
      data-slot="minio-tree-snapshot-partial"
      class="shrink-0 rounded-[10px] border border-v2-border-border-muted px-1.5 text-[10px] text-v2-state-fg-warning"
    >
      局部
    </span>
  )
}

type 哪棵树 = "sandbox" | "minio"

export interface DualFileTreeProps extends Omit<FileTreeProps, "draggable"> {
  /**
   * MinIO 上**当前项目已备份**的对象路径清单（下树的全部行）。相对路径，与沙箱树同一套路径语言
   * （设计 §5.2「镜像沙箱路径结构」）。`undefined` ＝ 还没有来源 ⇒ 下树走「未接入」空态。
   *
   * 今天由 `@/project/minio-backups` 这条缝供数——**缝里还没有写入方**（T011 的 `core/minio`
   * 没有 HTTP 出口），所以现状恒为 `undefined`。真正的出口归 T022。
   */
  backups?: readonly string[]
  /** 双树展开态（设计 §5.1：**默认收起**，按需展开，不常驻）。 */
  open?: boolean
  /** 点下树标题的 ✕（设计 §5.1 步骤 4「回到默认窄条态」）。 */
  onCollapse?: () => void
  /**
   * 拖上树 → 下树 ＝ **备份**（设计 §5.1 步骤 3），也用于右键菜单「备份到 MinIO」。
   * 省略 ＝ 还没接线 ⇒ **跨树那一放不落**（同 T005 三个按钮、T007 菜单六项的一贯口径：
   * 「未接线即禁用」——一个拖了没反应的**动作**同样是谎）。⚠️ 2026-10-13 起，**行可拖**与这条
   * **解耦**：上树的行恒可拖，拖出去的是**路径引用**（拖到右栏会话框自动填），不为「备份接没接」而变。
   *
   * ⚠️ `path` 只说明**用户从哪一项进来**——2026-10-18 用户裁定手动备份**一律整项目**，
   * 接线层（`workspace-entry.tsx` 的 `备份`）不再拿它收窄快照范围。
   */
  onBackup?: (path: string) => void
  /**
   * 右键菜单「从 MinIO 拉回」——**继承自 `FileTree` 的同名 prop**（`file-tree.tsx` 的
   * `onRestore?: (path: string) => void`），签名不能改：上树就是 `FileTree` 本身。
   * 拖拽那条（需要带恢复点）是另一个名字，见 `onRestoreSnapshot`。
   */
  onRestore?: (path: string) => void
  /**
   * 拖下树 → 上树 ＝ **从当前恢复点拉回**（2026-10-18）。收拖源原路径与恢复点 id；
   * 冲突判断与三选一交给恢复对话框（Task 16），树里不再有内联确认条。
   * 省略（或 `snapshotId` 为空）⇒ 下树的行不可拖。
   */
  onRestoreSnapshot?: (input: { snapshotId: string; path: string }) => void
  /**
   * 这个项目的恢复点清单（spec §11.2）。`undefined` ＝ 还没加载 / 没接数据源；
   * `[]` ＝ 明确没有恢复点——两者不是一件事，空态各说各的。
   */
  snapshots?: readonly BackupSnapshot[]
  /** 下树当前显示的恢复点。`undefined` ＝ 还没选 ⇒ 下树不可拖、空态提示先选一个。 */
  snapshotId?: string
  /** 切换恢复点（原生 `<select>`）。 */
  onSelectSnapshot?: (id: string) => void
  /** 删除当前恢复点（按钮本身不做二次确认，交给接线方）。 */
  onDeleteSnapshot?: (id: string) => void
  /** 容量用量（spec §11.2 标题行「已用 3.2 / 10 GB」）；`autoPaused` 另作暂停提示。 */
  usage?: { readonly usedBytes: number; readonly limitBytes: number; readonly autoPaused: boolean }
}

/**
 * 上下双树：上树＝沙箱、下树＝MinIO 备份（设计 §5）。
 *
 * ## 上树就是 `FileTree` 本身，不另起一棵
 *
 * 上树要能干文件树能干的一切（搜索 / 折叠 / 新建 / 右键），这些 T007–T009 已经做完了。
 * 这里把 `FileTreeProps` 整份 `extends` 进来再 `splitProps` 掉自己那五个，**其余原样 spread**
 * 给 `FileTree`——于是上树的能力面跟着 `FileTree` 长，本组件不必逐个转发（少一处会漂的镜像）。
 *
 * ## 收起态不卸载上树
 *
 * `<Show>` 只包**下树与分隔条**：上树恒挂载。`FileTree` 自己有搜索词 / 折叠态 / 选中行三份
 * 内部信号，展开双树再收起就把它们清掉的话，用户会看见自己刚选好的东西不见了
 * （同 `sidebar-tabs.tsx` 那条「两个 pane 常挂不卸载」的理由）。
 *
 * ## 拖拽为什么是**委托**，不是给每行挂一对回调
 *
 * 两棵树的行结构同构（都带 `data-slot="file-tree-row"` ＋ `data-path` ＋ `data-type`），
 * 所以「从哪棵树、拖的是哪一行、放到哪棵树的哪一行」这四个问题，在**最外层这一层**就能一次
 * 问完（`#004-12`：同一件事的判据只有一份）。`FileTree` / `MinioTree` 因此只被要求交出一个事实
 * ——「这行可以拖」——不必各自认识「备份」这件事。
 *
 * ## 本组件今天在生产里是「半截」的
 *
 * `open` / `onCollapse` 是纯 UI，`workspace-entry.tsx` 接得上；`onBackup` / `onRestore` /
 * `onRestoreSnapshot` 的**接收方**归 Task 17 接线（文件级备份快照 feature）。⚠️ 但**行可拖**
 * 不跟着它们：上树的行恒可拖（2026-10-13 用户裁定），拖出去的是**路径引用**（拖到右栏会话框
 * 自动填），与「备份接没接」是两回事。组件这一侧的能力由 `dual-file-tree.test.tsx` 证明。
 */
export function DualFileTree(props: DualFileTreeProps) {
  const [local, rest] = splitProps(props, [
    "backups",
    "open",
    "onCollapse",
    "onBackup",
    "onRestore",
    "onRestoreSnapshot",
    "snapshots",
    "snapshotId",
    "onSelectSnapshot",
    "onDeleteSnapshot",
    "usage",
  ])
  /**
   * MinIO 窗口高度（px）。`undefined` ＝ 还没拖过 ⇒ 走**文件区高度的 1/3**（用户 2026-10-17 下达）。
   * 拖过一次之后就钉成像素值：用户定了多高就是多高，不该在左栏改宽时自己漂。
   */
  const [窗高, set窗高] = createSignal<number>()
  /**
   * 窗口的定位祖先（`relative` 那层）。`容器高` 在**按下的那一刻**现量：分隔条的 `size` / `max`
   * 都是 mousedown 时读的，读一个挂载时算好的旧值，窗口改过大小时会差一截。
   */
  let 根: HTMLDivElement | undefined
  const 容器高 = () => 根?.clientHeight ?? 0
  /**
   * 正在被拖的那一项（`undefined` ＝ 没有拖拽在进行）。
   *
   * 组件内部的落点判据用它而**不**用 `dataTransfer` 里的 payload：同一页面内的拖拽，组件自己
   * 就知道拖的是谁，去读 `dataTransfer` 反而多一处会在 happy-dom 里立不住的依赖（那边没有
   * `DragEvent`）。payload 是**给树以外的消费者**的（会话框 / 底部窄条），它的形状由
   * `dual-file-tree.test.tsx` 的 `起拖载荷` 钉住（上树 `file:`、下树 `minio:`）。
   */
  const [拖源, set拖源] = createSignal<{ 树: 哪棵树; 路径: string }>()

  // `relative` 是 MinIO 窗口（`MinioTree`）的定位祖先——2026-10-17 起它是**置顶浮层**，
  // 不再是上下双树里的第二段普通流（用户实报：窗口盖不住文件列表）。
  return (
    <div
      ref={根}
      data-component="dual-file-tree"
      class="relative flex min-h-0 w-full flex-1 flex-col"
      // 拖拽的四个事件全在最外层这一层收——见文件头「为什么是委托」。
      onDragStart={起拖}
      onDragOver={悬停}
      onDrop={放下}
      onDragEnd={() => set拖源(undefined)}
    >
      {/* 上树**恒占满整片文件区**（它现在也是 MinIO 窗口后面的那层底）：窗口只盖住下面一部分，
          露出来的地方必须是真树、能滚能点——所以这里不再按「两树比例」压高度，分隔条也挪到了
          窗口自己的上沿（见 `MinioTree`）。 */}
      <div data-slot="sandbox-tree" data-tree="sandbox" class="flex min-h-0 w-full flex-1 flex-col">
        {/* 上树的行**恒可拖**（2026-10-13 用户裁定）：拖出去的是**路径引用**（拖到右栏会话框自动填），
            与「备份到 MinIO 有没有接线」是两回事——后者仍由 `可放` 那道闸门管（`onBackup` 没接就不落）。
            下树（MinIO）的行拖回沙箱＝拉回：文件与**目录**都可拖（目录按整棵子树，2026-10-18 用户下达）；
            闸门是「接了口 ＋ 选了恢复点」，与行的类型无关。 */}
        {/* `onBackup` / `onRestore` 在 `splitProps` 名单里 ⇒ 不在 `{...rest}` 里，**必须显式转发**：
            右键菜单「备份到 MinIO」/「从 MinIO 拉回」的禁用判据直接看这两个 prop，
            漏了它们菜单项永远是灰的（用户最初报的缺陷）。 */}
        <FileTree {...rest} draggable onBackup={local.onBackup} onRestore={local.onRestore} />
      </div>

      <Show when={local.open}>
        <MinioTree
          backups={local.backups}
          snapshots={local.snapshots}
          snapshotId={local.snapshotId}
          usage={local.usage}
          onSelectSnapshot={local.onSelectSnapshot}
          onDeleteSnapshot={local.onDeleteSnapshot}
          // 两个闸门一起判：没有恢复点就没有可拉的东西（spec §11.3 末条）。
          draggable={local.onRestoreSnapshot !== undefined && local.snapshotId !== undefined}
          onCollapse={local.onCollapse}
          高度={窗高()}
          容器高={容器高}
          onResize={set窗高}
        />
      </Show>
    </div>
  )

  /** 「这个事件发生在哪棵树的哪一行上」——两棵树的行结构同构，故一处问得出来。 */
  function 定位(event: Event) {
    const target = event.target
    if (!(target instanceof Element)) return undefined
    const 哪棵 = target.closest<HTMLElement>("[data-tree]")?.dataset.tree
    const 行 = target.closest<HTMLElement>("[data-slot='file-tree-row']")
    return {
      树: 哪棵 === "sandbox" || 哪棵 === "minio" ? (哪棵 as 哪棵树) : undefined,
      路径: 行?.dataset.path,
      类型: 行?.dataset.type,
    }
  }

  /**
   * 这一放算不算数：**有拖源、跨的是两棵不同的树、且那个方向有接缝**。
   *
   * 同树内不算——上树的行本来也能拖出浏览器（那是拖拽 A「沙箱 ↔ 本地电脑」，设计 §6.3），
   * 那条路与本组件无关，别在这里把它吃掉。
   */
  function 可放(event: Event) {
    const 源 = 拖源()
    if (!源) return false
    const 位 = 定位(event)
    if (!位?.树 || 位.树 === 源.树) return false
    return 源.树 === "sandbox"
      ? local.onBackup !== undefined
      : local.onRestoreSnapshot !== undefined && local.snapshotId !== undefined
  }

  function 起拖(event: DragEvent) {
    const 位 = 定位(event)
    if (!位?.树 || !位.路径) return
    set拖源({ 树: 位.树, 路径: 位.路径 })
    // 载荷按树分流：上树是**本地路径引用** `file:<path>`（会话框认这个形状、把它插成一条文件
    // 引用，2026-10-13 用户提出）；下树是**云上备份** `minio:<path>`（2026-10-18）——若仍写
    // `file:`，会话框会把云上备份误当成本地路径引用。
    // **目录补尾斜杠**——沿用仓里已有的记号让路径自己说清「这是目录」（同「复制路径」那处，
    // `#005-20`），别发明第二种写法。
    // 两处 `?.` 是刻意的：happy-dom 里这个事件是裸 `Event`，没有 `dataTransfer`——少了这两问，
    // 组件测试根本进不来（这一处已由 `dual-file-tree.test.tsx` 的 `起拖载荷` 替身补上）。
    const 引用 = 位.类型 === "directory" ? `${位.路径}/` : 位.路径
    event.dataTransfer?.setData(
      "text/plain",
      位.树 === "minio" ? `minio:${位.路径}` : `file:${引用}`,
    )
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
  }

  function 悬停(event: DragEvent) {
    if (!可放(event)) return
    // **不 `preventDefault` 就不会触发 `drop`** —— 这是 HTML5 拖拽的规矩，不是可选的优化。
    event.preventDefault()
  }

  function 放下(event: DragEvent) {
    if (!可放(event)) return
    event.preventDefault()
    const 源 = 拖源()
    set拖源(undefined)
    if (!源) return
    // 落点**不参与**路径计算（2026-10-18 用户裁定：保持原路径）。
    // 拖到哪个目录行都一样；而且 2026-10-18 起**手动备份一律整项目**——这里交上去的路径
    // 只标记「从哪一项进来」，接线层不会再拿它收窄快照范围。
    if (源.树 === "sandbox") {
      local.onBackup?.(源.路径)
      return
    }
    // `snapshotId` 是 getter，先取到局部常量再判/用（别读两次、也别把非空断言请回来）。
    const snapshotId = local.snapshotId
    if (snapshotId !== undefined) local.onRestoreSnapshot?.({ snapshotId, path: 源.路径 })
  }
}

/**
 * 下树：MinIO 备份的**只读**树（设计 §5.2）。
 *
 * 刻意不复用 `FileTree`：那棵树上挂着工具栏与右键菜单（新建 / 重命名 / 删除 / 上传…），
 * 对一份**云上的备份**都说不通——全禁用会变成一排灰按钮（看着就像坏了），而「禁用」在这里
 * 也不是「还没接线」，是**这些动作对备份不成立**。所以下树只画行：图标 ＋ 名字 ＋ ✓。
 *
 * 目录仍可开合（设计 §5.2 图里的 `▾`）：备份树深了要能收，不然下半栏就废了。
 */
function MinioTree(props: {
  backups?: readonly string[]
  snapshots?: readonly BackupSnapshot[]
  snapshotId?: string
  onSelectSnapshot?: (id: string) => void
  onDeleteSnapshot?: (id: string) => void
  usage?: { readonly usedBytes: number; readonly limitBytes: number; readonly autoPaused: boolean }
  /**
   * 行可拖回沙箱。调用方传的是「接了口 ＋ 选了恢复点」的结论（见 `DualFileTree` 那处）。
   * 文件与**目录**都按这一道闸门（2026-10-18 用户下达）；拖目录 ＝ 按目录路径整棵子树拉回，
   * 本组件只负责把路径原样交回外层，不再按行类型分流。
   */
  draggable?: boolean
  onCollapse?: () => void
  /** 用户拖出来的高度（px）。`undefined` ＝ 还没拖过 ⇒ 默认文件区高度的 1/3。 */
  高度?: number
  /** 文件区当下的高度（px）。**在 mousedown 那一刻现量**——见 `DualFileTree` 的同名注释。 */
  容器高: () => number
  onResize: (高: number) => void
}) {
  /**
   * 展开态**存展开集合**：空集合即默认 = **全部收缩**（2026-10-18 用户下达，与上树对齐）。
   *
   * ⚠️ 这一条**推翻了** 2026-10-17 的旧裁定（当时写的是「本树维持默认全展开，因为它是只读镜像、
   * 一屏本来就短」）。旧理由的前提是「窗口一屏装得下」——而真栈里一份 30 个文件的恢复点，
   * 摊开后光顶层之外还有两层，窗口默认只占文件区 1/3，全展开等于一进来就滚到看不见结构。
   * 用户看的是**进入时的第一眼**：先给骨架（顶层目录），要细看再「全部展开」。
   * 旧注释已按 `LEARNINGS #005-43` 一并改写，不留「注释说全展开、代码全收缩」的分裂。
   */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  // 与上树（`file-tree.tsx`）**同一个建树函数**：下树这一侧的备份清单是**文件级**的
  // （一条目录项都没有），所以今天两函数结果逐字相同——接上不是为了改变什么，是为了
  // **不让同一份清单形状在两棵树上各有一套建树规则**（`LEARNINGS #002-06`：两套漂了不报错，
  // 症状是「上树看得见、下树看不见」而看不出为什么）。
  const 模型 = createMemo(() => buildProjectFileTreeModel(props.backups ?? []))
  const 行列表 = createMemo(() => flattenFileTreeV2(模型(), 展开))

  function 展开(path: string) {
    return expanded().has(path)
  }
  function 切换(path: string) {
    const next = new Set(expanded())
    if (!next.delete(path)) next.add(path)
    setExpanded(next)
  }
  /**
   * 「全部展开」只放**目录**进集合（同上树 `file-tree.tsx:932-939`）：文件行不读这个集合，
   * 把文件路径塞进去是死数据；而「展开所有目录」按字面就该只有目录。
   *
   * 目录集合来自**建树之后**的模型，不是 `backups`：备份清单是文件级的，目录是合成出来的
   * ——直接遍历 `backups` 会一个目录都取不到（那会让这颗钮静默变成 no-op）。
   */
  function 全部展开() {
    setExpanded(
      new Set(
        flattenFileTreeV2(模型(), () => true)
          .filter((row) => row.node.type === "directory")
          .map((row) => row.node.path),
      ),
    )
  }

  return (
    <div
      data-slot="minio-tree"
      data-tree="minio"
      // 置顶浮层（2026-10-17 用户实报）：「MinIO 备份」窗口要**盖住**文件 Tab 里的文件/文件夹信息。
      // 修之前它只是上下双树里的第二段普通流（`position: static`、无底色、无上边框）：与文件列表
      // 不重叠 ⇒ 遮不住东西，上沿也「感觉不到在哪里」。
      //  - `absolute inset-0`：脱离普通流、盖满整片文件区（上树仍挂载在下面，收起时状态不丢）；
      //  - `z-20`：压过 `resize-handle.css` 里 z-index 10 的分隔条；
      //  - `bg-v2-background-bg-base`：**必须不透明**——透明浮层只是「什么都没盖」；
      //  - `border-t`：上沿一条横线，与下方窄条（`minio-bar.tsx` 的 `border-t`）同色同线型；
      //  - `inset-x-0 bottom-0` + 高度：窗口**锚在底部**（像从下面升起的抽屉），默认高度是
      //    文件区高度的 **1/3**（2026-10-17 用户下达），上沿可拖（见下面那只分隔条）。
      //    写比例不写常量：左栏高度变了窗口跟着走，不必再维护一份「默认高度」。
      class="absolute inset-x-0 bottom-0 z-20 flex min-h-0 w-full flex-col border-t border-v2-border-border-muted bg-v2-background-bg-base"
      style={{ height: props.高度 === undefined ? "33.3333%" : `${props.高度}px` }}
    >
      {/* 上沿拖拽区（2026-10-17 用户补报：置顶改造后窗口上沿拖不动了）。`edge="start"` ⇒ 柄压在
          **包含块的上沿**（`resize-handle.css` 的 `inset-block-start: 0` + `translateY(-50%)`）；
          `size` 量的是**窗口高度**、`edge="start"` 的 delta 是「指针上移 ⇒ 变高」——所以往下拖，
          窗口变矮、上沿跟着下去（正是用户要的方向）。`max` 取文件区高度：拖到顶即整片盖住。
          ⚠️ `size` / `max` 必须在按下那一刻读（`props.容器高()` 是函数不是值）：写成挂载时的快照，
          窗口在左栏改宽后就会差一截。 */}
      <ResizeHandle
        data-slot="dual-tree-splitter"
        direction="vertical"
        edge="start"
        size={props.高度 ?? props.容器高() / 3}
        min={最小窗高}
        max={Math.max(最小窗高, props.容器高())}
        onResize={props.onResize}
      />
      {/* 标题行（2026-10-18 用户裁定保留第一版设计，只做三件事）：
          ① 加「全部收缩 / 全部展开」两颗（镜像上树 `file-tree.tsx:575-587`：同一套图标、同一套文案、
             **同样带 tooltip**，顺序沿用上树——先收缩、后展开）；
          ② 用量只在 `≥80%` 时出现（`该报用量`），平时不占位；
          ③ 🗑 离开这一行（它删的是「哪一份恢复点」，搬进恢复点下拉、跟着那一项走）。
          「自动备份已暂停」也从这里撤了——那条完整告警归窄条（`minio-bar-paused`），
          窗口只说自己是什么、里面有什么。 */}
      <div
        data-slot="minio-tree-header"
        class="flex h-7 shrink-0 items-center gap-1 border-b border-v2-border-border-muted px-1"
      >
        <Icon name="cloud-upload" size="small" class="shrink-0 [--icon-base:currentColor]" />
        <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted">MinIO 备份</span>
        <TooltipV2 value="全部收缩" class="flex shrink-0">
          <button
            data-slot="minio-tree-collapse-all"
            type="button"
            aria-label="全部收缩"
            class={工具钮}
            onClick={() => setExpanded(new Set())}
          >
            <Icon name="collapse" size="small" class="[--icon-base:currentColor]" />
          </button>
        </TooltipV2>
        <TooltipV2 value="全部展开" class="flex shrink-0">
          <button
            data-slot="minio-tree-expand-all"
            type="button"
            aria-label="全部展开"
            class={工具钮}
            onClick={全部展开}
          >
            <Icon name="expand" size="small" class="[--icon-base:currentColor]" />
          </button>
        </TooltipV2>
        {/* 用量（spec §11.2「已用 3.2 / 10 GB」）：**只在快满时**出现并转警告色。
            平时它回答的是「我在看什么」——答案不是数字。 */}
        <Show when={该报用量(props.usage) ? props.usage : undefined}>
          {(usage) => (
            <span data-slot="minio-tree-usage" class="shrink-0 text-[12px] text-v2-state-fg-warning">
              {`${格式化字节(usage().usedBytes)} / ${格式化字节(usage().limitBytes)}`}
            </span>
          )}
        </Show>
        {/* 悬停提示：只剩一枚 `✕`——标题那行的「MinIO 备份」说的是**这棵树**，不是这颗按钮做什么。
            文案与 `aria-label` 同源。
            ⚠️ `TooltipV2` 插的那层 `<div>` 顶替了原先长在按钮上的 `shrink-0`（同 `file-tree.tsx`）。 */}
        <TooltipV2 value="收起 MinIO 备份" class="flex shrink-0">
          <button
            data-slot="minio-tree-collapse"
            type="button"
            aria-label="收起 MinIO 备份"
            class={工具钮}
            onClick={() => props.onCollapse?.()}
          >
            <Icon name="close" size="small" class="[--icon-base:currentColor]" />
          </button>
        </TooltipV2>
      </div>

      {/* 恢复点选择（spec §11.2 / §11.7）：**通栏胶囊 ＋ 下拉**，替换原生 `<select>`。
          原生控件在 28px 高、140px 宽里把「时间 · 类型 · 文件数」压成半截，且没法在每一项里
          放「删除」。下拉项**一行**：`时间  类型 · N 个文件 · 作用范围`（2026-10-18 用户下达：
          两行太高，恢复点多了列表要翻半天）。 */}
      <div
        data-slot="minio-tree-snapshots"
        class="flex shrink-0 items-center gap-1 border-b border-v2-border-border-muted px-1 py-1"
      >
        <DropdownMenu gutter={4} placement="bottom-start">
          {/* ⚠️ 用 `data-snapshot-picker` 而不是 `data-slot`：`DropdownMenu.Trigger`
              把 `data-slot="dropdown-menu-trigger"` 硬写在 `{...rest}` **之后**
              （`packages/ui/src/components/dropdown-menu.tsx:34`），调用方传的 `data-slot`
              会被静默覆盖、那个名字在 DOM 里根本不存在（`LEARNINGS #005-22`）。
              `Content` 只加 `data-component`，故那边的 `data-slot` 留得住。 */}
          <DropdownMenu.Trigger
            data-snapshot-picker=""
            // 当前选中项的 id 回显在触发器上：这是「我选的是哪一份」唯一的机器可读记号
            // （原生 `<select>` 的 `.value` 随控件一起退场，判据与读屏名都改挂在这里）。
            // ⚠️ 名字**不能**也叫 `data-snapshot-id`：菜单项与触发器会同时存在于 `document.body`，
            // 一个未加限定的 `querySelector("[data-snapshot-id='s-1']")` 会先命中触发器
            // （它排在 Portal 之前），拿到的是一颗没有 🗑 的节点（`#005-22` 的同族）。
            data-current-snapshot={props.snapshotId ?? ""}
            aria-label="选择恢复点"
            disabled={(props.snapshots?.length ?? 0) === 0}
            class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-left text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover disabled:cursor-default"
          >
            <Show
              when={props.snapshots?.find((snapshot) => snapshot.id === props.snapshotId)}
              fallback={<span class="min-w-0 flex-1 truncate text-v2-text-text-faint">选择恢复点</span>}
            >
              {(当前) => (
                <>
                  <span data-slot="minio-tree-snapshot-time" class="shrink-0 tabular-nums text-v2-text-text-base">
                    {时间戳(当前().createdAt)}
                  </span>
                  <span data-slot="minio-tree-snapshot-kind" class={徽标(当前().kind)}>
                    {类型名(当前().kind)}
                  </span>
                  <Show when={是局部(当前())}>{局部徽标()}</Show>
                  <span class="min-w-0 flex-1 truncate text-[11px] text-v2-text-text-faint">
                    {`${当前().totals.files} 个文件${当前().scope ? ` · ${当前().scope}` : ""}`}
                  </span>
                </>
              )}
            </Show>
            <Icon name="chevron-down" size="small" class="ml-auto shrink-0 [--icon-base:currentColor]" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              data-slot="minio-tree-snapshot-menu"
              // 定宽（不是 `min-w`）：一行里那个 `truncate` 要有**上界**才截得住——否则长作用范围
              // 会把菜单撑得任意宽，「一行」反而变成一条很长的行（2026-10-18）。
              class="z-30 max-h-64 w-[20rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-base shadow-lg"
            >
              <For each={props.snapshots ?? []}>
                {(snapshot) => (
                  <DropdownMenu.Item
                    data-snapshot-id={snapshot.id}
                    data-selected={snapshot.id === props.snapshotId ? "true" : undefined}
                    onSelect={() => props.onSelectSnapshot?.(snapshot.id)}
                    class="flex w-full items-center gap-2 px-2 py-1.5 text-left outline-none data-[highlighted]:bg-v2-overlay-simple-overlay-hover data-[selected]:bg-v2-background-bg-layer-01"
                  >
                    {/* 一行到底（2026-10-18 用户下达）：时间、类型、文件数（＋作用范围）。
                        作用范围非空时必带——同一分钟、不同选中项的两个恢复点否则看起来一模一样
                        （spec §11.2），故它跟着文件数一起**截断**，不换行。 */}
                    <div data-slot="minio-tree-snapshot-item-body" class="flex min-w-0 flex-1 items-center gap-1.5">
                      <span class="shrink-0 text-[12px] tabular-nums text-v2-text-text-base">
                        {时间戳(snapshot.createdAt)}
                      </span>
                      <span class={徽标(snapshot.kind)}>{类型名(snapshot.kind)}</span>
                      <Show when={是局部(snapshot)}>{局部徽标()}</Show>
                      <span class="min-w-0 truncate text-[11px] text-v2-text-text-faint">
                        {`${snapshot.totals.files} 个文件${snapshot.scope ? ` · ${snapshot.scope}` : ""}`}
                      </span>
                    </div>
                    {/* 删除**跟着这一项**（2026-10-18 用户裁定）：点它删的是这份恢复点，
                        不是「先选中、再去别处删」。三处 `stopPropagation` 不是洁癖 ——
                        Kobalte 在 **`pointerup`** 上选中菜单项（`LEARNINGS #006-37`），
                        不拦的话点 🗑 会顺带把这一项选上（那正是 `dual-file-tree.test.tsx` 里
                        「点删除不选中」那条钉住的性质）。 */}
                    <Show when={props.onDeleteSnapshot}>
                      <TooltipV2 value="删除这个恢复点" class="flex shrink-0">
                        <button
                          data-slot="minio-tree-delete"
                          // 不挂 `data-snapshot-id`：它与所在菜单项同名，而 🗑 是菜单项的子树 ⇒
                          // 任何按 id 取节点的查询都可能先命中这颗钮（`#005-22` 同族）。
                          type="button"
                          aria-label={`删除恢复点 ${时间戳(snapshot.createdAt)}（${类型名(snapshot.kind)}）`}
                          class="flex h-5 w-5 items-center justify-center rounded-[4px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-state-fg-danger"
                          onPointerDown={(event) => event.stopPropagation()}
                          onPointerUp={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            props.onDeleteSnapshot?.(snapshot.id)
                          }}
                        >
                          <Icon name="trash" size="small" class="[--icon-base:currentColor]" />
                        </button>
                      </TooltipV2>
                    </Show>
                    <Show when={snapshot.id === props.snapshotId}>
                      <Icon
                        name="check"
                        size="small"
                        aria-label="当前恢复点"
                        class="shrink-0 text-v2-text-text-base [--icon-base:currentColor]"
                      />
                    </Show>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>

      {/* 历史遗留的**局部恢复点**（2026-10-18 起手动备份一律整项目）：下树只列它当时那部分
          文件。不把「其余文件不在其中、拉回也不会删它们」说出来，用户会以为项目丢了文件
          （2026-10-18 用户实报）。新建的恢复点 `scope` 恒为 `""` ⇒ 这条不会出现。 */}
      <Show when={props.snapshots?.find((snapshot) => snapshot.id === props.snapshotId && 是局部(snapshot))}>
        {(局部) => (
          <p
            data-slot="minio-tree-partial-hint"
            class="shrink-0 border-b border-v2-border-border-muted px-2 py-1 text-[11px] leading-snug text-v2-state-fg-warning"
          >
            {`这是旧版本留下的局部恢复点：只包含「${局部().scope}」下的文件，项目里其余文件不在其中（拉回不会删除它们）。`}
          </p>
        )}
      </Show>

      <div class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-1 pt-1">
        <Show
          when={行列表().length > 0}
          fallback={
            <p
              data-slot="minio-tree-empty"
              data-state="empty"
              class="px-1 py-2 text-[13px] text-v2-text-text-faint"
            >
              {/* 五支而不是四支（`R-6`）：`autoPaused` **不能排最前**——超限时哪怕有恢复点也要
                  让人看见「有哪些恢复点」；而「已选恢复点、但它本身没有文件」不是「还没选」。 */}
              {props.snapshots === undefined
                ? EMPTY_NO_SOURCE
                : props.snapshots.length === 0
                  ? props.usage?.autoPaused
                    ? EMPTY_PAUSED
                    : EMPTY_NONE
                  : props.snapshotId === undefined
                    ? EMPTY_PICK
                    : props.usage?.autoPaused
                      ? `${EMPTY_EMPTY}（自动备份已暂停）`
                      : EMPTY_EMPTY}
            </p>
          }
        >
          <div data-slot="minio-tree-body" role="tree" class="flex w-full min-w-0 flex-col">
            <For each={行列表()}>
              {(row) => (
                <div
                  // `data-slot` **沿用 `file-tree-row`**：两棵树的行同构，拖拽的委托才只有一份
                  // （见 `DualFileTree` 的 `定位`；`data-tree` 负责区分是哪棵）。
                  data-slot="file-tree-row"
                  data-path={row.node.path}
                  data-type={row.node.type}
                  data-level={row.level}
                  // 文件与目录都可拖（2026-10-18 用户下达）：拖目录 ＝ 按目录路径整棵子树拉回。
                  // 闸门只有 `props.draggable` 一处（接了恢复口 ＋ 选了恢复点），别在这里再按类型分流
                  // ——两处判据会漂（`#002-06`）。
                  draggable={props.draggable === true}
                  // 传**布尔**不传字符串：Solid 的 `aria-expanded` 只收 `"true" | "false" | boolean`
                  // （`String(…)` 会被 tsgo 顶回来），与 `file-tree.tsx` 同一写法。
                  aria-expanded={row.node.type === "directory" ? 展开(row.node.path) : undefined}
                  role="treeitem"
                  tabindex="0"
                  style={{ "padding-left": `${row.level * INDENT_STEP}px` }}
                  class={ROW}
                >
                  <Show when={row.node.type === "directory"} fallback={<span class="w-4 shrink-0" />}>
                    {/* 悬停提示：与 `file-tree.tsx` 的箭头同法（文案随开合变、与 `aria-label` 同源）。 */}
                    <TooltipV2 value={展开(row.node.path) ? "收起" : "展开"} class="flex shrink-0">
                      <button
                        data-slot="minio-tree-chevron"
                        type="button"
                        aria-label={展开(row.node.path) ? "收起" : "展开"}
                        class="flex h-4 w-4 shrink-0 items-center justify-center text-v2-text-text-muted"
                        onClick={(event) => {
                          event.stopPropagation() // 箭头只管开合，不外溢
                          切换(row.node.path)
                        }}
                      >
                        <Icon
                          name={展开(row.node.path) ? "chevron-down" : "chevron-right"}
                          size="small"
                          class="[--icon-base:currentColor]"
                        />
                      </button>
                    </TooltipV2>
                  </Show>
                  <FileIcon
                    node={{ path: row.node.path, type: row.node.type }}
                    expanded={展开(row.node.path)}
                    class="h-4 w-4 shrink-0"
                  />
                  <span data-slot="minio-tree-name" class="min-w-0 flex-1 truncate">
                    {row.node.name}
                  </span>
                  {/* ✓ ＝ 「这份在 MinIO 上」。下树的行**全部**来自备份清单，所以每个**文件**都带 ✓；
                      目录不是一份对象，不标（设计 §5.2 图里 ✓ 也只在文件行上）。 */}
                  <Show when={row.node.type === "file"}>
                    <span data-slot="minio-tree-check" class="shrink-0">
                      <Icon name="check" size="small" class="[--icon-base:currentColor]" />
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
