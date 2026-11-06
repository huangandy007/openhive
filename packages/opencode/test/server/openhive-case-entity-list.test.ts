import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 实体清单, 实体档案, 清单上限, 类型计数 } from "../../src/server/openhive/case-entity-list"
import { 建事件, 建关系, 建实体, 建引用 } from "./openhive-case-fact-fixture"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-实体"
const 别人的项目 = "p-别人"
const 截断项目 = "p-截断"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await 建实体(库(), { id: "e-张", projectId: 项目, value: "张三", type: "人" })
  await 建实体(库(), { id: "e-李", projectId: 项目, value: "李四", type: "人", aliases: ["四哥"] })
  await 建实体(库(), { id: "e-号1", projectId: 项目, value: "13800000001", type: "号码" })
  await 建实体(库(), { id: "e-号2", projectId: 项目, value: "13800000002", type: "号码" })
  await 建实体(库(), { id: "e-账", projectId: 项目, value: "6222****0001", type: "账户" })
  await 建实体(库(), { id: "e-排", projectId: 项目, value: "王五", type: "人", trustState: "已排除" })
  // ilike 转义的干扰项：`100%` 与 `1000`。未转义时 q="100%"（模式 %100%%）会连 1000 一起带出。
  await 建实体(库(), { id: "e-百分", projectId: 项目, type: "物品", value: "100%" })
  await 建实体(库(), { id: "e-千", projectId: 项目, type: "物品", value: "1000" })
  await 建实体(库(), { id: "e-别人", projectId: 别人的项目, value: "赵六", type: "人" })

  // e-张 2 条有效关系（r-张李、r-张账）；r-张排 的对方 e-排 已排除 ⇒ 不计（§9.1 不进统计）；
  // e-李：1 条被排除的关系 → e-账。
  await 建关系(库(), { id: "r-张李", projectId: 项目, fromId: "e-张", toId: "e-李", type: "通话", sourceKind: "data" })
  await 建关系(库(), { id: "r-张账", projectId: 项目, fromId: "e-张", toId: "e-账", type: "转账", amount: 100, sourceKind: "data" })
  await 建关系(库(), { id: "r-李账", projectId: 项目, fromId: "e-李", toId: "e-账", type: "转账", trustState: "已排除", sourceKind: "data" })
  // 对端已排除：关系本身有效、对方实体不可见 ⇒ 默认档案里不出现（变异 C 的靶子）。
  await 建关系(库(), { id: "r-张排", projectId: 项目, fromId: "e-张", toId: "e-排", type: "通话", sourceKind: "data" })

  await 建事件(库(), { id: "ev-见面", projectId: 项目, participants: ["张三", "李四"], occurredAt: 1760000100 })
  await 建事件(库(), { id: "ev-转账", projectId: 项目, participants: ["张三"], occurredAt: 1760000200 })
  await 建事件(库(), { id: "ev-排除", projectId: 项目, participants: ["张三"], trustState: "已排除" })

  await 建引用(库(), { id: "c-张", projectId: 项目, factType: "entity", factId: "e-张", materialId: "m-1" })

  // 截断：201 条关系（> 关系上限 200）＋ 101 条事件（> 事件上限 100），用来钉「显示上限 ≠ 全量」。
  // 事件按参与者规范值挂到实体上，所以 e-多 的规范值必须与 participants 一致。
  await 建实体(库(), { id: "e-多", projectId: 截断项目, value: "多人", type: "人" })
  await 建实体(库(), { id: "e-多账", projectId: 截断项目, value: "6222****9999", type: "账户" })
  for (let i = 0; i < 201; i++) {
    await 建关系(库(), {
      id: `r-多${String(i).padStart(3, "0")}`,
      projectId: 截断项目,
      fromId: "e-多",
      toId: "e-多账",
      type: "转账",
      amount: 1,
      sourceKind: "data",
    })
  }
  for (let i = 0; i < 101; i++) {
    await 建事件(库(), {
      id: `ev-多${String(i).padStart(2, "0")}`,
      projectId: 截断项目,
      participants: ["多人"],
      occurredAt: 1760100000 + i,
    })
  }
})

afterAll(async () => {
  await pg?.stop()
})

