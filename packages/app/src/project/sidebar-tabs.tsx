import { createUniqueId, For, type JSX } from "solid-js"

/**
 * 左栏三个 tab。前两个见 `2026-09-11-项目管理-design.md` §2 ②；第三个「能力」于
 * 2026-10-27 裁决加入（`2026-10-27-项目能力面板-design.md` §14）。
 */
export type SidebarTabKey = "session" | "files" | "capability"

const TAB_LABEL: Record<SidebarTabKey, string> = { session: "会话", files: "文件", capability: "能力" }

/**
 * 三个 tab 的顺序表——`For` 与「下一个是哪个」都从这里取，不各写一份（`LEARNINGS #004-02`）。
 */
const TAB_ORDER: readonly SidebarTabKey[] = ["session", "files", "capability"]

/**
 * tab 的两种外观——**两条独立的 class 串，不是「基础串 ＋ 叠加串」**。
 *
 * 理由同 `file-tree.tsx` 的 `TOOL_BUTTON` / `TOOL_BUTTON_DANGER`：两个同权重的文本色类同时挂在
 * 元素上时，谁生效取决于 **CSS 里的先后**，不看 class 属性的顺序 ⇒ 叠加写法会是个
 * 「看着该亮、实际不一定亮」的假象（`LEARNINGS #003-05`）。
 */
const TAB_BASE = "h-6 shrink-0 cursor-pointer rounded-[4px] px-2 text-[13px] transition-colors"
const TAB = `${TAB_BASE} text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover`
// 选中态＝品牌浅金（理由见 `file-tree.tsx` 的 `ROW_SELECTED`：005 Step 5 审查 X5-1）。
const TAB_ACTIVE = `${TAB_BASE} bg-[var(--v2-background-bg-accent-soft)] font-semibold text-v2-text-text-base`

/**
 * pane 的骨架。**三个 pane 用同一条**——今天它们只是内容不同，视觉规则没有分歧。
 *
 * ## `flex flex-col` 是**三个 pane 都要的**，不是「文件」pane 的专利（2026-10-10）
 *
 * 这一层必须是 flex 容器，body 根上那个 `flex-1` 才**有剩余空间可分**；否则它退化成
 * 「高度＝内容高」，页签余下的空白**不属于任何 `ContextMenu` 触发区** ⇒ 空白处右键冒不到
 * 触发器（症状：用户原话「在空白处单击右键呼不出右键」）。
 *
 * 用户先报的是「文件」tab，当天只给那一个 pane 加了这一条（当时的 `PANE_FILES`）；随后按 ⑥ 步
 * grep 同类落点，真栈实测**会话** tab **逐字同型** —— 页签 `session-list-slot` bottom = 841、
 * 列表根 `session-list` bottom = 189；空白点最上层是页签**自己** ⇒ 菜单开 = `false`。
 * ⇒ 合成一条。不保留两个常量的理由：它们本来就会一样，留着就是同一件事的第二个说法
 * （`LEARNINGS #002-06`）。
 */
const PANE = "min-h-0 w-full flex-1 overflow-y-auto px-1 pt-1 flex flex-col"

export interface SidebarTabsProps {
  /**
   * 当前激活的 tab。**受控**——本组件自己不持有 tab 状态（同 `ProjectAnchor` / `FileTree` 的口径：
   * 只画 props、只喊回调）。左栏「当前在哪个 tab」要同时被 MinIO 窄条（§5.1① 点窄条切回「文件」）
   * 与中栏模块切换读到，所以状态只能落在共同祖先 `workspace-entry.tsx` 里。
   */
  active: SidebarTabKey
  /** 切到某个 tab。 */
  onSelect: (key: SidebarTabKey) => void
  /**
   * 「文件」tab 的 body——**由调用方注入**（今天接的是 `@/project/file-tree` 那棵树）。
   * 本组件不认识文件树，正如 `ProjectAnchor` 不认识项目列表。
   */
  files: JSX.Element
  /**
   * 「会话」tab 的 body——**同样由调用方注入**（生产接的是 `@/ai-session/sidebar-sessions`
   * 那一具取数 ＋ 导航的壳，2026-10-08 接入）。本组件**不认识会话**，正如它不认识文件树。
   *
   * ⚠️ T019 那版这里是一句硬编码的「会话列表未接入」；接上之后那句**没有了**——空态归列表
   * 自己（`@/ai-session/session-list` 的 `session-empty`），因为「没接入」与「暂无会话」是
   * 两句相反的话，而只有列表知道自己是哪一种（`LEARNINGS #002-02`）。
   */
  sessions: JSX.Element
  /**
   * 「能力」tab 的 body——**同样由调用方注入**（生产接 `@/project/capability-panel`）。
   * 本组件不认识能力面板，正如它不认识文件树与会话列表。
   */
  capability: JSX.Element
  /**
   * 「能力」标签后的数字。`undefined` = 还没取到 ⇒ **只写「能力」，不写 0**：
   * 那是替后端回答一个它还没回答的问题（同 `minio-bar.tsx:32-35`、`#002-02`）。
   */
  capabilityCount?: number
}

