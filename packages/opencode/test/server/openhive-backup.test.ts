import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { listBackupEvents } from "@opencode-ai/auth/project-backup-event"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { type FakeS3, startFakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { AnchorWorkspace } from "../../src/server/routes/instance/httpapi/middleware/anchor-workspace"
import { userIdentityLayer } from "../../src/server/routes/instance/httpapi/middleware/user-identity"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { OpenhiveArchive } from "../../src/server/openhive/archive"
import { OpenhiveBackup } from "../../src/server/openhive/backup"
import { OpenhivePg } from "../../src/server/openhive/pg"
import { QUOTA_BYTES, STATE_VERSION } from "../../src/server/openhive/backup-model"
import { openBackupStore } from "../../src/server/openhive/backup-store"
import { testEffect } from "../lib/effect"

/**
 * Task 11（spec §10.1）：**文件级备份快照的 HTTP 出口**。
 *
 * ## harness 与 `openhive-project-archive.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 真 JWT ＋ 假 S3 真 HTTP 端点），故整套约法照抄、
 * 只换判据点：`OPENHIVE_DATA_ROOT` 只能走 `process.env`、身份走 cookie 不走自造头、
 * `ConfigProvider` 递的 env 对 Effect 配置服务生效（`OPENHIVE_WORKSPACE_ROOT` 与
 * `OPENHIVE_MINIO_*` 都走这条）。
 *
 * ## ⚠️ 一个文件**只建一个 app**
 *
 * 归档测试文件头记过实测：**除进程里第一条 HTTP 请求外，任何新 app 的第一条 PG 查询都会撞一次
 * `Connection closed`**（随后自愈）。所以「MinIO 没配 ⇒ 503」那条住在
 * `openhive-backup-unconfigured.test.ts`，本文件只建这一个 app。
 *
 * ## 本文件**自己**把 `OpenhiveBackup.routes` 合进应用
 *
 * Task 11 只产出 `routes`，`server.ts` 的接线是 Task 12 的事。若直接抄 `HttpApiApp.routes`，
 * 本文件会在「出口没挂上」之外多红一层「Task 12 还没做」——RED 的根因就说不清了。
 * 于是这里用 `Layer.merge` 把备份层与既有应用并起来，`Layer.provide` 与 Task 12 将写的那几行
 * 逐项一致（少供一个服务是**层构造期炸**，不是静默回退）。
 *
 * ## 「未挂载」在本应用里**不是 404**
 *
 * 没被路由接管的路径落进 SPA 兜底，回 **200 ＋ `text/html`**。⇒ `json()` 把判据前移到
 * **`Content-Type`**，状态码只当伴随信号（`LEARNINGS #004-14`）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
/** 有身份、但不是任何项目的成员——「非成员 ⇒ 403」那条专用。 */
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/** 出口路径（**客户端契约**，写**字面量**、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const BACKUP = "/openhive/project/backup"
const HEARTBEAT = "/openhive/project/backup/heartbeat"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-backup-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（理由见同族测试的同款注释）。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用的测试必须像一次真部署那样把口令配上（T020 起）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

/** 假 S3 必须在 `openApp` 之前起来（配置服务在**层构造期**取值）。 */
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

/** 每个用例后还原假时钟（`setSystemTime` 影响整个进程）。 */
afterEach(() => setSystemTime())

const MINIO = {
  OPENHIVE_MINIO_ENDPOINT: s3.endpoint,
  OPENHIVE_MINIO_BUCKET: s3.bucket,
  OPENHIVE_MINIO_ACCESS_KEY: "k",
  OPENHIVE_MINIO_SECRET_KEY: "s",
  OPENHIVE_MINIO_USE_SSL: "false",
} as const

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
  ...MINIO,
}

