import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 重建关系, 写入翻译结果, 清本材料翻译 } from "../../src/server/openhive/case-translate-store"
import { 确保内置模板 } from "../../src/server/openhive/case-card-template"
import { 翻译资金 } from "../../src/server/openhive/case-translate"
import { 资金交易 } from "../../src/server/openhive/case-event-types"
import { insertEvent, insertParticipants, upsertEntity } from "../../src/server/openhive/case-fact-store"
import type { FactRowInput } from "../../src/server/openhive/case-store"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  await pg?.stop()
})
function db() {
  if (!pg) throw new Error("真库没起来")
  return pg.db
}

const 项目 = "prj-rel"
const 甲 = "6217001234567896514"
const 乙 = "6222021234567890123"
const 丙 = "6222000000000000009"

/**
 * 每个用例自带数据：本文件的用例都落在同一个 `项目` 下，而关系是**全项目聚合**的。
 * 不隔离的话，前一条用例的卡片会混进后一条的 `times/amount`（简报原夹具就踩了这一条：
 * 「外币」用例期望 6200，可上一条已经往同一对里又加了 5000）。
 */
beforeEach(async () => {
  await db().execute(sql`delete from auth.case_citation where project_id = ${项目}`)
  await db().execute(sql`delete from auth.case_event_participant where project_id = ${项目}`)
  await db().execute(sql`delete from auth.case_event where project_id = ${项目}`)
  await db().execute(sql`delete from auth.case_relation where project_id = ${项目}`)
  await db().execute(sql`delete from auth.case_entity_alias where project_id = ${项目}`)
  await db().execute(sql`delete from auth.case_entity where project_id = ${项目}`)
})

function 行(materialId: string, rowNo: number, over: Partial<FactRowInput> = {}): FactRowInput {
  return {
    projectId: 项目,
    materialId,
    sheet: "Sheet1",
    rowNo,
    startedAt: 1731117303 + rowNo,
    startedRaw: "2024-11-09 09:15:03",
    precision: "到秒",
    amount: "5000.00",
    direction: "付",
    counterparty: 乙,
    ownerAccount: 甲,
    currency: "CNY",
    ...over,
  }
}

async function 写(materialId: string, rows: FactRowInput[]) {
  const templateId = await 确保内置模板(db(), 项目)
  return 写入翻译结果(db(), {
    projectId: 项目,
    materialId,
    templateId,
    翻译: 翻译资金({ projectId: 项目, materialId, rows }),
  })
}

/** `case_relation.from_id/to_id` 存的是**实体 id**（`case_entity.id` 的 hash），不是账号。 */
async function 实体id(账号: string): Promise<string> {
  const [row] = rowsOf(
    await db().execute(sql`
      select id from auth.case_entity
       where project_id = ${项目} and type = '账户' and canonical_value = ${账号}
    `),
  )
  if (typeof row?.id !== "string") throw new Error(`账户实体不存在：${账号}`)
  return row.id
}

/** 只取这一对（方向明确）的转账关系，避免被同项目的其它对干扰。 */
async function 转账关系(from账号: string, to账号: string) {
  return rowsOf(
    await db().execute(sql`
      select id, from_id, to_id, times, amount, first_at, last_at, precision, trust_state, source_kind
        from auth.case_relation
       where project_id = ${项目} and type = '转账'
         and from_id = ${await 实体id(from账号)} and to_id = ${await 实体id(to账号)}
       order by trust_state, id
    `),
  )
}

/** 测试 1/2 的公共前置：两份材料落在同一对账户上。 */
async function 甲乙两份材料() {
  // 第三行故意用「到分」：关系精度取最粗的，混精度夹具才能钉住 CASE（全「到秒」时
  // 常量也能过）。
  await 写("m1", [行("m1", 2), 行("m1", 3, { amount: "1000.00", precision: "到分" })])
  await 写("m2", [行("m2", 2, { amount: "200.00" })])
}

