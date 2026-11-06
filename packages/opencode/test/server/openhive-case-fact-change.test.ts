import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  变更历史,
  操作人快照,
  最近一次可撤销,
  记变更,
} from "../../src/server/openhive/case-fact-change"

/**
 * 留痕 DAO（设计 §9.6）。
 *
 * ⚠️ PGlite 把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的：
 * 本文件自己发的 SQL **文本**必须与 DAO 的 SQL 不同，否则 42P05（同 `openhive-case-materials`）。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

const 甲 = { id: "u-留痕-甲", name: "甲民警", policeNo: "970001" }

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${甲.id}, ${甲.policeNo}, ${甲.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
})

afterAll(async () => {
  await pg?.stop()
})

describe("留痕读写", () => {
  test("写一条再读回来：前后值、原因、操作人都在", async () => {
    await 记变更(库(), {
      projectId: "p-留痕",
      factType: "relation",
      factId: "r-1",
      action: "修正",
      before: { trustState: "自动抽取", amount: 100 },
      after: { trustState: "已修正", amount: 1000 },
      reasonKind: "抽取错",
      reasonText: "金额少了一个零",
      actor: 甲,
    })

    const 全部 = await 变更历史(库(), "p-留痕", "relation", "r-1")
    expect(全部).toHaveLength(1)
    expect(全部[0]?.action).toBe("修正")
    expect(全部[0]?.reasonKind).toBe("抽取错")
    expect(全部[0]?.actorName).toBe("甲民警")
    // jsonb 落到真的对象上——不是 JSON 字符串标量（`::text::jsonb` 那一层的见证）
    expect(全部[0]?.before).toEqual({ trustState: "自动抽取", amount: 100 })
    expect(全部[0]?.after).toEqual({ trustState: "已修正", amount: 1000 })
  })

  test("操作人快照按账号取名字；账号不存在时回落占位，不写空串", async () => {
    expect((await 操作人快照(库(), 甲.id)).name).toBe("甲民警")
    expect((await 操作人快照(库(), "u-查无此人-12345678")).name).toBe("已注销用户（u-查无此人-1）")
  })

  test("最近一次可撤销跳过撤销行；同一条不能被撤销两次", async () => {
    await 记变更(库(), {
      projectId: "p-留痕-2",
      factType: "entity",
      factId: "e-1",
      action: "确认",
      before: { trustState: "自动抽取" },
      after: { trustState: "已确认" },
      actor: 甲,
    })
    const 确认条 = (await 变更历史(库(), "p-留痕-2", "entity", "e-1"))[0]
    expect(确认条).toBeDefined()

    await 记变更(库(), {
      projectId: "p-留痕-2",
      factType: "entity",
      factId: "e-1",
      action: "撤销",
      before: { trustState: "已确认" },
      after: { trustState: "自动抽取", 被撤销的留痕: 确认条?.id },
      actor: 甲,
    })

    expect(await 最近一次可撤销(库(), "p-留痕-2", "entity", "e-1")).toBeUndefined()
  })

  test("项目隔离：别的项目读不到", async () => {
    expect(await 变更历史(库(), "p-别的项目", "relation", "r-1")).toEqual([])
  })

  test("jsonb 标量原样读回：不做二次解析（\"123\" 不变数字、\"null\" 不变 null）", async () => {
    const 写 = async (id: string, action: "修正", before: unknown, after: unknown) => {
      await 记变更(库(), {
        projectId: "p-标量",
        factType: "entity",
        factId: id,
        action,
        before,
        after,
        reasonKind: "识别错",
        reasonText: "材料本身有歧义",
        actor: 甲,
      })
    }
    await 写("e-标量-文本", "修正", "旧值", "新值")
    await 写("e-标量-数字形", "修正", "123", "456")
    await 写("e-标量-null形", "修正", "null", "null")
    await 写("e-标量-布尔形", "修正", "true", "false")

    const 读 = async (id: string) => (await 变更历史(库(), "p-标量", "entity", id))[0]

    expect((await 读("e-标量-文本"))?.before).toBe("旧值")
    expect((await 读("e-标量-文本"))?.after).toBe("新值")
    expect((await 读("e-标量-数字形"))?.before).toBe("123")
    expect((await 读("e-标量-数字形"))?.after).toBe("456")
    expect((await 读("e-标量-null形"))?.before).toBe("null")
    expect((await 读("e-标量-布尔形"))?.after).toBe("false")
  })
})

describe("落库形状（变异 M1 的承重处）", () => {
  test("before / after 是 jsonb 对象，不是 JSON 字符串标量", async () => {
    await 记变更(库(), {
      projectId: "p-形状",
      factType: "event",
      factId: "ev-形状",
      action: "确认",
      before: { trustState: "自动抽取" },
      after: { trustState: "已确认" },
      actor: 甲,
    })
    // 裸 SQL 读**落库类型**：读口不做二次解析，DAO 级断言看不见字符串标量这个差别。
    // 这条只有 `::text::jsonb` 能满足——变异成 `::jsonb` 后 `jsonb_typeof` = 'string'。
    const 行 = rowsOf(
      await 库().execute(sql`
        select jsonb_typeof(before) as 前型, jsonb_typeof(after) as 后型,
               before ->> 'trustState' as 前态
          from auth.case_fact_change
         where project_id = 'p-形状' and fact_id = 'ev-形状'
      `),
    )[0]
    expect(String(行?.前型)).toBe("object")
    expect(String(行?.后型)).toBe("object")
    // jsonb 算子是真实消费者：落成字符串标量时 `->>` 取不到字段（得到 null）。
    expect(String(行?.前态)).toBe("自动抽取")
  })
})

describe("留痕的确定顺序", () => {
  test("同一秒内连写 20 条，历史顺序等于写入顺序", async () => {
    const 期望: ("确认" | "存疑")[] = []
    for (let i = 0; i < 20; i++) {
      const action = i % 2 === 0 ? "确认" : "存疑"
      期望.push(action)
      await 记变更(库(), {
        projectId: "p-顺序",
        factType: "entity",
        factId: "e-顺序",
        action,
        actor: 甲,
      })
    }
    const 历史 = await 变更历史(库(), "p-顺序", "entity", "e-顺序")
    // 按 id（随机 UUID）排序时，20 条的随机排列几乎不可能恰好等于写入序
    // （复审实测 20 组「确认→修正」有 11 组排反）⇒ 这条能真的钉住排序依据。
    expect(历史.map((条) => 条.action)).toEqual(期望)
  })
})

describe("留痕的形状", () => {
  test("同一个 fact_id 在不同 project 下互不串", async () => {
    await 记变更(库(), {
      projectId: "p-甲",
      factType: "event",
      factId: "共享 id",
      action: "存疑",
      actor: 甲,
    })
    await 记变更(库(), {
      projectId: "p-乙",
      factType: "event",
      factId: "共享 id",
      action: "确认",
      actor: 甲,
    })
    const n = rowsOf(
      await 库().execute(sql`
        select count(*)::int as 条数 from auth.case_fact_change where fact_id = '共享 id'
      `),
    )
    expect(Number(n[0]?.条数)).toBe(2)
    expect((await 变更历史(库(), "p-甲", "event", "共享 id"))[0]?.action).toBe("存疑")
  })
})
