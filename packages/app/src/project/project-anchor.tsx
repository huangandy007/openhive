import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"

/**
 * 项目锚点行（FR-001 / DESIGN §4.1）：左栏置顶的**上下文锚点**——
 * `项目名 + 成员数 + ▾（下拉项目列表）+ ＋（新建项目）`。
 *
 * 设计意图（`2026-09-11-项目管理-design.md` §2 ①）：民警**必须先看清「我在哪个项目干活」**，
 * 所以这一行常驻左栏顶部，四个元素不随空态消失（成员徽章除外，见下）。
 *
 * ## 这是一个**受控**组件：它不认识任何数据源
 *
 * 项目数据从哪来由调用方决定——今天来自 `@/project/current-project` 那个接入缝（读作
 * `undefined`），接线只有一处（`@/workspace/workspace-entry`）。这与 `@/topbar/topbar`
 * 收 `user` prop、顶栏自己不取身份是同一个口径（T008 立的规矩）：**组件只画 props、只喊回调**，
 * 于是本组件可以脱离六层 provider 单独渲染（本文件那组单测正是这么跑的）。
 *
 * ## 空态：宁缺勿假
 *
 * 没有当前项目时显示「未选择项目」并带 `data-state="empty"`，**不**塞一个占位项目名。
 * 理由同 `@/workspace/current-user`：把假数据放进 DOM，等真数据接上时没人分得清哪个是真的。
 *
 * ## 成员徽章：**有成员数才画**（设计 §4）
 *
 * 「共享项目在项目名旁显示 `👥 N`」——私有项目没有成员可言 ⇒ 调用方传 `undefined` 即可。
 * 判据是**这个属性在不在**，不是它的值：本组件不给 0、也不给假数。
 *
 * ## 三个按钮今天都是禁用态（这不是缺陷，是实情）
 *
 * ▾ / ＋ 接的是 T006 的项目面板、成员徽章接的是 T010 的成员面板——**都还没落地**。
 * 没拿到回调时按钮渲染成 `disabled`：一个点了没反应的按钮是对用户的谎，而「看起来能点」
 * 比「少个按钮」更难查（同「没报错 ≠ 执行了」）。T006/T010 接上回调，禁用态自然消失。
 */
export interface ProjectAnchorProps {
  /** 当前项目名。`undefined` = 尚未选中项目 ⇒ 空态。 */
  name?: string
  /** 成员数。`undefined` = 不画徽章（私有项目）。**共享项目才有**（设计 §4）。 */
  memberCount?: number
  /** 点 ▾：展开项目列表（T006）。省略 = 禁用。 */
  onToggleList?: () => void
  /** 点 ＋：新建项目（T006）。省略 = 禁用。 */
  onCreate?: () => void
  /** 点成员徽章：滑出成员面板（T010）。省略 = 禁用。 */
  onOpenMembers?: () => void
}

/** 空态文案。 */
const EMPTY_LABEL = "未选择项目"

/**
 * 成员徽章的图形（设计 §4 画的就是 `👥`）。
 *
 * ⚠️ **待设计侧复核项**（同 DESIGN.md §4.6 对「五档措辞 + `shield` 选型」的处理）：opencode 原生
 * 图标集里**没有** people / users 一档（已逐个枚举 `packages/ui/src/components/icon.tsx` 的全部
 * 图标名），故取设计文档字面的 `👥` 字形。代价一并写在这里：**emoji 不接 `--icon-base`**，与
 * DESIGN §1.2「单色线性图标」的纪律不同调——同一行的 `▾`／`＋` 都是单色 `Icon`。
 * 另两条收尾各有代价，留待设计侧裁定：① 往上游图标集加一档（要动 `icon.tsx`，那是**上游文件**，
 * 按宪法 §二须单独提交并标注保留的定制）；② 自绘内联 SVG（照 `@/topbar/topbar` 品牌标记的先例）。
 *
 * **这里是它唯一的定义**（T006 起导出）：项目面板的 `👥 N`（设计 §3「共享项目带 👥 + 成员数」）
 * 与锚点行的是**同一个设计元素**，故 `project-panel.tsx` 直接导入本常量——裁定「取哪个字形」
 * 时两处一起变，不会各写一份而漂开（`LEARNINGS #003-05` 的假镜像）。
 */
export const MEMBER_GLYPH = "👥"

/** 三个按钮共用的骨架：24px 方形、悬停浅底；**禁用时连悬停底也撤掉**（否则看着仍像能点）。 */
const BUTTON = [
  "flex h-6 shrink-0 cursor-pointer items-center rounded-md transition-colors",
  "hover:bg-v2-overlay-simple-overlay-hover",
  "disabled:cursor-default disabled:hover:bg-transparent",
].join(" ")

/**
 * 图标颜色**必须由包着它的那层注入 `--icon-base`**：`packages/ui/src/components/icon.css`
 * 给图标自身写了 `color: var(--icon-base)`，直接盖过继承来的色。不注入不会报错，只会
 * **静默恒灰**（`--icon-base` 的兜底是上游硬编码的一档灰）。与 `rail.tsx` 同因同注。
 */
const ICON_WRAP = "flex items-center [--icon-base:var(--v2-icon-icon-muted)]"

export function ProjectAnchor(props: ProjectAnchorProps) {
  return (
    <div
      data-component="project-anchor"
      class="flex h-10 shrink-0 select-none items-center gap-1 border-b border-v2-border-border-muted px-2 text-[13px]"
    >
      <span
        data-slot="project-anchor-name"
        data-state={props.name === undefined ? "empty" : "filled"}
        class="min-w-0 flex-1 truncate"
        classList={{ "text-v2-text-text-muted": props.name === undefined }}
      >
        {props.name ?? EMPTY_LABEL}
      </span>

      {/* `keyed` 是为了拿到收窄后的数字本身——非 `keyed` 的 Show 里 `props.memberCount` 仍是
          `number | undefined`，就得靠非空断言，而那正是 lint 门盯的东西。 */}
      <Show when={props.memberCount} keyed>
        {(count) => (
          <button
            type="button"
            data-slot="project-anchor-members"
            aria-label={`成员 ${count}`}
            disabled={props.onOpenMembers === undefined}
            onClick={() => props.onOpenMembers?.()}
            class={`${BUTTON} gap-1 px-1 text-v2-text-text-muted`}
          >
            <span aria-hidden="true">{MEMBER_GLYPH}</span>
            <span data-slot="project-anchor-member-count">{count}</span>
          </button>
        )}
      </Show>

      <button
        type="button"
        data-slot="project-anchor-toggle"
        aria-label="切换项目"
        disabled={props.onToggleList === undefined}
        onClick={() => props.onToggleList?.()}
        class={`${BUTTON} w-6 justify-center`}
      >
        <span class={ICON_WRAP}>
          <Icon name="chevron-down" size="small" />
        </span>
      </button>

      <button
        type="button"
        data-slot="project-anchor-create"
        aria-label="新建项目"
        disabled={props.onCreate === undefined}
        onClick={() => props.onCreate?.()}
        class={`${BUTTON} w-6 justify-center`}
      >
        <span class={ICON_WRAP}>
          <Icon name="plus" size="small" />
        </span>
      </button>
    </div>
  )
}
