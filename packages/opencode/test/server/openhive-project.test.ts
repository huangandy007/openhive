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
import { addMember } from "@opencode-ai/auth/project-member"
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

/**
 * 身份 cookie 的 `名=值`（**不含头名那一层**）。
 *
 * ⚠️ 2026-10-09 从原先那个 `cookie()`（返回一整个 `{ Cookie }`）里拆出来，与同族文件
 * `openhive-project-directory.test.ts` 的 `sessionCookie` 同形——理由在那边的注释里：项目 cookie
 * 要拼在**同一个 `Cookie` 头**里，而「返回一整份 headers」的写法会让第二个 cookie 把它**挤掉**，
 * 于是「带着项目 cookie」的用例其实什么都没带，**红出来的方向还是错的**（`#004-08`）。
 */
const sessionCookie = (value: string) => `${UserIdentity.COOKIE_NAME}=${value}`

/**
 * 「当前项目」的**第二个通道：cookie 名**（006 Step 5 · ②-1）。
 *
 * ⚠️ **同族文件里那句的理由逐字适用**：写字面量、**刻意不 import** 生产常量
 * （`middleware/project-location.ts` 的 `PROJECT_COOKIE`）——import 过来就变成「生产改什么、
 * 测试跟着改什么」，改名也测不出来（`LEARNINGS #003-05` 的假镜像）。
 */
const 项目cookie = (projectId: string) => `openhive_project=${projectId}`

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

/**
 * 以某人的身份发一个请求。
 *
 * - 额外**头**（项目头那条通道）从 `init.headers` 进；
 * - 第二个 **cookie**（项目 cookie 那条通道）从 `extraCookie` 进——**左栏/右栏那条 SDK 链够不着
 *   项目头**（那是上游 `createDirSdkContext` 造的，fork 侧没有注入头的缝），靠的是浏览器对
 *   每一条同源请求自动带的 cookie ⇒「左栏列会话」那条取数在本文件里**只能**用 cookie 通道复现。
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

/**
 * 列表项的**线上形状**（`project-panel.tsx` 的 `ProjectEntry` 是它在 UI 侧的那份投影）。
 *
 * ⚠️ 这里逐字写字段名，是**故意**的：跨包（`opencode` ⇄ `app`）没有共享类型可 import，
 * 而「键名对不上」的失败模式是**静默的空列表**（`panel.projects?.filter(...)` 全落空）。
 * 把它当**客户端契约**钉死（`LEARNINGS #003-05`：镜像要写成能被惊醒的样子）。
 *
 * ⚠️ **`memberCount` / `archived` / `role` 是可选键，这是刻意的**（第一版写成必填，是把「我以为的形状」
 * 当成了契约，`LEARNINGS #004-07`：形状由**被调方**定义——这里是消费侧 `ProjectEntry` 的注释）：
 *
 * - `memberCount`：`ProjectEntry` 原话「**私有项目读作 `undefined`**（同 `ProjectAnchor`：
 *   不给 0、不给假数）」。面板那句 `<Show when={props.project.memberCount} keyed>` 只要拿到真值
 *   就画 `👥 N` ⇒ 「给 0」与「给真数」都会让**私有项目**长出一个成员徽章。缺键 = 没有这回事。
 * - `archived`：`ProjectEntry` 原话「省略 = 活跃」。`project_archive` 的行要到 T013 才写，
 *   今天一条都没有；读成 `false` 等于替归档那条链**声称**「查过了，没归档」。
 * - `role`（T023 追加）：**我**在这行项目里的角色，面板拿它当 `ProjectMembership.decide` 的
 *   `actor`（判定只有那一份实现，组件零规则复述）。**没有成员行 ⇒ 缺键**——读成 `"member"` 会
 *   让 `decide` **放行**，读成 `"owner"` 更糟（凭空多一个能点的「归档」）。同上面两条口径：
 *   「还没查」不许写成「查过了」。
 * - `directory`（2026-10-08 追加深，**必给**）：这个项目在**沙箱里的落点**，左栏会话列表拿它
 *   去取那个目录的会话（`ensureDirSyncContext(目录)`）。与 `stale` 同**一类**——它是**算出来的**
 *   （`{沙箱根}/{userId}/{projectId}`），不是「来源有没有说」⇒ 缺键在语义上不成立，只能是写漏了；
 *   写漏的症状是**左栏一个会话都列不出来**（`LEARNINGS #002-02`）。⚠️ 它是**必给**键，
 *   `Schema.optional` 只是为了让上面那批「形状」用例不必每条都写它（同 `stale` 在别处的处置）。
 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  archived: Schema.optional(Schema.Boolean),
  role: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
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

/**
 * 建会话（**B 链**，`POST /api/session` ＋ 项目 **cookie**）——**照左栏/右栏那条 SDK 链的原样形状**
 * （`session-actions.ts` 的 `建会话`：`api.session.create({ location: { directory } })`，而那条链
 * **不发项目头**，靠 cookie 认项目）。
 */
