import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 户名对齐, 对齐代表 } from "../../src/server/openhive/case-party"
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

async function 对齐(值: string, 类型 = "人") {
  const 行们 = rowsOf(
    await db().execute(sql`
      select 代表, 候选数
        from ${户名对齐(数据集.对齐项目, sql`'self'`, sql`${类型}`, sql`${值}`)} 对齐
    `),
  )
  const 行 = 行们[0]
  if (行 === undefined) throw new Error("对齐子查询没有返回行")
  return { 代表: 行.代表 === null ? null : String(行.代表), 候选数: Number(行.候选数) }
}

async function 实体id(项目: string, 值: string): Promise<string> {
  const 行们 = rowsOf(
    await db().execute(sql`
      select id from auth.case_entity where project_id = ${项目} and canonical_value = ${值}
    `),
  )
  const id = 行们[0]?.id
  if (id === undefined) throw new Error(`找不到实体：${值}`)
  return String(id)
}

describe("端点对齐（10 §3.1）", () => {
  test("唯一户名候选 ⇒ 代表 = 该账户", async () => {
    const 实得 = await 对齐("王五")
    expect(实得).toEqual({ 代表: await 实体id(数据集.对齐项目, 数据集.对齐账号.Z), 候选数: 1 })
  })

  test("两个账户同户名 ⇒ 不对齐（代表 null、候选 2）", async () => {
    expect(await 对齐("李四")).toEqual({ 代表: null, 候选数: 2 })
  })

  test("没有户名证据 ⇒ 不对齐（代表 null、候选 0）", async () => {
    expect(await 对齐("查无此人")).toEqual({ 代表: null, 候选数: 0 })
  })

  test("账户/号码类型不参与对齐（代表恒为自己）", async () => {
    const 行们 = rowsOf(
      await db().execute(sql`
        select ${对齐代表(数据集.对齐项目, sql`${"self-id"}`, sql`'账户'`, sql`${"anything"}`)} as 代表
      `),
    )
    expect(String(行们[0]?.代表)).toBe("self-id")
  })
})
