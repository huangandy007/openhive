import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  find_crossings,
  query_entities,
  query_events,
  query_relations,
  type 工具上下文,
} from "../../src/server/openhive/case-mcp-tools"
import { insertRelation, upsertEntity } from "../../src/server/openhive/case-fact-store"
import { insertFactRows } from "../../src/server/openhive/case-store"
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
  return { db: db(), 身份: { userId: "u-id", projectId } }
}
async function 种流水(projectId: string, materialId: string, 户名: string, 本方: string, 对方: string) {
  const templateId = await 确保内置模板(db(), projectId)
  const 翻译 = 翻译资金({
    projectId,
    materialId,
    rows: [
      {
        projectId,
        materialId,
        sheet: "Sheet1",
        rowNo: 2,
        startedAt: 1731117303,
        startedRaw: "2024-11-09 09:15:03",
        precision: "到秒",
        amount: "5000.00",
        direction: "付",
        counterparty: 对方,
        counterpartyName: "李四",
        ownerAccount: 本方,
        currency: "CNY",
        extras: { ownerName: 户名 },
      },
    ],
  })
  await 写入翻译结果(db(), { projectId, materialId, templateId, 翻译 })
}
async function 账户id(projectId: string, 账号: string): Promise<string> {
  const 行 = rowsOf(
    await db().execute(sql`
      select id from auth.case_entity
       where project_id = ${projectId} and type = '账户' and canonical_value = ${账号}
    `),
  )
  return String(行[0]?.id)
}

const 项目 = "prj-id-tools"
const 张三账 = "6217001234567896514"
const 李四账 = "6222021234567890123"
beforeAll(async () => {
  await 种流水(项目, "m1", "张三", 张三账, 李四账)
})

describe("aggregate_money 的身份标注与措辞", () => {
  test("按户名查询 ⇒ 户名匹配，摘要写「户名为 X 的账户」并标未核实身份", async () => {
    const 结果 = await aggregate_money(ctx(项目), { 账户: "张三" })
    expect(结果.身份?.length).toBe(1)
    expect(结果.身份?.[0]).toMatchObject({ 实体: 张三账, 档: "户名匹配" })
    expect(结果.身份?.[0]?.说明).toContain("未核实身份")
    expect(结果.摘要.startsWith("户名为「张三」的账户")).toBe(true)
    expect(结果.摘要).toContain("（户名匹配，未核实身份）")
    expect(结果.数据).not.toBeNull()
  })

  test("空结果也带身份（档不随数据空而丢）", async () => {
    // 判定表第 1 条「确实没有交易」的前提是账户**有存在证据**（持有关系或明细行）。
    // brief 的翻译夹具只产生转账关系（无持有、无明细行），直接查会落兜底「无匹配行」
    // ——该前提不成立，与本用例要钉的「数据空但身份不丢」无关。这里按生产常态补一条
    // 明细行（`insertFactRows` 是 ingest 的写口，`#006-35` / `#006-11`），让空原因是
    // 判定表第 1 条而不是兜底。补的是**前置证据**，断言本身按 brief 原样保留。
    await insertFactRows(db(), [
      {
        projectId: 项目,
        materialId: "m1",
        sheet: "Sheet1",
        rowNo: 3,
        startedAt: 1731117304,
        startedRaw: "2024-11-09 09:15:04",
        amount: "1.00",
        ownerAccount: 张三账,
        currency: "CNY",
      },
    ])
    const 结果 = await aggregate_money(ctx(项目), { 账户: "张三", 起: 1800000000, 止: 1800000001 })
    expect(结果.空原因).toBe("确实没有交易")
    expect(结果.身份?.[0]?.档).toBe("户名匹配")
  })

  test("有实名登记证据 ⇒ 已核实，摘要不再写「未核实身份」", async () => {
    const 项目2 = "prj-id-tools-verified"
    await 种流水(项目2, "m1", "王五", "6217001234567890001", "6222021234567890002")
    const 账id = await 账户id(项目2, "6217001234567890001")
    await upsertEntity(db(), {
      id: "e-王五-tools",
      projectId: 项目2,
      type: "人",
      canonicalValue: "王五",
      aliases: [],
    })
    await insertRelation(db(), {
      id: "r-实名-tools",
      projectId: 项目2,
      fromId: 账id,
      toId: "e-王五-tools",
      type: "实名登记",
      sourceKind: "human",
      trustState: "自动抽取",
    })
    const 结果 = await aggregate_money(ctx(项目2), { 账户: "6217001234567890001" })
    expect(结果.身份?.[0]?.档).toBe("已核实")
    expect(结果.身份?.[0]?.说明).toContain("实名登记")
    expect(结果.摘要).not.toContain("未核实身份")
  })
})

describe("其余工具的身份标注", () => {
  test("query_relations 按户名查询 ⇒ 主体标户名匹配，摘要用账户称呼", async () => {
    const 结果 = await query_relations(ctx(项目), { 实体: "张三" })
    expect(结果.身份?.[0]).toMatchObject({ 实体: 张三账, 档: "户名匹配" })
    expect(结果.摘要).toContain("户名为「张三」的账户")
    expect(结果.摘要).toContain("未核实身份")
  })

  test("query_relations 不给实体 ⇒ 不带身份（没有查询主体）", async () => {
    const 结果 = await query_relations(ctx(项目), {})
    expect(结果.身份).toBeUndefined()
  })

  test("query_events 按参与实体 ⇒ 身份标注，摘要标未核实", async () => {
    const 结果 = await query_events(ctx(项目), { 参与实体: 张三账 })
    expect(结果.身份?.[0]?.档).toBe("户名匹配")
    expect(结果.摘要).toContain("未核实身份")
    expect(结果.数据).not.toBeNull()
  })

  test("find_crossings ⇒ 两侧各一档，摘要标未核实", async () => {
    const 结果 = await find_crossings(ctx(项目), { 甲: "张三", 乙: "李四" })
    expect(结果.身份?.length).toBe(2)
    expect(结果.身份?.map((a) => a.档)).toEqual(["户名匹配", "户名匹配"])
    expect(结果.摘要).toContain("未核实身份")
  })

  test("query_entities 每行人/账户带身份，摘要给未核实计数", async () => {
    const 结果 = await query_entities(ctx(项目), { 关键词: "张三" })
    const 行们 = 结果.数据 as { canonical_value: string; 身份?: { 档: string } }[]
    const 账户行 = 行们.find((行) => 行.canonical_value === 张三账)
    expect(账户行?.身份?.档).toBe("户名匹配")
    expect(结果.摘要).toContain("未核实身份")
  })
})
