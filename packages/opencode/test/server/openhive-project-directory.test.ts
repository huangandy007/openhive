import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
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

/**
 * 「当前项目」的**第二个通道：cookie**（006 Step 5 · ②-1，裁定 2026-10-07）。
 *
 * ⚠️ 同样**写字面量、不 import 生产常量**（理由与 `PROJECT_HEADER` 逐字相同，`#003-05` 的假镜像）。
 * 生产那份导出在 `middleware/project-location.ts` 的 `PROJECT_COOKIE`。
 */
const PROJECT_COOKIE = "openhive_project"

/** 项目 cookie 的 `名=值`。拼进**同一个 `Cookie` 头**（与身份那个共用头，见 `as()`）。 */
const 项目cookie = (projectId: string) => `${PROJECT_COOKIE}=${projectId}`

/** 已有 `project_ext` 行的项目 id。**合法路径段**——它会被 `join` 进沙箱路径。 */
const ALPHA = "prj_alpha_0001"
/** 格式合法、但库里**没有**这一行（R5：落沙箱根，不做隐式建项目）。 */
const GHOST = "prj_ghost_0002"
/**
 * 一个**已归档**的项目 id（006 Step 5 · ②-1 的判据要用）。
 *
 * ⚠️ 与 `ALPHA` 分开是**必需**的：归档是写在共享 PG 夹具里的**全局**状态，一旦 `ALPHA` 被标成
 * 归档，本文件前面那些「带头落项目目录」的用例会**一起变红**——而那是夹具传染，不是被测对象出了事。
 */
const FROZEN = "prj_frozen_0003"

// ⚠️ 归一化到长名再往下接：本机 `TMP` 是 **8.3 短名**（`ADMINI~1`），而锚定那一侧会把
// 存在的父目录 `realpath` 成长名 ⇒ 若这里留着短名，`sandboxOf` 的**期望值**就与实际值
// 只差这一层拼法（实测 7 条红全是这种「只差拼法」）。`mkdtempSync` 已经建了目录 ⇒
// 整条路径可以一次归一化到底（`realpathSync.native` 与产品那侧同一个原语）。
const SANDBOX = realpathSync.native(mkdtempSync(path.join(tmpdir(), "openhive-project-dir-")))
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

/**
 * 身份那个 cookie 的 `名=值`（**不含头名那一层**）。
 *
 * ⚠️ 2026-10-07（006 Step 5 · ②-1）从原先那个 `cookie()` 里拆出来：项目 cookie 要拼在
 * **同一个 `Cookie` 头**里，而这里原来是 `headers.set("Cookie", …)`（**整份覆盖**）——
 * 直接把第二个 cookie 传进来会被它挤掉，于是用例「带着项目 cookie」却什么都没带，
 * 而**红出来的方向是错的**（`#004-08` 那种「没报错 ≠ 执行了」）。
 */
const sessionCookie = (value: string) => `${UserIdentity.COOKIE_NAME}=${value}`

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 读 JSON 体。**过一遍 `Schema` 而不是 `as`**（`Response.json()` 是 `any`，`as` 会被 oxlint 拦）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.map(Effect.promise(() => response.json()), (body: unknown) => Schema.decodeUnknownSync(schema)(body))

