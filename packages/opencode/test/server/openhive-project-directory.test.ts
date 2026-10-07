import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ConfigProvider, Effect, Exit, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T017（FR-001 · D0-1 的落地口径）：**客户端报「当前项目」，服务端把它拼进会话目录**。
 *
 * ## 本任务要钉的一句话
 *
 * 会话目录 = `join(沙箱根, 项目目录)`，而**沙箱根那一半不受影响**：
 * `anchor-workspace.ts` 一字不动，客户端报的目录（含 `../../` 逃逸写法）**仍然一律无效**
 * （T017 的 ⚠️ 明写的回归断言）。所以本文件是**两条**判据：
 * ① 报了项目 ⇒ 在沙箱根**里面**再进一层；② 没报 / 报了别人的 / 报了不存在的 ⇒ 落沙箱根。
 *
 * ## 三笔裁定（2026-10-06，用户裁定，见 `state.md` 的 T017 节）
 *
 * | 问题 | 裁定 |
 * |---|---|
 * | 客户端用什么通道报 `projectId` | **请求头 `x-openhive-project`**（`payload.location` 没有这个字段，两条链也只有它够得着） |
 * | 这段代码落在哪 | **新的 fork 中间件**，挂在 `anchorWorkspaceLayer` **之后** |
 * | `join(沙箱根, 目录)` 里的「目录」取什么 | **就是 `projectId` 本身**（查 `project_ext` 的作用是「项目在不在」，不是「查它的目录」） |
 *
 * ## 为什么「挂在锚定之后」是这份测试的支点
 *
 * 锚定先把**所有**目录入参改写成沙箱根；本项目层再在**沙箱根里面**加一段。于是
 * 「客户端给的目录一律无效」这条不变量由锚定原样守着，本项目层加不出新的逃逸口——
 * **它的失败模式只能是「项目目录不生效、退回沙箱根」**，不会是「逃出沙箱」。
 * 这一条决定了下面几条用例怎么写：主判据在**项目**那一层，回归判据在**沙箱根**那一层。
 *
 * ## oracle 不经过被测对象
 *
 * 「会话落在哪个目录」一律**直接读库文件**（`bun:sqlite` 读 `session.directory`），不读响应体
 * （`LEARNINGS #002-02`：拿被测对象证明被测对象，等于没证）。种 `project_ext` 也走裸 SQL，
 * 不调我们自己的写入接口——那接口（新建项目）是 T006 的事，今天还不存在。
 *
 * ## 两条链各来一条（`LEARNINGS #004-01`：数**出口**，不是数「已经有守卫的地方」）
 *
 * 建会话有**两条**链，目录从**两个不同的地方**读：
 * - A 链 `POST /session` ⇒ 目录在 **URL**（`?directory=`，锚定改的那三处之一）；
 * - B 链 `POST /api/session` ⇒ 目录在**请求体**（`payload.location.directory`，锚定当初漏过的那条缝）。
 *
 * 只接一条 = 另一条静默退回沙箱根。所以下面 A 链、B 链**各有一条主判据**。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/**
 * 客户端报「当前项目」的通道（裁定①）。
 *
 * ⚠️ **这个字面量在本文件里是「客户端契约」，不是「生产常量的副本」**：生产那份导出在
 * `middleware/project-location.ts` 里，本文件**刻意不 import** 它——import 过来就变成
 * 「生产改什么测试跟着改什么」，改名也测不出来（`LEARNINGS #003-05` 的假镜像）。
 * 写死在这儿，改名必红。
 */
const PROJECT_HEADER = "x-openhive-project"

/** 已有 `project_ext` 行的项目 id。**合法路径段**——它会被 `join` 进沙箱路径。 */
const ALPHA = "prj_alpha_0001"
/** 格式合法、但库里**没有**这一行（R5：落沙箱根，不做隐式建项目）。 */
const GHOST = "prj_ghost_0002"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-project-dir-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/** 某人的沙箱根。**测试不创建它**——本 task 不建目录（见文件末「本 task 不覆盖什么」）。 */
const sandboxOf = (subject: TokenSubject) => path.join(WORKSPACE_ROOT, subject.id)

