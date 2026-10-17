import { ProjectMembership } from "@opencode-ai/core/project/membership"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, createSignal, splitProps, type JSX } from "solid-js"
import { 就地改名输入 } from "@/components/inline-rename-input"
import { MEMBER_GLYPH } from "./project-anchor"
import { ProjectActionDialog, type ProjectActionKind } from "./project-action-dialog"

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
 * - 「最近」= 活跃项目，按「多久以前」分桶（今天 / 7 天内 / 30 天内 / 更早），桶内倒序
 *   ——FR-002 的排序要求落在这个 tab 上（2026-10-11 用户下达分桶，理由是「一条扁平清单
 *   一多就退化成『全部』的另一种排法」，分桶把「多久以前」变成一眼可见的东西）；
 * - 「全部」= 活跃项目，按 `type` 分「我的项目 / 共享项目」两组（设计 §3）；
 * - 「已归档」= `archived` 的项目，带「找回」入口（设计 §3 / FR-009）。
 *
 * 分组的依据是**数据字段**（`type` / `archived`），不是调用方给的顺序——那样三个 tab 才真是
 * 同一份集合的视图，而不是三份碰巧长得像的清单。
 *
 * ## 归档入口（T023 / FR-008）：只在「全部」tab，且**必须先问一句**
 *
 * 出口的落点是设计 §8.1 定的：**行内**一个「归档」，只长在「全部」tab 的行上（「最近」不画——
 * 那里是「接着干」的地方，放破坏性动作只会让人点错）。哪一行画还要过 `canArchive`（见下）。
 *
 * **二次确认不是装饰**：归档会把沙箱里的文件先备份进 MinIO、再把本地那份删掉，而 005 全仓
 * **没有删项目的入口** ⇒ 点错一下的代价是一条不可逆的路。所以点「归档」**不直接办**，先问一句
 * ——说明句写清三件民警必须知道的事：**文件会先备份进 MinIO、本地这份会删掉、之后能在「已归档」
 * 里找回**——少写一件，这一问就没起到「问」的作用。
 *
 * ## 两个动作都走弹窗（2026-10-11 用户下达，换掉了内联确认条）
 *
 * 改之前：归档在面板底下开一条内联确认条（`project-archive-confirm`），而**「找回」一句都不问**、
 * 点一下当场办。用户原话：「我希望归档按钮被点击后，其交互为弹窗式交互」，以及（对找回）
 * 「通过弹窗进行交互，让用户选择『找回』、『取消』」。
 *
 * 所以现在问法**只有一处**：`问动作(action, project)` 开一条 `ProjectActionDialog`
 * （`project-action-dialog.tsx`），归档与找回共用它、差别只在文案与危险色。理由不只是「用户要求」：
 * 内联条在真栈上是钉在**面板最底下**的（那条注释原先写的是「面板就在眼睛底下」），而列表区一滚
 * 就把它和刚点的那一行隔开——同一个症状 `file-delete-dialog.tsx` 已经量过一次（横幅与对象隔了
 * 整棵树），只是这里隔的是一个滚动区。
 *
 * ⚠️ **确认框那一段原先写着「它是面板里唯一能点『归档』的地方，滚走了就等于归档做不成」**——
 * 那句是给**滚动区之外**留位置的理由，现在确认框已经不在面板里了。
 *
 * ⚠️ 弹窗里存的是**项目对象的名字**而不是 `id`：005 全仓没有改名入口，名字打下去就是永久的，
 * 所以开弹窗那一刻取的名字不会过期（同 `dual-file-tree.tsx` 的 `待拉回` 存路径）。
 *
 * ## 「找回」的两条收口（owner 才有；2026-10-11 用户裁定「找回按 owner 收口」）
 *
 * 找回的画点有**两处**——「已归档」tab 那一行、搜索命中那一行（`归档行` 是同一个组件，所以判定
 * 也只写一份）。哪一行画过 `canRestore`（`decide` 那一份实现，见下）。
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
  /** 最近访问时间（ms）。「最近」tab 靠它分桶与桶内倒序（FR-002）。 */
  lastAccessedAt: number
  /** 已归档。「已归档」tab 靠它筛（设计 §3 / §8）；省略 = 活跃。 */
  archived?: boolean
  /**
   * **我**在这个项目里的角色（T023）。面板拿它当 `ProjectMembership.decide` 的 `actor`
   * 判「这一行画不画『归档』」——判定**只有那一份实现**，本组件零规则复述。
   *
   * **省略 = 没有成员关系**（不是「member」）：`decide({ actor: undefined })` 对归档是拒，
   * 于是那一行不长尾巴。类型**复用 core 的 `MemberRole`**、不在这里重新声明一个
   * `"owner" | "member"`（同 `member-panel.tsx` 的 `role`）。
   */
  role?: ProjectMembership.MemberRole
  /**
   * 这个项目**在我这儿**超期了（T024 · FR-008 的「3 个月无操作」）：面板据此画一条
   * 「超期未归档」的标记。**省略 = 不提醒**（不是「不超期」——面板不区分「服务端说不超期」
   * 与「服务端没这条信息」，两者都只是不画标记，见 `openhive-project.ts` 的 `readEntry`）。
   *
   * ⚠️ **判定不在这里**：算「够不够 90 天」的活是服务端的（`core/src/project/ext.ts` 的
   * `isStale`）——面板不碰时钟、不碰那个数。**只认 `true`**（`stale?: true` 而不是
   * `stale: boolean`）与 `archived` 同款：少一个状态就少一处能写错的地方。
   *
   * ⚠️ 提醒画在哪一行由 `canArchive` 定（提醒的是**能处置它的那个人**，见 `Group`）——
   * 但它**不跟归档按钮绑在同一个 tab**：每天打开的是「最近」，提醒在那儿也得看得见。
   */
  stale?: true
  /**
   * 这个项目在沙箱里的**绝对目录**（`{沙箱根}/{userId}/{projectId}`，2026-10-08）。
   *
   * 左栏「会话」tab 靠它取数：会话是**按目录**存的（内核那边 `?directory=` 就是身份的一部分），
   * 而目录此前只活在服务端的中间件里 ⇒ 前端问不出来。它与 `stale` 同**一类**——**算出来的**，
   * 由读出口一定给（见 `openhive-project.ts` 的 `readEntry` 与后端 `project.ts` 的文件头）。
   *
   * **省略 = 这一行没有可用的目录**（缺键 / 空串 / 非字符串都算）：那时左栏**不画「＋」、
   * 也不去取会话**——拿着空目录取到的不是任何一个项目，界面看着像「这个项目没有会话」。
   */
  directory?: string
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

