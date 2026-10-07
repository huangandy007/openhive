import { afterAll, afterEach, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
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

/**
 * T014（FR-009）：**项目找回**——`archived=0`（＋`archived_at=NULL`）＋ MinIO 下载回沙箱。
 *
 * ## 它是 T013 的镜像，两条裁定在这里落地
 *
 * | 事项 | 裁定（2026-10-06，用户） | 落点 |
 * |---|---|---|
 * | 作用对象 | 与 T013 的 **(c) 同构**：owner 触发，服务端按 `project_member` **对每个成员各跑一遍** —— 把**他自己前缀**的文件下载回**他自己沙箱** | `restoreAll` 里**每个成员各造一个 store** |
 * | 共享 bare 仓库 `/shared/{projectId}.git` | **归档/找回都不动它**（它是项目级 git 载体、在 `/shared` 共享卷上；MinIO 那些键镜像的是**各人沙箱**，塞不进一个项目级对象） | 本模块**一行都不碰**它；`/shared` 的空间不随归档释放 ⇒ 挂 `state.md` 缺口表 ＋ `deploy-todo` 的 D-14 |
 * | 次序 | **标记最后落**（把 `design` §8.3 的「②改状态 ③下载」调成 T013 的次序） | `handleRestore` 的「全员下载完，才 `markRestored`」 |
 *
 * 「作用对象」不是自由选择：成员**已失权**（FR-010），自己触发不了；只还原 owner 那一份，
 * 成员的文件就永远留在 MinIO 里 —— 直接违背 FR-009 的「MinIO 文件**全部**下载回沙箱」。
 *
 * ## harness 与 `openhive-project-archive.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入），故整套约法照抄、只换判据点：
 * `OPENHIVE_DATA_ROOT` 只能走 `process.env`、身份走 cookie 不走自造头、`OPENHIVE_MINIO_*` 走
 * `ConfigProvider`（**层构造期**取值 ⇒ 假 S3 必须先起）。
 *
 * ## ⚠️ 一个文件**只建一个 app**（T013 实测：**新 app 的第一条 PG 查询**撞 `Connection closed`）
 *
 * 「MinIO 没配 ⇒ 非成员 403 而不是 503」那条要另一份 `OPENHIVE_MINIO_*` ⇒ 要第二个 app
 * ⇒ 它住在 `openhive-project-archive-unconfigured.test.ts` 里（那个文件里它是**唯一**的 app）。
 * 机制未查到底，已挂 `state.md` 的 T013 缺口表。
 *
 * ## 「未挂载」在本应用里**不是 404**
 *
 * 没被路由接管的路径落 SPA 兜底，回 **200 ＋ `text/html`**（同族实测）⇒ 判「出口在不在」
 * 一律先断 **`Content-Type`**，状态码只当伴随信号（`LEARNINGS #004-14`）。
 *
 * ## oracle 一律不经过被测对象
 *
 * - 放进 MinIO 的东西：**夹具自己记下的到达请求**（`fakeS3.requests`），不经 `Minio.Interface.get`；
 * - 归档行：**直接在 `pg.db` 上写 SQL**，不经 `archiveStatesOf`；
 * - 沙箱目录：`existsSync` / `readFileSync`。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }
/** 第三个身份：**一个项目都不建、也不加进任何项目**——「非成员」那条专用。 */
const CAROL: TokenSubject = { id: "770e8400-e29b-41d4-a716-446655440002", policeNo: "020603", name: "王五", isAdmin: false }

/** 出口路径（**客户端契约**，写**字面量**、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const ARCHIVE_PATH = "/openhive/project/archive"
const RESTORE_PATH = "/openhive/project/restore"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-restore-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是
 * `dataRoot(process.env)`，不是 Effect 的 `Config` 服务）——塞 `ConfigProvider` 会被**无声忽略**。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

/**
 * 假 S3 与 `openApp` 的构造**次序是要求不是巧合**：配置服务在**层构造期**取值
 * （`HttpRouter.use` 的 `Effect.gen` 里 `yield*`），所以 endpoint 必须在 `realApp(OPEN)` 之前就有。
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

/** `POST /openhive/project` —— 建一个项目。 */
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

/** 两个生命周期出口各一个发请求的助手（**回体不解析**：失败那条没有 `Content-Type` 契约）。 */
const archiveAs = (subject: TokenSubject, body: unknown) =>
  as(openApp, subject, ARCHIVE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const restoreAs = (subject: TokenSubject, body: unknown) =>
  as(openApp, subject, RESTORE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/** 「出口**接住了**请求」——判据落在 `Content-Type` 上（理由见文件头）。 */
const 出口接住了 = (response: Response): void => {
  expect(response.headers.get("content-type") ?? "").toContain("application/json")
  expect(response.status).toBe(200)
}

/**
 * 把某人加进项目（`project_member` 的一行）。**夹具**，构造输入用；断言一律读沙箱 / 归档行。
 *
 * `role` 默认为 `"member"`；**只有**「逃逸路径」那条传 `"owner"`——它要让「守卫缺席时副作用
 * 真的会发生」成立（否则授权先拒了，观测面为零）。
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

/** 往沙箱里放一个文件（**夹具**：构造输入）。 */
function seedFile(subject: TokenSubject, projectId: string, rel: string, content: string): void {
  const full = path.join(projectDirOf(subject, projectId), rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, "utf8")
}

/** 升序比较（**必须给 compare**：`.sort()` 不给会被 `require-array-sort-compare` 记一条）。 */
const 升序 = (values: string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** 沙箱目录里的**全部文件**（相对路径、`/` 归一、升序）；目录不存在 ⇒ 空数组。 */
function 全部文件(directory: string): string[] {
  const found: string[] = []
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel)
      else found.push(rel)
    }
  }
  if (existsSync(directory)) walk(directory, "")
  return 升序(found)
}

/**
 * 只算**用户自己放进去的**文件（`.git/**` 摘掉）。
 *
 * 与 T013 同因同注（`openhive-project-archive.test.ts` 的 `沙箱文件`）：`createAs` 建出来的项目
 * 目录**必然含 `.git`**（T018 那边 `git init` ＋ `ProjectV2.commit` 写的 `.git/opencode`），
 * 而归档把它一并传上去是**字面正确**的（设计说的是「沙箱目录内**全部**文件」）⇒ 找回也就把它
 * 一并下载回来。本 task 的主判据是「**谁的东西回了谁的沙箱**」，被这十几个固定噪音淹没就看不见
 * 亚健康的变体（「把 owner 的备份铺给所有成员」照样会带着正确的 `.git` 一起红）。
 *
 * ⚠️ 过滤与「`.git` 确实也回来了」**两条都要**——只过滤等于把头埋起来（`#002-02`）。
 * 后者另有一条**专门**的用例（Git 工作树没回来，「文件找回了」就只是一堆散文件）。
 */
function 沙箱文件(directory: string): string[] {
  return 全部文件(directory).filter((rel) => !rel.startsWith(".git/"))
}

/** 键里的**沙箱内相对路径**（去掉 `{userId}/{projectId}/` 两段）。 */
const 相对路径 = (key: string) => key.split("/").slice(2).join("/")

/** 备份里属于某项目的、**用户自己放进去的**对象键（升序）——「找回不动备份」那条的右侧。 */
const 用户备份 = (projectId: string) =>
  升序(s3.keys().filter((key) => key.includes(projectId) && !相对路径(key).startsWith(".git/")))

const 沙箱文件内容 = (subject: TokenSubject, projectId: string, rel: string): string =>
  readFileSync(path.join(projectDirOf(subject, projectId), rel), "utf8")

/** 读归档行。**直接打 `pg.db`**（不经 `archiveStatesOf`），出口是驱动给的**裸行**。 */
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
 * 「**那一行还在**，而且它的 `archived_at` 非空」——「找回没把它翻成未归档」的判据。
 *
 * ⚠️ **为什么分两句、而不是一句 `.not.toBeNull()`**：写成
 * `expect((yield* 归档行(id))?.archived_at).not.toBeNull()` 时，**行整个不见了**的实得值是
 * `undefined`（`undefined?.archived_at`），那条断言**照样通过** ⇒ 一行都没了的实现反而**更绿**
 * （`LEARNINGS #005-01` 的同族：实得值退化成原语时，判据看上去还在、其实已经空了）。
 * 先证明**行在**，再证明**那个字段的值**——两句缺一不可。
 * 与 `openhive-project-archive-unconfigured.test.ts` 那条 ③ 的写法**同口径**（`#002-06`：
 * 同一个判断别在两处各写一份不一样）。
 */
const 仍是已归档 = (projectId: string) =>
  Effect.gen(function* () {
    const 行 = yield* 归档行(projectId)
    expect(行).toBeDefined()
    expect(行?.archived_at).not.toBeNull()
  })

/**
 * **已经归档**的一个共享项目：ALICE owner、BOB member，两人的文件都进了**各自**的 MinIO 前缀、
 * 沙箱目录都已删。`seed` 决定各人沙箱里放什么（跑归档之前）。
 *
 * 走**真的归档出口**造这个前置状态，而不是用 `s3.seed` 直接塞对象：那样写的备份是**我猜的形状**，
 * 而这里要验的正是「归档写下的东西，找回能不能读回来」（`LEARNINGS #004-07`：形状由被调方定义）。
 */
const 已归档项目 = (seed: (project: { id: string }) => void) =>
  Effect.gen(function* () {
    const project = yield* createAs(ALICE, { name: "8·17专案", type: "shared" })
    yield* joinProject(project.id, BOB)
    seed(project)
    出口接住了(yield* archiveAs(ALICE, { projectId: project.id }))
    return project
  })

afterEach(() => {
  // 「下载失败」那条把假端点设成失败态；**每个用例后必须还原**，否则后面全红。
  s3.failWith(undefined)
})

describe("T014 · 找回：各人前缀的文件回到各人沙箱（T013 (c) 的镜像）", () => {
  it.live(
    "owner 找回：乙的文件进乙的沙箱、甲的文件进甲的沙箱，归档行翻回未归档，列表里回到活跃",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "资料/话单.csv", "甲的话单")
          seedFile(ALICE, id, "甲专属.md", "只有甲")
          seedFile(BOB, id, "资料/话单.csv", "乙的话单")
          seedFile(BOB, id, "乙专属.md", "只有乙")
        })
        // 归档确实把这四个文件搬走了 —— 没有这一条，下面的「回来了」可能只是**从来就没走**
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)

        const response = yield* restoreAs(ALICE, { projectId: project.id })
        出口接住了(response)
        expect(yield* json(Schema.Struct({ projectId: Schema.String, archived: Schema.Boolean }), response)).toEqual({
          projectId: project.id,
          archived: false,
        })

        // ① **被测属性**：逐键全等——多一个键（「把甲的备份铺给乙」）也红，判据是**谁的东西**。
        expect(沙箱文件(projectDirOf(ALICE, project.id))).toEqual(["甲专属.md", "资料/话单.csv"])
        expect(沙箱文件(projectDirOf(BOB, project.id))).toEqual(["乙专属.md", "资料/话单.csv"])
        // 内容也要对：**键对、内容错**（把同一个 Uint8Array 复用、或张冠李戴）不会让上面那条红。
        expect(沙箱文件内容(ALICE, project.id, "资料/话单.csv")).toBe("甲的话单")
        expect(沙箱文件内容(BOB, project.id, "资料/话单.csv")).toBe("乙的话单")
        // ② 不变量的一半：**Git 工作树也回来了**（`.git/opencode` 是 T018 那个支点文件）。
        //    少了它，「文件找回了」只是一堆散文件：仓库的身份、remote 配置、历史全没了。
        expect(全部文件(projectDirOf(ALICE, project.id))).toContain(".git/opencode")

        // ③ 归档行**成对**翻回去：`archived=false` 与 `archived_at=NULL` 是迁移那条
        //    `project_archive_coherence_check` 钉住的一对，只改一个会被库拒。
        const row = yield* 归档行(project.id)
        expect(row?.archived_at).toBeNull()

        // ④ 出参的另一半：项目从「已归档」回到「最近 / 全部」（`archived` 由 T018 的列表带出来）。
        const mine = (yield* listAs(ALICE)).find((entry) => entry.id === project.id)
        expect(mine?.archived).toBe(false)

        // ⑤ 找回**不动备份**：四个用户对象仍在 MinIO 里，一条 DELETE 都没有。
        //    这不是顺手的检查：删了备份，找回就成了「搬回家再把原件烧掉」。
        expect(用户备份(project.id)).toEqual(
          升序([
            `${ALICE.id}/${project.id}/甲专属.md`,
            `${ALICE.id}/${project.id}/资料/话单.csv`,
            `${BOB.id}/${project.id}/乙专属.md`,
            `${BOB.id}/${project.id}/资料/话单.csv`,
          ]),
        )
        expect(s3.requests.filter((record) => record.method === "DELETE" && record.key.includes(project.id))).toEqual([])
      }),
    30_000,
  )

  it.live(
    "子目录一路建出来（下载要 `mkdir` 逐级递归，不是只写一层）",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "深度/一级/二级/深.txt", "很深")
        })

        出口接住了(yield* restoreAs(ALICE, { projectId: project.id }))

        expect(沙箱文件(projectDirOf(ALICE, project.id))).toEqual(["深度/一级/二级/深.txt"])
        expect(沙箱文件内容(ALICE, project.id, "深度/一级/二级/深.txt")).toBe("很深")
      }),
    30_000,
  )

  it.live(
    "成员一份备份都没有（没 clone 过）⇒ 跳过，**不为它建空沙箱目录**；别人的那份照常回来",
    () =>
      Effect.gen(function* () {
        // 只有 ALICE 有文件：BOB 归档时一个对象都没传（`backupAll` 的跳过口径）。
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
        })

        出口接住了(yield* restoreAs(ALICE, { projectId: project.id }))

        expect(沙箱文件(projectDirOf(ALICE, project.id))).toEqual(["甲.txt"])
        // 「没有来源」与「来源说没有」是两件事：BOB 的沙箱里**不该凭空出现**一个空项目目录
        // （那会让他的文件树显示一个他从没有过的项目）。
        expect(existsSync(projectDirOf(BOB, project.id))).toBe(false)
      }),
    30_000,
  )

  it.live(
    "往返：找回之后还能再归档（`project_archive` 主键已存在 —— 那是**正常流程**不是异常）",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
        })

        出口接住了(yield* restoreAs(ALICE, { projectId: project.id }))
        expect(沙箱文件(projectDirOf(ALICE, project.id))).toEqual(["甲.txt"])

        // 再归档：`markArchived` 的 upsert 撞的是**已存在的那一行**（T013 的注释点名的场景）。
        const 再次 = yield* archiveAs(ALICE, { projectId: project.id })
        出口接住了(再次)
        expect(yield* json(Schema.Struct({ projectId: Schema.String, archived: Schema.Boolean }), 再次)).toEqual({
          projectId: project.id,
          archived: true,
        })
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
        yield* 仍是已归档(project.id)
      }),
    30_000,
  )

  it.live(
    "往返：二次归档清掉**已经不在沙箱里**的旧对象（不清的话，再找回时它静默复活）",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
          seedFile(ALICE, id, "乙.txt", "乙的")
        })

        出口接住了(yield* restoreAs(ALICE, { projectId: project.id }))
        expect(升序(沙箱文件(projectDirOf(ALICE, project.id)))).toEqual(升序(["甲.txt", "乙.txt"]))

        // 用户在沙箱里删掉乙 —— 这是**正常工作**：项目还在用，它的文件本来就会变。
        rmSync(path.join(projectDirOf(ALICE, project.id), "乙.txt"))

        // 再归档。备份的语义是「**此刻**沙箱的镜像」，不是「历次上传的并集」。
        出口接住了(yield* archiveAs(ALICE, { projectId: project.id }))

        // 被测属性：再找回时，回来的**就是再归档那一刻的沙箱**——乙不许出现。
        // （「复活」是最坏的一种错：用户删掉的东西自己回来了，而他没有做过任何「恢复」动作。）
        出口接住了(yield* restoreAs(ALICE, { projectId: project.id }))
        expect(升序(沙箱文件(projectDirOf(ALICE, project.id)))).toEqual(["甲.txt"])

        // 伴随信号：陈旧对象确实被清掉了（根因那一侧）。放后面——先钉用户看得见的后果
        // （`LEARNINGS #004-14`：被测属性在前，伴随信号在后）。
        expect(用户备份(project.id)).toEqual([`${ALICE.id}/${project.id}/甲.txt`])
      }),
    30_000,
  )
})

