import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite, type SQLQueryBindings } from "bun:sqlite"
import { existsSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T024（FR-008 的下半条）：**超期判定的接线 ＋ 「访问时刷新」那一条写入路径**。
 *
 * ## 这一组钉的是「接线」，不是「判定」
 *
 * 判定的两半（`isStale` 的边界与 `touchProjectExt` 只动自己那一行）在
 * `packages/core/test/project-ext.test.ts` 里钉过了。这里钉的是**一句话**：
 * 「库里那一列决定了响应里那个布尔，而 `POST /openhive/project/touch` 是它的写入方」——
 * 它横跨三层（每用户 SQLite 的行 → 列表出口 → HTTP 响应），单元测任何一层都证不了。
 *
 * ## harness 与 `openhive-project.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入），故整套约法照抄、只换判据点：
 * `process.env.OPENHIVE_DATA_ROOT` **只能走 env**（塞 `ConfigProvider` 会被无声忽略）、
 * 身份走 cookie 不走自造头、`json()` 先断 `Content-Type`（**未挂载 ≠ 404**：没挂上的路径落进
 * SPA 兜底回 200 ＋ `text/html`，只看状态码会把「内核是旧版本」读成「弄好了」）。
 *
 * ## 「3 个月」怎么改出来的（夹具，不是 oracle）
 *
 * `stale` 的输入是 `project_ext.last_accessed_at`，而**生产里没有任何出口能让它变成 90 天前**
 * （那是签到明天才发生的事）⇒ 直接用 `bun:sqlite` 改那一列。改的是**输入**，断言读的仍是
 * HTTP 响应（`LEARNINGS #002-02`：oracle 不经过被测对象；同 `openhive-project.test.ts` 的
 * `writeUserDb`，那条注释讲了「问」与「设」为什么取相反的失败口径）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/**
 * 出口路径与头名（**客户端契约**）。
 *
 * ⚠️ 写字面量、**刻意不 import 生产常量**——import 过来就成了「实现和它自己比对」，
 * 改名也测不出来（`LEARNINGS #003-05`）。三处与 `openhive-project.test.ts` 逐字一致。
 */
const PROJECT_PATH = "/openhive/project"
const TOUCH_PATH = "/openhive/project/touch"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-project-stale-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** ⚠️ 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，不是 Config 服务）。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上（T020 起）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/** 真 auth 库（文件级夹具）：`project_member` 的外键指向 `auth.user(id)`。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [ALICE, BOB]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
  }
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
}

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 读 JSON 体。**先断内容类型**——「未挂载 ≠ 404」（文件头那条实测）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 以某人的身份发一个请求。 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/**
 * 列表项的线上形状（`app/src/project/project-panel.tsx` 的 `ProjectEntry` 是它在 UI 侧那份投影）。
 *
 * ⚠️ 本文件**只声明这一组用例读到的字段**（可选键照写 `optional`）；跨包没有共享类型可 import
 * ⇒ 键名对不上是**静默的空列表**，当客户端契约钉死（`LEARNINGS #003-05`）。
 *
 * ⚠️ **`stale` 刻意是必填**（不写 `optional`）：它与 `memberCount` / `archived` / `role`
 * 那三个可选键**不是一类**——那三个描述的是「来源有没有说这件事」，而 `stale` 是**纯粹算得出来的**
 * （输入是 NOT NULL 的一列 ＋ 一次 `Date.now()`）⇒ 「缺键」在这里只能是**出口写漏了**。
 * 写成可选就等于允许它悄悄消失，而它消失的症状是**一个提醒都不出现**（`LEARNINGS #002-02`：
 * 别把「没做到」写成「做到了」）。这条由下面第一条用例钉住。
 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  lastAccessedAt: Schema.Number,
  stale: Schema.Boolean,
})

/** `POST /openhive/project` —— 建一个项目。 */
const createAs = (subject: TokenSubject, body: { name: string; type: string }) =>
  Effect.gen(function* () {
    const response = yield* as(subject, PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(yield* Effect.promise(() => response.json()))
  })

/** `GET /openhive/project` —— 列项目。 */
const listAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* as(subject, PROJECT_PATH)
    expect(response.status).toBe(200)
    return yield* json(Schema.Array(Entry), response)
  })

/** `POST /openhive/project/touch` —— 刷新「最近访问时间」。 */
const touchAs = (subject: TokenSubject, body: unknown) =>
  as(subject, TOUCH_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/**
 * touch 一次，**并证明这条路由真的跑了**：回 200 **且**体是 `application/json`。
 *
 * ⚠️ 只断 `status === 200` 是不够的——**未挂载的路径被 SPA 兜底回 200 ＋ `text/html`**
 * （文件头那句「未挂载 ≠ 404」的另一面：这里未挂载 = **200**，不是 404）。RED 那一跑就吃到了这个：
 * 「touch 别人的项目」在出口还不存在时**照样绿**（它当时只有状态码一条断言）。⇒ 判据前移到
 * `Content-Type`（`LEARNINGS #004-08`：「没报错」不等于「执行了」；同文件那条 401 用例是另一种
 * 免疫——它断的是「不是 200」）。
 */
const touchOk = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    const response = yield* touchAs(subject, { projectId })
    expect(response.status).toBe(200)
    return yield* json(Schema.Struct({ projectId: Schema.String }), response)
  })