/**
 * 项目级动作（归档 / 找回）的回调（T023）。
 *
 * 约定与 `onCreate` **逐字相同**：**回一句话 = 没办成**，那句话给民警看；`undefined` / 不回 = 收工。
 * 面板**不认识 HTTP**——把 403 / 网络错翻成一句人话是调用方的事（同本文件头「受控组件」口径）。
 */
export type ProjectActionCallback = (
  project: ProjectEntry,
) => string | undefined | Promise<string | undefined> | void

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

  /**
   * 点已归档项目的「找回」（FR-009）。省略 = 不画「找回」按钮。
   *
   * T023 起它的回话**有意义**了（`ProjectActionCallback`）——在那之前它的签名是 `(project) => void`，
   * 而「点了没反应」与「办成了」在画面上长得一样。
   */
  onRestore?: ProjectActionCallback

  /**
   * 归档一个项目（FR-008）。省略 = 整块不长「归档」。
   *
   * ⚠️ 两件事与这条 prop 有关、但**都不由它决定**：
   * ① **画在哪个 tab**：只画在「全部」tab 的行上（设计 §8.1），面板自己只把这条回调喂给那一组；
   * ② **哪一行画**：还要过 `canArchive`（`decide` 那一份实现）——同一份清单里「我建的」（owner）
   *    与「别人拉我进去的」（member / 没有成员行）长得不一样。
   */
  onArchive?: ProjectActionCallback

  /**
   * 改一个项目的名字（2026-10-16）。**交出去的是「哪一个 ＋ 新名字」**——与 `onArchive` /
   * `onRestore` 不同（那两条只交「哪一个」）：改名的动作**内容**就是那个名字。
   *
   * 约定同另两条：**回一句字符串 = 没办成**（显示在面板最底下），`undefined` / 没回 = 收工。
   */
  onRename?: (project: ProjectEntry, name: string) => string | undefined | Promise<string | undefined> | void
  /**
   * 删一个项目（2026-10-16）。**破坏性、不可恢复**——所以面板先开一条确认（spec §8）。
   * 同 `onArchive`：这里传出去的是「就这一个项目」，真正交出去发生在弹窗确认那一步。
   */
  onDelete?: ProjectActionCallback

  /**
   * 清单**取不到**（2026-10-11 用户实报）。省略 / `false` ＝ 没这回事。
   *
   * ## 「取不到」与「一个都没有」是两件事
   *
   * 同 `project-list.ts` 文件头那句「`undefined` ＝ 还没有来源，`[]` ＝ 来源说一个都没有」——
   * 这里是它的**界面形态**。少了这一条，`projects` 为空时面板一律画「还没有项目」，
   * 而**真相可能是我没问到**：民警手里有一堆项目，屏幕上却说他一个都没有。
   * （同时左栏会话 tab 会一体空白——那里的目录由清单推出来。）
   *
   * ⚠️ 失败**不抹掉已经画出来的行**：手里那份旧清单可能过时，但把民警的项目从屏幕上拿掉
   * 只会更糟（他正要点进去）。所以这一条是**加一句话**，不是**换一屏**。
   */
  loadFailed?: boolean

  /**
   * 「再来一次」（再来一次就是再拉一次清单）。省略 ＝ 那句话照说、钮是禁用态
   * ——同「未接线即禁用」那条规矩（项目行不可点、锚点行三个按钮、`onCreate` 省略时禁用）。
   *
   * 面板不认识 HTTP：它只管「有没有话要说、能不能再来一次」，把状态码翻成话与翻成动作
   * 都是调用方的事（同 `onCreate` 的回话口径）。
   */
  onRetryLoad?: () => void
}

/**
 * 「这一行画不画『归档』」——判定**只有** `ProjectMembership.decide` 那一份实现，
 * 本组件零规则复述（同 `member-panel.tsx`：它只问「能不能」，不自己答）。
 *
 * 三个输入都从行上来：`actor` = **我**在这行的角色（缺键 ⇒ `null` = 不是成员）、
 * `archived` = 这行归档没归档（缺键 = 活跃）、`target` = `null`（归档没有对象——见
 * `DecisionInput.target` 那条「刻意必填」的注释）。
 *
 * ⚠️ 已归档的行**不该**走到这里（它归「已归档」tab，由 `ArchivedGroup` 画，而那个组的行上只有
 * 「找回」）——`archived` 照实传，是为了让这条判据在**归档态确实成立**时也不放行，
 * 而不是靠「反正走不到」。
 */
const canArchive = (project: ProjectEntry) =>
  ProjectMembership.decide({
    actor: project.role ?? null,
    action: "archive",
    target: null,
    archived: project.archived === true,
  })

/**
 * 「这一行画不画『找回』」（FR-009）——判定同样**只有** `ProjectMembership.decide` 那一份
 * （同 `canArchive`），所以这个函数里同样一个角色名都不出现。
 *
 * 与归档那条的差别只在 `action` 与 `archived` 的值：归档态下 `decide` 只放行 `restore`
 * **且只放行 owner**（`membership.ts` 的 `if (input.archived)` 那一支）——这条判据就是
 * 「找回按 owner 收口」（用户 2026-10-11 裁定）。
 *
 * ⚠️ `archived` 照实传（`=== true`，缺键即 `false`）：归档态下传 `false` 会走到
 * `RULES.restore`（那条恒 `false`）⇒ **fail-closed**，不会因为「反正这一行一定是归档的」而放行。
 * 两个方向都不放行，正是我们要的：这行判据只该在「确实是归档态 + 我确实是 owner」时点亮。
 */
const canRestore = (project: ProjectEntry) =>
  ProjectMembership.decide({
    actor: project.role ?? null,
    action: "restore",
    target: null,
    archived: project.archived === true,
  })

/**
 * 能不能改这一行的名字（2026-10-16 spec §7：只有创建人）。
 *
 * ⚠️ 与 `canArchive` / `canRestore` 是**同一条**「面板不重写规则、只把事实交给 `decide`」——
 * 归档态下 `decide` 不给 rename 开口（理由见 `membership.ts`），所以已归档的行上这一项
 * **自动**不出现，本函数不需要再判一次 `archived`。
 */
const canRename = (project: ProjectEntry) =>
  ProjectMembership.decide({
    actor: project.role ?? null,
    action: "rename",
    target: null,
    archived: project.archived === true,
  })

/** 能不能删这一行（同 `canRename`）。⚠️ 归档态下**仍然可以**——spec §7：「已归档的项目也能删除」。 */
const canDelete = (project: ProjectEntry) =>
  ProjectMembership.decide({
    actor: project.role ?? null,
    action: "delete",
    target: null,
    archived: project.archived === true,
  })

/** 「最近」的桶键。**顺序即渲染顺序**（越近的越靠上）。 */
export type RecentBucketKey = "today" | "week" | "month" | "older"

/** 一个桶：键（机器读）＋ 标签（给人读）＋ 桶里的项目。 */
export interface RecentGroup {
  key: RecentBucketKey
  label: string
  items: ProjectEntry[]
}

