import { afterAll, beforeAll, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 配对工作表, 表统计, 读表格材料 } from "../../script/openhive-case-stage0"
import type { RawCell, RawSheet } from "../../src/server/openhive/case-sheet"
import { createMaterial } from "../../src/server/openhive/case-store"

/**
 * 阶段 0 取材料的 SQL（Task 12）。
 *
 * 为什么在这里起真 PG：被判定的正是**真库的列名与关联**——`auth.case_material` 没有
 * `source_path`，它只在 `auth.case_ingest_job` 上。PGlite 与生产同驱动，列名错了会当场
 * 报 `column ... does not exist`；这也是脚本「从未跑过」的原因，用假库会把它藏起来。
 *
 * 起库形状照 `openhive-case-mcp-tools.test.ts`：`startProductionDb()` 建库，自己用生产入口
 * `connect({ PG_POOL_MAX: "1" })` 建**一条**连接（PGlite 多连接 + bun-sql 连接级语句缓存
 * 会撞 `42P05`）。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
})

afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})

/**
 * 种一份材料并把它推到指定解析状态。
 *
 * `createMaterial` 只建「未入队」行（生产出口），状态推进照生产一样走 SQL——这里直接
 * update，因为本用例量的是**读取侧**的分母，不是状态机。
 */
async function 种材料(input: {
  projectId: string
  id: string
  path: string
  parseStatus?: "已解析" | "有问题"
}): Promise<void> {
  await createMaterial(库(), {
    id: input.id,
    projectId: input.projectId,
    fileName: input.path.split("/").pop() ?? input.id,
    kind: "资金",
    fingerprint: `${input.projectId}::${input.id}`,
    path: input.path,
  })
  await 库().execute(sql`
    update auth.case_material
       set parse_status = ${input.parseStatus ?? "已解析"}
     where project_id = ${input.projectId} and id = ${input.id}
  `)
}

/** 种一条入队作业。`source_path` / `queued_at` 是这道查询的两个判别维度。 */
async function 种作业(input: {
  projectId: string
  id: string
  materialId: string
  sourcePath: string
  queuedAt: number
}): Promise<void> {
  await 库().execute(sql`
    insert into auth.case_ingest_job
      (id, project_id, material_id, source_path, status, attempts, queued_at)
    values (${input.id}, ${input.projectId}, ${input.materialId}, ${input.sourcePath}, '完成', 1, ${input.queuedAt})
  `)
}

const 格 = (text: string | null): RawCell => ({ text, kind: text === null || text === "" ? "empty" : "text" })

test("同一材料有新旧两条 job ⇒ 取新那条的 source_path", async () => {
  const projectId = "p-stage0-最新"
  await 种材料({ projectId, id: "m-最新", path: "材料/流水.xlsx" })
  await 种作业({ projectId, id: "j-旧", materialId: "m-最新", sourcePath: `${projectId}/旧.xlsx`, queuedAt: 100 })
  await 种作业({ projectId, id: "j-新", materialId: "m-最新", sourcePath: `${projectId}/新.xlsx`, queuedAt: 200 })

  // 全量等值断言：多带一条旧作业也让这里红（不是只看「包含新值」）。
  expect(await 读表格材料(库(), projectId)).toEqual([
    { id: "m-最新", sourcePath: `${projectId}/新.xlsx`, path: "材料/流水.xlsx", 缺落点: false },
  ])
})

test("材料没有任何 job ⇒ 仍被返回，并标记缺落点（不是消失）", async () => {
  const projectId = "p-stage0-缺"
  await 种材料({ projectId, id: "m-缺", path: "材料/无作业.xlsx" })

  expect(await 读表格材料(库(), projectId)).toEqual([
    { id: "m-缺", sourcePath: "", path: "材料/无作业.xlsx", 缺落点: true },
  ])
})

test("最新 job 的 source_path 为空 ⇒ 回落到较旧那条非空的", async () => {
  // `source_path <> ''` 必须在 distinct 之前过滤：反过来（先取最新再判空）会让
  // 一条空的补跑作业把可用的落点遮掉，材料静默变成「缺落点」。
  const projectId = "p-stage0-空"
  await 种材料({ projectId, id: "m-空", path: "材料/回落.xlsx" })
  await 种作业({ projectId, id: "j-有", materialId: "m-空", sourcePath: `${projectId}/有.xlsx`, queuedAt: 100 })
  await 种作业({ projectId, id: "j-空", materialId: "m-空", sourcePath: "", queuedAt: 200 })

  expect(await 读表格材料(库(), projectId)).toEqual([
    { id: "m-空", sourcePath: `${projectId}/有.xlsx`, path: "材料/回落.xlsx", 缺落点: false },
  ])
})

test("parse_status 不是『已解析』的材料被排除", async () => {
  const projectId = "p-stage0-状态"
  await 种材料({ projectId, id: "m-好", path: "材料/好.xlsx" })
  await 种材料({ projectId, id: "m-坏", path: "材料/坏.xlsx", parseStatus: "有问题" })
  await 种作业({ projectId, id: "j-好", materialId: "m-好", sourcePath: `${projectId}/好.xlsx`, queuedAt: 100 })
  await 种作业({ projectId, id: "j-坏", materialId: "m-坏", sourcePath: `${projectId}/坏.xlsx`, queuedAt: 200 })

  // 同项目留一份「好」材料做正控：否则「返回空」在整条 SQL 挂掉时也成立。
  expect((await 读表格材料(库(), projectId)).map((材料) => 材料.id)).toEqual(["m-好"])
})