/**
 * 备份层与应用层并起来。三层 `Layer.provide` 与 Task 12 将写进 `server.ts` 的那几行同源：
 * `MinioConfig` 是备份自己的配置服务；沙箱根复用 `AnchorWorkspace.Config`（只有一处定义）；
 * `OpenhivePg.layer` 是**模块级同一个值** ⇒ 与既有 openhive 出口共用同一个 PG 客户端。
 */
const backupRoutes = OpenhiveBackup.routes.pipe(
  Layer.provide(OpenhiveArchive.MinioConfig.layer),
  Layer.provide(AnchorWorkspace.Config.layer),
  Layer.provide(OpenhivePg.layer),
  // Task 12 接线时，这几道全局中间件在 `server.ts` 顶层 provide 链里、包住**所有**路由；
  // 本文件单独合并备份层，所以要把**同一个** `userIdentityLayer` 值也供在备份层上——
  // 复刻「请求期注入 `User`」这一环。不供它 ⇒ 备份路由拿不到身份，一律 401（实测）。
  Layer.provide(
    userIdentityLayer.pipe(Layer.provide(UserIdentity.Config.layer), Layer.provide(DatabaseRouter.layer())),
  ),
)

const appRoutes = Layer.merge(HttpApiApp.routes, backupRoutes)

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(appRoutes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))), {
    disableLogger: true,
  }).handler

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

/** 读 JSON 体。**先断内容类型**——「未挂载」在本应用里落进 SPA 兜底、回 200 ＋ `text/html`。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
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

/** 列表项的**线上形状**（逐字写字段名当契约钉死——`#003-05`）。 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  archived: Schema.optional(Schema.Boolean),
})

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

/** POST 请求的固定形状（`Content-Type` 必须写，否则 `request.json` 直接失败）。 */
const 体 = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
})

/**
 * 新建一个有 owner、有文件的项目。**每个用例一个项目**——快照列表的断言才有干净的观测面。
 *
 * 建项目走**真实出口**（`createAs`），不要直接写 `project_member`：那会绕过生产注册链
 * （`#006-28`），而且项目目录归 `createAs` 那一步建好；这里只往里放两个文件当**输入**。
 */
const 新项目 = () =>
  Effect.gen(function* () {
    const project = yield* createAs(ALICE, {
      name: `备份·${Date.now()}·${crypto.randomUUID().slice(0, 6)}`,
      type: "private",
    })
    const directory = path.join(WORKSPACE_ROOT, ALICE.id, project.id)
    mkdirSync(path.join(directory, "资料"), { recursive: true })
    writeFileSync(path.join(directory, "资料", "甲.txt"), "aaa")
    writeFileSync(path.join(directory, "报告.docx"), "ccc")
    return { projectId: project.id, directory }
  })

const PreviewWire = Schema.Struct({
  counts: Schema.Struct({
    missing: Schema.Number,
    same: Schema.Number,
    different: Schema.Number,
    "type-mismatch": Schema.Number,
  }),
})

const RestoreWire = Schema.Struct({
  restored: Schema.Array(Schema.String),
  keptBoth: Schema.Array(Schema.String),
  overwritten: Schema.Array(Schema.String),
  skipped: Schema.Array(Schema.String),
  cancelled: Schema.Boolean,
})

/** `GET /jobs/{id}` 的线上形状（只收本文件要断的字段，别的会被 Schema 丢掉）。 */
const JobWire = Schema.Struct({
  state: Schema.String,
  error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })),
  result: Schema.optional(
    Schema.Struct({
      snapshotId: Schema.optional(Schema.String),
      preview: Schema.optional(PreviewWire),
      restore: Schema.optional(RestoreWire),
    }),
  ),
})

/** 轮询到终态。**等条件不等时间**（`#006-31`）：200 次 × 50ms ＝ 上限 10 秒。 */
const 等到终态 = (jobId: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i += 1) {
      const 响应 = yield* as(openApp, ALICE, `${BACKUP}/jobs/${jobId}`)
      expect(响应.status).toBe(200)
      const job = yield* json(JobWire, 响应)
      if (job.state === "succeeded" || job.state === "failed" || job.state === "cancelled") return job
      yield* Effect.sleep("50 millis")
    }
    return yield* Effect.fail(new Error("任务 10 秒内没有进入终态"))
  })

