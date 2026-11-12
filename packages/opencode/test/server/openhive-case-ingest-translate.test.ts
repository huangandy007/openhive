import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { claimNextJob, enqueueMaterial, runJob } from "../../src/server/openhive/case-ingest"
import { getMaterial } from "../../src/server/openhive/case-store"

/** 夹具起法与 `openhive-case-ingest.test.ts` 一致：事务独占一条连接（PG_POOL_MAX=1）。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
})
afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})
function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

function 造工作簿(rows: (string | number | null)[][]): Uint8Array {
  return 造多表工作簿([["Sheet1", rows]])
}

/** 多表工作簿：混合材料（话单 + 流水）与「资金表 + 非资金表」用例要用。 */
function 造多表工作簿(表们: [string, (string | number | null)[][]][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [名, rows] of 表们) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 名)
  // `xlsx` 的类型声明把返回值写成 `any`。用判型而不是 `as`：形状不对时当场炸，
  // 而不是把坏数据喂给解析器，也不触发 `no-unsafe-type-assertion`。
  const 输出: unknown = XLSX.write(wb, { type: "array", bookType: "xlsx" })
  if (!(输出 instanceof ArrayBuffer)) throw new Error("xlsx 没有返回 ArrayBuffer")
  return new Uint8Array(输出)
}

const 表头 = ["交易时间", "交易金额", "交易余额", "借贷标志", "交易对方账卡号", "交易对方名称", "查询账号", "查询户名"]
const 流水 = 造工作簿([
  [...表头],
  ["2024-11-09 09:15:03", 5000, 12300, "借", "6222021234567890123", "李四", "6217001234567896514", "张三"],
  ["2024-11-10 10:00:00", 1200, 13500, "贷", "6222021234567890123", "李四", "6217001234567896514", "张三"],
  ["", "", "", "", "合计", "", "", ""],
])

/** 独立项目用：表头加「币种」，一行人民币、一行美元。 */
const 外币流水 = 造工作簿([
  [...表头, "币种"],
  ["2024-11-09 09:15:03", 5000, 12300, "借", "6222021234567890123", "李四", "6217001234567896514", "张三", "人民币"],
  ["2024-11-10 10:00:00", 1200, 13500, "贷", "6222021234567890123", "李四", "6217001234567896514", "张三", "美元"],
])

/** 与 `openhive-case-ingest.test.ts:69-77` 同款话单夹具。 */
const 话单表头 = ["主叫号码", "被叫号码", "通话时间", "通话时长", "基站"]
const 话单 = 造工作簿([
  [...话单表头],
  ["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "HZ-01"],
  ["13700000000", "13600000000", "2026-01-02 03:05", "00:01:23", "HZ-02"],
])

const 文件 = new Map<string, Uint8Array>()
const deps = {
  readFile: async (sourcePath: string) => {
    const bytes = 文件.get(sourcePath)
    if (!bytes) throw new Error(`没有这个文件：${sourcePath}`)
    return bytes
  },
}

/** 入队 → 认领 → 跑完，返回材料 id 与作业结果。字节由调用方给，别动 `流水` 的用例 1→3 顺序依赖。 */
async function 跑字节(projectId: string, 名: string, fp: string, bytes: Uint8Array) {
  文件.set(`${projectId}/${名}`, bytes)
  const r = await enqueueMaterial(db(), {
    projectId,
    path: 名,
    sourcePath: `${projectId}/${名}`,
    fileName: 名,
    fingerprint: fp,
  })
  const job = await claimNextJob(db())
  if (!job) throw new Error("队列是空的")
  return { materialId: r.materialId, 结果: await runJob(db(), deps, job) }
}

/** 常规用例都吃同一份 `流水`，只换项目与指纹。 */
function 跑一份(projectId: string, 名: string, fp: string) {
  return 跑字节(projectId, 名, fp, 流水)
}

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null
}

