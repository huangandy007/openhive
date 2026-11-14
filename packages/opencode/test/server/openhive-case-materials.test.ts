import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Hash } from "@opencode-ai/core/util/hash"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { 材料视图 } from "../../src/server/openhive/case-materials"
import { 建模板 } from "../../src/server/openhive/case-card-template-store"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 材料视图与人工解析动作的真应用测试。
 *
 * 三组共用一套夹具：① GET 材料视图；② POST 入队 / 重新解析；③ POST 取消 / 跳过。
 * 后两组在 Task 3 / 4 追加，**夹具只在这里写一次**。
 *
 * ⚠️ PGlite 把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的：
 * 测试自己发的 SQL **文本**必须与出口里的 DAO SQL 不同，否则 42P05（同 `openhive-asset-draft`）。
 * 本文件的种子 / 断言一律写「另一套列序与换行」，不是复制 DAO 的语句。
 */

const test = testEffect(Layer.empty)
/**
 * 用 `.live` 那一档（与 `openhive-asset-draft.test.ts` 逐行一致）：本文件要签真 JWT、
 * 走真时钟（`queued_at` / `finished_at`），不要测试时钟那一套。
 */
const it = test.live
const SECRET = "c1a2s3e4m5a6t7e8r9i0a1l2s3t4u5v6"

const 我: TokenSubject = { id: "u-case-me", policeNo: "970001", name: "甲民警", isAdmin: false }
const 别人: TokenSubject = { id: "u-case-other", policeNo: "970002", name: "乙民警", isAdmin: false }

const 项目 = "p-case-mine"
const 别人的项目 = "p-case-other"

const 原始沙箱根 = mkdtempSync(join(tmpdir(), "openhive-case-ws-"))
const 项目根 = join(原始沙箱根, 我.id, 项目)
const 项目外 = mkdtempSync(join(tmpdir(), "openhive-case-outside-"))
const 数据根 = mkdtempSync(join(tmpdir(), "openhive-case-data-"))

const restoreWs = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 原始沙箱根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
/** PGlite 夹具把多条连接汇进同一个 PG 会话；事务另起连接，池只留 1 条。 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
/** 后台 worker 会认领同一个测试库的作业，把用例插进去的行悄悄跑掉。 */
const restoreWorker = restorePoint({ OPENHIVE_CASE_INGEST_WORKER: "0" })

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = 数据根

