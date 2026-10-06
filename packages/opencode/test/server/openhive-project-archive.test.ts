import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { nowSeconds } from "@opencode-ai/auth/time"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { type FakeS3, startFakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"
// 出口路径那两个常量**刻意不 import 生产源码**（`#003-05`：契约要写字面量），
// 而 `endpointOf` 是**被测对象本身**（一个纯函数）⇒ 只能 import，同 `Minio` 那些测试的做法。
import { endpointOf } from "../../src/server/openhive/archive"

/**
 * T013（FR-008）：**项目归档**——上传 MinIO ＋ 删沙箱 ＋ `archived=1`。
 *
 * ## 这一条到底钉的是什么（Q1×Q3 裁定的 (c)）
 *
 * 「owner 归档时**成员的**沙箱文件怎么办」由用户 2026-10-06 裁定取 **(c) 服务端替全体成员各跑一遍**：
 * 服务端对该项目**每个成员**的沙箱各跑「上传到**该成员自己的** MinIO 前缀 ＋ 删该成员沙箱」。
 * 所以本文件的主判据不是「传上去了」，而是**「谁的东西进了谁的前缀」**——把这条写错
 * （收进一个共享前缀、或把 owner 那份复制给所有人）**不会报错、不会变红**，只会让成员找回时
 * 拿到别人的文件。判据因此写成**逐键全等**（多一个键也红），不是「包含某几个键」。
 *
 * ## harness 与 `openhive-project.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入），故整套约法照抄、只换判据点：
 * `OPENHIVE_DATA_ROOT` 只能走 `process.env`、身份走 cookie 不走自造头、
 * **`ConfigProvider` 递的 env 对 Effect 配置服务生效**（`OPENHIVE_WORKSPACE_ROOT` 与
 * `OPENHIVE_MINIO_*` 都走这条）。
 *
 * ## 观测面：**真 S3 端点**，不是替身
 *
 * 归档的被测对象是**归档流程**，MinIO 是它的**边界** ⇒ 换掉 MinIO 是边界替身（`minio.md` §3 的
 * 原意）。但换的方式不是「注一个假接口」，而是 `@opencode-ai/core/test-support/fake-s3`
 * 那个**真 HTTP 端点**——真 `@aws-sdk/client-s3` 真签名真发请求，于是「哪个键、什么内容」
 * 全部**可断言**（`LEARNINGS #002-02`：替身替边界，不替被测对象）。
 *
 * ## oracle 一律不经过被测对象
 *
 * - 落进 MinIO 的东西：**读夹具自己记下的到达请求**（`fakeS3.requests`），不经 `Minio.Interface.get`；
 * - 归档行：**直接在 `pg.db` 上写 SQL**，不经 `archiveStatesOf`；
 * - 沙箱目录：`existsSync`。
 *
 * ## ⚠️ 一个文件**只建一个 app**（2026-10-06 说到根因：**新 app 的第一条 PG 查询**）
 *
 * 起因：「MinIO 没配 ⇒ 503」那条需要第二份 `OPENHIVE_MINIO_*`，于是本文件里 `realApp()` 被调了两次。
 * 实测：**第二个 app 的归档路由会在「读成员」那一步回 500**（defect，回体是
 * `{"name":"UnknownError",…,"ref":"err_…"}`，`disableLogger: true` 不打印真因）。
 *
 * 探针查到的（2026-10-06，本机，三种跑法结论一致）：
 * - 与 MinIO 配没配**无关**——探针打印的 `deps.minio` 与配置逐一对得上，且授权检查排在 MinIO 之前；
 * - 与「是第几个 app」**也无关**：先建两个 app、**先用第二个** ⇒ 第二个绿、第一个 500；再建第三个
 *   ⇒ 照样 500。**除进程里的第一条 HTTP 请求外，任何新 app 的第一条 PG 查询都会撞上一次**
 *   （同一 app 的下一条请求即正常，**自愈**）；
 * - 真因是那条查询自己：`DrizzleQueryError` → cause **`PostgresError: Connection closed`**，
 *   耗时 **3–11ms**（**不是** 3 秒连接超时）；
 * - 裸连接池连开三条、各自首查**全通** ⇒ 不是连接数、不是 `PG_*` 配错、不是 DB 层本身。
 *
 * ⚠️ **不能写成「生产不存在这个场景」**（我原稿那句被读码证伪，2026-10-06 三席评审 S3-02）：
 * `server.ts` 的 `listenerLayer` 对**每个 listener** 调一次 `HttpApiApp.createRoutes()`，而
 * `handler(request, HttpApiApp.context)` 与 `Effect.provide(HttpApiApp.context)` 用的是**同一份
 * 模块级** `context`（`Context.makeUnsafe(new Map())`）⇒ 同一进程多次 `listen()` **共用它**。
 * 所以这是**可能生产可达**的一条，只是本 feature 的判据不需要第二个 listener。
 *
 * ⚠️「**为什么第一条连接会被关掉**」仍未查到底（Bun SQL 池 × PGLite socket 这一带）——
 * 已挂 `state.md` 的 T013 缺口表（`#002-02`：没查清的要写成缺口，不能写成「没问题」）。
 * 处置：那条 503 用例搬进 `openhive-project-archive-unconfigured.test.ts`（`#004-12`：同族接缝
 * 测试的手段整段搬、按需要分文件），在那儿它是**唯一**的 app。
 * 顺带一条运维提示：**本文件某条用例如若莫名其妙回 500**，先看是不是这条——而不是先去改归档逻辑。
 *
 * ## 「未挂载」在本应用里**不是 404**
 *
 * 同族实测（`openhive-project.test.ts` 文件头那张表）：没被路由接管的路径落进 SPA 兜底，
 * 回 **200 ＋ `text/html`**。⇒ 本文件的 `json()` 把判据前移到 **`Content-Type`**，
 * 状态码只当伴随信号（`LEARNINGS #004-14`）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }
/** 第三个身份：本文件里**一个项目都不建、也不加进任何项目**——「非成员」那条专用。 */
const CAROL: TokenSubject = { id: "770e8400-e29b-41d4-a716-446655440002", policeNo: "020603", name: "王五", isAdmin: false }

/** 出口路径（**客户端契约**，写**字面量**、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const ARCHIVE_PATH = "/openhive/project/archive"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-archive-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，
 * 不是 Effect 的 `Config` 服务）——塞 `ConfigProvider` 会被**无声忽略**（同族测试的同款注释）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上（T020 起）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

/**
 * 假 S3 与 `openApp` 的构造**次序是要求不是巧合**：配置服务在**层构造期**取值
 * （`HttpRouter.use` 的 `Effect.gen` 里 `yield*`），所以 `OPEN` 必须在 `realApp(OPEN)` 之前
 * 就有 endpoint。放在模块顶（`Bun.serve({port:0})` 让 OS 挑空闲端口，`#002-05` 的要点①）。
 */
const s3: FakeS3 = startFakeS3()

afterAll(restoreDefaultPassword)

afterAll(() => {
  s3.stop()
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
  // `project_member.user_id` 有外键 ⇒ 会被加进项目的身份必须先有 `auth.user` 行。
  // CAROL 也插：她不做成员，但「非成员」那条要拿她当**有身份的外人**（无身份是 401，另一回事）。
  for (const subject of [ALICE, BOB, CAROL]) {
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

/** MinIO 那一组走 `minio.md` §4 的 env；endpoint 按该表是 **`host:port`**（协议由 `USE_SSL` 定）。 */
const MINIO = {
  OPENHIVE_MINIO_ENDPOINT: new URL(s3.endpoint).host,
  OPENHIVE_MINIO_BUCKET: s3.bucket,
  OPENHIVE_MINIO_ACCESS_KEY: "test-access-key",
  OPENHIVE_MINIO_SECRET_KEY: "test-secret-key",
} as const

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
  ...MINIO,
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

type App = ReturnType<typeof realApp>

const openApp = realApp(OPEN)

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 读 JSON 体。**过一遍 `Schema` 而不是 `as`**（`Response.json()` 是 `any`，`as` 会被 oxlint 拦）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    // ⚠️ **先断内容类型，不能只断状态码**——见文件头「未挂载 ≠ 404」。
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/**
 * 以某人的身份、对**指定的应用**发一个请求。
 *
 * 应用是参数（不是闭包里那个 `openApp`）：不同的 `OPENHIVE_MINIO_*` 组合要**建第二个 app**，
 * 而那种用例（「MinIO 没配 ⇒ 503」）**住在另一个文件里**——理由见本文件头「一个文件只建一个 app」。
 */

const as = (app: App, subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* app(url, { ...init, headers })
  })

/** 列表项的**线上形状**（逐字写字段名，当**客户端契约**钉死——`#003-05`）。 */
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
    const response = yield* as(openApp, subject, PROJECT_PATH, {
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
    const response = yield* as(openApp, subject, PROJECT_PATH)
    expect(response.status).toBe(200)
    return yield* json(Schema.Array(Entry), response)
  })

/** `POST /openhive/project/archive` —— 归档。**回体不解析**（失败那条没有 `Content-Type` 契约）。 */
const archiveAs = (app: App, subject: TokenSubject, body: unknown) =>
  as(app, subject, ARCHIVE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/**
 * 「归档这个出口**接住了**请求」——RED 阶段红的就是这一条。
 *
 * 判据必须落在 **`Content-Type`** 上：出口没挂上时请求会落进 SPA 兜底，回
 * **200 ＋ `text/html`**（同族实测，见文件头），**状态码看着像成功**（`#004-14`）。
 */
const 出口接住了 = (response: Response): void => {
  expect(response.headers.get("content-type") ?? "").toContain("application/json")
  expect(response.status).toBe(200)
}

/**
 * 把某人加进项目（`project_member` 的一行）。
 *
 * ⚠️ **刻意直接写库、不走将来的「邀请」出口**（T021 才落）：本 task 要验的是**归档**，
 * 若让它依赖另一条还没实现的链，这条测试就变成了「等 T021」。写库是**夹具**不是 oracle——
 * 它构造**输入**（谁是成员），断言仍然读 MinIO 到达请求 / 沙箱目录 / 归档行。
 *
 * `role` 默认为 `"member"`；**只有**「逃逸路径」那条用例传 `"owner"`——它要让「守卫缺席时
 * 副作用真的会发生」这件事成立（否则授权先拒了，观测面为零）。
 */
const joinProject = (projectId: string, subject: TokenSubject, role: "owner" | "member" = "member") =>
  Effect.promise(async () => {
    await pg?.db.execute(sql`
      insert into auth.project_member (project_id, user_id, role, time_created)
      values (${projectId}, ${subject.id}, ${role}, ${nowSeconds()})
    `)
  })

/** 某人的沙箱里、某个项目的目录。 */
const projectDirOf = (subject: TokenSubject, projectId: string) => path.join(WORKSPACE_ROOT, subject.id, projectId)

/**
 * 往沙箱里放一个文件（**夹具**：构造输入）。`recursive` 让「成员还没建过这个目录」也走得通
 * ——那正是真实情形（成员各自 clone 才有的目录）。
 */
function seedFile(subject: TokenSubject, projectId: string, rel: string, content: string): void {
  const full = path.join(projectDirOf(subject, projectId), rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, "utf8")
}

/**
 * 夹具记下的、**属于这个项目**的 PUT：`[对象键, 内容]`。
 *
 * 按 `projectId` 过滤而不是「本用例之后新增的」：每个用例建的项目 id 都是新的 UUID，
 * 于是这个过滤天然是**逐用例隔离**的（同一个假 S3 端点是文件级共享的）。
 */
const uploadsOf = (projectId: string) =>
  s3.requests
    .filter((record) => record.method === "PUT" && record.key.includes(projectId))
    // 元组标注不是装饰：不写它 `.map` 推出的是 `string[][]`，于是 `toEqual([[键, 内容]])`
    // 那几条全被 bun 的 `expect` 类型拦下（`Argument of type 'string[][]' is not assignable …`）。
    .map((record): [string, string] => [record.key, new TextDecoder().decode(record.body)])

/** 键里的**沙箱内相对路径**（去掉 `{userId}/{projectId}/` 两段）。 */
const 相对路径 = (key: string) => key.split("/").slice(2).join("/")

/**
 * 只算**用户自己放进去的**文件（`.git/**` 摘掉）。
 *
 * 存在的理由只有一个：`createAs` 建出来的项目目录**必然含 `.git`**（T018 那边 `git init`），
 * 而设计 §8.2 说的是「沙箱目录内**全部**文件」⇒ `.git` 一并上传是**字面正确**的，
 * **不是缺陷**（下面有专门一条用例钉它）。
 *
 * ⚠️ 这里原写「实测约 1038 个对象文件」，**是错的**（2026-10-06 复测：`git init` 本机产 **18**
 * 个文件，`ProjectV2.commit` 再写一个 `.git/opencode`）——差两个数量级，`#003-04` 那条
 * 「实测数字落笔前先复现」的活标本（三席评审 S3-08）。**教训**：条数随平台/git 版本漂，
 * 断言里一个字都不许写死（下面 `failOn` 的注释里那句「数它是一笔迟早会漂的账」照旧成立）。
 *
 * 但「逐键全等」那条判据要钉的是**谁的东西进谁的前缀**，被 `.git` 的噪声淹没就看不见
 * 亚健康的变体（「把 owner 那份复制给所有人」照样会带着正确的 `.git` 一起红——可读性没了，
 * 而且断言里会躺着一千个与判据无关的键）。所以这里把它当**噪音过滤器**。
 *
 * ⚠️ 过滤与「确实在里面」**两条都要**：只过滤就成了把头埋起来（`#002-02`：看不见的要写成缺口，
 * 不能当成不存在）；下面 `.git` 那条就是它的对照。
 */
const 沙箱文件 = (projectId: string) => uploadsOf(projectId).filter(([key]) => !相对路径(key).startsWith(".git/"))

/** 升序比较（**必须给 compare**：`.sort()` 不给会被 `require-array-sort-compare` 记一条）。 */
const 升序 = (values: string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * 归档行（**直接打 `pg.db`**，不经 `archiveStatesOf`）。
 *
 * 出口形状就是驱动给的**裸行**（`Record<string, unknown>`）——这是 oracle，不是产品接口：
 * 替它编一层 camelCase 映射等于把「这行长什么样」的判断在这条测试里再写一份，而那样写错的
 * 时候**红的是映射**、不是被测物（`#002-06`）。
 */
async function archiveRow(projectId: string): Promise<Record<string, unknown> | undefined> {
  if (!pg) return undefined
  const result = await pg.db.execute(
    sql`select archived, archived_at from auth.project_archive where project_id = ${projectId}`,
  )
  return rowsOf(result)[0]
}

/**
 * 同上的 Effect 形状：用例体是 `Effect.gen(function* …)`，**`await` 在里面不是语法**
 * （`function*` 不是 `async`），必须走 `yield*`。
 */
const 归档行 = (projectId: string) => Effect.promise(() => archiveRow(projectId))

/**
 * 一个**刚建好、还没归档**的共享项目：ALICE 是 owner、BOB 是 member，两人沙箱里各有一份文件。
 *
 * 每个用例都建**自己**的项目（不同 UUID）⇒ 与同文件里别的用例零耦合。
 */
const 共享项目 = () =>
  Effect.gen(function* () {
    const project = yield* createAs(ALICE, { name: "8·17专案", type: "shared" })
    yield* joinProject(project.id, BOB)
    return project
  })

afterEach(() => {
  // 「上传失败」那条把假端点设成失败态；**每个用例后必须还原**，否则后面全红。
  s3.failWith(undefined)
})

/** 归档前**必须**什么都没发生的那几条共用断言（安全属性在前，`#004-14`）。 */
function 零副作用(projectId: string, 谁的沙箱: TokenSubject[]): void {
  expect(uploadsOf(projectId)).toEqual([])
  for (const subject of 谁的沙箱) expect(existsSync(projectDirOf(subject, projectId))).toBe(true)
}

describe("T013 · 归档：成员各进各的前缀（Q1×Q3 裁定 (c)）", () => {
  it.live(
    "owner 归档：乙的文件进乙的前缀、甲的文件进甲的前缀，两人的沙箱目录都被删，列表里已归档",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "资料/话单.csv", "甲的话单")
        seedFile(ALICE, project.id, "报告.md", "甲的报告")
        seedFile(BOB, project.id, "资料/话单.csv", "乙的话单")
        // 甲沙箱里的**隔壁项目**：`releaseAll` 少写一段 projectId（`rm(join(root, userId))`）
        // 就会把它一起删掉，而「本项目目录没了」在那种变异下照样绿——它是这条判据唯一的观测面
        // （2026-10-06 三席评审 S3-06）。
        seedFile(ALICE, "隔壁专案", "无关.txt", "隔壁的，不该动")

        const response = yield* archiveAs(openApp, ALICE, { projectId: project.id })
        出口接住了(response)
        // 出参契约（T023 要靠它知道成没成）——**逐字写字段名**，不 import 生产类型。
        expect(yield* json(Schema.Struct({ projectId: Schema.String, archived: Schema.Boolean }), response)).toEqual({
          projectId: project.id,
          archived: true,
        })

        // ① **被测属性**：逐键全等——多一个键（比如「把 owner 那份复制给所有人」或
        //    「收进一个共享前缀」）也红。这是 (c) 裁定的落点。`.git/**` 是固定噪音，见 `沙箱文件`。
        expect(升序(沙箱文件(project.id).map(([key]) => key))).toEqual(
          升序([
            `${ALICE.id}/${project.id}/资料/话单.csv`,
            `${ALICE.id}/${project.id}/报告.md`,
            `${BOB.id}/${project.id}/资料/话单.csv`,
          ]),
        )
        // 内容也要对：**键对、内容错**（比如把同一个 Uint8Array 复用成空）不会让上面那条红。
        const 内容 = new Map(沙箱文件(project.id))
        expect(内容.get(`${ALICE.id}/${project.id}/资料/话单.csv`)).toBe("甲的话单")
        expect(内容.get(`${BOB.id}/${project.id}/资料/话单.csv`)).toBe("乙的话单")

        // ② 沙箱释放（FR-008 的「删除沙箱文件」）——放掉的是**这个项目那一层**，不是整只沙箱。
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
        expect(existsSync(projectDirOf(BOB, project.id))).toBe(false)
        expect(existsSync(path.join(projectDirOf(ALICE, "隔壁专案"), "无关.txt"))).toBe(true)

        // ③ 出参：归档后项目移入「已归档」（`archived` 这一项由 T018 的列表出口带出来）
        const mine = (yield* listAs(ALICE)).find((entry) => entry.id === project.id)
        expect(mine?.archived).toBe(true)
      }),
    30_000,
  )

  it.live(
    "私有项目（owner 只有自己）：自己的文件进自己的前缀，自己的沙箱被删",
    () =>
      Effect.gen(function* () {
        const project = yield* createAs(ALICE, { name: "私有专案", type: "private" })
        seedFile(ALICE, project.id, "独一份.txt", "只有我")

        出口接住了(yield* archiveAs(openApp, ALICE, { projectId: project.id }))

        expect(沙箱文件(project.id)).toEqual([[`${ALICE.id}/${project.id}/独一份.txt`, "只有我"]])
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
      }),
    30_000,
  )

  it.live(
    "成员还没有那个目录（没 clone 过）⇒ 跳过，不炸；同一个项目里别人的那份照常归档",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")

        出口接住了(yield* archiveAs(openApp, ALICE, { projectId: project.id }))

        // 乙一个对象都没有（不是「传了个空对象」），而归档对甲那一半照常完成。
        expect(沙箱文件(project.id)).toEqual([[`${ALICE.id}/${project.id}/甲.txt`, "甲的"]])
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
      }),
    30_000,
  )
})

