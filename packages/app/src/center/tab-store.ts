/** 中栏 tab 绑定的内容。 */
export interface ContentTab {
  /**
   * 这张 tab **由哪个模块打开**（项目管理 / 话单分析 / 资金分析…），FR-005 着色依据。
   * 是 tab 身份的一部分——同一个文件在两个模块里打开算两张 tab。
   * 注意与 `CenterTabState.module`（当前**停留**在哪个模块）区分：一个是出生地，一个是现在站的地方。
   */
  module: string
  /** tab 上显示的名字，一般取文件名。 */
  title: string
  /** 绑定的文件路径——视图注册表按它的扩展名解析视图（FR-007）。 */
  path: string
}

/** 一栏（pane）的内容。中栏恒有两栏：`panes[0]` 左/上、`panes[1]` 右/下。 */
export interface PaneState {
  /** 本栏已打开的 tab，顺序即显示顺序。 */
  tabs: ContentTab[]
  /** 本栏当前激活 tab 的 key（`contentTabKey` 形态）。 */
  active?: string
}

/** 中栏共享 tab 状态（001 的单栏 ＋ 2026-10-12 的分屏）。 */
export interface CenterTabState {
  /** 恒两栏。未分屏时右栏为空且不露（`split` 说了算，不看它有没有 tab）。 */
  panes: [PaneState, PaneState]
  /**
   * 右栏露不露。
   *
   * **显式存**、不从 `panes` 推：**收起**只把右栏藏起来，它那些 tab 留着
   * （设计文档 §3.1 决定 2）——「有没有 tab」与「露不露」是两件事。
   */
  split: boolean
  /**
   * 排列方向：`"左右"` ＝ 并排（竖着一条隔板）、`"上下"` ＝ 叠放（横着一条隔板）。
   *
   * ⚠️ 这两个词**只在交付给 `ResizeHandle` 那一行**翻译成 `horizontal` / `vertical`
   * （`center-split.tsx`），别在本层预先翻（spec §6）。
   */
  排列: "左右" | "上下"
  /** 新开的 tab 落哪一栏 ＝ 哪一栏受焦。未分屏时恒 `0`。 */
  activePane: 0 | 1
  /** 当前**停留**的模块（左栏所在的那个）——切它 MUST NOT 动 tabs（FR-006）。 */
  module?: string
}

/**
 * tab 的身份 key：来源模块 + 内容路径（FR-005 按模块着色，故同一文件在不同模块里
 * 是两个 tab）。分隔符用 `\n`，避免路径里的 `:` 造成拼接歧义。
 */
export const contentTabKey = (tab: ContentTab) => `${tab.module}\n${tab.path}`

/**
 * 空状态。**函数而不是常量**：它是每份状态的起点，共用一个对象等于让所有起点共享同一对
 * `panes` 数组（今天没有一处改它，但那是运气，不是保证）。
 */
export function 空中栏(): CenterTabState {
  return { panes: [{ tabs: [] }, { tabs: [] }], split: false, 排列: "左右", activePane: 0 }
}

/** 换掉某一栏。**只动那一栏**——另一栏必须是**原对象**（`===` 不变，视图才不重挂）。 */
function 换栏(current: CenterTabState, pane: 0 | 1, 下一栏: PaneState): CenterTabState {
  const panes: [PaneState, PaneState] = pane === 0 ? [下一栏, current.panes[1]] : [current.panes[0], 下一栏]
  return { ...current, panes }
}

/**
 * `!split` ⇒ 受焦栏归 0。
 *
 * 不收敛的后果是**静默**的：右栏没露，而新文件开进了它 ⇒ 用户点了「打开」，
 * 屏幕上什么都不发生（`LEARNINGS #006-27` 那类「认不出来就不发」的温床）。
 * 每一处会改动 `activePane` 的函数都要过这一道。
 */
function 收敛(current: CenterTabState): CenterTabState {
  return current.split || current.activePane === 0 ? current : { ...current, activePane: 0 }
}

/**
 * 点击一张已在列表里的 tab，把它切为当前——只动激活态，不动顺序（FR-004：
 * 顺序即显示顺序，点一下 SHOULD NOT 把 tab 挪到最前，那会让位置随点击乱跳）。
 */
