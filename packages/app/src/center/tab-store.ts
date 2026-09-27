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

/** 中栏共享 tab 状态。 */
export interface CenterTabState {
  /** 已打开的 tab，跨模块累积（FR-004），顺序即显示顺序。 */
  tabs: ContentTab[]
  /** 当前激活 tab 的 key。 */
  active?: string
  /**
   * 当前**停留**的模块（左栏所在的那个）——切它 MUST NOT 动 tabs（FR-006）。
   * 与 `ContentTab.module`（各 tab 的**来源**模块）不是一回事。
   */
  module?: string
}

/**
 * tab 的身份 key：来源模块 + 内容路径（FR-005 按模块着色，故同一文件在不同模块里
 * 是两个 tab）。分隔符用 `\n`，避免路径里的 `:` 造成拼接歧义。
 */
export const contentTabKey = (tab: ContentTab) => `${tab.module}\n${tab.path}`

/**
 * 点击一张已在列表里的 tab，把它切为当前——只动激活态，不动顺序（FR-004：
 * 顺序即显示顺序，点一下 SHOULD NOT 把 tab 挪到最前，那会让位置随点击乱跳）。
 */
export function activateContentTab(current: CenterTabState, key: string): CenterTabState {
  return { ...current, active: key }
}

/**
 * 打开一个 tab（FR-010：由模块动作打开，非预置常驻）。
 *
 * 已经开着就把它切过去（认的是 `contentTabKey`，故同一内容重复打开不会长出第二张）；
 * 否则追加到末尾。无论哪种，打开都意味着切过去。
 */
export function openContentTab(current: CenterTabState, tab: ContentTab): CenterTabState {
  const key = contentTabKey(tab)
  const opened = current.tabs.some((item) => contentTabKey(item) === key)
    ? current
    : { ...current, tabs: [...current.tabs, tab] }
  return activateContentTab(opened, key)
}

/**
 * 关闭一个 tab；若关的正是激活项，接替者优先取左邻居，没有左邻居则取右邻居
 * （沿用 `layout-tabs.ts` 的 `index-1 ?? index+1` 语义；`tabs` 已滤掉自己，
 * 故原 index 处的元素恰是原右邻居）。
 */
export function closeContentTab(current: CenterTabState, key: string): CenterTabState {
  const index = current.tabs.findIndex((item) => contentTabKey(item) === key)
  const tabs = current.tabs.filter((item) => contentTabKey(item) !== key)
  if (current.active !== key) return { ...current, tabs }
  const heir = tabs[index - 1] ?? tabs[index]
  return { ...current, tabs, active: heir ? contentTabKey(heir) : undefined }
}

/**
 * 切换当前工作上下文（左栏换模块）。
 *
 * 只换 module，MUST NOT 清空或改动中栏已有 tab（FR-006 / SC-002）。
 */
export function switchModule(current: CenterTabState, module: string): CenterTabState {
  return { ...current, module }
}