describe("T014 · 找回：标记最后落（次序是要求不是巧合）", () => {
  it.live(
    "下载失败 ⇒ 项目**仍是「已归档」**、沙箱不回来（先把 `archived` 改掉的那版会在第一条断言上红）",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
        })
        // 让**下载**（本项目键上的 `GET`）从第一个起就失败。`list` 是**桶级** GET（键为空），
        // 不在此列 —— 所以这条卡住的正是「取文件」，不是「查清单」。
        s3.failOn(500, (record) => record.method === "GET" && record.key.includes(project.id))

        const response = yield* restoreAs(ALICE, { projectId: project.id })

        // ① **被测属性**：标记没落（`archived_at` 非空 ⇔ `archived` 为真，由迁移那条 CHECK 绑死）。
        //    ⚠️ 判据写在 `archived_at` 上而不是状态码上：端点断言对顺序不敏感（`LEARNINGS #004-09`）
        //    —— 把 `markRestored` 挪到下载之前，状态码那条**照样红/绿**，只有这一条会变。
        yield* 仍是已归档(project.id)
        // ② 伴随信号：沙箱也没回来（下载失败，本来就不该有东西）。
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
        expect(response.ok).toBe(false)
      }),
    30_000,
  )
})

describe("T014 · 找回：谁不能找回（FR-009 手动 ＋ FR-010 owner 才留找回权）", () => {
  it.live(
    "成员不能找回（归档后已失权）：一个对象都没下载、两人的沙箱都还是空的、归档行没动",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
          seedFile(BOB, id, "乙.txt", "乙的")
        })
        const 下载前 = s3.requests.length

        const response = yield* restoreAs(BOB, { projectId: project.id })

        // 被测属性在前（`#004-14`）：**没有副作用**（沙箱没回来、没外呼），然后才是「它拒绝了」。
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
        expect(existsSync(projectDirOf(BOB, project.id))).toBe(false)
        expect(s3.requests.length).toBe(下载前)
        yield* 仍是已归档(project.id)
        expect(response.status).toBe(403)

        // ④ 也没变成「别人替我找回了」：列表里它还在「已归档」。
        expect((yield* listAs(ALICE)).find((entry) => entry.id === project.id)?.archived).toBe(true)
      }),
    30_000,
  )

  it.live(
    "非成员（外人）不能找回：零副作用、403",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
        })
        const 下载前 = s3.requests.length

        const response = yield* restoreAs(CAROL, { projectId: project.id })

        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
        expect(s3.requests.length).toBe(下载前)
        expect(response.status).toBe(403)
      }),
    30_000,
  )

  it.live(
    "**没归档**的项目「找回」：拒（`decide` 的 `restore` 在未归档时恒不成立）—— 否则会凭空建出一个空沙箱",
    () =>
      Effect.gen(function* () {
        // 建完就完，**不归档** ⇒ 目录还在、MinIO 里一个对象都没有。
        const project = yield* createAs(ALICE, { name: "还没归档的专案", type: "shared" })
        yield* joinProject(project.id, BOB)
        seedFile(ALICE, project.id, "甲.txt", "甲的")

        const response = yield* restoreAs(ALICE, { projectId: project.id })

        // 被测属性：**沙箱原样**（既没多也没少），然后才是状态码。
        expect(沙箱文件(projectDirOf(ALICE, project.id))).toEqual(["甲.txt"])
        expect(existsSync(projectDirOf(BOB, project.id))).toBe(false)
        expect(yield* 归档行(project.id)).toBeUndefined()
        expect(response.status).toBe(403)
      }),
    30_000,
  )
})

