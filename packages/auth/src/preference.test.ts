import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "./migrate"
import { PREFERENCE_KEYS, readPreferences, writePreference } from "./preference"
import { startProductionDb, type ProductionDb } from "./test-support"

/**
 * 需求 6 · 账号偏好（`auth.user_preference`）。
 *
 * 判据只落在「库里读得回来」上——这层的价值就是**跨设备一致**，内存里的默认值不算数：
 * ① 写一个键，换个句柄读回来还是它（模拟另一台机器登录）；
 * ② 同一个键写第二次是**覆盖**，不留历史行；
 * ③ 不认识的键读写都拒绝（闭集在代码里收窄，库只管列）；
 * ④ 用户注销级联删掉偏好（不能让「删不掉的账号」出现）。
 */

const databases: ProductionDb[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  await database.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values ('u1', '010001', '甲民警', 'x', 'x', '市局', '经侦支队', 'x', 0, 'h', 0)
  `)
  return database.db
}

/** 查询结果取行：PGlite / 远端 PG 两种句柄，返回形状一个是数组、一个带 `rows`。 */
function 行集(结果: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(结果)) return 结果 as Array<Record<string, unknown>>
  const rows = (结果 as { rows?: Array<Record<string, unknown>> } | null)?.rows
  return rows ?? []
}

describe("auth.user_preference", () => {
  test("迁移建了表，主键是 (user_id, key)", async () => {
    const db = await freshDb()
    const rows = await db.execute(sql`
      select a.attname
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'auth.user_preference'::regclass and i.indisprimary
    `)
    const 主键列 = 行集(rows).map((row) => String(row.attname))
    expect(主键列.sort()).toEqual(["key", "user_id"])
  })

  test("写进去的键读得回来（换一次查询，不是同一份内存）", async () => {
    const db = await freshDb()
    expect(await readPreferences(db, "u1")).toEqual({})

    await writePreference(db, "u1", "asset.pageSize", "50", 1_700_000_000)
    expect((await readPreferences(db, "u1"))["asset.pageSize"]).toBe("50")
  })

  test("同一个键写第二次是覆盖，不新增行", async () => {
    const db = await freshDb()
    await writePreference(db, "u1", "asset.pageSize", "50", 1_700_000_000)
    await writePreference(db, "u1", "asset.pageSize", "100", 1_700_000_100)

    expect((await readPreferences(db, "u1"))["asset.pageSize"]).toBe("100")
    const rows = await db.execute(sql`select count(*)::int as total from auth.user_preference`)
    const 行 = 行集(rows)
    expect(Number(行[0]?.total)).toBe(1)
  })

  test("不认识的键：写拒绝、读忽略（不谎报存在）", async () => {
    const db = await freshDb()
    await expect(writePreference(db, "u1", "asset.unknown", "x", 1)).rejects.toThrow("未知偏好键")

    // 直接塞一行脏数据（模拟别的写入方）：读出来不带上它，也不因此炸掉整个读。
    await db.execute(sql`
      insert into auth.user_preference (user_id, key, value, updated_at)
      values ('u1', 'asset.unknown', 'x', 1)
    `)
    expect(await readPreferences(db, "u1")).toEqual({})
  })

  test("闭集里至少含本轮要用的那个键", () => {
    expect(PREFERENCE_KEYS).toContain("asset.pageSize")
  })

  test("用户注销级联删除偏好", async () => {
    const db = await freshDb()
    await writePreference(db, "u1", "asset.pageSize", "20", 1)
    await db.execute(sql`delete from auth.user where id = 'u1'`)
    expect(await readPreferences(db, "u1")).toEqual({})
  })
})
