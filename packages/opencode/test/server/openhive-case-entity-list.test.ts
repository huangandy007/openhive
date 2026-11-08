import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 实体清单, 实体档案, 分组计数, 清单上限, 引用上限 } from "../../src/server/openhive/case-entity-list"
import { 建事件, 建关系, 建关系批, 建实体, 建引用, 建引用批 } from "./openhive-case-fact-fixture"

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
const 分段项目 = "p-实体分段"
const 分组项目 = "p-实体分组"
const 待确认项目 = "p-实体待确认"

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
  // 关系行要能说清「对方是什么」：细类优先、判不出用大类（2026-11-08 用户提出）。
  // 三条覆盖三种情形：形状判得出 / attrs 补空 / 人没有细类。
  await 建关系(库(), { id: "r-细人卡", projectId: 细类项目, fromId: "e-细人", toId: "e-细卡", type: "转账", sourceKind: "data" })
  await 建关系(库(), { id: "r-细人号", projectId: 细类项目, fromId: "e-细人", toId: "e-细号", type: "通话", sourceKind: "data" })
  await 建关系(库(), { id: "r-细卡人", projectId: 细类项目, fromId: "e-细卡", toId: "e-细人", type: "转账", sourceKind: "data" })

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

  // 关系分两段（数据说的 / 人说的）各带上限：笔录关系没有 first_at/last_at，
  // 排序键 `coalesce(last_at, first_at, 0)` 把它们全部排到最后 ⇒ 合并成一个 200 条的上限时，
  // 只要数据关系够 200 条，人说的就一条都不剩。这里钉「两段各留各的」。
  await 建实体(库(), { id: "e-段", projectId: 分段项目, value: "分段人", type: "人" })
  await 建实体(库(), { id: "e-段账", projectId: 分段项目, value: "6222****9999", type: "账户" })
  await 建关系批(库(), {
    projectId: 分段项目,
    fromId: "e-段",
    toId: "e-段账",
    sourceKind: "data",
    数量: 200,
    前缀: "r-段数",
    首: 1_760_100_000,
  })
  await 建关系批(库(), {
    projectId: 分段项目,
    fromId: "e-段",
    toId: "e-段账",
    sourceKind: "human",
    数量: 3,
    前缀: "r-段人",
  })
  // 两段都超限：数据 201 > 200、人 101 > 100，缺口的每一句都要报自己那一段的全量。
  await 建实体(库(), { id: "e-溢", projectId: 分段项目, value: "溢出人", type: "人" })
  await 建关系批(库(), {
    projectId: 分段项目,
    fromId: "e-溢",
    toId: "e-段账",
    sourceKind: "data",
    数量: 201,
    前缀: "r-溢数",
    首: 1_760_200_000,
  })
  await 建关系批(库(), {
    projectId: 分段项目,
    fromId: "e-溢",
    toId: "e-段账",
    sourceKind: "human",
    数量: 101,
    前缀: "r-溢人",
  })

  // 分组：关系 / 事件 / 人确认三个核心条件各自单独成立，外加一个都不满足的「提及」。
  // 已排除的关系与事件不能参与分组——否则 e-都没有 会被算成核心。
  await 建实体(库(), { id: "e-只关系", projectId: 分组项目, value: "A关系", type: "人", createdAt: 100 })
  await 建实体(库(), { id: "e-关系对方", projectId: 分组项目, value: "B对方", type: "账户", createdAt: 200 })
  await 建关系(库(), { id: "r-只关系", projectId: 分组项目, fromId: "e-只关系", toId: "e-关系对方", type: "转账" })
  await 建实体(库(), { id: "e-只事件", projectId: 分组项目, value: "C事件", type: "人", createdAt: 300 })
  await 建事件(库(), { id: "ev-只事件", projectId: 分组项目, participants: ["C事件"] })
  await 建实体(库(), { id: "e-只确认", projectId: 分组项目, value: "D确认", type: "人", trustState: "已确认", createdAt: 400 })
  await 建实体(库(), { id: "e-都没有", projectId: 分组项目, value: "E空", type: "人", createdAt: 500 })
  await 建实体(库(), { id: "e-分组排", projectId: 分组项目, value: "F排除", type: "人", trustState: "已排除" })
  await 建关系(库(), {
    id: "r-分组排",
    projectId: 分组项目,
    fromId: "e-都没有",
    toId: "e-分组排",
    type: "通话",
    trustState: "已排除",
  })
  await 建事件(库(), {
    id: "ev-分组排",
    projectId: 分组项目,
    participants: ["E空"],
    trustState: "已排除",
  })

  // 待确认：实体自身 1 + 关系 1（自动抽取）+ 事件 1（自动抽取）；已确认 / 已排除都不计。
  await 建实体(库(), { id: "e-待", projectId: 待确认项目, value: "待测", type: "人", trustState: "存疑" })
  await 建实体(库(), { id: "e-对", projectId: 待确认项目, value: "对照", type: "人" })
  await 建实体(库(), { id: "e-排2", projectId: 待确认项目, value: "已排", type: "人", trustState: "已排除" })
  await 建关系(库(), { id: "r-待1", projectId: 待确认项目, fromId: "e-待", toId: "e-对", type: "转账" })
  await 建关系(库(), {
    id: "r-待2",
    projectId: 待确认项目,
    fromId: "e-待",
    toId: "e-对",
    type: "转账",
    trustState: "已确认",
  })
  await 建关系(库(), {
    id: "r-待3",
    projectId: 待确认项目,
    fromId: "e-待",
    toId: "e-对",
    type: "转账",
    trustState: "已排除",
  })
  await 建关系(库(), {
    id: "r-待4",
    projectId: 待确认项目,
    fromId: "e-待",
    toId: "e-排2",
    type: "转账",
  })
  await 建事件(库(), { id: "ev-待1", projectId: 待确认项目, participants: ["待测"] })
  await 建事件(库(), { id: "ev-待2", projectId: 待确认项目, participants: ["待测"], trustState: "已确认" })
  await 建事件(库(), { id: "ev-待3", projectId: 待确认项目, participants: ["待测"], trustState: "已排除" })
  await 建实体(库(), { id: "e-准", projectId: 待确认项目, value: "已准", type: "人", trustState: "已确认" })
})

