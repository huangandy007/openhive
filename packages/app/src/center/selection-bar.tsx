import { createSignal, onMount, onCleanup, Show, type JSX } from "solid-js"
import { 复制文本 } from "@/utils/copy-text"
import { showToast } from "@/utils/toast"
import { 发到会话 } from "./ask-ai"
import { 多行选区文本, type 选区读数 } from "./structured-selection"

/**
 * 中栏「拖选一段 ⇒ 右下角浮出『问 AI / 复制』」（2026-11-08 用户提出）。
 *
 * ## 为什么是浮条，而不是只靠右键
 *
 * 右键是**藏起来的**动作：不告诉用户就没人知道。拖选几乎是每个人都会做的第一个动作，
 * 松手时在旁边递上两颗按钮，等于把那句话教了一遍（用户原话：「不用记右键」）。
 *
 * ## 出现在哪儿、什么时候
 *
 * - 位置：中栏**右下角**，固定不动。不跟着选区跑——跟随要算几何、会被滚动 / 分屏 / 换行搅乱
 *   （`#005-32` 那一类坑），而浮条只需要「一眼看见」。
 * - 出现：**鼠标松开**那一刻，且选区非空、且起点落在中栏里（在左栏选会话名不该弹出中栏的条）。
 * - 消失：选区被清掉（`selectionchange`），或点了其中一颗按钮。
 *
 * ⚠️ `selectionchange` 只用来**收条**，不用来出条：拖选过程中每次变化都弹一下，
 * 条会在手指底下闪，还可能接住下一次按下。出条只认 `mouseup`。
 *
 * ## 按下去不抢焦点
 *
 * 两颗按钮都 `onMouseDown` 里 `preventDefault()`：按下会先把选区清掉，`click` 还没到、
 * 载荷就没了——「点一下按钮，什么都没发生」正是这么来的。
 *
 * ## 载荷与右键同一条规则
 *
 * 跨 ≥2 条 `data-copy` 行 ⇒ 每行一条；否则就是浏览器给的选区原文（`多行选区文本` 的规则 1）。
 */

/** 当前选区：读数（判碰撞）＋ 原文 ＋ 起点节点（判是不是中栏里的字）。 */
export interface 选区替身 {
  readonly 读数: 选区读数
  readonly 文本: string
  readonly 锚点: Node | null
}

function 默认选区(): 选区替身 | null {
  const 选 = window.getSelection()
  if (选 === null) return null
  return { 读数: 选, 文本: 选.toString(), 锚点: 选.anchorNode }
}

export interface 浮动选区条Props {
  /** 中栏的根：载荷按它里面的行算，锚点也按它判内外。 */
  readonly 根: () => HTMLElement | undefined
  /** **测试注入替身**（happy-dom 的 Selection 与真浏览器不同），生产用默认那个。 */
  readonly 取选区?: () => 选区替身 | null
}

export function 浮动选区条(props: 浮动选区条Props): JSX.Element {
  const [载荷, set载荷] = createSignal<string | undefined>(undefined)
  const 取 = () => (props.取选区 ?? 默认选区)()

  const 在栏内 = (替身: 选区替身) => {
    const 根 = props.根()
    return 根 !== undefined && 替身.锚点 !== null && 根.contains(替身.锚点)
  }

  /** 松手：够条件就出条，载荷与右键同源。 */
  const 松手 = () => {
    const 替身 = 取()
    if (替身 === null || 替身.读数.isCollapsed || 替身.文本.trim() === "" || !在栏内(替身)) {
      set载荷(undefined)
      return
    }
    const 根 = props.根()
    if (根 === undefined) return
    set载荷(多行选区文本(根, 替身.读数) ?? 替身.文本.trim())
  }

  /** 选区变化只收条（见文件头：不用它出条）。 */
  const 选区变了 = () => {
    const 替身 = 取()
    if (替身 === null || 替身.读数.isCollapsed || 替身.文本.trim() === "") set载荷(undefined)
  }

  onMount(() => {
    window.addEventListener("mouseup", 松手)
    document.addEventListener("selectionchange", 选区变了)
    onCleanup(() => {
      window.removeEventListener("mouseup", 松手)
      document.removeEventListener("selectionchange", 选区变了)
    })
  })

  const 收起 = () => set载荷(undefined)

  const 复制 = () => {
    const 文本 = 载荷()
    if (文本 === undefined) return
    收起()
    void 复制文本(文本).then((成) => {
      if (!成) showToast("复制没成功")
    })
  }

  const 问AI = () => {
    const 文本 = 载荷()
    if (文本 === undefined) return
    收起()
    发到会话(文本)
  }

  return (
    <Show when={载荷()}>
      {(文本) => (
        <div
          data-slot="selection-bar"
          class="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-0.5 shadow-md"
        >
          <button
            type="button"
            data-slot="selection-bar-ask"
            aria-label={`问 AI：把选中的 ${文本().split("\n").length} 行发进右栏`}
            onMouseDown={(事件) => 事件.preventDefault()}
            onClick={问AI}
            class="h-7 cursor-pointer rounded-[6px] bg-[var(--v2-background-bg-accent-soft)] px-2.5 text-[12px] font-semibold text-v2-text-text-base"
          >
            问 AI
          </button>
          <button
            type="button"
            data-slot="selection-bar-copy"
            onMouseDown={(事件) => 事件.preventDefault()}
            onClick={复制}
            class="h-7 cursor-pointer rounded-[6px] px-2.5 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
          >
            复制
          </button>
        </div>
      )}
    </Show>
  )
}