/** 某个用户的库文件。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/**
 * 只读地跑一条查询；库文件不在 ⇒ `undefined`（**不 `new Sqlite` 去「顺便建一个」**）。
 *
 * 同族文件里那条 `queryOne` 的拷贝（含 `SQLQueryBindings[]` 与 `?? undefined` 两处类型写法，
 * 以及 `oxlint-disable-next-line` 必须**紧贴函数**那一行——指令与目标之间夹任何一行注释
 * 都等于没禁用）。
 */
// oxlint-disable-next-line typescript-eslint/no-unnecessary-type-parameters
function queryOne<T>(userId: string, sqlText: string, params: SQLQueryBindings[] = []): T | undefined {
  const file = userDb(userId)
  if (!existsSync(file)) return undefined
  const db = new Sqlite(file)
  try {
    return db.query<T, SQLQueryBindings[]>(sqlText).get(...params) ?? undefined
  } finally {
    db.close()
  }
}

/**
 * **写**用户的库文件（夹具）。
 *
 * 用途只有一处：把 `last_accessed_at` 改到「90 天前」/「89 天前」——生产里没有任何出口能做到
 * 这件事（那要等。这就是这个字段当初缺写入方的同一面）。
 *
 * **这是夹具不是 oracle**：改的是**输入**（时间戳那一列），断言读的仍是 HTTP 响应。
 * 库文件不在 ⇒ **抛**（写一个不存在的库是**夹具搭错了**，不该静默变成「没这回事」——
 * 与 `queryOne` 相反的取法，正是因为它俩一个是**问**一个是**设**）。
 */
function writeUserDb(userId: string, sqlText: string, params: SQLQueryBindings[] = []): void {
  const file = userDb(userId)
  if (!existsSync(file)) throw new Error(`夹具要写的用户库不存在：${file}`)
  const db = new Sqlite(file)
  try {
    db.query(sqlText).run(...params)
  } finally {
    db.close()
  }
}

/** `project_ext.last_accessed_at`（**直接读库文件**，不经被测对象）。 */
const accessedAt = (userId: string, projectId: string) =>
  queryOne<{ last_accessed_at: number }>(
    userId,
    "SELECT last_accessed_at FROM project_ext WHERE project_id = ?",
    [projectId],
  )?.last_accessed_at

/** 把某项目的「最近访问时间」拨到 `agoMs` 毫秒之前。 */
const backdate = (userId: string, projectId: string, agoMs: number) =>
  writeUserDb(userId, "UPDATE project_ext SET last_accessed_at = ? WHERE project_id = ?", [
    Date.now() - agoMs,
    projectId,
  ])

const 天 = 24 * 60 * 60 * 1000

/**
 * 每条用例自带一个项目：本文件所有用例共享同一个真库与同一批用户目录，
 * 拿「别人建的」当输入就是**用例间的隐式耦合**（同族文件那条 `CAROL` 的注释记过这件事）。
 */
const 新项目 = (subject: TokenSubject, name: string) => createAs(subject, { name, type: "private" })

