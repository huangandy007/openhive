import { useLocation } from "@solidjs/router"
import { createEffect, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
// ⚠️ openhive 定制（006 修复）：这是要保留的定制 —— 合并上游时两侧都留着。
// 中栏在会话路由上让位给右栏，判据（`routeSessionID`）在下面 `routePageVisible` 那处用。
import { AiSessionSlot } from "@/ai-session/ai-session-slot"
import { SidebarSessions } from "@/ai-session/sidebar-sessions"
import { routeSessionID } from "@/ai-session/route-session"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useCommand } from "@/context/command"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
// ⚠️ openhive 定制（2026-10-09 #3 设置迁到 rail）：这是要保留的定制 —— 合并上游时两侧都留着。
// 图标栏底部「系统设置」那颗对话框的**动作在这里取**：`useSettingsDialog()` 要 `useParams()`
// 与 `useDialog()`，只有**落在路由根之内**的这一层拿得到（`WorkspaceEntry` 被测试裸挂，读不了
// Router——见它 `onOpenSettings` 那个 prop 上的注释）。
import { useSettingsDialog } from "@/components/settings-dialog"
// ⚠️ openhive 定制（005 T018）：这是要保留的定制 —— 合并上游时两侧都留着。
// 工作台「项目」那件事的数据源在这里注入（1 行 import ＋ 1 个 prop，见 `@/project/project-data`
// 文件头「为什么要有这一层」）。删掉这两处 = 面板/文件树退回「未接线即禁用」态。
import { PROJECT_DATA } from "@/project/project-data"
// ⚠️ openhive 定制（2026-10-08 顶栏改造）：这三行是要保留的定制 —— 合并上游时两侧都留着。
// 顶栏（含品牌组 / 主页 / 站内信 / 全屏 / 用户区）从 `workspace-entry.tsx` 挪到这里挂：
// 它现在顶掉的是上游那条带子，必须跟 `Titlebar` 同一层（理由见 `@/topbar/titlebar-host`）。
import { TopbarConnected } from "@/topbar/topbar-connected"
import { useTitlebarHostMount } from "@/topbar/titlebar-host"
import { WorkspaceEntry } from "@/workspace/workspace-entry"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  // ⚠️ openhive 定制（006 修复）：这是要保留的定制。本组件落在 `Router` 的 `root` 之内（`app.tsx`），
  // 所以 `useLocation()` 在这里可用——与 `AiSessionSlot` 读的是同一个产地。
  const location = useLocation()
  // ⚠️ openhive 定制（2026-10-08 顶栏改造）：这是要保留的定制。
  // 顶栏那颗主页按钮的**语义直接借上游的**：`command.trigger("home.toggle")` 打的就是上游
  // `components/titlebar.tsx` 里 `command.register("titlebar-home", …)` 注册的那条（上游那颗按钮
  // 的 `onClick`；键盘 `mod+b` 走的也是它）。**刻意不在这里重写一遍 `toggleHome`**：那要连
  // `matchRoute`（home/draft/session 三支 ＋ 子会话回退到父 tab）一起抄，抄来的副本会与上游漂
  // （`LEARNINGS #003-05`）。上游那条注册在**被隐掉的那条带子里照样会跑**（CSS 隐藏不影响渲染）。
  // ⚠️ 代价：这条指令 id 是**字符串约定**（上游改名 ⇒ 本按钮静默无反应）。
  const layout = useLayout()
  const command = useCommand()
  /**
   * 图标栏那颗「系统设置」开对话框的动作（2026-10-09 #3）。
   *
   * **刻意用 `useSettingsDialog()` 而不是 `useSettingsCommand()`**：后者会**多注册一遍**
   * `settings.open`（`mod+,` 那条），而它已由 `pages/session.tsx` / `use-new-session-commands` /
   * `home-projects-controller` 在各自的页面上注册过——本组件罩着**所有**路由，再注册一次就是同一
   * 条指令的重复登记（这层不做那件事）。设置对话框这一侧本来就不用 `useCommand`。
   */
  const openSettings = useSettingsDialog()
  const titlebarHost = useTitlebarHostMount()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    /* ⚠️ openhive 定制（2026-10-08 顶栏改造）：`[&_header[data-slot=titlebar-v2]>div]:hidden`
       是本轮顶栏改造的**那一行**——它把上游标题栏那条内层带子（里面有：标签页条、渠道徽标
       DEV / BETA、上游那颗主页按钮 ＋ 新会话按钮）整个隐掉。**不改上游源码**（宪法 II）。
       · 锚点是上游的稳定钩子 `data-slot="titlebar-v2"`（`components/titlebar.tsx` 的 header 上）；
       · ⚠️ 它吃的是 header 的**所有** `div` 子元素——**包括** `<Portal>` 自己那个无名 div
         （2026-10-09 实测：宿主原先取 header 本身 ⇒ 顶栏 0×0 被同一条规则一起隐掉）。
         所以本产品自己的宿主是**自建的 `span[data-slot=topbar-host]`**（`@/topbar/titlebar-host`，
         Portal 那个无名 div 的取宽也在那里兜底——不必在这里补任意变体）；
       · 上游若改了元素类型 / 钩子名，症状是**上游那条带子重新露出来**（看得见，不静默）。
       ⚠️ 已知代价（已报备）：`#opencode-titlebar-right` 也在那条带子里 ⇒
       `session-header.tsx` 的状态/审查按钮与 `new-session.tsx` 的新会话状态一并不可见。 */
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_header[data-slot=titlebar-v2]>div]:hidden [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      {/* ⚠️ openhive 定制（2026-10-08 顶栏改造）：这是要保留的定制 —— 合并上游时两侧都留着。
          顶栏挂进**上游那条 header 的里面**（当静态子元素），不挂 `#opencode-titlebar-right`
          （那个注入点在刚被隐掉的那条带子里，投进去＝投进不可见容器；品牌要跑到最左，那个
          注入点在最右也够不到）。宿主是 `useTitlebarHostMount()` 自建的
          `span[data-slot=topbar-host]`（为什么是 span、为什么不能加宽高：`@/topbar/titlebar-host`
          与 `@/topbar/topbar-mount` 里那两处注释）——那条约束与上面那条隐藏规则是一对。
          「主页」那颗按钮的语义直接借上游的指令（见上面 `command.trigger` 那段注释）。 */}
      {/* ⚠️ openhive 定制（2026-10-09 用户下拉接线）：这是要保留的定制 —— 合并上游时两侧都留着。
          原先是 `TopbarMount` ＋ `user={currentUser()}`；换成 `TopbarConnected` 之后**身份与四个
          菜单项的动作都在那一层从 context 取**（`useAuthSession()` ＋ `useDialog()`，两者都只有
          这一层拿得到），本行只剩「宿主 + 按下态 + 主页语义」三样还是入口层的事。
          为什么身份也搬过去、以及那条「静默少一块」的代价：`@/topbar/topbar-connected` 文件头。 */}
      <TopbarConnected
        host={titlebarHost()}
        homeActive={layout.route().type === "home"}
        onOpenHome={() => command.trigger("home.toggle")}
      />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <WorkspaceEntry
          projectData={PROJECT_DATA}
          // ⚠️ openhive 定制（006 T008）：这是要保留的定制 —— 合并上游时两侧都留着。
          // 右栏（AI 会话）在这里挂进 `ThreePane` 的 `right` 槽（FR-010）。
          // **传访问器、不传元素**：内容要读的时候才创建、且创建在 `WorkspaceEntry` 自己建的
          // `CenterTabsProvider` 之内（`AiSessionSlot` 要按当前模块算投影）。理由与注意事项见
          // `workspace-entry.tsx` 的 `right` prop 上那段注释。
          right={() => <AiSessionSlot />}
          // ⚠️ openhive 定制（2026-10-08）：这是要保留的定制 —— 合并上游时两侧都留着。
          // 左栏「会话」tab 在这里挂进 `SidebarTabs` 的会话 pane：列出**当前项目目录**下的会话，
          // 与右栏**共用同一份目录缓存槽**（两边都走 `ensureDirSyncContext(目录)`）。
          // 同样**传访问器**（与上面 `right` 逐条同因）。判据与缺口见
          // `ai-session/sidebar-sessions.tsx` 的文件头。
          sessions={() => <SidebarSessions />}
          // ⚠️ openhive 定制（006 修复）：这是要保留的定制 —— 合并上游时两侧都留着。
          // 中栏**只在会话路由上**让位：`children` 在那条路由下就是 `pages/session.tsx`
          // （一页完整的 AI 会话），中栏再露一遍 = 屏幕上两个输入框、两条消息流，且都在真发消息。
          // 判据只有这一行，且**只在这里算**——`WorkspaceEntry` 被测试裸挂（无 Router），
          // 在它里面读 location 会当场抛（见那个 prop 上的注释）。
          // `routeSessionID` 只认生产那一种形态（`/server/<key>/session/<id>`），其余路由一律
          // `undefined` ⇒ 中栏照旧露上游页面，行为与加这一行之前逐字相同。
          routePageVisible={() => routeSessionID(location.pathname) === undefined}
          // ⚠️ openhive 定制（2026-10-09 #3 设置迁到 rail）：这是要保留的定制。
          // 图标栏底部那颗「系统设置」的动作——在本层取（要 Router ＋ DialogProvider），
          // 往里只传值（`WorkspaceEntry` 不读 Router）。
          onOpenSettings={openSettings}
        >
          <Suspense>{props.children}</Suspense>
        </WorkspaceEntry>
      </main>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
