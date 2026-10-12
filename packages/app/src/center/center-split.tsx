/**
 * 中栏的两栏（2026-10-12 / 中栏分屏）：左边/上边一栏、右边/下边一栏，各带自己的一套
 * tab 栏与内容区，中间一条可拖的隔板。
 *
 * ## 四条决定（每条都是踩过的坑换来的，别在这里重新论证）
 *
 * **① 包裹的边界 ＝ 那一栏的边界。** 每栏外面一层 `relative` 盒子，手柄放在**那一栏自己的
 * 盒子里**；盒子**不能** `overflow-hidden` —— 上游手柄是 `width:8px` ＋ `translateX(±50%)`，
 * 一半探到栏外去盖住那条缝；盒子一旦裁切，缝上就什么都没有了（`three-pane.tsx:134-148`
 * 记着这条是怎么量出来的）。
 *
 * **② 右栏第一次分屏时才挂，挂上就永不摘。** 收起时用 `display:none` 藏起来、**不摘节点**：
 * 摘了再挂会重跑那一栏的 `CenterContent` ⇒ 文件重读、PDF 回到第一页（001 T013 的教训）。
 * 而**首次挂载推迟到第一次分屏**，换来的是「从未分屏过时 DOM 与本组件引入前逐字相同」
 * ——既有测试与真栈布局零风险。（设计文档 §3.1 决定 2 说的是「`!split` 时右栏 keep mounted」；
 * 这里收窄成「挂过一次就不摘」，目的相同、既有面更小。）
 *
 * **③ 方向那两个词只在这一行翻。** 状态里叫 `排列: "左右" | "上下"`，`ResizeHandle` 认的是
 * `horizontal` / `vertical`。翻译**只出现一次**（spec §6）——多一处就多一处会各翻各的地方。
 *
 * **④ 受焦靠手势给。** 两栏各自 `onMouseDown` ⇒ `center.focusPane(p)`。这是 `activePane`
 * **唯一**的写入口（`tab-store.ts` 的 `focusPane`）：新开的文件落进受焦栏，而左栏文件树的
 * 点击**不在任何一栏里**，所以「我看着哪一栏」只能由栏内的手势说了算。
 */

import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { createEffect, createSignal, Show, type JSX } from "solid-js"
import { CenterContent } from "./center-content"
import type { LoadFileContent, SaveFileContent } from "./file-content"
import { TabBar } from "./tab-bar"
import { useCenterTabs } from "./tab-context"
import type { ViewRegistry } from "./view-registry"

/** 分屏后左/上那栏的**初始**尺寸（px）。真栈上用户第一件事就是拖到自己要的位置。 */
const 左右默认 = 480
const 上下默认 = 360
/** 两栏共同的下限：再小就看不清一行字了。 */
const 栏最小 = 200

/**
 * 上限按视口算（同 `three-pane.tsx` 的 `leftMax` / `rightMax`）——**拖到只剩一条缝**是
 * 用户做得出来的一件事，而它做出来之后没有任何办法恢复。
 * `Math.max(栏最小, …)` 兜住「视口量不到」（happy-dom 的 `innerWidth` 可能是 0）：
 * 让 `max < min` 递给 `ResizeHandle` 会得到「一拖就归零」。
 */
const 左右最大 = () => Math.max(栏最小, Math.round(window.innerWidth * 0.8))
const 上下最大 = () => Math.max(栏最小, Math.round(window.innerHeight * 0.8))

export interface CenterSplitProps {
  registry: ViewRegistry
  /** 中栏视图的取数出口（生产走 `LOAD_PROJECT_FILE`）。 */
  load?: LoadFileContent
  /** 中栏视图的存盘出口（生产走 `SAVE_PROJECT_FILE`）。**两栏都给**：两栏都能开可改的文档。 */
  save?: SaveFileContent
  /** 调用方页面此刻可不可以露（同 `CenterContent`，只有左/上那一栏承载它）。 */
  pageVisible?: boolean
  /** 「页面不露、也没有激活 tab」时的替身（只有左/上那一栏用）。 */
  empty?: JSX.Element
  /** 上游路由页面（**只在左/上那一栏**）。 */
  children?: JSX.Element
}

