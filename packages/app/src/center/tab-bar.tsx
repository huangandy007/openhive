import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { moduleColorVar } from "./module-color"
import { 会话改过, 看见改过 } from "./session-edits"
import { splitTabOverflow } from "./tab-overflow"
import { contentTabKey, type ContentTab } from "./tab-store"

/** tab 高 40px（DESIGN §3.2）。 */
export const TAB_HEIGHT = 40
/** 单张 tab 的估算宽度，用于溢出判定（DESIGN §4.5 未定宽度，取与 front 参考件 `max-w-[220px]` 同量级）。 */
const TAB_WIDTH = 180
/** 行末「⋯」自身占宽。 */
const OVERFLOW_WIDTH = 40

export interface TabBarProps {
  /** 已打开的 tab，顺序即显示顺序（FR-004 跨模块累积）。 */
  tabs: readonly ContentTab[]
  /** 当前激活 tab 的 key（`contentTabKey` 形态）。 */
  active?: string
  onActivate: (key: string) => void
  onClose: (key: string) => void
  /**
   * 可用宽度（px）；省略 = 组件自己量。
   * 留这个口子是因为 happy-dom 没有 CSS 引擎、`clientWidth` 恒为 0，量不出真实宽度
   * （沿用 T008 给顶栏留 `titlebarRight` 注入缝的同一范式）。
   */
  availableWidth?: number
  /**
   * 分屏（2026-10-12）：这颗钮长在**栏尾**，点开是「左右分屏 / 上下分屏」两项。
   *
   * 省略 ＝ **不渲染**（既有宿主：storybook、以及不接分屏的用例，DOM 一字不动）。
   * ⚠️ 少于两张 tab 时它**置灰可见**（`aria-disabled`）而不是藏起来：藏起来用户学不到
   * 「这里能分屏、但要先有两个文件」（设计文档 §3.3 的取舍）。
   */
  onSplit?: (排列: "左右" | "上下") => void
  /** 收起这一栏（只有右/下那一栏接）。省略 ＝ 不渲染。 */
  onUnsplit?: () => void
  /**
   * 这一栏是不是**受焦栏**。
   *
   * ⚠️ 只在分屏时才有意义——调用方传 `center.split() && center.activePane() === p`。
   * 单栏时画一条「这一栏受焦」的指示是噪音：它没有别处可选。
   */
  focused?: boolean
}

/**
 * 栏尾那颗分屏钮占的宽度（`size-6` ＝ 24px ＋ 条内 `gap-0.5` ＝ 2px）。
 * 只在**接了 `onSplit`** 时才从可用宽度里扣（见 `available()`）。
 */
const 栏尾钮宽 = 26

