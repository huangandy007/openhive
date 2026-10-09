import { createSignal, For, Show, type JSX } from "solid-js"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { 可列出的会话, type 会话行 } from "./session-actions"
import { 会话重命名输入 } from "./session-rename"

/**
 * 左栏「会话」tab 的列表（设计 §7 / `2026-09-11-项目管理-design.md`）。
 *
 * ## 纯展示：一行判断都没有
 *
 * 与 `FileTree` / `ProjectAnchor` 同一口径——**只画 props、只喊回调**。它不取数（那是
 * `sidebar-sessions.tsx` 的活）、不筛（筛法走 `可列出的会话`，右栏那份）、不导航（只喊
 * `onSelect`）。所以这一层挂得起来测（`session-list.test.tsx`），而接线那一层挂不起来。
 *
 * ## 它做四件事
 *
 * 1. 标题行右侧「＋」＝**新增会话**；
 * 2. 当前会话**浅金高亮**（`bg-[var(--v2-background-bg-accent-soft)]`，与 `file-tree.tsx` 的
 *    `ROW_SELECTED` / `sidebar-tabs.tsx` 的 `TAB_ACTIVE` 同一个 token）；
 * 3. 点某一行 **切到那一场**；
 * 4. **右键某一行** ⇒ 「重命名 / 删除」（2026-10-09 用户下达；设计 §7 原话只说「左栏不重复放每行
 *    的图标」——**不放图标**这条仍然成立，变的是这些动作左栏也够得着了）。
 *
 * ## 三个 `data-slot`
 *
 * `session-list-bar`（标题行）/ `session-new`（＋）/ `session-item`（一行）/ `session-empty`（空态）
 * ——`session-item` / `session-empty` 沿用 T019 那批接线用例认的名字（`session-empty` 此前是
 * 「会话列表未接入」那块硬编码空态）。
 *
 * ## 复用而非重造（用户的原话：「不要重复造轮子」）
 *
 * 「重命名」在两个入口上是**同一件事**：交互走 `session-rename.tsx` 的 `会话重命名输入`
 * （右栏顶栏用的也是它），请求走 `session-actions.ts` 的 `重命名会话`（右栏用的也是它）。
 * 本文件里没有一处 `title` 的 trim / 比较 / 请求——那些判据全仓各只有一份（`LEARNINGS #002-06`）。
 *
 * 「删除」不在本文件重建：调用方接的就是右栏顶栏那个 `删会话`（`onDeleteSession` 是同一个形状）。
 * 这里只多一层**二次确认**，而且与文件树同口径——**内联在菜单项里**，不弹框
 * （`file-tree.tsx` 的注释：「树是用户眼睛已经在的地方」）。
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
  /** 右键菜单「重命名」改完那一下。省略 ＝ 还没接线，那一项**禁用**（同 `FileTree` 的口径）。 */
  onRenameSession?: (sessionID: string, title: string) => void
  /** 右键菜单「删除」**确认之后**那一下。形状与右栏顶栏那个 `删会话` 一致——复用，不重建。 */
  onDeleteSession?: (sessionID: string) => void
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
 *
 * 行高 **32px**（`h-8`）＝用户 2026-10-09 定的（原为 `h-6` / 24px）。两个落点——本串与
 * `ITEM_EDIT`——**必须一起改**，`session-list.test.tsx` 的「行视觉规格」组各钉了一条
 * （`LEARNINGS #005-12`：同一个修法落在 N 处就写 N 条，别折成一条）。
 */
const ITEM =
  "flex h-8 min-w-0 w-full shrink-0 cursor-pointer items-center rounded-[4px] px-1 text-start text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
const ITEM_ACTIVE = "bg-[var(--v2-background-bg-accent-soft)]"

