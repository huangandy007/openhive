import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { createMemo, createSignal, Show, type JSX, type ParentProps } from "solid-js"

/** 左项目侧栏默认宽度（DESIGN.md §4.1：280px）。 */
export const LEFT_PANE_DEFAULT = 280

/** 右栏（AI 会话）默认宽度（DESIGN.md §4.1：360px）。 */
export const RIGHT_PANE_DEFAULT = 360

/** 左栏拖拽下限（DESIGN.md §4.1：160px ~ 视口 50%）。 */
const LEFT_PANE_MIN = 160

/** 右栏拖拽下限（DESIGN.md §4.1：240px ~ 视口 2/3）。 */
const RIGHT_PANE_MIN = 240

/**
 * 三栏的**分层底色**（2026-10-08 用户裁定：「左/中/右三栏底色 F2F2F2、各自容器 FFFFFF，
 * 这样三栏更好区分」）。
 *
 * 两个取值都走**既有语义 token**，不新增：
 * - 栏底 `background-bg-layer-02` 在浅色下 = `--v2-grey-200` = **#F2F2F2**（与要求逐字相同）
 * - 卡面 `background-bg-base` = **#FCFCFC**（与 #FFFFFF 差 3/255，肉眼分辨不出）
 *   字面 #FFFFFF 也能做，但代价是新增 token ⇒ `theme.css` 两处镜像 ＋ 重跑 `tailwind.ts` 与
 *   `build-oc2-v2-overrides.ts`（两个生成物整份重写）。为一个分辨不出的 3/255 换那份合并面
 *   不划算——判据与代价写在 `three-pane.test.tsx` 顶部那段，两边同源。
 *
 * ⚠️ **内缩不是装饰，是这条需求成立的前提**：三栏原是紧贴的，卡片满铺就把栏底 100% 盖住
 * ⇒ 灰一点看不见、「更好区分」等于没做。内缩与卡片是同一件事的两半，改一半等于没改。
 *
 * 纵向仍是 8px（`py-2`）——用户说的「间隔」指**栏与栏之间**的列缝，上下没提，不动。
 */
const 栏底 = "bg-v2-background-bg-layer-02 py-2"

/**
 * 栏底的**分侧**内缩（2026-10-08 用户第二次裁定）。
 *
 * 原话：「左栏、中栏、右栏之间的间隔缩小 2/3」＋ 提问后选定「外侧保持 8px」。原状四边各 8px
 * ⇒ 栏间 16px、外侧也是 8px。改后：
 * - **栏间**：2.5px ＋ 2.5px ≈ **5px**（16px 缩掉 2/3）
 * - **外侧**（左栏贴图标栏、右栏贴窗口边）：**不缩**，仍 8px
 *
 * ⇒ 四边同值的 `p-2` 表达不了，只能分侧。**方向是语义的**：`外` = 靠窗口/图标栏那一侧，
 * `内` = 靠着邻居那一侧。
 *
 * ⚠️ 四个类名必须**字面写全**（`pl-[8px]` 而不是 `` `pl-[${值}]` ``）：Tailwind 是**扫源码文本**
 * 找候选类的，拼出来的字符串它看不见 ⇒ 类不会生成、内缩静默消失（不报错、不变红）。
 */
const 外缝左 = "pl-[8px]"
const 外缝右 = "pr-[8px]"
const 内缝左 = "pl-[2.5px]"
const 内缝右 = "pr-[2.5px]"

/** 三栏共用的卡面：白底 ＋ 10px 圆角 ＋ **裁角**（不裁的话卡内组件的方角会顶穿圆角）。 */
const 卡面 = "w-full overflow-hidden rounded-[10px] bg-v2-background-bg-base"

/** 左右栏的卡片：栏底不是 flex 容器，卡片撑满它的 padding box。 */
const 侧栏卡片 = `h-full ${卡面}`

/**
 * 中栏的卡片：**原样复刻中栏的 flex 上下文**——`tab-bar` 与 `CenterContent` 的片段
 * （`center-page` 用 `display:contents`、空态用 `flex-1`）此前直接挂在中栏下，换了上下文
 * 它们的排布会静默改变。`min-h-0` 是卡内滚动容器（会话流 / 预览）能落到底的条件。
 */
const 中栏卡片 = `flex min-h-0 flex-1 flex-col items-start ${卡面}`

