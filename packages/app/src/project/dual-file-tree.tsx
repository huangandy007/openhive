import { Icon } from "@opencode-ai/ui/icon"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createMemo, createSignal, For, Show, splitProps } from "solid-js"
import { flattenFileTreeV2 } from "@/components/file-tree-v2-model"
import { buildProjectFileTreeModel } from "@/project/file-tree-model"
import { FileTree, type FileTreeProps } from "@/project/file-tree"

/** 每层缩进（设计 §6.4 的 16px 层级缩进）——**与 `file-tree.tsx` 同值**：两棵树并排出现，缩进不一致会看得出来。 */
const INDENT_STEP = 16

/** 上树高度上下限（设计 §5.2「按需调整两树比例」）。收起态不参与——那时上树占满。 */
const 上树最小 = 72
const 上树最大 = 480
const 上树默认 = 180

const ROW =
  "flex h-6 min-w-0 w-full shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
const 确认按钮 =
  "flex h-6 shrink-0 items-center rounded-[4px] px-1.5 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"

/** 下树的空态两句**不同**文案——「没有来源」与「来源说了没有」不是一件事（同 `file-tree.tsx` 两个空态、同 `minio-backups.ts` 的 `undefined` / `[]` 之分）。 */
const EMPTY_NO_SOURCE = "备份清单未接入"
const EMPTY_NONE = "还没有备份"

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
   * 省略 ＝ 还没接线 ⇒ **行不可拖**（同 T005 三个按钮、T007 菜单六项、T019 会话空态的一贯口径：
   * 「未接线即禁用」——一个拖了没反应的行同样是谎）。
   */
  onBackup?: (path: string) => void
  /** 拖下树 → 上树 ＝ **拉回沙箱**。覆盖沙箱里同名文件前先二次确认（见 `请求拉回`）。省略 ＝ 下树的行不可拖。 */
  onRestore?: (path: string) => void
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
 * `open` / `onCollapse` 是纯 UI，`workspace-entry.tsx` 接得上；而 `onBackup` / `onRestore`
 * 的**接收方不存在**（MinIO 的 HTTP 出口还没建，归 T022）⇒ 生产里这两个 prop 不传，
 * 于是行**不可拖**、下树也没有实际作用——与右键菜单第 9/10 项自 T008 起就禁用是同一件事。
 * 组件这一侧的能力由 `dual-file-tree.test.tsx` 证明，接线缺口记在 `005/tasks.md` 的 T012 与 T022。
 */
