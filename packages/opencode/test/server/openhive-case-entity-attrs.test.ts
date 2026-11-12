import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 合并属性, 属性观察表, 剥离本材料出处 } from "../../src/server/openhive/case-entity-attrs"
import { upsertEntity } from "../../src/server/openhive/case-fact-store"
import { 写入翻译结果, 清本材料翻译 } from "../../src/server/openhive/case-translate-store"
import { 确保内置模板 } from "../../src/server/openhive/case-card-template"
import { 翻译资金 } from "../../src/server/openhive/case-translate"
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

describe("合并属性（05 §5.2）", () => {
  test("同键同值去重，保留首次出处", () => {
    const 旧 = { 开户行: [{ 值: "招商银行", 出处: "m1#S#2" }] }
    const 新 = { 开户行: [{ 值: "招商银行", 出处: "m2#S#5" }] }
    expect(合并属性(旧, 新)).toEqual({ 开户行: [{ 值: "招商银行", 出处: "m1#S#2" }] })
  })

  test("同键不同值并存（A16：两条都在）", () => {
    const 旧 = { 开户行: [{ 值: "招商银行", 出处: "m1#S#2" }] }
    const 新 = { 开户行: [{ 值: "工商银行", 出处: "m2#S#5" }] }
    expect(合并属性(旧, 新)).toEqual({
      开户行: [
        { 值: "招商银行", 出处: "m1#S#2" },
        { 值: "工商银行", 出处: "m2#S#5" },
      ],
    })
  })

  test("新键追加；标量键覆盖（subtype 语义不变）", () => {
    expect(合并属性({ subtype: "银行卡" }, { subtype: "对公户" })).toEqual({ subtype: "对公户" })
    expect(合并属性({}, { 开户行: [{ 值: "招商银行", 出处: "m1#S#2" }] })).toEqual({
      开户行: [{ 值: "招商银行", 出处: "m1#S#2" }],
    })
  })

  test("剥离本材料出处：只删自己的，别材料的留", () => {
    const 旧 = {
      开户行: [
        { 值: "招商银行", 出处: "m1#S#2" },
        { 值: "工商银行", 出处: "m2#S#5" },
      ],
      subtype: "银行卡",
    }
    expect(剥离本材料出处(旧, "m1")).toEqual({
      开户行: [{ 值: "工商银行", 出处: "m2#S#5" }],
      subtype: "银行卡",
    })
  })

  test("剥离后没有任何观察的键整个消失（不留空数组）", () => {
    expect(剥离本材料出处({ 开户行: [{ 值: "招商银行", 出处: "m1#S#2" }] }, "m1")).toEqual({})
  })

  test("同一次合并里两条同值也只留一条（按值唯一，不指望调用方分批）", () => {
    expect(
      合并属性(
        {},
        {
          开户行: [
            { 值: "招商银行", 出处: "m1#S#2" },
            { 值: "招商银行", 出处: "m1#S#9" },
          ],
        },
      ),
    ).toEqual({ 开户行: [{ 值: "招商银行", 出处: "m1#S#2" }] })
  })
})

describe("materialId 形状前提（F8）", () => {
  test("含 `#` ⇒ 属性观察表 抛错（出处前缀会有歧义）", () => {
    expect(() => 属性观察表([], new Map(), [], "m#1")).toThrow(/materialId 形状与本函数前提不符/)
  })
})

const 项目 = "prj-attrs"

