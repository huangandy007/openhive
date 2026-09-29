import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { connect, resolveDatabaseUrl } from "./db"
import type { MigrationTarget } from "./migrate"

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
})

describe("PG 工具链", () => {
  test("drizzle + PGlite 能在进程内执行 SQL", async () => {
    const db = drizzle({ client: new PGlite() })

    const result = await db.execute(sql`select 1 as one`)

    expect(result.rows).toEqual([{ one: 1 }])
  })
})
