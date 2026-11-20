import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 分组计数, 实体清单, 实体面板, 实体档案 } from "../../src/server/openhive/case-entity-list"
import { 建实体, 建事件, 建关系 } from "./openhive-case-fact-fixture"

/**
 * 实体面板：分组计数与清单**一次**逐实体扫描（`#013-11` 的慢查询优化）。
 *
 * 现状是 `handleEntities` 同时调 `分组计数` ＋ `实体清单`，两份 SQL 各扫全部实体、
 * 各跑一遍逐实体相关子查询 ⇒ 同一份派生表算两遍。合并后必须满足两条：
 * ① 结果逐字段等于旧口径（分组与清单各自对照旧函数，钉住不能改语义）；
 * ② 一次调用只发**一条** SQL（用计数 `Queryable` 钉住，防回归成两次扫描）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
const 项目 = "p-实体面板"

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  await 建实体(db(), { id: "e-A", projectId: 项目, type: "账户", value: "账户A" })
  await 建实体(db(), { id: "e-B", projectId: 项目, type: "账户", value: "账户B" })
  await 建实体(db(), { id: "e-C", projectId: 项目, type: "人", value: "张三", aliases: ["三哥"] })
  await 建实体(db(), { id: "e-D", projectId: 项目, type: "人", value: "李四", trustState: "已确认" })
  // 无关系、无事件、未被确认 ⇒ 提及（让 `提及` 列不是恒 0，分组语义才被真值钉住）。
  await 建实体(db(), { id: "e-E", projectId: 项目, type: "人", value: "王五" })
  // 同名跨类型：文本回退必须 fail-closed，不能把事件同时算给两个实体。
  await 建实体(db(), { id: "e-F", projectId: 项目, type: "人", value: "张伟" })
  await 建实体(db(), { id: "e-G", projectId: 项目, type: "组织", value: "张伟" })
  await 建实体(db(), { id: "e-X", projectId: 项目, type: "人", value: "已排除者", trustState: "已排除" })
  // A 关联 2 条（A→B、B→A 各一条）；B 关联 2 条；C 关联 1 条；D 只有人确认 ⇒ 核心。
  await 建关系(db(), { id: "r-1", projectId: 项目, fromId: "e-A", toId: "e-B" })
  await 建关系(db(), { id: "r-2", projectId: 项目, fromId: "e-B", toId: "e-A" })
  await 建关系(db(), { id: "r-3", projectId: 项目, fromId: "e-C", toId: "e-B" })
  // 已排除的关系与事件都不计。
  await 建关系(db(), { id: "r-排除", projectId: 项目, fromId: "e-A", toId: "e-C", trustState: "已排除" })
  await 建事件(db(), { id: "ev-1", projectId: 项目, participants: ["账户A", "张三"], occurredAt: 1000 })
  await 建事件(db(), { id: "ev-2", projectId: 项目, participants: ["张三"], occurredAt: 2000 })
  // 别名文本回退：participants 存旧值，靠别名仍归到 e-C。
  await 建事件(db(), { id: "ev-别名", projectId: 项目, participants: ["三哥"], occurredAt: 2500 })
  // 同名跨类型：按值不可判，两边都不计。
  await 建事件(db(), { id: "ev-歧义", projectId: 项目, participants: ["张伟"], occurredAt: 2600 })
  await 建事件(db(), { id: "ev-排除", projectId: 项目, participants: ["账户A"], occurredAt: 3000, trustState: "已排除" })
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db(): Queryable {
  if (!库) throw new Error("真库没起来")
  return 库
}

/** 只转发、计数的 `Queryable`：用来钉「一次调用几条 SQL」。 */
function 计数库(源: Queryable): { readonly 库: Queryable; readonly 次数: () => number } {
  let 次 = 0
  return {
    库: {
      execute(query) {
        次 += 1
        return 源.execute(query)
      },
    },
    次数: () => 次,
  }
}

describe("实体面板：一次扫描，两种结果", () => {
  test("不分页：分组与清单逐字段等于旧口径", async () => {
    const 面板 = await 实体面板(db(), { projectId: 项目 })
    expect(面板.分组).toEqual(await 分组计数(db(), 项目))
    expect(面板.清单).toEqual(await 实体清单(db(), { projectId: 项目 }))
    // 实数钉住：A/B/C/D 核心，E/F/G 提及，X 已排除不出现 ⇒ 核心 4 / 提及 3。
    expect(面板.分组).toEqual({ 核心: 4, 提及: 3 })
    expect(面板.清单.行们.map((行) => 行.canonical_value).sort()).toEqual([
      "张三",
      "张伟",
      "张伟",
      "李四",
      "王五",
      "账户A",
      "账户B",
    ])
    // 别名回退计入，歧义值两边都不计。
    const 按id = new Map(面板.清单.行们.map((行) => [行.id, 行]))
    expect(按id.get("e-C")!.事件参与数).toBe(3)
    expect([按id.get("e-F")!.事件参与数, 按id.get("e-G")!.事件参与数]).toEqual([0, 0])
  })

  test("分组 / 搜索 / 排序 / limit 只作用于清单，分组计数仍是全量", async () => {
    const 面板 = await 实体面板(db(), { projectId: 项目, 分组: "核心", q: "账户", sort: "名称", limit: 1 })
    expect(面板.清单).toEqual(
      await 实体清单(db(), { projectId: 项目, 分组: "核心", q: "账户", sort: "名称", limit: 1 }),
    )
    expect(面板.分组).toEqual(await 分组计数(db(), 项目))
    expect(面板.清单.行们.map((行) => 行.canonical_value)).toEqual(["账户A"])
    expect(面板.清单.总数).toBe(2)
  })

  test("一次调用只发一条 SQL（防回归成两次扫描）", async () => {
    const 计 = 计数库(db())
    const 面板 = await 实体面板(计.库, { projectId: 项目, limit: 5 })
    expect(计.次数()).toBe(1)
    expect(面板.清单.总数).toBe(7)
  })

  test("逐实体与档案同口径：清单 关联数/事件参与数 = 档案 关系总数/事件总数", async () => {
    const 面板 = await 实体面板(db(), { projectId: 项目, limit: 50 })
    for (const 行 of 面板.清单.行们) {
      const 档案 = await 实体档案(db(), { projectId: 项目, id: 行.id })
      expect([行.id, 行.关联数, 行.事件参与数]).toEqual([行.id, 档案!.关系总数, 档案!.事件总数])
    }
  })
})