/**
 * 以某人的身份发一个请求。
 *
 * - 额外**头**（项目头那条通道）从 `init.headers` 进；
 * - 第二个 **cookie**（项目 cookie 那条通道，006 ②-1）从 `extraCookie` 进。
 *
 * ⚠️ `Cookie` 头**一次拼好**：身份与项目两个 cookie 共用这一个头，分两次 `set` 只会剩最后一个。
 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}, extraCookie?: string) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    const jar = [sessionCookie(yield* token(subject))]
    if (extraCookie !== undefined) jar.push(extraCookie)
    headers.set("Cookie", jar.join("; "))
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
const createV1As = (
  subject: TokenSubject,
  init: { project?: string; projectCookie?: string; directory?: string } = {},
) =>
  Effect.gen(function* () {
    const query = init.directory === undefined ? "" : `?directory=${encodeURIComponent(init.directory)}`
    const response = yield* as(
      subject,
      `/session${query}`,
      {
        method: "POST",
        headers: init.project === undefined ? {} : { [PROJECT_HEADER]: init.project },
      },
      init.projectCookie === undefined ? undefined : 项目cookie(init.projectCookie),
    )
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
  init: { project?: string; projectCookie?: string; directory?: string; headers?: Record<string, string> } = {},
) =>
  Effect.gen(function* () {
    const response = yield* as(
      subject,
      "/api/session",
      {
        method: "POST",
        headers: {
          ...(init.headers ?? { "Content-Type": "application/json" }),
          ...(init.project === undefined ? {} : { [PROJECT_HEADER]: init.project }),
        },
        body: JSON.stringify({ location: init.directory === undefined ? {} : { directory: init.directory } }),
      },
      init.projectCookie === undefined ? undefined : 项目cookie(init.projectCookie),
    )
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
 * **夹具注入**一行「已归档」——直接写 `project_archive`，不是走归档流程
 * （同 `openhive-project-frozen.test.ts` 的同名助手，抄它而不是自己发明，`#004-12`）。
 *
 * ⚠️ `archived_at` 不能省：迁移的 `project_archive_coherence_check` 钉着
 * `archived = (archived_at IS NOT NULL)`，只写 `archived` 会被库当场拒。
 * ⚠️ `on conflict` 不能省：本文件多条用例**共用同一个 PG 夹具**，第二次插入会撞主键，
 * 而那是**夹具**问题、不是被测对象的问题（撞主键会把用例炸成 error 而不是 fail）。
 *
 * ⚠️ 2026-10-09 从「项目 cookie 通道」那组**提到文件级**（判据 ⑦⑧ 也要用它）：归档是写进共享 PG 的
 * **全局**状态，两份定义迟早漂；而它一旦漂，症状是「某组用例莫名其妙 403 / 不 403」，读起来像别的事。
 */
const 标成已归档 = (projectId: string) =>
  Effect.promise(() =>
    Promise.resolve(
      pg!.db.execute(
        sql`insert into auth.project_archive (project_id, archived, archived_at)
            values (${projectId}, true, 1700000000)
            on conflict (project_id) do update set archived = excluded.archived, archived_at = excluded.archived_at`,
      ),
    ),
  )

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

/**
 * 006 Step 5 · ②-1（用户裁定 **B：cookie 通道**，2026-10-07）：**「当前项目」的第二个通道**。
 *
 * ## 这条为什么存在
 *
 * 006 的右栏（`packages/app/src/ai-session/`）建会话走 **SDK v2**（`POST /api/session`，B 链），
 * 而 SDK **不发 `x-openhive-project` 头**——带这个头的只有 005 那四个裸路由。于是「给右栏的建会话
 * 加个项目头」这条**按字面做会回归**：只有建会话带头、列会话不带头 ⇒ 新会话落在项目目录、
 * 而列表看的是沙箱根 ⇒ **新会话在列表里看不见**。右栏因此整条链落在**沙箱根**、不感知项目（②-1）。
 *
 * 选 cookie 的理由是**唯一零上游侵入**：fork 侧够不着那个要注入头的地方——右栏的目录作用域客户端
 * 由**上游** `context/server-sdk.tsx` 的 `createDirSdkContext` 造（`ensureDirSdkContext` /
 * `ensureDirSyncContext` 都从那里出来），实测没有可注入的缝。而 cookie 由**浏览器自动附带**，
 * SDK 那条链因此也带上了它。
 *
 * ## ⚠️ 但 cookie 是**环境信号**，不是**意向声明**——本组的判据全从这一点长出来
 *
 * 头是客户端**主动**填的：填了就是「我要进这个项目干活」。cookie 是浏览器**自动**带的：
 * 用户没做过任何声明，只是「当前选中的项目是它」。两者在本中间件里的处置**必须不同**，
 * 否则一个背景噪声就能砖掉前台：
 *
 * | 情形 | 显式通道（头） | 环境通道（cookie） |
 * |---|---|---|
 * | 指向**已归档**的项目 | **403**（005 T015 原语义，**一字不动**） | **当作没带** ⇒ 落沙箱根 |
 * | 值**非法**（`../../` 逃逸写法） | **400**（客户端能立刻看见并改） | **当作没带** ⇒ 落沙箱根 |
 * | 指向查不到的项目 | 落沙箱根（R5） | 落沙箱根（R5，同一支） |
 *
 * 判据一句话：**显式通道会拒绝；环境通道只会在「无效」时退化成「没有」。**
 *
 * 为什么归档那一支**不能**照 403 做（裁定前实测）：cookie 对**全 app 每一条请求**生效 ⇒
 * 当前项目一旦是已归档的（共享项目被 owner 归档、而本地 `currentProject` 还挂着它），
 * 连 `GET /openhive/project/list` 都会 403 ⇒ **项目清单读不到、用户切不出去**。
 * 而「不许在冻结目录里干活」这条**一点没松**：它由 T015 的**第二道门**（会话目录那道）原样守着
 * ——本组第 ⑤ 条就是它的对照（头打同一个归档项目仍然 403，说明门本身还活着）。
 *
 * ## 头压过 cookie（不是「cookie 补头」）
 *
 * 头在场时 **cookie 一次都不看**（第 ③ 条）：两者冲突时，只有显式那个是用户当下那句话。
 * 实现上就是 `header ?? cookie` 这个顺序，但**顺序本身是语义**，所以专门钉一条。
 *
 * ## 两条链都来一条（`LEARNINGS #004-01`：数**出口**）
 *
 * 与上面带头那两组的理由逐字相同：A 链目录在 **URL**、B 链在**请求体**，只接一条就是另一条
 * 静默退回沙箱根。⚠️ 但要说清一件事：cookie 的**读取**只有一处（中间件里那一行），在两条链的
 * **上游**——所以这里的两条钉的是「同一个 cookie 真的走到了两条链各自的改写点」，
 * **不是**两个独立的通道。⚠️ 实测口径：**右栏走的是 B 链**（SDK v2），A 链那条是本组对称补的。
 *
 * ## 本组不覆盖什么
 *
 * - **不覆盖「cookie 与头指向同一个项目」**：那一条退化成「头那一支」，与上面第二组同值，
 *   多写一条只是重复（`#005-12` 的反面：把一个落点拆成两条不是更严，是填充）。
 * - **不覆盖客户端的写入 / 清除**：那在 `packages/app/src/project/current-project.test.ts`
 *   （cookie 的名字在两侧各写一份字面量，都是**客户端契约**）。
 * - **不覆盖「换身份后旧 cookie 会不会串到别人身上」**：**不会**，而且是结构上不会——
 *   `findByProjectID` 查的是**请求方自己那份**每用户库，别人的项目 id 在那份库里查不到 ⇒ 走 R5。
 *   这条**推得出来**（每用户库物理隔离已由 `tenant-db-isolation.test.ts` 钉住），故本组不重复钉。
 */
