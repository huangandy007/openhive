import { createUniqueId, For, type JSX } from "solid-js"

/** 左栏两个 tab（`2026-09-11-项目管理-design.md` §2 ②：只有「会话 / 文件」两个）。 */
export type SidebarTabKey = "session" | "files"

/**
 * 两个 tab 的字面，**顺序即显示顺序**——设计 §2 画的就是 `[会话] [文件]`（默认停「文件」）。
 *
 * ⚠️ 这两个词是**判据**，不是装饰：US4 的验收标准原文写着「当前在**「文件」tab**」，
 * 所以「会话 / 文件」这个分法不是本组件自选的措辞。
 */
const TAB_LABEL: Record<SidebarTabKey, string> = { session: "会话", files: "文件" }

/**
 * 两个 tab 的顺序表——`For` 与「另一个是哪个」都从这里取，不各写一份（`LEARNINGS #004-02`）。
 */
const TAB_ORDER: readonly SidebarTabKey[] = ["session", "files"]

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

/** pane 的骨架。**两个 pane 用同一条**——今天它们只是内容不同，视觉规则没有分歧。 */
const PANE = "min-h-0 w-full flex-1 overflow-y-auto px-1 pt-1"

/**
 * 「文件」pane 的骨架：在 `PANE` 之上**再当一层 flex 容器**。
 *
 * 为什么只有这一个 pane 需要（2026-10-11，用户实报「空白处右键呼不出菜单」的根因）：
 * 见 `@/project/file-tree` 里那条同题注释——树的外层写着 `flex-1`，而它的父级若**不是**
 * flex 容器，那个 `flex-1` 就无剩余空间可分，退化成「高度＝内容高」⇒ 页签余下的空白
 * 不属于任何 `ContextMenu` 触发区 ⇒ 空白处右键冒不到触发器。
 */
const PANE_FILES = `${PANE} flex flex-col`

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
}

/**
 * 左栏的 ② tab 容器 ＋ ③ 主体（设计 §2）：`[会话] [文件]`，默认「文件」。
 *
 * ## 两个 pane **同时挂载**，靠 `hidden` 属性切换
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
   * 另一个 tab 是哪个。只有两个 ⇒ ← 与 → 都等于「切到另一个」（环绕在两个元素上退化成互换）。
   * 写成这样而不是 `indexOf` ＋ 取模：后者要处理「找不到」和「越界」两条**不可能发生**的分支。
   * 将来真加了第三个 tab，这里是一眼能看见该改的地方。
   */
  const 另一个 = (key: SidebarTabKey): SidebarTabKey => (key === "session" ? "files" : "session")

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
          const 目标 = 另一个(props.active)
          props.onSelect(目标)
          // `currentTarget` 必须**同步**取——事件派发完就置 null。两个 tab 是**同一批 DOM 节点**
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
        class={PANE_FILES}
      >
        {props.files}
      </div>
    </div>
  )
}