afterAll(async () => {
  await pg?.stop()
})

describe("实体清单与档案", () => {
  test("分组计数：三个核心条件各自成立；已排除实体不入统计；其余是提及", async () => {
    expect(await 分组计数(库(), 分组项目)).toEqual({ 核心: 4, 提及: 1 })
    // 别的项目不串；已排除实体不计。
    expect(await 分组计数(库(), 项目)).toEqual({ 核心: 3, 提及: 4 })
  })

  test("清单默认按权重（关系数 + 事件参与数）降序；同权重按已确认优先、再按名称", async () => {
    const { 行们, 总数 } = await 实体清单(库(), { projectId: 分组项目, sort: "涉案" })
    expect(行们.map((行) => [行.id, 行.关联数, 行.事件参与数, 行.权重, 行.分组])).toEqual([
      ["e-只关系", 1, 0, 1, "核心"],
      ["e-关系对方", 1, 0, 1, "核心"],
      ["e-只事件", 0, 1, 1, "核心"],
      ["e-只确认", 0, 0, 0, "核心"],
      ["e-都没有", 0, 0, 0, "提及"],
    ])
    expect(总数).toBe(5)
  })

  test("清单 sort=名称 / 时间", async () => {
    expect((await 实体清单(库(), { projectId: 分组项目, sort: "名称" })).行们.map((行) => 行.id)).toEqual([
      "e-只关系",
      "e-关系对方",
      "e-只事件",
      "e-只确认",
      "e-都没有",
    ])
    expect((await 实体清单(库(), { projectId: 分组项目, sort: "时间" })).行们.map((行) => 行.id)).toEqual([
      "e-都没有",
      "e-只确认",
      "e-只事件",
      "e-关系对方",
      "e-只关系",
    ])
  })

  test("分组过滤：核心 / 提及；省略分组 = 跨组", async () => {
    const 核心 = await 实体清单(库(), { projectId: 分组项目, 分组: "核心" })
    expect(核心.行们.map((行) => 行.id)).toEqual(["e-只关系", "e-关系对方", "e-只事件", "e-只确认"])
    expect(核心.总数).toBe(4)

    const 提及 = await 实体清单(库(), { projectId: 分组项目, 分组: "提及" })
    expect(提及.行们.map((行) => [行.id, 行.分组])).toEqual([["e-都没有", "提及"]])
    expect(提及.总数).toBe(1)
  })

  test("清单带事件参与数：事件被排除就不算", async () => {
    const { 行们 } = await 实体清单(库(), { projectId: 项目 })
    const 数 = Object.fromEntries(行们.map((行) => [行.id, [行.关联数, 行.事件参与数, 行.权重]]))
    expect(数["e-张"]).toEqual([2, 2, 4])
    expect(数["e-李"]).toEqual([1, 1, 2])
    expect(数["e-账"]).toEqual([1, 0, 1])
    expect(数["e-号1"]).toEqual([0, 0, 0])
    // ev-排除 是已排除事件，不进 e-张 的事件参与数（否则这里会是 3）。
    expect(数["e-张"]![1]).toBe(2)
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

  // 关系行要能说清「对方是什么」（2026-11-08 用户提出：在「对方」与「关系」之间加一列）。
  // 判据与实体自己的细类**同一把**（`细类()`）：形状优先、attrs 补空、都没有就是 null
  // ——界面据 null 退回大类，再没有才写「——」。
  test("档案关系的每条都带对方细类：形状 / attrs / 判不出（null）三种情形", async () => {
    const 人档 = (await 实体档案(库(), { projectId: 细类项目, id: "e-细人" }))!
    const 对方细类 = Object.fromEntries(人档.关系.map((行) => [行.id, 行.对方细类]))
    expect(对方细类).toEqual({
      // 4111… 形状判得出（Luhn 通过的 16 位）⇒ 银行卡
      "r-细人卡": "银行卡",
      // 400 号码形状判不出 ⇒ 用 attrs 里原文写的「固定电话」
      "r-细人号": "固定电话",
      // 反向那条（e-细卡 → e-细人）在 e-细人的档案里也出现，对方仍按形状判成银行卡。
      "r-细卡人": "银行卡",
    })
    const 卡档 = (await 实体档案(库(), { projectId: 细类项目, id: "e-细卡" }))!
    // 人是没有细类的大类：必须是 null（界面才知道退回大类），不是空串硬造。
    expect(卡档.关系.find((行) => 行.id === "r-细卡人")!.对方细类).toBeNull()
  })

  test("搜索跨组命中别名；结果带自己的分组", async () => {
    const 跨组 = await 实体清单(库(), { projectId: 项目, q: "四哥" })
    expect(跨组.行们.map((行) => [行.id, 行.分组])).toEqual([["e-李", "核心"]])
    const 提及 = await 实体清单(库(), { projectId: 分组项目, q: "E空" })
    expect(提及.行们.map((行) => [行.id, 行.分组])).toEqual([["e-都没有", "提及"]])
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

  test("清单截断时缺口说清上限与全量", async () => {
    const { 缺口, 总数 } = await 实体清单(库(), { projectId: 项目, limit: 2 })
    expect(总数).toBe(7)
    expect(缺口.join()).toContain("前 2 条")
    expect(缺口.join()).toContain("共 7 条")
    expect(清单上限).toBe(200)
  })

  test("清单缺口：恰好满页不算截断", async () => {
    // 号码恰 2 条：limit 2 是「正好装下」，不是「还有更多」。
    expect((await 实体清单(库(), { projectId: 项目, q: "138", limit: 2 })).缺口).toEqual([])
    expect((await 实体清单(库(), { projectId: 项目, q: "138", limit: 1 })).缺口.join()).toContain("前 1 条")
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

  test("档案待确认：实体 0/1 + 关系 + 事件；已确认、已排除、对方已排除都不计", async () => {
    const 档 = (await 实体档案(库(), { projectId: 待确认项目, id: "e-待" }))!
    expect(档.待确认).toEqual({ 实体: 1, 关系: 1, 事件: 1, 合计: 3 })
    // 打开「显示已排除」也不计：排除是人的决定，不是待办。
    const 带排 = (await 实体档案(库(), { projectId: 待确认项目, id: "e-待", includeExcluded: true }))!
    expect(带排.待确认).toEqual({ 实体: 1, 关系: 1, 事件: 1, 合计: 3 })
    // 已确认的实体自身不是待确认；它没有任何事实。
    const 准 = (await 实体档案(库(), { projectId: 待确认项目, id: "e-准" }))!
    expect(准.待确认).toEqual({ 实体: 0, 关系: 0, 事件: 0, 合计: 0 })
    // 自动抽取的实体自身算 1。
    const 对 = (await 实体档案(库(), { projectId: 待确认项目, id: "e-对" }))!
    expect(对.待确认.实体).toBe(1)
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

  // 2026-11-07：关系只有一个 200 条上限，而排序键把无时间的笔录关系排到最后 ⇒
  // 数据关系一满 200 条，人说的（民警从笔录里认的关系）整段消失。
  test("档案关系分两段各留各的：数据关系满 200 时人说的不消失", async () => {
    const 档 = (await 实体档案(库(), { projectId: 分段项目, id: "e-段" }))!
    expect(档.关系.filter((行) => 行.source_kind === "data")).toHaveLength(200)
    expect(档.关系.filter((行) => 行.source_kind === "human")).toHaveLength(3)
    // 数据段恰好 200（正好装下）、人段 3 < 100 ⇒ 两段都没截断，不报缺口。
    expect(档.关系数据总数).toBe(200)
    expect(档.关系人总数).toBe(3)
    expect(档.缺口).toBeUndefined()
  })

  // 每段的上限各管各的：缺口要分段报各自的全量，不能拿合并数糊过去。
  test("档案关系两段都超限时，缺口分段报全量", async () => {
    const 档 = (await 实体档案(库(), { projectId: 分段项目, id: "e-溢" }))!
    expect(档.关系.filter((行) => 行.source_kind === "data")).toHaveLength(200)
    expect(档.关系.filter((行) => 行.source_kind === "human")).toHaveLength(100)
    expect(档.关系数据总数).toBe(201)
    expect(档.关系人总数).toBe(101)
    expect(档.关系总数).toBe(302)
    const 缺口 = 档.缺口 ?? []
    expect(缺口.some((条) => 条.includes("数据说的关系") && 条.includes("共 201 条"))).toBe(true)
    expect(缺口.some((条) => 条.includes("人说的关系") && 条.includes("共 101 条"))).toBe(true)
    expect(档.一句话).toContain("302 条有效关系")
  })

  test("档案出处恰好满上限不算截断（缺口 undefined）", async () => {
    const 档 = (await 实体档案(库(), { projectId: 引用项目, id: "e-满引" }))!
    expect(档.引用).toHaveLength(引用上限)
    expect(档.引用总数).toBe(引用上限)
    expect(档.缺口).toBeUndefined()
  })
})
