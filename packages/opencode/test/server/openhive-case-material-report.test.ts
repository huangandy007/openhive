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
import { 最新报告, 报告历史, 写报告 } from "../../src/server/openhive/case-material-report"
import { 判准入 } from "../../src/server/openhive/case-ingest-admission"
import { 建参考库 } from "../../src/server/openhive/case-reference-store"
import { getMaterial } from "../../src/server/openhive/case-store"

/**
 * 016 T013 · 报告存取（append-only）+ N8 准入结论。
 *
 * 夹具起法与理由见 `openhive-case-ingest.test.ts` 文件头（`startProductionDb` ＋
 * 生产入口 `connect`；不用夹具自带的客户端，避免事务后换连接的 `42P05`）。
 *
 * 适配器夹具照 T008：真技能目录（`adapter.json` ＋ `convert.ts`）、转换器由 `跑转换器`
 * 起真子进程；`读适配器` 由用例注入。
 *
 * ⚠️ **本文件的适配器表头是刻意选的**：`报文时点 / 报文数额码 / 对手户名号` 既不在
 * 字段词典里（不精确、不作后缀），样例值也不符合特征层形状（时间没分隔符、金额没两位小数、
 * 户名不像手机号）⇒ 停用适配器后四层**一列都认不出**，才能走到 `未识别:无匹配适配器`。
 * 换成 `交易时间 / 交易金额 / 对方户名` 这类标准表头，四层照样解析成功，用例 3 会假红。
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

/** 内存文件系统：`sourcePath` → 字节（作业只认这个注入点）。 */
const 文件 = new Map<string, Uint8Array>()
const 读文件 = async (sourcePath: string) => {
  const bytes = 文件.get(sourcePath)
  if (!bytes) throw new Error(`没有这个文件：${sourcePath}`)
  return bytes
}

