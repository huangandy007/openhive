import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
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
  // `participants` 存的是实体的**规范值**，不是 id（01 §3.3；#006-11）。种子按生产形状写，
  // 否则「按 id 比」的死路会被夹具的假绿遮住（#006-35）。
  await 建事件(库(), { id: "ev-参与", projectId: 项目, participants: ["中心人物", "边角人物"] })
  await 建事件(库(), { id: "ev-无关", projectId: 项目, participants: ["边角人物"] })
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

  test("按人标：其唯一户名账户参与的表格事件也算（正向对齐）", async () => {
    await 建实体(库(), { id: "e-账户", projectId: 项目, type: "账户", value: "6222000000001" })
    await 建实体(库(), { id: "e-人", projectId: 项目, value: "李四" })
    await 库().execute(sql`
      insert into auth.case_entity_alias (id, project_id, entity_id, kind, value, raw_value, source_kind, created_at)
      values ('al-李四', ${项目}, 'e-账户', '户名', '李四', '李四', '文本', 1760000000)
    `)
    await 建事件(库(), {
      id: "ev-表参与",
      projectId: 项目,
      type: "资金交易",
      participants: ["6222000000001"],
      参与者表: [{ entityId: "e-账户", role: "付款方", ordinal: 0 }],
    })
    const 结果 = await 标依赖已变更(库(), 项目, "e-人")
    expect(结果.events).toBe(1)
    expect(
      (await 事实详情(库(), { projectId: 项目, type: "event", id: "ev-表参与" }))?.basisChangedAt,
    ).not.toBeNull()
  })

  test("改名后旧规范值进别名，旧值写的 text[] 事件仍被打标", async () => {
    await 建实体(库(), { id: "e-改名", projectId: 项目, value: "改名前" })
    await 建事件(库(), { id: "ev-旧值", projectId: 项目, participants: ["改名前"] })
    await 裁决(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "e-改名",
      action: "修正",
      changes: { canonicalValue: "改名后" },
      reasonKind: "抽取错",
      reasonText: "名字认错",
      by: 甲,
    })
    const 行 = rowsOf(
      await 库().execute(sql`
        select array_to_json(aliases)::text as aliases from auth.case_entity
         where project_id = ${项目} and id = 'e-改名'
      `),
    )[0]
    const 别名们: string[] = JSON.parse(String(行?.aliases ?? "[]"))
    expect(别名们).toContain("改名前")

    const 结果 = await 标依赖已变更(库(), 项目, "e-改名")
    expect(结果.events).toBe(1)
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

  // 终审修复 B：撤销修正会让规范值退回旧名，依赖事实的依据同样变了，必须重新标。
  // 此前只按 action 判定，撤销一律不传播，导致依赖事实停留在对旧值的复核结论上。
  test("撤销实体修正 ⇒ 依赖关系重新被标", async () => {
    await 建实体(库(), { id: "e-撤修正", projectId: 项目, value: "撤修正人物" })
    await 建关系(库(), { id: "r-撤修正", projectId: 项目, fromId: "e-撤修正", toId: "e-边" })
    await 裁决(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "e-撤修正",
      action: "修正",
      changes: { canonicalValue: "撤修正人物（改）" },
      reasonKind: "抽取错",
      reasonText: "名字认错",
      by: 甲,
    })
    expect(
      (await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-撤修正" }))?.basisChangedAt,
    ).not.toBeNull()

    // 人复核了这条依赖关系 ⇒ 标记清掉。
    await 裁决(库(), { projectId: 项目, factType: "relation", factId: "r-撤修正", action: "确认", by: 甲 })
    expect(
      (await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-撤修正" }))?.basisChangedAt,
    ).toBeNull()

    // 撤销那次修正 ⇒ 值退回旧名，依赖关系的依据又变了，标记必须重新有值。
    await 裁决(库(), { projectId: 项目, factType: "entity", factId: "e-撤修正", action: "撤销", by: 甲 })
    expect(
      (await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-撤修正" }))?.basisChangedAt,
    ).not.toBeNull()
  })

  // 反例：撤销「确认」值没变，不能误传播（否则人每点一次撤销，周围关系全变「请复核」）。
  test("撤销实体确认 ⇒ 依赖关系标记仍为 null（不误传播）", async () => {
    await 建实体(库(), { id: "e-撤确认", projectId: 项目, value: "撤确认人物" })
    await 建关系(库(), { id: "r-撤确认", projectId: 项目, fromId: "e-撤确认", toId: "e-边" })
    await 裁决(库(), { projectId: 项目, factType: "entity", factId: "e-撤确认", action: "确认", by: 甲 })
    await 裁决(库(), { projectId: 项目, factType: "entity", factId: "e-撤确认", action: "撤销", by: 甲 })
    expect(
      (await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-撤确认" }))?.basisChangedAt,
    ).toBeNull()
  })

  test("存疑不触发传播（只是看过了）", async () => {
    await 建实体(库(), { id: "e-只存疑", projectId: 项目, value: "只存疑" })
    await 建关系(库(), { id: "r-只存疑", projectId: 项目, fromId: "e-只存疑", toId: "e-边" })
    await 裁决(库(), { projectId: 项目, factType: "entity", factId: "e-只存疑", action: "存疑", by: 甲 })
    const 详情 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "r-只存疑" })
    expect(详情?.basisChangedAt).toBeNull()
  })
})
