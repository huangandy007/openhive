import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 重建关系 } from "../../src/server/openhive/case-translate-store"
import { 裁决 } from "../../src/server/openhive/case-trust"
import { 种P3数据集, type P3数据集 } from "../fixtures/p3/dataset"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-p3"

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种P3数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

async function 实体id(值: string): Promise<string> {
  const 行们 = rowsOf(
    await db().execute(sql`
      select id from auth.case_entity where project_id = ${数据集.projectId} and canonical_value = ${值}
    `),
  )
  const id = 行们[0]?.id
  if (typeof id !== "string") throw new Error(`找不到实体：${值}`)
  return id
}

async function 机器行(fromId: string, toId: string) {
  return rowsOf(
    await db().execute(sql`
      select times, times_cny, amount::text as amount, trust_state
        from auth.case_relation
       where project_id = ${数据集.projectId} and from_id = ${fromId} and to_id = ${toId}
         and source_kind = 'data'
    `),
  )[0]
}

describe("写端去重（10 §3 / §5）", () => {
  test("文本落库后触发重算：A→B 机器行只剩未被 human 覆盖的 1 笔 20000", async () => {
    const A = await 实体id(数据集.账号.A)
    const B = await 实体id(数据集.账号.B)
    expect(await 机器行(A, B)).toEqual({
      times: 1,
      times_cny: 1,
      amount: "20000.00",
      trust_state: "自动抽取",
    })
  })

  test("纯外币对：times=1、times_cny=0、amount=0.00", async () => {
    const A = await 实体id(数据集.账号.A)
    const C = await 实体id(数据集.账号.C)
    expect(await 机器行(A, C)).toEqual({
      times: 1,
      times_cny: 0,
      amount: "0.00",
      trust_state: "自动抽取",
    })
  })

  test("人工结论不再整对压制机器行（#013-04 同型）", async () => {
    const A = await 实体id(数据集.账号.A)
    const B = await 实体id(数据集.账号.B)
    const 人5000 = rowsOf(
      await db().execute(sql`
        select id from auth.case_relation
         where project_id = ${数据集.projectId} and source_kind = 'human' and amount = 5000
      `),
    )[0]?.id
    expect(人5000).toBeDefined()
    await 裁决(db(), {
      projectId: 数据集.projectId,
      factType: "relation",
      factId: String(人5000),
      action: "确认",
      by: 用户,
    })
    await 重建关系(db(), 数据集.projectId, [{ fromId: A, toId: B }])
    // 旧规则：该对存在「已确认」人工行 ⇒ 机器行被删且不重写（实得 undefined）。
    expect(await 机器行(A, B)).toEqual({
      times: 1,
      times_cny: 1,
      amount: "20000.00",
      trust_state: "自动抽取",
    })
  })
})
