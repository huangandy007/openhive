import { describe, expect, test } from "bun:test"
import { ASSET_CATEGORY_SEED } from "@opencode-ai/asset-service/categories"
import { ASSET_VISIBILITIES } from "@opencode-ai/asset-service/metadata"
import { ASSET_CATEGORY_ROWS, createAssetFilter } from "./filter"

/**
 * 左栏筛选条件（009 T005）。
 *
 * 这里只测**状态**：空间多选、类型单值、分类单开。渲染由 `asset-nav.test.tsx` 守。
 * 分类行必须与 `asset-service` 的 seed 同源——前端硬编码一份就是两处真相（`LEARNINGS #002-06`）。
 */
describe("AI 资产筛选状态", () => {
  test("默认：三个空间全选、类型 Skill、展开 order 最小的分类", () => {
    const filter = createAssetFilter()

    expect(filter.spaces()).toEqual([...ASSET_VISIBILITIES])
    expect(filter.type()).toBe("skill")
    expect(filter.category()).toBe(ASSET_CATEGORY_ROWS[0]?.id)
  })

  test("空间多选：点一下取消、再点恢复，顺序恒按 ASSET_VISIBILITIES", () => {
    const filter = createAssetFilter()

    filter.toggleSpace("department")
    expect(filter.spaces()).toEqual(["global", "personal"])
    expect(filter.spaceOn("department")).toBe(false)
    expect(filter.spaceOn("global")).toBe(true)

    filter.toggleSpace("personal")
    expect(filter.spaces()).toEqual(["global"])

    filter.toggleSpace("department")
    expect(filter.spaces()).toEqual(["global", "department"])
  })

  test("类型 Tab：切换只改类型，不动空间与分类", () => {
    const filter = createAssetFilter()
    const 分类 = filter.category()

    filter.selectType("knowledge_base")

    expect(filter.type()).toBe("knowledge_base")
    expect(filter.spaces()).toEqual([...ASSET_VISIBILITIES])
    expect(filter.category()).toBe(分类)
  })

  test("分类单开：点另一项换过去，再点同一项收起", () => {
    const filter = createAssetFilter()
    const 第二项 = ASSET_CATEGORY_ROWS[1].id

    filter.selectCategory(第二项)
    expect(filter.category()).toBe(第二项)

    filter.selectCategory(第二项)
    expect(filter.category()).toBeUndefined()
  })

  test("分类行来自 asset-service 的 seed，且按 order 升序", () => {
    const 期望 = [...ASSET_CATEGORY_SEED]
      .sort((a, b) => a.order - b.order)
      .map((分类) => ({ id: 分类.id, name: 分类.name }))

    expect(ASSET_CATEGORY_ROWS).toEqual(期望)
  })
})
