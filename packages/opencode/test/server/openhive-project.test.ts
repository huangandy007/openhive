import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite, type SQLQueryBindings } from "bun:sqlite"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "fs"
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
 * T018（FR-002 / FR-003）：**建项目 / 列项目的落库 ＋ HTTP 出口**。
 *
 * ## 为什么这一组必须打在**真应用**上（而不是单元测那几个函数）
 *
 * 本条要钉的一句话是「**建出来的 id 就是服务端认的那个 id**」——T017 的中间件按
 * `x-openhive-project` 的值去 `project_ext` 查、再拼 `join(沙箱根, projectId)`。
 * 这句话横跨**三层**：写库（四张表）→ 中间件查库 → 会话落点。单元测任何一层都证不了它，
 * 所以主判据是「建完项目、拿它建一次会话、直接读会话目录」。
 *
 * ## oracle 一律不经过被测对象（`LEARNINGS #002-02`）
 *
 * - 库里那四行：**用 `bun:sqlite` 直接读库文件**（不经 HTTP、不经我们自己的查询函数）；
 * - 业务 PG 那行：**直接在 `pg.db` 上写 SQL**，不经 `membersOf`；
 * - 目录 / bare 仓库：`existsSync`。
 * 只有「会话落在哪」需要一个读法，那个也用裸 SQL。
 *
 * ## harness 与 `openhive-project-directory.test.ts` 同源
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入），故整套约法照抄
 * （`LEARNINGS #004-12`：新出口的第一动作是把同族 harness 整段搬来，只换判据点）：
 * `process.env.OPENHIVE_DATA_ROOT` 只能走 env、假模型/口径不涉及、身份走 cookie 不走自造头。
 *
 * ## ⚠️ 「未挂载」在本应用里**不是 404**——状态码证明不了路由挂上了
 *
 * 2026-10-06 探针实测（temporary probe file，已删；同一个 `openApp` 打六条）：
 *
 * | 请求 | 结果 |
 * |---|---|
 * | `GET /config`（上游真路由）有凭证 | **200** ＋ `application/json` |
 * | `GET /nope`（不存在的路径）有凭证 | **200** ＋ `text/html`（SPA 的 `index.html`） |
 * | `POST /openhive/project`（本 task 尚未挂载）有凭证 | **200** ＋ `text/html` |
 * | `GET /openhive/project` 无凭证 | **401** ＋ 空体 |
 *
 * 也就是说**未匹配的路径被 SPA 兜底回 200**，本文件第一版那句 `expect(response.status).toBe(200)`
 * 在「路由根本没挂」时**照样绿**——RED 是靠后面 `response.json()` 解析空体炸出来的，报的是
 * `SyntaxError: Failed to parse JSON` 而不是「路由没挂」。**这是假绿与「读不懂的红」两头都占了**：
 * 若那条出口恰好回一个合法 JSON（比如上游某个通配路由），整组会**静默全绿**。
 *
 * ⇒ 本文件的 `json()` 把判据前移到 **`Content-Type`**：挂上的出口回 `application/json`，
 * 没挂的回 `text/html`。状态码仍然断，但它是**伴随信号**不是判据（`LEARNINGS #004-14`）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/**
 * 第三个身份，**本文件里一次项目也不建**——「空库 ⇒ []」那条专用的对照。
 *
 * ⚠️ 用它而不是 ALICE/BOB：本文件所有用例共享同一个真库、同一批用户目录，而 ALICE/BOB
 * 在别的用例里都建过项目 ⇒ 拿他们当「空」得到的是**用例间的隐式耦合**（2026-10-06 实测就是这样红的：
 * 那条断言收到的列表里躺着「2026-0601 电诈专案」「形状」「私有对照」三条**别的用例**建的项目）。
 * 判据一句话：**「空」必须是这个身份自己的性质，不是「到目前为止还没轮到别人建」。**
 *
 * 它**不需要** `auth.user` 行——本文件里它只读不写，而 `project_member` 的外键只在写时要（见下 `beforeAll`）。
 */
const CAROL: TokenSubject = { id: "770e8400-e29b-41d4-a716-446655440002", policeNo: "020603", name: "王五", isAdmin: false }

