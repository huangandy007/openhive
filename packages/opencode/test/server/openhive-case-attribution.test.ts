import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  事件归属条件,
  关系归属条件,
  账户归属集,
  读归属值,
} from "../../src/server/openhive/case-party"
import { 实体档案 } from "../../src/server/openhive/case-entity-list"
import { 关系图 } from "../../src/server/openhive/case-graph"
import { 种P3数据集, type P3数据集 } from "../fixtures/p3/dataset"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
const 文件 = new Map<string, Uint8Array>()

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种P3数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

async function 实体id(值: string): Promise<string> {
  const 行们 = rowsOf(
    await db().execute(sql`
      select id from auth.case_entity where project_id = ${数据集.projectId} and canonical_value = ${值}
    `),
  )
  const id = 行们[0]?.id
  if (typeof id !== "string") throw new Error(`找不到实体：${值}`)
  return id
}

async function 数(语句: ReturnType<typeof sql>): Promise<number> {
  return Number(rowsOf(await db().execute(语句))[0]?.数 ?? 0)
}

describe("基 1：事件归属", () => {
  test("按账户查：流水 3 + 笔录 1 = 4", async () => {
    const B = await 实体id(数据集.账号.B)
    const 条数 = await 数(sql`
      select count(*)::int as 数 from auth.case_event
       where project_id = ${数据集.projectId} and ${事件归属条件(数据集.projectId, B)}
    `)
    expect(条数).toBe(4)
  })

  test("按人查：其唯一户名账户的 3 个流水事件 + 自己参与的笔录事件", async () => {
    const 李四 = await 实体id("李四")
    const 条数 = await 数(sql`
      select count(*)::int as 数 from auth.case_event
       where project_id = ${数据集.projectId} and ${事件归属条件(数据集.projectId, 李四)}
    `)
    expect(条数).toBe(4)
  })

  test("文本为空时只能靠参与者表命中：账户本人 + 人的正向代表", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    try {
      // 裸插一行**文本参与者为空**的事件 + 一行参与者表（entity_id = 账户 B）。
      // 文本回退对该事件恒假，命中只可能来自参与者表那一支。
      await db().execute(sql`
        insert into auth.case_event (id, project_id, type, participants, created_at)
        values ('e-基1参与者表', ${数据集.projectId}, '见面', '{}'::text[], 1760000000)
      `)
      await db().execute(sql`
        insert into auth.case_event_participant (id, project_id, event_id, entity_id, role, mention_text, ordinal)
        values ('p-基1参与者表', ${数据集.projectId}, 'e-基1参与者表', ${B}, '参与', '账户', 0)
      `)
      const 查 = (实体id: string) =>
        数(sql`
          select count(*)::int as 数 from auth.case_event
           where project_id = ${数据集.projectId} and id = 'e-基1参与者表'
             and ${事件归属条件(数据集.projectId, 实体id)}
        `)
      // 账户本人：参与者表里 entity_id = B，命中。
      expect(await 查(B)).toBe(1)
      // 人的正向代表：参与者表里 entity_id = B，靠 归属实体集(李四) 含 B 命中。
      // 这一条同时钉住「参与者表那一支必须用归属实体集，而不是 = 实体id」。
      expect(await 查(李四)).toBe(1)
    } finally {
      await db().execute(sql`delete from auth.case_event_participant where project_id = ${数据集.projectId} and event_id = 'e-基1参与者表'`)
      await db().execute(sql`delete from auth.case_event where project_id = ${数据集.projectId} and id = 'e-基1参与者表'`)
    }
  })
})

