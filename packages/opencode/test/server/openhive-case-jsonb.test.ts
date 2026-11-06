import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  addCitation,
  applyParseAction,
  citationsOf,
  createMaterial,
  insertFactRows,
} from "../../src/server/openhive/case-store"

/** 夹具形状与 `openhive-case-fact-store.test.ts` 一致：只用 `pg.db`，不再 `connect()`。 */
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

const 项目 = "prj-jsonb"
const 材料 = "mat-jsonb"

beforeAll(async () => {
  await createMaterial(db(), {
    id: 材料,
    projectId: 项目,
    fileName: "笔录.txt",
    kind: "笔录",
    fingerprint: "fp-jsonb",
    path: "笔录.txt",
  })
})

/**
 * 这组用例钉的不是「读得回来」——读路径的 `typeof x === "string" ? JSON.parse` 会把
 * 错形状也读对，正是它把缺陷遮住了几个月。钉的是**库里的形状本身**：
 * `jsonb_typeof` 与 SQL 侧取值。形状错了，任何 `->>` 都是 null。
 */
describe("jsonb 写入必须是对象/数组，不是 JSON 字符串", () => {
  test("addCitation 的 locator 是 object，SQL 侧能取到 start", async () => {
    await addCitation(db(), {
      id: "c-jsonb",
      projectId: 项目,
      factType: "row",
      factId: "f-jsonb",
      materialId: 材料,
      locator: { start: 0, end: 10 },
      extractMethod: "机器",
    })
    const 行 = rowsOf(
      await db().execute(sql`
        select jsonb_typeof(locator) as 类型, locator->>'start' as 起点
          from auth.case_citation where project_id = ${项目} and id = 'c-jsonb'
      `),
    )
    expect(行[0]?.类型).toBe("object")
    expect(行[0]?.起点).toBe("0")
    // 读路径也必须还对（对象直接返回，字符串才 JSON.parse）。
    const 回读 = await citationsOf(db(), 项目, "row", "f-jsonb")
    expect(回读[0]?.locator).toEqual({ start: 0, end: 10 })
  })

  test("applyParseAction 的 parse_detail 是 object，SQL 侧能取到 reason", async () => {
    await applyParseAction(db(), {
      projectId: 项目,
      materialId: 材料,
      action: "入队",
      detail: { reason: "测试明细" },
    })
    const 行 = rowsOf(
      await db().execute(sql`
        select jsonb_typeof(parse_detail) as 类型, parse_detail->>'reason' as 原因
          from auth.case_material where project_id = ${项目} and id = ${材料}
      `),
    )
    expect(行[0]?.类型).toBe("object")
    expect(行[0]?.原因).toBe("测试明细")
  })

  test("insertFactRows 的 extras 是 object，SQL 侧能取到键", async () => {
    await insertFactRows(db(), [
      { projectId: 项目, materialId: 材料, sheet: "Sheet1", rowNo: 1, extras: { 单位: "元" } },
    ])
    const 行 = rowsOf(
      await db().execute(sql`
        select jsonb_typeof(extras) as 类型, extras->>'单位' as 单位
          from auth.case_fact_row where project_id = ${项目} and material_id = ${材料}
      `),
    )
    expect(行[0]?.类型).toBe("object")
    expect(行[0]?.单位).toBe("元")
  })
})