describe("跑表格产出卡片", () => {
  test("两份有效行 ⇒ 两张卡片、一条关系，parse_detail 带翻译计数", async () => {
    const { materialId, 结果 } = await 跑一份("p2tr", "流水.xlsx", "fp-tr-1")
    expect(结果).toBe("完成")

    const 事件 = rowsOf(
      await db().execute(sql`select id from auth.case_event where project_id = 'p2tr'`),
    )
    expect(事件).toHaveLength(2)

    const 关系 = rowsOf(
      await db().execute(sql`
        select times, amount from auth.case_relation where project_id = 'p2tr' and type = '转账'
      `),
    )
    // 一付一收、方向相反 ⇒ 两条关系，各一笔
    expect(关系).toHaveLength(2)
    expect(关系.map((r) => Number(r.times)).sort((a, b) => a - b)).toEqual([1, 1])

    const 材料 = await getMaterial(db(), "p2tr", materialId)
    const detail = 材料?.parseDetail
    expect(是对象(detail) && 是对象(detail.翻译)).toBe(true)
    if (!是对象(detail) || !是对象(detail.翻译)) throw new Error("没有翻译明细")
    expect(detail.翻译.卡片数).toBe(2)
    // 全等而不是 toMatchObject：实现会过滤掉计数为 0 的跳过原因，多键存在即是回归。
    expect(detail.翻译.跳过).toEqual({ 合计行: 1 })
    // 实得 rowNo = 4：Sheet1 第 1 行表头，数据在 2/3，合计在文件行号 4（1 基）。
    expect(detail.翻译.跳过行号).toEqual([{ sheet: "Sheet1", rowNo: 4, 原因: "合计行" }])
  })

  test("重放同一份材料 ⇒ 卡片不翻倍、关系不翻倍", async () => {
    文件.set("p2tr/流水.xlsx", 流水)
    const job = await (async () => {
      await enqueueMaterial(db(), {
        projectId: "p2tr",
        path: "流水.xlsx",
        sourcePath: "p2tr/流水.xlsx",
        fileName: "流水.xlsx",
        fingerprint: "fp-tr-1",
        force: true,
      })
      return claimNextJob(db())
    })()
    if (!job) throw new Error("队列是空的")
    expect(await runJob(db(), deps, job)).toBe("完成")
    const 事件 = rowsOf(
      await db().execute(sql`select id from auth.case_event where project_id = 'p2tr'`),
    )
    expect(事件).toHaveLength(2)
    const 关系 = rowsOf(
      await db().execute(sql`
        select times from auth.case_relation where project_id = 'p2tr' and type = '转账'
      `),
    )
    expect(关系.map((r) => Number(r.times)).sort((a, b) => a - b)).toEqual([1, 1])
  })

  // 上一条只验证「同 id 重复插入不翻倍」（事件 id 是确定的，`on conflict do nothing` 就能挡住）。
  // `清本材料翻译` 真正承重的是**新一次解析不再产出卡片**：旧卡片没有新卡片来覆盖，只能靠清理删。
  // 去掉那句调用 ⇒ 本用例红在「旧事件还在」。
  test("重放后不再产卡片 ⇒ 旧卡片与关系被清掉", async () => {
    文件.set(
      "p2tr/流水.xlsx",
      造工作簿([
        [...表头],
        ["2024-11-11 09:00:00", 700, 1000, "", "6222021234567890123", "李四", "6217001234567896514", "张三"],
      ]),
    )
    const { materialId } = await enqueueMaterial(db(), {
      projectId: "p2tr",
      path: "流水.xlsx",
      sourcePath: "p2tr/流水.xlsx",
      fileName: "流水.xlsx",
      fingerprint: "fp-tr-1",
      force: true,
    })
    const job = await claimNextJob(db())
    if (!job) throw new Error("队列是空的")
    expect(await runJob(db(), deps, job)).toBe("完成")

    const 事件 = rowsOf(
      await db().execute(sql`select id from auth.case_event where project_id = 'p2tr'`),
    )
    expect(事件).toHaveLength(0)
    const 关系 = rowsOf(
      await db().execute(sql`
        select id from auth.case_relation where project_id = 'p2tr' and type = '转账'
      `),
    )
    expect(关系).toHaveLength(0)

    const 材料 = await getMaterial(db(), "p2tr", materialId)
    const detail = 材料?.parseDetail
    if (!是对象(detail) || !是对象(detail.翻译)) throw new Error("没有翻译明细")
    expect(detail.翻译.卡片数).toBe(0)
  })

  test("非人民币卡片单独计数，且币种按行落库", async () => {
    const { materialId, 结果 } = await 跑字节("p2usd", "外币流水.xlsx", "fp-usd-1", 外币流水)
    expect(结果).toBe("完成")

    const 材料 = await getMaterial(db(), "p2usd", materialId)
    const detail = 材料?.parseDetail
    if (!是对象(detail) || !是对象(detail.翻译)) throw new Error("没有翻译明细")
    expect(detail.翻译.卡片数).toBe(2)
    expect(detail.翻译.非人民币卡片).toBe(1)

    // 币种按行落库（Q16）：`解析币种` 只把人民币的几种写法归成 `CNY`，其余原样大写——
    // 实跑「美元」得 `"美元"`（不是 `"USD"`），所以这里按实得断言，不按币种代码猜。
    const 币种计数 = rowsOf(
      await db().execute(sql`
        select currency, count(*) as n
          from auth.case_event
         where project_id = 'p2usd'
         group by currency
      `),
    )
    expect(Object.fromEntries(币种计数.map((r) => [String(r.currency), Number(r.n)]))).toEqual({
      CNY: 1,
      美元: 1,
    })
  })

  // I1：`insertEvents` 的 `do nothing` 保住了人工结论的事件行，但参与者是无条件 upsert。
  // 若重放换了对手，同一张卡会变成「旧金额 + 新参与者」，关系再按新参与者聚合。
  test("人工确认过的卡片重放换对手：事件与参与者整卡保留，关系不被改写", async () => {
    await 跑一份("p2human", "流水.xlsx", "fp-human-1")

    // 取一张卡钉成人工结论（`order by id limit 1` 保证跨轮稳定）。
    const 原事件 = rowsOf(
      await db().execute(sql`
        select id, amount from auth.case_event
         where project_id = 'p2human' order by id limit 1
      `),
    )
    expect(原事件).toHaveLength(1)
    const 确认id = String(原事件[0]?.id)
    const 确认金额 = String(原事件[0]?.amount)
    const 原参与 = rowsOf(
      await db().execute(sql`
        select ordinal, entity_id, role, mention_text
          from auth.case_event_participant
         where project_id = 'p2human' and event_id = ${确认id} order by ordinal
      `),
    )
    expect(原参与).toHaveLength(2)

    await db().execute(sql`
      update auth.case_event set trust_state = '已确认'
       where project_id = 'p2human' and id = ${确认id}
    `)
    const 关系前 = rowsOf(
      await db().execute(sql`
        select id from auth.case_relation where project_id = 'p2human' and type = '转账'
      `),
    )
    expect(关系前).toHaveLength(2)

    // 换对手账号重放：新对手是可建实体的普通账号。
    const 新对手 = "6222029999999999999"
    文件.set(
      "p2human/流水.xlsx",
      造工作簿([
        [...表头],
        ["2024-11-09 09:15:03", 5000, 12300, "借", 新对手, "李四", "6217001234567896514", "张三"],
        ["2024-11-10 10:00:00", 1200, 13500, "贷", 新对手, "李四", "6217001234567896514", "张三"],
      ]),
    )
    await enqueueMaterial(db(), {
      projectId: "p2human",
      path: "流水.xlsx",
      sourcePath: "p2human/流水.xlsx",
      fileName: "流水.xlsx",
      fingerprint: "fp-human-1",
      force: true,
    })
    const job = await claimNextJob(db())
    if (!job) throw new Error("队列是空的")
    expect(await runJob(db(), deps, job)).toBe("完成")

    const 事件 = rowsOf(
      await db().execute(sql`select id, amount from auth.case_event where project_id = 'p2human'`),
    )
    expect(事件).toHaveLength(2)
    // 人工结论的事件行保留旧金额（`on conflict do nothing`）。
    expect(String(事件.find((e) => String(e.id) === 确认id)?.amount)).toBe(确认金额)

    // 该事件的参与者逐字段不变（entity_id / role / mention_text）。
    const 确认参与 = rowsOf(
      await db().execute(sql`
        select ordinal, entity_id, role, mention_text
          from auth.case_event_participant
         where project_id = 'p2human' and event_id = ${确认id} order by ordinal
      `),
    )
    expect(确认参与).toEqual(原参与)

    // 对照：另一张（未确认的）卡确实换了对手——否则本用例只是「什么都没变」而绿。
    const 另一id = 事件.map((e) => String(e.id)).find((id) => id !== 确认id)
    if (另一id === undefined) throw new Error("另一张卡不见了")
    const 另一参与 = rowsOf(
      await db().execute(sql`
        select ordinal, entity_id, role, mention_text
          from auth.case_event_participant
         where project_id = 'p2human' and event_id = ${另一id} order by ordinal
      `),
    )
    const 新对手参与 = 另一参与.find((p) => p.mention_text === 新对手)
    expect(新对手参与).toBeDefined()
    expect(确认参与.some((p) => p.mention_text === 新对手)).toBe(false)

    // 关系集合：旧对手对仍在，且没有「人工卡旧金额挂到新对手」的新对。
    const 关系 = rowsOf(
      await db().execute(sql`
        select from_id, to_id, times, amount
          from auth.case_relation where project_id = 'p2human' and type = '转账'
      `),
    )
    expect(关系).toHaveLength(2)
    const 付 = 确认参与.find((p) => p.role === "付款方")
    const 收 = 确认参与.find((p) => p.role === "收款方")
    const 旧对 = 关系.find((r) => r.from_id === 付?.entity_id && r.to_id === 收?.entity_id)
    expect(旧对).toBeDefined()
    expect(String(旧对?.amount)).toBe(确认金额)
    expect(Number(旧对?.times)).toBe(1)
    const 新对手id = 新对手参与?.entity_id
    expect(typeof 新对手id).toBe("string")
    const 新对 = 关系.filter((r) => r.from_id === 新对手id || r.to_id === 新对手id)
    expect(新对).toHaveLength(1)
    const 另一金额 = String(事件.find((e) => String(e.id) === 另一id)?.amount)
    expect(String(新对[0]?.amount)).toBe(另一金额)
    expect(String(新对[0]?.amount)).not.toBe(确认金额)
  })

  // I3：材料级类型闸 vs 逐表翻译。混合材料判「话单」⇒ 资金表零卡片且原来一字提示都没有。
  test("混合材料（话单 + 资金）：判话单、0 卡片，未翻译表点名资金表", async () => {
    const 混合 = 造多表工作簿([
      ["Sheet1", [话单表头, ["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "HZ-01"]]],
      [
        "Sheet2",
        [表头, ["2024-11-09 09:15:03", 5000, 12300, "借", "6222021234567890123", "李四", "6217001234567896514", "张三"]],
      ],
    ])
    const { materialId, 结果 } = await 跑字节("p2mix", "混合.xlsx", "fp-mix-1", 混合)
    expect(结果).toBe("完成")

    const 材料 = await getMaterial(db(), "p2mix", materialId)
    expect(材料?.kind).toBe("话单")
    const detail = 材料?.parseDetail
    if (!是对象(detail)) throw new Error("没有 parse_detail")
    // 非资金材料不做翻译（既有话单语义不变）。
    expect(Object.hasOwn(detail, "翻译")).toBe(false)
    expect(detail.未翻译表).toEqual([{ sheet: "Sheet2", 原因: "材料类型=话单，本期只翻译资金材料" }])
    const 事件 = rowsOf(
      await db().execute(sql`select id from auth.case_event where project_id = 'p2mix'`),
    )
    expect(事件).toHaveLength(0)
  })

  // I3 的另一半：材料判资金时，非资金表的行不再进 `翻译资金` 刷跳过噪音。
  test("资金材料里的非资金表不进翻译：卡片只来自资金表", async () => {
    const 含说明 = 造多表工作簿([
      [
        "Sheet1",
        [表头, ["2024-11-09 09:15:03", 5000, 12300, "借", "6222021234567890123", "李四", "6217001234567896514", "张三"]],
      ],
      ["Sheet2", [["说明"], ["这是材料附带的说明文字"]]],
    ])
    const { materialId, 结果 } = await 跑字节("p2mix2", "流水带说明.xlsx", "fp-mix2-1", 含说明)
    expect(结果).toBe("完成")

    const 材料 = await getMaterial(db(), "p2mix2", materialId)
    const detail = 材料?.parseDetail
    if (!是对象(detail) || !是对象(detail.翻译)) throw new Error("没有翻译明细")
    expect(detail.翻译.卡片数).toBe(1)
    expect(detail.翻译.跳过行号).toEqual([])
    expect(detail.未翻译表).toEqual([{ sheet: "Sheet2", 原因: "本表类型=其他，不是资金表" }])
  })

  test("话单只落明细行：不做资金翻译、不建资金模板", async () => {
    const { materialId, 结果 } = await 跑字节("p2call", "话单.xlsx", "fp-call-1", 话单)
    expect(结果).toBe("完成")

    const 材料 = await getMaterial(db(), "p2call", materialId)
    expect(材料?.kind).toBe("话单")
    const detail = 材料?.parseDetail
    expect(是对象(detail)).toBe(true)
    if (!是对象(detail)) throw new Error("没有 parse_detail")
    // 「本期只做资金」这条 Global Constraint 的守护：话单路径不许出现翻译明细。
    expect(Object.hasOwn(detail, "翻译")).toBe(false)

    const 事件 = rowsOf(
      await db().execute(sql`select id from auth.case_event where project_id = 'p2call'`),
    )
    expect(事件).toHaveLength(0)
    const 模板 = rowsOf(
      await db().execute(sql`select id from auth.case_card_template where project_id = 'p2call'`),
    )
    expect(模板).toHaveLength(0)
  })
})

