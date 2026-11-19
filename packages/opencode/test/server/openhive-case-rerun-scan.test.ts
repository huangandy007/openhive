import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 扫候选, 批量入队, type 扫描依赖, type 扫描范围 } from "../../src/server/openhive/case-rerun-scan"
import type { 条目 } from "../../src/server/openhive/project-tree-scan"

/**
 * T015 · 重跑扫描与批量入队（N5）。
 *
 * harness 照 `openhive-case-ingest.test.ts`：真库（`startProductionDb` + `connect` + `migrate`），
 * 每个用例一个临时项目根目录；`读目录` / `读文件字节` 注入内存实现（不碰盘）。
 *
 * ## 为什么用真库
 *
 * 三类候选的取数是两条真 SQL（含 `distinct on` 与「排除已取消」），PGlite / 假仓储测不出
 * `distinct on` 的语义，也测不出 SQL 方言漂移。
 *
 * ## 已取消作业那条是刻意的
 *
 * 用例 1 在「未识别」材料上同时种一条**更新**的已取消作业（原因码空）。不排除已取消的话，
 * `distinct on` 会选中它，「未识别」筛不出来 —— 这正是 Ruling W 的回归点。
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

const 临时根们: string[] = []

afterAll(async () => {
  for (const 根 of 临时根们) {
    try {
      await rm(根, { recursive: true, force: true })
    } catch {
      // Windows 上句柄可能仍被持有：清理失败不该变成测试失败。
    }
  }
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

/** 新建一个临时项目根（返回根与它的父目录，父目录用于递归清理）。 */
async function 临时根(子段: string[] = []): Promise<string> {
  const 底 = await mkdtemp(join(tmpdir(), "openhive-rerun-scan-"))
  临时根们.push(底)
  const 根 = join(底, ...子段)
  await mkdir(根, { recursive: true })
  return 根
}

let 项目序号 = 0
function 新项目(): string {
  项目序号 += 1
  return `prj_rerun_${项目序号}_${Date.now()}`
}

interface 造材料输入 {
  projectId: string
  id: string
  fileName: string
  fingerprint: string
  path: string
  status?: string
  kind?: string
  createdAt?: number
}

async function 造材料(输入: 造材料输入) {
  await db().execute(sql`
    insert into auth.case_material
      (id, project_id, file_name, kind, fingerprint, path, parse_status, created_at)
    values (${输入.id}, ${输入.projectId}, ${输入.fileName}, ${输入.kind ?? "其他"}, ${输入.fingerprint},
            ${输入.path}, ${输入.status ?? "未入队"}, ${输入.createdAt ?? 1000})
  `)
}

async function 造作业(输入: {
  projectId: string
  id: string
  materialId: string
  status: string
  reasonCode: string | null
  queuedAt: number
}) {
  await db().execute(sql`
    insert into auth.case_ingest_job
      (id, project_id, material_id, status, attempts, queued_at, reason_code)
    values (${输入.id}, ${输入.projectId}, ${输入.materialId}, ${输入.status}, 1,
            ${输入.queuedAt}, ${输入.reasonCode})
  `)
}

/** 内存项目树：`目录` 的 key 是 `扫树` 传给 `读目录` 的那个 `dir`（`""` 是根）。 */
function 建依赖(
  根目录: string,
  目录: Record<string, 条目[]>,
  文件: Record<string, Uint8Array>,
  额外: Partial<扫描依赖> = {},
): 扫描依赖 {
  return {
    根目录,
    读目录: async (dir) => 目录[dir],
    读文件字节: async (绝对) => 文件[绝对],
    ...额外,
  }
}

const 字节 = (文本: string) => new TextEncoder().encode(文本)

const 全部范围: readonly 扫描范围[] = ["目录独有", "未入队", "未识别"]