export function CenterSplit(props: CenterSplitProps): JSX.Element {
  const center = useCenterTabs()
  const [左右宽, set左右宽] = createSignal(左右默认)
  const [上下高, set上下高] = createSignal(上下默认)
  /** 右栏挂没挂过（一旦为真就是永真，见文件头 ②）。 */
  const [右栏挂过, set右栏挂过] = createSignal(false)
  createEffect(() => {
    if (center.split()) set右栏挂过(true)
  })

  const 是左右 = () => center.排列() === "左右"
  const 容器 = () =>
    `flex w-full min-h-0 min-w-0 flex-1 items-stretch ${是左右() ? "flex-row" : "flex-col"}`
  /**
   * 左/上那一栏。
   *
   * **分屏时**尺寸由信号给，故 `shrink-0`；**没分屏时它独占整栏**，故 `flex-1`。
   * ⚠️ 少了未分屏那一支，它会被下面那个内联尺寸钉死在 `左右默认` / `上下默认` 上——
   * 卡片右侧整块空着、正文按 480 折行（2026-10-12 用户实报「没有有效利用中栏的有效空间」；
   * 真栈实测卡片 `1217px` 而这一栏 `480px`）。一行一列的两种情形都咬得到，故两支一起写。
   */
  const 头栏 = () =>
    `relative flex min-h-0 min-w-0 flex-col items-start ${center.split() ? "shrink-0" : "flex-1"} ${是左右() ? "h-full" : "w-full"}`
  /** 右/下那一栏：吃剩下那块。 */
  const 尾栏 = () => `flex min-h-0 min-w-0 flex-1 flex-col items-start ${是左右() ? "h-full" : "w-full"}`

  return (
    <div data-slot="center-split" class={容器()}>
      <div
        data-slot="center-pane"
        data-pane="0"
        class={头栏()}
        // 未分屏时**不写内联尺寸**：写了就把这一栏钉死（见 `头栏` 的注释）。
        style={center.split() ? (是左右() ? { width: `${左右宽()}px` } : { height: `${上下高()}px` }) : undefined}
        onMouseDown={() => center.focusPane(0)}
      >
        <TabBar
          tabs={center.pane(0).tabs}
          active={center.pane(0).active}
          onActivate={(key) => center.activate(key, 0)}
          onClose={(key) => center.close(key, 0)}
          focused={center.split() && center.activePane() === 0}
          onSplit={(排列) => center.splitPane(排列)}
        />
        <CenterContent
          pane={0}
          registry={props.registry}
          load={props.load}
          save={props.save}
          pageVisible={props.pageVisible}
          empty={props.empty}
        >
          {props.children}
        </CenterContent>
        <Show when={center.split()}>
          {/* ⚠️ 方向那两个词的**唯一**翻译处（文件头 ③）。`edge="end"`：
              左右分屏时手柄在下栏的左边缘、上下分屏时在上栏的下边缘（`resize-handle.css`）。
              颜色从本侧给：上游 `::after` 没有 `background`，不传就 hover 也全透明
              （同 `three-pane.tsx` 的 `手柄悬停色`）。 */}
          <ResizeHandle
            direction={是左右() ? "horizontal" : "vertical"}
            edge="end"
            size={是左右() ? 左右宽() : 上下高()}
            min={栏最小}
            max={是左右() ? 左右最大() : 上下最大()}
            onResize={是左右() ? set左右宽 : set上下高}
            class="after:bg-v2-border-border-strong"
          />
        </Show>
      </div>
      <Show when={右栏挂过()}>
        <div
          data-slot="center-pane"
          data-pane="1"
          class={尾栏()}
          // `display:none` 而不是不渲染（文件头 ②）。
          style={{ display: center.split() ? undefined : "none" }}
          onMouseDown={() => center.focusPane(1)}
        >
          <TabBar
            tabs={center.pane(1).tabs}
            active={center.pane(1).active}
            onActivate={(key) => center.activate(key, 1)}
            onClose={(key) => center.close(key, 1)}
            focused={center.split() && center.activePane() === 1}
            onUnsplit={() => center.unsplitPane()}
          />
          {/* ⚠️ 右栏**不承载** `children`（上游路由页面）：页面是「当前这条路」的那一页，
              画两份就是同一页在屏幕上出现两遍（同 `CenterContent` 里 `pageVisible` 那条注释
              防的是同一件事）。也不给 `empty`：那一栏空着就是空着，不必两处都说同一句话。 */}
          <CenterContent pane={1} registry={props.registry} load={props.load} save={props.save} empty={undefined} />
        </div>
      </Show>
    </div>
  )
}
