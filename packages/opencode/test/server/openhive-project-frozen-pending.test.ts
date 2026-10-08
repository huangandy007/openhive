import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Fiber, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testProviderConfig } from "../lib/test-provider"
import { testEffect } from "../lib/effect"

/**
 * T025（FR-010）：**归档 = 冻结**在「会话身份不在 `params["sessionID"]` 里」的那类出口上的落地。
 *
 * ## 本条原本要做什么，以及取数把它改成了什么
 *
 * T015 两道门的入口都写作 `params["sessionID"]` 或 `x-openhive-project` 头。而
 * `POST /permission/:requestID/reply`（以及 `POST /question/:requestID/reply|reject`）
 * **两个都没有**：`requestID` 是**待审批请求**的 id，它与会话的关联只在**实例级内存的 pending map**
 * 里（`packages/opencode/src/permission/index.ts` 的 `InstanceState`）。于是 T025 立项时的设想是：
 * 归档之后**不带头**答复那条 pending ⇒ 实例目录是沙箱根 ⇒ `Permission.reply` 找得到它 ⇒
 * **审批被放行、工具开始跑**；对策是在这两个出口上挂端点级中间件（用 `Permission.list()` 拿
 * `requestID → sessionID`，已归档 ⇒ 403）。
 *
 * ⚠️ **2026-10-06 取数把那个设想否掉了**（真应用 ＋ 身份开；下面两条用例就是它的固化）。
 * 夹具：带项目头建一条 `{沙箱根}/{projectId}` 的项目会话 ⇒ **不带项目头**在它上面跑一轮提示词
 * （假模型发一次 `read`、目标是沙箱外的真实文件）⇒ `external_directory` 审批挂起 ⇒ 归档，
 * 然后按姿态逐条答复：
 *
 * | 答复姿态 | 实例目录 | 状态 | 审批被消费 | 那一轮继续 |
 * |---|---|---|---|---|
 * | 无头 | 沙箱根 | **404** `PermissionNotFoundError` | 否 | 否（模型只被调 1 次） |
 * | 诱饵头（本人名下的活跃项目） | `{沙箱根}/{诱饵}` | **404** `PermissionNotFoundError` | 否 | 否 |
 * | 真头（已归档的那个） | `{沙箱根}/{项目}` | **403**「项目已归档，请先找回」 | 否 | 否 |
 * | 解冻后 ＋ 真头 | `{沙箱根}/{项目}` | **200** | **是** | **是（第 2 次）** |
 *
 * 机理：`Permission` / `Question` 是 `InstanceState`（`ScopedCache` 按 `InstanceRef.directory` 分桶，
 * 见 `packages/opencode/src/effect/instance-state.ts`）⇒ **pending 只活在挂起时那个实例里**；
 * 而会话作用域路由的实例目录取自**会话行**（`middleware/workspace-routing.ts` 的
 * `session?.directory || defaultDirectory(...)`）。`/permission/:requestID/reply` 没有 `sessionID`
 * 路由参数 ⇒ 它的实例目录**只能是**锚定写的沙箱根；**能落到项目实例的唯一通道就是那个项目头**，
 * 而带头过去的第一件事就是撞第一道门（上表第三行）。
 * ⇒ 判据一句话：**答复必须落在挂起时的同一个实例里，而那个实例的门就在道上**。
 *
 * ## 所以这个 task 为什么**不加门**（2026-10-06 用户裁定：只钉属性、不加门）
 *
 * 端点级中间件会**在同一个实例里**调 `Permission.list()`，而跨项目的那条 pending **不在**这个实例里
 * ⇒ 列表恒为 `[]` ⇒ 永远匹配不到 requestID ⇒ **它是 no-op**（上表「无头」那一行的列表就是空的）。
 * 加它要动两个**上游** group 文件（`groups/permission.ts`、`groups/question.ts`）＋ 一份会漂的
 * 第二投影，换不到任何安全收益，还会在「有门守着」的账上多记一条**不会触发**的守卫
 * （`LEARNINGS #002-02`：没覆盖的要写成缺口，不写成已覆盖）。
 * 出参「已归档项目会话里挂起的工具审批**放行不了**」由上表**已经成立**，本文件的职责是把它**钉住**。
 *
 * ⚠️ `question` 的两个端点（`/question/:requestID/reply|reject`）是**同一形状的服务与同一套实例
 * 口径**（`packages/opencode/src/question/index.ts` 同样走 `InstanceState`）——但**那是推断，不是
 * 实测**（`LEARNINGS #004-13`：成立与不成立都要验）。本文件只钉 permission 这一条；question 那半
 * 按缺口记在 `docs/superpowers/specs/005-project-management/state.md`。
 *
 * ## 两条用例各钉什么（`LEARNINGS #004-14`：一条用例里先把断言次序排好）
 *
 * - 用例 ①（主）：项目会话 ＋ 归档。三条**够不着**的姿态（无头 404 ／ 诱饵头 404 ／ 真头 403）是
 *   **伴随信号**——它们说明「**为什么**没放行」；**被测属性**是「那条审批**没被消费**」，由
 *   「解冻后用真头列出来它还在」钉死（归档后真头列表被第一道门挡成 403，观测面只能这样打开）。
 *   末尾那条「解冻 ＋ 真头 ⇒ 200 ⇒ 被消费 ⇒ 那一轮继续」是**对照**：它证明路由与机制都是活的，
 *   前面那些 404/403 **不是**「这条路由本来就不通」。
 * - 用例 ②（对照）：**不带项目头**建一条会话（会话行目录 ＝ 沙箱根）⇒ pending 落在**沙箱根实例**
 *   ⇒ **无头答复 200**、被消费、那一轮继续。它把「无头答复」这条通道单独证明一遍 ⇒ 用例 ① 那个
 *   404 的成因**只能是**「那条 pending 不在这个实例里」。
 *
 * ⚠️ 两条用例共用同一个用户（沙箱根实例是同一个），所以识别一律按**会话 id** 过滤
 * （`sessionID` 就在 `PermissionV1.Request` 里）；`permission` 字段断成 `external_directory`，
 * 证明「找到的就是我造的那一条」，不是别的耦合残留（`#003-05`：别把镜像写成看起来像）。
 *
 * ## ⚠️ 并发与 `42P05`：本条夹具**不能**边等边轮询（2026-10-06 实测，别改回去）
 *
 * 本条第一版是「fork 那一轮 ＋ 每 100ms 发一次 `GET /permission`（带真头）」，**稳定假红**：
 * 那一轮在 **15ms** 内回 **500 `UnknownError`**，模型一次都没被调用。抓到的真因（用
 * `Context.add(HttpApiApp.context, Logger.CurrentLoggers, …)` 把 app 的 `Effect.logError` 捞出来）是
 * `PostgresError 42P05 duplicate_prepared_statement`，**落点是第一道门的 `isArchived`**。
 *
 * 为什么：**PGlite 的预编译语句名是「实例级」的**——socket 服务端把多条连接汇进**同一个 PG 会话**
 * （`packages/opencode/src/server/openhive/pg.ts` 的文件头记着同一枚错，那里是「两个客户端」的
 * 版本）。本条造出的是**同一个客户端的两个并发请求**：被 fork 的那一轮（**第二道门** ⇒ `isArchived`）
 * 与轮询的第一次 `GET /permission`（**第一道门** ⇒ 同一句 SQL）**同时**准备 ⇒ 第二个被 PG 拒。
 *
 * ⇒ **这是夹具的形状问题，不是被测对象的问题**：生产的池是多连接（`packages/auth/src/db.ts`：
 * `connect` 走 `drizzle({connection:{url,…}})`，既有注释还写着「只落在池里那一条连接上，其余连接
 * 照旧」），并发请求各走各的会话，不会互相撞语句名。**症状却长得像「门在并发下崩了」**——
 * 这正是 `LEARNINGS #003-01` 的同一课：**先怀疑测量，再怀疑被测物**。
 *
 * 夹具的写法因此是：**先在进程内等**（`等模型开口`：假模型看到那一轮 ⇒ 说明门已经过去了，这一路
 * **一个 HTTP 请求都不发**），**再**去列 pending。轮询期间那一轮已经阻塞在 `Permission.ask` 上，
 * 它那条请求**不会再碰门** ⇒ 并发窗口消失。**别把它改回紧轮询**。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }

/**
 * 客户端报「当前项目」的通道。**写死字面量、不 import 生产常量**（同 `openhive-project-frozen.test.ts`：
 * import 过来就成了「生产改什么测试跟着改什么」，改名也测不出来，`LEARNINGS #003-05` 的假镜像）。
 */
