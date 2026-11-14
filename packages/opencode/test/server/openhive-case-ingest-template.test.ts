import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { claimNextJob, enqueueMaterial, runJob } from "../../src/server/openhive/case-ingest"
import { 读材料事实行, getMaterial } from "../../src/server/openhive/case-store"
import { 建模板, 停用模板 } from "../../src/server/openhive/case-card-template-store"
import { 检查模板定义 } from "../../src/server/openhive/case-card-template"

/** 夹具起法与 `openhive-case-ingest-translate.test.ts` 一致：事务独占一条连接（PG_POOL_MAX=1）。 */
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

/** 读 `parse_detail` 的窄口：形状不对当场炸，不用 `as`（同 `openhive-case-ingest-translate.test.ts`）。 */
function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}
function 读对象(值: unknown, 名: string): Record<string, unknown> {
  if (!是对象(值)) throw new Error(`没有 ${名}`)
  return 值
}

function 造多表工作簿(表们: [string, (string | number | null)[][]][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [名, rows] of 表们) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 名)
  // `xlsx` 的类型声明把返回值写成 `any`。用判型而不是 `as`：形状不对时当场炸，
  // 而不是把坏数据喂给解析器，也不触发 `no-unsafe-type-assertion`。
  const 输出: unknown = XLSX.write(wb, { type: "array", bookType: "xlsx" })
  if (!(输出 instanceof ArrayBuffer)) throw new Error("xlsx 没有返回 ArrayBuffer")
  return new Uint8Array(输出)
}

/** 一份「话单」：模板（谁=主叫号码、和谁=被叫号码、何时=通话时间、其他=通话时长）。 */
const 话单表 = [
  ["主叫号码", "被叫号码", "通话时间", "通话时长", "基站"],
  ["13800000001", "13900000002", "2023-11-14 22:13:20", "59", "杭州西湖"],
  ["13800000003", "13900000004", "2023-11-14 22:20:00", "12", "杭州滨江"],
  ["合计", "", "", "", ""],
]

function 话单定义() {
  const 检查 = 检查模板定义({
    name: "话单",
    eventType: "通话",
    slots: {
      谁: { 字段: "caller", 角色: "主叫" },
      和谁: [{ 字段: "callee", 角色: "被叫" }],
      何时: { 字段: "startedAt" },
      其他: [{ 字段: "durationSec" }],
    },
    required: ["何时"],
  })
  if (检查.值 === undefined) throw new Error(`夹具不合法：${检查.错.join("；")}`)
  return 检查.值
}

/**
 * 混合材料里的「非资金、非话单」表。
 *
 * ⚠️ 为什么不是话单表：材料级 `kind` 是「话单优先」（`case-recognize.ts` 的 `材料类型`），
 * 任何一张表认出 `caller` / `callee` / `durationSec` 都会把整份材料判成话单，资金表于是
 * 只记「未翻译表」、资金通路根本不跑（既有回归用例钉着这一条）。要用「资金 ＋ 模板」两路
 * 同时产卡，非资金表的字段就不能是话单专用列，只能走 extras。
 */
const 见面表 = [
  ["联系人", "联系电话", "签收时间"],
  ["李四", "13800000002", "2023-11-14 22:13:20"],
  ["赵六", "13900000004", "2023-11-14 22:20:00"],
]

function 见面定义() {
  const 检查 = 检查模板定义({
    name: "见面",
    eventType: "见面",
    slots: {
      谁: { 字段: "personName" },
      和谁: [{ 字段: "contactPhone" }],
      何时: { 字段: "deliveredAt" },
    },
    required: ["何时"],
  })
  if (检查.值 === undefined) throw new Error(`夹具不合法：${检查.错.join("；")}`)
  return 检查.值
}

/** 与 `openhive-case-ingest-translate.test.ts` 同形：一份材料字节走一份文件的内存表。 */
const 文件 = new Map<string, Uint8Array>()
const deps = {
  readFile: async (sourcePath: string) => {
    const bytes = 文件.get(sourcePath)
    if (!bytes) throw new Error(`没有这个文件：${sourcePath}`)
    return bytes
  },
}

/**
 * 入队 → 认领 → 跑完。
 *
 * `force: true` 恒开：重放用例要对同一份材料再跑一次，而 `enqueued` 在「已解析」且不强制时
 * 是 `false`（不会产生新作业）。其余用例里它只多推一次状态机，无副作用。
 */
