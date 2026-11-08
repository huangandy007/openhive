import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, Show, type JSX } from "solid-js"
import { EntityTypeBadge } from "../../components/entity-type-badge"
import {
  纠正原因们,
  type CaseDetailApi,
  type 档案事件,
  type 档案关系,
  type 实体档案,
  type 引用,
  type 纠正原因,
} from "../case-detail-api"
import { 多行选区文本 } from "../structured-selection"
import { 发到会话 } from "../ask-ai"
import { 定位文本, 金额文本, 时间文本 } from "./format"

export interface EntityProfileProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
  /** 三个跳转；标题在这里拼（档案页手里有规范值，`CaseView` 只认路径）。 */
  readonly onOpen: (view: "timeline" | "money" | "graph", 标题: string) => void
}

// 悬停必须看得见，而在**不透明底**上这不容易，两代写法都被真栈否掉了：
// ① `hover:bg-v2-overlay-*`（4% 黑）直接顶掉不透明底 ⇒ 242 → 245，反而更亮；
// ② `hover:bg-v2-background-bg-layer-03` 换相邻一档灰 ⇒ 242 → 238，只差 4 个色阶。
// 设计系统的口径（`button-v2.css`）是**叠层**：`background-image` 铺 4% 黑在底色之上。
// `cursor-pointer` 也必须显式给——全站没有 `button { cursor: pointer }`，默认 `default`。
const 悬停叠层 =
  "hover:[background-image:linear-gradient(0deg,var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))]"

const 裁决按钮类 = (押下: boolean) =>
  押下
    ? `h-7 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[13px] font-semibold text-v2-text-text-base transition-colors ${悬停叠层} disabled:cursor-not-allowed disabled:opacity-50`
    : `h-7 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base transition-colors ${悬停叠层} disabled:cursor-not-allowed disabled:opacity-50`

/**
 * 出处默认画多少行；超了给「展开全部」（2026-11-07）。
 *
 * 服务端另有 500 的硬顶（`case-entity-list.ts` 的 `引用上限`）——那个防病态数据，这个防版面。
 * 展开是**纯前端**：数据已经在回包里，不必再发请求。
 */
export const 出处默认显示 = 20

/**
 * 关系行的七列：方向 / 对方 / 类别 / 关系 / 次数 / 金额 / 状态。表头与行共用同一份列宽。
 *
 * 「类别」是 2026-11-08 用户裁定新增的一列（对方细类 → 大类 → 「——」）；
 * 原来的「类型」列改名为「关系」——那列本来就是关系类型（转账 / 通话），不是对方的类型。
 */
const 关系列 =
  "grid grid-cols-[48px_minmax(0,1fr)_72px_56px_52px_92px_64px] items-baseline gap-x-2 px-3"

/**
 * 对方是什么：细类 → 大类 → 「——」（2026-11-08 用户裁定）。
 *
 * `typeof` 那一句是给**没重启的内核**留的门：旧回包里根本没有 `对方细类` 这个键，
 * 直接 `!== null` 会拿到 `undefined` 并原样画成空白。
 */
function 对方类别(行: 档案关系): string {
  const 细类 = 行.对方细类
  if (typeof 细类 === "string" && 细类 !== "") return 细类
  return 行.对方类型 !== "" ? 行.对方类型 : "——"
}

/** 关系行的一条摘要（底栏「这条关系：…」与拖拽载荷的开头共用同一份写法）。 */
function 关系摘要(行: 档案关系): string {
  return `${行.方向 === "出" ? "出 →" : "← 入"} ${行.对方值}（${对方类别(行)}）· ${行.type}`
}

/** 事件行的一条摘要（同上）。 */
function 事件摘要(事件: 档案事件): string {
  return `${时间文本(事件.occurred_at)} · ${事件.type}`
}

/** 把非空段落用「 · 」串起来（空段直接不出现，不留两个分隔符挨在一起）。 */
function 串(...段们: Array<string | undefined>): string {
  return 段们.filter((段): 段 is string => 段 !== undefined && 段 !== "").join(" · ")
}

/**
 * 行的「带走」文本：右键「复制」、拖到会话框读的都是它（`data-copy`）。
 *
 * 与界面上的列**分开**写：界面上靠列对齐扫读，带走的要一句话读得懂（谁、什么关系、几次、
 * 多少钱、谁认过）。两处各写一份等于同一个前提写两遍（`#002-06`），所以导出也走这里。
 */
function 关系行文本(行: 档案关系): string {
  return 串(
    关系摘要(行),
    行.次数 === null ? "次数未知" : `${行.次数} 次`,
    金额文本(行.金额),
    行.trust_state,
    行.basis === null ? undefined : `依据：${行.basis}`,
  )
}

function 事件行文本(事件: 档案事件): string {
  return 串(
    事件摘要(事件),
    事件.summary ?? undefined,
    事件.participants.length === 0 ? undefined : 事件.participants.join("、"),
    事件.trust_state,
  )
}

function 出处行文本(引用: 引用): string {
  return 串(引用.path ?? 引用.fileName ?? 引用.materialId, 定位文本(引用.locator) || undefined, 引用.extractMethod)
}