/** 客户端谎报的目录：**一个 `../../` 的相对逃逸写法**（T017 的 ⚠️ 点名的那种填法）。 */
const FORGED = "../../escaped-outside-sandbox"

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（原因见 `tenant-db-isolation.test.ts` 上那条
 * 长注释：`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，不是 Effect 的 `Config` 服务）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** T020 之后，建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上。 */
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
 * 真 auth 库（文件级夹具，理由同 `tenant-db-isolation.test.ts`）：门开着时 `POST /session`
 * 要查 `auth.role_resource`，查不到就不建会话（fail-closed）。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
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

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 读 JSON 体。**过一遍 `Schema` 而不是 `as`**（`Response.json()` 是 `any`，`as` 会被 oxlint 拦）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.map(Effect.promise(() => response.json()), (body: unknown) => Schema.decodeUnknownSync(schema)(body))

/** 以某人的身份发一个请求；额外头（本项目那个通道）从 `init.headers` 进。 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** A 链 `POST /session` 的响应体（上游 `Session.Info` 的一个子集）。 */
const SessionInfo = Schema.Struct({ id: Schema.String })

/** B 链 `POST /api/session` 的响应体。 */
const V2SessionInfo = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })

/**
 * 建会话 · **A 链**（`POST /session`，目录在 **URL**）。
 *
 * 这是「同一个头的第二个出口」——锚定当初把入参清点成「URL 与头」时漏掉请求体那次
 * （审查 R-01），本项目层不能重犯：两条链的落点读法**不同**，所以两条都钉。
 */
const createV1As = (subject: TokenSubject, init: { project?: string; directory?: string } = {}) =>
  Effect.gen(function* () {
    const query = init.directory === undefined ? "" : `?directory=${encodeURIComponent(init.directory)}`
    const response = yield* as(subject, `/session${query}`, {
      method: "POST",
      headers: init.project === undefined ? {} : { [PROJECT_HEADER]: init.project },
    })
    expect(response.status).toBe(200)
    return (yield* json(SessionInfo, response)).id
  })

/**
 * 建会话 · **B 链**（`POST /api/session`，目录在**请求体**）。
 *
 * `headers` 是**整份替换**（不是追加）——只为让「不发 `Content-Type`」那种写法测得出来，
 * 见下面「镜像的第二个分歧点」那条用例。
 */
const createV2As = (
  subject: TokenSubject,
  init: { project?: string; directory?: string; headers?: Record<string, string> } = {},
) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/api/session", {
      method: "POST",
      headers: {
        ...(init.headers ?? { "Content-Type": "application/json" }),
        ...(init.project === undefined ? {} : { [PROJECT_HEADER]: init.project }),
      },
      body: JSON.stringify({ location: init.directory === undefined ? {} : { directory: init.directory } }),
    })
    expect(response.status).toBe(200)
    return (yield* json(V2SessionInfo, response)).data.id
  })

/** 某个用户的库文件。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/**
 * 某条会话落在哪个目录（**直接读库文件**）。
 *
 * 库还没被建出来时给 `undefined`——**不 `new Sqlite(...)` 去「顺便建一个」**：
 * 那会造出一个空的库文件，让「库本来该不该存在」这类断言从此失真。
 */
function sessionDirectory(userId: string, sessionId: string): string | undefined {
  const file = userDb(userId)
  if (!existsSync(file)) return undefined
  const db = new Sqlite(file)
  try {
    return db.query<{ directory: string }, [string]>("SELECT directory FROM session WHERE id = ?").get(sessionId)
      ?.directory
  } finally {
    db.close()
  }
}

/** 某人的库里有几条会话（「一条都没多出来」这种断言要它）。库不在 ⇒ 0。 */
function sessionCount(userId: string): number {
  const file = userDb(userId)
  if (!existsSync(file)) return 0
  const db = new Sqlite(file)
  try {
    return db.query<{ n: number }, []>("SELECT count(*) AS n FROM session").get()?.n ?? 0
  } finally {
    db.close()
  }
}

/** 某个用户的 `project_ext` 行数（「不隐式建项目」的观测面）。库不在 ⇒ 0。 */
function projectExtCount(userId: string): number {
  const file = userDb(userId)
  if (!existsSync(file)) return 0
  const db = new Sqlite(file)
  try {
    return db.query<{ n: number }, []>("SELECT count(*) AS n FROM project_ext").get()?.n ?? 0
  } finally {
    db.close()
  }
}

/**
 * 造一个「项目已存在」的用户：**先用一次普通建会话把该用户的库建出来**（`project_ext` 是建库钩子
 * 建的，T003），再用**裸 SQL** 补 `project` ＋ `project_ext` 两行。
 *
 * 为什么走裸 SQL 而不是 `DatabaseRouter.layer({root})`：本文件要的是**库文件自己长什么样**，
 * 走另一个 layer 会在测试进程里再开一份连接，却证明不了「应用那份连接看到的就是这些行」。
 * 裸 SQL 写进去、应用读出来，才是跨连接的真读法。
 *
 * ⚠️ `project` 行不能省：`project_ext.project_id` 有外键（`ON DELETE CASCADE`）。
 * ⚠️ `time_created` / `time_updated` / `last_accessed_at` 必须显式给：drizzle 的 `.$default()`
 * 是**运行时**默认值，裸 SQL 绕不过去（实测，见 `packages/core/test/project-ext.test.ts` 的同款注释）。
 * ⚠️ `OR IGNORE`：本文件的多条用例**共用同一个 DATA_ROOT**（库文件是跨用例累积的），
 * 同一个项目被种第二次是正常的——不 `OR IGNORE` 会撞 `UNIQUE constraint failed: project.id`，
 * 而那是个**夹具**问题，不是被测对象的问题。
 */
const withProject = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    yield* createV1As(subject)
    const db = new Sqlite(userDb(subject.id))
    try {
      db.run(
        "INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, '[]', 1700000000000, 1700000000000)",
        [projectId, `/tmp/${projectId}`],
      )
      db.run(
        "INSERT OR IGNORE INTO project_ext (project_id, type, project_type, shared_directory, last_accessed_at) VALUES (?, 'private', '单案', NULL, 1700000000000)",
        [projectId],
      )
    } finally {
      db.close()
    }
  })

/**
 * 归一化：断言钉的是**归属**，不是路径的书写形式（同 `tenant-directory-isolation.test.ts`）。
 * 目录不存在时 `realpath` 抛错 ⇒ 退回原样——本文件的沙箱目录**从不被创建**，两侧因此走同一条路。
 */
const canonical = (value: string) => {
  const real = (() => {
    try {
      return realpathSync.native(value)
    } catch {
      return value
    }
  })()
  return real.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
}

describe("T017 · 建会话落进项目目录（FR-001）", () => {
  /**
   * **主判据（B 链）**：报了项目 ⇒ 落 `{沙箱根}/{projectId}`。
   *
   * 另一半在同一个断言里：**落点在沙箱根里面**（`startsWith`）——少了它，一条「把项目 id 当绝对
   * 路径用」的实现（落 `/{projectId}`）也能满足「结尾是 projectId」这种弱断言。
   */
  it.live(
    "B 链：带 x-openhive-project 建会话 ⇒ 落 {沙箱根}/{projectId}（且在沙箱根里面）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)

        const id = yield* createV2As(ALICE, { project: ALPHA })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        const root = canonical(sandboxOf(ALICE))
        expect(landed).toBe(canonical(path.join(sandboxOf(ALICE), ALPHA)))
        expect(landed.startsWith(`${root}/`)).toBe(true)
      }),
    30_000,
  )

  /**
   * **主判据（A 链）**：同一个头，另一个出口。
   *
   * A 链的目录从 **URL** 读（`?directory=`），B 链从**请求体**读——两条链读的地方不同，
   * 只接一条就是「另一条静默退回沙箱根」（`LEARNINGS #004-01`）。
   */
  it.live(
    "A 链：带 x-openhive-project 建会话 ⇒ 同样落 {沙箱根}/{projectId}",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)

        const id = yield* createV1As(ALICE, { project: ALPHA })

        expect(canonical(sessionDirectory(ALICE.id, id) ?? "")).toBe(canonical(path.join(sandboxOf(ALICE), ALPHA)))
      }),
    30_000,
  )

  /**
   * **不变量回归 · 带头时伪造目录仍然无效**（T017 的 ⚠️ 点名的第一条）。
   *
   * 报项目 ＋ 报伪造目录**同时发生**时，落点必须是「沙箱根 ＋ 项目」，**不是**伪造值，也不是
   * 「两者的拼接」——`join(沙箱根,  "../../escaped")` 会逃出沙箱，而它看起来只是「把客户端报的
   * 目录接在项目后面」。
   */
  it.live(
    "带项目头 + 同时伪造 `../../` 目录：落项目目录，伪造值一律无效",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)

        const id = yield* createV2As(ALICE, { project: ALPHA, directory: FORGED })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        expect(landed).toBe(canonical(path.join(sandboxOf(ALICE), ALPHA)))
        expect(landed).not.toContain("escaped-outside-sandbox")
      }),
    30_000,
  )

  /**
   * **镜像的第二个分歧点**（`LEARNINGS #003-05`：镜像的两侧只要有一条不覆盖的写法，它就是假的）。
   *
   * 本层的 `isJsonRequest` 是**第二份**（第一份在 `anchor-workspace.ts`，两份共同镜像
   * `HttpApiBuilder` 的 `getRequestContentType`）。而「下游会不会当 JSON 解」有两个**已知**的分歧点，
   * 锚定那边各钉了一条用例（`anchor-workspace.test.ts` 的 R-01 组）：
   * **不发 `Content-Type`**、**大写带参数**。
   *
   * 本层若漂回 `includes("application/json")` 那种写法，这两种请求的体改写会**静默跳过**——
   * 后果是「退回沙箱根」（不是逃逸）⇒ **没有任何别的用例会红**。所以只能在这里钉。
   */
  it.live(
    "不发 Content-Type / 大写带参数：体改写照样生效（两个分歧点各一条）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)

        // 两个写法各跑一遍。**类型标注不能省**：不标注时数组字面量推出「`Content-Type` 可能是
        // `undefined`」的联合类型，与 `Record<string, string>` 不兼容（typecheck 实测）。
        const spellings: Record<string, string>[] = [
          {}, // ① 干脆不发 `Content-Type`（下游当 JSON 解，锚定/本层也**必须**当 JSON 改）
          { "Content-Type": "APPLICATION/JSON; charset=utf-8" }, // ② 大写 + 带参数
        ]
        for (const headers of spellings) {
          const id = yield* createV2As(ALICE, { project: ALPHA, headers })
          expect({ headers, landed: canonical(sessionDirectory(ALICE.id, id) ?? "") }).toEqual({
            headers,
            landed: canonical(path.join(sandboxOf(ALICE), ALPHA)),
          })
        }
      }),
    30_000,
  )

  /**
   * **不变量回归 · 不带头时客户端给的目录仍然无效**（T017 的 ⚠️ 点名的第二条，也是 R5 的判据）。
   *
   * 这条守的是「本项目层没有把锚定那条不变量**放宽**」：没有项目头 ⇒ 本项目层**一次都不该碰**请求，
   * 落点必须还是锚定给的沙箱根。它的红法有两种，都要能红：① 本项目层无事生非地改写了目录；
   * ② 锚定那条被绕过（客户端报的目录生效了）。
   */
  it.live(
    "不带项目头 + 伪造 `../../` 目录：仍落沙箱根（锚定那条不变量原样守着）",
    () =>
      Effect.gen(function* () {
        yield* createV1As(ALICE) // 先让库长出来，好让下面的读法有东西可读

        const id = yield* createV1As(ALICE, { directory: FORGED })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        expect(landed).toBe(canonical(sandboxOf(ALICE)))
        expect(landed).not.toContain("escaped-outside-sandbox")
      }),
    30_000,
  )

  /**
   * **R5：查不到就落沙箱根，不做隐式建项目**（T017 的第二条 ⚠️）。
   *
   * 两件事一起钉，缺一不可：
   * ① 落点 = 沙箱根（不是报错、也不是落 `{沙箱根}/{ghost}` 造一个没人认领的项目目录）；
   * ② **库里的行数不变**——「不隐式建项目」这句话的**唯一**观测面就是这里。
   * 少了 ②，一个「顺手 upsert 一行 project_ext」的实现照样绿，而那行会让 T006 的「新建项目」与
   * 它抢同一个 id 空间（`plan.md` R1 说两行必须同步创建，这条正是它的反面）。
   */
  it.live(
    "projectId 合法但库里没有：落沙箱根，且一行 project_ext 都不多出来",
    () =>
      Effect.gen(function* () {
        yield* createV1As(ALICE)
        const before = projectExtCount(ALICE.id)

        const id = yield* createV2As(ALICE, { project: GHOST })

        expect(canonical(sessionDirectory(ALICE.id, id) ?? "")).toBe(canonical(sandboxOf(ALICE)))
        expect(projectExtCount(ALICE.id)).toBe(before)
      }),
    30_000,
  )

  /**
   * **跨用户：项目身份走各自那份库**。
   *
   * BOB 报 ALICE 的项目 id：ALICE 的 `project_ext` 行在 **ALICE 的库**里（每用户库物理隔离），
   * 所以 BOB 那条路径**查不到** ⇒ 落 BOB 自己的沙箱根。
   *
   * 这条的断言刻意写成**两半**：既钉「落 BOB 的沙箱根」，又钉「**没有**落到 ALICE 的项目目录」。
   * 只写前半句的话，「把所有人锚进同一个空目录」也能绿（同 `tenant-db-isolation` 的「过紧也是缺陷」）。
   */
  it.live(
    "BOB 报 ALICE 的项目 id：查不到（各人各自的库）⇒ 落 BOB 自己的沙箱根",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)
        yield* createV1As(BOB) // 建出 BOB 的库——**BOB 需要自己的库存在**，这条才有观测面

        const id = yield* createV2As(BOB, { project: ALPHA })

        const landed = canonical(sessionDirectory(BOB.id, id) ?? "")
        expect(landed).toBe(canonical(sandboxOf(BOB)))
        expect(landed).not.toBe(canonical(path.join(sandboxOf(ALICE), ALPHA)))
      }),
    30_000,
  )

  /**
   * **非法 projectId ⇒ 拒**（与锚定对非法 userId 的处置**同一个判据、同一类逃逸**）。
   *
   * `projectId` 会被 `join` 进沙箱路径，所以它和 `userId` 是同一类东西：空串 / `.` / `..` /
   * 带分隔符的串都会让沙箱**塌掉或逃出去**（`User.isSafePathSegment` 的文件头列了四类）。
   * 锚定那一处对非法 userId 的裁定是 **fail closed（拒）**，理由逐字适用于这里
   * （`anchor-workspace.ts` 的「为什么非法 id 必须拒」）。
   *
   * ⚠️ 断言顺序照 `LEARNINGS #004-14`：**被测属性（一条会话都没落盘）在前**，
   * 伴随信号（状态码 / 抛错）在后——后者只是「拒」的一个表征。
   */
  it.live(
    "projectId 含 `..`：被拒，且**一条会话都没落盘**",
    () =>
      Effect.gen(function* () {
        yield* createV1As(ALICE)
        const before = sessionCount(ALICE.id)

        const outcome = yield* Effect.exit(
          as(ALICE, "/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json", [PROJECT_HEADER]: "../../bob" },
            body: JSON.stringify({ location: {} }),
          }),
        )

        // ① 没有落盘（`..` 既不该逃出 ALICE 的沙箱，也不该静默退回沙箱根把会话建出来）
        expect(sessionCount(ALICE.id)).toBe(before)
        // ② 被拒，且**是 400 不是 5xx**：`..` 是**客户端给的字符串**不合法，属「你给的不对」，
        //    不是「服务端出错了」。原先写成 `throw new Error(...)`，而 `throw` 在 `Effect.gen` 体内
        //    = **defect** ⇒ 整个请求成 `Exit` 失败（500 / 直接抛出）——与同文件对 `sessionID` 那条
        //    **刻意回 400** 的口径打架（`LEARNINGS #002-06`：同一个判断两处各写一份，早晚不等）。
        //    旧断言 `Exit.isFailure(outcome) || status !== 200` 把 defect 也当「被拒」收下了，
        //    所以这个不一致一直是绿的。
        expect(Exit.isSuccess(outcome) ? outcome.value.status : "FiberFailure").toBe(400)
      }),
    30_000,
  )
})

