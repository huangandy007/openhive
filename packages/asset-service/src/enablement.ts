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
 * ## 上限用子查询守卫，**但它只是软上限**
 *
 * `insert ... select ... where (count < 上限)` 把「查」和「写」收进一条语句，省掉应用层的
 * 两次往返。**它挡不住并发**：PG 默认 READ COMMITTED（`migrations/README.md` 的迁移运行器
 * 前提），`count` 子查询不锁任何行 ⇒ 两个并发语句各按自己的快照看到 19，资产不同则主键不冲突，
 * 都插进去，最终 21 行。
 *
 * 这个残差是**接受**的：启用是人的点击动作，两次点击相隔以秒计；且真超了也只是多装一个 skill，
 * 下一次停用就回来了。真要硬保证得上事务 ＋ `pg_advisory_xact_lock(hashtext(项目 id))`
 * （`auth/migrate.ts` 有同样的先例），但 `EnablementTarget` 只有 `execute`、拿不到那把锁——
 * **不为一个人工动作引入事务边界**。
 *
 * 并发下另一种瞬时态：实际插入 0 行、随后再读也不是已启用 ⇒ 回 `limit_reached`，
 * 比回「已启用」安全（前者让用户重试，后者骗他说装好了）。
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

/**
 * 一个项目的启用集合（服务端权威；前端只渲染这个）。
 *
 * `limit` **不接受入参**：上报给前端的数与守卫用的数必须是同一个常量，两处各传一份迟早
 * 漂成「启用说没到上限、读回来显示超了」（`#002-06`：同一个判断两处各写一份，早晚不等）。
 */
export async function enablementOf(db: EnablementTarget, projectId: string): Promise<EnablementState> {
  const enabled = await enabledAssetIds(db, projectId)
  return { enabled, enabledCount: enabled.length, limit: ENABLEMENT_LIMIT }
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
}

export type EnableResult = "enabled" | "already_enabled" | "limit_reached"

/**
 * 启用一份资产。返回值三态：
 * - `enabled`：这次真的插了；
 * - `already_enabled`：早就启用过（幂等，不覆盖启用人/时间）；
 * - `limit_reached`：数到上限，没插。
 */
export async function enableAsset(db: EnablementTarget, input: EnableInput): Promise<EnableResult> {
  const inserted = await db.execute(sql`
    insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
    select ${input.projectId}, ${input.assetId}, ${input.userId}, ${nowSeconds(input.now)}
     where (
       select count(*) from auth.project_asset_enablement where project_id = ${input.projectId}
     ) < ${ENABLEMENT_LIMIT}
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

/**
 * 删项目时清掉它的全部启用行（**不是**本模块的启停链，是项目删除链的同类落点）。
 *
 * 为什么必须有：`project_id` 没有外键（项目本体在每用户 SQLite），删项目时没有任何东西
 * 会替我们清这张表 ⇒ 删掉的项目会永久留下一批读不到、也清不掉的启用行。仓库里同类的
 * 项目级 PG 表（`project_member` / `project_archive` / `project_meta`）都在
 * `archive.ts` 的删除链第 5 步逐个 `remove*`，本函数是那一组的第四个成员（`#002-06`：
 * 找的是「谁在按同一个前提做同一件事」）。
 *
 * 调用点：`packages/opencode/src/server/openhive/archive.ts` 的删除链第 5 步。
 */
export async function removeProjectEnablement(
  db: EnablementTarget,
  input: { readonly projectId: string },
): Promise<void> {
  await db.execute(sql`
    delete from auth.project_asset_enablement where project_id = ${input.projectId}
  `)
}