describe("T014 · 找回：`projectId` 要当路径段用（与归档同一条守卫）", () => {
  it.live(
    "`projectId` 是 `.` 且**它确实是这个人的 owner 项目、也确实已归档** ⇒ 400，且归档行原样（副作用是零）",
    () =>
      Effect.gen(function* () {
        // ⚠️ 观测面要**造出来**才能成立（与 T013 那条同因）：守卫若缺席，下面这些前置会让请求
        // **真的走下去** —— `projectId = "."` 过得了 `Minio` 的段检查（`.` 不是 `..`、不以 `/`
        // 开头、不是盘符、不含 `\`），于是 `join(root, userId, ".")` ＝ **整只沙箱**，
        // 而 `markRestored` 会把这一行翻成未归档。判据因此取「**那一行没被动过**」。
        yield* joinProject(".", ALICE, "owner")
        yield* Effect.promise(async () => {
          await pg?.db.execute(sql`
            insert into auth.project_archive (project_id, archived, archived_at)
            values ('.', true, ${nowSeconds()})
          `)
        })

        const response = yield* restoreAs(ALICE, { projectId: "." })

        // ① 被测属性：门拦在副作用之前 —— 归档行没被动过。
        yield* 仍是已归档(".")
        // ② 伴随信号：拒绝了（守卫缺席时这里是 200 —— 那条路会一路走到 `markRestored`）。
        expect(response.status).toBe(400)
      }),
    30_000,
  )
})