/**
 * 桶的次序与标签——**次序即渲染顺序**，越近的越靠上（同三 tab 的「顺序即优先级」）。
 *
 * 标签写成「7 天内 / 30 天内」（带空格）：它们是**给人读的区间**，不是 CSS 类名。
 */
const 桶序: readonly { key: RecentBucketKey; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "week", label: "7 天内" },
  { key: "month", label: "30 天内" },
  { key: "older", label: "更早" },
]

/** 某个时刻所在**自然日**的零点（本地时区）。 */
const 当日零点 = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 两个时刻相差**几个自然日**（同一天 = 0）。
 *
 * `Math.round` 而不是 `floor`：在无夏令时的时区两者等价（本项目的部署地），有夏令时的那几天
 * 一天是 23 或 25 小时，`floor` 会把它们算成前一天的差——`round` 对两类日子都给出日历上的日数。
 */
const 日差 = (t: number, now: number) => Math.round((当日零点(now) - 当日零点(t)) / 86400000)

/**
 * 一个时刻落在哪个桶。
 *
 * ⚠️ **`差 <= 0` 那一支不是多余**：服务端的 `last_accessed_at` 与本机的钟不必完全一致，
 * 差一点点就会是「未来」。不兜的话它掉进 `older`——一个刚刚访问过的项目被排到「更早」，
 * 而这是**最不像它**的桶。归到今天才是它的位置。
 */
const 落桶 = (t: number, now: number): RecentBucketKey => {
  const 差 = 日差(t, now)
  if (差 <= 0) return "today"
  if (差 <= 7) return "week"
  if (差 <= 30) return "month"
  return "older"
}

/**
 * 把一组项目按「多久以前」分桶（FR-002 的排序要求在分桶之后仍成立：**桶内倒序**）。
 *
 * **纯函数、`now` 从参数进**：于是跨日 / 跨周 / 跨月的边界在单测里钉得死（文件头那条）。
 * 它不认识 `archived`——喂什么分什么，筛活跃是调用方的事（同 `Group` 的口径）。
 */
export function 近况分组(entries: readonly ProjectEntry[], now: number): RecentGroup[] {
  const 收 = new Map<RecentBucketKey, ProjectEntry[]>()
  for (const p of entries) {
    const key = 落桶(p.lastAccessedAt, now)
    const 已有 = 收.get(key)
    if (已有) 已有.push(p)
    else 收.set(key, [p])
  }
  return 桶序
    .map(({ key, label }) => ({
      key,
      label,
      // 桶内按最近访问倒序（FR-002）：分桶只回答「多久以前」，不回答「谁更近」。
      items: (收.get(key) ?? []).sort((a, b) => b.lastAccessedAt - a.lastAccessedAt),
    }))
    // 空桶不画——一个没有项目的组标题只是噪音（同 `Group` 的 `Show`）。
    .filter((g) => g.items.length > 0)
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
 * 搜索**没命中**的文案——与上面两句**都不是**同一件事：不是「你没有项目」，也不是
 * 「你没有归档的」，是「你要找的那个不在这儿」。糊成一句就会让民警以为项目没了。
 */
const EMPTY_MATCH = "没有匹配的项目"

/**
 * 「已归档」一次最多画多少条（**2026-10-11 用户下达**）。
 *
 * 「已归档」是三个 tab 里**唯一只涨不落**的一个（归档只进不出）⇒ 它终将变成最大的一堆，
 * 而找它的方式又是**点名找**（「上次那个结了的案子」）而不是翻——点名的找法该交给**搜索**，
 * 列表只负责最近归档的那几条。上限定在**画**这一侧（不改后端取数，见 state 的挂账）。
 */
const 已归档上限 = 50

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
  "text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover",
  "disabled:cursor-default disabled:text-v2-text-text-faint disabled:hover:bg-transparent",
].join(" ")

/** 三 tab 的页签。选中态走类名切换（`classList`），不用 `aria-*` 变体——少一层 Tailwind 语义。 */
const TAB_BUTTON = [
  "flex-1 cursor-pointer rounded-[4px] px-1.5 py-1 text-[12px] transition-colors",
  "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover",
].join(" ")

/**
 * tab 栏上那颗放大镜。
 *
 * ⚠️ 它与三个页签**不在同一个 `role="tablist"` 里**（`tablist` 的直接子是页签，塞个按钮进去
 * 是 a11y 上的错），所以它和 tablist 一起被外层那行 flex 管着——这也是它没有 `flex-1` 的原因：
 * 三个页签等分，它自己是个固定宽的图标钮。
 */
const SEARCH_TOGGLE = [
  "flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] px-1.5 py-1 transition-colors",
  "hover:bg-v2-overlay-simple-overlay-hover",
].join(" ")

/**
 * 一行的外壳（T023 起是 `div`，不再是 `button`）。
 *
 * 换掉 `button` 是因为有些行里现在有**第二个**按钮（「归档」），而按钮不能嵌按钮
 * ——同 `ArchivedGroup` 那条注释。名字那一块**仍是** `button`（`ITEM_NAME_BUTTON`），
 * 「点一下直达」不丢：改的只是「谁是可点的」，不是「还能不能点」。
 *
 * ⚠️ 三个 tab 的行**共用这一套外壳**（连没有尾巴的行也套着），不按 tab 分两种结构：
 * 两种结构意味着「同一个行样子」有两份写法，将来再往行上加一个动作时只会改到其中一份。
 */
const ITEM_ROW = "flex h-7 min-w-0 w-full shrink-0 items-center gap-1"

/**
 * 行里的名字按钮。与原来的整行按钮只差两处，都是被上面那层 flex 逼的：
 * `w-full` → `flex-1`（外壳里还要站一个「归档」），`h-7` 移到外壳上（外壳定高、按钮填满它）。
 */