/**
 * 出口路径（**客户端契约**）。
 *
 * ⚠️ 与 `openhive-project-directory.test.ts` 对头名的处置同款：这里写**字面量**、**刻意不 import**
 * 生产常量——import 过来就变成「生产改什么测试跟着改什么」，改名也测不出来（`LEARNINGS #003-05`）。
 */
const PROJECT_PATH = "/openhive/project"

/** 「当前项目」的头名（同上：字面量）。这条契约由 T017 立、T018 接上。 */
const PROJECT_HEADER = "x-openhive-project"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-project-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** 某人的沙箱根。**本文件不预先创建它**——建项目那一步才建（T017 的「已知不覆盖 ①」移交到本条）。 */
const sandboxOf = (subject: TokenSubject) => path.join(WORKSPACE_ROOT, subject.id)

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，
 * 不是 Effect 的 `Config` 服务）——同族测试的同款注释：塞 `ConfigProvider` 会被**无声忽略**。
 */
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
  // `project_member.user_id` 有外键 ⇒ 两个身份必须先有 `auth.user` 行。
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
  Effect.gen(function* () {
    // ⚠️ **先断内容类型，不能只断状态码**——见文件头「未挂载 ≠ 404」那条实测。
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 以某人的身份发一个请求；额外头（项目头那类）从 `init.headers` 进。 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/**
 * 列表项的**线上形状**（`project-panel.tsx` 的 `ProjectEntry` 是它在 UI 侧的那份投影）。
 *
 * ⚠️ 这里逐字写字段名，是**故意**的：跨包（`opencode` ⇄ `app`）没有共享类型可 import，
 * 而「键名对不上」的失败模式是**静默的空列表**（`panel.projects?.filter(...)` 全落空）。
 * 把它当**客户端契约**钉死（`LEARNINGS #003-05`：镜像要写成能被惊醒的样子）。
 *
 * ⚠️ **`memberCount` 与 `archived` 是可选键，这是刻意的**（第一版写成必填，是把「我以为的形状」
 * 当成了契约，`LEARNINGS #004-07`：形状由**被调方**定义——这里是消费侧 `ProjectEntry` 的注释）：
 *
 * - `memberCount`：`ProjectEntry` 原话「**私有项目读作 `undefined`**（同 `ProjectAnchor`：
 *   不给 0、不给假数）」。面板那句 `<Show when={props.project.memberCount} keyed>` 只要拿到真值
 *   就画 `👥 N` ⇒ 「给 0」与「给真数」都会让**私有项目**长出一个成员徽章。缺键 = 没有这回事。
 * - `archived`：`ProjectEntry` 原话「省略 = 活跃」。`project_archive` 的行要到 T013 才写，
 *   今天一条都没有；读成 `false` 等于替归档那条链**声称**「查过了，没归档」。
 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  archived: Schema.optional(Schema.Boolean),
})

/** `POST /openhive/project` —— 建一个项目，返回它的 `ProjectEntry`。 */
const createAs = (subject: TokenSubject, body: { name: string; type: string }) =>
  Effect.gen(function* () {
    const response = yield* as(subject, PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    return yield* json(Entry, response)
  })

/** `GET /openhive/project` —— 列项目。 */
const listAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* as(subject, PROJECT_PATH)
    expect(response.status).toBe(200)
    return yield* json(Schema.Array(Entry), response)
  })

/** 建会话（A 链，`POST /session`），带项目头——判「建出来的 id 服务端认不认」。 */
const createSessionAs = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/session", {
      method: "POST",
      headers: { [PROJECT_HEADER]: projectId },
    })
    expect(response.status).toBe(200)
    return (yield* json(Schema.Struct({ id: Schema.String }), response)).id
  })

