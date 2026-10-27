import { createEffect, createSignal, onCleanup, onMount, Show, type JSX, type ParentProps } from "solid-js"
import { AssetCenter } from "@/ai-assets/asset-center"
import type { AssetCatalog } from "@/ai-assets/asset-catalog"
import type { ProjectEnablement } from "@/ai-assets/enable-state"
import type { AssetCategories } from "@/ai-assets/categories"
import { AssetNav } from "@/ai-assets/asset-nav"
import { createAssetFilter } from "@/ai-assets/filter"
import { ProjectionModuleProvider } from "@/ai-session/projection-module"
import { useBigFileAsk } from "@/center/big-file-dialog"
import { CenterSplit } from "@/center/center-split"
import type { LoadFileContent, SaveFileContent } from "@/center/file-content"
import { createOpenFile } from "@/center/open-file"
import { 看见改过 } from "@/center/session-edits"
import { CenterTabsProvider, useCenterTabs } from "@/center/tab-context"
import { contentTabKey } from "@/center/tab-store"
import { viewRegistry } from "@/center/views"
import { 清空草稿 } from "@/center/views/richtext/draft-store"
import { archiveName, type ArchiveKind } from "@/project/archive-name"
import { currentProject, 还原启动项目, 读项目cookie, setCurrentProject } from "@/project/current-project"
import { DualFileTree } from "@/project/dual-file-tree"
import { folderUploadPlan, 拆目录, type FolderUploadTask } from "@/project/folder-upload"
import { MemberPanel, type MemberEntry } from "@/project/member-panel"
import { MinioBar } from "@/project/minio-bar"
import {
  backupJob,
  backupSnapshotId,
  backupSnapshots,
  backupUsage,
  minioBackups,
  在跑,
  setBackupJob,
  setBackupSnapshotId,
  setBackupSnapshots,
  setBackupUsage,
  setMinioBackups,
} from "@/project/minio-backups"
import { statProjectFile, type FileOpOutcome, type TransferProgress } from "@/project/openhive-file-ops"
import type { ProjectActionOutcome } from "@/project/openhive-project"
import { ProjectAnchor } from "@/project/project-anchor"
import type { ProjectData } from "@/project/project-data"
import { TargetPicker } from "@/project/target-picker"
import { 文件清单请求, projectFiles, setProjectFiles } from "@/project/project-files"
import { projectList, projectListFailed, setProjectList, setProjectListFailed } from "@/project/project-list"
import { projectMembers, setProjectMembers } from "@/project/project-members"
import { ProjectPanel } from "@/project/project-panel"
import { SidebarTabs, type SidebarTabKey } from "@/project/sidebar-tabs"
import { RAIL_ENTRIES } from "@/rail/entries"
import { Rail } from "@/rail/rail"
import { currentUser } from "./current-user"
import { ThreePane } from "./three-pane"
import { workspaceView } from "./workspace-view"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { RestoreDialog } from "@/project/backup-restore-dialog"
import { FileMoveReportDialog, type 搬报告 } from "@/project/file-move-report-dialog"
import { FileTransferDialog, type FileTransferState } from "@/project/file-transfer-dialog"
import { TaskResultDialog, type TaskResult } from "@/project/task-result-dialog"
import type { BackupPreview, RestoreDecision } from "@/project/openhive-backup"
import { showToast } from "@/utils/toast"

export interface WorkspaceEntryProps {
  /** 会话能力位；省略 = 尚未接签发方，图标栏不设限（语义见 `rail/entries.ts`）。 */
  capabilities?: ReadonlySet<string>
  /**
   * 取文件内容的接缝，供中栏视图渲染。
   *
   * 该由应用入口注入（`pages/layout-new.tsx` 拿 `useSDK()` 组），**不在这里 `useFile()`**：
   * `useFile` 要六层 provider 才活得下来，会把工作台的组件测试整个拖进去。
   * ⚠️ **今天还没接**（`layout-new.tsx` 只传了 `projectData`）——接它要六层
   * provider，属中栏视图那条线，不是 T018 的事。省略 = 视图拿不到内容（停在空态），但路由与 tab 照常。
   */
  loadFile?: LoadFileContent
  /**
   * 存文件正文的接缝（2026-10-12），`loadFile` 的**反方向**：改完的文档往盘上写。
   *
   * 同一个注入理由（应用入口注入、本组件不 import 生产实现）——省略 = 视图只读，
   * 工具栏不渲染（`.md` / `.txt` 照常看，就是不能改）。
   */
  saveFile?: SaveFileContent
  /**
   * **项目这件事的数据源**（T018）：清单 / 新建 / 项目文件三条链都从它走。
   *
   * 同样由应用入口注入（`pages/layout-new.tsx` 传生产的那一个 `PROJECT_DATA`），**不在这里
   * import 生产实现**：那样组件一挂上就会去打真接口，组件测试再也跑不成离线
   * （同 `loadFile` 的理由）。省略 = 一次请求都不发，界面停在 T018 之前的形态
   * （面板里项目行不可点、新建按钮禁用、文件树恒空态）。
   */
  projectData?: ProjectData
  /**
   * **右栏（AI 会话）**的内容（T008 / FR-010）。
   *
   * 同样是注入，理由与 `loadFile` / `projectData` 一字相同：生产那份要 `useServerSync()`
   * （右栏的会话数据按目录取），组件自己去 context 里拿，本组件的测试就再也跑不成离线
   * ——本文件全程**不挂任何 provider**。生产入口是 `pages/layout-new.tsx` 的
   * `right={() => <AiSessionSlot />}`。
   *
   * **形状是访问器、不是现成的元素**（同下面的 `routePageVisible`）：内容必须**读的时候才创建**，
   * 且创建在 `CenterTabsProvider`（本组件自己建的）**之内**——`AiSessionSlot` 要按当前模块算投影
   * （`useCenterTabs()`），在外面创建会当场抛错，而症状是右栏整栏消失、**错不在右栏上**。
   *
   * ⚠️ 条件必须落在这个 **prop 本身**（`right={props.right?.()}` 得到 `undefined`），
   * 不能包一层 `<Show>` 再传进去：`ThreePane` 判的是 `props.right !== undefined`，
   * 而 `<Show>` 元素恒非 `undefined`，会留下一条 360px 空栏（与 `left` 那条同因，见下面那段注释）。
   */
  right?: () => JSX.Element
  /**
   * **左栏「会话」tab 的内容**（2026-10-08 接入）。
   *
   * 与 `right` 逐条同因：注入而不 import（生产那份要 `useServerSync()` / `useLocation()`，
   * 组件自己去 context 里拿，本文件的组件测试就再也跑不成离线）；**形状是访问器**——内容必须
   * 读的时候才创建，且创建在 `CenterTabsProvider`（本组件自己建的）之内。
   * 生产入口是 `pages/layout-new.tsx` 的 `sessions={() => <SidebarSessions />}`。
   *
   * 省略 = 会话 pane 空着（同 `projectData` 省略时文件树恒空态：不假装有内容，也不白屏）。
   * ⚠️ 与 `right` 那条不同，这里**没有** `<Show>` 包一层的风险：`SidebarTabs` 收的是
   * `JSX.Element`，`undefined` 就是「什么都不画」。
   */
  sessions?: () => JSX.Element
  /**
   * 中栏**要不要露出调用方的页面**（`children`），也就是 `CenterContent` 的 `pageVisible`。
   * 省略 = 要（与引入本 prop 之前逐字同行为）。
   *
   * **为什么判定算在外面**：`children` 在生产里是**上游路由自己的页面**，在
   * `/server/:key/session/:id` 上就是 `pages/session.tsx`——一页完整的 AI 会话。中栏把它露出来，
   * 屏幕上就有**两个输入框、两条消息流**，且两个 composer 都在真的发消息（2026-10-08 真栈肉眼报出）。
   * 判据是「当前这条路由是不是会话页」，只有**读得到 Router 的那一层**算得出来。
   * ⚠️ 本组件**不读 Router**——`workspace-entry.test.tsx` 的 96 条用例**裸挂**它（无 Router），
   * 在这里 `useLocation()` 会当场抛。所以照 `right` / `loadFile` / `projectData` 的老规矩：
   * **能读 context 的那一层算，本层只认值**（生产入口是 `pages/layout-new.tsx`）。
   *
   * **形状是访问器**（同上面的 `right`）：切换路由时它要能变，
   * 传现成的 boolean 会把中栏冻在首次渲染那一刻的判断上。
   */
  routePageVisible?: () => boolean
  /**
   * 图标栏底部「系统设置」被点时的动作：**开设置对话框**（2026-10-09 用户下达的 #3）。
   *
   * **为什么也算在外面**（与 `routePageVisible` 同因、**同一段理由**）：生产那份取它要
   * `useSettingsDialog()`，而那个 hook 内部走 `useParams()` 与 `useDialog()`——本组件被
   * `workspace-entry.test.tsx` **裸挂**（无 Router、无 provider），在它里面调会当场抛。
   * 故照 `right` / `loadFile` / `projectData` 的老规矩：**能读 context 的那一层算，本层只认值**
   * （生产入口是 `pages/layout-new.tsx`）。
   *
   * 省略 = 点它什么都不做。**刻意不退回 `switchModule("settings")`**——设置不是模块
   * （`center-content.tsx` 没有任何按 module 的分支），退回只是把模块串换掉：图标点亮、左栏消失、
   * 什么也不打开。语义与代价见 `rail/rail.tsx` 的 `RailProps.onOpenSettings`。
   */
  onOpenSettings?: () => void
  /**
   * **AI 资产的数据源**（009 T006 / 需求 6）。
   *
   * 与 `projectData` 同一条规矩：**注入而不 import 生产实现**——本组件被组件测试裸挂，
   * 自己去取就再也跑不成离线。省略 = 无数据源（网格空着，`AssetGrid` 显示
   * 「没有符合条件的资产」，**不放假数据**）。
   *
   * 需求 6 起它不只是一份清单：筛选、分页、每页条数都在这个对象里（`AssetCatalog`），
   * 因为「筛完再看第几页」必须由同一处说了算（`asset-catalog.ts` 文件头）。
   */
  catalog?: AssetCatalog
  /**
   * **项目级 skill 启用状态**（2026-10-27 / Task 7）。
   *
   * 【保留的定制 · 同步上游时不要丢】与 `catalog` / `projectData` 同一条规矩：注入而不 import
   * 生产实现——本组件被组件测试裸挂，自己去取就跑不成离线。生产实现在 `pages/layout-new.tsx`
   * 建（`createProjectEnablement()` ＋ **在组件体内** `bind(() => currentProject()?.id)`）。
   *
   * 省略 = 中栏不画「已启用 N/20」计数条、卡片也不带启用按钮（与加它之前逐字相同）。
   * 本组件**只转发**，不读它的任何成员。
   */
  enablement?: ProjectEnablement
  /**
   * **进入 AI 资产视图时通知外面去拉一次**（T017）。
   *
   * 为什么需要这条回调而不是在挂载时拉一次：用户刚发布完就切过来，挂载时拉的清单里没有它——
   * 「刚发布却看不见」正是本轮要修的病，换成「刷新页面才看得见」等于没修。
   *
   * **只在视图变成 `ai-assets` 时触发**（每次进入都触发，含从别处切回来）；本组件自己不取数，
   * 与 `catalog` 的同一条规矩：注入而不 import 生产实现，组件测试仍然离线。
   */
  onAssetsOpen?: () => void
  /**
   * **AI 资产左栏的业务分类**（需求 4，2026-10-27）。
   *
   * 【保留的定制 · 同步上游时不要丢】009 时左栏 import `filter.ts` 那份由 seed 派生的常量。
   * 分类改为管理员维护、进库之后，再读常量就是「管理员改了、用户看不见」（`#002-06`），
   * 于是分类改由服务端来，生产实现在 `pages/layout-new.tsx` 建（`ai-assets/categories.ts`）后注入。
   *
   * 与 `catalog` / `projectData` 同一条规矩：**注入而不 import 生产实现**——本组件被组件测试
   * 裸挂，自己去取就再也跑不成离线。省略 = 还没有分类（左栏分类组空着，不放假数据）。
   */
  categories?: AssetCategories
}

/**
 * 三栏工作台的入口（FR-001）：**图标栏 → 三栏**（DESIGN §4.1），顶栏另挂上游注入点。
 *
 * T006 的图标栏与 T007 的顶栏此前都只是「组件齐备、没接进应用」（顶栏更是连挂载点都
 * 没接）。本组件是它们的**唯一接线处**：应用入口只认这一个组件，两个子组件都不必知道
 * 自己落在 `layout-new.tsx` 里。
 *
 * 中栏 tab 状态（`CenterTabsProvider`）也在这里落地：图标栏的当前模块与中栏 tab 是
 * **同一份状态**（FR-006 的联动正来自这一点——切模块走 `switchModule`，它按定义不动 tabs），
 * 而模块动作（T011）与视图（T012+）都在 provider 之内，就近取用即可。
 *
 * capability 省略即不过滤，故 001 下五入口恒可见；真正的鉴权在下游执行层（宪法 IV）。
 */
export function WorkspaceEntry(props: ParentProps<WorkspaceEntryProps>) {
  // 默认停在图标栏第一个入口（FR-002 声明的顺序即优先级）：进门就看得见「我在哪」。
  return (
    <CenterTabsProvider initialModule={RAIL_ENTRIES[0]?.id}>
      <WorkspaceBody {...props} />
    </CenterTabsProvider>
  )
}

