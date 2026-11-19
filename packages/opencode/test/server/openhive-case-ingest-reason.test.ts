import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  claimNextJob,
  enqueueMaterial,
  runJob,
  type RunDeps,
} from "../../src/server/openhive/case-ingest"
import type { 适配器 } from "../../src/server/openhive/case-adapter-registry"
import { createMaterial, getMaterial, type Queryable } from "../../src/server/openhive/case-store"

/**
 * 016 T011 · M3 原因码与作业进度（判据文件）。
 *
 * ## 三条纪律
 *
 * - **六值逐字面** `toBe` 全等，禁 `toContain('未识别')`（`#005-47`：期望值恰好等于下游
 *   默认值 / 前缀时，断言会空转）。
 * - 每条用例用独立 `projectId`，`beforeEach` 先清掉遗留的排队作业（`claimNextJob` 是全局
 *   FIFO，别组留下的排队行会盖住本组判据，`#005-34`）。
 * - 第 3 条是**故障注入**（独立库 drop 表），不是真实约束冲突——写在这里也写进报告。
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

beforeEach(async () => {
  await db().execute(sql`delete from auth.case_ingest_job where status = '排队中'`)
})

/** 临时目录（适配器夹具）用完就删。 */
const 临时目录们: string[] = []

afterEach(async () => {
  for (const 目录 of 临时目录们.splice(0)) await rm(目录, { recursive: true, force: true })
})

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 造工作簿(sheets: Record<string, (string | number | null)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
}

