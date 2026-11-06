import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 变更历史 } from "../../src/server/openhive/case-fact-change"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 处置提议, 建提议, 提议列表 } from "../../src/server/openhive/case-proposals"
import { 建实体 } from "./openhive-case-fact-fixture"

/**
 * AI 提议三态（计划 5 Task 7）。
 *
 * `处置提议` 走 `inTransaction` ⇒ 按 R-预2 把池留 1 条（PGlite 把多条连接汇进同一个 PG
 * 会话，事务从池里另起一条再准备同一句带参 SQL 会 42P05）。夹具自带的 `pg.db` 传的是固定
 * env，`PG_POOL_MAX` 在 `process.env` 里配不进去（`openhive-case-trust.test.ts:12-20`），
 * 所以走生产入口 `connect()` 自建一份，形状仍是「一个进程、一条连接」。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 项目 = "p-提议"
const 甲 = "u-提议-甲"

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${甲}, '970051', '甲民警', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
})

afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})

describe("提议三态", () => {
  test("建一条、列出待处理", async () => {
    const id = await 建提议(库(), {
      projectId: 项目,
      kind: "merge",
      payload: { survivorId: "e-1", mergedId: "e-2" },
      rationale: "两个号码的机主同名，且同时出现在三次通话里",
    })
    const 待处理 = await 提议列表(库(), 项目, "待处理")
    expect(待处理.map((条) => 条.id)).toContain(id)
    expect(待处理[0]?.status).toBe("待处理")
    expect(待处理[0]?.rationale).toContain("同名")
  })

  test("采纳 ⇒ 已采纳，记了人；再处置一次 ⇒ 409 already_decided", async () => {
    const id = await 建提议(库(), {
      projectId: 项目,
      kind: "merge",
      payload: {},
    })
    const 采纳后 = await 处置提议(库(), { projectId: 项目, id, action: "采纳", by: 甲 })
    expect(采纳后.status).toBe("已采纳")
    expect(采纳后.decidedBy).toBe(甲)
    expect(采纳后.decidedAt).not.toBeNull()

    await expect(
      处置提议(库(), { projectId: 项目, id, action: "否决", reasonText: "反悔了", by: 甲 }),
    ).rejects.toMatchObject({ code: "already_decided" })
  })

  test("否决必须带理由；带上 ⇒ 已否决，理由、人、时间都留", async () => {
    const id = await 建提议(库(), { projectId: 项目, kind: "merge", payload: {} })
    await expect(
      处置提议(库(), { projectId: 项目, id, action: "否决", reasonText: "  ", by: 甲 }),
    ).rejects.toMatchObject({ code: "reason_required" })

    const 否决后 = await 处置提议(库(), {
      projectId: 项目,
      id,
      action: "否决",
      reasonText: "两个号码归属不同单位",
      by: 甲,
    })
    expect(否决后.status).toBe("已否决")
    expect(否决后.rejectReason).toBe("两个号码归属不同单位")
    expect(否决后.decidedBy).toBe(甲)
  })

  test("采纳与否决都落一条留痕（判据 A18 的可追溯面）", async () => {
    const id = await 建提议(库(), { projectId: 项目, kind: "merge", payload: {} })
    await 处置提议(库(), { projectId: 项目, id, action: "采纳", by: 甲 })
    const 历史 = await 变更历史(库(), 项目, "entity", id)
    expect(历史.map((条) => 条.action)).toEqual(["采纳"])
  })

  test("不存在 ⇒ 409 proposal_not_found", async () => {
    await expect(
      处置提议(库(), { projectId: 项目, id: "没有这条", action: "采纳", by: 甲 }),
    ).rejects.toMatchObject({ code: "proposal_not_found" })
  })

  test("项目隔离：别的项目列不到", async () => {
    expect(await 提议列表(库(), "p-别处")).toEqual([])
  })

  test("采纳不执行合并：两个实体都还在，变更历史里没有「合并」（R8）", async () => {
    await 建实体(库(), { id: "e-提议-留", projectId: 项目, value: "同一个号码（留）" })
    await 建实体(库(), { id: "e-提议-并", projectId: 项目, value: "同一个号码（并）" })
    const id = await 建提议(库(), {
      projectId: 项目,
      kind: "merge",
      payload: { survivorId: "e-提议-留", mergedId: "e-提议-并" },
      rationale: "两个号码是同一部手机",
    })

    await 处置提议(库(), { projectId: 项目, id, action: "采纳", by: 甲 })

    // 采纳只改状态。执行合并仍要人再走一次 `合并实体` 并写明依据（R8）。
    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "e-提议-留" })).toBeDefined()
    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "e-提议-并" })).toBeDefined()
    expect((await 变更历史(库(), 项目, "entity", "e-提议-留")).map((条) => 条.action)).not.toContain("合并")
    expect((await 变更历史(库(), 项目, "entity", "e-提议-并")).map((条) => 条.action)).not.toContain("合并")
  })
})