afterAll(restoreWs)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreWorker)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
})
afterAll(() => rmSync(原始沙箱根, { recursive: true, force: true }))
afterAll(() => rmSync(项目外, { recursive: true, force: true }))
afterAll(() => {
  try {
    rmSync(数据根, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有；清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
const 库 = () => {
  if (!pg) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return pg.db
}

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [我, 别人]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${项目}, ${我.id}, 'owner', 0),
           (${别人的项目}, ${别人.id}, 'owner', 0)
  `)

  mkdirSync(join(项目根, "资料"), { recursive: true })
  mkdirSync(join(项目根, "分析"), { recursive: true })
  writeFileSync(join(项目根, "资料", "话单.xlsx"), "话单内容")
  writeFileSync(join(项目根, "资料", "流水.csv"), "流水内容")
  writeFileSync(join(项目根, "资料", "笔录.pdf"), "笔录内容")
  writeFileSync(join(项目根, "资料", "说明.md"), "说明内容")
  // R9 夹具：两份文件**字节相同** ⇒ 指纹相同，`createMaterial` 会认成同一行材料。
  writeFileSync(join(项目根, "资料", "原件.xlsx"), "同一份内容")
  writeFileSync(join(项目根, "资料", "副本.xlsx"), "同一份内容")
  writeFileSync(join(项目外, "外.xlsx"), "项目外的内容")
  symlinkSync(join(项目外, "外.xlsx"), join(项目根, "资料", "链接.xlsx"), "file")
})

/** 每个用例从干净的业务表开始（用户与成员行只在 beforeAll 种一次）。 */
beforeEach(async () => {
  for (const projectId of [项目, 别人的项目]) {
    await 库().execute(sql`delete from auth.case_ingest_job where project_id = ${projectId}`)
    await 库().execute(sql`delete from auth.case_fact_row where project_id = ${projectId}`)
    await 库().execute(sql`delete from auth.case_material where project_id = ${projectId}`)
  }
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: 原始沙箱根,
}

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() => Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)))
}

const openApp = realApp(OPEN)
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

type 解析状态 = "未入队" | "排队中" | "解析中" | "已解析" | "有问题" | "已跳过"

async function 种材料(input: {
  projectId?: string
  path: string
  status?: 解析状态
  kind?: string
  detail?: unknown
  fingerprint?: string
  createdAt?: number
  queuedBy?: string | null
}): Promise<string> {
  const id = `m-${crypto.randomUUID()}`
  await 库().execute(sql`
    insert into auth.case_material
      (id, project_id, file_name, kind, fingerprint, path, parse_status, parse_detail,
       queued_by, clock_offset_sec, created_at)
    values (${id}, ${input.projectId ?? 项目}, ${input.path.split("/").at(-1) ?? input.path},
            ${input.kind ?? "话单"}, ${input.fingerprint ?? `fp-${id}`}, ${input.path},
            ${input.status ?? "未入队"},
            ${input.detail === undefined ? null : JSON.stringify(input.detail)}::jsonb,
            ${input.queuedBy ?? null}, 0, ${input.createdAt ?? 1})
  `)
  return id
}

async function 种事实(input: {
  materialId: string
  projectId?: string
  rowNo: number
  caller?: string | null
  callee?: string | null
  counterparty?: string | null
}) {
  await 库().execute(sql`
    insert into auth.case_fact_row
      (project_id, material_id, sheet, row_no, caller, callee, counterparty, extras)
    values (${input.projectId ?? 项目}, ${input.materialId}, 'Sheet1', ${input.rowNo},
            ${input.caller ?? null}, ${input.callee ?? null}, ${input.counterparty ?? null}, '{}'::jsonb)
  `)
}

async function 种作业(input: {
  materialId: string
  projectId?: string
  status?: "排队中" | "运行中" | "完成" | "失败" | "已取消"
  queuedAt?: number
}): Promise<string> {
  const id = `j-${crypto.randomUUID()}`
  await 库().execute(sql`
    insert into auth.case_ingest_job
      (id, project_id, material_id, status, attempts, queued_by, queued_at)
    values (${id}, ${input.projectId ?? 项目}, ${input.materialId}, ${input.status ?? "排队中"},
            0, null, ${input.queuedAt ?? 0})
  `)
  return id
}

async function 材料行(path: string, projectId = 项目) {
  const rows = rowsOf(
    await 库().execute(sql`
      select id, parse_status, queued_by, fingerprint, kind, parse_detail
        from auth.case_material
       where project_id = ${projectId} and path = ${path}
       order by created_at desc, id desc
    `),
  )
  const row = rows[0]
  if (!row) return undefined
  // jsonb 经驱动回来是**字符串**（与 `case-store.ts` 的 `mapMaterialRow` 同一形状）：
  // 这里先解一遍，断言才能按对象比较。
  if (typeof row.parse_detail === "string") row.parse_detail = JSON.parse(row.parse_detail)
  return row
}

async function 作业行们(materialId: string) {
  return rowsOf(
    await 库().execute(sql`
      select id, status, queued_by, finished_at
        from auth.case_ingest_job
       where project_id = ${项目} and material_id = ${materialId}
       order by queued_at, id
    `),
  )
}

async function 事实数(materialId: string) {
  const rows = rowsOf(
    await 库().execute(sql`
      select count(*)::int as n
        from auth.case_fact_row
       where project_id = ${项目} and material_id = ${materialId}
    `),
  )
  return Number(rows[0]?.n ?? 0)
}

/** 盘上文件的指纹：种「已存在材料」时必须用它，否则 `createMaterial` 会另建一行。 */
const 文件指纹 = (相对: string) =>
  Hash.sha256(readFileSync(join(项目根, ...相对.split("/"))))

const 清单形状 = Schema.Struct({
  materials: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      path: Schema.String,
      kind: Schema.String,
      status: Schema.String,
      detail: Schema.NullOr(Schema.Unknown),
      queueAhead: Schema.Number,
      factCount: Schema.Number,
      numberCount: Schema.Number,
      parseable: Schema.Boolean,
    }),
  ),
  parseableExtensions: Schema.Array(Schema.String),
})

const 读清单 = (body: unknown) => Schema.decodeUnknownSync(清单形状)(body)

const 读清单回包 = (response: Response) =>
  Effect.promise(async () => 读清单(await response.json()))

describe("GET /openhive/case/materials", () => {
  it("401：没带身份时回空体 401", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(null, `/openhive/case/materials?projectId=${项目}`)
      expect(响应.status).toBe(401)
      expect(yield* Effect.promise(() => 响应.text())).toBe("")
    }))

  it("400：projectId 缺失 / 不是合法路径段", () =>
    Effect.gen(function* () {
      for (const url of ["/openhive/case/materials", `/openhive/case/materials?projectId=..`]) {
        const 响应 = yield* 发(我, url)
        expect(响应.status, url).toBe(400)
        const 体 = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String, code: Schema.String }))(
          yield* Effect.promise(() => 响应.json()),
        )
        expect(体.code).toBe("bad_request")
      }
    }))

  it("403：不是这个项目的成员", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/materials?projectId=${别人的项目}`)
      expect(响应.status).toBe(403)
    }))

  it("视图：状态、明细、事实数、号码数、排队位置、可解析都在一次回包里", () =>
    Effect.gen(function* () {
      const 已解析 = yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "已解析", kind: "话单" }),
      )
      yield* Effect.promise(() => 种事实({ materialId: 已解析, rowNo: 1, caller: "138", callee: "139", counterparty: "138" }))
      yield* Effect.promise(() => 种事实({ materialId: 已解析, rowNo: 2, caller: "137", callee: "", counterparty: null }))
      yield* Effect.promise(() =>
        种材料({
          path: "资料/流水.csv",
          status: "有问题",
          kind: "资金",
          detail: { reason: "时间列一个都没解析出来" },
        }),
      )
      const 别人的 = yield* Effect.promise(() =>
        种材料({ projectId: 别人的项目, path: "别人/话单.xlsx", status: "已解析" }),
      )
      yield* Effect.promise(() => 种事实({ materialId: 别人的, projectId: 别人的项目, rowNo: 1, caller: "999" }))

      const 响应 = yield* 发(我, `/openhive/case/materials?projectId=${项目}`)
      const 包 = yield* 读清单回包(响应)

      expect(响应.status).toBe(200)
      expect(包.parseableExtensions).toEqual([".xlsx", ".xls", ".csv", ".txt", ".md", ".log", ".docx"])
      const 行 = (path: string) => 包.materials.find((item) => item.path === path)
      expect(行("资料/话单.xlsx")).toMatchObject({
        kind: "话单",
        status: "已解析",
        factCount: 2,
        numberCount: 3, // 138 / 139 / 137 三个不同号码
        queueAhead: 0,
        parseable: true,
      })
      expect(行("资料/流水.csv")).toMatchObject({
        status: "有问题",
        detail: { reason: "时间列一个都没解析出来" },
        factCount: 0,
        parseable: true,
      })
      // 项目隔离：别人的材料不在这一份里
      expect(包.materials.map((item) => item.path)).not.toContain("别人/话单.xlsx")
    }))

  it("排队位置按**全局**队列序算，取这份材料**最早**那条排队作业", () =>
    Effect.gen(function* () {
      const 甲 = yield* Effect.promise(() => 种材料({ path: "资料/甲.xlsx", status: "排队中" }))
      const 乙 = yield* Effect.promise(() => 种材料({ path: "资料/乙.xlsx", status: "排队中" }))
      yield* Effect.promise(() => 种作业({ materialId: 甲, queuedAt: 5 }))
      yield* Effect.promise(() => 种作业({ materialId: 甲, queuedAt: 9 })) // 同一材料两条：取最早那条
      yield* Effect.promise(() => 种作业({ materialId: 乙, queuedAt: 7 }))
      // 别人的项目也在同一个全局队列里——worker 不按项目分组
      yield* Effect.promise(() => 种作业({ materialId: "m-别人的", projectId: 别人的项目, queuedAt: 3 }))

      const 包 = yield* 读清单回包(yield* 发(我, `/openhive/case/materials?projectId=${项目}`))
      const 位置 = (path: string) => 包.materials.find((item) => item.path === path)?.queueAhead

      expect(位置("资料/甲.xlsx")).toBe(1) // 只有 3 那条在它前面
      expect(位置("资料/乙.xlsx")).toBe(2) // 3 与 5 在它前面
    }))

  it("同一路径多行时取最新的一行（内容变了会另建材料）", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "未入队", fingerprint: "fp-old", createdAt: 100 }),
      )
      const 新 = yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "已解析", fingerprint: "fp-new", createdAt: 200 }),
      )
      yield* Effect.promise(() => 种事实({ materialId: 新, rowNo: 1, caller: "138" }))

      const 包 = yield* 读清单回包(yield* 发(我, `/openhive/case/materials?projectId=${项目}`))
      const 行 = 包.materials.filter((item) => item.path === "资料/话单.xlsx")

      expect(行).toHaveLength(1)
      expect(行[0]).toMatchObject({ id: 新, status: "已解析", factCount: 1 })
    }))

  it("产物行照常返回；可解析只按扩展名判，硬边界由 kind 单独判", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        种材料({ path: "分析/结论.xlsx", status: "未入队", kind: "产物" }),
      )
      const 包 = yield* 读清单回包(yield* 发(我, `/openhive/case/materials?projectId=${项目}`))
      expect(包.materials[0]).toMatchObject({ path: "分析/结论.xlsx", kind: "产物", status: "未入队", parseable: true })
    }))

  it("文本材料也标 parseable：白名单是表格 ∪ 文本", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => 种材料({ path: "资料/笔录.txt", status: "未入队" }))
      const 包 = yield* 读清单回包(yield* 发(我, `/openhive/case/materials?projectId=${项目}`))
      expect(包.materials.find((item) => item.path === "资料/笔录.txt")).toMatchObject({
        path: "资料/笔录.txt",
        parseable: true,
      })
    }))

  it("文本材料的事实数按引用去重计数，号码数按被引用的号码实体计数", () =>
    Effect.gen(function* () {
      // 沿用本文件既有的 `种材料` / `库()` 夹具（PGlite 会话约束见文件头）。
      // `beforeEach` 只清 job / fact_row / material，不清 entity 与 citation ⇒ id 必须唯一。
      const 唯一 = crypto.randomUUID()
      const 材料id = yield* Effect.promise(() =>
        种材料({ path: `笔录-${唯一}.txt`, kind: "笔录", status: "已解析" }),
      )
      const 号码实体 = `e-${唯一}`
      // 必须再有一条**非号码**实体引用：只引号码的话，把 SQL 里 `e.type = '号码'` 删掉
      // `count(distinct e.id)` 也还是 1，变异步骤就是空转（假红/假绿都测不出来）。
      const 人实体 = `e-人-${唯一}`
      for (const [id, type, 值] of [
        [号码实体, "号码", `13800138000${唯一}`],
        [人实体, "人", `张三${唯一}`],
      ] as const) {
        yield* Effect.promise(() =>
          库().execute(sql`insert into auth.case_entity
            (id, project_id, type, canonical_value, aliases, created_at)
            values (${id}, ${项目}, ${type}, ${值}, '{}'::text[], 1)`),
        )
      }
      // 同一号码实体被两片引用 ⇒ 只算 1 条；人实体 1 条；关系 1 条 ⇒ 事实数 3、号码数 1。
      // 最后一条是 `fact_type = 'row'` 的**变异保护**：行级引用由 `facts`（明细行）计数，
      // 不许在这里再算一次；没有它，去掉 SQL 里的 `<> 'row'` 也照样绿。
      for (const [id, factType, factId] of [
        [`${唯一}-c1`, "entity", 号码实体],
        [`${唯一}-c2`, "entity", 号码实体],
        [`${唯一}-c3`, "entity", 人实体],
        [`${唯一}-c4`, "relation", `r-${唯一}`],
        [`${唯一}-c5`, "row", `${材料id}#Sheet1#2`],
      ] as const) {
        yield* Effect.promise(() =>
          库().execute(sql`insert into auth.case_citation
            (id, project_id, fact_type, fact_id, material_id, locator, extract_method, created_at)
            values (${id}, ${项目}, ${factType}, ${factId}, ${材料id}, '{}'::jsonb, '机器', 1)`),
        )
      }
      const 行 = yield* Effect.promise(() => 材料视图(库(), 项目))
      const 目标 = 行.find((m) => m.id === 材料id)
      expect(目标?.factCount).toBe(3)
      expect(目标?.numberCount).toBe(1)
    }))
})

