import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { resolveDatabaseUrl } from "./db"

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

describe("PG 工具链", () => {
  test("drizzle + PGlite 能在进程内执行 SQL", async () => {
    const db = drizzle({ client: new PGlite() })

    const result = await db.execute(sql`select 1 as one`)

    expect(result.rows).toEqual([{ one: 1 }])
  })
})