/** 四层可解析的话单（用例 4 的「原件直入」对照）。 */
const 话单 = 造工作簿({
  Sheet1: [
    ["主叫号码", "被叫号码", "通话时间", "通话时长", "基站"],
    ["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "HZ-01"],
    ["13700000000", "13600000000", "2026-01-02 03:05", "00:01:23", "HZ-02"],
  ],
})

const 入队 = (projectId: string, fileName: string, fingerprint: string, force?: boolean) =>
  enqueueMaterial(db(), {
    projectId,
    path: fileName,
    sourcePath: `${projectId}/${fileName}`,
    fileName,
    fingerprint,
    ...(force === undefined ? {} : { force }),
  })

async function 跑下一条(依赖: RunDeps = { readFile: 读文件 }) {
  const job = await claimNextJob(db())
  if (!job) throw new Error("队列是空的：上一条用例把作业留在了别的状态？")
  return { 作业: job, 结果: await runJob(db(), 依赖, job) }
}

async function 读作业行(jobId: string) {
  const 行们 = rowsOf(
    await db().execute(sql`select status, reason_code from auth.case_ingest_job where id = ${jobId}`),
  )
  return 行们[0]
}

describe("报告存取与准入（作业链）", () => {
  const 适配表头 = ["报文时点", "报文数额码", "对手户名号"]
  let 根目录 = ""

  beforeEach(async () => {
    // `claimNextJob` 是全局 FIFO：别组留下的排队行会盖住本组判据（同 `#005-34`）。
    await db().execute(sql`delete from auth.case_ingest_job where status = '排队中'`)
  })

  afterEach(async () => {
    if (根目录 !== "") await rm(根目录, { recursive: true, force: true })
    根目录 = ""
  })

  /**
   * 转换器最小事实行（`case-converter-runner.ts` 校验 rowNo/amount/direction）；
   * 报告里的 `gates` 由转换器自报（Ruling X），这里给一个非空闸，验证**原样透传**。
   */
  const 成功脚本 = `
await Bun.write("result.json", JSON.stringify({
  rows: [
    { sheet: "Sheet1", rowNo: 2, startedAt: 1767225600, amount: "100.00", direction: "收",
      ownerAccount: "6222000000000001", counterparty: "6222000000000002", counterpartyName: "张三",
      currency: "CNY", extras: { "属性:对方:开户行": "招商银行" } },
    { sheet: "Sheet1", rowNo: 3, startedAt: 1767225660, amount: "200.00", direction: "付",
      ownerAccount: "6222000000000001", counterparty: "6222000000000003", counterpartyName: "李四",
      currency: "CNY", extras: { "属性:对方:开户行": "建设银行" } }
  ],
  report: {
    adapterId: "adapter-流水转换",
    gates: [{ 检查项: "时间可解析", 分母: 2, 命中: 2, 通过率: 1, 阈值: 0.99 }]
  }
}))
`

  /** 造夹具：技能目录（adapter.json ＋ convert.ts）、沙箱根下同字节原件、内存文件。 */
  async function 备料(代号: string) {
    根目录 = await mkdtemp(join(tmpdir(), `openhive-016-t13-${代号}-`))
    const 技能目录 = join(根目录, `skill-${crypto.randomUUID()}`)
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
        match: { requiredHeaders: 适配表头, optionalHeaders: [], priority: 100 },
        admission: { checks: [], thresholds: {} },
        rowRules: [],
        entry: { command: "bun run convert.ts", input: "path", output: "json" },
        output: { file: "result.json" },
      }),
    )
    await writeFile(join(技能目录, "convert.ts"), 成功脚本)

    const projectId = `p-报告-${代号}`
    const 文件名 = "流水.xlsx"
    const 工作簿 = 造工作簿({
      Sheet1: [
        [...适配表头],
        // 值刻意不满足特征层形状（见文件头）。
        ["20260102030405", "100", "张三"],
        ["20260102030506", "200", "李四"],
      ],
    })
    文件.set(`${projectId}/${文件名}`, 工作簿)
    await mkdir(join(根目录, projectId), { recursive: true })
    await writeFile(join(根目录, projectId, 文件名), 工作簿)
    return { projectId, 文件名, 工作簿, 技能目录 }
  }

  function 卡(目录: string): 适配器 {
    return {
      id: "adapter-流水转换",
      name: "流水转换器",
      version: "1.2.3",
      kind: "converter",
      materialType: "资金",
      attributeKeys: ["属性:对方:开户行"],
      match: { requiredHeaders: 适配表头, optionalHeaders: [], priority: 100 },
      admission: { checks: [], thresholds: {} },
      rowRules: [],
      entry: { command: "bun run convert.ts", input: "path", output: "json" },
      output: { file: "result.json" },
      目录,
    }
  }

  /** 适配器命中时的依赖；参考库给「内置-空」，富化统计仍要有版本。 */
  function 适配依赖(适配器们: 适配器[]): RunDeps {
    return {
      readFile: 读文件,
      根目录,
      读适配器: async () => ({ 适配器: 适配器们, 跳过: [] }),
      参考库: 建参考库(async () => ({ 版本: "内置-空", 条目: [] })),
    }
  }

  test("五要素齐全：适配器 id/版本/规则版本、SHA、闸、告警、跳过行、富化统计、准入", async () => {
    const { projectId, 文件名, 工作簿, 技能目录 } = await 备料("五要素")
    await 入队(projectId, 文件名, Hash.sha256(`${projectId}-五要素`))

    const { 作业, 结果 } = await 跑下一条(适配依赖([卡(技能目录)]))
    expect(结果).toBe("完成")
    expect((await getMaterial(db(), projectId, 作业.materialId))?.parseStatus).toBe("已解析")

    const 报告 = await 最新报告(db(), projectId, 作业.materialId)
    if (报告 === undefined) throw new Error("转换成功却没有报告")

    expect(报告.jobId).toBe(作业.jobId)
    expect(报告.materialId).toBe(作业.materialId)
    expect(报告.adapterId).toBe("adapter-流水转换")
    expect(报告.adapterVersion).toBe("1.2.3")
    // Ruling AO：适配器通路 ruleVersion = 适配.version；档案表没有 rule_version 列。
    expect(报告.ruleVersion).toBe("1.2.3")
    expect(报告.sourceSha256).toBe(Hash.sha256(Buffer.from(工作簿)))

    // Ruling X：gates 原样取转换器自报，不编造分母/通过率。
    expect(报告.gates).toEqual([{ 检查项: "时间可解析", 分母: 2, 命中: 2, 通过率: 1, 阈值: 0.99 }])

    expect(Array.isArray(报告.warnings)).toBe(true)
    // 富化的参考类告警（空参考库 ⇒ 账号查不到开户行 / 卡种）是 warnings 的来源之一。
    expect(报告.warnings.length).toBeGreaterThan(0)
    expect(
      报告.warnings.some(
        (w) => 是对象(w) && w["键"] === "开户行" && w["值"] === "6222000000000001" && w["原因"] === "参考库无此值",
      ),
    ).toBe(true)

    // 转换器的两行都合法（方向 / 金额 / 时间 / 账号齐全）⇒ 无跳过行。
    expect(报告.skippedRows).toEqual([])

    if (!是对象(报告.enrich)) throw new Error("enrich 不是对象")
    expect(Object.keys(报告.enrich).sort()).toEqual(["参考库版本", "未补全数", "补全数"].sort())
    expect(报告.enrich["参考库版本"]).toBe("内置-空")

    expect(报告.admission).toEqual({
      结论: "准入",
      依据: ["适配器 adapter-流水转换@1.2.3", "SHA-256 与原件一致"],
    })
  })

  test("重跑新增一行、历史版本逐字段不变；停用适配器后回到未识别且旧报告仍在", async () => {
    const { projectId, 文件名, 工作簿, 技能目录 } = await 备料("追加")
    await 入队(projectId, 文件名, Hash.sha256(`${projectId}-追加`))

    const 第一次 = await 跑下一条(适配依赖([卡(技能目录)]))
    expect(第一次.结果).toBe("完成")
    const 首次报告 = await 最新报告(db(), projectId, 第一次.作业.materialId)
    if (首次报告 === undefined) throw new Error("第一次转换成功却没有报告")

    // ── 同材料重跑（force）⇒ 作业是新的一行，报告必须新增一行 ──
    expect((await 入队(projectId, 文件名, Hash.sha256(`${projectId}-追加`), true)).enqueued).toBe(true)
    const 第二次 = await 跑下一条(适配依赖([卡(技能目录)]))
    expect(第二次.结果).toBe("完成")
    expect(第二次.作业.materialId).toBe(第一次.作业.materialId)
    expect(第二次.作业.jobId).not.toBe(第一次.作业.jobId)

    const 历史 = await 报告历史(db(), projectId, 第二次.作业.materialId)
    expect(历史.length).toBe(2)
    // 逐字段比较：历史那一行一个字都不许变（append-only）。
    expect(历史.find((行) => 行.id === 首次报告.id)).toEqual(首次报告)
    const 新报告 = 历史.find((行) => 行.id !== 首次报告.id)
    if (新报告 === undefined) throw new Error("重跑没有新增报告")
    expect(新报告.jobId).toBe(第二次.作业.jobId)
    expect(新报告.sourceSha256).toBe(Hash.sha256(Buffer.from(工作簿)))

    // 同一作业写第二份报告 = 编程错误，必须抛错（UNIQUE(project_id, job_id)）；
    // 不许 `on conflict do update` 静默覆盖历史（本文件的变异用例就拆这一条）。
    let 重复写入抛错 = false
    try {
      await 写报告(db(), {
        projectId,
        jobId: 第一次.作业.jobId,
        materialId: 第一次.作业.materialId,
        adapterId: null,
        adapterVersion: null,
        ruleVersion: null,
        sourceSha256: "重复",
        gates: [],
        warnings: [],
        skippedRows: [],
        enrich: null,
        admission: null,
      })
    } catch {
      重复写入抛错 = true
    }
    // 变异靶子：`on conflict … do update` 会把历史那一行覆盖成「重复」——
    // 追加语义下它必须一个字都不变（这轮写入本来就该失败）。
    const 重复后历史 = await 报告历史(db(), projectId, 第二次.作业.materialId)
    expect(重复后历史.length).toBe(2)
    expect(重复后历史.find((行) => 行.id === 首次报告.id)).toEqual(首次报告)
    expect(重复写入抛错).toBe(true)

    // ── 停用适配器（空注册表）后再跑：四层认不出这批表头 ⇒ 未识别:无匹配适配器 ──
    expect((await 入队(projectId, 文件名, Hash.sha256(`${projectId}-追加`), true)).enqueued).toBe(true)
    const 第三次 = await 跑下一条({ readFile: 读文件, 根目录, 读适配器: async () => ({ 适配器: [], 跳过: [] }) })
    expect(第三次.结果).toBe("失败")
    expect((await getMaterial(db(), projectId, 第三次.作业.materialId))?.parseStatus).toBe("有问题")
    const 作业行 = await 读作业行(第三次.作业.jobId)
    expect(作业行?.status).toBe("失败")
    expect(作业行?.reason_code).toBe("未识别:无匹配适配器")

    // Ruling M：失败不写报告 —— 历史仍是那两行，且内容不变。
    const 停用后历史 = await 报告历史(db(), projectId, 第三次.作业.materialId)
    expect(停用后历史.length).toBe(2)
    expect(停用后历史.find((行) => 行.id === 首次报告.id)).toEqual(首次报告)
    expect(停用后历史.find((行) => 行.id === 新报告.id)).toEqual(新报告)
  })

  test("四层通路 ⇒ 报告标记旁路（原件直入），adapterId 为空", async () => {
    const projectId = "p-报告-四层"
    const 文件名 = "话单.xlsx"
    文件.set(`${projectId}/${文件名}`, 话单)
    await 入队(projectId, 文件名, Hash.sha256(`${projectId}-四层`))

    const { 作业, 结果 } = await 跑下一条()
    expect(结果).toBe("完成")

    const 报告 = await 最新报告(db(), projectId, 作业.materialId)
    if (报告 === undefined) throw new Error("四层通路成功却没有报告")
    expect(报告.adapterId).toBeNull()
    expect(报告.adapterVersion).toBeNull()
    expect(报告.ruleVersion).toBeNull()
    expect(报告.gates).toEqual([])
    expect(报告.warnings).toContain("无适配器（四层识别），未执行适配器闸")
    expect(报告.sourceSha256).toBe(Hash.sha256(Buffer.from(话单)))

    if (!是对象(报告.admission)) throw new Error("admission 不是对象")
    expect(报告.admission["结论"]).toBe("旁路")
    const 依据 = 报告.admission["依据"]
    if (!Array.isArray(依据)) throw new Error("admission.依据 不是数组")
    expect(依据.some((条) => typeof 条 === "string" && 条.includes("原件直入"))).toBe(true)
  })
})