const 解析回包形状 = Schema.Struct({ ok: Schema.Boolean, status: Schema.String })
const 错误形状 = Schema.Struct({ error: Schema.String, code: Schema.String })

const 解析 = (subject: TokenSubject | null, body: unknown) =>
  发(subject, "/openhive/case/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const 读解析回包 = (response: Response) =>
  Effect.promise(async () => Schema.decodeUnknownSync(解析回包形状)(await response.json()))

const 读错误 = (response: Response) =>
  Effect.promise(async () => Schema.decodeUnknownSync(错误形状)(await response.json()))

describe("POST /openhive/case/parse（入队 / 重新解析）", () => {
  it("入队一份新表格：材料进「排队中」、作业落库、queued_by 是操作人、指纹是内容哈希", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "入队" })
      expect(响应.status).toBe(200)
      expect(yield* 读解析回包(响应)).toEqual({ ok: true, status: "排队中" })

      const 材料 = yield* Effect.promise(() => 材料行("资料/话单.xlsx"))
      expect(材料?.parse_status).toBe("排队中")
      expect(材料?.queued_by).toBe(我.id)
      expect(材料?.fingerprint).toBe(文件指纹("资料/话单.xlsx"))

      const 作业 = yield* Effect.promise(() => 作业行们(String(材料?.id)))
      expect(作业).toHaveLength(1)
      expect(作业[0]).toMatchObject({ status: "排队中", queued_by: 我.id })
    }))

  it("重新解析一份已解析材料：事实**原样保留**，只重新排队", () =>
    Effect.gen(function* () {
      const 材料 = yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "已解析", fingerprint: 文件指纹("资料/话单.xlsx") }),
      )
      yield* Effect.promise(() => 种事实({ materialId: 材料, rowNo: 1, caller: "138" }))
      yield* Effect.promise(() => 种事实({ materialId: 材料, rowNo: 2, caller: "139" }))

      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "重新解析" })
      expect(响应.status).toBe(200)
      expect((yield* Effect.promise(() => 材料行("资料/话单.xlsx")))?.parse_status).toBe("排队中")
      expect(yield* Effect.promise(() => 事实数(材料))).toBe(2)
      const 作业 = yield* Effect.promise(() => 作业行们(材料))
      expect(作业).toHaveLength(1)
      expect(作业[0]?.queued_by).toBe(我.id)
    }))

  it("入队「有问题」的文件 = 再试一次（状态机走「重新解析」）", () =>
    Effect.gen(function* () {
      const 材料 = yield* Effect.promise(() =>
        种材料({
          path: "资料/话单.xlsx",
          status: "有问题",
          fingerprint: 文件指纹("资料/话单.xlsx"),
          detail: { reason: "上次的表头认不出" },
        }),
      )
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "入队" })
      expect(响应.status).toBe(200)
      expect((yield* Effect.promise(() => 材料行("资料/话单.xlsx")))?.parse_status).toBe("排队中")
      expect(yield* Effect.promise(() => 作业行们(材料))).toHaveLength(1)
    }))

  it("重复入队：第二次 409 already_running，作业仍然只有一条", () =>
    Effect.gen(function* () {
      yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "入队" })
      const 材料 = yield* Effect.promise(() => 材料行("资料/话单.xlsx"))

      const 第二次 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "入队" })
      expect(第二次.status).toBe(409)
      expect((yield* 读错误(第二次)).code).toBe("already_running")
      expect(yield* Effect.promise(() => 作业行们(String(材料?.id)))).toHaveLength(1)
    }))

  it("状态不允许：已解析的文件不能「入队」、未入队的文件不能「重新解析」", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "已解析", fingerprint: 文件指纹("资料/话单.xlsx") }),
      )
      const 入队 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "入队" })
      expect(入队.status).toBe(409)
      expect((yield* 读错误(入队)).code).toBe("illegal_transition")

      yield* Effect.promise(() => 库().execute(sql`delete from auth.case_material where project_id = ${项目}`))
      yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "未入队", fingerprint: 文件指纹("资料/话单.xlsx") }),
      )
      const 重来 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "重新解析" })
      expect(重来.status).toBe(409)
      expect((yield* 读错误(重来)).code).toBe("illegal_transition")
    }))

  it("重新解析一份没有记录的文件 ⇒ 404 material_not_found", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/流水.csv", action: "重新解析" })
      expect(响应.status).toBe(404)
      expect((yield* 读错误(响应)).code).toBe("material_not_found")
    }))

  it("非表格：可解释地拒绝（not_parseable），不落材料也不落作业", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/笔录.pdf", action: "入队" })
      expect(响应.status).toBe(409)
      expect((yield* 读错误(响应)).code).toBe("not_parseable")
      expect(yield* Effect.promise(() => 材料行("资料/笔录.pdf"))).toBeUndefined()
    }))

  it("文本材料走同一入口：.md 入队成功，类型落到「其他」", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/说明.md", action: "入队" })
      expect(响应.status).toBe(200)
      const 行 = yield* Effect.promise(() => 材料行("资料/说明.md"))
      // `材料行` 已按 path 查，这里钉的是类型与状态两列（列名是 `parse_status`，不是 `status`）。
      expect(行).toMatchObject({ kind: "其他", parse_status: "排队中" })
    }))

  it("产物硬边界：kind=产物 时三个解析动作都回 artifact_not_parseable", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => 种材料({ path: "分析/结论.xlsx", status: "未入队", kind: "产物" }))
      for (const action of ["入队", "重新解析", "跳过"] as const) {
        const 响应 = yield* 解析(我, { projectId: 项目, path: "分析/结论.xlsx", action })
        expect(响应.status, action).toBe(409)
        expect((yield* 读错误(响应)).code, action).toBe("artifact_not_parseable")
      }
    }))

  it("路径闸：`..` / 反斜杠 / 绝对路径 / NUL 一律 400，碰不到库也碰不到盘", () =>
    Effect.gen(function* () {
      for (const path of ["../x.xlsx", "资料/../x.xlsx", "资料\\话单.xlsx", "/etc/x.xlsx", "C:/x.xlsx", "资料/\0x.xlsx"]) {
        const 响应 = yield* 解析(我, { projectId: 项目, path, action: "入队" })
        expect(响应.status, path).toBe(400)
        expect((yield* 读错误(响应)).code, path).toBe("bad_request")
      }
    }))

  it("盘上没有这个文件 ⇒ 404 file_missing，不落材料", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/不存在.xlsx", action: "入队" })
      expect(响应.status).toBe(404)
      expect((yield* 读错误(响应)).code).toBe("file_missing")
      expect(yield* Effect.promise(() => 材料行("资料/不存在.xlsx"))).toBeUndefined()
    }))

  it("链接把落点带出项目 ⇒ 400，且话是 LINK_ESCAPE 那一句", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/链接.xlsx", action: "入队" })
      expect(响应.status).toBe(400)
      expect((yield* 读错误(响应)).code).toBe("bad_request")
    }))

  it("401 / 403：没身份与不是成员都进不了写出口", () =>
    Effect.gen(function* () {
      const 未登录 = yield* 解析(null, { projectId: 项目, path: "资料/话单.xlsx", action: "入队" })
      expect(未登录.status).toBe(401)

      const 非成员 = yield* 解析(我, {
        projectId: 别人的项目,
        path: "资料/话单.xlsx",
        action: "入队",
      })
      expect(非成员.status).toBe(403)
    }))
})

