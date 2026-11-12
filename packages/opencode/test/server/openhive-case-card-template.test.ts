import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  资金模板id,
  资金模板插槽,
  校验槽位种类,
  确保内置模板,
} from "../../src/server/openhive/case-card-template"

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

describe("槽位种类硬校验（Q18）", () => {
  test("内置资金模板自检通过", () => {
    expect(校验槽位种类(资金模板插槽)).toEqual([])
  })

  test("时间列放进「多少钱」被拒", () => {
    const 错 = 校验槽位种类({ ...资金模板插槽, 多少钱: { 字段: "startedAt" } })
    expect(错).toHaveLength(1)
    expect(错[0]).toContain("多少钱")
    expect(错[0]).toContain("startedAt")
  })

  test("金额列塞进「其他」也被拒——绕不过算法（§4.7.5）", () => {
    const 错 = 校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "amount" }] })
    expect(错.some((e) => e.includes("其他"))).toBe(true)
  })

  test("「其他」只收 extras 字段；「何地」只收地点类", () => {
    expect(校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "balance" }] })).toEqual([])
    expect(校验槽位种类({ ...资金模板插槽, 何地: { 字段: "address" } })).toEqual([])
    expect(校验槽位种类({ ...资金模板插槽, 何地: { 字段: "merchant" } }).some((e) => e.includes("何地"))).toBe(true)
  })

  test("词表外的字段键被拒", () => {
    // @ts-expect-error 故意的非法字段名
    const 错 = 校验槽位种类({ 谁: { 字段: "notAField" } })
    expect(错.some((e) => e.includes("notAField"))).toBe(true)
  })
})

describe("内置模板行（Q15）", () => {
  test("按项目懒建一次，verified_at 非空，重复调用不新增行", async () => {
    const 项目 = "prj-template"
    const a = await 确保内置模板(db(), 项目)
    const b = await 确保内置模板(db(), 项目)
    expect(a).toBe(资金模板id)
    expect(b).toBe(资金模板id)
    const 行 = rowsOf(
      await db().execute(sql`
        select id, event_type, version, verified_at, required
          from auth.case_card_template
         where project_id = ${项目}
      `),
    )
    expect(行).toHaveLength(1)
    expect(行[0]?.event_type).toBe("资金交易")
    expect(行[0]?.verified_at).not.toBeNull()
    expect(行[0]?.version).toBe(1)
  })
})