/**
 * 左栏的 ② tab 容器 ＋ ③ 主体（设计 §2）：`[会话] [文件] [能力 N]`，默认「文件」。
 *
 * ## 三个 pane **同时挂载**，靠 `hidden` 属性切换
 *
 * 这不是省渲染的写法，是**正确性**的一半——同 `@/center/center-content` 里那条
 * 「还是同一份内容吗」的注释：`FileTree` 自己有搜索词 / 折叠态 / 选中行三份内部信号，
 * 用 `<Show>` 一卸载，**切一下 tab 就全没了**（用户在「文件」里选好一行、去「会话」看一眼、
 * 再回来，选中的东西不在了）。`hidden`（`display:none`）同时保证另一件事：非激活的 pane
 * **不进 Tab 顺序**，键盘到不了看不见的东西上。
 *
 * ## 键盘：只认 ← →
 *
 * 标准 ARIA tabs 的自动激活变体：← → 移动并激活，焦点跟着走（只动内容不动焦点的话，
 * 键盘用户下一次 Tab 会从自己站的地方跳走）。**不认 ↑ ↓**——那是树内部的事，见 `tasks.md`
 * 的 T019「↑↓ 区间导航继续挂账」。
 */
export function SidebarTabs(props: SidebarTabsProps) {
  const 基 = createUniqueId()
  const tabId = (key: SidebarTabKey) => `${基}-tab-${key}`
  const paneId = (key: SidebarTabKey) => `${基}-pane-${key}`

  /**
   * 相邻的下一个 tab——**索引环绕**：会话 → 文件 → 能力 → 会话。
   *
   * 两个 tab 时 ← → 等价于互换，直接写 `key === "session" ? "files" : "session"` 就够；
   * 2026-10-27 加了第三个，「谁在谁右边」不再是对称关系，必须真的走环。
   * 用取模而不是逐对列举：`TAB_ORDER` 是唯一顺序来源，加第四个 tab 时这里不用动（`#004-02`）。
   */
  const 下一个 = (key: SidebarTabKey, 步: 1 | -1): SidebarTabKey =>
    TAB_ORDER[(TAB_ORDER.indexOf(key) + 步 + TAB_ORDER.length) % TAB_ORDER.length]

  return (
    <div data-component="sidebar-tabs" class="flex min-h-0 w-full flex-1 flex-col">
      <div
        role="tablist"
        aria-label="左栏视图"
        class="flex h-7 shrink-0 items-center gap-1 border-b border-v2-border-border-muted px-1"
        // 键盘只有 ← →：ARIA tabs 的自动激活变体——移动即激活，**焦点跟着走**
        //（只挪内容不动焦点的话，键盘用户下一次 Tab 会从自己站的地方跳走）。
        // **不认 ↑ ↓**——那是树内部的事，见 `tasks.md` 的 T019「↑↓ 区间导航继续挂账」。
        // ⚠️ 写成**内联箭头**而不是具名函数：只有内联这处，Solid 才把 `currentTarget` 标成
        // 这个 div（具名函数收的是裸 `KeyboardEvent`，`currentTarget` 退化成 `EventTarget`，
        // 于是 `querySelector` 不存在）。这是仓库的成文写法，见 `auth/login-page.tsx` 那批
        // `onInput={(event) => …event.currentTarget.value}`。
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          const 目标 = 下一个(props.active, event.key === "ArrowRight" ? 1 : -1)
          props.onSelect(目标)
          // `currentTarget` 必须**同步**取——事件派发完就置 null。三个 tab 是**同一批 DOM 节点**
          // 被改属性、不随切换重建，所以这里取到的按钮与切换后页面上那个是同一个
          // （本文件有一条「切走切回没被重建」的用例把守）。
          event.currentTarget.querySelector<HTMLElement>(`[data-tab='${目标}']`)?.focus()
        }}
      >
        <For each={TAB_ORDER}>
          {(key) => (
            <button
              type="button"
              role="tab"
              data-slot="sidebar-tab"
              data-tab={key}
              id={tabId(key)}
              aria-selected={props.active === key}
              aria-controls={paneId(key)}
              // roving tabindex：只有激活的那个在 Tab 顺序里（T007 不给树行做这件事的原因是
              // 「没补 ↑↓ 就会出不去」；这里 ← → 是补了的，所以没有那个代价）。
              tabIndex={props.active === key ? 0 : -1}
              class={props.active === key ? TAB_ACTIVE : TAB}
              onClick={() => props.onSelect(key)}
            >
              {TAB_LABEL[key]}
              {key === "capability" && props.capabilityCount !== undefined ? ` ${props.capabilityCount}` : ""}
            </button>
          )}
        </For>
      </div>

      {/* ③ 会话。**与「文件」pane 同一条规则**：body 由调用方注入（设计 §7 的列表在
          `@/ai-session/session-list`，取数与导航在 `@/ai-session/sidebar-sessions`）。 */}
      <div
        role="tabpanel"
        data-slot="session-list-slot"
        data-pane="session"
        id={paneId("session")}
        aria-labelledby={tabId("session")}
        hidden={props.active !== "session"}
        class={PANE}
      >
        {props.sessions}
      </div>

      {/* ③ 文件。**这个 `data-slot` 名沿用 T007 的**：设计 §2 的 ③ 主体今天就是文件树那一块，
          T019 按裁定把它「整体搬进」tab body，搬的是**位置**不是身份——留着这个名字，
          T007 那批接线用例与 T012 都还能按原名找到它。 */}
      <div
        role="tabpanel"
        data-slot="file-tree-slot"
        data-pane="files"
        id={paneId("files")}
        aria-labelledby={tabId("files")}
        hidden={props.active !== "files"}
        class={PANE}
      >
        {props.files}
      </div>

      {/* ③ 能力（2026-10-27）。**与另外两个 pane 同一条规则**：body 由调用方注入。
          它同样常挂不卸载——面板里有「哪一组展开」的内部状态，切走再回来不该复位。 */}
      <div
        role="tabpanel"
        data-slot="capability-slot"
        data-pane="capability"
        id={paneId("capability")}
        aria-labelledby={tabId("capability")}
        hidden={props.active !== "capability"}
        class={PANE}
      >
        {props.capability}
      </div>
    </div>
  )
}