describe("POST /openhive/case/parse（指定模板 templateId）", () => {
  const 种模板 = (projectId: string, eventType: "通话" | "见面") =>
    建模板(库(), {
      projectId,
      定义: {
        name: `模板-${eventType}`,
        event_type: eventType,
        slots: { 何时: { 字段: "startedAt" } },
        required: ["何时"],
      },
    })

  it("形状非法（templateId 非字符串 / 空串）⇒ 400 bad_request，不落材料", () =>
    Effect.gen(function* () {
      for (const templateId of [123, "", "   "] as const) {
        const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "入队", templateId })
        expect(响应.status, String(templateId)).toBe(400)
        expect((yield* 读错误(响应)).code, String(templateId)).toBe("bad_request")
      }
      expect(yield* Effect.promise(() => 材料行("资料/话单.xlsx"))).toBeUndefined()
    }))

  it("「取消 / 跳过」带 templateId ⇒ 400 bad_request，材料状态不变", () =>
    Effect.gen(function* () {
      const 模板 = yield* Effect.promise(() => 种模板(项目, "通话"))
      const 材料 = yield* Effect.promise(() => 种材料({ path: "资料/话单.xlsx", status: "排队中" }))
      yield* Effect.promise(() => 种作业({ materialId: 材料, queuedAt: 1 }))
      for (const action of ["取消", "跳过"] as const) {
        const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action, templateId: 模板.id })
        expect(响应.status, action).toBe(400)
        expect((yield* 读错误(响应)).code, action).toBe("bad_request")
      }
      expect((yield* Effect.promise(() => 材料行("资料/话单.xlsx")))?.parse_status).toBe("排队中")
    }))

  it("不存在的模板 id ⇒ 400 bad_request（不是 500），不落材料", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, {
        projectId: 项目,
        path: "资料/话单.xlsx",
        action: "入队",
        templateId: "用户:00000000-0000-0000-0000-000000000000",
      })
      expect(响应.status).toBe(400)
      expect((yield* 读错误(响应)).code).toBe("bad_request")
      expect(yield* Effect.promise(() => 材料行("资料/话单.xlsx"))).toBeUndefined()
    }))

  it("别的项目的模板 id ⇒ 400 bad_request（不是 404，避免跨项目探测）", () =>
    Effect.gen(function* () {
      const 别人的模板 = yield* Effect.promise(() => 种模板(别人的项目, "通话"))
      const 响应 = yield* 解析(我, {
        projectId: 项目,
        path: "资料/话单.xlsx",
        action: "入队",
        templateId: 别人的模板.id,
      })
      expect(响应.status).toBe(400)
      expect((yield* 读错误(响应)).code).toBe("bad_request")
      expect(yield* Effect.promise(() => 材料行("资料/话单.xlsx"))).toBeUndefined()
    }))
})