describe("项目 cookie 通道（006 Step 5 · ②-1）", () => {
  /**
   * **主判据（B 链 ＝ 右栏走的那条）**：只带项目 cookie ⇒ 落 `{沙箱根}/{projectId}`。
   *
   * 另一半在同一个断言里：**落点在沙箱根里面**（`startsWith`）——少了它，一条「把项目 id 当绝对
   * 路径用」的实现（落 `/{projectId}`）也能满足「结尾是 projectId」这种弱断言（同上面第一组）。
   */
  it.live(
    "B 链：不带项目头、只带项目 cookie ⇒ 落 {沙箱根}/{projectId}（且在沙箱根里面）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)

        const id = yield* createV2As(ALICE, { projectCookie: ALPHA })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        const root = canonical(sandboxOf(ALICE))
        expect(landed).toBe(canonical(path.join(sandboxOf(ALICE), ALPHA)))
        expect(landed.startsWith(`${root}/`)).toBe(true)
      }),
    30_000,
  )

  /** 同一个 cookie 的**第二个出口**：A 链的目录从 URL 读（`?directory=`），不是从请求体。 */
  it.live(
    "A 链：只带项目 cookie ⇒ 同样落 {沙箱根}/{projectId}",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)

        const id = yield* createV1As(ALICE, { projectCookie: ALPHA })

        expect(canonical(sessionDirectory(ALICE.id, id) ?? "")).toBe(canonical(path.join(sandboxOf(ALICE), ALPHA)))
      }),
    30_000,
  )

  /**
   * **头在场时 cookie 一次都不看**。
   *
   * 诱饵选的是「头指向一个**查不到**的项目（R5 直通）、cookie 指向一个**存在**的项目」——
   * 于是两种实现分得开：`header ?? cookie`（正确）落**沙箱根**；
   * 而「头查不到就回落到 cookie」落 **ALPHA 项目目录**。两个落点不同值，断言有牙。
   */
  it.live(
    "头压过 cookie：头指向查不到的项目、cookie 指向存在的项目 ⇒ 落沙箱根（cookie 一次都不看）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)

        const id = yield* createV2As(ALICE, { project: GHOST, projectCookie: ALPHA })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        expect(landed).toBe(canonical(sandboxOf(ALICE)))
        expect(landed).not.toBe(canonical(path.join(sandboxOf(ALICE), ALPHA)))
      }),
    30_000,
  )

  /**
   * **本次裁定的核心**：cookie 指向**已归档**项目 ⇒ **当作没带**、落沙箱根、**200**（不是 403）。
   *
   * 两半都是被测属性，缺一不可：
   * ① 落沙箱根（不是落那个已归档的项目目录——那会在一个**已被 T013 删掉**的目录里建会话）；
   * ② **200**（不是 403）——这是「环境信号不构成归档意向」这句话本身。
   * 对照组是紧跟着的第 ⑤ 条（同一个项目、同一个夹具，只改通道）。
   */
  it.live(
    "cookie 指向**已归档**项目 ⇒ 当作没带、落沙箱根、200（环境信号不构成归档意向）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, FROZEN)
        yield* 标成已归档(FROZEN)

        const id = yield* createV2As(ALICE, { projectCookie: FROZEN })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        expect(landed).toBe(canonical(sandboxOf(ALICE)))
        expect(landed).not.toBe(canonical(path.join(sandboxOf(ALICE), FROZEN)))
      }),
    30_000,
  )

  /**
   * **对照：门本身还活着**——同一个已归档项目，走**头**仍然是 403。
   *
   * 少了这一条，上面那条「落沙箱根、200」在一个「**归档门整个被删掉**」的实现上照样绿
   * （`#004-08`：副作用类判据必须先证明机制是活的）。两条只差**通道**这一个变量：
   * 同一个用户、同一个项目 id、同一份应用、同一个归档态。
   *
   * ⚠️ 断言顺序照 `#004-14`：**被测属性（一条会话都没落盘）在前**，伴随信号（403）在后。
   */
  it.live(
    "对照：同一个已归档项目走**头** ⇒ 403、一条会话都没落盘（归档门没被上一条动过）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, FROZEN)
        yield* 标成已归档(FROZEN)
        const before = sessionCount(ALICE.id)

        const response = yield* as(ALICE, "/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", [PROJECT_HEADER]: FROZEN },
          body: JSON.stringify({ location: {} }),
        })

        expect(sessionCount(ALICE.id)).toBe(before)
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **cookie 值非法（逃逸写法）⇒ 当作没带**，不是 400。
   *
   * 这是「环境通道不产生错误」那条规则的第二个落点（与归档那一支同一条规则）：
   * 一个被改坏的 cookie 若能把请求变成 400，就等于**用一条背景噪声砖掉整个 app**。
   * 而安全性一点没松——非法值的结果是**落沙箱根**，`../../bob` 既不逃出去、也不静默生效。
   *
   * ⚠️ 与**头**那条非法值正相反：头非法 ⇒ **400**（上面那组钉着）。两条刻意不同，别当成不一致。
   */
  it.live(
    "cookie 值非法（`../../bob`）⇒ 当作没带、落沙箱根、200（环境通道不产生错误）",
    () =>
      Effect.gen(function* () {
        yield* createV1As(ALICE) // 先把 ALICE 的库建出来，下面才好读它

        const id = yield* createV2As(ALICE, { projectCookie: "../../bob" })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        expect(landed).toBe(canonical(sandboxOf(ALICE)))
        expect(landed).not.toContain("bob")
      }),
    30_000,
  )
})

