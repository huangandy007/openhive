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
 * ## 落库：T006 时留的缺口，T018 已接上
 *
 * T006 时「新建项目」**没有接收方**（上游两条链都没有 `POST /project`，`project_ext` 只有读函数），
 * 故 `onCreate` 不接线 ⇒ 两个新建按钮渲染成 `disabled`。**那是实情不是缺陷**：一个点了没反应的
 * 按钮是对用户的谎，而「看起来能点」比「少个按钮」更难查。缺口当时按
 * `LEARNINGS #002-04` 落进了 **T018** 的表（责任推出边界必须落接收方的表），T018 落库 ＋ 出口
 * 齐了，于是接线回到本组件之外的那一层（`@/workspace/workspace-entry`：有真数据源才传
 * `onCreate`，没传就仍是禁用态——组件本身**照旧不认识任何数据源**）。
 *
 * 于是 T006 那条「『新建项目成功』不在本 task 交付」**到此为止**：名字怎么来（本 task 的
 * 那一行输入）、建完什么结果（`onCreate` 的回话）、失败怎么告诉民警（输入框下那一句）都在这里，
 * 而「建到哪儿去」在 T018 的落库那一侧。
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

/**
 * 要建的一个新项目：**名字 ＋ 类型**，两样都得有。
 *
 * 名字在界面上由使用者当场打（点「私有 / 共享」之后面板顶上开一行），不在这里编——
 * 005 全仓没有改名入口，名字打下去就是永久的。
 */
export interface NewProjectInput {
  name: string
  type: ProjectType
}

export interface ProjectPanelProps {
  /** 面板要列的全部项目（三 tab 各自取子集）。省略 / 空 = 走空态。 */
  projects?: readonly ProjectEntry[]
  /** 当前项目的 id——列表里那一行会带（当前）标记（设计 §3 的「8·17专案（当前）」）。 */
  currentId?: string
  /** 点某个项目：切成当前项目（FR-003 / AC4 的落点）。省略 = 项目行不可点。 */
  onOpen?: (project: ProjectEntry) => void
  /**
   * 建一个新项目（FR-003）。省略 = 两个按钮禁用。
   *
   * ⚠️ 带 `name`：点按钮**不直接建**，而是先在面板上开一行输入（见 `NewProjectInput`）。
   * 省略 `name` 的老签名（`(type) => void`）不行——项目名是**锚点行上唯一的显示物**，
   * 而 005 全仓**没有改名入口**（`grep` 过），编出来的名字是永久的。
   *
   * ## 回话：**回一句话 = 没建成，那句话给民警看；其余（`undefined` / 不回）= 收工**
   *
   * 建是**异步**的（要落库、要一次往返），所以「成了没有」这个事实只有**那边**知道，
   * 面板只能等。等来的那句话直接显示在输入框下面、**输入框留着**——没建成却一点动静都没有的话，
   * 民警只会以为点坏了、再点一次，而 005 全仓没有删项目的入口。
   *
   * 面板**不认识 HTTP**：它只管「有没有话要说，说什么」，把状态码翻成话是调用方的事
   * （同本文件头的「受控组件」口径——所以这里收的是一句话，不是一个结论对象）。
   */
  onCreate?: (input: NewProjectInput) => string | undefined | Promise<string | undefined> | void

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

/** 起名字那一行。视觉值全部走 v2 token（宪法 §八；同 tab 与按钮，不写裸色值）。 */
const NAME_INPUT = [
  "w-full rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-02",
  "px-1.5 py-0.5 text-[12px] text-v2-text-text-base outline-none",
  "placeholder:text-v2-text-text-faint",
].join(" ")

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
  /**
   * 正在起名字的那一类项目；`undefined` = 没在起名字（那一行不画）。
   *
   * 点「私有 / 共享」**不直接建**，只是把这一行打开（FR-003 加了半步：名字得由人给）。
   * 收起的三种方式——建成了 / `Esc` / 失焦——都走 `收起()`，所以只有一处改这个信号。
   */
  const [起名, set起名] = createSignal<ProjectType | undefined>()
  /**
   * 上一次没建成的那句话；`undefined` = 没话说（还没建过 / 建成过 / 还没等到回话）。
   *
   * 与 `起名` **同生共死**（收起草稿就一起清），所以它只在那一行在的时候存在——
   * 画面上不会出现「一条没有来处的失败文案」。
   */
  const [没建成, set没建成] = createSignal<string | undefined>()
  /** 交出去之后、回话之前。这段缝隙里这一行是**锁着**的（见 `建`）。 */
  const [在办, set在办] = createSignal(false)

