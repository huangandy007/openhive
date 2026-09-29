import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate, rollback, rowsOf } from "./migrate"

/** 跑一条查询并把它抛出的错原样交回来（drizzle 的 `execute()` 是懒 thenable，需 await 才真执行）。 */
async function failureOf(query: PromiseLike<unknown>): Promise<unknown> {
  try {
    await query
    return undefined
  } catch (cause) {
    return cause
  }
}

/**
 * 取错误链上的 PG errcode。
 *
 * drizzle 把驱动错误包成 DrizzleQueryError，PG 的 errcode 挂在其 `cause` 上——
 * 所以要往里钻一层。用 `Reflect.get` 而不是 `as` 断言：错误对象的形状是运行时事实，
 * 断言只会把类型系统的警报掐掉。
 */
function pgErrorCode(thrown: unknown): string | undefined {
  const cause = typeof thrown === "object" && thrown !== null ? Reflect.get(thrown, "cause") : undefined
  if (typeof cause !== "object" || cause === null) return undefined
  const code: unknown = Reflect.get(cause, "code")
  return typeof code === "string" ? code : undefined
}

function freshDb() {
  return drizzle({ client: new PGlite() })
}

/** design-v2 §4.1 的用户表字段（`2026-09-06-openhive-design-v2.md:124-145`）。 */
const DESIGN_V2_COLUMNS = [
  "id",
  "police_no",
  "name",
  "id_card",
  "phone",
  "org",
  "dept",
  "section",
  "status",
  "password_hash",
  "is_admin",
  "must_change_pw",
  "last_login_at",
  "last_active_at",
  "created_at",
]

const seedUser = (id: string, police_no: string) => sql`
  insert into auth.user
    (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
  values
    (${id}, ${police_no}, '张三', '110101199001011234', '13800000000', '市局', '刑侦支队', '一大队', 1, '$argon2id$stub', 0)
`

describe("rowsOf", () => {
  // 两个方言的行结构不同是实测结论；bun-sql 那支离线跑不到真库，只能靠本组单测钉住。
  test("认 pglite 的 { rows } 形态", () => {
    expect(rowsOf({ rows: [{ version: "0001_init" }] })).toEqual([{ version: "0001_init" }])
  })

  test("认 bun-sql 的裸行数组形态", () => {
    expect(rowsOf([{ version: "0001_init" }])).toEqual([{ version: "0001_init" }])
  })

  test("两种都不像时点名报错，不静默当成空结果", () => {
    expect(() => rowsOf({ rowCount: 0 })).toThrow("无法从查询结果中取出行")
  })
})

describe("migrate", () => {
  test("建出 auth.user 表，字段与 design-v2 §4.1 逐字一致且顺序相同", async () => {
    const db = freshDb()

    await migrate(db)

    const result = await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'auth' and table_name = 'user'
      order by ordinal_position
    `)

    expect(result.rows.map((row) => row.column_name)).toEqual(DESIGN_V2_COLUMNS)
  })

  test("警号唯一约束生效：重复警号被拒", async () => {
    const db = freshDb()
    await migrate(db)
    await db.execute(seedUser("u1", "000001"))

    // 23505 = unique_violation。
    expect(pgErrorCode(await failureOf(db.execute(seedUser("u2", "000001"))))).toBe("23505")
  })

  test("重复执行安全：第二次不再建表，已有数据不丢", async () => {
    const db = freshDb()
    expect(await migrate(db)).toEqual(["0001_init"])

    await db.execute(seedUser("u1", "000001"))
    expect(await migrate(db)).toEqual([])

    const result = await db.execute(sql`select count(*)::int as n from auth.user`)
    expect(result.rows).toEqual([{ n: 1 }])
  })

  test("记账时间记的是 Unix 秒，与用户表时间列同一单位", async () => {
    const db = freshDb()
    await migrate(db)

    const result = await db.execute(sql`select applied_at::int8 as applied_at from auth._migration`)
    const [row] = rowsOf(result)
    expect(Math.abs(Number(row?.applied_at) - Math.floor(Date.now() / 1000))).toBeLessThan(60)
  })

  test("rollback 撤掉本迁移建出的表", async () => {
    const db = freshDb()
    await migrate(db)

    await rollback(db, "0001_init")

    const result = await db.execute(sql`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'auth' and table_name = 'user'
    `)
    expect(result.rows).toEqual([{ n: 0 }])
  })
})