/**
 * 左右栏的栏底：方向**固定**——左栏左边是图标栏（外侧）、右边是邻居；右栏反过来。
 * （中栏的看情况，所以它那一条在组件里算。）
 */
const 左栏底 = `${栏底} ${外缝左} ${内缝右}`
const 右栏底 = `${栏底} ${内缝左} ${外缝右}`

/**
 * 拖拽手柄 hover 时那条 3px 竖条的颜色。
 *
 * ⚠️ 上游 `resize-handle.css` 的 `::after`（hover 时 `opacity: 0 → 1`）**没有 `background`**
 * ⇒ 不透明度拉满也是全透明，「鼠标移上去除光标外毫无变化」就是这么来的。修法**不动上游 CSS**
 * （本项目第一号约束：最小化与官方的合并面）：`ResizeHandle` 透传 `class` / `classList`
 * （`resize-handle.tsx` 的 `splitProps`），颜色从**本侧**给。
 *
 * 取 `border-strong`（中性灰）而不是品牌金：`DESIGN.md` 把品牌金限定在
 * logo / 图标 / 高亮 / 链接 / **选中态**，hover 走中性。比上游 `session-review-v2.css` 那条
 * 同型先例（`border-muted`）强一档，是因为先例铺在**白面**上、这条铺在 **#F2F2F2 灰缝**上
 * ——同一个 alpha 在更深的底上更看不见，而这条需求的目的恰恰是「让用户知道可以拖」。
 */
const 手柄悬停色 = "after:bg-v2-border-border-strong"

export interface ThreePaneProps {
  /** 左栏内容。不传则左栏（含其手柄）不渲染——挂载对既有布局零影响。 */
  left?: JSX.Element
  /** 右栏内容。不传则右栏（含其手柄）不渲染。 */
  right?: JSX.Element
  /** 左栏折叠。折叠时左栏与其手柄一起让位，中栏占满。 */
  leftCollapsed?: boolean
  /** 右栏折叠。 */
  rightCollapsed?: boolean
}

/**
 * openhive 三栏工作台骨架：左导航 / 中浏览 / 右 AI 会话。
 *
 * 只负责几何、槽位与**三栏的分层底色**——三栏各放什么由调用方通过 `left` / `right` /
 * `children` 决定。挂载点见 `pages/layout-new.tsx` 的 `<main>`。
 */