  /** 收起草稿：`起名` 与 `没建成` 一起清——只清一个就会留下话不对板的文案。 */
  const 收起 = () => {
    set起名(undefined)
    set没建成(undefined)
  }

  /**
   * 交出去建，等回话。
   *
   * **锁**（`在办`）是在这儿落的：提交从同步改成异步之后，回车与回话之间有了一段缝隙，
   * 而这段缝隙里第二次回车会**再建一个**。005 全仓没有删项目的入口，重复建出来的只能留着
   * ——所以缝隙里回车 / `Esc` / 失焦**一律不算数**（三个入口同一条锁，`#004-01`：数清出口）。
   */
  const 建 = async (type: ProjectType, name: string) => {
    set没建成(undefined)
    set在办(true)
    const 回话 = await props.onCreate?.({ name, type })
    set在办(false)
    // 只有**字符串**算「有话要说」：`undefined` / 回调压根没返回值，都按收工处理。
    if (typeof 回话 !== "string") {
      收起()
      return
    }
    set没建成(回话)
  }

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
          onClick={() => set起名("private")}
        >
          私有
        </button>
        <button
          type="button"
          data-slot="project-panel-create-shared"
          aria-label="新建共享项目"
          class={CREATE_BUTTON}
          disabled={props.onCreate === undefined}
          onClick={() => set起名("shared")}
        >
          共享
        </button>
      </div>

      {/*
        起名字那一行：点「私有 / 共享」之后才在，就在新建入口底下。
        三种收法——回车（建）／`Esc`／失焦（都只是收起，不建）；**空名字回车不收起**，
        留着让民警接着打（拿一个空名去建，锚点行上就会出现一个没有名字的项目）。
      */}
      <Show when={起名()}>
        {(类型) => (
          <>
            <input
              data-slot="project-panel-name"
              /**
               * 出现即拿住焦点：点完「私有」直接就能打字，不必再点一下。
               *
               * ⚠️ 必须**等一个微任务**，不能直接 `el.focus()`：`ref` 回调是在元素**还没插进
               * 文档**的时候跑的，对游离节点调 `focus()` 是空操作（2026-10-06 实测，就是被
               * 「出现时就拿住焦点」那条用例抓出来的：直写时 `Received: false`）。
               * 微任务排在插入之后，那时节点已经在了。同族的 `rAF` 用法见
               * `components/prompt-input/slash-popover.tsx`，这里用微任务是因为**更早**
               * （同一个任务内，不等到下一帧）。
               */
              ref={(el) => queueMicrotask(() => el.focus())}
              type="text"
              aria-label="项目名称"
              placeholder="项目名称"
              class={NAME_INPUT}
              onKeyDown={(event) => {
                // 锁（见 `建`）：交出去之后、回话之前，这一行不认任何动作。
                if (在办()) return
                if (event.key === "Escape") {
                  收起()
                  return
                }
                if (event.key !== "Enter") return
                const name = event.currentTarget.value.trim()
                if (!name) return
                void 建(类型(), name)
              }}
              onBlur={() => {
                // 同上：正在办的时候点别处不算改主意——收起就再没地方报失败了。
                if (!在办()) 收起()
              }}
            />
            {/*
              没建成的那句话。**就在输入框底下**（用户 2026-10-06 裁定），与输入框同在一个
              `<Show>` 里 ⇒ 结构上不可能出现「有文案没输入框」。

              用**危险**状态色（同 `@/auth/change-password` 那条）：这一块坐在
              `bg-v2-background-bg-layer-01`（**随方案漂**的语义面）上，所以用同样会漂的 danger；
              登录页反过来（固定深色面）别照搬那条。
              `role="alert"`：这句话是民警**必须知道**的，不该只靠眼睛扫到。
            */}
            <Show when={没建成()}>
              {(文案) => (
                <p
                  data-slot="project-panel-create-error"
                  role="alert"
                  class="px-1.5 pb-0.5 text-[11px] leading-4 text-v2-state-fg-danger"
                >
                  {文案()}
                </p>
              )}
            </Show>
          </>
        )}
      </Show>

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