const PROJECT_HEADER = "x-openhive-project"

/** 已归档的那一个。 */
const FROZEN = "prj_pending_0001"
/** 诱饵头指向的那一个：**活跃**，且是本人名下的真项目 ⇒ 第一道门按它放行（T015 用例 ⑧ 同形）。 */
const ACTIVE = "prj_pending_0002"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-project-pending-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/**
 * 沙箱**外面**的一个真实文件：待审批的 `read` 工具读它。
 *
 * 为什么非要外面：`read.ts` 在真正读之前先 `assertExternalDirectoryEffect`——目标落在实例目录
 * 之外时，它 `ctx.ask({permission: "external_directory"})`，而默认规则集里
 * `external_directory` 是 `{"*": "ask"}`（`agent/agent.ts` 的 `defaults`）⇒ **挂起等人答**。
 * 沙箱里面的路径不会触发它（`containsPath` 直接放过）。
 *
 * ⚠️ 它**必须真的存在**：审批放行之后工具要读得成，那一轮才走得到「把工具结果回给模型」那一步
 * （第二次模型调用＝对照里那条端到端判据）。文件不存在时工具会回一个 not-found——本轮**也许**
 * 照样继续（那是上游的事），判据就变成「看运气」了。
 */
const OUTSIDE = mkdtempSync(path.join(tmpdir(), "openhive-project-pending-outside-"))
const OUTSIDE_FILE = path.join(OUTSIDE, "outside.txt")

