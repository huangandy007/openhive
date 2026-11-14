import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  explore_entity,
  find_crossings,
  money_flow,
  query_events,
  query_timeline,
  type 工具结果,
} from "../../src/server/openhive/case-mcp-tools"
import { 建实体, 建关系批 } from "./openhive-case-fact-fixture"

/**
 * AI 出口的模板可见性（§11.1）：未验证模板产出的卡片默认对 AI 隐藏。
 *
 * **每条用例用自己的项目 id、自己种数据**：`beforeAll` 只起库 + migrate。
 * 共享一个项目会让用例互相污染（前一条种的事件改变后一条的统计/空原因），
 * 单点 `-t` 复跑也就失去意义（`#005-34`）。
 *
 * 夹具注意：
 * - `auth.case_event.created_at` 是 NOT NULL 且无默认值，插入列清单必须带上它；
 * - `case_card_template_active_user`（0044）只允许同项目同事件类型有一个启用中的用户模板，
 *   独立项目后每条用例只有一个用户模板，因此模板 `event_type` 可与卡片 `type` 一致（「通话」）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  await pg?.stop()
})

/** 每个用例自报项目；身份里的 projectId 与种子用同一个值。 */
const 上下文 = (projectId: string) => {
  if (!pg) throw new Error("真库没起来")
  return { db: pg.db, 身份: { userId: "u-过滤", projectId } }
}

/**
 * 种一张模板行；`verifiedAt === null` 即「未验证」。
 *
 * `disabledAt` 默认 null（启用）。0044 的唯一索引只约束「同项目同事件类型只能有一个**启用中**的用户模板」；
 * 同一用例既要已验证又要未验证模板时，把已验证那张标为停用——这正是生产允许的状态
 * （0044 注释：停用保留行，已验证卡片仍可被 AI 查询），可见条件也只看 `verified_at`。
 * 两张模板因此都可以是 `event_type = '通话'`，与卡片 `type` 一致。
 */
async function 种模板(
  projectId: string,
  id: string,
  verifiedAt: number | null,
  disabledAt: number | null = null,
): Promise<void> {
  await pg!.db.execute(sql`
    insert into auth.case_card_template
      (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at, disabled_at)
    values (${id}, ${projectId}, ${id}, '通话', '{}'::jsonb, ARRAY['谁'], 1, ${verifiedAt}, 0, 0, ${disabledAt})
  `)
}

/** 种一张卡片事件；`模板id === null` 表示没有模板来源。 */
async function 种事件(input: {
  projectId: string
  id: string
  模板id: string | null
  participants: string[]
  purpose?: string | null
  /** 默认「通话」；资金流用例要「资金交易」。 */
  type?: string
  /** 默认 1700000000；显式 `null` = 没有发生时间（计数缺口用）。 */
  时间?: number | null
  /** 默认 null；`money_flow` 的单笔最大要求 amount 非空。 */
  金额?: string
}): Promise<void> {
  await pg!.db.execute(sql`
    insert into auth.case_event
      (id, project_id, type, occurred_at, occurred_raw, precision, participants, summary,
       trust_state, template_id, amount, currency, purpose, created_at)
    values (${input.id}, ${input.projectId}, ${input.type ?? "通话"},
            ${input.时间 === undefined ? 1700000000 : input.时间}, '2023-11-14 22:13:20', '到秒',
            array(select jsonb_array_elements_text(${JSON.stringify(input.participants)}::text::jsonb)),
            ${input.id}, '自动抽取', ${input.模板id}, ${input.金额 ?? null}, 'CNY', ${input.purpose ?? null}, 0)
  `)
}

async function 种实体(projectId: string, id: string, value: string, type = "号码"): Promise<void> {
  await 建实体(pg!.db, { id, projectId, type, value })
}

/** `工具结果.数据` 是 `unknown`（各工具形状不同），按事件数组收窄再取 id。 */
function 事件id们(结果: 工具结果): string[] {
  return ((结果.数据 ?? []) as { id: unknown }[]).map((行) => String(行.id)).sort()
}

