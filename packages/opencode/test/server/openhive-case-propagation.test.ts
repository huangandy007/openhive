import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 清依赖标记, 标依赖已变更 } from "../../src/server/openhive/case-propagation"
import { 裁决 } from "../../src/server/openhive/case-trust"
import { 建关系, 建事件, 建实体 } from "./openhive-case-fact-fixture"

/**
 * 依赖标记与裁决的库级用例（计划 5 Task 5）。
 *
 * `裁决` 走 `inTransaction` ⇒ 按 R-预2 把池留 1 条：PGlite 把多条连接汇进同一个 PG
 * 会话，事务从池里另起一条再准备同一句带参 SQL 会 42P05（`db.ts` 的 `PG_POOL_MAX` 注记）。
 * 与 `openhive-case-trust.test.ts` 同一条口径，不用夹具自带的 `pg.db`。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 项目 = "p-传播"
const 甲 = "u-传播-甲"

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${甲}, '970031', '甲民警', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
  await 建实体(库(), { id: "e-中心", projectId: 项目, value: "中心人物" })
  await 建实体(库(), { id: "e-边", projectId: 项目, value: "边角人物" })
  await 建关系(库(), { id: "r-指着", projectId: 项目, fromId: "e-中心", toId: "e-边" })
  await 建关系(库(), { id: "r-无关", projectId: 项目, fromId: "e-边", toId: "e-边" })
  await 建事件(库(), { id: "ev-参与", projectId: 项目, participants: ["e-中心", "e-边"] })
  await 建事件(库(), { id: "ev-无关", projectId: 项目, participants: ["e-边"] })
})

afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})

describe("依赖标记", () => {
  test("指向该实体的关系与参与它的事件被标；其余不动", async () => {
    const 结果 = await 标依赖已变更(库(), 项目, "e-中心")
    expect(结果).toEqual({ relations: 1, events: 1 })

    const 关系 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-指着" })
    expect(关系?.basisChangedAt).not.toBeNull()
    const 事件 = await 事实详情(库(), { projectId: 项目, type: "event", id: "ev-参与" })
    expect(事件?.basisChangedAt).not.toBeNull()

    const 无关 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-无关" })
    expect(无关?.basisChangedAt).toBeNull()
  })

  test("清标记 ⇒ 读回来是 null", async () => {
    await 清依赖标记(库(), 项目, "relation", "r-指着")
    const 关系 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-指着" })
    expect(关系?.basisChangedAt).toBeNull()
  })

  test("别的项目不跟着变", async () => {
    const 结果 = await 标依赖已变更(库(), "p-别处", "e-中心")
    expect(结果).toEqual({ relations: 0, events: 0 })
  })
})

describe("裁决与传播接通", () => {
  test("修正实体后，依赖关系被标；对依赖关系做人工动作后清掉", async () => {
    await 裁决(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "e-边",
      action: "修正",
      changes: { canonicalValue: "边角人物（改）" },
      reasonKind: "抽取错",
      reasonText: "名字认错",
      by: 甲,
    })
    const 标前 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-指着" })
    expect(标前?.basisChangedAt).not.toBeNull()

    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-指着", action: "确认", by: 甲 })
    const 标后 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-指着" })
    expect(标后?.basisChangedAt).toBeNull()
  })

  test("排除实体同样触发传播", async () => {
    await 建实体(库(), { id: "e-被排除", projectId: 项目, value: "错的人" })
    await 建关系(库(), { id: "r-指向排除", projectId: 项目, fromId: "e-被排除", toId: "e-边" })
    await 裁决(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "e-被排除",
      action: "排除",
      reasonKind: "识别错",
      reasonText: "这个人不存在",
      by: 甲,
    })
    const 详情 = await 事实详情(库(), {
      projectId: 项目,
      type: "relation",
      id: "r-指向排除",
      includeExcluded: true,
    })
    expect(详情?.basisChangedAt).not.toBeNull()
  })

  test("确认不触发传播（值没变）", async () => {
    await 建实体(库(), { id: "e-只确认", projectId: 项目, value: "只确认" })
    await 建关系(库(), { id: "r-只确认", projectId: 项目, fromId: "e-只确认", toId: "e-边" })
    await 裁决(库(), { projectId: 项目, factType: "entity", factId: "e-只确认", action: "确认", by: 甲 })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-只确认" })
    expect(详情?.basisChangedAt).toBeNull()
  })

  test("存疑不触发传播（只是看过了）", async () => {
    await 建实体(库(), { id: "e-只存疑", projectId: 项目, value: "只存疑" })
    await 建关系(库(), { id: "r-只存疑", projectId: 项目, fromId: "e-只存疑", toId: "e-边" })
    await 裁决(库(), { projectId: 项目, factType: "entity", factId: "e-只存疑", action: "存疑", by: 甲 })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-只存疑" })
    expect(详情?.basisChangedAt).toBeNull()
  })
})
