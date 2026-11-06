import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { claimNextJob, enqueueMaterial, runJob, 沙箱内路径 } from "../../src/server/openhive/case-ingest"
import { formatFingerprint } from "../../src/server/openhive/case-mapping"
import { readSheets } from "../../src/server/openhive/case-sheet"
import { applyParseAction, countFactRows, getMaterial } from "../../src/server/openhive/case-store"

/**
 * 起夹具的方式与理由见 `openhive-case-schema.test.ts` 文件头（本包没有 pglite 依赖）。
 *
 * ⚠️ **不用夹具自带的 `pg.db`**：事务从池里独占一条连接，事务之后换了连接再准备同一句
 * 带参 SQL ⇒ `42P05`（`db.ts` 的 `PG_POOL_MAX` 注记）。而 `startProductionDb()` 给它自己
 * 那个客户端传的是**固定 env**（不含 `PG_POOL_MAX`），在 `process.env` 里配不进去。
 * 所以走生产入口 `connect()` 自建一份 `max: 1` 的客户端——形状仍是「一个进程、一条连接」。
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

function 造工作簿(sheets: Record<string, (string | number | null)[][]>): Uint8Array {
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

const 话单表头 = ["主叫号码", "被叫号码", "通话时间", "通话时长", "基站"] as const
const 话单 = 造工作簿({
  Sheet1: [
    [...话单表头],
    ["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "HZ-01"],
    ["13700000000", "13600000000", "2026-01-02 03:05", "00:01:23", "HZ-02"],
  ],
})

/** 600 行数据（文件行号 2–601）。第二块（行号 502–601）里含 550，供 C1 造中途失败。 */
const 大话单 = 造工作簿({
  Sheet1: [
    [...话单表头],
    ...Array.from({ length: 600 }, (_, i) => [
      `1380000${String(i).padStart(4, "0")}`,
      "13900000000",
      "2026-01-02 03:04:05",
      String(i % 100),
      "HZ-01",
    ]),
  ],
})

/** 9 张表（默认上限 8）⇒ `readSheets` 会报「工作表超过上限」。 */
const 九表工作簿 = 造工作簿(
  Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `S${i + 1}`,
      [
        ["主叫号码", "通话时间"],
        ["13800000000", "2026-01-02 03:04:05"],
      ],
    ]),
  ),
)

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

/** 手工造一个作业：不走队列，直接钉某份材料 / 某个文件落点（重放与截断用例用）。 */
function 手工作业(projectId: string, materialId: string, sourcePath: string) {
  return { projectId, jobId: `job-手工-${projectId}`, materialId, sourcePath }
}

describe("enqueueMaterial + runJob 主通路", () => {
  test("新文件 ⇒ 建档 ＋ 排队，认领后跑通", async () => {
    文件.set("p1/话单.xlsx", 话单)
    const r = await 入队("p1", "话单.xlsx", "fp-1")
    expect(r.enqueued).toBe(true)
    expect((await getMaterial(db(), "p1", r.materialId))?.parseStatus).toBe("排队中")

    const 排队 = rowsOf(
      await db().execute(sql`select source_path, status, started_at from auth.case_ingest_job where project_id = 'p1'`),
    )
    expect(排队[0]).toMatchObject({ source_path: "p1/话单.xlsx", status: "排队中" })
    expect(排队[0]?.started_at).toBeNull()

    const { job, 结果 } = await 跑下一条()
    expect(结果).toBe("完成")

    const 作业 = rowsOf(
      await db().execute(
        sql`select status, attempts, started_at from auth.case_ingest_job where id = ${job.jobId}`,
      ),
    )
    expect(作业[0]).toMatchObject({ status: "完成" })
    expect(Number(作业[0]?.attempts)).toBe(1)
    // 认领时写了 started_at（M5）：没有它，「这条到底跑过没有」只能靠状态猜。
    expect(Number(作业[0]?.started_at)).toBeGreaterThan(0)

    expect(await countFactRows(db(), "p1")).toBe(2)
    const material = await getMaterial(db(), "p1", job.materialId)
    expect(material?.parseStatus).toBe("已解析")
    expect(material?.kind).toBe("话单")
    expect(await 查格式行数("p1")).toBe(1)
  })
})