/** provider 之内的那一层——context 只能由 provider **下面**的组件消费。 */
function WorkspaceBody(props: ParentProps<WorkspaceEntryProps>) {
  const center = useCenterTabs()
  const 问大文件 = useBigFileAsk()
  /**
   * 左栏文件树的「打开」（2026-10-12）：闸门在 `center/open-file.ts`（纯模块、单测覆盖），
   * 这里只把真实的四件依赖接上去。三条闭包**在每次调用时读一次 `activePane()`**，
   * 保证「判已在栏里 / 切过去 / 开一张」落在同一栏（`打开文件的依赖.受焦栏` 的 doc）。
   */
  const 打开文件 = createOpenFile({
    module: () => center.module() ?? "project",
    受焦栏: () => {
      const pane = center.activePane()
      return {
        已有: center.pane(pane).tabs.map(contentTabKey),
        切到: (key) => center.activate(key, pane),
        开: (tab) => center.open(tab, pane),
      }
    },
    stat: (path) => {
      const id = currentProject()?.id
      if (!id) return Promise.resolve(undefined)
      return statProjectFile(id, path)
    },
    dialog: 问大文件,
    看见改过,
  })
  /**
   * 项目面板开没开。**放在这里而不是面板里**：面板是「滑出」的浮层，开关它的按钮在锚点行上
   * （`▾` / `＋`），两者分属两个组件 ⇒ 状态只能落在共同祖先（本组件）里。
   * 这是个纯 UI 开关（`2026-09-11-项目管理-design.md` §3：点 `▾` 滑出），不是共享数据，
   * 所以不进接入缝。
   */
  const [panelOpen, setPanelOpen] = createSignal(false)
  /**
   * 成员面板开没开（T010）。理由同 `panelOpen`：开关它的按钮（`👥 N` 徽章）在锚点行上，
   * 而面板本身在下面，两者分属两个组件 ⇒ 状态只能落在共同祖先里。同样是纯 UI 开关，不进接入缝。
   *
   * **两个浮层互斥**（开一个就关另一个）：左栏只有一列宽，两块浮层叠在一起是「坏了」的样子，
   * 不是风格选择——所以两处开关都顺手把对方收掉。
   */
  const [memberOpen, setMemberOpen] = createSignal(false)
  /**
   * 左栏 ② 当前停在哪个 tab（设计 §2：`[会话] [文件]`，**默认「文件」**）。
   *
   * 落在这里而不是 `SidebarTabs` 里，是因为**有两个读写方**：窄条点击要把它拨回「文件」
   * （设计 §5.1 步骤 2①），而它是左栏的状态、跟中栏模块一样是「我在哪」的一部分。
   * 与 `panelOpen` / `memberOpen` 同因：状态只能落在共同祖先。
   */
  const [sidebarTab, setSidebarTab] = createSignal<SidebarTabKey>("files")
  /**
   * 上下双树展开态（T012 / `2026-09-11-项目管理-design.md` §5.1）。理由同 `sidebarTab`——
   * **两个读写方**：④ 窄条点击展开它（步骤 2②），下树标题的 ✕ 收起它（步骤 4）；
   * 收起 ＝ 默认态（步骤 1「不常驻双树，避免挤占文件区」）。
   *
   * 与 `sidebarTab` 同属「左栏此刻长什么样」：两个信号一起决定「文件」pane 里是**一棵树**
   * 还是**上下两棵树**，所以同样只能落在共同祖先。
   */
  const [dualOpen, setDualOpen] = createSignal(false)

  /**
   * 右栏（AI 会话）开没开（2026-10-10 用户下达：图标栏那颗「AI 会话」是它的乒乓开关）。
   *
   * **初值 `true`**（用户同日裁定「默认展开」）：进门右栏就在 = 与改动之前**看到的样子一致**，
   * 也让会话路由（中栏在那里让位给右栏）不会一进去就是空白。点一下收起、再点呼出。
   *
   * **与 `center.module()` 是两条轴**，刻意分开：模块轴管「我在哪个业务模块」（决定左栏放什么、
   * 指令卡投影按哪个**业务**模块算——009 起投影走 `projectionModule()` 的记忆，见那边注释），
   * 这条只管右栏这一栏的开合。合着用正是改动前的毛病——点它把
   * `module` 换成 `"ai-session"`，左栏（只在 `module === "project"` 时渲染）**整列消失**，
   * 右栏却一动不动。语义与出处见 `rail/rail.tsx` 的 `RailProps.aiSessionOpen`。
   *
   * ⚠️ 状态落在这里而不是 `Rail` 里，与 `panelOpen` / `memberOpen` 同因：**读写方分属两个组件**
   * （图标栏那颗是写方、`ThreePane` 的 `rightCollapsed` 是读方），只能落在共同祖先。
   */
  const [aiSessionOpen, setAiSessionOpen] = createSignal(true)

  /**
   * 左栏（项目管理）开没开（2026-10-11 用户下达：图标栏那颗「项目管理」是它的乒乓开关）。
   *
   * **初值 `true`**（与右栏同一条裁定「默认展开」）：进门左栏就在 = 与改动之前**看到的样子一致**
   * ——`initialModule` 是 `RAIL_ENTRIES[0].id`（＝ `"project"`），左栏今天本来就默认露着。
   *
   * ⚠️ 它与 `center.module()` 也是**两条轴**，但读的时候必须**合取**（见下面的 `项目左栏开着`）：
   * 项目视图的左栏只在 `module === "project"` 时渲染。只留模块轴 ⇒ 收不起来；只留开关轴 ⇒ 切到别的
   * 模块后图标栏那颗还亮着，而左栏明明已经让位了。
   *
   * 009 T005 起它**只管项目视图**：AI 资产的左栏是另一份内容（`AssetNav`），不受这颗开关支配。
   *
   * 状态落在这里而不是 `Rail` 里，理由与 `aiSessionOpen` 逐字相同：**读写方分属两个组件**
   * （图标栏那颗是写方、`ThreePane` 的 `leftCollapsed` 是读方），只能落在共同祖先。
   */
  const [projectOpen, setProjectOpen] = createSignal(true)
  /**
   * AI 资产左栏的筛选状态（009 T005 / DESIGN §4.8）：空间多选、类型 Tab、单开手风琴。
   *
   * 落在这里而不是 `AssetNav` 里：T006 的中栏要按**同一份筛选**取数，两者分属两个组件
   * ⇒ 状态只能落在共同祖先（与 `panelOpen` / `sidebarTab` 同因）。
   */
  const assetFilter = createAssetFilter()
  /**
   * 左栏此刻装的是**哪个视图**（009 T005）。
   *
   * 2026-10-25 前这里只有「`module === "project"` 才有左栏」一条判据。009 起「AI 资产」是
   * **模块级页面**（D0-3 用户裁定），也要占同一列左栏、内容换成 `AssetNav` ⇒ 把「模块 → 视图」
   * 收成纯函数 `workspaceView()`（可单测），本组件只按它分派内容。
   */
  const 视图 = () => workspaceView(center.module())
  /**
   * T017：**进入** AI 资产视图就通知外面拉一次（含从别处切回来、含首帧就停在这里）。
   *
   * 停在别的视图时不触发——不是懒加载优化，是「切过来时拿到的必须是最新的一版」：
   * 只在挂载时拉一次的话，发布完再切过来看到的仍是旧清单。
   */
  createEffect(() => {
    if (视图() !== "ai-assets") return
    props.onAssetsOpen?.()
  })
  /**
   * 「项目管理那颗图标亮不亮」——**开关轴与模块轴的合取**（两轴各自的理由见上面那段）。
   *
   * ⚠️ 它只代表**项目视图的左栏**：AI 资产进来后左栏同样露着，但那颗图标**不该亮**
   * （`workspace-entry.test.tsx` 的 T005 第一条钉的就是 `aria-pressed=false`）——它表示的
   * 是「我在项目管理」，不是「左边有栏」。
   */
  const 项目左栏开着 = () => 视图() === "project" && projectOpen()
  /**
   * 「左栏这一列露不露」——两个视图共用的一列（`2026-09-11-项目管理-design.md` §2）。
   *
   * 两处读它、必须同取一个值：`ThreePane` 的 `leftCollapsed`（真的收不收）与它自己的
   * `left` 槽（放什么）。各算一遍就是「亮着却收着」那类不一致的温床（`#002-06`）。
   */
  const 左栏可见 = () => 视图() === "ai-assets" || 项目左栏开着()
  /**
   * 「项目管理」那一颗的动作（2026-10-11 用户下达）。
   *
   * ⚠️ 与「AI 会话」那颗**唯一的实质差别**：那颗**不是**任何模块（拨一下开关就行），这一颗
   * **同时还是「进 project 模块」的入口**。不先切回来的话，用户在别的模块上点它只会把开关翻成
   * 关，而**项目左栏**本来就因为模块不对而不在（009 起 AI 资产占着同一列，但那是另一份内容）
   * ——点一下看上去「什么都没发生」（正是 `#006-16` 那类「界面上走不到的路径」）。
   *
   * 「先切回来」那一支**顺手把开关置真**，不是取反：用户点它的意思是「我要左栏」。取反的后果
   * 是「点一下反而把刚出现的左栏又关了」（本文件 `左栏（项目管理）的乒乓开关` 那组用例的第三条
   * 钉的就是它）。
   */
  const 点项目管理 = () => {
    if (center.module() !== "project") {
      center.switchModule("project")
      setProjectOpen(true)
      return
    }
    setProjectOpen((open) => !open)
  }

  /**
   * 项目数据源（省略 = 一次都不发）。取一次存下来就够：应用里它是**开局定死**的
   * （`layout-new.tsx` 传的是常量），不值当为「会变的 prop」再写一层。
   */
  const projectData = props.projectData
  /**
   * 清单请求的**代次**——只有最新一代的响应能写缝。
   *
   * 为什么清单需要一道闸，而它看起来只是「进门拉一次」：写这个缝的有**两个出口**
   * （进门那一次、建完重拉那一次），两者都异步、都可能迟到。少了它，一个慢的进门响应能把
   * **刚建好的新项目**从清单里抹回去（`#004-01`：数出口要数「谁在写这个缝」，
   * 不是数「谁看起来像这一类」）。
   */
  let 清单代次 = 0
  const 拉清单 = async (data: ProjectData) => {
    const 代 = ++清单代次
    // 开问之前先清「取不到」：**「还没问回来」不是「取不到」**——两者在界面上正好相反
    // （前者什么都不该说，后者要说一句话）。少了这一行，点重试之后那句提示会一直赖着，
    // 直到回话才消失；写得再快一点就是「重试了、界面毫无反应」。同 `right-pane-source.ts:123`。
    setProjectListFailed(undefined)
    const 清单 = await data.list()
    // 被新的一代顶掉 ⇒ **不写缝、也不交出去**：`onMount` 的还原拿这份清单判「存档还在不在」，
    // 交一份过期的清单出去，就会凭着一份**已经不成立**的名单去认领项目（同一道闸的另一半）。
    if (代 !== 清单代次) return undefined
    setProjectList(清单)
    /*
      清单没取到 ⇒ 把这件**事实**写进缝（2026-10-11 用户实报的那条 500 撞出来的产品行为）。

      `openhive-project.ts` 的 `listProjects()` 三态里，两支都回 `undefined`：出口没挂上 / 网络错。
      这一层**不区分**它们——面板要说的话与能做的手术是同一句、同一颗钮（再来一次），
      把状态码翻成话是 `project-data.ts` 那一层的事，而它今天也翻不出更多花样。

      ⚠️ 只在**这一处**写：`拉清单` 是清单的唯一写入方（进门、建完、归档、找回、重试都过它）；
      在四个调用点各写一份就是 `LEARNINGS #004-01` 那种「谁记得谁接」。
    */
    setProjectListFailed(清单 === undefined)
    return 清单
  }

  /**
   * 「拉一次清单，拉到了就按存档把上次的当前项目还原回来」——进场那一次与**重试**共用这一份。
   *
   * 为什么重试要走**同一个函数**、不是在钮上写一句 `拉清单` 就完事：清单第一次没拉到时，
   * `onMount` 里那句「还原」**压根没执行过**（它挂在 `if (清单)` 后面）。只补拉清单不补还原的话，
   * 民警点完重试会看到「项目行回来了、左栏会话还是空的、锚点行还写着未选择项目」——他点的那颗钮
   * **只用一半的力气**，另一半（当初被那次 500 挡掉的那一步）没有人再去补，界面就永久停在
   * 半坏的状态里。抄一份到钮上也不行：那就是「清单怎么进缝」的第二份写法
   * （`LEARNINGS #002-06`），改一处忘一处。
   *
   * ⚠️ 这里**不判**「当前项目是不是还空着」：存档（cookie）与当前项目是**同时**写的
   * （`setCurrentProject` 唯一的写入点），所以存档本来就是「民警最后选的那个」——重试顺手把它
   * 拿去新清单里核一遍，是这条链本来的语义（不在清单里 / 已归档 ⇒ 清掉，见 `还原启动项目`
   * 的三支），不是多余的副作用。
   */
  const 拉清单并还原 = async (data: ProjectData) => {
    // ⚠️ 存档必须在**等之前**读（同步读）。挪到 `await` 后面看着更「新鲜」，实则是个陷阱：
    // 清单回来的那一拍（这里要等一次往返），民警完全可能已经点了别的项目——而 `setCurrentProject`
    // 是**同时**写信号与 cookie 的 ⇒ 那时读到的「存档」是**他刚点的那个**，再拿它去这份旧清单里核，
    // 不在清单里就**清掉**，界面上就是「我刚点的项目自己弹回去了」。
    // 实测（2026-10-11）：这一行挪到 `await` 后面，`workspace-entry.test.tsx` 立刻红两条——
    // 「切当前项目 ⇒ 文件树跟着换」与「换项目那一刻先清空成员」。
    const 存档 = 读项目cookie()
    const 清单 = await 拉清单(data)
    // 清单没回来（取不到，或被新的一代顶掉）⇒ 什么都不做：宁可停在「未选择」，也不凭一个此刻
    // 验证不了的存档去认领（那会造出「锚点行挂着它、面板里却没有这一行」的悬空态）。
    if (清单) 还原启动项目(存档, 清单)
  }

  /**
   * 文件动作（T020）：右键菜单那四项 ＋ 从桌面拖进来的上传。
   *
   * ## 复制 / 移动为什么是**两段**
   *
   * 点菜单那一刻只**开一个目标选择器**，一个请求都不发（用户 2026-10-06 裁定①）——
   * 「搬到哪个目录」是这次操作的一部分，不该由前端猜一个（猜到根上就等于**悄悄把它挪走了**——
   * 「它」自 2026-10-11 起可以是**一棵目录**，那就更不该猜）。
   * 于是状态里存着「正在搬谁、往哪个方向搬」，等用户点中目标才发请求。
   *
   * ## 搬忙：进行中把面板整个禁掉
   *
   * 不是防呆，是防**重放**：连点两下目标会发两个请求，第二个必然撞「目标已存在同名文件」，
   * 那句报错会让用户以为是自己操作错了。
   */
  const [待搬, set待搬] = createSignal<{ path: string; mode: "copy" | "move" }>()
  const [搬忙, set搬忙] = createSignal(false)
  /**
   * 界面上那一句话（`undefined` ＝ 没有话要说）。
   *
   * **只说没成的事**：办成了树自己会变（清单重取），再补一句「复制成功」是给屏幕加噪音
   * （同 T018 的 `onCreate` 「`undefined` = 收工」）。
   */
  const [文件话, set文件话] = createSignal<string>()
  /**
   * 弹窗宿主（`app.tsx` 那层 `DialogProvider`）——搬一批的失败报告走它。
   *
   * 本文件此前没有 `useDialog()`；挂载前提**没有增加**：`workspace-entry.test.tsx` 的挂具
   * 自 2026-10-11 起就套着 `DialogProvider`（`useDialog()` 无 Provider 时**抛错**）。
   */
  const dialog = useDialog()
  /**
   * 传输弹窗的状态（`undefined` ＝ 没有在显示）。运行中与完成态是**同一个弹窗**
   * （用户裁定：成功停在弹窗、点「关闭」才收）。
   */
  const [传输, set传输] = createSignal<FileTransferState>()
  /** 这一次传输的中断句柄；`undefined` ＝ 没有在跑的传输。 */
  let 传输控: AbortController | undefined
  /** 文件清单的重取代次：拨一下 ⇒ 上面那个 effect 重跑（它在读它）。 */
  const [清单重取, set清单重取] = createSignal(0)
  /**
   * 「再取一次清单」——今天有三个出处：**自己的**文件动作办成后（`收下` / 上传）、以及用户
   * 在右键菜单点「刷新」（T020+，2026-10-10）。三处都拨同一枚代次、走同一道闸；抽成名字是为了
   * 让「这是一件事、只是有几种说法」显出来（`LEARNINGS #002-06`：照同一前提做同一件事的，别各写一份）。
   *
   * ⚠️ 它**够不着**外部改动（AI 写盘 / 别的进程）——那些没有回调可挂，只能靠用户手点「刷新」。
   */
  const 拨清单重取 = () => set清单重取((代次) => 代次 + 1)
  /**
   * 成员动作（T021）那一对：界面上那一句话 ＋ 名单重取的代次。
   *
   * 与上面文件那一对**逐字同因**（`undefined` ＝ 没有话要说、拨一下 ⇒ 重取），所以不再各讲一遍。
   */
  const [成员话, set成员话] = createSignal<string>()
  const [名单重取, set名单重取] = createSignal(0)
  /** 上传的落点目录：右键「上传」时先定下（树给的是**目录**，见 `FileTreeProps.onUpload`），选中文件后才用得着。 */
  const [上传落点, set上传落点] = createSignal("")
  /** 那台隐藏的文件选择器（拖进来那条路不用它，两条入口都落在同一个 `传` 上）。 */
  let 文件选择器: HTMLInputElement | undefined
  /** 那台隐藏的**文件夹**选择器（`webkitdirectory`，2026-10-24）。与文件选择器是两个 `input`。 */
  let 文件夹选择器: HTMLInputElement | undefined

  /**
   * 进门：**还原**上次的「当前项目」，并拉一次清单。
   *
   * ## 一、还原（Task B · 2026-10-09，用户裁定 **A：跟随当前项目**）
   *
   * 005 定下「打开时**不自动选**项目」：spec 只写了两件事——FR-003「新建后成为当前项目」与
   * AC4「点某项目切换」，对「打开时选谁」一个字没写，用户 2026-10-06 裁定照 spec 字面**不自动选**。
   * 那条裁定**没有变**——它管的是「**没有任何存档**时选谁」，答案是「谁也不选」。
   *
   * 变的是**有存档**的那一支。006 Step 5 ②-1 给「当前项目」加了 **cookie 通道**，而 cookie
   * **活得比页面久** ⇒ 刷新之后信号回到 `undefined`（界面说没项目）、cookie 却还指着上次那个项目
   * ⇒ **界面说没有项目、请求落在旧项目目录里**（三席独立审查命中同一处，`LEARNINGS #003-02`）。
   *
   * 006 第二轮审查当时的处理（裁定 B）是**启动即清**，把 cookie 拉回会话级；用户 2026-10-09
   * 改判 **A：跟随当前项目**——把那份存档**读回来还原**，于是刷新之后左栏会话 tab 列的还是这个
   * 项目自己的会话（今天最直觉的行为）。「清」那一支并没有消失：存档**失效**（项目没了 / 已归档）
   * 时照样清，见 `还原启动项目` 的三支。
   *
   * ⚠️ 必须**等清单回来**才判得了「存档有没有效」（有效性就是「在不在清单里」）⇒ 还原落在拉清单
   * **之后**。清单没回来（`拉清单` 被新的一代顶掉）时**什么都不做**：宁可停在「未选择」，也不凭
   * 一个此刻验证不了的存档去认领（那会造出「锚点行挂着它、面板里却没有这一行」的悬空态）。
   *
   * ⚠️ **走 `读项目cookie` ＋ `还原启动项目`**（后者的唯一写入点是 `setCurrentProject`），不手搓
   * `document.cookie`：信号与 cookie 必须**同时**变，两处各写一份就是分叉的老家
   * （`LEARNINGS #002-06`）。`workspace-entry.test.tsx` 末尾那一节三条断言分别钉这三半。
   *
   * ⚠️ **「挂载即还原」只在「本组件每次启动只挂一次」时成立**，而那是**上游事实**：`NewAppLayout`
   * 落在**路由根**里（`app.tsx` 那段「lives in the router root so it remains mounted across route
   * changes」）⇒ SPA 换路由不重挂。若哪天它被挪到某个 `<Route>` 之下，也只是重复算一次同样的
   * 结果（信号已经是对的），但那条假设今天**没有断言钉着**，已登记在 `006/state.md` 缺口表。
   *
   * ## 二、拉一次清单
   *
   * 上面那一半要用它；它本身也是左栏面板的数据（进门拉一次）。
   */
  onMount(() => {
    if (!projectData) {
      // 没有数据源 ⇒ 判不了存档有没有效 ⇒ 不能还原；但也不能留着它与信号分叉（见上）。
      // 这里沿用裁定 B 的老行为清一次：此刻「清」与「不选」是同一个状态，没有信息可丢。
      if (读项目cookie() !== undefined) setCurrentProject(undefined)
      return
    }
    void 拉清单并还原(projectData)
  })

  /**
   * 当前项目变了就换文件清单（AC4：左栏文件树随之切换）。
   *
   * 三件事按顺序：**先清空**（`undefined` = 还不知道，不是「这个项目没有文件」；留着上一个项目的
   * 文件更糟——那看起来像**串项目**了）→ 去取 → 回来时确认自己还是最新的。
   * 第三件不是假想的竞态：取文件要一层层走（`openhive-files.ts`），大目录慢得多，
   * 连点两下换项目就够触发。这道闸用 `onCleanup`（而不是上面那个代次计数器）是因为
   * **这里有一个响应式的键**——每次重跑，Solid 自己就会跑上一轮的清理。
   *
   * ⚠️ **清空只在「换了项目」那一趟做**（2026-10-10，「刷新」落地时收的尾）：上面那句「先清空」
   * 的**本意是防串项目**，可这个 effect 还被 `清单重取` 拨着重跑（同项目重取）。无条件清空落在
   * 同项目上，就会让树整片变「还没有文件」再长回来——对刚被 AI 改过文件、正盯着屏幕等的用户，
   * 那看着像**文件全没了**。所以清空改由「`id` 与上一次不同」把门：换项目才清，同项目重取
   * 保留旧清单、等新清单回来再换。
   *
   * 「上一次的 id」用哨兵起头（`undefined` 是「还没有当前项目」的**合法值**，拿它作初值会让
   * 「进门第一次、且当时没有项目」那一趟被误读成「没换项目」而不清空）。哨兵只在这里活，
   * 不进任何信号——它是**给前后两趟比对的私账**，不是界面状态。
   */
  /**
   * 清单的取数状态——**「还没有答案」与「答案是没有」不同一句话**（2026-10-21 用户实报）。
   *
   * 真栈实测：点项目后 **6ms** 就显示「还没有文件」，数据 **2930ms** 才到。那 2.9 秒里
   * `projectFiles()` 是 `undefined`（取数没回来），旧空态把它当成了「确实没有文件」。
   *
   * 四态：`idle`（没有项目）/ `loading`（正在取）/ `ready`（取到了）/ `failed`（取不到）。
   * 交给树时只有 `loading` / `failed` 两句话，`idle` 与 `ready` 都传 `undefined`（走原空态 / 画树）。
   */
  const [文件清单态, set文件清单态] = createSignal<"idle" | "loading" | "ready" | "failed">("idle")
  const 没取过 = Symbol("清单还没取过")
  let 上次项目: string | undefined | typeof 没取过 = 没取过
  /**
   * 已发出（或已决定不发）的那一份清单是哪一趟要的：`项目 id + 重取代次`。
   *
   * 换项目 / 用户拨 `清单重取` ⇒ 这个键变 ⇒ 取；同一项目切页签、开关目标选择器 ⇒ 键不变 ⇒ 不重复取。
   * `undefined`（还没决定过）与任何键都不等，所以按需取数的第一趟一定取得上。
   */
  let 上次取的清单: string | undefined
  createEffect(() => {
    const id = currentProject()?.id
    const 重取 = 清单重取() // 读一下：文件动作办成之后拨它，清单就跟着重取（T020）——同一道闸、两处触发
    /**
     * **按需取数**（2026-10-21）：文件页签看得见、目标选择器开着、或组件外有人明确要
     * （`project-files.ts` 的 `请求文件清单`，Markdown 的引用文件选择器）才发请求。
     *
     * 默认页签就是「文件」⇒ 打开项目那一下照旧取；省掉的是「停在会话页签切项目」那一路。
     */
    const 要看 = sidebarTab() === "files" || 待搬() !== undefined || 文件清单请求() > 0

    if (id !== 上次项目) {
      上次项目 = id
      setProjectFiles(undefined)
      set文件清单态(id ? "loading" : "idle")
    }
    if (!id || !projectData) {
      set文件清单态("idle")
      return
    }
    if (!要看) return

    const 这一份 = `${id}\n${重取}`
    if (这一份 === 上次取的清单) return
    上次取的清单 = 这一份

    let 作废 = false
    onCleanup(() => {
      作废 = true
    })
    void projectData.files(id).then((paths) => {
      if (作废) return
      if (paths === undefined) {
        // 取不到：**有旧清单就留着**（刷新失败不能把已有的树抹掉——同 `FileTreeProps.status`
        // 的「旧清单优先」）；没有才如实说「取不到」，并让树给出重试。
        set文件清单态(projectFiles() === undefined ? "failed" : "ready")
        return
      }
      setProjectFiles(paths)
      set文件清单态("ready")
    })
  })

  /**
   * 当前项目变了就清空中栏（2026-10-12 分屏追加）。
   *
   * **为什么是独立的一份 effect，而不是塞进上面那份文件 effect 里**：`clear()` 内部要读一次
   * center 的 `state`（`clear: () => setState(clearContentTabs(state()))`）——这次读**发生在
   * effect 执行期**，会把本 effect 订阅到 `state`；紧接着 `setState` 就把它**再跑一次**（实测：
   * 写进上面那份文件 effect ⇒ 同一份 id 取两次文件，`没有当前项目时不取文件` 红成 `["p1","p1"]`）。
   * 单独一份 effect ＋ `上次清栏` 守门：即使被拨一次，`id` 已记过 ⇒ 收敛、不再动。
   *
   * **这份不用哨兵**（与上面那份不同）：哨兵管的是「进门第一趟、且当时没有项目」要不要把缝
   * 清掉——`projectFiles` 是**模块级**信号，上一个实例可能留了货，必须清。而 `center` 由
   * `CenterTabsProvider` **每次挂载新建**（本组件自己的 provider），一进来就是空的，没有
   * 「上一个实例的货」可清。哨兵在这里只会让进门第一趟多写一次空状态——那正是把
   * `module()` 这一族读口拨醒、重造左栏子树的元凶（见 `tab-context.tsx` 里 `module` 那个
   * memo 的注释）。
   *
   * 「换项目」与「文件清单清空」本就是一个判断的两半（`LEARNINGS #002-06`）：上面那份清
   * `setProjectFiles`、这份清 `center`，两半写在不同 effect 里，但**触发条件是同一行**
   * （`currentProject()?.id` 变了）。
   */
  let 上次清栏: string | undefined = undefined
  createEffect(() => {
    const id = currentProject()?.id
    if (id !== 上次清栏) {
      上次清栏 = id
      // 草稿按**路径**存，而路径只在项目内唯一：换了项目还留着旧草稿，下一次打开同名文件
      // 会看到上一个案子的字（用户实报「串项目」的同族）。与 `center.clear()` 同一拍。
      清空草稿()
      center.clear()
    }
  })

  /**
   * 当前项目变了就换成员名单（T021 / FR-004）。
   *
   * **写法与上面那份逐字同因**（同一个键 ＋ 先清空 ＋ `onCleanup` 作废），多出来的只是
   * 第二个触发点：名单还会被**自己的动作**改（邀请 / 移除办成 ⇒ 拨 `名单重取`）。文件那份
   * 由 `清单重取` 拨、这份由 `名单重取` 拨——两条链各有一枚代次，混用一枚的话，挪一个文件
   * 会白白重取一次名单。
   *
   * ⚠️ **名单只有一个来源**：`projectData.members(id)`。不从清单里那份 `memberCount` 推——
   * 那个数只够画徽章，画不出「谁是 owner」，而 `role` 正是权限判定的输入。
   */
  createEffect(() => {
    const id = currentProject()?.id
    名单重取() // 读一下：成员动作办成之后拨它
    setProjectMembers(undefined)
    if (!id || !projectData) return

    let 作废 = false
    onCleanup(() => {
      作废 = true
    })
    void projectData.members(id).then((名单) => {
      if (!作废) setProjectMembers(名单)
    })
  })

  /**
   * 一次成员动作的收尾：**办成** ⇒ 清话；**没办成** ⇒ 把服务端那句话留下。返回「办成了吗」。
   *
   * 三只共用一份——它们的回话约定逐字相同（同 `收下`）。返回布尔而不是让每个调用方再看一次
   * `结论.kind`，是为了让「怎么说清一次失败」只有一处（`LEARNINGS #002-06`）。
   */
  function 收成员话(结论: ProjectActionOutcome): boolean {
    if (结论.kind !== "done") {
      set成员话(结论.message)
      return false
    }
    set成员话(undefined)
    return true
  }

  /**
   * 邀请（FR-004：owner 与 member **都能**）。(`policeNo` 是**警号**——「谁是谁」的翻译在服务端，
   * 见 `openhive-members.ts` 文件头。)
   *
   * 办成 ⇒ **重取名单**，不把这个人本地拼进列表：服务端那份才是真相（同 T018「清单重拉」）。
   */
  async function 邀请(policeNo: string) {
    const id = currentProject()?.id
    if (!id || !projectData) return
    if (收成员话(await projectData.invite(id, policeNo))) set名单重取((代次) => 代次 + 1)
  }

  /**
   * 移除（FR-004：**仅 owner**，目标须是 member）。带的是**那一行**的警号——面板的 `onRemove`
   * 回传的是整行（`member-panel.tsx` 的 `onRemove` 注释），而这条出口说的是警号。
   */
  async function 移除(member: MemberEntry) {
    const id = currentProject()?.id
    if (!id || !projectData) return
    if (收成员话(await projectData.remove(id, member.policeId))) set名单重取((代次) => 代次 + 1)
  }

  /**
   * 退出项目（FR-004：member 可退、owner 不可退）。**不带警号**——退的永远是自己。
   *
   * 办成之后两件事都要做：
   * ① **收起面板**——退群之后「这个项目的成员管理」跟我没关系了；
   * ② **把名单清成 `undefined`**——缝里那份**还有我**，再点开面板会看到自己还在名单里
   *    （而三个动作里至少「退群」还画得出来，点了只会收到 403）。`undefined` 是老实话：
   *    **还不知道**（不是「这个项目没有成员」）。
   *
   * ⚠️ **不重取**：退了之后这条出口必然 403，发出去只是把「取不到」写进缝里，绕一圈回到同一个
   * 地方，还多一个请求。⚠️ 也**不清当前项目**：清单读的是 `project_ext`（与成员关系是两张表），
   * 退群之后那个项目照旧挂在清单里——清它是在跟清单打架（谁在管那份数据，见 `project.ts` 的
   * `handleList`），而「看不见」不是退群该有的后果。
   */
  async function 退群() {
    const id = currentProject()?.id
    if (!id || !projectData) return
    if (!收成员话(await projectData.leave(id))) return
    setProjectMembers(undefined)
    setMemberOpen(false)
  }

  /**
   * 当前项目**是不是已归档的**——从**清单**里查，不从 `currentProject()` 查。
   *
   * `CurrentProject` 那个形状只有 id / name / memberCount（T005 定的），归档这一项只在清单的
   * 那一行上（`ProjectEntry.archived`）。再养一份「当前项目归档了吗」的状态，就是同一个事实
   * 的第二处写法，而服务端那份清单是**唯一来源**（`LEARNINGS #002-06`）。查不到（清单还没到 /
   * 那一行不在清单里）⇒ **不归档**：归档与否最终由服务端判（`decide` 会拒），前端这一份只是
   * 用来「别把点了必然被拒的按钮画出来」。
   */
  const 当前已归档 = () =>
    projectList()?.find((项目) => 项目.id === currentProject()?.id)?.archived === true

  /**
   * 一次文件动作的收尾：**办成** ⇒ 清话 ＋ 重取清单，回 `undefined`；
   * **没办成** ⇒ **回**服务端那句话（一个字都不写进内联那行 `file-op-message`）。
   *
   * ## 为什么从「写共享信号」改成「回一句话」
   *
   * 改之前它把失败话写进 `文件话`，而 `文件话` 画在**工具栏下方**——那是「上传 / 下载」的
   * 发起面，不是新建弹窗 / 删除弹窗 / 树里那一行的发起面。于是民警在弹窗里点了确定，
   * 话掉到一棵树之外（2026-10-16 实报）。
   *
   * 现在报在哪儿由**各调用方**决定：`建条` / `改名条` / `删条` 把回话交回发起它的那个面；
   * `搬一批` / `传` 的**成功支**只借这一步的重取清单，故 `void` 掉返回值。
   *
   * ⚠️ **不往这里塞弹窗**：它只回一句话。`2026-10-15-…-design.md:170` 那条「这份重复是有意的、
   * 不要顺手合并」的警戒，前提是「把弹窗塞进 `收下` 会连带改掉另外三个动作的报告方式」——
   * 本设计不塞弹窗，那条前提没了。
   *
   * 「重取」而不是「本地拼」：服务端回的新路径**只用来报一句话**，界面上的真相永远是重取那
   * 一份（同 T018 的「清单重拉，不把新行拼进旧清单」）。
   */
  async function 收下(结论: FileOpOutcome): Promise<string | undefined> {
    // 只有 `done` 算办成；`rejected` 与 `failed` 都回那句话（**不按类别分形状**：
    // `rejected` 里既有「可改一处再交」的 400，也有「重试永远撞同一道门」的 401 / 403，
    // 见 spec §6 末段）。
    if (结论.kind !== "done") return 结论.message
    set文件话(undefined)
    拨清单重取()
    return undefined
  }

  /** 开目标选择器（复制 / 移动共用）。**此刻一个请求都不发**——目标还没选。 */
  function 要搬(path: string, mode: "copy" | "move") {
    set文件话(undefined)
    set待搬({ path, mode })
  }

  /** 把一份报告交给弹窗。报告弹窗是**只读**的，它不自己取数。 */
  function 报结果(值: 搬报告) {
    void dialog.show(() => <FileMoveReportDialog 报告={值} />)
  }

  /**
   * 把一批路径搬进 `dir`。**右键那条老路（`搬`）与拖拽那条新路共用这一份**——同一个动作的
   * 两条入口不许各写一套（`LEARNINGS #002-06`）。
   *
   * 逐个 `await`、分开记账：服务端一次搬一个，「几个成了」这句话只有在这一层说得出来
   * （与既有 `传()` 同一形状）。
   *
   * ## 全成那一支借 `收下()` 的重取清单
   *
   * `收下()` 是五个动作共用的结论口，但它**只回一句话、不画任何东西**（2026-10-16 改）。
   * 所以这里可以放心借它的「办成 ⇒ 清话 ＋ 重取清单」，返回值 `void` 掉即可。
   * **失败支仍各回各的面**：这里回报告弹窗，`传` 回内联那行（发起面不同，spec §3 的表）。
   */
  async function 搬一批(dir: string, 路径们: readonly string[], mode: "copy" | "move") {
    const id = currentProject()?.id
    if (!id || !projectData) return
    if (搬忙()) return
    set搬忙(true)
    const 成了: string[] = []
    const 没成: Array<{ 路径: string; 原因: string }> = []
    for (const path of 路径们) {
      const 结论 = mode === "copy" ? await projectData.copy(id, path, dir) : await projectData.move(id, path, dir)
      if (结论.kind === "done") 成了.push(结论.path)
      // 逐个留原因（不像 `传()` 只留第一句）：报告弹窗要逐条说清**哪一个**没成、为什么。
      else 没成.push({ 路径: path, 原因: 结论.message })
    }
    set搬忙(false)
    set待搬(undefined)

    if (没成.length === 0) {
      // 全成：借 `收下` 那一步的重取清单，返回值不用（移动 / 复制报在报告弹窗里，不在内联那行）。
      void 收下({ kind: "done", path: dir })
      return
    }
    set文件话(undefined)
    // 有成了的就得重取（盘上真变了）；全败**不重取**——磁盘一点没变，重取是空跑。
    if (成了.length > 0) 拨清单重取()
    报结果({ 标题: mode === "copy" ? "复制" : "移动", 成了, 没成 })
  }

  /** 点了目标选择器才真搬（右键那条老路）。拖拽那条新路直接调 `搬一批`。 */
  async function 搬(dir: string) {
    const 目标 = 待搬()
    if (!目标) return
    await 搬一批(dir, [目标.path], 目标.mode)
  }

  /**
   * 开一张传输弹窗，并记下「这一次」的中断句柄。
   *
   * ⚠️ `onClose`（Esc / 点遮罩 / 右上角 ×）走的是**和「取消」同一条**收尾：用户裁定
   * 「取消即关窗、不报错」，而「窗关了、传输还在后台偷偷继续」不是取消。
   * `show()` 的第二参**只有** Esc / 遮罩 / 关闭按钮会走到；取消按钮走 `onCancel`，两者同归宿。
   */
  function 开传输(初: FileTransferState, 控: AbortController) {
    传输控 = 控
    set传输(初)
    void dialog.show(
      () => <FileTransferDialog state={传输() ?? 初} onCancel={() => 收传输(true)} onClose={() => 收传输(false)} />,
      () => 收传输(true),
    )
  }

  /**
   * 收窗：`中断` 为真时同时掐掉那一枪。
   *
   * 可重入：`收传输` 自己调 `dialog.close()` 时，dialog 会回头调 `show` 注册的 `onClose`
   * （`context/dialog.tsx:48`）——第二次进来时 `传输控` 已清空、`close()` 也被它自己的锁挡住，
   * 不会把同一枪 abort 两遍、也不会把窗关两次。
   */
  function 收传输(中断: boolean) {
    const 控 = 传输控
    传输控 = undefined
    if (中断 && 控 && !控.signal.aborted) 控.abort()
    set传输(undefined)
    dialog.close()
  }

  /**
   * 上传一批文件到**同一个目录**（右键「上传」的文件选择器 ＋ 从桌面拖进来）。
   *
   * 两条入口都折成同一张任务表，真正的发送在 `传一批`——「几个成了、几个没成」这句话
   * 只有一份判断（`LEARNINGS #005-24`）。
   */
  async function 传(dir: string, files: readonly File[]) {
    await 传一批(files.map((file): FolderUploadTask => ({ file, dir, 显示名: file.name })))
  }

  /**
   * 上传**一整个文件夹**（2026-10-24 用户下达：右键上传只能选文件）。
   *
   * 浏览器交出来的是一份扁平的 `File` 清单（每个带 `webkitRelativePath`），而服务端：
   * **一次只收一个文件**、**落点目录必须已存在**、**`create` 不递归**。所以顺序是：
   * 先按相对路径算出要建哪些目录（浅的在前）→ 一个个建 → 再逐个上传（`传一批`）。
   *
   * 目录是否已存在**现取一份清单**再判：界面上的那份不知道 AI 在沙箱里建过什么，而重复建
   * 一个已有目录会被服务端回「已经有同名的东西了」，整批上传会在这里无谓地停下。
   *
   * 口径（用户裁定）：**保留所选文件夹本身**——在「资料」下上传「卷宗」，得到「资料/卷宗/…」。
   */
  async function 传文件夹(落点: string, files: readonly File[]) {
    const id = currentProject()?.id
    if (!id || !projectData) return
    set文件话(undefined)

    if (files.length === 0) {
      // 空文件夹：`webkitdirectory` 一个文件都交不出来，目录本身也就无从创建（浏览器的限制）。
      set文件话("选中的文件夹里没有文件（空文件夹传不上去）")
      return
    }

    const 清单 = await projectData.files(id)
    if (清单 === undefined) {
      set文件话("取不到文件清单，没有开始上传")
      return
    }

    const 计划 = folderUploadPlan(落点, files, 清单)
    if (计划.要建的目录.length > 0) {
      set搬忙(true)
      for (const dir of 计划.要建的目录) {
        const { parent, name } = 拆目录(dir)
        const 结论 = await projectData.createEntry(id, "directory", parent, name)
        if (结论.kind !== "done") {
          set搬忙(false)
          // 目录没建出来就**一个文件都不传**：落到不存在的目录只会得到 N 句「目标目录不存在」，
          // 把真正的第一处失败埋掉。
          set文件话(`建不出文件夹「${dir}」：${结论.message}`)
          return
        }
      }
      set搬忙(false)
    }

    await 传一批(计划.任务)
  }

  /**
   * 上传一张任务表（每项自带落点目录）。**逐个发**：服务端一次只收一个（`file.ts` 的
   * `handleUpload`），而「几个成了、几个没成」这句话只有在这一层说得出来。
   *
   * ## 弹窗与取消（2026-10-18）
   *
   * 运行中一张模态弹窗，百分比来自**当前文件**的字节进度；批量时另给「第 i / N 个」。
   * 取消 / Esc / 点遮罩都中断**当前这一枪**并关窗（用户裁定），已经传完的文件保留——
   * 服务端本来就是一次一个，中断只作用于正在飞的那一个。
   *
   * `显示名` 只在弹窗里用：文件夹上传时带路径（`卷宗/附件/说明.docx`），不同子目录里的
   * 同名文件才分得清。
   */
  async function 传一批(任务: readonly FolderUploadTask[]) {
    const id = currentProject()?.id
    if (!id || !projectData || 任务.length === 0) return
    set搬忙(true)
    set文件话(undefined)

    const 控 = new AbortController()
    const 总数 = 任务.length
    let 成了 = 0
    let 字节 = 0
    let 缘由: string | undefined

    // 初始态先画出来：点完「上传」到第一块数据之间不该是空白等待。
    开传输(
      {
        kind: "running",
        action: "上传",
        name: 任务[0].显示名,
        progress: { loaded: 0, total: 任务[0].file.size },
        ...(总数 > 1 ? { batch: { index: 1, total: 总数 } } : {}),
      },
      控,
    )

    for (const [序, 项] of 任务.entries()) {
      if (控.signal.aborted) break
      const { file, dir, 显示名 } = 项
      const 报进度 = (进度: TransferProgress) => {
        // 取消之后还在飞的那几块不许把弹窗状态写回来（否则 `收传输` 清掉的状态又活了）。
        if (控.signal.aborted) return
        set传输({
          kind: "running",
          action: "上传",
          name: 显示名,
          progress: 进度,
          ...(总数 > 1 ? { batch: { index: 序 + 1, total: 总数 } } : {}),
        })
      }
      报进度({ loaded: 0, total: file.size })
      const 结论 = await projectData.upload(id, dir, file, { signal: 控.signal, onProgress: 报进度 })
      // 取消 ⇒ **一个字的错都不报**（用户裁定「关窗、不报错」）。
      if (控.signal.aborted) break
      if (结论.kind === "done") {
        成了 += 1
        字节 += file.size
      }
      // 只留**第一句**：一批文件失败的原因常常是同一个，逐条堆出来会是一面墙。
      else 缘由 ??= 结论.message
    }
    set搬忙(false)

    // 取消：弹窗已由 `收传输` 收掉；已传上去的那几个要出现在树里，所以只拨清单。
    if (控.signal.aborted) {
      if (成了 > 0) 拨清单重取()
      return
    }

    const 没成 = 任务.length - 成了
    if (没成 === 0) {
      // 全成：借 `收下` 那一步的重取清单（移动 / 复制报在报告弹窗里，不在内联那行）。
      void 收下({ kind: "done", path: 任务[0].dir })
      // **停在弹窗**（用户裁定）：让「传了几个、多大」留在屏幕上，点「关闭」才收。
      set传输({ kind: "done", action: "上传", files: 成了, bytes: 字节 })
      return
    }

    // 失败不在这里弹第二张脸：关窗，落回文件树下方那行内联红字（沿用既有口径）。
    收传输(false)
    // ⚠️ 那句话只讲**其中一个**。不说清还有几个的话，界面会把「3 个里失败了 2 个」
    // 说成「失败了 1 个」——报一个数就得报准它（`LEARNINGS #003-04` 同族：写下的数要经得起复核）。
    set文件话(任务.length === 1 ? (缘由 ?? "上传文件失败") : `${缘由 ?? "上传文件失败"}（这批 ${任务.length} 个里 ${没成} 个没成功）`)
    if (成了 > 0) 拨清单重取()
  }

  /**
   * 下载：取字节 → 存到本地。
   *
   * 文件名从**路径的末段**取，不从响应头取：`project-data.ts` 的 `download` 只交出字节
   * （那一层要能在没有 DOM 的单测里跑，响应头过不去），而服务端在 `Content-Disposition` 里
   * 给的名字与路径末段是同一个（`file.ts` 的 `disposition(basename(target))`）。
   */
  async function 下载(path: string) {
    const id = currentProject()?.id
    if (!id || !projectData) return
    set文件话(undefined)
    const 控 = new AbortController()
    const 名 = 末段(path)
    开传输({ kind: "running", action: "下载", name: 名, progress: { loaded: 0, total: 0 } }, 控)

    const blob = await projectData.download(id, path, {
      signal: 控.signal,
      onProgress: (项) => {
        if (控.signal.aborted) return
        set传输({ kind: "running", action: "下载", name: 名, progress: 项 })
      },
    })
    // 取消 ⇒ 不报错、不落盘（弹窗已由 `收传输` 收掉）。
    if (控.signal.aborted) return
    if (!blob) {
      收传输(false)
      set文件话(`下载「${path}」失败`)
      return
    }
    存到本地(blob, 名)
    // 停在弹窗（同上传）：摘要用**实际取回的字节数**，不是 stat 的估值。
    set传输({ kind: "done", action: "下载", files: 1, bytes: blob.size })
  }

  /**
   * 打包下载：文件夹 / 多选 → 一个 zip（2026-10-20）。
   *
   * 与 `下载` 同一套弹窗与取消语义；差别只在数据源那一枪与结果形状：
   * - 包名在**这一刻**由纯函数算好（`now` 在这里给），服务端不解析它；
   * - 完成态的 `files` 来自响应的 `x-openhive-file-count`，`bytes` 用**实际取回**的 blob 大小。
   *
   * ⚠️ 取消判据仍看 `signal.aborted`，不看返回值：数据源在中断时可能回 `failed`
   * （它不知道用户是主动取消还是网络断），而界面对「用户取消」的处理是**什么都不说**。
   */
  async function 打包下载(paths: readonly string[], kind: ArchiveKind) {
    const 项目 = currentProject()
    // `CurrentProject.id` 是**可选**的（`current-project.ts`）：只判 `!项目` 不够，`项目.id` 仍是
    // `string | undefined`、给 `downloadArchive` 过不了类型门。判它才是「真的有项目可打包」。
    if (!项目?.id || !projectData) return
    set文件话(undefined)
    const 控 = new AbortController()
    const 名 = archiveName(项目.name, paths, kind, new Date())
    开传输({ kind: "running", action: "下载", name: 名, progress: { loaded: 0, total: 0 } }, 控)

    const 结果 = await projectData.downloadArchive(项目.id, paths, 名, {
      signal: 控.signal,
      onProgress: (项) => {
        if (控.signal.aborted) return
        set传输({ kind: "running", action: "下载", name: 名, progress: 项 })
      },
    })
    // 取消 ⇒ 不报错、不落盘（弹窗已由 `收传输` 收掉）。
    if (控.signal.aborted) return
    if (结果.kind !== "done") {
      收传输(false)
      set文件话(结果.message)
      return
    }
    存到本地(结果.blob, 名)
    set传输({ kind: "done", action: "下载", files: 结果.files, bytes: 结果.blob.size })
  }

  /**
   * 建一个新条目（T018）。`kind` / `parent` / `name` 三样都由文件树给：`parent` 是它按节点表
   * 判出来的**落点目录**、`name` 是用户在树上现敲的。
   *
   * ⚠️ 本层**一个字都不加工**——尤其不重判「这个名字合不合法」：判据在服务端只有一条
   * （`file.ts` 的 `usableName`），前端再判一遍就是会各漂一半的第二份（`LEARNINGS #002-06`）。
   * 被拒时服务端那句原话经 `收下` 到民警眼前（如「文件名里不能含 `:`…」）。
   */
  async function 建条(input: { kind: "file" | "directory"; parent: string; name: string }) {
    const id = currentProject()?.id
    if (!id || !projectData) return undefined
    // 把回话**原样**交回新建弹窗（`string` = 没办成 ⇒ 弹窗不关、就地报）。
    return 收下(await projectData.createEntry(id, input.kind, input.parent, input.name))
  }

  /** 改名（T018）：`path` 是**旧路径**、`name` 是新名字——两样都由文件树给（它手里有节点表）。 */
  async function 改名条(path: string, name: string) {
    const id = currentProject()?.id
    if (!id || !projectData) return undefined
    return 收下(await projectData.renameEntry(id, path, name))
  }

  /** 删除（T018）：文件直接删、**目录递归删**。二次确认在文件树那侧（FR-006），到这里已经确认过。 */
  async function 删条(path: string) {
    const id = currentProject()?.id
    if (!id || !projectData) return undefined
    return 收下(await projectData.removeEntry(id, path))
  }

  /**
   * 「现在有没有一个项目可以动」——建 / 改名 / 删这三项**接线与否**的判据。
   *
   * 三个 handler 各自也守着一条（拿不到 id 就不发请求），但那只是**兜底**：光靠它的话，树上的
   * ＋ 与 ✏️ 在没选中项目时**照样是亮的**，点下去什么都不发生——正是 `file-tree.tsx` 反复挡的
   * 那种谎（「看起来能点」比「少个按钮」更难查）。所以判据要落在**接线与否**上，让树自己置灰。
   *
   * ⚠️ 与 T020 那四项**今天还不一致**：`onCopy` / `onMove` / `onUpload` / `onDownload` 是无条件
   * 接的，其中「上传」在没选中项目时同样点得动、同样静默（复制 / 移动 / 下载被菜单的「要有作用
   * 对象」间接挡住，没选中项目时树通常是空的）。那是 T020 留下的账，改它要连它的用例一起动，
   * 不并进本条（登记在 `005/state.md`）。
   */
  const 有项目 = () => currentProject()?.id !== undefined

  /** 右键「上传」：先记下落点，再开系统文件选择器。落点由**树**给（它判的类型），本层不重判一遍。 */
  function 选文件(dir: string) {
    set上传落点(dir)
    文件选择器?.click()
  }

  /**
   * 选择器回来：交给 `传`，然后把输入框**清空**。
   *
   * 清空不是随手一笔：浏览器按 `value` 判「有没有变」，不清的话**同一个文件连选两次不会触发
   * `change`**——民警第一次传失败、想再传一次，第二次点它什么都不会发生。
   */
  function 选中(event: { currentTarget: HTMLInputElement }) {
    const 器 = event.currentTarget
    const files = Array.from(器.files ?? [])
    器.value = ""
    void 传(上传落点(), files)
  }

  /**
   * 右键「上传文件夹」：落点规则与「上传」**逐字相同**（树给的是目录），只是开的是另一台
   * `webkitdirectory` 选择器。
   */
  function 选文件夹(dir: string) {
    set上传落点(dir)
    文件夹选择器?.click()
  }

  /**
   * 目录选择器回来：先按相对路径建子目录，再逐个上传（`传文件夹`）。
   *
   * 同样**清空 `value`**：不清的话同一个文件夹连选两次不会触发 `change`（同 `选中` 那段）。
   */
  function 选中文件夹(event: { currentTarget: HTMLInputElement }) {
    const 器 = event.currentTarget
    const files = Array.from(器.files ?? [])
    器.value = ""
    void 传文件夹(上传落点(), files)
  }

  // ─── 备份 / 恢复接线（Task 17，2026-10-18） ───────────────────────────────────────
  //
  // 这一段的职责只有一件：把 Task 13 的十个 HTTP 出口、Task 15 的双树、Task 16 的恢复对话框
  // **接到一起**。口径全部来自 `2026-10-18-file-backup-snapshot-design.md` §5.1 / §6 / §8 / §11：
  //   · 需求唯一来源：spec（最高）；缺口 / 结构以两份 amend 为准（见 task-17 报告「权威顺序」）。
  //   · 五个信号（恢复点清单 / 选中恢复点 / 用量 / 任务 / 下树路径）都是**模块级**的，换项目
  //     必须清——留着上一个项目的货看起来像「串项目」（同 `projectFiles` 的既有口径）。

  /**
   * 把五个备份信号清成「还不知道」（`undefined`）。
   *
   * ⚠️ 三个态不能混：`undefined` ＝ 不知道、`[]` ＝ 明确没有、有值 ＝ 有。清空只能写 `undefined`
   * ——写 `[]` 是在替后端回答一个它还没回答的问题（`@/project/minio-backups` 文件头）。
   */
  const 清空备份信号 = () => {
    setBackupSnapshots(undefined)
    setBackupSnapshotId(undefined)
    setBackupUsage(undefined)
    setBackupJob(undefined)
    setMinioBackups(undefined)
  }

  /**
   * **项目代次**：换项目 / 卸载 / 项目从清单消失时递增，作废一切在飞的回包。
   *
   * 与文件清单的 `清单代次` 同因（`#004-01`）：取状态是**多段**异步（状态 → 恢复点清单 →
   * 选中恢复点的明细），一段慢下来就会在用户已经切走之后落地。`onCleanup` 不够用——这里没有
   * 「每次重跑由 Solid 自动清理」的响应式键，重取还有**第二个出口**（起完备份 / 删完恢复点）。
   *
   * ⚠️ 它与下面的 `重取代次` 是**两个量**：重取本身（轮询 / 起完备份）不能推进项目代次，否则
   * 正在 `等任务` 的那个长任务（预览动辄超过 1 秒）会被它自己的轮询判成「项目换了」而中止。
   */
  let 备份代次 = 0

  /**
   * **重取请求代次**：同一项目内，后发起的重取作废先前那一次的回包。
   *
   * 只保护「同一项目的两次重取谁先落地」，不参与「项目还在不在」的判断（那是 `备份代次`）。
   */
  let 重取代次 = 0

  /**
   * 重取**备份状态**：用量 ＋ 恢复点清单 ＋ 选中恢复点的文件清单。
   *
   * 三处必须提到组件作用域（amend R-3）：进门那一趟、`等任务` 收尾、`删恢复点` 办成后。
   *
   * ⚠️ 删恢复点后的重取**只能走这一条**，不能拨 `拨清单重取`——那条是**项目文件**清单，
   * 拨它等于每次删一个云上恢复点都重取一遍沙箱文件树（两件事，两个来源）。
   *
   * 选中项规则：上一次选中的恢复点还在新清单里就留着（轮询不跳选中项）；否则落到最新一条
   * （spec §11.2 的默认）。`undefined` ⇒ 下树明确空。
   */
  const 重取备份状态 = async () => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    const 代 = ++重取代次
    const 项目代 = 备份代次
    const 还有效 = () =>
      代 === 重取代次 && 项目代 === 备份代次 && currentProject()?.id === id
    try {
      const 状态 = await projectData.backupStatus(id)
      if (!还有效()) return
      // ⚠️ `undefined` 是「这次没问出来」，不是「服务端说没有任务」：只有拿到状态才写。
      // 写成 `状态?.activeJob ?? undefined` 的话，一次网络抖动就会清掉 `backupJob` ⇒ 1 秒轮询
      // 的 `在跑` 守卫当场失败，进度条消失且**再也不会回来**（三态见 `minio-backups` 文件头）。
      if (状态 !== undefined) {
        // 展示口径是 `usedBytes`（`MinioBar` / `MinioTree` 的 prop），服务端给的是 `usageBytes`。
        setBackupUsage({
          usedBytes: 状态.usageBytes,
          limitBytes: 状态.limitBytes,
          autoPaused: 状态.autoPaused,
        })
        setBackupJob(状态.activeJob ?? undefined)
      }

      const 清单 = await projectData.snapshots(id)
      if (!还有效()) return
      setBackupSnapshots(清单)
      if (清单 === undefined) {
        // 取不到 ⇒ 下树回到「还不知道」（不是「还没有备份」——那两句意思相反）。
        // 选中项也要一起清：留着旧 id，右键「从 MinIO 拉回」还能对一个界面上已经不在的
        // 恢复点起预览（F-5）。
        setBackupSnapshotId(undefined)
        setMinioBackups(undefined)
        return
      }
      const 选中 = backupSnapshotId()
      const 目标 = 选中 !== undefined && 清单.some((snapshot) => snapshot.id === 选中) ? 选中 : 清单[0]?.id
      if (目标 !== 选中) setBackupSnapshotId(目标)
      if (目标 === undefined) {
        setMinioBackups([])
        return
      }
      const 明细 = await projectData.snapshotDetail(id, 目标)
      if (!还有效() || backupSnapshotId() !== 目标) return
      setMinioBackups(明细?.files.map((file) => file.path) ?? undefined)
    } catch {
      // 网络层抛错按「取不到」处理：信号留在调用前的态（通常是清空后的 `undefined`），
      // 但**绝不**把异常漏成未处理的 rejection——它会变成整页的 unhandled error。
    }
  }

  /**
   * 起一个任务并等它跑完（预览 / 恢复共用，amend R-5）。
   *
   * 轮询间隔 1 秒；`job()` 第一轮就回终态时**不必等满 1 秒**（amend S-4，测试不必碰真实定时器）。
   * 收尾两件：① `setBackupJob(undefined)` ⇒ 窄条回到空闲态（spec §11.5「完成：窄条回到空闲态」）；
   * ② **重取状态** ⇒ 用量与恢复点清单跟着变（恢复完成可能新增 / 改变快照）。
   */
  const 等任务 = async (jobId: string, 守: { id: string; 代: number }) => {
    /** 跨过 await 之后先问「还是同一个项目、同一个实例吗」——否则回包会落进新项目。 */
    const 还在 = () => currentProject()?.id === 守.id && 守.代 === 备份代次
    for (let i = 0; i < 7_200; i += 1) {
      if (!还在()) return undefined
      const job = await projectData?.job(jobId)
      if (!还在()) return undefined
      if (job === undefined) return undefined
      setBackupJob(job)
      if (!在跑(job)) {
        setBackupJob(undefined)
        await 重取备份状态()
        return job
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    return undefined
  }

  /**
   * 一次手工备份 / 恢复有了结果（或压根没起起来）⇒ **开弹窗**（2026-10-18 用户下达）。
   *
   * 只接三样入口：`跑恢复`、`备份` / `备份越限`、`跟备份任务`——它们都只有一个「按键的人」。
   * 自动备份不经过这里，故不会凭空弹窗打断。窄条里的进行中进度 / 取消也不动。
   */
  const 报任务结果 = (result: TaskResult) => {
    // 弹窗已把这一次说清 ⇒ 底栏那行**上一次**动作的旧话不再成立（新一次起手时也会清，这里再清
    // 一次是防「失败 → 再试 → 弹窗说了新结果、底栏还挂着旧话」）。
    set文件话(undefined)
    void dialog.show(() => <TaskResultDialog result={result} />)
  }

  /**
   * 预览里有没有「必须先问用户」的东西（spec §6.1 / §6.4）。
   *
   * `missing` / `same` 不会覆盖任何本地内容 ⇒ 不必拦；`different` / `type-mismatch` 会动用户
   * 现有文件 ⇒ 要三选一。`.git` 内部路径另有确认（spec §6.4）⇒ 即使全是 `same` 也要问。
   */
  const 需确认 = (preview: BackupPreview): boolean => {
    if (preview.counts.different > 0 || preview.counts["type-mismatch"] > 0) return true
    // ⚠️ `localOnly` 是「只在本地、不会被恢复」的那一份（spec §6.6），拿它拦这次拖拽等于为一件
    // 不会发生的事问用户。`.git` 以服务端的 `gitAffected` 为准（按**完整目标集合**判，不受
    // `entries` 的 2000 条上限影响，整支复审 M-1）；既有扫描保留，兼容老服务端缺字段。
    return preview.gitAffected || preview.entries.some((entry) => entry.path.split("/").includes(".git"))
  }

  /**
   * 真发恢复请求并等它跑完，然后把结果说成一句话、重取项目文件清单。
   *
   * `decision` / `decisions` **原样**来自 `RestoreDialog`——`type-mismatch` 的默认 `skip` 已在
   * 对话框里补进 `decisions`（`backup-restore-dialog.tsx` 文件头），本层不再二次加工。
   */
  const 跑恢复 = async (
    id: string,
    input: { snapshotId: string; path: string },
    decision: RestoreDecision,
    decisions: Record<string, RestoreDecision>,
  ) => {
    if (!projectData || currentProject()?.id !== id) return
    const 守 = { id, 代: 备份代次 }
    const 还在 = () => currentProject()?.id === 守.id && 守.代 === 备份代次
    const 恢复 = await projectData.restoreBackup(id, { ...input, decision, decisions })
    if (!还在()) return
    if (恢复 === undefined) {
      报任务结果({ kind: "not-started", action: "恢复", message: "恢复没能起起来" })
      return
    }
    const 结果 = await 等任务(恢复, 守)
    // 任务跑完时项目已经切走 / 本实例已卸载 ⇒ 结果与那句话都不属于现在这个项目。
    if (!还在()) return
    if (结果 === undefined) {
      报任务结果({ kind: "not-started", action: "恢复", message: "恢复没有拿到结果" })
      return
    }
    // 结果走**弹窗**（2026-10-18 用户下达）：分色 / 零值折叠 / 失败详情都在
    // `task-result-dialog.tsx`。没拿到 `result.restore` 也照实弹——标题会按终态说清是哪一种。
    报任务结果({ kind: "restore", job: 结果 })
    拨清单重取()
  }

  /**
   * 从 MinIO 拉回一条路径（§6.1 的两个入口共用）：**先预览**，再决定要不要问。
   *
   * - 拖拽入口（`{ 必定确认: false }`）：全部 `missing` / `same` 且不涉 `.git` ⇒ **直接恢复**，
   *   不弹框（spec §6.1 末句「全部缺失或相同则无需确认」）。
   * - 右键入口（`{ 必定确认: true }`）：spec §6.1 第一入口就是「打开恢复对话框」，一律问。
   */
  const 拉回 = async (
    input: { snapshotId: string; path: string },
    选项: { 必定确认?: boolean } = {},
  ) => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    const 守 = { id, 代: 备份代次 }
    const 还在 = () => currentProject()?.id === 守.id && 守.代 === 备份代次
    const jobId = await projectData.previewRestore(id, input)
    if (!还在()) return
    if (jobId === undefined) {
      报任务结果({ kind: "not-started", action: "恢复", message: "预览没能起起来" })
      return
    }
    const job = await 等任务(jobId, 守)
    // 预览期间切走项目（或卸载）⇒ 既不能开对话框，也不能把「预览没取到」写到新项目上。
    if (!还在()) return
    const preview = job?.result?.preview
    if (preview === undefined) {
      报任务结果({ kind: "not-started", action: "恢复", message: "预览没取到" })
      return
    }
    if (!选项.必定确认 && !需确认(preview)) {
      await 跑恢复(id, input, "keep-both", {})
      return
    }
    void dialog.show(() => (
      <DialogV2 class="w-[min(34rem,calc(100vw-3rem))]">
        <RestoreDialog
          preview={preview}
          busy={在跑(backupJob())}
          onCancel={() => dialog.close()}
          onConfirm={({ decision, decisions }) => {
            dialog.close()
            void 跑恢复(id, input, decision, decisions)
          }}
        />
      </DialogV2>
    ))
  }

  /**
   * 预检期抢读任务（整支复审 I-1 / F-1）。
   *
   * `POST /backup` 在回 202 `{jobId}` **之前**同步跑完扫描 + 逐文件 sha256 + blob 枚举
   * （大项目几十秒到数分钟）。这段时间客户端手里没有 jobId，但服务端任务已经 `jobs.start`
   * 且阶段已上报 ⇒ 不抢读的话窄条一直空着：没有进度、没有取消钮，1 秒轮询的 `在跑` 守卫
   * 永远为假。这里在请求飞行期间每 200ms 读一次状态，接上在跑的任务就收手（之后由既有
   * 1 秒轮询接管），最多 10 次（约 2 秒）——**有界**，不造第二套轮询。
   *
   * 只写 `backupJob`（与 `重取备份状态` 同一个信号）；`仍在预检` 由调用方在请求回包时翻成
   * `false`，避免迟到的抢读覆盖成功支刚写下的状态。
   */
  const 盯上预检任务 = async (守: { id: string; 代: number }, 仍在预检: () => boolean) => {
    const 还有效 = () => 仍在预检() && currentProject()?.id === 守.id && 守.代 === 备份代次
    try {
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (!还有效() || !projectData) return
        const 状态 = await projectData.backupStatus(守.id)
        if (!还有效()) return
        const job = 状态?.activeJob ?? undefined
        if (在跑(job)) {
          setBackupJob(job)
          return
        }
      }
    } catch {
      // G-2：抢读失败不打扰用户，1 秒轮询在任务就绪后自会接管。
    }
  }

  /**
   * 起一次手动备份（右键与拖拽共用）。
   *
   * **一律整项目**（2026-10-18 用户裁定）：右键哪一行、从哪一行拖，只决定用户从哪个入口进来，
   * **不再收窄快照范围**——按选中项拍出来的「局部恢复点」会让用户在回看时只看到项目的一部分，
   * 误以为自己丢了文件。服务端 `path: ""` 即整项目（spec §3.2）。
   *
   * ⚠️ 成功支必须 `await 重取备份状态()`：只清 `文件话` 的话，`backupJob` 永远空着，而 1 秒
   * 轮询的守卫是 `在跑(backupJob())` ⇒ **永远不轮询**、窄条永远不显示进度（amend R-3 的死锁）。
   */
  const 备份 = async () => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    // ⚠️ N-1：进函数**第一行**（任何 await 之前）就钉住项目与代次，一路交给 `等任务` /
    // `跟备份任务`。晚到 `backup()` / 重取之后再读 `currentProject()`，可能已经是**另一个项目**
    // ——旧任务的终态会把旧项目的 snapshotId 选中到新项目上。
    const 守 = { id, 代: 备份代次 }
    const 还在 = () => currentProject()?.id === 守.id && 守.代 === 备份代次
    // F-1：请求飞行期间先抢读任务——预检期也要看得见进度、点得到取消。回包后立刻停手。
    let 预检 = true
    const 请求 = projectData.backup(id, "", false)
    void 盯上预检任务(守, () => 预检)
    const 起 = await 请求
    预检 = false
    // ⚠️ S-1：`backup()` 可能跨过切项目 / 卸载。回包既不能变成新项目的文案，也不能把
    // 超限框开在新项目上——**静默**返回（此刻用户已经在别处了，说什么都不属于这里）。
    if (!还在()) return
    if (起 === undefined) {
      报任务结果({ kind: "not-started", action: "备份", message: "备份没能起起来" })
      return
    }
    if ("code" in 起) {
      if (起.code === "quota_exceeded") {
        // spec §8.3：409 `quota_exceeded` ⇒ 先说清后果，再让用户选。
        set文件话(undefined)
        void dialog.show(() => (
          <确认框
            kind="quota"
            title="超出容量上限"
            message="本次备份将超出 10 GB 上限，自动备份会暂停，是否继续？（不会自动删旧恢复点）"
            onConfirm={() => void 备份越限(守)}
            onCancel={() => dialog.close()}
          />
        ))
        return
      }
      if (起.code === "job_running") {
        // 409 有两个来源（整支复审 F-5）：① 同一项目已有任务在跑（带 `jobId`）⇒ spec §11.6
        // 说一句「已接上进度」并取回状态；② **项目删除占位**（不带 `jobId`）⇒ 没有任务可接，
        // 说实情、也不重取（重取只会白打一趟）。
        if (起.jobId !== undefined) {
          set文件话("这个项目正在备份，已接上当前进度")
          await 重取备份状态()
          return
        }
        set文件话("项目正在删除，请稍后重试")
        return
      }
      报任务结果({ kind: "not-started", action: "备份", message: "备份没能起起来" })
      return
    }
    set文件话(undefined)
    // 两件都要：重取让进度**立刻**进窄条（R-3.2），跟进任务让成功之后选中新恢复点（§11.5）。
    await 重取备份状态()
    void 跟备份任务(起.jobId, 守)
  }

  /**
   * 超限确认之后带 `allowOverQuota: true` 再试一次（spec §8.3）。
   *
   * ⚠️ S-1：守由**打开超限框的那次 `备份`**传入（它进门第一行捕获的 `{ id, 代 }`）。
   * 在这里现读 `currentProject()` 会把「框开着期间用户切了项目」读成一个合法的守卫，
   * 于是以新项目身份跑一次旧项目的备份。
   *
   * 口径同 `备份`：**整项目**（`path: ""`），不继承任何选中项。
   */
  const 备份越限 = async (守: { id: string; 代: number }) => {
    dialog.close()
    if (!projectData) return
    if (currentProject()?.id !== 守.id || 守.代 !== 备份代次) return
    // G-1：与 `备份()` 同形——请求飞行期间先抢读任务，预检期也要看得见进度、点得到取消。
    let 预检 = true
    const 请求 = projectData.backup(守.id, "", true)
    void 盯上预检任务(守, () => 预检)
    const 起 = await 请求
    预检 = false
    if (起 === undefined || "code" in 起) {
      报任务结果({ kind: "not-started", action: "备份", message: "备份没能起起来" })
      return
    }
    set文件话(undefined)
    await 重取备份状态()
    void 跟备份任务(起.jobId, 守)
  }

  /**
   * 切恢复点（下树 `<select>`）：先改选中项、把下树置「还不知道」，再取那个恢复点的明细。
   *
   * 陈旧回包丢弃：切走项目、或用户又拨了另一个恢复点 ⇒ 这份回包作废（与 `重取备份状态`
   * 同一道防线；这里不共用代次，因为判据是**这两个值本身**，比代次更直接）。
   */
  const 选恢复点 = async (snapshotId: string) => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    setBackupSnapshotId(snapshotId)
    setMinioBackups(undefined)
    try {
      const 明细 = await projectData.snapshotDetail(id, snapshotId)
      if (currentProject()?.id !== id || backupSnapshotId() !== snapshotId) return
      setMinioBackups(明细?.files.map((file) => file.path) ?? undefined)
    } catch {
      // 同 `重取备份状态`：取不到就停在「还不知道」，不抛。
    }
  }

  /**
   * 跟住一个刚起的手动备份；成功就**选中新恢复点**（spec §11.5）。
   *
   * ⚠️ 光靠备份成功后的 `重取备份状态()` 不够：选中项规则会保留「旧 id 还在清单里」的那一个，
   * 而新快照恰好是**追加**进去的 ⇒ 用户看到的仍是旧恢复点。服务端把新 id 写在终态 job 的
   * `result.snapshotId` 里，这里把它取出来显式选中。
   *
   * 自动备份（服务端发起、本层没有 jobId）不抢用户选中项——本版只处理手动备份。
   */
  const 跟备份任务 = async (jobId: string, 守: { id: string; 代: number }) => {
    try {
      const job = await 等任务(jobId, 守)
      // 等任务跨了 await：项目切走 / 卸载后，这个 job 的新快照不属于现在的项目。
      // ⚠️ 守是**调用方进门第一行**捕获的那一对值（N-1）；在这里重新读 `currentProject()`
      // 会把「已经切到新项目」这件事读成一个合法的守卫。
      if (currentProject()?.id !== 守.id || 守.代 !== 备份代次) return
      // 没有终态任务（轮询没拿到）也要说一声：用户按了「备份」，不能什么都没发生。
      if (job === undefined) {
        报任务结果({ kind: "not-started", action: "备份", message: "备份没有拿到结果" })
        return
      }
      // 成功 / 失败 / 取消都弹（2026-10-18 用户下达）；自动备份不经过这里。
      报任务结果({ kind: "backup", job })
      const 快照 = job.result?.snapshotId
      if (typeof 快照 !== "string") return
      await 选恢复点(快照)
    } catch {
      // 后台跟进失败不打扰用户：窄条已回到空闲态，下一次进门会重取状态。
    }
  }

  /**
   * 删除恢复点（spec §8.5：**先确认后调用**）。
   *
   * 这里只负责**开确认框**；真删在 `执行删恢复点`。两条用例分别钉「确认前没调」与「确认后调了」
   * ——合成一条的话，变异只会把红停在最先撞倒的那句上（`#005-46`）。
   */
  const 删恢复点 = (snapshotId: string) => {
    const id = currentProject()?.id
    if (!id || !projectData) return
    void dialog.show(() => (
      <确认框
        kind="delete-snapshot"
        title="删除这个恢复点？"
        message="删除后不可恢复；项目里的文件不受影响。"
        pendingText="正在删除…"
        // 返回 Promise：`确认框` 靠它把「正在删除…」撑到回包（2026-10-21 用户反馈：
        // 点完删除框一关、屏幕上什么都没变，分不清「还在删」和「压根没删」）。
        onConfirm={() => 执行删恢复点(id, snapshotId)}
        onCancel={() => dialog.close()}
      />
    ))
  }

  const 执行删恢复点 = async (id: string, snapshotId: string) => {
    if (!projectData) {
      dialog.close()
      showToast({ variant: "error", title: "恢复点没删掉", description: "项目还没准备好，请稍后再试" })
      return
    }
    // 与 `跑恢复` / `备份` 同形：`deleteSnapshot` 跨了 await，切走项目（或卸载）之后
    // 这次回包不能把结果写到新项目的界面上（整支复审 F-4）。
    const 守 = { id, 代: 备份代次 }
    const 还在 = () => currentProject()?.id === 守.id && 守.代 === 备份代次
    const 成 = await projectData.deleteSnapshot(守.id, snapshotId)
    // 用户已经切走 ⇒ 静默收框；此刻说什么都不属于新项目。
    if (!还在()) {
      dialog.close()
      return
    }
    if (!成) {
      dialog.close()
      // 失败只在动作点说（中栏那行离 MinIO 窗口太远，用户看不到）；原因拿不到——
      // `deleteSnapshot` 把 409 / 503 / 网络都折成 `false`，能说的只有「重试」。
      showToast({ variant: "error", title: "恢复点没删掉", description: "请稍后再试；若一直失败，可能是 MinIO 暂时不可用" })
      return
    }
    set文件话(undefined)
    // 先刷新清单**再**关框：关框那一刻界面上那一行必须已经没了，否则又回到「框关了、
    // 屏幕原样」的老样子（用户看到的仍是「没变化」）。
    await 重取备份状态()
    if (!还在()) {
      dialog.close()
      return
    }
    dialog.close()
    showToast({ variant: "success", title: "恢复点已删除" })
  }

  /**
   * 进门 / 换项目：**同步**取一次状态并发一次心跳，之后 60 秒心跳 ＋ 1 秒轮询（仅在跑时）。
   *
   * ⚠️ 首 tick 一律走**同步调用**、不依赖 60s / 1s 定时器（amend S-4）：定时器只负责「之后」，
   * 让测试与首屏都不必等一个真实周期。
   *
   * ⚠️ 轮询守卫是 `在跑(backupJob())`，不是 `backupJob() !== undefined`：终态任务会在服务端
   * 注册表里留 10 分钟（spec §8.4），「有任务」不等于「任务在跑」（amend R-3）。
   */
  createEffect(() => {
    const id = currentProject()?.id
    备份代次 += 1 // 换项目 ⇒ 上一轮还在飞的请求作废
    清空备份信号()
    if (!id || !projectData) return

    void 重取备份状态()
    void projectData.heartbeat(id)
    const 心跳 = setInterval(() => void projectData.heartbeat(id), 60_000)
    const 轮询 = setInterval(() => {
      if (!在跑(backupJob())) return
      void 重取备份状态()
    }, 1_000)
    onCleanup(() => {
      备份代次 += 1
      clearInterval(心跳)
      clearInterval(轮询)
    })
  })

  /**
   * 当前项目**从清单里消失**（被删 / 被归档 / 被移出）时清空五个备份信号。
   *
   * 与上面那份 effect 是**两条触发**：那份看 `currentProject` 变没变，这份看「当前项目还在不在
   * 清单里」——删项目那条链**不会**保证先清当前项目（面板可能还没来得及），少了这份，旧项目的
   * 恢复点会留在界面上，看起来像「删了还在」。
   *
   * ⚠️ 只用既有清单 `projectList()`，不新造第二份判断（`#002-06`）；清单还没取到
   * （`undefined`）时**不动**——「还没问」不是「已经没了」。
   */
  createEffect(() => {
    const id = currentProject()?.id
    const 清单 = projectList()
    if (id === undefined || 清单 === undefined) return
    if (清单.some((项目) => 项目.id === id)) return
    // 光清信号不够：此刻可能正有一份「旧项目」的请求在飞，而它的项目 id **没变**
    // （`currentProject` 还是它）⇒ 不推进代次的话，它回来时 `还有效()` 仍成立、会把旧恢复点
    // 写回并永久残留（F-3）。
    备份代次 += 1
    清空备份信号()
  })

  return (
    // 右栏投影模块的记忆（009 T005 / D0-6）：进入「AI 资产」后右栏仍按**进入前**的业务模块投影。
    // 挂在最外层是为了让 `props.right`（`AiSessionSlot` 由 `ThreePane` 惰性创建）也落在作用域内
    // ——Solid 的 context 按 owner 树传递，后创建的后代照样读得到。
    <ProjectionModuleProvider>
      {/* 图标栏是**三栏之外**的独立一列（DESIGN §4.1：图标栏 56px → 左项目侧栏 280px → 中 → 右），
          故不能塞进 `ThreePane` 的 `left` 槽（那是左项目侧栏，005 T005 起交给 `ProjectAnchor`）。
          外层这层行容器因此必需：挂载点 `<main>`（layout-new.tsx）是 `flex-col`，
          直接并列两个子元素会变成上下堆叠。 */}
      <div data-component="workspace-entry" class="flex-1 min-h-0 min-w-0 w-full flex">
        <Rail
          active={center.module()}
          // ⚠️ 这颗收到的 id **永远不是** `"project"` / `"ai-session"`：那两颗的出口在下面几条，
          // 不经过这里（`rail.tsx` 里按 `PROJECT_ENTRY_ID` / `AI_SESSION_ENTRY_ID` 分流）。故
          // `module` 不会再变成 `"ai-session"`——那正是改动前「点它左栏消失」的成因。
          onSelect={(id) => center.switchModule(id)}
          // 左栏那颗乒乓开关（2026-10-11 用户下达）。高亮与出口是**同一条轴的两半**，都喂给同一颗
          // 入口（见 `RailProps.projectOpen`）。⚠️ 喂的是 `项目左栏开着()`——与模块轴**合取过**的那个，
          // 不是裸的 `projectOpen()`：否则切到别的模块后它还亮着（左栏已经让位了）。
          // 009 T005：AI 资产下左栏照旧露着，但这颗**不亮**（它表示「我在项目管理」）。
          projectOpen={项目左栏开着()}
          onToggleProject={点项目管理}
          // 右栏那颗乒乓开关（2026-10-10 用户下达）。同上一对的理由（见 `RailProps.aiSessionOpen`）。
          aiSessionOpen={aiSessionOpen()}
          onToggleAiSession={() => setAiSessionOpen((open) => !open)}
          // 「系统设置」那颗**不切模块**：它开对话框，动作由入口层注入（见本文件 `onOpenSettings`
          // prop 上那段注释）。
          onOpenSettings={props.onOpenSettings}
          capabilities={props.capabilities}
        />
        {/* 左栏按模块分内容（`2026-09-11-项目管理-design.md` §2：左栏是「项目管理 / AI 资产」两入口
            共用的一列）。009 T005 起两个入口都有内容：项目视图是项目侧栏，AI 资产是 `AssetNav`。
            ⚠️ 条件必须落在 `left` **prop 本身**：包一层 `<Show>` 再传进去是错的——`ThreePane` 判的是
            `props.left !== undefined`，`<Show>` 元素恒非 `undefined`，于是空态下会留下一条 280px 空栏。
            ⚠️ 2026-10-11 起这一列有**两道门**：内容门（`left` 的三元，管「这一列放什么」）＋
            开关门（`leftCollapsed`，管「用户把它收起了没」）。开关门只归**项目视图**。 */}
        <ThreePane
          // 左栏那颗乒乓开关的**执行端**（2026-10-11 用户下达）：收起时 `ThreePane` 整块 `<Show>`
          // 不渲染 ⇒ 左栏**连同 `ResizeHandle` 一起**让位，中栏是 `flex-1 min-w-0`，自然吃满——
          // 「中栏宽度自动适应」不需要另写一行宽度逻辑（与右栏 `rightCollapsed` 逐字同因）。
          // ⚠️ 它与 `left` 是**两个独立的门**（`有左栏 = props.left !== undefined && !props.leftCollapsed`），
          // 而这里喂的是 `左栏可见()`：AI 资产恒露（左栏是它的唯一导航），项目视图才受开关支配。
          leftCollapsed={!左栏可见()}
          left={
            视图() === "ai-assets" ? (
              <AssetNav
                filter={assetFilter}
                categories={props.categories?.rows}
                categoriesError={props.categories?.error}
              />
            ) : 视图() === "project" ? (
              // 这一层 `relative` 是给面板当定位祖先的：面板按设计 §3 是**滑出**的浮层
              // （「点项目名 ▾ 滑出」），不能挤掉下面 §2 的 ②tab / ③文件树。
              // 代价：左栏的第一层从「锚点行」变成这个容器——`workspace-entry.test.tsx` 里
              // T005 那条「锚点行是左栏第一个孩子」的断言因此改成了「锚点在左栏里」。
              <div data-component="project-sidebar" class="relative flex h-full min-h-0 w-full flex-col">
                <ProjectAnchor
                  name={currentProject()?.name}
                  memberCount={currentProject()?.memberCount}
                  onToggleList={() => {
                    setMemberOpen(false)
                    setPanelOpen((open) => !open)
                  }}
                  // 👥 徽章：滑出成员面板（T010）。`ProjectAnchor` 早在 T005 就预留了这个回调
                  // （注释点名「接的是 T010 的成员面板」），今天才接上——在那之前它渲染成 `disabled`。
                  // 今天只有**共享项目**有徽章（`memberCount` 非空），私有项目没有成员管理这回事。
                  onOpenMembers={() => {
                    setPanelOpen(false)
                    setMemberOpen((open) => !open)
                  }}
                  // `＋` 就是「打开面板」——面板置顶就是「＋新建项目（私有/共享）」
                  // （设计 §3：「置顶最易达」）。
                  // T018 接上落库后**定过一次**（用户 2026-10-06 裁定：面板内联一行命名输入），
                  // 结论是 `＋` 保持现状、不直达表单：直达要在这里再养一份「起名」状态，而面板
                  // 那一份已经在了（`project-panel.tsx` 的 `起名`）——两份状态就得再定谁先谁后。
                  onCreate={() => setPanelOpen(true)}
                />
                <Show when={panelOpen()}>
                  {/*
                    槽**自己**给出高度上限（2026-10-11 用户实报「三个 tab 没有滚动条」）。

                    ⚠️ 上限只能落在这里、落不在面板里：面板不知道自己在屏幕的哪一段，而槽知道
                    ——`top-10`（2.5rem）是它自己写下的偏移，`100%` 解析到包含块
                    （`project-sidebar`，`relative h-full`）的高度 ⇒ 两者一减就是「从面板顶到侧栏底」
                    这段可用高度。`max-h-[calc(100%-2.5rem)]` 与 `top-10` **是同一个数**，改一个要改另一个。

                    ⚠️ `flex flex-col` 是让上限**真的生效**的那一步：面板是 flex 子项，配它自己那条
                    `min-h-0` 才压得下去。少了 `flex`，`max-h` 只是把槽的**盒子**截短，面板照样
                    按内容高溢出（盒子里没有布局纪律去压缩子项）。

                    ⚠️ 高度保持 `auto`（不用 `bottom-0`）：槽是**透明**的浮层，撑满整个侧栏会
                    把下方文件树与输入条的点击**整片挡住**。内容高＋上限，挡住的面积就等于面板本身。
                  */}
                  <div
                    data-slot="project-panel-slot"
                    class="absolute inset-x-0 top-10 z-10 flex max-h-[calc(100%-2.5rem)] flex-col px-1"
                  >
                    <ProjectPanel
                      projects={projectList()}
                      currentId={currentProject()?.id}
                      /*
                        清单取不到 ⇒ 面板说一句话 ＋ 一颗「重试」（2026-10-11）。

                        重试走的是**进门那一次用的同一个函数**（`拉清单并还原`）：既补拉清单，
                        也补上「按存档还原当前项目」那一步——那一步当初正是被这次失败挡掉的，
                        不补的话钮只用一半力气（行回来了、左栏会话还是空的），见那个函数的注释。
                        不另开一条「重试专用」的路：那等于把「清单怎么进缝」抄第二遍
                        （`LEARNINGS #002-06`）。

                        `void` 是刻意的：面板那颗钮的语义是「再来一次」，不是「等它出结果」
                        ——结果由缝回流到面板（成了行会出现、没成那句话留着），钮不必再回一句话。
                        **没数据源时照样接**（不像 `onCreate` 那样判 `projectData`）：重试要的是
                        「再问一次」，而没有数据源时「取不到」根本不会成立（连请求都没发过），
                        真实分支也走不到那儿。
                      */
                      loadFailed={projectListFailed()}
                      onRetryLoad={
                        projectData ? () => void 拉清单并还原(projectData) : undefined
                      }
                      onOpen={(project) => {
                        // 「点一下直达」（设计 §3）：切当前项目并把面板收起来——留着它挡在
                        // 文件树前面，正是「直达」的反面。
                        setCurrentProject({
                          id: project.id,
                          name: project.name,
                          memberCount: project.memberCount,
                        })
                        setPanelOpen(false)
                        /*
                          记一次「我打开了它」（T024 / FR-008 的「3 个月无操作」）。

                          ⚠️ **触发点只能是这里**（不是「拉清单时顺手刷一下」）：列项目是做
                          「算超期」那件事，把它变成写入方，超期判定就恒假、提醒永远不出现，
                          而且不报错、不变红（`openhive-project.ts` 的 `touchProject` 讲了这条）。

                          `void` 是刻意的、不是偷懒：这条链**没有失败态要显示**（服务端没记上
                          最坏只是这个项目照旧算超期），所以既不 `await`（不让一次记账拖慢
                          「点一下直达」）、也不接回话（它只回一个布尔，没有话要说）。
                          没数据源 ⇒ 连请求都不发（`?.`，与上面几条「未接线即禁用」同一规矩）。
                        */
                        void projectData?.touch(project.id)
                      }}
                      /*
                        新建（FR-003）。没数据源就**不传** ⇒ 面板照旧渲染成禁用态
                        ——「未接线即禁用」，与项目行不可点、锚点行三个按钮同一条规矩。

                        回话的约定：**字符串 = 没建成**（面板把它显示在输入框下并留住输入框），
                        `undefined` = 收工。把「拒绝 / 失败」翻成一句给民警看的话是在这里做的
                        ——面板不认识 HTTP，它只管有没有话要说。
                      */
                      onCreate={
                        projectData
                          ? async (input) => {
                              const 结论 = await projectData.create(input)
                              if (结论.kind !== "created") return 结论.message
                              // FR-003：新建后**成为当前项目**。用服务端给的 id，不自己编
                              // ——`x-openhive-project` 那个头要拿它去定位目录（T017 的中间件），
                              // 前端编的 id 后端不认。
                              setCurrentProject({
                                id: 结论.project.id,
                                name: 结论.project.name,
                                memberCount: 结论.project.memberCount,
                              })
                              // 清单**重拉**，不把新行拼进旧清单：旧清单可能压根还没到
                              // （`undefined` = 还不知道），拼上去就成了「一个不完整的清单当完整的用」。
                              await 拉清单(projectData)
                              // 明写 `undefined`，不靠落空：这一支的两个出口都回值（没建成回一句话、
                              // 建成回「没有话要说」），漏写这个 `return` 会被 `consistent-return` 告警。
                              return undefined
                            }
                          : undefined
                      }
                      /*
                        归档（FR-008 / T023）。**破坏性**操作，所以办成之后有两件收尾：

                        ① **清单重拉**——那一行不再属于「全部」了。不把旧清单抠掉那行，正是因为
                           清单是缝里的只读数据，而重拉还能顺带把**别人**的改动带回来。
                        ② 归档的要是**当前项目**，就把它清掉：不清的话锚点行还挂着它，而它的沙箱
                           已经删了——民警点进去看到空目录，文件其实在 MinIO 上（这正是「界面显示一个
                           已经不存在的东西」，不是在收拾现场）。
                           清的是**被归档的那一个**，不是「有归档就清」：归档别人不动当前项目。

                        没办成 ⇒ 把服务端那句话原样交回去（`结论.message`——`rejected` 与 `failed` 两支
                        都带它，接线这一层不需要、也不该分开看），前端不自己改写措辞——它不知道是哪一条
                        规则挡下的（同 T018 的 400 那条）。
                      */
                      onArchive={
                        projectData
                          ? async (project) => {
                              const 结论 = await projectData.archive(project.id)
                              if (结论.kind !== "done") return 结论.message
                              if (currentProject()?.id === project.id) setCurrentProject(undefined)
                              await 拉清单(projectData)
                              return undefined
                            }
                          : undefined
                      }
                      /*
                        找回（FR-009 / T023）。**不碰当前项目**：找回一个项目不等于切到它
                        ——「点一下直达」是 `onOpen` 的事，这里只把清单重拉一次
                        （那一行从「已归档」回到「全部」）。

                        ⚠️ 归档与找回**都不带 `x-openhive-project` 头**，`project-data.ts` 那两个
                        方法已经钉住了这件事（带了的话，找回会被 T017 中间件的第一道门自己挡在
                        门外——那个项目**永久找不回来**）。
                      */
                      onRestore={
                        projectData
                          ? async (project) => {
                              const 结论 = await projectData.restore(project.id)
                              if (结论.kind !== "done") return 结论.message
                              await 拉清单(projectData)
                              return undefined
                            }
                          : undefined
                      }
                      /*
                        改名（2026-10-16）。办成之后：**清单重拉 ＋ 按存档把当前项目从新清单里重导回来**。

                        为什么走 `拉清单并还原` 而不是只 `拉清单`：`拉清单` 只写 `projectList` /
                        `projectListFailed`，**从不写 `currentProject`**——改名的要是**当前项目**，
                        只拉清单会让面板显示新名、锚点行（读 `currentProject()?.name`）**永久停在
                        旧名**，直到重新点开或整页刷新（评审 Important，2026-10-16）。
                        为什么不就地改 `currentProject()` 里的名字：就地改会造出**两处名字来源**——
                        面板读清单、锚点行读 `currentProject()`，改一处漏一处时就出现「面板上新名字、
                        左栏锚点上旧名字」且不报错（`LEARNINGS #004-02`：一份判定不要长出两个投影）。
                        所以「重导」仍走 `还原启动项目` 这一条既有的唯一出口，不另开第二份真相。

                        没办成 ⇒ 把服务端那句话原样交回去（同 `onArchive`：`rejected` 与 `failed`
                        两支都带 `message`，接线这一层不需要、也不该分开看）。
                      */
                      onRename={
                        projectData
                          ? async (project, name) => {
                              const 结论 = await projectData.rename(project.id, name)
                              if (结论.kind !== "done") return 结论.message
                              await 拉清单并还原(projectData)
                              return undefined
                            }
                          : undefined
                      }
                      /*
                        删除（2026-10-16）。**破坏性、不可恢复**，所以办成之后有两件收尾
                        ——与 `onArchive` 逐字同形（`onArchive` 那段注释的 ①② 在这里逐条成
                        立：清单重拉 ＋ 删的是当前项目就清掉它）。

                        ⚠️ 与 `onArchive` 只差一处、而那处**不能少**：删除**没有找回**，
                        所以「当前项目被删掉」之后它**永远不会回来**——不 `setCurrentProject(undefined)`
                        的话，锚点行会长期挂着一个已经不存在的项目（点进去任何文件操作必失败）。

                        ⚠️ 与归档 / 找回一样**不带 `x-openhive-project` 头**（`project-data.ts`
                        那条注释逐字记着理由）：删除的要是**当前项目**，带了头会让请求先撞上
                        「项目已不存在」那道门自己挡住自己。
                      */
                      onDelete={
                        projectData
                          ? async (project) => {
                              const 结论 = await projectData.deleteProject(project.id)
                              if (结论.kind !== "done") return 结论.message
                              if (currentProject()?.id === project.id) setCurrentProject(undefined)
                              await 拉清单(projectData)
                              return undefined
                            }
                          : undefined
                      }
                    />
                  </div>
                </Show>
                {/* 成员面板（FR-004 / US3 / 设计 §4）：`👥 N` 徽章滑出，同项目面板一样是浮层。
                    数据走 `@/project/project-members` 那条缝（写入方是上面那个 effect）、
                    身份走 `@/workspace/current-user`；三个动作（T021）各接各的出口。
                    `archived` 交给面板去问 `decide`（本层不重写规则，只把**事实**递过去）——
                    否则归档项目上会画出三颗点了必然被拒的按钮。 */}
                <Show when={memberOpen()}>
                  {/*
                    同 `project-panel-slot`：槽**自己**给出高度上限（用户 2026-10-11 实报「面板不滚」
                    的**同款落点**）。面板是 `absolute` 浮层、不知道屏幕到哪结束；能算出「从面板顶到
                    侧栏底」这段可用高度的只有槽——`top-10`（2.5rem）是它自己写下的偏移，`100%` 解析到
                    `relative h-full` 的侧栏 ⇒ `max-h-[calc(100%-2.5rem)]` 与 `top-10` **是同一个数**，
                    改一个要改另一个。`flex flex-col` 是让上限真的生效的那一步（配面板自己的 `min-h-0`）。
                  */}
                  <div data-slot="member-panel-slot" class="absolute inset-x-0 top-10 z-10 flex max-h-[calc(100%-2.5rem)] flex-col px-1">
                    <MemberPanel
                      projectName={currentProject()?.name}
                      members={projectMembers()}
                      selfPoliceId={currentUser()?.policeId}
                      archived={当前已归档()}
                      /*
                        没数据源就**不传** ⇒ 面板照旧渲染成禁用态（「未接线即禁用」，同项目面板那条）。
                        回话的约定也同那一侧：`undefined` = 收工（名单自己会变），
                        有话说 = 没办成、把服务端那句话显示出来。
                      */
                      onInvite={projectData ? (policeNo) => void 邀请(policeNo) : undefined}
                      onRemove={projectData ? (member) => void 移除(member) : undefined}
                      onLeave={projectData ? () => void 退群() : undefined}
                    />
                    {/* 那句话（`undefined` ＝ 没有话要说）——同文件动作那条，`role="alert"` 让屏幕
                        阅读器在它冒出来时读一遍。排在面板**下面**：它不是面板的一部分，
                        而是这次动作的结果。 */}
                    <Show when={成员话()}>
                      {(话) => (
                        <p
                          data-slot="member-op-message"
                          role="alert"
                          class="mt-1 w-full min-w-0 rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[13px] break-all text-v2-state-fg-danger"
                        >
                          {话()}
                        </p>
                      )}
                    </Show>
                  </div>
                </Show>
                {/* 左栏 ②③（设计 §2 / FR-005）：`[会话] [文件]` tab 容器 ＋ 主体。
                    「文件」pane 里装的是**上下双树**（T012 / 设计 §5）：上树＝沙箱那棵文件树
                    （T007 的 `FileTree` 一字未改地当了上树），下树＝MinIO 备份，默认收起、点 ④
                    窄条展开。pane 的 `data-slot` 仍叫 `file-tree-slot`（T007 起就是这个名字，
                    不必随装进去的东西改）。`files` 传的是元素本身，`SidebarTabs` 两个 pane
                    常挂不卸载 —— 切一下 tab 不该把选中的行、展开的目录、搜过的词丢掉
                    （`DualFileTree` 也因此只把**下树**放进 `<Show>`，上树恒挂载）。
                    它排在面板之后：面板是 `absolute` 浮层、不占流，故视觉上紧贴锚点行。

                    ⚠️ 自 Task 17（2026-10-18）起 `onBackup` / `onRestore` **接上了**：拖沙箱行到下树
                    ＝ 起备份（**整项目**，2026-10-18 用户裁定）；拖下树行回沙箱 ＝ 先预览、有冲突才问（spec §6.1）。
                    两者都要**有项目**才接线（没有项目就没有可备份的东西），与相邻各项同一口径。
                    ⚠️ 上树的行仍**恒可拖**（2026-10-13 用户裁定）：拖出的是**路径引用**（拖到右栏
                    会话框自动填），不为备份接线而变。 */}
                <SidebarTabs
                  active={sidebarTab()}
                  onSelect={setSidebarTab}
                  // ③ 会话 pane（2026-10-08）：与 `files` 同款注入——本组件不认识会话列表，
                  // 正如它不认识文件树。`?.()` 得到 `undefined` ＝ 调用方没接（pane 空着）。
                  sessions={props.sessions?.()}
                  files={
                    <>
                      {/* 文件动作：T018 的建 / 改名 / 删 ＋ T020 的四项 ＋ Task 17 的备份 / 恢复
                          （接收方是 `@/project/minio-backups` 的 HTTP 出口）。
                          `onRefresh`（T020+，2026-10-10）：把「再取一次清单」那枚代次交给用户手拨
                          ——AI 写盘这类**外部改动**今天没有回调可挂，只能手点。与建/改名/删一样
                          **要有项目**才接线（没有项目时没有什么可刷的）。 */}
                      <DualFileTree
                        paths={projectFiles()}
                        // 「正在取 / 取不到」两句话（2026-10-21）：`paths` 的 `undefined` 自己也
                        // 说不清是哪种，只有本组件知道——交给树去说（`FileTreeProps.status`）。
                        status={
                          文件清单态() === "loading"
                            ? "loading"
                            : 文件清单态() === "failed"
                              ? "failed"
                              : undefined
                        }
                        // 取不到时那颗重试：与右键菜单里的「刷新」是**同一枚代次**（`拨清单重取`）——
                        // 「再取一遍」只有一个意思，不该有第二条路（`#002-06`）。
                        onRetry={有项目() ? 拨清单重取 : undefined}
                        backups={minioBackups()}
                        open={dualOpen()}
                        onCollapse={() => setDualOpen(false)}
                        // Task 17：恢复点清单 / 选中项 / 用量 → 下树（spec §11.2）。
                        snapshots={backupSnapshots()}
                        snapshotId={backupSnapshotId()}
                        usage={backupUsage()}
                        onSelectSnapshot={(snapshotId) => void 选恢复点(snapshotId)}
                        onDeleteSnapshot={(snapshotId) => 删恢复点(snapshotId)}
                        // 备份 / 恢复两条入口（§5.1 / §6.1）。`onRestore` 与 `onRestoreSnapshot`
                        // 是**两个**名字：右键需要「当前恢复点」，拖拽那条自己带恢复点。
                        // 一律整项目（2026-10-18 用户裁定）：组件仍把被点 / 被拖的路径交上来，
                        // 但备份**不按它收窄**——局部恢复点会让用户误以为文件丢了。
                        onBackup={有项目() ? () => void 备份() : undefined}
                        onRestore={
                          有项目()
                            ? (path) => {
                                const snapshotId = backupSnapshotId()
                                if (snapshotId === undefined) {
                                  set文件话("先在下树里选一个恢复点")
                                  return
                                }
                                void 拉回({ snapshotId, path }, { 必定确认: true })
                              }
                            : undefined
                        }
                        onRestoreSnapshot={有项目() ? (input) => void 拉回(input) : undefined}
                        // 三个回调都把回话**原样**往回交（`string` = 没办成）：新建 / 删除由弹窗就地报，
                        // 重命名由树报在**那一行**上。
                        onCreate={有项目() ? (input) => 建条(input) : undefined}
                        onRename={有项目() ? (path, name) => 改名条(path, name) : undefined}
                        onDelete={有项目() ? (path) => 删条(path) : undefined}
                        onCopy={(path) => 要搬(path, "copy")}
                        onMove={(path) => 要搬(path, "move")}
                        onUpload={选文件}
                        onUploadFolder={选文件夹}
                        onDownload={(path) => void 下载(path)}
                        onArchive={(paths, kind) => void 打包下载(paths, kind)}
                        onDropFiles={(files, dir) => void 传(dir, files)}
                        onRefresh={有项目() ? 拨清单重取 : undefined}
                        // 2026-10-15：同树拖拽批量移动。与相邻的 onCopy/onMove **同一口径**
                        // （不并 `有项目()`，由 `搬一批` 自己查 id）——拖动一时没有项目的树本来也没有行。
                        onMoveTo={(路径们, dir) => void 搬一批(dir, 路径们, "move")}
                        // 2026-10-12：右键第一项「打开」与文件行双击都走它。
                        // 与其余各项同一口径——**要有项目**才接线（没有项目就没有可打开的文件）。
                        onOpen={有项目() ? (path) => void 打开文件({ path, 标题: 末段(path) }) : undefined}
                      />
                      {/* 目标选择器（复制 / 移动共用，用户裁定①）：点了目标才发请求。
                          排在树**下面**：它是这次操作的一部分，不该盖住用户正在看的那棵树
                          （同 `dual-file-tree.tsx` 的拉回确认）。
                          ⚠️ **不再**援引 `file-tree.tsx` 的删除确认：那条 2026-10-11 已改弹窗
                          （`file-delete-dialog.tsx`）。 */}
                      <Show when={待搬()}>
                        {(正在搬) => (
                          <TargetPicker
                            path={正在搬().path}
                            mode={正在搬().mode}
                            paths={projectFiles()}
                            busy={搬忙()}
                            onPick={(dir) => void 搬(dir)}
                            onCancel={() => set待搬(undefined)}
                          />
                        )}
                      </Show>
                      {/* 那句话（`undefined` ＝ 没有话要说）。`role="alert"` 让屏幕阅读器在条冒出来时
                          读一遍（不是模态，不需要焦点管理——同上面两条内联确认）。 */}
                      <Show when={文件话()}>
                        {(话) => (
                          <p
                            data-slot="file-op-message"
                            role="alert"
                            class="w-full min-w-0 rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[13px] break-all text-v2-state-fg-danger"
                          >
                            {话()}
                          </p>
                        )}
                      </Show>
                      {/* 「上传」的第一条入口（设计 §6.3 原话「含文件选择器上传」）。
                          `multiple`：一次拖一批也走同一个 `传`，两条入口的行为没有第二条路。
                          隐藏而**不是**不渲染：`display:none` 的 input 照样能被 `click()` 打开
                          （浏览器如此），而留在 DOM 里也让组件测试够得着它。 */}
                      <input
                        data-slot="file-op-input"
                        ref={文件选择器}
                        type="file"
                        multiple
                        hidden
                        onChange={选中}
                      />
                      {/* 「上传文件夹」的入口（2026-10-24 用户下达）：`webkitdirectory` 让系统
                          选择器只认目录，交出来的每个 `File` 带 `webkitRelativePath`。
                          与上面那台**必须是两个 `input`**——`webkitdirectory` 一旦挂上就只能选目录，
                          文件上传那台不能受影响。 */}
                      <input
                        data-slot="file-op-folder-input"
                        // `webkitdirectory` 不在 `InputHTMLAttributes` 的类型里（Solid 的 `attr:*`
                        // 只开给组件、没开给原生元素）⇒ 走 ref 写属性。写属性的效果与写在标签上一致。
                        ref={(el) => {
                          文件夹选择器 = el
                          el.setAttribute("webkitdirectory", "")
                        }}
                        type="file"
                        multiple
                        hidden
                        onChange={选中文件夹}
                      />
                    </>
                  }
                />
                {/* 左栏 ④ MinIO 常驻窄条（设计 §2 / §5.1 步骤 1）。`count` 走接入缝——今天
                    缝里没有写入方，所以窄条走「不知道几项」态（`@/project/minio-backups` 文件头）。
                    点它一步做两件事（设计 §5.1 步骤 2①②）：① 把左栏拨回「文件」tab（MinIO 是
                    文件操作，不该停在会话视图）；② 展开上下双树。**两件事要一起做**——只切 tab
                    不展开的话，用户点这一下等于点了个空（T019 时 2② 还没实现，就是这个半截态）。 */}
                <MinioBar
                  count={minioBackups()?.length}
                  usage={backupUsage()}
                  job={backupJob()}
                  // 窄条是窗口的**页脚**：箭头得说得出再点一下是开还是关（2026-10-18）。
                  expanded={dualOpen()}
                  onOpen={() => {
                    // ① 拨回文件 tab（MinIO 是文件操作）；② 开合窗口。
                    // 若刚才不在文件页（比如停在会话 tab），这一下是「去文件页并打开」——
                    // 不 toggle：此时 `dualOpen` 的旧值用户根本没看见，按旧值反着做会点出个空。
                    const 本来在文件页 = sidebarTab() === "files"
                    setSidebarTab("files")
                    setDualOpen(本来在文件页 ? !dualOpen() : true)
                  }}
                  onCancel={() => {
                    const job = backupJob()
                    if (!job || !projectData) return
                    void projectData.cancelJob(job.id).then(() => 重取备份状态())
                  }}
                />
              </div>
            ) : undefined
          }
          // 右栏（AI 会话，T008 / FR-010）。⚠️ `?.()` 不能省，也不能包 `<Show>`——理由见 prop 上那段注释。
          //
          // `rightCollapsed` 是那颗乒乓开关的**执行端**（2026-10-10 用户下达）：收起时
          // `ThreePane` 整块 `<Show>` 不渲染 ⇒ 右栏**连同 `ResizeHandle` 一起**让位，中栏是
          // `flex-1 min-w-0`，自然吃满——「中栏宽度自动适应」不需要另写一行宽度逻辑。
          // ⚠️ 它与 `right` 是**两个独立的门**（`有右栏 = props.right !== undefined && !props.rightCollapsed`）：
          // 没有会话时 `right` 本来就是 `undefined`（`AiSessionSlot` 只在有会话时渲染），
          // 于是**首页 / 草稿页上拨这个开关只有图标亮灭、右栏照旧不出现**。那是右栏「整根只在
          // 会话路由下渲染」的既有事实，不是这条开关引入的（已记进本次交付说明）。
          rightCollapsed={!aiSessionOpen()}
          right={props.right?.()}
        >
          {/* 中栏。业务模块下是「两栏 ＋ 一条可拖的隔板」（2026-10-12 分屏）：几何与「谁在哪一栏」
              都在 `center-split.tsx` 里，本组件只把取数出口与上游页面注入进去。
              AI 资产是**模块级页面**（D0-3）——文件 tab 那套（`CenterSplit`）整块让位，但 tab
              状态不丢（只是不渲染，`center` 里的 tabs 原封不动），切回项目管理时照旧。
              T006 起这里是搜索 + 卡片网格 ＋ 页码条；`assetFilter` 与左栏**共享同一份**（左栏点了
              类型/分类，中栏按它重新取数），取数走 `props.catalog` 这条注入缝（需求 6）。 */}
          {视图() === "ai-assets" ? (
            <AssetCenter filter={assetFilter} catalog={props.catalog} enablement={props.enablement} />
          ) : (
            <CenterSplit
              registry={viewRegistry}
              load={props.loadFile}
              save={props.saveFile}
              pageVisible={props.routePageVisible?.() ?? true}
              empty={
                <div
                  data-slot="center-empty"
                  class="flex w-full flex-1 items-center justify-center px-6 text-center text-[13px] text-v2-text-text-faint"
                >
                  从左侧选择文件查看，或在右栏让 AI 生成成果
                </div>
              }
            >
              {props.children}
            </CenterSplit>
          )}
        </ThreePane>
      </div>
    </ProjectionModuleProvider>
  )
}