export function DualFileTree(props: DualFileTreeProps) {
  const [local, rest] = splitProps(props, ["backups", "open", "onCollapse", "onBackup", "onRestore"])
  /** 上树高度。**只有展开态读它**——收起态上树是 `flex-1`，这个数不参与排布。 */
  const [上高, set上高] = createSignal(上树默认)
  /**
   * 正在被拖的那一项（`undefined` ＝ 没有拖拽在进行）。
   *
   * 判据用它而**不**用 `dataTransfer` 里的 payload：同一页面内的拖拽，组件自己就知道拖的是谁，
   * 去读 `dataTransfer` 反而多一处会在 happy-dom 里立不住的依赖（那边没有 `DragEvent`）。
   * payload 照放（见 `起拖`），但**没有一条断言依赖它**。
   */
  const [拖源, set拖源] = createSignal<{ 树: 哪棵树; 路径: string }>()
  /**
   * 「待确认拉回」的那一项——非空即**确认条开着**（裁定 4A：拉回会盖掉沙箱里现行的那份）。
   *
   * 存**路径**而不是布尔：确认条上要写出「覆盖的是谁」，确认之后还得原样把路径喊回 `onRestore`。
   *
   * ⚠️ 这一条**不再**跟着 `file-tree.tsx` 的删除确认走（2026-10-11，⑦-③）：那边已经把二次确认
   * 改成**弹窗**（`file-delete-dialog.tsx`），信号也随之取消（对象在开弹窗那一刻就交给弹窗了，
   * 不必在本组件里记一份）。本文件这条**仍是内联条**，是本仓最后一条这种形态
   * ——登记在 T022，尚未裁定。
   */
  const [待拉回, set待拉回] = createSignal<string>()

  return (
    <div
      data-component="dual-file-tree"
      class="flex min-h-0 w-full flex-1 flex-col"
      // 拖拽的四个事件全在最外层这一层收——见文件头「为什么是委托」。
      onDragStart={起拖}
      onDragOver={悬停}
      onDrop={放下}
      onDragEnd={() => set拖源(undefined)}
    >
      {/* 上树。`relative` 是给分隔条当定位祖先——`resize-handle.css` 把柄写死为 `position: absolute`
          且只按**包含块的边缘**定位（`edge="end"` ⇒ `inset-block-end: 0`），所以包裹的边界必须
          就是上树的边界，柄才落在两树之间那条缝上（同 `three-pane.tsx` 的不变量）。 */}
      <div
        data-slot="sandbox-tree"
        data-tree="sandbox"
        classList={{ "relative flex min-h-0 w-full flex-col": true, "flex-1": !local.open }}
        style={local.open ? { height: `${上高()}px` } : undefined}
      >
        <FileTree {...rest} draggable={local.onBackup !== undefined} />
        {/* 收起态**连分隔条都不渲染**（不是隐藏）：没有两棵树，就没有可调的比例。 */}
        <Show when={local.open}>
          <ResizeHandle
            data-slot="dual-tree-splitter"
            direction="vertical"
            edge="end"
            size={上高()}
            min={上树最小}
            max={上树最大}
            onResize={set上高}
          />
        </Show>
      </div>

      <Show when={local.open}>
        <MinioTree
          backups={local.backups}
          draggable={local.onRestore !== undefined}
          onCollapse={local.onCollapse}
        />
      </Show>

      {/* 拉回的二次确认（裁定 4A）——**内联**一条，不用 `Dialog`：
          树是用户眼睛已经在的地方，再叠一层跨模块的模态还得让人多解释一步「这是在拉回哪儿」。
          `role="alert"` 让屏幕阅读器在条冒出来时读一遍（不是模态，不需要焦点管理）。

          ⚠️ 原先这里写的是「同 T009 的删除确认」——**那句话已经不作数了**：2026-10-11（⑦-③）
          删除确认改成了**弹窗**（`file-delete-dialog.tsx`，理由见那个文件头：内联条在真栈上是
          钉在栏底的整栏宽横幅、落在树区域之外，与刚点的那一行隔了整棵树）。本文件这条**没跟着改**
          （登记在 T022，用户尚未裁定），所以「内联」这个选择在本文件里**现在只剩自己撑着了**
          ——再有人问「为什么不一并弹窗化」，别拿删除确认当先例。 */}
      <Show when={待拉回()}>
        {(path) => (
          <div
            data-slot="restore-confirm"
            role="alert"
            class="flex w-full min-w-0 items-center gap-1 rounded-[4px] bg-v2-background-bg-layer-01 px-1 py-0.5 text-[13px] text-v2-text-text-base"
          >
            <span class="min-w-0 truncate">
              确定用 MinIO 上的版本覆盖「<span data-slot="restore-name">{path()}</span>」？
            </span>
            <button
              data-slot="restore-cancel"
              type="button"
              class={确认按钮}
              onClick={() => set待拉回(undefined)}
            >
              取消
            </button>
            <button data-slot="restore-ok" type="button" class={确认按钮} onClick={确认拉回}>
              覆盖
            </button>
          </div>
        )}
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
    return 源.树 === "sandbox" ? local.onBackup !== undefined : local.onRestore !== undefined
  }

  function 起拖(event: DragEvent) {
    const 位 = 定位(event)
    if (!位?.树 || !位.路径) return
    set拖源({ 树: 位.树, 路径: 位.路径 })
    // 往 `dataTransfer` 里也放一份（与上游 `file-tree-v2.tsx` 是同一个 payload 形状 `file:<path>`），
    // 但**判据不读它**（见 `拖源` 的注释）。两处 `?.` 是刻意的：happy-dom 里这个事件是裸 `Event`，
    // 没有 `dataTransfer` —— 少了这两问，组件测试根本进不来。
    event.dataTransfer?.setData("text/plain", `file:${位.路径}`)
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
    const 位 = 定位(event)
    set拖源(undefined)
    if (!源 || !位) return
    const 目标 = 拼路径(位, 源.路径)
    if (源.树 === "sandbox") local.onBackup?.(目标)
    else 请求拉回(目标)
  }

  /** 落到哪个路径上：目录行＝它自己；文件行＝它所在的目录；空白（根以外的子树区域）＝根。 */
  function 拼路径(位: { 路径?: string; 类型?: string }, 源路径: string) {
    const 名 = 源路径.slice(源路径.lastIndexOf("/") + 1)
    const 目录 = 位.类型 === "directory" ? (位.路径 ?? "") : 父目录(位.路径)
    return 目录 ? `${目录}/${名}` : 名
  }

  function 父目录(path: string | undefined) {
    if (!path) return ""
    const index = path.lastIndexOf("/")
    return index === -1 ? "" : path.slice(0, index)
  }

  /**
   * 拉回前先看**沙箱里有没有同名**：没有 ⇒ 纯新增，没什么可破坏的，直接拉；有 ⇒ 覆盖沙箱现行
   * 的那份，先确认（裁定 4A）。把「拦不拦」挂在**沙箱的实际内容**上，而不是「拉回这个动作」
   * 上——同一个动作在两种情形下代价不同，拦法就该不同。
   */
  function 请求拉回(path: string) {
    if (!(rest.paths ?? []).includes(path)) return local.onRestore?.(path)
    set待拉回(path)
  }

  function 确认拉回() {
    const path = 待拉回()
    if (!path) return
    set待拉回(undefined)
    local.onRestore?.(path)
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
  draggable?: boolean
  onCollapse?: () => void
}) {
  /**
   * 收起态**存反向**（收起集合而不是展开集合）：默认全展开，空集合即默认。
   *
   * ⚠️ 与上树（`file-tree.tsx`）**故意相反**，不是漏改：上树自 2026-10-11 起默认**全收缩**
   * （用户第 5 条「开始进入文件 Tab 页面时，默认全部收缩」），这里维持默认全展开。两条理由的前提不同
   * （`LEARNINGS #005-28`）：第 5 条讲的是**沙箱树**的初始态（深了摊开一屏放不下几条），
   * 而这棵是**只读的云上备份镜像**、用途是跟沙箱对照着看，一屏本来就短。裁定与落点表见
   * `docs/superpowers/specs/005-project-management/state.md` ⑦ 第 5 条。
   */
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  // 与上树（`file-tree.tsx`）**同一个建树函数**：下树这一侧的备份清单是**文件级**的
  // （一条目录项都没有），所以今天两函数结果逐字相同——接上不是为了改变什么，是为了
  // **不让同一份清单形状在两棵树上各有一套建树规则**（`LEARNINGS #002-06`：两套漂了不报错，
  // 症状是「上树看得见、下树看不见」而看不出为什么）。
  const 模型 = createMemo(() => buildProjectFileTreeModel(props.backups ?? []))
  const 行列表 = createMemo(() => flattenFileTreeV2(模型(), 展开))

  function 展开(path: string) {
    return !collapsed().has(path)
  }
  function 切换(path: string) {
    const next = new Set(collapsed())
    if (!next.delete(path)) next.add(path)
    setCollapsed(next)
  }

  return (
    <div data-slot="minio-tree" data-tree="minio" class="flex min-h-0 w-full flex-1 flex-col">
      {/* 树标题（设计 §5.2 下图那行「⬆ MinIO 备份（镜像沙箱路径） ✕」）。文案沿用 ④ 窄条的
          「MinIO 备份」——窄条展开后就是这行标题，两处换词会让「展开的是同一个东西」变得不明显。 */}
      <div
        data-slot="minio-tree-header"
        class="flex h-7 shrink-0 items-center gap-1 border-b border-v2-border-border-muted px-1"
      >
        <Icon name="cloud-upload" size="small" class="shrink-0 [--icon-base:currentColor]" />
        <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted">MinIO 备份</span>
        {/* 悬停提示：只剩一枚 `✕`——标题那行的「MinIO 备份」说的是**这棵树**，不是这颗按钮做什么。
            文案与 `aria-label` 同源。
            ⚠️ `TooltipV2` 插的那层 `<div>` 顶替了原先长在按钮上的 `shrink-0`（同 `file-tree.tsx`）。 */}
        <TooltipV2 value="收起 MinIO 备份" class="flex shrink-0">
          <button
            data-slot="minio-tree-collapse"
            type="button"
            aria-label="收起 MinIO 备份"
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
            onClick={() => props.onCollapse?.()}
          >
            <Icon name="close" size="small" class="[--icon-base:currentColor]" />
          </button>
        </TooltipV2>
      </div>

      <div class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-1 pt-1">
        <Show
          when={行列表().length > 0}
          fallback={
            <p
              data-slot="minio-tree-empty"
              data-state="empty"
              class="px-1 py-2 text-[13px] text-v2-text-text-faint"
            >
              {props.backups === undefined ? EMPTY_NO_SOURCE : EMPTY_NONE}
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
                  draggable={props.draggable === true && row.node.type === "file"}
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