const ITEM_NAME_BUTTON = [
  "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-left",
  "text-v2-text-text-muted transition-colors",
  // hover 底走全 app 的 house 标准（`overlay-hover`）。原先跟的是上游 home
  // `HomeProjectNavButton` 的 `hover:bg-v2-background-bg-layer-01`，但那面镜子**已经不成立**了：
  // 本行的选中态按 X5-1 改成了品牌浅金（见 `classList` 那处），两半不再逐字对应——
  // 留着「我在镜像 home」的说法比不镜像更坏（`#003-05`）。何况 `layer-01` 就是最浅那档中性底
  // （`grey-100`），与面板底色几乎同色 ⇒ 划过去的反馈几乎看不见（005 第二轮审查 **R2-04**）。
  "hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base",
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

/**
 * 一行**活跃**项目：名字可点（直达），尾巴上可以挂超期提醒与「归档」。
 *
 * 抽出来是因为它有了**第三个**消费者（2026-10-11 加搜索：结果里活跃与已归档混在一张单子上）。
 * 按本文件那句「同一个行样子不该有两份写法」——两份已经勉强，三份必然散。
 */
function 活跃行(props: {
  project: ProjectEntry
  current: boolean
  onOpen?: (project: ProjectEntry) => void
  /**
   * 点了这一行的「归档」。**不是执行归档**：面板要先弹一条确认（破坏性操作），
   * 所以这里传出去的是「把这个项目记下来」，真正交出去发生在确认那一步。
   */
  onAskArchive?: (project: ProjectEntry) => void
  /** 这一行的「改名」被点了之后进来（`新名` 已 trim、且与原样不同——判据在 `就地改名输入` 里）。 */
  onRename?: (project: ProjectEntry, 新名: string) => void
  /** 这一行的「删除」被点了之后、**确认之前**（真正的执行在弹窗那一层）。 */
  onAskDelete?: (project: ProjectEntry) => void
}) {
  /**
   * 这一行**正在就地改名**——**行级**信号而不是面板级。
   *
   * 做成面板级（`createSignal<string | undefined>` 存「哪个 id 在改」）要多传一层 prop、
   * 还要在清单重拉时对账「那个 id 还在不在」；而编辑态是**一次编辑的事**，它天然属于这一行。
   */
  const [在改名, set在改名] = createSignal(false)
  return (
    <div data-slot="project-row" class={`${ITEM_ROW} group/row`}>
      <Show
        when={在改名()}
        fallback={
          <button
            type="button"
            data-slot="project-item"
            data-current={props.current ? "true" : undefined}
            class={ITEM_NAME_BUTTON}
            classList={{
              "bg-[var(--v2-background-bg-accent-soft)] text-v2-text-text-base": props.current,
            }}
            disabled={props.onOpen === undefined}
            onClick={() => props.onOpen?.(props.project)}
          >
            <ItemBody project={props.project} current={props.current} />
          </button>
        }
      >
        {/*
          就地改名（spec §8）：**整颗名字按钮被换掉**，不是把输入框塞进按钮里
          ——`<button>` 里放 `<input>` 是非法嵌套。
          复用 `就地改名输入`（**一个字不改**）：它带着「一次编辑只结一次账」那条真栈实测出来的守卫。
        */}
        <就地改名输入
          槽位="project-rename-input"
          可访问名称="项目名称"
          原名={props.project.name}
          on提交={(新名) => {
            set在改名(false)
            props.onRename?.(props.project, 新名)
          }}
          on取消={() => {
            set在改名(false)
          }}
        />
      </Show>
      {/* 超期提醒（T024）——**不是按钮**，只是把事实摆出来。判定分两层：
          ① 服务端说他超期了（`stale`，缺键 = 不提醒）；
          ② 提醒的是**能处置它的那个人**（`canArchive`，与「归档」按钮同一份 `decide`）。
          第二层的理由：member 看得见项目，但归档不是他能做的——一条他动不了的提醒只是噪音。
          ⚠️ 刻意**不**加 `props.onAskArchive !== undefined`：那样提醒就只剩「全部」tab 有，
          而每天打开的是「最近」（见 `ProjectEntry.stale` 那条注释）。 */}
      <Show when={props.project.stale === true && canArchive(props.project)}>
        <span
          data-slot="project-stale"
          aria-label={`${props.project.name} 超过 3 个月未访问`}
          class="shrink-0 rounded-[4px] bg-v2-background-bg-layer-03 px-1 text-[11px] text-v2-text-text-muted"
        >
          超期未归档
        </span>
      </Show>
      {/* 不给回调 ⇒ 不画（「未接线即禁用」的另一种形态：归档是破坏性动作，
          画一个 disabled 的「归档」只是噪音）；给了回调也还要过 `decide`。 */}
      <Show when={props.onAskArchive !== undefined && canArchive(props.project)}>
        <button
          type="button"
          data-slot="project-archive"
          aria-label={`归档 ${props.project.name}`}
          class={CREATE_BUTTON}
          onClick={() => props.onAskArchive?.(props.project)}
        >
          归档
        </button>
      </Show>
      <行菜单
        project={props.project}
        onRename={
          props.onRename === undefined
            ? undefined
            : () => {
                set在改名(true)
              }
        }
        onAskDelete={props.onAskDelete}
      />
    </div>
  )
}

/**
 * 一行**已归档**项目：整行**不可点**（归档态下服务端 `frozen` 拒绝一切写入，点开也干不了活），
 * 尾巴上只有「找回」。
 *
 * 外壳是 `div` 不是 `button`——它里面有「找回」按钮，按钮不能嵌按钮。
 */
function 归档行(props: {
  project: ProjectEntry
  current: boolean
  /**
   * 点了这一行的「找回」。**不是执行找回**：面板要先弹一条确认（同归档那条），
   * 所以这里传出去的是「就这一个项目」，真正交出去发生在弹窗确认那一步。
   */
  onRestore?: (project: ProjectEntry) => void
  /** 已归档的行**也能删除**（spec §7）——它比找回更彻底，藏进 ⋯。 */
  onAskDelete?: (project: ProjectEntry) => void
  /**
   * 画不画「已归档」标记。**默认不画**——「已归档」tab 里每一行都是归档的，标记是纯噪音。
   * 只有**搜索结果**那种活跃与归档混在一张单子上的场合才要它：那里「为什么这一行点不开」
   * 必须看得出来。
   */
  带归档标记?: boolean
}) {
  return (
    // 与 `活跃行` 同一层壳（`data-slot="project-row"`）：⋯ 要挂在**行**上，而 `行菜单钮` 的
    // 辅助按这个壳找行——没有它，已归档的行上那颗 ⋯ 就找不到了。
    <div data-slot="project-row" class={`${ITEM_ROW} group/row`}>
      <div
        data-slot="project-item"
        data-current={props.current ? "true" : undefined}
        class={ITEM_STATIC}
      >
        <ItemBody project={props.project} current={props.current} />
        <Show when={props.带归档标记}>
          <span
            data-slot="project-item-archived"
            class="shrink-0 rounded-[4px] bg-v2-background-bg-layer-03 px-1 text-[11px] text-v2-text-text-muted"
          >
            已归档
          </span>
        </Show>
        {/* 不给回调 ⇒ 不画（「未接线即禁用」）；给了回调也还要过 `decide`——归档态下只有 owner
            能找回（用户 2026-10-11 裁定「找回按 owner 收口」，判定见 `canRestore`）。 */}
        <Show when={props.onRestore !== undefined && canRestore(props.project)}>
          <button
            type="button"
            data-slot="project-restore"
            aria-label={`找回 ${props.project.name}`}
            class={CREATE_BUTTON}
            onClick={() => props.onRestore?.(props.project)}
          >
            找回
          </button>
        </Show>
        {/* ⚠️ 归档行**不传 `onRename`**：归档态下 `decide` 不给 rename 开口（`canRename` 恒 false）
            ⇒ 传了也不会画。不传是**刻意的**：多传一个恒被过滤掉的回调，只会在读代码时误导人
            以为「归档行也能改名」。 */}
        <行菜单 project={props.project} onAskDelete={props.onAskDelete} />
      </div>
    </div>
  )
}

/**
 * 「⋯」那一颗的宿主。
 *
 * ⚠️ 形状照 `file-tree.tsx` 的 `工具钮`（它是 `DropdownMenu.Trigger` 的宿主，见那个文件
 * `:1236-1243` 的注释）：`DropdownMenuTrigger` 会给宿主加自己的 `data-*`，所以本组件
 * **不设 `data-slot`**——只有 `data-project-action` 是我们自己的名字（见 `行菜单` 的注释）。
 */
function 菜单钮(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["class", "children"])
  return (
    <button
      type="button"
      class={`hover-reveal flex shrink-0 cursor-pointer items-center rounded-[4px] px-1 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover group-hover/row:opacity-100 focus-within:opacity-100 ${local.class ?? ""}`}
      {...rest}
    >
      ⋯
    </button>
  )
}

