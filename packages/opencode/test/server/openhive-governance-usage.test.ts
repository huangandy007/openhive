import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { Analytics } from "@/governance/analytics"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 010 T009 · **用量/成本看板**的 HTTP 出口（FR-008 / US5）。
 *
 * 判据分三层：
 *
 * 1. **门**：未登录 401 / 业务专家 403 / 普通民警 403 / 系统管理员 200。
 *    `usage-cost` 在 `auth/src/governance.ts` 只授**系统管理员**——业务专家对它连 `read` 都没有，
 *    这是 FR-003 分权矩阵的一格（T014 会成体系地再测一遍）。
 * 2. **抽取先于报表**：`analytics.ts` 的 docstring 把「何时抽取」交给读接口。判据不看实现，
 *    看**事实表在请求前是空的、请求后有了行**——只看报表返回非空会漏掉「别人替我抽过」。
 * 3. **口径**：窗口左闭右开 `[from, to)`；token = 输入 + 输出；成本 6 位小数；三种分组
 *    （org / model / user），`user` 分组带姓名（已注销账号回落 `已注销用户（前 8 位）`）。
 *
 * ⚠️ 夹具**走生产出口造数据**（`#006-35`）：源库是每用户 SQLite 的最小 `event` 表，事实行由
 * `Analytics.extractAll`（被读接口自己调用）落库。**不裸 `INSERT INTO usage_fact`**（`#006-28`）。
 * 唯一直接写库的是 `auth.user` 行——那本来就是别的出口（T005 录入）的产物。
 *
 * ⚠️ **本文件只建一个 app**（`openhive-project-archive.test.ts` 文件头记过：第二个 app 的第一条
 * PG 查询会撞 `Connection closed`）。每个用例用**各自的分析库**（`OPENHIVE_ANALYTICS_DB` 在请求期
 * 读，`#004-11`：env 按文件隔离、本文件内改了就对本文件生效），因此用例之间不靠执行顺序。
 */

const it = testEffect(Layer.empty)

const SECRET = "a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4"

const ADMIN: TokenSubject = {
  id: "11111111-1111-4111-8111-111111111111",
  policeNo: "930001",
  name: "系统管理员乙",
  isAdmin: true,
}
const EXPERT: TokenSubject = {
  id: "22222222-2222-4222-8222-222222222222",
  policeNo: "930002",
  name: "业务专家甲",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "33333333-3333-4333-8333-333333333333",
  policeNo: "930003",
  name: "民警丙",
  isAdmin: false,
}

/** 有使用记录的三个人（不是凭证持有者，只是数据的归属）。 */
const 甲民警 = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa"
const 乙民警 = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb"
const 丙民警 = "cccccccc-0000-4000-8000-cccccccccccc"

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const USAGE = "/openhive/governance/usage-cost"

const FROM = 1_700_000_000_000
const TO = 1_700_000_100_000

const STARTED = "session.next.step.started.1"
const ENDED = "session.next.step.ended.2"

const SOURCE_DDL = `
CREATE TABLE event (
  id text PRIMARY KEY,
  aggregate_id text NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  data text NOT NULL
);
`

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-gov-usage-"))
const DATA_ROOT = join(SANDBOX, "data")
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
const previousAnalytics = process.env.OPENHIVE_ANALYTICS_DB
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restoreRequireUser = restorePoint({ OPENHIVE_REQUIRE_USER_ID: "1" })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restoreRequireUser)
afterAll(restorePoolMax)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  if (previousAnalytics === undefined) delete process.env.OPENHIVE_ANALYTICS_DB
  else process.env.OPENHIVE_ANALYTICS_DB = previousAnalytics
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  const 人: Array<{ id: string; policeNo: string; name: string; org: string; isAdmin: boolean }> = [
    { id: ADMIN.id, policeNo: ADMIN.policeNo, name: ADMIN.name, org: "市局本级", isAdmin: true },
    { id: EXPERT.id, policeNo: EXPERT.policeNo, name: EXPERT.name, org: "市局本级", isAdmin: true },
    { id: OFFICER.id, policeNo: OFFICER.policeNo, name: OFFICER.name, org: "南浔分局", isAdmin: false },
    { id: 甲民警, policeNo: "930011", name: "甲民警", org: "湖州市局", isAdmin: false },
    { id: 乙民警, policeNo: "930012", name: "乙民警", org: "南浔分局", isAdmin: false },
    { id: 丙民警, policeNo: "930013", name: "丙民警", org: "德清县局", isAdmin: false },
  ]
  for (const person of 人) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${person.id}, ${person.policeNo}, ${person.name}, 'x', 'x', ${person.org}, '基座部门', '基座科室',
              ${1}, ${person.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  // 两个模板角色由迁移种下（系统管理员含 `usage-cost: read`；业务专家**没有**这一格）。
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)

  种事件库()
})

