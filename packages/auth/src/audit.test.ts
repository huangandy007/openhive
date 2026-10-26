/**
 * 审计流水（010 T010 / FR-009 / SC-003）。
 *
 * 判据只钉**这张表与这两个函数答应的事**：
 * ① 一行审计的每一列都能逐字往返（含 `detail` 的 JSON 往返、时间为 Unix 秒）；
 * ② 检索的窗口/筛选/分页/排序各是语义而不只是「参数被接受」；
 * ③ 用户输入里的 `%` / `_` 是**字面量**，不能变成通配（否则一次误输入就翻出全部日志）。
 *
 * 「谁在什么时候真的写了审计」在 opencode 的治理路由测里钉（本文件只测存储与检索）。
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "./migrate"
import { listAuditEvents, recordAuditEvent, type AuditEventInput } from "./audit"
import { startProductionDb, type ProductionDb } from "./test-support"

let pg: ProductionDb
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  await pg?.stop()
})

/** 一条可覆盖的最小审计行。`occurredAt` 缺省用「现在」，测试里都显式给。 */
const 一条 = (overrides: Partial<AuditEventInput> = {}): AuditEventInput => ({
  actorId: "u-甲",
  actorName: "甲民警",
  actorPoliceNo: "930011",
  board: "account-manage",
  action: "account.create",
  targetType: "user",
  targetId: "u-乙",
  result: "ok",
  detail: { policeNo: "930012" },
  occurredAt: 1_700_000_000,
  ...overrides,
})

describe("写", () => {
  test("全列逐字往返：detail 是对象、id / occurred_at 是 number（秒）", async () => {
    await recordAuditEvent(pg.db, 一条({ detail: { policeNo: "930012", name: "乙民警" } }))
    const page = await listAuditEvents(pg.db, { actor: "930011" })
    expect(page.items).toHaveLength(1)
    const row = page.items[0]!
    expect(row).toMatchObject({
      actor_id: "u-甲",
      actor_name: "甲民警",
      actor_police_no: "930011",
      board: "account-manage",
      action: "account.create",
      target_type: "user",
      target_id: "u-乙",
      result: "ok",
      detail: { policeNo: "930012", name: "乙民警" },
      occurred_at: 1_700_000_000,
    })
    // ⚠️ 必须是 number：bun-sql 把 BIGINT 吐成 BigInt/字符串，只做大小比较会绿得空转（#002-01）。
    expect(typeof row.id).toBe("number")
    expect(typeof row.occurred_at).toBe("number")
  })

  test("可空列：board / target / detail 缺省 ⇒ null / null / {}（不是字符串 \"null\"）", async () => {
    await recordAuditEvent(
      pg.db,
      一条({ actorId: "u-丙", actorPoliceNo: "930013", board: undefined, targetType: undefined, targetId: undefined, detail: undefined, action: "tool.denied", result: "denied" }),
    )
    const page = await listAuditEvents(pg.db, { actor: "930013" })
    const row = page.items[0]!
    expect(row.board).toBeNull()
    expect(row.target_type).toBeNull()
    expect(row.target_id).toBeNull()
    expect(row.detail).toEqual({})
    expect(row.result).toBe("denied")
  })
})

