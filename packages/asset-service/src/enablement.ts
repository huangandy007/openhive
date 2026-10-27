import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"

/**
 * 项目级 skill 启用关系（2026-10-27）。
 *
 * ## 事实在库，目录是投影
 *
 * 本文件只碰 `auth.project_asset_enablement` 一张表。把 skill 链接进项目目录那件事在
 * `project-skill-link.ts`，两件事**分开**：链接失败（权限、磁盘）不该把库写脏，
 * 库写成功而链接失败时由下一次对账修回来（`reconcileSkillLinks`）。
 *
 * ## 上限用子查询守卫，不先查后写
 *
 * `insert ... select ... where (count < 上限)` 一条语句完成「够数就不插」，没有
 * 「查完 19、两人同时插进第 20、21 个」的窗口。并发下仍可能出现「实际插入 0 行、且随后
 * 读到的也不是已启用」的瞬时态，那时回 `limit_reached`——比放行第 21 个安全。
 *
 * ## 时间一律 Unix 秒
 *
 * 毫秒装不进 `integer`（`0001_init.sql` 的警告；`auth/time.ts` 的 `nowSeconds()`）。
 */

/** 每个项目最多启用的 skill 数（产品参数，不进 DB CHECK：要能调）。 */
export const ENABLEMENT_LIMIT = 20

/** 能跑 SQL 的句柄（形状同 `PreferenceTarget` / `AssetTarget`）。 */
export interface EnablementTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface EnablementState {
  /** 已启用的资产 id，**最近启用的在前**（同时间按 id 升序，保证稳定）。 */
  readonly enabled: readonly string[]
  readonly enabledCount: number
  readonly limit: number
}

function nowSeconds(now: number | undefined): number {
  return now ?? Math.floor(Date.now() / 1000)
}

/** 一个项目的启用集合（服务端权威；前端只渲染这个）。 */
export async function enablementOf(
  db: EnablementTarget,
  projectId: string,
  limit = ENABLEMENT_LIMIT,
): Promise<EnablementState> {
  const enabled = await enabledAssetIds(db, projectId)
  return { enabled, enabledCount: enabled.length, limit }
}

export async function enabledAssetIds(db: EnablementTarget, projectId: string): Promise<string[]> {
  const result = await db.execute(sql`
    select asset_id
      from auth.project_asset_enablement
     where project_id = ${projectId}
     order by enabled_at desc, asset_id asc
  `)
  return rowsOf(result).map((row) => String(row.asset_id))
}

export interface EnableInput {
  readonly projectId: string
  readonly assetId: string
  /** 启用人（审计与「谁装的」）。 */
  readonly userId: string
  /** Unix 秒；测试传固定值。 */
  readonly now?: number
  readonly limit?: number
}

export type EnableResult = "enabled" | "already_enabled" | "limit_reached"

/**
 * 启用一份资产。返回值三态：
 * - `enabled`：这次真的插了；
 * - `already_enabled`：早就启用过（幂等，不覆盖启用人/时间）；
 * - `limit_reached`：数到上限，没插。
 */
export async function enableAsset(db: EnablementTarget, input: EnableInput): Promise<EnableResult> {
  const limit = input.limit ?? ENABLEMENT_LIMIT
  const inserted = await db.execute(sql`
    insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
    select ${input.projectId}, ${input.assetId}, ${input.userId}, ${nowSeconds(input.now)}
     where (
       select count(*) from auth.project_asset_enablement where project_id = ${input.projectId}
     ) < ${limit}
    on conflict (project_id, asset_id) do nothing
    returning asset_id
  `)
  if (rowsOf(inserted).length > 0) return "enabled"
  // 没插进去只有两种可能：已经启用过，或者数已到上限。再读一次分辨。
  const existing = await db.execute(sql`
    select 1 from auth.project_asset_enablement
     where project_id = ${input.projectId} and asset_id = ${input.assetId}
  `)
  return rowsOf(existing).length > 0 ? "already_enabled" : "limit_reached"
}

/** 停用。返回 `true` = 真的删了一行（重复停用是空操作）。 */
export async function disableAsset(
  db: EnablementTarget,
  input: { readonly projectId: string; readonly assetId: string },
): Promise<boolean> {
  const result = await db.execute(sql`
    delete from auth.project_asset_enablement
     where project_id = ${input.projectId} and asset_id = ${input.assetId}
    returning 1
  `)
  return rowsOf(result).length > 0
}