describe("T013 · 归档：谁不能归档（FR-008 仅 owner）", () => {
  it.live(
    "成员不能归档：一个对象都没上传、两人的沙箱都还在、库里没有归档行",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")
        seedFile(BOB, project.id, "乙.txt", "乙的")

        const response = yield* archiveAs(openApp, BOB, { projectId: project.id })

        // 被测属性在前（`#004-14`）：**没有副作用**，然后才是「它拒绝了」这条伴随信号。
        零副作用(project.id, [ALICE, BOB])
        expect(yield* 归档行(project.id)).toBeUndefined()
        expect(response.ok).toBe(false)
        expect(response.status).toBe(403)
        expect((yield* listAs(ALICE)).find((entry) => entry.id === project.id)?.archived).toBeUndefined()
      }),
    30_000,
  )

  it.live(
    "非成员（外人）不能归档：同样零副作用、403",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")

        const response = yield* archiveAs(openApp, CAROL, { projectId: project.id })

        零副作用(project.id, [ALICE])
        expect(yield* 归档行(project.id)).toBeUndefined()
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  it.live(
    "已归档的项目再归档一次：拒（归档 = 冻结），且归档时刻没有被刷新",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")
        出口接住了(yield* archiveAs(openApp, ALICE, { projectId: project.id }))
        const 第一次 = yield* 归档行(project.id)
        expect(第一次?.archived_at).not.toBeNull()

        const response = yield* archiveAs(openApp, ALICE, { projectId: project.id })

        // 被测属性在前（`#004-14`：bun 的 `expect` 一失败即中止用例体 ⇒ 书写顺序决定拿到哪条证据）。
        // 判据是**那一行逐字节没变**，不是「没报错」也不是只看 `archived`：重入若被放行，`archived`
        // 仍是 true（恒绿），而 `archived_at` 会被重写。
        // ⚠️ **它只能抓跨秒的重入**：`nowSeconds()` 是**秒**粒度，而两次调用相隔毫秒，同一秒内
        //    `archived_at` 本来就不会变（2026-10-06 三席评审 S1-03/S3-05 纠的——注释原先写成
        //    「钉住时刻没被刷新」，那是 over-claim）。当成**加强**判据用，不是唯一判据。
        expect(yield* 归档行(project.id)).toEqual(第一次)
        // 伴随信号：拒了。重入若被放行，红的是上面那条（行变了）而**不是**这条。
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  it.live(
    "不带凭证：归档回 401，且零副作用",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")

        const response = yield* openApp(ARCHIVE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })

        零副作用(project.id, [ALICE])
        expect(response.status).toBe(401)
      }),
    30_000,
  )
})

