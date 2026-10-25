import { describe, expect, test } from "bun:test"
import { ASSET_CATEGORY_SEED, categoryById, isKnownCategory } from "./categories"

const DESIGN_EXAMPLES = ["情报研判", "案件办理", "文书写作", "审讯深挖", "督导考核"]

describe("业务分类 seed（D0-15，待业务管理员审阅）", () => {
  test("设计文档点名的五类都在 seed 里", () => {
    const names = ASSET_CATEGORY_SEED.map((category) => category.name)
    expect(names).toEqual(expect.arrayContaining(DESIGN_EXAMPLES))
  })

  test("ID 与名称唯一，排序号唯一且递增", () => {
    const ids = ASSET_CATEGORY_SEED.map((category) => category.id)
    const names = ASSET_CATEGORY_SEED.map((category) => category.name)
    const orders = ASSET_CATEGORY_SEED.map((category) => category.order)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(orders).size).toBe(orders.length)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
  })

  test("按 ID 能取到分类，未知 ID 明确为未知", () => {
    expect(categoryById("intelligence")?.name).toBe("情报研判")
    expect(categoryById("not-exist")).toBeUndefined()
    expect(isKnownCategory("intelligence")).toBe(true)
    expect(isKnownCategory("not-exist")).toBe(false)
  })
})
