import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 变更历史 } from "../../src/server/openhive/case-fact-change"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 裁决 } from "../../src/server/openhive/case-trust"
import { 建关系, 建实体 } from "./openhive-case-fact-fixture"

/**
 * 裁决的库级用例（计划 5 Task 3）。
 *
 * `裁决` 走 `inTransaction` ⇒ 按 R-预2 把池留 1 条：PGlite 把多条连接汇进同一个 PG
 * 会话，事务从池里另起一条再准备同一句带参 SQL 会 42P05（`db.ts` 的 `PG_POOL_MAX` 注记）。
 *
 * ⚠️ **不能用夹具自带的 `pg.db`**：`startProductionDb()` 给它自己那个客户端传的是固定
 * env（不含 `PG_POOL_MAX`），在 `process.env` 里配不进去（`case-ingest.test.ts:19-22`）。
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

const 项目 = "p-裁决"
const 甲 = "u-裁决-甲"

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${甲}, '970021', '甲民警', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
})

afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})

async function 新关系(id: string): Promise<void> {
  await 建实体(库(), { id: `${id}-a`, projectId: 项目, value: `${id}-甲` })
  await 建实体(库(), { id: `${id}-b`, projectId: 项目, value: `${id}-乙` })
  await 建关系(库(), { id, projectId: 项目, fromId: `${id}-a`, toId: `${id}-b`, amount: 100 })
}

describe("裁决：三态", () => {
  test("确认 ⇒ 已确认，留痕记了前态与操作人", async () => {
    await 新关系("r-确认")
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-确认",
      action: "确认",
      by: 甲,
    })
    expect(结果.trustState).toBe("已确认")
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-确认" })
    expect(详情?.trustState).toBe("已确认")
    expect(详情?.changes).toHaveLength(1)
    expect(详情?.changes[0]?.before).toEqual({ trustState: "自动抽取" })
    expect(详情?.changes[0]?.actorName).toBe("甲民警")
  })

  test("排除必须带原因与一句话；缺一样都 409 bad_changes", async () => {
    await 新关系("r-排除-缺")
    await expect(
      裁决(库(), { projectId: 项目, factType: "relation", factId: "r-排除-缺", action: "排除", by: 甲 }),
    ).rejects.toMatchObject({ code: "bad_changes" })
    await expect(
      裁决(库(), {
        projectId: 项目,
        factType: "relation",
        factId: "r-排除-缺",
        action: "排除",
        reasonKind: "抽取错",
        reasonText: "   ",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_changes" })
  })

  test("排除带上原因 ⇒ 已排除，且默认读不到了", async () => {
    await 新关系("r-排除-好")
    await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-排除-好",
      action: "排除",
      reasonKind: "识别错",
      reasonText: "这笔不是转账，是取现",
      by: 甲,
    })
    expect(await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-排除-好" })).toBeUndefined()
    const 带上 = await 事实详情(库(), {
      projectId: 项目,
      type: "relation",
      id: "r-排除-好",
      includeExcluded: true,
    })
    expect(带上?.trustState).toBe("已排除")
    expect(带上?.changes[0]?.reasonKind).toBe("识别错")
  })

  test("存疑 ⇒ 存疑；「存疑」不需要原因", async () => {
    await 新关系("r-存疑")
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-存疑",
      action: "存疑",
      by: 甲,
    })
    expect(结果.trustState).toBe("存疑")
  })

  test("任意状态都能直接改（人优先于系统判定）", async () => {
    await 新关系("r-来回")
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-来回", action: "确认", by: 甲 })
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-来回", action: "存疑", by: 甲 })
    const 结果 = await 裁决(库(), {
      projectId: 项目,
      factType: "relation",
      factId: "r-来回",
      action: "确认",
      by: 甲,
    })
    expect(结果.trustState).toBe("已确认")
    expect(await 变更历史(库(), 项目, "relation", "r-来回")).toHaveLength(3)
  })

  test("事实不存在 ⇒ 409 fact_not_found，且不留半条留痕", async () => {
    await expect(
      裁决(库(), { projectId: 项目, factType: "relation", factId: "r-无", action: "确认", by: 甲 }),
    ).rejects.toMatchObject({ code: "fact_not_found" })
    expect(await 变更历史(库(), 项目, "relation", "r-无")).toEqual([])
  })

  test("项目隔离：别的项目改不到", async () => {
    await 新关系("r-隔离")
    await expect(
      裁决(库(), { projectId: "p-别处", factType: "relation", factId: "r-隔离", action: "确认", by: 甲 }),
    ).rejects.toMatchObject({ code: "fact_not_found" })
  })
})
