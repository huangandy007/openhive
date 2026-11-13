import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { aggregate_money, money_flow, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 种P3数据集, type P3数据集 } from "../fixtures/p3/dataset"

/**
 * `money_flow`（09 §4.2）：某账户的资金流。
 *
 * 汇总 / 对手方 / 外币行数 / 空原因 / 时间窗 / 账户解析全部复用 `aggregate_money`；
 * 本工具只补首末（其实也由汇总 SQL 的窗口聚合给出）、集中度、单笔最大。
 * 数据走生产入口 `种P3数据集`（`#006-35`），不裸种事实表。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-资金流"

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

function ctx(): 工具上下文 {
  return { db: db(), 身份: { userId: 用户, projectId: 数据集.projectId } }
}

describe("money_flow", () => {
  test("B：入 3 笔 35000、收支分列、首末、对手排行、单笔最大、集中度", async () => {
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as {
      笔数: number
      收入合计: string
      支出合计: string
      首末: { 首: number | null; 末: number | null }
      对手排行: { 对手方: string; 方向: string; 笔数: number; 合计: string }[]
      单笔最大: { id: string; 金额: string }[]
      集中度: Record<string, string>
      外币行数: number
    }
    expect(数据.笔数).toBe(3)
    expect(数据.收入合计).toBe("35000.00")
    expect(数据.支出合计).toBe("0.00")
    expect(数据.首末.首).toBe(1774972800)
    expect(数据.首末.末).toBe(1775181600)
    expect(数据.对手排行).toEqual([{ 对手方: "张三", 方向: "入", 笔数: 3, 合计: "35000.00" }])
    expect(数据.单笔最大.map((条) => 条.金额)).toEqual(["20000.00", "10000.00"])
    expect(数据.集中度).toEqual({ 入: "100.0%" })
    expect(数据.外币行数).toBe(1)
    // 单笔口径是整句契约，不是关键词。
    expect(结果.缺口).toContain(
      "单笔最大取资金交易事件（CNY、未排除、经基 1 涉及本账户）；只有笔录人工关系、没有对应流水事件的笔不在榜上",
    )
    // 上游 `aggregate_money` 的余额走势缺口与本工具交付无关，不许整份透传（T7/T8 口径）。
    expect(结果.缺口.join("\n")).not.toContain("人民币余额行超过")
  })

  test("与 aggregate_money 的对手方逐数相等（同一口径）", async () => {
    const 流 = await money_flow(ctx(), { 账户: 数据集.账号.A })
    const 汇总 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    const 流数据 = 流.数据 as { 对手排行: unknown }
    const 汇总数据 = 汇总.数据 as { 对手方: unknown }
    expect(流数据.对手排行).toEqual(汇总数据.对手方)
  })

  test("方向=付：所选方向没有人民币转账 ⇒ 汇总为空但空原因为 null，缺口说清", async () => {
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B, 方向: "付" })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as { 汇总: unknown[]; 支出合计: string }
    expect(数据.汇总).toEqual([])
    expect(数据.支出合计).toBe("0.00")
    // 整句全等（实得文案）：弱断言 `toContain("所选方向")` 挡不住文案漂移。
    expect(结果.缺口.at(-1)).toBe("所选方向（付）在本时间窗内没有人民币转账关系")
  })

  test("方向=收 + 对手=张三：只留入账", async () => {
    // 设计 09 §4.2 / 11 §6 的 `方向` 取值是 收 / 付 / 全部（brief 的用例写成了 aggregate_money
    // 的「入」，与同一 brief 的实现代码冲突；按设计取「收」）。
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B, 方向: "收", 对手: "张三" })
    const 数据 = 结果.数据 as { 对手排行: unknown[]; 单笔最大: unknown[] }
    expect(数据.对手排行).toHaveLength(1)
    expect(数据.单笔最大).toHaveLength(2)
  })

  test("查询次数钉住", async () => {
    let 次 = 0
    const 柄 = {
      execute: async (...参数: Parameters<Queryable["execute"]>) => {
        次++
        return db().execute(...参数)
      },
    }
    const 结果 = await money_flow(
      { db: 柄 as Queryable, 身份: { userId: 用户, projectId: 数据集.projectId } },
      { 账户: 数据集.账号.B },
    )
    expect(结果.空原因).toBeNull()
    // 实测钉住（本轮实得，见 task-9-report）：aggregate_money 自身 11 次 + 账户再解析 1 次
    // + 单笔最大 1 次 = 13。brief 推导的 14 与实得不同，按实测钉住。
    expect(次).toBe(13)
  })
})
