import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  find_crossings,
  query_entities,
  query_events,
  query_relations,
  type 工具上下文,
} from "../../src/server/openhive/case-mcp-tools"
import { 确保内置模板 } from "../../src/server/openhive/case-card-template"
import { 翻译资金 } from "../../src/server/openhive/case-translate"
import { 写入翻译结果 } from "../../src/server/openhive/case-translate-store"

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
function ctx(projectId: string): 工具上下文 {
  return { db: db(), 身份: { userId: "u-a11", projectId } }
}

const 项目 = "prj-id-a11"

beforeAll(async () => {
  const templateId = await 确保内置模板(db(), 项目)
  const 翻译 = 翻译资金({
    projectId: 项目,
    materialId: "m1",
    rows: [
      {
        projectId: 项目,
        materialId: "m1",
        sheet: "Sheet1",
        rowNo: 2,
        startedAt: 1731117303,
        startedRaw: "2024-11-09 09:15:03",
        precision: "到秒",
        amount: "5000.00",
        direction: "付",
        counterparty: "6222021234567890123",
        counterpartyName: "李四",
        ownerAccount: "6217001234567896514",
        currency: "CNY",
        extras: { ownerName: "张三" },
      },
    ],
  })
  await 写入翻译结果(db(), { projectId: 项目, materialId: "m1", templateId, 翻译 })
})

describe("A11 验收：只有户名没有身份证", () => {
  test("问「张三」⇒ 答「户名为「张三」的账户」+ 未核实身份 + 真实汇总（不是 0 笔）", async () => {
    const 结果 = await aggregate_money(ctx(项目), { 账户: "张三" })
    expect(结果.摘要.startsWith("户名为「张三」的账户")).toBe(true)
    expect(结果.摘要).toContain("户名匹配，未核实身份")
    expect(结果.身份?.[0]?.档).toBe("户名匹配")
    // 不用 `as` 窄化 `unknown`：本仓 oxlint 会记一条新告警（`openhive-case-empty-reason.test.ts`
    // 同款处理）。`toMatchObject` 钉的是同一个值：1 笔、合计 5000.00，不是 0 笔。
    expect(结果.数据).toMatchObject({ 汇总: [{ 方向: "出", 笔数: 1, 合计: "5000.00" }] })
  })
})

describe("三档口径写进每个涉及实体的工具", () => {
  test("五个工具的 口径 都含「身份三档（已核实 / 户名匹配 / 无匹配）」", async () => {
    const 口径们 = [
      (await aggregate_money(ctx(项目), { 账户: "张三" })).口径,
      (await query_relations(ctx(项目), { 实体: "张三" })).口径,
      (await query_events(ctx(项目), { 参与实体: "张三" })).口径,
      (await query_entities(ctx(项目), { 关键词: "张三" })).口径,
      (await find_crossings(ctx(项目), { 甲: "张三", 乙: "李四" })).口径,
    ]
    for (const 口径 of 口径们) expect(口径).toContain("身份三档（已核实 / 户名匹配 / 无匹配）")
  })
})
