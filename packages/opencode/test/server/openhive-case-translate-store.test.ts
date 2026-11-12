import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 清本材料翻译, 写入翻译结果 } from "../../src/server/openhive/case-translate-store"
import { 确保内置模板 } from "../../src/server/openhive/case-card-template"
import { 翻译资金 } from "../../src/server/openhive/case-translate"
import type { FactRowInput } from "../../src/server/openhive/case-store"

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

const 项目 = "prj-store"

function 行(over: Partial<FactRowInput> = {}): FactRowInput {
  return {
    projectId: 项目,
    materialId: "m1",
    sheet: "Sheet1",
    rowNo: 2,
    startedAt: 1731117303,
    startedRaw: "2024-11-09 09:15:03",
    precision: "到秒",
    amount: "5000.00",
    balance: "12300.00",
    direction: "付",
    counterparty: "6222021234567890123",
    counterpartyName: "李四",
    ownerAccount: "6217001234567896514",
    currency: "CNY",
    extras: { ownerName: "张三" },
    ...over,
  }
}

async function 写(materialId: string, rows: FactRowInput[]) {
  const templateId = await 确保内置模板(db(), 项目)
  const 翻译 = 翻译资金({ projectId: 项目, materialId, rows })
  return 写入翻译结果(db(), { projectId: 项目, materialId, templateId, 翻译 })
}

describe("写入翻译结果", () => {
  test("卡片 + 两张参与者 + 一处出处 + 两条别名 + 两个账户实体", async () => {
    const r = await 写("m1", [行()])
    expect(r.卡片数).toBe(1)

    const 事件 = rowsOf(
      await db().execute(sql`
        select id, type, amount, occurred_at, precision, currency, template_id, attrs
          from auth.case_event where project_id = ${项目} and id like '%'
      `),
    )
    expect(事件).toHaveLength(1)
    expect(事件[0]).toMatchObject({
      type: "资金交易",
      precision: "到秒",
      currency: "CNY",
      template_id: "内置:资金/v1",
    })
    expect(String(事件[0]?.amount)).toBe("5000.00")
    // bun-sql 把 jsonb 读成对象（PGlite 的其它读法见过 JSON 文本，两种都认）。
    const 原始属性 = 事件[0]?.attrs
    const 卡片属性 = typeof 原始属性 === "string" ? JSON.parse(原始属性) : 原始属性
    expect(卡片属性).toEqual({ 余额: "12300.00" })

    const 参与 = rowsOf(
      await db().execute(sql`
        select role, mention_text, ordinal, entity_id
          from auth.case_event_participant
         where project_id = ${项目} and event_id = ${eventsId(事件[0])}
         order by ordinal
      `),
    )
    expect(参与.map((p) => p.role)).toEqual(["付款方", "收款方"])
    expect(参与.every((p) => typeof p.entity_id === "string")).toBe(true)

    const 引用 = rowsOf(
      await db().execute(sql`
        select fact_type, locator from auth.case_citation
         where project_id = ${项目} and material_id = 'm1'
      `),
    )
    expect(引用).toHaveLength(1)
    expect(引用[0]?.fact_type).toBe("event")

    const 别名 = rowsOf(
      await db().execute(sql`
        select kind, value, raw_value, material_id, revoked_at
          from auth.case_entity_alias where project_id = ${项目} order by value
      `),
    )
    expect(别名.map((a) => a.value)).toEqual(["张三", "李四"])
    expect(别名.every((a) => a.kind === "户名" && a.material_id === "m1" && a.revoked_at === null)).toBe(true)

    const 实体 = rowsOf(
      await db().execute(sql`select type, canonical_value from auth.case_entity where project_id = ${项目}`),
    )
    expect(实体).toHaveLength(2)
    expect(实体.every((e) => e.type === "账户")).toBe(true)
  })

  test("同一账号多行只查库一次（内存 Map）", async () => {
    const 多行 = Array.from({ length: 5 }, (_, i) => 行({ materialId: "m2", rowNo: 2 + i }))
    const r = await 写("m2", 多行)
    expect(r.卡片数).toBe(5)
    const 实体 = rowsOf(
      await db().execute(sql`select id from auth.case_entity where project_id = ${项目} and type = '账户'`),
    )
    expect(实体).toHaveLength(2) // 复用 m1 建的两个，不新增
  })

  test("重放：先清后写，卡片/参与者/别名不重复", async () => {
    await 清本材料翻译(db(), 项目, "m2")
    await 写("m2", [行({ materialId: "m2" })])
    const 事件 = rowsOf(
      await db().execute(sql`select id from auth.case_event where project_id = ${项目}`),
    )
    expect(事件).toHaveLength(2) // m1 一条 + m2 一条，不是 m2 的两条
    const 别名 = rowsOf(
      await db().execute(sql`
        select id, revoked_at from auth.case_entity_alias
         where project_id = ${项目} and material_id = 'm2'
      `),
    )
    expect(别名).toHaveLength(2)
    // 撤销不是删除：重写把它们清回未撤销，而不是另插两条。
    expect(别名.every((a) => a.revoked_at === null)).toBe(true)
  })

  test("重放行数变少：参与者按事件级联清、出处只留本次写的（Q14）", async () => {
    // 两行 → 两个事件 / 四条参与者 / 两条出处；重放成一行 ⇒ 旧事件与它的参与者必须消失。
    await 写("m5", [行({ materialId: "m5", rowNo: 2 }), 行({ materialId: "m5", rowNo: 3 })])
    await 清本材料翻译(db(), 项目, "m5")
    await 写("m5", [行({ materialId: "m5", rowNo: 2 })])

    const 孤儿 = rowsOf(
      await db().execute(sql`
        select p.id from auth.case_event_participant p
         where p.project_id = ${项目}
           and not exists (
             select 1 from auth.case_event e
              where e.project_id = p.project_id and e.id = p.event_id
           )
      `),
    )
    expect(孤儿).toHaveLength(0)
    const 引用 = rowsOf(
      await db().execute(sql`
        select id from auth.case_citation
         where project_id = ${项目} and material_id = 'm5' and fact_type = 'event'
      `),
    )
    expect(引用).toHaveLength(1)
  })

  test("按材料撤销别名：只清不写时留痕为已撤销，不硬删", async () => {
    await 写("m4", [行({ materialId: "m4" })])
    await 清本材料翻译(db(), 项目, "m4")
    const 别名 = rowsOf(
      await db().execute(sql`
        select revoked_at from auth.case_entity_alias
         where project_id = ${项目} and material_id = 'm4'
      `),
    )
    expect(别名).toHaveLength(2)
    expect(别名.every((a) => typeof a.revoked_at === "number")).toBe(true)
  })
})

/** 事件 id 从行里取，避免测试里重复算 hash。 */
function eventsId(行: Record<string, unknown> | undefined): string {
  const id = 行?.id
  if (typeof id !== "string") throw new Error("没有事件行")
  return id
}
