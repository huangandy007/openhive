import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  type 工具上下文,
  type 工具结果,
} from "../../src/server/openhive/case-mcp-tools"
import { 种探索数据集, type 探索数据集 } from "../fixtures/explore/dataset"

/**
 * 关系时间贯穿（Task 2b）：笔录里「2026年2月10日，张三向李四转账5万元」抽出来后，
 * `case_relation.first_at/last_at` 必须落到 2026-02-10（epoch 见下），否则
 * `aggregate_money` 的时间窗 `coalesce(last_at, first_at, 0) >= 起` 会把 5 笔转账全滤掉。
 *
 * ## epoch 数字是探针实测值，不是「再调一次 parseTime」
 *
 * 探针（2026-11-12 本机）：
 * ```
 * "2026年2月10日" {"seconds":1770652800,"precision":"到日"}
 * "2026年2月11日" {"seconds":1770739200,"precision":"到日"}
 * "2026年2月12日" {"seconds":1770825600,"precision":"到日"}
 * "2026年2月15日" {"seconds":1771084800,"precision":"到日"}
 * "2026年2月20日" {"seconds":1771516800,"precision":"到日"}
 * "2026-01-28"    1769529600（= 2026-01-27T16:00:00.000Z）
 * "2026-02-26"    1772035200（= 2026-02-25T16:00:00.000Z）
 * "2025-01-01"    1735660800   "2025-12-31" 1767110400
 * ```
 * `case-time.ts` 的时区约定：**固定 Asia/Shanghai（UTC+8）**，`Date.UTC(...) - 8h`
 * （`TZ_OFFSET_SECONDS = 8 * 3600`），不按进程时区漂。
 *
 * 起库方式与 `openhive-case-explore-seed.test.ts` / `openhive-case-explore-replay.test.ts`
 * 一致：`startProductionDb()` 撑 PGlite，再自建 `PG_POOL_MAX=1` 的客户端。
 * 数据集只经生产出口种下（`种探索数据集`），不裸写事实表。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: 探索数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-explore"

/** 探针实测 epoch（秒）。5 条转账两两不同，全部落在 2026-02-10–2026-02-20。 */
const 转账时间 = [1770652800, 1770739200, 1770825600, 1771084800, 1771516800] as const
const 窗口起 = 1769529600 // 2026-01-28 00:00 +08:00
const 窗口止 = 1772035200 // 2026-02-26 00:00 +08:00
const 窗外起 = 1735660800 // 2025-01-01 00:00 +08:00
const 窗外止 = 1767110400 // 2025-12-31 00:00 +08:00

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  // 种数据集必须在新库里只跑一次（指纹相同会走幂等分支并抛「材料没有入队」）。
  数据集 = await 种探索数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

function ctx(): 工具上下文 {
  return { db: db(), 身份: { userId: 用户, projectId: 数据集.projectId } }
}

describe("关系时间贯穿（09 §7.4 / §9.1）", () => {
  test("转账关系的 first_at / last_at 落库且精度为到日", async () => {
    const 行们 = rowsOf(
      await db().execute(sql`
        select first_at, last_at, precision
          from auth.case_relation
         where project_id = ${数据集.projectId} and type = '转账'
         order by first_at asc
      `),
    )
    // 数据集里就是 5 条转账；不是 5 条说明夹具或落库变了，后面的断言都会失去意义。
    expect(行们.length).toBe(5)
    for (const 行 of 行们) {
      expect(行.first_at).not.toBeNull()
      expect(行.last_at).toBe(行.first_at)
      expect(String(行.precision)).toBe("到日")
    }
    const 值们 = 行们.map((行) => Number(行.first_at))
    // 与探针实测值逐个相等：同时覆盖「互不相同」「落在 2026-02-10–2026-02-20」。
    expect(值们).toEqual([...转账时间])
    for (const 值 of 值们) {
      expect(值).toBeGreaterThanOrEqual(转账时间[0])
      expect(值).toBeLessThanOrEqual(转账时间[4])
    }
  })

  // 代码按「模型给没给 `时间原文`」判，不按关系类型抑制；本数据集里这 6 条恰好都没给。
  // 所以这条证明的是「本数据集里 持有/实名登记 仍为 NULL」，不是「持有/实名登记 类型被特意跳过」。
  test("本数据集里持有 / 实名登记没给时间原文 ⇒ first_at/last_at 仍为 NULL", async () => {
    const 行们 = rowsOf(
      await db().execute(sql`
        select type, first_at, last_at
          from auth.case_relation
         where project_id = ${数据集.projectId}
           and type in ('持有', '实名登记')
         order by type asc, id asc
      `),
    )
    // 5 持有 + 1 实名登记。
    expect(行们.length).toBe(6)
    for (const 行 of 行们) {
      expect(行.first_at).toBeNull()
      expect(行.last_at).toBeNull()
    }
  })

  test("aggregate_money 带起止时收付分列为 2 笔 / 3 笔，而非一笔都没有", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.A, 起: 窗口起, 止: 窗口止 })
    const 数据 = 结果.数据
    // 用 `in` 收窄而不是类型断言：断言会把「数据形状变了」变成编译期盲区。
    if (数据 === null || typeof 数据 !== "object" || !("汇总" in 数据)) {
      throw new Error(`aggregate_money 没有返回汇总：${JSON.stringify(结果)}`)
    }
    // 两个方向各是独立条目，没有第三条把它们相加——收付分列不相抵。
    expect(数据.汇总).toEqual([
      { 方向: "出", 笔数: 3, 合计: "180000.00" },
      { 方向: "入", 笔数: 2, 合计: "28000.00" },
    ])
  })

  // 窗内 0 笔也算「确实没有交易」：这是 `09` §3.5 判定表第 1 条（账户有持有 / 明细证据、
  // 时间窗内 0 笔转账），**不是回归**。A 有「张三—持有→A」这条证据，所以窗外的 5 笔转账
  // 被时间窗滤掉后，正确答案是「确实没有交易」，不再回兜底值。
  test("窗外时间窗（2025 年）⇒ 汇总为空，空原因为「确实没有交易」", async () => {
    const 结果: 工具结果 = await aggregate_money(ctx(), {
      账户: 数据集.账号.A,
      起: 窗外起,
      止: 窗外止,
    })
    expect(结果.数据).toBeNull()
    expect(结果.空原因).toBe("确实没有交易")
  })
})
