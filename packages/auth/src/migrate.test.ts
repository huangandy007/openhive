import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate, rollback, rowsOf } from "./migrate"
import { pgErrorCode } from "./pg-errors"

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
 * 同上，但要求抛的确实是 `Error` 并交回来——留着逃出去的是字符串或 undefined 时，
 * 调用点的 `thrown.message` 会读成 undefined 而**断言照样通过**（同 login / password / register
 * 三个测试文件里同名的那只，本文件原本只有 `failureOf`，两处 `as Error` 是被 lint 挡下才补的）。
 */
async function errorOf(query: PromiseLike<unknown>): Promise<Error> {
  const thrown = await failureOf(query)
  if (!(thrown instanceof Error)) throw new Error(`期望抛出 Error，实际拿到：${String(thrown)}`)
  return thrown
}

function freshDb() {
  return drizzle({ client: new PGlite() })
}

/**
 * design-v2 §4.1 的用户表字段（`2026-09-06-openhive-design-v2.md:124-145`）。
 *
 * `deactivated_at` 是 **002 T016 追加**的（FR-010 要「保留 30 天」，没有停用时刻就判不了窗口），
 * design-v2 §4.1 的表已同步。它在末尾而非 `status` 旁边，是因为**物理顺序如此**：
 * 0002 用 `ALTER TABLE ADD COLUMN` 加列，PG 只能追加到末尾——本条断言比的正是物理顺序。
 */
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
  "deactivated_at",
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
    expect(await migrate(db)).toEqual(["0001_init", "0002_deactivated_at", "0003_flags_not_null"])

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

  // 这条**以前是** `rollback(db, "0001_init")` 一把删表——把不安全的用法当成了正常用法：
  // 那时 0002/0003 还记在账上，库会停在「表没了、账却说 0002 已应用」的状态。
  // 现在必须按逆序回滚，而逆序回滚本来就该是唯一被演示的用法。
  test("按逆序逐个回滚可以回到空库（down 脚本真的撤掉了 up 建的东西）", async () => {
    const db = freshDb()
    await migrate(db)

    await rollback(db, "0003_flags_not_null")
    await rollback(db, "0002_deactivated_at")
    await rollback(db, "0001_init")

    const result = await db.execute(sql`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'auth' and table_name = 'user'
    `)
    expect(result.rows).toEqual([{ n: 0 }])
  })
})

/**
 * rollback 只允许回滚 **head**（最后一个已应用的版本）。
 *
 * 这两条测试的价值不在于「守卫抛不抛错」，而在于**它们以前是不存在的**——而缺口不是
 * 「少一条测试」，是「少一条测试 + 两条既有测试把危险用法演示成了正常用法」。
 */
describe("rollback 的边界", () => {
  async function columnCountOf(db: ReturnType<typeof freshDb>): Promise<number> {
    const result = await db.execute(sql`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'auth' and table_name = 'user'
    `)
    return Number(rowsOf(result)[0]?.n)
  }

  test("拒绝回滚非 head 版本——否则账与 schema 永久背离，migrate() 再也修不回来", async () => {
    const db = freshDb()
    await migrate(db)

    const thrown = await errorOf(rollback(db, "0001_init"))

    expect(thrown.message).toContain("0003_flags_not_null")
  })

  test("拒绝回滚没应用过的版本，也不把版本号拼进文件路径", async () => {
    const db = freshDb()
    await migrate(db)

    // 若版本号不校验就拼进 `runFile` 的文件名，这里读的是工作目录外的任意文件，
    // 内容再交给 `sql.raw` 执行。
    const thrown = await errorOf(rollback(db, "../../001_init"))

    expect(thrown.message).toContain("未应用")
  })

  // 把「守卫拦住之后库仍完好」这件事本身钉住——守卫若哪天被删掉，上一条仍会红，
  // 但这条会**先**暴露后果：migrate() 报成功，而 deactivated_at 已经没了。
  test("回滚 head 之后，schema 与账仍一致，再 migrate 能完整回到 16 列", async () => {
    const db = freshDb()
    await migrate(db)
    await rollback(db, "0003_flags_not_null")

    expect(await migrate(db)).toEqual(["0003_flags_not_null"])
    expect(await columnCountOf(db)).toBe(DESIGN_V2_COLUMNS.length)
  })
})

/**
 * 0003 把两个标记位收紧为 NOT NULL。
 *
 * 为什么值得专门钉一条：读取侧一律用 `=== 1` 比（`login.ts`），于是
 * `must_change_pw = NULL` 被读成「不需改密」——失败方向**朝外**，一个 NULL 就绕过强制改密，
 * 而且它在库里与「正常改过密」完全同形（都是「不等于 1」的反面：0）。三值逻辑在这里
 * 不是学术问题，是 FR-006 会不会被静默绕过的问题。
 */
describe("标记位不可为空（0003）", () => {
  async function accountCreated() {
    const db = freshDb()
    await migrate(db)
    await db.execute(seedUser("u1", "000001"))
    return db
  }

  test("must_change_pw 拒绝 NULL——NULL 会被 login 读成「不需改密」", async () => {
    const db = await accountCreated()

    const thrown = await failureOf(db.execute(sql`update auth.user set must_change_pw = null where id = 'u1'`))

    // 23502 = not_null_violation。
    expect(pgErrorCode(thrown)).toBe("23502")
  })

  test("is_admin 拒绝 NULL——读法同源，一并收紧", async () => {
    const db = await accountCreated()

    const thrown = await failureOf(db.execute(sql`update auth.user set is_admin = null where id = 'u1'`))

    expect(pgErrorCode(thrown)).toBe("23502")
  })
})