afterAll(async () => {
  await pg?.stop()
})

/** 每用户一个最小 `event` 表（与 `analytics.test.ts` 同形：抽取器只读 `id` / `type` / `data`）。 */
function 种事件库() {
  for (const userId of [甲民警, 乙民警, 丙民警]) 建源库(userId)

  // 窗口内两条（一条恰好落在 `from`，一条落在 `to - 1`）。
  步(甲民警, "evt_0001", "s1", FROM, { model: "claude-sonnet", cost: 0.25, input: 100, output: 50 })
  步(甲民警, "evt_0002", "s2", TO - 1, { model: "claude-sonnet", cost: 0.5, input: 200, output: 80 })
  // 恰好落在 `to`：左闭右开，**不算**。
  步(甲民警, "evt_0003", "s3", TO, { model: "claude-sonnet", cost: 9.99, input: 1000, output: 1000 })

  步(乙民警, "evt_0001", "s1", FROM + 1_000, { model: "gpt-5", cost: 0.1, input: 50, output: 25 })

  步(丙民警, "evt_0001", "s1", FROM + 2_000, { model: "gpt-5", cost: 0.04, input: 10, output: 5 })
}

function 建源库(userId: string) {
  const path = join(DATA_ROOT, userId, "opencode.db")
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true })
  try {
    db.exec(SOURCE_DDL)
  } finally {
    db.close()
  }
}

/** 一对 started/ended（ended 才是事实行；模型在 started 上，抽取器按 messageID 关联）。 */
function 步(
  userId: string,
  baseId: string,
  messageID: string,
  timestamp: number,
  options: { model: string; cost: number; input: number; output: number },
) {
  const db = new Database(join(DATA_ROOT, userId, "opencode.db"))
  try {
    const write = (suffix: string, type: string, data: unknown) =>
      db
        .query("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, 'ses_1', 0, ?, ?)")
        .run(`${baseId}${suffix}`, type, JSON.stringify(data))

    write("a", STARTED, {
      timestamp,
      sessionID: "ses_1",
      assistantMessageID: messageID,
      agent: "build",
      model: { id: options.model, providerID: "prov" },
    })
    write("b", ENDED, {
      timestamp,
      sessionID: "ses_1",
      assistantMessageID: messageID,
      finish: "stop",
      cost: options.cost,
      tokens: { input: options.input, output: options.output, reasoning: 0, cache: { read: 0, write: 0 } },
    })
  } finally {
    db.close()
  }
}

/**
 * 每个用例一个**新的**分析库：`OPENHIVE_ANALYTICS_DB` 由读接口在请求期读（`#004-11`），
 * 所以「抽取发生在哪一次请求」可以被逐用例钉住，不靠用例执行顺序。
 */
let 序号 = 0
function 新分析库(): string {
  const path = join(SANDBOX, `analytics-${++序号}.db`)
  process.env.OPENHIVE_ANALYTICS_DB = path
  return path
}

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_DATA_ROOT: DATA_ROOT,
}

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
}

const openApp = realApp(OPEN)