/**
 * T020 的**前置两条之 2**（`tasks.md` 逐字：「**先补一条用例：文件树入口的实例目录确实上移了**」）。
 *
 * ## 为什么要在这里补，而不是「顺手假设它已经成立」
 *
 * `project-location.ts` 的文件头「已知不覆盖」第三条自己点名了本 task，原话是：
 * 「……于是**文件树 / pty / 上传那些入口的实例目录也跟着上移**。这是产品想要的方向……
 * 但那些入口**没有跑过带头的情形**——它们的行为是**推**出来的，不是测出来的。**要动它们之前
 * 先补一条用例**」。**T020 就是这条欠账的第一个消费者**：四项文件操作全部按「落点＝项目目录」写，
 * 若这条推出来的结论不成立，四项会**静默地全落到沙箱根**——不报错、不变红，只是写错了地方。
 *
 * ## 两条判据，缺一不可（`LEARNINGS #004-08`：「没报错」不等于「执行了」）
 *
 * ① **带头 ⇒ 列的是项目目录**（被测属性）；
 * ② **不带头 ⇒ 列的是沙箱根**（对照／阳性证明：这条证明「两个目录真的不是同一个」，
 *    少了它，一个「任何请求都列项目目录」的实现照样绿——而那会让 `GET /file` 在没选项目时
 *    把某个项目的内容画给用户）。
 *
 * 观测面是**磁盘上的两个不同文件**，不是响应状态码——「目录是谁」这件事只有内容说得清
 * （`LEARNINGS #002-02`：oracle 不经过被测对象）。
 */