/**
 * 一行尾巴上那颗「⋯」——**改名字与不可恢复的删除**的入口（2026-10-16 spec §3/§8）。
 *
 * ## 为什么是菜单而不是两颗常显钮
 *
 * spec §3 的原则一：**不可恢复的动作必须跟可恢复的动作长得不一样**——归档在行上是一颗常显钮
 * （今天就这样），删除藏进 ⋯。形态不同是**刻意**的，不是布局巧合。
 *
 * ## 未接线 / 无权 ⇒ 整个菜单不画
 *
 * 与「归档 / 找回」同一条约定（`问归档` 那段注释）：不给回调 ⇒ 不画；给了回调也还要过 `decide`。
 * 两样都不成立时**连 ⋯ 都不出现**——画一颗点开来空空的菜单是纯噪音。
 *
 * ## 槽位名为什么是 `data-project-action` 而不是 `data-slot`
 *
 * `DropdownMenuItem` 把 `data-slot` 写在 `{...rest}` **之后**（`LEARNINGS #005-22`）⇒
 * 调用方传的 `data-slot` 会被静默覆盖、**那个名字在 DOM 里从来不存在**，而用例会一直绿着空转。
 * 换一个宿主不占的名字（`data-project-action`），先例见 `file-tree.tsx` 的 `data-create-kind`。
 *
 * ## 视觉：悬停出现、**键盘聚焦也出现**（spec §8）
 *
 * `hover-reveal` 是全 app 的既有 utility（默认 `opacity-0`，`@media (hover:none)` 恒可见
 * ⇒ 触屏也够得着）；配 `group-hover/row:opacity-100` ＋ `focus-within:opacity-100`
 * ——后者是 spec §8「不做成鼠标专属」那半句的**唯一实现**（先例
 * `pages/home/home-projects-view.tsx:474-495` 的 `group/project`）。
 *
 * ⚠️ **组件层量不出它可见不可见**（happy-dom 没有 CSS 引擎，`LEARNINGS #005-07`）——
 * 本层的判据只能断「元素在不在」，**真的悬停会不会出现**归真栈（Task 9）。
 */
