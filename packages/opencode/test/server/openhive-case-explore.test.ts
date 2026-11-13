import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { aggregate_money, explore_entity, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 建户名别名, 建关系, 建材料, 建实体 } from "./openhive-case-fact-fixture"
import { 种P3数据集, type P3数据集 } from "../fixtures/p3/dataset"

/**
 * `explore_entity`（09 §4.1 / 11 §5）：档案 + 关系圈 + 最近事件 + 全量计数。
 *
 * 数据走生产入口 `种P3数据集`（`#006-35`，不裸种事实表）。B 的口径已被
 * `openhive-case-attribution.test.ts` 钉住：关系 4（数据 2 / 人 2）、对方 2、事件 4；
 * 关系圈里 A 经唯一户名对齐成「张三」、纯外币 B→C（times_cny=0）不进圈。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-探索"

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种P3数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db(): Queryable {
  if (!库) throw new Error("真库没起来")
  return 库
}

function ctx(projectId = 数据集.projectId): 工具上下文 {
  return { db: db(), 身份: { userId: 用户, projectId } }
}

async function 实体id(值: string): Promise<string> {
  const 行们 = rowsOf(
    await 库!.execute(sql`
      select id from auth.case_entity where project_id = ${数据集.projectId} and canonical_value = ${值}
    `),
  )
  const id = 行们[0]?.id
  if (typeof id !== "string") throw new Error(`找不到实体：${值}`)
  return id
}

describe("explore_entity", () => {
  test("B：档案 + 关系圈 + 事件 + 全量计数", async () => {
    const 结果 = await explore_entity(ctx(), { 实体: 数据集.账号.B })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as {
      档案: { type: string; canonical_value: string; trust_state: string }
      关系圈: {
        对方: string
        对方类型: string
        对方细类: string | null
        方向: string
        类型: string
        次数: number
        金额: string | null
        首: number | null
        末: number | null
      }[]
      事件: { id: string; 类型: string; 时间: number | null; 参与者: string[]; 信任态: string }[]
      总数: { 关系总数: number; 对方数: number; 事件总数: number }
      邻域?: unknown
    }
    expect(数据.档案.type).toBe("账户")
    expect(数据.档案.canonical_value).toBe(数据集.账号.B)
    // 对方展示走「对齐代表」（10 §3.1）：A 有唯一户名「张三」⇒ 显示张三，不是账号。
    // 纯外币 B→C（times_cny=0）按 `aggregate_money` 同口径不进圈（D-9）。
    expect(数据.关系圈).toHaveLength(1)
    expect(数据.关系圈[0]).toEqual({
      对方: "张三",
      对方类型: "人",
      对方细类: null,
      方向: "入",
      类型: "转账",
      次数: 3,
      金额: "35000.00",
      // 笔录「2026年4月1日」是最早一笔（UTC+8），流水 2026-04-03 10:00 是最晚一笔。
      首: 1774972800,
      末: 1775181600,
    })
    expect(数据.事件).toHaveLength(4)
    // 参与者摘要走共享 `参与者视图`（含已排除 = false），不是原样回 participants。
    for (const 条 of 数据.事件) expect(Array.isArray(条.参与者)).toBe(true)
    expect(数据.总数).toEqual({ 关系总数: 4, 对方数: 2, 事件总数: 4 })
    // 「关系总数 4 / 对方数 2」与「关系圈 1 组」的差必须由缺口解释：纯外币 B→C 不进圈。
    expect(数据.关系圈).toHaveLength(1)
    expect(数据.关系圈.length).toBeLessThan(数据.总数.对方数)
    // 跳数默认 1：不带邻域。
    expect(数据.邻域).toBeUndefined()
    // 缺口精确全等：上限说明 + 纯外币 1 条；事件没有真截断（4/4）⇒ 不写事件缺口。
    expect(结果.缺口).toEqual([
      "关系圈按对方聚合、最多 10 组（按金额降序）",
      "1 条关系金额为 0.00 且笔数含外币（外币金额不进关系圈）",
    ])
  })

  test("A：人与账户 B 合成一组（分组键是代表，展示优先用户名）", async () => {
    const 结果 = await explore_entity(ctx(), { 实体: 数据集.账号.A })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as {
      关系圈: { 对方: string; 对方类型: string; 方向: string; 次数: number; 金额: string | null }[]
    }
    // A→账户B 与 A→人李四 按 `coalesce(户名对齐代表, 对方.id)` 合成一组；展示取人名李四。
    expect(数据.关系圈).toHaveLength(1)
    expect(数据.关系圈[0]).toMatchObject({
      对方: "李四",
      对方类型: "人",
      方向: "出",
      次数: 3,
      金额: "35000.00",
    })
  })

  test("跳数=2：附 1～2 跳邻域", async () => {
    const B = await 实体id(数据集.账号.B)
    const 结果 = await explore_entity(ctx(), { 实体: B, 跳数: 2 })
    const 数据 = 结果.数据 as { 邻域?: { 节点: unknown[] } }
    expect(结果.空原因).toBeNull()
    expect(数据.邻域?.节点).toHaveLength(3)
  })

  test("限制只管事件条数：真截断才写缺口，并写实际交付条数", async () => {
    const 结果 = await explore_entity(ctx(), { 实体: 数据集.账号.B, 限制: 2 })
    const 数据 = 结果.数据 as { 事件: unknown[]; 总数: { 事件总数: number } }
    expect(数据.事件).toHaveLength(2)
    expect(数据.总数.事件总数).toBe(4)
    expect(结果.缺口).toEqual([
      "关系圈按对方聚合、最多 10 组（按金额降序）",
      "1 条关系金额为 0.00 且笔数含外币（外币金额不进关系圈）",
      "事件只列最近 2 条，全量 4 条",
    ])
  })

  test("限制 ≥ 全量（4/4）：不写事件截断缺口", async () => {
    const 结果 = await explore_entity(ctx(), { 实体: 数据集.账号.B, 限制: 4 })
    const 数据 = 结果.数据 as { 事件: unknown[] }
    expect(数据.事件).toHaveLength(4)
    // 旧实现无条件写「最近 4 条，全量 4 条」；这条用全等把它挡住。
    expect(结果.缺口).toEqual([
      "关系圈按对方聚合、最多 10 组（按金额降序）",
      "1 条关系金额为 0.00 且笔数含外币（外币金额不进关系圈）",
    ])
  })

  test("起止只作用于关系圈：窗外圈空，事件与总数仍全时段", async () => {
    // 2026-04-27 之后：夹具里的关系全在窗前，事件仍应原样返回（I3 的不对称）。
    const 结果 = await explore_entity(ctx(), { 实体: 数据集.账号.B, 起: 1777219200 })
    const 数据 = 结果.数据 as {
      关系圈: unknown[]
      事件: unknown[]
      总数: { 关系总数: number; 对方数: number; 事件总数: number }
    }
    expect(数据.关系圈).toEqual([])
    expect(数据.事件).toHaveLength(4)
    expect(数据.总数).toEqual({ 关系总数: 4, 对方数: 2, 事件总数: 4 })
    expect(结果.摘要).toContain("关系圈 0 组")
    expect(结果.口径).toContain("起止只作用于关系圈")
    // 窗外的纯外币也不计：缺口只剩上限说明。
    expect(结果.缺口).toEqual(["关系圈按对方聚合、最多 10 组（按金额降序）"])
  })

  test("无此实体：空原因 + 引导，不抛错", async () => {
    // 用独立空项目：p-p3 的 `P3笔录.txt` 落库状态是「有问题」（≠ 已解析），
    // 按空原因优先级必须回「材料未解析」，测不到「无此实体」（实测，见报告）。
    const 结果 = await explore_entity(ctx("p-无此实体"), { 实体: "查无此人" })
    expect(结果.空原因).toBe("无此实体")
    expect(结果.数据).toBeNull()
    expect(结果.摘要).toBe("本项目里找不到实体「查无此人」")
    expect(结果.下一步[0]?.工具).toBe("query_entities")
  })

  test("项目里有未解析材料 ⇒ 材料未解析（不是无此实体）", async () => {
    await 建材料(db(), { id: "m-未解析", projectId: "p-探索", path: "探索未解析.txt" })
    const 结果 = await explore_entity(ctx("p-探索"), { 实体: "查无此人" })
    expect(结果.空原因).toBe("材料未解析")
    expect(结果.数据).toBeNull()
    expect(结果.摘要).toBe("「查无此人」查不到：项目里还有 1 份材料尚未解析，现在还不能断定没有这个实体")
    expect(结果.缺口).toEqual(["1 份材料尚未解析，其中可能含资金流水"])
    expect(结果.下一步[0]?.工具).toBe("search_materials")
  })

  test("实体存在但无任何事实", async () => {
    await 建实体(db(), { id: "e-空", projectId: "p-探索", value: "空档案" })
    const 结果 = await explore_entity(ctx("p-探索"), { 实体: "空档案" })
    expect(结果.空原因).toBe("实体存在但无任何事实")
    expect(结果.数据).toBeNull()
    expect(结果.摘要).toBe("「空档案」在档案里没有任何关系或事件")
  })

  test("实体被排除：回无此实体，摘要说明已排除", async () => {
    await 建实体(db(), { id: "e-排单", projectId: "p-排除", value: "被排者", trustState: "已排除" })
    const 结果 = await explore_entity(ctx("p-排除"), { 实体: "被排者" })
    expect(结果.空原因).toBe("无此实体")
    expect(结果.数据).toBeNull()
    expect(结果.摘要).toBe("实体「被排者」已排除或不属于本项目")
    expect(结果.下一步[0]?.工具).toBe("query_entities")
  })

  test("查询次数钉住", async () => {
    let 次 = 0
    const 柄 = {
      execute: async (...参数: Parameters<Queryable["execute"]>) => {
        次++
        return db().execute(...参数)
      },
    }
    const 结果 = await explore_entity(
      { db: 柄 as Queryable, 身份: { userId: 用户, projectId: 数据集.projectId } },
      { 实体: 数据集.账号.B },
    )
    expect(结果.空原因).toBeNull()
    // 实测账（修轮 1）：解析实体 1 + 实体档案 8 + 关系圈 1 + 关系圈遗漏 3
    // + 参与者视图 2 = 15。遗漏 3 = 纯外币 / 内部往来 / 归属歧义各一次 count。
    expect(次).toBe(15)
  })

  test("限制 不改变查询次数（无每事件 N+1）", async () => {
    const 数 = async (限制: number): Promise<number> => {
      let 次 = 0
      const 柄 = {
        execute: async (...参数: Parameters<Queryable["execute"]>) => {
          次++
          return db().execute(...参数)
        },
      }
      const 结果 = await explore_entity(
        { db: 柄 as Queryable, 身份: { userId: 用户, projectId: 数据集.projectId } },
        { 实体: 数据集.账号.B, 限制 },
      )
      expect(结果.空原因).toBeNull()
      return 次
    }
    // 1 条与 4 条事件必须走同样多的查询：参与者摘要是批量取，不是逐事件查。
    expect(await 数(1)).toBe(await 数(4))
  })
})

describe("账户展示与关系圈遗漏（独立项目，不污染既有夹具）", () => {
  const 展示项目 = "p-展示"
  const Q = "6222000000000001"
  const P = "6222000000000002"
  const S = "6222000000000003"
  const T = "6222000000000004"

  test("组织户名展示组织名；候选 ≥ 2 回落账号（汇总与关系圈同口径）", async () => {
    // 账户 Q 为中心；P 的唯一户名是组织「某某公司」；S 有两个户名人名 ⇒ fail-closed。
    await 建实体(db(), { id: "e-展-Q", projectId: 展示项目, type: "账户", value: Q })
    await 建实体(db(), { id: "e-展-P", projectId: 展示项目, type: "账户", value: P })
    await 建实体(db(), { id: "e-展-S", projectId: 展示项目, type: "账户", value: S })
    await 建实体(db(), { id: "e-展-T", projectId: 展示项目, type: "账户", value: T })
    await 建实体(db(), { id: "e-展-公司", projectId: 展示项目, type: "组织", value: "某某公司" })
    await 建实体(db(), { id: "e-展-张Q", projectId: 展示项目, value: "张Q" })
    await 建实体(db(), { id: "e-展-王歧", projectId: 展示项目, value: "王歧" })
    await 建实体(db(), { id: "e-展-人甲", projectId: 展示项目, value: "人甲" })
    await 建实体(db(), { id: "e-展-人乙", projectId: 展示项目, value: "人乙" })
    await 建实体(db(), { id: "e-展-R", projectId: 展示项目, value: "R" })
    await 建户名别名(db(), { id: "a-展-Q-张Q", projectId: 展示项目, entityId: "e-展-Q", value: "张Q" })
    await 建户名别名(db(), { id: "a-展-Q-王歧", projectId: 展示项目, entityId: "e-展-Q", value: "王歧" })
    await 建户名别名(db(), { id: "a-展-T-王歧", projectId: 展示项目, entityId: "e-展-T", value: "王歧" })
    await 建户名别名(db(), { id: "a-展-P-公司", projectId: 展示项目, entityId: "e-展-P", value: "某某公司" })
    await 建户名别名(db(), { id: "a-展-S-甲", projectId: 展示项目, entityId: "e-展-S", value: "人甲" })
    await 建户名别名(db(), { id: "a-展-S-乙", projectId: 展示项目, entityId: "e-展-S", value: "人乙" })
    await 建关系(db(), { id: "r-展-Q-P", projectId: 展示项目, fromId: "e-展-Q", toId: "e-展-P", amount: 100 })
    await 建关系(db(), { id: "r-展-Q-S", projectId: 展示项目, fromId: "e-展-Q", toId: "e-展-S", amount: 200 })
    // 内部往来：张Q 是 Q 的唯一户名（两端都在归属集）；歧义：王歧 对应 Q、T 两个账户。
    await 建关系(db(), { id: "r-展-内部", projectId: 展示项目, fromId: "e-展-张Q", toId: "e-展-Q", amount: 50 })
    await 建关系(db(), { id: "r-展-歧义", projectId: 展示项目, fromId: "e-展-王歧", toId: "e-展-R", amount: 30 })

    const 探索 = await explore_entity(ctx(展示项目), { 实体: Q })
    expect(探索.空原因).toBeNull()
    const 数据 = 探索.数据 as {
      关系圈: { 对方: string; 对方类型: string; 方向: string; 次数: number; 金额: string | null }[]
    }
    expect(数据.关系圈).toHaveLength(2)
    expect(数据.关系圈.find((组) => 组.对方 === "某某公司")).toMatchObject({
      对方类型: "组织",
      方向: "出",
      次数: 1,
      金额: "100.00",
    })
    // S 的户名候选 2 个 ⇒ 回落账号本身，不猜其中一个人名。
    expect(数据.关系圈.find((组) => 组.对方 === S)).toMatchObject({
      对方类型: "账户",
      方向: "出",
      次数: 1,
      金额: "200.00",
    })
    // 丢掉的两类关系各带具体条数进缺口（I1）。
    expect(探索.缺口).toEqual([
      "关系圈按对方聚合、最多 10 组（按金额降序）",
      "1 条关系两端都在本账户归属集内（账户内部往来），未计入关系圈",
      "1 条关系因户名对应多个账户未归属本账户（fail-closed，不猜）",
    ])

    // `aggregate_money` 的对手方展示与关系圈同一份 `账户展示名`：组织名显示、歧义回落账号。
    const 汇总 = await aggregate_money(ctx(展示项目), { 账户: Q })
    expect(汇总.空原因).toBeNull()
    const 对手方 = (汇总.数据 as { 对手方: { 对手方: string; 方向: string; 笔数: number; 合计: string }[] })
      .对手方
    expect(对手方).toEqual([
      { 对手方: S, 方向: "出", 笔数: 1, 合计: "200.00" },
      { 对手方: "某某公司", 方向: "出", 笔数: 1, 合计: "100.00" },
    ])
  })
})
