import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { AssetType, AssetVisibility } from "./metadata"

/** 资产共享根的变量名；与 `OPENHIVE_WORKSPACE_ROOT` / `OPENHIVE_SHARED_ROOT` 同构。 */
export const ASSETS_ROOT_ENV = "OPENHIVE_ASSETS_ROOT"

/** 生产默认根：由部署方把共享卷挂到这里。 */
export const DEFAULT_ASSETS_ROOT = "/assets"

const ASSET_TYPE_DIRS: Record<AssetType, string> = {
  skill: "skills",
  mcp: "mcp",
  knowledge_base: "knowledge-base",
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * 校验单个路径段。资产 id / 部门 / 可见范围都会直接拼进共享卷路径，
 * 一旦放行 `..` 或分隔符就会写出根目录。
 */
export function assertSafeSegment(value: string, label = "路径段"): string {
  if (typeof value !== "string") throw new Error(`非法${label}：${String(value)}`)
  if (value === "" || value !== value.trim()) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (value === "." || value === "..") throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (value.endsWith(".")) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (/[\\/:*?"<>|\0-\x1f]/.test(value)) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (WINDOWS_RESERVED.test(value)) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  return value
}

/** 资产共享根：环境变量优先，空串按未配置处理。 */
export function assetsRoot(env: Record<string, string | undefined>): string {
  return env[ASSETS_ROOT_ENV] || DEFAULT_ASSETS_ROOT
}

/** 在资产根下拼安全路径。 */
export function assetDirectory(root: string, ...segments: string[]): string {
  return join(root, ...segments.map((segment) => assertSafeSegment(segment)))
}

/** 审核中：`/assets/pending/{assetId}`。 */
export function pendingDirectory(root: string, assetId: string): string {
  return join(root, "pending", assertSafeSegment(assetId, "资产 id"))
}

/** 已归档：`/assets/archive/{assetId}`。 */
export function archiveDirectory(root: string, assetId: string): string {
  return join(root, "archive", assertSafeSegment(assetId, "资产 id"))
}

export type PublishScope = {
  visibility: AssetVisibility
  /** 可见范围为 `department` 时必填；运行期由 `assertSafeSegment` 再校验。 */
  department?: string
}

/**
 * 已发布目录：
 * - 全局 `/assets/global/{skills,mcp,knowledge-base}/{assetId}`
 * - 部门 `/assets/dept/{department}/{skills,mcp,knowledge-base}/{assetId}`
 *
 * 个人资产留在作者沙箱，不进共享发布目录。
 */
export function publishDirectory(
  root: string,
  type: AssetType,
  scope: PublishScope,
  assetId: string,
): string {
  const typeDirectory = ASSET_TYPE_DIRS[type]
  if (typeDirectory === undefined) throw new Error(`未知资产类型：${type}`)

  const visibilityName: string = scope.visibility
  const visibility = scope.visibility
  if (visibility === "global") {
    return join(root, "global", typeDirectory, assertSafeSegment(assetId, "资产 id"))
  }
  if (visibility === "department") {
    const department = assertSafeSegment(scope.department ?? "", "部门 id")
    return join(root, "dept", department, typeDirectory, assertSafeSegment(assetId, "资产 id"))
  }
  if (visibility === "personal") {
    throw new Error("个人资产不发布：请保留在作者沙箱")
  }
  throw new Error(`未知可见范围：${visibilityName}`)
}

/** 建目录，已存在不报错（重复调用安全）。 */
export async function ensureDir(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o755 })
}
