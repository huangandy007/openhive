import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { For, Show, createSignal, type JSX } from "solid-js"
import { MEMBER_GLYPH } from "./project-anchor"

/**
 * 成员面板（FR-004 / US3 / `2026-09-11-项目管理-design.md` §4）：点锚点行的 `👥 N` **侧滑**出来。
 *
 * ```
 * 👥 成员管理 · 8·17 专案
 * ＋ 邀请成员（输入警号）
 * ── 成员（3）──
 * 👤 张三（本人）        owner
 * 👤 李四               member  [移除]
 * 👤 王五               member  [移除]
 * [退出项目]
 * ```
 *
 * ## 受控组件：它不认识任何数据源（同 `ProjectAnchor` / `ProjectPanel` 的口径）
 *
 * 成员表由 `members` prop 给、动作只喊回调，于是它能脱离六层 provider 单独渲染
 * （`member-panel.test.tsx` 正是这么跑的）。数据从哪来由调用方决定——今天来自
 * 成员接缝（待接线），接线只有一处（`@/workspace/workspace-entry`）。
 *
 * ## 「侧滑」这个形态不在这里（本组件不知道自己在哪儿）
 *
 * 定位（`absolute` / 从右边滑入）由**调用方包一层**决定，同 `ProjectPanel` 的做法——
 * `ProjectPanel` 自己是 `w-full`、由 `workspace-entry` 的 `<Show>` 包一层 `absolute inset-x-0`。
 * happy-dom **没有 CSS 引擎**，几何量不到，所以这个决定本来也测不进本组件。
 *
 * ## 🔴 权限：一律问 `ProjectMembership.decide`，本组件**不重写任何规则**（FR-004）
 *
 * 微信群模型（本项目设计 §4 原文）：
 *
 * | 动作 | 谁能做 |
 * |---|---|
 * | `invite` | owner **与** member 都能 |
 * | `remove` | **仅 owner**，且目标是 member |
 * | `leave` | **仅 member**（owner 不能退群）；且退的永远是**自己** |
 * | 已归档的项目 | 冻结——除 owner 的找回外，上述一个都不成立（FR-010） |
 *
 * 这四条**不写在这里**，全部由 `packages/core/src/project/membership.ts` 的 `decide` 回答。
 * 复述规则是最容易漂的一类镜像（`LEARNINGS #003-05`：镜像的两侧只要有一条不覆盖的写法，
 * 这个镜像就是假的），而这里连复述都不需要——`actor` 从 `selfPoliceId` 反查得到 `role`，
 * 查不到就是 `null`，`decide` 对 `null` 的每个动作都落空 ⇒ 前端天然 fail-closed。
 *
 * ## 「权限决定**画不画**，接线决定**能不能点**」——两条独立的理由（T005 起的口径）
 *
 * - `decide` 说不成立 ⇒ 那个按钮**根本不渲染**（画一个点了报「你没权限」的按钮没有意义）；
 * - 回调没给 ⇒ 渲染成 `disabled`（`LEARNINGS #005-01` 的反面：一个点了没反应的按钮是对用户的谎）。
 *
 * 所以本组件里 `disabled` **只**看「接没接线」，从不看权限——权限那半已经在上一步把元素去掉了。
 * 两件事各查各的，混在一起就会写出「有权限但没接线」时按钮**可点而无声**的形状。
 *
 * ## ⚠️ 本 task 刻意不落库（用户 2026-10-06 裁定：范围 = 前端面板 ＋ 接缝）
 *
 * 邀请 / 移除 / 退群的**落库与 HTTP 出口**今天**没有接收方**：`packages/auth/src/project-member.ts`
 * 目前只有读（T004），`packages/opencode/src/project/member.ts` 是**上游目录**里的一个文件、
 * 尚无本 feature 的改动。所以三个回调都不接线 ⇒ 渲染成 `disabled`——**这是实情不是缺陷**
 * （同 `ProjectPanel` 的两个新建按钮、`ProjectAnchor` 的三个按钮）。
 * 落库缺口由 **T021** 认领（`LEARNINGS #002-04`：责任推出边界必须落接收方的表）。
 */
export interface MemberEntry {
  /**
   * 警号——成员的身份（设计 §4：「输入警号邀请」，复用管理员录入的警号体系）。
   *
   * 它同时是**列表 key**、**「本人」的比对依据**与 `onRemove` 回传的对象，所以必填且唯一。
   */
  readonly policeId: string
  readonly name: string
  /**
   * 成员在这条链上的身份，两档（FR-004 末句：不设 viewer 只读角色）。
   *
   * ⚠️ **复用 core 的 `MemberRole`，不在这里重新声明一个 `"owner" | "member"`**：
   * 那会是同一份闭集的第二处写法，而 `decide` 的入参正是这个类型——两处一旦漂开，
   * 编译器不会说话（`LEARNINGS #004-03`：闭合集要有取值断言钉着，别靠裸联合各写各的）。
   */
  readonly role: ProjectMembership.MemberRole
}

