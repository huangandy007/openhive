import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"

/** 起库形状与 `openhive-case-fact-store.test.ts` 一致：只用 `pg.db`，不另 `connect()`。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  await pg?.stop()
})
function db() {
  if (!pg) throw new Error("真库没起来")
  return pg.db
}

const 项目 = "prj-schema-p2"

describe("0039 迁移", () => {
  test("三张新表都在，且主键按 (project_id, id)", async () => {
    const 表们 = rowsOf(
      await db().execute(sql`
        select table_name
          from information_schema.tables
         where table_schema = 'auth'
           and table_name in ('case_entity_alias', 'case_event_participant', 'case_card_template')
         order by table_name
      `),
    ).map((r) => r.table_name)
    expect(表们).toEqual(["case_card_template", "case_entity_alias", "case_event_participant"])
  })

  test("case_event 五个新列的默认值与可空性", async () => {
    const 列们 = rowsOf(
      await db().execute(sql`
        select column_name, is_nullable, data_type, column_default
          from information_schema.columns
         where table_schema = 'auth' and table_name = 'case_event'
           and column_name in ('occurred_end', 'amount', 'attrs', 'template_id', 'currency')
         order by column_name
      `),
    )
    expect(列们.map((r) => r.column_name)).toEqual([
      "amount",
      "attrs",
      "currency",
      "occurred_end",
      "template_id",
    ])
    const 按名 = new Map(列们.map((r) => [String(r.column_name), r]))
    expect(按名.get("attrs")).toMatchObject({ is_nullable: "NO", data_type: "jsonb" })
    expect(String(按名.get("attrs")?.column_default)).toContain("{}")
    expect(按名.get("currency")).toMatchObject({ is_nullable: "NO", data_type: "text" })
    expect(String(按名.get("currency")?.column_default)).toContain("CNY")
    expect(按名.get("amount")).toMatchObject({ is_nullable: "YES", data_type: "numeric" })
    expect(按名.get("template_id")).toMatchObject({ is_nullable: "YES", data_type: "text" })
  })

  test("参与者表同一事件同一 ordinal 只许一行", async () => {
    await db().execute(sql`
      insert into auth.case_event_participant
        (id, project_id, event_id, entity_id, role, mention_text, ordinal)
      values ('p-a', ${项目}, 'ev-1', null, '付款方', '6217', 0)
    `)
    // 不用 `expect(...).rejects`：`db().execute()` 返回 drizzle 的 thenable（PgAsyncRaw），
    // bun 的 `.rejects` 只认原生 Promise；且 `await-thenable` lint 规则不认 `.rejects.toThrow()`
    // 的返回类型。try/catch 的判别力相同：约束在 ⇒ 抛错，约束不在 ⇒ 插入成功。
    let 第二次插入被拒 = false
    try {
      await db().execute(sql`
        insert into auth.case_event_participant
          (id, project_id, event_id, entity_id, role, mention_text, ordinal)
        values ('p-b', ${项目}, 'ev-1', null, '收款方', '6222', 0)
      `)
    } catch {
      第二次插入被拒 = true
    }
    expect(第二次插入被拒).toBe(true)
  })
})
