import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"

/**
 * 资产收藏与使用记录（009 T011，FR-007 / design §1.3 §1.5）。
 *
 * ## 收藏 ≠ 授权
 *
 * 本文件**不参与任何授权判定**：`effectivePermissions()` / `canReadAsset()` 的入参里
 * 没有收藏。收藏只是「我觉得它好用」的个人偏好，唯一去向是右栏抽屉排序。
 * 由此彻底拆掉「启用」这个旧概念：能不能看 / 用由 `role_resource` 决定，常不常用由这里决定。
 *
 * ⚠️ 收藏行可以对一份**当前读不到**的资产存在（授权被撤销后，旧收藏行不会自动消失）。
 *    列出收藏时**必须**再过一遍 `canReadAsset()`，否则收藏入口会漏出无权资产（T017 的判据）。
 *    本文件只提供原始行，不做过滤——把授权判定塞进这里，就又把两件事搅在一起了。
 *
 * ## 最近使用与使用次数
 *
 * 每用户每资产一行 `asset_usage.last_used_at`（抽屉排序用）；
 * `auth.asset.usage_count` / `favorite_count` 是**展示用的缓存列**，由这里维护。
 * 缓存不是账本：用户注销时外键级联删掉明细，但资产的计数列不会自动回退（见迁移注释）。
 *
 * ## 次数为什么在缓存列里
 *
 * 列表卡片要显示「用过 N 次」，若每次列表都 `count(*)`，就把一次分页查询变成 N 次聚合。
 * 写入路径单一（`addFavorite` / `removeFavorite` / `recordUsage`），缓存能与明细同步增长；
 * 真出现漂移，用明细重算即可（对账不在本任务）。
 */

/** 能跑 SQL 的句柄（形状同 `AssetTarget` / `NotificationTarget`）。 */
export interface PreferenceTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface FavoriteInput {
  readonly userId: string
  readonly assetId: string
  /** Unix 秒；缺省取当前时间。测试传固定值，避免时钟依赖。 */
  readonly now?: number
}

function nowSeconds(now: number | undefined): number {
  return now ?? Math.floor(Date.now() / 1000)
}

/**
 * 收藏一份资产。
 *
 * 返回 `true` = 这次真的插入了新行；`false` = 早就收藏过（幂等，不重复计数）。
 * 「插入成功才 +1」用一条数据修改 CTE 完成，不需要先查再写（没有 TOCTOU 窗口）。
 */
export async function addFavorite(db: PreferenceTarget, input: FavoriteInput): Promise<boolean> {
  const result = await db.execute(sql`
    with inserted as (
      insert into auth.asset_favorite (user_id, asset_id, created_at)
      values (${input.userId}, ${input.assetId}, ${nowSeconds(input.now)})
      on conflict (user_id, asset_id) do nothing
      returning 1
    )
    update auth.asset
       set favorite_count = favorite_count + 1
     where id = ${input.assetId}
       and exists (select 1 from inserted)
    returning id
  `)
  return rowsOf(result).length > 0
}

/**
 * 取消收藏。返回 `true` = 真的删了一行。
 *
 * `greatest(..., 0)` 是防御性下限：缓存若已漂移成 0，删除也不该把它压成负数。
 */
export async function removeFavorite(
  db: PreferenceTarget,
  input: { readonly userId: string; readonly assetId: string },
): Promise<boolean> {
  const result = await db.execute(sql`
    with removed as (
      delete from auth.asset_favorite
       where user_id = ${input.userId} and asset_id = ${input.assetId}
      returning 1
    )
    update auth.asset
       set favorite_count = greatest(favorite_count - 1, 0)
     where id = ${input.assetId}
       and exists (select 1 from removed)
    returning id
  `)
  return rowsOf(result).length > 0
}

export async function isFavorite(
  db: PreferenceTarget,
  input: { readonly userId: string; readonly assetId: string },
): Promise<boolean> {
  const result = await db.execute(sql`
    select 1
      from auth.asset_favorite
     where user_id = ${input.userId} and asset_id = ${input.assetId}
  `)
  return rowsOf(result).length > 0
}

/**
 * 某用户收藏的资产 id（收藏时间倒序，同时间按 id 升序保证稳定）。
 *
 * ⚠️ 这是**原始清单**，其中可能包含当前已无权读取的资产；调用方必须过滤（见文件头）。
 */
