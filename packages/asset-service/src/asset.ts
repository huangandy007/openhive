import { sql, type SQL } from "drizzle-orm"
import { integer, numeric, pgSchema, text } from "drizzle-orm/pg-core"
import { rowsOf } from "@opencode-ai/auth/migrate"
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  validateAssetMetadata,
  type AssetMetadata,
  type AssetStatus,
  type AssetType,
  type AssetVisibility,
  type MetadataIssue,
} from "./metadata"

/**
 * 资产统一元数据仓储（009 T003，FR-001）。
 *
 * 表的真相来源是 `packages/auth/src/migrations/0009_asset.sql`；本文件只负责类型安全查询。
 * 改结构时两侧都要动——只改一侧会被 `asset.test.ts` 的防漂移断言拦下（同 `auth/user.ts` 的做法）。
 *
 * ## 为什么在 `asset-service` 而不是 `auth`
 *
 * D0-1 裁定：资产域代码独立成包，`auth` 只提供迁移运行器与真库夹具。资产表暂时借
 * `auth` schema（技术债，F10 再评估），但「借住」不等于「归它管」——把仓储写进 `auth`
 * 会让 `auth` 的语义从「身份与权限」扩成「什么都管」。
 *
 * ## 为什么不收 drizzle 的 `PgDatabase`
 *
 * 同 `auth/project-member.ts` 的取向：收窄成「能跑 SQL 的东西」，PGlite 与生产 bun-sql
 * 都满足，测试不必给驱动搭替身。两种驱动的结果形状不同（`{rows}` vs 裸数组），
 * 统一由 `auth/migrate.ts` 的 `rowsOf` 收掉。
 *
 * ## 读出来的值要自己映射
 *
 * `db.execute(sql\`...\`)` 走的是原始 SQL，**drizzle 的列映射不会生效**：`numeric` 在
 * PG 文本协议里是字符串（`"4.50"`），timestamp 也是字符串。所以下面每个字段都显式
 * `String()` / `Number()`，而不是把行直接当 `AssetMetadata` 用。这一点与
 * `project-member.ts` 的 `asBool` 是同一类处置。
 */

const assetSchema = pgSchema("auth")

/**
 * 资产表模型。列名逐个显式写出，不依赖 casing 推断——迁移里的列名是硬事实。
 *
 * `numeric(... mode: "number")` 只影响**drizzle 查询构建器**的映射；本文件全部走原始 SQL，
 * 读出来的 `rating` 仍是字符串，由 `toMetadata` 转。
 */
export const asset = assetSchema.table("asset", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().notNull(),
  ownerId: text("owner_id").notNull(),
  ownerName: text("owner_name").notNull(),
  department: text("department").notNull(),
  visibility: text("visibility").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  favoriteCount: integer("favorite_count").notNull(),
  usageCount: integer("usage_count").notNull(),
  rating: numeric("rating", { precision: 3, scale: 2, mode: "number" }).notNull(),
  ratingCount: integer("rating_count").notNull(),
  feedbackCount: integer("feedback_count").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  publishedAt: integer("published_at"),
  archivedAt: integer("archived_at"),
})

export type AssetRow = typeof asset.$inferSelect

/** 能跑 SQL 的句柄（形状同 `auth/rbac.ts` 的 `GrantTarget` / `migrate.ts` 的 `MigrationTarget`）。 */
export interface AssetTarget {
  execute(query: SQL): PromiseLike<unknown>
}

/**
 * 元数据不合法时抛出的错误。
 *
 * **一次列全所有问题**（不是遇到第一条就抛）：前端要逐字段标红，调用方也该一次看到全部。
 * 错误在**碰库之前**产生——否则「不合法」会以数据库约束报错的形式出现，前端拿不到字段名。
 */
export class AssetMetadataError extends Error {
  constructor(readonly issues: MetadataIssue[]) {
    super(`资产元数据不合法：${issues.map((issue) => `${issue.field} ${issue.message}`).join("；")}`)
    this.name = "AssetMetadataError"
  }
}