describe("扫候选", () => {
  test("1. 三类候选各命中；合计=3；样本按 目录独有→未入队→未识别 排序", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 依赖 = 建依赖(
      根,
      {
        "": [{ path: "材料", type: "directory", ignored: false }],
        材料: [{ path: "材料/新文件.xlsx", type: "file", ignored: false }],
      },
      { [join(根, "材料/新文件.xlsx")]: 字节("目录独有的内容-1") },
    )
    await 造材料({ projectId: 项目, id: "m-未入队", fileName: "排队.xlsx", fingerprint: "fp-未入队", path: "材料/排队.xlsx" })
    await 造材料({
      projectId: 项目,
      id: "m-未识别",
      fileName: "坏.xlsx",
      fingerprint: "fp-未识别",
      path: "材料/坏.xlsx",
      status: "有问题",
    })
    await 造作业({
      projectId: 项目,
      id: "j-完成",
      materialId: "m-未识别",
      status: "完成",
      reasonCode: "未识别:无匹配适配器",
      queuedAt: 100,
    })
    // Ruling W：更新的已取消作业（原因码空）不得遮蔽上面那条「完成」。
    await 造作业({
      projectId: 项目,
      id: "j-已取消",
      materialId: "m-未识别",
      status: "已取消",
      reasonCode: null,
      queuedAt: 200,
    })

    const 结果 = await 扫候选(db(), { projectId: 项目, 范围: 全部范围, 依赖 })

    expect(结果.合计).toBe(3)
    expect(结果.候选.目录独有).toEqual([{ path: "材料/新文件.xlsx" }])
    expect(结果.候选.未入队).toEqual([{ materialId: "m-未入队", path: "材料/排队.xlsx" }])
    expect(结果.候选.未识别).toEqual([
      { materialId: "m-未识别", path: "材料/坏.xlsx", 原因码: "未识别:无匹配适配器" },
    ])
    expect(结果.样本).toEqual(["材料/新文件.xlsx", "材料/排队.xlsx", "材料/坏.xlsx"])
    expect(结果.截断).toBe(false)
  })

  test("2. 已解析不进任何一类（带对照：未入队那条照常命中）", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 依赖 = 建依赖(根, { "": [] }, {})
    await 造材料({
      projectId: 项目,
      id: "m-已解析",
      fileName: "解析过.xlsx",
      fingerprint: "fp-已解析",
      path: "材料/解析过.xlsx",
      status: "已解析",
    })
    await 造作业({
      projectId: 项目,
      id: "j-已解析",
      materialId: "m-已解析",
      status: "完成",
      reasonCode: null,
      queuedAt: 10,
    })
    await 造材料({
      projectId: 项目,
      id: "m-对照",
      fileName: "对照.xlsx",
      fingerprint: "fp-对照",
      path: "材料/对照.xlsx",
    })

    const 结果 = await 扫候选(db(), { projectId: 项目, 范围: 全部范围, 依赖 })

    expect(结果.合计).toBe(1)
    expect(结果.候选.目录独有).toEqual([])
    expect(结果.候选.未识别).toEqual([])
    expect(结果.候选.未入队).toEqual([{ materialId: "m-对照", path: "材料/对照.xlsx" }])
    expect(结果.样本).toEqual(["材料/对照.xlsx"])
  })

  test("3. 同内容材料改过 path：旧路径不报「目录独有」（sha256 去重，R9）", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 同内容 = 字节("同一份内容，改名前后字节相同")
    const 依赖 = 建依赖(
      根,
      {
        "": [{ path: "材料", type: "directory", ignored: false }],
        材料: [
          { path: "材料/原名.xlsx", type: "file", ignored: false },
          { path: "材料/另一份.xlsx", type: "file", ignored: false },
        ],
      },
      {
        [join(根, "材料/原名.xlsx")]: 同内容,
        [join(根, "材料/另一份.xlsx")]: 字节("另一份不同的内容"),
      },
    )
    await 造材料({
      projectId: 项目,
      id: "m-改名",
      fileName: "改名后.xlsx",
      fingerprint: Hash.sha256(Buffer.from(同内容)),
      path: "材料/改名后.xlsx",
      status: "已解析",
    })

    const 结果 = await 扫候选(db(), { projectId: 项目, 范围: ["目录独有"], 依赖 })

    // 旧路径（同 sha）不报；只报真正的新内容——后半句防止「什么都不报」也绿。
    expect(结果.候选.目录独有).toEqual([{ path: "材料/另一份.xlsx" }])
    expect(结果.合计).toBe(1)
  })

  test("4. 截断如实上报：50001 条路径 ⇒ 截断=true，合计不被清零", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 条目们: 条目[] = [
      { path: "材料/真材料.xlsx", type: "file", ignored: false },
      ...Array.from({ length: 50_000 }, (_, i): 条目 => ({
        path: `材料/f${i}.bin`,
        type: "file",
        ignored: false,
      })),
    ]
    const 依赖 = 建依赖(根, { "": 条目们 }, {
      [join(根, "材料/真材料.xlsx")]: 字节("截断边界内唯一可解析的那份"),
    })

    const 结果 = await 扫候选(db(), { projectId: 项目, 范围: ["目录独有"], 依赖 })

    expect(结果.截断).toBe(true)
    expect(结果.合计).toBe(1)
    expect(结果.候选.目录独有).toEqual([{ path: "材料/真材料.xlsx" }])
  })
})