export interface MemberPanelProps {
  /** 面板标题里的项目名（设计 §4：`成员管理 · 8·17 专案`）。省略 = 只写「成员管理」。 */
  readonly projectName?: string
  /** 成员表。省略 / 空 = 走空态（同 `ProjectPanel` 的 `projects`）。 */
  readonly members?: readonly MemberEntry[]
  /**
   * **我是谁**——用警号（同 `TopbarUser.policeId`）。
   *
   * 省略 / 查不到 ⇒ `decide` 的 `actor` 为 `null` ⇒ 动作一个都不画。这是**有意的 fail-closed**：
   * 身份没到之前宁少勿假，而不是先按「大概能行」把按钮画出来。
   */
  readonly selfPoliceId?: string
  /** 项目是否已归档（FR-010）。归档 = 冻结，交给 `decide` 判，本组件不另写判断。 */
  readonly archived?: boolean
  /** 邀请（设计 §4：输入警号）。回传**已 trim** 的警号。省略 = 禁用。 */
  readonly onInvite?: (policeId: string) => void
  /** 移除某人。回传**那一行**的成员本身（列表里没有「当前选中」那一套）。省略 = 禁用。 */
  readonly onRemove?: (member: MemberEntry) => void
  /** 退出项目——不带参数：退的永远是**自己**（`selfPoliceId` 那个人）。省略 = 禁用。 */
  readonly onLeave?: () => void
}

/**
 * 成员行前的小人。
 *
 * 和 `MEMBER_GLYPH` 一样是彩色 emoji ⇒ **不接 `--icon-base`**（同 `ProjectAnchor` 的注释：
 * emoji 自带颜色，塞进 `ICON_WRAP` 也不变色）。所以这里刻意**不**用 `Icon`，也不用 `ICON_WRAP`。
 */
export const PERSON_GLYPH = "👤"

const PANEL =
  "flex w-full min-w-0 flex-col gap-1 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1 shadow-lg"

const TITLE_ROW = "flex h-7 shrink-0 items-center gap-1 px-1.5 text-[13px] text-v2-text-text-base"

const ROW = "flex h-7 min-w-0 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-[13px] text-v2-text-text-base"

/**
 * 「成员（N）」那条分组标题（设计 §4：`── 成员（3）──`）。
 *
 * 设计图里两侧的横线是 **ASCII 草图的装饰**，不是要渲染的字符——真实界面用**留白 + 小号字**
 * 表达「这是一条分组分隔」更自然，也不必让 `textContent` 里混进装饰符（测试可读）。
 */
const COUNT_ROW = "shrink-0 px-1.5 pt-1 pb-0.5 text-[11px] text-v2-text-text-muted"

const ROLE_LABEL = "shrink-0 text-[11px] text-v2-text-text-muted"

const SMALL_BUTTON = [
  "cursor-pointer rounded-[4px] px-1.5 py-0.5 text-[12px] transition-colors",
  "text-v2-text-text-base hover:bg-v2-background-bg-layer-03",
  "disabled:cursor-default disabled:text-v2-text-text-faint disabled:hover:bg-transparent",
].join(" ")

const INPUT = "min-w-0 flex-1 rounded-[4px] bg-v2-background-bg-layer-03 px-1.5 py-0.5 text-[12px] text-v2-text-text-base"

