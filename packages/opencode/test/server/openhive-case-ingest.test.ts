import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { claimNextJob, enqueueMaterial, runJob, 作业项目目录, 沙箱内路径 } from "../../src/server/openhive/case-ingest"
import { formatFingerprint } from "../../src/server/openhive/case-mapping"
import { readSheets } from "../../src/server/openhive/case-sheet"
import { applyParseAction, countFactRows, getMaterial } from "../../src/server/openhive/case-store"
import { 建假抽取器 } from "./openhive-case-extract-fixture"
import { 建实体 } from "./openhive-case-fact-fixture"

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

/** `parseDetail` 是 `unknown`：用类型谓词收窄，别在断言里写 `as`（会引入 oxlint warning）。 */
function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null
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
    const 指纹 = formatFingerprint(表头, 样例, 0)
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

  test("同一指纹的第二份材料命中缓存，待确认仍在 parse_detail 里", async () => {
    // 「金额（万元）」被单位闸拦下、进待确认；「摘要」认不出、进未知列。
    // 两份内容相同 ⇒ 格式指纹相同；材料指纹不同 ⇒ 各建各的材料。
    const 表 = [
      ["交易金额", "金额（万元）", "摘要"],
      ["1.00", "2.00", "甲"],
      ["2.00", "3.00", "乙"],
    ]
    文件.set("p-缓存/甲.xlsx", 造工作簿({ Sheet1: 表 }))
    文件.set("p-缓存/乙.xlsx", 造工作簿({ Sheet1: 表 }))
    // 队列全局且按 (queued_at, id) 取最老：同一秒入队时先后由随机 id 决定，
    // 所以别断「先跑的是甲」。两份内容相同 ⇒ 谁第二谁命中缓存。
    await db().execute(sql`delete from auth.case_ingest_job where status = '排队中'`)
    await 入队("p-缓存", "甲.xlsx", "fp-缓存-甲")
    await 入队("p-缓存", "乙.xlsx", "fp-缓存-乙")

    // 逐次跑，模拟单 worker 顺序。
    const 作业1 = await claimNextJob(db())
    if (作业1 === undefined) throw new Error("没有作业")
    expect(await runJob(db(), deps, 作业1)).toBe("完成")
    const 作业2 = await claimNextJob(db())
    if (作业2 === undefined) throw new Error("没有第二个作业")
    expect(await runJob(db(), deps, 作业2)).toBe("完成")
    // 第二份必须真的走缓存，否则这条用例测不到 result 的持久化。
    expect(await 查命中数("p-缓存")).toBe(1)

    const 材料 = await getMaterial(db(), "p-缓存", 作业2.materialId)
    const 详情 = 材料?.parseDetail
    expect(是对象(详情)).toBe(true)
    const mapping = 是对象(详情) ? 详情.mapping : undefined
    expect(是对象(mapping)).toBe(true)
    const 工作表 = 是对象(mapping) ? mapping.工作表 : undefined
    const Sheet1 = 是对象(工作表) ? 工作表.Sheet1 : undefined
    expect(是对象(Sheet1)).toBe(true)
    // 命中缓存也要有待确认：待确认只在首次识别时产生，不随 result 存下来就会消失。
    const 项 = 是对象(Sheet1) ? Sheet1.待确认 : undefined
    expect(Array.isArray(项) ? 项.length : 0).toBeGreaterThan(0)
  })

  test("格式缓存里的非法字段名被剔除，合法条目仍生效（列级降级）", async () => {
    // 直接种一行缓存：mapping 混进「垃圾」这种非识别字段。读格式必须把它剔除，
    // 但同一条 mapping 里合法的 caller 要照常生效（不能整行丢弃）。
    const 表头 = ["随便", "主叫号码"]
    const 工作簿 = 造工作簿({ Sheet1: [表头, ["x", "13800000000"]] })
    const { sheets } = readSheets(工作簿)
    const 样例 = sheets[0].rows.slice(0, 20).map((r) => r.cells.map((c) => c.text))
    const 指纹 = formatFingerprint(表头, 样例, 0)
    await db().execute(sql`
      insert into auth.case_table_format
        (project_id, fingerprint, header, mapping, method, unknown_columns, result, hit_count, created_at, updated_at)
      values ('p-脏缓存', ${指纹}, ${JSON.stringify(表头)}::text::jsonb,
              ${JSON.stringify({ 0: "垃圾", 1: "caller" })}::text::jsonb,
              '词典', 1,
              ${JSON.stringify({ 来源: { 1: "词典" }, 待确认: [], 方法: "词典", 未知列: 1 })}::text::jsonb,
              0, 1, 1)
    `)

    文件.set("p-脏缓存/脏.xlsx", 工作簿)
    // 全局队列里若有遗留的排队行，会先被认领走。
    await db().execute(sql`delete from auth.case_ingest_job where status = '排队中'`)
    const r = await 入队("p-脏缓存", "脏.xlsx", "fp-脏缓存")
    expect((await 跑下一条()).结果).toBe("完成")
    expect(await 查命中数("p-脏缓存")).toBe(1)
    expect(await 读第一行("p-脏缓存", r.materialId)).toEqual({
      caller: "13800000000",
      // 脏条目那一列降级为「未识别」⇒ 原文按原表头进 extras。
      extras: { 随便: "x" },
    })
  })

  test("格式缓存里全是非法字段名 ⇒ 一条都不算认出（脏行降级为未识别）", async () => {
    // 修复前：`{0:"垃圾"}` 也按「键的个数」计成认出 1 列，零列闸被绕过，
    // 材料标「已解析」却一行事实都没有。剔除非法条目后它等价于空映射。
    const 表头 = ["随便"]
    const 工作簿 = 造工作簿({ Sheet1: [表头, ["x"]] })
    const { sheets } = readSheets(工作簿)
    const 样例 = sheets[0].rows.slice(0, 20).map((r) => r.cells.map((c) => c.text))
    const 指纹 = formatFingerprint(表头, 样例, 0)
    await db().execute(sql`
      insert into auth.case_table_format
        (project_id, fingerprint, header, mapping, method, unknown_columns, result, hit_count, created_at, updated_at)
      values ('p-脏缓存2', ${指纹}, ${JSON.stringify(表头)}::text::jsonb,
              ${JSON.stringify({ 0: "垃圾" })}::text::jsonb,
              '词典', 1,
              ${JSON.stringify({ 来源: {}, 待确认: [], 方法: "词典", 未知列: 1 })}::text::jsonb,
              0, 1, 1)
    `)

    文件.set("p-脏缓存2/脏.xlsx", 工作簿)
    await db().execute(sql`delete from auth.case_ingest_job where status = '排队中'`)
    const r = await 入队("p-脏缓存2", "脏.xlsx", "fp-脏缓存2")
    expect((await 跑下一条()).结果).toBe("失败")
    const 材料 = await getMaterial(db(), "p-脏缓存2", r.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    expect(材料?.parseDetail).toMatchObject({ reason: expect.stringContaining("一列都没认出来") })
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

describe("作业项目目录", () => {
  const root = join(tmpdir(), "openhive-作业目录")

  test("两段用户/项目 + 文件 ⇒ 项目目录", () => {
    expect(作业项目目录(root, "u1/p/材料/笔录.txt", "p")).toBe(join(root, "u1", "p"))
  })

  test("不足三段 ⇒ 拒", () => {
    expect(作业项目目录(root, "u1/p", "p")).toBeUndefined()
    expect(作业项目目录(root, "", "p")).toBeUndefined()
  })

  test("前导斜杠 / 空段 / . / .. 落在前两段 ⇒ 拒", () => {
    expect(作业项目目录(root, "/u1/p/a.txt", "p")).toBeUndefined()
    expect(作业项目目录(root, "./p/a.txt", "p")).toBeUndefined()
    expect(作业项目目录(root, "u1/../p/a.txt", "p")).toBeUndefined()
    expect(作业项目目录(root, "../u1/p/a.txt", "p")).toBeUndefined()
  })

  test("第二段与作业的 projectId 不一致 ⇒ 拒（别用别的项目的模型配置）", () => {
    expect(作业项目目录(root, "u1/别人的/a.txt", "p")).toBeUndefined()
  })

  test("后段出现 . / .. / 空段 ⇒ 拒（写者不会这么给）", () => {
    expect(作业项目目录(root, "u1/p/../别人的/a.txt", "p")).toBeUndefined()
    expect(作业项目目录(root, "u1/p/./a.txt", "p")).toBeUndefined()
    expect(作业项目目录(root, "u1/p//a.txt", "p")).toBeUndefined()
  })

  test("反斜杠不是分隔符（Windows 单段路径直接拒）", () => {
    expect(作业项目目录(root, "u1\\p\\a.txt", "p")).toBeUndefined()
  })

  test("混合分隔符不许把 .. 带出沙箱根", () => {
    // 只按 `/` 切段时第二段仍是 `p`（项目闸通过），但 win32 的 `join` 认 `\`
    // 并把 `..` 归一 ⇒ 目录落到沙箱根之外。POSIX 上 `\` 只是普通字符，构造不出越界，
    // 与上面「反斜杠」那一条同款：只在 win32 断言（否则 Linux CI 是一条假红）。
    if (process.platform === "win32")
      expect(作业项目目录(root, "u1\\..\\../p/a.txt", "p")).toBeUndefined()
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

/**
 * bun 1.4.3 会把绑给 jsonb 参数的 JS 字符串再编码一次；写侧不加 `::text` 时落库是
 * **JSON 字符串**（`jsonb_typeof = 'string'`），`header->>0` 取不到列名。读路径的
 * `typeof === "string" ? JSON.parse` 会把错形状也读对，所以只有 SQL 侧取值能揭穿它。
 */
describe("表格格式缓存的 jsonb 形状", () => {
  test("header 落成 array、mapping 落成 object，SQL 侧能取到列名", async () => {
    // `claimNextJob` 是全局 FIFO：别的 describe 留下一条件排队作业，这里就会认领到它，
    // 红在「完成/失败」而不是 jsonb 上。认领前先清干净（与「人工入库置顶」组的 `清空队列` 同款）。
    await db().execute(sql`delete from auth.case_ingest_job where status = '排队中'`)
    文件.set("p-jsonb-表/话单.xlsx", 话单)
    await 入队("p-jsonb-表", "话单.xlsx", "fp-jsonb-表")
    expect((await 跑下一条()).结果).toBe("完成")
    const 行 = rowsOf(
      await db().execute(sql`
        select jsonb_typeof(header) as 头条, jsonb_typeof(mapping) as 映射,
               header->>0 as 首列
          from auth.case_table_format where project_id = 'p-jsonb-表'
      `),
    )
    expect(行[0]?.头条).toBe("array")
    expect(行[0]?.映射).toBe("object")
    expect(行[0]?.首列).toBe("主叫号码")
  })
})

describe("文本作业（计划 4）", () => {
  afterEach(async () => {
    // 作业表**必须一起清**：队列是全局的，上一条用例若在认领前/中途失败，留下的「排队中」
    // 作业会被下一条用例认领走，`认领本材料` 于是抛「认领到别人的作业」——一条失败连累五条。
    await db().execute(sql`delete from auth.case_ingest_job where project_id = ${"p-txt"}`)
    await db().execute(sql`delete from auth.case_citation where project_id = ${"p-txt"}`)
    await db().execute(sql`delete from auth.case_relation where project_id = ${"p-txt"}`)
    await db().execute(sql`delete from auth.case_event where project_id = ${"p-txt"}`)
    await db().execute(sql`delete from auth.case_entity where project_id = ${"p-txt"}`)
    await db().execute(sql`delete from auth.case_material where project_id = ${"p-txt"}`)
  })

  const 文本 = "2026年3月5日，张三（13800138000）向李四转账28万元。\n李四说张三还欠他3万元。"
  const 回答 = {
    实体: [
      { 类型: "人", 取值: "张三" },
      { 类型: "人", 取值: "李四" },
      { 类型: "号码", 取值: "13800138000" },
    ],
    关系: [{ 类型: "转账", 从: "张三", 到: "李四", 金额原文: "28万", 原文: "张三（13800138000）向李四转账28万元" }],
    事件: [{ 类型: "转账", 时间原文: "2026年3月5日", 参与人: ["张三", "李四"], 原文: "2026年3月5日，张三（13800138000）向李四转账28万元" }],
  }

  async function 入队文本(fileName = "笔录.txt", 内容 = 文本) {
    文件.set(`p-txt/${fileName}`, new TextEncoder().encode(内容))
    return 入队("p-txt", fileName, `fp-${fileName}`)
  }

  /** 队列是全局的：认领完必须核对是本用例那份，否则后续断言会对着别人的材料说话。 */
  async function 认领本材料(materialId: string) {
    const job = await claimNextJob(db())
    if (!job) throw new Error("队列是空的：上一条用例把作业留在了别的状态？")
    if (job.materialId !== materialId) throw new Error(`认领到别人的作业：${job.materialId}`)
    return job
  }

  test("一份笔录 ⇒ 实体/关系/事件/引用落库，材料「已解析」，text_content 有全文", async () => {
    const 入 = await 入队文本()
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => 回答)
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)
    expect(r).toBe("完成")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("已解析")
    // 成功路径也要留下片数与重试次数：审计三件套与 A17 的回读通过率都靠它们。
    // 片数写 `sliceCount`：`slices` 在前端契约里是**问题切片数组**（见下面那条契约用例）。
    const 明细 = 材料?.parseDetail
    if (!是对象(明细)) throw new Error("parse_detail 不是对象")
    expect(typeof 明细.sliceCount).toBe("number")
    expect(Number(明细.sliceCount)).toBeGreaterThanOrEqual(1)
    expect(typeof 明细.attempts).toBe("number")
    expect(Number(明细.attempts)).toBeGreaterThanOrEqual(1)
    // 不在这里断言 kind：本用例走 `enqueueMaterial`（默认 `其他`），类型猜测在 `入队材料`
    // 那一层（Task 1 已测）。文本分支本身不读 kind，别把两件事钉在一处。

    const 关系 = rowsOf(await db().execute(sql`
      select type, amount, trust_state from auth.case_relation where project_id = 'p-txt'
    `))
    expect(关系.length).toBe(1)
    expect(关系[0]?.amount).toBe("280000.00")
    expect(关系[0]?.trust_state).toBe("自动抽取")

    const 实体 = rowsOf(await db().execute(sql`
      select canonical_value from auth.case_entity where project_id = 'p-txt'
    `))
    // 中文与数字混排的排序取决于库的 collation：比集合，不比序列。
    expect(实体.map((e) => String(e.canonical_value)).sort()).toEqual(
      ["13800138000", "张三", "李四"].sort(),
    )

    const 引用 = rowsOf(await db().execute(sql`
      select fact_type, extract_method from auth.case_citation where project_id = 'p-txt'
    `))
    // 3 实体 ＋ 1 关系 ＋ 1 事件。
    expect(引用.length).toBe(5)
    expect(引用.every((c) => c.extract_method === "机器")).toBe(true)

    // 事件也必须落库——只断关系/实体的话，事件写入整段删掉这条用例仍绿。
    const 事件行 = rowsOf(await db().execute(sql`
      select type, trust_state from auth.case_event where project_id = 'p-txt'
    `))
    expect(事件行.length).toBe(1)
    expect(事件行[0]?.type).toBe("转账")
    expect(事件行[0]?.trust_state).toBe("自动抽取")

    const 行 = rowsOf(await db().execute(sql`
      select text_content from auth.case_material where project_id = 'p-txt'
    `))
    expect(行[0]?.text_content).toBe(文本)
  })

  // 模型会把 16 位卡号写成「号码」。大类在**写入口**纠正（`纠正大类`），关系两端也要
  // 跟着按纠正后的大类去找实体——否则这类材料的关系会静默丢掉（`from/to` 取不到就 continue），
  // 而实体表里只剩一条错类的号码。两处一起钉，少钉一处就是「纠正了但关系没了」。
  test("卡号被抽成「号码」⇒ 落库是「账户」，关系两端也接得上", async () => {
    const 卡号 = "6222020000000001"
    const 原文 = `2026年3月5日，张三向账户${卡号}转账28万元。`
    const 入 = await 入队文本("卡号.txt", 原文)
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "张三" },
        { 类型: "号码", 取值: 卡号 },
      ],
      关系: [{ 类型: "转账", 从: "张三", 到: 卡号, 金额原文: "28万", 原文 }],
      事件: [],
    }))
    expect(await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)).toBe("完成")

    const 实体 = rowsOf(await db().execute(sql`
      select type, canonical_value from auth.case_entity where project_id = 'p-txt'
    `))
    expect(实体.map((e) => `${String(e.type)}|${String(e.canonical_value)}`).sort()).toEqual(
      ["人|张三", `账户|${卡号}`].sort(),
    )

    const 关系 = rowsOf(await db().execute(sql`
      select t.type as to_type, t.canonical_value as to_value
      from auth.case_relation r
      join auth.case_entity t on t.project_id = r.project_id and t.id = r.to_id
      where r.project_id = 'p-txt'
    `))
    // 关系没丢、且落在纠正后的账户上：只纠正实体而漏掉端点查找时，这里会是 0 行。
    expect(关系.length).toBe(1)
    expect(关系[0]?.to_type).toBe("账户")
    expect(关系[0]?.to_value).toBe(卡号)
  })

  test("人名带组织后缀 ⇒ 落库是「组织」，关系两端也接得上；旧「人」行可并存", async () => {
    const 单位 = "柏加派出所"
    const 原文 = `2026年3月5日，张三到${单位}办理实名登记。`
    // 存量里已经有一条同值的「人」行：唯一索引含 type，两行可以并存，不报错。
    await 建实体(db(), { id: "e-旧人行", projectId: "p-txt", value: 单位, type: "人" })

    const 入 = await 入队文本("组织.txt", 原文)
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "张三" },
        { 类型: "人", 取值: 单位 },
      ],
      关系: [{ 类型: "实名登记", 从: "张三", 到: 单位, 依据: "笔录记载", 原文 }],
      事件: [],
    }))
    expect(await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)).toBe("完成")

    const 实体 = rowsOf(await db().execute(sql`
      select type, canonical_value from auth.case_entity
       where project_id = 'p-txt' and canonical_value = ${单位}
       order by type
    `))
    // 旧「人」行还在，新「组织」行已落库；不是覆盖。
    expect(实体.map((行) => String(行.type)).sort()).toEqual(["人", "组织"])

    const 关系 = rowsOf(await db().execute(sql`
      select t.type as to_type, t.canonical_value as to_value
      from auth.case_relation r
      join auth.case_entity t on t.project_id = r.project_id and t.id = r.to_id
      where r.project_id = 'p-txt'
    `))
    // 关系没丢、且落在纠正后的组织上：端点查找只硬列人/号码/账户时，这里会是 0 行。
    expect(关系.length).toBe(1)
    expect(关系[0]?.to_type).toBe("组织")
    expect(关系[0]?.to_value).toBe(单位)
  })

  test("关系端点是声明为「地点」的实体 ⇒ 关系落库且 to_type = 地点（端点候选扩到八类）", async () => {
    const 地点 = "城东茶馆"
    const 原文 = `2026年3月5日，张三在${地点}与李四见面。`
    const 入 = await 入队文本("地点端点.txt", 原文)
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "张三" },
        // 模型把地点**声明**成地点：关系端点必须落到这条上，不能被推断成「人」。
        { 类型: "地点", 取值: 地点 },
      ],
      关系: [{ 类型: "同行", 从: "张三", 到: 地点, 依据: "笔录记载", 原文 }],
      事件: [],
    }))
    expect(await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)).toBe("完成")

    const 关系 = rowsOf(await db().execute(sql`
      select t.type as to_type, t.canonical_value as to_value
      from auth.case_relation r
      join auth.case_entity t on t.project_id = r.project_id and t.id = r.to_id
      where r.project_id = 'p-txt'
    `))
    // 端点候选只列人/号码/账户时，这里会是 0 行（关系被静默丢弃）。
    expect(关系.length).toBe(1)
    expect(关系[0]?.to_type).toBe("地点")
    expect(关系[0]?.to_value).toBe(地点)
  })

  test("材料写着细类、形状又判不出的实体：细类落进 attrs", async () => {
    const 原文 = "张三的支付宝账号是1234567890，用于收款。"
    const 入 = await 入队文本("支付宝.txt", 原文)
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => ({
      实体: [{ 类型: "账户", 取值: "1234567890", 细类: "第三方支付" }],
      关系: [],
      事件: [],
    }))
    expect(await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)).toBe("完成")

    const 行 = rowsOf(await db().execute(sql`
      select type, attrs from auth.case_entity where project_id = 'p-txt'
    `))
    expect(行.length).toBe(1)
    expect(行[0]?.type).toBe("账户")
    // PGlite 的 jsonb 读回是 JSON 文本，别的驱动可能是对象：两种都认。
    const 原始属性 = 行[0]?.attrs
    const 属性 = typeof 原始属性 === "string" ? JSON.parse(原始属性) : 原始属性
    expect(属性).toEqual({ subtype: "第三方支付" })
  })

  test("形状判得出的实体：模型写的细类不落库（压不过形状）", async () => {
    const 入 = await 入队文本("手机号.txt", "张三的手机号13800000001，登记为固定电话。")
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => ({
      实体: [{ 类型: "号码", 取值: "13800000001", 细类: "固定电话" }],
      关系: [],
      事件: [],
    }))
    expect(await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)).toBe("完成")

    const 行 = rowsOf(await db().execute(sql`
      select attrs from auth.case_entity where project_id = 'p-txt'
    `))
    const 原始属性 = 行[0]?.attrs
    const 属性 = typeof 原始属性 === "string" ? JSON.parse(原始属性) : 原始属性
    // 存下来只会让下一个人以为「原文写了固定电话、显示却是手机号」是 bug。
    expect(属性?.subtype).toBeUndefined()
  })

  // 钉住「后端 parse_detail 与前端解析器同名不同形」这个坑：`slices` 在前端契约里是
  // **问题切片数组**（`packages/app/src/project/case-materials-api.ts:96-116` 的 `解析问题`：
  // 有就必须是对象数组、每项 range/reason/count 齐全），不是「片数」。成功路径曾把它写成
  // `slices: <number>` ⇒ 前端 `解析清单` 判「服务端回包形状不对」，整份材料列表都加载失败。
  test("契约：成功路径的 parse_detail 不含 slices 键（片数走 sliceCount）", async () => {
    const 入 = await 入队文本("契约.txt")
    const job = await 认领本材料(入.materialId)
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 建假抽取器(() => 回答) }, job)
    expect(r).toBe("完成")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("已解析")
    const 明细 = 材料?.parseDetail
    if (!是对象(明细)) throw new Error("parse_detail 不是对象")
    // 用前端同一个判据验一遍：reason 有就必须是字符串；slices 有就必须是数组。
    expect(明细.reason === undefined || typeof 明细.reason === "string").toBe(true)
    expect(明细.slices === undefined || Array.isArray(明细.slices)).toBe(true)
    // 成功路径不该有 `slices`——片数走 sliceCount，避免与「问题切片数组」同名不同形。
    expect("slices" in 明细).toBe(false)
    expect(typeof 明细.sliceCount).toBe("number")
  })

  test("只有合法缺失（事件没给时间）⇒ 材料「已解析」，提示进 parse_detail.notes（I2）", async () => {
    const 入 = await 入队文本("合法缺失.txt", "张三与李四见面。")
    const job = await 认领本材料(入.materialId)
    const r = await runJob(
      db(),
      {
        ...deps,
        建抽取器: async () =>
          建假抽取器(() => ({
            实体: [{ 类型: "人", 取值: "张三" }],
            关系: [],
            // 只缺时间：这是设计 §7.4 允许的输出（标存疑转人工），不是「没抽干净」。
            事件: [{ 类型: "见面", 参与人: ["张三"], 原文: "张三与李四见面" }],
          })),
      },
      job,
    )
    expect(r).toBe("完成")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("已解析")
    const 明细 = 材料?.parseDetail
    if (!是对象(明细)) throw new Error("parse_detail 不是对象")
    expect(Array.isArray(明细.notes)).toBe(true)
    expect(明细.notes).toEqual(expect.arrayContaining([expect.stringContaining("没有给时间")]))
  })

  // 「有问题」分支的 notes 与限长（N3-2）。切片按行边界、每片 1500 字：这里造两行各 800 字
  // ⇒ 恰好两片。片 1 只给「事件没时间」这类合法缺失（提示），片 2 回 `{}`（结构非法 ⇒ 问题片），
  // 于是材料落「有问题」而 notes 里仍有片 1 的提示。
  // 片 1 里再放 26 条提示：1 条时间认不出（拼出 >200 字的原文，验截断）＋ 25 条没有给时间，
  // 总数超过 20 ⇒ 验上限。断言只依赖 notes 本身，不重构生产代码。
  test("「有问题」分支也带 notes，且限长 20 条 / 每条 200 字（N3-2）", async () => {
    const 长原文 = "甲".repeat(300)
    const 看不清的时间 = "甲".repeat(250)
    const 行1 = `张三与李四见面。${"甲".repeat(800)}`
    const 行2 = "乙".repeat(800)
    const 入 = await 入队文本("两片.txt", `${行1}\n${行2}`)

    const job = await 认领本材料(入.materialId)
    const r = await runJob(
      db(),
      {
        ...deps,
        建抽取器: async () =>
          建假抽取器((片序号) => {
            if (片序号 !== 1) return {}
            return {
              实体: [
                { 类型: "人", 取值: "张三" },
                { 类型: "人", 取值: "李四" },
              ],
              关系: [],
              事件: [
                // 时间原文在出处里、但归一看不出 ⇒ 进提示，且拼出来超过 200 字。
                { 类型: "聚会", 时间原文: 看不清的时间, 参与人: [], 原文: 长原文 },
                // 合法缺失：25 条都没有时间 ⇒ 25 条提示，与上一条合计 26 条。
                ...Array.from({ length: 25 }, (_, i) => ({
                  类型: `见面${i}`,
                  参与人: ["张三"],
                  原文: "张三与李四见面",
                })),
              ],
            }
          }),
      },
      job,
    )
    expect(r).toBe("完成")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    const 明细 = 材料?.parseDetail
    if (!是对象(明细)) throw new Error("parse_detail 不是对象")
    // 「有问题」分支要有逐片明细（前端黄三角要它），也要有提示。
    expect(Array.isArray(明细.slices)).toBe(true)
    const notes = 明细.notes
    if (!Array.isArray(notes)) throw new Error("parse_detail.notes 不是数组")
    expect(notes.length).toBe(20)
    for (const 一条 of notes) {
      if (typeof 一条 !== "string") throw new Error("notes 里有非字符串")
      expect(一条.length).toBeLessThanOrEqual(200)
    }
    // 第一条（时间认不出）原文超 200 字 ⇒ 被截到恰好 200 字。
    expect(notes.some((一条) => typeof 一条 === "string" && 一条.length === 200)).toBe(true)
    expect(notes).toEqual(expect.arrayContaining([expect.stringContaining("没有给时间")]))
  })

  test("回读不过 N 次 ⇒ 材料「有问题」＋ 作业「失败」（0 成功不得记完成）", async () => {
    const 入 = await 入队文本()
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => ({
      实体: [{ 类型: "人", 取值: "王五" }], 关系: [], 事件: [],
    }))
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)
    expect(r).toBe("失败")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    // 不用 `as` 收窄：`toMatchObject` 能直接对 `unknown` 断言，且数组要求长度相等，
    // 「slices 只有 1 段」仍被钉住。该输入固定，模型只产出「王五找不到」这一条问题。
    const 明细 = 材料?.parseDetail
    expect(明细).toMatchObject({
      attempts: 3,
      factCount: 0,
      slices: [{ range: expect.stringContaining("0-"), count: 1 }],
    })

    // M5：作业表要留下可查的结论，不能只靠材料状态。
    const 作业 = rowsOf(await db().execute(sql`select status, error from auth.case_ingest_job where id = ${job.jobId}`))
    expect(作业[0]).toMatchObject({ status: "失败" })
    expect(String(作业[0]?.error)).toContain("全部 1 段")
  })

  test("两片都失败 ⇒ 作业「失败」、error 带片数", async () => {
    // 两行各 800 字 ⇒ 恰好两片。两片都回 `{}`（结构非法）⇒ 全部片失败。
    const 入 = await 入队文本("两片全坏.txt", `${"甲".repeat(800)}\n${"乙".repeat(800)}`)
    const job = await 认领本材料(入.materialId)
    const r = await runJob(
      db(),
      { ...deps, 建抽取器: async () => ({ ...建假抽取器(() => ({})), 模型来源: "task_model" }) },
      job,
    )
    expect(r).toBe("失败")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    // 审计字段：模型来源随「有问题」分支写进 parse_detail（假抽取器默认不填，这里显式给）。
    expect(材料?.parseDetail).toMatchObject({ modelSource: "task_model" })
    const 作业 = rowsOf(await db().execute(sql`select status, error from auth.case_ingest_job where id = ${job.jobId}`))
    expect(作业[0]).toMatchObject({ status: "失败" })
    expect(String(作业[0]?.error)).toContain("全部 2 段")
  })

  test("重放：改模型回答后重新解析，旧关系被删、新关系落库，实体不重复", async () => {
    const 入 = await 入队文本()
    const 第一次 = await 认领本材料(入.materialId)
    await runJob(db(), { ...deps, 建抽取器: async () => 建假抽取器(() => 回答) }, 第一次)

    // 走生产出口重排：`applyParseAction("重新解析")` 只改材料状态、**不建作业**，
    // 单独调它之后 `claimNextJob` 拿不到东西。同一个文件再来一次（force）才是生产里
    // 民警点「重新解析」走的路径。
    const 重排 = await 入队("p-txt", "笔录.txt", "fp-笔录.txt", true)
    expect(重排.enqueued).toBe(true)
    const 第二次 = await 认领本材料(入.materialId)
    const 改后 = {
      ...回答,
      // 出处里必须同时有「张三」和「李四」：回读要逐字核对两端角色，缺一个整条关系会被丢。
      关系: [{ 类型: "转账", 从: "张三", 到: "李四", 金额原文: "3万", 原文: "李四说张三还欠他3万元" }],
    }
    await runJob(db(), { ...deps, 建抽取器: async () => 建假抽取器(() => 改后) }, 第二次)

    const 关系 = rowsOf(await db().execute(sql`
      select amount from auth.case_relation where project_id = 'p-txt'
    `))
    expect(关系.map((r) => r.amount)).toEqual(["30000.00"])
    const 实体 = rowsOf(await db().execute(sql`
      select count(*)::int as n from auth.case_entity where project_id = 'p-txt'
    `))
    expect(实体[0]?.n).toBe(3)
  })

  // I3 保留「已确认事实」的引用之后，重放若又抽到**同一条**事实，`引用id` 与上次完全相同：
  // `insertRelation` 有 `on conflict do nothing` 不炸，`addCitation` 再裸插就是 23505，
  // 整个事务回滚、重放硬失败。人工确认入口在计划 5，但这条链路现在就得能跑。
  test("重放又抽到同一条人工事实：引用不撞主键，重放照跑（N1）", async () => {
    const 入 = await 入队文本()
    const 第一次 = await 认领本材料(入.materialId)
    await runJob(db(), { ...deps, 建抽取器: async () => 建假抽取器(() => 回答) }, 第一次)

    // 模拟计划 5 的人工确认入口（计划 4 还没有写这个状态的 UI）：把唯一那条关系标成已确认。
    await db().execute(sql`
      update auth.case_relation set trust_state = '已确认' where project_id = 'p-txt'
    `)

    const 重排 = await 入队("p-txt", "笔录.txt", "fp-笔录.txt", true)
    expect(重排.enqueued).toBe(true)
    const 第二次 = await 认领本材料(入.materialId)
    // 回**同一份**回答 ⇒ 同一事实 id、同一片起 ⇒ 同一引用 id。
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 建假抽取器(() => 回答) }, 第二次)
    expect(r).toBe("完成")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("已解析")
    const 关系 = rowsOf(await db().execute(sql`
      select trust_state from auth.case_relation where project_id = 'p-txt'
    `))
    expect(关系.length).toBe(1)
    expect(关系[0]?.trust_state).toBe("已确认")
    // 保留下来的引用只有一条：重插同 id 必须「什么都不做」，而不是再加一条或炸掉。
    const 引用 = rowsOf(await db().execute(sql`
      select count(*)::int as n from auth.case_citation
       where project_id = 'p-txt' and fact_type = 'relation'
    `))
    expect(引用[0]?.n).toBe(1)
  })

  test("全部片失败的重放：零事实不删旧事实与旧引用（C1）", async () => {
    const 入 = await 入队文本()
    const 第一次 = await 认领本材料(入.materialId)
    await runJob(db(), { ...deps, 建抽取器: async () => 建假抽取器(() => 回答) }, 第一次)

    // 直接查事实表与引用表（不是材料视图的 factCount）：这一条要钉的是「行还在不在」。
    const 事实数 = async () => {
      const r = rowsOf(
        await db().execute(sql`
          select
            (select count(*)::int from auth.case_relation where project_id = 'p-txt') as 关系,
            (select count(*)::int from auth.case_event where project_id = 'p-txt') as 事件,
            (select count(*)::int from auth.case_citation where project_id = 'p-txt') as 引用
        `),
      )
      return r[0]
    }
    expect(await 事实数()).toMatchObject({ 关系: 1, 事件: 1, 引用: 5 })

    const 重排 = await 入队("p-txt", "笔录.txt", "fp-笔录.txt", true)
    expect(重排.enqueued).toBe(true)
    const 第二次 = await 认领本材料(入.materialId)
    // `{}` 每一片 3 次都过不了结构校验 ⇒ 零事实、问题片非空。修前会先删旧事实再写 0 条；
    // 零成功切片 ⇒ 作业记「失败」（T4）。
    const r = await runJob(
      db(),
      { ...deps, 建抽取器: async () => 建假抽取器(() => ({})) },
      第二次,
    )
    expect(r).toBe("失败")

    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    const 明细 = 材料?.parseDetail
    if (!是对象(明细) || !Array.isArray(明细.slices))
      throw new Error("parse_detail.slices 不是数组")
    expect(明细.slices.length).toBeGreaterThan(0)

    // 上一次的关系/事件/引用必须原样还在：删了它就是拿失败覆盖成功。
    expect(await 事实数()).toMatchObject({ 关系: 1, 事件: 1, 引用: 5 })
  })

  test("取消（一片都没跑）后不再调模型、状态不被推进", async () => {
    const 入 = await 入队文本()
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => 回答)
    // 「跑到一半点取消」在单测里表达不出来（`runJob` 内部才构造 `仍应继续`），
    // 这里构造相同的**入库时刻**：作业已认领，材料已是「有问题」（用户点过取消）。
    await applyParseAction(db(), { projectId: "p-txt", materialId: 入.materialId, action: "开始" })
    await applyParseAction(db(), { projectId: "p-txt", materialId: 入.materialId, action: "取消" })
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)
    expect(r).toBe("完成")
    expect(假.调用次数()).toBe(0)
    expect((await getMaterial(db(), "p-txt", 入.materialId))?.parseStatus).toBe("有问题")
  })

  test("取消（一片都没跑）⇒ 上一次解析的事实原样保留，不清空", async () => {
    const 入 = await 入队文本()
    const 第一次 = await 认领本材料(入.materialId)
    await runJob(db(), { ...deps, 建抽取器: async () => 建假抽取器(() => 回答) }, 第一次)

    const 重排 = await 入队("p-txt", "笔录.txt", "fp-笔录.txt", true)
    expect(重排.enqueued).toBe(true)
    const 第二次 = await 认领本材料(入.materialId)
    // 模拟「跑到一半点取消」的入库时刻：排队中 →（开始）→ 解析中 →（取消）→ 有问题。
    await applyParseAction(db(), { projectId: "p-txt", materialId: 入.materialId, action: "开始" })
    await applyParseAction(db(), { projectId: "p-txt", materialId: 入.materialId, action: "取消" })

    const 假 = 建假抽取器(() => 回答)
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 假 }, 第二次)
    expect(r).toBe("完成")
    expect(假.调用次数()).toBe(0)

    // 旧事实必须还在：删了它就是「取消 = 清空」。
    const 关系 = rowsOf(await db().execute(sql`
      select amount from auth.case_relation where project_id = 'p-txt'
    `))
    expect(关系.map((x) => x.amount)).toEqual(["280000.00"])
    const 引用 = rowsOf(await db().execute(sql`
      select count(*)::int as n from auth.case_citation where project_id = 'p-txt'
    `))
    expect(引用[0]?.n).toBe(5)
    expect((await getMaterial(db(), "p-txt", 入.materialId))?.parseStatus).toBe("有问题")
  })

  test("金额在出处里找不到 ⇒ 关系仍落库、trust_state「存疑」、金额为空", async () => {
    const 入 = await 入队文本()
    const job = await 认领本材料(入.materialId)
    const 假 = 建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "张三" },
        { 类型: "人", 取值: "李四" },
      ],
      // 「5万」不在出处里 ⇒ 回读把金额置空并标存疑；事实本身照常入库（设计 §7.4）。
      关系: [{ 类型: "转账", 从: "张三", 到: "李四", 金额原文: "5万", 原文: "李四说张三还欠他3万元" }],
      事件: [],
    }))
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)
    expect(r).toBe("完成")

    const 关系 = rowsOf(await db().execute(sql`
      select amount, trust_state from auth.case_relation where project_id = 'p-txt'
    `))
    expect(关系.length).toBe(1)
    expect(关系[0]?.amount).toBeNull()
    expect(关系[0]?.trust_state).toBe("存疑")
    // 有问题的片 ⇒ 材料「有问题」，但作业是跑完了的。
    expect((await getMaterial(db(), "p-txt", 入.materialId))?.parseStatus).toBe("有问题")
  })

  test("一条事实都抽不出 ⇒ 「有问题」，不是「已解析 · 0 条」", async () => {
    const 入 = await 入队文本()
    const job = await 认领本材料(入.materialId)
    const r = await runJob(db(), {
      ...deps,
      建抽取器: async () => 建假抽取器(() => ({ 实体: [], 关系: [], 事件: [] })),
    }, job)
    expect(r).toBe("失败")
    expect((await getMaterial(db(), "p-txt", 入.materialId))?.parseStatus).toBe("有问题")
  })

  test("没有抽取器 ⇒ 可解释地失败，不写半截事实", async () => {
    const 入 = await 入队文本()
    const job = await 认领本材料(入.materialId)
    const r = await runJob(db(), deps, job)
    expect(r).toBe("失败")
    const 材料 = await getMaterial(db(), "p-txt", 入.materialId)
    expect(材料?.parseStatus).toBe("有问题")
    expect(材料?.parseDetail).toMatchObject({ reason: expect.stringContaining("没有配置抽取模型") })
  })

  test("同片两条同型同时间的事件（原文不同）都落库；完全重复的只落一条，不撞引用主键", async () => {
    // 第三句单独给关系用：金额「3万」必须在**该关系的出处**里，否则会多出一条「金额找不到」的
    // 问题（不影响结论，但会把这条用例的意图搅浑）。
    const 内容 = "2026年3月5日，张三与李四见面。2026年3月5日，张三又与李四见面。李四说张三还欠他3万元。"
    const 入 = await 入队文本("重复事件.txt", 内容)
    const job = await 认领本材料(入.materialId)
    const 关系一条 = { 类型: "转账", 从: "张三", 到: "李四", 金额原文: "3万", 原文: "李四说张三还欠他3万元" }
    const 甲 = {
      类型: "见面", 时间原文: "2026年3月5日", 参与人: ["张三", "李四"],
      原文: "2026年3月5日，张三与李四见面",
    }
    const 乙 = {
      类型: "见面", 时间原文: "2026年3月5日", 参与人: ["张三", "李四"],
      原文: "2026年3月5日，张三又与李四见面",
    }
    const 假 = 建假抽取器(() => ({
      实体: [
        { 类型: "人", 取值: "张三" },
        { 类型: "人", 取值: "李四" },
      ],
      // 同一条关系重复两次 ⇒ 只该落一条。
      关系: [关系一条, 关系一条],
      // 甲重复两次 ⇒ 只该落一条；乙与甲只差原文 ⇒ 必须各自落一条。
      事件: [甲, 甲, 乙],
    }))
    const r = await runJob(db(), { ...deps, 建抽取器: async () => 假 }, job)
    expect(r).toBe("完成")

    const 事件 = rowsOf(await db().execute(sql`
      select count(*)::int as n from auth.case_event where project_id = 'p-txt'
    `))
    expect(事件[0]?.n).toBe(2)
    const 关系 = rowsOf(await db().execute(sql`
      select count(*)::int as n from auth.case_relation where project_id = 'p-txt'
    `))
    expect(关系[0]?.n).toBe(1)
    const 事件引用 = rowsOf(await db().execute(sql`
      select count(*)::int as n from auth.case_citation
       where project_id = 'p-txt' and fact_type = 'event'
    `))
    expect(事件引用[0]?.n).toBe(2)
  })
})