function Tab(props: { tab: ContentTab; active: boolean; onActivate: () => void; onClose: () => void }) {
  let 标题: HTMLSpanElement | undefined
  /**
   * 标题此刻**真的**被 `max-w-44` 截了没有（2026-10-13 用户裁定：提示**只在被截断时**弹）。
   *
   * 「装不下」是**两个数**的比较：内容多宽（`scrollWidth`）与看得见多宽（`clientWidth`）。
   * 这一条与上游 `components/server/server-row.tsx` 的 `truncated`、`components/titlebar-tab-nav.tsx`
   * 的 `titleOverflowing` **同一个判法**——那两处也是「名字被截了才给提示」，照抄形状不另发明
   * （`LEARNINGS #004-12`）。
   *
   * 初值与「量不到」都算**没截断**：不知道就不弹（宁可少弹，不可乱弹）。
   */
  const [被截断, set被截断] = createSignal(false)

  /** 量一次。拿不到那个 span（还没挂上）就**保持上一次的结论**，不猜。 */
  const 量 = () => {
    const 节点 = 标题
    if (!节点) return
    set被截断(节点.scrollWidth > 节点.clientWidth)
  }

  createEffect(() => {
    // 名字变了（同一条 tab 换了文件）要重量。⚠️ 只读不依赖：`量` 读的是 DOM 上的几何，
    // 不是信号，所以这里不会因为 `被截断` 自己变化而重跑（那会是个自激的回路）。
    props.tab.title
    // 首帧那一次：DOM 已在，但浏览器还没排版 ⇒ 让一拍（microtask），量到的才是真宽度。
    queueMicrotask(量)
  })

  onMount(() => {
    /*
      ⚠️ 两个环境前提，都不是洁癖：
      ① happy-dom 里 `ResizeObserver` 就算存在，**回调也不触发**（`LEARNINGS #006-19`）⇒ 那里只有上面那条
         effect 的量法在跑，几何恒 0/0、也就永远判「没截断」；
      ② 上游 `server-row.tsx` 同款守卫也写在这里，照抄。
      宽度变化（浏览器缩放、字体换掉、栏被拖宽）时重量：tab 是 `shrink-0 max-w-44`，宽度只随
      **字体度量**变，故观察点取那个 span 自己。
    */
    if (typeof ResizeObserver !== "function") return
    createResizeObserver([标题], 量)
  })

  return (
    <div
      data-slot="tab"
      data-module={props.tab.module}
      role="tab"
      aria-selected={props.active}
      onClick={props.onActivate}
      class="relative flex h-full max-w-44 shrink-0 cursor-pointer items-center gap-2 rounded-t-md px-3 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
      classList={{ "bg-v2-background-bg-base font-semibold text-v2-text-text-base": props.active }}
    >
      <Show when={props.active}>
        {/* 激活态顶边条：除底色外再用「形状」表达（DESIGN §3.2 / §4.3），与 rail 的选中竖条同法 */}
        <span data-slot="tab-active-bar" class="absolute inset-x-0 top-0 h-0.5 bg-v2-background-bg-accent" />
      </Show>
      {/* ⚠️ **本仓定制（openhive，2026-10-13）**：图标改按**文件类型**选，不再按来源模块。
          用户实报：「在中栏打开的（左栏文件树里的）文件，其 tab 前面是个文件夹图标」——
          根因是原来取的是**模块图标**（`RAIL_ENTRIES` 那套），而「项目管理」那颗入口的图标
          正是 `folder` ⇒ 停在项目管理模块时，**每一张文件 tab 前面都是一个文件夹**。

          现在与左栏文件树用**同一个** `FileIcon`（`ui/components/file-icon`），按文件名 / 扩展名
          选图标——单位是**文件**，看的就是「它是什么文件」。
          ⚠️ 它**认得出没有扩展名的文件**（`readme` / `makefile` / `license` 都在它那张
          `fileNames` 表里，认不出才回落到通用文件图标）⇒ 这里**不需要**「没扩展名就退回模块图标」
          那支兜底；那支反而会给 `LICENSE`、`Makefile` 这类文件重新戴上文件夹。

          ⚠️ **颜色仍按来源模块**（FR-005，用户 2026-10-13 裁定：形状换、颜色不换）。
          `FileIcon` 的 mono 变体画的是 `fill="currentColor"` 的遮罩矩形——它**不读**
          `--icon-base`（那是 `icon.css` 给 v1 `Icon` 定的规矩），所以身份色由这一层的 `color`
          直接给。⚠️ 少了这个 `color`，图标在深色/浅色主题下都退回 `currentColor` 的继承值，
          **不报错、不变红**，只是颜色不对。 */}
      <span
        data-slot="tab-icon"
        class="flex shrink-0 items-center"
        style={{ color: `var(${moduleColorVar(props.tab.module)})` }}
      >
        <FileIcon node={{ path: props.tab.path, type: "file" }} mono />
      </span>
      {/* 标题悬停提示（2026-10-13 用户实报「文件名较长时会被截断」）：**只在真的被截断时**弹
          （同日用户裁定），文案就是文件名全名、不带目录。
          ⚠️ `TooltipV2` 会插一层自己的 `<div>`（实测），那一层从此**就是标题的父级** ⇒ 它必须接下
          「可被压缩」这件事：`min-w-0`。**少了它这个功能根本不工作**——2026-10-13 真栈实测的链条：
          壳一挂上，那层 `flex`（没有 `min-w-0`）作为 flex 项**拒绝收缩**（`min-width:auto`），标题当场
          拿到全宽 ⇒ `ResizeObserver` 重量读出「内容宽 == 看得见宽」（实测 `381/381`）⇒ 判「放得下」
          ⇒ 摘壳 ⇒ 停在「没壳」那一相、**提示再也不弹**。⚠️ 症状不是「布局坏了」（tab 仍是 176px、
          标题看着还是省略号）而是「鼠标停上去什么都没发生」——所以守护者是本 spec 的 ②，
          **不是** ⑤：⑤ 那两条子断言在这次变异下**照样绿**（实测，别把它当 `min-w-0` 的守护者）。
          放得下时 `inactive` 让它**原样渲染 children、不套壳**（`tooltip-v2.tsx:87`）⇒ DOM 与从前一致。 */}
      <TooltipV2 value={props.tab.title} class="flex min-w-0" inactive={!被截断()}>
        <span data-slot="tab-title" ref={标题} class="truncate">
          {props.tab.title}
        </span>
      </TooltipV2>
      {/* 「这份文件被 AI 会话改过、中栏还停在旧版」的标记（2026-10-13 用户实报：「在中栏打开的
          文件，如果该文件通过 AI 会话进行了修改，用户要如何知道呢」）。
          同一句 `会话改过` 也决定「点它要不要重读」（见 `TabBar` 的 `activate`）——标记与动作
          **同一个判据**，不会出现「亮着却点不动」或「没亮却换了内容」。

          ⚠️ 画在标题**外面**、而不管标题截没截断：`max-w-44` 把长名字截成省略号时，这一枚仍要在
          （用户要的正是「看不见全名也知道它变了」）。`shrink-0` 保它不被压掉。 */}
      <Show when={会话改过(props.tab.path)}>
        <span
          data-slot="tab-edited-dot"
          role="img"
          aria-label="内容已在会话中更新"
          class="size-1.5 shrink-0 rounded-full bg-v2-background-bg-accent"
        />
      </Show>
      {/* 悬停提示：关闭钮只有一枚 `×`，鼠标用户看不见 `aria-label`。
          ⚠️ `TooltipV2` 会插一层自己的 `<div>`（实测），故原先挂在按钮上的 `shrink-0`
          要由这层接过去——否则宽 tab 被 `max-w-44` 截断时，先被压掉的会是这颗按钮。 */}
      <TooltipV2 value={`关闭 ${props.tab.title}`} class="flex shrink-0">
        <button
          type="button"
          data-slot="tab-close"
          aria-label={`关闭 ${props.tab.title}`}
          onClick={(event) => {
            // 关按钮长在 tab 上，不拦一下会连带把这张 tab 也激活
            event.stopPropagation()
            props.onClose()
          }}
          class="group flex size-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-v2-overlay-simple-overlay-hover"
        >
          {/* 图标颜色必须由这层 wrapper 注入 `--icon-base`：写在按钮上的 `text-v2-icon-*`
              到不了图标（`icon.css` 给图标自身写了 `color: var(--icon-base)`），不注入就静默恒灰、
              连悬停提亮一起失效——与本文件的 rail、topbar 是同一套做法。

              这里写**类**而不是内联 style：关闭按钮只有「默认 / 悬停」两档**固定**色，走类才有
              `group-hover:` 提亮的余地。左边那个文件图标反过来用内联——因为它的色是
              `moduleColorVar()` **运行时算出来**的身份色，拼不出类名。两处取舍不同是**这个区别**
              造成的（算得出来的只能内联，固定档位才轮到类），不是漏了一处。 */}
          <span
            data-slot="tab-close-icon"
            class="flex items-center [--icon-base:var(--v2-icon-icon-muted)] group-hover:[--icon-base:var(--v2-icon-icon-base)]"
          >
            <Icon name="close-small" />
          </span>
        </button>
      </TooltipV2>
    </div>
  )
}

