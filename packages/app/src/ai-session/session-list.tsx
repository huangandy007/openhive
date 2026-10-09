import { For, Show, type JSX } from "solid-js"
import { 可列出的会话, type 会话行 } from "./session-actions"

/**
 * 左栏「会话」tab 的列表（设计 §7 / `2026-09-11-项目管理-design.md`）。
 *
 * ## 纯展示：一行判断都没有
 *
 * 与 `FileTree` / `ProjectAnchor` 同一口径——**只画 props、只喊回调**。它不取数（那是
 * `sidebar-sessions.tsx` 的活）、不筛（筛法走 `可列出的会话`，右栏那份）、不导航（只喊
 * `onSelect`）。所以这一层挂得起来测（`session-list.test.tsx`），而接线那一层挂不起来。
 *
 * ## 设计 §7 把它定死成了三件事
 *
 * 1. 标题行右侧「＋」＝**新增会话**（「重命名 / 删除 / 导出在右栏「⋯」菜单，左栏会话列表
 *    **不重复放图标**——左栏只放高频的「新增」」）；
 * 2. 当前会话**浅金高亮**（`bg-[var(--v2-background-bg-accent-soft)]`，与 `file-tree.tsx` 的
 *    `ROW_SELECTED` / `sidebar-tabs.tsx` 的 `TAB_ACTIVE` 同一个 token）；
 * 3. 点某一行 **切到那一场**。
 *
 * ## 三个 `data-slot`
 *
 * `session-list-bar`（标题行）/ `session-new`（＋）/ `session-item`（一行）/ `session-empty`（空态）
 * ——`session-item` / `session-empty` 沿用 T019 那批接线用例认的名字（`session-empty` 此前是
 * 「会话列表未接入」那块硬编码空态）。
 */

/**
 * 列表要读的字段：`id`（key 与回调）。`title` **可选**——`会话行` 里没有它，而它是给人看的
 * 唯一那一样：没有 title 就退回 `id`，不画一个空行（同 `session-panel.tsx` 那条
 * `<span>{会话.title}</span>`，只是那边 `Session` 的 `title` 一定有）。
 *
 * ⚠️ `parentID` / `time` **不在**这里——它们只喂筛法，本组件一个字段都不多读。
 */
export interface 会话列表行 extends 会话行 {
  readonly title?: string
}

export interface SessionListProps {
  /**
   * 当前项目在沙箱里的**绝对目录**。`undefined` ＝ 还没选中项目（或目录还未知）。
   *
   * 它同时是「＋」的**唯一**判据（见下）——所以不另设一个 `canCreate` 之类的布尔：两个名字
   * 描述同一件事，就会有第二处能写错的地方。
   */
  directory?: string
  /**
   * 那个目录下的会话表（**原样给**，筛法由本组件按 `可列出的会话` 走）。
   * `undefined` ＝ 还没取到（**不是**「一场都没有」）。
   */
  sessions?: readonly 会话列表行[]
  /** 当前会话 id（来自路由）。省略 ＝ 视图不在任何一场会话上，于是没有行高亮。 */
  currentID?: string
  onSelect: (sessionID: string) => void
  /**
   * 新增会话。**收目录**（不是无参）——调用方拿到的就是本组件据以画「＋」的那一个，
   * 于是「判目录有没有」这件事全仓只有这一处。
   */
  onNewSession: (directory: string) => void
}

/**
 * 行与标题行的 class 串——**两条独立的串，不写成「基础串 ＋ 选中串」**。
 *
 * 理由同 `sidebar-tabs.tsx` 的 `TAB` / `TAB_ACTIVE`：两个同权重的 `bg-*` 同时挂在元素上时谁生效
 * 取决于 **CSS 里的先后**，不看 class 属性的顺序 ⇒ 叠加写法会是个「看着该亮、实际不一定亮」的
 * 假象（`LEARNINGS #003-05`）。本文件那条用例断的是**选中行带浅金、未选中行不带**，并让
 * **未选中行确实带着 hover token**（X5-1 要的是「选中与 hover 是两个不同的 token」，让两边摆在一起
 * 才比得出来）——**不是**断「选中行不许带 hover」：选中行同时带两个 token 是本仓既有写法
 * （`file-tree.tsx` 的 `classList`），断言「不许有」等于发明一条仓库里没有的规则。
 */
const ITEM =
  "flex h-6 min-w-0 w-full shrink-0 cursor-pointer items-center rounded-[4px] px-1 text-start text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
const ITEM_ACTIVE = "bg-[var(--v2-background-bg-accent-soft)]"

export function SessionList(props: SessionListProps): JSX.Element {
  /**
   * 筛过的表。**`undefined` 一路保持 `undefined`**（不折成 `[]`）——「还没取到」与
   * 「一场都没有」在下游是两个不同的画面，折在这里就再也分不出来了。
   *
   * ⚠️ 求值写成普通函数（不是 `createMemo`）是**安全的**，而且是对的：`props.sessions` 是个
   * **数组**、不是 `JSX.Element` getter，读它不会新建子树（与 `LEARNINGS #006-21` 那条
   * 「读 `props.x` 是副作用」的场景不同——那条讲的是 `Element` 型的 props）。
   */
  const 列出 = () => (props.sessions === undefined ? undefined : 可列出的会话(props.sessions))

  return (
    <div data-component="session-list" class="flex min-h-0 w-full flex-1 flex-col">
      {/* 标题行：**只有「＋」**（左边不写「会话」二字——头上那个 tab 已经写了）。
          它**不在** `role="tablist"` 里：tablist 里只许有 tab，塞个按钮进去屏幕阅读器读到的
          是「第三个 tab」。 */}
      <Show when={props.directory}>
        {(目录) => (
          <div data-slot="session-list-bar" class="flex h-7 shrink-0 items-center justify-end px-1">
            <button
              type="button"
              data-slot="session-new"
              aria-label="新建会话"
              title="新建会话"
              class="h-6 shrink-0 cursor-pointer rounded-[4px] px-2 text-[13px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
              onClick={() => props.onNewSession(目录())}
            >
              ＋
            </button>
          </div>
        )}
      </Show>

      {/* 列表与空态共处一个滚动区：标题行常驻（它是这个 pane 的「工具栏」，不该被滚走）」 */}
      <div data-slot="session-list-body" class="min-h-0 w-full flex-1 overflow-y-auto px-1 pt-1">
        <For each={列出()}>
          {(会话) => (
            <button
              type="button"
              data-slot="session-item"
              data-session-id={会话.id}
              aria-current={会话.id === props.currentID ? "true" : undefined}
              // 选中态是**另一条链**的 class 串（见 ITEM / ITEM_ACTIVE 的注释）：不写成
              // `classList` 叠两个 bg，那样两个同权重 token 谁生效要看 CSS 先后。
              class={会话.id === props.currentID ? `${ITEM} ${ITEM_ACTIVE}` : ITEM}
              onClick={() => props.onSelect(会话.id)}
            >
              <span class="min-w-0 truncate">{会话.title ?? 会话.id}</span>
            </button>
          )}
        </For>

        {/* 空态只在**两样都有**时才说：目录已知 ＋ 表在手（`!== undefined`）。
            少了任何一个，说「暂无会话」都是把「还没问到」讲成「问到了，没有」（`#002-02`）。 */}
        <Show when={props.directory !== undefined && 列出()?.length === 0}>
          <p
            data-slot="session-empty"
            data-state="empty"
            class="px-1 py-2 text-[13px] text-v2-text-text-faint"
          >
            暂无会话
          </p>
        </Show>
      </div>
    </div>
  )
}
