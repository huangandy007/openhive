import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { 手画边 } from "../../../app/src/center/case-views/hgraph/edge"
import { 校验来源 } from "../../src/server/openhive/hgraph-file"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"
import { testEffect } from "../lib/effect"

/**
 * T2 · 跨层契约：前端手画边构造器 × 后端来源闸 / 唯一写入路径（修复轮 2026-11-16）。
 *
 * 为什么放在 `packages/opencode`：`校验来源` 是**全仓唯一**的来源硬闸实现（hgraph-file §`校验来源`），
 * `POST /openhive/hgraph/ops` 是唯一写入口。前端构造器若与后端闸的判据漂了（例如构造器不再写
 * `依据`、或 `来源.kind` 写了个非法值），只有把**前端真实构造器**喂给**后端真实闸与真实写口**
 * 才拦得住。导入的是前端纯模块（`edge.ts` 只 import `./file` 的类型与 `./temp-id`），不引 Solid。
 *
 * 夹具照 `case-hgraph-ops.test.ts`：真应用 ＋ `ConfigProvider` ＋ **Cookie 身份**（不是 Bearer）；
 * 项目目录按生产常态建在 `{沙箱根}/{属主}/{projectId}`（`#006-11`）。
 */
const test = testEffect(Layer.empty)
const it = test.live
const SECRET = "t0s1u2v3w4x5y6z7a8b9c0d1e2f3g4h5"

/** ⚠️ 用户 id 必须 ASCII（网关会把它塞进 `x-user-id` 头，中文会被 Web Request 判非法）。 */
const 我: TokenSubject = { id: "u-hgraph-contract", policeNo: "980021", name: "甲民警", isAdmin: false }
const 项目 = "p-hgraph-contract"

const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-hgraph-contract-"))
const 数据根 = join(沙箱根, "data")
const restoreWs = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 沙箱根 })
const restoreDataRoot = restorePoint({ OPENHIVE_DATA_ROOT: 数据根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
const restoreWorker = restorePoint({ OPENHIVE_CASE_INGEST_WORKER: "0" })

afterAll(restoreWs)
afterAll(restoreDataRoot)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreWorker)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${我.id}, ${我.policeNo}, ${我.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${项目}, ${我.id}, 'owner', 0)
  `)
  mkdirSync(我目录(), { recursive: true })
})

afterAll(async () => {
  await pg?.stop()
  // win32：刚停下的 PGlite 句柄可能还占着目录（实测 `EBUSY`）。退避重试几次；
  // 仍删不掉就留给系统临时目录清理——临时目录的残留不该把整份用例判红。
  for (let 次 = 0; 次 < 5; 次++) {
    try {
      rmSync(沙箱根, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
})

function 我目录() {
  return join(沙箱根, 我.id, 项目)
}

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: 沙箱根,
}

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() => Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)))
}

const 应用 = realApp(OPEN)
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 身份走 **Cookie**（`UserIdentity.COOKIE_NAME`），不是 Bearer。 */
const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* 应用(url, { ...init, headers })
  })

const 发体 = (subject: TokenSubject | null, url: string, body: unknown) =>
  发(subject, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const 读回 = <T>(响应: Response) => Effect.promise(() => 响应.json() as Promise<T>)

const PREFIX = "/openhive/hgraph"
const 操作 = (body: Record<string, unknown>) => 发体(我, `${PREFIX}/ops`, { projectId: 项目, ...body })

const 时刻 = "2026-11-16T10:00:00+08:00"

function 空图(标题: string) {
  return {
    格式: 1,
    标题,
    创建于: 时刻,
    更新于: 时刻,
    设置: {
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    },
    节点: [] as unknown[],
    边: [] as unknown[],
    文字: [] as unknown[],
  }
}

/** 节点只要 id 存在 + 端点可解析；新增/改过的节点才走必填字段闸，这里不改它。 */
function 节点(id: string, 名称: string) {
  return { id, 名称, 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 10, y: 20 }
}

/** 把一份图写到项目里（这些用例的前提不是「经由 ops 造数据」）。 */
function 摆图(相对: string, 图: unknown) {
  const 绝对 = join(我目录(), 相对)
  mkdirSync(join(绝对, ".."), { recursive: true })
  writeFileSync(绝对, JSON.stringify(图, null, 2) + "\n", "utf8")
  return 绝对
}

describe("T2 · 契约：手画边的字段能被后端来源闸接受", () => {
  test.effect("依据非空 + 可信度 ⇒ `校验来源` 通过（{ok:true}）", () =>
    Effect.sync(() => {
      const 条 = 手画边("n1", "n2", { 依据: "两人同日同酒店入住", 可信度: "中" })

      expect(校验来源(条)).toEqual({ ok: true })
    }),
  )

  test.effect("同一构造器、依据为空 ⇒ 后端拒 `INFERENCE_NEEDS_BASIS`（UI 空依据不能提交是必要闸）", () =>
    Effect.sync(() => {
      const 结果 = 校验来源(手画边("n1", "n2", { 依据: "", 可信度: "中" }))

      expect(结果.ok).toBe(false)
      if (结果.ok) return
      expect(结果.code).toBe("INFERENCE_NEEDS_BASIS")
    }),
  )
})

describe("T2 · 契约：手画边经唯一写入路径落盘", () => {
  it("POST /openhive/hgraph/ops 写入 ⇒ 200；读回文件含 `可信度` 与 `依据`", () =>
    Effect.gen(function* () {
      const 相对 = "契约/手画边.hgraph"
      const 绝对 = 摆图(相对, { ...空图("手画边"), 节点: [节点("n1", "张三"), 节点("n2", "李四")] })
      const 条 = 手画边("n1", "n2", { 依据: "两人同日同酒店入住", 可信度: "中" })

      const 响应 = yield* 操作({ path: 相对, 操作: [{ 操作: "加边", 边: [条] }] })
      expect(响应.status).toBe(200)

      const 内容 = readFileSync(绝对, "utf8")
      expect(内容).toContain('"可信度": "中"')
      expect(内容).toContain('"依据": "两人同日同酒店入住"')
    }),
  )

  it("来源换成人写的 `{kind:\"乱写\"}` ⇒ 400 BAD_SHAPE（T1 取值闸），文件字节不变", () =>
    Effect.gen(function* () {
      const 相对 = "契约/乱写来源.hgraph"
      const 绝对 = 摆图(相对, { ...空图("乱写来源"), 节点: [节点("n1", "张三"), 节点("n2", "李四")] })
      const 前 = readFileSync(绝对, "utf8")

      const 条 = 手画边("n1", "n2", { 依据: "甲", 可信度: "中" })
      // 直接改构造结果（模拟 UI 之外的坏写入方）：契约测试要证明后端闸自己会拒。
      ;(条 as unknown as { 来源: unknown }).来源 = { kind: "乱写" }

      const 响应 = yield* 操作({ path: 相对, 操作: [{ 操作: "加边", 边: [条] }] })
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("BAD_SHAPE")
      expect(readFileSync(绝对, "utf8")).toBe(前)
    }),
  )
})
