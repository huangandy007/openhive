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
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
}

const 表头 = ["交易时间", "交易金额", "交易余额", "借贷标志", "交易对方账卡号", "交易对方名称", "查询账号", "查询户名"]
const 流水 = 造工作簿([
  [...表头],
  ["2024-11-09 09:15:03", 5000, 12300, "借", "6222021234567890123", "李四", "6217001234567896514", "张三"],
  ["2024-11-10 10:00:00", 1200, 13500, "贷", "6222021234567890123", "李四", "6217001234567896514", "张三"],
  ["", "", "", "", "合计", "", "", ""],
])

const 文件 = new Map<string, Uint8Array>()
const deps = {
  readFile: async (sourcePath: string) => {
    const bytes = 文件.get(sourcePath)
    if (!bytes) throw new Error(`没有这个文件：${sourcePath}`)
    return bytes
  },
}

async function 跑一份(projectId: string, 名: string, fp: string) {
  文件.set(`${projectId}/${名}`, 流水)
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
    expect(detail.翻译.跳过).toMatchObject({ 合计行: 1 })
    expect(Array.isArray(detail.翻译.跳过行号)).toBe(true)
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
})