/**
 * **与归档侧逐条对齐的两条**（2026-10-06 审查 F1）。
 *
 * `handleRestore` 与 `handleArchive` 的前三步是同一套（身份 → 畸形体 → 路径段），而这两条**性质**
 * 在归档侧有测试、在找回侧此前**一条都没有**（`grep -c 401` 在本题测试文件里是 **0**）。
 * 补齐的理由是**出口级的对齐**：两个出口对「没身份」与「烂请求体」的对外表现应当一致。
 *
 * ⚠️ **但这两条钉住的东西不一样，别都当成「产品码被钉住了」**（2026-10-06 实测，`#003-03` 三类）：
 *
 * - **畸形体那条有牙**：把 `handleRestore` 的 `badRequest("请求体要带 projectId")` 删掉 ⇒
 *   **恰红 1**（`payload.value` 在 `None` 上抛 ⇒ 500，期望 400），其余 10 条全绿。
 * - **401 那条没有牙，而且是结构性的**：把 `handleRestore` 的
 *   `if (Option.isNone(user)) return unauthorized()` **整行删掉** ⇒ **11 条全绿**
 *   （`-unconfigured` 那 3 条另跑也全绿）。原因不在测试写错，而在**那条分支不可达**：
 *   `user-identity.ts` 中间件在进 handler **之前**就把无身份请求回成 401
 *   （`middleware/user-identity.ts` 的 `if (!user) return HttpServerResponse.empty({ status: UNAUTHORIZED })`），
 *   而 `OpenhiveArchive.routes` 全仓**只有一个挂载点**（`httpapi/server.ts`，且就在那条链里）。
 * - **归档侧同形**（一并实测）：把 `handleArchive` 的同一行删掉 ⇒ 归档两文件 **18 条全绿**
 *   ⇒ **T013 那条 401 用例当时钉住的也是中间件**，不是它自己的守卫。这条更正了 T013 收尾时的
 *   理解（当时把它读成「handler 的守卫被钉住了」）。
 *
 * ⇒ 结论：401 那条**保留**（它如实断言了「这个出口对无身份请求回 401 且零副作用」——那是中间件
 * 给的、但确实是出口级的真性质，将来中间件豁免表一变它就是第一道网），**但 handler 里那行守卫本身
 * 是「纵深防御」而非被测行为**，已挂进 `state.md` 的缺口表（`#002-02`：测不到的写成缺口，不许
 * 写成覆盖）。**没有删那行**：它与 `handleArchive` 逐条同形是整条链的骨架，单删一侧会让两个
 * handler 悄悄分叉（那正是本文件头引的 `#002-06`）。
 *
 * ⚠️ 两条都**不是 RED-first 写的**（产品码先就有），据实说明；成牙证据取上面的变异。
 */