describe("T024 · 超期判定的接线（FR-008）", () => {
  /**
   * **`stale` 一定在响应里**——刚建的项目也要有这一个键，且为 `false`。
   *
   * 它同时是下面几条的**对照**：一条「刚建 ⇒ false」证明这个布尔**不是恒真**
   * （`LEARNINGS #004-08`：副作用类判据要先证明机制是活的，这里反过来——先证明这个布尔会动）。
   */
  it.effect("新建的项目在列表里带 `stale: false`（键一定在，不是缺键）", () =>
    Effect.gen(function* () {
      const created = yield* 新项目(ALICE, "刚建的")

      const listed = (yield* listAs(ALICE)).filter((entry) => entry.id === created.id)

      expect(listed.map((entry) => entry.stale)).toEqual([false])
    }),
  )

  /**
   * **接线的主判据**：库里那一列往回拨 90 天 ⇒ 响应里那个布尔翻真。
   *
   * 90 与 89 两条一起才说明「库里的值真的流过去了」而不是「接了个常量」——单看 90 那条，
   * 一个恒真的实现照样绿。
   */
  it.effect("`last_accessed_at` 拨到 90 天前 ⇒ `stale: true`；89 天前 ⇒ 仍是 false", () =>
    Effect.gen(function* () {
      const 超期 = yield* 新项目(ALICE, "超期的")
      const 未超期 = yield* 新项目(ALICE, "未超期的")
      backdate(ALICE.id, 超期.id, 90 * 天)
      backdate(ALICE.id, 未超期.id, 89 * 天)

      const listed = yield* listAs(ALICE)
      const 取 = (id: string) => listed.filter((entry) => entry.id === id).map((entry) => entry.stale)

      // 被测属性（超期那条）在前，对照在后（`#004-14`：红的时候要读到「谁不对」）。
      expect(取(超期.id)).toEqual([true])
      expect(取(未超期.id)).toEqual([false])
    }),
  )

  /**
   * **这个出口存在的理由**：把一个天天在用的项目从「超期」里救回来。
   *
   * 没有它，`last_accessed_at` 只在建项目时写一次 ⇒「3 个月无操作」实际等价于「建项目后 3 个月」，
   * 一个天天在用的项目照样到期（T024 裁定 ③）。这条用例走**完整一圈**：
   * 拨旧 → 列表说超期 → touch → **直接读库**看那一列变了 → 再列表说不再超期。
   *
   * 中间那一步（读库）是**不变量**，不是装饰：只看首尾两条的话，一个「列表出口把 stale 写死成
   * false」的实现也能让它全绿。
   */
  it.effect("touch 一次 ⇒ 库那一列被刷新、列表里不再超期（写入方与判定闭环）", () =>
    Effect.gen(function* () {
      const 项目 = yield* 新项目(ALICE, "被访问的")
      backdate(ALICE.id, 项目.id, 120 * 天)
      const 拨旧 = accessedAt(ALICE.id, 项目.id)
      expect((yield* listAs(ALICE)).filter((entry) => entry.id === 项目.id).map((entry) => entry.stale)).toEqual([true])

      expect(yield* touchOk(ALICE, 项目.id)).toEqual({ projectId: 项目.id })

      // 库那一列：**变了**，而且落在「刚刚」这个窗口里（不是写了个常量、也不是没动）。
      const 刷新后 = accessedAt(ALICE.id, 项目.id)
      expect(刷新后).toBeGreaterThan(拨旧 ?? 0)
      expect(Math.abs((刷新后 ?? 0) - Date.now())).toBeLessThan(60_000)

      expect((yield* listAs(ALICE)).filter((entry) => entry.id === 项目.id).map((entry) => entry.stale)).toEqual([
        false,
      ])
    }),
  )

  /**
   * **授权是结构性的**：touch 只能刷**调用者自己**那一行（`project_ext` 是个人态、一人一份）。
   *
   * ⚠️ 这里**没有** `decide` 可问——`PROJECT_ACTIONS` 里没有「访问」这个动作，也不该有：
   * 「能不能邀请 / 归档」与「能不能刷新我自己的时间」不是一类事（同 `frozen` 那条注释的取向）。
   * 判据因此落在**结果**上：拨 120 天的是 BOB 自己的行；ALICE 挨个 touch BOB 的项目，**BOB 那行不许被刷新**
   * （刷新了就意味着「别人的项目能被我拉动其超期判定」，而 FR-008 的提醒是**按人**算的）。
   */
  it.effect("touch 别人的项目：200 但**对方那一行不动**（授权是结构性的，没有 decide 可问）", () =>
    Effect.gen(function* () {
      const 鲍勃的 = yield* 新项目(BOB, "鲍勃的")
      backdate(BOB.id, 鲍勃的.id, 120 * 天)
      const 拨旧 = accessedAt(BOB.id, 鲍勃的.id)

      // ⚠️ 顺序在这里**不能**按 `#004-14` 的「被测属性在前」硬排：观测必须在**动作之后**，
      // 否则「对方那行没动」在 touch 还没发生时就已经成立（假绿）。⇒ 先发请求（它自带
      // 「路由真的跑了」那条前提前，见 `touchOk`），再读两行。
      expect(yield* touchOk(ALICE, 鲍勃的.id)).toEqual({ projectId: 鲍勃的.id })
      // 被测属性：BOB 那一行**一个毫秒都没动**。
      expect(accessedAt(BOB.id, 鲍勃的.id)).toBe(拨旧 ?? 0)
      // 反面也钉一条：ALICE 那边**不许凭空多出一行**（个人态的行由建项目那一步产生，
      // 而建项目要过外键 —— 这里若多出一行，说明有人把 touch 写成了 upsert）。
      expect(accessedAt(ALICE.id, 鲍勃的.id)).toBeUndefined()
    }),
  )

  /** 没身份的请求一律 401（与其他三个出口同口径）。 */
  it.effect("没身份 ⇒ 401（touch 也不放行）", () =>
    Effect.gen(function* () {
      const response = yield* openApp(TOUCH_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "whatever" }),
      })

      expect(response.status).toBe(401)
    }),
  )

  /** 体不对（没有 `projectId`）⇒ 400，**不是 500**——客户端的事，不是服务端故障。 */
  it.effect("体里没有 `projectId` ⇒ 400（不是 500）", () =>
    Effect.gen(function* () {
      const response = yield* touchAs(ALICE, {})

      expect(response.status).toBe(400)
    }),
  )
})