const sandboxOf = (subject: TokenSubject) => path.join(WORKSPACE_ROOT, subject.id)

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是
 * `dataRoot(process.env)`，不是 Effect 的 `Config` 服务；塞 `ConfigProvider` 会被无声忽略）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  for (const dir of [SANDBOX, OUTSIDE]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
  }
})

/* ------------------------------------------------------------------ 假模型 */

const MARK_FROZEN = "openhive-pending-marker-frozen-4f19"
const MARK_ROOT = "openhive-pending-marker-root-9c02"

const llmBodies: string[] = []
let llmServer: ReturnType<typeof Bun.serve> | undefined
let llmUrl = ""

/**
 * 这个请求是不是**会话标题生成器**那一轮（上游在首次提示词后另起的一次小调用）。
 *
 * ⚠️ 它**也会带着用户的正文**（标题要从正文里生成），所以「体里有 marker」**不足以**认出
 * 「这是被测那一轮」——把工具调用发在标题那一轮上，真正的那一轮就什么都不会发生，pending
 * 永远不出现（本条夹具第一版就是这么假红的，2026-10-06 实测）。
 */
const 是标题生成 = (body: string) => body.includes("title generator")

/** 某个探针正文在几条**真实**模型请求里（两条：被测那一轮 ＋ 工具结果回填那一轮）。 */
const 模型调用次数 = (marker: string) => llmBodies.filter((body) => body.includes(marker) && !是标题生成(body)).length

const line = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: Record<string, unknown>, finish?: string) => ({
  id: "chatcmpl-test",
  object: "chat.completion.chunk",
  choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
})

/** 纯文本一轮：`role` → 正文 → `stop`（照 `test/lib/llm-server.ts` 的形状）。 */
const textSSE = (value: string) =>
  [line(chunk({ role: "assistant" })), line(chunk({ content: value })), line(chunk({}, "stop")), "data: [DONE]\n\n"].join(
    "",
  )

/** 一次工具调用：`role` → 起 call → 参数 → `tool_calls` 收尾（同上，`Reply.tool()` 的形状）。 */
const toolSSE = (name: string, input: unknown) =>
  [
    line(chunk({ role: "assistant" })),
    line(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "" } }] })),
    line(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(input) } }] })),
    line(chunk({}, "tool_calls")),
    "data: [DONE]\n\n",
  ].join("")

/** 每个探针正文只发**一次**工具调用；它之后再来的请求（工具结果回填那一轮）给纯文本。 */
const seen = new Map<string, number>()
const markOf = (body: string) => [MARK_FROZEN, MARK_ROOT].find((marker) => body.includes(marker))

