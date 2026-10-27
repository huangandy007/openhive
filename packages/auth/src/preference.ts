export * as Preference from "./preference"

import { sql } from "drizzle-orm"
import { rowsOf } from "./migrate"

/**
 * 账号级偏好（需求 6，FR-006）。表的真相来源是 `migrations/0019_user_preference.sql`。
 *
 * ## 为什么不是 `localStorage`
 *
 * 中栏「每页条数」是**账号偏好**：民警在单位电脑选 50，回家登录也该是 50。浏览器本地存储
 * 做不到跨设备，所以进库、按键存。
 *
 * ## 为什么键是闭集
 *
 * 开放键空间等于给每个客户端一列「想写什么写什么」的库——写错一个键名不会有任何报错，
 * 只会静默多一行谁也不读的垃圾。闭集让「拼错」当场变成异常。加键就改 `PREFERENCE_KEYS`
 * 一行，代价可接受。
 *
 * 值的合法性**不在这里**：每个键各有各的约束（例如每页条数只允许 20 / 50 / 100），谁定义
 * 这个键谁校验。本层只保证「键认得出、值放得进」。
 */

/** 认识的偏好键（闭集）。键名带域前缀，避免不同模块撞名。 */
export const PREFERENCE_KEYS = ["asset.pageSize"] as const
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number]

/** 值的长度上限：偏好是标量，不是文档。超长一律拒绝，别让一张表变成存储。 */
const VALUE_max = 256

/** 能跑 SQL 的句柄（形状同 `rbac.ts` 的 `GrantTarget`）。 */
export interface PreferenceTarget {
  execute(query: Parameters<typeof rowsOf>[0]): PromiseLike<unknown>
}

function 是键(value: string): value is PreferenceKey {
  return (PREFERENCE_KEYS as readonly string[]).includes(value)
}

/**
 * 读一个用户的**全部**已知偏好（键 → 值）。
 *
 * 库里可能存在闭集外的行（别的写入方、手工改库）：这里**跳过**而不是抛错——读路径因为一行
 * 脏数据整体失败，等于「一个无关的键把整页打不开」。写路径则相反，未知键当场拒绝。
 */
export async function readPreferences(
  db: PreferenceTarget,
  userId: string,
): Promise<Partial<Record<PreferenceKey, string>>> {
  const rows = rowsOf(await db.execute(sql`
    select key, value from auth.user_preference where user_id = ${userId}
  `))
  const 结果: Partial<Record<PreferenceKey, string>> = {}
  for (const row of rows) {
    const key = String(row["key"])
    if (!是键(key)) continue
    结果[key] = String(row["value"])
  }
  return 结果
}

/**
 * 写一个偏好（upsert：每用户每键一行，覆盖旧值，不留历史）。
 *
 * 未知键与超长值都在碰库**之前**拒绝——先写进去再报错等于什么都没保证。
 */
export async function writePreference(
  db: PreferenceTarget,
  userId: string,
  key: string,
  value: string,
  updatedAt: number,
): Promise<void> {
  if (!是键(key)) throw new Error(`未知偏好键：${key}`)
  if (value.length > VALUE_max) throw new Error(`偏好值过长：${value.length} > ${VALUE_max}`)
  await db.execute(sql`
    insert into auth.user_preference (user_id, key, value, updated_at)
    values (${userId}, ${key}, ${value}, ${updatedAt})
    on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at
  `)
}