/** 某个用户的库文件。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/**
 * 只读地跑一条查询；库文件不在 ⇒ `undefined`（**不 `new Sqlite` 去「顺便建一个」**）。
 *
 * 两处类型写法不是风格：`Statement.get` 的返回是 `T | null`，而本函数的契约是 `undefined`
 * ⇒ 末尾要 `?? undefined` 收敛（否则 typecheck 报 `'T | null' is not assignable to 'T | undefined'`）；
 * 绑定参数的类型必须写 `SQLQueryBindings[]`（bun 的类型参数有约束，`unknown[]` 过不去）。
 *
 * `T` 挂在这里（而不是每处调用各写一遍行形状）是本文件**四个**薄包装
 * （`projectRow` / `extRow` / `directoryCount` / `sessionDirectory`）共用的那一层：
 * 规则 `no-unnecessary-type-parameters` 说的「`T` 只用一次」是对的，但按 T010 的先例
 * （`member-panel.test.tsx` 那条注释）拆成四份 = 四份重复，所以显式关掉这一条。
 * ⚠️ 禁用指令**必须是紧贴函数的那一行**——`oxlint-disable-next-line` 看的是**字面下一行**，
 * 指令与函数之间再夹任何一行注释（哪怕还是注释）就等于**没禁用**。2026-10-06 实测：
 * 写成三行注释块时警告照旧，且行号跟着函数往下漂。
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
 * **写**用户的库文件（`bun:sqlite`，与 `queryOne` 同一条路，只是动了写）。
 *
 * 用途只有一处：构造「两条同 `last_accessed_at`」的夹具。**这是夹具不是 oracle**——
 * 它改的是**输入**（时间戳那一列），不是被测对象的输出；断言仍然读的是 HTTP 响应
 * （`LEARNINGS #002-02` 要的是「oracle 不经过被测对象」，这里满足）。
 *
 * 库文件不在 ⇒ 抛（写一个不存在的库是**夹具搭错了**，不该静默变成「没这回事」——
 * 与 `queryOne` 的「不在就 `undefined`」相反的取法，正是因为它俩一个是**问**一个是**设**）。
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

/** `project` 行的 `(id, worktree, vcs)`；没有 ⇒ `undefined`。 */
const projectRow = (userId: string, projectId: string) =>
  queryOne<{ id: string; worktree: string; vcs: string | null }>(
    userId,
    "SELECT id, worktree, vcs FROM project WHERE id = ?",
    [projectId],
  )

/** `project_ext` 行；没有 ⇒ `undefined`。 */
const extRow = (userId: string, projectId: string) =>
  queryOne<{ type: string; shared_directory: string | null }>(
    userId,
    "SELECT type, shared_directory FROM project_ext WHERE project_id = ?",
    [projectId],
  )

/** `project_directory` 里记了几条这个项目的目录。 */
const directoryCount = (userId: string, projectId: string) =>
  queryOne<{ n: number }>(userId, "SELECT count(*) AS n FROM project_directory WHERE project_id = ?", [projectId])
    ?.n ?? 0

/** 某条会话落在哪个目录（**直接读库文件**，不经被测对象）。 */
const sessionDirectory = (userId: string, sessionId: string) =>
  queryOne<{ directory: string }>(userId, "SELECT directory FROM session WHERE id = ?", [sessionId])?.directory

/** 业务 PG 里的成员行（**直接打 `pg.db`**，不经 `membersOf`）。 */
async function memberRows(projectId: string): Promise<{ user_id: string; role: string }[]> {
  if (!pg) return []
  const result = await pg.db.execute(
    sql`select user_id, role from auth.project_member where project_id = ${projectId} order by user_id`,
  )
  return rowsOf(result).map((row) => ({ user_id: String(row.user_id), role: String(row.role) }))
}