describe("T013 · 归档：失败与畸形输入都留不下半个状态", () => {
  it.live(
    "上传失败 ⇒ 沙箱一个都没删、库里没有归档行（先传后删、标记最后落）",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")
        seedFile(BOB, project.id, "乙.txt", "乙的")
        s3.failWith(403)

        const response = yield* archiveAs(openApp, ALICE, { projectId: project.id })

        // ② 「上传在删除之前」这条**顺序**判据只有沙箱还在时才测得出来（`#004-09`）：
        //    端点判据（它失败了）对「删没删」完全不敏感。
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(true)
        expect(existsSync(projectDirOf(BOB, project.id))).toBe(true)
        expect(yield* 归档行(project.id)).toBeUndefined()
        expect(response.ok).toBe(false)
      }),
    30_000,
  )

  it.live(
    "第二个成员上传失败 ⇒ **第一个成员的沙箱也还在**（全员传完才开删）",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")
        seedFile(BOB, project.id, "乙.txt", "乙的")

        // 失败点落在**乙的第一个对象**上——按**键**判，不按「第几个请求」：
        // ① 甲要传几个对象是 `.git` 说了算（T018 的 `git init`，本机实测 19 个：18 ＋ `.git/opencode`），
        //    数它是一笔迟早会漂的账（且写死过一次、错到两个数量级 —— 见 `沙箱文件` 的注释）；
        // ② `backupAll` 按成员逐个传完 ⇒ 「乙的键在甲的全部键之后」是**构造保证**的，
        //    于是「前一半成功、后一半失败」这句话由这一行直接写成，不用推断。
        // ⚠️ 旧夹具（按键之前的 `failAfter(1, 403)`）读了**服务端累计**请求数，而假 S3 是文件级共享的
        //    ⇒ 实际效果是「这个请求起全失败」，边界压根没落在两个成员之间：M2 变异下这条**全绿**。
        s3.failOn(403, (request) => request.key.startsWith(`${BOB.id}/`))

        const response = yield* archiveAs(openApp, ALICE, { projectId: project.id })

        // 对照（`#004-08`：副作用类判据不能只钉「什么都没发生」）：**甲的**那个文件真的传上去了，
        // 所以这不是「一次外呼都没发生」的假象。
        expect(沙箱文件(project.id).map(([key]) => key)).toContain(`${ALICE.id}/${project.id}/甲.txt`)
        // 被测属性：**没有**任何一个沙箱被删。写成「传一个删一个」的实装会让先传完的那一个没了，
        // 而此时项目**没有**被标成已归档（下一句）——成员的本地文件就这么没了，且不可恢复。
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(true)
        expect(existsSync(projectDirOf(BOB, project.id))).toBe(true)
        expect(yield* 归档行(project.id)).toBeUndefined()
        expect(response.ok).toBe(false)
      }),
    30_000,
  )

  it.live(
    "projectId 不是合法路径段（`.`）⇒ 400，且那个成员的**整个沙箱**一根汗毛没动",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        /**
         * 为什么取值是 **`.`** 而不是 `../x`（这条用例的前身）。
         *
         * 两者都过不了 `isSafePathSegment`，但只有 `.` 还能过 `Minio` 的段检查——含 `..` 的会在
         * `makeStore` 里当场抛，**走不到副作用**（`./x` 也不行：那是另一条项目内的路径）。而
         * `join(root, userId, ".")` 恰好等于**该成员的整个沙箱目录**：这是「不合法路径段」里
         * 后果最重的一个（整只沙箱被搬走 ＋ 被删）。
         *
         * 判据是「副作用没发生」，那么取值就必须选**守卫若缺席、副作用真会发生**的那个
         * （`#004-13`：不是「没有现成观测面」，是「这个输入压根没有可观测的后果」）。
         */
        const 隔壁项目 = "另一个专案"
        seedFile(ALICE, 隔壁项目, "哨兵.txt", "这根哨兵不许被传走，也不许被删")
        /**
         * 让那条逃逸路**真的走得通**：库里给 ALICE 一行 `project_id = "."` 的 **owner** 行。
         *
         * 不写它，守卫缺席时 `membersOf(".")` 返回空集 ⇒ actor 为 `null` ⇒ 403，副作用分支根本
         * 到不了——于是「零副作用」三条断言**恒真**（2026-10-06 三席评审的 S1-01 与 S2-02 抓的
         * 就是这个：用例自称「400 ＋ 零副作用」，实际只有状态码能红）。
         */
        yield* joinProject(".", ALICE, "owner")
        const 请求前 = s3.requests.length

        const response = yield* archiveAs(openApp, ALICE, { projectId: "." })

        // ① **被测属性**：项目目录之外的东西一样不许被搬走（顺序、内容都算）。
        expect(existsSync(path.join(projectDirOf(ALICE, 隔壁项目), "哨兵.txt"))).toBe(true)
        //    ⚠️ `uploadsOf` 按**真** projectId 过滤，而逃逸后的键里带的是 `.`（或被 HTTP 那层
        //    规范化掉）⇒ 它看不见这条路的产物，**不能单独用它**。补一条不依赖任何过滤口径的
        //    本地差分：这次请求之后，假 S3 上一条 PUT 都没发生。
        expect(s3.requests.slice(请求前).filter((record) => record.method === "PUT")).toEqual([])
        expect(uploadsOf(project.id)).toEqual([])
        // ② 伴随信号：拒了，而且是 400（不是授权拒的 403、也不是炸出来的 500）。
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  it.live(
    "体是畸形 JSON（或没有 projectId）⇒ 400",
    () =>
      Effect.gen(function* () {
        const 畸形 = yield* as(openApp, ALICE, ARCHIVE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{不是 JSON",
        })
        const 缺字段 = yield* archiveAs(openApp, ALICE, { name: "没有 projectId" })

        expect(畸形.status).toBe(400)
        expect(缺字段.status).toBe(400)
      }),
    30_000,
  )
})

