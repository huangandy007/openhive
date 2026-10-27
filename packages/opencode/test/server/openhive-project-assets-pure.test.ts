import { describe, expect, test } from "bun:test"
import { 带内核清单 } from "../../src/server/openhive/project-assets"

/**
 * `带内核清单` 的判据只有一条：**「不知道」与「没有」必须长得不一样**（`#002-02`）。
 *
 * 这些用例不进 `openhive-project-assets.test.ts`——那个文件是真 PG 集成测试，
 * 纯函数不该为它付建库的代价。
 */
describe("带内核清单", () => {
  const 基 = { enabled: ["a"], enabledCount: 1, limit: 20 }

  test("内核清单缺席 ⇒ 回包里**没有** skills 这个键（不知道）", () => {
    const 回 = 带内核清单(基, undefined)
    expect(Object.prototype.hasOwnProperty.call(回, "skills")).toBe(false)
  })

  test("内核清单是空数组 ⇒ 回包有 skills: []（明确没有）", () => {
    const 回 = 带内核清单(基, [])
    expect(Object.prototype.hasOwnProperty.call(回, "skills")).toBe(true)
    expect(回.skills?.length).toBe(0)
  })

  test("内核清单有内容 ⇒ 原样带上，且不动既有字段", () => {
    const 一 = {
      name: "资金流向分析",
      location: "/w/u/p/.opencode/skill/asset_1/SKILL.md",
      assetId: "asset_1",
      assetName: "资金流向分析",
    }
    const 回 = 带内核清单(基, [一])
    expect(回.skills?.length).toBe(1)
    expect(回.skills?.[0]?.assetId).toBe("asset_1")
    expect(回.enabled).toEqual(["a"])
    expect(回.enabledCount).toBe(1)
    expect(回.limit).toBe(20)
  })
})