export function activateContentTab(current: CenterTabState, key: string, pane: 0 | 1 = current.activePane): CenterTabState {
  return 收敛({ ...换栏(current, pane, { ...current.panes[pane], active: key }), activePane: pane })
}

/**
 * 打开一个 tab（FR-010：由模块动作打开，非预置常驻）。
 *
 * 已经开着就把它切过去（认的是 `contentTabKey`，故同一内容重复打开不会长出第二张）；
 * 否则追加到末尾。无论哪种，打开都意味着切过去。
 */
export function openContentTab(current: CenterTabState, tab: ContentTab, pane: 0 | 1 = current.activePane): CenterTabState {
  const key = contentTabKey(tab)
  const 栏 = current.panes[pane]
  // 已经开着就把它切过去（认的是 `contentTabKey`）；否则追加到末尾。无论哪种，打开都意味着切过去。
  const opened: PaneState = 栏.tabs.some((item) => contentTabKey(item) === key) ? 栏 : { ...栏, tabs: [...栏.tabs, tab] }
  return 收敛({ ...换栏(current, pane, { ...opened, active: key }), activePane: pane })
}

/**
 * 关闭一个 tab；若关的正是激活项，接替者优先取左邻居，没有左邻居则取右邻居
 * （沿用 `layout-tabs.ts` 的 `index-1 ?? index+1` 语义；`tabs` 已滤掉自己，
 * 故原 index 处的元素恰是原右邻居）。
 */
export function closeContentTab(current: CenterTabState, key: string, pane: 0 | 1 = current.activePane): CenterTabState {
  const 栏 = current.panes[pane]
  const index = 栏.tabs.findIndex((item) => contentTabKey(item) === key)
  const tabs = 栏.tabs.filter((item) => contentTabKey(item) !== key)
  if (栏.active !== key) return 收敛({ ...换栏(current, pane, { ...栏, tabs }), activePane: pane })
  const heir = tabs[index - 1] ?? tabs[index]
  return 收敛({ ...换栏(current, pane, { ...栏, tabs, active: heir ? contentTabKey(heir) : undefined }), activePane: pane })
}

/**
 * 切换当前工作上下文（左栏换模块）。
 *
 * 只换 module，MUST NOT 清空或改动中栏已有 tab（FR-006 / SC-002）。
 */
export function switchModule(current: CenterTabState, module: string): CenterTabState {
  return { ...current, module }
}

/** 分屏：**不动任何 tab**（谁在哪栏、谁激活，一字不改），只把右栏露出来。 */
export function splitPane(current: CenterTabState, 排列: "左右" | "上下"): CenterTabState {
  return { ...current, split: true, 排列 }
}

/** 收起：右栏**藏起来但节点不摘**（`center-split.tsx` 用 `display:none`），它那些 tab 留着。 */
export function unsplitPane(current: CenterTabState): CenterTabState {
  return { ...current, split: false, activePane: 0 }
}

/** 受焦栏改到这一栏（两栏各自的 `onMouseDown` 喊它）。未分屏时收敛回 0。 */
export function focusPane(current: CenterTabState, pane: 0 | 1): CenterTabState {
  return 收敛({ ...current, activePane: pane })
}

/**
 * 清空两栏（**换项目**时喊，2026-10-12 追加）。
 *
 * 为什么必须有：左栏那棵树是**当前项目**的文件，而中栏一张 tab 绑的是一个**路径**。
 * 换了项目之后，旧 tab 的路径在新项目里指向另一样东西（或者什么都不指向）——那看起来像
 * **串项目**，与 `workspace-entry.tsx` 里文件清单那条 effect 的注释（「留着上一个项目的
 * 文件更糟」）是同一个判断。
 *
 * `排列` 留着（下次分屏还是用户上次选的那个方向）；`split` 归 `false`——换完项目回到单栏，
 * 让两栏空着（其中一栏还看不见）是没道理的状态。
 */
export function clearContentTabs(current: CenterTabState): CenterTabState {
  return { ...current, panes: [{ tabs: [] }, { tabs: [] }], split: false, activePane: 0 }
}