const 取 = (subject: TokenSubject | null, url: string) =>
  Effect.gen(function* () {
    const headers = new Headers()
    if (subject) {
      const token = yield* Effect.promise(() => signToken(subject, SECRET))
      headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${token}`)
    }
    return yield* openApp(url, { headers })
  })

const 查询 = (subject: TokenSubject | null, query: string) => 取(subject, `${USAGE}?${query}`)

const ReportResponse = Schema.Struct({
  collected: Schema.Boolean,
  watermark: Schema.NullOr(Schema.Number),
  from: Schema.Number,
  to: Schema.Number,
  groupBy: Schema.String,
  metrics: Schema.Struct({
    calls: Schema.Number,
    totalTokens: Schema.Number,
    estimatedCost: Schema.Number,
    activeOrgs: Schema.Number,
  }),
  rows: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      label: Schema.String,
      calls: Schema.Number,
      inputTokens: Schema.Number,
      outputTokens: Schema.Number,
      cost: Schema.Number,
    }),
  ),
})
const ErrorResponse = Schema.Struct({ error: Schema.String })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

const 窗口 = `from=${FROM}&to=${TO}`

describe("T009 · 门", () => {
  it.live("无凭证 ⇒ 401（空体）；业务专家 ⇒ 403（usage-cost 只授系统管理员）；普通民警 ⇒ 403", () =>
    Effect.gen(function* () {
      新分析库()
      const 匿名 = yield* 取(null, USAGE)
      expect(匿名.status).toBe(401)
      expect((yield* Effect.promise(() => 匿名.text()))).toBe("")

      const 专家 = yield* 取(EXPERT, USAGE)
      expect(专家.status).toBe(403)
      expect((yield* json(ErrorResponse, 专家)).error).toContain("没有")

      expect((yield* 取(OFFICER, USAGE)).status).toBe(403)
    }),
  )

  it.live("不可解析的参数也先撞门 ⇒ 业务专家 403 而不是 400（授权排在解析之前）", () =>
    Effect.gen(function* () {
      新分析库()
      expect((yield* 查询(EXPERT, "from=abc&to=xyz&groupBy=nonsense")).status).toBe(403)
    }),
  )

  it.live("管理员能读 ⇒ 200，响应带窗口与分组回显", () =>
    Effect.gen(function* () {
      新分析库()
      const response = yield* 查询(ADMIN, `${窗口}&groupBy=org`)
      expect(response.status).toBe(200)
      const body = yield* json(ReportResponse, response)
      expect(body.from).toBe(FROM)
      expect(body.to).toBe(TO)
      expect(body.groupBy).toBe("org")
    }),
  )
})

describe("T009 · 抽取先于报表", () => {
  it.live("请求前分析库还没有事实行；请求后有了——抽取由读接口自己触发", () =>
    Effect.gen(function* () {
      const path = 新分析库()
      expect(existsSync(path)).toBe(false)

      const body = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=org`))
      expect(body.collected).toBe(true)
      expect(body.watermark === null ? 0 : body.watermark).toBeGreaterThan(0)
      expect(body.metrics.calls).toBe(4)

      const store = Analytics.open(path)
      try {
        // 抽取落**全部**事件（含恰好落在 `to` 的那条），窗口只在报表层生效 ⇒ 5 行、窗口内 4 次。
        expect(store.db.query("SELECT count(*) AS count FROM usage_fact").get()).toEqual({ count: 5 })
      } finally {
        store.close()
      }
    }),
  )

  it.live("再请求一次不翻倍（幂等：抽取按游标只走新增）", () =>
    Effect.gen(function* () {
      新分析库()
      const 一 = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=org`))
      const 二 = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=org`))
      expect(二.metrics).toEqual(一.metrics)
      expect(二.rows).toEqual(一.rows)
    }),
  )
})

