/**
 * `.hgraph` 演示态（012 · T011；设计 08 §5.17 / contracts/ui.md §4）。
 *
 * ## 两句口径
 *
 * - **按 `出现序` 步进**：`演示步进(文档, 步号)` 是纯函数，只回答「这一步哪些节点/边可见」。
 *   未写 `出现序` = 第 0 步（与 `0` 同义，FR-040 / data-model §3）；负数视为非法 ⇒ 永不可见，
 *   **不抛错**（文件是读放宽的，演示态不能因为一条脏数据整块崩）。
 * - **边要两端都在**：边自身 `出现序 ≤ 步号` **且** 两个端点都可见才揭示——端点没出现就把边
 *   显示出来等于剧透，这不是筛选（FR-047 的隐藏计数归 T017）。
 * - `文字` **不参与**（R35）：设计只对节点/边按 `出现序` 揭示；`演示步进` 的返回值也只有
 *   两个集合 ⇒ 文字块在演示态照常显示（标题/说明本来就是给人看的）。
 *
 * ## 覆盖层只做键盘 + 步号显示
 *
 * 渲染复用**同一个** `画布` 实例（`只读` + `可见`，R37）：编辑器进入演示时把画布切成只读并
 * 过滤渲染，本组件只是在它上面盖一层 `absolute inset-0` 的键盘容器。**刻意不在这里再挂一个
 * 画布**——那会让编辑态的视口（缩放/平移）随卸载丢失，而 FR-040 要求退出后视口保持进入前
 * 的样子。快捷键只挂本容器（`tabindex="0"`，进入即 `focus()`），**不挂 `window`**。
 */
import { onCleanup, onMount, type JSX } from "solid-js"
import type { 图文件 } from "./file"

export interface 演示可见 {
  readonly 可见节点: ReadonlySet<string>
  readonly 可见边: ReadonlySet<string>
}

/**
 * `出现序` 的规范化：`undefined` / `null` ⇒ 0；非有限数 / 负数 ⇒ `undefined`（不可见）。
 * 小数按非法处理：步号是自然数，`1.5` 落在 1 与 2 之间没有定义（输入侧也在拦）。
 *
 * M5：解析器是读放宽的，`"出现序": null` 会原样留在文档里；它与「删键」同义（后端
 * `null` = 删键），所以必须按缺省 0 处理，而不是当成非法值永不出现。
 */
function 归一序(值: number | null | undefined): number | undefined {
  if (值 === undefined || 值 === null) return 0
  if (typeof 值 !== "number" || !Number.isFinite(值) || 值 < 0) return undefined
  return 值
}

/**
 * 纯函数：`步号` 及之前应当揭示的节点/边。
 *
 * 同序按 `id` 升序**只影响揭示节奏**（同一 id 排序后再切分），集合语义与数组顺序无关——
 * 所以输入数组怎么排，输出的集合都一样。
 */
export function 演示步进(文档: 图文件, 步号: number): 演示可见 {
  const 可见节点 = new Set<string>()
  for (const 点 of [...文档.节点].sort((甲, 乙) => (甲.id < 乙.id ? -1 : 甲.id > 乙.id ? 1 : 0))) {
    const 序 = 归一序(点.出现序)
    if (序 !== undefined && 序 <= 步号) 可见节点.add(点.id)
  }

  const 可见边 = new Set<string>()
  for (const 行 of [...文档.边].sort((甲, 乙) => (甲.id < 乙.id ? -1 : 甲.id > 乙.id ? 1 : 0))) {
    const 序 = 归一序(行.出现序)
    if (序 === undefined || 序 > 步号) continue
    // 端点未出现 ⇒ 边不可见（演示的本意，不是筛选）。
    if (!可见节点.has(行.从) || !可见节点.has(行.到)) continue
    可见边.add(行.id)
  }

  return { 可见节点, 可见边 }
}

export interface 演示覆盖层Props {
  readonly 步号: number
  readonly 设置步号: (步号: number) => void
  readonly 关闭: () => void
}

