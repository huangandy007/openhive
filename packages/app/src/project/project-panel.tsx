import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, createSignal } from "solid-js"
import { MEMBER_GLYPH } from "./project-anchor"

/**
 * 项目面板（FR-002 / FR-003 / `2026-09-11-项目管理-design.md` §3）：点锚点行的 `▾` 滑出，
 * 结构是**一个置顶的新建入口 ＋ 三个 tab**——
 *
 * ```
 * ＋ 新建项目（私有 / 共享）   ← 置顶，最易达（设计 §3）
 * [最近] [全部] [已归档]      ← 三 tab（没有「当前」：当前项目已常驻左栏顶部，见设计 §3）
 * ```
 *
 * ## 受控组件：它不认识任何数据源（同 `ProjectAnchor` 的口径）
 *
 * 数据由 `projects` prop 给、动作只喊回调，于是它能脱离六层 provider 单独渲染
 * （`project-panel.test.tsx` 正是这么跑的）。数据从哪来由调用方决定——今天来自
 * `@/project/project-list` 那个接入缝（读作 `undefined`），接线只有一处（`@/workspace/workspace-entry`）。
 *
 * ## ⚠️ 本 task 刻意不落库（用户 2026-10-06 裁定：范围 = 前端面板 ＋ 接缝）
 *
 * 「新建项目」今天**没有接收方**：上游两条链**都没有** `POST /project`（create），
 * `project_ext` 也只有读函数 `findByProjectID`（T003），`project_member` / `project_archive`
 * 更是刻意留白（T004 裁定「有消费者才写取数」）。所以 `onCreate` 不接线 ⇒ 两个新建按钮渲染成
 * `disabled`——**这是实情不是缺陷**（同 `ProjectAnchor` 的三个按钮）：一个点了没反应的按钮是对
 * 用户的谎，而「看起来能点」比「少个按钮」更难查。
 * 落库缺口由 **T018** 认领（`LEARNINGS #002-04`：责任推出边界必须落接收方的表），
 * 故 T006 的出参**「新建项目成功」不在本 task 交付**，只有「三 tab 可切换」在。
 *
 * ## 三 tab 的关系：同一份集合的三个视图（所以过滤在本组件里做）
 *
 * - 「最近」= 活跃项目，按 `lastAccessedAt` 倒序（FR-002 的排序要求就落在这个 tab 上）；
 * - 「全部」= 活跃项目，按 `type` 分「我的项目 / 共享项目」两组（设计 §3）；
 * - 「已归档」= `archived` 的项目，带「找回」入口（设计 §3 / FR-009）。
 *
 * 分组的依据是**数据字段**（`type` / `archived`），不是调用方给的顺序——那样三个 tab 才真是
 * 同一份集合的视图，而不是三份碰巧长得像的清单。
 */
export type ProjectType = "private" | "shared"

/** 三 tab 的身份。 */
export type ProjectPanelTab = "recent" | "all" | "archived"

/**
 * 面板要画的一个项目。
 *
 * 字段是**按「面板要画什么」定的**（`LEARNINGS #004-07`：判据形状由被调方定义）：
 * `type` 决定「全部」分到哪一组，`archived` 决定它在不在「已归档」，
 * `lastAccessedAt` 决定「最近」的先后，`memberCount` 只在共享项目上有（设计 §3 的 `👥 N`）。
 *
 * ⚠️ 这些字段**今天没有任何后端提供**——`project_ext`（每用户库）有 `last_accessed_at`，
 * `project_member`（业务 PG）有成员，`project_archive`（业务 PG）有归档态，但三者都**没有**
 * 前端读得到的出口。把它们拼成这里这一行的活是 **T018** 的。
 */
export interface ProjectEntry {
  /** 稳定标识：列表 key、`currentId` 比对、`onOpen` / `onRestore` 回传都用它。 */
  id: string
  name: string
  /** 私有 / 共享——「全部」tab 靠它分两组（设计 §3）。 */
  type: ProjectType
  /** 成员数。**私有项目读作 `undefined`**（同 `ProjectAnchor`：不给 0、不给假数）。 */
  memberCount?: number
  /** 最近访问时间（ms）。「最近」tab 按它倒序（FR-002）。 */
  lastAccessedAt: number
  /** 已归档。「已归档」tab 靠它筛（设计 §3 / §8）；省略 = 活跃。 */
  archived?: boolean
}

export interface ProjectPanelProps {
  /** 面板要列的全部项目（三 tab 各自取子集）。省略 / 空 = 走空态。 */
  projects?: readonly ProjectEntry[]
  /** 当前项目的 id——列表里那一行会带（当前）标记（设计 §3 的「8·17专案（当前）」）。 */
  currentId?: string
  /** 点某个项目：切成当前项目（FR-003 / AC4 的落点）。省略 = 项目行不可点。 */
  onOpen?: (project: ProjectEntry) => void
  /** 点「新建（私有 / 共享）」（FR-003）。省略 = 两个按钮禁用（今天就是这样，见文件头）。 */
  onCreate?: (type: ProjectType) => void
  /** 点已归档项目的「找回」（FR-009）。省略 = 不画「找回」按钮。 */
  onRestore?: (project: ProjectEntry) => void
}

