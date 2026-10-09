import { createEffect, createSignal, onCleanup, onMount, Show, type JSX, type ParentProps } from "solid-js"
import { CenterContent } from "@/center/center-content"
import type { LoadFileContent } from "@/center/file-content"
import { TabBar } from "@/center/tab-bar"
import { CenterTabsProvider, useCenterTabs } from "@/center/tab-context"
import { viewRegistry } from "@/center/views"
import { currentProject, 还原启动项目, 读项目cookie, setCurrentProject } from "@/project/current-project"
import { DualFileTree } from "@/project/dual-file-tree"
import { MemberPanel, type MemberEntry } from "@/project/member-panel"
import { MinioBar } from "@/project/minio-bar"
import { minioBackups } from "@/project/minio-backups"
import type { FileOpOutcome } from "@/project/openhive-file-ops"
import type { ProjectActionOutcome } from "@/project/openhive-project"
import { ProjectAnchor } from "@/project/project-anchor"
import type { ProjectData } from "@/project/project-data"
import { TargetPicker } from "@/project/target-picker"
import { projectFiles, setProjectFiles } from "@/project/project-files"
import { projectList, setProjectList } from "@/project/project-list"
import { projectMembers, setProjectMembers } from "@/project/project-members"
import { ProjectPanel } from "@/project/project-panel"
import { SidebarTabs, type SidebarTabKey } from "@/project/sidebar-tabs"
import { RAIL_ENTRIES } from "@/rail/entries"
import { Rail } from "@/rail/rail"
import { currentUser } from "./current-user"
import { ThreePane } from "./three-pane"

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
    const 清单 = await data.list()
    // 被新的一代顶掉 ⇒ **不写缝、也不交出去**：`onMount` 的还原拿这份清单判「存档还在不在」，
    // 交一份过期的清单出去，就会凭着一份**已经不成立**的名单去认领项目（同一道闸的另一半）。
    if (代 !== 清单代次) return undefined
    setProjectList(清单)
    return 清单
  }

  /**
   * 文件动作（T020）：右键菜单那四项 ＋ 从桌面拖进来的上传。
   *
   * ## 复制 / 移动为什么是**两段**
   *
   * 点菜单那一刻只**开一个目标选择器**，一个请求都不发（用户 2026-10-06 裁定①）——
   * 「搬到哪个目录」是这次操作的一部分，不该由前端猜一个（猜到根上就等于把一个文件悄悄挪走了）。
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
  /** 文件清单的重取代次：拨一下 ⇒ 上面那个 effect 重跑（它在读它）。 */
  const [清单重取, set清单重取] = createSignal(0)
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
    const 存档 = 读项目cookie()
    if (!projectData) {
      // 没有数据源 ⇒ 判不了存档有没有效 ⇒ 不能还原；但也不能留着它与信号分叉（见上）。
      // 这里沿用裁定 B 的老行为清一次：此刻「清」与「不选」是同一个状态，没有信息可丢。
      if (存档 !== undefined) setCurrentProject(undefined)
      return
    }
    void (async () => {
      const 清单 = await 拉清单(projectData)
      if (清单) 还原启动项目(存档, 清单)
    })()
  })

  /**
   * 当前项目变了就换文件清单（AC4：左栏文件树随之切换）。
   *
   * 三件事按顺序：**先清空**（`undefined` = 还不知道，不是「这个项目没有文件」；留着上一个项目的
   * 文件更糟——那看起来像**串项目**了）→ 去取 → 回来时确认自己还是最新的。
   * 第三件不是假想的竞态：取文件要一层层走（`openhive-files.ts`），大目录慢得多，
   * 连点两下换项目就够触发。这道闸用 `onCleanup`（而不是上面那个代次计数器）是因为
   * **这里有一个响应式的键**——每次重跑，Solid 自己就会跑上一轮的清理。
   */
  createEffect(() => {
    const id = currentProject()?.id
    清单重取() // 读一下：文件动作办成之后拨它，清单就跟着重取（T020）——同一道闸、两处触发
    setProjectFiles(undefined)
    if (!id || !projectData) return

    let 作废 = false
    onCleanup(() => {
      作废 = true
    })
    void projectData.files(id).then((paths) => {
      if (!作废) setProjectFiles(paths)
    })
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
   * 一次文件动作的收尾：**办成** ⇒ 清话 ＋ 重取清单；**没办成** ⇒ 把服务端那句话留下。
   *
   * 「重取」而不是「本地拼」：服务端回的新路径**只用来报一句话**，界面上的真相永远是重取那一份
   * （同 T018 的「清单重拉，不把新行拼进旧清单」——拼出来的树跟磁盘没有对过账）。
   */
  function 收下(结论: FileOpOutcome) {
    if (结论.kind !== "done") {
      set文件话(结论.message)
      return
    }
    set文件话(undefined)
    set清单重取((代次) => 代次 + 1)
  }

  /** 开目标选择器（复制 / 移动共用）。**此刻一个请求都不发**——目标还没选。 */
  function 要搬(path: string, mode: "copy" | "move") {
    set文件话(undefined)
    set待搬({ path, mode })
  }

  /** 点了目标才真搬。 */
  async function 搬(dir: string) {
    const 目标 = 待搬()
    const id = currentProject()?.id
    if (!目标 || !id || !projectData) return
    set搬忙(true)
    const 结论 =
      目标.mode === "copy"
        ? await projectData.copy(id, 目标.path, dir)
        : await projectData.move(id, 目标.path, dir)
    set搬忙(false)
    set待搬(undefined)
    收下(结论)
  }

  /**
   * 上传一批文件到某个目录。**逐个发**：服务端一次只收一个（`file.ts` 的 `handleUpload`），
   * 而「几个成了、几个没成」这句话只有在这一层说得出来。
   */
  async function 传(dir: string, files: readonly File[]) {
    const id = currentProject()?.id
    if (!id || !projectData || files.length === 0) return
    set搬忙(true)
    let 成了 = 0
    let 缘由: string | undefined
    for (const file of files) {
      const 结论 = await projectData.upload(id, dir, file)
      if (结论.kind === "done") 成了 += 1
      // 只留**第一句**：一批文件失败的原因常常是同一个，逐条堆出来会是一面墙。
      else 缘由 ??= 结论.message
    }
    set搬忙(false)

    const 没成 = files.length - 成了
    if (没成 === 0) {
      收下({ kind: "done", path: dir })
      return
    }
    // ⚠️ 那句话只讲**其中一个**。不说清还有几个的话，界面会把「3 个里失败了 2 个」
    // 说成「失败了 1 个」——报一个数就得报准它（`LEARNINGS #003-04` 同族：写下的数要经得起复核）。
    set文件话(files.length === 1 ? (缘由 ?? "上传文件失败") : `${缘由 ?? "上传文件失败"}（这批 ${files.length} 个里 ${没成} 个没成功）`)
    if (成了 > 0) set清单重取((代次) => 代次 + 1)
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
    const blob = await projectData.download(id, path)
    if (!blob) {
      set文件话(`下载「${path}」失败`)
      return
    }
    存到本地(blob, 末段(path))
  }

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

  return (
    <>
      {/* 图标栏是**三栏之外**的独立一列（DESIGN §4.1：图标栏 56px → 左项目侧栏 280px → 中 → 右），
          故不能塞进 `ThreePane` 的 `left` 槽（那是左项目侧栏，005 T005 起交给 `ProjectAnchor`）。
          外层这层行容器因此必需：挂载点 `<main>`（layout-new.tsx）是 `flex-col`，
          直接并列两个子元素会变成上下堆叠。 */}
      <div data-component="workspace-entry" class="flex-1 min-h-0 min-w-0 w-full flex">
        <Rail
          active={center.module()}
          onSelect={(id) => center.switchModule(id)}
          capabilities={props.capabilities}
        />
        {/* 左栏按模块开关（`2026-09-11-项目管理-design.md` §2：左栏是「项目管理 / AI 资产」两入口
            共用的一列）。今天只有「项目管理」有左栏内容，故先只认它——多认一个模块就要多一份内容，
            而「AI 资产」的左栏属 006 之后的事（见 state.md 的欠账表）。
            ⚠️ 条件必须落在 `left` **prop 本身**：包一层 `<Show>` 再传进去是错的——`ThreePane` 判的是
            `props.left !== undefined`，`<Show>` 元素恒非 `undefined`，于是空态下会留下一条 280px 空栏。 */}
        <ThreePane
          left={
            center.module() === "project" ? (
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
                  <div data-slot="project-panel-slot" class="absolute inset-x-0 top-10 z-10 px-1">
                    <ProjectPanel
                      projects={projectList()}
                      currentId={currentProject()?.id}
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
                    />
                  </div>
                </Show>
                {/* 成员面板（FR-004 / US3 / 设计 §4）：`👥 N` 徽章滑出，同项目面板一样是浮层。
                    数据走 `@/project/project-members` 那条缝（写入方是上面那个 effect）、
                    身份走 `@/workspace/current-user`；三个动作（T021）各接各的出口。
                    `archived` 交给面板去问 `decide`（本层不重写规则，只把**事实**递过去）——
                    否则归档项目上会画出三颗点了必然被拒的按钮。 */}
                <Show when={memberOpen()}>
                  <div data-slot="member-panel-slot" class="absolute inset-x-0 top-10 z-10 px-1">
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

                    ⚠️ `onBackup` / `onRestore` **刻意不接**：它们的接收方（MinIO 的 HTTP 出口）
                    今天还不存在，归 T022。不接 ⇒ 行不可拖（「未接线即禁用」，与右键菜单第 9/10
                    项自 T008 起就禁用是同一件事）。 */}
                <SidebarTabs
                  active={sidebarTab()}
                  onSelect={setSidebarTab}
                  // ③ 会话 pane（2026-10-08）：与 `files` 同款注入——本组件不认识会话列表，
                  // 正如它不认识文件树。`?.()` 得到 `undefined` ＝ 调用方没接（pane 空着）。
                  sessions={props.sessions?.()}
                  files={
                    <>
                      {/* ④ 个文件动作（T020）：四项各接各的回调。`onBackup` / `onRestore` 仍不接
                          —— 它们的接收方（MinIO 的 HTTP 出口）归 T022。 */}
                      <DualFileTree
                        paths={projectFiles()}
                        backups={minioBackups()}
                        open={dualOpen()}
                        onCollapse={() => setDualOpen(false)}
                        onCopy={(path) => 要搬(path, "copy")}
                        onMove={(path) => 要搬(path, "move")}
                        onUpload={选文件}
                        onDownload={(path) => void 下载(path)}
                        onDropFiles={(files, dir) => void 传(dir, files)}
                      />
                      {/* 目标选择器（复制 / 移动共用，用户裁定①）：点了目标才发请求。
                          排在树**下面**：它是这次操作的一部分，不该盖住用户正在看的那棵树
                          （同 `file-tree.tsx` 的删除确认、`dual-file-tree.tsx` 的拉回确认）。 */}
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
                  onOpen={() => {
                    setSidebarTab("files")
                    setDualOpen(true)
                  }}
                />
              </div>
            ) : undefined
          }
          // 右栏（AI 会话，T008 / FR-010）。⚠️ `?.()` 不能省，也不能包 `<Show>`——理由见 prop 上那段注释。
          right={props.right?.()}
        >
          {/* 中栏顶部的内容视图 tab 栏（FR-004 / FR-005 / DESIGN §4.5） */}
          <TabBar
            tabs={center.tabs()}
            active={center.active()}
            onActivate={(key) => center.activate(key)}
            onClose={(key) => center.close(key)}
          />
          {/* tab 栏下面就是内容区（FR-007 / DESIGN §4.5 的「中栏承载内容视图」）。
              没有可解析的激活 tab 时原样落回 `children`——即上游路由自己的页面，
              故 001 下（尚无模块动作）行为与本组件引入前完全一致。
              `pageVisible` / `empty` 只在**会话路由**上改变这一档：那里中栏让位给右栏
              （design-v2 §8.2「中栏看结果、右栏让 AI 干活」），页面照旧常驻、只是不露。 */}
          <CenterContent
            registry={viewRegistry}
            load={props.loadFile}
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
          </CenterContent>
        </ThreePane>
      </div>
    </>
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