describe("判准入（纯函数）", () => {
  test("适配器产出且 SHA 一致（或首次）⇒ 准入", () => {
    expect(
      判准入({ 本轮适配器: { id: "a1", version: "2" }, 本轮原因码: null, 原件sha256: "abc" }),
    ).toEqual({ 结论: "准入", 依据: ["适配器 a1@2", "SHA-256 与原件一致"] })
    expect(
      判准入({
        本轮适配器: { id: "a1", version: "2" },
        本轮原因码: null,
        原件sha256: "abc",
        历史报告: { adapterId: "a1", sourceSha256: "abc" },
      }),
    ).toEqual({ 结论: "准入", 依据: ["适配器 a1@2", "SHA-256 与原件一致"] })
  })

  test("无适配器 ⇒ 旁路；历史由适配器产出 ⇒ 追加停用提示", () => {
    expect(判准入({ 本轮原因码: null, 原件sha256: "abc" })).toEqual({
      结论: "旁路",
      依据: ["无适配器产出（原件直入）"],
    })
    expect(
      判准入({
        本轮原因码: null,
        原件sha256: "abc",
        历史报告: { adapterId: "a1", sourceSha256: "abc" },
      }),
    ).toEqual({
      结论: "旁路",
      依据: ["无适配器产出（原件直入）", "历史报告由适配器 a1 产出，本轮未使用（可能已停用）"],
    })
  })

  test("本轮原因码非空 ⇒ 旁路", () => {
    expect(
      判准入({ 本轮原因码: "未识别:无匹配适配器", 原件sha256: "abc" }),
    ).toEqual({ 结论: "旁路", 依据: ["本轮原因码：未识别:无匹配适配器"] })
  })
})
