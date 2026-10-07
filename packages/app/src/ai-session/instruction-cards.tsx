import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { splitTabOverflow } from "../center/tab-overflow"
import { GENERIC_MODULE } from "./capabilities"
import type { ProjectedCard } from "./projection"

/**
 * 指令卡的**视觉语法**（DESIGN §4.7.1 卡面 ＋ §4.7.2 分组标题与溢出）。
 *
 * 这一份被两层共用：「常用操作」（`common-cards.tsx`）与「上下文指令」（`context-cards.tsx`）。
 * DESIGN §4.7 开篇那条写得很硬——**同一张卡的语法只有一个**，两层长相**完全相同**，只靠分组标题区分；
 * 给两层两种长相就是把 FR-001 要的「机制通用」在视觉上又拆回两份。所以这里导出的是 `title` ＋ `cards`，
 * 不是两个组件。
 *
 * 本文件只管长相与次序，**不管从投影哪一支取数**（那是各层自己的事），也不管点卡之后干什么
 * （`onPick` 是 FR-007 的接缝，填入输入框是 T009）。
 */

/** 卡宽 96px（`w-24`，§4.7.1）。**必须定宽**——溢出算式要拿它当输入，见 §4.7.2「可见几张」。 */
export const CARD_WIDTH = 96

/** 行内间距 8px（`gap-2`，§4.7.1）。 */
export const CARD_GAP = 8

/** 溢出钮 24px（`size-6`，§4.7.2：与 `center/tab-bar.tsx` 同一颗）。 */
export const OVERFLOW_WIDTH = 24

/**
 * 一行能放几张卡。
 *
 * 复用 `center/tab-overflow.ts` 的 `splitTabOverflow`（§4.7.2 点名的路：**它的宽度本就是参数**
 * ⇒ 天然通用，既不改它、也不另抄一份）。
 *
 * 传进去的是**卡宽 ＋ 行内间距**：分隔符也占位置，不算进去就会多放一张、把行挤出去
 * （`center/tab-bar.tsx` 对它的 `gap-0.5` 也是这么近似处理的）。
 *
 * ⚠️ **计数必须是纯函数**：happy-dom 没有 CSS 引擎，`clientWidth` 恒为 0、`getComputedStyle`
 * 拿不到真值，任何「量出来再算能放几张」的写法在本仓的测试环境里**测不了**。这是**测试可行性**
 * 决定的形状，不是审美偏好（§4.7.2）。
 */
function 一行能放几张(条数: number, 可用宽: number) {
  return splitTabOverflow(条数, 可用宽, { tabWidth: CARD_WIDTH + CARD_GAP, overflowWidth: OVERFLOW_WIDTH })
}

/**
 * §4.7.1 的**行内排序**：跨模块那支（`GENERIC_MODULE`）的卡排在模块自己的卡**前面**。
 *
 * 「常数在前才形成肌肉记忆：第一张卡永远在同一位置」。`sort` 是稳定的 ⇒ 组内相对次序不动。
 * 拷一份再排：入参是投影的产物，就地排会污染调用方。
 */
function 通用优先(卡: readonly ProjectedCard[]) {
  return [...卡].sort((左, 右) => Number(右.module === GENERIC_MODULE) - Number(左.module === GENERIC_MODULE))
}

/**
 * 一张卡。
 *
 * 底面二选一（不是叠加）：`classList` 里默认态与选中态互斥，否则两条 `background-color` 都落在
 * 同一个元素上，谁赢由 Tailwind 生成顺序决定——**看着像「选中态坏了」，实际是两份底色在打架**。
 * hover 同理，只在默认态给：选中态悬停不该变灰（§4.7.1「选中浅金、hover 灰 overlay」）。
 */
function 一张卡(props: { 卡: ProjectedCard; 选中: boolean; onPick?: (卡: ProjectedCard) => void }): JSX.Element {
  return (
    <button
      type="button"
      data-slot="card"
      class="flex h-8 w-24 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-v2-border-border-muted px-2 shadow-[var(--v2-elevation-raised)]"
      classList={{
        // ⚠️ 浅金与阴影都只能走**任意值**写法（`bg-[…]` / `shadow-[…]`）：`--v2-background-bg-accent-soft`
        // 与 `--v2-elevation-*` 都没有 Tailwind 孪生（§4.7.0 那张表）。**把工具类前缀直接接上这两个
        // 名字**（`bg-` ＋ 前者、`shadow-` ＋ 后者）会被 `workspace/design-token-refs.test.ts` 判红。
        //
        // ⚠️ 那条纪律在这里还有一层：上面那句**故意拆开写**，不是啰嗦——那个测试扫的是**文件全文**，
        // 注释里的反例一样算「写了工具类形态」。DESIGN §4.7.0 能照原样写反例，只是因为
        // **文档不在它的扫描范围内**（只扫 `packages/app/src` 下那七个目录），别照着抄进源码。
        "bg-v2-background-bg-base": !props.选中,
        "bg-[var(--v2-background-bg-accent-soft)]": props.选中,
        "hover:bg-v2-overlay-simple-overlay-hover": !props.选中,
      }}
      onClick={() => props.onPick?.(props.卡)}
    >
      <span data-slot="card-label" class="truncate text-[13px] text-v2-text-text-base">
        {props.卡.label}
      </span>
    </button>
  )
}

