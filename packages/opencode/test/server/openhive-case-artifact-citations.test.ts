import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 产物复核, 登记产物引用, 解析标记 } from "../../src/server/openhive/case-artifact-citations"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 建事件, 建关系, 建实体 } from "./openhive-case-fact-fixture"

/**
 * 产物引用登记与复核（计划 7 Task 10）。
 *
 * ## 与生产 SQL 的文本必须不同
 *
 * PGlite 把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的；本文件的小查询
 * 一律「显式列序 ＋ 换行」，不复用 DAO 的语句文本（同 `openhive-case-fact-fixture.ts` 文件头）。
 *
 * ## 变更时间是**受控的**
 *
 * 不用生产的 `记变更`：它写真实 `nowSeconds()`，与本进程刚写下的引用时间同秒 ⇒ `>` 判不出来，
 * 用例会时红时绿。这里直接插入指定 `created_at` 的变更行。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = (): Queryable => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-产物引用"
const 别人的项目 = "p-产物引用-别人"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await 建实体(库(), { id: "e-张", projectId: 项目, type: "人", value: "张三" })
  await 建实体(库(), { id: "e-李", projectId: 项目, type: "人", value: "李四" })
  await 建关系(库(), { id: "r-张李", projectId: 项目, fromId: "e-张", toId: "e-李", type: "转账", amount: 100 })
  await 建事件(库(), { id: "ev-见面", projectId: 项目, type: "见面", summary: "两人见面" })
  // 别人的项目里同名事实：所有查询必须按 project_id 收敛，不能被它带偏。
  await 建实体(库(), { id: "e-张", projectId: 别人的项目, type: "人", value: "别人家的张三" })
})

afterAll(async () => {
  await pg?.stop()
})

const 正文 = [
  "# 分析报告",
  "",
  "张三（[[fact:entity:e-张]]）与李四之间有大额转账（[[fact:relation:r-张李]]）。",
  "[[fact:entity:e-张]] 出现第二次，算同一条引用。",
  "这一条指向不存在的事实：[[fact:entity:e-没有]]。",
  "这一条类型不对：[[fact:row:话单.xlsx#Sheet1#2]]。",
].join("\n")

async function 材料行数(db: Queryable, projectId: string, path: string): Promise<number> {
  const 行们 = rowsOf(await db.execute(sql`
    select count(*)::int as 条数
      from auth.case_material
     where project_id = ${projectId} and path = ${path}
  `))
  return Number(行们[0]?.条数 ?? 0)
}

async function 材料行(
  db: Queryable,
  projectId: string,
  path: string,
): Promise<{ id: string; kind: string; parse_status: string }> {
  const 行们 = rowsOf(await db.execute(sql`
    select id, kind, parse_status
      from auth.case_material
     where project_id = ${projectId} and path = ${path}
     order by created_at desc, id desc
     limit 1
  `))
  const 行 = 行们[0]
  if (行 === undefined) throw new Error(`没有找到材料行：${path}`)
  return { id: String(行.id), kind: String(行.kind), parse_status: String(行.parse_status) }
}

async function 引用行数(db: Queryable, projectId: string, materialId: string): Promise<number> {
  const 行们 = rowsOf(await db.execute(sql`
    select count(*)::int as 条数
      from auth.case_citation
     where project_id = ${projectId} and material_id = ${materialId}
  `))
  return Number(行们[0]?.条数 ?? 0)
}

/** 受控时间的变更留痕：`action='确认'` 不触发「必须写理由」的两条 CHECK。 */
async function 建变更(
  db: Queryable,
  input: { projectId: string; factType: string; factId: string; createdAt: number },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_fact_change
      (id, project_id, fact_type, fact_id, action, actor_id, actor_name, actor_police_no, created_at)
    values (${crypto.randomUUID()}, ${input.projectId}, ${input.factType}, ${input.factId},
            '确认', 'u-测试', '测试员', '000000', ${input.createdAt})
  `)
}

describe("产物引用（计划 7 Task 10）", () => {
  test("解析标记：认得三种事实、去重、报未认", () => {
    const { 引用们, 未认 } = 解析标记(正文)
    // `解析标记` 只判语法、不查库：`e-没有` 语法合法，也在引用们里；存在性由 `登记产物引用` 判。
    expect(引用们.map((条) => `${条.fact_type}:${条.fact_id}`)).toEqual([
      "entity:e-张",
      "relation:r-张李",
      "entity:e-没有",
    ])
    expect(引用们[0]!.原文).toBe("[[fact:entity:e-张]]")
    expect(引用们[0]!.位置).toBe(正文.indexOf("[[fact:entity:e-张]]"))
    expect(未认.map((条) => 条.原文)).toEqual(["[[fact:row:话单.xlsx#Sheet1#2]]"])
    expect(未认[0]!.原因).toContain("只认 entity / relation / event")
  })

  test("没写标记的正文 ⇒ 一条都不认，也不建材料行", async () => {
    const 结果 = await 登记产物引用(库(), { projectId: 项目, path: "报告/空.md", content: "没有标记" })
    expect(结果).toMatchObject({ 登记: 0, 删除: 0, 材料id: null })
    expect(await 材料行数(库(), 项目, "报告/空.md")).toBe(0)
  })

  test("登记：产物行进材料库，存在的两条写引用，不存在的进跳过", async () => {
    const 结果 = await 登记产物引用(库(), { projectId: 项目, path: "报告/分析.md", content: 正文 })
    expect(结果.登记).toBe(2)
    expect(结果.跳过.map((条) => 条.原文)).toEqual([
      "[[fact:entity:e-没有]]",
      "[[fact:row:话单.xlsx#Sheet1#2]]",
    ])
    const 材料 = await 材料行(库(), 项目, "报告/分析.md")
    expect(材料.kind).toBe("产物")
    // 库的硬边界（0031 的 `case_material_parsed_source`）：产物只能停在 `未入队`。
    expect(材料.parse_status).toBe("未入队")
    expect(结果.材料id).toBe(材料.id)
  })

  test("重复登记同一份内容：材料行不分裂、引用条数不变", async () => {
    const 第一次 = await 登记产物引用(库(), { projectId: 项目, path: "报告/分析.md", content: 正文 })
    const 第二次 = await 登记产物引用(库(), { projectId: 项目, path: "报告/分析.md", content: 正文 })
    expect(第二次.材料id).toBe(第一次.材料id)
    expect(await 材料行数(库(), 项目, "报告/分析.md")).toBe(1)
    expect(await 引用行数(库(), 项目, 第二次.材料id!)).toBe(2)
  })

  test("内容变了 ⇒ 新版本材料行，旧版本的引用被清掉（同一路径只有一份回链）", async () => {
    const 旧的 = await 登记产物引用(库(), { projectId: 项目, path: "报告/改.md", content: 正文 })
    const 换了 = 正文 + "\n补充：[[fact:event:ev-见面]]。"
    const 新的 = await 登记产物引用(库(), { projectId: 项目, path: "报告/改.md", content: 换了 })
    expect(新的.材料id).not.toBe(旧的.材料id)
    expect(新的.登记).toBe(3)
    expect(await 引用行数(库(), 项目, 旧的.材料id!)).toBe(0)
  })

  test("产物复核：刚登记完没有要复核的", async () => {
    const 结果 = await 产物复核(库(), { projectId: 项目, path: "报告/分析.md" })
    expect(结果.产物?.kind).toBe("产物")
    expect(结果.引用.length).toBe(2)
    expect(结果.需复核).toBe(0)
  })

  test("变更时间与引用时间同一秒 ⇒ 不算复核（判据是严格大于）", async () => {
    const 前 = await 产物复核(库(), { projectId: 项目, path: "报告/分析.md" })
    const 引用时间 = 前.引用.find((条) => 条.fact_id === "e-张")!.引用时间
    await 建变更(库(), { projectId: 项目, factType: "entity", factId: "e-张", createdAt: 引用时间 })
    const 后 = await 产物复核(库(), { projectId: 项目, path: "报告/分析.md" })
    expect(后.引用.find((条) => 条.fact_id === "e-张")!.变更时间).toBe(引用时间)
    expect(后.需复核).toBe(0)
  })

  test("这条事实之后被改过 ⇒ 恰好那一条要复核", async () => {
    const 前 = await 产物复核(库(), { projectId: 项目, path: "报告/分析.md" })
    const 引用时间 = 前.引用.find((条) => 条.fact_id === "e-张")!.引用时间
    await 建变更(库(), { projectId: 项目, factType: "entity", factId: "e-张", createdAt: 引用时间 + 1 })
    const 后 = await 产物复核(库(), { projectId: 项目, path: "报告/分析.md" })
    expect(后.需复核).toBe(1)
    expect(后.引用.find((条) => 条.fact_id === "e-张")!.需复核).toBe(true)
    expect(后.引用.find((条) => 条.fact_id === "r-张李")!.需复核).toBe(false)
  })

  test("没登记过的路径 ⇒ 产物 null ＋ 缺口一句话，不是抛错", async () => {
    const 结果 = await 产物复核(库(), { projectId: 项目, path: "报告/没有.md" })
    expect(结果.产物).toBeNull()
    expect(结果.缺口.join()).toContain("还没有登记过引用")
  })
})
