import { randomUUID } from "node:crypto"
import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"

/**
 * 业务分类仓储（需求 4，2026-10-27）。
 *
 * 表的真相来源是 `packages/auth/src/migrations/0020_asset_category.sql`；本文件与
 * `asset.ts` 同一套取向：收窄成「能跑 SQL 的东西」、原始 SQL、逐字段显式映射。
 *
 * ## 为什么单独一个文件，而不是塞进 `categories.ts`
 *
 * `categories.ts` 是**代码里的形参**：它是 seed 源（迁移照抄一份进库）、也是测试夹具。
 * 一旦把「谁是合法分类」的判断也留在那里，库里新增的分类就永远不合法——闭集会分家成
 * 两份实现（`LEARNINGS #002-06`）。所以判断只有这里一份：**库里的启用集合**。
 *
 * ## 没有删除
 *
 * 本文件刻意**不导出** `deleteCategory`：资产行的 `category` 存的是 id，删掉分类行会让
 * 那批资产指向一个查不到的名字。要「不让人再选」就停用（`enabled = false`）。
 *
 * ## 重名靠唯一索引，不靠先查后写
 *
 * 「先 select 再 insert」在并发下会双写成功。这里直接写，撞 `23505` 就翻成
 * `CategoryNameTakenError`——`template.ts` 同一处置。
 */

/**
 * 「其他」兜底桶在 HTTP 查询串里的**保留值**（需求 2，2026-10-27）。
 *
 * 它不是分类：库里没有这一行，所以建草稿 / 批量改分类都拒它。前端 `filter.ts` 另写一份
 * 字面量（客户端不 import 内核源码，`#003-05`）；两处漂了会在组件测试 / HTTP 用例里当场红。
 * seed id 是普通 slug、管理员新建的是 `cat_<uuid>`，两边都不可能撞上这个值。
 */
export const OTHER_CATEGORY_ID = "__other__"

/** 与 `asset.ts` 的 `AssetTarget` 同形：PGlite 与生产 bun-sql 都满足。 */
export interface CategoryTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface AssetCategory {
  readonly id: string
  readonly name: string
  readonly sortOrder: number
  readonly enabled: boolean
  /** seed 导入的那九类（仅用于排查/审计，不参与判定）。 */
  readonly builtin: boolean
}

export class CategoryNameRequiredError extends Error {
  constructor() {
    super("分类名称不能为空")
    this.name = "CategoryNameRequiredError"
  }
}

export class CategoryNameTakenError extends Error {
  constructor(name: string) {
    super(`已有同名分类「${name}」`)
    this.name = "CategoryNameTakenError"
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("分类不存在")
    this.name = "CategoryNotFoundError"
  }
}

/** 名称修剪 + 非空；空名在碰库之前就拒（库的 CHECK 是第二道闸，不是第一道）。 */
function 校名(name: string): string {
  const trimmed = name.trim()
  if (trimmed === "") throw new CategoryNameRequiredError()
  return trimmed
}

function 排序值(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function toCategory(row: Record<string, unknown>): AssetCategory {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    sortOrder: 排序值(row["sort_order"]),
    enabled: row["enabled"] === true,
    builtin: row["builtin"] === true,
  }
}

const COLUMNS = sql`id, name, sort_order, enabled, builtin`

/**
 * 列出分类，按 `sort_order` 升序（同序按 id，保证两次查询顺序一致）。
 *
 * `includeDisabled` 默认 `false`：使用面只该看到启用的——停用就是「别再让人选它」。
 * 管理面用 `true`，否则停用过的分类在后台里消失，再也启不回来。
 */
export async function listCategories(
  db: CategoryTarget,
  options: { readonly includeDisabled?: boolean } = {},
): Promise<AssetCategory[]> {
  const rows = rowsOf(
    await db.execute(
      options.includeDisabled === true
        ? sql`select ${COLUMNS} from auth.asset_category order by sort_order asc, id asc`
        : sql`select ${COLUMNS} from auth.asset_category where enabled order by sort_order asc, id asc`,
    ),
  )
  return rows.map(toCategory)
}

