import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { claimNextJob, enqueueMaterial, runJob } from "../../src/server/openhive/case-ingest"

/**
 * 用途落库（01 §3.11.2 的唯一落点）：翻译层判出用途 → 事件行三列。
 *
 * 走生产出口 `enqueueMaterial → claimNextJob → runJob` 而不是直调 `插入事件`：
 * 绕过上游 `翻译资金` 的用例只证明下游的形状（`#006-35` / `#013-04` 的同款教训）。
 * 重放保护用例同时钉住「父行（事件）不被覆盖」与「父行上的用途三列一并保住」。
 */
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
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1")
  const 输出: unknown = XLSX.write(wb, { type: "array", bookType: "xlsx" })
  if (!(输出 instanceof ArrayBuffer)) throw new Error("xlsx 没有返回 ArrayBuffer")
  return new Uint8Array(输出)
}

// 备注与交易类型都不是识别字段 ⇒ 都进 extras（01 §4.0.5 坑 3）；判定只读 extras。
// extras 的键**就是表头文本**（`case-rows.ts:194` 起 `键们[i]`）；`case-row-query.ts:156`
// 已经在按 `extras["备注"]` 取备注原文 —— 这里沿用同一个键，不另起约定（`#002-06`）。
const 表头 = ["交易时间", "交易金额", "借贷标志", "交易对方账卡号", "查询账号", "备注", "交易类型"]
const 流水 = 造工作簿([
  [...表头],
  ["2024-11-09 09:15:03", 5000, "借", "6222021234567890123", "6217001234567896514", "P云停车平台缴费", "支付账户消费"],
  ["2024-11-09 10:15:03", 1200, "借", "6222021234567890123", "6217001234567896514", "", "支付账户对支付账户转账"],
])

const 文件 = new Map<string, Uint8Array>()
const deps = {
  readFile: async (sourcePath: string) => {
    const bytes = 文件.get(sourcePath)
    if (!bytes) throw new Error(`没有这个文件：${sourcePath}`)
    return bytes
  },
}

async function 跑(projectId: string, 名: string, fp: string, bytes: Uint8Array, force = false) {
  文件.set(`${projectId}/${名}`, bytes)
  const r = await enqueueMaterial(db(), {
    projectId,
    path: 名,
    sourcePath: `${projectId}/${名}`,
    fileName: 名,
    fingerprint: fp,
    // 重放用例必须显式 `force`：同指纹入队会被去重挡掉（连作业都不产生），
    // 那样测到的不是「重放保护」而是「根本没重放」——`openhive-case-ingest-translate.test.ts:139`
    // 的重放用例同样带 `force: true`。
    force,
  })
  // 同一文件里多条用例共用一个库，队列里可能还有别的项目的作业：一直认领到本材料为止，
  // 认领到的别的作业原样跑掉（与生产调度器一致）。上限 10 只是防「队列空却不报错」写成死循环。
  for (let i = 0; i < 10; i += 1) {
    const job = await claimNextJob(db())
    if (!job) throw new Error("队列是空的：刚入队的作业没被认领到")
    await runJob(db(), deps, job)
    if (job.materialId === r.materialId) return r.materialId
  }
  throw new Error("连着认领 10 个作业都没轮到刚入队的材料")
}

describe("入库判用途（01 §3.11.2 唯一落点）", () => {
  test("卡片带上 purpose / purpose_l1 / purpose_basis", async () => {
    await 跑("p-purpose-1", "a.xlsx", "fp-purpose-1", 流水)
    const 行们 = rowsOf(
      await db().execute(sql`
        select purpose, purpose_l1, purpose_basis::text as basis
          from auth.case_event
         where project_id = 'p-purpose-1'
         order by occurred_at asc
      `),
    )
    expect(行们.map((行) => `${String(行.purpose)}/${String(行.purpose_l1)}`)).toEqual(["停车/消费", "转账/转账"])
    const 依据 = JSON.parse(String(行们[0]?.basis))
    expect(依据.规则).toBe("消费.停车")
    expect(依据.命中).toBe("P云")
    expect(依据.字段).toBe("备注原文")
    expect(依据.词表).toBe("v1.0")
  })

  test("重放后人工卡不被覆盖，机器卡按当前词表重算", async () => {
    await 跑("p-purpose-2", "a.xlsx", "fp-purpose-2", 流水)
    // 模拟人工把第一张卡改成「购物」并标「已修正」（既有信任态机制，R3 不新增列）。
    await db().execute(sql`
      update auth.case_event
         set purpose = '购物', trust_state = '已修正'
       where project_id = 'p-purpose-2'
         and id = (select id from auth.case_event where project_id = 'p-purpose-2' order by occurred_at asc limit 1)
    `)
    await 跑("p-purpose-2", "a.xlsx", "fp-purpose-2", 流水, true)
    const 行们 = rowsOf(
      await db().execute(sql`
        select purpose, trust_state from auth.case_event
         where project_id = 'p-purpose-2' order by occurred_at asc
      `),
    )
    // 人工卡：purpose 仍是「购物」；机器卡：按词表重算出「转账」。
    expect(行们.map((行) => `${String(行.purpose)}/${String(行.trust_state)}`)).toEqual(["购物/已修正", "转账/自动抽取"])
  })
})
