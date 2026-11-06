import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 材料事实清单 } from "../../src/server/openhive/case-material-facts"
import { addCitation } from "../../src/server/openhive/case-store"
import { 建事件, 建实体, 建材料, 建关系 } from "./openhive-case-fact-fixture"

/**
 * 材料事实清单（计划 7 Task 2）。
 *
 * 写入一律走生产出口 `addCitation`（`case-store.ts:466`）：行级引用的 `locator` 与
 * `fact_id` 由它的契约决定，测试别另写一条写入路径，否则测的就不是生产形状。
 * 只有「locator 是 JSON 字符串标量」这种驱动 / 旧行形状需要裸 SQL 落库（生产出口写不出来）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-材料事实"
const 别人的项目 = "p-别处"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const [id, path, kind] of [
    ["m-单", "话单.xlsx", "话单"],
    ["m-空", "空.xlsx", "笔录"],
    ["m-厚", "厚.xlsx", "话单"],
    ["m-排除", "排除.xlsx", "话单"],
    ["m-未知", "未知.xlsx", "话单"],
    ["m-不变量", "不变量.xlsx", "话单"],
    ["m-小", "小.xlsx", "话单"],
    ["m-详对象", "详对象.xlsx", "笔录"],
    ["m-详串", "详串.xlsx", "笔录"],
  ] as const) {
    await 建材料(库(), { id, projectId: 项目, path, fileName: path, kind })
  }

  await 建实体(库(), { id: "e-张", projectId: 项目, value: "张三", type: "人", trustState: "自动抽取" })
  await 建实体(库(), { id: "e-李", projectId: 项目, value: "李四", type: "人" })
  await 建实体(库(), { id: "e-号1", projectId: 项目, value: "13800000001", type: "号码" })
  await 建实体(库(), { id: "e-排", projectId: 项目, value: "王五", type: "人", trustState: "已排除" })
  await 建实体(库(), { id: "e-对排", projectId: 项目, value: "赵六", type: "人", trustState: "已排除" })
  await 建事件(库(), { id: "ev-排", projectId: 项目, summary: "已排除事件", trustState: "已排除" })
  await 建关系(库(), { id: "r-张李", projectId: 项目, fromId: "e-张", toId: "e-李", type: "通话" })
  // 关系本身有效，但对方实体已排除（§9.1：默认不出现）。
  await 建关系(库(), { id: "r-张排", projectId: 项目, fromId: "e-张", toId: "e-对排", type: "转账" })
  // 关系本身已排除。
  await 建关系(库(), { id: "r-排", projectId: 项目, fromId: "e-排", toId: "e-李", type: "通话", trustState: "已排除" })
  // 关系本身有效，但**起端**实体已排除（钉住 `关系起.trust_state` 这个谓词）。
  await 建关系(库(), { id: "r-起排", projectId: 项目, fromId: "e-对排", toId: "e-李", type: "通话" })

  const 引用 = (
    id: string,
    factType: "entity" | "relation" | "event" | "row",
    factId: string,
    materialId: string,
    locator: unknown,
  ) => addCitation(库(), { id, projectId: 项目, factType, factId, materialId, locator, extractMethod: "机器" })

  await 引用("c-e1", "entity", "e-张", "m-单", { sheet: "Sheet#1", row: 2 })
  await 引用("c-r1", "relation", "r-张李", "m-单", { sheet: "Sheet#1", row: 2 })
  await 引用("c-e2", "entity", "e-号1", "m-单", { sheet: "通话明细", row: 3 })

  // §9.1：已排除实体 / 事件 / 关系本身 / 对方实体已排除的关系，各一条。
  await 引用("c-排实体", "entity", "e-排", "m-排除", { sheet: "排除表", row: 1 })
  await 引用("c-排事件", "event", "ev-排", "m-排除", { sheet: "排除表", row: 2 })
  await 引用("c-排对端", "relation", "r-张排", "m-排除", { sheet: "排除表", row: 3 })
  await 引用("c-排关系", "relation", "r-排", "m-排除", { sheet: "排除表", row: 4 })
  await 引用("c-起排", "relation", "r-起排", "m-排除", { sheet: "排除表", row: 5 })

  // 定位形状不认识：笔录路径真实写入的 `{start,end}`（`case-ingest.ts:513,548,577`）。
  await 引用("c-未1", "entity", "e-张", "m-未知", { start: 0, end: 1200 })
  await 引用("c-未2", "entity", "e-张", "m-未知", { start: 1201, end: 2400 })

  // 头号不变量：row 型 fact_id 里嵌着「Sheet#1#2」，但定位只认 locator。
  await 引用("c-行", "row", "m-单#Sheet#1#2", "m-不变量", { sheet: "真表", row: 7 })

  await 引用("c-小关系", "relation", "r-张李", "m-小", { sheet: "小表", row: 1 })
  await 引用("c-小悬空", "entity", "e-不存在", "m-小", { sheet: "小表", row: 2 })
  // locator 是 JSON **字符串标量**（旧行 / 某些驱动的形状），生产出口写不出来。
  await 库().execute(sql`
    insert into auth.case_citation
      (id, project_id, fact_type, fact_id, material_id, locator, extract_method, created_at)
    values
      (${"c-小字符串"}, ${项目}, ${"entity"}, ${"e-张"}, ${"m-小"},
       ${JSON.stringify(JSON.stringify({ sheet: "字符串表", row: 9 }))}::text::jsonb, ${"机器"}, 1760000000)
  `)

  // parse_detail 两路：jsonb 对象 / jsonb 字符串标量（内容是一段 JSON 文本）。
  await 库().execute(sql`
    update auth.case_material
       set parse_detail = ${JSON.stringify({ rows: 3 })}::text::jsonb
     where project_id = ${项目} and id = ${"m-详对象"}
  `)
  await 库().execute(sql`
    update auth.case_material
       set parse_detail = ${JSON.stringify(JSON.stringify({ rows: 5 }))}::text::jsonb
     where project_id = ${项目} and id = ${"m-详串"}
  `)

  // 单个 sheet 501 行 ⇒ 截断到 500；id 补零保证插入 / 排序稳定。
  for (let i = 1; i <= 501; i++) {
    await 引用(`c-厚-${String(i).padStart(4, "0")}`, "entity", "e-号1", "m-厚", { sheet: "Sheet1", row: i })
  }
})

afterAll(async () => {
  await pg?.stop()
})

describe("材料事实清单", () => {
  test("按 sheet / row 分组；工作表名含 # 也不拆错", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "话单.xlsx" }))!
    expect(结果.分组.map((组) => 组.sheet)).toEqual(["Sheet#1", "通话明细"])
    expect(结果.分组[0]!.行们.map((行) => 行.row_no)).toEqual([2])
    expect(结果.分组[0]!.行们[0]!.事实们.map((条) => 条.fact_id)).toEqual(["e-张", "r-张李"])
  })

  test("事实值取 canonical_value；自动抽取的 trust_state 如实带出", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "话单.xlsx" }))!
    expect(结果.分组[0]!.行们[0]!.事实们[0]!.值).toBe("张三")
    expect(结果.分组[0]!.行们[0]!.事实们[0]!.trust_state).toBe("自动抽取")
  })

  test("材料不存在 / 不属于本项目 ⇒ undefined", async () => {
    expect(await 材料事实清单(库(), { projectId: 项目, path: "没有.xlsx" })).toBeUndefined()
    expect(await 材料事实清单(库(), { projectId: 别人的项目, path: "话单.xlsx" })).toBeUndefined()
  })

  test("没有引用的材料 ⇒ 空分组 + 缺口说清（解析结果为空与没解析是两件事）", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "空.xlsx" }))!
    expect(结果.分组).toEqual([])
    expect(结果.缺口.join()).toContain("没有引用")
  })

  test("单个 sheet 超过 500 行时截断并写缺口（说清丢了多少行）", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "厚.xlsx" }))!
    expect(结果.分组[0]!.行们.length).toBe(500)
    expect(结果.缺口.join()).toContain("500")
    expect(结果.缺口.join()).toContain("另有 1 行")
  })

  test("§9.1：默认排除已排除的实体 / 事件 / 关系；includeExcluded 才带出", async () => {
    const 默认 = (await 材料事实清单(库(), { projectId: 项目, path: "排除.xlsx" }))!
    expect(默认.分组).toEqual([])
    // 全被排除 ≠ 没有引用：空态说明不能写成「解析没抽出事实」。
    expect(默认.缺口.join()).toContain("均已排除")

    const 含排除 = (await 材料事实清单(库(), {
      projectId: 项目,
      path: "排除.xlsx",
      includeExcluded: true,
    }))!
    expect(含排除.分组.map((组) => 组.sheet)).toEqual(["排除表"])
    expect(含排除.分组[0]!.行们.flatMap((行) => 行.事实们.map((条) => 条.fact_id))).toEqual([
      "e-排",
      "ev-排",
      "r-张排",
      "r-排",
      "r-起排",
    ])
    expect(含排除.分组[0]!.行们.flatMap((行) => 行.事实们.map((条) => 条.trust_state))).toEqual([
      "已排除",
      "已排除",
      "自动抽取",
      "已排除",
      "自动抽取",
    ])
  })

  test("定位形状不认识（{start,end}）⇒ 分组为空，缺口写清条数，不静默吞", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "未知.xlsx" }))!
    expect(结果.分组).toEqual([])
    expect(结果.缺口.join()).toContain("2 条引用")
    expect(结果.缺口.join()).toContain("工作表")
  })

  test("头号不变量：分组只认 locator，不拆 fact_id 的 #", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "不变量.xlsx" }))!
    expect(结果.分组.map((组) => 组.sheet)).toEqual(["真表"])
    expect(结果.分组[0]!.行们.map((行) => 行.row_no)).toEqual([7])
    expect(结果.分组[0]!.行们[0]!.事实们[0]!.fact_id).toBe("m-单#Sheet#1#2")
  })

  test("关系的事实值是「起点 → 终点 · 类型」", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "小.xlsx" }))!
    const 关系条 = 结果.分组
      .flatMap((组) => 组.行们)
      .flatMap((行) => 行.事实们)
      .find((条) => 条.fact_id === "r-张李")
    expect(关系条?.值).toBe("张三 → 李四 · 通话")
  })

  test("悬空引用（事实行被删）⇒ 值回落成 fact_id，trust_state 为 null", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "小.xlsx" }))!
    const 悬空条 = 结果.分组
      .flatMap((组) => 组.行们)
      .flatMap((行) => 行.事实们)
      .find((条) => 条.fact_id === "e-不存在")
    expect(悬空条?.值).toBe("e-不存在")
    expect(悬空条?.trust_state).toBeNull()
  })

  test("locator 是 JSON 字符串标量时也能收", async () => {
    const 结果 = (await 材料事实清单(库(), { projectId: 项目, path: "小.xlsx" }))!
    const 字符串组 = 结果.分组.find((组) => 组.sheet === "字符串表")
    expect(字符串组?.行们.map((行) => 行.row_no)).toEqual([9])
  })

  test("parse_detail 两路解 JSON：对象与字符串标量", async () => {
    const 对象 = (await 材料事实清单(库(), { projectId: 项目, path: "详对象.xlsx" }))!
    expect(对象.材料.parse_detail).toEqual({ rows: 3 })
    const 字符串 = (await 材料事实清单(库(), { projectId: 项目, path: "详串.xlsx" }))!
    expect(字符串.材料.parse_detail).toEqual({ rows: 5 })
  })
})