beforeAll(() => {
  llmServer = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = await request.text()
      llmBodies.push(body)
      const marker = markOf(body)
      // 用 `if` 而不是把判断存进布尔变量：`marker !== undefined` 写在同一条件里，
      // TS 才会在体内把 marker 窄化成 `string`（否则每个用法都得补 `!`，而那正是 3 条 lint 警告的来源）。
      let round = 0
      if (marker !== undefined && !是标题生成(body)) {
        round = (seen.get(marker) ?? 0) + 1
        seen.set(marker, round)
      }
      const sse = round === 1 ? toolSSE("read", { filePath: OUTSIDE_FILE }) : textSSE("done")
      return new Response(sse, { headers: { "content-type": "text/event-stream" } })
    },
  })
  llmUrl = `http://127.0.0.1:${llmServer.port}`
})

afterAll(async () => {
  await llmServer?.stop(true)
})

/* ------------------------------------------------------------------ 用户环境 */

/** 真 auth 库（文件级夹具，理由同 `openhive-project-frozen.test.ts`：门开着时建会话要查授权）。 */
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

/** B 链建会话的线上形状（包了 `data`）。 */
const SessionV2 = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
/** 403 的线上形状（两道门同一个口径）。断文案，不只断状态码。 */
const Frozen = Schema.Struct({ error: Schema.String })
const FROZEN_MESSAGE = "项目已归档，请先找回"
/** 够不着那条 pending 时 handler 的口径（`PermissionV1.NotFoundError`）。 */
const NotFound = Schema.Struct({ _tag: Schema.String, requestID: Schema.String })
const NOT_FOUND_TAG = "PermissionNotFoundError"
/**
 * 待审批请求的线上形状——**只取本条要用的两格**。
 *
 * `sessionID` 是「requestID → 会话」那条关联的**唯一**来源；`permission` 用来把「找到的那一条」
 * 钉成夹具自己造的那一种。
 */
const PendingPermission = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  permission: Schema.String,
})
const PendingPermissions = Schema.Array(PendingPermission)

/** 某个用户的库文件。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/**
 * 归一化：断言钉的是**归属**，不是路径的书写形式（同 `openhive-project-frozen.test.ts` 的同名助手）。
 * 库里的 `session.directory` 是**正斜杠**（上游写进去的就是这个形状），`path.join` 出来的在 win32
 * 是反斜杠——不归一化的话这条夹具前置会假红。
 */
const canonical = (value: string) =>
  (() => {
    try {
      return realpathSync.native(value)
    } catch {
      return value
    }
  })()
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .toLowerCase()

/** 某条会话落在哪个目录（**直接读库文件**，不走产品接口）。 */
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

/** 把假 provider 写进某个目录的 `opencode.json`（实例配置从**实例目录**读，目录就是落点）。 */
function writeProviderConfigInto(directory: string) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...testProviderConfig(llmUrl) }),
  )
}

/** 造一个「项目已存在」的用户（同 `openhive-project-frozen.test.ts` 的同名助手）。 */
const withProject = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    // 假 provider 必须在**任何请求之前**落盘：实例的配置是**第一次请求时读一次并常驻**的
    // （`InstanceStore.load` 按目录缓存实例），第一个请求（下面那句 `/session`）就会把
    // 沙箱根实例建起来 ⇒ 之后再写 `opencode.json` 已读不到（2026-10-09 实测：`GET /config`
    // 不含 `test-model` ⇒ 那一轮 500 `ProviderModelNotFoundError`）。
    writeProviderConfigInto(sandboxOf(subject))
    writeProviderConfigInto(path.join(sandboxOf(subject), projectId))
    yield* as(subject, "/session", { method: "POST" })
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
    // ⚠️ 这两份写在**函数开头**（见那里的注释）：少写一份不会红成「判据不成立」，而是红成
    // 「那一轮根本没起来」（配置读不到 ⇒ 模型没被调用）——`#002-02` 那类「看着像被测对象坏了」的
    // 假红，夹具自己先堵死。
  })