/**
 * 编辑态那一行的 class——**与 `ITEM` 差三处**：
 *
 * 1. 少 `cursor-pointer` 与 hover：这时它是个**容器**，里头是输入框，点它没有「切到那一场」
 *    这回事；
 * 2. 有自己的**灰底** `bg-v2-overlay-simple-overlay-pressed`（实测落在容器上 ≈ `#E6E6E6`，
 *    与容器底 `#FAFAFA` 差 20 级）——用户 2026-10-09 定的「背景呈现灰色，以便能够很好的区分」。
 *    ⚠️ **不许再叠 `ITEM_ACTIVE`**：两个同权重的 `bg-*` 同时在场上时谁生效看 **CSS 先后**、
 *    不看 class 属性顺序（`LEARNINGS #003-05`），叠加就是「看着该灰、实际可能还是金」。
 *    定的口径是「**灰 > 金**」——同一行不能同时说「这是当前会话」和「这行在编辑」。
 *    （变的是它**画成什么样**；`aria-current` 不跟着摘，「这是当前会话」在 HTML 上仍然说得出来。）
 * 3. 高度与 `ITEM` **逐字相同**（`h-8` / `px-1` / `rounded-[4px]`）：改名的输入框必须**落在原来
 *    那一行的位置上**，否则文字会在眼前跳一下。
 */
