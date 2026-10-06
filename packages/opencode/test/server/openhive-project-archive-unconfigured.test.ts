import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T013（FR-008）：**MinIO 没配时归档的处置**——503 ＋ 零副作用 ＋ 应用照常可用。
 *
 * ## 为什么这个用例住在一个单独的文件里
 *
 * 它**不能**和 `openhive-project-archive.test.ts` 住一起，理由不是审美：那条链要**第二份
 * `OPENHIVE_MINIO_*`**（那 13 条钉的是「配好了能用」，这条钉的是「没配会怎样」），而在一个进程里
 * 建第二个 app 会让归档路由在读成员那一步炸成 500。实测边界与排查过程逐条写在
 * `openhive-project-archive.test.ts` 的文件头「一个文件只建一个 app」，**未查到底，已挂缺口表**。
 * 处置走 `#004-12`：同族接缝测试的手段整段搬、按需要分文件。这里它是**唯一**的 app。
 *
 * ## 这条钉的是哪一句设计承诺
 *
 * 「MinIO 配置**整份配好才算配**，配不全不影响应用启动」（`src/server/openhive/archive.ts` 文件头）：
 * D-13（「服务凭据怎么签」）还没裁定，部署方今天很可能一个 `OPENHIVE_MINIO_*` 都没配——若把它写成
 * 必填，**整个应用起不来**，而没配 MinIO 只是「归档用不了」。
 *
 * 本文件有**两条**用例，钉的是同一份「配了一半」配置下**两种调用者**的两种答案：
 * ① 有权限（owner）⇒ **503**（明说归档不可用）；② 没权限（非成员）⇒ **403**
 * ——后者钉的是**次序**：授权判定排在配置检查**之前**，否则「这台机器配没配 MinIO」就成了
 * 谁都能读的部署状态（2026-10-06 三席评审 S1-02 补，原本一条测试都没有）。
 *
 * 所以下面这份 env **刻意配一半**（endpoint ＋ bucket 有，两把密钥没有）：这正是要拦的那种部署——
 * 把它当「配好了」不会在配置处报错，只会在第一次外呼时炸在 SDK 里、报一个与配置无关的错。
 * 「全都没配」走的是**同一个** `Option` 分支（`Config.option(Config.all({…}))`，实测 2026-10-06）：
 * 全缺 → `None`，缺一个 → `None`，全给 → `Some`。而「全给 ⇒ 能用」由另一个文件的 13 条守着。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
/** 有身份、但不是任何项目的成员——「授权先于配置」那条要用他（见文件头）。 */
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/** 出口路径（**客户端契约**，写**字面量**、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const ARCHIVE_PATH = "/openhive/project/archive"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-archive-bare-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（理由见同族测试的同款注释）。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/**
 * **只配一半**——见文件头。两把密钥刻意不写。
 *
 * endpoint 指向一个不存在的域名也无所谓：这两项**根本不会**走到 `Minio.makeStore`（`None` 分支
 * 在 `backupAll` 之前就返回了）。反过来，如果实现把「配一半」当成了「配好了」，这条用例会表现为
 * **外呼失败**（DNS 或连接错）而不是 503——那也是红，且红得说明问题。
 */
const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
  OPENHIVE_MINIO_ENDPOINT: "minio.invalid:9000",
  OPENHIVE_MINIO_BUCKET: "openhive",
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

/** 以某人的身份发一个请求。 */
const asWho = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 以 ALICE（本文件里唯一建项目的人）的身份发一个请求。 */
const as = (url: string, init: RequestInit = {}) => asWho(ALICE, url, init)

/** 读 JSON 体。**先断内容类型**——「未挂载」在本应用里落进 SPA 兜底、回 200 ＋ `text/html`。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 列表项的**线上形状**（逐字写字段名当契约钉死——`#003-05`）。 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  archived: Schema.optional(Schema.Boolean),
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

/** 某人的沙箱里、某个项目的目录。 */
const projectDirOf = (projectId: string) => path.join(WORKSPACE_ROOT, ALICE.id, projectId)

/** 归档行（**直接打 `pg.db`**，不经 `archiveStatesOf`）。 */
const 归档行 = (projectId: string) =>
  Effect.promise(async () => {
    const result = await pg?.db.execute(
      sql`select archived, archived_at from auth.project_archive where project_id = ${projectId}`,
    )
    return rowsOf(result)[0]
  })

