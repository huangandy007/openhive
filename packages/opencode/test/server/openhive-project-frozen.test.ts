import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs"
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
 * T015（FR-010）：**归档 = 冻结**在「在项目里干活」这条出口上的落地。
 *
 * ## 本任务钉的那句话，与它为什么不是 T013/T014 已经做过的事
 *
 * 归档（T013）与找回（T014）各自那条链上，`ProjectMembership.decide` 已经把人拦住了。
 * 但那两条链**只管自己那两个出口**。归档之后**别的**出口——建会话、读文件——今天
 * **一个字都没读归档态**：服务端唯一消费 `x-openhive-project` 的是
 * `middleware/project-location.ts`，它只查每用户库的 `project_ext`（回答「这个项目在不在」），
 * 于是「已归档」在文件/会话这些出口上**完全不存在**。
 *
 * 实测（2026-10-06，本文件写之前的一次探针，真应用 ＋ 真 PG）：`project_archive.archived = true`
 * 之后，带项目头建会话**仍然 200**，会话**照样落** `{沙箱根}/{projectId}`。沙箱早在 T013 里
 * 被删过一轮，这一条请求又把它**重建**出来——项目状态写着「已归档」，磁盘上却多了一个活目录。
 *
 * ## 裁定（2026-10-06，用户三问，均取推荐项）
 *
 * | 问题 | 裁定 |
 * |---|---|
 * | 「归档 = 冻结」延不延伸到「在项目里干活」 | **延伸**：已归档 ⇒ **一律拒**（含 owner，与 T004 的收紧口径同一条） |
 * | 门落在哪、拒成什么形态 | **`project-location.ts` 中间件**（带项目头的唯一收口）＋ **403 JSON**（与归档/找回同一口径） |
 * | 中间件怎么拿到「冻结」 | 查**一次** `project_archive`（`archiveStatesOf`），判据在 core 与 `decide` **同文件** |
 *
 * 三条互相咬合：**判据一处定义** ⇒ 中间件不需要多查一次 `project_member` 拿角色（那半条判定
 * 今天没有真实消费者，成员连自己的 `project_ext` 行都拿不到——那是 T021 的事）⇒
 * **每请求只多一次 PG 往返**。
 *
 * ## 为什么门只有一道，而下面的用例有三条出口
 *
 * `LEARNINGS #004-01`：判据要锚在「**做那件事的那一行**」。那个「一行」就是中间件——
 * 建会话（A 链 `POST /session` 读 URL、B 链 `POST /api/session` 读请求体）与文件树
 * （`GET /file`）的目录都从它那里出来。但**「一个门覆盖了几条路」与「这几条路真的被覆盖了」
 * 是两件事**：中间件今天只被 T017 的用例跑过建会话这一条（该文件头「已知不覆盖」明写着
 * 「文件树 / pty / 上传那些入口没跑过带头的情形」）。所以下面 A 链、B 链、`GET /file`
 * **各来一条**，把「三处都被同一道门拦住」从**推**出来的变成**测**出来的。
 *
 * ## 对照为什么必须有，且必须在**同一个夹具**里
 *
 * 「已归档 ⇒ 403」单独看**证明不了任何事**：403 也可能是别的原因（没身份、项目查不到、
 * 路由没挂上）。所以对照组必须**只改归档态这一个变量**，其余（同一个用户、同一个项目 id、
 * 同一个头、同一份应用）**逐字相同**。`LEARNINGS #002-02`：没跑过对照的判据不是判据。
 *
 * ⚠️ 「没有归档行」那一支是有意义的**正常态**而不是「坏数据」：`project_archive` 的行要到
 * 第一次归档才写（T013），今天**所有**项目都没有这一行 ⇒ 默认值必须是「未归档」，
 * 否则这道门会把全世界的项目一起冻掉。下面第 4 条就是这个默认值的回归断言
 * （口径与 T018 列表那条 `archives.get(id)?.archived ?? false` **同一条**——两处漂了就是
 * 「列表说活跃、进门被拒」）。
 *
 * ## oracle 一律不经过被测对象
 *
 * 「会话落没落盘」直接读**库文件**（`bun:sqlite` 读 `session.directory` / `count(*)`），
 * 不读响应体；种 `project_ext` 与 `project_archive` 都走**裸 SQL**，不调产品写入接口
 * （同 `openhive-project-directory.test.ts` 的取向）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }

