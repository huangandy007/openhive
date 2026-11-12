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

  test("「其他」只挡算法类（金额/时间/方向）；「何地」只收地点类", () => {
    // 余额、时长、地点进「其他」必须放行：前者是内置资金模板的既有填法，
    // 后者是设计 §4.7.2 话单模板的明文示例（`"其他": { "时长": "durationSec" }`）。
    expect(校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "balance" }] })).toEqual([])
    expect(校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "durationSec" }] })).toEqual([])
    expect(校验槽位种类({ ...资金模板插槽, 何地: { 字段: "address" } })).toEqual([])
    // 方向列落「其他」= 借贷方向丢失，收付会判反（§4.7.5 第二行）。
    expect(校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "direction" }] }).some((e) => e.includes("其他"))).toBe(
      true,
    )
    expect(校验槽位种类({ ...资金模板插槽, 何地: { 字段: "merchant" } }).some((e) => e.includes("何地"))).toBe(true)
    // §3.5「订餐：和谁 = 组织（商户）」——商户字段必须能落「和谁」，否则 Q18 会挡掉订餐模板。
    expect(校验槽位种类({ ...资金模板插槽, 和谁: [{ 字段: "merchant" }] })).toEqual([])
  })

  test("畸形输入返回错误清单而不是抛 TypeError", () => {
    // 模板 JSON 从库 / HTTP 来，不保证符合 `模板槽位`；校验边界必须不抛、不静默丢弃（评审探针两例）。
    expect(() => 校验槽位种类({ 其他: { 时长: "durationSec" } })).not.toThrow()
    const 嵌套对象 = 校验槽位种类({ 其他: { 时长: "durationSec" } })
    expect(嵌套对象).toHaveLength(1)
    expect(嵌套对象[0]).toContain("其他")
    expect(嵌套对象[0]).toContain("形状")

    const 字符串填法 = 校验槽位种类({ 谁: "ownerAccount" })
    expect(字符串填法).toHaveLength(1)
    expect(字符串填法[0]).toContain("谁")
    expect(字符串填法[0]).toContain("形状")

    // 数组里混入非对象：畸形条目报形状错，合法条目照旧校验（金额仍被拒），一条都不丢。
    const 混合 = 校验槽位种类({ ...资金模板插槽, 其他: [{ 字段: "amount" }, "oops"] })
    expect(混合).toHaveLength(2)
    expect(混合.some((e) => e.includes("其他") && e.includes("形状"))).toBe(true)
    expect(混合.some((e) => e.includes("金额"))).toBe(true)

    // 顶层不是对象也要给错误清单。
    expect(校验槽位种类(null)).toHaveLength(1)
  })

  test("词表外的字段键被拒", () => {
    // 入参是 unknown（校验边界），非法字段名由运行时词表拒绝。
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

  test("slots 变了 ⇒ version +1", async () => {
    const 项目 = "prj-template-version"
    await 确保内置模板(db(), 项目)
    await db().execute(sql`
      update auth.case_card_template
         set slots = '{"谁":{"字段":"ownerAccount"}}'::jsonb
       where project_id = ${项目} and id = ${资金模板id}
    `)
    await 确保内置模板(db(), 项目)
    const 行 = rowsOf(
      await db().execute(sql`
        select version from auth.case_card_template
         where project_id = ${项目} and id = ${资金模板id}
      `),
    )
    expect(行[0]?.version).toBe(2)
  })

  test("verified_at 一经写定不被重跑覆盖", async () => {
    const 项目 = "prj-template-verified"
    await 确保内置模板(db(), 项目)
    await db().execute(sql`
      update auth.case_card_template set verified_at = 1000000000
       where project_id = ${项目} and id = ${资金模板id}
    `)
    await 确保内置模板(db(), 项目)
    const 行 = rowsOf(
      await db().execute(sql`
        select verified_at from auth.case_card_template
         where project_id = ${项目} and id = ${资金模板id}
      `),
    )
    expect(行[0]?.verified_at).toBe(1000000000)
  })
})
