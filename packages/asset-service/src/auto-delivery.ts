import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { readableAssetCondition, type AssetViewer } from "./readable-sql"

/**
 * 自动送达（需求 5a，2026-10-27，用户裁定）。
 *
 * ## 它解决什么
 *
 * 「审核通过」只把 skill 复制进共享卷，而内核从不读共享卷 ⇒ 用户还要去资产中心一份份点
 * 「启用」。自动送达把这一步去掉：**读者打开自己的项目时，他读得到的已发布 skill 自动
 * 出现**（`project-assets.ts` 的对账把链接建进 `.opencode/skill/`）。库里的行仍是事实、
 * 目录仍是投影，与 `enablement.ts` 同一套语义。
 *
 * ## 表里只存「关」
 *
 * 默认行为必须是「开」——加功能之前发布过的项目、新加入的人，都该按默认走。若存「开」的行，
 * 新项目 / 老项目都得先补一行才算数，漏一行就是静默不送达。故 `auth.project_asset_auto_delivery`
 * 的每一行都表示**这个人把这个项目的自动送达关了**（`#006-11`：按生产常态种，别让默认值
 * 与「没配过」分家）。
 *
 * ## 预算不在这里算
 *
 * `autoDeliverableAssets()` 只按 `limit` 截断，**不读 `ENABLEMENT_LIMIT`**：预算 =
 * 20 − 该项目已手动启用的条数，那个减法只有调用方（`project-assets.ts` 的对账）同时知道
 * 两侧的数。两处各算一份迟早漂成「前端说还能送 5 个、后端只送了 2 个」（`#002-06`）。
 *
 * ## 候选集不含 global
 *
 * 用户裁定（2026-10-27）：20 个的预算只管**项目内链接**，`global` 档走内核配置的
 * `skills.paths`（`/assets/global/skills`），一份配置全单位生效。把它也算进候选集等于
 * 同一份 skill 被送两遍，还白占一个预算位。
 */

/** 能跑 SQL 的句柄（形状同 `EnablementTarget`）。 */
export interface AutoDeliveryTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface AutoDeliveryState {
  /** `false` = 这个人在这个项目里关掉了自动送达（表里有一行）。 */
  readonly enabled: boolean
}

export interface AutoDeliveryScope {
  readonly userId: string
  readonly projectId: string
}

function nowSeconds(now: number | undefined): number {
  return now ?? Math.floor(Date.now() / 1000)
}

/** 开关状态（默认开）。 */
export async function autoDeliveryOf(
  db: AutoDeliveryTarget,
  scope: AutoDeliveryScope,
): Promise<AutoDeliveryState> {
  const rows = rowsOf(
    await db.execute(sql`
      select 1 from auth.project_asset_auto_delivery
       where user_id = ${scope.userId} and project_id = ${scope.projectId}
    `),
  )
  return { enabled: rows.length === 0 }
}

/**
 * 改开关。`enabled = true` ⇒ 删行（回到默认开）；`enabled = false` ⇒ upsert 一行。
 *
 * 幂等：连点两次开 / 连点两次关都是同一结果，不报错。
 */
export async function setAutoDelivery(
  db: AutoDeliveryTarget,
  input: AutoDeliveryScope & { readonly enabled: boolean; readonly now?: number },
): Promise<void> {
  if (input.enabled) {
    await db.execute(sql`
      delete from auth.project_asset_auto_delivery
       where user_id = ${input.userId} and project_id = ${input.projectId}
    `)
    return
  }
  await db.execute(sql`
    insert into auth.project_asset_auto_delivery (user_id, project_id, disabled_at)
    values (${input.userId}, ${input.projectId}, ${nowSeconds(input.now)})
    on conflict (user_id, project_id) do update set disabled_at = excluded.disabled_at
  `)
}

export type AutoVisibility = "department" | "targeted"

export interface AutoCandidate {
  readonly id: string
  readonly visibility: AutoVisibility
  /** `department` 档拼发布目录要用它（`publishDirectory` 的入参）。 */
  readonly department: string
  /** 排序键，回给调用方只为可查（不参与建链接）。 */
  readonly publishedAt: number | null
}

/**
 * 这个人这个项目「该自动拿到」的 skill，**按发布时间倒序**（同时间按 id 升序，保证稳定）。
 *
 * 判据三层：
 * 1. `readableAssetCondition()` —— 可见性只有一份规则（`#004-02`）；
 * 2. `type='skill'` + `status='published'` —— 只有审核通过的 skill 能被内核调用；
 * 3. `visibility in ('department','targeted')` —— `global` 走配置、`personal` 留在作者沙箱。
 */
export async function autoDeliverableAssets(
  db: AutoDeliveryTarget,
  viewer: AssetViewer,
  input: { readonly limit: number; readonly exclude?: readonly string[] },
): Promise<AutoCandidate[]> {
  if (input.limit <= 0) return []
  const exclude = input.exclude ?? []
  const 排除 =
    exclude.length === 0
      ? sql``
      : sql`and auth.asset.id not in (${sql.join(
          exclude.map((id) => sql`${id}`),
          sql`, `,
        )})`

  const result = await db.execute(sql`
    select auth.asset.id, auth.asset.visibility, auth.asset.department, auth.asset.published_at
      from auth.asset
     where ${readableAssetCondition(viewer)}
       and auth.asset.type = 'skill'
       and auth.asset.status = 'published'
       and auth.asset.visibility in ('department', 'targeted')
       ${排除}
     order by coalesce(auth.asset.published_at, auth.asset.updated_at) desc, auth.asset.id asc
     limit ${input.limit}
  `)

  // SQL 的 `in` 已经保证只回这两档；收窄仍走显式判定而不是断言——库列是 text，
  // 断言在类型层是免费的、在运行期什么也没挡（与 `readable-sql.ts` 的 `isAssetPerm` 同取向）。
  return rowsOf(result).flatMap((row) => {
    const visibility = row.visibility
    if (visibility !== "department" && visibility !== "targeted") return []
    return [
      {
        id: String(row.id),
        visibility,
        department: typeof row.department === "string" ? row.department : "",
        publishedAt: row.published_at === null ? null : Number(row.published_at),
      },
    ]
  })
}