describe("enqueueMaterial 幂等", () => {
  test("同一个指纹再入队 ⇒ 不重复排队（判据 A2）", async () => {
    // 自己造出「已解析」状态：这一条钉的是 `case "已解析"` 分支。
    文件.set("p11/话单.xlsx", 话单)
    const 首次 = await 入队("p11", "话单.xlsx", "fp-11")
    expect((await 跑下一条()).结果).toBe("完成")

    const r = await 入队("p11", "话单.xlsx", "fp-11")
    expect(r.enqueued).toBe(false)
    expect(r.materialId).toBe(首次.materialId)
    const 材料 = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_material where project_id = 'p11'`),
    )
    expect(Number(材料[0]?.n)).toBe(1)
    const 作业 = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_ingest_job where project_id = 'p11'`),
    )
    expect(Number(作业[0]?.n)).toBe(1)
  })

  test("排队中再入队 ⇒ 不重复排队，作业仍只有一条", async () => {
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
    文件.set("p2a/话单.xlsx", 话单)
    文件.set("p2b/话单.xlsx", 话单)
    expect((await 入队("p2a", "话单.xlsx", "fp-共用")).enqueued).toBe(true)
    expect((await 跑下一条()).结果).toBe("完成")
    expect((await 入队("p2b", "话单.xlsx", "fp-共用")).enqueued).toBe(true)
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await countFactRows(db(), "p2a")).toBe(2)
    expect(await countFactRows(db(), "p2b")).toBe(2)
  })
})

describe("claimNextJob", () => {
  test("认领后同一条作业不能再被认领", async () => {
    // ⚠️ 单连接顺序调用时，第二次的子查询本来就看不到「排队中」⇒ 修前也绿。
    // 它钉的是**调用约定**（认领 ⇒ 离开可认领集合）；并发重复认领由外层
    // `and status = '排队中'` 谓词兜住（CODE 复审为准，不是这条用例）。
    文件.set("p16/话单.xlsx", 话单)
    const r = await 入队("p16", "话单.xlsx", "fp-16")
    const job = await claimNextJob(db())
    if (!job) throw new Error("没认领到作业")
    expect(job.materialId).toBe(r.materialId)
    expect(await claimNextJob(db())).toBeUndefined()
    expect(await runJob(db(), deps, job)).toBe("完成")
    const 作业 = rowsOf(
      await db().execute(sql`select attempts from auth.case_ingest_job where id = ${job.jobId}`),
    )
    expect(Number(作业[0]?.attempts)).toBe(1)
  })
})