/** 校验元数据；不合法时抛 `AssetMetadataError`。供写入路径在产生副作用之前调用。 */
export function assertValidAssetMetadata(input: AssetMetadata): void {
  const issues = validateAssetMetadata(input)
  if (issues.length > 0) throw new AssetMetadataError(issues)
}

/**
 * 从行里取一个闭集字段。**不认识的取值直接抛错**，不用 `as` 断言蒙过去。
 *
 * 库里有 CHECK 挡着，但「CHECK 存在」与「读到的值一定合法」是两件事：迁移漏跑、
 * 别的写入方、手工改库都会造出闭集外的值。断言会把它静默带进 `AssetMetadata`，
 * 一路流到前端才炸（或更糟：被当成合法状态处理）。
 */
function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.some((candidate) => candidate === value)
}

function closedValue<T extends string>(
  values: readonly T[],
  value: unknown,
  field: string,
): T {
  if (!isOneOf(values, value)) {
    throw new Error(`auth.asset.${field} 出现未知取值：${String(value)}`)
  }
  return value
}

/**
 * 把 PG 行映射回 `AssetMetadata`。
 *
 * `tags` 只接受**驱动已解析成数组**的形状：两种驱动今天都解析 `text[]`，遇到字符串（PG
 * 数组字面量）说明驱动行为变了——此时**抛错**而不是猜着切分，否则含逗号的标签会被静默截断。
 */
function toMetadata(row: Record<string, unknown>): AssetMetadata {
  if (!Array.isArray(row.tags)) {
    throw new Error(`无法解析 auth.asset.tags：期望数组，实得 ${typeof row.tags}`)
  }
  return {
    id: String(row.id),
    name: String(row.name),
    type: closedValue(ASSET_TYPES, row.type, "type"),
    description: String(row.description),
    icon: String(row.icon),
    category: String(row.category),
    tags: row.tags.map(String),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name),
    department: String(row.department),
    visibility: closedValue(ASSET_VISIBILITIES, row.visibility, "visibility"),
    version: Number(row.version),
    status: closedValue(ASSET_STATUSES, row.status, "status"),
    favoriteCount: Number(row.favorite_count),
    usageCount: Number(row.usage_count),
    rating: Number(row.rating),
    ratingCount: Number(row.rating_count),
    feedbackCount: Number(row.feedback_count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    publishedAt: row.published_at === null ? null : Number(row.published_at),
    archivedAt: row.archived_at === null ? null : Number(row.archived_at),
  }
}

const COLUMNS = sql`
  id, name, type, description, icon, category, tags, owner_id, owner_name, department,
  visibility, version, status, favorite_count, usage_count, rating, rating_count,
  feedback_count, created_at, updated_at, published_at, archived_at
`

/**
 * 写入一条资产元数据。
 *
 * ⚠️ **不吞错**：主键冲突（同一 id 写两次）与所有者外键失败都必须抛出去。这两条是
 * 数据层的事实，在 `asset.test.ts` 里打真库验过；catch 掉就等于把验证变成装饰。
 *
 * 不写 `on conflict`：资产 id 是创建时生成的稳定 ID，同一个 id 不该有第二次「创建」。
 * 撞主键意味着调用方传错了 id，应当炸出来。
 */
export async function insertAsset(db: AssetTarget, input: AssetMetadata): Promise<void> {
  assertValidAssetMetadata(input)
  await db.execute(sql`
    insert into auth.asset (
      id, name, type, description, icon, category, tags, owner_id, owner_name, department,
      visibility, version, status, favorite_count, usage_count, rating, rating_count,
      feedback_count, created_at, updated_at, published_at, archived_at
    ) values (
      ${input.id}, ${input.name}, ${input.type}, ${input.description}, ${input.icon},
      ${input.category}, ${tagsLiteral(input.tags)}, ${input.ownerId}, ${input.ownerName},
      ${input.department}, ${input.visibility}, ${input.version}, ${input.status},
      ${input.favoriteCount}, ${input.usageCount}, ${input.rating}, ${input.ratingCount},
      ${input.feedbackCount}, ${input.createdAt}, ${input.updatedAt}, ${input.publishedAt},
      ${input.archivedAt}
    )
  `)
}

