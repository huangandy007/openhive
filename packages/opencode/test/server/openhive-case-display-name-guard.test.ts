import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 账户展示名 } from "../../src/server/openhive/case-party"
import { 种展示数据集, type 展示数据集 } from "../fixtures/p3/dataset"

/**
 * 缺口 #16（10 §3.1「显示优先用户名」）：`账户展示名` 的 fail-closed 守卫必须在函数内。
 *
 * 函数注释自称「与 `户名对齐` 对称、同样 fail-closed」，但守卫原先写在两个调用点
 * （`关系圈` 3 个 `case when 候选数 = 1`、`aggregate_money` 1 个）——函数本体裸返回
 * `代表值`。第三处调用忘套那层 `case when`，就会把「多候选里随便取一个」当人名回给模型。
 *
 * 本文件直接调函数本体（生产入口取数，`#006-35`），不复制调用点的守卫：
 * - S 的户名候选 2 个（人甲 / 人乙）⇒ 代表三列全 null；
 * - P 的唯一户名是组织「某某公司」⇒ 代表三列给出它。
 * 既有 `openhive-case-explore.test.ts`「账户展示与关系圈遗漏」两条对外行为用例
 * （关系圈 / `aggregate_money` 对手方）是本次重构的行为钉子，随门禁一起跑。
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

async function 账户id(值: string): Promise<string> {
  const 行们 = rowsOf(
    await db().execute(sql`
      select id from auth.case_entity
       where project_id = ${展示.项目} and canonical_value = ${值} and type = '账户'
    `),
  )
  const id = 行们[0]?.id
  if (id === undefined) throw new Error(`找不到账户实体：${值}`)
  return 文本(id)
}

function 文本(值: unknown): string {
  if (typeof 值 === "string") return 值
  throw new Error(`列不是字符串：${typeof 值}`)
}

function 可空文本(值: unknown): string | null {
  return 值 === null || 值 === undefined ? null : 文本(值)
}

async function 展示名(账户值: string) {
  const 行们 = rowsOf(
    await db().execute(sql`
      select 代表值, 代表类型, 代表attrs, 候选数
        from ${账户展示名(展示.项目, sql`${await 账户id(账户值)}`)} 展示
    `),
  )
  const 行 = 行们[0]
  if (行 === undefined) throw new Error("展示名子查询没有返回行")
  return {
    代表值: 可空文本(行.代表值),
    代表类型: 可空文本(行.代表类型),
    代表attrs: 可空文本(行.代表attrs),
    候选数: Number(行.候选数),
  }
}

describe("缺口 #16：账户展示名的 fail-closed 守卫在函数内", () => {
  test("户名候选 ≥ 2 ⇒ 三个代表列全为 null（不猜其中一个人名）", async () => {
    const 行 = await 展示名(展示.账号.S)
    // 候选数先证明夹具真的是歧义（否则「代表值 = null」可能是空结果造成的假红）。
    expect(行.候选数).toBe(2)
    expect(行.代表值).toBeNull()
    expect(行.代表类型).toBeNull()
    expect(行.代表attrs).toBeNull()
  })

  test("户名候选恰好 1 ⇒ 给出该户名", async () => {
    expect(await 展示名(展示.账号.P)).toMatchObject({
      代表值: "某某公司",
      代表类型: "组织",
      候选数: 1,
    })
  })
})