describe("关系从卡片重建（§4.0.4）", () => {
  test("两份材料同一对 ⇒ 笔数金额相加，不互相覆盖", async () => {
    await 甲乙两份材料()
    const 关系 = await 转账关系(甲, 乙)
    expect(关系).toHaveLength(1)
    expect(Number(关系[0]?.times)).toBe(3)
    expect(String(关系[0]?.amount)).toBe("6200.00")
    // 首末与精度同样来自聚合，不是常量。m1#2/m2#2 的 startedAt 相同。
    expect(Number(关系[0]?.first_at)).toBe(1731117305)
    expect(Number(关系[0]?.last_at)).toBe(1731117306)
    // 取最粗：m1#3 是「到分」。
    expect(String(关系[0]?.precision)).toBe("到分")
  })

  test("重放一份材料 ⇒ 笔数不变（不是 6 也不是 4）", async () => {
    await 甲乙两份材料()
    await 写("m2", [行("m2", 2, { amount: "200.00" })])
    const 关系 = await 转账关系(甲, 乙)
    expect(关系).toHaveLength(1)
    expect(Number(关系[0]?.times)).toBe(3)
    expect(String(关系[0]?.amount)).toBe("6200.00")
  })

  test("双向各自一条：A→B 与 B→A 不合并", async () => {
    // 反向行必须是**乙付给甲**：所有者是乙、对手是甲、方向「付」。
    // 简报原夹具写成「所有者乙、对手甲、方向收」，那仍是甲付给乙，两条落进同一对。
    await 写("m3", [
      行("m3", 2),
      行("m3", 3, { direction: "付", counterparty: 甲, ownerAccount: 乙, amount: "300.00" }),
    ])
    const 正向 = await 转账关系(甲, 乙)
    const 反向 = await 转账关系(乙, 甲)
    expect(正向).toHaveLength(1)
    expect(反向).toHaveLength(1)
    expect(Number(正向[0]?.times)).toBe(1)
    expect(String(正向[0]?.amount)).toBe("5000.00")
    expect(Number(反向[0]?.times)).toBe(1)
    expect(String(反向[0]?.amount)).toBe("300.00")
  })

  test("外币计笔数，但不进人民币合计（Q16 裁定）", async () => {
    await 写("m4", [
      行("m4", 2, { amount: "100.00" }),
      行("m4", 3, { amount: "200.00" }),
      行("m4", 4, { amount: "500.00", currency: "USD" }),
    ])
    const 关系 = await 转账关系(甲, 乙)
    expect(关系).toHaveLength(1)
    // 笔数是定性事实：3 笔往来（含 1 笔美元），不能因币种被抹掉。
    expect(Number(关系[0]?.times)).toBe(3)
    // 金额只累计人民币：100 + 200，USD 500 不进合计。
    expect(String(关系[0]?.amount)).toBe("300.00")
  })

  test("已排除的卡片不参与聚合", async () => {
    await 写("m5", [行("m5", 2)])
    expect(await 转账关系(甲, 乙)).toHaveLength(1)
    await db().execute(sql`
      update auth.case_event set trust_state = '已排除'
       where project_id = ${项目} and id = ${await 卡片idOf("m5", 2)}
    `)
    await 重建关系(db(), 项目, [{ fromId: await 实体id(甲), toId: await 实体id(乙) }])
    // 唯一一张卡片被排除 ⇒ 该对没有可聚合的事实，机器关系必须消失而不是留旧值。
    expect(await 转账关系(甲, 乙)).toHaveLength(0)
  })

  test("已确认的人工关系不被机器行叠加", async () => {
    await 写("m5", [行("m5", 2)])
    const a = await 实体id(甲)
    const b = await 实体id(乙)
    // 人工关系同样按**实体 id** 挂两端（简报原夹具把账号写进 from_id/to_id）。
    await db().execute(sql`
      insert into auth.case_relation
        (id, project_id, from_id, to_id, type, amount, times, source_kind, trust_state, created_at)
      values ('人工-关系', ${项目}, ${a}, ${b}, '转账', 8888.00, 9, 'data', '已确认', 1)
    `)
    await 重建关系(db(), 项目, [{ fromId: a, toId: b }])
    const 关系 = await 转账关系(甲, 乙)
    const 机器 = 关系.filter((r) => r.trust_state === "自动抽取")
    expect(机器).toHaveLength(0)
    expect(关系.filter((r) => r.trust_state === "已确认")).toHaveLength(1)
  })

  test("重写材料后卡片金额变了 ⇒ 关系按卡片重算，不保留旧值", async () => {
    await 写("m6", [行("m6", 2)])
    expect(String((await 转账关系(甲, 乙))[0]?.amount)).toBe("5000.00")
    await 清本材料翻译(db(), 项目, "m6")
    await 写("m6", [行("m6", 2, { amount: "800.00" })])
    const 关系 = await 转账关系(甲, 乙)
    expect(关系).toHaveLength(1)
    expect(String(关系[0]?.amount)).toBe("800.00")
    expect(Number(关系[0]?.times)).toBe(1)
  })

  test("重放换了对手：旧对的机器关系被清掉，新对建立", async () => {
    await 写("m7", [行("m7", 2)])
    expect(await 转账关系(甲, 乙)).toHaveLength(1)
    await 清本材料翻译(db(), 项目, "m7")
    // 同一行换成对手丙：旧对（甲,乙）没有卡片支持，必须消失而不是留一笔「幽灵转账」。
    await 写("m7", [行("m7", 2, { counterparty: 丙 })])
    expect(await 转账关系(甲, 乙)).toHaveLength(0)
    const 新对 = await 转账关系(甲, 丙)
    expect(新对).toHaveLength(1)
    expect(Number(新对[0]?.times)).toBe(1)
    expect(String(新对[0]?.amount)).toBe("5000.00")
  })

  test("同对已有笔录抽出的转账关系 ⇒ 重建不动它", async () => {
    await 写("m9", [行("m9", 2)])
    const a = await 实体id(甲)
    const b = await 实体id(乙)
    // 笔录路径（case-ingest.ts）：type 也是「转账」、trust 也是自动抽取，只是 source_kind='human'
    // 且 id 由材料+原文决定。整片删会误伤它。
    await db().execute(sql`
      insert into auth.case_relation
        (id, project_id, from_id, to_id, type, amount, times, source_kind, trust_state, created_at)
      values ('笔录-转账', ${项目}, ${a}, ${b}, '转账', 999.00, 1, 'human', '自动抽取', 1)
    `)
    await 重建关系(db(), 项目, [{ fromId: a, toId: b }])

    const 关系 = await 转账关系(甲, 乙)
    const 笔录 = 关系.filter((r) => r.id === "笔录-转账")
    expect(笔录).toHaveLength(1)
    expect(String(笔录[0]?.amount)).toBe("999.00")
    expect(String(笔录[0]?.source_kind)).toBe("human")
    // 卡片聚合的机器行同时存在（两条并存，不互相顶替）。
    const 机器 = 关系.filter((r) => r.source_kind === "data")
    expect(机器).toHaveLength(1)
    expect(String(机器[0]?.amount)).toBe("5000.00")
  })

  test("已排除的关系不被机器行顶回来", async () => {
    await 写("m10", [行("m10", 2)])
    const a = await 实体id(甲)
    const b = await 实体id(乙)
    // 路径 1（简报原写法）：机器聚合行被人工改成已排除。id 不变，`on conflict do nothing`
    // 也会挡住重新插入——这条单靠 id 冲突就成立，不足以证明保护集本身。
    await db().execute(sql`
      update auth.case_relation set trust_state = '已排除'
       where project_id = ${项目} and type = '转账'
         and from_id = ${a} and to_id = ${b} and trust_state = '自动抽取'
    `)
    await 重建关系(db(), 项目, [{ fromId: a, toId: b }])
    let 关系 = await 转账关系(甲, 乙)
    expect(关系.filter((r) => r.trust_state === "自动抽取")).toHaveLength(0)
    expect(关系.filter((r) => r.trust_state === "已排除")).toHaveLength(1)

    // 路径 2：人工排除行是**另一条 id**（笔录/人工排除路径就是这样）。没有 `已排除`
    // 保护集时，机器行会被重新插入并与它并存，人工排除等于被撤销。
    await db().execute(sql`
      delete from auth.case_relation
       where project_id = ${项目} and type = '转账'
         and from_id = ${a} and to_id = ${b} and trust_state = '已排除'
    `)
    await db().execute(sql`
      insert into auth.case_relation
        (id, project_id, from_id, to_id, type, amount, times, source_kind, trust_state, created_at)
      values ('人工-排除', ${项目}, ${a}, ${b}, '转账', 777.00, 2, 'human', '已排除', 1)
    `)
    await 重建关系(db(), 项目, [{ fromId: a, toId: b }])
    关系 = await 转账关系(甲, 乙)
    expect(关系.filter((r) => r.trust_state === "自动抽取")).toHaveLength(0)
    expect(关系.filter((r) => r.trust_state === "已排除")).toHaveLength(1)
  })

  test("掩码对手 ⇒ 不建关系行", async () => {
    // 源文件自带掩码（§4.0.5 坑 1）：卡片照出，但不建账户实体 ⇒ 不能有转账关系。
    await 写("m11", [行("m11", 2, { counterparty: "6222****7890" })])
    const 事件 = rowsOf(
      await db().execute(sql`select id from auth.case_event where project_id = ${项目}`),
    )
    expect(事件).toHaveLength(1)
    const 关系 = rowsOf(
      await db().execute(sql`
        select id from auth.case_relation where project_id = ${项目} and type = '转账'
      `),
    )
    expect(关系).toHaveLength(0)
  })

  test("精度全到秒 ⇒ 到秒（显式分支，不能被 NULL 兜底吞掉）", async () => {
    // M5 的修法若写成「把 else '到秒' 直接改 else null」，全到秒的一对也会变成 NULL。
    // 这条与下一条成对：只钉 NULL 侧会漏掉这个回归。
    await 写("m12", [行("m12", 2, { precision: "到秒" })])
    const 关系 = await 转账关系(甲, 乙)
    expect(关系).toHaveLength(1)
    expect(String(关系[0]?.precision)).toBe("到秒")
  })

  test("精度全 NULL ⇒ NULL，不升级为最细（M5）", async () => {
    // 翻译路径的卡片精度恒有值（`翻译资金` 兜底「到日」）；全 NULL 只能来自直接写入的
    // 资金交易事件（文本抽取将来可能复用本类型）。
    const a = await upsertEntity(db(), {
      projectId: 项目, id: "e-精度-甲", type: "账户", canonicalValue: 甲, aliases: [],
    })
    const b = await upsertEntity(db(), {
      projectId: 项目, id: "e-精度-乙", type: "账户", canonicalValue: 乙, aliases: [],
    })
    await insertEvent(db(), {
      projectId: 项目,
      id: "ev-精度-空",
      type: 资金交易,
      occurredAt: 1731117305,
      occurredRaw: "2024-11-09 09:15:03",
      precision: null,
      amount: "100.00",
      participants: [甲, 乙],
      summary: null,
      trustState: "自动抽取",
      currency: "CNY",
    })
    await insertParticipants(db(), [
      {
        projectId: 项目, id: "p-精度-空-付", eventId: "ev-精度-空", entityId: a,
        role: "付款方", mentionText: 甲, citationId: null, ordinal: 0,
      },
      {
        projectId: 项目, id: "p-精度-空-收", eventId: "ev-精度-空", entityId: b,
        role: "收款方", mentionText: 乙, citationId: null, ordinal: 1,
      },
    ])
    await 重建关系(db(), 项目, [{ fromId: a, toId: b }])
    const 关系 = await 转账关系(甲, 乙)
    expect(关系).toHaveLength(1)
    expect(关系[0]?.precision).toBe(null)
  })

  test("清理时旧对上的已确认人工关系不被删", async () => {
    await 写("m8", [行("m8", 2)])
    const a = await 实体id(甲)
    const b = await 实体id(乙)
    await db().execute(sql`
      insert into auth.case_relation
        (id, project_id, from_id, to_id, type, amount, times, source_kind, trust_state, created_at)
      values ('人工-旧对', ${项目}, ${a}, ${b}, '转账', 8888.00, 9, 'data', '已确认', 1)
    `)
    await 清本材料翻译(db(), 项目, "m8")
    const 关系 = await 转账关系(甲, 乙)
    expect(关系.filter((r) => r.trust_state === "自动抽取")).toHaveLength(0)
    expect(关系.filter((r) => r.trust_state === "已确认")).toHaveLength(1)
  })
})

/** 从材料 + 行号反查卡片 id：id 是纯 hash，测试里直接调纯函数算不了（缺 sheet），改查库。 */
async function 卡片idOf(materialId: string, rowNo: number): Promise<string> {
  const [row] = rowsOf(
    await db().execute(sql`
      select id from auth.case_event
       where project_id = ${项目} and created_at > 0
         and id in (select fact_id from auth.case_citation
                     where project_id = ${项目} and material_id = ${materialId}
                       and locator->>'row' = ${String(rowNo)})
    `),
  )
  return String(row?.id)
}