/**
 * 实体档案（design §8.3）。
 *
 * 关系**分两段**：「数据说的」是抽取器直出的（`source_kind !== "human"`），「人说的」是民警
 * 认定过的。合并成一张表会让民警分不清哪条能当依据——这正是 §4.2 要区分 `data` / `human` 的理由。
 *
 * ## 版面（2026-11-07 视觉改版）
 *
 * 根节点不再自己滚动，而是「固定身份头 / 滚动体 / 固定裁决条」三段：
 * 滚动时始终看得见「这是谁」，也始终够得着 ✓ 对 / ✗ 错 / ？存疑（原来要滚到页尾）。
 * 身份头始终渲染（载入 / 出错时只剩「实体档案」字样），因为「显示已排除」开关在错误态
 * 仍是重试入口，不能被 `<Show when={档()}>` 一起藏掉。
 *
 * ## 数字条为什么没有「涉及金额」
 *
 * `金额` 是**逐条关系**的 numeric 字符串，出入双向各记一遍：4×3 万来回会在客户端加成 12 万
 * （真正的交易额是 12 万，但「流入」「流出」两侧各算一次会得到 24 万）。服务端不提供聚合，
 * 前端就不摆这个数字——宁可少一个指标，不编一个错数。
 *
 * ## 数字卡的口径（2026-11-07 改）
 *
 * 四个数字一律报**全量**（回包里的 `关系总数` / `事件总数` / `引用总数` / `对方数`），
 * 与顶部「一句话」同源。原先按本页条数算，201 个对手方会显示成 200，同一页两个数字打架；
 * 列表本身仍只带最多 200 条关系 / 100 条事件，截断由数字卡里的「缺口」说清。
 */
