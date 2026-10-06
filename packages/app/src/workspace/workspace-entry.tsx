import { createSignal, Show, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { CenterContent } from "@/center/center-content"
import type { LoadFileContent } from "@/center/file-content"
import { TabBar } from "@/center/tab-bar"
import { CenterTabsProvider, useCenterTabs } from "@/center/tab-context"
import { viewRegistry } from "@/center/views"
import { currentProject, setCurrentProject } from "@/project/current-project"
import { ProjectAnchor } from "@/project/project-anchor"
import { projectList } from "@/project/project-list"
import { ProjectPanel } from "@/project/project-panel"
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
   * 由应用入口注入（`pages/layout-new.tsx` 拿 `useSDK()` 组），**不在这里 `useFile()`**：
   * `useFile` 要六层 provider 才活得下来，会把工作台的组件测试整个拖进去。
   * 省略 = 视图拿不到内容（停在空态），但路由与 tab 照常。
   */
  loadFile?: LoadFileContent
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
                  onToggleList={() => setPanelOpen((open) => !open)}
                  // `＋` 今天退化成「打开面板」——面板置顶就是「＋新建项目（私有/共享）」
                  // （设计 §3：「置顶最易达」）。**这不是「新建」的替代**：面板里那两个按钮
                  // 今天同样是禁用的（没有落库接收方，见 `project-panel.tsx` 文件头）。
                  // T018 接上落库后，这里要再定一次：`＋` 是继续打开面板，还是直达新建表单。
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
                    />
                  </div>
                </Show>
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
