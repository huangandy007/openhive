import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 实体清单, 实体档案, 清单上限, 引用上限, 类型计数 } from "../../src/server/openhive/case-entity-list"
import { 建事件, 建关系, 建实体, 建引用, 建引用批 } from "./openhive-case-fact-fixture"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-实体"
const 别人的项目 = "p-别人"
const 截断项目 = "p-截断"
const 细类项目 = "p-实体细类"
const 引用项目 = "p-实体出处"

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

  // 截断：201 条关系（> 关系上限 200）指向 **201 个不同账户**（对方各不相同，页内的去重与全量去重会给出不同答案）
  // ＋ 101 条事件（> 事件上限 100），用来钉「显示上限 ≠ 全量」。
  // 事件按参与者规范值挂到实体上，所以 e-多 的规范值必须与 participants 一致。
  await 建实体(库(), { id: "e-多", projectId: 截断项目, value: "多人", type: "人" })
  for (let i = 0; i < 201; i++) {
    const 号 = String(i).padStart(3, "0")
    await 建实体(库(), { id: `e-多账${号}`, projectId: 截断项目, value: `6222****${号}`, type: "账户" })
    await 建关系(库(), {
      id: `r-多${号}`,
      projectId: 截断项目,
      fromId: "e-多",
      toId: `e-多账${号}`,
      type: "转账",
      amount: 1,
      sourceKind: "data",
    })
  }
  // 去重口径还得有人钉：e-重 对同一个账户两条转账 ⇒ 仍应是「1 个实体 / 1 个账户」。
  await 建实体(库(), { id: "e-重", projectId: 截断项目, value: "重复", type: "人" })
  await 建关系(库(), { id: "r-重0", projectId: 截断项目, fromId: "e-重", toId: "e-多账000", type: "转账", amount: 2, sourceKind: "data" })
  await 建关系(库(), { id: "r-重1", projectId: 截断项目, fromId: "e-重", toId: "e-多账000", type: "转账", amount: 3, sourceKind: "data" })
  // 边界：恰好 200 条关系 = 正好装下，缺口必须是 undefined（缺口判断写成 `>=` 会在这里红）。
  await 建实体(库(), { id: "e-满", projectId: 截断项目, value: "满员", type: "人" })
  for (let i = 0; i < 200; i++) {
    await 建关系(库(), {
      id: `r-满${String(i).padStart(3, "0")}`,
      projectId: 截断项目,
      fromId: "e-满",
      toId: "e-多账000",
      type: "转账",
      amount: 4,
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

  // 细类：形状（Luhn 通过的 16 位 → 银行卡）与 attrs（原文写「固定电话」）各一条；
  // 形状判得出的（11 位手机号）压过 attrs；人判不出细类，必须是 undefined 而不是硬造一个。
  await 建实体(库(), { id: "e-细号", projectId: 细类项目, value: "4001234567", type: "号码", attrs: { subtype: "固定电话" } })
  await 建实体(库(), { id: "e-细盖", projectId: 细类项目, value: "13800000001", type: "号码", attrs: { subtype: "固定电话" } })
  await 建实体(库(), { id: "e-细卡", projectId: 细类项目, value: "4111111111111111", type: "账户" })
  await 建实体(库(), { id: "e-细人", projectId: 细类项目, value: "钱七", type: "人" })

  // 出处是四块里唯一没有上限的（`引用们` 无 LIMIT）⇒ 大案里一个号码能在几百份材料里出现。
  // 这里钉「有上限」与「上限说清全量」：501 条截断、恰好 500 不截断。
  await 建实体(库(), { id: "e-多引", projectId: 引用项目, value: "号码全", type: "号码" })
  await 建引用批(库(), {
    projectId: 引用项目,
    factType: "entity",
    factId: "e-多引",
    materialId: "m-全集",
    数量: 引用上限 + 1,
    前缀: "c-多引",
  })
  await 建实体(库(), { id: "e-满引", projectId: 引用项目, value: "号码满", type: "号码" })
  await 建引用批(库(), {
    projectId: 引用项目,
    factType: "entity",
    factId: "e-满引",
    materialId: "m-全集",
    数量: 引用上限,
    前缀: "c-满引",
  })
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

  test("清单与档案带细类：形状优先、attrs 补空；判不出就是 undefined", async () => {
    const { 行们 } = await 实体清单(库(), { projectId: 细类项目 })
    const 细类 = Object.fromEntries(行们.map((行) => [行.id, 行.subtype]))
    expect(细类).toEqual({
      // 400 号码形状判不出 ⇒ 用 attrs 里原文写的细类
      "e-细号": "固定电话",
      // 11 位手机号形状判得出 ⇒ attrs 写的「固定电话」压不过形状
      "e-细盖": "手机号",
      "e-细卡": "银行卡",
      "e-细人": undefined,
    })

    const 档 = (await 实体档案(库(), { projectId: 细类项目, id: "e-细卡" }))!
    expect(档.subtype).toBe("银行卡")
    const 人档 = (await 实体档案(库(), { projectId: 细类项目, id: "e-细人" }))!
    expect(人档.subtype).toBeUndefined()
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

  test("清单缺口：恰好满页不算截断", async () => {
    // 号码恰 2 条：limit 2 是「正好装下」，不是「还有更多」。
    expect((await 实体清单(库(), { projectId: 项目, type: "号码", limit: 2 })).缺口).toEqual([])
    expect((await 实体清单(库(), { projectId: 项目, type: "号码", limit: 1 })).缺口.join()).toContain("前 1 条")
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
    // 契约：没有截断就给 undefined，不给空数组。
    expect(档.缺口).toBeUndefined()
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
    // e-多 有 201 条关系、对方是 201 个不同账户，而列表页只带 200 行：
    // 一句话的实体数/条数必须走全量聚合，不能按页算（按页会说 200）。
    const 多 = (await 实体档案(库(), { projectId: 截断项目, id: "e-多" }))!
    expect(多.一句话).toContain("与本项目 201 个实体有 201 条有效关系")
    expect(多.一句话).toContain("涉及 201 个账户")
    // 同一个账户两条转账仍是 1 个实体、1 个账户（去重口径）。
    const 重 = (await 实体档案(库(), { projectId: 截断项目, id: "e-重" }))!
    expect(重.一句话).toContain("与本项目 1 个实体有 2 条有效关系")
    expect(重.一句话).toContain("涉及 1 个账户")
  })

  test("档案：已排除实体与已排除事件默认不出现，includeExcluded 才给", async () => {
    expect(await 实体档案(库(), { projectId: 项目, id: "e-排" })).toBeUndefined()
    expect(await 实体档案(库(), { projectId: 项目, id: "e-排", includeExcluded: true })).toBeDefined()
    const 默认 = (await 实体档案(库(), { projectId: 项目, id: "e-张" }))!
    expect(默认.事件).toHaveLength(2)
    const 带排 = (await 实体档案(库(), { projectId: 项目, id: "e-张", includeExcluded: true }))!
    expect(带排.事件).toHaveLength(3)
  })

  test("档案恰好满页不算截断（缺口 undefined）", async () => {
    const 档 = (await 实体档案(库(), { projectId: 截断项目, id: "e-满" }))!
    expect(档.关系).toHaveLength(200)
    expect(档.缺口).toBeUndefined()
  })

  test("档案截断：关系与事件只显示上限条数，缺口说清全量", async () => {
    const 档 = (await 实体档案(库(), { projectId: 截断项目, id: "e-多" }))!
    expect(档.关系).toHaveLength(200)
    expect(档.事件).toHaveLength(100)
    const 缺口 = 档.缺口 ?? []
    expect(缺口).toHaveLength(2)
    expect(缺口.some((条) => 条.includes("200") && 条.includes("关系图"))).toBe(true)
    expect(缺口.some((条) => 条.includes("100") && 条.includes("时间线"))).toBe(true)
    // 2026-11-07：这两句原来写「请到关系图 / 时间线看全部」，但关系图上限 50 节点、
    // 时间线默认 50 条，都比档案的 200 / 100 还少——空头支票。改成说清「怎么缩小范围」。
    expect(缺口.every((条) => !条.includes("看全部"))).toBe(true)
    expect(档.一句话).toContain("201 条有效关系")
    // 事件数用全量（101），不是当前页的 100。
    expect(档.一句话).toContain("101 个事件")
  })

  test("档案出处：超过上限只给上限条，总数说全量", async () => {
    const 档 = (await 实体档案(库(), { projectId: 引用项目, id: "e-多引" }))!
    expect(档.引用).toHaveLength(引用上限)
    expect(档.引用总数).toBe(引用上限 + 1)
    const 缺口 = 档.缺口 ?? []
    expect(缺口).toHaveLength(1)
    expect(缺口[0]).toContain("出处")
    expect(缺口[0]).toContain(`共 ${引用上限 + 1} 条`)
  })

  // 2026-11-07：四个数字原先用「本页条数」（关系 200 / 事件 100）和「本页去重」（对手方），
  // 而顶部「一句话」走全量（`涉及` 是 count distinct、条数是窗口计数）⇒ 同一页两个数字打架，
  // 201 个对手方会显示成 200。数字一律走全量，页内截断由缺口说明。
  test("档案：关系总数 / 事件总数 / 对方数都是全量，不跟当前页走", async () => {
    const 档 = (await 实体档案(库(), { projectId: 截断项目, id: "e-多" }))!
    expect(档.关系).toHaveLength(200)
    expect(档.关系总数).toBe(201)
    expect(档.事件).toHaveLength(100)
    expect(档.事件总数).toBe(101)
    expect(档.对方数).toBe(201)
    // 全量与「一句话」必须是同一批数（两处各算一次就会漂）。
    expect(档.一句话).toContain("201 个实体有 201 条有效关系")
    expect(档.一句话).toContain("101 个事件")
  })

  test("档案：对手方按对方实体去重（同一账户两条转账仍是 1 个）", async () => {
    const 重 = (await 实体档案(库(), { projectId: 截断项目, id: "e-重" }))!
    expect(重.关系总数).toBe(2)
    expect(重.对方数).toBe(1)
    const 满 = (await 实体档案(库(), { projectId: 截断项目, id: "e-满" }))!
    expect(满.关系总数).toBe(200)
    expect(满.对方数).toBe(1)
  })

  test("档案出处恰好满上限不算截断（缺口 undefined）", async () => {
    const 档 = (await 实体档案(库(), { projectId: 引用项目, id: "e-满引" }))!
    expect(档.引用).toHaveLength(引用上限)
    expect(档.引用总数).toBe(引用上限)
    expect(档.缺口).toBeUndefined()
  })
})