describe("POST /openhive/case/parse（取消 / 跳过）", () => {
  it("排队中取消：材料回「未入队」，作业行落「已取消」并写 finished_at", () =>
    Effect.gen(function* () {
      const 材料 = yield* Effect.promise(() => 种材料({ path: "资料/话单.xlsx", status: "排队中" }))
      yield* Effect.promise(() => 种作业({ materialId: 材料, queuedAt: 1 }))

      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "取消" })
      expect(响应.status).toBe(200)
      expect(yield* 读解析回包(响应)).toEqual({ ok: true, status: "未入队" })

      expect((yield* Effect.promise(() => 材料行("资料/话单.xlsx")))?.parse_status).toBe("未入队")
      const 作业 = yield* Effect.promise(() => 作业行们(材料))
      expect(作业).toHaveLength(1)
      expect(作业[0]?.status).toBe("已取消")
      expect(Number(作业[0]?.finished_at)).toBeGreaterThan(0)
    }))

  it("解析中取消：落「有问题」＋原因「用户取消」，**已提交的事实原样保留**，运行中的作业行不碰", () =>
    Effect.gen(function* () {
      const 材料 = yield* Effect.promise(() => 种材料({ path: "资料/话单.xlsx", status: "解析中" }))
      yield* Effect.promise(() => 种事实({ materialId: 材料, rowNo: 1, caller: "138" }))
      yield* Effect.promise(() => 种事实({ materialId: 材料, rowNo: 2, caller: "139" }))
      yield* Effect.promise(() => 种作业({ materialId: 材料, status: "运行中", queuedAt: 1 }))

      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "取消" })
      expect(响应.status).toBe(200)
      expect(yield* 读解析回包(响应)).toEqual({ ok: true, status: "有问题" })

      const 行 = yield* Effect.promise(() => 材料行("资料/话单.xlsx"))
      expect(行?.parse_status).toBe("有问题")
      expect(行?.parse_detail).toEqual({ reason: "用户取消" })
      expect(yield* Effect.promise(() => 事实数(材料))).toBe(2)
      expect((yield* Effect.promise(() => 作业行们(材料)))[0]?.status).toBe("运行中")
    }))

  it("取消一份没在排队的文件 ⇒ 409 illegal_transition；没有记录 ⇒ 404", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => 种材料({ path: "资料/话单.xlsx", status: "未入队" }))
      const 未入队 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "取消" })
      expect(未入队.status).toBe(409)
      expect((yield* 读错误(未入队)).code).toBe("illegal_transition")

      const 没记录 = yield* 解析(我, { projectId: 项目, path: "资料/流水.csv", action: "取消" })
      expect(没记录.status).toBe(404)
      expect((yield* 读错误(没记录)).code).toBe("material_not_found")
    }))

  it("跳过一个未入队的表格：落「已跳过」，queued_by 记操作人", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "未入队", fingerprint: 文件指纹("资料/话单.xlsx") }),
      )
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "跳过" })
      expect(响应.status).toBe(200)
      expect(yield* 读解析回包(响应)).toEqual({ ok: true, status: "已跳过" })
      expect(yield* Effect.promise(() => 材料行("资料/话单.xlsx"))).toMatchObject({
        parse_status: "已跳过",
        queued_by: 我.id,
      })
    }))

  it("跳过一份**没有材料记录**的 PDF：登记一行 kind=其他，再落已跳过", () =>
    Effect.gen(function* () {
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/笔录.pdf", action: "跳过" })
      expect(响应.status).toBe(200)

      const 行 = yield* Effect.promise(() => 材料行("资料/笔录.pdf"))
      expect(行).toMatchObject({ parse_status: "已跳过", kind: "其他" })
      expect(行?.fingerprint).toBe(文件指纹("资料/笔录.pdf"))
      expect(行?.queued_by).toBe(我.id)
    }))

  it("已解析的文件不能跳过（409 illegal_transition）", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "已解析", fingerprint: 文件指纹("资料/话单.xlsx") }),
      )
      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "跳过" })
      expect(响应.status).toBe(409)
      expect((yield* 读错误(响应)).code).toBe("illegal_transition")
    }))

  it("跳过之后再入队：共用同一条队列与幂等（只有一条作业）", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        种材料({ path: "资料/话单.xlsx", status: "已跳过", fingerprint: 文件指纹("资料/话单.xlsx") }),
      )
      const 入队 = yield* 解析(我, { projectId: 项目, path: "资料/话单.xlsx", action: "入队" })
      expect(入队.status).toBe(200)
      const 材料 = yield* Effect.promise(() => 材料行("资料/话单.xlsx"))
      expect(材料?.parse_status).toBe("排队中")
      expect(yield* Effect.promise(() => 作业行们(String(材料?.id)))).toHaveLength(1)
    }))

  it("产物硬边界也覆盖跳过（409 artifact_not_parseable）", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => 种材料({ path: "分析/结论.xlsx", status: "未入队", kind: "产物" }))
      const 响应 = yield* 解析(我, { projectId: 项目, path: "分析/结论.xlsx", action: "跳过" })
      expect(响应.status).toBe(409)
      expect((yield* 读错误(响应)).code).toBe("artifact_not_parseable")
    }))
})