export function ThreePane(props: ParentProps<ThreePaneProps>) {
  const [leftWidth, setLeftWidth] = createSignal(LEFT_PANE_DEFAULT)
  const [rightWidth, setRightWidth] = createSignal(RIGHT_PANE_DEFAULT)
  const viewport = () => window.innerWidth
  const leftMax = () => Math.round(viewport() * 0.5)
  const rightMax = () => Math.round((viewport() * 2) / 3)

  /**
   * 「那一侧**有没有**邻居」只判一次，`<Show>` 与中栏内缩共用它——同一件事在两处各写一份判据，
   * 改一处另一处就静默分家（`LEARNINGS #002-06`）。
   *
   * ⚠️ **必须是 `createMemo`，不能是普通函数**（2026-10-08 实测，代价是一条别人文件里的红）：
   * `props.left` / `props.right` 是**每次读都可能新建一棵子树**的 getter（调用方写的是
   * `left={() => <ProjectAnchor/>}` 这种）。普通函数**每次调用都读一次 props**，而它被读的地方
   * 不只是 `<Show>`——中栏那句 `class={…中栏底()…}` 是一条**会重跑的 effect**，它每重跑一次就
   * 多读一次 props ⇒ **多造一棵孤儿左栏树**，孤儿实例写模块级接缝（`LEARNINGS #005-03` 那类竞态）。
   *
   * 实证（隔离到单变量，各跑一次）：`workspace-entry.test.tsx`（T020 上传）在我的函数版下
   * **99 pass / 1 fail**、连续 3 次稳定；把中栏那处读 props 改成**静态类名**（同样那串类、只是
   * 不读 props）⇒ **100 pass / 0 fail**；改成「读 props 但返回裸 `栏底`」⇒ 又红。即与类名字符串
   * **无关**，与「读不读 props」有关。memo 把读收敛到一次并缓存，症状消失。
   */
  const 有左栏 = createMemo(() => props.left !== undefined && !props.leftCollapsed)
  const 有右栏 = createMemo(() => props.right !== undefined && !props.rightCollapsed)

  /** 中栏两侧看邻居：有邻居 ⇒ 内缝（2.5px）；没有 ⇒ 那一侧是外层边，回到 8px。 */
  const 中栏底 = () => `${栏底} ${有左栏() ? 内缝左 : 外缝左} ${有右栏() ? 内缝右 : 外缝右}`

  return (
    // 每一栏各包一层 `relative` 的包裹，**手柄放进自己那一栏的包裹里**——这不是排版需要，
    // 是给手柄当定位祖先。`resize-handle.css` 给手柄写死了 `position: absolute`，且只用
    // **包含块的边缘**定位（`inset-inline-end: 0`；`edge="start"` 时换成 `inset-inline-start: 0`）
    // ——它自己**不按 `size` 做偏移**（`size` 只参与拖拽算数）。所以手柄落在哪条缝上完全由
    // 定位祖先决定：若把手柄直接挂到下面这具容器上，容器横跨三栏，左栏手柄就跑到容器**最右边**、
    // 右栏手柄跑到**最左边**（压住图标栏），手柄与它要拖的那条缝分家，在缝上按下去拖不动。
    // 一句话的不变量：**包裹的边界 == 那一栏的边界**，手柄才落在缝上。
    //
    // ⚠️ 这层包裹**不许加 `overflow-hidden`**（准确说：不许换成任何会裁掉溢出内容的盒子）。
    // 手柄是 `width: 8px` + `translateX(±50%)`——**有一半探在包裹外面**去压那条缝，裁了就只剩 4px
    // （`resize-handle.css:20-27`）。也**不能把 `<ResizeHandle>` 挪进 `aside`**：`aside` 自己有
    // `overflow-hidden`，同样裁一半。上游各调用点形状不一、**别照抄**：干净的例子是 `layout.tsx`
    // 那个 `w-0 overflow-visible` 的零宽层；另有把手柄放进带 `overflow:hidden` 的窗格里、再靠
    // `-top-1` 之类的负偏移把它挪出来的写法（`terminal-panel-v2.tsx`）——那是另一种补偿，
    // 照搬形状只会把手柄裁掉一半。
    // happy-dom 没有 CSS 引擎、量不出几何，故由 `three-pane.test.tsx` 里那条结构不变量钉住。
    <div data-component="three-pane" class="flex-1 min-h-0 min-w-0 w-full flex">
      <Show when={有左栏()}>
        <div data-slot="three-pane-left-group" class="relative flex shrink-0 min-h-0">
          <aside
            data-slot="three-pane-left"
            class={`shrink-0 min-h-0 overflow-hidden ${左栏底}`}
            style={{ width: `${leftWidth()}px` }}
          >
            <div data-slot="three-pane-left-card" class={侧栏卡片}>
              {props.left}
            </div>
          </aside>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={leftWidth()}
            min={LEFT_PANE_MIN}
            max={leftMax()}
            onResize={setLeftWidth}
            class={手柄悬停色}
          />
        </div>
      </Show>
      {/* 中栏原样复刻挂载点 `<main>`（layout-new.tsx）的 flex 上下文：子路由此前直接挂在
          它下面，若这里换了 `items-start` / `flex-col`，既有页面的布局会静默改变。 */}
      <div
        data-slot="three-pane-center"
        class={`flex-1 min-h-0 min-w-0 flex flex-col items-start ${中栏底()}`}
      >
        <div data-slot="three-pane-center-card" class={中栏卡片}>
          {props.children}
        </div>
      </div>
      <Show when={有右栏()}>
        <div data-slot="three-pane-right-group" class="relative flex shrink-0 min-h-0">
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={rightWidth()}
            min={RIGHT_PANE_MIN}
            max={rightMax()}
            onResize={setRightWidth}
            class={手柄悬停色}
          />
          <aside
            data-slot="three-pane-right"
            class={`shrink-0 min-h-0 overflow-hidden ${右栏底}`}
            style={{ width: `${rightWidth()}px` }}
          >
            <div data-slot="three-pane-right-card" class={侧栏卡片}>
              {props.right}
            </div>
          </aside>
        </div>
      </Show>
    </div>
  )
}
