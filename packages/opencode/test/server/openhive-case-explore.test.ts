import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { explore_entity, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 建材料, 建实体 } from "./openhive-case-fact-fixture"
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
    // 跳数默认 1：不带邻域。
    expect(数据.邻域).toBeUndefined()
    // 截断口径要如实说（关系圈上限固定 10、事件只列最近 10）。
    expect(结果.缺口.join("\n")).toContain("关系圈按对方聚合、最多 10 组（按金额降序）")
    expect(结果.缺口.join("\n")).toContain("事件只列最近 10 条，全量 4 条")
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

  test("限制只管事件条数，并在缺口里说清全量", async () => {
    const 结果 = await explore_entity(ctx(), { 实体: 数据集.账号.B, 限制: 2 })
    const 数据 = 结果.数据 as { 事件: unknown[]; 总数: { 事件总数: number } }
    expect(数据.事件).toHaveLength(2)
    expect(数据.总数.事件总数).toBe(4)
    expect(结果.缺口.join("\n")).toContain("事件只列最近 2 条，全量 4 条")
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
    // 实测账：解析实体 1 + 实体档案 8 + 关系圈 1 + 参与者视图 2 = 12。
    // （brief 推导为「解析 1 + 档案 9 + 关系圈 1 + 未解析 1」——总数同为 12，
    //  但档案实测 8 次、未解析材料数在「找到实体」路径上不查。）
    expect(次).toBe(12)
  })
})