describe("AI 默认过滤未验证模板卡片（§11）", () => {
  test("query_events：默认隐藏未验证；模板行不存在与无模板仍可见；含未验证=true 放行", async () => {
    const 项目 = "p-过滤-事件"
    await 种模板(项目, "用户:t-已验", 100, 1)
    await 种模板(项目, "用户:t-未验", null)
    await 种事件({ projectId: 项目, id: "ev-已验", 模板id: "用户:t-已验", participants: ["13800000001"] })
    await 种事件({ projectId: 项目, id: "ev-未验", 模板id: "用户:t-未验", participants: ["13800000001"] })
    // 模板行不存在（`template_id` 非空但查不到行，例如内置模板尚未懒建）与无模板（null）都算可见：
    // 可见条件只在「行存在且 verified_at is null」时隐藏。已验证非空分支由 `ev-已验` 覆盖。
    await 种事件({ projectId: 项目, id: "ev-无模板", 模板id: null, participants: ["13800000001"] })
    await 种事件({ projectId: 项目, id: "ev-行不存在", 模板id: "内置:资金/v1", participants: ["13800000001"] })

    expect(事件id们(await query_events(上下文(项目), {}))).toEqual(["ev-已验", "ev-无模板", "ev-行不存在"])
    expect(事件id们(await query_events(上下文(项目), { 含未验证: true }))).toContain("ev-未验")
  })

  test("query_timeline：默认隐藏；含未验证=true 放行；统计口径一致", async () => {
    const 项目 = "p-过滤-时间线"
    await 种实体(项目, "e-线", "13800000001")
    await 种模板(项目, "用户:t-已验", 100, 1)
    await 种模板(项目, "用户:t-未验", null)
    await 种事件({ projectId: 项目, id: "ev-线-已验", 模板id: "用户:t-已验", participants: ["13800000001"] })
    await 种事件({ projectId: 项目, id: "ev-线-未验", 模板id: "用户:t-未验", participants: ["13800000001"] })

    const 默认 = await query_timeline(上下文(项目), { 实体: "13800000001" })
    expect(JSON.stringify(默认)).not.toContain("ev-线-未验")
    const 显式 = await query_timeline(上下文(项目), { 实体: "13800000001", 含未验证: true })
    expect(JSON.stringify(显式)).toContain("ev-线-未验")
  })

  test("query_timeline 统计侧：唯一事件是未验证卡 ⇒ 默认是「对象未登记」而不是「无事件」", async () => {
    const 项目 = "p-过滤-统计"
    await 种实体(项目, "e-统计", "13700000007")
    await 种模板(项目, "用户:t-统计", null)
    await 种事件({ projectId: 项目, id: "ev-统计-未验", 模板id: "用户:t-统计", participants: ["13700000007"] })

    // 列表与统计必须一起过滤：只过滤列表时统计仍数到 1 条 ⇒ 空原因从「对象未登记」漂成「无事件」。
    const 默认 = await query_timeline(上下文(项目), { 实体: "13700000007" })
    expect(JSON.stringify(默认)).not.toContain("ev-统计-未验")
    expect(默认.空原因).toBe("对象未登记")

    const 显式 = await query_timeline(上下文(项目), { 实体: "13700000007", 含未验证: true })
    expect(JSON.stringify(显式)).toContain("ev-统计-未验")
    expect(显式.空原因).toBeNull()
  })

  test("find_crossings：默认隐藏；含未验证=true 放行", async () => {
    const 项目 = "p-过滤-交叉"
    await 种实体(项目, "e-交-甲", "13800000001")
    await 种实体(项目, "e-交-乙", "13900000002")
    await 种模板(项目, "用户:t-已验", 100, 1)
    await 种模板(项目, "用户:t-未验", null)
    await 种事件({
      projectId: 项目,
      id: "ev-交-已验",
      模板id: "用户:t-已验",
      participants: ["13800000001", "13900000002"],
    })
    await 种事件({
      projectId: 项目,
      id: "ev-交-未验",
      模板id: "用户:t-未验",
      participants: ["13800000001", "13900000002"],
    })

    const 默认 = await find_crossings(上下文(项目), { 甲: "13800000001", 乙: "13900000002" })
    expect(JSON.stringify(默认)).not.toContain("ev-交-未验")
    const 显式 = await find_crossings(上下文(项目), {
      甲: "13800000001",
      乙: "13900000002",
      含未验证: true,
    })
    expect(JSON.stringify(显式)).toContain("ev-交-未验")
  })

  test("用途补判计数也过滤未验证（否则空原因会误报「用途未结构化」）", async () => {
    const 项目 = "p-过滤-用途"
    // 基线卡有意落一个用途：补判计数按整个项目数「purpose is null」，
    // 让唯一「无用途」的卡就是下面那张未验证卡，这条用例才对「要不要过滤」有咬合力。
    await 种事件({ projectId: 项目, id: "ev-用-基", 模板id: null, participants: ["13800000001"], purpose: "其他" })
    await 种模板(项目, "用户:t-用途", null)
    await 种事件({
      projectId: 项目,
      id: "ev-用-未验-无用途",
      模板id: "用户:t-用途",
      participants: ["13800000001"],
      purpose: null,
    })

    const 结果 = await query_events(上下文(项目), { 用途: "停车" })
    // 默认查询按用途过滤后为空；补判计数若把未验证卡算进去，会变成「用途未结构化」。
    expect(结果.空原因).toBe("无匹配行")
  })

  test("可见条件每次直读库：转正后可见，清 verified_at 立即隐藏，再置回恢复", async () => {
    const 项目 = "p-过滤-动态"
    await 种模板(项目, "用户:t-动态", 100)
    await 种事件({ projectId: 项目, id: "ev-动态", 模板id: "用户:t-动态", participants: ["13800000001"] })

    expect(事件id们(await query_events(上下文(项目), {}))).toContain("ev-动态")

    // 模拟「改映射 ⇒ 重新预览」：清掉转正时间，默认出口立即隐藏（判据每次直读库列，无缓存）。
    await pg!.db.execute(sql`
      update auth.case_card_template set verified_at = null
       where project_id = ${项目} and id = '用户:t-动态'
    `)
    expect(事件id们(await query_events(上下文(项目), {}))).not.toContain("ev-动态")

    // 再次转正 ⇒ 立即恢复可见。
    await pg!.db.execute(sql`
      update auth.case_card_template set verified_at = 200
       where project_id = ${项目} and id = '用户:t-动态'
    `)
    expect(事件id们(await query_events(上下文(项目), {}))).toContain("ev-动态")
  })

  test("explore_entity：经实体档案读的事件默认不含未验证卡；含未验证=true 含", async () => {
    const 项目 = "p-过滤-探索"
    await 种实体(项目, "e-探", "13500000005")
    await 种模板(项目, "用户:t-探已验", 100, 1)
    await 种模板(项目, "用户:t-探未验", null)
    await 种事件({ projectId: 项目, id: "ev-探-已验", 模板id: "用户:t-探已验", participants: ["13500000005"] })
    await 种事件({ projectId: 项目, id: "ev-探-未验", 模板id: "用户:t-探未验", participants: ["13500000005"] })

    const 默认 = await explore_entity(上下文(项目), { 实体: "13500000005" })
    // 列表与总数必须一起过滤：只过滤列表时 `事件总数` 仍数到 2 条。
    expect(JSON.stringify(默认)).not.toContain("ev-探-未验")
    expect(JSON.stringify(默认)).toContain("ev-探-已验")
    const 默认数据 = 默认.数据 as { 总数: { 事件总数: number } }
    expect(默认数据.总数.事件总数).toBe(1)

    const 显式 = await explore_entity(上下文(项目), { 实体: "13500000005", 含未验证: true })
    expect(JSON.stringify(显式)).toContain("ev-探-未验")
    expect((显式.数据 as { 总数: { 事件总数: number } }).总数.事件总数).toBe(2)
  })

  test("money_flow：默认金额与计数不含未验证卡；含未验证=true 含", async () => {
    const 项目 = "p-过滤-资金流"
    const 账户 = "6222021234567891"
    await 种实体(项目, "e-资-账户", 账户, "账户")
    await 种实体(项目, "e-资-对手", "6222021234567892", "账户")
    // 关系要带时间：`money_flow` 的 `起` 作用于关系的 `coalesce(last_at, first_at, 0)`，
    // 时间全 NULL 的关系会被时间窗排除 ⇒ 汇总为空，走不到单笔最大的断言。
    await 建关系批(pg!.db, {
      projectId: 项目,
      fromId: "e-资-账户",
      toId: "e-资-对手",
      type: "转账",
      sourceKind: "data",
      数量: 1,
      前缀: "r-资-",
      首: 1_700_000_000,
    })
    await 种模板(项目, "用户:t-资已验", 100, 1)
    await 种模板(项目, "用户:t-资未验", null)
    await 种事件({
      projectId: 项目,
      id: "ev-资-已验",
      模板id: "用户:t-资已验",
      participants: [账户],
      type: "资金交易",
      金额: "300.00",
    })
    await 种事件({
      projectId: 项目,
      id: "ev-资-未验",
      模板id: "用户:t-资未验",
      participants: [账户],
      type: "资金交易",
      金额: "900.00",
      时间: 1700000100,
    })
    // 没有发生时间的那张：默认不该出现在「无时间条数」的缺口里，含未验证=true 才数到。
    await 种事件({
      projectId: 项目,
      id: "ev-资-未验-无时",
      模板id: "用户:t-资未验",
      participants: [账户],
      type: "资金交易",
      金额: "800.00",
      时间: null,
    })

    // 起 必须给：否则 `无时间条数` 不统计（单笔窗口条件为空），这条用例对计数分支无咬合力。
    const 默认 = await money_flow(上下文(项目), { 账户, 起: 1 })
    const 默认数据 = 默认.数据 as { 单笔最大: { id: string; 金额: string }[] }
    expect(默认数据.单笔最大.map((条) => 条.id)).toEqual(["ev-资-已验"])
    expect(默认.缺口?.some((句) => 句.includes("没有发生时间")) ?? false).toBe(false)

    const 显式 = await money_flow(上下文(项目), { 账户, 起: 1, 含未验证: true })
    const 显式数据 = 显式.数据 as { 单笔最大: { id: string; 金额: string }[] }
    expect(new Set(显式数据.单笔最大.map((条) => 条.id))).toEqual(new Set(["ev-资-已验", "ev-资-未验"]))
    expect(显式.缺口?.some((句) => 句.includes("1 条资金交易事件没有发生时间")) ?? false).toBe(true)
  })
})
