/**
 * 中栏 tab 的溢出判定（FR-005「放不下的 tab 收进行末「⋯」，不用横向滚动条」）。
 *
 * 为什么做成纯函数而不是像上游 `titlebar-tab-strip.tsx` 那样量 DOM：
 * happy-dom 没有 CSS 引擎，`scrollWidth` / `clientWidth` 恒为 0，量出来的结果永远是「放得下」。
 * 把「算几张」抽成纯算术，判定逻辑就能被单测直接钉住；组件只负责把量到的宽度喂进来。
 */
export interface TabOverflowOptions {
  /** 单张 tab 的宽度（含间距）。 */
  tabWidth: number
  /** 行末「⋯」按钮自身占的宽度。 */
  overflowWidth: number
}

export interface TabOverflow {
  /** 直接渲染的 tab 张数（取前 N 张）。 */
  visibleCount: number
  /** 收进「⋯」的 tab 张数（尾部）。 */
  hiddenCount: number
}

export function splitTabOverflow(count: number, available: number, options: TabOverflowOptions): TabOverflow {
  if (count === 0) return { visibleCount: 0, hiddenCount: 0 }

  // 放得下就一张不收——「⋯」只在真的有东西被收走时才出现。
  if (count * options.tabWidth <= available) return { visibleCount: count, hiddenCount: 0 }

  // 溢出时「⋯」必须占位，故先从可用宽度里扣掉它再算能放几张。
  const room = available - options.overflowWidth
  // 上限取 count - 1：既然判定为溢出，就至少得有一张收进「⋯」，否则「⋯」是个空盒子。
  const visibleCount = Math.min(Math.max(Math.floor(room / options.tabWidth), 0), count - 1)

  return { visibleCount, hiddenCount: count - visibleCount }
}
