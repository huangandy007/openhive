import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { 适配器 } from "../../src/server/openhive/case-adapter-registry"
import { 探测 } from "../../src/server/openhive/case-adapter-probe"
import {
  清空失败冷却,
  认领待探测,
  探测材料,
  type 探测依赖,
} from "../../src/server/openhive/case-probe-worker"

/**
 * 016 T006 · N2 探测闸（只跑表头闸，Ruling X）与独立探测通道。
 *
 * 钉住四件事：
 * 1. 三态：全含必需头 ⇒ 已识别；有候选只差列 ⇒ `未识别:缺必需列:<第一个缺失列>`；
 *    没有 converter 候选（含全被 Ruling I 的 kind 过滤掉）⇒ `未识别:无匹配适配器`；
 * 2. 决胜只有 `priority desc, id asc` 一份——输入数组顺序打乱两次、连跑 10 次结论不变；
 * 3. 探测只写 `case_material.probe`，`parse_status` 仍是「排队中」；探测过的材料不再被认领；
 * 4. 非「排队中」的材料不被认领。
 */

/** converter 卡：只有 converter 在探测里可报「已识别」（Ruling I / F）。 */
function 转换器(over: {
  id: string
  requiredHeaders: readonly string[]
  priority?: number
  version?: string
}): 适配器 {
  return {
    id: over.id,
    name: over.id,
    version: over.version ?? "1.0.0",
    kind: "converter",
    materialType: "资金",
    attributeKeys: [],
    match: {
      requiredHeaders: over.requiredHeaders,
      optionalHeaders: [],
      priority: over.priority ?? 100,
    },
    admission: { checks: [], thresholds: {} },
    rowRules: [],
    目录: `/skills/${over.id}`,
    entry: { command: "bun run convert.ts", input: "xlsx", output: "json" },
    output: { file: "result.json" },
  }
}

/** rowRules 卡：本期不执行，探测里**不得**报成已识别。 */
function 行规则(id: string, requiredHeaders: readonly string[]): 适配器 {
  return {
    id,
    name: id,
    version: "1.0.0",
    kind: "rowRules",
    materialType: "话单",
    attributeKeys: [],
    match: { requiredHeaders, optionalHeaders: [], priority: 999 },
    admission: { checks: [], thresholds: {} },
    rowRules: ["本方 = 主叫 ? 主叫 : 被叫"],
    目录: `/skills/${id}`,
    entry: { input: "xlsx", output: "json" },
    output: { file: "rows.json" },
  }
}