describe("POST /openhive/case/parse（评审遗留 R9 / R10）", () => {
  it("R9：入队与已有材料同指纹（同一内容在别处已解析）⇒ 409 illegal_transition，不是 state_changed", () =>
    Effect.gen(function* () {
      // 材料行落在「原件」，指纹取「副本」的字节（两文件字节相同）；path 不同 ⇒
      // `getMaterialByPath(副本)` 找不到，`createMaterial` 按指纹撞上「原件」那一行。
      yield* Effect.promise(() =>
        种材料({ path: "资料/原件.xlsx", status: "已解析", fingerprint: 文件指纹("资料/副本.xlsx") }),
      )

      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/副本.xlsx", action: "入队" })
      expect(响应.status).toBe(409)
      expect((yield* 读错误(响应)).code).toBe("illegal_transition")
    }))

  it("R10：取消**不读盘**——文件已删也能取消排队", () =>
    Effect.gen(function* () {
      const 材料 = yield* Effect.promise(() => 种材料({ path: "资料/已删.xlsx", status: "排队中" }))
      yield* Effect.promise(() => 种作业({ materialId: 材料, queuedAt: 1 }))

      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/已删.xlsx", action: "取消" })
      expect(响应.status).toBe(200)
      expect(yield* 读解析回包(响应)).toEqual({ ok: true, status: "未入队" })
    }))

  it("R10：跳过已有记录**不读盘**——文件已删也能跳过", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => 种材料({ path: "资料/已删2.xlsx", status: "未入队" }))

      const 响应 = yield* 解析(我, { projectId: 项目, path: "资料/已删2.xlsx", action: "跳过" })
      expect(响应.status).toBe(200)
      expect(yield* 读解析回包(响应)).toEqual({ ok: true, status: "已跳过" })
      expect((yield* Effect.promise(() => 材料行("资料/已删2.xlsx")))?.parse_status).toBe("已跳过")
    }))
})
