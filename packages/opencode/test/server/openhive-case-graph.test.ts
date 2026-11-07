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
const 细类项目 = "p-图细类"

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
  // §9.1 四类里的第 3 类：关系自身已排除（两端都可见）。它必须整条消失。
  await 建关系(库(), { id: "r-排除", projectId: 项目, fromId: "e-张", toId: "e-李", type: "通话", trustState: "已排除" })
  // §9.1 第 4 类：悬空端点（`case_relation` 无外键，可以插进去）。
  // 实测（`#004-03`）：单把两条 join 改成 left join **不红**——`终.trust_state <> '已排除'`
  // 作用在 NULL 上为假，WHERE 仍是第二道闸；只有「left join ＋ 拆掉端点可见性条件」才会画出来。
  await 建关系(库(), { id: "r-悬空", projectId: 项目, fromId: "e-张", toId: "e-不存在", type: "通话" })
  // 入方向：只有 `or r.to_id in (…)` 这一半能把它取到（删掉那半句必红）。
  await 建关系(库(), { id: "r-账张", projectId: 项目, fromId: "e-账", toId: "e-张", type: "通话" })

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
  // 自环：同一条边在 `关联数` 里只算一次（from_id = to_id 时别加两遍）。
  await 建关系(库(), { id: "r-自", projectId: 排序项目, fromId: "e-心", toId: "e-心", type: "通话" })
  // 第 1 跳恰好装满上限、且没有被截断（没有更多边）：缺口只能说「未展开第 2 跳」，
  // 不能谎称「画了前 N 个」。
  await 建实体(库(), { id: "e-满", projectId: 排序项目, value: "满", type: "人" })
  await 建实体(库(), { id: "e-甲2", projectId: 排序项目, value: "甲二", type: "账户" })
  await 建实体(库(), { id: "e-乙2", projectId: 排序项目, value: "乙二", type: "账户" })
  await 建关系(库(), { id: "r-满甲", projectId: 排序项目, fromId: "e-满", toId: "e-甲2", type: "通话" })
  await 建关系(库(), { id: "r-满乙", projectId: 排序项目, fromId: "e-满", toId: "e-乙2", type: "通话" })

  // 第 2 跳截断：中心 1 个邻居，邻居再连 50 个不同实体。上限 50 ⇒ 第 2 跳只能画 48 条，
  // 剩下 2 条只能进缺口。修复前 `limit = 剩余` 把多出来的行静默吃掉，缺口是空的。
  await 建实体(库(), { id: "e-根", projectId: "p-二跳", value: "根", type: "人" })
  await 建实体(库(), { id: "e-枝", projectId: "p-二跳", value: "枝", type: "人" })
  await 建关系(库(), { id: "r-根枝", projectId: "p-二跳", fromId: "e-根", toId: "e-枝", type: "通话" })
  for (let i = 0; i < 50; i++) {
    const 号 = String(i).padStart(2, "0")
    await 建实体(库(), { id: `e-叶${号}`, projectId: "p-二跳", value: `叶${号}`, type: "账户" })
    await 建关系(库(), {
      id: `r-枝叶${号}`,
      projectId: "p-二跳",
      fromId: "e-枝",
      toId: `e-叶${号}`,
      type: "转账",
      amount: 1,
    })
  }

  // 细类：形状（11 位手机号）与 attrs（原文写「固定电话」）两条来源各一条；
  // 中心实体自己就是号码，用来钉「中心节点也带细类」。
  await 建实体(库(), { id: "e-细心", projectId: 细类项目, value: "中心", type: "人" })
  await 建实体(库(), {
    id: "e-细号",
    projectId: 细类项目,
    value: "13800000001",
    type: "号码",
    attrs: { subtype: "固定电话" },
  })
  await 建实体(库(), { id: "e-细卡", projectId: 细类项目, value: "4111111111111111", type: "账户" })
  await 建关系(库(), { id: "r-细心号", projectId: 细类项目, fromId: "e-细心", toId: "e-细号", type: "通话" })
  await 建关系(库(), { id: "r-细心卡", projectId: 细类项目, fromId: "e-细心", toId: "e-细卡", type: "转账" })
})