/**
 * 客户端报「当前项目」的通道。**写死字面量、不 import 生产常量**——import 过来就成了
 * 「生产改什么测试跟着改什么」，改名也测不出来（`LEARNINGS #003-05` 的假镜像）。
 * 生产那份导出在 `middleware/project-location.ts` 的 `PROJECT_HEADER`。
 */
const PROJECT_HEADER = "x-openhive-project"

/** 已归档的那个项目。**合法路径段**——它会被 `join` 进沙箱路径。 */
const ARCHIVED = "prj_frozen_0001"
/** 对照组：格式合法、库里**没有**归档行（今天所有项目的常态）。 */
const ACTIVE = "prj_frozen_0002"
/**
 * 第二道门（D1）专用：它的前提是「会话**先**进去、项目**后**归档」，所以不能复用 `ARCHIVED`
 * ——那条路径上第一道门会先把「带头建会话」拦掉（夹具是同一个库、跨用例共享状态）。
 */
const ARCHIVED_LATER = "prj_frozen_0003"
/**
 * 用例 ⑧ 专用（同 `ARCHIVED_LATER` 的理由：前提是「会话**先**进去、项目**后**归档」）。
 * 它另需一个**诱饵项目头**（下面那个常量）来证明「头的存在不是第二道门的开关」。
 */
const ARCHIVED_HEADED = "prj_frozen_0004"
/**
 * 诱饵头之一：**合法的路径段、库里没有 `project_ext` 行** ⇒ 第一道门走到 R5 直通那一支，
 * 请求看上去「不属于任何项目」。这正是绕过面的形状（F1）。
 */
const DECOY_UNKNOWN = "prj_frozen_0005"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-project-frozen-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/**
 * 某人的沙箱根。
 *
 * ⚠️ 建会话那两条出口**不要求**这个目录存在（落点只是写进 `session.directory`）；只有
 * `GET /file` 需要，所以**只有它那条**由 `withProject` 建出项目目录来（见该助手里的注释）。
 */
const sandboxOf = (subject: TokenSubject) => path.join(WORKSPACE_ROOT, subject.id)

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是
 * `dataRoot(process.env)`，不是 Effect 的 `Config` 服务）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上。 */
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
 *
 * ⚠️ 它**同时**是本 task 的被测依赖：中间件要读 `auth.project_archive`。`startProductionDb`
 * 把 `PG_*` 写进 `process.env`（跑完还原），而中间件的连接池是**惰性**建的 ⇒ 只要第一条
 * 请求发生在 `beforeAll` 之后、`afterAll` 之前，它就落在**这个** PGlite 上（不是真的 PG）。
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

/** 以某人的身份发一个请求；额外头（本项目那个通道）从 `init.headers` 进。 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 读 JSON 体。**过一遍 `Schema` 而不是 `as`**（`Response.json()` 是 `any`，`as` 会被 oxlint 拦）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.promise(async () => Schema.decodeUnknownSync(schema)(await response.json()))

/** A 链（`/session`）的线上形状：**裸的** `{ id }`。 */
const SessionV1 = Schema.Struct({ id: Schema.String })
/** B 链（`/api/session`）的线上形状：**包了 `data`**。两条链的读法不同（`#004-01`），故两个形状分开写。 */
const SessionV2 = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
/** 403 的线上形状（两道门同一个口径）。**断它而不是只断状态码**：403 谁都会回，断文案才知道是这道门回的那一条。 */
const Frozen = Schema.Struct({ error: Schema.String })
const FROZEN_MESSAGE = "项目已归档，请先找回"

/** B 链建会话（目录读**请求体**）。**不在这里断言状态码**——本文件的判据就是状态码本身。 */
const postSessionAs = (subject: TokenSubject, projectId: string) =>
  as(subject, "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", [PROJECT_HEADER]: projectId },
    body: JSON.stringify({ location: {} }),
  })

