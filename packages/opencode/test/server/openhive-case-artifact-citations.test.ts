import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
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

/**
 * `登记产物引用` 现在走 `inTransaction` ⇒ 按 R-预2 把池留 1 条：PGlite 把多条连接汇进同一
 * 个 PG 会话，事务从池里另起一条再准备同一句带参 SQL 会 42P05。`startProductionDb()` 给它
 * 自己那个客户端传的是固定 env（不含 `PG_POOL_MAX`），在 `process.env` 里配不进去——
 * 所以走生产入口 `connect()` 自建一份（同 `openhive-case-merge.test.ts`）。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = (): Queryable => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 项目 = "p-产物引用"
const 别人的项目 = "p-产物引用-别人"

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
  await 建实体(库(), { id: "e-张", projectId: 项目, type: "人", value: "张三" })
  await 建实体(库(), { id: "e-李", projectId: 项目, type: "人", value: "李四" })
  await 建关系(库(), { id: "r-张李", projectId: 项目, fromId: "e-张", toId: "e-李", type: "转账", amount: 100 })
  await 建事件(库(), { id: "ev-见面", projectId: 项目, type: "见面", summary: "两人见面" })
  // 别人的项目里同名事实：所有查询必须按 project_id 收敛，不能被它带偏。
  await 建实体(库(), { id: "e-张", projectId: 别人的项目, type: "人", value: "别人家的张三" })
  // 只存在于别人项目的事实：引用它必须被跳过（跨项目引用不许登记）。
  await 建实体(库(), { id: "e-别人的专有", projectId: 别人的项目, type: "人", value: "别人家的专有" })
  // 关系与事件**同 id**：关系值回落的子查询必须带 `fact_type = 'relation'`，否则事件引用会
  // 显示成一条关系（fact id 是自由字符串，跨表撞 id 完全合法）。
  await 建关系(库(), { id: "r-撞号", projectId: 项目, fromId: "e-张", toId: "e-李", type: "通话" })
  await 建事件(库(), { id: "r-撞号", projectId: 项目, type: "见面", summary: "撞号事件" })
})

afterAll(async () => {
  await 客户端?.$client.close()
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

/**
 * 从 drizzle `SQL` 对象里取原始语句文本。**只用于测试注入失败点**：判断「这一步是不是
 * 插引用」，不拿它做任何生产判据。
 */
function 语句文本(query: unknown): string {
  const chunks = (query as { queryChunks?: readonly unknown[] }).queryChunks ?? []
  return chunks
    .map((块) => {
      if (typeof 块 === "string") return 块
      const 值 = (块 as { value?: unknown }).value
      return Array.isArray(值) ? 值.join("") : ""
    })
    .join(" ")
}

/**
 * 事务内「插引用」那一步人造失败，其余语句原样透传。
 *
 * 目的只有一个：验证「删旧 ＋ 登记产物行 ＋ 插引用」确实在**同一个事务**里——旧实现先自动
 * 提交 delete，一旦后面抛错，这个路径的引用就被清零（页面显示「没有引用事实」，请复核消失）。
 */
function 坏在插引用(db: Queryable): Queryable {
  const 事务库 = db as Queryable & {
    transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  }
  return {
    execute: (query: Parameters<Queryable["execute"]>[0]) => db.execute(query),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      事务库.transaction((tx) =>
        fn({
          execute: (query: Parameters<Queryable["execute"]>[0]) => {
            if (语句文本(query).includes("insert into auth.case_citation"))
              throw new Error("人造失败：插引用这一步")
            return tx.execute(query)
          },
        }),
      ),
  } as unknown as Queryable
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

  test("只在别人项目里存在的事实 ⇒ 跳过（不允许跨项目引用）", async () => {
    const 结果 = await 登记产物引用(库(), {
      projectId: 项目,
      path: "报告/跨项目.md",
      content: "跨项目引用：[[fact:entity:e-别人的专有]]",
    })
    expect(结果.登记).toBe(0)
    expect(结果.跳过.map((条) => 条.原文)).toEqual(["[[fact:entity:e-别人的专有]]"])
    expect(结果.跳过[0]!.原因).toContain("这个项目里没有这条事实")
  })

  test("已排除的事实仍出现在复核结果里（不吞待复核行），并带上 trust_state", async () => {
    await 建实体(库(), { id: "e-排除", projectId: 项目, type: "人", value: "被排除的人", trustState: "已排除" })
    await 登记产物引用(库(), {
      projectId: 项目,
      path: "报告/排除.md",
      content: "[[fact:entity:e-排除]]",
    })
    const 结果 = await 产物复核(库(), { projectId: 项目, path: "报告/排除.md" })
    expect(结果.引用.length).toBe(1)
    expect(结果.引用[0]!.trust_state).toBe("已排除")
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

  test("关系值回落的子查询只认 relation：event 与 relation 同 id 时显示事件摘要", async () => {
    await 登记产物引用(库(), {
      projectId: 项目,
      path: "报告/撞号.md",
      content: "[[fact:event:r-撞号]]",
    })
    const 结果 = await 产物复核(库(), { projectId: 项目, path: "报告/撞号.md" })
    expect(结果.引用).toHaveLength(1)
    // 缺 `fact_type = 'relation'` 时这里会变成「张三 → 李四 · 通话」——关系子查询按 id 撞上了。
    expect(结果.引用[0]!.值).toBe("撞号事件")
  })

  test("插入阶段抛错 ⇒ 旧引用仍在（删旧 + 登记在同一事务里，不把复核清零）", async () => {
    const 旧 = await 登记产物引用(库(), {
      projectId: 项目,
      path: "报告/事务.md",
      content: "[[fact:entity:e-张]]",
    })
    expect(await 引用行数(库(), 项目, 旧.材料id!)).toBe(1)

    let 抛了 = false
    try {
      // 内容变了 ⇒ 会先删掉本路径旧引用、再建新产物行与引用；插引用这一步人造失败。
      await 登记产物引用(坏在插引用(库()), {
        projectId: 项目,
        path: "报告/事务.md",
        content: "[[fact:entity:e-李]]",
      })
    } catch {
      抛了 = true
    }
    expect(抛了).toBe(true)
    // 没有事务时 delete 已经自动提交，这里会变 0。
    expect(await 引用行数(库(), 项目, 旧.材料id!)).toBe(1)
  })
})
