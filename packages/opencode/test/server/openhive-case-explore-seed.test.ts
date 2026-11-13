import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { countFactRows, getMaterial, type Queryable } from "../../src/server/openhive/case-store"
import { 种探索数据集, type 探索数据集 } from "../fixtures/explore/dataset"

/**
 * 20 题固定数据集的 seed 用例（计划 T1）。
 *
 * 数据集只经函数级生产出口种下（`enqueueMaterial` → `claimNextJob` → `runJob`，见
 * `../fixtures/explore/dataset.ts`），本文件只做「落成了什么形状」的断言。
 *
 * 起库方式与 `openhive-case-ingest.test.ts` 文件头一致：`startProductionDb()` 撑 PGlite，
 * 再自建一份 `PG_POOL_MAX=1` 的客户端（事务从池里独占连接，夹具自带客户端的 env 固定）。
 * 断言读用 `countFactRows` 与手写 count SQL；手写 SQL 的文本刻意与 DAO 不同（`#005-10` 同族）。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: 探索数据集
const 文件 = new Map<string, Uint8Array>()

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种探索数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

async function 材料(id: string, projectId: string = 数据集.projectId) {
  const row = await getMaterial(db(), projectId, id)
  if (!row) throw new Error(`材料不存在：${id}`)
  return row
}

async function 数一行(db: Queryable, query: ReturnType<typeof sql>): Promise<number> {
  const rows = rowsOf(await db.execute(query))
  return Number(rows[0]?.n ?? 0)
}

async function 数实体(db: Queryable, projectId: string): Promise<number> {
  return 数一行(
    db,
    sql`
      select count(*)::int as n from auth.case_entity where project_id = ${projectId}
    `,
  )
}

async function 数关系(db: Queryable, projectId: string): Promise<number> {
  return 数一行(
    db,
    sql`
      select count(*)::int as n from auth.case_relation where project_id = ${projectId}
    `,
  )
}

async function 数事件(db: Queryable, projectId: string): Promise<number> {
  return 数一行(
    db,
    sql`
      select count(*)::int as n from auth.case_event where project_id = ${projectId}
    `,
  )
}

/** 按列分组计数；SQL 的文本同样手写、与 DAO 不同（`#005-10` 同族）。 */
async function 数分组(
  db: Queryable,
  query: ReturnType<typeof sql>,
): Promise<Record<string, number>> {
  const rows = rowsOf(await db.execute(query))
  const 结果: Record<string, number> = {}
  for (const row of rows) 结果[String(row.k)] = Number(row.n)
  return 结果
}

/** 明细行按**材料 kind** 分组（`case_fact_row` 本身没有 kind 列，要 join 材料表）。 */
async function 数明细行按材料类型(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select m.kind as k, count(*)::int as n
        from auth.case_fact_row r
        join auth.case_material m
          on m.project_id = r.project_id and m.id = r.material_id
       where r.project_id = ${projectId}
       group by m.kind
    `,
  )
}

/** 明细行按**币种**分组；只数资金材料（话单行没有币种列，会以默认 CNY 混进分母）。 */
async function 数资金明细行按币种(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select r.currency as k, count(*)::int as n
        from auth.case_fact_row r
        join auth.case_material m
          on m.project_id = r.project_id and m.id = r.material_id
       where r.project_id = ${projectId} and m.kind = '资金'
       group by r.currency
    `,
  )
}

async function 数实体按类型(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select type as k, count(*)::int as n
        from auth.case_entity where project_id = ${projectId}
       group by type
    `,
  )
}

async function 数关系按类型(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select type as k, count(*)::int as n
        from auth.case_relation where project_id = ${projectId}
       group by type
    `,
  )
}

/** 关系按来源分组：`human` = 笔录抽取，`data` = 表格翻译聚合（01 §4.0.2）。 */
async function 数关系按来源(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select source_kind as k, count(*)::int as n
        from auth.case_relation where project_id = ${projectId}
       group by source_kind
    `,
  )
}

async function 数事件按类型(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select type as k, count(*)::int as n
        from auth.case_event where project_id = ${projectId}
       group by type
    `,
  )
}

