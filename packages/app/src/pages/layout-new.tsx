import { useLocation } from "@solidjs/router"
import { createEffect, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
// ⚠️ openhive 定制（006 修复）：这是要保留的定制 —— 合并上游时两侧都留着。
// 中栏在会话路由上让位给右栏，判据（`routeSessionID`）在下面 `routePageVisible` 那处用。
import { AiSessionSlot } from "@/ai-session/ai-session-slot"
import { routeSessionID } from "@/ai-session/route-session"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, useTitlebarRightMount, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
// ⚠️ openhive 定制（005 T018）：这是要保留的定制 —— 合并上游时两侧都留着。
// 工作台「项目」那件事的数据源在这里注入（1 行 import ＋ 1 个 prop，见 `@/project/project-data`
// 文件头「为什么要有这一层」）。删掉这两处 = 面板/文件树退回「未接线即禁用」态。
import { PROJECT_DATA } from "@/project/project-data"
import { WorkspaceEntry } from "@/workspace/workspace-entry"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const titlebarRight = useTitlebarRightMount()
  // ⚠️ openhive 定制（006 修复）：这是要保留的定制。本组件落在 `Router` 的 `root` 之内（`app.tsx`），
  // 所以 `useLocation()` 在这里可用——与 `AiSessionSlot` 读的是同一个产地。
  const location = useLocation()
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
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
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
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <WorkspaceEntry
          titlebarRight={titlebarRight}
          projectData={PROJECT_DATA}
          // ⚠️ openhive 定制（006 T008）：这是要保留的定制 —— 合并上游时两侧都留着。
          // 右栏（AI 会话）在这里挂进 `ThreePane` 的 `right` 槽（FR-010）。
          // **传访问器、不传元素**：内容要读的时候才创建、且创建在 `WorkspaceEntry` 自己建的
          // `CenterTabsProvider` 之内（`AiSessionSlot` 要按当前模块算投影）。理由与注意事项见
          // `workspace-entry.tsx` 的 `right` prop 上那段注释。
          right={() => <AiSessionSlot />}
          // ⚠️ openhive 定制（006 修复）：这是要保留的定制 —— 合并上游时两侧都留着。
          // 中栏**只在会话路由上**让位：`children` 在那条路由下就是 `pages/session.tsx`
          // （一页完整的 AI 会话），中栏再露一遍 = 屏幕上两个输入框、两条消息流，且都在真发消息。
          // 判据只有这一行，且**只在这里算**——`WorkspaceEntry` 被测试裸挂（无 Router），
          // 在它里面读 location 会当场抛（见那个 prop 上的注释）。
          // `routeSessionID` 只认生产那一种形态（`/server/<key>/session/<id>`），其余路由一律
          // `undefined` ⇒ 中栏照旧露上游页面，行为与加这一行之前逐字相同。
          routePageVisible={() => routeSessionID(location.pathname) === undefined}
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
