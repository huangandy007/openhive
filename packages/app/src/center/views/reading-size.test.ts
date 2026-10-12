import { beforeEach, describe, expect, test } from "bun:test"
import {
  档位,
  步进,
  默认字号,
  最大字号,
  最小字号,
  收档,
  设阅读字号,
  阅读字号,
} from "./reading-size"

/**
 * 中栏文档的正文档位（2026-10-12 ③）。
 *
 * `设阅读字号` 会同时改**模块级信号**与盘上那份 ⇒ 每条用例前一律还原到默认档：
 * 这一份状态跨用例活着，不还原的话下一条一进来就站在别的档位上（`LEARNINGS #005-03` 那族的静默污染）。
 */
beforeEach(() => 设阅读字号(默认字号))

describe("档位表", () => {
  test("五档、有序、默认档在表里", () => {
    expect([...档位]).toEqual([14, 16, 18, 20, 22])
    expect(最小字号).toBe(14)
    expect(最大字号).toBe(22)
    expect([...档位]).toContain(默认字号)
  })
})

describe("步进：一次一档，到端点停下", () => {
  test("从默认档往上：16 → 18 → 20 → 22", () => {
    const 一 = 步进(默认字号, 1)
    const 二 = 步进(一, 1)
    const 三 = 步进(二, 1)

    expect([一, 二, 三]).toEqual([18, 20, 22])
  })

  test("从默认档往下：16 → 14", () => {
    expect(步进(默认字号, -1)).toBe(14)
  })

  /**
   * 端点上**不动**。这条守卫写在这里（不在按钮上）是有意的：按钮换成快捷键、或者哪天被人拆掉，
   * 「到端点就停」这件事依然为真（`LEARNINGS #006-16`：守卫要能被走到，也要不靠那个钮才成立）。
   */
  test("已在最小档再往下 ⇒ 还是最小档", () => {
    expect(步进(最小字号, -1)).toBe(最小字号)
  })

  test("已在最大档再往上 ⇒ 还是最大档", () => {
    expect(步进(最大字号, 1)).toBe(最大字号)
  })

  test("给一个不是档位的数 ⇒ 先收回默认档再走（不会踩到空档）", () => {
    // 17 不是档位 ⇒ 收档成 16 ⇒ 往上走到 18（而不是「17 + 2」这种表外值）。
    expect(步进(17, 1)).toBe(18)
    expect(步进(Number.NaN, -1)).toBe(14)
  })
})

describe("收档：盘上的怪值不许铺到正文上", () => {
  test("档位里的值原样收下", () => {
    for (const 档 of 档位) expect(收档(档)).toBe(档)
  })

  test("不是档位的（含空键读出来的 0、手改的 17、字符串、NaN）一律掉回默认", () => {
    // `localStorage.getItem` 读不到时回 `null`，`Number(null)` 是 **0**（不是 NaN）——就是个非档位值。
    for (const 怪 of [0, 17, 999, -1, 14.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "18", {}]) {
      expect(收档(怪)).toBe(默认字号)
    }
  })
})

describe("设档：越界先收档，且落盘", () => {
  test("设一个表外的值 ⇒ 生效的是默认档", () => {
    设阅读字号(999)
    expect(阅读字号()).toBe(默认字号)
  })

  test("改档之后盘上那份也跟着变（下次开界面靠它）", () => {
    // ⚠️ 这一条是**白箱**（读了自家的键名）：键名是「换语义就换号」的那条契约的落点，
    // 改它必须是有意的。真正的「刷新还在」由真栈钉（`e2e/real-stack/richtext-reading-size-real.spec.ts`），
    // 这里只在快套里看一眼「写没写下去」。
    设阅读字号(18)
    expect(阅读字号()).toBe(18)
    expect(localStorage.getItem("openhive.reading-size.v1")).toBe("18")
  })
})