export function MemberPanel(props: MemberPanelProps): JSX.Element {
  const 成员 = () => props.members ?? []

  /**
   * **我是谁**——在成员表里按警号反查。查不到 = `undefined`（不是成员 / 身份还没到）。
   *
   * ⚠️ 「谁是我」这个判断**只写这一处**：下面「本人」标记也读它（`<Show when={m === 我()}>`），
   * 权限反查 role 也读它。分成两处写（一处 `find(...)` 判权限、一处 `m.policeId ===
   * props.selfPoliceId` 画标记）看着无害，但变异验证会当场拆穿：把 `find` 换成 `成员()[0]`
   * 时，**只有权限那侧红**，标记那侧一条用例都不动（2026-10-06 实测，M5 原版 5 红 / 加上标记后 6 红）
   * ——那正是 `LEARNINGS #002-06` 说的「同一个判断在两处各写一份：不报错、不变红」。
   */
  const 我 = () => 成员().find((m) => m.policeId === props.selfPoliceId)

  /**
   * **能不能**做某个动作——唯一判据是 `ProjectMembership.decide`（见文件头）。
   *
   * `target` 只有 `remove` 用得上（`DecisionInput` 里那句「刻意必填而不是可选」的注释解释了为什么
   * 它不给默认值）；这里给 `null` 作默认是**调用侧**的便利，而 `remove` 那条**永远显式传**那一行的
   * `role`——所以「忘了传 target」在 `remove` 上仍然落空（拒），方向是保守的。
   */
  const 能 = (action: ProjectMembership.ProjectAction, target: ProjectMembership.MemberRole | null = null) =>
    ProjectMembership.decide({
      actor: 我()?.role ?? null,
      action,
      target,
      archived: props.archived === true,
    })

  /** 邀请框里那个警号。 */
  const [警号, set警号] = createSignal("")

  /**
   * 点「邀请」——**空警号一个字都不喊**。
   *
   * 不靠 `disabled` 表达（那会和「没接线 ⇒ 禁用」混成同一个视觉，用户分不出是哪一种），
   * 而是在这里挡掉：空字符串不是一个人，不该被当成一个人发出去。
   */
  function 邀请() {
    const 值 = 警号().trim()
    if (!值) return
    set警号("")
    props.onInvite?.(值)
  }

  return (
    <div data-component="member-panel" class={PANEL}>
      {/* 标题：`👥 成员管理 · 8·17 专案`（emoji 在槽**外**，槽里只有文字——测试读 textContent） */}
      <div class={TITLE_ROW}>
        <span aria-hidden="true">{MEMBER_GLYPH}</span>
        <span data-slot="member-panel-title" class="min-w-0 truncate">
          成员管理{props.projectName === undefined ? "" : ` · ${props.projectName}`}
        </span>
      </div>

      {/* ＋ 邀请成员（输入警号）——`decide` 说不成立就整块不画（含归档） */}
      <Show when={能("invite")}>
        <div class="flex shrink-0 items-center gap-1 px-1.5">
          <span aria-hidden="true">{PERSON_GLYPH}</span>
          <input
            data-slot="member-panel-invite-input"
            type="text"
            placeholder="输入警号邀请"
            value={警号()}
            onInput={(e) => set警号(e.currentTarget.value)}
            class={INPUT}
          />
          <button
            type="button"
            data-slot="member-panel-invite-ok"
            class={SMALL_BUTTON}
            disabled={props.onInvite === undefined}
            onClick={邀请}
          >
            邀请
          </button>
        </div>
      </Show>

      <div data-slot="member-panel-count" class={COUNT_ROW}>
        成员（{成员().length}）
      </div>

      <Show
        when={成员().length > 0}
        fallback={
          <div data-slot="member-panel-empty" class="px-2 py-3 text-[12px] text-v2-text-text-faint">
            还没有成员
          </div>
        }
      >
        <For each={成员()}>
          {(m) => (
            <div data-slot="member-row" data-police-id={m.policeId} class={ROW}>
              <span aria-hidden="true">{PERSON_GLYPH}</span>
              <span data-slot="member-name" class="min-w-0 truncate">
                {m.name}
              </span>
              {/* 「本人」标记：自己得认得出自己（设计 §4：`张三（本人）`）。
                  `m === 我()` 比的是**同一个对象引用**（两处都取自 props.members 的元素），
                  所以它和权限反查 role 走的是同一个判断——改一处两处一起动。 */}
              <Show when={m === 我()}>
                <span data-slot="member-self" class={ROLE_LABEL}>
                  （本人）
                </span>
              </Show>
              <span data-slot="member-role" class={`ml-auto ${ROLE_LABEL}`}>
                {m.role}
              </span>
              {/* [移除]：`decide` 说不成立就不画（含「目标是 owner」——否则项目会无主） */}
              <Show when={能("remove", m.role)}>
                <button
                  type="button"
                  data-slot="member-remove"
                  aria-label={`移除 ${m.name}`}
                  class={SMALL_BUTTON}
                  disabled={props.onRemove === undefined}
                  onClick={() => props.onRemove?.(m)}
                >
                  移除
                </button>
              </Show>
            </div>
          )}
        </For>
      </Show>

      {/* [退出项目]：仅 member 看得到（owner 不能退群）；上边框把它和列表分开（设计 §4 的底部单独一行） */}
      <Show when={能("leave")}>
        <div class="mt-1 shrink-0 border-t border-v2-border-border-muted px-1.5 pt-1">
          <button
            type="button"
            data-slot="member-panel-leave"
            class={SMALL_BUTTON}
            disabled={props.onLeave === undefined}
            onClick={() => props.onLeave?.()}
          >
            退出项目
          </button>
        </div>
      </Show>
    </div>
  )
}
