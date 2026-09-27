import { describe, expect, test } from "bun:test"
import { splitTabOverflow } from "./tab-overflow"

const OPTIONS = { tabWidth: 100, overflowWidth: 40 }

describe("中栏 tab 溢出收「⋯」（FR-005 / DESIGN §4.5）", () => {
  test("没有 tab：不渲染「⋯」（隐藏数为 0）", () => {
    expect(splitTabOverflow(0, 500, OPTIONS)).toEqual({ visibleCount: 0, hiddenCount: 0 })
  })

  test("放得下：全部可见，不渲染「⋯」", () => {
    expect(splitTabOverflow(5, 500, OPTIONS)).toEqual({ visibleCount: 5, hiddenCount: 0 })
  })

  test("刚好占满：仍然全部可见（边界不算溢出）", () => {
    expect(splitTabOverflow(5, 500, OPTIONS)).toEqual({ visibleCount: 5, hiddenCount: 0 })
  })

  test("放不下：至少收走一张——不然「⋯」是个空盒子", () => {
    const { visibleCount, hiddenCount } = splitTabOverflow(4, 399, OPTIONS)

    expect(hiddenCount).toBeGreaterThan(0)
    expect(visibleCount).toBeLessThan(4)
  })

  test("「⋯」自己也要占地方：可用宽度扣掉它再算放得下几张", () => {
    // 不扣的话 floor(330/100)=3，会误判成「放得下 3 张」；
    // 扣掉 40 的「⋯」只剩 290，只放得下 2 张。
    expect(splitTabOverflow(4, 330, OPTIONS)).toEqual({ visibleCount: 2, hiddenCount: 2 })
  })

  test("可见 + 隐藏恒等于总数：不许在收走的过程中把 tab 弄丢", () => {
    for (const available of [0, 50, 120, 260, 330, 500]) {
      const { visibleCount, hiddenCount } = splitTabOverflow(4, available, OPTIONS)

      expect(visibleCount + hiddenCount).toBe(4)
    }
  })

  test("空间窄到一张都放不下：可见数为 0，不返回负数", () => {
    expect(splitTabOverflow(3, 10, OPTIONS)).toEqual({ visibleCount: 0, hiddenCount: 3 })
  })
})
