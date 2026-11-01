import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  ASSET_VISIBILITY_LABELS,
  validateAssetMetadata,
  type AssetMetadata,
} from "./metadata"

function validMetadata(): AssetMetadata {
  return {
    id: "asset_fund-analysis",
    name: "资金分析",
    type: "skill",
    description: "从银行流水中识别可疑资金链路",
    summary: "",
    precautions: "",
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
    iterationNote: "",
    iterationWorkspace: null,
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
    // 需求 3b：第四档「指定人员」。它不靠空间授权，只靠授权行（`authorization.ts`）。
    expect(ASSET_VISIBILITIES).toEqual(["global", "department", "targeted", "personal"])
    expect(ASSET_VISIBILITY_LABELS["targeted"]).toBe("指定人员")
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

  /**
   * `iterationWorkspace` 的形状校验（`metadata.ts:224-231`）。
   *
   * ⚠️ 这里只覆盖 **insert 出口**：`insertAsset` / `storeAsset` 走 `validateAssetMetadata`；
   * `updateAssetLifecycle` **不过校验**（迭代三条动作直接写这一列，这是已知的）。
   * 写入值由 `iterationWorkspaceRelative()` 唯一产生，该函数内部已逐段 `assertSafeSegment`，
   * 所以这里只钉「形状门」这一份，不另造一套路径规则。
   *
   * 删掉那条分支的后果按平台不同（`#004-03`：断言必须能失败，所以要说准）：
   * - win32：本条用例在第一条断言就红（实测 `Received: []`）；`..` 与非字符串那两条
   *   轮不到执行（同一用例前一条失败即中止），所以能直接钉住绝对路径判定的只有第一条；
   * - posix：判定没了也不影响结果——`resolve("x")` 以 `/` 开头，split 出首段为空串，
   *   由「空段」规则照样拦下 ⇒ 该用例仍绿（该判定在 posix 上行为等价于空段规则）。
   *   所以 posix 侧真正钉住的是空段规则，不是绝对路径判定。
   */
  test("iterationWorkspace 必须是沙箱根下的相对路径：绝对路径 / `..` / 类型不对都被拒", () => {
    const 问题 = (value: unknown) =>
      validateAssetMetadata({ ...validMetadata(), iterationWorkspace: value as string })
    const 字段 = (value: unknown) => 问题(value).map((issue) => issue.field)

    // 绝对路径：换落盘根那天会指向旧机器上的位置（#010-04）。
    // 用 `resolve("x")` 而不是写死 `C:/evil/x`：后者在 Linux 上不是绝对路径
    // （CI 的 unit 矩阵含 ubuntu），断言会恒红。posix 下这条由「首段为空」规则兜住，
    // 与绝对路径判定同效；win32 下才真正走盘符那条。
    expect(字段(resolve("x"))).toContain("iterationWorkspace")
    // 越界段：`..` 能把文件写到沙箱根外面。
    expect(字段("u1/../p1/x")).toContain("iterationWorkspace")

    // 类型不对（非字符串）：今天在绝对路径判定之后的 `.split` 处抛 TypeError，而不是静默放行。
    // 没有把它变成 MetadataIssue 是已知残差（该分支只做形状判断）；删掉分支后这两句不再抛。
    expect(() => 问题(42)).toThrow(TypeError)
    expect(() => 问题({} as unknown)).toThrow(TypeError)

    // 合法值与 null（没有工作副本）放行。
    expect(问题("u1/p1/.openhive/iterations/asset_1")).toEqual([])
    expect(问题(null)).toEqual([])
  })

  /**
   * 浏览器可加载性（2026-11-01 真栈白板）：前端把本文件当**运行时常量来源**
   * （`ASSET_*` / label 表 / `CONTENT_LIMITS`，见 `packages/app/src/ai-assets/*.tsx`），
   * 所以 Vite 会把整个模块打进浏览器图。一旦这里有 `node:*` 导入，Vite 换成一个
   * 「一访问就抛」的桩 ⇒ 模块加载失败 ⇒ **整页白板**（实测报错：
   * `Module "node:path" has been externalized for browser compatibility`）。
   * 本文件头也写着「不碰数据库、不碰文件系统」。
   *
   * 读源码而不是 import：`bun test` 里 `node:path` 能解析、跑得绿，只有静态检查才拦得住
   * 「服务端能跑、浏览器炸」这一类。`readFileSync` 引在测试里无妨——测试不进浏览器图。
   */
  test("本模块必须能在浏览器里加载：不许引 Node 内置模块", () => {
    const 源 = readFileSync(new URL("./metadata.ts", import.meta.url), "utf8")
    const 引入 = [...源.matchAll(/import\s+[^;]*?from\s+["'](node:[^"']+)["']/g)].map((m) => m[1])
    expect(引入).toEqual([])
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