const 快照列表 = (projectId: string) =>
  Effect.gen(function* () {
    const 响应 = yield* as(openApp, ALICE, `${BACKUP}/snapshots?projectId=${projectId}`)
    expect(响应.status).toBe(200)
    return yield* json(
      Schema.Struct({
        snapshots: Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.String, scope: Schema.String })),
        truncated: Schema.Boolean,
      }),
      响应,
    )
  })

/** 等到至少出现 N 份快照（自动备份是异步的，**等条件不等时间**）。 */
const 等快照数 = (projectId: string, 数: number) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i += 1) {
      const 列表 = yield* 快照列表(projectId)
      if (列表.snapshots.length >= 数) return 列表.snapshots
      yield* Effect.sleep("50 millis")
    }
    return yield* Effect.fail(new Error(`10 秒内没有等到 ${数} 份快照`))
  })

/** 升序比较（必须给 compare：`.sort()` 不给会被 `require-array-sort-compare` 记一条）。 */
const 升序 = (values: readonly string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * 起一次预览任务并等到终态。`path` 给定时只比那一份（`.git/**` 也在快照里——spec §5.3
 * 要求整份版本库进快照——整项目预览的 `same` 会被它淹掉，实测 20）。
 */
const 预览 = (projectId: string, snapshotId: string, path?: string) =>
  Effect.gen(function* () {
    const 起 = yield* as(
      openApp,
      ALICE,
      `${BACKUP}/restore/preview`,
      体({ projectId, snapshotId, ...(path === undefined ? {} : { path }) }),
    )
    expect(起.status).toBe(202)
    const job = yield* 等到终态((yield* json(Schema.Struct({ jobId: Schema.String }), 起)).jobId)
    expect(job.state).toBe("succeeded")
    return job
  })

describe("Task 11 · 备份成功链（202 ＋ 轮询 ＋ 恢复点清单与文件明细）", () => {
  it.live(
    "POST /backup ⇒ 202 + jobId；succeeded 后能列出快照、读到文件清单、审计落 12 列",
    () =>
      Effect.gen(function* () {
        const project = yield* 新项目()

        const 起 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
        expect(起.status).toBe(202)
        const { jobId } = yield* json(Schema.Struct({ jobId: Schema.String }), 起)

        const job = yield* 等到终态(jobId)
        expect(job.state).toBe("succeeded")
        expect(job.result?.snapshotId).toBeTruthy()

        const 列 = yield* 快照列表(project.projectId)
        expect(列.truncated).toBe(false)
        expect(列.snapshots).toHaveLength(1)
        expect(列.snapshots[0]?.kind).toBe("manual")

        const 明细 = yield* as(
          openApp,
          ALICE,
          `${BACKUP}/snapshots/${列.snapshots[0].id}?projectId=${project.projectId}`,
        )
        expect(明细.status).toBe(200)
        const 清单 = yield* json(Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) }), 明细)
        // `.git/**` 是 `createAs` 的 `git init` 带来的**固定噪音**（备份不排除 `.git`，spec §5.3），
        // 与归档测试的 `沙箱文件` 同一条过滤理由。
        expect(升序(清单.files.map((file) => file.path).filter((p) => !p.startsWith(".git/")))).toEqual([
          "报告.docx",
          "资料/甲.txt",
        ])

        // 审计走 12 列接口（spec §9.3）：动作是 `backup`、结局 `ok`、带 kind / snapshotId。
        // 这条同时钉住「不写进 detail JSON」——旧接口根本没有 kind / result 这两列。
        const 事件 = yield* Effect.promise(() => listBackupEvents(pg!.db, project.projectId))
        const 备份 = 事件.find((event) => event.action === "backup")
        expect(备份?.result).toBe("ok")
        expect(备份?.kind).toBe("manual")
        expect(备份?.snapshot_id).toBe(job.result?.snapshotId)
        expect(备份?.files).toBeGreaterThanOrEqual(2)
      }),
    30_000,
  )

  it.live("同一项目的第二个并发手动备份 ⇒ 其中一个 409 job_running（单飞）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      // **并发**发两条：串行发的话第一个可能已经跑完，锁就观测不到了。
      const [a, b] = yield* Effect.all(
        [
          as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId })),
          as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId })),
        ],
        { concurrency: 2 },
      )
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([202, 409])
      const 冲突 = a.status === 409 ? a : b
      const body = yield* json(Schema.Struct({ code: Schema.String, jobId: Schema.String }), 冲突)
      expect(body.code).toBe("job_running")
      expect(body.jobId.length).toBeGreaterThan(0)
    }),
    30_000,
  )
})