/**
 * 目录通道（2026-10-09，用户裁定 **A**）：**客户端在 URL 上报的目录**也能指名「哪个项目」。
 *
 * ## 这条为什么存在（用户看到的那个 bug）
 *
 * 左栏会话列表按**目录**取会话（`loadSessions(project.worktree)` 走 `GET /session?directory=…`），
 * 而服务端此前只认**头 / cookie** ⇒ 客户端替**另一个项目**发的请求（页面加载时那段**预热**
 * 会给每个项目各拉一次列表）拿到的是**当前项目**的会话 ⇒ 切项目后左栏列的还是别人的会话。
 * 真栈实测（2026-10-09，同一页面内直打服务端）：`cookie=p1` ＋ `?directory=…/p2` 返回的集合
 * **逐条等于** p1 自己的。本组钉的就是「**目录说了算**」。
 *
 * ## 目录通道是**显式通道**（2026-10-09 用户裁定 **方案 A**），与 cookie **不同档**
 *
 * 第一版把它与 cookie 并列成**环境**档（理由：都骑在一串请求上）。**用户同日改判**，判据是本仓那条
 * 尺子——「这条信号骑在**多少条**请求上」：cookie 骑在**每一条**请求上（含项目清单 ⇒ 会砖掉整个
 * app，见 cookie 那组末段），而目录只在**说到某个项目**的请求上出现（项目清单**不走目录作用域
 * SDK**：`listProjects` 是裸 `fetch(PATH.list, { credentials: "same-origin" })`）。
 * ⇒ 它按**显式**档处置：指向**已归档**项目 ⇒ **403**，不再是「当作没带 ⇒ 静默换成沙箱根的集合」
 * ——那正是用户报的那个 bug 的形状（指名要 p2 的会话，拿回来**别人**的集合）。第 ⑦ 条钉它。
 *
 * ⚠️ 升级的作用面**只有归档那一支**：目录通道**产不出**非法值（见下「形状判据」末段），
 * 所以 `400` 那一支对它**不可达**——别为它写用例，那是 `#003-03` 第③类的形状（写不出红）。
 * 头仍是最纯的显式通道、仍**最高优先级**（第 ④ 条钉它）。
 *
 * ## 形状判据（安全那一半）
 *
 * 目录必须**恰好**是 `{沙箱根}/{本人 id}/{projectId}`——比这深 / 浅、或第一段**不是本人 id**
 * （＝指向别人的沙箱）⇒ 一律 `undefined`（当作没带）。判据本体是 `project-location.ts` 既有的
 * `projectIdOfSessionDirectory`，本组是它**第一次**被外部输入喂到（此前只有会话行喂它），
 * 所以第 ⑤ 条顺带把它那条「第一段必须是自己」的分支也钉住了（那分支自己的注释里写着
 * 「今天走不到、没有测试守着」——**本组让它走到了**）。
 *
 * ### ⚠️ 为什么这里**没有**「非法值 ⇒ 400」那条用例（本次刻意不写）
 *
 * 因为**写不出红**：`projectIdOfSessionDirectory` 走 `path.relative`，而它**已归一化** ⇒ `.` /
 * `..` / 尾分隔一律被吃掉、落进「长度 ≠ 2」或「首段不是本人 id」⇒ `undefined`（2026-10-09 探针
 * 实测：`{根}/{本人 id}/..` ⇒ `relative` 为 `""`；`{根}/{本人 id}/.` 与尾分隔 ⇒ `relative` 为本人
 * id 那一段）。`..%2F..` 这类**字面**串确实**原样保留**成 projectId，可它不含 `/` 或 `\`
 * ⇒ 过得了 `isSafePathSegment`（它只拒空 / `.` / `..` / 含分隔符）⇒ 也不是非法值。
 * 一句话：`badRequest()` 那一支**对目录通道不可达**。硬写一条只会得到「改前改后都绿」
 * ——那是 `#003-03` 第③类（不可达 ⇒ 该删代码 / 该记缺口，不是补测试），据实记在这里。
 */