/**
 * 分类是否存在且启用——**闭集的唯一实现**。
 *
 * 建草稿（`service.ts` 的 `createDraftAsset`）走这里，而不是查 `categories.ts` 的常量：
 * 管理员新增的分类必须立刻能用，seed 只是初稿。
 */
export async function isEnabledCategory(db: CategoryTarget, id: string): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`select 1 from auth.asset_category where id = ${id} and enabled`))
  return rows.length > 0
}

/**
 * 一页资产用到的分类名（需求 2）：**含停用分类**。
 *
 * 「其他」桶里的资产要标「原分类：xxx」——那正是被停用的那个分类，名字只能从库里取；
 * 拿 seed 常量拼就是第二份真相（管理员改过名就对不上）。库里没有的 id 不出现，
 * 前端退回显示 id（历史数据 / 直写库）。
 */
export async function categoryNamesOf(
  db: CategoryTarget,
  ids: readonly string[],
): Promise<Record<string, string>> {
  const 唯一 = [...new Set(ids)]
  if (唯一.length === 0) return {}
  const values = sql.join(唯一.map((id) => sql`${id}`), sql`, `)
  const rows = rowsOf(await db.execute(sql`select id, name from auth.asset_category where id in (${values})`))
  return Object.fromEntries(rows.map((row) => [String(row["id"]), String(row["name"])]))
}

export async function categoryById(db: CategoryTarget, id: string): Promise<AssetCategory | undefined> {
  const rows = rowsOf(await db.execute(sql`select ${COLUMNS} from auth.asset_category where id = ${id}`))
  return rows.length === 0 ? undefined : toCategory(rows[0]!)
}

/**
 * 新建分类。`id` **由服务生成**（`cat_<uuid>`），管理员只填名称：
 *
 * id 会出现在查询串、库与审计里，让管理员手输 slug 要额外做格式校验与重名提示，
 * 收益只是「可读」——排查时看 `name` 就够了。
 *
 * `sortOrder` 省略时排到末尾（当前最大值 + 10），与 seed 的 10/20/… 同一种间距。
 */
export async function createCategory(
  db: CategoryTarget,
  input: { readonly name: string; readonly sortOrder?: number; readonly now?: number },
): Promise<AssetCategory> {
  const name = 校名(input.name)
  const id = `cat_${randomUUID()}`
  const now = input.now ?? Math.floor(Date.now() / 1000)

  const 末尾 = rowsOf(
    await db.execute(sql`select coalesce(max(sort_order), 0) + 10 as next from auth.asset_category`),
  )[0]?.["next"]
  const sortOrder = input.sortOrder ?? 排序值(末尾)

  try {
    await db.execute(sql`
      insert into auth.asset_category (id, name, sort_order, enabled, builtin, created_at, updated_at)
      values (${id}, ${name}, ${sortOrder}, true, false, ${now}, ${now})
    `)
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw new CategoryNameTakenError(name)
    throw error
  }
  return { id, name, sortOrder, enabled: true, builtin: false }
}

/**
 * 部分更新：只改给了的字段（改名 / 排序 / 启停）。`id` 永不改（改名不换 id）。
 *
 * 三类改动共用一条出口：它们在库里只是三列，分三个函数等于三段重复的「找不到就 404」。
 */
export async function updateCategory(
  db: CategoryTarget,
  id: string,
  patch: { readonly name?: string; readonly sortOrder?: number; readonly enabled?: boolean },
  now = Math.floor(Date.now() / 1000),
): Promise<AssetCategory> {
  const name = patch.name === undefined ? null : 校名(patch.name)
  const sortOrder = patch.sortOrder === undefined ? null : patch.sortOrder
  const enabled = patch.enabled === undefined ? null : patch.enabled

  try {
    const result = await db.execute(sql`
      update auth.asset_category
      set name = coalesce(${name}::text, name),
          sort_order = coalesce(${sortOrder}::integer, sort_order),
          enabled = coalesce(${enabled}::boolean, enabled),
          updated_at = ${now}
      where id = ${id}
      returning id
    `)
    if (rowsOf(result).length === 0) throw new CategoryNotFoundError()
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw new CategoryNameTakenError(name ?? "")
    throw error
  }

  const 更新后 = await categoryById(db, id)
  if (更新后 === undefined) throw new CategoryNotFoundError()
  return 更新后
}