describe("016 T006 · 探测（表头闸）", () => {
  test("全含必需头 ⇒ 已识别（带适配器 id 与版本）", () => {
    const 甲 = 转换器({ id: "converter-a", requiredHeaders: ["交易时间", "交易金额"], priority: 100 })
    const 乙 = 转换器({
      id: "converter-b",
      requiredHeaders: ["交易时间", "交易金额", "对方户名"],
      priority: 100,
    })

    expect(探测({ 表头: ["交易时间", "交易金额"] }, [甲, 乙])).toEqual({
      状态: "已识别",
      适配器id: "converter-a",
      版本: "1.0.0",
      // 乙多要「对方户名」⇒ 只有甲过表头闸。
      命中们: [{ id: "converter-a", version: "1.0.0", priority: 100 }],
    })
  })

  test("有候选只差列 ⇒ 未识别:缺必需列:<requiredHeaders 声明顺序的第一个缺失列>", () => {
    const 乙 = 转换器({
      id: "converter-b",
      requiredHeaders: ["交易时间", "交易金额", "对方户名"],
      priority: 100,
    })

    expect(探测({ 表头: ["交易时间"] }, [乙])).toEqual({
      状态: "未识别",
      原因码: "未识别:缺必需列:交易金额",
    })
  })

  test("没有候选 ⇒ 未识别:无匹配适配器", () => {
    expect(探测({ 表头: ["交易时间", "交易金额"] }, [])).toEqual({
      状态: "未识别",
      原因码: "未识别:无匹配适配器",
    })
  })

  test("候选全是 rowRules（Ruling I 过滤）⇒ 未识别:无匹配适配器，不报假绿灯", () => {
    const 行 = 行规则("row-rules-a", ["交易时间"])

    expect(探测({ 表头: ["交易时间"] }, [行])).toEqual({
      状态: "未识别",
      原因码: "未识别:无匹配适配器",
    })
  })

  test("多命中只有 priority desc → id asc 一份：输入顺序打乱、连跑 10 次结论恒定", () => {
    const 甲 = 转换器({ id: "a-tie", requiredHeaders: ["交易时间"], priority: 150 })
    const 乙 = 转换器({ id: "b-tie", requiredHeaders: ["交易时间"], priority: 150 })

    for (let i = 0; i < 10; i++) {
      // 两种数组顺序轮换：结论不许跟着数组顺序走。
      const 输入 = i % 2 === 0 ? [乙, 甲] : [甲, 乙]
      expect(探测({ 表头: ["交易时间"] }, 输入)).toEqual({
        状态: "已识别",
        适配器id: "a-tie",
        版本: "1.0.0",
        命中们: [
          { id: "a-tie", version: "1.0.0", priority: 150 },
          { id: "b-tie", version: "1.0.0", priority: 150 },
        ],
      })
    }
  })

  test("全缺列时取缺列最少者（不是 priority 高的那个）（I2）", () => {
    // 表头只有「交易时间」：少列卡缺 1 列（交易金额，priority 100），
    // 多列卡缺 2 列（对方户名/对方账号，priority 200）。报少列卡的第一缺失列。
    const 少 = 转换器({ id: "a-few", requiredHeaders: ["交易时间", "交易金额"], priority: 100 })
    const 多 = 转换器({
      id: "z-many",
      requiredHeaders: ["交易时间", "对方户名", "对方账号"],
      priority: 200,
    })

    expect(探测({ 表头: ["交易时间"] }, [少, 多])).toEqual({
      状态: "未识别",
      原因码: "未识别:缺必需列:交易金额",
    })
  })

  test("缺列数并列时按 priority desc 决胜，且不随数组顺序（I2）", () => {
    const 甲 = 转换器({ id: "a-tie", requiredHeaders: ["交易时间", "交易金额"], priority: 100 })
    const 乙 = 转换器({ id: "b-tie", requiredHeaders: ["交易时间", "对方户名"], priority: 200 })
    const 期望 = { 状态: "未识别" as const, 原因码: "未识别:缺必需列:对方户名" }

    expect(探测({ 表头: ["交易时间"] }, [甲, 乙])).toEqual(期望)
    expect(探测({ 表头: ["交易时间"] }, [乙, 甲])).toEqual(期望)
  })

  test("priority 高者胜出（不管数组顺序）", () => {
    const 低 = 转换器({ id: "a-low", requiredHeaders: ["交易时间"], priority: 100 })
    const 高 = 转换器({ id: "z-high", requiredHeaders: ["交易时间"], priority: 200 })

    expect(探测({ 表头: ["交易时间"] }, [低, 高])).toEqual({
      状态: "已识别",
      适配器id: "z-high",
      版本: "1.0.0",
      命中们: [
        { id: "z-high", version: "1.0.0", priority: 200 },
        { id: "a-low", version: "1.0.0", priority: 100 },
      ],
    })
    expect(探测({ 表头: ["交易时间"] }, [高, 低])).toEqual({
      状态: "已识别",
      适配器id: "z-high",
      版本: "1.0.0",
      命中们: [
        { id: "z-high", version: "1.0.0", priority: 200 },
        { id: "a-low", version: "1.0.0", priority: 100 },
      ],
    })
  })

  test("A2：converter 零命中、rowRules 命中 ⇒ 告警含规则型 id 与 projectId；converter 命中不告警", () => {
    const 原告警 = console.warn
    const 记录: string[] = []
    console.warn = (...参数: unknown[]) => {
      记录.push(参数.map((项) => String(项)).join(" "))
    }
    try {
      const 行 = 行规则("row-rules-a", ["交易时间"])
      expect(探测({ 表头: ["交易时间"], projectId: "p-warn" }, [行])).toEqual({
        状态: "未识别",
        原因码: "未识别:无匹配适配器",
      })
      const 规则告警 = 记录.filter((项) => 项.includes("规则型适配器未在本期实现"))
      expect(规则告警.length).toBe(1)
      expect(规则告警[0]).toContain("row-rules-a")
      expect(规则告警[0]).toContain("p-warn")

      // converter 命中 ⇒ 不再出现规则型告警。
      记录.length = 0
      const 转 = 转换器({ id: "converter-a", requiredHeaders: ["交易时间"] })
      expect(探测({ 表头: ["交易时间"], projectId: "p-warn" }, [转, 行]).状态).toBe("已识别")
      expect(记录.filter((项) => 项.includes("规则型适配器未在本期实现")).length).toBe(0)
    } finally {
      console.warn = 原告警
    }
  })

  test("A3：命中们 = 全部表头闸通过者（含落选者），按 priority desc, id asc", () => {
    const 甲 = 转换器({ id: "z-low", requiredHeaders: ["交易时间"], priority: 100 })
    const 乙 = 转换器({ id: "a-high", requiredHeaders: ["交易时间"], priority: 200 })
    const 结论 = 探测({ 表头: ["交易时间"] }, [甲, 乙])

    expect(结论.状态).toBe("已识别")
    expect(结论.适配器id).toBe("a-high")
    expect(结论.命中们).toEqual([
      { id: "a-high", version: "1.0.0", priority: 200 },
      { id: "z-low", version: "1.0.0", priority: 100 },
    ])
  })
})

