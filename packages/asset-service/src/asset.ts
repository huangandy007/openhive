import { sql, type SQL } from "drizzle-orm"
import { integer, numeric, pgSchema, text } from "drizzle-orm/pg-core"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { readableAssetCondition, type AssetViewer } from "./readable-sql"
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

/** 批量改分类的结果（需求 2）：真改了的（带旧值，供审计）＋ 库里没有的 id。 */
export interface CategoryUpdateResult {
  readonly changed: readonly { readonly id: string; readonly from: string }[]
  readonly missing: readonly string[]
}

/**
 * 批量把资产的业务分类改成 `category`（需求 2，2026-10-27）。
 *
 * **只动「旧值 ≠ 目标值」的行**：重复点「应用」不该把 `updated_at` 一路刷新、把清单顺序
 * 打乱，也不该给审计灌一批「没改也算改」。目标分类是否**合法**不在这里判——那是出口的
 * 责任，唯一实现是 `isEnabledCategory()`（`#002-06`）。
 *
 * 先读旧值再写，中间存在极小窗口（并发改同一行会让审计里的 `from` 过时）；分类维护是
 * 低频管理动作，为此加一把锁不划算。写用一条语句，行与行之间不会只改一半。
 */
export async function updateAssetCategories(
  db: AssetTarget,
  ids: readonly string[],
  category: string,
  now = Math.floor(Date.now() / 1000),
): Promise<CategoryUpdateResult> {
  if (ids.length === 0) return { changed: [], missing: [] }

  const 占位 = sql.join(ids.map((id) => sql`${id}`), sql`, `)
  const rows = rowsOf(await db.execute(sql`select id, category from auth.asset where id in (${占位})`))
  const 现有 = new Map(rows.map((row) => [String(row["id"]), String(row["category"])]))
  const missing = [...new Set(ids.filter((id) => !现有.has(id)))]
  // 有一个 id 不存在就整批不写：批量动作留半截，管理员看到 404 却已有资产改了分类，最难对账。
  if (missing.length > 0) return { changed: [], missing }

  const changed = [...现有.entries()]
    .filter(([, 旧值]) => 旧值 !== category)
    .map(([id, from]) => ({ id, from }))
  if (changed.length === 0) return { changed, missing }

  const 目标 = sql.join(changed.map((item) => sql`${item.id}`), sql`, `)
  await db.execute(sql`
    update auth.asset set category = ${category}, updated_at = ${now} where id in (${目标})
  `)
  return { changed, missing }
}

export interface AssetListFilters {
  readonly type?: AssetType
  readonly status?: AssetStatus
  readonly category?: string
  /**
   * 「其他」兜底（需求 2，2026-10-27）：只列**分类不在启用清单里**的行。
   *
   * 口径是「不在启用清单」而不是「分类为空」——`category` 是 NOT NULL，空分类不存在；
   * 停用的分类（管理员停掉）与库里根本没有的 id（历史数据 / 直写库）都落进来。
   * 「启用清单」的唯一来源是 `auth.asset_category.enabled`，与 `category-store.ts` 同源。
   */
  readonly categoryOther?: true
  /**
   * 空间过滤。**单个值或数组**都收（需求 6，2026-10-27）：使用面左栏三个空间是复选，
   * 前端把选中的那几个一起下推，免得「取回 20 条再内存筛」把每页条数吃掉。
   *
   * ⚠️ **空数组是「空集」，不是「不过滤」**：用户把三个空间全取消，结果必须是空的——
   * 否则「取消」这个动作永远取消不掉任何东西。
   */
  readonly visibility?: AssetVisibility | readonly AssetVisibility[]
  /**
   * 关键字（`ilike`）：匹配名称、描述、标签。
   *
   * 不含所有者姓名：搜索框找的是「资产能干什么」，不是「谁提交的」。
   * 标签用 `array_to_string` 展开后匹配，避免为搜索再建一张表。
   */
  readonly search?: string
  /**
   * 可见性下推（需求 6，2026-10-27）：只列这个读者读得到的行。
   *
   * 条件由 `readableAssetCondition()` 生成——那是 `canReadAsset()` 的 SQL 投影，
   * 规则仍只有一份（`readable-sql.ts`）。别在这里手写 `owner_id = ... or ...`：
   * 第二份实现漂了不会报错，只会「该看见的看不见」。
   */
  readonly readableBy?: AssetViewer
}

/** 一页的切片（需求 6）。`limit` 是页大小，`offset` 是已经跳过的行数。 */
export interface AssetPage {
  readonly limit: number
  readonly offset: number
}

/**
 * 条件全集——`listAssets` / `countAssets` **共用这一份**。
 *
 * 两处各写一遍 `where`，就会出现「总数说有 25 条、翻到第 2 页只剩 3 条」这类只在翻页时
 * 才现形的漂移。所以这里只有构造，没有第二种拼法。
 */