/** 三 tab 的**顺序即优先级**（设计 §3：最近 / 全部 / 已归档）。 */
const TABS: readonly { id: ProjectPanelTab; label: string }[] = [
  { id: "recent", label: "最近" },
  { id: "all", label: "全部" },
  { id: "archived", label: "已归档" },
]

/**
 * 空态文案**分两句话**：「还没有项目」与「没有已归档的项目」说的不是一件事
 * ——后者是「你有项目，只是没有归档的」，写成同一句会把两件事糊成一件。
 */
const EMPTY_ACTIVE = "还没有项目"
const EMPTY_ARCHIVED = "没有已归档的项目"

/**
 * 图标颜色**必须由包着它的那层注入 `--icon-base`**（同 `project-anchor.tsx` / `rail.tsx`）：
 * 不注入不会报错，只会**静默恒灰**。
 */
const ICON_WRAP = "flex items-center [--icon-base:var(--v2-icon-icon-muted)]"

/** 新建入口里的两个按钮：小、次要（DESIGN §4.2「次要按钮」）。 */
const CREATE_BUTTON = [
  "cursor-pointer rounded-[4px] px-1.5 py-0.5 text-[12px] transition-colors",
  "text-v2-text-text-base hover:bg-v2-background-bg-layer-03",
  "disabled:cursor-default disabled:text-v2-text-text-faint disabled:hover:bg-transparent",
].join(" ")

/** 三 tab 的页签。选中态走类名切换（`classList`），不用 `aria-*` 变体——少一层 Tailwind 语义。 */
const TAB_BUTTON = [
  "flex-1 cursor-pointer rounded-[4px] px-1.5 py-1 text-[12px] transition-colors",
  "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover",
].join(" ")

/** 一行项目（可点的那些；归档那组的行是 `div`，因为它里面还要放「找回」按钮）。 */
const ITEM_BUTTON = [
  "flex h-7 min-w-0 w-full shrink-0 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-left",
  "text-v2-text-text-muted transition-colors",
  "hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base",
  "disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-v2-text-text-muted",
].join(" ")

/** 同一行的静态外壳（归档组那个 `div` 用）。 */
const ITEM_STATIC = "flex h-7 min-w-0 w-full shrink-0 items-center gap-2 rounded-[6px] px-1.5 text-v2-text-text-base"

/** 一行的内容——活跃行与归档行**同一套**（名字 / 当前标记 / 成员数），只是外壳不同。 */
function ItemBody(props: { project: ProjectEntry; current: boolean }) {
  return (
    <>
      <span data-slot="project-item-name" class="min-w-0 flex-1 truncate">
        {props.project.name}
      </span>
      <Show when={props.current}>
        <span
          data-slot="project-item-current"
          class="shrink-0 rounded-[4px] bg-v2-background-bg-layer-03 px-1 text-[11px] text-v2-text-text-muted"
        >
          当前
        </span>
      </Show>
      {/* `keyed` 是为了拿到收窄后的数字本身——非 `keyed` 的 Show 里仍是 `number | undefined`
          （同 `project-anchor.tsx` 的成员徽章）。 */}
      <Show when={props.project.memberCount} keyed>
        {(count) => (
          <span data-slot="project-item-members" class="flex shrink-0 items-center gap-1 text-v2-text-text-muted">
            <span aria-hidden="true">{MEMBER_GLYPH}</span>
            <span data-slot="project-item-member-count">{count}</span>
          </span>
        )}
      </Show>
    </>
  )
}