/** 路径的末段（文件名）。两种分隔符都认：树给的路径归一成 `/`，而服务端原样给的可能是 `\`（win32）。 */
function 末段(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * 把取回来的字节**存到本地**——`utils/session-export.ts` 的 `downloadSessionExport` 是同一套
 * （`<a download>` 那条链：`createObjectURL` → 点一下 → 收回 URL）。
 *
 * 为什么这一段落在**这里**而不是 `openhive-file-ops.ts`：那一层要能在没有 DOM 的单测里跑
 * （`project-data.ts` 的 `download` 注释），所以它到字节为止；DOM 只在这一层出现。
 */
function 存到本地(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * 本文件局部的二次确认框（超限备份 / 删除恢复点共用，Task 17）。
 *
 * 为什么不是 `window.confirm`：happy-dom 下它会把整轮挂死（没有人去点原生框）；浏览器原生框
 * 也与 DESIGN 的视觉不是一套。为什么留在本文件：本仓**没有**现成的 `ConfirmDialog`
 * （amend R-6），这两处是目前唯一的消费者——按「单次使用不抽象」先不建公共组件。
 *
 * `data-kind` 是判据的抓手：两种确认的按钮文案相同（继续），只有 `kind` 能分开「问的是哪件事」。
 *
 * `onConfirm` 可以返回 Promise：返回了就把框留在原地、把主按钮切成「进行中」，等它落定
 * 才让调用方自己 `dialog.close()`。这条是 2026-10-21 用户反馈的直接产物——删除恢复点
 * 在服务端同步跑 GC（实测 500 个文件 806ms，真 MinIO 更久），旧实现回包**之前**就关框，
 * 屏幕退回原样 ⇒ 用户分不清「还在删」与「压根没删」。
 *
 * 超限确认走的是同步分支（`onConfirm` 返回 `void`）：那条路的进度在 MinIO 窄条上，
 * 不必在这里重复一次 pending。
 */
function 确认框(props: {
  kind: "quota" | "delete-snapshot"
  title: string
  message: string
  onConfirm: () => void | Promise<void>
  /** 回包前主按钮的字。省略 ⇒ 不切 pending（同步动作）。 */
  pendingText?: string
  onCancel: () => void
}) {
  const [进行中, set进行中] = createSignal(false)
  const 确认 = () => {
    if (进行中()) return
    const 结果 = props.onConfirm()
    if (结果 === undefined || props.pendingText === undefined) return
    set进行中(true)
    void 结果.finally(() => set进行中(false))
  }
  return (
    <DialogV2 class="w-[min(28rem,calc(100vw-3rem))]">
      <div data-component="backup-confirm" data-kind={props.kind} class="contents">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <DialogBody class="px-4 pt-4 pb-2">
          <p data-slot="backup-confirm-message" class="w-full min-w-0 text-[13px] text-v2-text-text-muted">
            {props.message}
          </p>
        </DialogBody>
        <DialogFooter>
          <ButtonV2
            data-slot="backup-confirm-cancel"
            variant="neutral"
            disabled={进行中()}
            onClick={() => props.onCancel()}
          >
            取消
          </ButtonV2>
          <ButtonV2
            attr:autofocus=""
            data-slot="backup-confirm-ok"
            variant={进行中() ? "loading" : "contrast"}
            disabled={进行中()}
            onClick={确认}
          >
            {进行中() ? props.pendingText : "继续"}
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}