describe("runJob", () => {
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
    // ⚠️ 必须保留至少一列认得出（主叫号码）：I3 起「所有列都认不出」按标题行处理、整份
    // 「有问题」（否则「已解析」= 0 行在骗人）。A4 讲的是**列级**认不出仍入库，前提是
    // 这张表本身被认成了一张数据表。
    文件.set("p3/怪格式.xlsx", 造工作簿({ Sheet1: [["主叫号码", "基站"], ["13800000000", "HZ-00"]] }))
    const r = await 入队("p3", "怪格式.xlsx", "fp-3")
    expect((await 跑下一条()).结果).toBe("完成")
    expect((await 读第一行("p3", r.materialId))?.extras).toEqual({ 基站: "HZ-00" })
  })

  test("文件读不出来 ⇒ 作业失败、材料落「有问题」且带原因", async () => {
    const r = await 入队("p4", "不存在.xlsx", "fp-4")
    const { job, 结果 } = await 跑下一条()
    expect(结果).toBe("失败")
    const material = await getMaterial(db(), "p4", r.materialId)
    expect(material?.parseStatus).toBe("有问题")
    expect(material?.parseDetail).toMatchObject({ reason: expect.any(String) })
    // M5：失败也要在作业表里留下可查的结论，不能只靠材料状态。
    const 作业 = rowsOf(
      await db().execute(sql`select status, error from auth.case_ingest_job where id = ${job.jobId}`),
    )
    expect(作业[0]).toMatchObject({ status: "失败" })
    expect(typeof 作业[0]?.error).toBe("string")
    expect(作业[0]?.error).not.toBe("")
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
    文件.set("p12/话单.xlsx", 话单)
    expect((await 入队("p12", "话单.xlsx", "fp-12")).enqueued).toBe(true)
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await countFactRows(db(), "p12")).toBe(2)

    await db().execute(sql`
      update auth.case_fact_row set duration_sec = 999
       where project_id = 'p12' and sheet = 'Sheet1' and row_no = 2
    `)
    const r = await 入队("p12", "话单.xlsx", "fp-12", true)
    expect(r.enqueued).toBe(true)
    expect((await 跑下一条()).结果).toBe("完成")

    expect(await countFactRows(db(), "p12")).toBe(2)
    const row = rowsOf(
      await db().execute(sql`
        select duration_sec from auth.case_fact_row
         where project_id = 'p12' and sheet = 'Sheet1' and row_no = 2
      `),
    )
    expect(Number(row[0]?.duration_sec)).toBe(37)
  })

  test("重放中途写库失败 ⇒ 旧行不被删（先删后写在同一个事务里，C1）", async () => {
    // PROBE C 的形状：旧 2 行 → 重放 600 行、第二块（行号 550）写失败。
    // 没有事务时旧行已删、只留前 500 行 —— 材料「有问题」但数据成了半份。
    文件.set("p13/话单.xlsx", 话单)
    const r = await 入队("p13", "话单.xlsx", "fp-13")
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await countFactRows(db(), "p13")).toBe(2)
    const 旧行 = rowsOf(
      await db().execute(sql`
        select row_no, caller, duration_sec from auth.case_fact_row
         where project_id = 'p13' order by row_no
      `),
    )

    文件.set("p13/大话单.xlsx", 大话单)
    await applyParseAction(db(), { projectId: "p13", materialId: r.materialId, action: "重新解析" })
    await db().execute(sql`alter table auth.case_fact_row add constraint probe_boom check (row_no <> 550)`)
    try {
      expect(await runJob(db(), deps, 手工作业("p13", r.materialId, "p13/大话单.xlsx"))).toBe("失败")
      expect(await countFactRows(db(), "p13")).toBe(2)
      const 现在 = rowsOf(
        await db().execute(sql`
          select row_no, caller, duration_sec from auth.case_fact_row
           where project_id = 'p13' order by row_no
        `),
      )
      expect(现在).toEqual(旧行)
    } finally {
      await db().execute(sql`alter table auth.case_fact_row drop constraint probe_boom`)
    }
  })

  test("工作表超过上限 ⇒ 整份不落库、材料「有问题」", async () => {
    文件.set("p14/九表.xlsx", 九表工作簿)
    const r = await 入队("p14", "九表.xlsx", "fp-14")
    expect((await 跑下一条()).结果).toBe("失败")
    const material = await getMaterial(db(), "p14", r.materialId)
    expect(material?.parseStatus).toBe("有问题")
    expect(material?.parseDetail).toMatchObject({ reason: expect.stringContaining("工作表超过上限") })
    expect(await countFactRows(db(), "p14")).toBe(0)
  })

  test("source_path 是空串的脏作业 ⇒ 材料落「有问题」，重拖能自愈（I5）", async () => {
    // `source_path` 的 schema 默认值就是空串：老数据 / 手工修库都可能留下这种作业。
    // 空检查必须在「开始」**之后**：排队中直接「出问题」是非法转移（被吞掉）⇒ 材料永远
    // 「排队中」、`该走哪个动作("排队中")` 返回 undefined ⇒ 再拖也 enqueued: false，不自愈。
    // 失败路径本身不绑事务（R28）。
    文件.set("p17/话单.xlsx", 话单)
    const r = await 入队("p17", "话单.xlsx", "fp-17")
    const 认领 = await claimNextJob(db())
    if (!认领) throw new Error("没认领到作业")

    expect(await runJob(db(), deps, { ...认领, sourcePath: "" })).toBe("失败")
    const 作业 = rowsOf(
      await db().execute(sql`select status, error from auth.case_ingest_job where id = ${认领.jobId}`),
    )
    expect(作业[0]).toMatchObject({ status: "失败" })
    expect(typeof 作业[0]?.error).toBe("string")
    expect(作业[0]?.error).not.toBe("")

    // 状态必须走到「有问题」——「排队中」是一个没有出边的死胡同。
    expect((await getMaterial(db(), "p17", r.materialId))?.parseStatus).toBe("有问题")

    // 自愈：民警把同一个文件再拖一次 ⇒ 重新解析、跑通。
    expect((await 入队("p17", "话单.xlsx", "fp-17")).enqueued).toBe(true)
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await countFactRows(db(), "p17")).toBe(2)
  })

  test("映射了时间列但一个值都解析不出 ⇒ 材料「有问题」，不谎称「已解析」（I2）", async () => {
    // 真 Date 单元格之外的另一半：列认出来了、原文有值，但值不是任何可解析格式。
    // 没有这道闸时 startedAt 全 null、材料却标「已解析」——用户以为数据进来了。
    文件.set(
      "p19/待核实.xlsx",
      造工作簿({
        Sheet1: [
          ["主叫号码", "通话时间"],
          ["13800000000", "待核实"],
          ["13700000000", "不详"],
        ],
      }),
    )
    const r = await 入队("p19", "待核实.xlsx", "fp-19")
    expect((await 跑下一条()).结果).toBe("失败")
    const material = await getMaterial(db(), "p19", r.materialId)
    expect(material?.parseStatus).toBe("有问题")
    expect(material?.parseDetail).toMatchObject({ reason: expect.stringContaining("时间") })
    expect(await countFactRows(db(), "p19")).toBe(0)
  })

  test("时间列整列为空 ⇒ 不触发失败闸（非空原文数为 0）", async () => {
    // 闸只该拦「明明有原文、却一个都没解析出来」。空列是合法数据，不能把整份文件误拒。
    文件.set(
      "p19b/空时间.xlsx",
      造工作簿({
        Sheet1: [
          ["主叫号码", "通话时间"],
          ["13800000000", null],
        ],
      }),
    )
    const r = await 入队("p19b", "空时间.xlsx", "fp-19b")
    expect((await 跑下一条()).结果).toBe("完成")
    expect((await getMaterial(db(), "p19b", r.materialId))?.parseStatus).toBe("已解析")
    expect(await countFactRows(db(), "p19b")).toBe(1)
  })

  test("一列都没认出来 ⇒ 材料「有问题」，不落任何行（I3）", async () => {
    // 标题行被当表头时，所有表的所有列都认不出。标「已解析」等于告诉民警「这份导进来了」，
    // 实际一行数据都没有。
    文件.set("p20/标题行.xlsx", 造工作簿({ Sheet1: [["通话记录导出", null, null]] }))
    const r = await 入队("p20", "标题行.xlsx", "fp-20")
    expect((await 跑下一条()).结果).toBe("失败")
    const material = await getMaterial(db(), "p20", r.materialId)
    expect(material?.parseStatus).toBe("有问题")
    expect(material?.parseDetail).toMatchObject({ reason: expect.stringContaining("一列都没认出来") })
    expect(await countFactRows(db(), "p20")).toBe(0)
  })

  test("重放时一列都没认出来 ⇒ 旧行仍在（删除在算完之后，I3）", async () => {
    文件.set("p21/话单.xlsx", 话单)
    const r = await 入队("p21", "话单.xlsx", "fp-21")
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await countFactRows(db(), "p21")).toBe(2)

    文件.set("p21/标题行.xlsx", 造工作簿({ Sheet1: [["通话记录导出", null, null]] }))
    await applyParseAction(db(), { projectId: "p21", materialId: r.materialId, action: "重新解析" })
    expect(await runJob(db(), deps, 手工作业("p21", r.materialId, "p21/标题行.xlsx"))).toBe("失败")
    expect(await countFactRows(db(), "p21")).toBe(2)
  })

  test("脏格式缓存：越界列号不算「认出来了」（I3 收口）", async () => {
    // 旧缓存里可能留下越界的列号（读格式对内容不做校验）。零列闸若只数键的个数，
    // 会把「99: caller」这种脏映射当成「认出了一列」放过 ⇒ 标「已解析」，
    // 而实际上表头一列都没认出来。只计 header 范围内的合法列号。
    const 表头 = ["随便", "别的"]
    const 工作簿 = 造工作簿({ Sheet1: [表头, ["a", "b"]] })
    const { sheets } = readSheets(工作簿)
    const 样例 = sheets[0]!.rows.slice(0, 20).map((r) => r.cells.map((c) => c.text))
    const 指纹 = formatFingerprint(表头, 样例)
    await db().execute(sql`
      insert into auth.case_table_format
        (project_id, fingerprint, header, mapping, method, unknown_columns, hit_count, created_at, updated_at)
      values ('p24', ${指纹}, ${JSON.stringify(表头)}::jsonb, ${JSON.stringify({ 99: "caller" })}::jsonb,
              '词典', 1, 0, 1, 1)
    `)

    文件.set("p24/脏缓存.xlsx", 工作簿)
    const r = await 入队("p24", "脏缓存.xlsx", "fp-24")
    expect((await 跑下一条()).结果).toBe("失败")
    const material = await getMaterial(db(), "p24", r.materialId)
    expect(material?.parseStatus).toBe("有问题")
    expect(material?.parseDetail).toMatchObject({ reason: expect.stringContaining("一列都没认出来") })
    expect(await countFactRows(db(), "p24")).toBe(0)
  })

  test("8 张有数据 ＋ 第 9 张 Excel 默认空表 ⇒ 不误拒，8 张的数据都在（I4）", async () => {
    const sheets: Record<string, (string | number | null)[][]> = {}
    for (let i = 1; i <= 8; i++) {
      sheets[`S${i}`] = [
        ["主叫号码", "通话时间"],
        ["13800000000", "2026-01-02 03:04:05"],
      ]
    }
    sheets["空表"] = []
    文件.set("p22/八表.xlsx", 造工作簿(sheets))
    const r = await 入队("p22", "八表.xlsx", "fp-22")
    expect((await 跑下一条()).结果).toBe("完成")
    expect((await getMaterial(db(), "p22", r.materialId))?.parseStatus).toBe("已解析")
    expect(await countFactRows(db(), "p22")).toBe(8)
  })

  test("格式缓存参与识别版本：旧公式算出的指纹不再命中（I6）", async () => {
    // 版本进了指纹之后，旧公式算出的行就成了不可达缓存（没有迁移负担）。
    // 这里手工插一条**旧公式**指纹 ＋ 全指 amount 的错误映射：修前会命中它（caller 全空），
    // 修后走新指纹重新识别。
    const header = 话单表头.map((h) => String(h))
    const { sheets } = readSheets(话单)
    const 样例 = sheets[0]!.rows.slice(0, 20).map((r) => r.cells.map((c) => c.text))
    // 旧公式（`formatFingerprint` 加版本之前的那一份）：[规范化表头, 列形状]
    const 规范化 = (raw: string | null) =>
      (raw ?? "").replace(/[（(【[].*?[）)】\]]/g, "").replace(/[\s　]/g, "").toLowerCase()
    const 列形状 = (values: (string | null)[][]) => {
      const sample = values.slice(0, 20)
      const width = Math.max(0, ...sample.map((r) => r.length))
      const out: string[] = []
      for (let c = 0; c < width; c++) {
        const v = sample.map((r) => r[c] ?? null).filter((x): x is string => x !== null && x.trim() !== "")
        if (v.length === 0) out.push("空")
        else if (v.every((x) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(x.trim()))) out.push("时间")
        else if (v.every((x) => /^-?\d+\.\d{2}$/.test(x.trim()))) out.push("金额")
        else if (v.every((x) => /^-?\d+$/.test(x.trim()))) out.push("整数")
        else out.push("文本")
      }
      return out
    }
    const 旧指纹 = Hash.sha256(JSON.stringify([header.map(规范化), 列形状(样例)]))
    const 错误映射 = { 0: "amount", 1: "amount", 2: "amount", 3: "amount", 4: "amount" }
    await db().execute(sql`
      insert into auth.case_table_format
        (project_id, fingerprint, header, mapping, method, unknown_columns, hit_count, created_at, updated_at)
      values ('p23', ${旧指纹}, ${JSON.stringify(header)}::jsonb, ${JSON.stringify(错误映射)}::jsonb,
              '词典', 0, 0, 1, 1)
    `)

    文件.set("p23/话单.xlsx", 话单)
    const r = await 入队("p23", "话单.xlsx", "fp-23")
    expect((await 跑下一条()).结果).toBe("完成")

    // 命中错误映射的表现：caller 空、amount = 号码（两位小数补零）。
    const row = await 读第一行("p23", r.materialId)
    expect(row?.caller).toBe("13800000000")

    // 新指纹另起一行格式记忆；旧行留着但永远不会被读到。
    const 格式行数 = rowsOf(
      await db().execute(sql`select fingerprint from auth.case_table_format where project_id = 'p23'`),
    )
    expect(格式行数).toHaveLength(2)
    expect(格式行数.map((x) => String(x.fingerprint))).toContain(旧指纹)
  })

  test("单位声明不同 ⇒ 指纹不同，不能靠缓存绕过单位闸（N1）", async () => {
    // 先导入「金额」正常表，把该格式的映射写进缓存；再导入表头「金额（万元）」、
    // **数据形状完全相同**的材料。修复前两者规范化后的指纹相同 ⇒ 命中缓存 ⇒
    // 第二份按默认单位落库（10000 倍错）且标「已解析」。修复后指纹保留原始表头 ⇒
    // 指纹不同 ⇒ 重新识别 ⇒ 万元列被单位闸拒 ⇒ 零列可识别 ⇒ 「有问题」。
    文件.set("p25/基础.xlsx", 造工作簿({ Sheet1: [["金额"], ["10000.00"], ["20000.00"]] }))
    const 第一 = await 入队("p25", "基础.xlsx", "fp-25a")
    expect((await 跑下一条()).结果).toBe("完成")
    expect((await getMaterial(db(), "p25", 第一.materialId))?.parseStatus).toBe("已解析")
    expect(await countFactRows(db(), "p25")).toBe(2)

    文件.set("p25/万元.xlsx", 造工作簿({ Sheet1: [["金额（万元）"], ["1.00"], ["2.00"]] }))
    const 第二 = await 入队("p25", "万元.xlsx", "fp-25b")
    expect((await 跑下一条()).结果).toBe("失败")
    const 材料 = await getMaterial(db(), "p25", 第二.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    expect(材料?.parseDetail).toMatchObject({ reason: expect.stringContaining("一列都没认出来") })
    // 第二份没有落任何行：项目里仍只有第一份的 2 行。
    expect(await countFactRows(db(), "p25")).toBe(2)
  })

  test("重放时截断 ⇒ 旧行还在（删除在算完之后）", async () => {
    文件.set("p15/话单.xlsx", 话单)
    const r = await 入队("p15", "话单.xlsx", "fp-15")
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await countFactRows(db(), "p15")).toBe(2)

    文件.set("p15/九表.xlsx", 九表工作簿)
    await applyParseAction(db(), { projectId: "p15", materialId: r.materialId, action: "重新解析" })
    expect(await runJob(db(), deps, 手工作业("p15", r.materialId, "p15/九表.xlsx"))).toBe("失败")
    expect(await countFactRows(db(), "p15")).toBe(2)
  })
})