/**
 * 「全部文件」的**字面结果**：`.git` 也一并进 MinIO。
 *
 * 这条不是给归档流程挑刺，而是钉住一条**很容易被后人「顺手优化掉」的事实**：T018 建项目时在
 * 沙箱里 `git init` 了，于是每个项目目录都带一份完整仓库（本机实测 19 个文件）。设计 §8.2
 * 写的是「沙箱目录内**全部**文件上传」⇒ 一并上传是**符合设计**的，不是漏网。
 *
 * 为什么不能「跳过 `.git` 省点流量」：`.git/opencode` 里存着**这个项目的 id**（T018 落的支点），
 * 找回（T014）要靠它把沙箱目录认回同一个项目，`.git/config` 等决定这份仓库还算不算仓库。
 * 一个跳过 `.git` 的实装**不会报错、不会变红**——能变红的只有这条用例。
 */
describe("T013 · 归档：「全部文件」包含 `.git`（找回的支点）", () => {
  it.live(
    "沙箱项目目录是 git 仓库 ⇒ `.git` 里的东西随归档一起进前缀；**成员那份也进成员自己前缀**",
    () =>
      Effect.gen(function* () {
        // 共享项目（ALICE owner ＋ BOB member）：`.git` 的**前缀方向**必须**在成员那一侧也**钉一次。
        // 之前这里只有 owner、且成员夹具只塞纯文本 ⇒「成员前缀写反只影响 `.git`」这种实现在
        // 2026-10-06 三席评审（S1-04）时**不会变红**。
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "甲.txt", "甲的")
        // 乙那份 `.git` 由夹具**造**（成员各自的目录是各自 clone 才有的，建项目那一步只碰 owner）：
        // 这里要验的是「`.git/` 开头的相对路径也照原样落在**他自己的**前缀下」，不是 git 的行为。
        seedFile(BOB, project.id, ".git/config", "[core]\n\trepositoryformatversion = 0\n")

        出口接住了(yield* archiveAs(openApp, ALICE, { projectId: project.id }))

        const 键 = uploadsOf(project.id).map(([key]) => key)
        expect(键).toContain(`${ALICE.id}/${project.id}/.git/opencode`)
        expect(键).toContain(`${ALICE.id}/${project.id}/.git/config`)
        expect(键).toContain(`${BOB.id}/${project.id}/.git/config`)
        // 支点里的**内容**：断 `toContain` 而不是全等——那个文件的**格式**由上游
        // `ProjectV2.commit` 定，不是我们的契约，钉死字节等于给上游埋一条假警报（`#003-05`）。
        // 但「键传了、内容是空的」是实装真会犯的错，所以内容必须看一眼。
        expect(new Map(uploadsOf(project.id)).get(`${ALICE.id}/${project.id}/.git/opencode`) ?? "").toContain(project.id)
        expect(new Map(uploadsOf(project.id)).get(`${BOB.id}/${project.id}/.git/config`)).toBe(
          "[core]\n\trepositoryformatversion = 0\n",
        )
        // 沙箱照样删干净——`.git` 不是「删不掉的那一部分」，两个人都是。
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
        expect(existsSync(projectDirOf(BOB, project.id))).toBe(false)
      }),
    30_000,
  )
})

