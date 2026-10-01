import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { connect, resolveDatabaseUrl } from "./db"
import type { UserAccountTarget } from "./user"
import type { MigrationTarget } from "./migrate"
import type { UserInsertTarget } from "./register"

/** 让被测代码抛出的错原样交回来（drizzle 的 `execute()` 是懒 thenable，需 await 才真执行）。 */
async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (cause) {
    return cause
  }
}

describe("resolveDatabaseUrl", () => {
  test("由 PG_* 环境变量拼出连接串", () => {
    expect(
      resolveDatabaseUrl({
        PG_HOST: "db.internal",
        PG_PORT: "5432",
        PG_USER: "openhive",
        PG_PASSWORD: "s3cret",
        PG_DATABASE: "openhive",
      }),
    ).toBe("postgres://openhive:s3cret@db.internal:5432/openhive")
  })

  test("缺必填项时点名报错", () => {
    expect(() => resolveDatabaseUrl({ PG_HOST: "db.internal" })).toThrow("PG_PORT")
  })

  test("密码含 URL 保留字符时转义，不破坏连接串结构", () => {
    expect(
      resolveDatabaseUrl({
        PG_HOST: "db.internal",
        PG_PORT: "5432",
        PG_USER: "openhive",
        PG_PASSWORD: "p@ss:w/rd",
        PG_DATABASE: "openhive",
      }),
    ).toBe("postgres://openhive:p%40ss%3Aw%2Frd@db.internal:5432/openhive")
  })
})

describe("connect", () => {
  const complete = {
    PG_HOST: "127.0.0.1",
    PG_PORT: "1",
    PG_USER: "openhive",
    PG_PASSWORD: "p",
    PG_DATABASE: "openhive",
  }

  test("缺环境变量时点名报错，不静默连到别的库", () => {
    expect(() => connect({})).toThrow("PG_HOST")
  })

  // 这条的断言主体是那行**类型标注**，不是 expect：它保证生产驱动能被迁移运行器直接消费。
  // T003 期间它抓到过真问题——bun-sql 的 execute() 解析成裸行数组，PGlite 解析成 { rows }。
  test("环境变量齐全即可构造，且生产驱动满足迁移运行器接口", () => {
    const target: MigrationTarget = connect(complete)

    expect(typeof target.execute).toBe("function")
  })

  // 同上，这条的断言主体也是那行**类型标注**：证明录入走的窄接口在 bun-sql 上也成立。
  // 没有它，`UserInsertTarget` 就只被测试用的 PGlite 验证过，生产驱动无人担保。
  test("生产驱动满足录入接口", () => {
    const target: UserInsertTarget = connect(complete)

    expect(typeof target.insert).toBe("function")
  })

  // 同上：登录要查人和记登录，生产驱动也得满足。这条同时说明「select 解析成行数组」这一
  // 形状承诺在 bun-sql 上成立（PGlite 侧由 login.test.ts 在运行时实测）。
  test("生产驱动满足登录接口", () => {
    const target: UserAccountTarget = connect(complete)

    expect(typeof target.select).toBe("function")
    expect(typeof target.update).toBe("function")
  })

  describe("连接超时（T023）", () => {
    /**
     * 收一份「**连得上、但不回话**」的 TCP 端点：三次握手成功，之后永远不发 PG 的启动响应。
     *
     * 为什么需要它——「端口没人听」那条路走不出 `connect` 的超时：OS 直接回 ECONNREFUSED，
     * **立刻**失败，无论配没配超时。要真正踩到超时，必须有一个**接受连接后装死**的对端，
     * 否则测的是「连接被拒」，不是「等不到响应」。
     */
    // ⚠️ **不要给这个函数写返回类型标注**：`ReturnType<typeof Bun.listen>` 取的是**最后一个**
    // 重载（`UnixSocketListener`），于是 `server.port` 在类型层不存在——而 TCP 那个重载才有。
    // 让 `{ hostname, port }` 自己选中 `TCPSocketListener`。
    const silentEndpoint = () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })

    /** 取 drizzle 包在 `cause` 上的驱动错误码。用 `in` 收窄，不用 `as`（lint 挡 `as`）。 */
    const causeCodeOf = (thrown: unknown): unknown => {
      if (typeof thrown !== "object" || thrown === null || !("cause" in thrown)) return undefined
      const cause: unknown = thrown.cause
      if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined
      return cause.code
    }

    test("PG 不回话时快速失败，不挂在那里等", async () => {
      const server = silentEndpoint()

      try {
        const db = connect({ ...complete, PG_PORT: String(server.port) })
        const started = Bun.nanoseconds()
        const thrown = await failureOf(() => db.execute(sql`select 1 as one`))
        const elapsedMs = (Bun.nanoseconds() - started) / 1e6

        // ⚠️ 断言主体是**时间**，且门槛**刻意不引用 `db.ts` 那个常量**：引用它等于让测试
        // 跟着实现走，那「有人把常量改大」这件最该被发现的事就永远发现不了。
        // 参照物是 Bun 自己的默认连接超时 **30 秒**（`bun-types/sql.d.ts` 的 `@default 30`）：
        // 没配超时的实现会一直等到那一刻，本任务要的是「明显快于它」。
        //
        // 门槛为什么是 6 秒（变异实测定的，不是拍的）：常量 3 秒时实测跑出 **3000ms 上下、
        // 漂移 ~20ms**，故 6 秒留了 3 秒余量；同时它能抓住「常量改到 6 秒以上」的回归——
        // 8 秒那档实测 `8013ms` ⇒ 红。
        // ⚠️ **边界说清楚**：门槛以下（改成 4 秒、5 秒）**抓不到**。那档没被拦是因为
        // 「比 3 秒慢一两秒」够不上要拦的回归；真正要防的是「配置被删」与「改回默认 30 秒」，
        // 两者分别是 20 秒超时与 30 秒超时，都稳稳落在门槛之上。
        expect(elapsedMs).toBeLessThan(6_000)
        expect(causeCodeOf(thrown)).toBe("ERR_POSTGRES_CONNECTION_TIMEOUT")
      } finally {
        server.stop(true)
      }
    }, 20_000)
  })
})

describe("PG 工具链", () => {
  test("drizzle + PGlite 能在进程内执行 SQL", async () => {
    const db = drizzle({ client: new PGlite() })

    const result = await db.execute(sql`select 1 as one`)

    expect(result.rows).toEqual([{ one: 1 }])
  })
})