/**
 * 归一化：断言钉的是**归属**，不是路径的书写形式（同族测试同款）。
 * ⚠️ 本文件与同族那条**不同**：这里的目录**真的会被建出来**，`realpath` 会真的解析
 * （win32 上 `Administrator` 那种长短名差异正是 `LEARNINGS #003-04` 记过的一类），
 * 所以两侧都过同一个 `canonical`，而不是靠「反正目录不存在」走同一条路。
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

describe("T018 · 建项目落库（FR-002）", () => {
  /**
   * **主判据**：一次建项目 ⇒ **四处都落**＋目录建出来。
   *
   * 四处是 U4 的「收成一个写入模块」点名的那四处：`project`（上游）＋ `project_directory`（上游）
   * ＋ `project_ext`（每用户库，T003）＋ `project_member`（业务 PG，T004）。
   * **少任何一处都不会报错**，只会让某个下游静默失效：少了 `project` 则 `project_ext` 的外键插不进去、
   * 少了 `project_ext` 则 T017 的中间件查不到、少了 `project_member` 则 T013 的归档判定把 owner 判成外人。
   */
  it.live(
    "建私有项目 ⇒ project / project_directory / project_ext / project_member 四处都落 ＋ 目录建出来",
    () =>
      Effect.gen(function* () {
        const entry = yield* createAs(ALICE, { name: "2026-0601 电诈专案", type: "private" })

        // ① 每用户库：project 行（worktree = 项目目录本身）＋ project_ext（private / 无共享目录）
        const project = projectRow(ALICE.id, entry.id)
        expect(project?.worktree && canonical(project.worktree)).toBe(canonical(path.join(sandboxOf(ALICE), entry.id)))
        expect(extRow(ALICE.id, entry.id)).toEqual({ type: "private", shared_directory: null })
        expect(directoryCount(ALICE.id, entry.id)).toBeGreaterThan(0)

        // ② 业务 PG：owner 行
        expect(yield* Effect.promise(() => memberRows(entry.id))).toEqual([{ user_id: ALICE.id, role: "owner" }])

        // ③ 目录真的建出来了（T017 移交过来的那一条：中间件只写路径，不建目录）
        expect(existsSync(path.join(sandboxOf(ALICE), entry.id))).toBe(true)

        // ④ 出参的形状：**私有项目不给 `memberCount`**（不是给 0），且没有归档行 ⇒ 不给 `archived`
        //    （不是给 false）。两条都是「不给假数」的同一个取向，判据落在**键在不在**上，
        //    而不是落在值上——值上「0」与「1」都会让面板多画一个徽章。
        expect("memberCount" in entry).toBe(false)
        expect("archived" in entry).toBe(false)
      }),
    30_000,
  )

  /**
   * **id 的形状**（开工前裁定 (1)：`crypto.randomUUID()`）。
   *
   * 钉形状不是为了好看：这个值会**直接当路径段**（`join(沙箱根, projectId)`），也会当请求头的值
   * （HTTP 头不许带非 ASCII）。裁定选 UUID 的**代价**是沙箱目录人不可读，**换来**的是
   * 「零碰撞 ⇒ 不需要『撞了就重取』那条分支与它的测试」——这条断言就是那个交换的收据。
   */
  it.live(
    "新建项目的 id 是 UUID v4（它要当路径段与头值，不能用中文或任意串）",
    () =>
      Effect.gen(function* () {
        const entry = yield* createAs(ALICE, { name: "形状", type: "private" })

        expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      }),
    30_000,
  )

  /**
   * **本 task 的支点**：建出来的 id **就是服务端认的那个 id**。
   *
   * 走完「建项目 → 拿它的 id 建会话 → 读会话目录」，跨越写库 / 中间件查库 / 落点三处。
   * 这条不成立时，症状是**会话落在沙箱根而不是项目目录**——不报错、不变红，
   * 只有打开文件树才发现「我在项目里干活，文件却不在项目里」。
   */
  it.live(
    "建完项目用它建会话 ⇒ 会话落 {沙箱根}/{userId}/{projectId}（T017 的契约接上了）",
    () =>
      Effect.gen(function* () {
        const entry = yield* createAs(ALICE, { name: "落地", type: "shared" })

        const sessionId = yield* createSessionAs(ALICE, entry.id)

        expect(canonical(sessionDirectory(ALICE.id, sessionId) ?? "")).toBe(
          canonical(path.join(sandboxOf(ALICE), entry.id)),
        )
      }),
    30_000,
  )

  /**
   * **共享项目**：Q2 裁定的 bare 仓库由本条建（裁定 (2)），且路径写进 `project_ext.shared_directory`。
   *
   * 两半缺一不可：只 `git init --bare` 不落库 ⇒ T016 的共享读写**不知道去哪儿找**；
   * 只落库不建仓库 ⇒ 那行指向一个不存在的目录，而它看起来完全正常。
   */
  it.live(
    "建共享项目 ⇒ /shared/{projectId}.git 建出来 ＋ shared_directory 落库 ＋ 出参带 memberCount",
    () =>
      Effect.gen(function* () {
        const entry = yield* createAs(ALICE, { name: "共享专案", type: "shared" })

        const bare = path.join(SHARED_ROOT, `${entry.id}.git`)
        // `HEAD` 是 `git init --bare` 一定会写下的那一个文件——断言它而不是断言目录存在：
        // 「目录在」在**建目录**那一步之后就已经成立了（① 与 ⑥ 建的是两个不同的目录，
        // 但万一 `bare` 被算成项目目录，只断目录存在就抓不到）。
        expect(existsSync(path.join(bare, "HEAD"))).toBe(true)
        expect(extRow(ALICE.id, entry.id)).toEqual({ type: "shared", shared_directory: bare })

        // 共享项目**才**给 `memberCount`（就是 owner 自己）——与上面私有那条构成对照。
        expect(entry.memberCount).toBe(1)
      }),
    30_000,
  )

  /**
   * **私有项目不许留下共享仓库的痕迹**（对照）。
   *
   * 少了这条，「不管什么类型都 `git init --bare`」也能让上面那条绿——而它会让每个私有项目
   * 在 `/shared` 下多一个没人认领的仓库。
   */
  it.live(
    "建私有项目 ⇒ /shared 下不留东西（对照）",
    () =>
      Effect.gen(function* () {
        const entry = yield* createAs(ALICE, { name: "私有对照", type: "private" })

        expect(existsSync(path.join(SHARED_ROOT, `${entry.id}.git`))).toBe(false)
        expect(extRow(ALICE.id, entry.id)?.shared_directory).toBeNull()
      }),
    30_000,
  )
})

