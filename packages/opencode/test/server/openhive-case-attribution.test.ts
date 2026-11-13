import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  事件归属条件,
  关系归属条件,
  账户归属集,
  读归属值,
} from "../../src/server/openhive/case-party"
import { 种P3数据集, type P3数据集 } from "../fixtures/p3/dataset"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
const 文件 = new Map<string, Uint8Array>()

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

async function 数(语句: ReturnType<typeof sql>): Promise<number> {
  return Number(rowsOf(await db().execute(语句))[0]?.数 ?? 0)
}

describe("基 1：事件归属", () => {
  test("按账户查：3 个流水事件（参与者表）+ 1 个笔录事件（唯一户名对齐者的文本值）", async () => {
    const B = await 实体id(数据集.账号.B)
    const 条数 = await 数(sql`
      select count(*)::int as 数 from auth.case_event
       where project_id = ${数据集.projectId} and ${事件归属条件(数据集.projectId, B)}
    `)
    expect(条数).toBe(4)
  })

  test("按人查：其唯一户名账户的 3 个流水事件 + 自己参与的笔录事件", async () => {
    const 李四 = await 实体id("李四")
    const 条数 = await 数(sql`
      select count(*)::int as 数 from auth.case_event
       where project_id = ${数据集.projectId} and ${事件归属条件(数据集.projectId, 李四)}
    `)
    expect(条数).toBe(4)
  })
})

describe("基 2：账户归属", () => {
  test("归属集 = 账户自己 ∪ 唯一户名对齐到它的人", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    const 行们 = rowsOf(
      await db().execute(sql`
        select id from ${账户归属集(数据集.projectId, [B])} 集 order by id asc
      `),
    )
    expect(行们.map((行) => String(行.id)).sort()).toEqual([B, 李四].sort())
  })

  test("恰好一端在集合里才算归属：A→李四 归属 B", async () => {
    const B = await 实体id(数据集.账号.B)
    const 条数 = await 数(sql`
      select count(*)::int as 数 from auth.case_relation
       where project_id = ${数据集.projectId}
         and ${关系归属条件(数据集.projectId, [B], sql`from_id`, sql`to_id`)}
    `)
    // A→B 机器、A→B 人工、A→李四 人工、B→C 机器（纯外币也先算关系，人民币笔数由读端口过滤）
    expect(条数).toBe(4)
  })

  test("两端都落在集合里 ⇒ 不归属（B 与李四之间的往来是账户内部）", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    // 造一条 李四 → B：两端都在归属集里，XOR 必须把它排除。
    await db().execute(sql`
      insert into auth.case_relation (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
      values ('r-基2自环', ${数据集.projectId}, ${李四}, ${B}, '转账', '1000.00', 'human', '自动抽取', 1760000000)
    `)
    const 条数 = await 数(sql`
      select count(*)::int as 数 from auth.case_relation
       where project_id = ${数据集.projectId} and id = 'r-基2自环'
         and ${关系归属条件(数据集.projectId, [B], sql`from_id`, sql`to_id`)}
    `)
    expect(条数).toBe(0)
    await db().execute(sql`delete from auth.case_relation where project_id = ${数据集.projectId} and id = 'r-基2自环'`)
  })

  test("值集覆盖「自己 + 正向代表 + 反向对齐者」", async () => {
    const B = await 实体id(数据集.账号.B)
    const 值们 = (await 读归属值(db(), 数据集.projectId, B)).sort()
    expect(值们).toEqual([数据集.账号.B, "李四"].sort())
  })
})
