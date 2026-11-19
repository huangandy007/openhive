export * as OpenhiveCaseTrustedSkill from "./case-trusted-skill"

import { enableAsset } from "@opencode-ai/asset-service/enablement"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { sql } from "drizzle-orm"
import { 读设置, 留痕 } from "./case-ingest-settings"
import type { Queryable } from "./case-store"

/**
 * 平台级「可信技能」白名单（016 T014 / FR-047）。
 *
 * ## 平台级，不是项目级
 *
 * `auth.trusted_skill`（0048）没有 `project_id`：可信是**单位管理员**的平台裁定，
 * 项目属主不得自行加白（FR-047）。管理员判据由调用方传入（唯一来源是会话身份
 * `User.Info.isAdmin`），本模块**不**在 SQL 里 join 用户表再判一次——同一个判断两处各写
 * 一份，早晚不等（`#002-06`）。
 *
 * ## 写入前复判 published
 *
 * 「加进白名单」不是永久授权：技能下线（`status` 离开 `published`）后白名单条目**自动失效**。
 * 因此加的时候校验一次 `type='skill' && status='published'`，自动启用前再复判一次
 * `status='published'`（见 `自动启用可信技能` 第 3 步）；两处查同一列，缺任一都会让
 * 「下线后仍被装进项目」变成可达路径。
 */

/** 白名单条目：`auth.trusted_skill` join `auth.asset`（姓名不是本接口的消费者，不 join 用户表）。 */
export interface 白名单条目 {
  assetId: string
  name: string
  status: string
  addedBy: string
  addedAt: number
}

export type 白名单写入结果 =
  | { ok: true }
  | { ok: false; code: "forbidden" | "asset_not_found" | "asset_not_skill" | "asset_not_published" }