/** A 链建会话（目录读 **URL**）。两条链的落点读法不同，故两条都要钉（`#004-01`）。 */
const getSessionAs = (subject: TokenSubject, projectId: string) =>
  as(subject, "/session", { method: "POST", headers: { [PROJECT_HEADER]: projectId } })

/** 文件树那条出口（`packages/app/src/project/openhive-files.ts` 真走的路径）。 */
const listFilesAs = (subject: TokenSubject, projectId: string) =>
  as(subject, "/file?path=", { headers: { [PROJECT_HEADER]: projectId } })

/** 某个用户的库文件。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/**
 * 某条会话落在哪个目录（**直接读库文件**）。库还没被建出来时给 `undefined`——
 * **不 `new Sqlite(...)` 去「顺便建一个」**（那会让「库本来该不该存在」这类断言失真）。
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

/**
 * 某人的库里有几条会话。**「一条都没多出来」这条断言要它**——它同时覆盖两种坏实现：
 * 放行进项目目录（重建沙箱）、以及**静默降级**落沙箱根（那也是「建了会话」）。
 */
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

/**
 * 造一个「项目已存在」的用户：**先用一次普通建会话把该用户的库建出来**（建库钩子建 `project_ext`，
 * T003），再用**裸 SQL** 补 `project` ＋ `project_ext` 两行。
 *
 * ⚠️ `project` 行不能省：`project_ext.project_id` 有外键（`ON DELETE CASCADE`）。
 * ⚠️ 时间列必须显式给：drizzle 的 `.$default()` 是**运行时**默认值，裸 SQL 绕不过去。
 * ⚠️ `OR IGNORE`：本文件多条用例**共用同一个 DATA_ROOT**（库文件跨用例累积）。
 */
