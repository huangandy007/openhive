import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 材料事实清单 } from "../../src/server/openhive/case-material-facts"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 建实体, 建材料, 建关系 } from "./openhive-case-fact-fixture"

/**
 * 材料事实清单（计划 7 Task 2）。
 *
 * ⚠️ PGlite 把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的：本文件自带的
 * `建带定位引用` 必须与生产 DAO 的 SQL **文本不同**（显式列序 ＋ 换行）。共享夹具的
 * `建引用` 把 locator 写死成 `{"page":3,"para":2}`，喂不了「按 sheet/row 分组」，故不改它、
 * 在这里另写一条。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

/** 夹具 `建引用` 的定位可变版（不改共享夹具）。 */
async function 建带定位引用(
  db: Queryable,
  input: {
    id: string
    projectId: string
    factType: string
    factId: string
    materialId: string
    locator: unknown
    extractMethod?: string
  },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_citation
      (id, project_id, material_id, fact_type, fact_id, locator, extract_method, created_at)
    values
      (${input.id}, ${input.projectId}, ${input.materialId}, ${input.factType}, ${input.factId},
       ${JSON.stringify(input.locator)}::text::jsonb, ${input.extractMethod ?? "机器"}, 1760000000)
  `)
}

const 项目 = "p-材料事实"
const 别人的项目 = "p-别处"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  await 建材料(库(), { id: "m-单", projectId: 项目, path: "话单.xlsx", fileName: "话单.xlsx", kind: "话单" })
  await 建材料(库(), { id: "m-空", projectId: 项目, path: "空.xlsx", fileName: "空.xlsx" })
  await 建材料(库(), { id: "m-厚", projectId: 项目, path: "厚.xlsx", fileName: "厚.xlsx" })

  await 建实体(库(), { id: "e-张", projectId: 项目, value: "张三", type: "人", trustState: "自动抽取" })
  await 建实体(库(), { id: "e-李", projectId: 项目, value: "李四", type: "人" })
  await 建实体(库(), { id: "e-号1", projectId: 项目, value: "13800000001", type: "号码" })
  await 建关系(库(), { id: "r-张李", projectId: 项目, fromId: "e-张", toId: "e-李", type: "通话" })

  await 建带定位引用(库(), {
    id: "c-e1", projectId: 项目, factType: "entity", factId: "e-张",
    materialId: "m-单", locator: { sheet: "Sheet#1", row: 2 }, extractMethod: "机器",
  })
  await 建带定位引用(库(), {
    id: "c-r1", projectId: 项目, factType: "relation", factId: "r-张李",
    materialId: "m-单", locator: { sheet: "Sheet#1", row: 2 }, extractMethod: "机器",
  })
  await 建带定位引用(库(), {
    id: "c-e2", projectId: 项目, factType: "entity", factId: "e-号1",
    materialId: "m-单", locator: { sheet: "通话明细", row: 3 }, extractMethod: "机器",
  })

  // 单个 sheet 501 行 ⇒ 截断到 500；id 补零保证插入 / 排序稳定。
  for (let i = 1; i <= 501; i++) {
    await 建带定位引用(库(), {
      id: `c-厚-${String(i).padStart(4, "0")}`,
      projectId: 项目,
      factType: "entity",
      factId: "e-号1",
      materialId: "m-厚",
      locator: { sheet: "Sheet1", row: i },
      extractMethod: "机器",
    })
  }
})

afterAll(async () => {
  await pg?.stop()
})

describe("材料事实清单", () => {
  test("按 sheet / row 分组；工作表名含 # 也不拆错", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "话单.xlsx" }))!
    expect(结果.分组.map((组) => 组.sheet)).toEqual(["Sheet#1", "通话明细"])
    expect(结果.分组[0]!.行们.map((行) => 行.row_no)).toEqual([2])
    expect(结果.分组[0]!.行们[0]!.事实们.map((条) => 条.fact_id)).toEqual(["e-张", "r-张李"])
  })

  test("事实值取 canonical_value / 关系端点；排除态如实带出", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "话单.xlsx" }))!
    expect(结果.分组[0]!.行们[0]!.事实们[0]!.值).toBe("张三")
    expect(结果.分组[0]!.行们[0]!.事实们[0]!.trust_state).toBe("自动抽取")
  })

  test("材料不存在 / 不属于本项目 ⇒ undefined", async () => {
    expect(await 材料事实清单(库(), { projectId: 项目, path: "没有.xlsx" })).toBeUndefined()
    expect(await 材料事实清单(库(), { projectId: 别人的项目, path: "话单.xlsx" })).toBeUndefined()
  })

  test("没有引用的材料 ⇒ 空分组 + 缺口说清（解析结果为空与没解析是两件事）", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "空.xlsx" }))!
    expect(结果.分组).toEqual([])
    expect(结果.缺口.join()).toContain("没有引用")
  })

  test("单个 sheet 超过 500 行时截断并写缺口", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "厚.xlsx" }))!
    expect(结果.分组[0]!.行们.length).toBe(500)
    expect(结果.缺口.join()).toContain("500")
  })
})