describe("T014 · 找回：失败与畸形输入都留不下半个状态（与归档侧对齐）", () => {
  it.live(
    "不带凭证：找回回 401，且零副作用（归档行没动、没外呼、沙箱没回来）",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
        })
        const 下载前 = s3.requests.length

        // 不带 Cookie 直达出口（与归档侧那条同形：`as()` 会注入身份，这里**刻意不注入**）。
        // ⚠️ 这个 401 由**中间件**给出、不是 `handleRestore` 里那行守卫（详见本 describe 的头注）。
        const response = yield* openApp(RESTORE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })

        // 被测属性在前（`#004-14`）：零副作用，然后才是「它拒绝了」。
        yield* 仍是已归档(project.id)
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
        expect(s3.requests.length).toBe(下载前)
        expect(response.status).toBe(401)
      }),
    30_000,
  )

  it.live(
    "体是畸形 JSON（或没有 projectId）⇒ 400，且零副作用（没外呼、归档行没动）",
    () =>
      Effect.gen(function* () {
        const project = yield* 已归档项目(({ id }) => {
          seedFile(ALICE, id, "甲.txt", "甲的")
        })
        const 下载前 = s3.requests.length

        const 畸形 = yield* as(openApp, ALICE, RESTORE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{不是 JSON",
        })
        const 缺字段 = yield* restoreAs(ALICE, { name: "没有 projectId" })

        expect(畸形.status).toBe(400)
        expect(缺字段.status).toBe(400)
        // 400 和 403 都可能「拒了但顺手干了点事」⇒ 零副作用要单独钉（`#004-09`：端点判据对
        // 副作用完全不敏感）。
        expect(s3.requests.length).toBe(下载前)
        yield* 仍是已归档(project.id)
        expect(existsSync(projectDirOf(ALICE, project.id))).toBe(false)
      }),
    30_000,
  )
})