// ---- 探测通道（真库） ----

const 项目 = "p-probe"
const 用户 = "u-probe"

function 造工作簿(rows: (string | number)[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1")
  // `XLSX.write` 的返回类型是 `any`；这里只做「按字节重新包一层」，不读它的字段。
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

const 命中表 = 造工作簿([
  ["交易时间", "交易金额"],
  ["2026-01-02 03:04:05", "100.00"],
])

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})

afterAll(async () => {
  await pg?.stop()
})

function 库() {
  if (pg === undefined) throw new Error("真库没起来")
  return pg.db
}

async function 造材料(input: { id: string; status: string; createdAt?: number }) {
  await 库().execute(sql`
    insert into auth.case_material
      (id, project_id, file_name, kind, fingerprint, path, parse_status, queued_by, created_at)
    values (${input.id}, ${项目}, 'a.xlsx', '资金', ${input.id},
            '材料/a.xlsx', ${input.status}, ${用户}, ${input.createdAt ?? 0})
  `)
}

/** 作业行：探测取它的 `source_path` 当权威落点（C1）。 */
async function 造作业(input: { id: string; materialId: string; sourcePath: string; queuedBy?: string }) {
  await 库().execute(sql`
    insert into auth.case_ingest_job
      (id, project_id, material_id, status, queued_at, queued_by, source_path)
    values (${input.id}, ${项目}, ${input.materialId}, '排队中', 1, ${input.queuedBy ?? 用户},
            ${input.sourcePath})
  `)
}

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 读probe(原始: unknown): Record<string, unknown> {
  const 值 = typeof 原始 === "string" ? JSON.parse(原始) : 原始
  if (!是对象(值)) throw new Error("probe 不是对象")
  return 值
}

const deps: 探测依赖 = {
  root: "/sandbox",
  readFile: async () => 命中表,
  读注册表: async () => [转换器({ id: "converter-a", requiredHeaders: ["交易时间", "交易金额"] })],
}

