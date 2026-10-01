import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate, rollback, rowsOf } from "./migrate"
import { pgErrorCode } from "./pg-errors"
import { withTempMigrations } from "./test-support"

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

/** 表在不在。用 `information_schema` 而不是 `to_regclass()`：后者认 `search_path`，判据会随会话漂。 */
async function tableExists(db: ReturnType<typeof freshDb>, name: string, schema?: string): Promise<boolean> {
  const result = await db.execute(sql`
    select count(*)::int as n from information_schema.tables
    where table_name = ${name} and (${schema ?? null}::text is null or table_schema = ${schema ?? null})
  `)
  return Number(rowsOf(result)[0]?.n) > 0
}

/**
 * 记账表里现在记着哪些版本。断言写成整个列表（通常 `[]`），比逐条 count 更能看出残留了什么。
 *
 * 「表整个不在」也算空：整轮回滚会连 `BOOTSTRAP` 建的那张表一起带走（它也在同一个事务里），
 * 那是「一条记录都没有」的更强形式，不是另一种失败。
 */
async function ledgerVersions(db: ReturnType<typeof freshDb>): Promise<string[]> {
  if (!(await tableExists(db, "_migration", "auth"))) return []
  const result = await db.execute(sql`select version from auth._migration order by version`)
  return rowsOf(result).map((row) => String(row.version))
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
 * T021：`migrate()` 的事务与并发锁（002 评审 I4）。
 *
 * 出参两半：① 两个进程同时 `migrate()` 只有一个应用，另一个等待后看到「已应用」；
 * ② 单个迁移文件内失败时**整文件回滚**，不留半应用状态。
 *
 * ⚠️ **①那半在本机测不了**，理由与实测见 003 `state.md` 缺口表——这里只留②那半的测试，
 * 以及一条能测的边角（锁不许漏出去）。别把本文件读成「并发已覆盖」。
 */
describe("migrate 的事务与并发锁（T021）", () => {
  // 迁移目录可注入是②那半的**前置**：不给一条「往临时目录里放一个坏文件」的路，
  // 就只能往仓库的 `migrations/` 里丢测试文件——一个跑挂了没删掉的残骸会被生产的下一次
  // 迁移一起应用（见 test-support.ts 的 `withTempMigrations`）。
  //
  // ⚠️ 这条钉的是**注入这件事本身**：目录参数被忽略时，`migrate()` 会照常应用仓库的
  // 三个真迁移并返回它们的版本号，这里的断言随即红——它不会「碰巧通过」。
  test("迁移目录可注入：应用的是注入目录里的文件，不是仓库的 migrations/", async () => {
    const db = freshDb()

    const applied = await withTempMigrations({ "0001_probe.sql": "create table probe_injected (x int)" }, (dir) =>
      migrate(db, dir),
    )

    expect(applied).toEqual(["0001_probe"])
    expect(await tableExists(db, "probe_injected")).toBe(true)
  })

  test("迁移文件中途失败 ⇒ 整文件回滚：前面语句不留痕，也不记账", async () => {
    const db = freshDb()

    // 判别式是**前半截有没有留下**。记账那半在改之前也是空的（insert 排在 `runFile` 之后，
    // 压根没跑到），单独断言它区分不开两种实现——`LEARNINGS #002-02`。
    const thrown = await errorOf(
      withTempMigrations(
        {
          "0001_broken.sql": [
            "create table probe_half (x int)",
            "--> statement-breakpoint",
            "select * from no_such_table_xyz",
          ].join("\n"),
        },
        (dir) => migrate(db, dir),
      ),
    )

    expect(thrown.message).toContain("no_such_table_xyz")
    expect(await tableExists(db, "probe_half")).toBe(false)
    expect(await ledgerVersions(db)).toEqual([])
  })

  // 上一条钉的是「文件自己的语句要一起回滚」，这条钉的是**记账也在同一个事务里**——
  // 两件事分开，是因为它们对应两种不同的改法：只把 `runFile` 包进事务，上一条就绿了，
  // 而「改了库、没记账」这个 002 评审 I4 的原文病还在（记账 insert 仍排在事务外）。
  //
  // 构造法子是让**记账这一步自己失败**：文件最后一条语句替运行器把记账行写了，
  // 运行器随后那句 insert 必撞主键。这样「DDL 成功之后、记账失败」这个窗口就必现，
  // 不依赖时序或运气。文件内容怪，是为了把那个窗口钉死；真实迁移不会这么写。
  test("记账与迁移文件同生共死：记账失败时该文件的 DDL 一并回滚", async () => {
    const db = freshDb()

    const thrown = await errorOf(
      withTempMigrations(
        {
          "0001_greedy.sql": [
            "create table probe_greedy (x int)",
            "--> statement-breakpoint",
            "insert into auth._migration (version, applied_at) values ('0001_greedy', 0)",
          ].join("\n"),
        },
        (dir) => migrate(db, dir),
      ),
    )

    // 23505 = unique_violation。
    expect(pgErrorCode(thrown)).toBe("23505")
    expect(await tableExists(db, "probe_greedy")).toBe(false)
    expect(await ledgerVersions(db)).toEqual([])
  })

  // 「迁移期间持着并发锁」在本机**只能这样验**：夹具的多个客户端被 socket 服务端汇进同一个
  // PG 会话（见 `test-support.ts`），而会话内的 advisory 锁是可重入的——实测第二个客户端
  // `pg_try_advisory_lock` 立刻拿到 `true`。所以「另一个 runner 在等」写不出来。
  //
  // 剩下的可观测面是**锁在不在**：让迁移文件自己回头看一眼 `pg_locks`。它看得见自己所在
  // 事务持有的 advisory 锁（实测），于是「持锁」这件事有了判别式。
  // ⚠️ 这条**不**能证明互斥——那半是登记在案的缺口，别把这里读成「并发已覆盖」。
  test("迁移执行期间确实持着 advisory 锁", async () => {
    const db = freshDb()

    await withTempMigrations(
      {
        "0001_saw_lock.sql": [
          "create table probe_locked as",
          "  select 1 as held where exists (select 1 from pg_locks where locktype = 'advisory')",
        ].join("\n"),
      },
      (dir) => migrate(db, dir),
    )

    const result = await db.execute(sql`select count(*)::int as n from probe_locked`)
    expect(rowsOf(result)).toEqual([{ n: 1 }])
  })

  // ⚠️ 这条**不是**驱动本次改动的 RED——不做任何加锁它也是绿的。写进来是为了守**将来**：
  // 若哪天换成会话级 `pg_advisory_lock` 而忘了 `finally` 里解锁，锁会漏在连接上，
  // 此后每次 `migrate()` 都挂住，且现象是「卡住」不是「报错」，排查代价很高。
  // 它的有效性是用**变异**验过的（改成会话级锁不解锁 ⇒ 本条红），不是「看着像有用」。
  test("migrate 跑完不留残余的 advisory 锁（失败路径同样不留）", async () => {
    const db = freshDb()

    await migrate(db)
    await errorOf(
      withTempMigrations({ "0001_broken.sql": "select * from no_such_table_xyz" }, (dir) => migrate(db, dir)),
    )

    const result = await db.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`)
    expect(rowsOf(result)).toEqual([{ n: 0 }])
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