afterAll(async () => {
  await pg?.stop()
})

describe("关系图", () => {
  test("1 跳：只画中心与直接邻居；已排除端点不画", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张" }))!
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["e-张", "e-李", "e-账"].sort())
    expect(图.边.map((边) => 边.id).sort()).toEqual(["r-张李", "r-张账", "r-账张"].sort())
    expect(图.节点.find((点) => 点.id === "e-张")!.中心).toBe(true)
    // 中心只有一个（别的前缀同名 / 重复加点都会在这里红）。
    expect(图.节点.filter((点) => 点.中心)).toHaveLength(1)
    expect(图.节点.find((点) => 点.id === "e-李")!.跳数).toBe(1)
    expect(图.节点.find((点) => 点.id === "e-李")!.trust_state).toBe("已确认")
    expect(图.缺口).toEqual([])
  })

  test("§9.1 四类都不画：已排除端点 / 已排除关系 / 悬空端点 / 跨项目端点", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张" }))!
    expect(图.边.some((边) => ["r-排除", "r-悬空", "r-张排", "r-排张", "r-张别人"].includes(边.id))).toBe(false)
    expect(图.节点.some((点) => ["e-排", "e-不存在", "e-别人"].includes(点.id))).toBe(false)
  })

  test("2 跳：跳数按最短距离回填；关联数只算图里画出来的边", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张", 跳数: 2 }))!
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["e-账", "e-号1", "e-号2", "e-张", "e-李"].sort())
    expect(图.边.some((边) => 边.id === "r-号1外")).toBe(false)
    expect(图.缺口).toEqual([])
    // 跳数：中心 0；e-李 / e-账 是第 1 跳；e-号1 / e-号2 是第 2 跳。
    expect(图.节点.find((点) => 点.id === "e-张")!.跳数).toBe(0)
    expect(图.节点.find((点) => 点.id === "e-李")!.跳数).toBe(1)
    expect(图.节点.find((点) => 点.id === "e-账")!.跳数).toBe(1)
    expect(图.节点.find((点) => 点.id === "e-号1")!.跳数).toBe(2)
    expect(图.节点.find((点) => 点.id === "e-号2")!.跳数).toBe(2)
    // 关联数（按实际种子）：e-张 3 条（r-张李 / r-张账 / r-账张）、e-李 3 条、
    // e-账 2 条、e-号1 1 条、e-号2 1 条。
    expect(图.节点.find((点) => 点.id === "e-张")!.关联数).toBe(3)
    expect(图.节点.find((点) => 点.id === "e-李")!.关联数).toBe(3)
    expect(图.节点.find((点) => 点.id === "e-账")!.关联数).toBe(2)
    expect(图.节点.find((点) => 点.id === "e-号1")!.关联数).toBe(1)
    expect(图.节点.find((点) => 点.id === "e-号2")!.关联数).toBe(1)
  })

  test("类型筛选只留该类型的边与两端", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张", 跳数: 2, 类型: ["转账"] }))!
    expect(图.边.map((边) => 边.id)).toEqual(["r-张账"])
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["e-张", "e-账"].sort())
  })

  test("第 1 跳被截断时缺口说清画了多少、共有多少", async () => {
    const 图 = (await 关系图(库(), { projectId: 项目, id: "e-张", 跳数: 2, 上限: 2 }))!
    expect(图.节点.length).toBe(2)
    // 第二个名额是 e-账（r-张账 次数 1 排在前面）；装不下端点的边**不能画**，
    // 否则图里会留一条悬空边（§9.1）。
    expect(图.节点.map((点) => 点.id)).toEqual(["e-张", "e-账"])
    expect(图.边.map((边) => 边.id)).toEqual(["r-张账"])
    // 图里只画了 1 条边 ⇒ 关联数只能按图算（库内 e-张 的度数还更大）。
    expect(图.节点.find((点) => 点.id === "e-张")!.关联数).toBe(1)
    // 只有一条缺口（不许「截断」与「没展开第 2 跳」两条近似重复的）。
    expect(图.缺口).toHaveLength(1)
    expect(图.缺口[0]).toContain("第 1 跳只画了前 2 个节点")
    expect(图.缺口[0]).toContain("3 条关联关系")
  })

  test("第 1 跳恰好装满上限且没被截断：缺口说「未展开」，不谎称截断", async () => {
    const 图 = (await 关系图(库(), { projectId: 排序项目, id: "e-满", 跳数: 2, 上限: 3 }))!
    expect(图.节点.map((点) => 点.id).sort()).toEqual(["e-满", "e-甲2", "e-乙2"].sort())
    expect(图.缺口).toEqual(["节点已达上限 3，未展开第 2 跳"])
  })

  test("第 2 跳按边数截断时缺口不空，且带总数", async () => {
    const 图 = (await 关系图(库(), { projectId: "p-二跳", id: "e-根", 跳数: 2, 上限: 50 }))!
    expect(图.节点.length).toBe(50)
    expect(图.边.length).toBe(49)
    expect(图.缺口).toHaveLength(1)
    // 只陈述「候选里还有多少没画」，不声称「画了多少」——`slice` 行数里可能混着
    // 第 1 跳已画过的回边（r-根枝），说「画了前 N 条」会把没画的说成画了。
    // 实得：pre-LIMIT 总数 51 − 剩余 48 = 3 条候选没画。
    expect(图.缺口[0]).toContain("第 2 跳还有 3 条候选关系没有画")
    expect(图.缺口[0]).toContain("节点上限 50")
  })

  test("上限 1：节点只有中心，但缺口必须说清（含 clamp 到 1 的 0 / 负值）", async () => {
    for (const 上限 of [1, 0, -5]) {
      const 一跳 = (await 关系图(库(), { projectId: 项目, id: "e-张", 上限 }))!
      expect(一跳.节点.map((点) => 点.id)).toEqual(["e-张"])
      expect(一跳.缺口.length).toBeGreaterThan(0)
      expect(一跳.缺口.join()).toContain("上限 1")
      const 二跳 = (await 关系图(库(), { projectId: 项目, id: "e-张", 上限, 跳数: 2 }))!
      expect(二跳.节点.map((点) => 点.id)).toEqual(["e-张"])
      expect(二跳.缺口.length).toBeGreaterThan(0)
      expect(二跳.缺口.join()).toContain("上限 1")
    }
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

  test("自环的关联数只计一次", async () => {
    const 图 = (await 关系图(库(), { projectId: 排序项目, id: "e-心" }))!
    expect(图.边.map((边) => 边.id).sort()).toEqual(["r-a", "r-z", "r-自"].sort())
    expect(图.节点.find((点) => 点.id === "e-心")!.关联数).toBe(3)
    expect(图.节点.find((点) => 点.id === "e-甲")!.关联数).toBe(1)
    expect(图.节点.find((点) => 点.id === "e-乙")!.关联数).toBe(1)
  })

  test("节点带细类：中心与邻居都要有；attrs 里明确写的优先于形状", async () => {
    // 中心：号码本身就有细类（否则「中心节点没有细类」会看不出来）
    const 中心图 = (await 关系图(库(), { projectId: 细类项目, id: "e-细号" }))!
    expect(中心图.节点.find((点) => 点.id === "e-细号")!.subtype).toBe("固定电话")
    // 邻居：一条边两端都带细类；判不出的人不硬造一个
    const 图 = (await 关系图(库(), { projectId: 细类项目, id: "e-细心" }))!
    const 取 = (id: string) => 图.节点.find((点) => 点.id === id)!
    expect(取("e-细号").subtype).toBe("固定电话")
    expect(取("e-细卡").subtype).toBe("银行卡")
    expect(取("e-细心").subtype).toBeUndefined()
  })
})