const createV2SessionAs = (subject: TokenSubject, projectId: string, directory: string) =>
  Effect.gen(function* () {
    const response = yield* as(
      subject,
      "/api/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: { directory } }),
      },
      项目cookie(projectId),
    )
    expect(response.status).toBe(200)
    return (yield* json(Schema.Struct({ data: Schema.Struct({ id: Schema.String }) }), response)).data.id
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
 * 删掉某项目的**全部**成员行（**夹具**，T023）：构造「有 `project_ext` 行、却没有成员行」的分叉态。
 *
 * 与 `writeUserDb` 同一条理由：改的是**输入**（PG 里的成员关系），断言仍然读 HTTP 响应
 * （`LEARNINGS #002-02`：oracle 不经过被测对象）。真库没起来 ⇒ **抛**——搭错了不该静默变成
 * 「没这回事」（同 `writeUserDb` 的取法）。
 */
async function dropMemberRows(projectId: string): Promise<void> {
  if (!pg) throw new Error(`夹具要删成员行，但真库没起来：${projectId}`)
  await pg.db.execute(sql`delete from auth.project_member where project_id = ${projectId}`)
}

/**
 * 给某项目插**一行**成员关系（**夹具**，T023）：构造「库里剩下的那行**不是我的**」。
 *
 * 走生产的 `addMember`（T021 的邀请出口今天还不存在，同 `openhive-project-shared.test.ts` 的
 * `addMemberTo`）。与 `dropMemberRows` 同一条理由：写的是**输入**（PG 里的成员关系），
 * 断言读的仍是 HTTP 响应（`LEARNINGS #002-02`）；真库没起来 ⇒ **抛**，搭错了不该静默。
 */
async function addMemberRow(projectId: string, userId: string, role: string): Promise<void> {
  if (!pg) throw new Error(`夹具要插成员行，但真库没起来：${projectId}`)
  // Unix **秒**（`src/time.ts` 的 `nowSeconds()` 口径）——`addMember` 要求调用方给。
  await addMember(pg.db, { projectId, userId, role, timeCreated: Math.floor(Date.now() / 1000) })
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
   * **列表要给出这个项目的目录**（2026-10-08，左栏会话列表的取数前提）。
   *
   * 左栏的会话列表**按目录取数**（`ensureDirSyncContext(目录)`，与右栏同一个缓存槽），而它
   * 此前**问不出「当前项目的目录是什么」**——`ProjectEntry` 上没有这个字段，服务端只在中间件里
   * 现算。前端拿不到就只剩两条路：猜一个（错的时候**左栏列的是另一个目录的会话**，界面上看不出
   * 不对），或者干脆不列（功能永远接不上）。所以这个字段是**接口缺口**，不是锦上添花。
   *
   * ⚠️ 判据**不**写成「等于我重新算一遍的字符串」——那样两边一起漂也会绿。钉的是**中间件实际
   * 锚定的那个目录**：拿列表给的值去建会话，再**直接读库**看那条会话落在哪（oracle 不过被测对象，
   * `LEARNINGS #002-02`）。三者（列表给的 / 会话实际落的 / 沙箱根＋id）由此串成一条链。
   */
  it.live(
    "列项目出参带 directory，且等于中间件实际锚定的那个目录（左栏会话列表的取数前提）",
    () =>
      Effect.gen(function* () {
        const entry = yield* createAs(ALICE, { name: "目录出参", type: "private" })
        const listed = (yield* listAs(ALICE)).find((row) => row.id === entry.id)

        // 第一半：键在、且是绝对路径（缺键时下一条断言会读成 `undefined`，先把它钉成「有」）。
        expect(listed?.directory).toBeDefined()

        const sessionId = yield* createSessionAs(ALICE, entry.id)

        expect(canonical(listed?.directory ?? "")).toBe(canonical(sessionDirectory(ALICE.id, sessionId) ?? ""))
        // 第二半（与上面那条同款的重算，把「中间件锚点」与「沙箱布局」也串上）：三者必须同源。
        expect(canonical(listed?.directory ?? "")).toBe(canonical(path.join(sandboxOf(ALICE), entry.id)))
      }),
    30_000,
  )

  /**
   * **列表给的那个 `directory`，要能原样穿过会话列表那一道出口**（2026-10-09 补的另一半）。
   *
   * ## 上一条为什么拦不住这个缺陷
   *
   * 上一条断的是「列表给的值 ≙ 会话实际落的目录 ≙ 沙箱根＋id」，而**三处都过了 `canonical()`**
   * ——那一步把 8.3 短名、符号链接、大小写**全抹平**了。缺陷恰好长在被抹平的那一个维度上
   * （`LEARNINGS #003-05` 的假镜像：判据两侧一起归一化，就再也比不出「写法不同」这件事）。
   *
   * ## 缺陷的形状（左栏「一个会话都看不到」，2026-10-09 实测）
   *
   * 用户打的是**列表出口**，而列表出口**不做那层归一化**，它把两半拿来直接比：
   * - **过滤那一半**：`handlers/session.ts` 的 `ctx.query.directory ? yield* InstanceState.directory : undefined`
   *   ——客户端给的串**被丢掉**，用的是**实例层**的目录（`project/instance-store.ts` 里的 `FSUtil.resolve(...)`）；
   * - **存储那一半**：写进 `session.directory` 的是 `location.directory` **原样**
   *   （`packages/core/src/session.ts` 的 `directory: input.location.directory`），而那个值由中间件算成
   *   `projectDirectory(Config.root, …)`（`middleware/project-location.ts`）——**不过 `resolve`**。
   *
   * ⇒ 两侧只有在**该值是实例层归一化的不动点**时才相等。`OPENHIVE_WORKSPACE_ROOT` 不是它自己的
   * 规范化形式时（本机 `os.tmpdir()` 就是 `C:\Users\ADMINI~1\…`，8.3 短名；软链接根同理），
   * **存的是短名、比的是长名** ⇒ 列表回 0 行 ⇒ 左栏空白。而右栏打开同一场会话**一切正常**
   * （它按会话 id 直接读那一行，不比目录）⇒ 这缺陷**看起来像「没有会话」**，不像「目录写错了」。
   *
   * ## 判据（两条，都**不掺测试侧的归一化**）
   *
   * ① **端到端**：按左栏的形状取数（cookie 通道 ＋ `?directory=` ＋ `roots=true`，与
   *    `sidebar-sessions.tsx` → `client.session.list({ directory, roots: true })` 同形）⇒ 建的那场**在**。
   * ② **机制**：列表给的串 ≙ **实例层自己报的那个目录**——`GET /path` 的 `directory` 就是它
   *    （`handlers/instance.ts` 的 `getPath` 读 `InstanceState.context.directory`，与列表的过滤值
   *    **同一个来源**）。两个产品出口对同一个值给出同一个串，中间不掺 `canonical()`。
   */
  it.live(
    "列项目给的 directory 能列回该项目的会话（左栏「看不到会话」那条）",
    () =>
      Effect.gen(function* () {
        const entry = yield* createAs(ALICE, { name: "左栏会话可见性", type: "private" })
        const listed = (yield* listAs(ALICE)).find((row) => row.id === entry.id)
        expect(listed?.directory).toBeDefined()
        const 目录 = listed?.directory ?? ""

        // ① 端到端（**被测属性排在前面**，`LEARNINGS #004-14`：`expect` 一失败即中止用例体，
        // 书写顺序决定你读到哪一条证据——这条红了才读得到「会话列不出来」这个现象本身）。
        const sessionId = yield* createV2SessionAs(ALICE, entry.id, 目录)
        const rows = yield* json(
          Schema.Array(Schema.Struct({ id: Schema.String })),
          yield* as(ALICE, `/session?directory=${encodeURIComponent(目录)}&roots=true`, {}, 项目cookie(entry.id)),
        )
        expect(rows.map((row) => row.id)).toContain(sessionId)

        // ② 机制：列表给的串必须**就是**实例层算出来的那个目录（两个产品出口对上，见文件头判据）。
        const instance = yield* json(
          Schema.Struct({ directory: Schema.String }),
          yield* as(ALICE, "/path", {}, 项目cookie(entry.id)),
        )
        expect(instance.directory).toBe(目录)
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

describe("T023 · 列项目带 role（授权数据）", () => {
  /**
   * **主判据**：行上的 `role` 是**调用者自己**在那个项目里的角色（T018 建项目时落的 `owner` 行）。
   *
   * 为什么列表要带它、而不是让面板自己猜：名单取自**每用户库**的 `project_ext`，而今天那张表
   * **只有创建者会写**（T018 第 8 步）⇒「列表里每一行都是我建的」这个**巧合**让「每一行都能归档」
   * 看着也对。等到成员也拿到 `project_ext` 行的那天，巧合消失，面板上会多出一排点不动的「归档」
   * 且**不报错不变红**（`LEARNINGS #003-05`：镜像要写成能被惊醒的样子）。role 摊到列表上之后，
   * 「谁能归档」只剩 `ProjectMembership.decide` **一份**实现。
   *
   * 断言写成「过滤出这一行再比数组」而不是 `entries[0].role`：过滤后为空、为一行、为两行
   * 都读得出来（`Received: []` 一眼是「这一行根本没回来」），而 `[0]` 在行缺失时只是
   * `undefined`——那与「role 键没给」是**两件事**，混在一起就分不清该修哪一半。
   */
  it.live(
    "列项目：自己建的项目带 role: owner",
    () =>
      Effect.gen(function* () {
        const created = yield* createAs(BOB, { name: "我建的", type: "private" })

        expect((yield* listAs(BOB)).filter((entry) => entry.id === created.id).map((entry) => entry.role)).toEqual([
          "owner",
        ])
      }),
    30_000,
  )

  /**
   * **fail-closed**：没有成员行 ⇒ **没有 `role` 键**（不是 `"member"`、更不是 `"owner"`）。
   *
   * 这条判据守的是「**读不到就画不出**」。默认成任何角色，面板都会在一条**没有授权依据**的行上
   * 画出「归档」按钮——而 `decide(actor: 编出来的角色)` 恰恰会**放行**（`RULES.archive` 只问
   * `actor === "owner"`）。这与 `memberCount` / `archived` 的缺键是同一条口径：读的一侧不许替
   * 写的那一侧作证。
   *
   * 构造手法是**直接改库**（删成员行），与「同一毫秒」那条同一条理由：改的是**输入**
   * （PG 里的成员关系），断言仍然读 HTTP 响应（`LEARNINGS #002-02`）。
   *
   * ⚠️ **对照排在被测属性之前，这里是被时间顺序逼的**（`#004-14` 的例外）：删之前那次列表
   * 就是「机制是活的」的证明——少了它，删库那一步没生效（写错表名、连接打空）也会让最后那句绿
   * （`LEARNINGS #004-08`：副作用类判据必须先有一条对照）。
   */
  it.live(
    "没有成员行 ⇒ 列表里没有 role 键（fail-closed）",
    () =>
      Effect.gen(function* () {
        const created = yield* createAs(ALICE, { name: "没有成员行", type: "private" })

        // 对照（前置）：删之前这一行是带 role 的。
        expect(
          (yield* listAs(ALICE)).filter((entry) => entry.id === created.id).map((entry) => entry.role),
        ).toEqual(["owner"])

        yield* Effect.promise(() => dropMemberRows(created.id))

        const listed = (yield* listAs(ALICE)).filter((entry) => entry.id === created.id)
        // 断「键在不在」而不是「值是不是 undefined」：`Schema.optional` 的缺席是**键不在**
        // （同上面 `memberCount` / `archived` 那两条既有断言），断值会把两种情形混成一句。
        expect(listed.map((entry) => "role" in entry)).toEqual([false])
      }),
    30_000,
  )

  /**
   * **别人的成员行 ≠ 我的成员行**——`rolesOf` 里 `where user_id = ${input.userId}` 那一行。
   *
   * 为什么单开一条：上面那条把成员行**全删了**，于是「查全部成员再挑一个」这种写法
   * （`user_id` 过滤丢掉）会得到**同样的空结果** ⇒ 两条都绿（2026-10-07 席 A 审查指出）。
   * 要抓住它，库里得**剩一行属于别人**：只剩 BOB 的 `member` 行时，ALICE 必须**仍然没有
   * `role` 键**——她确实没有成员行。方向也正：丢了过滤是**多给**角色（面板画出「归档」按钮），
   * 与「宁可漏给不能多给」相反。
   *
   * ⚠️ 判据特意**不**写成「owner 拿到 owner、member 拿到 member」：那种写法要靠 SQL 的返回顺序
   * 才能决定变异红不红（`new Map()` 后写覆盖先写，PGlite 的返回顺序没有契约）——那是**不稳定的红**，
   * 不算数（`LEARNINGS #003-03`：凑不出「恰红」就不能记成恰红）。这里断的是**有没有这一行**，
   * 与顺序无关。
   *
   * 构造手法同上：改的是**输入**（PG 里的成员关系），断言读的仍是 HTTP 响应（`#002-02`）。
   */
  it.live(
    "别人是成员 ⇒ 不等于我是成员（没有我的成员行时列表里没有 role 键）",
    () =>
      Effect.gen(function* () {
        const created = yield* createAs(ALICE, { name: "别人的成员行", type: "private" })

        // 对照（前置）：换之前我这一行是带 role 的——机制是活的，最后那句才有意义
        // （`LEARNINGS #004-08`：副作用类判据必须先有一条对照）。
        expect(
          (yield* listAs(ALICE)).filter((entry) => entry.id === created.id).map((entry) => entry.role),
        ).toEqual(["owner"])

        // 把我那一行**换成 BOB 的**：库里从此还剩一行，且**不是我的**。
        yield* Effect.promise(() => dropMemberRows(created.id))
        yield* Effect.promise(() => addMemberRow(created.id, BOB.id, "member"))

        const listed = (yield* listAs(ALICE)).filter((entry) => entry.id === created.id)
        expect(listed.map((entry) => "role" in entry)).toEqual([false])
      }),
    30_000,
  )
})

/**
 * 建项目**中途失败**专用身份。**故意不给它 `auth.user` 行**——那正是下面那条注入点。
 *
 * ⚠️ 与 `CAROL` 是两个不同身份，别合并：CAROL 是「空库 ⇒ []」的对照，它得一直是「一次也不写」；
 * 这个身份**会**写（写在失败的那次建项目里）。也不用 ALICE / BOB——他们**有** `auth.user` 行，
 * 外键那条注入点在他们身上根本不成立。
 */
const DAVE: TokenSubject = { id: "880e8400-e29b-41d4-a716-446655440003", policeNo: "020604", name: "赵六", isAdmin: false }

/**
 * 补测（backend-testing · 真库/原子性）· **建项目中途失败 ⇒ 这个项目等于没建成**。
 *
 * ## 被钉的契约
 *
 * 住在 `packages/opencode/src/server/openhive/project.ts` 的文件头（第 7、8 步的次序）：
 * 「项目列表**只读 `project_ext`**，所以『这个项目可不可见』由第 ⑧ 步单独决定。把它放最后
 * ⇒ 中途任何一步失败，结果是**这个项目根本不出现在列表里**（等于没建成）」。那句话的判据形式是
 * **「可见性最后落，失败就退回『不存在』」**——T018 自己写在文件头，但**零用例**钉它
 * （2026-10-07 清点：全仓 `grep` 不到任何「建项目失败」的用例）。
 *
 * ## 怎么让它在「中途」失败（注入点 ＝ ① 之后、⑧ 之前）
 *
 * 第 ⑦ 步 `addMember` 往 `auth.project_member` 写 owner 行，而 `user_id` 那一列有外键
 * `→ auth.user(id)`（`0005_project_member.sql` 的 DDL 逐字）。所以**一个没有 `auth.user` 行的身份**
 * 发 `POST /openhive/project` 时：①–⑥ 全部成功（目录、git 仓库、上游 `project` 与
 * `project_directory` 两行都落了），第 ⑦ 步被外键当场拒 ⇒ 500。
 *
 * ⚠️ **这是人造注入，如实说明**：生产里登录就会落 `auth.user` 行，这个身份状态不会自然出现。
 * 选它恰恰因为它**确定**——真实的触发源（PG 抖一下 / 磁盘满）不可控，写不成一条稳定用例。
 * 本用例问的是**次序那条契约**（中途失败 ⇒ 不可见），不是「外键会不会拒」。
 *
 * ## 判据分两层，都读**副作用**（`#004-14`：被测属性排在伴随信号之前）
 *
 * 1. **前提证据**（`#004-08`：副作用类判据必须先证明机制是活的）：④ 的上游两行**在**
 *    ⇒ 建项目确实走到了 ⑧ 之前。少了这一条，一个畸形的 400 会看着和这里的 500 一模一样。
 * 2. **被测属性**：列项目**一条都没多**。
 * 3. 伴随信号（状态码）放最后：这是服务端故障，不是「请求被拒」。
 *
 * ## 本用例**不**断言的那一半（如实登记，别读成「已覆盖」）
 *
 * 物理残留**确实留下了**，本用例一个字都没说。2026-10-07 实测（`private` 那一支）：
 * 项目目录**在**、`.git` **在**、上游 `project` 一行 ＋ `project_directory` 一行（`directoryCount = 1`）
 * **在**、`project_member` **0 行**（⑦ 正是被拒的那一步）；`shared` 那一支还会多一个 bare 仓库。
 * 断言一个缺陷「按预期发生」等于把它写成规格（`#002-02` 的反面用法），所以这里只记不断。
 * 残留是 **X4-9** 那条已登记缺口（`state.md`），取舍见本次交付说明。
 */
describe("补测 · 建项目中途失败 ⇒ 项目不存在（真库原子性）", () => {
  it.live(
    "⑦ owner 行被外键拒 ⇒ 500，且列项目一条都没多",
    () =>
      Effect.gen(function* () {
        // 前提：这个身份还没有任何项目（这是它**自己**的性质——本文件里只有本用例用它）。
        const 前 = yield* listAs(DAVE)

        const response = yield* as(DAVE, PROJECT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "建到一半", type: "private" }),
        })

        // 前提证据（先证明机制是活的）：①–⑥ 落了上游两行 ⇒ 失败点确实在 ⑧ 之前。
        const 幽灵 = queryOne<{ id: string }>(DAVE.id, "SELECT id FROM project ORDER BY rowid LIMIT 1")
        if (幽灵 === undefined) throw new Error("建项目没走到 ④——注入点不是「中途」，本用例不成立")
        expect(directoryCount(DAVE.id, 幽灵.id)).toBe(1)

        // 被测属性：可见性（列表）**一条都没多**。
        const 后 = yield* listAs(DAVE)
        expect(后.map((entry) => entry.id)).toEqual(前.map((entry) => entry.id))
        // ⑧ 之后的正面证据：`project_ext` 一行都没有（列表唯一的数据源）。
        expect(extRow(DAVE.id, 幽灵.id)).toBeUndefined()

        // 伴随信号：服务端故障，不是「请求被拒」。
        expect(response.status).toBe(500)
      }),
    30_000,
  )
})