/** **夹具注入**一行「已归档」（同 `openhive-project-frozen.test.ts` 的同名助手，理由见那里）。 */
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
 * 复核用：把归档行删掉（夹具注入的逆操作）。
 *
 * ⚠️ 它存在的**唯一**原因是观测面：归档之后**带真头**列 pending 会被第一道门挡成 403
 * （用例 ① 第三行那条），而那条 pending 只在这个实例里看得见 ⇒ 想断言「它**还在**」，
 * 就只能先把归档行撤掉。这不是绕过被测的门，是**打开观测面**（`LEARNINGS #004-09`：
 * 顺序/存留这类判据只有在门之前或是在门之外才测得出来）。
 */
const 取消归档 = (projectId: string) =>
  Effect.promise(() =>
    Promise.resolve(pg!.db.execute(sql`delete from auth.project_archive where project_id = ${projectId}`)),
  )

/* ------------------------------------------------------------------ 被测流程 */

/**
 * B 链建会话（目录读**请求体**）。
 *
 * - 带项目头 ⇒ 会话行落在 `{沙箱根}/{projectId}`（`middleware/project-location.ts` 那条）；
 * - **不带** ⇒ 落在沙箱根（锚定写的那个），这正是用例 ② 要的形状。
 */
const 建会话 = (subject: TokenSubject, projectId?: string) =>
  as(subject, "/api/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(projectId === undefined ? {} : { [PROJECT_HEADER]: projectId }),
    },
    body: JSON.stringify({ location: {} }),
  })

/**
 * 在一条会话上跑一轮提示词——**不带项目头**（A 链 `POST /session/:id/message`）。
 *
 * 假模型回一次 `read` 工具调用，目标是沙箱**外面**的文件 ⇒ `external_directory` 审批挂起
 * ⇒ 这个请求**一直不返回**（`Permission.ask` 阻塞在 `Deferred.await`），所以调用方必须 fork 它。
 *
 * ⚠️ 不带头**不是笔误**：这一轮的实例目录由**会话行**决定（`workspace-routing.ts` 的
 * `session?.directory`），头在这里不参与；带头反而会多撞一次第一道门。
 */
const 触发审批 = (subject: TokenSubject, sessionID: string, marker: string) =>
  as(subject, `/session/${sessionID}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: "build",
      model: { providerID: "test", modelID: "test-model" },
      parts: [{ type: "text", text: marker }],
    }),
  })

/**
 * 等到**那一轮已经越过门、走到模型**——判据在**进程内**（假模型看到的请求数），**一个 HTTP 请求
 * 都不发**。
 *
 * ⚠️ 这一条不是优化，是**夹具必须**：文件头「并发与 `42P05`」那一节记着，边等边轮询会让两个请求
 * 同时准备同一句 SQL（PGlite 的语句名是实例级的）⇒ 那一轮当场 500，看着像门崩了。
 * 反过来说，它顺带把「那一轮到底起没起来」断成了**夹具的**判据：等不到 ⇒ 红在夹具，不红在门。
 */
const 等模型开口 = (marker: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (模型调用次数(marker) >= 1) return true
      yield* Effect.sleep(100)
    }
    return false
  })

/**
 * 挂在**哪个实例**里的、属于某条会话的那条待审批请求（`GET /permission`，v1 实例出口）。
 *
 * `projectId` 决定**实例目录**：不带 ⇒ 沙箱根实例；带上 ⇒ `{沙箱根}/{projectId}`。
 * 按**会话 id** 过滤：两条用例共用同一个用户，列表里可能有别人留下的条目。
 */
const 挂起的审批 = (subject: TokenSubject, sessionID: string, projectId?: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/permission", {
      headers: projectId === undefined ? {} : { [PROJECT_HEADER]: projectId },
    })
    expect(response.status).toBe(200)
    const list = yield* json(PendingPermissions, response)
    return list.find((item) => item.sessionID === sessionID)
  })

/**
 * 等那条 pending 出现。**先**在进程内等那一轮越过门（`等模型开口`），**再**开始发列表请求——
 * 那之后那一轮已经阻塞在 `Permission.ask` 上，不会再碰门（文件头「并发与 `42P05`」）。
 */
const 等审批出现 = (subject: TokenSubject, sessionID: string, projectId: string | undefined, marker: string) =>
  Effect.gen(function* () {
    expect(yield* 等模型开口(marker)).toBe(true)
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = yield* 挂起的审批(subject, sessionID, projectId)
      if (found) return found
      yield* Effect.sleep(200)
    }
    return undefined
  })

/** 等模型被第 N 次调用（判据是异步到达的，等到位再读一次，别和竞态比速度）。 */
const 等模型调用 = (marker: string, 目标: number) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (模型调用次数(marker) >= 目标) break
      yield* Effect.sleep(100)
    }
    return 模型调用次数(marker)
  })

/**
 * 答复那条待审批请求。
 *
 * `projectId` 同样决定实例目录——**这就是本条要试的那个变量**：答复**能不能找到**那条 pending，
 * 全看这里与「挂起时所在的实例」对不对得上。
 */
const 答复审批 = (subject: TokenSubject, requestID: string, projectId?: string) =>
  as(subject, `/permission/${requestID}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(projectId === undefined ? {} : { [PROJECT_HEADER]: projectId }),
    },
    body: JSON.stringify({ reply: "once" }),
  })

