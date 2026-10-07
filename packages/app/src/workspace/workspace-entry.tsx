import { createEffect, createSignal, onCleanup, onMount, Show, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { CenterContent } from "@/center/center-content"
import type { LoadFileContent } from "@/center/file-content"
import { TabBar } from "@/center/tab-bar"
import { CenterTabsProvider, useCenterTabs } from "@/center/tab-context"
import { viewRegistry } from "@/center/views"
import { currentProject, setCurrentProject } from "@/project/current-project"
import { DualFileTree } from "@/project/dual-file-tree"
import { MemberPanel } from "@/project/member-panel"
import { MinioBar } from "@/project/minio-bar"
import { minioBackups } from "@/project/minio-backups"
import type { FileOpOutcome } from "@/project/openhive-file-ops"
import { ProjectAnchor } from "@/project/project-anchor"
import type { ProjectData } from "@/project/project-data"
import { TargetPicker } from "@/project/target-picker"
import { projectFiles, setProjectFiles } from "@/project/project-files"
import { projectList, setProjectList } from "@/project/project-list"
import { projectMembers } from "@/project/project-members"
import { ProjectPanel } from "@/project/project-panel"
import { SidebarTabs, type SidebarTabKey } from "@/project/sidebar-tabs"
import { RAIL_ENTRIES } from "@/rail/entries"
import { Rail } from "@/rail/rail"
import { Topbar } from "@/topbar/topbar"
import { currentUser } from "./current-user"
import { ThreePane } from "./three-pane"

export interface WorkspaceEntryProps {
  /**
   * 顶栏右侧注入点的挂载元素访问器（上游 `useTitlebarRightMount()`）。
   * 省略 / 为空 = 顶栏无处可挂，**不渲染**——绝不退而求其次塞进中栏。
   */
  titlebarRight?: () => HTMLElement | null
  /** 会话能力位；省略 = 尚未接签发方，图标栏不设限（语义见 `rail/entries.ts`）。 */
  capabilities?: ReadonlySet<string>
  /**
   * 取文件内容的接缝，供中栏视图渲染。
   *
   * 该由应用入口注入（`pages/layout-new.tsx` 拿 `useSDK()` 组），**不在这里 `useFile()`**：
   * `useFile` 要六层 provider 才活得下来，会把工作台的组件测试整个拖进去。
   * ⚠️ **今天还没接**（`layout-new.tsx` 只传了 `titlebarRight` 与 `projectData`）——接它要六层
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
    if (代 === 清单代次) setProjectList(清单)
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
  /** 上传的落点目录：右键「上传」时先定下（树给的是**目录**，见 `FileTreeProps.onUpload`），选中文件后才用得着。 */
  const [上传落点, set上传落点] = createSignal("")
  /** 那台隐藏的文件选择器（拖进来那条路不用它，两条入口都落在同一个 `传` 上）。 */
  let 文件选择器: HTMLInputElement | undefined

  /**
   * 进门拉一次清单。
   *
   * **只拉清单，不认领当前项目**：005 的 spec 只写了两件事——FR-003「新建后成为当前项目」与
   * AC4「点某项目切换」，对「打开时选谁」一个字没写。用户 2026-10-06 裁定照 spec 字面：
   * **不自动选**（不选 ⇒ 不发 `x-openhive-project` ⇒ 后端落回沙箱根，即 005 之前的行为）。
   */
  onMount(() => {
    if (projectData) void 拉清单(projectData)
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
                    数据走 `@/project/project-members` 那条缝、身份走 `@/workspace/current-user`；
                    三个动作回调**今天不接线** ⇒ 渲染成 `disabled`（落库缺口归 T021，见 `member-panel.tsx` 文件头）。 */}
                <Show when={memberOpen()}>
                  <div data-slot="member-panel-slot" class="absolute inset-x-0 top-10 z-10 px-1">
                    <MemberPanel
                      projectName={currentProject()?.name}
                      members={projectMembers()}
                      selfPoliceId={currentUser()?.policeId}
                    />
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
              故 001 下（尚无模块动作）行为与本组件引入前完全一致。 */}
          <CenterContent registry={viewRegistry} load={props.loadFile}>
            {props.children}
          </CenterContent>
        </ThreePane>
      </div>
      <Show when={props.titlebarRight?.()} keyed>
        {(mount) => (
          <Portal mount={mount}>
            <Topbar user={currentUser()} />
          </Portal>
        )}
      </Show>
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