/**
 * 计划 3 终审阻塞 3：人工「解析入库」要**置顶**（设计 `design.md:498`「强制入队，置顶优先」）。
 *
 * `claimNextJob` 按 `(queued_at, id)` 全局取最老一条；人工入队若用 `nowSeconds()`，就会排在
 * 所有已排队作业后面（实测第 51 位）。这里用**过去时刻**种队首，保证 FIFO 对照与置顶判据
 * 在变异下都能稳定地红/绿（同一秒内多个作业撞 `queued_at` 会让 `id` 的随机序决定胜负）。
 */
describe("人工入库置顶（设计：强制入队，置顶优先）", () => {
  const 秒 = () => Math.floor(Date.now() / 1000)

  /** 清掉遗留的排队行：`claimNextJob` 是全局队列，别的用例留下的队首会盖住本组判据。 */
  async function 清空队列() {
    await db().execute(sql`delete from auth.case_ingest_job where status = '排队中'`)
  }

  async function 种一条(projectId: string, name: string, queuedAt: number) {
    const r = await enqueueMaterial(db(), {
      projectId,
      path: name,
      sourcePath: `${projectId}/${name}`,
      fileName: name,
      fingerprint: `fp-置顶-${crypto.randomUUID()}`,
    })
    await db().execute(
      sql`update auth.case_ingest_job set queued_at = ${queuedAt} where project_id = ${projectId} and material_id = ${r.materialId}`,
    )
    return r
  }

  test("人工「解析入库」置顶：排在同项目已有三条作业之前", async () => {
    await 清空队列()
    const 项目 = "pq-置顶"
    await 种一条(项目, "先1.xlsx", 秒() - 10)
    await 种一条(项目, "先2.xlsx", 秒() - 9)
    await 种一条(项目, "先3.xlsx", 秒() - 8)

    const 人工 = await enqueueMaterial(db(), {
      projectId: 项目,
      path: "人工.xlsx",
      sourcePath: `${项目}/人工.xlsx`,
      fileName: "人工.xlsx",
      fingerprint: "fp-置顶-人工",
      置顶: true,
    })

    const 下一条 = await claimNextJob(db())
    expect(下一条?.materialId).toBe(人工.materialId)
  })

  test("对照：不传置顶（上传自动入队口径）⇒ 排在队尾，不是队首", async () => {
    await 清空队列()
    const 项目 = "pq-队尾"
    const 先 = await 种一条(项目, "先.xlsx", 秒() - 10)
    await 种一条(项目, "后.xlsx", 秒() - 9)

    await enqueueMaterial(db(), {
      projectId: 项目,
      path: "自动.xlsx",
      sourcePath: `${项目}/自动.xlsx`,
      fileName: "自动.xlsx",
      fingerprint: "fp-置顶-自动",
    })

    const 下一条 = await claimNextJob(db())
    expect(下一条?.materialId).toBe(先.materialId)
  })
})