/* ------------------------------------------------------------------ 用例 */

describe("T025 · 归档 = 冻结（FR-010）：会话身份不在 URL 参数里的出口（待审批请求）", () => {
  /**
   * **主判据**：已归档项目的会话里挂着的工具审批——**答复替用户放行不了**。
   *
   * 断言次序照 `LEARNINGS #004-14`：先三条**伴随信号**（够不着的三种姿态，它们说明「为什么」），
   * 再**被测属性**（那条审批没被消费），最后**对照**（解冻 ＋ 真头 ⇒ 200 ＋ 被消费 ＋ 那一轮继续）。
   *
   * ⚠️ 前置那几段（建会话 ⇒ 触发 ⇒ 等到审批）**不是判据**，是夹具：它们红了说明这一轮根本没跑起来
   * （配置读不到 / 工具没被调用 / 假模型形状不对），与被测的门无关——所以每一步都断死，别让它们
   * 退化成「跑过了就好」。
   */
  it.live(
    "已归档项目：答复那条待审批请求放行不了（无头 404 ／ 诱饵头 404 ／ 真头 403），审批没被消费",
    () =>
      Effect.gen(function* () {
        yield* withProject(ALICE, FROZEN)
        yield* withProject(ALICE, ACTIVE)

        const created = yield* 建会话(ALICE, FROZEN)
        expect(created.status).toBe(200)
        const { data: session } = yield* json(SessionV2, created)
        // 会话行确实落在项目目录里（这条旁路的前提；落没落盘直接读库文件，不走产品接口）。
        expect(canonical(sessionDirectory(ALICE.id, session.id) ?? "")).toBe(
          canonical(path.join(sandboxOf(ALICE), FROZEN)),
        )

        // 不带项目头地跑一轮 ⇒ `read` 要读沙箱外的文件 ⇒ 审批挂起、这一轮不返回。
        const 那一轮 = yield* Effect.forkChild(触发审批(ALICE, session.id, MARK_FROZEN))
        // pending 落在**项目实例**里（会话行说了算）⇒ 只有带真头才列得到它——这本身就是机理的一半。
        const 审批 = yield* 等审批出现(ALICE, session.id, FROZEN, MARK_FROZEN)
        expect(审批).toBeDefined()
        if (!审批) return
        expect(审批.permission).toBe("external_directory")
        // 对照的起点：这一刻模型只被调过 1 次（工具还没跑完）。
        expect(模型调用次数(MARK_FROZEN)).toBe(1)

        yield* 标成已归档(FROZEN)

        // ① 无头：实例目录＝沙箱根 ⇒ 这条 pending 不在这个实例里 ⇒ handler 找不到它。
        //    ⚠️ **状态码在前、正文字段在后**：放行成功时 body 是 `true`（`Permission.reply` 的成功体），
        //    先解 `NotFound` 会把红化成一句 `SchemaError: Expected object, got true`——读不出「放行了」。
        //    变异验证（2026-10-06，把 pending 拉成模块级）正是这么红的，故调序（`LEARNINGS #004-14`）。
        const 无头 = yield* 答复审批(ALICE, 审批.id)
        expect(无头.status).toBe(404)
        expect((yield* json(NotFound, 无头))._tag).toBe(NOT_FOUND_TAG)

        // ② 诱饵头：指向本人名下的**活跃**项目 ⇒ 第一道门按它放行、实例目录推到那一层
        //    ⇒ 仍然不是挂起时的那个实例（T015 用例 ⑧ 的诱饵在这个出口上同样解不开）。
        const 诱饵 = yield* 答复审批(ALICE, 审批.id, ACTIVE)
        expect(诱饵.status).toBe(404)
        expect((yield* json(NotFound, 诱饵))._tag).toBe(NOT_FOUND_TAG)

        // ③ 真头：唯一能落到那个实例的通道 ⇒ 第一道门「已归档」拦下。
        const 真头 = yield* 答复审批(ALICE, 审批.id, FROZEN)
        expect(真头.status).toBe(403)
        expect((yield* json(Frozen, 真头)).error).toBe(FROZEN_MESSAGE)

        // ④ 端到端那一半：三次答复之后那一轮**没有**继续（模型没有被第 2 次调用）。
        expect(yield* 等模型调用(MARK_FROZEN, 2)).toBe(1)

        // ⑤ **被测属性**：那条审批**没被消费**。归档之后真头列表是 403，观测面只能这样打开。
        yield* 取消归档(FROZEN)
        expect((yield* 挂起的审批(ALICE, session.id, FROZEN))?.id).toBe(审批.id)

        // ⑥ **对照**：把「已归档」这一个变量拿掉，同一条答复（真头）⇒ 200、被消费、那一轮真的继续。
        //    少了它，上面那三个 404/403 可能只是「这条路由本来就不通」（`#004-08`）。
        const 解冻后 = yield* 答复审批(ALICE, 审批.id, FROZEN)
        expect(解冻后.status).toBe(200)
        expect(yield* 等模型调用(MARK_FROZEN, 2)).toBe(2)
        expect(yield* 挂起的审批(ALICE, session.id, FROZEN)).toBeUndefined()

        yield* Fiber.interrupt(那一轮)
      }),
    120_000,
  )

  /**
   * **对照（通道本身是活的）**：**不带项目头**建一条会话 ⇒ 会话行目录 ＝ 沙箱根 ⇒ pending 落在
   * **沙箱根实例** ⇒ 同一条无头答复 **200**、被消费、那一轮继续。
   *
   * 它把「无头答复」这条通道单独证明一遍：用例 ① 那个 404 的成因**只能是**「那条 pending 不在这个
   * 实例里」，不是「无头答复本来就不通」、也不是「requestID 打错了」——**看着一样红**（`#004-08`）。
   *
   * ⚠️ 这条用例**一处门都碰不到**（没有项目头 ⇒ 没有第一道门；会话目录是沙箱根 ⇒ 第二道门算不出
   * 项目 id）⇒ 它**天生**没有文件头那节讲的并发窗口。用它当对照反而更干净。
   */
  it.live(
    "对照：pending 落在沙箱根实例时，同一条无头答复 200 ⇒ 被消费，那一轮继续",
    () =>
      Effect.gen(function* () {
        // 这一条**不需要**项目：它要的正是「没有项目」的那个实例。
        yield* withProject(ALICE, FROZEN)

        const created = yield* 建会话(ALICE)
        expect(created.status).toBe(200)
        const { data: session } = yield* json(SessionV2, created)
        expect(canonical(sessionDirectory(ALICE.id, session.id) ?? "")).toBe(canonical(sandboxOf(ALICE)))

        const 那一轮 = yield* Effect.forkChild(触发审批(ALICE, session.id, MARK_ROOT))
        // 无头列表就能看见它——与用例 ① 的「只有带真头才看得见」正好相反。
        const 审批 = yield* 等审批出现(ALICE, session.id, undefined, MARK_ROOT)
        expect(审批).toBeDefined()
        if (!审批) return
        expect(审批.permission).toBe("external_directory")
        expect(模型调用次数(MARK_ROOT)).toBe(1)

        const 答复 = yield* 答复审批(ALICE, 审批.id)

        // ① 被测属性（对照侧）＝**机制是活的**：无头答复被接受。
        expect(答复.status).toBe(200)
        // ② 那一轮真的继续了（工具跑完、结果回给模型）。
        expect(yield* 等模型调用(MARK_ROOT, 2)).toBe(2)
        // ③ 审批被消费掉——与用例 ① 同一条判据、相反取值。
        expect(yield* 挂起的审批(ALICE, session.id)).toBeUndefined()

        expect((yield* Fiber.join(那一轮)).status).toBe(200)
      }),
    120_000,
  )
})
