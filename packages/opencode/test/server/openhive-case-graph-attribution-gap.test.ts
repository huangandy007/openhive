import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 关系图 } from "../../src/server/openhive/case-graph"
import { 种展示数据集, type 展示数据集 } from "../fixtures/p3/dataset"

/**
 * 缺口 #2（设计 11 §3.2 / §3.3）：关系图**不画**的关系必须在 `缺口` 里说出来。
 *
 * - 内部往来：两端都在账户归属集（`张Q → Q`）压成 `中心 → 中心`，图里没有；
 * - 归属歧义：户名对应多个账户（`王歧` 对齐 Q、T）fail-closed，两端都不在归属集。
 *
 * 档案（`case-entity-list.ts`）、关系圈遗漏、`aggregate_money` 三处都已写这两句，
 * 关系图曾是唯一静默的读口（`#002-06`）。数据走生产入口 `种展示数据集`（`#006-35`）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 展示: 展示数据集
const 文件 = new Map<string, Uint8Array>()

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  展示 = await 种展示数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db(): Queryable {
  if (!库) throw new Error("真库没起来")
  return 库
}

async function 实体id(值: string): Promise<string> {
  const 行们 = rowsOf(
    await db().execute(sql`
      select id from auth.case_entity
       where project_id = ${展示.项目} and canonical_value = ${值}
    `),
  )
  const id = 行们[0]?.id
  if (typeof id !== "string") throw new Error(`找不到实体：${值}`)
  return id
}

describe("缺口 #2：关系图对不画的关系要写缺口", () => {
  test("账户 Q 中心：内部往来与归属歧义各 1 条，都不画、都要说", async () => {
    const Q = await 实体id(展示.账号.Q)
    const 图 = (await 关系图(db(), { projectId: 展示.项目, id: Q, 跳数: 1 }))!
    // 不画：张Q→Q（内部往来）与 王歧→R（歧义）都不在边上；只有 Q→P、Q→S。
    expect(图.边).toHaveLength(2)
    expect(图.缺口.join()).toContain("账户内部往来 1 条")
    expect(图.缺口.join()).toContain("账户归属歧义 1 条")
  })

  test("类型筛选：请求的通话关系里没有这两类，缺口不许提", async () => {
    const Q = await 实体id(展示.账号.Q)
    const 图 = (await 关系图(db(), { projectId: 展示.项目, id: Q, 跳数: 1, 类型: ["通话"] }))!
    // 库里这两条都是转账；用户筛了通话，就不该拿转账来充缺口句。
    expect(图.缺口.join()).not.toContain("账户内部往来")
    expect(图.缺口.join()).not.toContain("账户归属歧义")
  })

  test("人中心不套投影：原始关系照旧画，不报账户归属缺口", async () => {
    const 张Q = await 实体id("张Q")
    const Q = await 实体id(展示.账号.Q)
    const 图 = (await 关系图(db(), { projectId: 展示.项目, id: 张Q, 跳数: 1 }))!
    expect(图.边.some((条) => 条.from === 张Q && 条.to === Q)).toBe(true)
    expect(图.缺口.join()).not.toContain("账户内部往来")
    expect(图.缺口.join()).not.toContain("账户归属歧义")
  })
})