/**
 * 把标签数组编成 PG 数组表达式。
 *
 * ⚠️ **不能直接把 JS 数组塞进 `sql` 模板**：drizzle 会把数组展开成行构造器
 * `($7, $8)`，而 `text[]` 列拒绝 record（实测 `42804`：`column "tags" is of type
 * text[] but expression is of type record`）。必须显式写成 `array[$7, $8]::text[]`，
 * 每个元素仍走独立占位符（不拼字符串，注入面不因此扩大）。
 */
function tagsLiteral(tags: readonly string[]): SQL {
  if (tags.length === 0) return sql`'{}'::text[]`
  return sql`array[${sql.join(
    tags.map((tag) => sql`${tag}`),
    sql`, `,
  )}]::text[]`
}

/** 按 id 读一条；不存在返回 `undefined`（不是 `null`，也不是半填的对象）。 */
export async function assetById(db: AssetTarget, id: string): Promise<AssetMetadata | undefined> {
  const rows = rowsOf(await db.execute(sql`select ${COLUMNS} from auth.asset where id = ${id}`))
  const [row] = rows
  return row === undefined ? undefined : toMetadata(row)
}

export interface AssetListFilters {
  readonly type?: AssetType
  readonly status?: AssetStatus
  readonly category?: string
  readonly visibility?: AssetVisibility
  /**
   * 关键字（`ilike`）：匹配名称、描述、标签。
   *
   * 不含所有者姓名：搜索框找的是「资产能干什么」，不是「谁提交的」。
   * 标签用 `array_to_string` 展开后匹配，避免为搜索再建一张表。
   */
  readonly search?: string
}

/**
 * 列资产，按 `updated_at` 倒序。
 *
 * 次级键 `id` 不是装饰：`updated_at` 是**秒**粒度，同一次批量写入很容易同秒；
 * 没有稳定的次级键，列表顺序会随 PG 的返回顺序漂。前端的虚拟滚动与「最近更新」
 * 依赖这个顺序稳定。
 *
 * 过滤条件都是等值（`search` 除外）；`undefined` 表示不过滤——**空串也按「有值」处理**，
 * 因为空串搜索不是「不过滤」，而是调用方传错了。
 */
export async function listAssets(
  db: AssetTarget,
  filters: AssetListFilters = {},
): Promise<AssetMetadata[]> {
  const conditions: SQL[] = []
  if (filters.type !== undefined) conditions.push(sql`type = ${filters.type}`)
  if (filters.status !== undefined) conditions.push(sql`status = ${filters.status}`)
  if (filters.category !== undefined) conditions.push(sql`category = ${filters.category}`)
  if (filters.visibility !== undefined) conditions.push(sql`visibility = ${filters.visibility}`)
  if (filters.search !== undefined) {
    const pattern = `%${filters.search}%`
    conditions.push(sql`(
      name ilike ${pattern}
      or description ilike ${pattern}
      or array_to_string(tags, ' ') ilike ${pattern}
    )`)
  }

  const where = conditions.length === 0 ? sql`` : sql`where ${sql.join(conditions, sql` and `)}`
  const rows = rowsOf(await db.execute(sql`
    select ${COLUMNS}
    from auth.asset
    ${where}
    order by updated_at desc, id asc
  `))
  return rows.map(toMetadata)
}

/**
 * 按 id 删除元数据；删到返回 `true`，本来就没有返回 `false`。
 *
 * 用 `returning id` 数行数，而不是先查再删：先查再删是两条语句，两条之间别人删掉时
 * 会把「没删到」报成成功。`returning` 的形状在两种驱动下都由 `rowsOf` 收掉。
 *
 * **只删元数据**：`/assets` 下的文件由 `service.ts` 的 `discardAsset` 在这个成功之后删。
 */
export async function deleteAsset(db: AssetTarget, id: string): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`delete from auth.asset where id = ${id} returning id`))
  return rows.length > 0
}