describe("检索", () => {
  test("窗口左闭右开 [from, to)：恰好 from 的进、恰好 to 的不进", async () => {
    const 甲 = "u-窗口"
    await recordAuditEvent(pg.db, 一条({ actorId: 甲, actorPoliceNo: "940001", occurredAt: 1_000 }))
    await recordAuditEvent(pg.db, 一条({ actorId: 甲, actorPoliceNo: "940001", occurredAt: 1_005 }))
    await recordAuditEvent(pg.db, 一条({ actorId: 甲, actorPoliceNo: "940001", occurredAt: 1_010 }))

    const 命中 = await listAuditEvents(pg.db, { actor: "940001", from: 1_000, to: 1_010 })
    expect(命中.items.map((row) => row.occurred_at)).toEqual([1_005, 1_000])
  })

  test("actor 匹配姓名**或**警号（子串）；`%` / `_` 是字面量不是通配", async () => {
    await recordAuditEvent(pg.db, 一条({ actorId: "u-丁", actorName: "丁民警", actorPoliceNo: "950001" }))
    // 姓名命中
    expect((await listAuditEvents(pg.db, { actor: "丁民" })).total).toBeGreaterThanOrEqual(1)
    // 警号命中
    expect((await listAuditEvents(pg.db, { actor: "9500" })).items.every((row) => row.actor_police_no === "950001")).toBe(true)
    // `%` 若不转义会匹配全部行——那条用例证明它是字面量
    expect((await listAuditEvents(pg.db, { actor: "%" })).total).toBe(0)
    expect((await listAuditEvents(pg.db, { actor: "_" })).total).toBe(0)
  })

  test("action / result 是精确筛选，可与窗口叠加", async () => {
    const 标记 = "u-筛"
    await recordAuditEvent(pg.db, 一条({ actorId: 标记, actorPoliceNo: "960001", action: "org.rename", result: "ok", occurredAt: 2_000 }))
    await recordAuditEvent(pg.db, 一条({ actorId: 标记, actorPoliceNo: "960001", action: "org.rename", result: "failed", occurredAt: 2_001 }))
    await recordAuditEvent(pg.db, 一条({ actorId: 标记, actorPoliceNo: "960001", action: "org.delete", result: "ok", occurredAt: 2_002 }))

    const 失败的重命名 = await listAuditEvents(pg.db, { actor: "960001", action: "org.rename", result: "failed" })
    expect(失败的重命名.items.map((row) => row.occurred_at)).toEqual([2_001])

    const 窗口内的重命名 = await listAuditEvents(pg.db, { actor: "960001", action: "org.rename", from: 2_001, to: 9_999 })
    expect(窗口内的重命名.items.map((row) => row.result)).toEqual(["failed"])
  })

  test("q 匹配对象 id 与 detail 文本（不匹配操作人与动作）", async () => {
    const 标记 = "u-关"
    await recordAuditEvent(pg.db, 一条({ actorId: 标记, actorPoliceNo: "970001", targetId: "p-专案-42", detail: { reason: "调离" } }))
    expect((await listAuditEvents(pg.db, { q: "专案-42" })).items.every((row) => row.target_id === "p-专案-42")).toBe(true)
    expect((await listAuditEvents(pg.db, { q: "调离" })).items.some((row) => row.actor_id === 标记)).toBe(true)
    // 操作人姓名不进 q（那是 actor 参数的职责）
    expect((await listAuditEvents(pg.db, { q: "甲民警", actor: "970001" })).total).toBe(0)
  })

  test("排序 occurred_at 倒序、同秒按 id 倒序（翻页不重不漏）", async () => {
    const 标记 = "u-序"
    for (let i = 0; i < 3; i++) {
      await recordAuditEvent(pg.db, 一条({ actorId: 标记, actorPoliceNo: "980001", occurredAt: 3_000 }))
    }
    await recordAuditEvent(pg.db, 一条({ actorId: 标记, actorPoliceNo: "980001", occurredAt: 2_999 }))
    const page = await listAuditEvents(pg.db, { actor: "980001" })
    const 时间 = page.items.map((row) => row.occurred_at)
    expect(时间).toEqual([3_000, 3_000, 3_000, 2_999])
    const ids = page.items.map((row) => row.id)
    expect(ids[0]).toBeGreaterThan(ids[1]!)
    expect(ids[1]).toBeGreaterThan(ids[2]!)
  })

  test("分页：total 是筛选后总数（不受 limit 影响），默认 50、上限 200、非法值回落缺省", async () => {
    const 标记 = "u-页"
    for (let i = 0; i < 5; i++) {
      await recordAuditEvent(pg.db, 一条({ actorId: 标记, actorPoliceNo: "990001", occurredAt: 4_000 + i }))
    }
    const 第一页 = await listAuditEvents(pg.db, { actor: "990001", pageSize: 2 })
    expect(第一页).toMatchObject({ total: 5, page: 1, pageSize: 2 })
    expect(第一页.items).toHaveLength(2)

    const 第二页 = await listAuditEvents(pg.db, { actor: "990001", pageSize: 2, page: 2 })
    expect(第二页.items).toHaveLength(2)
    // 两页不重叠
    const 交集 = 第一页.items.filter((row) => 第二页.items.some((other) => other.id === row.id))
    expect(交集).toHaveLength(0)

    const 缺省 = await listAuditEvents(pg.db, { actor: "990001" })
    expect(缺省.pageSize).toBe(50)
    const 超上限 = await listAuditEvents(pg.db, { actor: "990001", pageSize: 5000 })
    expect(超上限.pageSize).toBe(200)
    const 非法 = await listAuditEvents(pg.db, { actor: "990001", page: 0, pageSize: -1 })
    expect(非法).toMatchObject({ page: 1, pageSize: 50 })
  })

  test("空结果 ⇒ total 0、items 空数组（不是 undefined）", async () => {
    const page = await listAuditEvents(pg.db, { actor: "没有这个人" })
    expect(page).toEqual({ total: 0, page: 1, pageSize: 50, items: [] })
  })
})
