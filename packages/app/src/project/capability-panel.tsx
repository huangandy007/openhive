import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import type { 内核技能, 被覆盖技能 } from "@/ai-assets/enable-api"
import { 合并能力, 计数, type 能力条目, type 库内条目, type 自带条目 } from "./capability-source"
import { 技能句子, 技能载荷, 技能载荷型 } from "@/ai-session/skill-drop"

/**
 * 项目「能力」面板（`2026-10-27-项目能力面板-design.md`）。
 *
 * ## 三档手风琴
 *
 * 永远恰好一组展开。展开组**之前**的组收在顶部，**之后**的组贴底。
 * 点已展开的组头 ⇒ 收起自己、回到「技能」展开——这条是兜底，否则会出现三组全收起的空面板。
 *
 * ## 组头形态借自 MinIO 条（`minio-bar.tsx:130-154`）
 *
 * 13px、`muted → base` 的 hover、右侧箭头说明「再点一下会怎样」。**不借**它的默认收起：
 * 用户点这个 tab 就是来看内容的。
 *
 * ## 知识库永远不写数字
 *
 * 它不是「0 个」，是这个功能还没做——内核连它的工具映射都没有（`rbac.ts:117`）。
 * 写 `0` 等于替后端回答一个它回答不了的问题（`#002-02`）。
 *
 * ## 技能组的数字在没数时不写
 *
 * `计数()` 不区分「不知道」与 0，所以 `skills()` 为 `undefined`（从未读到 / 换过项目）时
 * 整段计数**不渲染**——兜底成 `计数(条目() ?? [])` 会把「读不到」画成「0 个」（`#002-02`）。
 */
export type 能力组 = "skill" | "knowledge" | "mcp"

const 组序: readonly 能力组[] = ["skill", "knowledge", "mcp"]
const 组名: Record<能力组, string> = { skill: "技能", knowledge: "知识库", mcp: "MCP" }

const 槽名: Record<能力组, string> = {
  skill: "capability-group-skill",
  knowledge: "capability-group-knowledge",
  mcp: "capability-group-mcp",
}

export interface CapabilityPanelProps {
  readonly hasProject: () => boolean
  readonly enabled: () => ReadonlySet<string>
  /** 项目真相（含我看不见的）。与 `enabled().size` 不等时补一行说明（设计 §6）。 */
  readonly enabledCount: () => number
  readonly skills: () => readonly 内核技能[] | undefined
  /** 服务端点名的「已启用却被同名技能盖掉」的资产；`undefined` = 这次没这个结论。 */
  readonly shadowed: () => readonly 被覆盖技能[] | undefined
  /**
   * 「这个项目的这次读到底了」（成功或失败都算）。
   *
   * 只靠 `skills()` 的 `undefined` 分不清「还在读」与「读完了但读不到」：前者该说「正在读取…」，
   * 后者必须给重试——否则面板会永远停在「正在读取」，而 `reload()` 在面板上没有第二个入口
   * （终审 I2）。
   */
  readonly readDone: () => boolean
  readonly error: () => string | undefined
  readonly busy: () => string | undefined
  readonly onToggle: (assetId: string) => void
  readonly onRetry: () => void
}

const 头 =
  "flex h-7 w-full shrink-0 cursor-pointer items-center gap-1.5 px-2 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
const 贴底头 = `border-t border-v2-border-border-muted ${头}`
// 悬停灰底（2026-10-28 用户要求）：用项目统一的 hover 覆盖层令牌，与组头、资产卡同一档灰，
// 不另造颜色（品牌化走 tokens，不硬编码）。
const 条目框 =
  "rounded-[6px] border border-v2-border-border-muted px-2 py-1.5 hover:bg-v2-overlay-simple-overlay-hover"
const 小钮 =
  "cursor-pointer rounded-[4px] px-1.5 py-0.5 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"

/** 预览与卡片右缘的缝。 */
const 预览缝 = 8

/** 预览锚在**视口坐标**上（`getBoundingClientRect` 给的就是视口坐标，配 `position: fixed` 用）。 */
interface 说明锚 {
  readonly 文字: string
  readonly left: number
  /** 卡片纵向中线——预览默认居中在它上面。 */
  readonly 中线: number
}