/** 内存文件系统：`sourcePath` → 字节（作业只认这个注入点，不直接碰盘）。 */
const 文件 = new Map<string, Uint8Array>()
const deps: RunDeps = {
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

let 序号 = 0
function 新项目(前缀: string): string {
  序号 += 1
  return `p-r-${前缀}-${序号}`
}

async function 入队(projectId: string, fileName: string, 目标: Queryable = db()) {
  return enqueueMaterial(目标, {
    projectId,
    path: fileName,
    sourcePath: `${projectId}/${fileName}`,
    fileName,
    fingerprint: Hash.sha256(`${projectId}-${fileName}`),
  })
}

async function 跑一条(依赖: RunDeps, 目标: Queryable = db()) {
  const 作业 = await claimNextJob(目标)
  if (!作业) throw new Error("队列是空的：上一条用例把作业留在了别的状态？")
  return { 作业, 结果: await runJob(目标, 依赖, 作业) }
}

interface 作业列 {
  status: string
  reason_code: string | null
  progress: unknown
}

async function 取作业行(jobId: string, 目标: Queryable = db()): Promise<作业列> {
  const 行们 = rowsOf(
    await 目标.execute(sql`
      select status, reason_code, progress from auth.case_ingest_job where id = ${jobId}
    `),
  )
  const 行 = 行们[0]
  if (!行) throw new Error(`查不到作业行：${jobId}`)
  return {
    status: String(行.status),
    reason_code: typeof 行.reason_code === "string" ? 行.reason_code : null,
    progress: 行.progress,
  }
}

/** jsonb 可能以对象或字符串回来（driver 差异）；形状不对直接说，别让断言在 `undefined` 上静默过。 */
function 解析进度(原始: unknown): Record<string, unknown> {
  if (typeof 原始 === "string") {
    const 解析: unknown = JSON.parse(原始)
    if (是对象(解析)) return 解析
  }
  if (是对象(原始)) return 原始
  throw new Error(`progress 形状不对：${String(原始)}`)
}

async function 事实行数(projectId: string, 目标: Queryable = db()): Promise<number> {
  const 行们 = rowsOf(
    await 目标.execute(sql`
      select count(*)::int as n from auth.case_fact_row where project_id = ${projectId}
    `),
  )
  return Number(行们[0]?.n)
}

/**
 * 造一套适配器夹具：技能目录（adapter.json ＋ convert.ts）与工作簿。
 *
 * 只有真正要跑转换器的用例才需要沙箱根与原件；只测「探测/表头闸」的用例传 `写原件: false`，
 * 目录仍然造出来（`适配器.目录` 是必填字段），只是不会被 `跑转换器` 读到。
 */
async function 备适配器(
  代号: string,
  选项: {
    readonly 表头们: readonly string[]
    readonly 工作簿: Uint8Array
    readonly 转换脚本?: string
    readonly 写原件?: boolean
  },
) {
  const 根 = await mkdtemp(join(tmpdir(), `openhive-016-t11-${代号}-`))
  临时目录们.push(根)
  const 技能目录 = join(根, `skill-${crypto.randomUUID()}`)
  await mkdir(技能目录, { recursive: true })
  await writeFile(
    join(技能目录, "adapter.json"),
    JSON.stringify({
      id: "adapter-流水转换",
      name: "流水转换器",
      version: "1.2.3",
      kind: "converter",
      materialType: "资金",
      attributeKeys: ["属性:对方:开户行"],
      match: { requiredHeaders: 选项.表头们, optionalHeaders: [], priority: 100 },
      admission: { checks: [], thresholds: {} },
      rowRules: [],
      entry: { command: "bun run convert.ts", input: "path", output: "json" },
      output: { file: "result.json" },
    }),
  )
  if (选项.转换脚本 !== undefined) await writeFile(join(技能目录, "convert.ts"), 选项.转换脚本)

  const projectId = 新项目(代号)
  const 文件名 = "流水.xlsx"
  文件.set(`${projectId}/${文件名}`, 选项.工作簿)
  if (选项.写原件 === true) {
    await mkdir(join(根, projectId), { recursive: true })
    await writeFile(join(根, projectId, 文件名), 选项.工作簿)
  }
  return { 根, 技能目录, projectId, 文件名 }
}

function 卡(目录: string, 表头们: readonly string[]): 适配器 {
  return {
    id: "adapter-流水转换",
    name: "流水转换器",
    version: "1.2.3",
    kind: "converter",
    materialType: "资金",
    attributeKeys: ["属性:对方:开户行"],
    match: { requiredHeaders: 表头们, optionalHeaders: [], priority: 100 },
    admission: { checks: [], thresholds: {} },
    rowRules: [],
    entry: { command: "bun run convert.ts", input: "path", output: "json" },
    output: { file: "result.json" },
    目录,
  }
}

/** 适配器通路的依赖：注册表由用例注入（Ruling J），模型入口一被调用就抛错。 */
function 装适配器依赖(根目录: string, 卡们: 适配器[]): RunDeps {
  return {
    readFile: deps.readFile,
    根目录,
    读适配器: async () => ({ 适配器: 卡们, 跳过: [] }),
    建表头识别器: async () => {
      throw new Error("适配器命中时不许构造表头识别器")
    },
  }
}

const 流水表头 = ["交易时间", "交易金额", "对方户名"] as const

describe("T011 原因码（六值字面）与作业进度", () => {
  test("1. 读不进来的文件 ⇒ 失败:读文件；进度停在 读表", async () => {
    const projectId = 新项目("读文件")
    const 文件名 = "坏文件.xlsx"
    文件.set(`${projectId}/${文件名}`, new Uint8Array([0, 1, 2, 3]))
    await 入队(projectId, 文件名)

    const { 作业, 结果 } = await 跑一条(deps)
    expect(结果).toBe("失败")

    const 列 = await 取作业行(作业.jobId)
    expect(列.reason_code).toBe("失败:读文件")
    expect(列.status).toBe("失败")
    expect(解析进度(列.progress)["阶段"]).toBe("读表")
  })

  test("2. 转换器非零退出且无报告 ⇒ 失败:转换器异常", async () => {
    const { 根, 技能目录, projectId, 文件名 } = await 备适配器("转换器异常", {
      表头们: 流水表头,
      工作簿: 造工作簿({ Sheet1: [[...流水表头], ["2026-01-02 03:04:05", "100.00", "张三"]] }),
      转换脚本: "process.exit(3)\n",
      写原件: true,
    })
    await 入队(projectId, 文件名)

    const { 作业, 结果 } = await 跑一条(装适配器依赖(根, [卡(技能目录, 流水表头)]))
    expect(结果).toBe("失败")

    // 字面全等：不许被值闸映射冒领（报告缺失 ⇒ 不走 `未识别:值闸不过:*`）。
    expect((await 取作业行(作业.jobId)).reason_code).toBe("失败:转换器异常")
    expect((await getMaterial(db(), projectId, 作业.materialId))?.parseStatus).toBe("有问题")
  })

  test("3. 写入事务失败（故障注入：独立库 drop 掉 case_fact_row）⇒ 失败:入库异常", async () => {
    // ⚠️ 故障注入，不是真实约束冲突：本用例独占一个干净库，把事实行表整张删掉，
    // 让事务里的第一条写入抛「表不存在」。其它用例不受影响。
    const 独立 = await startProductionDb()
    let 独立库: ReturnType<typeof connect> | undefined
    try {
      独立库 = connect({ ...process.env, PG_POOL_MAX: "1" })
      await migrate(独立库)
      await 独立库.execute(sql`drop table auth.case_fact_row`)

      const projectId = 新项目("入库异常")
      const 文件名 = "话单.xlsx"
      文件.set(`${projectId}/${文件名}`, 话单)
      await 入队(projectId, 文件名, 独立库)

      const { 作业, 结果 } = await 跑一条(deps, 独立库)
      expect(结果).toBe("失败")
      expect((await 取作业行(作业.jobId, 独立库)).reason_code).toBe("失败:入库异常")
    } finally {
      await 独立库?.$client.close()
      await 独立.stop()
    }
  })

  test("4. 空注册表 + 认不出的表 ⇒ 未识别:无匹配适配器；材料 有问题", async () => {
    const projectId = 新项目("无匹配")
    const 文件名 = "陌生表.xlsx"
    文件.set(
      `${projectId}/${文件名}`,
      造工作簿({
        Sheet1: [
          ["甲", "乙"],
          ["丙", "丁"],
        ],
      }),
    )
    await 入队(projectId, 文件名)

    const { 作业, 结果 } = await 跑一条({ readFile: deps.readFile, 读适配器: async () => ({ 适配器: [], 跳过: [] }) })
    expect(结果).toBe("失败")
    expect((await 取作业行(作业.jobId)).reason_code).toBe("未识别:无匹配适配器")
    expect((await getMaterial(db(), projectId, 作业.materialId))?.parseStatus).toBe("有问题")
  })

  test("5. 适配器缺必需列 ⇒ 未识别:缺必需列:<列名>（字面含列名）", async () => {
    const { 技能目录, projectId, 文件名 } = await 备适配器("缺列", {
      表头们: ["查询账号", "交易流水号"],
      工作簿: 造工作簿({
        Sheet1: [
          ["交易流水号"],
          ["A0001"],
          ["A0002"],
        ],
      }),
    })
    await 入队(projectId, 文件名)

    const { 作业, 结果 } = await 跑一条({
      readFile: deps.readFile,
      读适配器: async () => ({ 适配器: [卡(技能目录, ["查询账号", "交易流水号"])], 跳过: [] }),
    })
    expect(结果).toBe("失败")
    // 逐字面：列名按 requiredHeaders 声明顺序取第一个缺失列。
    expect((await 取作业行(作业.jobId)).reason_code).toBe("未识别:缺必需列:查询账号")
  })

  test("6. 转换器报告里的失败闸 ⇒ 未识别:值闸不过:<检查项>；事实行 0 行", async () => {
    const 闸脚本 = `
await Bun.write("result.json", JSON.stringify({
  rows: [],
  report: { gates: [{ 检查项: "时间可解析", 通过率: 0.4, 阈值: 0.99 }] }
}))
process.exit(3)
`
    const { 根, 技能目录, projectId, 文件名 } = await 备适配器("值闸", {
      表头们: 流水表头,
      工作簿: 造工作簿({ Sheet1: [[...流水表头], ["不是时间", "100.00", "张三"]] }),
      转换脚本: 闸脚本,
      写原件: true,
    })
    await 入队(projectId, 文件名)

    const { 作业, 结果 } = await 跑一条(装适配器依赖(根, [卡(技能目录, 流水表头)]))
    expect(结果).toBe("失败")

    expect((await 取作业行(作业.jobId)).reason_code).toBe("未识别:值闸不过:时间可解析")
    expect((await getMaterial(db(), projectId, 作业.materialId))?.parseStatus).toBe("有问题")
    expect(await 事实行数(projectId)).toBe(0)
  })

  test("7. 未入队材料不伪造原因码：没有作业行 ⇒ 无从谈起", async () => {
    const projectId = 新项目("未入队")
    const materialId = await createMaterial(db(), {
      id: crypto.randomUUID(),
      projectId,
      fileName: "还没排队的.xlsx",
      kind: "其他",
      fingerprint: Hash.sha256(`${projectId}-未入队`),
      path: "还没排队的.xlsx",
    })

    const 行们 = rowsOf(
      await db().execute(sql`
        select count(*)::int as n from auth.case_ingest_job where material_id = ${materialId}
      `),
    )
    expect(Number(行们[0]?.n)).toBe(0)
    expect((await getMaterial(db(), projectId, materialId))?.parseStatus).toBe("未入队")
  })

  test("8. 成功跑完 ⇒ progress 阶段=写入，已处理=总数=事实行数", async () => {
    const projectId = 新项目("进度")
    const 文件名 = "话单.xlsx"
    文件.set(`${projectId}/${文件名}`, 话单)
    await 入队(projectId, 文件名)

    const { 作业, 结果 } = await 跑一条(deps)
    expect(结果).toBe("完成")

    const 进度 = 解析进度((await 取作业行(作业.jobId)).progress)
    expect(进度["阶段"]).toBe("写入")
    const 行数 = await 事实行数(projectId)
    expect(行数).toBe(2)
    expect(Number(进度["已处理"])).toBe(行数)
    expect(Number(进度["总数"])).toBe(行数)
  })
})
