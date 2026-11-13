import { afterAll, beforeAll, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { find_crossings, query_events, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 种探索数据集, type 探索数据集 } from "../fixtures/explore/dataset"

/**
 * 事件参与者条件（P3 T6）：`query_events` / `find_crossings` 的「事件是否涉及该实体」
 * 必须同时认两路证据——`participants text[]` 的实体规范值，**或**参与者表里该实体的
 * 对齐代表（人 → 唯一户名账户）。
 *
 * 表格卡片的参与者是**账户**（`case-translate.ts` 的 `规范值: 本方/对方`），按人查时
 * text[] 里没有人名；旧实现只比 text[] ⇒ 按人查流水事件恒空（`#006-11` 同型静默空）。
 * 这两个用例钉住「按人查到账户参与的表格事件」。
 *
 * 数据集只经生产出口种下（`种探索数据集`），不裸写事实表（`#006-28` / `#006-35`）。
 * 起库方式与 `openhive-case-empty-reason.test.ts` 一致。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: 探索数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-explore"

/** 2026-02-10 00:00 +08:00 ～ 2026-02-10 23:59:59 +08:00（探针实测，见 relation-time 文件头）。 */
const 当天起 = 1770652800
const 当天止 = 1770739199

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
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

test("按人查事件：张三 通过唯一户名账户 A 看得到 A→B 的流水事件", async () => {
  const 结果 = await query_events(ctx(), { 参与实体: "张三", 起: 当天起, 止: 当天止 })
  // 改前：participants text[] 只有账户规范值 ⇒ 0 条、空原因=无匹配行。
  expect(结果.空原因).toBeNull()
  expect(结果.数据).toHaveLength(1)
  expect(结果.数据).toMatchObject([{ type: "资金交易" }])
})

test("共同时空：李四 与 张三 在 2/10 的流水事件上相交", async () => {
  const 结果 = await find_crossings(ctx(), { 甲: "李四", 乙: "张三", 起: 当天起, 止: 当天止 })
  // `toMatchObject` 对数组要求**同长度**：这一条同时钉住「非 null」「恰好 1 条」「类型」。
  // 不用 `as` 窄化 `unknown`：本仓 oxlint 会记 `no-unsafe-type-assertion` 新告警。
  expect(结果.数据).toMatchObject({ 共同时空: [{ type: "资金交易" }] })
})