export function CapabilityPanel(props: CapabilityPanelProps): JSX.Element {
  const [展开, set展开] = createSignal<能力组>("skill")

  /**
   * 说明预览（2026-10-28 用户裁定：说明从卡片里挪到**悬停 / 聚焦时卡片右侧**的浮层）。
   *
   * ## `Portal` ＋ `fixed` 各管一件事（两件都靠真栈变异实测过，别按「都一样」想当然）
   *
   * 左栏这三层壳——`aside[three-pane-left]`、`three-pane-left-card`、本面板——都是
   * `overflow: hidden`。但裁剪只吃**包含块落在裁剪树内**的元素；`position: fixed` 的元素
   * 包含块是视口，**躲在 `overflow: hidden` 的祖先里也不会被裁**（实测：只留 `fixed`、
   * 拆掉 `Portal`，越界那一段的命中栈顶仍是预览自己，`capability-hover-preview-real.spec.ts`）。
   * 所以挡住裁剪的是 `fixed`，`Portal` 不是。
   *
   * `Portal` 管的是另一件事——**坐标基准**。实测同一变异：`left` 偏 1px、纵向偏 37px
   * （卡中 168 ⇒ 预中 205），说明这棵子树里有祖先成了 `fixed` 的包含块，坐标就不再是视口
   * 坐标了。而 `说明锚` 存的是 `getBoundingClientRect` 给的**视口坐标**，两套基准对不上就错位。
   * `Portal` 到 body 下把基准拉回视口，与「视口坐标」这个前提对齐；顺带也不依赖这棵树将来
   * 有没有人加 `transform` / `filter` / `contain`（它们都会改包含块）。
   *
   * 两句合起来才是这段代码能成立的完整理由：`fixed` 逃裁剪，`Portal` 保坐标。
   * 右栏那条悬停预览是同一个形状（`ai-session/session-nav.tsx` 与
   * `e2e/real-stack/session-nav-real.spec.ts` ③b）。
   *
   * `z-30`：左栏之上、真浮层之下（真 dialog/menu 从 50 起）。`pointer-events-none`：预览
   * 压在鼠标路径上也不能接事件——否则它自己会吃掉 `mouseleave`/`mouseenter`，卡片闪个不停。
   */
  const [说明, set说明] = createSignal<说明锚>()
  /** 夹紧后的纵向中心；`undefined` = 还没量到高度（happy-dom 或尚未布局）⇒ 退回卡片中线。 */
  const [预览纵, set预览纵] = createSignal<number>()

  const 收说明 = () => {
    set预览纵(undefined)
    set说明(undefined)
  }

  /**
   * 从**这张卡**右上角弹出它的说明。
   *
   * 没有说明就什么都不弹——不给一个空盒子（空浮层比没有浮层更像坏了）。
   */
  const 弹说明 = (卡: HTMLElement, 文字: string | undefined) => {
    if (文字 === undefined) return 收说明()
    const 盒 = 卡.getBoundingClientRect()
    set预览纵(undefined)
    set说明({ 文字, left: 盒.right + 预览缝, 中线: 盒.top + 盒.height / 2 })
  }

  /**
   * 卡片的悬停 / 聚焦接线（两处条目共用）。
   *
   * 键盘要能拿到同一份信息：焦点落在卡里的停用按钮上时同样弹。`focusout` 要分清楚
   * 「焦点离开卡片」与「焦点在卡内挪动」（卡片 → 停用按钮），后者收掉就是闪一下没了。
   */
  const 卡接线 = (文字: () => string | undefined) => ({
    onMouseEnter: (事件: MouseEvent & { currentTarget: HTMLElement }) => 弹说明(事件.currentTarget, 文字()),
    onMouseLeave: () => 收说明(),
    onFocusIn: (事件: FocusEvent & { currentTarget: HTMLElement }) => 弹说明(事件.currentTarget, 文字()),
    onFocusOut: (事件: FocusEvent & { currentTarget: HTMLElement }) => {
      const 下一个 = 事件.relatedTarget
      // `relatedTarget` 是 `EventTarget | null`：`null`（焦点不知去向，如点了页外）与
      // 非节点目标都按「离开了」处理；只有落在**卡内**的节点上才算还在卡里。
      if (!(下一个 instanceof Node) || !事件.currentTarget.contains(下一个)) 收说明()
    },
  })

  /**
   * 这张卡能不能拖去右栏（2026-10-29 用户提出，并裁定「没启用的不能拖」）。
   *
   * - 库内条目：只有 `loaded`（内核真加载到了）才算能用。②「已启用但没加载到」那张卡
   *   拖过去只会得到一句「请使用…技能帮我：」，而 AI 那边根本没有这个技能——等于用拖拽
   *   替用户造一个不存在的承诺（这正是那张卡下面那行诊断在说的事）。
   * - 自带条目：内核读得到才在这里出现，本来就是可用的。
   */
  const 可拖 = (条: 能力条目) => (条.kind === "local" ? true : 条.loaded)

  /**
   * 拖拽源接线。载荷与文案都取自 `@/ai-session/skill-drop`，收货方从同一处取（`#002-06`）。
   *
   * `text/plain` 写**整句**而不是内部前缀：拖到别的应用（记事本、别的输入框）时落下的
   * 是人话，不是 `skill:话单分析`。同一个拖拽里两种型各说各的受众。
   */
  const 拖接线 = (条: 能力条目) =>
    可拖(条)
      ? {
          draggable: true,
          onDragStart: (事件: DragEvent) => {
            if (!事件.dataTransfer) return
            事件.dataTransfer.effectAllowed = "copy"
            事件.dataTransfer.setData(技能载荷型, 技能载荷(条.name))
            事件.dataTransfer.setData("text/plain", 技能句子(条.name))
            // 指针拖着东西离开卡片时多半没有 `mouseleave`（拖拽期间不派发指针事件）⇒
            // 不收掉预览，它就会孤零零留在屏上（同「卡片被移走」那条清理的必要性）。
            收说明()
          },
        }
      : {}

  /** 说明对读屏仍然可见（视觉上省掉了那一行，信息不能整个消失）。 */
  const 读屏说明 = (文字: () => string | undefined) => (
    <Show when={文字()}>
      {(说) => (
        <span data-slot="capability-desc-sr" class="sr-only">
          {说()}
        </span>
      )}
    </Show>
  )

  const 条目 = () => 合并能力({ enabled: props.enabled(), skills: props.skills(), shadowed: props.shadowed() })
  const 前面 = () => 组序.filter((组) => 组序.indexOf(组) < 组序.indexOf(展开()))
  const 后面 = () => 组序.filter((组) => 组序.indexOf(组) > 组序.indexOf(展开()))
  const 数不到 = () => props.enabledCount() - props.enabled().size

  const 点组 = (组: 能力组) => {
    // 点已展开的组 ⇒ 回技能（设计 §3 规则 3）。点别的组 ⇒ 换它展开。
    set展开(组 === 展开() ? "skill" : 组)
  }

  // `清单` 只从「已经数过」的分支传进来——这个函数不负责分辨「不知道」与 0（`#002-02`）。
  // ⚠️ 收的是 **accessor**，不是数组：数组字面值在这里是「烧死的快照」，数据一变就永远停在旧值
  //（终审 C1 实测：`setEnabled(new Set())` 后组头仍写「· 1 个」）。JSX 里的 `清单()` 会被编译器
  // 包成 getter，所以读它就是订阅。
  const 组头 = (组: 能力组, 贴底: boolean, 清单: () => readonly 能力条目[]) => (
    <button
      type="button"
      data-slot={槽名[组]}
      aria-expanded={展开() === 组}
      class={贴底 ? 贴底头 : 头}
      onClick={() => 点组(组)}
    >
      <span aria-hidden="true">◆</span>
      <span class="font-semibold">{组名[组]}</span>
      <Show when={组 === "skill"}>
        <span data-slot="capability-count-skill" class="text-v2-text-text-muted">
          · {计数(清单())} 个
        </span>
      </Show>
      <Show when={组 === "mcp"}>
        <span data-slot="capability-count-mcp" class="text-v2-text-text-muted">
          · 0 个
        </span>
      </Show>
      {/* 知识库不写数字：内核报不出它，0 是我们编的（设计 §3、`#002-02`）。 */}
      <Show when={组 === "knowledge"}>
        <span class="text-v2-text-text-muted">即将支持</span>
      </Show>
      <span class="ml-auto" aria-hidden="true">
        {展开() === 组 ? "⌄" : "›"}
      </span>
    </button>
  )

  const 自带 = (条: 自带条目) => (
    <div data-slot="capability-item-local" class={条目框} {...卡接线(() => 条.description)} {...拖接线(条)}>
      <div class="flex items-center gap-1.5">
        <span aria-hidden="true">●</span>
        <span class="font-semibold">{条.name}</span>
        <span class="ml-auto text-[11px] text-v2-text-text-muted">📝 本项目自带</span>
      </div>
      {读屏说明(() => 条.description)}
    </div>
  )

  const 库内 = (条: 库内条目) => (
    <div
      data-slot={条.loaded ? "capability-item-loaded" : "capability-item-stale"}
      class={条目框}
      {...卡接线(() => 条.description)}
      {...拖接线(条)}
    >
      <div class="flex items-center gap-1.5">
        <span aria-hidden="true">{条.loaded ? "●" : "▲"}</span>
        <span class="font-semibold">{条.name}</span>
        {/* 2026-10-28：`📦` 换成图标集里的 `archive`（同一个意思，但是对得上设计系统的画法）。
            `--icon-base` 必须由这层注入——`icon.css` 给图标自身写了 `color: var(--icon-base)`，
            写在父级上的 `text-*` 到不了它，不注入就静默落上游那档硬编码灰（`rail.tsx` 同一个坑）。 */}
        <span
          data-slot="capability-source"
          class="ml-auto flex items-center gap-1 text-[11px] text-v2-text-text-muted"
        >
          <span class="flex items-center [--icon-base:var(--v2-icon-icon-muted)]">
            <Icon name="archive" size="small" />
          </span>
          资产库
        </span>
      </div>
      {读屏说明(() => 条.description)}
      {/* 正常（`loaded`）时卡片里没有第二块文字——说明改由右侧预览承载了。
          只有 ② 还要一行**诊断**（它不是说明，是「为什么没生效」，必须留在卡上）。 */}
      <Show when={!条.loaded}>
        {/* ② 有两种成因，说反了就是在假故障上劝用户停用（2026-10-28 真栈现场）：
            链接真丢了 vs 被同名技能盖掉（链接完好，内核去重时留了另一份）。
            槽名分开，两种文案不互相顶替，测试也断得出是哪一种。 */}
        <Show
          when={条.覆盖者}
          fallback={
            <p data-slot="capability-stale-reason" class="pl-3 text-[11px]">
              已启用，但 AI 没加载到——项目里的快捷方式可能丢了。停用后可在资产中心重新启用。
            </p>
          }
        >
          {(盖) => (
            <p data-slot="capability-shadowed-reason" class="pl-3 text-[11px]">
              已启用，但被一份同名技能「{盖().name}」盖住了，AI 现在用的是那一份。改名或移走那份同名技能后重试。
            </p>
          )}
        </Show>
      </Show>
      <div class="pl-3 pt-1">
        <button
          type="button"
          data-slot="capability-disable"
          disabled={props.busy() === 条.assetId}
          class={小钮}
          onClick={() => props.onToggle(条.assetId)}
        >
          停用
        </button>
      </div>
    </div>
  )

  // ③ 自带条目**没有**操作按钮：它不是装来的，点了等于删用户的文件（设计 §4）。
  const 一条 = (条: 能力条目) => {
    // 卡片被移走（比如刚点了「停用」，回包后它整条消失）时，指针不会再给这张卡发
    // `mouseleave` ⇒ 预览会孤零零留在屏上。卡片自己的清理里把它收掉。
    onCleanup(收说明)
    return 条.kind === "local" ? 自带(条) : 库内(条)
  }

  // 只有「真的数过」才进得来：`清单()` 一定是有值的数组，组头/条目/计数才允许出现。
  // ⚠️ 形参是 **accessor**：`Show` 的非 keyed 回调只在真假翻转时重跑，把 `清单()` 当场求值再传下去
  // 等于把数组焊死在那一刻（终审 C1）。JSX 里的 `清单()` / `<For each={清单()}>` 才是订阅点。
  const 手风琴 = (清单: () => readonly 能力条目[]) => (
    <>
      <For each={前面()}>{(组) => 组头(组, false, 清单)}</For>
      {组头(展开(), false, 清单)}

      <div class="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <Show when={展开() === "skill"}>
          <Show when={数不到() > 0}>
            <p data-slot="capability-out-of-scope" class="px-1 pb-1 text-[11px] text-v2-text-text-muted">
              项目共启用 {props.enabledCount()} 个，其中 {数不到()} 个不在你的授权范围。
            </p>
          </Show>
          <Show
            when={清单().length > 0}
            fallback={<p class="px-1 py-2 text-[12px] text-v2-text-text-muted">这个项目还没有装任何技能。</p>}
          >
            <div class="flex flex-col gap-1.5">
              <For each={清单()}>{(条) => 一条(条)}</For>
            </div>
          </Show>
        </Show>

        <Show when={展开() === "knowledge"}>
          <p class="px-1 py-2 text-[12px] text-v2-text-text-muted">知识库还没有接入，接入后会出现在这里。</p>
        </Show>

        <Show when={展开() === "mcp"}>
          <p class="px-1 py-2 text-[12px] text-v2-text-text-muted">
            这个项目还没有连任何 MCP。MCP 要由管理员在治理后台登记、授权给你，才会出现在这里。
          </p>
        </Show>
      </div>

      <For each={后面()}>{(组) => 组头(组, true, 清单)}</For>
    </>
  )

  return (
    <div data-component="capability-panel" class="flex min-h-0 w-full flex-1 flex-col">
      <Show
        when={props.hasProject()}
        fallback={
          <p data-slot="capability-no-project" class="px-2 py-3 text-[13px] text-v2-text-text-muted">
            先选一个项目
          </p>
        }
      >
        {/*
          失败 ⇒ 整块只剩重试（设计 §8）。**旧数据也必须一起藏掉**：`error` 有值时
          `skills()` 可能还留着上次成功的值，而库侧这次没读到——三态判断不成立，
          照画会把每条已装技能误判成 ③「本项目自带」，组头还会写 `· 0 个`。
        */}
        {/* 判据是 `!== undefined`，不是真值：`error()` 为空串也是「有错」（设计口径），
            用真值会让 `""` 落回 fallback——旧 skills 还在时 §8 违规复活。

            「读完了但没读到」也走这一块（终审 I2）：`readDone()` 为真而 `条目()` 仍缺席，
            说明这次读有结论了——结论是「不知道」。停在「正在读取…」是没有出口的，
            面板上唯一能拨重试的地方就是下面这颗钮。 */}
        <Show
          when={props.error() !== undefined || (props.readDone() && 条目() === undefined)}
          fallback={
            // 从没读到 / 换过项目 / 正在读：一行「正在读取」，不画组头、计数、条目、重试。
            <Show
              when={条目()}
              fallback={
                <p data-slot="capability-loading" class="px-2 py-3 text-[13px] text-v2-text-text-muted">
                  正在读取…
                </p>
              }
            >
              {/* `Show` 的回调参数**本来就是** accessor：直接透传，别再 `()` 一次
                  （求了值就又把它烧成数组，C1 会原地复活）。 */}
              {(清单) => 手风琴(清单)}
            </Show>
          }
        >
          {/* 不用 children 回调：`when` 现在是布尔，回调拿到的是 `true` 而不是那句人话。 */}
          <div data-slot="capability-unreadable" class="px-2 py-2 text-[12px] text-v2-text-text-muted">
            <Show when={props.error() !== undefined}>
              <p data-slot="capability-error" class="text-v2-state-fg-danger">
                {props.error()}
              </p>
            </Show>
            <p>
              暂时读不到这个项目的技能。
              <button type="button" data-slot="capability-retry" class={小钮} onClick={() => props.onRetry()}>
                重试
              </button>
            </p>
          </div>
        </Show>
      </Show>

      {/* 说明预览：`Portal` ＋ `fixed`（理由见 `说明` 信号上的那段注释）。 */}
      <Show when={说明()} keyed>
        {(锚) => {
          let 盒: HTMLDivElement | undefined
          // 高度要**挂上去之后**才量得到（`Portal` 是先建后插）；量到再夹紧到视口内，
          // 免得靠近底边的那张卡的预览从屏幕下沿出去。量不到（happy-dom／未布局）就落在中线上。
          onMount(() => {
            const 高 = 盒?.offsetHeight ?? 0
            if (高 <= 0) return
            const 上沿 = 8
            const 下沿 = window.innerHeight - 8
            set预览纵(Math.min(Math.max(锚.中线, 上沿 + 高 / 2), 下沿 - 高 / 2))
          })
          return (
            <Portal>
              <div
                ref={盒}
                data-slot="capability-hover-preview"
                class="pointer-events-none z-30 -translate-y-1/2 overflow-hidden rounded-lg bg-v2-background-bg-layer-01 p-2 text-xs leading-5 whitespace-pre-wrap text-v2-text-text-base shadow-[var(--v2-elevation-floating)] w-[260px] max-h-[min(320px,50vh)]"
                style={{
                  // `position` 写内联而不是类：它是这套逃逸机制的**一半**，测试要能直接读到它
                  //（happy-dom 不跑 CSS，类名量不出来——`#005-07`）。
                  position: "fixed",
                  left: `${锚.left}px`,
                  top: `${预览纵() ?? 锚.中线}px`,
                }}
              >
                {锚.文字}
              </div>
            </Portal>
          )
        }}
      </Show>
    </div>
  )
}
