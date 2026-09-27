import { Show, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { CenterContent } from "@/center/center-content"
import type { LoadFileContent } from "@/center/file-content"
import { TabBar } from "@/center/tab-bar"
import { CenterTabsProvider, useCenterTabs } from "@/center/tab-context"
import { viewRegistry } from "@/center/views"
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

  return (
    <>
      {/* 图标栏是**三栏之外**的独立一列（DESIGN §4.1：图标栏 56px → 左项目侧栏 280px → 中 → 右），
          故不能塞进 `ThreePane` 的 `left` 槽（那是左项目侧栏，归 T010）。外层这层行容器因此必需：
          挂载点 `<main>`（layout-new.tsx）是 `flex-col`，直接并列两个子元素会变成上下堆叠。 */}
      <div data-component="workspace-entry" class="flex-1 min-h-0 min-w-0 w-full flex">
        <Rail
          active={center.module()}
          onSelect={(id) => center.switchModule(id)}
          capabilities={props.capabilities}
        />
        <ThreePane>
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