/** 一组项目：组标题 + 若干行。**空组不画**（画一个空标题只是噪音）。 */
function Group(props: {
  group: string
  label: string
  items: readonly ProjectEntry[]
  currentId?: string
  onOpen?: (project: ProjectEntry) => void
}) {
  return (
    <Show when={props.items.length > 0}>
      <div data-slot="project-group" data-group={props.group} class="flex min-w-0 flex-col">
        <div data-slot="project-group-label" class="px-1.5 py-1 text-[11px] text-v2-text-text-faint">
          {props.label}
        </div>
        <For each={props.items}>
          {(project) => {
            const current = () => project.id === props.currentId
            return (
              <button
                type="button"
                data-slot="project-item"
                data-current={current() ? "true" : undefined}
                class={ITEM_BUTTON}
                classList={{
                  "bg-v2-background-bg-layer-03 text-v2-text-text-base": current(),
                }}
                disabled={props.onOpen === undefined}
                onClick={() => props.onOpen?.(project)}
              >
                <ItemBody project={project} current={current()} />
              </button>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

/** 「已归档」那一组：每行带「找回」（FR-009）。 */
function ArchivedGroup(props: {
  items: readonly ProjectEntry[]
  currentId?: string
  onRestore?: (project: ProjectEntry) => void
}) {
  return (
    <Show when={props.items.length > 0}>
      <div data-slot="project-group" data-group="archived" class="flex min-w-0 flex-col">
        <div data-slot="project-group-label" class="px-1.5 py-1 text-[11px] text-v2-text-text-faint">
          已归档项目
        </div>
        <For each={props.items}>
          {(project) => (
            // 外壳是 `div` 不是 `button`——它里面有「找回」按钮，按钮不能嵌按钮。
            <div
              data-slot="project-item"
              data-current={project.id === props.currentId ? "true" : undefined}
              class={ITEM_STATIC}
            >
              <ItemBody project={project} current={project.id === props.currentId} />
              <Show when={props.onRestore}>
                {(restore) => (
                  <button
                    type="button"
                    data-slot="project-restore"
                    aria-label={`找回 ${project.name}`}
                    class={CREATE_BUTTON}
                    onClick={() => restore()(project)}
                  >
                    找回
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

export function ProjectPanel(props: ProjectPanelProps) {
  // 默认停在第一个 tab「最近」（同「顺序即优先级」）。
  const [tab, setTab] = createSignal<ProjectPanelTab>("recent")

  const 全部 = () => props.projects ?? []
  const 活跃 = () => 全部().filter((p) => p.archived !== true)
  const 已归档 = () => 全部().filter((p) => p.archived === true)
  /** 「最近」= 活跃项目按访问时间倒序（FR-002 的排序要求）。 */
  const 最近 = () => [...活跃()].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)

  const 空态 = (文案: string) => (
    <div data-slot="project-panel-empty" class="px-2 py-3 text-[12px] text-v2-text-text-faint">
      {文案}
    </div>
  )

  return (
    <div
      data-component="project-panel"
      class="flex w-full min-w-0 flex-col gap-1 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1 shadow-lg"
    >
      {/* 置顶：＋ 新建项目（私有 / 共享） */}
      <div data-slot="project-panel-create" class="flex items-center gap-1 px-1.5 py-0.5">
        <span class={ICON_WRAP}>
          <Icon name="plus" size="small" />
        </span>
        <span class="flex-1 truncate text-[12px]">新建项目</span>
        <button
          type="button"
          data-slot="project-panel-create-private"
          aria-label="新建私有项目"
          class={CREATE_BUTTON}
          disabled={props.onCreate === undefined}
          onClick={() => props.onCreate?.("private")}
        >
          私有
        </button>
        <button
          type="button"
          data-slot="project-panel-create-shared"
          aria-label="新建共享项目"
          class={CREATE_BUTTON}
          disabled={props.onCreate === undefined}
          onClick={() => props.onCreate?.("shared")}
        >
          共享
        </button>
      </div>

      <div data-slot="project-panel-tabs" role="tablist" class="flex items-center gap-0.5 px-0.5">
        <For each={TABS}>
          {(t) => (
            <button
              type="button"
              role="tab"
              data-slot="project-panel-tab"
              data-tab={t.id}
              aria-selected={tab() === t.id ? "true" : "false"}
              class={TAB_BUTTON}
              classList={{ "bg-v2-background-bg-layer-03 text-v2-text-text-base": tab() === t.id }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      <div data-slot="project-panel-body" role="tabpanel" class="flex min-w-0 flex-col">
        <Show when={tab() === "recent"}>
          <Show when={最近().length > 0} fallback={空态(EMPTY_ACTIVE)}>
            <Group
              group="recent"
              label="最近访问"
              items={最近()}
              currentId={props.currentId}
              onOpen={props.onOpen}
            />
          </Show>
        </Show>

        <Show when={tab() === "all"}>
          <Show when={活跃().length > 0} fallback={空态(EMPTY_ACTIVE)}>
            <Group
              group="mine"
              label="我的项目"
              items={活跃().filter((p) => p.type === "private")}
              currentId={props.currentId}
              onOpen={props.onOpen}
            />
            <Group
              group="shared"
              label="共享项目"
              items={活跃().filter((p) => p.type === "shared")}
              currentId={props.currentId}
              onOpen={props.onOpen}
            />
          </Show>
        </Show>

        <Show when={tab() === "archived"}>
          <Show when={已归档().length > 0} fallback={空态(EMPTY_ARCHIVED)}>
            <ArchivedGroup items={已归档()} currentId={props.currentId} onRestore={props.onRestore} />
          </Show>
        </Show>
      </div>
    </div>
  )
}