describe("基 2：账户归属", () => {
  test("归属集 = 账户自己 ∪ 唯一户名对齐到它的人", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    const 行们 = rowsOf(
      await db().execute(sql`
        select id from ${账户归属集(数据集.projectId, [B])} 集 order by id asc
      `),
    )
    expect(行们.map((行) => String(行.id)).sort()).toEqual([B, 李四].sort())
  })

  test("恰好一端在集合里才算归属：A→李四 归属 B", async () => {
    const B = await 实体id(数据集.账号.B)
    const 条数 = await 数(sql`
      select count(*)::int as 数 from auth.case_relation
       where project_id = ${数据集.projectId}
         and ${关系归属条件(数据集.projectId, [B], sql`from_id`, sql`to_id`)}
    `)
    // A→B 机器、A→B 人工、A→李四 人工、B→C 机器（纯外币也先算关系，人民币笔数由读端口过滤）
    expect(条数).toBe(4)
  })

  test("两端都落在集合里 ⇒ 不归属（B 与李四之间的往来是账户内部）", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    try {
      // 造一条 李四 → B：两端都在归属集里，XOR 必须把它排除。
      await db().execute(sql`
        insert into auth.case_relation (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
        values ('r-基2自环', ${数据集.projectId}, ${李四}, ${B}, '转账', '1000.00', 'human', '自动抽取', 1760000000)
      `)
      const 条数 = await 数(sql`
        select count(*)::int as 数 from auth.case_relation
         where project_id = ${数据集.projectId} and id = 'r-基2自环'
           and ${关系归属条件(数据集.projectId, [B], sql`from_id`, sql`to_id`)}
      `)
      expect(条数).toBe(0)
    } finally {
      // 断言失败也必须清掉裸插行，否则后续用例看到脏数据。
      await db().execute(sql`delete from auth.case_relation where project_id = ${数据集.projectId} and id = 'r-基2自环'`)
    }
  })

  test("值集覆盖「自己 + 正向代表 + 反向对齐者」", async () => {
    const B = await 实体id(数据集.账号.B)
    const 值们 = (await 读归属值(db(), 数据集.projectId, B)).sort()
    expect(值们).toEqual([数据集.账号.B, "李四"].sort())
  })
})

describe("实体档案：与汇总同口径", () => {
  test("账户 B：关系 4（数据 2 / 人 2）、对方 2、事件 4", async () => {
    const B = await 实体id(数据集.账号.B)
    const 档案 = await 实体档案(db(), { projectId: 数据集.projectId, id: B })
    expect(档案).toBeDefined()
    expect(档案?.关系总数).toBe(4)
    expect(档案?.关系数据总数).toBe(2)
    expect(档案?.关系人总数).toBe(2)
    expect(档案?.对方数).toBe(2)
    expect(档案?.事件总数).toBe(4)
  })

  test("账户 A：关系 4、对方 3（B 两笔算一个、C、李四）、事件 3", async () => {
    const A = await 实体id(数据集.账号.A)
    const 档案 = await 实体档案(db(), { projectId: 数据集.projectId, id: A })
    expect(档案?.关系总数).toBe(4)
    expect(档案?.对方数).toBe(3)
    expect(档案?.事件总数).toBe(3)
  })
})

describe("关系图：账户中心的端点投影", () => {
  test("B 为中心：A 与 B 之间 3 条、35000；A→李四 经对齐归并进这条边并进缺口", async () => {
    const B = await 实体id(数据集.账号.B)
    const A = await 实体id(数据集.账号.A)
    const 图 = await 关系图(db(), { projectId: 数据集.projectId, id: B, 跳数: 1 })
    expect(图).toBeDefined()
    expect(图?.节点).toHaveLength(3) // B 中心 + A + C
    const 边 = 图?.边.find(
      (条) =>
        (条.from === B && 条.to === A) || (条.from === A && 条.to === B),
    )
    expect(边).toBeDefined()
    expect(边?.times).toBe(3)
    expect(边?.amount).toBe("35000.00")
    expect(边?.明细数).toBe(3)
    expect(图?.缺口.join()).toContain("1 条关系经户名对齐归属本账户")
  })
})

describe("关系图：账户中心 2 跳的端点归一化", () => {
  test("B 为中心 2 跳：归一化保留，但以中心为端点的边不在第 2 跳补画", async () => {
    const B = await 实体id(数据集.账号.B)
    const A = await 实体id(数据集.账号.A)
    const C = await 实体id(数据集.账号.C)
    const 李四 = await 实体id("李四")
    const 图 = await 关系图(db(), { projectId: 数据集.projectId, id: B, 跳数: 2 })
    expect(图).toBeDefined()
    // 图上不新增节点：归一化掉的「李四」不能作为 2 跳节点回来。
    expect(图?.节点.map((点) => 点.id).sort()).toEqual([B, A, C].sort())
    // 同一关系不能既并入 1 跳的 A—B，又作为原始 2 跳边单独画出（金额跨边重复）。
    expect(图?.边.map((条) => 条.id).sort()).toEqual(
      [`rel|${A}|${B}|转账`, `rel|${B}|${C}|转账`, `rel|${A}|${C}|转账`].sort(),
    )
    const AB = 图?.边.find((条) => 条.from === A && 条.to === B)
    expect(AB?.times).toBe(3)
    expect(AB?.amount).toBe("35000.00")
    expect(AB?.明细数).toBe(3)
    expect(图?.边.some((条) => 条.from === 李四 || 条.to === 李四)).toBe(false)
    // 一跳点仍是 1 跳（中心端点边不在第 2 跳被标成 2 跳）。
    expect(图?.节点.find((点) => 点.id === A)?.跳数).toBe(1)
    expect(图?.节点.find((点) => 点.id === C)?.跳数).toBe(1)
    expect(图?.缺口).toEqual(["1 条关系经户名对齐归属本账户（图上的端点已归并到本账户）"])
  })
})