/**
 * `endpointOf` 的两条口径（S3-09）——**纯**判据，不建 app、不碰假 S3。
 *
 * 存在的理由：`Minio.Config.endpoint` 的文件头写着「`host:port`，**或带协议**」，而本模块
 * 曾经**无条件**补协议头 ⇒ 部署方按前者给带协议的完整 URL 时，拼出来的是 `http://https://…`，
 * 它不在配置处报错，只在第一次外呼时炸在 SDK 里（一个与配置无关的错，**静默**）。
 * 造一个「配了带协议 endpoint」的真世界要**第二个 app**（代价见文件头），而这条判据的值
 * 全在这个纯函数里 ⇒ 就地测它，别为它去付那个代价。
 */
describe("T013 · archive.endpointOf：带协议与不带协议两种写法归一", () => {
  const settings = (endpoint: string, useSSL: boolean) => ({
    endpoint,
    bucket: "openhive",
    accessKeyId: "k",
    secretAccessKey: "s",
    useSSL,
  })

  // ⚠️ 用 bun 的 `test`（本文件那个 `it` 是 `testEffect` 的包装，只吃 Effect 体）——
  // 这条是纯函数判据，没有 app、没有 Effect。
  test("不带协议 ⇒ 按 useSSL 补；带协议 ⇒ 原样用（不再补一层）", () => {
    expect(endpointOf(settings("minio.internal:9000", false))).toBe("http://minio.internal:9000")
    expect(endpointOf(settings("minio.internal:9000", true))).toBe("https://minio.internal:9000")
    expect(endpointOf(settings("https://minio.internal:9000", false))).toBe("https://minio.internal:9000")
    expect(endpointOf(settings("http://minio.internal:9000", true))).toBe("http://minio.internal:9000")
  })
})

