import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 确认别名, 撤销别名, 读别名上下文, 记别名命中 } from "../../src/server/openhive/case-field-alias"

/**
 * 本模块的写入全走 `inTransaction` ⇒ 按 R-预2 把池留 1 条（`PG_POOL_MAX`）：PGlite 把多条
 * 连接汇进同一个 PG 会话，事务从池里另起一条再准备同一句带参 SQL 会 `42P05`。夹具自带的
 * `pg.db` 用的是固定 env（不含 `PG_POOL_MAX`），所以走生产入口 `connect()` 自建一份
 * （同 `openhive-case-merge.test.ts` 文件头）。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
})
afterAll(async () => {
  await pg?.stop()
})
function db() {
  if (!客户端) throw new Error("真库没起来")
  return 客户端
}

const 确认 = (header: string, field = "counterpartyName") =>
  确认别名(db(), { header, field, materialId: "m1", projectId: "p1", by: "u1" })

async function 版本() {
  const 行 = rowsOf(await db().execute(sql`select version from auth.case_field_alias_version where id = 1`))
  return Number(行[0]?.version)
}

describe("别名库", () => {
  test("确认后读得到，版本 +1", async () => {
    const 前 = await 版本()
    await 确认("交易对方名称")
    const 上下文 = await 读别名上下文(db())
    expect(上下文.别名.get("交易对方名称")).toBe("counterpartyName")
    expect(上下文.版本).toBe(前 + 1)
  })

  test("活跃别名重复确认 ⇒ 抛「已存在」，版本不动", async () => {
    await 确认("重复表头")
    const 前 = await 版本()
    await expect(确认("重复表头", "counterparty")).rejects.toThrow(/已存在/)
    expect(await 版本()).toBe(前)
  })

  test("撤销后版本 +1；再确认同一表头可复活（R1）", async () => {
    await 确认("可复活")
    const 撤销前 = await 版本()
    expect(await 撤销别名(db(), { header: "可复活", by: "u2" })).toBe(true)
    expect(await 版本()).toBe(撤销前 + 1)
    expect((await 读别名上下文(db())).别名.has("可复活")).toBe(false)

    await 确认("可复活", "counterparty")
    expect((await 读别名上下文(db())).别名.get("可复活")).toBe("counterparty")
  })

  test("撤销不存在的别名 ⇒ false，版本不动", async () => {
    const 前 = await 版本()
    expect(await 撤销别名(db(), { header: "从来没有", by: "u1" })).toBe(false)
    expect(await 版本()).toBe(前)
  })

  test("非法字段名 ⇒ 拒绝写入", async () => {
    await expect(确认("坏字段", "不存在的字段")).rejects.toThrow(/字段/)
  })

  test("表头超长 ⇒ 拒绝前先给可读错误（CHECK 也兜底）", async () => {
    await expect(确认("x".repeat(201))).rejects.toThrow()
  })

  test("记别名命中一份材料一次，不按行重复加", async () => {
    await 确认("命中表头")
    await 记别名命中(db(), ["命中表头", "命中表头"])
    const 行 = rowsOf(await db().execute(sql`select hit_count from auth.case_field_alias where header = '命中表头'`))
    expect(Number(行[0]?.hit_count)).toBe(1)
  })
})