type 可全屏元素 = { requestFullscreen?: () => Promise<unknown> }
type 可全屏文档 = { fullscreenElement?: unknown; exitFullscreen?: () => Promise<unknown> }

/**
 * R40：进入演示请求全屏。元素上没有该方法（happy-dom / 老浏览器）就静默跳过；
 * 返回的 Promise（用户拒绝、权限策略拒绝）一律吞掉——演示本身不依赖真全屏。
 * 同步抛错也按「不支持」处理（部分实现要求用户手势）。
 */
function 请求全屏(元素: HTMLElement | undefined): void {
  if (元素 === undefined) return
  const 方法 = (元素 as unknown as 可全屏元素).requestFullscreen
  if (typeof 方法 !== "function") return
  try {
    void Promise.resolve(方法.call(元素)).catch(() => {})
  } catch {
    // 不支持 / 策略拒绝：演示照常可用。
  }
}

/** R40：退出演示时只退出「我们自己进入的」全屏；不在全屏就没有可退的。 */
function 退出全屏(): void {
  const 宿主 = document as unknown as 可全屏文档
  if (宿主.fullscreenElement === undefined || 宿主.fullscreenElement === null) return
  const 方法 = 宿主.exitFullscreen
  if (typeof 方法 !== "function") return
  try {
    void Promise.resolve(方法.call(宿主)).catch(() => {})
  } catch {
    // 退出全屏失败不回滚演示态。
  }
}

/**
 * 演示覆盖层：盖在画布上的键盘容器 + 步号提示。
 *
 * `空格` 下一步 / `Backspace` 上一步（到 0 为止，0 是合法起始态）/ `Esc` 退出。
 * 焦点在输入框时整段提前返回（沿用 `canvas.tsx` 的 `tagName` 判定：`foreignObject` 里的
 * input 是 SVG 命名空间节点，不能用 `instanceof HTMLElement`）。
 */
export function 演示覆盖层(props: 演示覆盖层Props): JSX.Element {
  let 容器: HTMLDivElement | undefined
  onMount(() => {
    容器?.focus()
    请求全屏(容器)
  })
  onCleanup(退出全屏)

  const 按键 = (事件: KeyboardEvent) => {
    const 目标 = 事件.target
    if (目标 !== null && "tagName" in 目标) {
      const 名 = String(目标.tagName).toUpperCase()
      const 可编辑 = "isContentEditable" in 目标 && 目标.isContentEditable === true
      if (名 === "INPUT" || 名 === "TEXTAREA" || 名 === "SELECT" || 可编辑) return
    }
    if (事件.key === " " || 事件.key === "Spacebar") {
      事件.preventDefault()
      props.设置步号(props.步号 + 1)
      return
    }
    if (事件.key === "Backspace") {
      事件.preventDefault()
      // 步号是自然数：0 是起始态，不往负数走。
      props.设置步号(Math.max(0, props.步号 - 1))
      return
    }
    if (事件.key === "Escape") {
      事件.preventDefault()
      props.关闭()
    }
  }

  // R41：覆盖层不吃指针/滚轮（`pointer-events-none`），事件落回下面的只读画布
  //（滚轮缩放仍可用、点选无效）。
  return (
    <div
      ref={(元素) => (容器 = 元素)}
      data-slot="hgraph-present"
      role="dialog"
      aria-label="演示"
      tabindex="0"
      class="pointer-events-none absolute inset-0 z-30 flex flex-col outline-none"
      onKeyDown={按键}
    >
      <p
        data-slot="hgraph-present-step"
        class="pointer-events-none absolute left-3 top-3 rounded border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 py-0.5 text-12-regular text-v2-text-text-base"
      >
        第 {props.步号} 步
      </p>
      <p class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-12-regular text-v2-text-text-muted">
        空格 下一步 · Backspace 上一步 · Esc 退出
      </p>
    </div>
  )
}
