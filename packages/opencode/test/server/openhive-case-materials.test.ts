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
  return rows[0]
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
      expect(包.parseableExtensions).toEqual([".xlsx", ".xls", ".csv"])
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
})