export function EntityProfile(props: EntityProfileProps): JSX.Element {
  const [档, set档] = createSignal<实体档案 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)
  // §9.1 / Global Constraint：已排除的事实默认不出现，档案页是唯一能「切换查看」的地方。
  // 开关状态**只由用户点它改变**：请求失败只进错误态，不回滚开关（否则用户会以为是自己点错了）。
  const [含排除, set含排除] = createSignal(false)
  // 出处默认只画前 20 条（见 `出处默认显示` 的说明）。
  const [展开出处, set展开出处] = createSignal(false)
  /** 上一次取的实体键：只在**换实体**时收起出处，裁决 / 切开关重取不该改变阅读位置。 */
  let 上次实体 = ""

  // 纠正入口（design §9.2）：✓ 对 / ✗ 错 / ？存疑，只作用于这个实体本身。
  const [裁决中, set裁决中] = createSignal(false)
  const [展开原因, set展开原因] = createSignal(false)
  const [原因类型, set原因类型] = createSignal<纠正原因 | undefined>()
  const [原因说明, set原因说明] = createSignal("")
  // 裁决成功后 +1 ⇒ 下面的取数 effect 重跑，以服务端回包的 `trust_state` 为准。
  // **不在这里乐观改写档案**：裁决成功但重取失败时，界面该说的是「读不到档案」。
  const [重取序, set重取序] = createSignal(0)
  // 裁决自己的错误：**不能**与「读不到档案」共用信号——那条画在滚动体最顶部，档案很长时
  // 用户在底部提交失败根本看不见，切「显示已排除」重取还会把它抹掉。
  const [裁决错误, set裁决错误] = createSignal<string | undefined>()
  const 原因区id = createUniqueId()
  let 原因框: HTMLTextAreaElement | undefined

  /**
   * 底栏那三个按钮作用在**谁**身上（2026-11-08 用户提出：原来只写「这条事实」，看不出对象）。
   *
   * 默认整条实体；点某条关系 / 事件就换成它，再点一次退回实体。对象必须是一条能说出口的事实
   * ——关系与事件都有自己的 `trust_state`，裁决也各发各的 `factType` / `factId`。
   */
  const [裁决对象, set裁决对象] = createSignal<
    { readonly factType: "entity" } | { readonly factType: "relation" | "event"; readonly factId: string }
  >({ factType: "entity" })
  const 选中的关系 = createMemo(() => {
    const 对象 = 裁决对象()
    if (对象.factType !== "relation") return undefined
    return 档()?.关系.find((行) => 行.id === 对象.factId)
  })
  const 选中的事件 = createMemo(() => {
    const 对象 = 裁决对象()
    if (对象.factType !== "event") return undefined
    return 档()?.事件.find((行) => 行.id === 对象.factId)
  })
  /** 按钮押下读的是**选中对象自己**的信任态（选中一条「已确认」的关系时，✓ 对就该是押下的）。 */
  const 当前信任态 = createMemo(
    () => 选中的关系()?.trust_state ?? 选中的事件()?.trust_state ?? 档()?.trust_state,
  )
  /** 底栏标题：必须让用户一眼看出「现在评的是谁」。 */
  const 底栏对象文本 = createMemo(() => {
    const 当前 = 档()
    if (当前 === undefined) return ""
    const 关系 = 选中的关系()
    if (关系 !== undefined) return `这条关系：${关系摘要(关系)}`
    const 事件 = 选中的事件()
    if (事件 !== undefined) return `这条事件：${事件摘要(事件)}`
    return `整条实体：${当前.canonical_value}（${当前.type}${当前.subtype === undefined ? "" : ` · ${当前.subtype}`}）`
  })

  /**
   * 点行选对象。两件事它**不做**：
   * 1. 拖选文字之后松手那次 click 不改选——用户是在选字复制，不是要评这一行。
   * 2. 不 `preventDefault` 任何鼠标默认行为——否则正文就选不中了（第 4 件的底线）。
   */
  const 点选事实 = (对象: { readonly factType: "relation" | "event"; readonly factId: string }) => {
    const 选区 = window.getSelection()
    if (选区 !== null && !选区.isCollapsed) return
    const 当前 = 裁决对象()
    if (当前.factType === 对象.factType && 当前.factId === 对象.factId) {
      set裁决对象({ factType: "entity" })
      return
    }
    set裁决对象(对象)
  }
  /** 行是不是当前对象（选中底色与 `data-selected` 共用这一份判据）。 */
  const 是选中 = (factType: "relation" | "event", factId: string) => {
    const 对象 = 裁决对象()
    return 对象.factType === factType && 对象.factId === factId
  }

  // 刷新后选中的那条可能已经不在了（被排除 / 服务端换了回包）⇒ 退回整条实体，
  // 否则底栏会一直指着一个画不出来的东西。
  createEffect(() => {
    const 当前 = 档()
    if (当前 === undefined) return
    const 对象 = 裁决对象()
    if (对象.factType === "entity") return
    const 在 = 对象.factType === "relation"
      ? 当前.关系.some((行) => 行.id === 对象.factId)
      : 当前.事件.some((行) => 行.id === 对象.factId)
    if (!在) set裁决对象({ factType: "entity" })
  })

  createEffect(() => {
    const projectId = props.projectId
    const id = props.id
    const api = props.api
    const 要排除 = 含排除()
    // 只为了订阅「重取」信号（值本身不参与取数），见上面的 `set重取序`。
    void 重取序()
    const 实体键 = `${projectId}/${id}`
    if (实体键 !== 上次实体) {
      上次实体 = 实体键
      set展开出处(false)
      // 换了实体，上一条实体选中的关系 / 事件当然不再属于这里（同 id 也不该沿用）。
      set裁决对象({ factType: "entity" })
    }
    set档(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（与 Task 5 同一处修过的坑，
    // `LEARNINGS #005-03`）。写成 `return () => …` 时迟到的回包会盖掉新实体的档案。
    // 开关切换也会重跑本 effect——旧请求同样要被作废，否则迟到的旧回包会盖掉新选择。
    onCleanup(() => {
      作废 = true
    })
    void api.profile(projectId, id, 要排除)
      .then((结果) => {
        if (作废) return
        set载入(false)
        if (结果.kind === "error") {
          set错误(结果.message)
          return
        }
        set档(结果.value)
      })
      // ⚠️ 必须接 rejection：不接就是「载入中」永远不散 ＋ 一条 unhandled rejection。失败与
      // `kind: "error"` 是同一件事（读不到档案），说法也只该有一种（同一个错误信号）。
      .catch((错误值: unknown) => {
        if (作废) return
        set载入(false)
        set错误(错误值 instanceof Error ? 错误值.message : "读取实体档案失败")
      })
  })

  const 数据说的 = createMemo(() => 档()?.关系.filter((行) => 行.source_kind !== "human") ?? [])
  const 人说的 = createMemo(() => 档()?.关系.filter((行) => 行.source_kind === "human") ?? [])
  /** 画出来的出处行：未展开时只给前 `出处默认显示` 条。 */
  const 显示的引用 = createMemo(() => {
    const 全部 = 档()?.引用 ?? []
    return 展开出处() ? 全部 : 全部.slice(0, 出处默认显示)
  })

  /**
   * 数字卡一律报**全量**（服务端回包里的 `关系总数` / `事件总数` / `对方数` / `待确认.合计`）。
   *
   * 不能拿 `关系.length` 报：列表页只带前 200 条，按页报会把「201 个对手方」说成 200，
   * 还会和顶部「一句话」（全量聚合）对不上。页内截断由数字卡下面的「缺口」说明。
   */
  const 统计 = createMemo(() => {
    const 当前 = 档()
    if (当前 === undefined) return []
    return [
      { key: "关系", 值: 当前.关系总数 },
      { key: "事件", 值: 当前.事件总数 },
      { key: "对手方", 值: 当前.对方数 },
      { key: "待确认", 值: 当前.待确认.合计 },
    ]
  })

  /**
   * 四格各自的落点：点数字 = 走到它数的那批东西跟前，别让人自己往下翻。
   *
   * 「对手方」没有自己的正文块——它是关系里「对方」去重后的个数 ⇒ 与「关系」同落点。
   * 「待确认」没有自己的块：它是「回到整条实体 + 聚焦 ✓ 正确」，让用户马上能开始裁决。
   * 落点用 `data-slot` 现查，不另存 ref 数组：块是条件渲染的，ref 可能在点击时已经换过。
   */
  const 落点: Record<string, string> = {
    关系: "entity-relations",
    事件: "entity-events",
    对手方: "entity-relations",
  }
  /** 读屏只念「3 / 关系」会以为这是静态数字：可读名必须说清它会跳。 */
  const 格子可读名 = (键: string): string => {
    const 当前 = 档()
    if (键 === "待确认")
      return `回到整条实体并聚焦「✓ 正确」（实体 ${当前?.待确认.实体 ?? 0} + 关系 ${当前?.待确认.关系 ?? 0} + 事件 ${当前?.待确认.事件 ?? 0}）`
    if (键 === "对手方") return "跳到关系块（对手方在关系里）"
    return `跳到${键}块`
  }
  /** 档案自己的滚动容器；点击时从**它里面**找落点，滚到别处等于把用户送出档案页。 */
  let 滚动体: HTMLDivElement | undefined
  /** 底栏裁决条：待确认跳转要聚焦其中的「✓ 正确」。 */
  let 裁决条: HTMLElement | undefined

  const 跳到 = (键: string) => {
    if (键 === "待确认") {
      set裁决对象({ factType: "entity" })
      裁决条?.querySelector<HTMLElement>("[data-slot='entity-trust-confirm']")?.focus()
      return
    }
    const 目标 = 滚动体?.querySelector(`[data-slot='${落点[键]}']`)
    if (目标 instanceof HTMLElement) 目标.scrollIntoView({ block: "start" })
  }

  /** 排除必须同时有原因类型与一句说明（design §9.2）。只判空，不改用户输入。 */
  const 可提交排除 = () => 原因类型() !== undefined && 原因说明().trim() !== ""

  /**
   * 发一次裁决。**成功后不乐观改界面**：收起原因区、清空输入，然后让取数 effect 重跑，
   * 信任态一律读服务端的。失败则保留原因区原文，直接可重试。
   *
   * 在途防重只靠按钮的 `disabled`（裁决中）——`.click()` / 真双击在按钮禁用后都不会再触发。
   */
  const 裁决 = async (
    action: "确认" | "排除" | "存疑",
    原因?: { readonly reasonKind: 纠正原因; readonly reasonText: string },
  ) => {
    set裁决中(true)
    set裁决错误(undefined)
    // 作用对象随底栏标题走：选中了某条关系 / 事件就裁决它，否则裁决整条实体。
    const 对象 = 裁决对象()
    try {
      const 回 = await props.api.trust({
        projectId: props.projectId,
        factType: 对象.factType,
        factId: 对象.factType === "entity" ? props.id : 对象.factId,
        action,
        reasonKind: 原因?.reasonKind,
        reasonText: 原因?.reasonText,
      })
      if (回.kind === "error") {
        set裁决错误(回.message)
        return
      }
      set展开原因(false)
      set原因类型(undefined)
      set原因说明("")
      // ⚠️ 排除成功后服务端默认不再返回这条（§9.1）：还按「不含已排除」重取只会拿到 404，
      // 界面会从「已排除」跳成「找不到这个实体」。先打开「显示已排除」，这次重取才读得到它。
      // 开关本来就是 true（用户自己开着的）时，set 同值不会触发 effect，改走 `重取序`。
      if (action === "排除" && !含排除()) set含排除(true)
      else set重取序((序) => 序 + 1)
    } catch (错误值) {
      // 客户端契约是「从不抛」，但夹具 / 将来换了实现仍可能抛：与 `kind:"error"` 同一个出口。
      set裁决错误(错误值 instanceof Error ? 错误值.message : "提交裁决失败")
    } finally {
      set裁决中(false)
    }
  }

  return (
    <div data-component="entity-profile" class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header data-slot="entity-profile-head" class="@container shrink-0 border-b border-v2-border-border-muted">
        <div class="mx-auto flex w-full max-w-[760px] flex-wrap items-start gap-3 px-4 py-2.5">
          <Show
            when={档()}
            fallback={<span class="min-w-0 flex-1 text-[13px] text-v2-text-text-muted">实体档案</span>}
          >
            {(档) => (
              // 中栏被挤窄时（右侧会话音轨 + 左栏同时开着）整个身份块独占一行，
              // 标题不在一串号码中间硬折行；三个跳转掉到下一行。
              <div class="flex min-w-0 flex-1 items-start gap-3 @max-[520px]:w-full">
                <EntityTypeBadge type={档().type} 大 />
                <div class="min-w-0">
                  <h1
                    data-slot="entity-profile-title"
                    class="break-words text-[18px] font-semibold leading-7 text-v2-text-text-base"
                  >
                    {档().canonical_value}
                  </h1>
                  <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      data-slot="entity-profile-type"
                      class="rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted"
                    >
                      {`${档().type}${档().subtype === undefined ? "" : ` · ${档().subtype}`}`}
                    </span>
                    <span
                      data-slot="entity-profile-trust-state"
                      class="rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted"
                    >
                      {档().trust_state}
                    </span>
                    <Show when={档().aliases.length > 0}>
                      <span data-slot="entity-profile-aliases" class="text-[12px] text-v2-text-text-muted">
                        别名：{档().aliases.join("、")}
                      </span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <div class="flex shrink-0 flex-col items-end gap-1 @max-[520px]:w-full @max-[520px]:items-start">
            {/* 真实交互元素 + 文字标签（不是只靠颜色表达状态）：`aria-pressed` 也是状态的唯一判据。
                放在固定头里：错误态它仍是重试入口，不能被档案的 `<Show>` 藏掉。 */}
            <button
              type="button"
              data-slot="entity-profile-include-excluded"
              aria-pressed={含排除()}
              onClick={() => set含排除((值) => !值)}
              class={
                含排除()
                  ? `h-6 shrink-0 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-v2-text-text-base transition-colors ${悬停叠层}`
                  : "h-6 shrink-0 cursor-pointer rounded-[4px] px-2 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
              }
            >
              显示已排除
            </button>
            <Show when={档()}>
              {(档) => (
                <div class="flex flex-wrap justify-end gap-1">
                  {/* 同一实体换视图：路径由 `CaseView` 拼（它手里有 projectId 与 id），标题在这里拼
                      （档案页手里有规范值，关系图 / 时间线只拿到 id）。 */}
                  <For each={[
                    ["timeline", "时间线", "entity-open-timeline"],
                    ["money", "资金", "entity-open-money"],
                    ["graph", "关系图", "entity-open-graph"],
                  ] as const}>
                    {([视图, 文案, slot]) => (
                      <button
                        type="button"
                        data-slot={slot}
                        onClick={() => props.onOpen(视图, `${档().canonical_value} · ${文案}`)}
                        class={`h-7 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base transition-colors ${悬停叠层}`}
                      >
                        {文案}
                      </button>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>
        </div>
      </header>

      {/* `select-text`（2026-11-08 用户提出「档案里的信息要能拖选、右键复制、拖到会话框」）：
          工作区那一层挂着 `select-none`（`pages/layout-new.tsx:174`），白名单只开了输入类三处；
          文档视图早已为此翻回来过（`center/views/binary-view.tsx:311-323`）。档案正文同理——
          不翻回来，`user-select` 一路继承成 `none`，一个字都选不中。 */}
      <div
        data-slot="entity-profile-body"
        ref={滚动体}
        class="min-h-0 flex-1 overflow-y-auto select-text"
        // 拖选跨两行以上 ⇒ 把「每行一条」的文本塞进拖拽载荷（下同 `内容菜单` 的右键复制）；
        // 只选一行 / 没选区时**不接管**，原生带过去的正是用户眼见的精确文字。
        onDragStart={(事件) => {
          const 文本 = 多行选区文本(事件.currentTarget, window.getSelection())
          if (文本 === undefined) return
          事件.dataTransfer?.setData("text/plain", 文本)
        }}
      >
        <div class="mx-auto w-full max-w-[760px] px-4 py-3">
          <Show when={错误()}>
            {(话) => (
              <p data-slot="entity-profile-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
                {话()}
              </p>
            )}
          </Show>
          <Show when={载入() && 档() === undefined}>
            <p data-slot="entity-profile-loading" class="text-[13px] text-v2-text-text-muted">
              正在读取实体档案…
            </p>
          </Show>
          <Show when={档()}>
            {(档) => (
              <div class="flex flex-col gap-3">
                {/* 结论由服务端生成（§8.3）：同一份数据两次打开必须说同一句话。前端不拼第二份。 */}
                <p
                  data-slot="entity-profile-conclusion"
                  class="text-[14px] leading-6 text-v2-text-text-base"
                >
                  {档().一句话}
                </p>

                <section
                  data-slot="entity-profile-summary"
                  class="overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  <div class="grid grid-cols-4 divide-x divide-v2-border-border-muted">
                    <For each={统计()}>
                      {(项) => (
                        /* 整格是按钮：只让数字可点、标签点不动，等于给用户一个看着像入口的死区。 */
                        <button
                          type="button"
                          data-slot="entity-stat"
                          data-key={项.key}
                          data-jump={落点[项.key]}
                          aria-label={格子可读名(项.key)}
                          onClick={() => 跳到(项.key)}
                          class={`cursor-pointer px-3 py-2 text-left transition-colors ${悬停叠层}`}
                        >
                          <div
                            data-slot="entity-stat-value"
                            class="text-[20px] font-semibold leading-7 tabular-nums text-v2-text-text-base"
                          >
                            {项.值}
                          </div>
                          <div class="text-[11px] text-v2-text-text-muted">{项.key}</div>
                        </button>
                      )}
                    </For>
                  </div>
                  {/* 服务端截断（关系 / 事件只列了前 N 条）就照实说，与清单的 `缺口` 同一套口径。
                      放在数字卡里：让「这是截断后的计数」和数字挨着说，不冒充全量。 */}
                  <For each={档().缺口 ?? []}>
                    {(话) => (
                      <p
                        data-slot="entity-profile-gap"
                        class="border-t border-v2-border-border-muted px-3 py-1.5 text-[11px] text-v2-text-text-muted"
                      >
                        {话}
                      </p>
                    )}
                  </For>
                </section>

                {/* 一条事实都没有时，摆一句**能点的示例问句**（2026-11-08 用户提出）：
                    空页面说「没有」等于让人走；给一句现成的话，用户才知道这页能干什么。
                    有事实时不摆——正常页面上它只会抢版面。 */}
                <Show when={档().关系.length === 0 && 档().事件.length === 0}>
                  <section
                    data-slot="entity-empty-hint"
                    class="rounded-[10px] border border-dashed border-v2-border-border-muted px-3 py-3"
                  >
                    <p class="text-[13px] text-v2-text-text-muted">
                      这个实体暂时没有关系，也没有事件。可以先去文件里找：
                    </p>
                    <button
                      type="button"
                      data-slot="entity-empty-ask"
                      onClick={() =>
                        发到会话(
                          `帮我查一下「${档().canonical_value}」还有哪些往来（转账 / 关系）没有登记，并说明依据的是哪些文件。`,
                        )
                      }
                      class={`mt-2 h-7 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base transition-colors ${悬停叠层}`}
                    >
                      问 AI：还有哪些往来没登记？
                    </button>
                  </section>
                </Show>

                <section
                  data-slot="entity-relations"
                  class="@container scroll-mt-3 overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  {/* 块头一行说清全量（2026-11-08 用户裁定 A）：数字用回包的**全量**计数，
                      不是当前页 `关系.length`（服务端只给前 N 条）。子段标题不再重复报数。 */}
                  <div
                    data-slot="entity-relations-head"
                    class="flex flex-wrap items-baseline gap-x-2 px-3 pt-2"
                  >
                    <h2 class="text-[12px] font-semibold text-v2-text-text-base">关系</h2>
                    <span data-slot="entity-relations-total" class="text-[11px] tabular-nums text-v2-text-text-muted">
                      共 {档().关系总数} 条
                    </span>
                    <span
                      data-slot="entity-relations-data-count"
                      class="text-[11px] tabular-nums text-v2-text-text-muted"
                    >
                      · 数据说的 {档().关系数据总数} 条
                    </span>
                    <span
                      data-slot="entity-relations-human-count"
                      class="text-[11px] tabular-nums text-v2-text-text-muted"
                    >
                      · 人说的 {档().关系人总数} 条
                    </span>
                  </div>
                  <关系段
                    标题="数据说的"
                    slot="entity-relations-data"
                    行们={数据说的()}
                    选中={是选中}
                    点选={点选事实}
                  />
                  <关系段
                    标题="人说的"
                    slot="entity-relations-human"
                    行们={人说的()}
                    选中={是选中}
                    点选={点选事实}
                    分隔
                  />
                </section>

                <section
                  data-slot="entity-events"
                  class="scroll-mt-3 overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  <div class="flex items-baseline gap-1.5 px-3 pt-2">
                    <h2 class="text-[12px] font-semibold text-v2-text-text-base">事件</h2>
                    {/* 报全量（`事件总数`），与同屏数字卡同口径；`事件.length` 只是当前页。 */}
                    <span class="text-[11px] tabular-nums text-v2-text-text-muted">{档().事件总数} 起</span>
                  </div>
                  <Show
                    when={档().事件.length > 0}
                    fallback={<p class="px-3 py-1 pb-2 text-[12px] text-v2-text-text-muted">没有共同事件</p>}
                  >
                    <div class="px-3 pt-1 pb-2">
                      <For each={档().事件}>
                        {(事件) => <事件行 事件={事件} 选中={是选中("event", 事件.id)} 点选={() => 点选事实({ factType: "event", factId: 事件.id })} />}
                      </For>
                    </div>
                  </Show>
                </section>

                <section
                  data-slot="entity-citations"
                  class="scroll-mt-3 overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  <div class="flex items-baseline gap-1.5 px-3 pt-2 pb-1">
                    <h2 class="text-[12px] font-semibold text-v2-text-text-base">出处</h2>
                    {/* 全量条数（`引用总数`），不是当前页 `引用.length`：服务端最多只给 500 条。 */}
                    <span class="text-[11px] tabular-nums text-v2-text-text-muted">{档().引用总数} 条</span>
                  </div>
                  <Show when={档().引用总数 === 0}>
                    <p class="px-3 pb-2 text-[12px] text-v2-text-text-muted">没有登记出处</p>
                  </Show>
                  <For each={显示的引用()}>
                    {(引用) => (
                      <div
                        data-slot="entity-citation"
                        data-copy={出处行文本(引用)}
                        class="flex flex-wrap items-baseline gap-x-2 border-t border-v2-border-border-muted px-3 py-1 text-[12px]"
                      >
                        <span class="text-v2-text-text-base">
                          {引用.path ?? 引用.fileName ?? 引用.materialId}
                        </span>
                        <Show when={定位文本(引用.locator) !== ""}>
                          <span class="text-v2-text-text-muted">{定位文本(引用.locator)}</span>
                        </Show>
                        <span class="text-v2-text-text-faint">{引用.extractMethod}</span>
                      </div>
                    )}
                  </For>
                  {/* 展开是纯前端：数据已经在回包里（服务端只多截在 500），不再发请求。 */}
                  <Show when={档().引用.length > 出处默认显示}>
                    <button
                      type="button"
                      data-slot="entity-citation-expand"
                      aria-expanded={展开出处()}
                      onClick={() => set展开出处((值) => !值)}
                      class={`mx-3 my-1 h-7 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base transition-colors ${悬停叠层}`}
                    >
                      {展开出处() ? "收起" : `展开全部 ${档().引用.length} 条`}
                    </button>
                  </Show>
                </section>
              </div>
            )}
          </Show>
        </div>
      </div>

      {/* 纠正入口（design §9.2）：✓ 对 / ✗ 错 / ？存疑 是这一页的业务动作，固定在底栏——
          长档案里不用先滚到页尾，裁决完也始终看得见自己在评谁。 */}
      <Show when={档()}>
        {(_档) => (
          <footer class="shrink-0 border-t border-v2-border-border-muted bg-v2-background-bg-layer-01">
            <div class="mx-auto w-full max-w-[760px] px-4 py-2">
              {/* 裁决自己的错误画在按钮 / 原因区旁边（不是滚动体顶部的「读不到档案」）。 */}
              <Show when={裁决错误()}>
                {(话) => (
                  <p data-slot="entity-trust-error" role="alert" class="mb-1 text-[13px] text-v2-state-fg-danger">
                    {话()}
                  </p>
                )}
              </Show>
              {/* 原因区在按钮**上方**展开：底栏贴着窗口下沿，向下长会把输入框顶出屏幕。 */}
              <Show when={展开原因()}>
                <div
                  id={原因区id}
                  data-slot="entity-trust-reason"
                  class="mb-1 max-h-[45vh] w-full overflow-y-auto rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-base p-2"
                >
                  <textarea
                    ref={(框) => (原因框 = 框)}
                    data-slot="entity-trust-reason-text"
                    aria-label="错在哪里（一句话）"
                    class="w-full rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-base p-2 text-[13px] leading-6 text-v2-text-text-base"
                    rows={2}
                    placeholder="写一句话说明哪里错了"
                    value={原因说明()}
                    onInput={(事件) => set原因说明(事件.currentTarget.value)}
                  />
                  <div
                    data-slot="entity-trust-reason-kinds"
                    role="radiogroup"
                    aria-label="错误原因"
                    class="mt-1 flex flex-wrap gap-1"
                  >
                    <For each={纠正原因们}>
                      {(值) => (
                        <button
                          type="button"
                          role="radio"
                          data-slot="entity-trust-reason-kind"
                          data-kind={值}
                          aria-checked={原因类型() === 值}
                          disabled={裁决中()}
                          class={裁决按钮类(原因类型() === 值)}
                          onClick={() => set原因类型(值)}
                        >
                          {值}
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="mt-1 flex gap-1">
                    <button
                      type="button"
                      data-slot="entity-trust-reason-submit"
                      disabled={裁决中() || !可提交排除()}
                      onClick={() => {
                        const 类型 = 原因类型()
                        if (类型 === undefined) return
                        void 裁决("排除", { reasonKind: 类型, reasonText: 原因说明() })
                      }}
                      class={裁决按钮类(false)}
                    >
                      提交
                    </button>
                    <button
                      type="button"
                      data-slot="entity-trust-reason-cancel"
                      disabled={裁决中()}
                      onClick={() => {
                        set展开原因(false)
                        set原因类型(undefined)
                        set原因说明("")
                      }}
                      class={裁决按钮类(false)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              </Show>
              <div data-slot="entity-trust" ref={(元素) => (裁决条 = 元素)} class="flex flex-wrap items-center gap-1">
                {/* 标题必须说清「现在评的是谁」：默认整条实体，点行之后换成那条关系 / 事件。
                    长文本截断——底栏不能被一串号码顶出行外。 */}
                <span
                  data-slot="entity-trust-target"
                  class="mr-1 min-w-0 max-w-full truncate text-[12px] text-v2-text-text-muted"
                >
                  {底栏对象文本()}
                </span>
                {/* 形如「✓ 对」的符号是装饰，语义由可见文字与 `aria-label` 承担；
                    当前态用 `aria-pressed` ＋ 头部徽章的文字表达，不只靠颜色。 */}
                <button
                  type="button"
                  data-slot="entity-trust-confirm"
                  aria-label="这条事实对（确认）"
                  aria-pressed={当前信任态() === "已确认"}
                  disabled={裁决中()}
                  onClick={() => void 裁决("确认")}
                  class={裁决按钮类(当前信任态() === "已确认")}
                >
                  ✓ 对
                </button>
                <button
                  type="button"
                  data-slot="entity-trust-reject"
                  aria-label="这条事实有错（排除）"
                  aria-pressed={当前信任态() === "已排除"}
                  aria-expanded={展开原因()}
                  aria-controls={原因区id}
                  disabled={裁决中()}
                  onClick={() => {
                    set展开原因(true)
                    // 原因区整块是 `<Show>` 新插入的，Solid 的渲染在本次事件里同步完成 ⇒ ref 已就绪。
                    原因框?.focus()
                  }}
                  class={裁决按钮类(当前信任态() === "已排除")}
                >
                  ✗ 错
                </button>
                <button
                  type="button"
                  data-slot="entity-trust-doubt"
                  aria-label="这条事实存疑"
                  aria-pressed={当前信任态() === "存疑"}
                  disabled={裁决中()}
                  onClick={() => void 裁决("存疑")}
                  class={裁决按钮类(当前信任态() === "存疑")}
                >
                  ？存疑
                </button>
                <Show when={裁决中()}>
                  <span data-slot="entity-trust-pending" role="status" class="text-[12px] text-v2-text-text-muted">
                    提交中…
                  </span>
                </Show>
              </div>
            </div>
          </footer>
        )}
      </Show>
    </div>
  )
}

/**
 * 关系的一段（数据说的 / 人说的）。
 *
 * 表头与行共用 `关系列`：靠列对齐扫读，不再把方向、对方、类型、次数、金额、依据、信任态
 * 挤成一行文字墙。空的段只留一行灰字，不白占一整块版面。
 */
function 关系段(props: {
  readonly 标题: string
  readonly slot: string
  readonly 行们: readonly 档案关系[]
  /** 这一行是不是底栏当前对象；`选中` / `点选` 由档案组件传下来（行自己没有状态）。 */
  readonly 选中: (factType: "relation" | "event", factId: string) => boolean
  readonly 点选: (对象: { readonly factType: "relation" | "event"; readonly factId: string }) => void
  readonly 分隔?: boolean
}): JSX.Element {
  return (
    <div class={props.分隔 === true ? "border-t border-v2-border-border-muted" : ""}>
      <div class="flex items-baseline gap-1.5 px-3 pt-2">
        <h2 class="text-[12px] font-semibold text-v2-text-text-base">{props.标题}</h2>
        {/* 空的段只多一句「没有」，不白占一整块版面（原来它自己占掉两行）。
            条数由块头统一报（`entity-relations-head`），这里不再重复。 */}
        <Show when={props.行们.length === 0}>
          <span class="text-[12px] text-v2-text-text-muted">· 没有</span>
        </Show>
      </div>
      <div data-slot={props.slot} class="pb-1">
        <Show when={props.行们.length > 0}>
          <div
            data-slot="entity-relation-head"
            class={`${关系列} pb-1 text-[11px] text-v2-text-text-muted @max-[560px]:hidden`}
          >
            <span>方向</span>
            <span>对方</span>
            <span>类别</span>
            <span>关系</span>
            <span class="text-right">次数</span>
            <span class="text-right">金额</span>
            <span>状态</span>
          </div>
          <For each={props.行们}>
            {(行) => {
              // 行可点 = 底栏的裁决对象切到它（2026-11-08）。`onMouseDown` 里不拦默认行为，
              // 否则正文选不中；拖选后的那次 click 由 `点选事实` 自己按选区判断跳过。
              const 选 = () => props.选中("relation", 行.id)
              return (
              <div
                data-slot="entity-relation"
                data-id={行.id}
                data-source={行.source_kind}
                data-copy={关系行文本(行)}
                data-selected={选() ? "true" : undefined}
                role="button"
                tabindex="0"
                aria-pressed={选()}
                onClick={() => props.点选({ factType: "relation", factId: 行.id })}
                // 双击 = 把这一行原文送进右栏（2026-11-08）。两次 click 会各点选一次 ⇒ 底栏
                // 对象回到原样，正好不留下副作用。
                onDblClick={() => 发到会话(关系行文本(行))}
                onKeyDown={(事件) => {
                  if (事件.key !== "Enter" && 事件.key !== " ") return
                  事件.preventDefault()
                  props.点选({ factType: "relation", factId: 行.id })
                }}
                class={`${关系列} cursor-pointer border-t border-v2-border-border-muted py-1.5 text-[13px] hover:bg-v2-overlay-simple-overlay-hover @max-[560px]:flex @max-[560px]:flex-wrap @max-[560px]:gap-y-1 ${选() ? "bg-[var(--v2-background-bg-accent-soft)]" : ""}`}
              >
                <span
                  data-slot="entity-relation-direction"
                  class="w-12 shrink-0 whitespace-nowrap text-[12px] text-v2-text-text-muted"
                >
                  {行.方向 === "出" ? "出 →" : "← 入"}
                </span>
                {/* 窄栏降级时对方值独占一行：号码只差最后几位，截断会把四行截成同一个样子。 */}
                <div class="min-w-0 flex-1 @max-[560px]:flex-none @max-[560px]:basis-[calc(100%-56px)]">
                  <div data-slot="entity-relation-counterparty" class="truncate text-v2-text-text-base">
                    {行.对方值}
                  </div>
                  {/* 依据放不下第七列（列宽会把对方值挤没），压在对方值下面一行；不丢信息。 */}
                  <Show when={行.basis}>
                    {(依据) => (
                      <div class="truncate text-[11px] text-v2-text-text-muted">依据：{依据()}</div>
                    )}
                  </Show>
                </div>
                <span
                  data-slot="entity-relation-kind"
                  class="shrink-0 truncate text-[12px] text-v2-text-text-muted"
                >
                  {对方类别(行)}
                </span>
                <span
                  data-slot="entity-relation-type"
                  class="shrink-0 truncate text-[12px] text-v2-text-text-muted"
                >
                  {行.type}
                </span>
                <span
                  data-slot="entity-relation-count"
                  class="shrink-0 text-right tabular-nums text-v2-text-text-muted"
                >
                  {行.次数 === null ? "—" : `${行.次数} 次`}
                </span>
                <span
                  data-slot="entity-relation-amount"
                  class="shrink-0 text-right tabular-nums text-v2-text-text-base"
                >
                  {金额文本(行.金额)}
                </span>
                <span
                  data-slot="entity-relation-state"
                  class="shrink-0 justify-self-start rounded-[4px] bg-v2-background-bg-base px-1.5 leading-4 text-[11px] text-v2-text-text-muted"
                >
                  {行.trust_state}
                </span>
              </div>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}

/**
 * 一条事件：左轨日期与时刻，右列类型 / 摘要 / 参与人。日期用 `时间文本` 的同一份手写格式。
 * 行本身可点（同关系行）：点一下把底栏的裁决对象换成这条事件。
 */
function 事件行(props: {
  readonly 事件: 档案事件
  readonly 选中: boolean
  readonly 点选: () => void
}): JSX.Element {
  const 事件 = props.事件
  const 时间 = 时间文本(事件.occurred_at)
  const [日, 刻] = 时间.split(" ")
  return (
    <div
      data-slot="entity-event"
      data-id={事件.id}
      data-copy={事件行文本(事件)}
      data-selected={props.选中 ? "true" : undefined}
      role="button"
      tabindex="0"
      aria-pressed={props.选中}
      onClick={props.点选}
      // 同关系行：双击把这条事件原文送进右栏（两次 click 各切一次底栏对象，互相抵消）。
      onDblClick={() => 发到会话(事件行文本(事件))}
      onKeyDown={(键) => {
        if (键.key !== "Enter" && 键.key !== " ") return
        键.preventDefault()
        props.点选()
      }}
      class={`grid cursor-pointer grid-cols-[76px_minmax(0,1fr)] gap-x-3 ${props.选中 ? "bg-[var(--v2-background-bg-accent-soft)]" : ""}`}
    >
      <div class="py-1.5 text-right">
        <div class="text-[11px] tabular-nums text-v2-text-text-muted">{日 ?? "—"}</div>
        <Show when={刻}>
          <div class="text-[11px] tabular-nums text-v2-text-text-faint">{刻}</div>
        </Show>
      </div>
      <div class="relative border-l border-v2-border-border-muted py-1.5 pl-3">
        <span
          aria-hidden="true"
          class="absolute -left-[3.5px] top-[9px] size-1.5 rounded-full bg-[var(--v2-brand-gold)]"
        />
        <div class="flex flex-wrap items-baseline gap-1.5">
          <span class="rounded-[4px] bg-v2-background-bg-base px-1.5 py-0.5 text-[11px] text-v2-text-text-muted">
            {事件.type}
          </span>
          <Show when={事件.summary}>
            {(话) => <span class="text-[13px] text-v2-text-text-base">{话()}</span>}
          </Show>
        </div>
        <div class="mt-0.5 text-[12px] text-v2-text-text-muted">{事件.participants.join("、")}</div>
      </div>
    </div>
  )
}
