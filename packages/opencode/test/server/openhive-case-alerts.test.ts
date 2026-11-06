import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 规则, 提醒清单, 标记已读, 生成提醒 } from "../../src/server/openhive/case-alerts"
import { 建关系, 建实体 } from "./openhive-case-fact-fixture"

/**
 * 主动提醒 DAO（计划 7 Task 9）。
 *
 * ## 种子的数字就是判据
 *
 * `资金对称` 的闸是「两向各 ≥ 2 笔 **且** 各合计 ≥ 5000」：brief 里 `2 笔 × 1000` 的种子
 * **不命中**（合计 2000 < 5000）。这里按实际阈值把单笔抬到 3000（合计 6000），断言不改软。
 *
 * ## 与生产 SQL 的文本必须不同
 *
 * PGlite 把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的；夹具（`建实体` /
 * `建关系`）本来就与 DAO 的 SQL 不同，见夹具文件头。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-提醒"
const 别人的项目 = "p-提醒-别人"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  // ── R1 资金对称：e-账 收 2 笔 × 3000、出 2 笔 × 3000（合计各 6000 ≥ 5000、笔数各 2）──
  await 建实体(库(), { id: "e-账", projectId: 项目, type: "账户", value: "6222****9001" })
  await 建实体(库(), { id: "e-甲", projectId: 项目, type: "人", value: "甲" })
  await 建实体(库(), { id: "e-乙", projectId: 项目, type: "人", value: "乙" })
  await 建实体(库(), { id: "e-丙", projectId: 项目, type: "人", value: "丙" })
  await 建实体(库(), { id: "e-丁", projectId: 项目, type: "人", value: "丁" })
  for (const [id, from, to] of [
    ["r-入1", "e-甲", "e-账"],
    ["r-入2", "e-乙", "e-账"],
    ["r-出1", "e-账", "e-丙"],
    ["r-出2", "e-账", "e-丁"],
  ] as const)
    await 建关系(库(), { id, projectId: 项目, fromId: from, toId: to, type: "转账", amount: 3000 })

  // ── R2 通话转账重合：e-张 ↔ e-李 既有通话又有转账（合计 12000 ≥ 10000）──
  await 建实体(库(), { id: "e-张", projectId: 项目, type: "人", value: "张三" })
  await 建实体(库(), { id: "e-李", projectId: 项目, type: "人", value: "李四" })
  await 建关系(库(), { id: "r-张李话", projectId: 项目, fromId: "e-张", toId: "e-李", type: "通话" })
  await 建关系(库(), {
    id: "r-张李转",
    projectId: 项目,
    fromId: "e-张",
    toId: "e-李",
    type: "转账",
    amount: 12000,
  })

  // ── R3 号码多账户：e-号 连到 3 个账户 ──
  await 建实体(库(), { id: "e-号", projectId: 项目, type: "号码", value: "13800000000" })
  for (const [id, 值] of [
    ["e-账1", "6222****9011"],
    ["e-账2", "6222****9012"],
    ["e-账3", "6222****9013"],
  ] as const) await 建实体(库(), { id, projectId: 项目, type: "账户", value: 值 })
  for (const [id, 账] of [
    ["r-号1", "e-账1"],
    ["r-号2", "e-账2"],
    ["r-号3", "e-账3"],
  ] as const)
    await 建关系(库(), { id, projectId: 项目, fromId: "e-号", toId: 账, type: "实名登记" })

  // ── 反向各 6000（合计 12000）：按方向分组会漏报，按无序对聚合才命中 ──
  await 建实体(库(), { id: "e-王", projectId: 项目, type: "人", value: "王五" })
  await 建实体(库(), { id: "e-赵", projectId: 项目, type: "人", value: "赵六" })
  await 建关系(库(), { id: "r-王赵转1", projectId: 项目, fromId: "e-王", toId: "e-赵", type: "转账", amount: 6000 })
  await 建关系(库(), { id: "r-王赵转2", projectId: 项目, fromId: "e-赵", toId: "e-王", type: "转账", amount: 6000 })
  await 建关系(库(), { id: "r-王赵话", projectId: 项目, fromId: "e-王", toId: "e-赵", type: "通话" })

  // ── 两个方向各自都 ≥ 10000：仍应是一条（合并双向），且数字不随行序漂 ──
  await 建实体(库(), { id: "e-周", projectId: 项目, type: "人", value: "周七" })
  await 建实体(库(), { id: "e-吴", projectId: 项目, type: "人", value: "吴八" })
  await 建关系(库(), { id: "r-周吴转1", projectId: 项目, fromId: "e-周", toId: "e-吴", type: "转账", amount: 12000 })
  await 建关系(库(), { id: "r-周吴转2", projectId: 项目, fromId: "e-吴", toId: "e-周", type: "转账", amount: 15000 })
  await 建关系(库(), { id: "r-周吴话", projectId: 项目, fromId: "e-周", toId: "e-吴", type: "通话" })

  // ── 不该命中的噪声：已排除的关系不算（变异 B 靠它）──
  // ⚠️ 方向必须是 **e-账 出**：`资金对称` 的「出」取 `from_id`。若把它建成 `e-甲 → e-账`，
  // 它只会让 e-甲 多一笔出，而 e-账 的出/入笔数不变 ⇒ 变异 B（去掉 trust 过滤）**不会红**。
  await 建关系(库(), {
    id: "r-排",
    projectId: 项目,
    fromId: "e-账",
    toId: "e-甲",
    type: "转账",
    amount: 3000,
    trustState: "已排除",
  })

  // ── 别人的项目：至少命中一条规则（否则「标记已读只认本项目」是空转，`#005-47`）──
  await 建实体(库(), { id: "e-别账", projectId: 别人的项目, type: "账户", value: "6222****9999" })
  await 建实体(库(), { id: "e-别甲", projectId: 别人的项目, type: "人", value: "别甲" })
  await 建实体(库(), { id: "e-别乙", projectId: 别人的项目, type: "人", value: "别乙" })
  await 建实体(库(), { id: "e-别丙", projectId: 别人的项目, type: "人", value: "别丙" })
  await 建实体(库(), { id: "e-别丁", projectId: 别人的项目, type: "人", value: "别丁" })
  for (const [id, from, to] of [
    ["r-别入1", "e-别甲", "e-别账"],
    ["r-别入2", "e-别乙", "e-别账"],
    ["r-别出1", "e-别账", "e-别丙"],
    ["r-别出2", "e-别账", "e-别丁"],
  ] as const)
    await 建关系(库(), { id, projectId: 别人的项目, fromId: from, toId: to, type: "转账", amount: 3000 })
})

afterAll(async () => {
  await pg?.stop()
})

type 通话事实 = { 甲: string; 乙: string; 甲值: string; 乙值: string; 转账合计: string; 转账笔数: number }

describe("主动提醒 DAO", () => {
  test("三条规则各自命中，且已排除的关系不算", async () => {
    const { 提醒 } = await 生成提醒(库(), 项目)
    const 规则们 = 提醒.map((条) => 条.rule_id)
    expect(规则们.filter((条) => 条 === 规则.资金对称).length).toBe(1)
    expect(规则们.filter((条) => 条 === 规则.号码多账户).length).toBe(1)
    // R2 张/李 + 反向各 6000 + 双向各过阈值 ⇒ 三条「通话转账重合」，不是按方向拆开的四条。
    expect(规则们.filter((条) => 条 === 规则.通话转账重合).length).toBe(3)
    const 对称 = 提醒.find((条) => 条.rule_id === 规则.资金对称)!
    expect(对称.事实).toMatchObject({ 账户: "e-账", 出笔: 2, 入笔: 2 })
  })

  test("通话转账重合按无序对聚合：反向各 6000（合计 12000）命中一条", async () => {
    const { 提醒 } = await 生成提醒(库(), 项目)
    const 命中 = 提醒.filter(
      (条) => 条.rule_id === 规则.通话转账重合 && (条.事实 as 通话事实).甲值 === "王五",
    )
    expect(命中.length).toBe(1)
    expect(命中[0]!.事实).toMatchObject({
      甲: "e-王",
      乙: "e-赵",
      甲值: "王五",
      乙值: "赵六",
      转账合计: "12000.00",
      转账笔数: 2,
    })
  })

  test("通话转账重合双向各自过阈值：仍只有一条，合计不随行序漂", async () => {
    const 第一次 = await 生成提醒(库(), 项目)
    // least/greatest 按 id 排：`e-吴` < `e-周`，所以甲是吴八、乙是周七。
    const 命中 = 第一次.提醒.filter(
      (条) => 条.rule_id === 规则.通话转账重合 && (条.事实 as 通话事实).乙值 === "周七",
    )
    expect(命中.length).toBe(1)
    expect(命中[0]!.事实).toMatchObject({ 甲值: "吴八", 乙值: "周七", 转账合计: "27000.00", 转账笔数: 2 })
    expect((await 生成提醒(库(), 项目)).新建).toBe(0)
  })

  test("重复生成幂等：第二次 新建 = 0，清单长度不变", async () => {
    await 生成提醒(库(), 项目)
    const 第二次 = await 生成提醒(库(), 项目)
    expect(第二次.新建).toBe(0)
    expect((await 提醒清单(库(), 项目)).length).toBe(5)
  })

  test("已读状态在重复生成后保住（提醒不是每次都「又变成新的一批」）", async () => {
    const 清单 = await 提醒清单(库(), 项目)
    expect(await 标记已读(库(), 项目, [清单[0]!.id])).toBe(1)
    await 生成提醒(库(), 项目)
    const 之后 = await 提醒清单(库(), 项目)
    expect(之后.find((条) => 条.id === 清单[0]!.id)!.read_at).not.toBeNull()
  })

  test("标记已读处理每一个 id：排在 200 之后的也照改（不静默截断）", async () => {
    const 清单 = await 提醒清单(库(), 项目)
    const 目标 = 清单.find((条) => 条.read_at === null)!
    const ids = [...Array.from({ length: 200 }, (_, i) => `al-不存在-${i}`), 目标.id]
    expect(await 标记已读(库(), 项目, ids)).toBe(1)
  })

  test("标记已读只认本项目的 id（别的项目的 id 改不到）", async () => {
    const 别人的 = await 生成提醒(库(), 别人的项目)
    // 先钉住「别人的项目确实有提醒」——没有它，下面那个 0 在「根本没生成」时也成立（`#005-47`）。
    expect(别人的.提醒.length).toBeGreaterThan(0)
    expect(await 标记已读(库(), 项目, 别人的.提醒.map((条) => 条.id))).toBe(0)
  })
})