function 行菜单(props: {
  project: ProjectEntry
  /**
   * 「改名」被点了。⚠️ **不带新名字**——菜单这一下只是**把这一行切成编辑态**，
   * 名字还没被输入（真正带名字的那一层是 `活跃行` 的 `onRename`）。
   * 同一个文件里有两个同名但不同形的 `onRename`，**刻意的**：`行菜单` 是「谁来接这个动作」，
   * `活跃行` 是「新名字是多少」——把两件事合成一个签名，就会逼菜单项编一个假名字出来。
   */
  onRename?: () => void
  onAskDelete?: (project: ProjectEntry) => void
}) {
  const 改名 = () => props.onRename !== undefined && canRename(props.project)
  const 删除 = () => props.onAskDelete !== undefined && canDelete(props.project)
  return (
    <Show when={改名() || 删除()}>
      {/* ⚠️ `modal={false}` **不是可选项**：默认 `modal: true` 让 Kobalte 的 `createFocusScope`
          在菜单开着时**锁焦点**（`trapFocus`）——实测（focus 探针，2026-10-17）点「改名」后
          `就地改名输入` 的 rAF 焦点刚落下（+121ms）就被焦点陷阱**当场**抢回菜单内容
          （`project-row-menu`）⇒ 输入条 blur ⇒ 「提交」时草稿没变（同值）⇒ 自己收掉。
          同 `file-tree.tsx` 右键菜单那段（`#005-28` 同族：下游不是同一个东西时理由要重验，不搬结论）。
          ⚠️ 但「改名」这条链**另有**一处竞态在测试侧：菜单**开**那一刻的延迟自动聚焦
          （`tryAutoFocus`，`setTimeout 0`）也抢焦点——那一处 `modal={false}` 管不着，靠用例
          在点菜单项前先冲刷一拍（见 `project-panel.test.tsx` 的 `冲刷`）。 */}
      <DropdownMenu gutter={4} placement="bottom-end" modal={false}>
        <DropdownMenu.Trigger as={菜单钮} data-project-action="menu" aria-label={`${props.project.name} 的更多操作`} />
        <DropdownMenu.Portal>
          <DropdownMenu.Content data-slot="project-row-menu">
            <Show when={改名()}>
              <DropdownMenu.Item data-project-action="rename" onSelect={() => props.onRename?.()}>
                <DropdownMenu.ItemLabel>改名</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </Show>
            <Show when={删除()}>
              <DropdownMenu.Item data-project-action="delete" onSelect={() => props.onAskDelete?.(props.project)}>
                <DropdownMenu.ItemLabel>删除</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}

/** 一组项目：组标题 + 若干行。**空组不画**（画一个空标题只是噪音）。 */
function Group(props: {
  group: string
  label: string
  items: readonly ProjectEntry[]
  currentId?: string
  onOpen?: (project: ProjectEntry) => void
  onAskArchive?: (project: ProjectEntry) => void
  onRename?: (project: ProjectEntry, 新名: string) => void
  onAskDelete?: (project: ProjectEntry) => void
}) {
  return (
    <Show when={props.items.length > 0}>
      <div data-slot="project-group" data-group={props.group} class="flex min-w-0 flex-col">
        <div data-slot="project-group-label" class="px-1.5 py-1 text-[11px] text-v2-text-text-faint">
          {props.label}
        </div>
        <For each={props.items}>
          {(project) => (
            <活跃行
              project={project}
              current={project.id === props.currentId}
              onOpen={props.onOpen}
              onAskArchive={props.onAskArchive}
              onRename={props.onRename}
              onAskDelete={props.onAskDelete}
            />
          )}
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
  onAskDelete?: (project: ProjectEntry) => void
}) {
  return (
    <Show when={props.items.length > 0}>
      <div data-slot="project-group" data-group="archived" class="flex min-w-0 flex-col">
        <div data-slot="project-group-label" class="px-1.5 py-1 text-[11px] text-v2-text-text-faint">
          已归档项目
        </div>
        <For each={props.items}>
          {(project) => (
            <归档行
              project={project}
              current={project.id === props.currentId}
              onRestore={props.onRestore}
              onAskDelete={props.onAskDelete}
            />
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
  /**
   * 弹窗这一层的入口（归档 / 找回共用）。**没有待确认状态可言**——待确认的是弹窗自己那一份
   * 状态，面板不再存「是哪一个项目」：存了就会有一格状态只能靠「弹窗关了没有」来清
   * （原先那条内联确认条正是这么写的 `待归档`，现在整格删掉了）。
   *
   * ⚠️ `useDialog()` 在没有 `DialogProvider` 时**抛错**（`context/dialog.tsx`：刻意的，不是
   * 静默 `undefined`）——所以本组件从 2026-10-11 起有一条**挂载前提**：外面得套那层 Provider。
   * app 里它在 `app.tsx`；组件测试在 `project-panel.test.tsx` 顶部补（`LEARNINGS #005-27`）。
   */
  const dialog = useDialog()
  /**
   * 上一个动作没办成的那句话（归档 / 找回共用一格）。
   *
   * 与 `onCreate` 的回话同一条约定：**字符串 = 没办成**。归位放在面板最底下、`role="alert"`
   * ——民警点了「归档」却什么都没发生是最坏的一种静默（`LEARNINGS #004-08`：副作用类判据
   * 必须先有一条对照证明机制是活的，这里反过来：机制没活也得说出来）。
   */
  const [没办成, set没办成] = createSignal<string | undefined>()
  /**
   * 搜索框的状态——**开关与词合成一格**：`undefined` = 没开（输入框不画），`""` = 开了但还没
   * 打字（输入框画着、列表照旧），非空 = 在搜（列表换成结果）。同 `起名` 的口径：一格状态、
   * 一处改它，就不可能出现「框没了词还在」。
   */
  const [搜, set搜] = createSignal<string | undefined>()

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

  /**
   * 交出去办一个**项目级动作**（归档 / 找回），等回话。
   *
   * 与 `建` 同一条约定：**回一句字符串 = 没办成**（显示在面板最底下），`undefined` / 没回 = 收工。
   * 两个动作共用这一处——它们的「怎么收场」是同一件事，分成两份只会在改一处时漏掉另一处
   * （`LEARNINGS #002-06`）。
   */
  const 办 = async (project: ProjectEntry, 动作: ProjectActionCallback | undefined) => {
    set没办成(undefined)
    const 回话 = await 动作?.(project)
    if (typeof 回话 === "string") set没办成(回话)
  }

  /**
   * 把新名字交出去，等回话。与 `办` 同一条约定（字符串 = 没办成）。
   *
   * 与 `办` 分成两条而不是合成一条：`办` 交的是「一个动作」，这条交的是「一个动作 ＋ 一个值」
   * ——合并要给它加一个可选的第二参，而那会让 `onArchive` / `onRestore` 的调用点也跟着长出一个
   * 恒不传的位置（`LEARNINGS #002-06` 的取向：别为省一行把两件事塞进一个判定）。
   */
  const 办改名 = async (project: ProjectEntry, name: string) => {
    set没办成(undefined)
    const 回话 = await props.onRename?.(project, name)
    if (typeof 回话 === "string") set没办成(回话)
  }

  /**
   * 问一句再办（归档 / 找回 / 删除共用）。
   *
   * ⚠️ 三个动作的接收方**在 `onConfirm` 里现读**（不是开弹窗时捕获一份）：弹窗可能开着的时候
   * 调用方重新接了线，那时该走的是新的那一份。表写成 `Record<ProjectActionKind, …>` ⇒
   * **将来加第四个动作时不补这一行是编译错误**（同 `RULES` 表那条理由）。
   */
  const 问动作 = (action: ProjectActionKind, project: ProjectEntry) => {
    void dialog.show(() => (
      <ProjectActionDialog
        action={action}
        projectName={project.name}
        onConfirm={() => {
          const 接: Record<ProjectActionKind, ProjectActionCallback | undefined> = {
            archive: props.onArchive,
            restore: props.onRestore,
            delete: props.onDelete,
          }
          void 办(project, 接[action])
        }}
      />
    ))
  }

  /**
   * 记下「要归档的是哪一个」，等确认。它**只在真的有人接得住的时候**才递下去
   * （下面两个 `Group` 里写的就是这条三元）——`Group` 那侧「不给回调即不画」的约定
   * 靠的是**调用方不递**，不是靠它自己去猜面板有没有接收方（一个没有接收方的「归档」按钮
   * 点下去什么都不会发生，那是对用户的谎）。2026-10-07 由「没接线 ⇒ 谁都不画」那条用例抓出来的。
   */
  const 问归档 = (project: ProjectEntry) => 问动作("archive", project)

  /**
   * 找回（FR-009）。**上面那条规矩的第二个出口，同款三元**——`ArchivedGroup` 那侧也写着
   * 「不给回调即不画」（`<Show when={props.onRestore !== undefined && canRestore(…)}>`），
   * 所以这里同样**只在不为空时递下去**。
   *
   * ⚠️ 别写成 `onRestore={(p) => void 办(p, props.onRestore)}`：那是个**恒真的函数**，会把
   * `归档行` 里那条 `Show` 永远点亮——未接线的面板上就多出一个**点了没反应**的「找回」
   * （2026-10-07 席 B 审查抓出；`LEARNINGS #003-02`：修完一处要 grep 谁在按同一个前提做同一件事，
   * `问归档` 那条三元就是同一个前提）。
   *
   * ⚠️ 2026-10-11 起它**不直接办**了：改成开弹窗（用户下达：找回也要「找回 / 取消」二选一）。
   * 「谁画这一行」的判定没变，仍在 `归档行` 的 `canRestore` 上。
   */
  const 找回 = (project: ProjectEntry) => 问动作("restore", project)

  /**
   * 删除的入口（2026-10-16）。**上面那条规矩的第三个出口，同款三元**——`活跃行` / `归档行`
   * 那侧写着「不给回调即不画」，所以这里同样**只在不为空时递下去**。
   */
  const 问删除 = (project: ProjectEntry) => 问动作("delete", project)

  /**
   * 搜索词（首尾空格不算数——民警手滑打出来的空格不该让结果空掉）。
   * 判「在不在搜」与「拿它去比」都读这一处，两处各写一遍就会出现「看着在搜、其实没筛」。
   */
  const 搜词 = () => (搜() ?? "").trim()
  /** 在不在搜：**有词才算**（开了框没打字 = 没搜，列表照旧）。 */
  const 在搜 = () => 搜词().length > 0
  /**
   * 命中的项目。
   *
   * ⚠️ 走**全量**（`全部()`）而不是 `已归档()`——已归档那 50 条截断是**列表**的收敛办法，
   * 不是搜索的。搜索要是也只看那 50 条，被截掉的那些就**永远找不回来**了，
   * 而那行提示正写着「请用搜索查找」。
   *
   * 匹配是**包含**、不分大小写（民警记不住全名，也不一定记得住大小写）；
   * 结果按最近访问倒序，与 `projects` 的传入顺序无关（那个顺序谁都不该依赖）。
   */
  const 命中 = () =>
    [...全部()]
      .filter((p) => p.name.toLowerCase().includes(搜词().toLowerCase()))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)

  /**
   * 开 / 关搜索框。关的时候**把词一起清掉**（`undefined` 而不是 `""`）——留一个空词的话，
   * 下次点开框还在、词却没了；留个非空词更糟：框是关着的，列表却被一个看不见的词筛着。
   */
  const 切搜索 = () => set搜(搜() === undefined ? "" : undefined)

  const 全部 = () => props.projects ?? []
  const 活跃 = () => 全部().filter((p) => p.archived !== true)
  /**
   * 已归档的**全量**，按最近访问倒序。
   *
   * 倒序是**截断的前提**，不只是好看：不排序就 `slice`，砍掉的是「`projects` 里排在后面的」，
   * 而那与「多久以前」无关（传进来的顺序是服务端两条链并出来的，谁都不该依赖）。
   */
  const 已归档全 = () =>
    全部()
      .filter((p) => p.archived === true)
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
  const 已归档 = () => 已归档全().slice(0, 已归档上限)
  /** 被截掉多少个（0 = 一条没截，那时提示行不画）。 */
  const 已归档还有 = () => 已归档全().length - 已归档().length
  /** 「最近」= 活跃项目按「多久以前」分桶，桶内仍按最近访问倒序（FR-002）。 */
  const 最近 = () => 近况分组(活跃(), Date.now())

  const 空态 = (文案: string) => (
    /**
     * ⚠️ 清单**取不到**时一律不画（2026-10-11）：那一刻「还没有项目 / 没有匹配的项目 /
     * 没有已归档的项目」三句**全是假话**——民警手里可能有一堆项目，只是这一次没问到。
     * 画在哪一句上都一样，所以闸设在**这里一处**，不设在四个 `fallback` 上
     * （`LEARNINGS #004-01`：一个判定要落在所有出口都过的那一层）。
     */
    <Show when={!props.loadFailed}>
      <div data-slot="project-panel-empty" class="px-2 py-3 text-[12px] text-v2-text-text-faint">
        {文案}
      </div>
    </Show>
  )

  return (
    <div
      data-component="project-panel"
      // ⚠️ `min-h-0` 不是装饰（2026-10-11 用户实报「三个 tab 没有滚动条」）：
      // 本元素是挂载槽（`project-panel-slot`）的 **flex 子项**，而 flex 子项的自动最小高＝**内容高**
      // ⇒ 不给它这一条，槽再怎么限高它也**压不下去**，列表照样把面板撑破、超出部分被祖先
      // `three-pane-left-card{overflow-y:hidden}` 裁掉且滚不动（真栈实测 `wheel` 前后 `scrollTop` 恒 0）。
      class="flex min-h-0 w-full min-w-0 flex-col gap-1 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1 shadow-lg"
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

      {/* tab 栏那一行：三个页签（`role="tablist"` 里只放页签）＋ 右侧一颗放大镜。 */}
      <div class="flex items-center gap-0.5 px-0.5">
        <div data-slot="project-panel-tabs" role="tablist" class="flex min-w-0 flex-1 items-center gap-0.5">
          <For each={TABS}>
            {(t) => (
              <button
                type="button"
                role="tab"
                data-slot="project-panel-tab"
                data-tab={t.id}
                aria-selected={tab() === t.id ? "true" : "false"}
                class={TAB_BUTTON}
                classList={{
                  // 选中页签＝品牌浅金（同 `sidebar-tabs.tsx` 的 `TAB_ACTIVE`，X5-1）。
                  "bg-[var(--v2-background-bg-accent-soft)] text-v2-text-text-base": tab() === t.id,
                }}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>
        {/*
          搜索的入口（2026-10-11 用户下达）。放在 tab 栏而不是做第四个 tab：搜索**不属于任何一个
          tab**（三个 tab 是同一份集合的三个视图，搜索是另一个问题——「我记得有那么个案子」），
          做成 tab 就得和它们抢位置，切走还会丢词。
        */}
        <button
          type="button"
          data-slot="project-search-toggle"
          aria-label="搜索项目"
          aria-expanded={搜() === undefined ? "false" : "true"}
          class={SEARCH_TOGGLE}
          onClick={切搜索}
        >
          <span class={ICON_WRAP}>
            <Icon name="magnifying-glass" size="small" />
          </span>
        </button>
      </div>

      {/*
        搜索框：点放大镜才在（同「起名字那一行」的口径——条件行、出现即拿焦点、`Esc` 收起）。
        **不绑 `value`**：它是这一格状态唯一的写入方，而开关本身会重建这一行，不需要单向回灌。
      */}
      <Show when={搜() !== undefined}>
        <div class="px-0.5">
          <input
            data-slot="project-search"
            ref={(el) => queueMicrotask(() => el.focus())}
            type="text"
            aria-label="搜索项目"
            placeholder="搜索项目"
            class={NAME_INPUT}
            onInput={(event) => set搜(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") 切搜索()
            }}
          />
        </div>
      </Show>

      {/*
        ⚠️ **列表区就是滚动容器**（2026-10-11 用户实报）：`overflow-y-auto` 让超出部分滚起来，
        `min-h-0` 是它的前提——flex 子项的自动最小高＝内容高，少了它这一条 `overflow` 形同虚设
        （盒子根本不会被压到内容高以下，于是永远不触发滚动）。

        钉它的是 `project-panel.test.tsx` 的「列表区是滚动容器」那条；**真的滚得动**与
        「面板底边落回容器内」由真栈量几何（本层 happy-dom 没有 CSS 引擎，`LEARNINGS #005-07`）。

        为什么滚的是**这一层**而不是整块面板：它上面的「＋新建项目」行与 tab 栏是工具栏
        （同 `session-list.tsx:244` 那条「标题行常驻」），下面的错误行是「刚点过的那个动作」
        的回执——两者都不该被列表滚走。
        （归档 / 找回的确认框一度也在这里，2026-10-11 改成弹窗后就不归这条管了。）
      */}
      <div data-slot="project-panel-body" role="tabpanel" class="flex min-h-0 min-w-0 flex-col overflow-y-auto">
        {/*
          清单取不到 ⇒ 一句话 ＋ 一颗「重试」（2026-10-11 用户实报）。

          放在**列表区里面最上面**，不是当成整屏错误页：失败不抹掉已经画出来的行（见 `loadFailed`
          的注释），所以它与列表**同屏**——上一条说「这次没问到」，下面是他手里那份旧清单。

          为什么必须有这一行：`拉清单` 失败时既不写缝、也不报错、也不重试，`projectList()` 就永久
          停在 `undefined`。那之后左栏会话 tab 一体空白（目录由清单推出来），而面板说「还没有项目」
          ——用户唯一能拿到的读数就是这两句**都不会动**的假话，没有出口、也没有第二次机会。
        */}
        <Show when={props.loadFailed}>
          <div
            data-slot="project-panel-load-failed-row"
            class="flex min-w-0 shrink-0 items-center gap-1 px-1.5 py-1 text-[12px] text-v2-text-text-muted"
          >
            {/* 那句话自己带一个槽位（不借用整行的）：整行的文本里还挂着「重试」两个字，
                判据读整行就变成了「句子里夹着钮的标签」——那种断言得靠 `toContain` 才对得上，
                而子串匹配正是 `LEARNINGS #006-22` 记下的那种「读起来像钉住了、其实没有」。 */}
            <span data-slot="project-panel-load-failed" class="min-w-0 flex-1 truncate">
              项目清单没取到
            </span>
            <button
              type="button"
              data-slot="project-panel-retry"
              class={CREATE_BUTTON}
              disabled={props.onRetryLoad === undefined}
              onClick={() => props.onRetryLoad?.()}
            >
              重试
            </button>
          </div>
        </Show>

        {/*
          搜索**盖住整个列表区**（三个 tab 的内容一条都不画）——搜索不是「第四个视图」，
          它是「换一个问题问同一份集合」。至于搜索框自己，仍旧在 tab 栏底下待着（它在列表区之外），
          所以搜完不必重新点开。
        */}
        <Show when={在搜()}>
          <Show when={命中().length > 0} fallback={空态(EMPTY_MATCH)}>
            <div data-slot="project-search-results" class="flex min-w-0 flex-col">
              {/* 活跃与已归档**混在一张单子上**，所以按行分流：活跃的可点（找到就走），
                  归档的整行不可点 + 带「已归档」标记 + 尾巴上「找回」（就地救回来）。 */}
              <For each={命中()}>
                {(project) =>
                  project.archived === true ? (
                    <归档行
                      project={project}
                      current={project.id === props.currentId}
                      onRestore={props.onRestore === undefined ? undefined : 找回}
                      onAskDelete={props.onDelete === undefined ? undefined : 问删除}
                      带归档标记
                    />
                  ) : (
                    <活跃行
                      project={project}
                      current={project.id === props.currentId}
                      onOpen={props.onOpen}
                      onRename={props.onRename === undefined ? undefined : 办改名}
                      onAskDelete={props.onDelete === undefined ? undefined : 问删除}
                    />
                  )
                }
              </For>
            </div>
          </Show>
        </Show>

        {/* 不在搜 ⇒ 三个 tab 照旧（它们是同一份集合的三个视图）。 */}
        <Show when={!在搜()}>
          <Show when={tab() === "recent"}>
            <Show when={最近().length > 0} fallback={空态(EMPTY_ACTIVE)}>
              {/* 一个桶一组（今天 / 7 天内 / 30 天内 / 更早）——空桶已经在 `近况分组` 里滤掉。 */}
              <For each={最近()}>
                {(g) => (
                  <Group
                    group={g.key}
                    label={g.label}
                    items={g.items}
                    currentId={props.currentId}
                    onOpen={props.onOpen}
                    onRename={props.onRename === undefined ? undefined : 办改名}
                    onAskDelete={props.onDelete === undefined ? undefined : 问删除}
                  />
                )}
              </For>
            </Show>
          </Show>

          {/* 「归档」只画在**这一个** tab 的行上（设计 §8.1：「项目列表『全部』tab 内，或项目名右键」；
              右键那一半本仓没有先例，故不做）。「最近 / 已归档」两组不传 `onAskArchive` ⇒ 不长尾巴。 */}
          <Show when={tab() === "all"}>
            <Show when={活跃().length > 0} fallback={空态(EMPTY_ACTIVE)}>
              <Group
                group="mine"
                label="我的项目"
                items={活跃().filter((p) => p.type === "private")}
                currentId={props.currentId}
                onOpen={props.onOpen}
                onAskArchive={props.onArchive === undefined ? undefined : 问归档}
                onRename={props.onRename === undefined ? undefined : 办改名}
                onAskDelete={props.onDelete === undefined ? undefined : 问删除}
              />
              <Group
                group="shared"
                label="共享项目"
                items={活跃().filter((p) => p.type === "shared")}
                currentId={props.currentId}
                onOpen={props.onOpen}
                onAskArchive={props.onArchive === undefined ? undefined : 问归档}
                onRename={props.onRename === undefined ? undefined : 办改名}
                onAskDelete={props.onDelete === undefined ? undefined : 问删除}
              />
            </Show>
          </Show>

          <Show when={tab() === "archived"}>
            <Show when={已归档().length > 0} fallback={空态(EMPTY_ARCHIVED)}>
              <ArchivedGroup
                items={已归档()}
                currentId={props.currentId}
                onRestore={props.onRestore === undefined ? undefined : 找回}
                onAskDelete={props.onDelete === undefined ? undefined : 问删除}
              />
              {/* 被截掉的那些**不是不见了**，是换了个找法——不说这一句，民警只会以为项目丢了。
                  （`搜索` 就是 tab 栏上那颗放大镜，见上面的 tab 栏。） */}
              <Show when={已归档还有() > 0}>
                <p
                  data-slot="project-archived-hint"
                  class="px-1.5 py-1 text-[11px] leading-4 text-v2-text-text-faint"
                >
                  另有 {已归档还有()} 个更早的已归档项目，请用搜索查找。
                </p>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>

      {/* 没办成的那句话（归档 / 找回共用）。放在面板最底下、`role="alert"`：这句话是民警
          **必须知道**的（他刚点了一个破坏性动作），不该只靠眼睛扫到。 */}
      <Show when={没办成()}>
        {(文案) => (
          <p
            data-slot="project-panel-action-error"
            role="alert"
            class="px-1.5 text-[11px] leading-4 text-v2-state-fg-danger"
          >
            {文案()}
          </p>
        )}
      </Show>
    </div>
  )
}