describe("关系图：投影缺口的类型 / 强度 / 上限口径", () => {
  test("类型筛选下缺口只数同类型的对齐关系（通话类没进图就不该说已归并）", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    const 周八 = await 实体id("周八")
    try {
      await db().execute(sql`
        insert into auth.case_relation (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
        values ('r-修1类型', ${数据集.projectId}, ${李四}, ${周八}, '通话', null, 'human', '自动抽取', 1760000000)
      `)
      const 图 = await 关系图(db(), { projectId: 数据集.projectId, id: B, 跳数: 1, 类型: ["转账"] })
      // 投影进来的只有 A→李四（转账）；李四→周八 是通话，被类型条件挡在图外。
      expect(图?.缺口.join()).toContain("1 条关系经户名对齐归属本账户")
    } finally {
      await db().execute(sql`delete from auth.case_relation where project_id = ${数据集.projectId} and id = 'r-修1类型'`)
    }
  })

  test("强度筛选下缺口不与强度缺口自相矛盾（没达标的关系不算已归并）", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    const 周八 = await 实体id("周八")
    try {
      await db().execute(sql`
        insert into auth.case_relation (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
        values ('r-修1强度', ${数据集.projectId}, ${李四}, ${周八}, '通话', null, 'human', '自动抽取', 1760000000)
      `)
      const 图 = await 关系图(db(), { projectId: 数据集.projectId, id: B, 跳数: 1, 强度: "强" })
      // 强档：A→B 达标（35000）；B→C（金额 0）与 李四→周八（通话、1 次）都不达标。
      expect(图?.缺口.join()).toContain("1 条关系经户名对齐归属本账户")
      expect(图?.强度缺口).toEqual({ 未显示: 2, 总数: 3 })
    } finally {
      await db().execute(sql`delete from auth.case_relation where project_id = ${数据集.projectId} and id = 'r-修1强度'`)
    }
  })

  test("上限 1 时一条边都没画，缺口不许宣称已归并", async () => {
    const B = await 实体id(数据集.账号.B)
    const 图 = await 关系图(db(), { projectId: 数据集.projectId, id: B, 上限: 1 })
    expect(图?.节点.map((点) => 点.id)).toEqual([B])
    expect(图?.缺口).toEqual(["节点已达上限 1，第 1 跳的关联关系未画"])
  })

  test("两端都在归属集（李四→B）不画成中心自环，也不计入「经对齐」条数", async () => {
    const B = await 实体id(数据集.账号.B)
    const 李四 = await 实体id("李四")
    try {
      await db().execute(sql`
        insert into auth.case_relation (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
        values ('r-修1内部', ${数据集.projectId}, ${李四}, ${B}, '转账', '1000.00', 'human', '自动抽取', 1760000000)
      `)
      const 图 = await 关系图(db(), { projectId: 数据集.projectId, id: B, 跳数: 1 })
      expect(图?.边.filter((条) => 条.from === B && 条.to === B)).toEqual([])
      // 账户内部往来是「不画、不计数」；经对齐仍只有 A→李四 那 1 条。
      expect(图?.缺口.join()).toContain("1 条关系经户名对齐归属本账户")
    } finally {
      await db().execute(sql`delete from auth.case_relation where project_id = ${数据集.projectId} and id = 'r-修1内部'`)
    }
  })

  test("人中心不套投影：原始自环照旧画出来", async () => {
    const 李四 = await 实体id("李四")
    const A = await 实体id(数据集.账号.A)
    try {
      // 人的自环：投影路径会把它压成 `中心 → 中心` 并排掉；人中心必须走默认路径。
      await db().execute(sql`
        insert into auth.case_relation (id, project_id, from_id, to_id, type, amount, source_kind, trust_state, created_at)
        values ('r-修1人自环', ${数据集.projectId}, ${李四}, ${李四}, '转账', '1000.00', 'human', '自动抽取', 1760000000)
      `)
      const 图 = await 关系图(db(), { projectId: 数据集.projectId, id: 李四, 跳数: 1 })
      expect(图?.边.find((条) => 条.from === 李四 && 条.to === 李四)).toBeDefined()
      expect(图?.边.find((条) => 条.from === A && 条.to === 李四)).toBeDefined()
      expect(图?.缺口.join()).not.toContain("经户名对齐")
    } finally {
      await db().execute(sql`delete from auth.case_relation where project_id = ${数据集.projectId} and id = 'r-修1人自环'`)
    }
  })
})
