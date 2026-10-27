import { describe, expect, test } from "bun:test"
import { ASSET_VISIBILITIES } from "@opencode-ai/asset-service/metadata"
import { createAssetFilter } from "./filter"

/**
 * 左栏筛选条件（009 T005 / 需求 4）。
 *
 * 这里只测**状态**：空间多选、类型单值、分类单开。渲染由 `asset-nav.test.tsx` 守。
 *
 * ⚠️ 需求 4 起本文件**不再有分类行**（那份由 seed 派生的 `ASSET_CATEGORY_ROWS` 已删除）：
 * 分类的唯一来源是服务端，前端再留一份常量就是两处真相（`LEARNINGS #002-06`）。
 * 筛选状态只记住「选中了哪个 id」，名字与顺序不归它管。
 */
describe("AI 资产筛选状态", () => {
  test("默认：三个空间全选、类型 Skill、**不展开任何分类**（T017 裁定，见 `filter.ts` 头注）", () => {
    const filter = createAssetFilter()

    expect(filter.spaces()).toEqual([...ASSET_VISIBILITIES])
    expect(filter.type()).toBe("skill")
    // 默认收窄到第一类会把落在别类的已发布资产全藏起来——用户报的就是这个现场。
    expect(filter.category()).toBeUndefined()
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
    // 分类 id 由服务端来（这里只挑一个字符串当样本，不依赖任何 seed）。
    const 第二项 = "finance"

    filter.selectCategory(第二项)
    expect(filter.category()).toBe(第二项)

    filter.selectCategory(第二项)
    expect(filter.category()).toBeUndefined()
  })

  test("筛选状态不带分类行：本模块只留「选中了哪个 id」", async () => {
    const 模块 = await import("./filter")
    // 需求 4 的红线：前端不再持有分类清单。它一旦回来，「管理员改了用户看不见」就复发了。
    expect(Object.keys(模块)).toEqual(["createAssetFilter"])
  })
})
