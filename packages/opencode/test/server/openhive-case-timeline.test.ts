import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { query_timeline, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 种P3数据集, type P3数据集 } from "../fixtures/p3/dataset"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-p3"

/** 2025 年窗口：项目里没有任何事件。 */
const 窗外起 = 1735660800
const 窗外止 = 1767110400

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

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}
function ctx(库柄: Queryable = db(), projectId: string = 数据集.projectId): 工具上下文 {
  return { db: 库柄, 身份: { userId: 用户, projectId } }
}

/** 计数包装：`Queryable` 只有 `execute`，包一层就能钉住「最多 7 次查询」。 */
function 计数(库柄: Queryable): { db: Queryable; 次数: () => number } {
  let n = 0
  return {
    db: {
      execute: (q) => {
        n += 1
        return 库柄.execute(q)
      },
    },
    次数: () => n,
  }
}

describe("query_timeline（09 §4.3）", () => {
  test("地点分支先拒答：能力未就绪，不返回空", async () => {
    const 结果 = await query_timeline(ctx(), { 地点: "城东宾馆" })
    expect(结果.空原因).toBe("能力未就绪")
    expect(结果.数据).toBeNull()
    expect(结果.摘要).toContain("尚未支持")
  })

  test("实体与地点都不给 ⇒ bad_input", async () => {
    await expect(query_timeline(ctx(), {})).rejects.toThrow("实体与地点")
  })

  test("第一页：时间升序、缺时间条数、续页游标", async () => {
    const 结果 = await query_timeline(ctx(), { 实体: "李四", 限制: 1 })
    const 数据 = 结果.数据 as {
      事件们: { 类型: string; 时间: number; 参与者: string[] }[]
      缺时间条数: number
      下一页游标: string | null
    } | null
    expect(结果.空原因).toBeNull()
    expect(数据).not.toBeNull()
    expect(数据!.事件们).toHaveLength(1)
    // 4/1 那笔 10000 早于 4/3 的 20000、4/5 的 50 USD；升序先到 4/1。
    expect(数据!.事件们[0]!.类型).toBe("资金交易")
    expect(数据!.事件们[0]!.参与者.join()).toContain("付款方")
    expect(数据!.缺时间条数).toBe(1)
    expect(数据!.下一页游标).not.toBeNull()
    expect(结果.缺口.join()).toContain("1 个事件没有时间")
  })

  test("游标翻页：三笔有时间事件，第二页仍有游标、第三页归 null", async () => {
    const 第一页 = await query_timeline(ctx(), { 实体: "李四", 限制: 1 })
    const 游标1 = (第一页.数据 as { 下一页游标: string | null }).下一页游标
    expect(游标1).not.toBeNull()
    const 第二页 = await query_timeline(ctx(), { 实体: "李四", 限制: 1, 游标: 游标1! })
    const 数据2 = 第二页.数据 as { 事件们: { 时间: number }[]; 下一页游标: string | null } | null
    expect(第二页.空原因).toBeNull()
    expect(数据2!.事件们).toHaveLength(1)
    expect(数据2!.下一页游标).not.toBeNull()
    const 第三页 = await query_timeline(ctx(), { 实体: "李四", 限制: 1, 游标: 数据2!.下一页游标! })
    const 数据3 = 第三页.数据 as { 事件们: { 时间: number }[]; 下一页游标: string | null } | null
    expect(第三页.空原因).toBeNull()
    expect(数据3!.事件们).toHaveLength(1)
    expect(数据3!.下一页游标).toBeNull()
  })

  test("对象存在但事件全无时间 ⇒ 时间全部缺失", async () => {
    const 结果 = await query_timeline(ctx(), { 实体: "周八" })
    expect(结果.空原因).toBe("时间全部缺失")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("1 个事件没有时间")
  })

  test("对象存在但没有任何事件 ⇒ 对象未登记", async () => {
    // `吴九` 在夹具的抽取器里声明了，但原文没出现 ⇒ 抽取层拒建，p-p3 里不存在。
    // p-p3 里能解析到的实体都落在事件参与者集合里（张三经户名对齐到账户 A）。
    // 只有 p-party 的「人李四」例外：X/Y 两个账户同名 ⇒ 对齐 fail-closed，事件里没有它。
    const 结果 = await query_timeline(ctx(db(), 数据集.对齐项目), { 实体: "李四" })
    expect(结果.空原因).toBe("对象未登记")
  })

  test("窗口内没有事件但对象有历史事件 ⇒ 无事件", async () => {
    const 结果 = await query_timeline(ctx(), { 实体: "李四", 起: 窗外起, 止: 窗外止 })
    expect(结果.空原因).toBe("无事件")
  })

  test("50 张卡片的查询预算：≤ 7 次", async () => {
    const 包装 = 计数(db())
    await query_timeline(ctx(包装.db), { 实体: "李四", 限制: 50 })
    // 解析实体 1 + 事件 1 + 统计 1 + 参与者 1 + 出处 1 + 读身份标注 2 = 7
    expect(包装.次数()).toBeLessThanOrEqual(7)
  })
})