describe("T018 · 列项目（FR-003）", () => {
  /**
   * **主判据**：列出来的就是建出来的，字段齐、按「最近访问」倒序。
   *
   * 倒序不是修饰：设计 §3 的「最近」tab 直接按它排，顺序反了是**用户可见的错**，
   * 而它不会让任何别的断言红。
   */
  it.live(
    "列项目：最近建的在前（「最近」tab 的顺序），字段与键齐",
    () =>
      Effect.gen(function* () {
        const first = yield* createAs(BOB, { name: "先建", type: "private" })
        // 时间戳是**毫秒**，两次建项目之间只隔一次 HTTP 往返 ⇒ 同一个毫秒是可能的，
        // 而「同一毫秒时谁在前」是**另一条**判据（下一条用例单独钉）。这里先把时间**拉开**，
        // 让本用例只回答「倒序对不对」这一个问题（`#004-14`：一条用例只钉一件事）。
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))
        const second = yield* createAs(BOB, { name: "后建", type: "shared" })

        const entries = yield* listAs(BOB)

        expect(entries.map((entry) => entry.id)).toEqual([second.id, first.id])

        const shared = entries[0]
        const own = entries[1]
        expect(shared).toMatchObject({ name: "后建", type: "shared", memberCount: 1, lastAccessedAt: second.lastAccessedAt })
        expect(own).toMatchObject({ name: "先建", type: "private", lastAccessedAt: first.lastAccessedAt })
        // 「不给假数」两条：私有项目没有 `memberCount`、没有归档行就没有 `archived`。
        expect("memberCount" in own).toBe(false)
        expect("archived" in shared).toBe(false)
      }),
    30_000,
  )

  /**
   * **同一毫秒的两条，顺序仍然确定**——次级键 `project_id` 的判据。
   *
   * 少了这条，实现里那句 `orderBy(desc(last_accessed_at), project_id)` 的后半段**删掉也不会红**
   * （`LEARNINGS #004-04`：写进代码/注释的事实性说法，要么有判据，要么别写）。而后半段是真需要的：
   * 没有它，同毫秒的两行顺序由 SQLite 的返回顺序决定——用户看到的是「列表会跳」。
   *
   * 构造手法是**直接改库**（把先建那条的时间戳改成与后建同一个毫秒），因为「让服务端在同一毫秒里
   * 建两个项目」在测试里做不到（两次 HTTP 往返之间必然隔了不止一毫秒）。改的是**被测对象之外**的
   * 输入（`project_ext` 的时间戳），不是它的输出——`LEARNINGS #002-02` 要的是 oracle 不经过被测对象，
   * 这一句正好相反地满足：**夹具**直接写库。
   */
  it.live(
    "同一 lastAccessedAt 的两条 ⇒ 按 project_id 升序（次级键，顺序不许不确定）",
    () =>
      Effect.gen(function* () {
        const alpha = yield* createAs(BOB, { name: "甲", type: "private" })
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))
        const beta = yield* createAs(BOB, { name: "乙", type: "private" })

        // 把「甲」的时间戳对齐到「乙」的——两条从此同毫秒。
        // ⚠️ `Effect.sync` 而不是 `Effect.promise`：后者要求 thunk **返回 Promise**，
        // 而 `writeUserDb` 是同步的（返回 `void`）⇒ 会去 `.then` 一个 `undefined`，
        // 报的是 Effect 内部的 `TypeError: undefined is not an object (...'.then')`，
        // **与真因隔着一层**（2026-10-06 实测踩到）。
        yield* Effect.sync(() =>
          writeUserDb(BOB.id, "UPDATE project_ext SET last_accessed_at = ? WHERE project_id = ?", [
            beta.lastAccessedAt,
            alpha.id,
          ]),
        )

        const entries = yield* listAs(BOB)
        const both = entries.filter((entry) => entry.id === alpha.id || entry.id === beta.id)

        expect(both.map((entry) => entry.id)).toEqual([alpha.id, beta.id].sort())
      }),
    30_000,
  )

  /**
   * **空库 ⇒ `[]`**（收口时必查的那一条）。
   *
   * 「还没有来源」与「来源说一个都没有」是两件事：HTTP 这一层只能给后者，而**接缝那一层**
   * （`project-list.ts`）必须把「还没有来源」表达成 `undefined`。这条钉的是 HTTP 这一半；
   * 接缝那一半在 `packages/app` 的测试里。
   */
  it.live(
    "空库 ⇒ []（不是 404、不是 null）",
    () =>
      Effect.gen(function* () {
        // CAROL 在本文件里从不建项目（见它的定义处）——「空」是它自己的性质。
        expect(yield* listAs(CAROL)).toEqual([])
      }),
    30_000,
  )

  /**
   * **隔离**：ALICE 的项目不许出现在 BOB 的列表里。
   *
   * 这条是宪法 §一（物理隔离）在**读出口**上的见证。少了它，「列表 = 把主库 `project` 表全倒出来」
   * 也能让上面几条绿——而那是把全部门的项目名摊给每个人看。
   */
  it.live(
    "隔离：ALICE 建的项目不出现在 BOB 的列表里",
    () =>
      Effect.gen(function* () {
        const mine = yield* createAs(ALICE, { name: "甲的", type: "private" })

        // 被测属性在前（`#004-14`）：先钉「没混进来」，再钉「自己的还在」。
        expect((yield* listAs(BOB)).map((entry) => entry.id)).not.toContain(mine.id)
        expect((yield* listAs(ALICE)).map((entry) => entry.id)).toContain(mine.id)
      }),
    30_000,
  )
})

describe("T018 · 出口本身（身份门）", () => {
  /**
   * 没有身份 ⇒ 两个出口都不许通。**这是 fail-closed 的一半**（另一半在中间件）。
   *
   * 钉 `401` 而不是「不是 200」：探针实测无凭证时**恰好**是 401 ＋空体，把它钉死才能察觉
   * 「身份层从 401 漂成 302 跳登录页」这类改动——而那种漂**不会**让「不是 200」这条红。
   * ⚠️ 这里**只能**断状态码，不能走 `json()`：无凭证的回体是**空**的。
   */
  it.live(
    "不带凭证：建与列都回 401，且一个口子也不放",
    () =>
      Effect.gen(function* () {
        const created = yield* openApp(PROJECT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "偷偷建", type: "private" }),
        })
        const listed = yield* openApp(PROJECT_PATH)

        expect(created.status).toBe(401)
        expect(listed.status).toBe(401)
      }),
    30_000,
  )
})
