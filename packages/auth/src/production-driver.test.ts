import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { sql } from "drizzle-orm"
import { connect } from "./db"
import { login } from "./login"
import { migrate, rollback, rowsOf } from "./migrate"
import { pgErrorCode } from "./pg-errors"
import { DEFAULT_PASSWORD } from "./policy"
import { DuplicatePoliceNoError, registerUser, type RegisterInput } from "./register"

/**
 * **生产驱动 × 真库** 的回归。
 *
 * 002 收尾测试路由报告 §4.1-A 标的缺口：`db.test.ts` 只用**类型标注**钉住生产驱动
 * （`PG_PORT: "1"`，靠惰性连接不碰网络），`migrate.test.ts:56` 也自己写着「bun-sql 那支
 * 离线跑不到真库」。于是 002 全程**没有任何一条断言真正执行过 `drizzle-orm/bun-sql` 这一支**——
 * 而 T003 期间正是在这条路径上抓到过真问题（两个驱动的 `execute()` 结果形状不同，
 * 见 `migrate.ts` 的 `rowsOf` 与 state.md 裁定 ④）。
 *
 * 本文件把它补上：同一个 PG 语义引擎（PGlite = 编译成 WASM 的 PostgreSQL），
 * 经 TCP 暴露，让**生产条目 `connect()`** 连上去真跑。
 *
 * 为什么不是内存替身 / mock：本文件测的就是「生产驱动这一支」，替身会让被测对象消失。
 * 为什么不开 Docker：本机 `docker: command not found`（亦无本地 PG 二进制），
 * PGlite + socket 是离线可得且与生产同为 PostgreSQL 语义的真库。
 *
 * ⚠️ **残差（说清楚，不假装闭合）**：服务端是 **WASM 构建的 PG**，不是生产那个 PG 二进制 /
 * 版本。所以本文件闭合的是**驱动那一半**（序列化、结果解析、错误对象形状——这些是自己写的、
 * 会错的那一半），**不**闭合「与生产 PG 同版本同构建」。后者仍需一个真 PG 实例，
 * 应由 CI 提供（本 feature 无此闸）。
 */

/** 让被测代码抛出的错原样交回来（drizzle 的 `execute()` 是懒 thenable，需 await 才真执行）。 */
async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (cause) {
    return cause
  }
}

/**
 * 起一个真 PG，经 TCP 暴露，用**生产条目 `connect()`** 连上去。
 *
 * 走 `connect()` 而不是直接 `drizzle(url)`：前者才是生产入口，顺带把
 * `resolveDatabaseUrl` 的 PG_* 拼装也纳入被测范围。
 */
async function withProductionDb<T>(fn: (db: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const pg = new PGlite()
  // port 0 = 让 OS 挑一个空闲端口，避免与并行跑的其他用例抢端口。
  const server = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0 })
  await server.start()

  // 走公开的 getServerConn()（形如 "127.0.0.1:54321"）——`server.server` 是 private，
  // 运行时拿得到、类型层拿不到，用它会让 typecheck 红。
  const conn = server.getServerConn()
  const port = conn.slice(conn.lastIndexOf(":") + 1)

  try {
    return await fn(
      connect({
        PG_HOST: "127.0.0.1",
        PG_PORT: port,
        PG_USER: "postgres",
        PG_PASSWORD: "postgres",
        PG_DATABASE: "postgres",
      }),
    )
  } finally {
    await server.stop()
    await pg.close()
  }
}

const SECRET = "test-secret"

const input = (policeNo: string): RegisterInput => ({
  policeNo,
  name: "张三",
  idCard: "110101199001011234",
  phone: "13800000000",
  org: "市局",
  dept: "刑侦支队",
  section: "一大队",
  status: 1,
})

describe("生产驱动 (bun-sql) × 真库", () => {
  // 形态承诺第一次在**真连接**上被验证：此前只有 db.test.ts 的类型标注 + migrate.test.ts
  // 对字面量的单元断言。若 bun-sql 哪天改成 { rows }，这里先红。
  test("连上真库并执行 SQL：结果是裸行数组（不是 { rows }）", async () => {
    await withProductionDb(async (db) => {
      const result = await db.execute(sql`select 1 as one`)

      expect(Array.isArray(result)).toBe(true)
      expect(rowsOf(result)).toEqual([{ one: 1 }])
    })
  })

  // 这条同时压住 rowsOf 的 bun-sql 分支：appliedVersions() 若取不出行会抛
  // 「无法从查询结果中取出行」，migrate 的第二次调用就过不去。
  test("migrate 在生产驱动上跑通，且第二次幂等", async () => {
    await withProductionDb(async (db) => {
      expect(await migrate(db)).toEqual(["0001_init", "0002_deactivated_at", "0003_flags_not_null"])
      expect(await migrate(db)).toEqual([])
    })
  })

  // 最高价值的一条：`pgErrorCode` 钻的是 `thrown.cause.code`——那是 **PGlite 侧**实测出来的
  // 错误对象形状。bun-sql 若把 SQLSTATE 挂在别处，生产里 `registerUser` 就**静默不再翻译**
  // 重复警号，管理员看到的是内部报错而不是「该警号已录入」。这条钉的就是这个。
  test("重复警号的 UNIQUE 在生产驱动上被真库拦下，并翻译成领域错误", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      await registerUser(db, input("000001"))

      const thrown = await failureOf(() => registerUser(db, input("000001")))

      expect(thrown).toBeInstanceOf(DuplicatePoliceNoError)
      // 原始 SQLSTATE 仍可达，排查线索没丢（与 register.test.ts 的同名断言同义）。
      // 注意探的是 `thrown` 自己、不是 `thrown.cause`：I2 之后 `cause` 已换成
      // `{ code: "23505" }` 这个**纯数据**替身，原始 drizzle 错误不再挂在错误对象上
      // （它的 message 内联了 insert 的查询参数——含 password_hash / id_card / phone）。
      expect(pgErrorCode(thrown)).toBe("23505")
    })
  })

  // 压住 select() 的解析形状：bun-sql 若返回 { rows }，login 会读不到行、判成凭证错误。
  test("registerUser + login 在生产驱动上跑通（select 解析成行数组）", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      const { id } = await registerUser(db, input("000001"))

      const result = await login(db, { policeNo: "000001", password: DEFAULT_PASSWORD }, SECRET)

      expect(result.subject.id).toBe(id)
      expect(result.subject.name).toBe("张三")
      expect(result.mustChangePw).toBe(true)
    })
  })

  // 以前这里只回滚 `0001_init` 一把删表——那是**越过 head 回滚**，现在被 rollback 的守卫拒绝
  // （见 migrate.ts：会让账与 schema 永久背离）。改成按逆序回滚到空库：语义相同（可逆），
  // 而且顺带在生产驱动上把**三个** down 脚本都跑了一遍。
  test("rollback 在生产驱动上可逆（按逆序回滚到空库）", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      await rollback(db, "0003_flags_not_null")
      await rollback(db, "0002_deactivated_at")
      await rollback(db, "0001_init")

      const result = await db.execute(sql`
        select count(*)::int as n from information_schema.tables
        where table_schema = 'auth' and table_name = 'user'
      `)

      expect(rowsOf(result)).toEqual([{ n: 0 }])
    })
  })
})
