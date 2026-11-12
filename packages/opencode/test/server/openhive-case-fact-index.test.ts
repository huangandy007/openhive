import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"

/**
 * 索引的结构见证。
 *
 * 这里**只**钉「索引建出来了、列序对、下发到每个分区」——
 * 「规划器会不会用它」在 5 行数据上测不出来（小表永远选 Seq Scan），
 * 归 Task 6 的真栈 `EXPLAIN (ANALYZE)` 基线。别把这条用例写成 A22 已覆盖（`#004-03`）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})

afterAll(async () => {
  await pg?.stop()
})

describe("迁移 0037 · case_fact_row 时间索引", () => {
  test("父索引存在，列序是 (project_id, started_at)", async () => {
    const 行们 = rowsOf(
      await 库().execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'auth' and indexname = 'case_fact_row_project_started'
      `),
    )
    expect(行们).toHaveLength(1)
    expect(String(行们[0]?.indexdef)).toContain("(project_id, started_at)")
  })

  test("16 个分区各自拿到一条子索引，列序与父索引一致", async () => {
    // 按 `pg_inherits` 认亲、不按名字前缀匹配：PG 18 给分区子索引起的名字是按列名派生的
    // （`case_fact_row_pXX_project_id_started_at_idx`），不沿袭父索引名——
    // 按名字匹配等于把引擎的命名实现细节钉进用例，换个 PG 版本就假红。
    const 子索引 = rowsOf(
      await 库().execute(sql`
        select child.relname as indexname, tbl.relname as tablename, pg_get_indexdef(child.oid) as indexdef
          from pg_inherits i
          join pg_class child on child.oid = i.inhrelid
          join pg_index x on x.indexrelid = child.oid
          join pg_class tbl on tbl.oid = x.indrelid
         where i.inhparent = 'auth.case_fact_row_project_started'::regclass
         order by tablename
      `),
    )
    expect(子索引).toHaveLength(16)
    // 分区名是 p00..p15，少一个就是「父表建了、某个分区没下发」——这在本仓是真实故障形态。
    expect(子索引[0]?.tablename).toBe("case_fact_row_p00")
    expect(子索引[15]?.tablename).toBe("case_fact_row_p15")
    for (const 行 of 子索引) expect(String(行.indexdef)).toContain("(project_id, started_at)")
  })

  test("索引已存在时同一条 IF NOT EXISTS 再执行两次不抛错（部署脚本先建、migrate 再跑的幂等路径）", async () => {
    // 模拟「部署侧脚本先建、随后 migrate() 再跑」：先让索引不存在，再原样重放迁移里那条语句两次。
    // 去掉 `IF NOT EXISTS` 后第二次必抛 42P07（变异实得见报告），这正是文件头 :12-14 的论证。
    await 库().execute(sql`drop index if exists auth.case_fact_row_project_started`)
    const 建索引 = sql`CREATE INDEX IF NOT EXISTS case_fact_row_project_started
      ON auth.case_fact_row (project_id, started_at)`
    await 库().execute(建索引)
    await 库().execute(建索引)
    const 行们 = rowsOf(
      await 库().execute(sql`
        select indexname from pg_indexes
         where schemaname = 'auth' and indexname = 'case_fact_row_project_started'
      `),
    )
    expect(行们).toHaveLength(1)
  })
})
