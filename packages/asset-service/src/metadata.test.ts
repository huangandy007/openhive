import { describe, expect, test } from "bun:test"
import {
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  validateAssetMetadata,
  type AssetMetadata,
} from "./metadata"

function validMetadata(): AssetMetadata {
  return {
    id: "asset_fund-analysis",
    name: "资金分析",
    type: "skill",
    description: "从银行流水中识别可疑资金链路",
    icon: "analysis",
    category: "intelligence",
    tags: ["资金", "研判"],
    ownerId: "user_001",
    ownerName: "张三",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "draft",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_760_000_000,
    updatedAt: 1_760_000_000,
    publishedAt: null,
    archivedAt: null,
  }
}

describe("资产统一元数据（FR-001）", () => {
  test("7 个状态恰好是 D0-7 裁定的那一组，驳回不是状态", () => {
    expect(ASSET_STATUSES).toEqual([
      "draft",
      "in_review",
      "pending_tech",
      "published",
      "iterating",
      "offline",
      "archived",
    ])
    expect(ASSET_STATUSES).not.toContain("rejected")
  })

  test("状态、类型、可见范围都有中文标签", () => {
    expect(ASSET_STATUSES.map((status) => ASSET_STATUS_LABELS[status])).toEqual([
      "草稿",
      "审核中",
      "待技术发布",
      "已发布",
      "迭代中",
      "已下线",
      "已归档",
    ])
    expect(ASSET_TYPES).toEqual(["skill", "mcp", "knowledge_base"])
    expect(ASSET_VISIBILITIES).toEqual(["global", "department", "personal"])
  })

  test("一份合法元数据没有校验问题", () => {
    expect(validateAssetMetadata(validMetadata())).toEqual([])
  })

  test("未知类型、未知状态、未知可见范围都会被拒", () => {
    const issues = validateAssetMetadata({
      ...validMetadata(),
      type: "unknown" as AssetMetadata["type"],
      status: "rejected" as AssetMetadata["status"],
      visibility: "public" as AssetMetadata["visibility"],
    })

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["type", "status", "visibility"]),
    )
  })

  test("必填文本字段不能为空，部门可见范围必须有部门", () => {
    const issues = validateAssetMetadata({
      ...validMetadata(),
      name: "  ",
      description: "",
      category: "",
      ownerId: "",
      ownerName: " ",
      department: "",
      visibility: "department",
    })

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["name", "description", "category", "ownerId", "ownerName", "department"]),
    )
  })

  test("标签必须是非空、去重后的字符串", () => {
    const issues = validateAssetMetadata({
      ...validMetadata(),
      tags: ["资金", " 资金 ", "", 1 as unknown as string],
    })

    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["tags"]))
    expect(issues.filter((issue) => issue.field === "tags").length).toBeGreaterThanOrEqual(3)
  })

  test("版本号、计数与评分是有限且合法的数字", () => {
    const issues = validateAssetMetadata({
      ...validMetadata(),
      version: 0,
      favoriteCount: -1,
      usageCount: 1.5,
      rating: 5.1,
      ratingCount: -1,
      feedbackCount: 0.5,
      createdAt: 20,
      updatedAt: 10,
    })

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        "version",
        "favoriteCount",
        "usageCount",
        "rating",
        "ratingCount",
        "feedbackCount",
        "updatedAt",
      ]),
    )
  })

  test("已归档时间只能是 null 或 Unix 秒", () => {
    const issues = validateAssetMetadata({
      ...validMetadata(),
      publishedAt: -1,
      archivedAt: 1.5,
    })

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["publishedAt", "archivedAt"]),
    )
  })
})