async function 跑一份(项目: string, 文件名: string, 字节: Uint8Array, templateId?: string) {
  文件.set(`${项目}/${文件名}`, 字节)
  await enqueueMaterial(db(), {
    projectId: 项目,
    path: 文件名,
    sourcePath: `${项目}/${文件名}`,
    fileName: 文件名,
    fingerprint: `fp-${项目}-${文件名}-${templateId ?? "auto"}`,
    force: true,
    ...(templateId === undefined ? {} : { templateId }),
  })
  const job = await claimNextJob(db())
  if (!job) throw new Error("队列是空的")
  const 结果 = await runJob(db(), deps, job)
  return { job, 结果 }
}

describe("ingest 自动选模板（§9）", () => {
  test("自动命中：parse_detail 有卡片模板与列，事件落模板 id，卡片未被验证 ⇒ 默认不可见（第 6 步验）", async () => {
    const 项目 = "p-ingest-自动"
    const 行 = await 建模板(db(), { projectId: 项目, 定义: 话单定义() })
    const { job } = await 跑一份(项目, "话单.xlsx", 造多表工作簿([["Sheet1", 话单表]]))
    const 材料 = await getMaterial(db(), 项目, job.materialId)
    const 明细 = 读对象(材料?.parseDetail, "parse_detail")
    expect(明细.卡片模板).toEqual([
      { 工作表: "Sheet1", 方式: "自动", id: 行.id, name: "话单", 命中槽数: expect.any(Number) },
    ])
    const 表们 = 读对象(读对象(明细.mapping, "mapping").工作表, "mapping.工作表")
    const 列 = 读对象(读对象(表们["Sheet1"], "mapping.工作表.Sheet1").列, "列")
    // 列号是表头下标（0 起），逐列钉具体识别字段——只断言「有值」测不出映射错位。
    expect(列["0"]).toBe("caller")
    expect(列["1"]).toBe("callee")
    expect(列["2"]).toBe("startedAt")
    expect(列["3"]).toBe("durationSec")

    const 卡们 = rowsOf(
      await db().execute(sql`
        select id, type, template_id, summary, amount, occurred_at
          from auth.case_event where project_id = ${项目} order by occurred_at
      `),
    )
    expect(卡们).toHaveLength(2)
    expect(卡们[0]?.type).toBe("通话")
    expect(卡们[0]?.template_id).toBe(行.id)
    expect(String(卡们[0]?.summary)).toContain("通话：13800000001 与 13900000002")
    expect(卡们[0]?.amount ?? null).toBeNull()
    // 命中计数 +1
    const 命中 = rowsOf(await db().execute(sql`
      select hit_count from auth.case_card_template where project_id = ${项目} and id = ${行.id}
    `))
    expect(Number(命中[0]?.hit_count)).toBe(1)
  })

  test("套了模板但 0 张卡 ⇒ 不记 `卡片模板`（明细只记真产出事实的表，§9.3）", async () => {
    const 项目 = "p-ingest-零卡"
    await 建模板(db(), { projectId: 项目, 定义: 话单定义() })
    // 只有表头、没有数据行：表头能认出模板（建议命中），但翻译一行都产不出卡。
    const { job } = await 跑一份(项目, "只有表头.xlsx", 造多表工作簿([["Sheet1", [话单表[0]!]]]))
    const 材料 = await getMaterial(db(), 项目, job.materialId)
    const 明细 = 读对象(材料?.parseDetail, "parse_detail")
    // 0 卡的表若也写进 `卡片模板`，回执会声称「这张表套了模板、产出了事实」。
    expect("卡片模板" in 明细).toBe(false)
    const 卡数 = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_event where project_id = ${项目}`))
    expect(Number(卡数[0]?.n)).toBe(0)
  })

  test("没有匹配模板 ⇒ 未翻译表原因；仍落明细行、不产卡片", async () => {
    const 项目 = "p-ingest-无模板"
    const { job } = await 跑一份(项目, "话单.xlsx", 造多表工作簿([["Sheet1", 话单表]]))
    const 材料 = await getMaterial(db(), 项目, job.materialId)
    const 明细 = 读对象(材料?.parseDetail, "parse_detail")
    expect(明细.未翻译表).toEqual([{ sheet: "Sheet1", 原因: "没有匹配的卡片模板（可在项目里配置）" }])
    const 卡数 = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_event where project_id = ${项目}`))
    expect(Number(卡数[0]?.n)).toBe(0)
    const 行数 = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_fact_row where project_id = ${项目}`))
    expect(Number(行数[0]?.n)).toBe(3) // 2 数据行 + 1 合计行；合计行在翻译时跳过，但明细行照落
  })

  test("显式指定模板 ⇒ 只套指定那张，方式=指定；无视自动建议", async () => {
    const 项目 = "p-ingest-指定"
    const 指定 = await 建模板(db(), { projectId: 项目, 定义: 话单定义() })
    // 第二张是**真能被自动建议命中**的候选（字段集与话单表重合、事件类型不同因而不撞唯一索引）。
    // 若实现拿自动建议覆盖指定，选中的会是它——断言卡片类型/模板 id 才能咬住。
    const 伪候选 = await 建模板(db(), {
      projectId: 项目,
      定义: {
        name: "见面",
        event_type: "见面",
        slots: {
          谁: { 字段: "caller" },
          和谁: [{ 字段: "callee" }],
          何时: { 字段: "startedAt" },
        },
        required: ["何时"],
      },
    })
    expect(伪候选.id).not.toBe(指定.id)

    const { job } = await 跑一份(项目, "话单.xlsx", 造多表工作簿([["Sheet1", 话单表]]), 指定.id)
    const 材料 = await getMaterial(db(), 项目, job.materialId)
    const 明细 = 读对象(材料?.parseDetail, "parse_detail")
    expect(明细.卡片模板).toEqual([{ 工作表: "Sheet1", 方式: "指定", id: 指定.id, name: "话单" }])
    const 作业 = rowsOf(await db().execute(sql`select template_id from auth.case_ingest_job where id = ${job.jobId}`))
    expect(作业[0]?.template_id).toBe(指定.id)
    const 卡们 = rowsOf(await db().execute(sql`
      select type, template_id from auth.case_event where project_id = ${项目} order by occurred_at
    `))
    expect(卡们).toHaveLength(2)
    expect(卡们.map((卡) => [String(卡.type), String(卡.template_id)])).toEqual([
      ["通话", 指定.id],
      ["通话", 指定.id],
    ])
  })

  test("指定的模板在排队期间被停用 ⇒ 作业失败、材料有问题，且不静默回落自动建议", async () => {
    const 项目 = "p-ingest-失效"
    const 指定 = await 建模板(db(), { projectId: 项目, 定义: 话单定义() })
    // 这张「会被自动建议命中」的模板是诱饵：静默回落的话它会产出卡片，断言 0 卡就红。
    await 建模板(db(), {
      projectId: 项目,
      定义: {
        name: "见面",
        event_type: "见面",
        slots: {
          谁: { 字段: "caller" },
          和谁: [{ 字段: "callee" }],
          何时: { 字段: "startedAt" },
        },
        required: ["何时"],
      },
    })
    文件.set(`${项目}/话单.xlsx`, 造多表工作簿([["Sheet1", 话单表]]))
    await enqueueMaterial(db(), {
      projectId: 项目,
      path: "话单.xlsx",
      sourcePath: `${项目}/话单.xlsx`,
      fileName: "话单.xlsx",
      fingerprint: "fp-失效-1",
      force: true,
      templateId: 指定.id,
    })
    const job = await claimNextJob(db())
    if (!job) throw new Error("队列是空的")
    expect(job.templateId).toBe(指定.id)

    // 排队成功后模板被停用（§9.5 的第二道判定：作业里必须 fail-closed）。
    expect(await 停用模板(db(), { projectId: 项目, id: 指定.id })).toBe(true)

    const 结果 = await runJob(db(), deps, job)
    expect(结果).toBe("失败")
    const 材料 = await getMaterial(db(), 项目, job.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    expect(材料?.parseDetail).toMatchObject({ reason: `指定的卡片模板不存在或已停用：${指定.id}` })
    const 卡数 = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_event where project_id = ${项目}`))
    expect(Number(卡数[0]?.n)).toBe(0)
  })

  test("混合材料：资金表走资金通路、非资金表走模板，两边都产卡片", async () => {
    const 项目 = "p-ingest-混合"
    await 建模板(db(), { projectId: 项目, 定义: 见面定义() })
    const 流水表 = [
      ["交易时间", "交易金额", "交易余额", "借贷标志", "交易对方账卡号", "交易对方名称", "查询账号", "查询户名"],
      ["2024-11-09 09:15:03", 5000, 12300, "借", "6222021234567890123", "李四", "6217001234567896514", "张三"],
    ]
    const { job } = await 跑一份(
      项目,
      "混合.xlsx",
      造多表工作簿([
        ["流水", 流水表],
        ["见面", 见面表],
      ]),
    )
    const 材料 = await getMaterial(db(), 项目, job.materialId)
    const 明细 = 读对象(材料?.parseDetail, "parse_detail")
    const 卡片模板 = 明细.卡片模板
    if (!Array.isArray(卡片模板)) throw new Error("没有卡片模板明细")
    expect(
      卡片模板.map((c) => {
        const 项 = 读对象(c, "卡片模板项")
        return [项.工作表, 项.方式]
      }),
    ).toEqual([
      ["流水", "代码规则"],
      ["见面", "自动"],
    ])
    // 不排序、不依赖 locale：直接按类型名取值断言。
    const 类型数 = new Map(
      rowsOf(
        await db().execute(sql`select type, count(*)::int as n from auth.case_event where project_id = ${项目} group by type`),
      ).map((r) => [String(r.type), Number(r.n)]),
    )
    expect(类型数.size).toBe(2)
    expect(类型数.get("见面")).toBe(2)
    expect(类型数.get("资金交易")).toBe(1)
  })

  test("重放幂等：同一份材料解析两次，卡片数与模板命中计数按次累加但不重复建卡", async () => {
    const 项目 = "p-ingest-重放"
    const 行 = await 建模板(db(), { projectId: 项目, 定义: 话单定义() })
    const 字节 = 造多表工作簿([["Sheet1", 话单表]])
    await 跑一份(项目, "话单.xlsx", 字节)
    await 跑一份(项目, "话单.xlsx", 字节)
    const 卡数 = rowsOf(await db().execute(sql`select count(*)::int as n from auth.case_event where project_id = ${项目}`))
    expect(Number(卡数[0]?.n)).toBe(2)
    const 命中 = rowsOf(await db().execute(sql`
      select hit_count from auth.case_card_template where project_id = ${项目} and id = ${行.id}
    `))
    expect(Number(命中[0]?.hit_count)).toBe(2)
  })

  test("掩码值不建实体（§8.2 / §13.1）：落库的规范值里没有 *", async () => {
    const 项目 = "p-ingest-掩码"
    await 建模板(db(), { projectId: 项目, 定义: 话单定义() })
    const 掩码表 = [
      ["主叫号码", "被叫号码", "通话时间", "通话时长"],
      ["138****0001", "139****0002", "2023-11-14 22:13:20", "59"],
      ["138****0003", "139****0004", "2023-11-14 22:20:00", "12"],
    ]
    const { job } = await 跑一份(项目, "掩码话单.xlsx", 造多表工作簿([["Sheet1", 掩码表]]))
    const 材料 = await getMaterial(db(), 项目, job.materialId)
    expect(材料?.parseStatus).toBe("已解析")
    // 先证明通路真的跑了：两行都产卡（否则「没有 * 实体」是空跑出来的假绿，`#005-18`）。
    const 卡数 = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_event where project_id = ${项目}`),
    )
    expect(Number(卡数[0]?.n)).toBe(2)
    const 实体值们 = rowsOf(
      await db().execute(sql`select canonical_value from auth.case_entity where project_id = ${项目}`),
    )
    expect(实体值们.filter((行) => String(行.canonical_value).includes("*"))).toEqual([])
  })
})

describe("读材料事实行（预览用只读口）", () => {
  test("同一 sheet 内按 row_no 升序、金额余额为字符串、extras 解析成对象、上限生效", async () => {
    const 项目 = "p-读行"
    await db().execute(sql`
      insert into auth.case_fact_row
        (project_id, material_id, sheet, row_no, caller, callee, started_at, started_raw,
         precision, time_type, duration_sec, amount, balance, counterparty, counterparty_name,
         owner_account, direction, currency, extras)
      values (${项目}, 'm-读行', 'Sheet1', 2, '13800000001', '13900000002', 1700000000, '2023-11-14 22:13:20',
              '到秒', '发生', 59, 100.00, 900.00, '6222021234567890', '李四',
              '6217001234567890', '付', 'USD', '{"address":"某地"}'::jsonb),
             (${项目}, 'm-读行', 'Sheet1', 3, '13800000003', NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CNY', '{}'::jsonb)
    `)
    const 行们 = await 读材料事实行(db(), 项目, "m-读行", "Sheet1", 1)
    expect(行们).toHaveLength(1)
    expect(行们[0]).toMatchObject({
      projectId: 项目,
      materialId: "m-读行",
      sheet: "Sheet1",
      rowNo: 2,
      caller: "13800000001",
      callee: "13900000002",
      startedAt: 1700000000,
      startedRaw: "2023-11-14 22:13:20",
      precision: "到秒",
      timeType: "发生",
      durationSec: 59,
      amount: "100.00",
      balance: "900.00",
      counterparty: "6222021234567890",
      counterpartyName: "李四",
      ownerAccount: "6217001234567890",
      direction: "付",
      currency: "USD",
      extras: { address: "某地" },
    })
    const 全部 = await 读材料事实行(db(), 项目, "m-读行", "Sheet1", 20)
    expect(全部.map((r) => r.rowNo)).toEqual([2, 3])
    expect(全部[1]?.extras).toEqual({})
    expect(await 读材料事实行(db(), 项目, "m-读行", "别的表", 20)).toEqual([])
  })
})