describe("Task 11 · 授权三态与路径守卫", () => {
  it.live("非成员 ⇒ 403；没有身份 ⇒ 401；projectId 非法 ⇒ 400", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()

      // BOB 有身份、不是这个项目的成员。
      const 外人 = yield* as(openApp, BOB, BACKUP, 体({ projectId: project.projectId }))
      expect(外人.status).toBe(403)
      // 拒绝要说得清（JSON 体）：`json()` 先断内容类型。
      expect((yield* json(Schema.Struct({ error: Schema.String }), 外人)).error.length).toBeGreaterThan(0)

      // 不带 cookie：直接走 `openApp`，不经 `as`。
      const 匿名 = yield* openApp(BACKUP, 体({ projectId: project.projectId }))
      expect(匿名.status).toBe(401)

      const 非法 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: "../x" }))
      expect(非法.status).toBe(400)
      expect((yield* json(Schema.Struct({ code: Schema.String }), 非法)).code).toBe("bad_request")
    }),
    30_000,
  )

  it.live("范围不存在 ⇒ 400（不许开一个必失败的任务）；别人的任务 id ⇒ 404", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()

      const 缺 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId, path: "没有这个目录" }))
      // spec §10.3：路径不存在归 400 bad_request（不是先开任务再失败）。
      expect(缺.status).toBe(400)
      expect((yield* json(Schema.Struct({ code: Schema.String }), 缺)).code).toBe("bad_request")

      // 别人的任务 id：即使猜到了也读不到（`jobs.get` 按 userId 过滤）。
      const 别人 = yield* as(openApp, BOB, `${BACKUP}/jobs/00000000-0000-4000-8000-000000000000`)
      expect(别人.status).toBe(404)
      expect((yield* json(Schema.Struct({ code: Schema.String }), 别人)).code).toBe("not_found")
    }),
    30_000,
  )
})