describe("目录通道（客户端报的 ?directory= 只说「哪个项目」）", () => {
  /** 第二个项目。与 `ALPHA` 分开：两条会话落在**两个不同目录**，判据才有分辨率。 */
  const BETA = "prj_beta_0004"

  /**
   * 第三个项目：**只**给这条组的归档用例（⑦）用。
   *
   * ⚠️ **不能借 `FROZEN`**（`prj_frozen_0003`）：它在上面那组 cookie 用例里**已经被标成归档**，
   * 而归档是写进共享 PG 夹具的**全局**状态 ⇒ 本组「归档**之前**」那半条会当场红，红在**夹具传染**
   * 上而不是被测对象上（`#004-08` 那种「红了，但红的不是我预期那条」）。
   */
  const FROZEN_DIR = "prj_frozen_0005"

  /** 客户端会填的目录（＝服务端项目清单给的那个 worktree，见 `project.ts` 的 `handleList`）。 */
  const 项目目录 = (subject: TokenSubject, projectId: string) => path.join(sandboxOf(subject), projectId)

  /**
   * 列某个**目录**下的会话 id。
   *
   * oracle 是**响应体**（不是库）：这条读法正是左栏会话列表走的那条，比读库更贴被测的那件事。
   * 客户端报的是**目录**，项目 cookie 另给（`undefined` ＝ 不带）。
   */
  const 列目录 = (subject: TokenSubject, directory: string, projectCookie?: string) =>
    Effect.gen(function* () {
      const url = `/session?directory=${encodeURIComponent(directory)}&limit=50&order=desc`
      const response = yield* as(subject, url, {}, projectCookie === undefined ? undefined : 项目cookie(projectCookie))
      expect(response.status).toBe(200)
      const rows = yield* json(Schema.Array(Schema.Struct({ id: Schema.String })), response)
      return rows.map((row) => row.id)
    })

  /** 两个项目各建一条会话，返回 `{ 甲, 乙 }`（ALPHA / BETA 各一）。 */
  const 两个项目各一条 = () =>
    Effect.gen(function* () {
      yield* withProject(ALICE, ALPHA)
      const 甲 = yield* createV1As(ALICE, { project: ALPHA })
      yield* withProject(ALICE, BETA)
      const 乙 = yield* createV1As(ALICE, { project: BETA })
      return { 甲, 乙 }
    })

  /**
   * **主判据**：cookie 指向 BETA、目录指向 ALPHA ⇒ 列的是 **ALPHA** 的会话。
   *
   * 这正是用户看到的那件事：客户端替 ALPHA 发请求，而「当前项目」（cookie）是 BETA。
   * 修之前 red in the right way：返回的集合是 BETA 的（`toContain(甲)` 先红）。
   */
  it.live(
    "① 主判据：cookie=BETA、目录=ALPHA ⇒ 列 ALPHA 的会话（目录压过 cookie）",
    () =>
      Effect.gen(function* () {
        const { 甲, 乙 } = yield* 两个项目各一条()

        const ids = yield* 列目录(ALICE, 项目目录(ALICE, ALPHA), BETA)

        expect(ids).toContain(甲)
        expect(ids).not.toContain(乙)
      }),
    30_000,
  )

  /**
   * **对照 / 阳性证明**：同一个 cookie、目录换成 BETA ⇒ 列的是 **BETA** 的会话。
   *
   * 少了它，一条「不管目录报什么都列同一个项目」的实现照样满足上面那条
   * （`#004-08`：「没报错」不等于「执行了」）。两条只差**目录**这一个变量。
   */
  it.live(
    "② 对照：同一个 cookie、目录=BETA ⇒ 列 BETA 的会话（证明上面那条的两个目录确实不同）",
    () =>
      Effect.gen(function* () {
        const { 甲, 乙 } = yield* 两个项目各一条()

        const ids = yield* 列目录(ALICE, 项目目录(ALICE, BETA), BETA)

        expect(ids).toContain(乙)
        expect(ids).not.toContain(甲)
      }),
    30_000,
  )

  /**
   * **回归 · 目录没给出项目时 cookie 仍然说了算**：目录停在**沙箱根**（缺 `{projectId}` 那一段）
   * ⇒ 当作没带 ⇒ cookie=BETA 生效。
   *
   * 这条守的是「目录通道没有把 cookie 那条**打掉**」——不带头建会话 / 列会话的正常落点正是沙箱根。
   */
  it.live(
    "③ 回归：目录=沙箱根（没有项目那一段）⇒ cookie 仍然说了算（列 BETA）",
    () =>
      Effect.gen(function* () {
        const { 甲, 乙 } = yield* 两个项目各一条()

        const ids = yield* 列目录(ALICE, sandboxOf(ALICE), BETA)

        expect(ids).toContain(乙)
        expect(ids).not.toContain(甲)
      }),
    30_000,
  )

  /**
   * **回归 · 头仍然压过目录**：头=ALPHA、目录=BETA ⇒ 落 ALPHA。
   *
   * 通道优先级是 `头 ?? 目录 ?? cookie`；头是唯一**显式**那个（如上「环境通道」一节），
   * 它压过其余两个。观测面用**建会话**（读库）：落点这件事库说得最清楚。
   */
  it.live(
    "④ 回归：头=ALPHA、目录=BETA ⇒ 落 ALPHA（头仍压过目录）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ALPHA)
        yield* withProject(ALICE, BETA)

        const id = yield* createV1As(ALICE, {
          project: ALPHA,
          directory: 项目目录(ALICE, BETA),
          projectCookie: BETA,
        })

        expect(canonical(sessionDirectory(ALICE.id, id) ?? "")).toBe(canonical(项目目录(ALICE, ALPHA)))
      }),
    30_000,
  )

  /**
   * **回归 · 安全那一半：目录指向别人的沙箱 ⇒ 当作没带**。
   *
   * 目录是**客户端可填**的，而这个通道会把它的**第二段**当成 projectId 拼进**自己的**沙箱
   * ⇒ 「第一段必须等于本人 id」这条判据（`projectIdOfSessionDirectory` 里那句）从此**可达**了。
   * 断言写成两半：落本人沙箱根，且**没有**落到 BOB 的沙箱里（少了后半句，「把所有人锚进同一个
   * 空目录」也能绿）。
   */
  it.live(
    "⑤ 回归：目录指向别人的沙箱 ⇒ 当作没带（不落 BOB 的沙箱）",
    () =>
      Effect.gen(function* () {
        yield* createV1As(ALICE) // 先把 ALICE 的库建出来，下面才好读它

        const id = yield* createV1As(ALICE, { directory: path.join(sandboxOf(BOB), "prj_someone_else") })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        expect(landed).toBe(canonical(sandboxOf(ALICE)))
        expect(landed).not.toContain(canonical(sandboxOf(BOB)))
      }),
    30_000,
  )

  /**
   * **回归 · 逃逸写法仍然无效**：目录写 `../../` ⇒ 当作没带，落沙箱根。
   *
   * 与上面第一组那条同源（锚定 + 本层的同一条不变量），单独留在这组里是因为**通道变了**：
   * 目录从此是「有效输入」，所以「哪些写法算**无效**」必须各钉一条。
   */
  it.live(
    "⑥ 回归：目录写 `../../` 逃逸写法 ⇒ 一律无效（落沙箱根，不逃出去）",
    () =>
      Effect.gen(function* () {
        yield* createV1As(ALICE)

        const id = yield* createV1As(ALICE, { directory: FORGED })

        const landed = canonical(sessionDirectory(ALICE.id, id) ?? "")
        expect(landed).toBe(canonical(sandboxOf(ALICE)))
        expect(landed).not.toContain("escaped-outside-sandbox")
      }),
    30_000,
  )

  /**
   * **目录通道指向已归档项目 ⇒ 403**（2026-10-09 用户裁定「方案 A」：目录通道升 **显式档**）。
   *
   * 为什么它不能再是「当作没带、落沙箱根、200」：那是**静默换项目**——客户端指名要 FROZEN_DIR 的
   * 会话，服务端却把请求改写到**沙箱根**，返回**另一个目录**的集合（用户报的那个 bug 的形状）。
   * cookie 那组仍走环境档（它骑在**每一条**请求上，会把整个 app 砖掉，见该组末段），两条**刻意不同档**。
   *
   * ⚠️ 两半都在断言里，缺一会让这条用例失去分辨率：
   * ①（**前置**）归档**之前**同一条请求 200 **且列出的就是 FROZEN_DIR 那条会话**——少了它，
   * 一个「本通道对所有目录都回 403」的实现照样绿（`#004-08`：副作用类判据先证明机制是活的）。
   * ②（**被测属性**）归档**之后** 403。
   * ⚠️ 断言顺序照 `#004-14` 本应「被测属性在前」，这里相反是**时间上的必然**（题设必须先发生），
   * 已在用例名里点明「归档前 … 是 200」。
   */
  it.live(
    "⑦ 显式：目录指向已归档项目 ⇒ 403（归档前同一条请求是 200 且列的就是它的会话）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, FROZEN_DIR)
        const 冻 = yield* createV1As(ALICE, { project: FROZEN_DIR })
        const url = `/session?directory=${encodeURIComponent(项目目录(ALICE, FROZEN_DIR))}&limit=50&order=desc`

        // ① 前置：这条目录形状被接受，且**真的路由到了 FROZEN_DIR**（不是碰巧 200）。
        const 归档前 = yield* as(ALICE, url)
        expect(归档前.status).toBe(200)
        const 归档前的行 = yield* json(Schema.Array(Schema.Struct({ id: Schema.String })), 归档前)
        expect(归档前的行.map((row) => row.id)).toContain(冻)

        // ② 被测属性：归档之后，同一条请求**拒绝**，不再静默换成沙箱根的集合。
        yield* 标成已归档(FROZEN_DIR)
        const 归档后 = yield* as(ALICE, url)
        expect(归档后.status).toBe(403)
      }),
    30_000,
  )
})
