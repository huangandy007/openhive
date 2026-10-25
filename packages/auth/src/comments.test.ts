import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate, rowsOf } from "./migrate"

/**
 * 0008 的中文注释是否真的落到了库里。
 *
 * 为什么值得一条测试：`COMMENT ON` 写错表名 / 列名时 PG 会报错，但**漏写**一条不会——
 * 迁移照样成功、库里就是少一段说明。这条用例遍历整个 `auth` schema，把「漏写」变成红色。
 *
 * ⚠️ 它同时是一条**给未来迁移的约束**：新增表或列却忘了写注释，这里会红。
 * 这不是误伤——用户明确要求字段带中文说明（2026-10-25）。
 */

function freshDb() {
  return drizzle({ client: new PGlite() })
}

const HAS_CHINESE = /\p{Script=Han}/u

describe("auth schema 的中文注释（0008）", () => {
  test("每张表、每个字段都有非空中文注释", async () => {
    const db = freshDb()
    await migrate(db)

    const tables = rowsOf(
      await db.execute(sql`
        select c.relname, obj_description(c.oid, 'pg_class') as comment
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relkind = 'r'
        order by c.relname
      `),
    )

    // 防止「零张表 ⇒ 没有缺失 ⇒ 绿」的空转。
    expect(tables.length).toBeGreaterThanOrEqual(8)
    expect(tables.filter((row) => typeof row.comment !== "string" || row.comment.trim() === "")).toEqual([])
    expect(tables.filter((row) => !HAS_CHINESE.test(String(row.comment)))).toEqual([])

    const columns = rowsOf(
      await db.execute(sql`
        select c.relname, a.attname, col_description(c.oid, a.attnum) as comment
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'auth' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        order by c.relname, a.attnum
      `),
    )

    expect(columns.length).toBeGreaterThanOrEqual(45)
    expect(columns.filter((row) => typeof row.comment !== "string" || row.comment.trim() === "")).toEqual([])
    expect(columns.filter((row) => !HAS_CHINESE.test(String(row.comment)))).toEqual([])
  })

  test("关键字段的说明写清了取值闭集、单位与特殊语义", async () => {
    const db = freshDb()
    await migrate(db)

    const columns = rowsOf(
      await db.execute(sql`
        select c.relname, a.attname, col_description(c.oid, a.attnum) as comment
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'auth' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      `),
    )
    const commentOf = new Map(
      columns.map((row) => [`${String(row.relname)}.${String(row.attname)}`, String(row.comment)]),
    )

    expect(commentOf.get("user.police_no")).toContain("警号")
    expect(commentOf.get("user.status")).toContain("1 启用 / 0 停用")
    expect(commentOf.get("user.deactivated_at")).toContain("三分语义")
    expect(commentOf.get("role_resource.perm")).toContain("read / write / review / admin")
    expect(commentOf.get("project_archive.archived_at")).toContain("Unix 秒")
    expect(commentOf.get("project_backup_event.scope")).toContain("空串表示整个项目")

    const schema = rowsOf(
      await db.execute(sql`select obj_description(oid, 'pg_namespace') as comment from pg_namespace where nspname = 'auth'`),
    )
    expect(String(schema[0]?.comment)).toContain("openhive")
  })
})