/** 全部白名单条目（最近的在前；同秒按 asset_id 升序，保证稳定）。 */
export async function 列白名单(db: Queryable): Promise<白名单条目[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select t.asset_id, a.name, a.status, t.added_by, t.added_at
        from auth.trusted_skill t
        join auth.asset a on a.id = t.asset_id
       order by t.added_at desc, t.asset_id asc
    `),
  )
  return rows.map((行) => ({
    assetId: String(行.asset_id),
    name: String(行.name),
    status: String(行.status),
    addedBy: String(行.added_by),
    addedAt: Number(行.added_at),
  }))
}

/**
 * 加入白名单。管理员判据在最前：**没权限的人连资产存不存在都不该知道**（`#004-09` 权限先于一切）。
 * 插入是幂等的（`on conflict (asset_id) do nothing`）；只有真的插进去才留痕。
 */
export async function 加白名单(
  db: Queryable,
  输入: { assetId: string; userId: string; 操作人是管理员: boolean; 现在秒?: () => number },
): Promise<白名单写入结果> {
  if (!输入.操作人是管理员) return { ok: false, code: "forbidden" }

  const 资产 = rowsOf(
    await db.execute(sql`select type, status from auth.asset where id = ${输入.assetId}`),
  )[0]
  if (资产 === undefined) return { ok: false, code: "asset_not_found" }
  if (资产.type !== "skill") return { ok: false, code: "asset_not_skill" }
  if (资产.status !== "published") return { ok: false, code: "asset_not_published" }

  const 插入 = await db.execute(sql`
    insert into auth.trusted_skill (asset_id, added_by, added_at)
    values (${输入.assetId}, ${输入.userId}, ${(输入.现在秒 ?? nowSeconds)()})
    on conflict (asset_id) do nothing
    returning asset_id
  `)
  if (rowsOf(插入).length > 0) {
    await 留痕(db, 输入.userId, {
      action: "case.trusted_skill.add",
      targetType: "asset",
      targetId: 输入.assetId,
      detail: { assetId: 输入.assetId },
    })
  }
  return { ok: true }
}

/** 撤出白名单。不存在也返回 `ok`（幂等：连点两次不该第二次报错）；只有真的删掉才留痕。 */
export async function 撤白名单(
  db: Queryable,
  输入: { assetId: string; userId: string; 操作人是管理员: boolean },
): Promise<白名单写入结果> {
  if (!输入.操作人是管理员) return { ok: false, code: "forbidden" }

  const 删除 = await db.execute(sql`
    delete from auth.trusted_skill where asset_id = ${输入.assetId} returning asset_id
  `)
  if (rowsOf(删除).length > 0) {
    await 留痕(db, 输入.userId, {
      action: "case.trusted_skill.revoke",
      targetType: "asset",
      targetId: 输入.assetId,
      detail: { assetId: 输入.assetId },
    })
  }
  return { ok: true }
}

export async function 在白名单内(db: Queryable, assetId: string): Promise<boolean> {
  const 行 = rowsOf(
    await db.execute(sql`select 1 from auth.trusted_skill where asset_id = ${assetId}`),
  )
  return 行.length > 0
}

export interface 自动启用输入 {
  projectId: string
  userId: string
  /** 候选（如本次新发布 / 扫描发现的技能）。 */
  资产id们: readonly string[]
  /** 项目属主才能装（与人工启用同口径，`#004-09`）。 */
  操作人是属主: boolean
  /** 注入 `启用内核`（T016 接线）：只判「这份资产能不能装进项目」。 */
  内核: (assetId: string) => Promise<{ ok: true } | { ok: false; code?: string; error: string }>
}

export interface 自动启用结果 {
  已启用: string[]
  跳过: { assetId: string; 原因: string }[]
  失败: { assetId: string; 原因: string }[]
}

/**
 * 自动启用可信技能（FR-047）。顺序固定：
 *
 * 1. 非属主 ⇒ 全部跳过（与人工启用同口径；权限在任何副作用之前，`#004-09`）；
 * 2. 开关关闭 ⇒ 全部跳过，**不碰** `enableAsset`；
 * 3. 不在白名单 ⇒ 跳过（「仍需提示」，不是失败）；
 * 4. 启用前复判 `status='published'` ⇒ 下线后白名单条目失效，**不调**内核 / `enableAsset`；
 * 5. 注入的启用内核 ⇒ `ok:false` 即失败（原因取 `error`）；
 * 6. `enableAsset`（20 上限原样在 SQL 里）⇒ `enabled` / `already_enabled`（跳过）/ `limit_reached`（失败）；
 * 7. 每个**真的**启用的资产一条审计（FR-063）。
 */
export async function 自动启用可信技能(db: Queryable, 输入: 自动启用输入): Promise<自动启用结果> {
  const 已启用: string[] = []
  const 跳过: { assetId: string; 原因: string }[] = []
  const 失败: { assetId: string; 原因: string }[] = []

  if (!输入.操作人是属主) {
    for (const assetId of 输入.资产id们) 跳过.push({ assetId, 原因: "非项目属主不能自动启用" })
    return { 已启用, 跳过, 失败 }
  }

  const 设置 = await 读设置(db, 输入.projectId)
  if (!设置.autoEnableTrusted) {
    for (const assetId of 输入.资产id们) 跳过.push({ assetId, 原因: "自动启用开关关闭" })
    return { 已启用, 跳过, 失败 }
  }

  // 白名单过滤与 published 复判分两步：前者逐条（条目少），后者一条批量 select。
  const 候选: string[] = []
  for (const assetId of 输入.资产id们) {
    if (await 在白名单内(db, assetId)) 候选.push(assetId)
    else 跳过.push({ assetId, 原因: "不在白名单（仍需提示）" })
  }

  const 状态 = new Map<string, string>()
  if (候选.length > 0) {
    const 行们 = rowsOf(
      await db.execute(sql`
        select id, status
          from auth.asset
         where id in (${sql.join(
           候选.map((id) => sql`${id}`),
           sql`, `,
         )})
      `),
    )
    for (const 行 of 行们) 状态.set(String(行.id), String(行.status))
  }

  for (const assetId of 候选) {
    if (状态.get(assetId) !== "published") {
      失败.push({ assetId, 原因: "资产未发布（白名单条目已失效）" })
      continue
    }

    let 内核结果: { ok: true } | { ok: false; code?: string; error: string }
    try {
      内核结果 = await 输入.内核(assetId)
    } catch (error) {
      失败.push({ assetId, 原因: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (!内核结果.ok) {
      失败.push({ assetId, 原因: 内核结果.error })
      continue
    }

    const 启用 = await enableAsset(db, { projectId: 输入.projectId, assetId, userId: 输入.userId })
    if (启用 === "enabled") {
      已启用.push(assetId)
      await 留痕(db, 输入.userId, {
        action: "case.trusted_skill.auto_enable",
        targetType: "asset",
        targetId: assetId,
        detail: { assetId },
      })
    } else if (启用 === "already_enabled") {
      跳过.push({ assetId, 原因: "已启用" })
    } else {
      失败.push({ assetId, 原因: "项目启用数已达上限" })
    }
  }

  return { 已启用, 跳过, 失败 }
}