export interface InstructionCardRowProps {
  /** 分组标题（「常用操作」/「上下文指令」）——**唯一**区分两层的东西（DESIGN §4.7 开篇）。 */
  title: string
  cards: ProjectedCard[]
  /**
   * 这一行的可用宽（px）。**缺省 = 还没量到**（首帧，或 happy-dom 这类无 CSS 引擎的环境），
   * 此时当作「不限宽」先全显示：判成 0 会把整行一股脑塞进「⋯」，**凭空隐藏比暂时多显示更糟**。
   */
  availableWidth?: number
  /** 输入框里当前那句话。来自哪张卡就点亮哪张（§4.7.1 选中态）。 */
  activePrompt?: string
  /** 点一张卡。**填入输入框是 T009 的活**，这里只把卡交出去（FR-007 的接缝）。 */
  onPick?: (卡: ProjectedCard) => void
}

export function InstructionCardRow(props: InstructionCardRowProps): JSX.Element {
  let 行: HTMLDivElement | undefined
  const [量到的, set量到的] = createSignal(0)

  // 宽度**来源**可以是量出来的（同 `center/tab-bar.tsx`），但**计数**在纯函数里（§4.7.2）。
  // `ResizeObserver` 在无 CSS 引擎的环境里不存在 ⇒ 跳过，`量到的` 保持 0 = 「还没量到」。
  onMount(() => {
    if (typeof ResizeObserver === "undefined" || !行) return
    const observer = new ResizeObserver(() => set量到的(行?.clientWidth ?? 0))
    observer.observe(行)
    onCleanup(() => observer.disconnect())
  })

  const 可用宽 = () => props.availableWidth ?? (量到的() || Number.POSITIVE_INFINITY)
  const 排序后 = () => 通用优先(props.cards)
  const 切分 = () => 一行能放几张(排序后().length, 可用宽())
  const 行内 = () => 排序后().slice(0, 切分().visibleCount)
  const 收进 = () => 排序后().slice(切分().visibleCount)

  return (
    <div ref={行} data-slot="card-row" class="flex w-full flex-col gap-2 bg-v2-background-bg-layer-01 px-3 py-2">
      <div data-slot="card-row-title" class="text-[11px] text-v2-text-text-muted">
        {props.title}
      </div>
      <div class="flex items-center gap-2">
        <For each={行内()}>{(卡) => <一张卡 卡={卡} 选中={卡.prompt === props.activePrompt} onPick={props.onPick} />}</For>
        <Show when={收进().length > 0}>
          {/*
           * 溢出菜单用**原生 `MenuV2`**（§4.7.2）：浮层 chrome（min-width / padding / 圆角 /
           * `box-shadow: var(--v2-elevation-floating)` / z-index）都由 `menu-v2.css` 给，
           * 不自己写一份——自己写就等于在 §4.7 之外又造一套浮层规格。
           *
           * ⚠️ 它与「更多 skill」是**两件事**：这里装的是**本行放不下的那几张卡**，
           * 「更多 skill」开的是**整个 skill 全集**，差一个数量级，界面必须分开（§4.7.2）。
           */}
          <MenuV2>
            <MenuV2.Trigger
              data-slot="card-overflow"
              aria-label={`还有 ${收进().length} 张卡片`}
              class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base"
            >
              {/* 原生图标集没有 ellipsis / more 一档，用字面字形 U+22EF 顶（§4.7.2，同 center/tab-bar.tsx） */}
              ⋯
            </MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content>
                <For each={收进()}>
                  {(卡) => (
                    <MenuV2.Item data-slot="card-overflow-item" onSelect={() => props.onPick?.(卡)}>
                      {卡.label}
                    </MenuV2.Item>
                  )}
                </For>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </Show>
      </div>
    </div>
  )
}
