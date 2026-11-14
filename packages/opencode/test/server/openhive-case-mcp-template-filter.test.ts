import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { find_crossings, query_events, query_timeline } from "../../src/server/openhive/case-mcp-tools"
import { 建实体 } from "./openhive-case-fact-fixture"

/**
 * AI 出口的模板可见性（§11.1）：未验证模板产出的卡片默认对 AI 隐藏。
 *
 * 夹具注意：
 * - `auth.case_event.created_at` 是 NOT NULL 且无默认值，简报的插入列清单缺它，这里补 `created_at = 0`；
 * - `case_card_template_active_user`（0044）只允许同项目同事件类型有一个启用中的用户模板，
 *   所以两张用户模板的 `event_type` 错开（卡片自身的 `type` 仍是「通话」，两码事）；
 * - `query_timeline` / `find_crossings` 先解析实体，号码要先落 `case_entity` 才有得查。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // 两个模板：一个已验证、一个未验证；各产一张事件（同参与者、同时间窗）。
  await pg.db.execute(sql`
    insert into auth.case_card_template
      (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at)
    values ('用户:t-已验', 'p-过滤', '已验证', '通话', '{}'::jsonb, ARRAY['谁'], 1, 100, 0, 0),
           ('用户:t-未验', 'p-过滤', '未验证', '见面', '{}'::jsonb, ARRAY['谁'], 1, null, 0, 0)
  `)
  for (const [id, 模板id] of [
    ["ev-已验", "用户:t-已验"],
    ["ev-未验", "用户:t-未验"],
    ["ev-内置", "内置:资金/v1"],
    ["ev-无模板", null],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.case_event
        (id, project_id, type, occurred_at, occurred_raw, precision, participants, summary,
         trust_state, template_id, currency, created_at)
      values (${id}, 'p-过滤', '通话', 1700000000, '2023-11-14 22:13:20', '到秒',
              ARRAY['13800000001','13900000002'], ${id}, '自动抽取', ${模板id}, 'CNY', 0)
    `)
  }
  // `query_timeline` / `find_crossings` 都要先把入参解析成实体（`解析实体` 找不到会抛 not_found）。
  await 建实体(pg.db, { id: "e-过滤-甲", projectId: "p-过滤", type: "号码", value: "13800000001" })
  await 建实体(pg.db, { id: "e-过滤-乙", projectId: "p-过滤", type: "号码", value: "13900000002" })
})
afterAll(async () => {
  await pg?.stop()
})
const 上下文 = () => {
  if (!pg) throw new Error("真库没起来")
  return { db: pg.db, 身份: { userId: "u-过滤", projectId: "p-过滤" } }
}

describe("AI 默认过滤未验证模板卡片（§11）", () => {
  test("query_events：默认隐藏未验证；含未验证=true 放行", async () => {
    const 默认 = await query_events(上下文(), {})
    // `工具结果.数据` 是 `unknown`（各工具形状不同），这里按事件数组收窄再断言。
    const ids = ((默认.数据 ?? []) as { id: unknown }[]).map((行) => String(行.id))
    expect(ids).toContain("ev-已验")
    expect(ids).toContain("ev-内置")
    expect(ids).toContain("ev-无模板")
    expect(ids).not.toContain("ev-未验")

    const 显式 = await query_events(上下文(), { 含未验证: true })
    expect(((显式.数据 ?? []) as { id: unknown }[]).map((行) => String(行.id))).toContain("ev-未验")
  })

  test("query_timeline：默认隐藏；含未验证=true 放行；统计口径一致", async () => {
    const 默认 = await query_timeline(上下文(), { 实体: "13800000001" })
    expect(JSON.stringify(默认)).not.toContain("ev-未验")
    const 显式 = await query_timeline(上下文(), { 实体: "13800000001", 含未验证: true })
    expect(JSON.stringify(显式)).toContain("ev-未验")
  })

  test("find_crossings：默认隐藏；含未验证=true 放行", async () => {
    // 两个号码都在参与者里 ⇒ 两张卡都是「共同时空」候选。
    await pg!.db.execute(sql`
      update auth.case_event set participants = ARRAY['13800000001','13900000002']
       where project_id = 'p-过滤'
    `)
    const 默认 = await find_crossings(上下文(), { 甲: "13800000001", 乙: "13900000002" })
    expect(JSON.stringify(默认)).not.toContain("ev-未验")
    const 显式 = await find_crossings(上下文(), { 甲: "13800000001", 乙: "13900000002", 含未验证: true })
    expect(JSON.stringify(显式)).toContain("ev-未验")
  })

  test("用途补判计数也过滤未验证（否则空原因会误报「用途未结构化」）", async () => {
    // 补判计数按整个项目数「purpose is null」，所以先给前面四张卡都落一个用途，
    // 让唯一「无用途」的卡就是下面这张未验证卡——否则这条用例对「要不要过滤」没咬合力。
    await pg!.db.execute(sql`
      update auth.case_event set purpose = '其他' where project_id = 'p-过滤'
    `)
    // 一张未验证、无用途的卡：默认查询按用途过滤后为空，若补判计数把它算进去，
    // 会返回「有 N 个事件还没有用途判定」而不是「无匹配行」。
    await pg!.db.execute(sql`
      insert into auth.case_event
        (id, project_id, type, occurred_at, occurred_raw, precision, participants, summary,
         trust_state, template_id, currency, purpose, created_at)
      values ('ev-未验-无用途', 'p-过滤', '通话', 1700000000, 'x', '到秒',
              ARRAY['13800000001'], '未验证且无用途', '自动抽取', '用户:t-未验', 'CNY', null, 0)
    `)
    const 结果 = await query_events(上下文(), { 用途: "停车" })
    expect(结果.空原因).not.toBe("用途未结构化")
  })
})