/** 只数资金交易卡（见面等其他事件没有币种语义，混进来会污染分母）。 */
async function 数资金事件按币种(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select currency as k, count(*)::int as n
        from auth.case_event
       where project_id = ${projectId} and type = '资金交易'
       group by currency
    `,
  )
}

/** 口述转账按金额分组：缺失或重复都会让计数偏离每档 1 笔。 */
async function 数口述转账按金额(db: Queryable, projectId: string): Promise<Record<string, number>> {
  return 数分组(
    db,
    sql`
      select amount::text as k, count(*)::int as n
        from auth.case_relation
       where project_id = ${projectId} and type = '转账' and source_kind = 'human'
       group by amount
    `,
  )
}

/**
 * 表格翻译聚合出的转账关系（`source_kind='data'`）逐条取原值。
 *
 * 与关系总数/分组互补：分组只能证明「多了一条」，这里钉住多出的那条**是谁到谁、
 * 几笔、金额多少**（Q16：`times` 计全币种、`amount` 只计 CNY）。
 */
async function 数据转账们(db: Queryable, projectId: string) {
  const rows = rowsOf(
    await db.execute(sql`
      select 起.canonical_value as 从, 终.canonical_value as 到,
             r.times as 次数, r.times_cny as 人民币次数, r.amount::text as 金额,
             r.first_at as 首次, r.last_at as 末次
        from auth.case_relation r
        join auth.case_entity 起
          on 起.project_id = r.project_id and 起.id = r.from_id
        join auth.case_entity 终
          on 终.project_id = r.project_id and 终.id = r.to_id
       where r.project_id = ${projectId} and r.source_kind = 'data'
       order by r.first_at, r.id
    `),
  )
  return rows.map((row) => ({
    从: String(row.从),
    到: String(row.到),
    次数: Number(row.次数),
    人民币次数: Number(row.人民币次数),
    金额: String(row.金额),
    首次: Number(row.首次),
    末次: Number(row.末次),
  }))
}

/**
 * 资金交易卡 ↔ 流水行的一一对照（01 §4.0.2「一行 → 一张卡」）。
 *
 * 按卡片聚合出付款方/收款方，再与流水行逐列比对；同一行落两张卡（重复）或漏卡
 * 都会让返回的条目数或某条的值对不上。
 */
async function 资金事件按流水对照(db: Queryable, projectId: string) {
  const rows = rowsOf(
    await db.execute(sql`
      select e.amount::text as 金额, e.currency as 币种, e.occurred_at as 时刻,
             max(case when p.role = '付款方' then en.canonical_value end) as 付款方,
             max(case when p.role = '收款方' then en.canonical_value end) as 收款方
        from auth.case_event e
        join auth.case_event_participant p
          on p.project_id = e.project_id and p.event_id = e.id
        join auth.case_entity en
          on en.project_id = p.project_id and en.id = p.entity_id
       where e.project_id = ${projectId} and e.type = '资金交易'
       group by e.id, e.amount, e.currency, e.occurred_at
       order by e.occurred_at
    `),
  )
  return rows.map((row) => ({
    金额: String(row.金额),
    币种: String(row.币种),
    时刻: Number(row.时刻),
    付款方: String(row.付款方),
    收款方: String(row.收款方),
  }))
}

/** 副项目里「排队中」的材料数；DAO 的读口是 `getMaterial`（按 id），这条只按状态数。 */
async function 数排队中(db: Queryable, projectId: string): Promise<number> {
  return 数一行(
    db,
    sql`
      select count(*)::int as n
        from auth.case_material
       where project_id = ${projectId} and parse_status = '排队中'
    `,
  )
}

describe("探索数据集 seed（09 §13.1）", () => {
  test("四份材料的解析状态与类型", async () => {
    const 流水 = await 材料(数据集.材料.流水)
    const 话单 = await 材料(数据集.材料.话单)
    const 笔录 = await 材料(数据集.材料.笔录)
    // R-W 后这份排队中的流水在副项目（主项目刻意没有未解析材料）。
    const 待解析 = await 材料(数据集.材料.待解析, 数据集.待解析项目)

    expect(流水.parseStatus).toBe("已解析")
    expect(流水.kind).toBe("资金")
    expect(话单.kind).toBe("话单")
    expect(笔录.parseStatus).toBe("已解析")
    expect(待解析.parseStatus).toBe("排队中")
  })

  test("明细行：流水 7 行 + 话单 3 行 + 待解析 0 行", async () => {
    expect(await countFactRows(db(), 数据集.projectId)).toBe(10)
    // 总数对不等于组成对：按材料 kind 分组，别让用例名比断言强。
    expect(await 数明细行按材料类型(db(), 数据集.projectId)).toEqual({ 资金: 7, 话单: 3 })
  })

  test("资金明细币种：流水 7 行里 CNY 5、USD 2（09 §4.5 第 2 条）", async () => {
    expect(await 数资金明细行按币种(db(), 数据集.projectId)).toEqual({ CNY: 5, USD: 2 })
  })

  test("迁移可重复执行：再跑一次 migrate() 不抛错、无待应用版本", async () => {
    // 迁移运行器按记账表跳过已应用版本；这条钉住「部署跑两次不会炸」。
    expect(await migrate(db())).toEqual([])
  })

  test("实体：5 人 + 6 账户 + 1 号码 = 12", async () => {
    expect(await 数实体(db(), 数据集.projectId)).toBe(12)
    expect(await 数实体按类型(db(), 数据集.projectId)).toEqual({ 人: 5, 账户: 6, 号码: 1 })
  })

  test("关系：5 持有 + 5 笔口述转账 + 1 实名登记 + 1 条表格转账聚合 = 12（P2 资金翻译）", async () => {
    expect(await 数关系(db(), 数据集.projectId)).toBe(12)
    // 笔录抽取仍产 5 持有 / 5 转账 / 1 实名登记；P2 起表格也产卡片并聚合转账
    // （01 §4.0.2），多出的那条来自流水，`source_kind='data'`。
    expect(await 数关系按类型(db(), 数据集.projectId)).toEqual({ 持有: 5, 转账: 6, 实名登记: 1 })
    expect(await 数关系按来源(db(), 数据集.projectId)).toEqual({ human: 11, data: 1 })
    // 口述转账逐笔金额：同金额出现两次（重复入库）或漏一笔都会偏离下面每档 1。
    expect(await 数口述转账按金额(db(), 数据集.projectId)).toEqual({
      "8000.00": 1,
      "20000.00": 1,
      "30000.00": 1,
      "50000.00": 1,
      "100000.00": 1,
    })
    // 表格聚合的原值抽样：A 账户 → 赵六账户 F 的两笔美元流水。
    // Q16 口径（`#013-02`）：`times` 计全币种、`amount` 只计 CNY ⇒ 2 笔 / 人民币 0 笔 / 0.00。
    expect(await 数据转账们(db(), 数据集.projectId)).toEqual([
      {
        从: 数据集.账号.A,
        到: 数据集.账号.F,
        次数: 2,
        人民币次数: 0,
        金额: "0.00",
        首次: 1771988400,
        末次: 1772078400,
      },
    ])
  })

  test("事件：7 条资金交易（与 7 行流水一一对应）+ 1 条见面 = 8（P2 资金翻译）", async () => {
    expect(await 数事件(db(), 数据集.projectId)).toBe(8)
    expect(await 数事件按类型(db(), 数据集.projectId)).toEqual({ 资金交易: 7, 见面: 1 })
    expect(await 数资金事件按币种(db(), 数据集.projectId)).toEqual({ CNY: 5, USD: 2 })
    // 一行流水一张卡（01 §4.0.2）：金额 / 币种 / 时刻 / 收付双方逐条对得上；
    // 同一行落两张卡（重复）或漏一张都会让这条红。
    expect(await 资金事件按流水对照(db(), 数据集.projectId)).toEqual([
      { 金额: "50000.00", 币种: "CNY", 时刻: 1770688800, 付款方: 数据集.账号.A, 收款方: 数据集.账号.B },
      { 金额: "20000.00", 币种: "CNY", 时刻: 1770771600, 付款方: 数据集.账号.B, 收款方: 数据集.账号.A },
      { 金额: "30000.00", 币种: "CNY", 时刻: 1770877800, 付款方: 数据集.账号.A, 收款方: 数据集.账号.E },
      { 金额: "100000.00", 币种: "CNY", 时刻: 1771114500, 付款方: 数据集.账号.A, 收款方: 数据集.账号.B },
      { 金额: "8000.00", 币种: "CNY", 时刻: 1771577100, 付款方: 数据集.账号.B, 收款方: 数据集.账号.A },
      { 金额: "300.00", 币种: "USD", 时刻: 1771988400, 付款方: 数据集.账号.A, 收款方: 数据集.账号.F },
      { 金额: "200.00", 币种: "USD", 时刻: 1772078400, 付款方: 数据集.账号.A, 收款方: 数据集.账号.F },
    ])
  })

  test("副项目：一份未解析材料、零明细行、零实体", async () => {
    expect(await 数排队中(db(), 数据集.待解析项目)).toBe(1)
    expect(await countFactRows(db(), 数据集.待解析项目)).toBe(0)
    expect(await 数实体(db(), 数据集.待解析项目)).toBe(0)
  })

  // —— T7a D5：第三项目的**形状**（回放用例 D4/D5 依赖它，但它自己没被钉住）——
  // P2 资金翻译（01 §3.8.1「账户实体必须从第一份流水就建」/ §4.0.2，`d2abbe609b`）起，
  // 表格也建账户实体、聚合成转账关系：H / I 两个账号从明细行落成账户实体，1 行流水
  // 聚成 1 条 data 转账（30000 CNY）。旧注释「H 只是明细行里的账号字符串」是 P1 的事实，
  // P2 起已被翻译层取代。
  test("第三项目 p-explore-partial：已解析 1 / 排队中 1 / 明细行 1 / 账户实体 2 / 转账关系 1（P2 资金翻译）", async () => {
    const 材料们 = rowsOf(
      await db().execute(sql`
        select file_name as 名, kind as 类, parse_status as 态
          from auth.case_material
         where project_id = ${数据集.部分解析项目}
         order by file_name
      `),
    )
    expect(材料们).toEqual([
      { 名: "待解析流水.xlsx", 类: "其他", 态: "排队中" },
      { 名: "部分流水.xlsx", 类: "资金", 态: "已解析" },
    ])
    expect(await 数排队中(db(), 数据集.部分解析项目)).toBe(1)
    // 已解析那份的 1 行明细（2026-03-01，H → I，30000 CNY）。
    expect(await countFactRows(db(), 数据集.部分解析项目)).toBe(1)
    // 2 个账户实体就是明细行里的 H / I（不是别的、也不是重复建）。
    expect(await 数实体(db(), 数据集.部分解析项目)).toBe(2)
    expect(await 数实体按类型(db(), 数据集.部分解析项目)).toEqual({ 账户: 2 })
    const 实体值们 = rowsOf(
      await db().execute(sql`
        select canonical_value from auth.case_entity
         where project_id = ${数据集.部分解析项目}
         order by canonical_value
      `),
    ).map((row) => String(row.canonical_value))
    expect(实体值们).toEqual([数据集.账号.H, 数据集.账号.I])
    // 1 行明细聚成 1 条转账，原值逐项钉住（H → I，1 笔人民币 30000）。
    expect(await 数关系(db(), 数据集.部分解析项目)).toBe(1)
    expect(await 数关系按类型(db(), 数据集.部分解析项目)).toEqual({ 转账: 1 })
    expect(await 数据转账们(db(), 数据集.部分解析项目)).toEqual([
      {
        从: 数据集.账号.H,
        到: 数据集.账号.I,
        次数: 1,
        人民币次数: 1,
        金额: "30000.00",
        首次: 1772326800,
        末次: 1772326800,
      },
    ])
  })
})