describe("Task 11 · 自动备份的暂停与冷却", () => {
  it.live("state 已 autoPaused ⇒ 心跳不拍；同批未暂停的对照项目照常拍（证明机制是活的）", () =>
    Effect.gen(function* () {
      const 暂停 = yield* 新项目()
      const 对照 = yield* 新项目()

      // 造「暂停、但用量已降回 0」的态：若实现只看用量、不看 autoPaused，就会照拍 ⇒ 红。
      // 这也是真实序列——超限暂停后用户删掉恢复点，暂停标志保留到每日清扫（spec §8.3）。
      yield* Effect.promise(async () => {
        const store = openBackupStore({
          endpoint: s3.endpoint,
          bucket: s3.bucket,
          credentials: { accessKeyId: MINIO.OPENHIVE_MINIO_ACCESS_KEY, secretAccessKey: MINIO.OPENHIVE_MINIO_SECRET_KEY },
          userId: ALICE.id,
          projectId: 暂停.projectId,
        })
        await store.writeState({
          version: STATE_VERSION,
          usageBytes: 0,
          lastGcAt: 0,
          autoPaused: true,
          snapshots: [],
        })
      })

      for (const project of [暂停, 对照]) {
        const 响应 = yield* as(openApp, ALICE, HEARTBEAT, 体({ projectId: project.projectId }))
        expect(响应.status).toBe(204)
      }

      // 对照项目：自动快照真的出现了（「暂停项目没有快照」这条才有判别力）。
      expect((yield* 等快照数(对照.projectId, 1))[0]?.kind).toBe("auto")
      // 再给暂停项目一拍的时间，仍然一份都没有。
      yield* Effect.sleep("500 millis")
      expect((yield* 快照列表(暂停.projectId)).snapshots).toEqual([])
    }),
    30_000,
  )

  it.live("用量已到上限、autoPaused 还没置位 ⇒ 心跳把暂停标志写回，且一份快照都不拍（spec §8.3）", () =>
    Effect.gen(function* () {
      // ⚠️ 这个项目**刻意是空树**（不写任何文件）：`runBackup` 的配额判据是
      //    `usage + 本次计划字节 > QUOTA`，空树计划字节为 0 ⇒ 即便「不提前跳过」也**不会**抛
      //    `QuotaError`、而是照拍一张 0 文件的快照。这样「detect 是否真按用量提前跳过」才有
      //    可观测差别（有文件时两条路都收敛到 QuotaError ⇒ 变异验证抓不到，`LEARNINGS #003-03`）。
      const created = yield* createAs(ALICE, {
        name: `备份·满额·${Date.now()}·${crypto.randomUUID().slice(0, 6)}`,
        type: "private",
      })
      const project = { projectId: created.id }
      const directory = path.join(WORKSPACE_ROOT, ALICE.id, project.projectId)
      mkdirSync(directory, { recursive: true })
      // 建项目时 register 链会 `git init`（~24 个 `.git` 文件，且 `.git` 不在排除表里）。
      // 这些文件会让「不提前跳过」也撞 `QuotaError` ⇒ 两条路收敛到同一个可观测结局。
      // 删掉它们，树真的是 0 文件：提前跳过 ⇒ 什么都不发生；不跳过 ⇒ 0 字节计划放行、照拍一张空快照。
      rmSync(path.join(directory, ".git"), { recursive: true, force: true })

      // 造「用量越限、暂停标志还没落」的态：若 detect 只看 autoPaused、不看用量，就会照拍 ⇒ 红。
      const store = yield* Effect.promise(async () => {
        const store = openBackupStore({
          endpoint: s3.endpoint,
          bucket: s3.bucket,
          credentials: {
            accessKeyId: MINIO.OPENHIVE_MINIO_ACCESS_KEY,
            secretAccessKey: MINIO.OPENHIVE_MINIO_SECRET_KEY,
          },
          userId: ALICE.id,
          projectId: project.projectId,
        })
        await store.writeState({
          version: STATE_VERSION,
          usageBytes: QUOTA_BYTES,
          lastGcAt: 0,
          autoPaused: false,
          snapshots: [],
        })
        return store
      })

      expect((yield* as(openApp, ALICE, HEARTBEAT, 体({ projectId: project.projectId }))).status).toBe(204)
      // 等一拍（checkNow 是异步的），再断言「没拍」与「暂停已落」。
      yield* Effect.sleep("500 millis")
      expect((yield* 快照列表(project.projectId)).snapshots).toEqual([])
      const 态 = yield* Effect.promise(() => store.readState())
      expect(态?.autoPaused).toBe(true)
    }),
    30_000,
  )

  it.live("手动成功 ⇒ noteBackup 把冷却起点拨到现在（删掉 noteBackup 会多出一份自动快照）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()

      // ① 首拍：项目打开时立即检查一次（绕过冷却）⇒ 自动快照 1。
      expect((yield* as(openApp, ALICE, HEARTBEAT, 体({ projectId: project.projectId }))).status).toBe(204)
      expect((yield* 等快照数(project.projectId, 1))[0]?.kind).toBe("auto")

      // ② 时间推进 2 小时：1 小时冷却已过。
      const 真实 = Date.now()
      setSystemTime(new Date(真实 + 2 * 60 * 60 * 1000))
      try {
        // ③ 改树 ⇒ 手动备份成功（成功后必须 noteBackup，把 lastAutoAt 拨到「现在」）。
        writeFileSync(path.join(project.directory, "手动前.txt"), "1")
        const 起 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
        expect(起.status).toBe(202)
        const { jobId } = yield* json(Schema.Struct({ jobId: Schema.String }), 起)
        expect((yield* 等到终态(jobId)).state).toBe("succeeded")

        // ④ 再改树：让「树没变」这条挡箭牌不成立（否则少了 noteBackup 也拍不出新快照，测不出来）。
        writeFileSync(path.join(project.directory, "自动前.txt"), "2")
        // ⑤ 再心跳：冷却未到 ⇒ **不**拍。
        expect((yield* as(openApp, ALICE, HEARTBEAT, 体({ projectId: project.projectId }))).status).toBe(204)
        yield* Effect.sleep("1 second")

        const 列 = yield* 快照列表(project.projectId)
        expect(升序(列.snapshots.map((snapshot) => snapshot.kind))).toEqual(["auto", "manual"])
      } finally {
        setSystemTime()
      }
    }),
    30_000,
  )
})

