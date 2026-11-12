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

/**
 * 取 PG 的 SQLSTATE（如唯一冲突 `23505`）。
 *
 * bun 的 `PostgresError` 把 SQLSTATE 放在 `errno`；drizzle 的 `DrizzleQueryError` 会把它
 * 包在 `cause` 里。用运行时收窄而不是类型断言：断言版本被 `no-unsafe-type-assertion` 拦。
 */
function sqlstateOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const 直接 = Reflect.get(error, "errno")
  if (typeof 直接 === "string") return 直接
  const cause = Reflect.get(error, "cause")
  if (typeof cause !== "object" || cause === null) return undefined
  const 包裹 = Reflect.get(cause, "errno")
  return typeof 包裹 === "string" ? 包裹 : undefined
}

const 项目 = "prj-schema-p2"
const 项目乙 = `${项目}-乙`

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

    // 主键列集合必须**恰为** {id, project_id}：后续任务的 `on conflict (project_id, id)`
    // 与跨项目隔离都靠它，只查 tables 会把「主键退化成单列 (id)」放过去。
    // `string_agg` 按列名排序 ⇒ 期望值为固定字符串；失败时 diff 直接显示表名与实得列。
    const 主键 = rowsOf(
      await db().execute(sql`
        select t.relname as table_name,
               string_agg(a.attname, ',' order by a.attname) as columns
          from pg_constraint c
          join pg_class t on t.oid = c.conrelid
          join pg_namespace n on n.oid = t.relnamespace
          cross join lateral unnest(c.conkey) as k(attnum)
          join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
         where n.nspname = 'auth' and c.contype = 'p'
           and t.relname in ('case_entity_alias', 'case_event_participant', 'case_card_template')
         group by t.relname
         order by t.relname
      `),
    ).map((r) => [r.table_name, r.columns])
    expect(主键).toEqual([
      ["case_card_template", "id,project_id"],
      ["case_entity_alias", "id,project_id"],
      ["case_event_participant", "id,project_id"],
    ])
  })

  test("case_event 五个新列的默认值与可空性", async () => {
    const 列们 = rowsOf(
      await db().execute(sql`
        select column_name, is_nullable, data_type, column_default,
               numeric_precision, numeric_scale
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
    expect(按名.get("currency")).toMatchObject({ is_nullable: "NO", data_type: "text" })
    expect(按名.get("amount")).toMatchObject({
      is_nullable: "YES",
      data_type: "numeric",
      numeric_precision: 18,
      numeric_scale: 2,
    })
    expect(按名.get("occurred_end")).toMatchObject({ is_nullable: "YES", data_type: "integer" })
    expect(按名.get("template_id")).toMatchObject({ is_nullable: "YES", data_type: "text" })

    // 默认值钉到 PG 的规范形：`{}` 必须是 jsonb 空对象、货币必须是 CNY，而不是「包含这些字符」。
    expect(String(按名.get("attrs")?.column_default)).toBe("'{}'::jsonb")
    expect(String(按名.get("currency")?.column_default)).toBe("'CNY'::text")
  })

  test("参与者表同一事件同一 ordinal 只许一行，且不跨项目互斥", async () => {
    await db().execute(sql`
      insert into auth.case_event_participant
        (id, project_id, event_id, entity_id, role, mention_text, ordinal)
      values ('p-a', ${项目}, 'ev-1', null, '付款方', '6217', 0)
    `)

    let 捕获: unknown
    try {
      await db().execute(sql`
        insert into auth.case_event_participant
          (id, project_id, event_id, entity_id, role, mention_text, ordinal)
        values ('p-b', ${项目}, 'ev-1', null, '收款方', '6222', 0)
      `)
    } catch (error) {
      捕获 = error
    }
    // 不能只断言「抛了错」：表不存在之类的任何错误都会被当成成功。
    expect(捕获).toBeDefined()
    expect(sqlstateOf(捕获)).toBe("23505")

    // 约束必须是 (project_id, event_id, ordinal)：换项目后同样的 (event_id, ordinal) 要允许。
    // 若误写成 UNIQUE (event_id, ordinal)，这条插入会撞 23505 而红。
    await db().execute(sql`
      insert into auth.case_event_participant
        (id, project_id, event_id, entity_id, role, mention_text, ordinal)
      values ('p-乙', ${项目乙}, 'ev-1', null, '付款方', '6217', 0)
    `)
  })
})