describe("沙箱内路径", () => {
  const root = join(tmpdir(), "openhive-沙箱")

  test("正常相对路径落在沙箱根下（/ 分隔也可）", () => {
    expect(沙箱内路径(root, "u1/p/材料/a.xlsx")).toBe(resolve(root, "u1", "p", "材料", "a.xlsx"))
  })

  test("文件名以 .. 开头不是越界（只有 .. 与 ../ 开头才是）", () => {
    // `startsWith("..")` 会把合法的 `..foo.xlsx` 一起拒掉——过宽与过窄一样是错。
    expect(沙箱内路径(root, "..foo.xlsx")).toBe(resolve(root, "..foo.xlsx"))
    expect(沙箱内路径(root, "材料/..foo.xlsx")).toBe(resolve(root, "材料", "..foo.xlsx"))
  })

  test("越出根 / 空路径 / 绝对路径一律 undefined", () => {
    expect(沙箱内路径(root, "../../etc/passwd")).toBeUndefined()
    expect(沙箱内路径(root, "u1/../../etc/passwd")).toBeUndefined()
    expect(沙箱内路径(root, "")).toBeUndefined()
    expect(沙箱内路径(root, join(root, "u1", "a.xlsx"))).toBeUndefined()
    // win32 上反斜杠同样是分隔符：`..\..\Windows\win.ini` 必须被拒。
    if (process.platform === "win32") expect(沙箱内路径(root, "..\\..\\Windows\\win.ini")).toBeUndefined()
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