test("非表格扩展名被排除（复用 可解析表格 的口径）", async () => {
  const projectId = "p-stage0-后缀"
  await 种材料({ projectId, id: "m-xlsx", path: "材料/流水.XLSX" })
  await 种材料({ projectId, id: "m-txt", path: "材料/笔录.txt" })
  await 种作业({ projectId, id: "j-xlsx", materialId: "m-xlsx", sourcePath: `${projectId}/流水.XLSX`, queuedAt: 100 })
  await 种作业({ projectId, id: "j-txt", materialId: "m-txt", sourcePath: `${projectId}/笔录.txt`, queuedAt: 200 })

  expect((await 读表格材料(库(), projectId)).map((材料) => 材料.id)).toEqual(["m-xlsx"])
})

test("表统计：行/列与 §10.1 行级指标按映射列实测", async () => {
  const 表: RawSheet = {
    name: "Sheet1",
    header: [格("交易时间"), 格("交易金额"), 格("交易对方账号"), 格("本方账号"), 格("借贷标志"), 格("备注")],
    rows: [
      { rowNo: 2, cells: [格("2026-01-01"), 格("1,200.50"), 格("6222000011112222"), 格(""), 格("收"), 格("甲")] },
      { rowNo: 3, cells: [格("2026-01-02"), 格(""), 格(""), 格("6217000011112222"), 格(""), 格("乙")] },
      { rowNo: 4, cells: [格(null), 格("300"), 格("6217000033334444"), 格("6217000033334444"), 格(""), 格(null)] },
    ],
  }

  // 列 0 → startedAt、1 → amount、2 → counterparty、3 → ownerAccount、4 → direction；备注列未认。
  // 金额合计 = 1200.50 + 300（空/未认不算）；行级非空按「该行映射列有任意非空」计一次。
  expect(表统计(表, { 0: "startedAt", 1: "amount", 2: "counterparty", 3: "ownerAccount", 4: "direction" })).toEqual({
    列数: 6,
    行数: 3,
    金额合计: 1500.5,
    时间非空数: 2,
    counterparty非空: 2,
    ownerAccount非空: 2,
    direction非空: 1,
  })
})

test("表统计：金额按分累加，0.1 + 0.2 + 0.3 必须正好等于 0.6", () => {
  // 浮点直接累加会得到 0.6000000000000001；基线数字要能直接抄，也避免逐材料求和漂移。
  const 表: RawSheet = {
    name: "Sheet1",
    header: [格("金额")],
    rows: ["0.1", "0.2", "0.3"].map((金额, i) => ({ rowNo: i + 2, cells: [格(金额)] })),
  }

  expect(表统计(表, { 0: "amount" }).金额合计).toBe(0.6)
})

test("表统计：每笔先按分取整（0.29×3 的 0.29*100 不是整数，只在末尾收敛会留尾巴）", () => {
  // 0.1 / 0.2 / 0.3 乘 100 恰好都是整数，区分不出「逐笔取整」与「只在末尾收敛」。
  // 0.29 * 100 = 28.999999999999996：不逐笔 Math.round 会累出 0.8699999999999999。
  const 表: RawSheet = {
    name: "Sheet1",
    header: [格("金额")],
    rows: ["0.29", "0.29", "0.29"].map((金额, i) => ({ rowNo: i + 2, cells: [格(金额)] })),
  }

  expect(表统计(表, { 0: "amount" }).金额合计).toBe(0.87)
})

test("表统计：多列映射 amount 时逐列相加（同一行两列都有值 ⇒ 合计包含两次）", () => {
  // 已知口径（借贷分列通常每行只填一边）：不是按行去重，与行级非空的口径不同。
  const 表: RawSheet = {
    name: "Sheet1",
    header: [格("借方发生额"), 格("贷方发生额")],
    rows: [{ rowNo: 2, cells: [格("100"), 格("100")] }],
  }

  expect(表统计(表, { 0: "amount", 1: "amount" }).金额合计).toBe(200)
})

const 识别表 = (name: string): Parameters<typeof 配对工作表>[1][number] => ({
  sheet: name,
  表头: [null],
  列: {},
  来源: {},
  待确认: [],
  方法: "词典",
  未知列: 0,
  命中: false,
})

test("配对工作表：等长同序时原样返回配对", () => {
  const 甲: RawSheet = { name: "Sheet1", header: [格("A")], rows: [] }
  const 乙: RawSheet = { name: "Sheet2", header: [格("B")], rows: [] }
  const 配对 = 配对工作表([甲, 乙], [识别表("Sheet1"), 识别表("Sheet2")])

  expect(配对.map(({ 原表, 表 }) => [原表.name, 表.sheet])).toEqual([
    ["Sheet1", "Sheet1"],
    ["Sheet2", "Sheet2"],
  ])
})

test("配对工作表：数量不等直接抛错（不静默少算一张表）", () => {
  const 甲: RawSheet = { name: "Sheet1", header: [格("A")], rows: [] }

  expect(() => 配对工作表([甲], [])).toThrow(/工作表数与原始 sheet 数不等/)
})

test("配对工作表：名字错位直接抛错（不把统计挂到别的表头上）", () => {
  const 甲: RawSheet = { name: "Sheet1", header: [格("A")], rows: [] }
  const 乙: RawSheet = { name: "Sheet2", header: [格("B")], rows: [] }

  expect(() => 配对工作表([甲, 乙], [识别表("Sheet2"), 识别表("Sheet1")])).toThrow(/工作表错位/)
})