describe("修复轮 1（产物行 / 同一 path 多行）", () => {
  test("7. 产物行不进三类候选；批量入队不增作业、不另建行", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 依赖 = 建依赖(根, { "": [] }, {})
    // `case_material_parsed_source` 把产物的 parse_status 钉死为「未入队」：只看状态会把它当候选。
    await 造材料({
      projectId: 项目,
      id: "m-产物",
      fileName: "资金分析报告.md",
      fingerprint: "fp-产物",
      path: "材料/资金分析报告.md",
      status: "未入队",
      kind: "产物",
    })

    const 扫描 = await 扫候选(db(), { projectId: 项目, 范围: 全部范围, 依赖 })
    expect(扫描.合计).toBe(0)
    expect(扫描.候选.目录独有).toEqual([])
    expect(扫描.候选.未入队).toEqual([])
    expect(扫描.候选.未识别).toEqual([])

    const 结果 = await 批量入队(db(), { projectId: 项目, 范围: 全部范围, userId: "u-操作人", 依赖 })
    expect(结果).toEqual({ 已入队: 0, 跳过: [], 失败: [] })

    // 产物硬边界：不排作业，也不另建一行 `kind='其他'` 绕过 0031 的约束。
    const 作业数 = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_ingest_job where project_id = ${项目}`),
    )
    expect(Number(作业数[0]?.n)).toBe(0)
    const 材料数 = rowsOf(
      await db().execute(sql`select count(*)::int as n from auth.case_material where project_id = ${项目}`),
    )
    expect(Number(材料数[0]?.n)).toBe(1)
  })

  test("8. 同一 path 只认最新一行：旧「未入队」+ 新「已解析」⇒ 不进候选", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 依赖 = 建依赖(根, { "": [] }, {})
    // 内容变过 ⇒ 另建一行（fingerprint 不同），旧行留着；界面上那份文件只认最新一行。
    await 造材料({
      projectId: 项目,
      id: "m-旧行",
      fileName: "流水.xlsx",
      fingerprint: "fp-旧",
      path: "材料/流水.xlsx",
      status: "未入队",
      createdAt: 100,
    })
    await 造材料({
      projectId: 项目,
      id: "m-新行",
      fileName: "流水.xlsx",
      fingerprint: "fp-新",
      path: "材料/流水.xlsx",
      status: "已解析",
      createdAt: 200,
    })
    // 对照：另一条真·未入队必须照常命中，防止「查询写坏了 ⇒ 全部为空」也绿。
    await 造材料({
      projectId: 项目,
      id: "m-对照",
      fileName: "对照.xlsx",
      fingerprint: "fp-对照-8",
      path: "材料/对照.xlsx",
    })

    const 结果 = await 扫候选(db(), { projectId: 项目, 范围: 全部范围, 依赖 })

    expect(结果.候选.未入队).toEqual([{ materialId: "m-对照", path: "材料/对照.xlsx" }])
    expect(结果.合计).toBe(1)
  })
})

describe("批量入队", () => {
  test("5. 汇总数 = 实际入队数；sourcePath = 沙箱前缀/材料/xxx（默认前缀按根目录末两段）", async () => {
    const 根 = await 临时根(["u1", "prj1"])
    const 项目 = 新项目()
    const 盘上内容 = 字节("批量入队-目录独有")
    const 依赖 = 建依赖(
      根,
      {
        "": [{ path: "材料", type: "directory", ignored: false }],
        材料: [{ path: "材料/新文件.xlsx", type: "file", ignored: false }],
      },
      { [join(根, "材料/新文件.xlsx")]: 盘上内容 },
    )
    await 造材料({ projectId: 项目, id: "m-未入队", fileName: "排队.xlsx", fingerprint: "fp-未入队", path: "材料/排队.xlsx" })
    await 造材料({
      projectId: 项目,
      id: "m-未识别",
      fileName: "坏.xlsx",
      fingerprint: "fp-未识别",
      path: "材料/坏.xlsx",
      status: "有问题",
    })
    await 造作业({
      projectId: 项目,
      id: "j-完成",
      materialId: "m-未识别",
      status: "完成",
      reasonCode: "未识别:无匹配适配器",
      queuedAt: 100,
    })

    const 结果 = await 批量入队(db(), {
      projectId: 项目,
      范围: 全部范围,
      userId: "u-操作人",
      依赖,
    })

    expect(结果).toEqual({ 已入队: 3, 跳过: [], 失败: [] })

    // 三条材料都在队列里。
    const 材料们 = rowsOf(
      await db().execute(sql`select path, parse_status from auth.case_material where project_id = ${项目}`),
    )
    // 用 Map 比较：DB 的 `order by path` 走库的排序规则，别把断言绑到运行环境的 locale 上。
    expect(材料们.length).toBe(3)
    expect(new Map(材料们.map((行) => [String(行.path), String(行.parse_status)]))).toEqual(
      new Map([
        ["材料/坏.xlsx", "排队中"],
        ["材料/新文件.xlsx", "排队中"],
        ["材料/排队.xlsx", "排队中"],
      ]),
    )

    // 目录独有那份材料的作业落点：`{沙箱前缀}/{项目内路径}`，`/` 分隔。
    // 默认前缀 = 根目录末两段（根是 `<底>/u1/prj1`）。
    const 新材料 = rowsOf(
      await db().execute(sql`
        select id from auth.case_material
         where project_id = ${项目} and fingerprint = ${Hash.sha256(Buffer.from(盘上内容))}
      `),
    )
    expect(新材料.length).toBe(1)
    const 作业 = rowsOf(
      await db().execute(sql`
        select source_path from auth.case_ingest_job
         where project_id = ${项目} and material_id = ${String(新材料[0]?.id)}
      `),
    )
    expect(作业.map((行) => String(行.source_path))).toEqual(["u1/prj1/材料/新文件.xlsx"])
  })

  test("10. 目录独有带反斜杠 ⇒ 按平台断言：win32 归一为 /，POSIX 保持字面字符", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 内容 = 字节("反斜杠路径的目录独有内容")
    // `扫树` 在 win32 上把 `path.relative` 的原样（`材料\批1.xlsx`）交回来；
    // POSIX 上 `\` 是文件名的字面字符（`file.ts:475-482`），不得改写。
    const 依赖 = 建依赖(
      根,
      {
        "": [{ path: "材料", type: "directory", ignored: false }],
        材料: [{ path: "材料\\批1.xlsx", type: "file", ignored: false }],
      },
      { [join(根, "材料\\批1.xlsx")]: 内容 },
      { 沙箱前缀: "u10/prj10" },
    )

    const 结果 = await 批量入队(db(), { projectId: 项目, 范围: ["目录独有"], userId: "u-操作人", 依赖 })
    expect(结果).toEqual({ 已入队: 1, 跳过: [], 失败: [] })

    // 上传链路（`file.ts` 的 `relativePath`）恒写 `/`；win32 的 `\` 必须归一成同一形状。
    // POSIX 的 `\` 是正文、不是分隔符，保持原样——改了就是改用户的文件名。
    const 期望 = process.platform === "win32" ? "材料/批1.xlsx" : "材料\\批1.xlsx"
    const 材料们 = rowsOf(
      await db().execute(sql`select path from auth.case_material where project_id = ${项目}`),
    )
    expect(材料们.map((行) => String(行.path))).toEqual([期望])

    const 作业们 = rowsOf(
      await db().execute(sql`select source_path from auth.case_ingest_job where project_id = ${项目}`),
    )
    expect(作业们.map((行) => String(行.source_path))).toEqual([`u10/prj10/${期望}`])
  })

  test("11. 平台无关：join 拼出的路径入库恒为 / 分隔", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 内容 = 字节("join 拼出的目录独有内容")
    // `join` 按平台给 `材料/批2.xlsx`（POSIX）或 `材料\批2.xlsx`（win32）——
    // 不管哪种，入库形态必须是上传链路同口径的 `/`。
    const 扫树路径 = join("材料", "批2.xlsx")
    const 依赖 = 建依赖(
      根,
      {
        "": [{ path: "材料", type: "directory", ignored: false }],
        材料: [{ path: 扫树路径, type: "file", ignored: false }],
      },
      { [join(根, 扫树路径)]: 内容 },
      { 沙箱前缀: "u11/prj11" },
    )

    const 结果 = await 批量入队(db(), { projectId: 项目, 范围: ["目录独有"], userId: "u-操作人", 依赖 })
    expect(结果).toEqual({ 已入队: 1, 跳过: [], 失败: [] })

    const 材料们 = rowsOf(
      await db().execute(sql`select path from auth.case_material where project_id = ${项目}`),
    )
    expect(材料们.map((行) => String(行.path))).toEqual(["材料/批2.xlsx"])

    const 作业们 = rowsOf(
      await db().execute(sql`select source_path from auth.case_ingest_job where project_id = ${项目}`),
    )
    expect(作业们.map((行) => String(行.source_path))).toEqual(["u11/prj11/材料/批2.xlsx"])
  })

  test("6. 已解析的候选被跳过（扫描后被并发改状态，第二道防线拦下）", async () => {
    const 根 = await 临时根()
    const 项目 = 新项目()
    const 依赖文件: Record<string, Uint8Array> = { [join(根, "材料/新文件.xlsx")]: 字节("并发改状态-目录独有") }
    let 已翻 = false
    const 依赖 = 建依赖(
      根,
      {
        "": [{ path: "材料", type: "directory", ignored: false }],
        材料: [{ path: "材料/新文件.xlsx", type: "file", ignored: false }],
      },
      依赖文件,
      {
        // 扫树读这份字节时，把「未入队」那条材料并发改成「已解析」：
        // 候选快照已含它（材料查询先于扫树），入队时却必须按**当前**状态跳过。
        读文件字节: async (绝对) => {
          if (!已翻) {
            已翻 = true
            await db().execute(sql`
              update auth.case_material set parse_status = '已解析'
               where project_id = ${项目} and id = 'm-将被改'
            `)
          }
          return 依赖文件[绝对]
        },
      },
    )
    await 造材料({
      projectId: 项目,
      id: "m-将被改",
      fileName: "待改.xlsx",
      fingerprint: "fp-待改",
      path: "材料/待改.xlsx",
    })
    await 造材料({
      projectId: 项目,
      id: "m-未识别",
      fileName: "坏.xlsx",
      fingerprint: "fp-未识别-6",
      path: "材料/坏.xlsx",
      status: "有问题",
    })
    await 造作业({
      projectId: 项目,
      id: "j-完成-6",
      materialId: "m-未识别",
      status: "完成",
      reasonCode: "未识别:无匹配适配器",
      queuedAt: 100,
    })

    const 结果 = await 批量入队(db(), {
      projectId: 项目,
      范围: 全部范围,
      userId: "u-操作人",
      依赖: { ...依赖, 沙箱前缀: "u6/prj6" },
    })

    expect(结果.已入队).toBe(2)
    expect(结果.跳过).toEqual([{ path: "材料/待改.xlsx", 原因: "已解析" }])
    expect(结果.失败).toEqual([])

    // 显式沙箱前缀同样落进 `source_path`（Ruling AQ）。
    const 作业们 = rowsOf(
      await db().execute(sql`
        select j.source_path
          from auth.case_ingest_job j
          join auth.case_material m on m.project_id = j.project_id and m.id = j.material_id
         where j.project_id = ${项目} and m.path = '材料/坏.xlsx' and j.status = '排队中'
      `),
    )
    expect(作业们.map((行) => String(行.source_path))).toEqual(["u6/prj6/材料/坏.xlsx"])
  })
})