/**
 * 项目目录**本身**是符号链接——`filesUnder` 的**根**那一步必须用 `lstat`（S2-01）。
 *
 * 威胁模型（不是假想）：成员自己的 `bash` 工作目录就在 `{root}/{userId}`，他可以把
 * `{root}/{userId}/{projectId}` 整个换成一条指向**任何他能读到的目录**的链接。跟随的实现
 * （`existsSync` / `statSync` 都跟随）会把那个目录的文件全部传进**他自己**的 MinIO 前缀
 * ——`rm` 那一步删的是链接本身，所以是**跨用户读**（泄漏），不是破坏。
 *
 * 用 `junction` 而不是普通符号链接：win32 上建它**不需要管理员权限**，而 `lstat` 一样把它
 * 报成链接（`isDirectory()` 为假）⇒ 判据与 POSIX 的 symlink 同形，两平台同一条用例。
 */
describe("T013 · 归档：项目目录本身是符号链接（跨目录读的入口）", () => {
  it.live(
    "指向别处 ⇒ 那个别处的东西一个不传、一个不删；链接本身按「空目录」放掉",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        const 别处 = path.join(SANDBOX, "别处")
        mkdirSync(别处, { recursive: true })
        writeFileSync(path.join(别处, "别人的话单.csv"), "不该出现在任何人的 MinIO 里", "utf8")

        const 链接 = projectDirOf(ALICE, project.id)
        rmSync(链接, { recursive: true, force: true })
        symlinkSync(别处, 链接, "junction")

        const response = yield* archiveAs(openApp, ALICE, { projectId: project.id })

        // ① 被测属性：**别人的东西没被搬走**。跟随的实现会把 `别人的话单.csv` 传进甲的前缀，
        //    而那个键里带真 projectId ⇒ `uploadsOf` 看得见（不用差分也红）。
        expect(uploadsOf(project.id)).toEqual([])
        // ② 另一条独立的安全属性：**那个别处也没被删**——「放掉链接」不等于「放掉它指向的目录」。
        expect(existsSync(path.join(别处, "别人的话单.csv"))).toBe(true)
        // ③ 伴随信号：归档本身成功了（链接按空目录处理，不是失败）。
        expect(response.status).toBe(200)
      }),
    30_000,
  )
})

/**
 * 一处**夹具自检**：没有它，「零副作用」那几条断言在夹具自己坏掉时**照样绿**
 * （`uploadsOf` 的过滤写错 ⇒ 永远空 ⇒ 「一个对象都没传」恒真）。
 * 这条用一条**真归档**证明观测面是活的——同 `#004-08` 的判据「副作用类判据必须先有一条
 * 对照证明机制是活的」。
 */
describe("T013 · 夹具自检", () => {
  it.live(
    "uploadsOf 真的能看见上传（否则「零副作用」恒真）",
    () =>
      Effect.gen(function* () {
        const project = yield* 共享项目()
        seedFile(ALICE, project.id, "自检.txt", "有东西")

        出口接住了(yield* archiveAs(openApp, ALICE, { projectId: project.id }))

        expect(沙箱文件(project.id)).toEqual([[`${ALICE.id}/${project.id}/自检.txt`, "有东西"]])
      }),
    30_000,
  )
})
