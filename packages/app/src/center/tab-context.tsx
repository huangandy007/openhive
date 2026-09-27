import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import {
  activateContentTab,
  closeContentTab,
  openContentTab,
  switchModule as switchModuleState,
  type CenterTabState,
  type ContentTab,
} from "./tab-store"

/** 中栏 tab 状态的读写口（组件只认这一层，不直接碰 reducer）。 */
export interface CenterTabs {
  /** 当前**停留**的模块（左栏高亮那个），不是各 tab 的来源模块。 */
  module: Accessor<string | undefined>
  /** 已打开的 tab，顺序即显示顺序（FR-004）。 */
  tabs: Accessor<readonly ContentTab[]>
  /** 当前激活 tab 的 key。 */
  active: Accessor<string | undefined>
  /** 打开一个 tab（FR-010：由模块动作调用，非预置常驻）。 */
  open: (tab: ContentTab) => void
  activate: (key: string) => void
  close: (key: string) => void
  /** 切当前工作上下文（左栏换模块）——MUST NOT 动已有 tab（FR-006）。 */
  switchModule: (module: string) => void
}

const CenterTabsContext = createContext<CenterTabs>()

/**
 * 中栏 tab 状态的响应式外壳（FR-004 / FR-006）。
 *
 * `tab-store.ts` 是**纯 reducer**（T005 定的契约，好测）；本组件只做两件事：把状态放进
 * signal、把动作转交给那些 reducer。之所以用 context 而不是模块级单例：T011 的「模块动作」
 * 与 T012+ 的视图散在树的深处，逐层传 prop 会把中栏状态焊进每一层；context 让它们就近取用。
 * 也因此作用域随 `<CenterTabsProvider>` 走——组件测试天然互不串味，不必写全局复位钩子。
 */
export function CenterTabsProvider(props: ParentProps<{ initialModule?: string }>): JSX.Element {
  // 只在挂载时读一次：进门停在哪个模块是初值，之后一律由 switchModule 改。
  const [state, setState] = createSignal<CenterTabState>({ tabs: [], module: props.initialModule })

  const tabs: CenterTabs = {
    module: () => state().module,
    tabs: () => state().tabs,
    active: () => state().active,
    open: (tab) => setState(openContentTab(state(), tab)),
    activate: (key) => setState(activateContentTab(state(), key)),
    close: (key) => setState(closeContentTab(state(), key)),
    switchModule: (module) => setState(switchModuleState(state(), module)),
  }

  return <CenterTabsContext.Provider value={tabs}>{props.children}</CenterTabsContext.Provider>
}

/** 取中栏 tab 状态。在 provider 之外调用是接线错误——直接抛错，不静默给 undefined。 */
export function useCenterTabs(): CenterTabs {
  const tabs = useContext(CenterTabsContext)
  if (!tabs) throw new Error("useCenterTabs 必须在 <CenterTabsProvider> 之内使用")
  return tabs
}
