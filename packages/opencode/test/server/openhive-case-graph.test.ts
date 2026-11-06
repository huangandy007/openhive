import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 关系图 } from "../../src/server/openhive/case-graph"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 建关系, 建实体 } from "./openhive-case-fact-fixture"

/**
 * 关系图 DAO（计划 7 Task 3）。
 *
 * 共享夹具的 `建关系` 不写 `times` 列（DDL 可空、无默认值），所以「边带上次数」这条
 * 断言要在本文件里自带一条写 `times` 的构造器。它与生产 SQL 的**文本必须不同**
 * （PGlite 把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的，同文本会
 * 42P05，见夹具文件头）：这里显式列序 + 换行。
 */
async function 建带次数关系(
  db: Queryable,
  input: {
    id: string
    projectId: string
    fromId: string
    toId: string
    type: string
    times: number
    amount?: number | null
    trustState?: string
  },
): Promise<void> {
  await db.execute(sql`
    insert into auth.case_relation
      (id, project_id, from_id, to_id, type, times, amount, source_kind, trust_state, created_at)
    values
      (${input.id}, ${input.projectId}, ${input.fromId}, ${input.toId},
       ${input.type}, ${input.times},
       ${input.amount === undefined || input.amount === null ? null : input.amount.toFixed(2)},
       'data', ${input.trustState ?? "自动抽取"}, 1_760_000_000)
  `)
}

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 项目 = "p-图"
const 别人的项目 = "p-图别人"
const 排序项目 = "p-图序"

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  await 建实体(库(), { id: "e-张", projectId: 项目, value: "张三", type: "人" })
  // 非默认信任态：节点上的 `trust_state` 必须取自实体行，不能写死「自动抽取」。
  await 建实体(库(), { id: "e-李", projectId: 项目, value: "李四", type: "人", trustState: "已确认" })
  await 建实体(库(), { id: "e-账", projectId: 项目, value: "6222****0002", type: "账户" })
  await 建实体(库(), { id: "e-号1", projectId: 项目, value: "13800000001", type: "号码" })
  await 建实体(库(), { id: "e-号2", projectId: 项目, value: "13800000002", type: "号码" })
  await 建实体(库(), { id: "e-外", projectId: 项目, value: "13700000009", type: "号码" })
  await 建实体(库(), { id: "e-排", projectId: 项目, value: "王五", type: "人", trustState: "已排除" })
  await 建实体(库(), { id: "e-别人", projectId: 别人的项目, value: "赵六", type: "人" })

  await 建关系(库(), { id: "r-张李", projectId: 项目, fromId: "e-张", toId: "e-李", type: "通话" })
  // 唯一带次数的边：截断时靠 `coalesce(times,0) desc` 抢到第一个名额。
  await 建带次数关系(库(), {
    id: "r-张账",
    projectId: 项目,
    fromId: "e-张",
    toId: "e-账",
    type: "转账",
    times: 1,
    amount: 100,
  })
  await 建关系(库(), { id: "r-李号1", projectId: 项目, fromId: "e-李", toId: "e-号1", type: "实名登记" })
  await 建关系(库(), { id: "r-李号2", projectId: 项目, fromId: "e-李", toId: "e-号2", type: "实名登记" })
  await 建关系(库(), { id: "r-号1外", projectId: 项目, fromId: "e-号1", toId: "e-外", type: "通话" })
  // 已排除端点在**两端各一条**：brief 的变异 A 只改 `起` 端条件，
  // 若种子里已排除实体只出现在 `to` 端，那条变异恒不红（本文件多补 `r-排张`）。
  await 建关系(库(), { id: "r-张排", projectId: 项目, fromId: "e-张", toId: "e-排", type: "通话" })
  await 建关系(库(), { id: "r-排张", projectId: 项目, fromId: "e-排", toId: "e-张", type: "通话" })
  // 关系在本项目、对端实体在别的项目：join 的 `project_id` 漏带到哪一侧都会把它画出来。
  await 建关系(库(), { id: "r-张别人", projectId: 项目, fromId: "e-张", toId: "e-别人", type: "通话" })

  // 排序项目：两条边 id 是纯 ASCII，任何「按 id 排序」都与「按次数排序」相左，
  // 不依赖库的中文排序规则 —— 删掉 `times` 排序时必红。
  await 建实体(库(), { id: "e-心", projectId: 排序项目, value: "中心", type: "人" })
  await 建实体(库(), { id: "e-甲", projectId: 排序项目, value: "甲", type: "账户" })
  await 建实体(库(), { id: "e-乙", projectId: 排序项目, value: "乙", type: "账户" })
  await 建关系(库(), { id: "r-a", projectId: 排序项目, fromId: "e-心", toId: "e-甲", type: "通话" })
  await 建带次数关系(库(), {
    id: "r-z",
    projectId: 排序项目,
    fromId: "e-心",
    toId: "e-乙",
    type: "通话",
    times: 3,
  })
})

afterAll(async () => {
  await pg?.stop()
})

describe("关系图", () => {
  test("1 跳：只画中心与直接邻居；已排除端点不画", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张" }))!
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["e-张", "e-李", "e-账"].sort())
    expect(图.边.map((边) => 边.id).sort()).toEqual(["r-张李", "r-张账"].sort())
    expect(图.节点.find((点) => 点.id === "e-张")!.中心).toBe(true)
    expect(图.节点.find((点) => 点.id === "e-李")!.跳数).toBe(1)
    expect(图.节点.find((点) => 点.id === "e-李")!.trust_state).toBe("已确认")
  })

  test("2 跳：带上第 2 跳节点与边；第 3 跳不画", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张", 跳数: 2 }))!
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["e-账", "e-号1", "e-号2", "e-张", "e-李"].sort())
    expect(图.边.some((边) => 边.id === "r-号1外")).toBe(false)
  })

  test("类型筛选只留该类型的边与两端", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张", 跳数: 2, 类型: ["转账"] }))!
    expect(图.边.map((边) => 边.id)).toEqual(["r-张账"])
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["e-张", "e-账"].sort())
  })

  test("上限截断写缺口，且 2 跳不再画", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张", 跳数: 2, 上限: 2 }))!
    expect(图.节点.length).toBe(2)
    expect(图.缺口.join()).toContain("2")
    // 第二个名额是 e-账（r-张账 次数 1 排在前面）；装不下端点的边**不能画**，
    // 否则图里会留一条悬空边（§9.1）。
    expect(图.节点.map((点) => 点.id)).toEqual(["e-张", "e-账"])
    expect(图.边.map((边) => 边.id)).toEqual(["r-张账"])
  })

  test("中心不存在 / 已排除 / 别的项目 ⇒ undefined", async () => {
    expect(await 关系图(库(), { projectId: 项目, id: "没有" })).toBeUndefined()
    expect(await 关系图(库(), { projectId: 项目, id: "e-排" })).toBeUndefined()
    expect(await 关系图(库(), { projectId: 项目, id: "e-别人" })).toBeUndefined()
  })

  test("边带上次数与金额（金额是 numeric 文本，不带千分位）", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张" }))!
    const 转账 = 图.边.find((边) => 边.id === "r-张账")!
    expect(转账.amount).toBe("100.00")
    expect(转账.times).toBe(1)
  })

  test("截断时按次数降序抢名额（删掉 times 排序会画错边）", async () => {
    const 图 = (await 关系图(库(), { projectId: 排序项目, id: "e-心", 上限: 2 }))!
    expect(图.节点.map((点) => 点.id)).toEqual(["e-心", "e-乙"])
    expect(图.边.map((边) => 边.id)).toEqual(["r-z"])
  })
})
