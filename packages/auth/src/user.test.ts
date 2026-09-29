import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { getTableColumns, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import { user } from "./user"

describe("用户表模型", () => {
  test("防漂移：drizzle 模型与迁移建出的表逐列一致（名字 + 可空性）", async () => {
    const db = drizzle({ client: new PGlite() })
    await migrate(db)

    const migrated = await db.execute(sql`
      select column_name, is_nullable from information_schema.columns
      where table_schema = 'auth' and table_name = 'user'
      order by column_name
    `)

    const modeled = Object.values(getTableColumns(user))
      .map((column) => ({ column_name: column.name, is_nullable: column.notNull ? "NO" : "YES" }))
      .sort((a, b) => a.column_name.localeCompare(b.column_name))

    // 迁移是表的真相来源，drizzle 模型只负责类型安全查询；两边不齐 = 有人只改了一侧。
    expect(migrated.rows).toEqual(modeled)
  })
})
