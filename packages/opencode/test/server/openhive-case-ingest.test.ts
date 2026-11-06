import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { claimNextJob, enqueueMaterial, runJob } from "../../src/server/openhive/case-ingest"
import { countFactRows, getMaterial } from "../../src/server/openhive/case-store"

/** 起夹具的方式与理由见 `openhive-case-schema.test.ts` 文件头（本包没有 pglite 依赖）。 */
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

function 造工作簿(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
}

/** 内存文件系统：`sourcePath` → 字节。作业只认这个注入点，不直接碰盘。 */
const 文件 = new Map<string, Uint8Array>()
const deps = {
  readFile: async (sourcePath: string) => {
    const bytes = 文件.get(sourcePath)
    if (!bytes) throw new Error(`没有这个文件：${sourcePath}`)
    return bytes
  },
}

const 话单 = 造工作簿({
  Sheet1: [
    ["主叫号码", "被叫号码", "通话时间", "通话时长", "基站"],
    ["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "HZ-01"],
    ["13700000000", "13600000000", "2026-01-02 03:05", "00:01:23", "HZ-02"],
  ],
})

/** 入队的公共壳：`source_path` 在测试里就是 `项目id/文件名`，与生产形态形状相同即可。 */
const 入队 = (projectId: string, fileName: string, fingerprint: string, force?: boolean) =>
  enqueueMaterial(db(), {
    projectId,
    path: fileName,
    sourcePath: `${projectId}/${fileName}`,
    fileName,
    fingerprint,
    ...(force === undefined ? {} : { force }),
  })

/** 认领最老的一条并跑完。队列为空时直接说明，别让后面拿到 `undefined` 报个看不懂的错。 */
async function 跑下一条() {
  const job = await claimNextJob(db())
  if (!job) throw new Error("队列是空的：上一条用例把作业留在了别的状态？")
  return { job, 结果: await runJob(db(), deps, job) }
}

describe("enqueueMaterial", () => {
  test("新文件 ⇒ 建档 ＋ 排队，作业记下文件落点", async () => {
    文件.set("p1/话单.xlsx", 话单)
    const r = await 入队("p1", "话单.xlsx", "fp-1")
    expect(r.enqueued).toBe(true)
    expect((await getMaterial(db(), "p1", r.materialId))?.parseStatus).toBe("排队中")

    const 作业 = rowsOf(
      await db().execute(sql`select source_path, status from auth.case_ingest_job where project_id = 'p1'`),
    )
    expect(作业[0]).toMatchObject({ source_path: "p1/话单.xlsx", status: "排队中" })
  })
})

describe("runJob", () => {
  test("认领 → 跑通：明细行落库、类型自动判定、格式被记住、状态到「已解析」", async () => {
    const { job, 结果 } = await 跑下一条()
    expect(结果).toBe("完成")

    const 作业 = rowsOf(
      await db().execute(sql`select status, attempts from auth.case_ingest_job where id = ${job.jobId}`),
    )
    expect(作业[0]).toMatchObject({ status: "完成" })
    expect(Number(作业[0]?.attempts)).toBe(1)

    expect(await countFactRows(db(), "p1")).toBe(2)
    const material = await getMaterial(db(), "p1", job.materialId)
    expect(material?.parseStatus).toBe("已解析")
    expect(material?.kind).toBe("话单")
    expect(await 查格式行数("p1")).toBe(1)
  })

  test("同一个指纹再入队 ⇒ 不重复排队（判据 A2）", async () => {
    const r = await 入队("p1", "话单.xlsx", "fp-1")
    expect(r.enqueued).toBe(false)
    const n = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_material where project_id = 'p1'`),
    )
    expect(Number(n[0]?.n)).toBe(1)
  })

  test("排队中再入队 ⇒ 不重复排队，作业仍只有一条", async () => {
    // 上一条走的是「已解析」分支；这一条钉「排队中/解析中一律不重排」那条。
    文件.set("p7/话单.xlsx", 话单)
    const r = await 入队("p7", "话单.xlsx", "fp-7")
    expect(r.enqueued).toBe(true)
    expect((await 入队("p7", "话单.xlsx", "fp-7")).enqueued).toBe(false)
    const n = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_ingest_job where project_id = 'p7'`),
    )
    expect(Number(n[0]?.n)).toBe(1)
    // 队列是全局的：这条作业必须自己消费掉，否则下一条用例拿到的就是它。
    expect((await 跑下一条()).结果).toBe("完成")
  })

  test("别的项目同一个指纹 ⇒ 各是各的一条，各跑各的", async () => {
    文件.set("p2/话单.xlsx", 话单)
    const r = await 入队("p2", "话单.xlsx", "fp-1")
    expect(r.enqueued).toBe(true)
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await countFactRows(db(), "p2")).toBe(2)
    expect(await countFactRows(db(), "p1")).toBe(2)
  })

  test("同格式的第二个文件：命中格式缓存，hit_count 涨到 1", async () => {
    // 必须真的跑**两份**文件：只跑一份时格式行刚写进去、hit_count 是 0，断言 1 必红。
    // 两份内容相同 ⇒ 格式指纹相同；材料指纹不同 ⇒ 两份材料各建各的。
    文件.set("p6/话单-一月.xlsx", 话单)
    文件.set("p6/话单-二月.xlsx", 话单)
    await 入队("p6", "话单-一月.xlsx", "fp-6a")
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await 查格式行数("p6")).toBe(1)
    expect(await 查命中数("p6")).toBe(0)

    await 入队("p6", "话单-二月.xlsx", "fp-6b")
    expect((await 跑下一条()).结果).toBe("完成")
    // 第二份走的是同一条格式行 ⇒ 命中一次，且没有写出第二行格式。
    expect(await 查格式行数("p6")).toBe(1)
    expect(await 查命中数("p6")).toBe(1)
  })

  test("认不出的列原样进 extras（判据 A4）", async () => {
    文件.set("p3/怪格式.xlsx", 造工作簿({ Sheet1: [["甲", "乙"], ["13800000000", "HZ-00"]] }))
    const r = await 入队("p3", "怪格式.xlsx", "fp-3")
    expect((await 跑下一条()).结果).toBe("完成")
    expect((await 读第一行("p3", r.materialId))?.extras).toEqual({ 甲: "13800000000", 乙: "HZ-00" })
  })

  test("文件读不出来 ⇒ 作业失败、材料落「有问题」且带原因", async () => {
    const r = await 入队("p4", "不存在.xlsx", "fp-4")
    expect((await 跑下一条()).结果).toBe("失败")
    const material = await getMaterial(db(), "p4", r.materialId)
    expect(material?.parseStatus).toBe("有问题")
    expect(material?.parseDetail).toMatchObject({ reason: expect.any(String) })
  })

  test("字节不是表格 ⇒ 同样落「有问题」，不是崩掉 worker", async () => {
    文件.set("p5/坏文件.xlsx", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    const r = await 入队("p5", "坏文件.xlsx", "fp-5")
    expect((await 跑下一条()).结果).toBe("失败")
    expect((await getMaterial(db(), "p5", r.materialId))?.parseStatus).toBe("有问题")
  })

  test("重放：先删后写，被改花的旧行必须被覆盖回原值（设计 §5.3）", async () => {
    // ⚠️ 这一条是本计划最容易假绿的地方：`insertFactRows` 的 `on conflict do nothing`
    // 会让「没删也没写」和「真的重写了」都表现成「行数不变」。所以先手工把一行的
    // duration_sec 改成 999 —— 只有**真的删了再写**，它才会变回 37。
    await db().execute(sql`
      update auth.case_fact_row set duration_sec = 999
       where project_id = 'p1' and sheet = 'Sheet1' and row_no = 2
    `)
    const r = await 入队("p1", "话单.xlsx", "fp-1", true)
    expect(r.enqueued).toBe(true)
    expect((await 跑下一条()).结果).toBe("完成")

    expect(await countFactRows(db(), "p1")).toBe(2)
    const row = rowsOf(
      await db().execute(sql`
        select duration_sec from auth.case_fact_row
         where project_id = 'p1' and sheet = 'Sheet1' and row_no = 2
      `),
    )
    expect(Number(row[0]?.duration_sec)).toBe(37)
  })
})

async function 查命中数(projectId: string): Promise<number> {
  const rows = rowsOf(
    await db().execute(sql`select hit_count from auth.case_table_format where project_id = ${projectId}`),
  )
  return Number(rows[0]?.hit_count ?? 0)
}

async function 查格式行数(projectId: string): Promise<number> {
  const rows = rowsOf(
    await db().execute(
      sql`select count(*)::int as n from auth.case_table_format where project_id = ${projectId}`,
    ),
  )
  return Number(rows[0]?.n ?? 0)
}

async function 读第一行(projectId: string, materialId: string) {
  const rows = rowsOf(
    await db().execute(sql`
      select caller, extras from auth.case_fact_row
       where project_id = ${projectId} and material_id = ${materialId}
       order by row_no limit 1
    `),
  )
  const row = rows[0]
  if (!row) return undefined
  // jsonb 在本仓的 bun-sql 驱动下读回来是字符串（同 `getMaterial` 的归一）。
  const extras = typeof row.extras === "string" ? JSON.parse(row.extras) : row.extras
  return { caller: row.caller, extras }
}
