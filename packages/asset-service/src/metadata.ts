/**
 * 资产统一元数据模型（FR-001）。
 *
 * 这个文件只是「契约」：类型、闭集、校验规则。它不碰数据库、不碰文件系统。
 * 资产表落在 `auth` schema（D0-1），文件落在 `/assets`（D0-2），两者由后续 task 接上。
 */

export const ASSET_TYPES = ["skill", "mcp", "knowledge_base"] as const
export type AssetType = (typeof ASSET_TYPES)[number]

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  skill: "Skill",
  mcp: "MCP",
  knowledge_base: "知识库",
}

/**
 * 三级空间（FR-006）。部门当前是自由文本（D0-4 的技术债），
 * 所以这里只固定三档，不引入部门 ID。
 */
export const ASSET_VISIBILITIES = ["global", "department", "personal"] as const
export type AssetVisibility = (typeof ASSET_VISIBILITIES)[number]

export const ASSET_VISIBILITY_LABELS: Record<AssetVisibility, string> = {
  global: "全局",
  department: "部门",
  personal: "个人",
}

/**
 * 7 个状态，按 D0-7 的裁定。
 *
 * 驳回不是第 8 个状态，而是 `in_review -> draft` 的转移事件（见 lifecycle.ts）。
 */
export const ASSET_STATUSES = [
  "draft",
  "in_review",
  "pending_tech",
  "published",
  "iterating",
  "offline",
  "archived",
] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  draft: "草稿",
  in_review: "审核中",
  pending_tech: "待技术发布",
  published: "已发布",
  iterating: "迭代中",
  offline: "已下线",
  archived: "已归档",
}

/**
 * 资产元数据。字段与 FR-001 的清单一一对应，另加 D0-15 的 `category`。
 *
 * 计数 / 评分 / 反馈今天没有真值来源（T011 才落表），但模型先留位置；
 * 后续写入方必须填真实值，禁止用假数据把界面撑满。
 */
export interface AssetMetadata {
  /** 稳定 ID；后续由资产服务生成，不用名称做键。 */
  id: string
  name: string
  type: AssetType
  description: string
  /** 图标标识，前端按标识映射到视觉资产。 */
  icon: string
  /** 业务分类 ID，取值见 categories.ts；单值，不等同于 tags。 */
  category: string
  tags: readonly string[]
  ownerId: string
  ownerName: string
  /** 所属部门，当前是自由文本；`department` 可见范围时必填。 */
  department: string
  visibility: AssetVisibility
  /** 从 1 开始的整数；迭代时 +1。 */
  version: number
  status: AssetStatus
  favoriteCount: number
  usageCount: number
  /** 0..5 的平均分。 */
  rating: number
  ratingCount: number
  feedbackCount: number
  /** Unix 秒。 */
  createdAt: number
  updatedAt: number
  publishedAt: number | null
  archivedAt: number | null
}

export interface MetadataIssue {
  field: string
  message: string
}

const REQUIRED_TEXT_FIELDS = [
  "id",
  "name",
  "description",
  "icon",
  "category",
  "ownerId",
  "ownerName",
] as const

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0
}

function isUnixSecondsOrNull(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value)
}

/**
 * 返回全部问题，而不是遇到第一条就抛。
 * 调用方（T003 的写入路径）可以一次把问题告诉用户，前端也能逐字段标红。
 */
export function validateAssetMetadata(input: AssetMetadata): MetadataIssue[] {
  const issues: MetadataIssue[] = []

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = input[field]
    if (typeof value !== "string" || value.trim() === "") {
      issues.push({ field, message: "不能为空" })
    }
  }

  if (!isOneOf(ASSET_TYPES, input.type)) {
    issues.push({ field: "type", message: `必须是 ${ASSET_TYPES.join(" / ")} 之一` })
  }
  if (!isOneOf(ASSET_STATUSES, input.status)) {
    issues.push({ field: "status", message: `必须是 ${ASSET_STATUSES.join(" / ")} 之一` })
  }
  if (!isOneOf(ASSET_VISIBILITIES, input.visibility)) {
    issues.push({ field: "visibility", message: `必须是 ${ASSET_VISIBILITIES.join(" / ")} 之一` })
  }

  if (input.visibility === "department" && (typeof input.department !== "string" || input.department.trim() === "")) {
    issues.push({ field: "department", message: "部门可见范围必须填写部门" })
  }

  if (!Array.isArray(input.tags)) {
    issues.push({ field: "tags", message: "必须是字符串数组" })
  } else {
    const seen = new Set<string>()
    for (const tag of input.tags) {
      if (typeof tag !== "string" || tag.trim() === "") {
        issues.push({ field: "tags", message: "标签必须是非空字符串" })
        continue
      }
      const normalized = tag.trim()
      if (seen.has(normalized)) {
        issues.push({ field: "tags", message: `标签重复：${normalized}` })
        continue
      }
      seen.add(normalized)
    }
  }

  if (!isNonNegativeInteger(input.version) || input.version < 1) {
    issues.push({ field: "version", message: "必须是从 1 开始的整数" })
  }

  for (const field of ["favoriteCount", "usageCount", "ratingCount", "feedbackCount"] as const) {
    if (!isNonNegativeInteger(input[field])) {
      issues.push({ field, message: "必须是非负整数" })
    }
  }

  if (!isFiniteNumber(input.rating) || input.rating < 0 || input.rating > 5) {
    issues.push({ field: "rating", message: "必须是 0 到 5 之间的数字" })
  }

  for (const field of ["createdAt", "updatedAt"] as const) {
    if (!isNonNegativeInteger(input[field])) {
      issues.push({ field, message: "必须是 Unix 秒（非负整数）" })
    }
  }
  if (isNonNegativeInteger(input.createdAt) && isNonNegativeInteger(input.updatedAt) && input.updatedAt < input.createdAt) {
    issues.push({ field: "updatedAt", message: "不能早于 createdAt" })
  }

  for (const field of ["publishedAt", "archivedAt"] as const) {
    if (!isUnixSecondsOrNull(input[field])) {
      issues.push({ field, message: "必须是 null 或 Unix 秒（非负整数）" })
    }
  }

  return issues
}
