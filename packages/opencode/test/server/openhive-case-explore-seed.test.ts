import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { countFactRows, getMaterial, type Queryable } from "../../src/server/openhive/case-store"
import { 种探索数据集, type 探索数据集 } from "../fixtures/explore/dataset"

/**
 * 20 题固定数据集的 seed 用例（计划 T1）。
 *
 * 数据集只经函数级生产出口种下（`enqueueMaterial` → `claimNextJob` → `runJob`，见
 * `../fixtures/explore/dataset.ts`），本文件只做「落成了什么形状」的断言。
 *
 * 起库方式与 `openhive-case-ingest.test.ts` 文件头一致：`startProductionDb()` 撑 PGlite，
 * 再自建一份 `PG_POOL_MAX=1` 的客户端（事务从池里独占连接，夹具自带客户端的 env 固定）。
 * 断言读用 `countFactRows` 与手写 count SQL；手写 SQL 的文本刻意与 DAO 不同（`#005-10` 同族）。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: 探索数据集
const 文件 = new Map<string, Uint8Array>()

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种探索数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

async function 材料(id: string) {
  const row = await getMaterial(db(), 数据集.projectId, id)
  if (!row) throw new Error(`材料不存在：${id}`)
  return row
}

async function 数一行(db: Queryable, query: ReturnType<typeof sql>): Promise<number> {
  const rows = rowsOf(await db.execute(query))
  return Number(rows[0]?.n ?? 0)
}

async function 数实体(db: Queryable, projectId: string): Promise<number> {
  return 数一行(
    db,
    sql`
      select count(*)::int as n from auth.case_entity where project_id = ${projectId}
    `,
  )
}

async function 数关系(db: Queryable, projectId: string): Promise<number> {
  return 数一行(
    db,
    sql`
      select count(*)::int as n from auth.case_relation where project_id = ${projectId}
    `,
  )
}

async function 数事件(db: Queryable, projectId: string): Promise<number> {
  return 数一行(
    db,
    sql`
      select count(*)::int as n from auth.case_event where project_id = ${projectId}
    `,
  )
}

describe("探索数据集 seed（09 §13.1）", () => {
  test("四份材料的解析状态与类型", async () => {
    const 流水 = await 材料(数据集.材料.流水)
    const 话单 = await 材料(数据集.材料.话单)
    const 笔录 = await 材料(数据集.材料.笔录)
    const 待解析 = await 材料(数据集.材料.待解析)

    expect(流水.parseStatus).toBe("已解析")
    expect(流水.kind).toBe("资金")
    expect(话单.kind).toBe("话单")
    expect(笔录.parseStatus).toBe("已解析")
    expect(待解析.parseStatus).toBe("排队中")
  })

  test("明细行：流水 7 行 + 话单 3 行 + 待解析 0 行", async () => {
    expect(await countFactRows(db(), 数据集.projectId)).toBe(10)
  })

  test("实体：5 人 + 6 账户 = 11", async () => {
    expect(await 数实体(db(), 数据集.projectId)).toBe(11)
  })

  test("关系：5 持有 + 5 转账 = 10", async () => {
    expect(await 数关系(db(), 数据集.projectId)).toBe(10)
  })

  test("事件 1", async () => {
    expect(await 数事件(db(), 数据集.projectId)).toBe(1)
  })

  test("副项目：一份未解析材料、零明细行、零实体", async () => {
    expect(await countFactRows(db(), 数据集.待解析项目)).toBe(0)
    expect(await 数实体(db(), 数据集.待解析项目)).toBe(0)
  })
})
