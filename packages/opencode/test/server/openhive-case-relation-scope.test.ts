import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 实体档案, 关系圈 } from "../../src/server/openhive/case-entity-list"
import { 关系图 } from "../../src/server/openhive/case-graph"
import { 种展示数据集, type 展示数据集 } from "../fixtures/p3/dataset"

/**
 * 缺口 #13（设计 11 §3.2）：基 2 的「类型分派」只有一份——账户 → 归属集 / XOR，
 * 其他类型 → **端点等于自己**。实体档案 / 关系圈 / 关系图 / `find_crossings` 四读口同源。
 *
 * 判据用**组织自环**：非账户走端点相等 ⇒ 自环照旧触达；一旦误把组织也当账户（基 2
 * 扩到组织但只改了一半），XOR 会把自环判成「内部往来」⇒ 三个读口同时丢它。人中心的
 * 同款断言在 `openhive-case-attribution.test.ts`（「人中心不套投影：原始自环照旧画出来」）。
 *
 * 数据走生产入口 `种展示数据集`（`#006-35`）；自环是关系行，按既有用例的做法直插。
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
  const 组织 = await 实体id("某某公司")
  await db().execute(sql`
    insert into auth.case_relation
      (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
    values
      ('r-组织自环', ${展示.项目}, ${组织}, ${组织}, '转账', '10.00', 'human', '自动抽取', 1760000000)
  `)
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
      select id, type from auth.case_entity
       where project_id = ${展示.项目} and canonical_value = ${值}
    `),
  )
  const id = 行们[0]?.id
  if (typeof id !== "string") throw new Error(`找不到实体：${值}`)
  return id
}

// 变异 B（账户分支 `触达` 退回端点 OR）在既有用例里**没有红**——账户的 XOR 只在关系图
// 的自有路径上被钉住，档案 / 关系圈这条共享口径没有用例守着。补这条：内部往来
// （两端都在归属集）不许进账户档案与关系圈。它的行为在重构前就是这样，属特征用例。
describe("缺口 #13：账户分支仍走 XOR", () => {
  test("账户自环（两端都在归属集）不计入档案关系总数、不成圈组", async () => {
    const Q = await 实体id(展示.账号.Q)
    const 前 = await 实体档案(db(), { projectId: 展示.项目, id: Q })
    const 圈前 = await 关系圈(db(), { projectId: 展示.项目, id: Q, type: "账户" })
    try {
      await db().execute(sql`
        insert into auth.case_relation
          (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
        values
          ('r-账户自环', ${展示.项目}, ${Q}, ${Q}, '转账', '10.00', 'human', '自动抽取', 1760000000)
      `)
      const 后 = await 实体档案(db(), { projectId: 展示.项目, id: Q })
      const 圈后 = await 关系圈(db(), { projectId: 展示.项目, id: Q, type: "账户" })
      expect(后?.关系总数).toBe(前?.关系总数)
      expect(圈后.组总数).toBe(圈前.组总数)
    } finally {
      await db().execute(sql`delete from auth.case_relation where project_id = ${展示.项目} and id = 'r-账户自环'`)
    }
  })
})

describe("缺口 #13：非账户走「端点等于自己」", () => {
  test("档案：组织自环计入关系总数", async () => {
    const 组织 = await 实体id("某某公司")
    const 档案 = await 实体档案(db(), { projectId: 展示.项目, id: 组织 })
    expect(档案).toBeDefined()
    expect(档案!.关系总数).toBe(1)
    expect(档案!.关系[0]?.对方值).toBe("某某公司")
  })

  test("关系圈：组织自环成一组，对方是它自己", async () => {
    const 组织 = await 实体id("某某公司")
    const 圈 = await 关系圈(db(), { projectId: 展示.项目, id: 组织, type: "组织" })
    expect(圈.组总数).toBe(1)
    expect(圈.项们[0]?.对方).toBe("某某公司")
  })

  test("关系图：组织中心不套投影，自环照旧画出来", async () => {
    const 组织 = await 实体id("某某公司")
    const 图 = (await 关系图(db(), { projectId: 展示.项目, id: 组织, 跳数: 1 }))!
    expect(图.边.some((条) => 条.from === 组织 && 条.to === 组织)).toBe(true)
  })
})
