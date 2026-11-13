import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 读身份标注, 身份后缀 } from "../../src/server/openhive/case-identity"
import { insertRelation, upsertEntity } from "../../src/server/openhive/case-fact-store"

/**
 * A6「疑似换主」（`01` §9 A6；调研结论 `五个待定问题的调研结论.md:194-205`）：
 * 同一号码（或账户）先后实名登记给两个人、两段时间不重叠且间隔超过阈值 ⇒
 * 身份说明必须提示「疑似换主」，摘要后缀也要带出（不能只靠详情）。
 *
 * 口径（2026-11-13 用户裁定）：
 * - 证据只用未排除的 `实名登记` 边的 `first_at` / `last_at`；
 * - 任一方时间缺失、或两段时间重叠、或间隔 ≤ 90 天 ⇒ **不提示**（fail-closed，不猜）；
 * - 身份档不变（仍是「已核实」：有实名登记证据是事实），只加说明与提示。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  await pg?.stop()
})
function db() {
  if (!pg) throw new Error("真库没起来")
  return pg.db
}

/** `YYYY-MM-DD`（UTC）→ 秒。测试时间写死，不依赖 `Date.now()`。 */
const 日 = (s: string): number => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000)

async function 建实体(projectId: string, id: string, type: string, 值: string): Promise<void> {
  await upsertEntity(db(), { id, projectId, type, canonicalValue: 值, aliases: [] })
}

async function 建实名(
  projectId: string,
  id: string,
  fromId: string,
  toId: string,
  窗: { 起?: number; 止?: number } = {},
  trustState: "自动抽取" | "已排除" = "自动抽取",
): Promise<void> {
  await insertRelation(db(), {
    id,
    projectId,
    fromId,
    toId,
    type: "实名登记",
    sourceKind: "human",
    trustState,
    firstAt: 窗.起 ?? null,
    lastAt: 窗.止 ?? null,
  })
}

/** 建「两人实名登记同一实体」的最小场景，返回实体 id 与读到的标注。 */
async function 两人场景(
  projectId: string,
  类型: "号码" | "账户",
  值: string,
  甲窗: { 起?: number; 止?: number },
  乙窗: { 起?: number; 止?: number },
) {
  await 建实体(projectId, `${projectId}-目标`, 类型, 值)
  await 建实体(projectId, `${projectId}-甲`, "人", "甲某")
  await 建实体(projectId, `${projectId}-乙`, "人", "乙某")
  await 建实名(projectId, `${projectId}-r-甲`, `${projectId}-甲`, `${projectId}-目标`, 甲窗)
  await 建实名(projectId, `${projectId}-r-乙`, `${projectId}-乙`, `${projectId}-目标`, 乙窗)
  const 表 = await 读身份标注(db(), projectId, [{ id: `${projectId}-目标`, 类型, 值 }])
  const 标 = 表.get(`${projectId}-目标`)
  if (标 === undefined) throw new Error("没读到标注")
  return 标
}

describe("A6 疑似换主", () => {
  test("号码：两段时间不重叠且相隔 120 天 ⇒ 说明与后缀都提示", async () => {
    const 标 = await 两人场景(
      "p-换主-是",
      "号码",
      "13800000001",
      { 起: 日("2026-01-01"), 止: 日("2026-02-01") },
      { 起: 日("2026-06-01"), 止: 日("2026-07-01") },
    )
    expect(标.档).toBe("已核实")
    expect(标.说明).toContain("疑似换主")
    expect(标.说明).toContain("120 天")
    expect(标.说明).toContain("不能认定当前归属")
    expect(标.提示).toBeDefined()
    const 后缀 = 身份后缀([标])
    expect(后缀).toContain("疑似换主")
    expect(后缀).toContain("甲某")
    expect(后缀).toContain("乙某")
  })

  test("号码：相隔 30 天（未过阈值）⇒ 不提示", async () => {
    const 标 = await 两人场景(
      "p-换主-近",
      "号码",
      "13800000002",
      { 起: 日("2026-01-01"), 止: 日("2026-02-01") },
      { 起: 日("2026-03-03"), 止: 日("2026-04-01") },
    )
    expect(标.档).toBe("已核实")
    expect(标.说明).not.toContain("疑似换主")
    expect(标.提示).toBeUndefined()
    expect(身份后缀([标])).toBe("")
  })

  test("号码：一方没有时间窗 ⇒ fail-closed，不提示", async () => {
    const 标 = await 两人场景(
      "p-换主-缺时",
      "号码",
      "13800000003",
      { 起: 日("2026-01-01"), 止: 日("2026-02-01") },
      {},
    )
    expect(标.说明).not.toContain("疑似换主")
    expect(标.提示).toBeUndefined()
  })

  test("号码：两段时间重叠 ⇒ 不提示", async () => {
    const 标 = await 两人场景(
      "p-换主-重叠",
      "号码",
      "13800000004",
      { 起: 日("2026-01-01"), 止: 日("2026-06-01") },
      { 起: 日("2026-03-01"), 止: 日("2026-08-01") },
    )
    expect(标.说明).not.toContain("疑似换主")
    expect(标.提示).toBeUndefined()
  })

  test("号码：同一个人两条边（时间相隔很远）⇒ 不与自己比，不提示", async () => {
    const p = "p-换主-同一人"
    await 建实体(p, `${p}-目标`, "号码", "13800000005")
    await 建实体(p, `${p}-甲`, "人", "甲某")
    await 建实名(p, `${p}-r-1`, `${p}-甲`, `${p}-目标`, { 起: 日("2026-01-01"), 止: 日("2026-02-01") })
    await 建实名(p, `${p}-r-2`, `${p}-甲`, `${p}-目标`, { 起: 日("2026-09-01"), 止: 日("2026-10-01") })
    const 表 = await 读身份标注(db(), p, [{ id: `${p}-目标`, 类型: "号码", 值: "13800000005" }])
    const 标 = 表.get(`${p}-目标`)
    if (标 === undefined) throw new Error("没读到标注")
    expect(标.说明).not.toContain("疑似换主")
    expect(标.提示).toBeUndefined()
  })

  test("号码：一条实名登记边已排除 ⇒ 不参与换主", async () => {
    const p = "p-换主-排除"
    await 建实体(p, `${p}-目标`, "号码", "13800000006")
    await 建实体(p, `${p}-甲`, "人", "甲某")
    await 建实体(p, `${p}-乙`, "人", "乙某")
    await 建实名(p, `${p}-r-甲`, `${p}-甲`, `${p}-目标`, { 起: 日("2026-01-01"), 止: 日("2026-02-01") })
    await 建实名(
      p,
      `${p}-r-乙`,
      `${p}-乙`,
      `${p}-目标`,
      { 起: 日("2026-06-01"), 止: 日("2026-07-01") },
      "已排除",
    )
    const 表 = await 读身份标注(db(), p, [{ id: `${p}-目标`, 类型: "号码", 值: "13800000006" }])
    const 标 = 表.get(`${p}-目标`)
    if (标 === undefined) throw new Error("没读到标注")
    expect(标.说明).not.toContain("疑似换主")
    expect(标.提示).toBeUndefined()
  })

  test("账户：同构场景同样提示（账户也会二次开户）", async () => {
    const 标 = await 两人场景(
      "p-换主-账户",
      "账户",
      "6222021234567890513",
      { 起: 日("2026-01-01"), 止: 日("2026-02-01") },
      { 起: 日("2026-06-01"), 止: 日("2026-07-01") },
    )
    expect(标.档).toBe("已核实")
    expect(标.说明).toContain("疑似换主")
    expect(标.提示).toBeDefined()
  })
})