describe("Task 11 · 预览 / 恢复 / 删除恢复点", () => {
  it.live("改一个文件 ⇒ 预览报 different；覆盖恢复把内容写回；删除恢复点后清单为空", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()

      const 起 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
      expect(起.status).toBe(202)
      const { jobId } = yield* json(Schema.Struct({ jobId: Schema.String }), 起)
      const 备份任务 = yield* 等到终态(jobId)
      expect(备份任务.state).toBe("succeeded")
      const snapshotId = 备份任务.result?.snapshotId ?? ""
      expect(snapshotId.length).toBeGreaterThan(0)

      // 改内容：预览必须报「有差异」；没改的那份仍是 same（两个状态各由一份文件钉住）。
      writeFileSync(path.join(project.directory, "报告.docx"), "已经被改过")
      const 改过的 = yield* 预览(project.projectId, snapshotId, "报告.docx")
      expect(改过的.result?.preview?.counts.different).toBe(1)
      expect(改过的.result?.preview?.counts.same).toBe(0)
      const 没改的 = yield* 预览(project.projectId, snapshotId, "资料/甲.txt")
      expect(没改的.result?.preview?.counts.same).toBe(1)
      expect(没改的.result?.preview?.counts.different).toBe(0)

      // 覆盖恢复：内容回到快照里的那份。
      const 恢复起 = yield* as(
        openApp,
        ALICE,
        `${BACKUP}/restore`,
        体({ projectId: project.projectId, snapshotId, decision: "overwrite" }),
      )
      expect(恢复起.status).toBe(202)
      const 恢复任务 = yield* 等到终态((yield* json(Schema.Struct({ jobId: Schema.String }), 恢复起)).jobId)
      expect(恢复任务.state).toBe("succeeded")
      expect(readFileSync(path.join(project.directory, "报告.docx"), "utf8")).toBe("ccc")

      // 删除恢复点：只删 manifest（blob 交 GC，spec §8.2）。
      const 删 = yield* as(
        openApp,
        ALICE,
        `${BACKUP}/snapshots/${snapshotId}?projectId=${project.projectId}`,
        { method: "DELETE" },
      )
      expect(删.status).toBe(200)
      expect(yield* json(Schema.Struct({ deleted: Schema.Boolean }), 删)).toEqual({ deleted: true })
      expect((yield* 快照列表(project.projectId)).snapshots).toEqual([])
      const 再读 = yield* as(openApp, ALICE, `${BACKUP}/snapshots/${snapshotId}?projectId=${project.projectId}`)
      expect(再读.status).toBe(404)
    }),
    30_000,
  )
})
