import { describe, expect, test } from "bun:test"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { ASSET_CATEGORY_ROWS } from "./filter"
import { 卡片行距, 卡片高, 网格列数, 筛选资产, 匹配搜索 } from "./grid-model"

/**
 * 中栏网格的纯逻辑（009 T006 / DESIGN §4.9）。
 *
 * 三件事分开测：**筛选交集**（左栏三组 ∧ 搜索）、**搜索匹配口径**（名称/描述/标签，含子串、
 * 忽略大小写）、**列数计算**（宽 → 列，DOM 量不到时也有确定答案）。
 */

function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "a1",
    name: "资金流向研判",
    type: "skill",
    description: "按账户汇总资金往来",
    icon: "hexagon",
    category: ASSET_CATEGORY_ROWS[0].id,
    tags: ["资金", "研判"],
    ownerId: "u1",
    ownerName: "张三",
    department: "经侦支队",
    visibility: "global",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1,
    updatedAt: 1,
    publishedAt: 1,
    archivedAt: null,
    ...over,
  }
}

const 查询 = (over: Partial<Parameters<typeof 筛选资产>[1]> = {}) => ({
  spaces: ["global", "department", "personal"] as const,
  type: "skill" as const,
  category: ASSET_CATEGORY_ROWS[0].id,
  search: "",
  ...over,
})

const 名 = (列表: readonly AssetMetadata[]) => 列表.map((a) => a.name)

describe("筛选资产", () => {
  test("默认查询：空间全选 ∧ 类型 Skill ∧ 当前分类", () => {
    const 列表 = [
      资产({ id: "a", name: "命中" }),
      资产({ id: "b", name: "类型不符", type: "mcp" }),
      资产({ id: "c", name: "分类不符", category: ASSET_CATEGORY_ROWS[1].id }),
      资产({ id: "d", name: "空间不在", visibility: "personal" }),
    ]
    expect(名(筛选资产(列表, 查询({ spaces: ["global", "department"] })))).toEqual(["命中"])
  })

  test("分类未展开（undefined）⇒ 不按分类过滤，只按类型与空间", () => {
    const 列表 = [
      资产({ id: "a", name: "甲", category: ASSET_CATEGORY_ROWS[0].id }),
      资产({ id: "b", name: "乙", category: ASSET_CATEGORY_ROWS[1].id }),
      资产({ id: "c", name: "丙", type: "mcp" }),
    ]
    expect(名(筛选资产(列表, 查询({ category: undefined })))).toEqual(["甲", "乙"])
  })

  test("空间全不选 ⇒ 一条都不返回（不是退回全选）", () => {
    expect(筛选资产([资产()], 查询({ spaces: [] }))).toEqual([])
  })

  test("搜索与左栏筛选是交集，且保持输入顺序", () => {
    const 列表 = [
      资产({ id: "a", name: "甲-资金" }),
      资产({ id: "b", name: "乙-资金", type: "mcp" }),
      // 描述与标签也要换掉：默认值里都含「资金」，不换的话这条会因描述/标签命中而掩盖搜索口径
      资产({ id: "c", name: "丙-话单", description: "按通话记录汇总", tags: ["话单"] }),
    ]
    expect(名(筛选资产(列表, 查询({ search: "资金" })))).toEqual(["甲-资金"])
  })
})

describe("匹配搜索", () => {
  test("名称 / 描述 / 标签都能命中，且忽略大小写与首尾空格", () => {
    const 项 = 资产({ name: "FundFlow", description: "账户汇总", tags: ["XLSX"] })

    expect(匹配搜索(项, "fund")).toBe(true)
    expect(匹配搜索(项, "账户")).toBe(true)
    expect(匹配搜索(项, "xlsx")).toBe(true)
    expect(匹配搜索(项, "  汇总  ")).toBe(true)
    expect(匹配搜索(项, "不存在")).toBe(false)
  })

  test("空搜索（含纯空白）⇒ 全部通过", () => {
    expect(匹配搜索(资产(), "")).toBe(true)
    expect(匹配搜索(资产(), "   ")).toBe(true)
  })
})

describe("网格列数", () => {
  test("按 240px 最小卡宽 + 12px 列距算，至少 1 列", () => {
    expect(网格列数(0)).toBe(1)
    expect(网格列数(251)).toBe(1)
    expect(网格列数(252)).toBe(1)
    expect(网格列数(504)).toBe(2)
    expect(网格列数(756)).toBe(3)
    expect(网格列数(1024)).toBe(4)
  })

  test("行高常量：卡片 132px + 行距 12px（虚拟滚动按它算）", () => {
    expect(卡片高).toBe(132)
    expect(卡片行距).toBe(12)
  })
})