function 行(materialId: string, rowNo: number, 开户行: string): FactRowInput {
  return {
    projectId: 项目,
    materialId,
    sheet: "Sheet1",
    rowNo,
    startedAt: 1731117303,
    startedRaw: "2024-11-09 09:15:03",
    precision: "到秒",
    amount: "5000.00",
    direction: "付",
    counterparty: "6222021234567890123",
    ownerAccount: "6217001234567896514",
    currency: "CNY",
    extras: { "属性:对方:开户行": 开户行 },
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

async function 对方属性() {
  const [row] = rowsOf(
    await db().execute(sql`
      select attrs from auth.case_entity
       where project_id = ${项目} and type = '账户' and canonical_value = '6222021234567890123'
    `),
  )
  return row?.attrs
}

async function 本方属性() {
  const [row] = rowsOf(
    await db().execute(sql`
      select attrs from auth.case_entity
       where project_id = ${项目} and type = '账户' and canonical_value = '6217001234567896514'
    `),
  )
  return row?.attrs
}

/**
 * 从 `attrs`（jsonb 读出来是**对象**，不是字符串）里取「开户行」的值列表。
 * 走运行时判型而不是 `as`：`no-unsafe-type-assertion` 会把断言报成 warning，而且形状变了
 * 断言也照样编译通过、断言只会更晚才炸。
 */
function 开户行值们(attrs: unknown): string[] {
  if (typeof attrs !== "object" || attrs === null || !("开户行" in attrs)) return []
  const 列表 = attrs.开户行
  if (!Array.isArray(列表)) return []
  const 值们: string[] = []
  for (const 条 of 列表) {
    if (typeof 条 === "object" && 条 !== null && "值" in 条 && typeof 条.值 === "string") 值们.push(条.值)
  }
  return 值们
}

describe("attrs 落库与反回归（§3.10 / 05 §5.2）", () => {
  test("两份材料给出不同开户行 ⇒ 两条都在", async () => {
    await 写("am1", [
      {
        ...行("am1", 2, "招商银行"),
        extras: { "属性:对方:开户行": "招商银行", "属性:本方:开户行": "招商银行" },
      },
    ])
    await 写("am2", [行("am2", 2, "工商银行")])
    expect(await 对方属性()).toEqual({
      开户行: [
        { 值: "招商银行", 出处: "am1#Sheet1#2" },
        { 值: "工商银行", 出处: "am2#Sheet1#2" },
      ],
    })
    // 本方实体这时也拿到了自己的开户行——只断言对方的话，`归属` 映射写成常量「对方」
    // 照样绿（`#005-18` 假绿四问之二）。
    expect(await 本方属性()).toEqual({
      开户行: [{ 值: "招商银行", 出处: "am1#Sheet1#2" }],
    })
  })

  test("重放一份材料换了开户行 ⇒ 旧值被自己的出处剥离，别材料的留", async () => {
    await 写("am1", [行("am1", 2, "建设银行")])
    expect(await 对方属性()).toEqual({
      开户行: [
        { 值: "工商银行", 出处: "am2#Sheet1#2" },
        { 值: "建设银行", 出处: "am1#Sheet1#2" },
      ],
    })
  })

  test("`upsertEntity` 不再键级覆盖（`case-fact-store.ts:73` 的反回归）", async () => {
    const 键 = "6222021234567890123"
    await upsertEntity(db(), {
      projectId: 项目,
      id: "e-x",
      type: "账户",
      canonicalValue: 键,
      aliases: [],
      attrs: { 开户行: [{ 值: "农商行", 出处: "手工#1" }] },
    })
    const 现 = 开户行值们(await 对方属性())
    expect(现).toContain("农商行")
    expect(现).toContain("建设银行")
  })

  test("重放后不再产出的属性被清掉（Q14 按材料整体清除）", async () => {
    await 写("bm1", [
      {
        ...行("bm1", 2, "交通银行"),
        extras: { "属性:对方:开户行": "交通银行", "属性:本方:开户行": "交通银行" },
      },
    ])
    expect(开户行值们(await 本方属性())).toContain("交通银行")

    // 真实重放顺序：清本材料 → 重新写入。新行**只给「对方」属性**，本方这一轮一条属性
    // 都没有 ⇒ 写入器 ⑤ 的 `按实体` 里根本没有本方实体，旧值只能在清理侧被剥掉。
    await 清本材料翻译(db(), 项目, "bm1")
    await 写("bm1", [行("bm1", 3, "农业银行")])

    expect(开户行值们(await 本方属性())).not.toContain("交通银行")
    // 剥离必须**按出处**、不能把整份 attrs 抹掉：只断言「本材料的没了」的话，
    // 清理写成 `set attrs = '{}'` 照样绿（复审变异 C 存活）。招商银行来自 am1，必须还在。
    expect(开户行值们(await 本方属性())).toContain("招商银行")
    expect(开户行值们(await 对方属性())).toContain("农业银行")
  })
})