/**
 * 中栏 tab 栏（FR-005 / DESIGN §4.5）：跨模块累积的内容视图 tab。
 *
 * 与顶栏的 session tab 条（`titlebar.tsx` 的 `TitlebarTabStrip`）是两套东西，分工见 §4.5：
 * 顶栏管 opencode 会话 tab、溢出走横向滚动；这里管「内容视图 tab」、溢出把尾部收进行末「⋯」。
 * 两者不共享状态、不互相搬运。
 *
 * 只负责「显示哪些、点了通知谁」——tab 的增删改与激活态由 `tab-store.ts` 持有，
 * T010 起挂在中栏顶部（`ThreePane` 的 center 槽）。根元素带 `w-full` 是必需的：中栏容器是
 * `flex flex-col items-start`（复刻挂载点 `<main>` 的 flex 上下文），缺了它这条栏会缩到内容宽度。
 */
export function TabBar(props: TabBarProps) {
  let strip: HTMLDivElement | undefined
  /** 溢出「⋯」那一区（触发钮 ＋ 它的菜单）——「点外面」判据里的「里面」。 */
  let 溢出区: HTMLDivElement | undefined
  /** 分屏钮那一区（触发钮 ＋ 它的菜单 ＋ 收起钮）。 */
  let 分屏区: HTMLDivElement | undefined
  const [measured, setMeasured] = createSignal(0)
  // 同一时刻最多开一个下拉：溢出「⋯」与分屏钮的菜单共用一个状态。
  const [菜单, setMenu] = createSignal<"overflow" | "split" | undefined>(undefined)

  onMount(() => {
    if (typeof ResizeObserver === "undefined" || !strip) return
    const observer = new ResizeObserver(() => setMeasured(strip?.clientWidth ?? 0))
    observer.observe(strip)
    onCleanup(() => observer.disconnect())
  })

  /**
   * 「点外面就收」（2026-10-13 用户实报：分屏菜单点列表以外任何地方都不消失）。
   *
   * 两个菜单此前**只**靠「再点一次触发钮 / 选中某一项」关（都走 `setMenu`），点别处一直是开着的
   * ——因为这里**根本没有**外部点击监听。补上：听 `document` 的 `pointerdown`（capture），
   * 照本仓浮层的既有范式（`ui/src/components/popover.tsx:99`、`components/titlebar-tab-nav.tsx:163`），
   * 落在**当前这个菜单所在那一区之外**就收。
   *
   * ⚠️ **触发钮所在的那一区算「里面」**（`#005-35`：触发器不是「外面」）。否则 pointerdown 先把
   * 菜单收掉、紧跟的 click 又 toggle 开 ⇒ 变成「再点触发钮关不掉」。本文件有两条用例钉这条边界。
   *
   * `createEffect` 读 `菜单()`：一开一关各重挂一次监听；`onCleanup` 摘掉上一轮的（`#005-27`
   * 那一族的收尾纪律——监听挂在 `document` 上，不摘就会跨用例残留）。
   */
  createEffect(() => {
    const 开着 = 菜单()
    if (!开着) return
    const 区 = 开着 === "split" ? 分屏区 : 溢出区
    const 摘 = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const 目标 = event.target
        if (!(目标 instanceof Node)) return
        if (区?.contains(目标)) return
        setMenu(undefined)
      },
      { capture: true },
    )
    onCleanup(摘)
  })

  // `measured()` 为 0 = **还没量到**（首帧，或 happy-dom 这类无 CSS 引擎的环境），不是「宽度为零」。
  // 判成 0 会把全部 tab 一股脑塞进「⋯」——凭空隐藏比暂时多显示更糟，故当作「不限宽」先全显示。
  const available = () => {
    const 总 = props.availableWidth ?? (measured() || Number.POSITIVE_INFINITY)
    // 栏尾那颗分屏钮要占宽。**只在接了它的时候扣**：不接的宿主（既有用例 / storybook）
    // 数字与今天逐字相同——那 26px 是真的被那颗钮吃掉的，不是账面上的。
    return props.onSplit === undefined ? 总 : 总 - 栏尾钮宽
  }
  const split = () => splitTabOverflow(props.tabs.length, available(), { tabWidth: TAB_WIDTH, overflowWidth: OVERFLOW_WIDTH })
  const visible = () => props.tabs.slice(0, split().visibleCount)
  const hidden = () => props.tabs.slice(split().visibleCount)

  /**
   * 激活一张 tab。**两条激活路径共用这一处**（栏里可见的 tab、以及溢出「⋯」菜单里的项）：
   * 若这张文件被会话改过、中栏还停在旧版，就趁这一次点击把它**换新**——清掉圆点（用户看见了）
   * 并请中栏重读（`触发重载` 让 `center-content.tsx` 的比较器放行 ⇒ 视图重挂重读）。
   *
   * ⚠️ 判据（「被改过没有」）只在 `看见改过` 里写一份：从左栏文件树打开一份**已经开着**的文件
   * 走的是另一条路（`open-file.ts`），那条路也喊它。没被改过的 tab 走原路
   * （`触发重载` 不动，`tab-bar.test.tsx` 有反面用例钉这条）。
   */
  const activate = (tab: ContentTab) => {
    看见改过(tab.path)
    props.onActivate(contentTabKey(tab))
    setMenu(undefined)
  }

  return (
    <div
      ref={strip}
      data-component="tab-bar"
      data-focused={props.focused ? "true" : undefined}
      style={{ height: `${TAB_HEIGHT}px` }}
      class="relative flex w-full shrink-0 items-stretch gap-0.5 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02 px-1"
    >
      <For each={visible()}>
        {(tab) => (
          <Tab
            tab={tab}
            active={contentTabKey(tab) === props.active}
            onActivate={() => activate(tab)}
            onClose={() => props.onClose(contentTabKey(tab))}
          />
        )}
      </For>
      <Show when={hidden().length > 0}>
        <div ref={溢出区} class="relative flex items-center">
          {/* 悬停提示：`⋯` 只有字形，说不出「还有几个」。
              `aria-expanded` 就挂在这颗按钮上，于是菜单一展开，`TooltipV2` 的 `sync()` 会顺带
              把提示压住——提示与下拉不同屏出现，正是想要的那条（免得两层浮层打架）。 */}
          <TooltipV2 value={`还有 ${hidden().length} 个标签页`} class="flex shrink-0">
            <button
              type="button"
              data-slot="tab-overflow"
              aria-label={`还有 ${hidden().length} 个标签页`}
              aria-expanded={菜单() === "overflow"}
              onClick={() => setMenu(菜单() === "overflow" ? undefined : "overflow")}
              class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base"
            >
              {/* 原生图标集没有 ellipsis / more 一档，用字面字形 U+22EF 顶（同 §5.3 的线性风格） */}
              ⋯
            </button>
          </TooltipV2>
          <Show when={菜单() === "overflow"}>
            <div
              data-slot="tab-overflow-menu"
              class="absolute top-full right-0 z-50 mt-1 flex min-w-40 flex-col rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1 shadow-lg"
            >
              <For each={hidden()}>
                {(tab) => (
                  <button
                    type="button"
                    data-slot="tab-overflow-item"
                    onClick={() => activate(tab)}
                    class="cursor-pointer truncate rounded px-2 py-1.5 text-left text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  >
                    {tab.title}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
      {/* 受焦指示（2026-10-12）：沿用 tab 上那条激活条的语言（同族 `tab-active-bar`），
          不新造视觉符号（设计文档 §3.3）。只读「受不受焦」这一个事实，不读鼠标。 */}
      <Show when={props.focused}>
        <span data-slot="tab-bar-focus-bar" class="absolute inset-x-0 bottom-0 h-0.5 bg-v2-background-bg-accent" />
      </Show>
      <Show when={props.onSplit !== undefined || props.onUnsplit !== undefined}>
        <div ref={分屏区} class="relative ml-auto flex items-center gap-0.5">
          <Show when={props.onSplit}>
            {/* ⚠️ **本仓定制（openhive，2026-10-13）**：上游这里是「够分屏才可点」（`够分屏` =
                `props.tabs.length >= 2`，不够时 `aria-disabled` 置灰、提示写「至少打开两个文件才能分屏」）。
                本仓取消了这道闸——因为本仓的分屏**不搬 tab**（`tab-store.ts` 的 `splitPane`
                「不动任何 tab，只把右栏露出来」）：右栏初来就是一个空栏，由用户切过去自己开文件，
                所以「先有两个 tab」这个前提不成立，有一张（甚至一张没有）也照样能先把栏劈开。
                提示语随之收成一句「分屏」。 */}
            <TooltipV2 value="分屏" class="flex shrink-0">
              <button
                type="button"
                data-slot="split-button"
                aria-label="分屏"
                onClick={() => setMenu(菜单() === "split" ? undefined : "split")}
                class="flex size-6 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base"
              >
                {/* ⚠️ **本仓定制（openhive，2026-10-13）**：上游这里用的是一段字面字形 `▫`（U+25AB）。
                    本仓换成原生 **v2** 图标集里的 `split`（外方框 ＋ 两条竖栏），照用户给的参考图
                    `images/screen/2026-10-12_170442.png`；同一族还有 `unified`（两条横栏）。
                    ⚠️ 这是 **v2** 图标（`@opencode-ai/ui/v2/icon`）——与本文件 tab 上那颗关闭钮走的
                    v1 图标集（`@opencode-ai/ui/icon`）**不是同一套 sprite**，`split` 这个名字只在 v2 里有。
                    （tab 前面那枚文件图标走的是第三套：`ui/components/file-icon` 的 sprite。） */}
                <IconV2 name="split" />
              </button>
            </TooltipV2>
          </Show>
          <Show when={菜单() === "split" && props.onSplit}>
            <div
              data-slot="split-menu"
              class="absolute top-full right-0 z-50 mt-1 flex min-w-28 flex-col rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1 shadow-lg"
            >
              <For each={["左右", "上下"] as const}>
                {(排列) => (
                  <button
                    type="button"
                    data-slot="split-menu-item"
                    data-split={排列}
                    onClick={() => {
                      setMenu(undefined)
                      props.onSplit?.(排列)
                    }}
                    class="cursor-pointer truncate rounded px-2 py-1.5 text-left text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  >
                    {排列}分屏
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={props.onUnsplit}>
            <TooltipV2 value="收起这一栏" class="flex shrink-0">
              <button
                type="button"
                data-slot="unsplit-button"
                aria-label="收起这一栏"
                onClick={() => props.onUnsplit?.()}
                class="shrink-0 cursor-pointer rounded px-2 py-1 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
              >
                收起
              </button>
            </TooltipV2>
          </Show>
        </div>
      </Show>
    </div>
  )
}