describe("实体清单与档案", () => {
  test("类型计数：排除已排除、排除别的项目、按数量降序", async () => {
    expect(await 类型计数(库(), 项目)).toEqual([
      { type: "人", count: 2 },
      { type: "号码", count: 2 },
      { type: "物品", count: 2 },
      { type: "账户", count: 1 },
    ])
  })

  test("清单默认按涉案（有效关系数）降序；已排除关系不计", async () => {
    const { 行们 } = await 实体清单(库(), { projectId: 项目, sort: "涉案" })
    expect(行们.map((行) => [行.id, 行.关联数])).toEqual([
      ["e-张", 2],
      ["e-账", 1],
      ["e-李", 1],
      ["e-百分", 0],
      ["e-千", 0],
      ["e-号1", 0],
      ["e-号2", 0],
    ])
  })

  test("搜索跨类型命中别名；给了类型就只查该类型", async () => {
    const 跨类 = await 实体清单(库(), { projectId: 项目, q: "四哥" })
    expect(跨类.行们.map((行) => 行.id)).toEqual(["e-李"])
    const 限类型 = await 实体清单(库(), { projectId: 项目, type: "人", q: "四哥" })
    expect(限类型.行们.map((行) => 行.id)).toEqual(["e-李"])
    expect((await 实体清单(库(), { projectId: 项目, type: "号码", q: "四哥" })).行们).toEqual([])
  })

  test("清单不返回已排除实体；includeExcluded 只在档案里管", async () => {
    const { 行们 } = await 实体清单(库(), { projectId: 项目, q: "王五" })
    expect(行们).toEqual([])
  })

  test("清单搜索把 % 与 _ 当字面量（ilike 转义）", async () => {
    // 未转义时模式是 %100%% ⇒ e-千（1000）也被带进来。
    expect((await 实体清单(库(), { projectId: 项目, q: "100%" })).行们.map((行) => 行.id)).toEqual(["e-百分"])
    // 未转义时 _ 是单字符通配 ⇒ 1000 / 100% 都会命中。
    expect((await 实体清单(库(), { projectId: 项目, q: "100_" })).行们).toEqual([])
  })

  test("清单截断时缺口说清上限", async () => {
    const { 缺口 } = await 实体清单(库(), { projectId: 项目, limit: 2 })
    expect(缺口.join()).toContain("前 2 条")
    expect(清单上限).toBe(200)
  })

  test("档案：关系带方向/对方/依据；已排除关系默认不出现；事件按时间倒序；一句话是整句", async () => {
    const 档 = (await 实体档案(库(), { projectId: 项目, id: "e-张" }))!
    expect(档.关系.map((行) => [行.id, 行.方向, 行.对方值])).toEqual([
      ["r-张李", "出", "李四"],
      ["r-张账", "出", "6222****0001"],
    ])
    expect(档.事件.map((条) => 条.id)).toEqual(["ev-转账", "ev-见面"])
    expect(档.引用.map((条) => 条.id)).toEqual(["c-张"])
    expect(档.一句话).toContain("张三")
    expect(档.一句话).toContain("账户")
    expect(档.一句话).toContain("关联 2 个事件")
  })

  test("档案 includeExcluded=true 才带出已排除关系和已排除实体", async () => {
    const 默认 = (await 实体档案(库(), { projectId: 项目, id: "e-李" }))!
    expect(默认.关系.map((行) => 行.id)).toEqual(["r-张李"])
    const 带排 = (await 实体档案(库(), { projectId: 项目, id: "e-李", includeExcluded: true }))!
    expect(带排.关系.map((行) => 行.id)).toEqual(["r-张李", "r-李账"])
  })

  test("别的项目的实体取不到", async () => {
    expect(await 实体档案(库(), { projectId: 项目, id: "e-别人" })).toBeUndefined()
  })

  test("档案关系入方向：对方取 from_id", async () => {
    const 档 = (await 实体档案(库(), { projectId: 项目, id: "e-李" }))!
    expect(档.关系.map((行) => [行.id, 行.方向, 行.对方值])).toEqual([["r-张李", "入", "张三"]])
  })

  test("档案一句话：按对方实体去重，关系条数用全量", async () => {
    const 档 = (await 实体档案(库(), { projectId: 项目, id: "e-张" }))!
    expect(档.一句话).toContain("与本项目 2 个实体有 2 条有效关系")
    expect(档.一句话).toContain("1 个账户")
    expect(档.一句话).toContain("1 个人")
    // e-多 对同一个账户有 201 条关系：去重后是「1 个账户」。
    // 用整段「涉及 1 个账户」而不是裸「1 个账户」——「201 个账户」含子串「1 个账户」（#006-22）。
    const 多 = (await 实体档案(库(), { projectId: 截断项目, id: "e-多" }))!
    expect(多.一句话).toContain("涉及 1 个账户")
  })

  test("档案：已排除实体与已排除事件默认不出现，includeExcluded 才给", async () => {
    expect(await 实体档案(库(), { projectId: 项目, id: "e-排" })).toBeUndefined()
    expect(await 实体档案(库(), { projectId: 项目, id: "e-排", includeExcluded: true })).toBeDefined()
    const 默认 = (await 实体档案(库(), { projectId: 项目, id: "e-张" }))!
    expect(默认.事件).toHaveLength(2)
    const 带排 = (await 实体档案(库(), { projectId: 项目, id: "e-张", includeExcluded: true }))!
    expect(带排.事件).toHaveLength(3)
  })

  test("档案截断：关系与事件只显示上限条数，缺口说清全量", async () => {
    const 档 = (await 实体档案(库(), { projectId: 截断项目, id: "e-多" }))!
    expect(档.关系).toHaveLength(200)
    expect(档.事件).toHaveLength(100)
    const 缺口 = 档.缺口 ?? []
    expect(缺口).toHaveLength(2)
    expect(缺口.some((条) => 条.includes("200") && 条.includes("关系"))).toBe(true)
    expect(缺口.some((条) => 条.includes("100") && 条.includes("事件"))).toBe(true)
    expect(档.一句话).toContain("201 条有效关系")
    // 事件数用全量（101），不是当前页的 100。
    expect(档.一句话).toContain("101 个事件")
  })
})
