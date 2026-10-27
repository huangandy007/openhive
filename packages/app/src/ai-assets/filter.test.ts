import { describe, expect, test } from "bun:test"
import { ASSET_VISIBILITIES } from "@opencode-ai/asset-service/metadata"
import { createAssetFilter, 兜底分类ID } from "./filter"

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
  test("默认：全部空间（需求 3b 起四档）全选、类型 Skill、**不展开任何分类**（T017 裁定，见 `filter.ts` 头注）", () => {
    const filter = createAssetFilter()

    expect(filter.spaces()).toEqual([...ASSET_VISIBILITIES])
    expect(filter.type()).toBe("skill")
    // 默认收窄到第一类会把落在别类的已发布资产全藏起来——用户报的就是这个现场。
    expect(filter.category()).toBeUndefined()
  })

  test("空间多选：点一下取消、再点恢复，顺序恒按 ASSET_VISIBILITIES", () => {
    const filter = createAssetFilter()

    filter.toggleSpace("department")
    expect(filter.spaces()).toEqual(["global", "targeted", "personal"])
    expect(filter.spaceOn("department")).toBe(false)
    expect(filter.spaceOn("global")).toBe(true)

    filter.toggleSpace("personal")
    expect(filter.spaces()).toEqual(["global", "targeted"])

    filter.toggleSpace("department")
    expect(filter.spaces()).toEqual(["global", "department", "targeted"])
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

  test("「全部」：清掉已选分类，回到不筛（需求 1）", () => {
    const filter = createAssetFilter()

    filter.selectCategory("finance")
    expect(filter.category()).toBe("finance")

    filter.clearCategory()
    expect(filter.category()).toBeUndefined()

    // 已经「全部」时再点一次仍是「全部」（不是 toggle，不会反过来选中谁）。
    filter.clearCategory()
    expect(filter.category()).toBeUndefined()
  })

  test("「其他」是保留值：选中它等于选中一个字面量 id，与真实分类走同一条状态（需求 2）", () => {
    const filter = createAssetFilter()

    filter.selectCategory(兜底分类ID)
    expect(filter.category()).toBe("__other__")

    // 再点一次回到「全部」——它长在分类手风琴里，就守手风琴的规矩。
    filter.selectCategory(兜底分类ID)
    expect(filter.category()).toBeUndefined()
  })

  test("筛选状态不带分类行：本模块只留「选中了哪个 id」", async () => {
    const 模块 = await import("./filter")
    // 需求 4 的红线：前端不再持有分类清单。它一旦回来，「管理员改了用户看不见」就复发了。
    // 需求 2 的 `兜底分类ID` 不是清单：它是一个保留值（服务端库里没有这一行），
    // 与内核 `category-store.ts` 的 `OTHER_CATEGORY_ID` 逐字相同、刻意各写一份（`#003-05`）。
    expect(Object.keys(模块).sort()).toEqual(["createAssetFilter", "兜底分类ID"])
  })
})
