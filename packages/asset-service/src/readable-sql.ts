import { sql, type SQL } from "drizzle-orm"
import type { AssetStatus } from "./metadata"

/**
 * 「读」规则的**两侧共享件**（需求 6，2026-10-27）。
 *
 * 这个文件存在的唯一理由：让 `authorization.ts`（内存判定 `canReadAsset()`）与
 * `asset.ts`（SQL 下推）**共用同一批常量与同一条谓词**，而不制造
 * `asset.ts ↔ authorization.ts` 的运行时循环（`authorization.ts` 要 `assetById()`，
 * `asset.ts` 要谓词）。
 *
 * 规则本身仍只有一份：`canReadAsset()` 是判据，`readableAssetCondition()` 是它的 SQL 投影，
 * `authorization-pushdown.test.ts` 用双投影相等断言把两边钉在一起（`#004-02`）。
 */

/** 四类权限动作（design §3.1）。与 `0004_rbac.sql` 的 `role_resource_perm_check` 同值。 */
export const ASSET_PERMS = ["read", "write", "review", "admin"] as const
export type AssetPerm = (typeof ASSET_PERMS)[number]

/**
 * 运行时收窄。`GrantRow.perm` 是 `string`（PG 侧的保证是 CHECK，不是 TS 类型）；
 * 未知值**跳过而不是猜一档**——猜成 `read` 会把一条坏数据变成一次放行。
 */
export function isAssetPerm(value: unknown): value is AssetPerm {
  return typeof value === "string" && (ASSET_PERMS as readonly string[]).includes(value)
}

/** 授权判定的视角：只认「你是谁 + 你在哪个部门」，不碰 `is_admin`（那是治理后台总开关，F10）。 */
export interface AssetViewer {
  readonly userId: string
  readonly department: string
}

/**
 * 对**非作者、非被授权者**可见的状态：资产只有进入共享空间之后才对全单位 / 部门开放。
 *
 * 草稿 / 审核中 / 待技术发布还停在作者或审核人手里；已归档是终态，不在浏览中出现。
 * 不为这道门，「作者先把可见范围设成 global 再慢慢写」就等于对全单位直播未完成品。
 *
 * ⚠️ `offline`（已下线）仍算可见：它只是「不能用」，不是「看不见」——使用者收到下线通知
 * 后要能找到它。可用性判定归 T008 / T009，别在这里提前砍。
 */
export const SHARED_STATUSES: ReadonlySet<AssetStatus> = new Set(["published", "iterating", "offline"])

/**
 * `canReadAsset()` 的 **SQL 投影**（需求 6 · 可见性下推，2026-10-27）。
 *
 * ## 为什么必须有它，而且只能有一份规则
 *
 * 分页要求「先按可见性筛、再 `limit/offset`」。若仍在内存里过滤（`assets.ts` 文件头的原做法），
 * 页大小会被筛掉的行吃掉：翻 20 条里可能只剩 3 条可见 ⇒ 翻页跳条、每页忽多忽少。
 * 下推必须与 `canReadAsset()` **同源**：两边漂了不会报错，只会「该看见的看不见 / 不该看见的
 * 看见了」。判据是 `authorization-pushdown.test.ts` 的双投影相等断言（`#004-02`）。
 *
 * ## 三个分支与 `effectivePermissions()` 逐条对应
 *
 * - 作者 ⇒ 恒可读（不看状态、不看可见范围）；
 * - 命中的授权行 ⇒ 可读。`resource_type` 与 `resource_id` **同时**匹配，且 `perm` 必须在闭集内
 *   （`canReadAsset` 对未知 `perm` 是跳过，这里用 `in` 表达同一个「跳过」）；
 * - 三级空间 ⇒ 仅共享状态（`SHARED_STATUSES`，从同一个 Set 生成 `in` 列表）、且
 *   `global` / 非空同部门 `department`。
 *
 * `personal` 不在这里放行——作者那一份已由第一支覆盖，其余人本就不该看见。
 *
 * ## 用法约束
 *
 * 条件用 `auth.asset.<列>` 引用外层表：**只允许用在 `from auth.asset` 且不给别名**的查询里
 * （`asset.ts` 的 `listAssets` / `countAssets` 就是这种形状）。给表起别名会让条件静默指向
 * 另一个表或报错——这不是可选项，是这条 SQL 的契约。
 */
export function readableAssetCondition(viewer: AssetViewer): SQL {
  const sharedStatuses = sql.join(
    [...SHARED_STATUSES].map((status) => sql`${status}`),
    sql`, `,
  )
  const perms = sql.join(
    ASSET_PERMS.map((perm) => sql`${perm}`),
    sql`, `,
  )

  return sql`(
    auth.asset.owner_id = ${viewer.userId}
    or exists (
      select 1
      from auth.user_role reader_role
      join auth.role_resource reader_grant on reader_grant.role_id = reader_role.role_id
      where reader_role.user_id = ${viewer.userId}
        and reader_grant.resource_type = auth.asset.type
        and reader_grant.resource_id = auth.asset.id
        and reader_grant.perm in (${perms})
    )
    or (
      auth.asset.status in (${sharedStatuses})
      and (
        auth.asset.visibility = 'global'
        or (
          auth.asset.visibility = 'department'
          and auth.asset.department <> ''
          and auth.asset.department = ${viewer.department}
        )
      )
    )
  )`
}