const ITEM_EDIT =
  "flex h-8 min-w-0 w-full shrink-0 items-center rounded-[4px] px-1 bg-v2-overlay-simple-overlay-pressed"

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

  /** 正在改名的是**哪一行**（`undefined` ＝ 没有一行在改）。同一时刻只开一行。 */
  const [改名的, set改名的] = createSignal<string | undefined>()
  /**
   * 已经在菜单里问过「确认删除？」的是**哪一行**。
   *
   * 存 id 而不是布尔——「确认删除？」要让人看得出**删的是谁**，而且**换一行右键就得把问过的
   * 那一次作废**（否则下一击会在另一行头上执行一次没人确认过的删除）。两件事都要求它带着对象。
   */
  const [待删, set待删] = createSignal<string | undefined>()
  /**
   * 右键时指针底下那一行（`undefined` ＝ 不在任何一行上）。
   *
   * 它同时是两项的**作用对象**。⚠️ 与 `file-tree.tsx` 同一个坑：`onContextMenu` **不能**挂在
   * `ContextMenu.Trigger` 上（Kobalte 的触发器把它收走之后再 `preventDefault` /
   * `stopPropagation`，**不调用**外面传进来的那个）——挂上去的后果是**菜单照开、作用对象永远是
   * 「没有」**，而且不报错。
   */
  const [菜单对象, set菜单对象] = createSignal<string | undefined>()

  /** 右键时记下指针底下那一行，并把上一次问过的「确认删除？」作废。 */
  function 记行(event: MouseEvent) {
    const target = event.target
    const id =
      target instanceof Element
        ? (target.closest<HTMLElement>("[data-slot='session-item']")?.getAttribute("data-session-id") ?? undefined)
        : undefined
    set菜单对象(id)
    set待删(undefined)
  }

  /** 进那一行的编辑态。没有作用对象就不动作（不猜「大概是说第一行」）。 */
  function 点改名(sessionID: string | undefined) {
    if (!sessionID) return
    set待删(undefined)
    set改名的(sessionID)
  }

  /**
   * 「删除」**永远先问一次**，绝不直接喊 `onDeleteSession`。菜单项与文件树同口径：第一下只是
   * 把那一项变成「确认删除？」，第二下才真删——而**第二次必须是同一个对象**，所以判据是
   * `待删() !== id` 而不是「点过一下没有」。
   *
   * ## 收菜单那一下为什么挂在 `待删` 上，而不是一个常量
   *
   * 菜单项那侧的 `closeOnSelect={待删() !== 菜单对象()}` 是个 **getter**，而 Kobalte 的
   * `MenuItemBase` 是 **先调 `local.onSelect?.()`、再读 `local.closeOnSelect`**
   * （`@kobalte/core/dist/chunk/LEK3K6R3.jsx` 的 `MenuItemBase.onSelect`）⇒ 它读到的是
   * **这次点击之后**的状态。两支因此正好给出两个不同的值：
   *
   * - **第一下**：这里 `set待删(id)` ⇒ 它读到的 `待删() !== 菜单对象()` 为 `false` ⇒ **不关**；
   * - **第二下**：这里先 `set待删(undefined)`、再把 id 交出去 ⇒ 读到 `true` ⇒ **关**。
   *
   * ⚠️ 所以第 ② 支里那句 `set待删(undefined)` 是**判据的一半，不是可有可无的收尾**——删掉它，
   * 两次点击之后的 `待删` 就一模一样、区分不出来，菜单会**留在原地**指着一条已经不存在的会话
   * （2026-10-09 真栈实测：删完菜单原样开着，两项都还在）。而且它**不报错、不变红**。
   * `session-list.test.tsx` 的「确认删除之后菜单收掉」钉的就是它。
   */
  function 点删(sessionID: string | undefined) {
    if (!sessionID) return
    if (待删() !== sessionID) {
      set待删(sessionID)
      return
    }
    set待删(undefined)
    props.onDeleteSession?.(sessionID)
  }

  /** 改完那一下：交出去，并把编辑态收掉（请求与错误回话由调用方管）。 */
  function 交改名(sessionID: string, title: string) {
    set改名的(undefined)
    props.onRenameSession?.(sessionID, title)
  }

  /** 那一行在编辑态吗（`props.currentID` 与 `data-session-id` 一样是**字符串比较**，不是引用）。 */
  const 在编辑 = (会话: 会话列表行) => 改名的() === 会话.id

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

      {/* 列表与空态共处一个滚动区：标题行常驻（它是这个 pane 的「工具栏」，不该被滚走）」
          `ContextMenu` 罩住**这一整块**（不是每行一个）：触发器要有一个「右键落在哪儿就算哪儿」
          的区域，而 `记行` 在内层自己找那一行（同 `file-tree.tsx` 的结构）。 */}
      <ContextMenu modal={false}>
        <ContextMenu.Trigger
          as="div"
          data-slot="session-list-body"
          class="min-h-0 w-full flex-1 overflow-y-auto px-1 pt-1"
        >
          {/* ⚠️ `onContextMenu` 挂**这一层**、不挂 `ContextMenu.Trigger`（理由见 `菜单对象` 的注释）。 */}
          <div data-slot="session-list-region" class="flex w-full min-w-0 flex-col" onContextMenu={记行}>
            <For each={列出()}>
              {(会话) => (
                /* 编辑态**换掉**那个 `<button>`，不是往里塞一个 `<input>`——`<button>` 里放
                   `<input>` 是非法嵌套，浏览器会把 DOM 拆开，Solid 的 `ref` 与事件随后全落在
                   错位的节点上。两条分支都带着 `data-slot` / `data-session-id` / `aria-current`：
                   换的是「这一行画成什么样」，不是「这一行是谁」。 */
                <Show
                  when={在编辑(会话)}
                  fallback={
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
                  }
                >
                  <div
                    data-slot="session-item"
                    data-session-id={会话.id}
                    aria-current={会话.id === props.currentID ? "true" : undefined}
                    // 编辑态**不再分成两支**：灰底对每一行都一样（见 `ITEM_EDIT` 的注释——
                    // 「灰 > 金」，编辑当前会话时浅金让位）。`aria-current` 照旧带着。
                    class={ITEM_EDIT}
                  >
                    <会话重命名输入
                      原名={会话.title}
                      on提交={(新名) => 交改名(会话.id, 新名)}
                      on取消={() => set改名的(undefined)}
                    />
                  </div>
                </Show>
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
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item
              data-action="rename"
              // 「未接线」与「没有作用对象」是两条**独立**的禁用理由，合起来写进一个表达式即可，
              // 但别把它们混成一个布尔量（`file-tree.tsx` 那条注释记着这个区分）。
              disabled={!props.onRenameSession || 菜单对象() === undefined}
              onSelect={() => 点改名(菜单对象())}
            >
              <ContextMenu.ItemLabel>重命名</ContextMenu.ItemLabel>
            </ContextMenu.Item>

            <ContextMenu.Item
              data-action="delete"
              disabled={!props.onDeleteSession || 菜单对象() === undefined}
              // 收菜单**只在「确认」那一下**发生（第一下要让「确认删除？」留得住）——判据因此是
              // 「这次点击**之后** `待删` 还等不等于作用对象」：第一下刚被设上（相等 ⇒ 不关），
              // 第二下刚被清掉（不等 ⇒ 关）。⚠️ Kobalte 读它的时机在 `onSelect` **之后**，
              // 所以这里拿得到「点击后」的值（见 `点删` 的注释）。恒写 `false` 菜单永远留着、
              // 恒写 `true` 第一下就收掉——两种都能让这两条用例中的一条变红。
              closeOnSelect={待删() !== 菜单对象()}
              onSelect={() => 点删(菜单对象())}
            >
              <ContextMenu.ItemLabel>{待删() === 菜单对象() ? "确认删除？" : "删除"}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </div>
  )
}
