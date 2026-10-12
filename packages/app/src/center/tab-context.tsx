import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import {
  空中栏,
  activateContentTab,
  clearContentTabs,
  closeContentTab,
  focusPane as focusPaneState,
  openContentTab,
  splitPane as splitPaneState,
  switchModule as switchModuleState,
  unsplitPane as unsplitPaneState,
  type CenterTabState,
  type ContentTab,
  type PaneState,
} from "./tab-store"

/** 中栏 tab 状态的读写口（组件只认这一层，不直接碰 reducer）。 */
export interface CenterTabs {
  /** 当前**停留**的模块（左栏高亮那个），不是各 tab 的来源模块。 */
  module: Accessor<string | undefined>
  /**
   * 取**那一栏的对象**（不是它的 tabs）：调用方要 tabs 与 active 两样，分两次取会读到两个时刻
   * （`LEARNINGS #002-06`：同一件事的两半必须在同一个快照里）。
   */
  pane: (pane: 0 | 1) => PaneState
  /** 新开的 tab 落哪一栏 ＝ 哪一栏受焦。未分屏时恒 `0`。 */
  activePane: Accessor<0 | 1>
  /** 右栏露不露。 */
  split: Accessor<boolean>
  /** 排列方向（`"左右"` / `"上下"`）。 */
  排列: Accessor<"左右" | "上下">
  /** 打开一个 tab（FR-010：由模块动作调用，非预置常驻）。`pane` 省略 ＝ 受焦栏。 */
  open: (tab: ContentTab, pane?: 0 | 1) => void
  activate: (key: string, pane?: 0 | 1) => void
  close: (key: string, pane?: 0 | 1) => void
  /** 受焦栏改到这一栏（两栏各自的 `onMouseDown` 喊它）。未分屏时收敛回 0。 */
  focusPane: (pane: 0 | 1) => void
  /** 分屏：**不动任何 tab**，只把右栏露出来。 */
  splitPane: (排列: "左右" | "上下") => void
  /** 收起：右栏藏起来但节点不摘，它那些 tab 留着。 */
  unsplitPane: () => void
  /** 清空两栏（换项目时喊）。 */
  clear: () => void
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
  const [state, setState] = createSignal<CenterTabState>({ ...空中栏(), module: props.initialModule })

  /**
   * `module` 是**独立的一条轴**（当前停留哪个模块），与 tab 开合 / 分屏 / 清空那些写**不共一根弦**。
   *
   * 为什么必须 memo（2026-10-12 实测，代价是一条别人文件里的红）：`state` 是**整份对象**一个
   * signal，`module: () => state().module` 在**任何**写（开 tab、清空、分屏）下都会拨醒它的读口
   * ——哪怕 `.module` 那串一个字没变。而 `workspace-entry.tsx` 的 `left` 那道门写的是
   * `center.module() === "project" ? <左栏/> : undefined`：这个 getter **每读一次就可能新造一棵
   * 左栏子树**（`three-pane.tsx` 里记着同一件事）。于是「清空一个本就空的 center」这种空写，
   * 会让左栏子树被重造、那台隐藏文件选择器的 `ref` 指回**已摘除**的旧 input——之后点「上传」
   * 点的是空气（`选文件` 里 `文件选择器?.click()` 落在 detached 节点上）。
   *
   * `createMemo` 只会在 `.module` **真的变了**时才通知下游（内部仍每次重算，但 `===` 相等就
   * 不外传）。tab 开合 / 清空 / 分屏都不动 module ⇒ 左栏那道门不被重读 ⇒ 不重造子树。
   */
  const module = createMemo(() => state().module)

  const tabs: CenterTabs = {
    module,
    pane: (pane) => state().panes[pane],
    activePane: () => state().activePane,
    split: () => state().split,
    排列: () => state().排列,
    open: (tab, pane) => setState(openContentTab(state(), tab, pane)),
    activate: (key, pane) => setState(activateContentTab(state(), key, pane)),
    close: (key, pane) => setState(closeContentTab(state(), key, pane)),
    focusPane: (pane) => setState(focusPaneState(state(), pane)),
    splitPane: (排列) => setState(splitPaneState(state(), 排列)),
    unsplitPane: () => setState(unsplitPaneState(state())),
    clear: () => setState(clearContentTabs(state())),
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