export async function favoriteAssetIds(db: PreferenceTarget, userId: string): Promise<string[]> {
  const result = await db.execute(sql`
    select asset_id
      from auth.asset_favorite
     where user_id = ${userId}
     order by created_at desc, asset_id asc
  `)
  return rowsOf(result).map((row) => String(row.asset_id))
}

/**
 * 记一次使用：更新「我的最近使用」并把资产的使用次数 +1。
 *
 * 调用方应已确认该用户能读这份资产（T015 在执行成功后调用）；本函数不重复判授权。
 * 同一用户同一资产只有一行——重复使用只更新时间，次数仍继续累计。
 */
export async function recordUsage(
  db: PreferenceTarget,
  input: { readonly userId: string; readonly assetId: string; readonly now?: number },
): Promise<void> {
  await db.execute(sql`
    with recorded as (
      insert into auth.asset_usage (user_id, asset_id, last_used_at)
      values (${input.userId}, ${input.assetId}, ${nowSeconds(input.now)})
      on conflict (user_id, asset_id) do update set last_used_at = excluded.last_used_at
      returning 1
    )
    update auth.asset
       set usage_count = usage_count + 1
     where id = ${input.assetId}
       and exists (select 1 from recorded)
  `)
}

/** 某用户的「资产 id → 最近使用时间」，给抽屉排序用。 */
export async function lastUsedAtOf(
  db: PreferenceTarget,
  userId: string,
): Promise<Map<string, number>> {
  const result = await db.execute(sql`
    select asset_id, last_used_at
      from auth.asset_usage
     where user_id = ${userId}
  `)
  const map = new Map<string, number>()
  for (const row of rowsOf(result)) map.set(String(row.asset_id), Number(row.last_used_at))
  return map
}

/**
 * 收藏了某资产的用户 id（下线 / 重新上线通知的「使用者」收件人）。
 *
 * 排序是为了测试与通知写入稳定；调用方仍要去重并排除发起人。
 */
export async function favoriteUsers(db: PreferenceTarget, assetId: string): Promise<string[]> {
  const result = await db.execute(sql`
    select user_id
      from auth.asset_favorite
     where asset_id = ${assetId}
     order by user_id
  `)
  return rowsOf(result).map((row) => String(row.user_id))
}

/** 排序需要的最小形状；前端把 `SkillCapability` 映射成它即可。 */
export interface DrawerCandidate {
  readonly id: string
  readonly usageCount: number
}

/** 排序用的个人偏好。没有这些值时传空集合 / 空 Map，排序退化为按次数。 */
export interface DrawerPreferences {
  readonly favorites: ReadonlySet<string>
  readonly lastUsedAt: ReadonlyMap<string, number>
}

/**
 * 右栏「更多 skill」抽屉的组内排序（design §1.5 / PRD §8.2）。
 *
 * 设计里的三种说法（「最近使用上浮」「高频在前」「收藏加权 / 收藏低频排后」）有些互相
 * 牵扯，这里落成**一条确定的无权重规则**，依次比较：
 *
 * 1. 最近使用时间倒序——用过的上浮，没用的排后面（`-Infinity`）；
 * 2. 使用次数倒序——高频在前；
 * 3. 是否收藏——次数相同时收藏的靠前（收藏是**微调**，不会把低频资产抬到高频前面）；
 * 4. 资产 id 升序——兜底，保证结果稳定可测。
 *
 * 这是排序，不是过滤：入参原样返回（仅换顺序），不做任何「无权就消失」的判断。
 */
export function orderForDrawer<T extends DrawerCandidate>(
  items: readonly T[],
  prefs: DrawerPreferences,
): T[] {
  const lastUsed = (id: string): number => prefs.lastUsedAt.get(id) ?? Number.NEGATIVE_INFINITY
  const favoriteRank = (id: string): number => (prefs.favorites.has(id) ? 1 : 0)

  return [...items].sort((a, b) => {
    const aLast = lastUsed(a.id)
    const bLast = lastUsed(b.id)
    if (aLast !== bLast) return bLast > aLast ? 1 : -1

    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount

    const aFavorite = favoriteRank(a.id)
    const bFavorite = favoriteRank(b.id)
    if (aFavorite !== bFavorite) return bFavorite - aFavorite

    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}