describe("T013 · MinIO 没配：有权限 ⇒ 503，没权限 ⇒ 403（次序）", () => {
  it.live(
    "配了一半 = 没配：归档不可用（503 ＋ 说明），沙箱一个没动、库里没有归档行，列表照常",
    () =>
      Effect.gen(function* () {
        // 建项目走的是**另一个**出口，它不碰 MinIO ⇒ 没配 MinIO 不影响它（这本身就是「应用照常」的一半）。
        const created = yield* as(PROJECT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "8·17专案", type: "private" }),
        })
        const project = yield* json(Entry, created)

        const response = yield* as(ARCHIVE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })

        // ① 被测属性：**归档不可用**，而且是「明说」——回的是 JSON 体的 `error`，
        //    不是空体、也不是 SPA 兜底那个 200 ＋ `text/html`（`json()` 里先断的内容类型）。
        //    （401 那条刻意回**空**体，所以「有说明」在这里是判据的一部分，不是装饰。）
        //    ⚠️ 不断**逐字文案**：那是给人看的一句话，不是契约（同族 403 那条也只断状态码）。
        //    断「非空」就够——空的 503 与「解释了为什么」是两回事，而这只差在文案上。
        expect(response.status).toBe(503)
        expect((yield* json(Schema.Struct({ error: Schema.String }), response)).error.length).toBeGreaterThan(0)

        // ② 零副作用（安全属性）。`#004-14` 的次序：被测属性 → 副作用 → 伴随信号。
        //    这里没有可断言的 MinIO 观测面（就是没配），所以两条落在「沙箱没动」与「没落归档行」上——
        //    它们**合起来**覆盖了归档那五步里唯一还可能发生的那一步（标记）。
        expect(existsSync(projectDirOf(project.id))).toBe(true)
        expect(yield* 归档行(project.id)).toBeUndefined()

        // ③ 「应用照常起得来」的另一半：列表出口活着，且这个项目**没**被标成已归档。
        const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
        const mine = listed.find((entry) => entry.id === project.id)
        expect(mine?.archived).toBeUndefined()
      }),
    30_000,
  )

  /**
   * ⚠️ 这条钉的是**次序**，不是「没配会怎样」——它是 2026-10-06 三席评审 S1-02 补的：
   * 那条次序（`archive.ts` 的 ④ 排在 ③ 之后）**当时一条测试都没有**——把 ③ ④ 调个头，
   * 「配好了」那一整个文件**全绿**（那里人人都是 owner、或压根没有这回事）。
   *
   * 观测面怎么造（`#004-13`：「没有现成观测面」≠「没有观测面」）：**两个条件缺一不可**——
   * **未配置**（否则两次序都走 503 前面的那条路）＋ **非成员**（否则授权必过、连 403 都不会出现）。
   * 这也正是这条用例**只能住在这个文件里**的第二个理由：它要的 `OPEN` 是**配了一半**那份。
   */
  it.live(
    "非成员（有身份、不在成员表里）⇒ 403，**不是** 503：授权判定排在配置检查之前",
    () =>
      Effect.gen(function* () {
        const created = yield* as(PROJECT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "8·17专案（乙来归档）", type: "private" }),
        })
        const project = yield* json(Entry, created)

        const response = yield* asWho(BOB, ARCHIVE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })

        // 被测属性：MinIO 明明没配（同一份 `OPEN`），非成员拿到的是 403 而**不是** 503
        // ⇒ 「这台机器配没配 MinIO」这个部署状态不外泄给没权限问的人。调换 ③ ④ 会让它变 503。
        expect(response.status).toBe(403)
        // 拒绝要**说得清**（回 JSON ＋ 非空 error），不是空体、也不是 SPA 兜底那个 200 ＋ `text/html`。
        expect((yield* json(Schema.Struct({ error: Schema.String }), response)).error.length).toBeGreaterThan(0)
        // 零副作用：沙箱没动、库里没有归档行——调换次序**不改变**这两条，它们与上面那条是
        // 同一件事的两个层面（`#004-14` 的次序：被测属性 → 伴随信号 → 对照）。
        expect(existsSync(projectDirOf(project.id))).toBe(true)
        expect(yield* 归档行(project.id)).toBeUndefined()
      }),
    30_000,
  )
})