function assetConditions(filters: AssetListFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters.type !== undefined) conditions.push(sql`type = ${filters.type}`)
  if (filters.status !== undefined) conditions.push(sql`status = ${filters.status}`)
  if (filters.category !== undefined) conditions.push(sql`category = ${filters.category}`)
  if (filters.categoryOther === true) {
    // 需求 2 的兜底桶。子查询而不是把 id 清单拼进来：分类随时会被管理员停用，
    // 拼进来的清单在下一次请求就过期了。
    conditions.push(sql`category not in (select id from auth.asset_category where enabled)`)
  }
  if (filters.visibility !== undefined) {
    // 数组逐个占位符（不把 JS 数组直接塞进模板：drizzle 会展开成行构造器，`in` 的语义就
    // 取决于 PG 怎么理解 record——`tags` 那里踩过同款坑）。
    const values: readonly AssetVisibility[] =
      typeof filters.visibility === "string" ? [filters.visibility] : filters.visibility
    conditions.push(
      values.length === 0
        ? sql`false`
        : sql`visibility in (${sql.join(
            values.map((value) => sql`${value}`),
            sql`, `,
          )})`,
    )
  }
  if (filters.search !== undefined) {
    const pattern = `%${filters.search}%`
    conditions.push(sql`(
      name ilike ${pattern}
      or description ilike ${pattern}
      or array_to_string(tags, ' ') ilike ${pattern}
    )`)
  }
  if (filters.readableBy !== undefined) conditions.push(readableAssetCondition(filters.readableBy))
  return conditions
}

function whereOf(conditions: readonly SQL[]): SQL {
  return conditions.length === 0 ? sql`` : sql`where ${sql.join([...conditions], sql` and `)}`
}

/**
 * 分页参数**在碰库之前**校验：`limit <= 0` 或非整数会被 PG 拒成一条看不出所以然的 SQL 错，
 * 负数 offset 更糟——它静默返回空页，看起来像「没有数据」。
 */
function assertPage(page: AssetPage): void {
  if (!Number.isInteger(page.limit) || page.limit <= 0) {
    throw new Error(`非法分页：limit 必须是正整数，实得 ${String(page.limit)}`)
  }
  if (!Number.isInteger(page.offset) || page.offset < 0) {
    throw new Error(`非法分页：offset 必须是非负整数，实得 ${String(page.offset)}`)
  }
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
  page?: AssetPage,
): Promise<AssetMetadata[]> {
  if (page !== undefined) assertPage(page)

  const where = whereOf(assetConditions(filters))
  // 切片排在 order by 之后：先取全序再切，翻页才不会跳条。
  const paging = page === undefined ? sql`` : sql`limit ${page.limit} offset ${page.offset}`
  const rows = rowsOf(await db.execute(sql`
    select ${COLUMNS}
    from auth.asset
    ${where}
    order by updated_at desc, id asc
    ${paging}
  `))
  return rows.map(toMetadata)
}

/**
 * 同一份条件下的**总数**（需求 6）。
 *
 * 与 `listAssets` 共用 `assetConditions()`：分页只切列表，总数必须按同一条件数全量，
 * 否则前端算出来的总页数会与翻到底的实际行为对不上。
 */
export async function countAssets(db: AssetTarget, filters: AssetListFilters = {}): Promise<number> {
  const where = whereOf(assetConditions(filters))
  const rows = rowsOf(await db.execute(sql`select count(*) as total from auth.asset ${where}`))
  const total = rows[0]?.["total"]
  return typeof total === "number" ? total : Number(total ?? 0)
}

/** 生命周期列的一次条件写入（T008）。 */
export interface AssetLifecycleUpdate {
  /** 只有库里仍是这个状态才写——并发改状态时更新落空，而不是覆盖别人的结果。 */
  readonly expectedStatus: AssetStatus
  readonly status: AssetStatus
  readonly version: number
  readonly updatedAt: number
  readonly publishedAt: number | null
  readonly archivedAt: number | null
  /** 发布时选定的可见范围；省略表示不改。 */
  readonly visibility?: AssetVisibility
}

/**
 * 条件更新生命周期列：`where id = ? and status = expectedStatus`。
 *
 * 返回更新后的完整元数据；**状态已不是期望值时返回 `undefined`**，一个字段都不改。
 * 用条件更新而不是「先查再写」：两条语句之间别人改了状态，先查后写会把别人的结果覆盖掉，
 * 而这里落空正好让调用方回滚文件并报并发（`service.ts` 的 `transitionAsset`）。
 *
 * 只写生命周期列：名称 / 描述 / 标签等内容字段由编辑路径负责，互不覆盖。
 */
export async function updateAssetLifecycle(
  db: AssetTarget,
  id: string,
  update: AssetLifecycleUpdate,
): Promise<AssetMetadata | undefined> {
  if (!Number.isInteger(update.version) || update.version < 1) {
    throw new Error(`非法资产版本号：${String(update.version)}`)
  }

  const rows = rowsOf(await db.execute(sql`
    update auth.asset set
      status = ${update.status},
      version = ${update.version},
      updated_at = ${update.updatedAt},
      published_at = ${update.publishedAt},
      archived_at = ${update.archivedAt},
      visibility = coalesce(${update.visibility ?? null}, visibility)
    where id = ${id} and status = ${update.expectedStatus}
    returning ${COLUMNS}
  `))
  const [row] = rows
  return row === undefined ? undefined : toMetadata(row)
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
