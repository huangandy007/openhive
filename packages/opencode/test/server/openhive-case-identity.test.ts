import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 判定身份, 读身份标注, type 身份证据 } from "../../src/server/openhive/case-identity"
import { insertRelation, upsertEntity } from "../../src/server/openhive/case-fact-store"
import { 确保内置模板 } from "../../src/server/openhive/case-card-template"
import { 翻译资金 } from "../../src/server/openhive/case-translate"
import { 写入翻译结果 } from "../../src/server/openhive/case-translate-store"

function 证据(over: Partial<身份证据> = {}): 身份证据 {
  return { 类型: "账户", 值: "6217001234567896514", 户名们: [], 人证们: [], ...over }
}

describe("判定身份：三档只认证据", () => {
  test("账户有实名登记边 ⇒ 已核实，说明写明人", () => {
    const 判读 = 判定身份(证据({ 人证们: ["张三"] }))
    expect(判读.档).toBe("已核实")
    expect(判读.说明).toContain("实名登记")
    expect(判读.说明).toContain("张三")
  })

  test("账户既有实名登记又有户名 ⇒ 已核实（边优先）", () => {
    expect(判定身份(证据({ 人证们: ["张三"], 户名们: ["张三"] })).档).toBe("已核实")
  })

  test("人只有名字 ⇒ 户名匹配，必须写「未核实身份」", () => {
    const 判读 = 判定身份(证据({ 类型: "人", 值: "张三" }))
    expect(判读.档).toBe("户名匹配")
    expect(判读.说明).toContain("未核实身份")
    expect(判读.说明).toContain("张三")
  })

  test("人实体有实名登记边 ⇒ 已核实", () => {
    const 判读 = 判定身份(证据({ 类型: "人", 值: "张三", 人证们: ["张三"] }))
    expect(判读.档).toBe("已核实")
    expect(判读.说明).toContain("实名登记")
    expect(判读.说明).not.toContain("该人")
  })

  test("账户只有户名 ⇒ 户名匹配，说明带户名且不冒充本人", () => {
    const 判读 = 判定身份(证据({ 户名们: ["张三"] }))
    expect(判读.档).toBe("户名匹配")
    expect(判读.说明).toContain("未核实身份")
    expect(判读.说明).toContain("张三")
    expect(判读.说明).toContain("不能当作本人")
  })

  test("账户既无户名又无实名登记 ⇒ 无匹配（查不到归属）", () => {
    const 判读 = 判定身份(证据())
    expect(判读.档).toBe("无匹配")
    expect(判读.说明).toContain("查不到归属")
    expect(判读.说明).not.toContain("已核实")
  })

  test("号码没有实名登记 ⇒ 无匹配", () => {
    const 判读 = 判定身份(证据({ 类型: "号码", 值: "19900001111" }))
    expect(判读.档).toBe("无匹配")
    expect(判读.说明).toContain("查不到归属")
    expect(判读.说明).not.toContain("近似")
    expect(判读.说明).not.toContain("可能是本人")
    expect(判读.说明).not.toContain("该账户")
  })

  test("人多于 3 个 ⇒ 只列 3 个并写总数", () => {
    const 判读 = 判定身份(证据({ 人证们: ["甲", "乙", "丙", "丁", "戊"] }))
    expect(判读.档).toBe("已核实")
    expect(判读.说明).toContain("甲、乙、丙")
    expect(判读.说明).toContain("等 5 人")
    expect(判读.说明).not.toContain("丁")
  })

  test("正好 3 个人 ⇒ 不写「等 3 人」", () => {
    const 判读 = 判定身份(证据({ 人证们: ["甲", "乙", "丙"] }))
    expect(判读.说明).toContain("甲、乙、丙")
    expect(判读.说明).not.toContain("等 3 人")
  })
})

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

/** 走生产出口种一份资金流水：账户实体 + `kind='户名'` 别名都由 `写入翻译结果` 建。 */
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

describe("读身份标注：证据只认未排除的实名登记边与未撤销的户名", () => {
  const 项目 = "prj-id-evidence"

  test("只有户名 ⇒ 户名匹配；批量返回按 id 取", async () => {
    await 种流水(项目, "m1", "张三", "6217001234567896514", "6222021234567890123")
    const 本方id = await 账户id(项目, "6217001234567896514")
    const 对方id = await 账户id(项目, "6222021234567890123")
    const 表 = await 读身份标注(db(), 项目, [
      { id: 本方id, 类型: "账户", 值: "6217001234567896514" },
      { id: 对方id, 类型: "账户", 值: "6222021234567890123" },
    ])
    expect(表.get(本方id)?.档).toBe("户名匹配")
    expect(表.get(本方id)?.实体).toBe("6217001234567896514")
    expect(表.get(对方id)?.档).toBe("户名匹配")
  })

  test("写一条实名登记边 ⇒ 已核实，人证是对方的规范值", async () => {
    const 本方id = await 账户id(项目, "6217001234567896514")
    await upsertEntity(db(), {
      id: "e-张三-证据",
      projectId: 项目,
      type: "人",
      canonicalValue: "张三",
      aliases: [],
    })
    await insertRelation(db(), {
      id: "r-实名-证据",
      projectId: 项目,
      fromId: 本方id,
      toId: "e-张三-证据",
      type: "实名登记",
      sourceKind: "human",
      trustState: "自动抽取",
    })
    const 表 = await 读身份标注(db(), 项目, [{ id: 本方id, 类型: "账户", 值: "6217001234567896514" }])
    expect(表.get(本方id)?.档).toBe("已核实")
    expect(表.get(本方id)?.说明).toContain("张三")
  })

  test("实名登记边被「已排除」⇒ 不算证据", async () => {
    const 项目2 = "prj-id-evidence-excluded"
    await 种流水(项目2, "m1", "王五", "6217001234567890001", "6222021234567890002")
    const 本方id = await 账户id(项目2, "6217001234567890001")
    await upsertEntity(db(), {
      id: "e-王五-证据",
      projectId: 项目2,
      type: "人",
      canonicalValue: "王五",
      aliases: [],
    })
    await insertRelation(db(), {
      id: "r-实名-排除",
      projectId: 项目2,
      fromId: 本方id,
      toId: "e-王五-证据",
      type: "实名登记",
      sourceKind: "human",
      trustState: "已排除",
    })
    const 表 = await 读身份标注(db(), 项目2, [{ id: 本方id, 类型: "账户", 值: "6217001234567890001" }])
    expect(表.get(本方id)?.档).toBe("户名匹配")
  })

  test("户名别名被撤销 ⇒ 回到无匹配", async () => {
    const 项目3 = "prj-id-evidence-revoked"
    await 种流水(项目3, "m1", "赵六", "6217001234567890003", "6222021234567890004")
    const 本方id = await 账户id(项目3, "6217001234567890003")
    await db().execute(sql`
      update auth.case_entity_alias set revoked_at = 1700000000
       where project_id = ${项目3} and entity_id = ${本方id} and kind = '户名'
    `)
    const 表 = await 读身份标注(db(), 项目3, [{ id: 本方id, 类型: "账户", 值: "6217001234567890003" }])
    expect(表.get(本方id)?.档).toBe("无匹配")
  })

  test("空输入不查库、返回空表", async () => {
    expect((await 读身份标注(db(), "prj-never", [])).size).toBe(0)
  })
})