const withProject = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    yield* as(subject, "/session", { method: "POST" })
    // ⚠️ 项目目录**要真的建出来**——只有 `GET /file` 那条出口需要它（`fs.list` 对着一个不存在的
    // 目录会炸成 500，那与本 task 的判据无关，会把对照组也染红）。建会话那两条链**不需要**它：
    // 落点只是写进 `session.directory`（T017 文件头「已知不覆盖」实测过：目录不存在照样 200）。
    mkdirSync(path.join(sandboxOf(subject), projectId), { recursive: true })
    const db = new Sqlite(userDb(subject.id))
    try {
      db.run(
        "INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, '[]', 1700000000000, 1700000000000)",
        [projectId, path.join(sandboxOf(subject), projectId)],
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
 * （同 `openhive-project-archive-unconfigured.test.ts` 的同名助手）。
 *
 * ⚠️ `archived_at` 不能省：迁移的 `project_archive_coherence_check` 钉着
 * `archived = (archived_at IS NOT NULL)`，只写 `archived` 会被库当场拒。
 * ⚠️ `on conflict` 不能省：本文件多条用例**共用同一个 PG 夹具与同一个项目 id**
 * （库是文件级共享的，同 `withProject` 的 `OR IGNORE`）——第二次插入会撞主键，
 * 而那是**夹具**问题、不是被测对象的问题（撞主键会把用例炸成 error 而不是 fail）。
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
 * 让某人成为某项目的 **owner**（夹具注入，裸 SQL）。只有「管理类调用」那条用例要它。
 *
 * 为什么必须真的给 owner：那条用例要钉的是「**门**排在 handler 之前」。归档/找回 handler 的
 * 次序是 `身份 → 归档态 → decide(403) → MinIO 配置(503)`，所以**非成员**打过去得到的 403
 * 与门给的 403 **同值**——门在不在都一个样，**断言没有牙**。给了 owner 之后：没有门 ⇒ handler
 * 走到 MinIO 那一步 ⇒ 503；有门 ⇒ 403。403 与 503 的差才是「门先响」的证据。
 *
 * ⚠️ `auth.user` 行必须有：`project_member.user_id` 有外键指向它（同
 * `openhive-project.test.ts` 的 `beforeAll`——那里是为建项目写的 owner 行）。
 * ⚠️ 两句**分开发**：`db.execute` 一次一句，不拼 `;`。
 * ⚠️ `on conflict` 不能省（同一份 PG、同一个项目 id 被多条用例共用，同 `标成已归档`）。
 */
const 让谁当owner = (subject: TokenSubject, projectId: string) =>
  Effect.promise(async () => {
    await pg!.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
    await pg!.db.execute(sql`
      insert into auth.project_member (project_id, user_id, role, time_created)
      values (${projectId}, ${subject.id}, 'owner', 1700000000)
      on conflict (project_id, user_id) do update set role = excluded.role
    `)
  })

/**
 * 归一化：断言钉的是**归属**，不是路径的书写形式（同 `tenant-directory-isolation.test.ts`）。
 * 目录不存在时 `realpath` 抛错 ⇒ 退回原样（win32 的 `tmpdir()` 是 8.3 短名，两个都解析不出来时
 * 至少退化成同一种写法，仍可比）。
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

describe("T015 · 归档 = 冻结（FR-010）：已归档的项目上不能干活", () => {
  /**
   * **主判据（B 链）**：已归档 ＋ 带项目头 ⇒ 被拒，且**零副作用**。
   *
   * 断言顺序照 `LEARNINGS #004-14`：**被测的安全属性（一条会话都没落盘）在前**，
   * 伴随信号（403）在后——`expect` 一失败即中止用例体，顺序决定变异时读到的是哪一条证据。
   *
   * 不落盘这一条**同时覆盖两种坏实现**，所以它是本题最强的判据：
   * ① 放行 ⇒ 会话落进项目目录（沙箱被重建）；② 静默降级落沙箱根 ⇒ 会话也落盘了。
   */
  it.live(
    "B 链：已归档 + 带 x-openhive-project 建会话 ⇒ 一条会话都没落盘，且回 403",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ARCHIVED)
        yield* 标成已归档(ARCHIVED)
        const before = sessionCount(ALICE.id)

        const response = yield* postSessionAs(ALICE, ARCHIVED)

        expect(sessionCount(ALICE.id)).toBe(before)
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **A 链**：同一个门，另一个入口。
   *
   * A 链的目录从 **URL** 读（`?directory=`）、B 链从**请求体**读——T017 的用例证明过
   * 「两条链的落点读法不同」。本题的门在**改写之前**，两条链应当**同等地**被拦下；
   * 这条就是那句话的观测面（只拦一条的话，改写的两半里就有一半还活着）。
   */
  it.live(
    "A 链：已归档 + 带项目头建会话 ⇒ 一条会话都没落盘，且回 403",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ARCHIVED)
        yield* 标成已归档(ARCHIVED)
        const before = sessionCount(ALICE.id)

        const response = yield* getSessionAs(ALICE, ARCHIVED)

        expect(sessionCount(ALICE.id)).toBe(before)
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **文件树那条出口**（FR-010 的「成员访问文件」）——`packages/app/src/project/openhive-files.ts`
   * 不发任何目录参数，只发这个头；它是**前端真正走的那条路**，也是本 task 最该钉的一条。
   *
   * ⚠️ 它同时也是 T017 文件头「已知不覆盖」里点名的那些入口的第一个实测样本：
   * 那一节写着「文件树 / pty / 上传那些入口没跑过带头的情形，它们的行为是推出来的」。
   */
  it.live(
    "GET /file：已归档 + 带项目头 ⇒ 回 403（前端真正走的那条出口）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ARCHIVED)
        yield* 标成已归档(ARCHIVED)

        const response = yield* listFilesAs(ALICE, ARCHIVED)

        expect(response.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **对照组**（`LEARNINGS #002-02`：「已归档 ⇒ 403」单独看证明不了任何事——403 也可能是
   * 别的原因）。这里只把**归档态**这一个变量拿掉，其余逐字相同，并且**三条出口一起跑**：
   * A 链、B 链落 `{沙箱根}/{projectId}`，文件树回 200 —— 于是上面那三条 403 的归因是实的。
   *
   * 它同时是「**没有归档行 ⇒ 未归档**」这条默认值的回归断言：`project_archive` 的行要到
   * 第一次归档才写，今天所有项目都没有 ⇒ 这条默认值错了，这道门会把全世界的项目一起冻掉。
   */
  it.live(
    "对照：同一个夹具、只是没有归档行 ⇒ 三条出口都照常（会话落 {沙箱根}/{projectId}、文件树 200）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ACTIVE)

        const b = yield* postSessionAs(ALICE, ACTIVE)
        expect(b.status).toBe(200)
        const v2 = yield* json(SessionV2, b)
        expect(canonical(sessionDirectory(ALICE.id, v2.data.id) ?? "")).toBe(
          canonical(path.join(sandboxOf(ALICE), ACTIVE)),
        )

        const a = yield* getSessionAs(ALICE, ACTIVE)
        expect(a.status).toBe(200)
        const v1 = yield* json(SessionV1, a)
        expect(canonical(sessionDirectory(ALICE.id, v1.id) ?? "")).toBe(canonical(path.join(sandboxOf(ALICE), ACTIVE)))

        const files = yield* listFilesAs(ALICE, ACTIVE)
        expect(files.status).toBe(200)
      }),
    30_000,
  )

  /**
   * **不带项目头的请求一次都不碰**（T017 文件头点名的「本层最重要的性质」）。
   *
   * 这道门是**全局中间件**（挂在合并路由之上），所以「它只认项目头」必须是一条被钉住的
   * 性质、而不是一句注释：归档项目的**非项目作用域**调用（列项目、取身份）照常。
   * 反过来说，若实现改成「按 projectId 在库里查到就冻」，这条会红——那正是要拦的形状：
   * 一个客户端**不报**自己在哪个项目时，服务端的失败模式只能是「落沙箱根」，
   * 不该变成「整条链 403」。
   */
  it.live(
    "不带项目头的请求：归档态一次都不碰（建会话照常，且落沙箱根）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ARCHIVED)
        yield* 标成已归档(ARCHIVED)

        const response = yield* as(ALICE, "/session", { method: "POST" })

        expect(response.status).toBe(200)
        const session = yield* json(SessionV1, response)
        // 落**沙箱根**（不是项目目录）：这正是「不带头 ⇒ 归档态一次都不碰」的观测面——
        // 门若按「库里有归档行就冻」实现，这条会红。断言落点而不是只看状态码：
        // 「静默降级到沙箱根」与「照常进项目目录」是两种不同的实现，本站的是前者。
        expect(canonical(sessionDirectory(ALICE.id, session.id) ?? "")).toBe(canonical(sandboxOf(ALICE)))
      }),
    30_000,
  )

  /**
   * **管理类调用不该带项目头**——这条钉的是本 task 引入的**唯一一处跨链风险**。
   *
   * 归档 / 找回两条出口**也是**全局中间件的下游（`OpenhiveArchive.routes` 与别的路由一起
   * merge 进同一张表）。若某个调用方在请求上看带回它的项目头，这道门会**先于** handler
   * 把它拦下 ⇒ **已归档的项目再也找回不了**（找回正需要已归档这个前提）。
   *
   * 今天不会发生：前端那两条薄客户端（`openhive-project.ts` 的 `listProjects` /
   * `createProject`）**都不发这个头**，`grep` 全仓只有 `openhive-files.ts` 发。所以本条的
   * 取向是**把契约钉死**：带了头 = 「我要进这个已经冻住的项目里干活」⇒ 403 是对的，
   * 错的是那个头。T023（FE 归档/找回入口）接线时**别**给找回的调用加这个头。
   *
   * ⚠️ **为什么这里要先 `让谁当owner`**：找回 handler 对**非成员**也回 403，与门同值
   * ⇒ 门在不在都绿，断言**没有牙**（`#004-08` 的「没跑过对照的判据不是判据」）。给了 owner
   * 之后两条用例的差才是证据：**同一个人、同一个归档项目、同一份应用**，只差一个头——
   * 带头 ⇒ 403（门），**不带头 ⇒ 503**（handler 走到「MinIO 未配置」那一步，本文件的应用
   * 刻意没配 MinIO）。
   *
   * ⚠️ **这个差只证明「门在不在」，不证明「门排在 handler 之前」**（复查 2026-10-06 席2 F1：
   * 原先这里写的是后者，**是错的**）。门若排在 handler **之后**，带头那一枪同样会是 403——
   * handler 先跑完（回 403 或 503），门根本没机会说话。管理类链上**一个副作用都没有**，
   * 端到端断言分不出先后（`#004-09`：端点断言对顺序不敏感）。要在这里测顺序，得先造一个
   * **门之前就能读到的观测面**（`#004-13`：「没有现成观测面」≠「没有观测面」）——
   * 今天没造，已如实记进 `project-location.ts` 的「已知不覆盖」。
   * 顺序在**建会话**那条链上是测过的：用例 ①②③ 断的是**落盘目录**，门在 handler 之后
   * 就不会是那个目录。
   */
  it.live(
    "管理类调用带了项目头：这道门先拦下（找回 403），不带头则走到 handler（503）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ARCHIVED)
        yield* 标成已归档(ARCHIVED)
        yield* 让谁当owner(ALICE, ARCHIVED)

        const 找回 = (headers: Record<string, string>) =>
          as(ALICE, "/openhive/project/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ projectId: ARCHIVED }),
          })

        const 带头 = yield* 找回({ [PROJECT_HEADER]: ARCHIVED })
        const 不带头 = yield* 找回({})

        // 对照在前、被测在后：`expect` 一失败即中止用例体（`#004-14`），这一题的证据是两者
        // 的**差**，所以先拿到「机制是活的」那一半（503 说明 handler 确实会走到配置检查）。
        expect(不带头.status).toBe(503)
        expect(带头.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **第二道门（T015 · D1）**：目录来自**会话行**、不来自头的那一半。
   *
   * 前六条钉的都是「请求**自己说**它在哪个项目」那一半（`x-openhive-project`）。但能让人在项目目录里
   * 干活的**不止**那个头：会话作用域那条链的实例目录取自**会话行**（`middleware/workspace-routing.ts`
   * 的 `session?.directory || …`，那是**上游**文件），于是「建会话时带了头、以后用这个会话时不必再带」
   * 是一条**旁路**——归档后它照样在那个（已被 T013 删掉的）目录里跑。
   *
   * 这条用例钉的是**补上的第二道门**：不带项目头时，若这条请求匹配到的路由带 `sessionID` 参数
   * （两条链都叫这个名字），就去读那个会话的目录；目录落在 `{沙箱根}/{本人}/{projectId}` 里、
   * 且该项目已归档 ⇒ **403**。⚠️ 也就是说：**归档项目的会话整体冻住**（连读它也是 403），
   * 不只「在它里面跑提示词」。
   *
   * ⚠️ **对照（`#004-08`：没跑过对照的判据不是判据）**：同一个请求在**归档前**必须是 200。
   * 少了这一半，下面那个 403 可能只是「路由没了」「会话读不到」——**看着一样红**。
   *
   * ⚠️ **为什么用 `ARCHIVED_LATER` 而不是 `ARCHIVED`**：这条用例的前提是「会话**先**进去、
   * 项目**后**归档」，而夹具（库）**跨用例共享**——`ARCHIVED` 在前面几条里已经被标成归档了，
   * 拿它起步会**先撞上第一道门**（带头建会话就 403），红在夹具上而不是在被测的那条断言上
   * （第一次跑就是这么红的）。
   *
   * ⚠️ **断言顺序**（`#004-14`）：这里被测属性（归档后 403 ＋ 文案）**排在对照之后**——与那条
   * 纪律相反，是被**时间序**逼的：归档前那一半只能是前置条件，不先拿到 200 就无从谈「归档后」。
   * 补救是把对照**断死在状态码上**（不是「跑过了就算」），并且它的失败信息与 403 那条不重样。
   */
  it.live(
    "已有会话不带项目头：归档后连读它都被拒（403 ＋ 文案），归档前同一请求是 200（两条链各一遍）",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ARCHIVED_LATER)

        // 会话**怎么进去的**：带着头建（落点由用例 ① 钉着）——这条旁路的前提就是它。
        const created = yield* postSessionAs(ALICE, ARCHIVED_LATER)
        expect(created.status).toBe(200)
        const { data: session } = yield* json(SessionV2, created)

        // 两条链各读一遍。⚠️ 这不是凑数：第二道门要靠**路由参数名**认出入境（`params["sessionID"]`），
        // 而「两条链同名」本来只是一句注释——`#004-03`（「有 X 钉住」必须真钉住）。v2 那一半没有的话，
        // 上游把 `/api/session/:sessionID` 改成别的参数名，结果是**那条链静默裸奔**、不报错不变红。
        // 对照同样两遍（`#004-08`）：少了它，「403」可能只是「这条 v2 路由根本不通」。
        const 读它 = () => as(ALICE, `/session/${session.id}`)
        const v2读它 = () => as(ALICE, `/api/session/${session.id}`)

        const 归档前 = yield* 读它()
        const v2归档前 = yield* v2读它()
        expect(归档前.status).toBe(200)
        expect(v2归档前.status).toBe(200)

        yield* 标成已归档(ARCHIVED_LATER)

        const 归档后 = yield* 读它()
        const v2归档后 = yield* v2读它()
        const body = yield* json(Frozen, 归档后)
        const v2body = yield* json(Frozen, v2归档后)
        expect(body.error).toBe(FROZEN_MESSAGE)
        expect(v2body.error).toBe(FROZEN_MESSAGE)
        expect(归档后.status).toBe(403)
        expect(v2归档后.status).toBe(403)
      }),
    30_000,
  )

  /**
   * **第二道门不能被「再带一个头」解除**（F1，2026-10-06 第二轮审查实测出来的 Critical）。
   *
   * 绕过面：请求带**任意**一个不是「已归档项目」的项目头 ⇒ 第一道门那一支要么按该项目放行
   * （本人名下的活跃项目）、要么走 R5 直通（查不到 `project_ext` 行）；而**会话作用域路由的
   * 工作目录取自会话行、不取自请求**（A 链 `middleware/workspace-routing.ts` 的
   * `session?.directory || defaultDirectory(...)`，B 链 `packages/server/src/middleware/session-location.ts`
   * 直读 `SessionTable.directory`）⇒ 归档项目里的旧会话照样在它的目录里干活。
   * 也就是说：**「请求有没有说自己在哪个项目」不该是「要不要问会话行」的开关**。
   *
   * 两式诱饵缺一不可，它们走的是第一道门里**两条不同的分支**：
   * - `DECOY_UNKNOWN`（库里没有 `project_ext` 行）⇒ R5 直通；
   * - `ACTIVE`（本人名下的活跃项目，用例 ④ 种过 `project_ext` 行且无归档行）⇒ 按它放行并改写目录。
   *   第二式更险：它连「落点被改写到别的项目目录」都说得通，只有会话行才认得出真相。
   *
   * 对照（`#004-08`）：**无头**那一条必须先 403——否则下面两条「也是 403」可能只是
   * 「这条路由本来就不通」，看着一样红。
   */
  it.live(
    "已有会话落在归档项目：请求再**带上**一个别的项目头（查不到的 ／ 本人名下活跃的）也解除不了冻结",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, ARCHIVED_HEADED)

        // 会话**先**进去（这条旁路的前提），项目**后**归档。
        const created = yield* postSessionAs(ALICE, ARCHIVED_HEADED)
        expect(created.status).toBe(200)
        const { data: session } = yield* json(SessionV2, created)

        yield* 标成已归档(ARCHIVED_HEADED)

        const 对照无头 = yield* as(ALICE, `/api/session/${session.id}`)
        expect(对照无头.status).toBe(403)

        const 诱饵1 = yield* as(ALICE, `/api/session/${session.id}`, {
          headers: { [PROJECT_HEADER]: DECOY_UNKNOWN },
        })
        const 诱饵1body = yield* json(Frozen, 诱饵1)
        expect(诱饵1body.error).toBe(FROZEN_MESSAGE)
        expect(诱饵1.status).toBe(403)

        const 诱饵2 = yield* as(ALICE, `/api/session/${session.id}`, { headers: { [PROJECT_HEADER]: ACTIVE } })
        const 诱饵2body = yield* json(Frozen, 诱饵2)
        expect(诱饵2body.error).toBe(FROZEN_MESSAGE)
        expect(诱饵2.status).toBe(403)
      }),
    30_000,
  )
})