describe("016 T006 · 独立探测通道", () => {
  // 失败冷却是模块级表（生产语义就是进程级），用例之间必须清，否则上一条的失败影响下一条。
  beforeEach(() => 清空失败冷却())

  test("探测只写 probe、不碰 parse_status；认领后 probe 非空，第二次认领不到", async () => {
    await 造材料({ id: "probe-a", status: "排队中" })
    // 落点只认作业权威 source_path（C1）：夹具必须带作业行，否则探测按「无作业」留空。
    await 造作业({ id: "job-probe-a", materialId: "probe-a", sourcePath: "u-probe/p-probe/材料/a.xlsx" })

    const 一份 = await 认领待探测(库())
    expect(一份?.materialId).toBe("probe-a")

    await 探测材料(库(), deps, 一份!)

    const row = rowsOf(
      await 库().execute(sql`
        select probe, parse_status from auth.case_material
         where project_id = ${项目} and id = 'probe-a'
      `),
    )[0]
    const probe = 读probe(row?.probe)
    expect(probe["状态"]).toBe("已识别")
    expect(probe["适配器id"]).toBe("converter-a")
    expect(probe["版本"]).toBe("1.0.0")
    expect(typeof probe["完成秒"]).toBe("number")
    // A3：`命中们` 只进报告，**不进** `case_material.probe`（键集保持文档字段）。
    expect(Object.keys(probe).sort()).toEqual(["完成秒", "版本", "状态", "适配器id"].sort())
    // 探测不推进解析状态（否则会造「排队中 → 有问题」的非法转移）。
    expect(row?.parse_status).toBe("排队中")

    // probe 已写 ⇒ 部分索引的场景不再被认领。
    expect(await 认领待探测(库())).toBeUndefined()
  })

  test("非「排队中」的材料（已解析）不被认领", async () => {
    await 造材料({ id: "parsed-a", status: "已解析", createdAt: 1 })

    expect(await 认领待探测(库())).toBeUndefined()
  })

  test("落点只认作业权威 source_path：共享项目成员入队也读到属主目录（C1）", async () => {
    // 沙箱落点恒为项目**属主**目录；`queued_by` 记的是**操作人**。共享项目里二者不同，
    // 按 queued_by 反推必然 ENOENT。
    await 库().execute(sql`
      insert into auth.case_material
        (id, project_id, file_name, kind, fingerprint, path, parse_status, queued_by, created_at)
      values ('probe-c1', ${项目}, 'x.xlsx', '资金', 'probe-c1',
              '材料/x.xlsx', '排队中', ${"成员甲"}, 5)
    `)
    await 库().execute(sql`
      insert into auth.case_ingest_job
        (id, project_id, material_id, status, queued_at, queued_by, source_path)
      values ('job-c1', ${项目}, 'probe-c1', '排队中', 1, ${"成员甲"},
              ${"属主乙/p-probe/材料/x.xlsx"})
    `)

    const 一份 = await 认领待探测(库())
    expect(一份?.materialId).toBe("probe-c1")
    expect(一份?.sourcePath).toBe("属主乙/p-probe/材料/x.xlsx")

    const 收到路径: string[] = []
    await 探测材料(
      库(),
      {
        root: "/sandbox",
        readFile: async (绝对路径) => {
          收到路径.push(绝对路径)
          return 命中表
        },
        读注册表: async () => [转换器({ id: "converter-a", requiredHeaders: ["交易时间", "交易金额"] })],
      },
      一份!,
    )

    // `沙箱内路径` 用 resolve 拼；断言与它同一口径，并确认没有拿操作人（成员甲）当目录。
    expect(收到路径).toEqual([resolve("/sandbox", "属主乙", "p-probe", "材料", "x.xlsx")])
    expect(收到路径[0]).not.toContain("成员甲")
  })

  test("材料没有作业行 ⇒ sourcePath 为 null，探测不写 probe（C1）", async () => {
    await 造材料({ id: "probe-null", status: "排队中", createdAt: 6 })

    const 一份 = await 认领待探测(库())
    expect(一份?.materialId).toBe("probe-null")
    expect(一份?.sourcePath).toBeNull()

    const 收到路径: string[] = []
    await 探测材料(
      库(),
      {
        root: "/sandbox",
        readFile: async (绝对路径) => {
          收到路径.push(绝对路径)
          return 命中表
        },
        读注册表: async () => [],
      },
      一份!,
    )

    expect(收到路径).toEqual([])
    const row = rowsOf(
      await 库().execute(sql`
        select probe, parse_status from auth.case_material
         where project_id = ${项目} and id = 'probe-null'
      `),
    )[0]
    expect(row?.probe === null).toBe(true)
    expect(row?.parse_status).toBe("排队中")
  })

  test("探测失败后进入冷却：同一条不会每 500ms 被重认领（I1）", async () => {
    await 造材料({ id: "probe-fail", status: "排队中", createdAt: -1 })
    await 造作业({ id: "job-probe-fail", materialId: "probe-fail", sourcePath: "u-probe/p-probe/材料/a.xlsx" })
    // 下一条**同项目**材料：证明冷却只按材料（而非按项目）生效。
    await 造材料({ id: "probe-after", status: "排队中", createdAt: 1 })

    const 一份 = await 认领待探测(库())
    expect(一份?.materialId).toBe("probe-fail")

    await 探测材料(
      库(),
      {
        root: "/sandbox",
        readFile: async () => {
          throw new Error("读表失败")
        },
        读注册表: async () => [],
      },
      一份!,
    )

    // 失败契约不变：probe 仍留空、状态不推进。
    const row = rowsOf(
      await 库().execute(sql`
        select probe, parse_status from auth.case_material
         where project_id = ${项目} and id = 'probe-fail'
      `),
    )[0]
    expect(row?.probe === null).toBe(true)
    expect(row?.parse_status).toBe("排队中")

    // 冷却期内不许立刻重认领同一条；同项目的下一条必须能认领到（把「冷却键只按 projectId」
    // 做变异靶子：那样这里拿到 undefined ⇒ 红）。
    const 再认领 = await 认领待探测(库())
    expect(再认领?.materialId).toBe("probe-after")
  })

  test("A9：viewer 用落点属主（source_path 第一段），不是 queued_by", async () => {
    await 库().execute(sql`
      insert into auth.user
        (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${"属主乙"}, 'p-owner-a9', '属主乙', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
    `)
    await 造材料({ id: "probe-a9", status: "排队中", createdAt: -100 })
    await 造作业({
      id: "job-a9",
      materialId: "probe-a9",
      sourcePath: "属主乙/p-probe/材料/a.xlsx",
      queuedBy: "成员甲",
    })

    const 一份 = await 认领待探测(库())
    expect(一份?.materialId).toBe("probe-a9")

    const 收到读者: { userId: string; department: string }[] = []
    await 探测材料(
      库(),
      {
        root: "/sandbox",
        readFile: async () => 命中表,
        // 模拟 `usableSkillAssets` 的可见性：只有属主本人看得到这份部门定向适配器。
        读注册表: async (_目录, viewer) => {
          收到读者.push({ userId: viewer.userId, department: viewer.department })
          return viewer.userId === "属主乙"
            ? [转换器({ id: "converter-a", requiredHeaders: ["交易时间", "交易金额"] })]
            : []
        },
      },
      一份!,
    )

    expect(收到读者[0]?.userId).toBe("属主乙")
    expect(收到读者[0]?.department).toBe("经侦支队")

    const row = rowsOf(
      await 库().execute(sql`
        select probe from auth.case_material
         where project_id = ${项目} and id = 'probe-a9'
      `),
    )[0]
    expect(读probe(row?.probe)["状态"]).toBe("已识别")
  })
})