describe("T020 前置 · 文件树入口的实例目录上移（FR-005）", () => {
  /** 沙箱根上那个文件：**只有不带头时才该看得见**。 */
  const 沙箱根上的 = "沙箱根上的.txt"
  /** 项目目录里那个文件：**只有带头时才该看得见**。 */
  const 项目里的 = "项目里的.txt"

  /**
   * 在盘上摆出两个**内容不同**的目录——两条判据的分辨率全来自这里。
   *
   * ⚠️ 本文件的既有那组用例**刻意不建目录**（见 `sandboxOf` 的注释），本组是**唯一**建目录的地方；
   * 两组的 DATA_ROOT / WORKSPACE_ROOT 虽然共用，但断言一律过 `canonical`（两侧都过），
   * 故「目录存在 ⇒ realpath 解析」这件事对两组都只是把两侧一起换算一遍。
   */
  const 摆两个目录 = (subject: TokenSubject, projectId: string) => {
    const 沙箱 = sandboxOf(subject)
    const 项目 = path.join(沙箱, projectId)
    mkdirSync(项目, { recursive: true })
    writeFileSync(path.join(沙箱, 沙箱根上的), "root-only")
    writeFileSync(path.join(项目, 项目里的), "project-only")
  }

  /** `GET /file?path=`（一层）。返回路径清单——**路径**而不是整行：判据只关心「列到了谁」。 */
  const 列一层 = (subject: TokenSubject, project?: string) =>
    Effect.gen(function* () {
      const response = yield* as(subject, "/file?path=", {
        headers: project === undefined ? {} : { [PROJECT_HEADER]: project },
      })
      expect(response.status).toBe(200)
      const rows = yield* json(Schema.Array(Schema.Struct({ path: Schema.String })), response)
      return rows.map((row) => row.path)
    })

  /**
   * **主判据**：带项目头 ⇒ `GET /file` 列的是**项目目录**。
   *
   * 断言写成两半（`tenant-db-isolation` 的「过紧也是缺陷」同款取向）：既要**看见**项目里那个，
   * 也要**看不见**沙箱根上那个。只写前半句的话，「把两个目录的内容并起来回」也能绿。
   */
  it.live(
    "带 x-openhive-project ⇒ 列的是项目目录（不是沙箱根）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)
        摆两个目录(ALICE, ALPHA)

        const paths = yield* 列一层(ALICE, ALPHA)

        expect(paths).toContain(项目里的)
        expect(paths).not.toContain(沙箱根上的)
      }),
    30_000,
  )

  /**
   * **对照 / 阳性证明**：不带头 ⇒ 列的是**沙箱根**。
   *
   * 这条不是重复上面那条：它证明「两个目录**真的不是同一个**」。少了它，上面那条在一个
   * 「不管有没有头都列项目目录」的实现上照样绿（`LEARNINGS #004-08`）。
   */
  it.live(
    "不带头 ⇒ 列的是沙箱根（证明上面那条的两个目录确实不同）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)
        摆两个目录(ALICE, ALPHA)

        const paths = yield* 列一层(ALICE)

        expect(paths).toContain(沙箱根上的)
        expect(paths).not.toContain(项目里的)
      }),
    30_000,
  )
})