describe("T009 · 口径", () => {
  it.live("窗口左闭右开：恰好落在 to 的那条不算；from 那条算", () =>
    Effect.gen(function* () {
      新分析库()
      const body = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=org`))
      // 甲民警两条（from / to-1）＋ 乙民警一条 ＋ 丙民警一条；to 那条（1000+1000 token、9.99）不在内。
      expect(body.metrics).toEqual({ calls: 4, totalTokens: 520, estimatedCost: 0.89, activeOrgs: 3 })
    }),
  )

  it.live("按单位分组：键是快照进事实行的 org，按调用次数降序", () =>
    Effect.gen(function* () {
      新分析库()
      const body = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=org`))
      expect(body.rows[0]).toMatchObject({ key: "湖州市局", calls: 2, inputTokens: 300, outputTokens: 130, cost: 0.75 })
      const 南浔 = body.rows.find((row) => row.key === "南浔分局")
      expect(南浔).toMatchObject({ calls: 1, inputTokens: 50, outputTokens: 25, cost: 0.1 })
      // 没有用户库的账号不产生行、也不算进 activeOrgs（市局本级的两个管理员没有使用记录）。
      expect(body.rows.some((row) => row.key === "市局本级")).toBe(false)
    }),
  )

  it.live("按模型分组：模型来自 started 事件（ended 上没有）", () =>
    Effect.gen(function* () {
      新分析库()
      const body = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=model`))
      expect(body.rows[0]).toMatchObject({ key: "claude-sonnet", calls: 2, cost: 0.75 })
      expect(body.rows.find((row) => row.key === "gpt-5")).toMatchObject({ calls: 2, cost: 0.14 })
    }),
  )

  it.live("按人分组：键是 userId，label 是姓名（警号）；库里已没有这个人时回落", () =>
    Effect.gen(function* () {
      新分析库()
      const 前 = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=user`))
      expect(前.rows.find((row) => row.key === 甲民警)).toMatchObject({ label: "甲民警（930011）", calls: 2 })
      expect(前.rows.find((row) => row.key === 丙民警)).toMatchObject({ label: "丙民警（930013）", calls: 1 })

      // 账号被清理（`auth.user` 行没了）之后，历史消耗仍是事实——名字翻不出来时回落成 id 前缀。
      if (!pg) throw new Error("真库没起来")
      yield* Effect.promise(() => pg!.db.execute(sql`delete from auth.user where id = ${丙民警}`))

      const 后 = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=user`))
      expect(后.rows.find((row) => row.key === 丙民警)).toMatchObject({
        label: `已注销用户（${丙民警.slice(0, 8)}）`,
        calls: 1,
      })
    }),
  )

  it.live("没有用户库 ⇒ collected:false、指标全 0、无行（看板据此显示「—」而不是 0）", () =>
    Effect.gen(function* () {
      新分析库()
      const 空根 = join(SANDBOX, "empty-data")
      const 原根 = process.env.OPENHIVE_DATA_ROOT
      process.env.OPENHIVE_DATA_ROOT = 空根
      try {
        const body = yield* json(ReportResponse, yield* 查询(ADMIN, `${窗口}&groupBy=org`))
        expect(body).toMatchObject({
          collected: false,
          watermark: null,
          metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 },
          rows: [],
        })
      } finally {
        if (原根 === undefined) delete process.env.OPENHIVE_DATA_ROOT
        else process.env.OPENHIVE_DATA_ROOT = 原根
      }
    }),
  )

  it.live("缺省窗口是近 30 天（不传 from / to 也能读）", () =>
    Effect.gen(function* () {
      新分析库()
      const body = yield* json(ReportResponse, yield* 查询(ADMIN, "groupBy=org"))
      expect(body.to - body.from).toBe(30 * 24 * 60 * 60 * 1000)
      expect(body.groupBy).toBe("org")
    }),
  )
})

describe("T009 · 参数", () => {
  it.live("非毫秒 / from ≥ to / 未知分组 ⇒ 400；缺省 groupBy = org", () =>
    Effect.gen(function* () {
      新分析库()
      expect((yield* 查询(ADMIN, "from=abc&to=xyz")).status).toBe(400)
      expect((yield* 查询(ADMIN, "from=200&to=100")).status).toBe(400)
      expect((yield* 查询(ADMIN, `${窗口}&groupBy=dept`)).status).toBe(400)
      expect((yield* 查询(ADMIN, `${窗口}&groupBy=user`)).status).toBe(200)
    }),
  )
})
