import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 重建关系, 本材料转账对 } from "../../src/server/openhive/case-translate-store"
import { aggregate_money, query_relations, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
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
    // 新语义是「并存」：机器行照写，人工行不因重建而消失。
    const 人工 = rowsOf(
      await db().execute(sql`
        select trust_state from auth.case_relation
         where project_id = ${数据集.projectId} and id = ${String(人5000)}
      `),
    )[0]
    expect(人工?.trust_state).toBe("已确认")
  })

  test("本材料转账对：笔录的（账户 → 人）按户名对齐成账户对", async () => {
    const A = await 实体id(数据集.账号.A)
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    const 对们 = await 本材料转账对(db(), 数据集.projectId, 数据集.材料.笔录)
    // 对齐发生在 `本材料转账对` 内部：A→李四 必须落到 (A, B)，否则重建删不到真正的机器行。
    expect(对们).toContainEqual({ fromId: A, toId: B })
    expect(对们).not.toContainEqual({ fromId: A, toId: 李四 })
  })
})

function ctx(): 工具上下文 {
  return { db: db(), 身份: { userId: 用户, projectId: 数据集.projectId } }
}

describe("读端去重口径（10 §6.1）", () => {
  test("汇总按人民币笔数：出 3 笔 / 35000.00，纯外币不进", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    expect(结果.数据).toMatchObject({
      汇总: [{ 方向: "出", 笔数: 3, 合计: "35000.00" }],
    })
    expect(结果.空原因).toBeNull()
    expect(结果.缺口.join()).toContain("1 条转账关系金额为 0.00")
  })

  test("人 与 账户B 合并成一个对手方（显示优先用户名）", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    expect(结果.数据).toMatchObject({
      对手方: [{ 对手方: "李四", 方向: "出", 笔数: 3, 合计: "35000.00" }],
    })
  })

  test("query_relations 仍按事实各列一条，并用缺口交代去重口径", async () => {
    const 结果 = await query_relations(ctx(), { 实体: 数据集.账号.A, 类型: "转账", 限制: 200 })
    expect(结果.数据).toHaveLength(4) // 2 human + A→B 机器 + A→C 纯外币机器
    expect(结果.缺口.join()).toContain("汇总与对手方已去重")
  })
})

describe("显示（10 §3.1 / §6.1）", () => {
  const 对齐ctx = (): 工具上下文 => ({
    db: db(),
    身份: { userId: 用户, projectId: 数据集.对齐项目 },
  })

  test("对手是账户 ⇒ 显示唯一户名对应的人名（不是账号）", async () => {
    // Z（王五）→ W（赵六）：只有流水机器关系，没有人工关系 ⇒ 只能靠第二档显示「赵六」。
    const 结果 = await aggregate_money(对齐ctx(), { 账户: 数据集.对齐账号.Z })
    expect(结果.数据).toMatchObject({
      对手方: [{ 对手方: "赵六", 方向: "出", 笔数: 2, 合计: "500.00" }],
    })
  })
})
