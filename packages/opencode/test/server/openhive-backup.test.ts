import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect"
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
import { OpenhiveArchive, type MinioSettings } from "../../src/server/openhive/archive"
import { OpenhiveBackup } from "../../src/server/openhive/backup"
import { OpenhivePg } from "../../src/server/openhive/pg"
import { QUOTA_BYTES, STATE_VERSION, type Manifest } from "../../src/server/openhive/backup-model"
import { sharedJobs } from "../../src/server/openhive/backup-jobs"
import { CancelledError } from "../../src/server/openhive/backup-run"
import { createAutoScheduler } from "../../src/server/openhive/backup-auto"
import { snapshotIdOf } from "../../src/server/openhive/backup-rules"
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
 * ## 路由接线：Task 12 起走生产应用
 *
 * Task 11 时本文件用 `Layer.merge(HttpApiApp.routes, backupRoutes)` 自己并了一层；Task 12 把
 * `OpenhiveBackup.routes` 挂进了 `server.ts` 的同一个 `Layer.mergeAll` 与顶层 provide 链，
 * 再 merge 就是同一批路由注册两次（实测 `Method 'POST' already declared for route
 * '/openhive/project/backup'`）。现在只把**测试上限**经 `createRoutes` 的第二个参数注入。
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
const ARCHIVE = "/openhive/project/archive"
const BACKUP = "/openhive/project/backup"
const HEARTBEAT = "/openhive/project/backup/heartbeat"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-backup-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/**
 * 注入的小上限（fix round 1 · I-4）：生产 `QUOTA_BYTES` 是 10 GiB，本机造不出「逻辑大小之和
 * 超过上限」的真实文件。`routesWithQuota(TEST_QUOTA)` 只换上限**数值**，spec §8.3 的公式
 * （`缺失 blob 之和 + ceil(logicalBytes / 20)`）一个字不改——生产默认仍是 `QUOTA_BYTES`。
 */
const TEST_QUOTA = 1024 * 1024

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
 * Task 12 起备份路由已由 `server.ts` 挂进生产应用（顶层 provide 链包住，含身份门）。
 * 本文件只需要把**上限**换掉：`createRoutes` 的第二个参数就是为此留的
 * （`routesWithQuota` 只换数值，spec §8.3 的公式一个字不改）。
 *
 * ⚠️ **不再 `Layer.merge(HttpApiApp.routes, backupRoutes)`**：那会让同一批路由注册两次
 * （层构造期 `Method 'POST' already declared for route '/openhive/project/backup'`）。
 * 身份也不用再单独供——顶层链里的 `userIdentityLayer` 已经包住全部路由。
 */
const backupRoutes = OpenhiveBackup.routesWithQuota(TEST_QUOTA).pipe(
  Layer.provide(OpenhiveArchive.MinioConfig.layer),
  Layer.provide(AnchorWorkspace.Config.layer),
  Layer.provide(OpenhivePg.layer),
)

const appRoutes = HttpApiApp.createRoutes(undefined, backupRoutes)

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

const MINIO_SETTINGS: MinioSettings = {
  endpoint: s3.endpoint,
  bucket: s3.bucket,
  accessKeyId: MINIO.OPENHIVE_MINIO_ACCESS_KEY,
  secretAccessKey: MINIO.OPENHIVE_MINIO_SECRET_KEY,
  useSSL: false,
}

const 连接 = Option.some(MINIO_SETTINGS)

/** 与生产同一条拼法（`endpointOf` 在 `storeOf` 里做；这里直接给带协议的 endpoint）。 */
const 存储 = (projectId: string) =>
  openBackupStore({
    endpoint: s3.endpoint,
    bucket: s3.bucket,
    credentials: {
      accessKeyId: MINIO.OPENHIVE_MINIO_ACCESS_KEY,
      secretAccessKey: MINIO.OPENHIVE_MINIO_SECRET_KEY,
    },
    userId: ALICE.id,
    projectId,
  })

const StatusWire = Schema.Struct({
  activeJob: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  usageBytes: Schema.Number,
  limitBytes: Schema.Number,
  autoPaused: Schema.Boolean,
})

const statusOf = (projectId: string) =>
  Effect.gen(function* () {
    const 响应 = yield* as(openApp, ALICE, `${BACKUP}/status?projectId=${projectId}`)
    expect(响应.status).toBe(200)
    return yield* json(StatusWire, 响应)
  })

/** 起一次手动备份并等到终态（成功链的公共前奏）。 */
const 手动备份 = (projectId: string) =>
  Effect.gen(function* () {
    const 起 = yield* as(openApp, ALICE, BACKUP, 体({ projectId }))
    expect(起.status).toBe(202)
    const { jobId } = yield* json(Schema.Struct({ jobId: Schema.String }), 起)
    return { jobId, job: yield* 等到终态(jobId) }
  })

/** 等 state 的 `autoPaused` 变成期望值（**等条件不等时间**，`#006-31`）。 */
const 等暂停值 = (store: ReturnType<typeof 存储>, 期望: boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i += 1) {
      const 态 = yield* Effect.promise(() => store.readState())
      if (态?.autoPaused === 期望) return 态
      yield* Effect.sleep("50 millis")
    }
    return yield* Effect.fail(new Error(`10 秒内 autoPaused 没有变成 ${期望}`))
  })

/** 一条被捕获的结构化日志（`console.info("[openhive-backup]", {...})`）。 */
type 日志行 = { readonly 标签: unknown; readonly 载荷?: Record<string, unknown> }

/** 等一条结构化日志出现（**等条件不等时间**；日志在终态之后才写的落点用它）。 */
const 等日志 = (记录: readonly 日志行[], 取: (载荷: Record<string, unknown>) => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i += 1) {
      const 行 = 记录.find(
        (entry) => entry.标签 === "[openhive-backup]" && entry.载荷 !== undefined && 取(entry.载荷),
      )
      if (行 !== undefined) return 行
      yield* Effect.sleep("25 millis")
    }
    return yield* Effect.fail(new Error("10 秒内没有等到结构化日志"))
  })

/** 空树项目（建项目会 `git init` ⇒ 先删 `.git`，让「拍出来的是 0 文件快照」可观测）。 */
const 空项目 = () =>
  Effect.gen(function* () {
    const created = yield* createAs(ALICE, {
      name: `备份·空树·${Date.now()}·${crypto.randomUUID().slice(0, 6)}`,
      type: "private",
    })
    const directory = path.join(WORKSPACE_ROOT, ALICE.id, created.id)
    mkdirSync(directory, { recursive: true })
    rmSync(path.join(directory, ".git"), { recursive: true, force: true })
    return { projectId: created.id, directory }
  })

/** 一份合法的旧自动清单（每日清扫用例的输入）。 */
function 旧自动清单(projectId: string, id: string, createdAt: number): Manifest {
  return {
    version: 1,
    id,
    projectId,
    ownerId: ALICE.id,
    kind: "auto",
    scope: "",
    createdAt,
    createdBy: ALICE.id,
    source: "auto",
    timezone: "UTC",
    status: "complete",
    files: [],
    dirs: [],
    skipped: [],
    totals: { files: 0, bytes: 0, uploadedBytes: 0, skipped: 0 },
  }
}

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
  failed: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
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

  /**
   * **删除期间的占位锁**（Task 12 fix round 1 · I-2，spec §5.8 末条）：项目删除会 `hold` 住
   * 每个成员 × 项目，挡住**新**任务。此时 `start` 回 `resumed` 但没有任务对象 ⇒ 409 响应体
   * **不带 `jobId`**（客户端 `jobId?` 本来就是可选，不给它一个假的去轮询）。
   */
  it.live("删除占位（hold）期间 ⇒ POST /backup 回 409，响应体不带 jobId", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const 放 = sharedJobs.hold(ALICE.id, project.projectId)
      expect(放, "占位应当拿到 release（此前没有持有者）").toBeDefined()
      try {
        const 响应 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
        expect(响应.status).toBe(409)
        const 响应体 = yield* json(
          Schema.Struct({ code: Schema.String, jobId: Schema.optional(Schema.String) }),
          响应,
        )
        expect(响应体.code).toBe("job_running")
        expect(响应体.jobId, "被删除占位挡住时不该给出 jobId").toBeUndefined()
      } finally {
        放?.()
      }
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
  it.live("自动暂停后用量降到上限以下 ⇒ 下一次检查清空 autoPaused 并照常拍（spec §8.3 末条）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const store = 存储(project.projectId)

      // 真实序列：超限暂停后用户删掉恢复点 ⇒ 用量降回 0、暂停标志还留着。
      // 旧实现到这里就 `return`（标志保留到每日清扫）⇒ 一份都不拍、标志一直是 true（RED）。
      yield* Effect.promise(() =>
        store.writeState({
          version: STATE_VERSION,
          usageBytes: 0,
          lastGcAt: 0,
          autoPaused: true,
          snapshots: [],
        }),
      )

      expect((yield* as(openApp, ALICE, HEARTBEAT, 体({ projectId: project.projectId }))).status).toBe(204)

      // 新判据：用量已降回 ⇒ 这一次检查真的拍了一张，并把暂停标志清空。
      expect((yield* 等快照数(project.projectId, 1))[0]?.kind).toBe("auto")
      yield* 等暂停值(store, false)
    }),
    30_000,
  )

  it.live("用量恰好等于上限（不是大于）⇒ 不暂停、照常拍（`>` 口径，M-2）", () =>
    Effect.gen(function* () {
      // 空树 ⇒ 计划字节为 0：`>` 口径下 `usage + 0 > quota` 不成立，应当照拍；
      // 旧实现 `usageBytes >= QUOTA_BYTES` ⇒ 提前暂停、一份都不拍（RED）。
      const project = yield* 空项目()
      const store = 存储(project.projectId)
      yield* Effect.promise(() =>
        store.writeState({
          version: STATE_VERSION,
          // 应用侧注入的上限是 `TEST_QUOTA`（I-4），等号判据要对着**这个**上限量。
          usageBytes: TEST_QUOTA,
          lastGcAt: 0,
          autoPaused: false,
          snapshots: [],
        }),
      )

      expect((yield* as(openApp, ALICE, HEARTBEAT, 体({ projectId: project.projectId }))).status).toBe(204)

      expect((yield* 等快照数(project.projectId, 1))[0]?.kind).toBe("auto")
      yield* 等暂停值(store, false)
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
          // M-2 统一 `>`：恰好等于上限**不算**越限（边界那条用例钉住等号），
          // 所以这里要造「真越限」＝上限 + 1。上限取注入的 `TEST_QUOTA`。
          usageBytes: TEST_QUOTA + 1,
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

// ─────────────────────────────────────────────────────────────────────────────
// Fix round 1（复审提交的 I-1…I-5 / M-1…M-5）
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix round 1 · 自动备份进共享单飞锁（I-1 / §7.3）与取消（I-5.3）", () => {
  it.live(
    "自动备份进行中 activeFor 非空、手动 409；HTTP 取消 ⇒ cancelled ＋ 审计 cancelled ＋ lastAutoAt 保持",
    () =>
      Effect.gen(function* () {
        const project = yield* 新项目()
        const 固定 = Date.now()
        const scheduler = createAutoScheduler({
          now: () => 固定,
          isRunning: (userId, projectId) => sharedJobs.activeFor(userId, projectId) !== undefined,
          // 注入一个「阻塞到收到取消」的假执行器：不 sleep 等时间，等条件（`#006-31`）。
          detect: OpenhiveBackup.makeDetect({
            root: WORKSPACE_ROOT,
            minio: 连接,
            pg: () => pg!.db,
            jobs: sharedJobs,
            quotaBytes: TEST_QUOTA,
            run: async (input) => {
              for (let i = 0; i < 400; i += 1) {
                if (input.jobId !== undefined && sharedJobs.get(input.jobId, input.userId)?.cancelRequested === true) {
                  throw new CancelledError("任务已取消")
                }
                await new Promise((resolve) => setTimeout(resolve, 25))
              }
              throw new Error("假执行器 10 秒内没等到取消")
            },
          }),
        })

        scheduler.heartbeat(ALICE.id, project.projectId)
        const 跑 = scheduler.checkNow(ALICE.id, project.projectId)

        // 等任务进表（旧实现 detect 从不 `jobs.start` ⇒ 永远是空，RED）。
        let 任务ID = ""
        for (let i = 0; i < 200; i += 1) {
          const 活 = sharedJobs.activeFor(ALICE.id, project.projectId)
          if (活 !== undefined) {
            任务ID = 活.id
            break
          }
          yield* Effect.sleep("25 millis")
        }
        expect(任务ID.length).toBeGreaterThan(0)
        expect(sharedJobs.activeFor(ALICE.id, project.projectId)?.id).toBe(任务ID)

        // HTTP 级并发：自动任务在跑时，手动备份必须撞单飞锁。
        const 手动 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
        expect(手动.status).toBe(409)
        expect((yield* json(Schema.Struct({ code: Schema.String }), 手动)).code).toBe("job_running")

        // HTTP 取消 ⇒ 假执行器收到取消、detect 落终态。
        const 取消 = yield* as(openApp, ALICE, `${BACKUP}/jobs/${任务ID}/cancel`, { method: "POST" })
        expect(取消.status).toBe(202)
        yield* Effect.promise(() => 跑)

        const 终 = yield* 等到终态(任务ID)
        expect(终.state).toBe("cancelled")
        // 取消不得写 manifest（spec §5.6）。
        expect((yield* 快照列表(project.projectId)).snapshots).toEqual([])

        // 审计：action=backup、result=cancelled、kind=auto。
        const 事件 = yield* Effect.promise(() => listBackupEvents(pg!.db, project.projectId))
        const 取消行 = 事件.find((event) => event.action === "backup" && event.result === "cancelled")
        expect(取消行?.kind).toBe("auto")

        // 取消 ⇒ `lastAutoAt` 保持（用户取消后不要每分钟又被弹一次，spec §7.3）。
        expect(scheduler.entries().find((entry) => entry.projectId === project.projectId)?.lastAutoAt).toBe(固定)
      }),
    30_000,
  )
})

describe("Fix round 1 · 删除恢复点幂等与用量同步（I-2 / §8.5）", () => {
  it.live("同一 id 连删两次 ⇒ 两次都 200 deleted:true（幂等）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const { job } = yield* 手动备份(project.projectId)
      const snapshotId = job.result?.snapshotId ?? ""
      const 删 = () =>
        as(openApp, ALICE, `${BACKUP}/snapshots/${snapshotId}?projectId=${project.projectId}`, { method: "DELETE" })

      const 第一次 = yield* 删()
      expect(第一次.status).toBe(200)
      expect(yield* json(Schema.Struct({ deleted: Schema.Boolean }), 第一次)).toEqual({ deleted: true })

      // 旧实现 manifest 不见了 ⇒ 404（RED）；幂等的语义是「目标状态已达成」。
      const 第二次 = yield* 删()
      expect(第二次.status).toBe(200)
      expect(yield* json(Schema.Struct({ deleted: Schema.Boolean }), 第二次)).toEqual({ deleted: true })
    }),
    30_000,
  )

  it.live("两份快照删一份 ⇒ usageBytes 下降、state.snapshots 摘掉、lastGcAt 更新", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const 一 = yield* 手动备份(project.projectId)
      const 二 = yield* 手动备份(project.projectId)
      expect((yield* 快照列表(project.projectId)).snapshots).toHaveLength(2)

      const store = 存储(project.projectId)
      const 删前状态 = yield* Effect.promise(() => store.readState())
      const 删前 = yield* statusOf(project.projectId)
      const 删的ID = 一.job.result?.snapshotId ?? ""
      expect(删的ID.length).toBeGreaterThan(0)
      expect(二.job.result?.snapshotId).not.toBe(删的ID)

      const 删 = yield* as(
        openApp,
        ALICE,
        `${BACKUP}/snapshots/${删的ID}?projectId=${project.projectId}`,
        { method: "DELETE" },
      )
      expect(删.status).toBe(200)

      // ① 用量当场更新（不是等下一次备份 / 每日清扫才变）。
      const 删后 = yield* statusOf(project.projectId)
      expect(删后.usageBytes).toBeLessThan(删前.usageBytes)
      // ② state.snapshots 不再含它。
      const 删后状态 = yield* Effect.promise(() => store.readState())
      expect(删后状态?.snapshots.some((snapshot) => snapshot.id === 删的ID)).toBe(false)
      // ③ GC 跑过 ⇒ lastGcAt 前进（24h 宽限内 blob 不会被删，不断言 blob 消失）。
      expect(删后状态?.lastGcAt ?? 0).toBeGreaterThan(删前状态?.lastGcAt ?? 0)
    }),
    30_000,
  )
})

describe("Fix round 1 · 归档项目读写分流（I-5.2 / M-1 / 验收 #39 #50）", () => {
  const 归档 = (projectId: string) => as(openApp, ALICE, ARCHIVE, 体({ projectId }))

  it.live("归档后读端点仍 200：status / snapshots / snapshot / jobs/{id}", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const { jobId, job } = yield* 手动备份(project.projectId)
      const snapshotId = job.result?.snapshotId ?? ""
      const q = `projectId=${project.projectId}`

      const 归档响应 = yield* 归档(project.projectId)
      expect(归档响应.status).toBe(200)

      // 旧实现把「已归档」一律 403（连读都挡）⇒ 第一条就 RED。
      const 读 = [
        yield* as(openApp, ALICE, `${BACKUP}/status?${q}`),
        yield* as(openApp, ALICE, `${BACKUP}/snapshots?${q}`),
        yield* as(openApp, ALICE, `${BACKUP}/snapshots/${snapshotId}?${q}`),
        yield* as(openApp, ALICE, `${BACKUP}/jobs/${jobId}`),
      ]
      for (const 响应 of 读) expect(响应.status).toBe(200)
    }),
    30_000,
  )

  it.live("归档后写动作一律 403，文案逐字「项目已归档，请使用项目找回」", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const { jobId, job } = yield* 手动备份(project.projectId)
      const snapshotId = job.result?.snapshotId ?? ""
      const q = `projectId=${project.projectId}`

      expect((yield* 归档(project.projectId)).status).toBe(200)

      const 写 = [
        yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId })),
        yield* as(openApp, ALICE, `${BACKUP}/restore/preview`, 体({ projectId: project.projectId, snapshotId })),
        yield* as(
          openApp,
          ALICE,
          `${BACKUP}/restore`,
          体({ projectId: project.projectId, snapshotId, decision: "overwrite" }),
        ),
        yield* as(openApp, ALICE, `${BACKUP}/snapshots/${snapshotId}?${q}`, { method: "DELETE" }),
        // 取消也是写动作：旧实现根本不看归档（直接 202）⇒ RED。
        yield* as(openApp, ALICE, `${BACKUP}/jobs/${jobId}/cancel`, { method: "POST" }),
      ]
      for (const 响应 of 写) {
        expect(响应.status).toBe(403)
        expect(yield* json(Schema.Struct({ error: Schema.String }), 响应)).toEqual({
          error: "项目已归档，请使用项目找回",
        })
      }
    }),
    30_000,
  )
})

describe("Fix round 1 · 非成员读端点（I-5.1）", () => {
  it.live("BOB 对六个读端点一律 403（status / snapshots / snapshot / preview / restore / DELETE）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const { job } = yield* 手动备份(project.projectId)
      const snapshotId = job.result?.snapshotId ?? ""
      const q = `projectId=${project.projectId}`

      const 读 = [
        yield* as(openApp, BOB, `${BACKUP}/status?${q}`),
        yield* as(openApp, BOB, `${BACKUP}/snapshots?${q}`),
        yield* as(openApp, BOB, `${BACKUP}/snapshots/${snapshotId}?${q}`),
        yield* as(openApp, BOB, `${BACKUP}/restore/preview`, 体({ projectId: project.projectId, snapshotId })),
        yield* as(
          openApp,
          BOB,
          `${BACKUP}/restore`,
          体({ projectId: project.projectId, snapshotId, decision: "overwrite" }),
        ),
        yield* as(openApp, BOB, `${BACKUP}/snapshots/${snapshotId}?${q}`, { method: "DELETE" }),
      ]
      for (const 响应 of 读) {
        expect(响应.status).toBe(403)
        expect((yield* json(Schema.Struct({ code: Schema.String }), 响应)).code).toBe("forbidden")
      }
    }),
    30_000,
  )
})

describe("Fix round 1 · snapshotId 路径守卫（M-5）", () => {
  it.live("preview / restore 的 snapshotId 非法 ⇒ 400，与 GET/DELETE 同一条文案", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const 目标 = [
        { url: `${BACKUP}/restore/preview`, body: { projectId: project.projectId, snapshotId: "../x" } },
        {
          url: `${BACKUP}/restore`,
          body: { projectId: project.projectId, snapshotId: "../x", decision: "overwrite" },
        },
      ]
      for (const 请求 of 目标) {
        const 响应 = yield* as(openApp, ALICE, 请求.url, 体(请求.body))
        // 旧实现把非法 id 折成「清单读不到」⇒ 404（RED）。
        expect(响应.status).toBe(400)
        expect(yield* json(Schema.Struct({ error: Schema.String, code: Schema.String }), 响应)).toEqual({
          error: "snapshotId 不是合法的恢复点 id",
          code: "bad_request",
        })
      }
    }),
    30_000,
  )
})

describe("Fix round 1 · 恢复点列表的边界态（M-4）", () => {
  it.live("state.snapshots 为空但 manifest 有 ⇒ 列表回退重建，不返回空", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      yield* 手动备份(project.projectId)
      const store = 存储(project.projectId)
      const 态 = yield* Effect.promise(() => store.readState())
      expect(态).toBeDefined()
      // 防暂停分支写出 `snapshots: []` 的边界态（manifest 还在）。
      yield* Effect.promise(() =>
        store.writeState({
          version: STATE_VERSION,
          usageBytes: 态?.usageBytes ?? 0,
          lastGcAt: 态?.lastGcAt ?? 0,
          autoPaused: 态?.autoPaused ?? false,
          snapshots: [],
        }),
      )

      const 列 = yield* 快照列表(project.projectId)
      // 旧实现直接信 state ⇒ 空数组（RED）。
      expect(列.snapshots).toHaveLength(1)
    }),
    30_000,
  )
})

describe("Fix round 1 · §9.4 结构化日志（M-3）", () => {
  it.live("备份成功打一条 action=backup，字段取 manifest.totals（不另算一份）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const 原 = console.info
      const 记录: 日志行[] = []
      console.info = ((...args: unknown[]) => {
        记录.push({
          标签: args[0],
          载荷:
            typeof args[1] === "object" && args[1] !== null ? (args[1] as Record<string, unknown>) : undefined,
        })
      }) as typeof console.info
      try {
        const { job } = yield* 手动备份(project.projectId)
        const snapshotId = job.result?.snapshotId ?? ""
        const 明细 = yield* as(openApp, ALICE, `${BACKUP}/snapshots/${snapshotId}?projectId=${project.projectId}`)
        expect(明细.status).toBe(200)
        const 清单 = yield* json(
          Schema.Struct({
            totals: Schema.Struct({
              files: Schema.Number,
              bytes: Schema.Number,
              uploadedBytes: Schema.Number,
              skipped: Schema.Number,
            }),
            dirs: Schema.Array(Schema.String),
          }),
          明细,
        )

        // 旧实现一条都不打（RED）。
        const 行 = yield* 等日志(记录, (载荷) => 载荷.action === "backup")
        expect(行.载荷).toMatchObject({
          action: "backup",
          kind: "manual",
          logicalBytes: 清单.totals.bytes,
          uploadedBytes: 清单.totals.uploadedBytes,
          dedupSavedBytes: 清单.totals.bytes - 清单.totals.uploadedBytes,
          files: 清单.totals.files,
          dirs: 清单.dirs.length,
          skipped: 清单.totals.skipped,
        })
        expect(typeof 行.载荷?.durationMs).toBe("number")
      } finally {
        console.info = 原
      }
    }),
    30_000,
  )

  it.live("恢复终点打一条 action=restore，计数取 RestoreResult", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const { job } = yield* 手动备份(project.projectId)
      const snapshotId = job.result?.snapshotId ?? ""
      writeFileSync(path.join(project.directory, "报告.docx"), "已经被改过")

      const 原 = console.info
      const 记录: 日志行[] = []
      console.info = ((...args: unknown[]) => {
        记录.push({
          标签: args[0],
          载荷:
            typeof args[1] === "object" && args[1] !== null ? (args[1] as Record<string, unknown>) : undefined,
        })
      }) as typeof console.info
      try {
        const 起 = yield* as(
          openApp,
          ALICE,
          `${BACKUP}/restore`,
          体({ projectId: project.projectId, snapshotId, decision: "overwrite" }),
        )
        expect(起.status).toBe(202)
        const 恢复任务 = yield* 等到终态((yield* json(Schema.Struct({ jobId: Schema.String }), 起)).jobId)
        expect(恢复任务.state).toBe("succeeded")
        const 结果 = 恢复任务.result?.restore

        // 旧实现一条都不打（RED）；日志在终态之后才写，等条件。
        const 行 = yield* 等日志(记录, (载荷) => 载荷.action === "restore")
        expect(行.载荷).toMatchObject({
          action: "restore",
          restored: 结果?.restored.length,
          overwritten: 结果?.overwritten.length,
          keptBoth: 结果?.keptBoth.length,
          skipped: 结果?.skipped.length,
          failed: 结果?.failed.length,
        })
        expect(typeof 行.载荷?.durationMs).toBe("number")
      } finally {
        console.info = 原
      }
    }),
    30_000,
  )
})

describe("Fix round 1 · 手动配额预检按 §8.3 公式（I-4）", () => {
  it.live("逻辑大小之和超上限、但缺失 blob 很小 ⇒ 不 409（去重后只算缺失）", () =>
    Effect.gen(function* () {
      const project = yield* 空项目()
      writeFileSync(path.join(project.directory, "大文件.bin"), Buffer.alloc(700_000, 7))

      const 一 = yield* 手动备份(project.projectId)
      expect(一.job.state).toBe("succeeded")

      // 第二次：logicalBytes = 700_000、missing = 0 ⇒ required = ceil(700_000 / 20) = 35_000。
      // 而 `usage(≈700KB) + logical(700KB)` 已超 1 MiB ⇒ **旧的「用量 + 逻辑大小」判据会 409**（RED）。
      const 二 = yield* 手动备份(project.projectId)
      expect(二.job.state).toBe("succeeded")
    }),
    60_000,
  )

  it.live("真超限 ⇒ 409，`requiredBytes` 逐字等于 缺失 + ceil(logical/20)", () =>
    Effect.gen(function* () {
      const project = yield* 空项目()
      writeFileSync(path.join(project.directory, "整块.bin"), Buffer.alloc(1_000_000, 9))

      const 响应 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
      expect(响应.status).toBe(409)
      const 回 = yield* json(
        Schema.Struct({
          code: Schema.String,
          usageBytes: Schema.Number,
          limitBytes: Schema.Number,
          requiredBytes: Schema.Number,
        }),
        响应,
      )
      expect(回.code).toBe("quota_exceeded")
      expect(回.usageBytes).toBe(0)
      expect(回.limitBytes).toBe(TEST_QUOTA)
      // 1_000_000 + ceil(1_000_000 / 20) = 1_050_000（逐字断言，不用「大于」）。
      expect(回.requiredBytes).toBe(1_050_000)
    }),
    30_000,
  )

  it.live("`allowOverQuota: true` ⇒ 202 且任务成功", () =>
    Effect.gen(function* () {
      const project = yield* 空项目()
      writeFileSync(path.join(project.directory, "整块.bin"), Buffer.alloc(1_000_000, 9))

      const 起 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId, allowOverQuota: true }))
      expect(起.status).toBe(202)
      const { jobId } = yield* json(Schema.Struct({ jobId: Schema.String }), 起)
      const job = yield* 等到终态(jobId)
      expect(job.state).toBe("succeeded")
    }),
    60_000,
  )
})

describe("Fix round 1 · 每日清扫的活跃任务守卫（I-5.5 / §8.4）", () => {
  it.live("有活跃任务 ⇒ 一个 manifest 不删、不写 gc 审计；无任务 ⇒ 删过期 manifest 并写 gc 审计", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const store = 存储(project.projectId)
      // 同一天、40 天前的两份 auto 快照（>30 天 ⇒ 周桶；同一周 ⇒ 只留最新那份）。
      const 基准 = new Date()
      基准.setDate(基准.getDate() - 40)
      基准.setHours(12, 0, 0, 0)
      const 旧时刻 = 基准.getTime()
      const 新时刻 = 旧时刻 + 60 * 60 * 1000
      const 旧ID = snapshotIdOf(旧时刻, "aaaaaa")
      const 新ID = snapshotIdOf(新时刻, "bbbbbb")
      yield* Effect.promise(async () => {
        await store.writeManifest(旧自动清单(project.projectId, 旧ID, 旧时刻))
        await store.writeManifest(旧自动清单(project.projectId, 新ID, 新时刻))
      })

      const 清扫 = () =>
        Effect.promise(() =>
          OpenhiveBackup.每日清扫({
            root: WORKSPACE_ROOT,
            minio: 连接,
            pg: () => pg!.db,
            jobs: sharedJobs,
            quotaBytes: TEST_QUOTA,
          }),
        )

      // ① 有活跃任务：整轮跳过（不删、不写 gc 审计）。
      const 起 = sharedJobs.start({ kind: "backup", userId: ALICE.id, projectId: project.projectId, path: "" })
      yield* 清扫()
      expect((yield* Effect.promise(() => store.manifests())).map((entry) => entry.id).sort()).toEqual(
        [旧ID, 新ID].sort(),
      )
      const 有任务时审计 = yield* Effect.promise(() => listBackupEvents(pg!.db, project.projectId))
      expect(有任务时审计.some((event) => event.action === "gc")).toBe(false)

      // ② 任务收敛之后再扫：过期那份被删，并写一条 gc 审计。
      sharedJobs.finish(起.job!.id, "cancelled")
      yield* 清扫()
      expect((yield* Effect.promise(() => store.manifests())).map((entry) => entry.id)).toEqual([新ID])
      const 无任务时审计 = yield* Effect.promise(() => listBackupEvents(pg!.db, project.projectId))
      expect(无任务时审计.some((event) => event.action === "gc" && event.result === "ok")).toBe(true)
    }),
    30_000,
  )
})

describe("Fix round 2 · 已占锁后的 MinIO 抖动（阻断项）", () => {
  it.live("预检成功后读 state 抛错 ⇒ 500，且锁当场释放（同一项目再 POST 不是 409）", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      // 只让「读 state.json」失败：预检（扫描 / 哈希 / list blobs）照常通过，
      // 于是失败恰好落在 `jobs.start` **之后**的那一次读上（`backup.ts:contextStatus`）。
      s3.failOn(500, (request) => request.method === "GET" && request.key.endsWith("/state.json"))
      try {
        const 第一 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
        expect(第一.status).toBe(500)
      } finally {
        // `failWith(undefined)` 同时清掉 `failOn` 的条件（夹具文档写明）。
        s3.failWith(undefined)
      }

      // 锁已释放：同一 (user, project) 再来一次应当被受理，而不是永久 409。
      const 第二 = yield* as(openApp, ALICE, BACKUP, 体({ projectId: project.projectId }))
      expect(第二.status).toBe(202)
    }),
    60_000,
  )
})

describe("Fix round 2 · 每日清扫的 isBusy 透传（§8.4）", () => {
  it.live("顶层检查通过、函数内检查拦截 ⇒ 一个 manifest 不删、不写 gc 审计", () =>
    Effect.gen(function* () {
      const project = yield* 新项目()
      const store = 存储(project.projectId)
      // 两份 40 天前的 auto 快照（同一周 ⇒ 只留最新那份）——被拆掉透传守卫时会删掉旧的那份。
      const 基准 = new Date()
      基准.setDate(基准.getDate() - 40)
      基准.setHours(12, 0, 0, 0)
      const 旧时刻 = 基准.getTime()
      const 新时刻 = 旧时刻 + 60 * 60 * 1000
      const 旧ID = snapshotIdOf(旧时刻, "aaaaaa")
      const 新ID = snapshotIdOf(新时刻, "bbbbbb")
      yield* Effect.promise(async () => {
        await store.writeManifest(旧自动清单(project.projectId, 旧ID, 旧时刻))
        await store.writeManifest(旧自动清单(project.projectId, 新ID, 新时刻))
      })

      // 假注册表：**只对本项目**生效——`每日清扫` 枚举整个 `auth.project_member`（SQL 无
      // `ORDER BY`），别的项目的 `activeFor` 必须照常答「没有」，否则本项目可能还没轮到就被
      // 别的项目的计数耗掉（整文件下复核实测：前 9 次都是别的项目 ⇒ 用例空转）。
      // 对本项目：**第一次**问「有任务吗」答没有（顶层守卫放行），之后每次都答有
      // （`applyRetention` / `collectGarbage` 各自的函数内守卫拦截）。返回值用真任务对象，
      // 形状不必再编。任务收尾放 finally，别污染同文件后续用例。
      const 起 = sharedJobs.start({ kind: "backup", userId: ALICE.id, projectId: project.projectId, path: "" })
      let 本项目问过 = 0
      const 假注册表 = {
        ...sharedJobs,
        activeFor: (_userId: string, projectId: string) => {
          if (projectId !== project.projectId) return undefined
          本项目问过 += 1
          return 本项目问过 === 1 ? undefined : 起.job
        },
      }
      try {
        yield* Effect.promise(() =>
          OpenhiveBackup.每日清扫({
            root: WORKSPACE_ROOT,
            minio: 连接,
            pg: () => pg!.db,
            jobs: 假注册表,
            quotaBytes: TEST_QUOTA,
          }),
        )
      } finally {
        sharedJobs.finish(起.job!.id, "cancelled")
      }

      expect((yield* Effect.promise(() => store.manifests())).map((entry) => entry.id).sort()).toEqual(
        [旧ID, 新ID].sort(),
      )
      const 审计 = yield* Effect.promise(() => listBackupEvents(pg!.db, project.projectId))
      // 中途出现任务 ⇒ 这一轮什么都没做，不该留下「删了 0 个」的假 ok 审计。
      expect(审计.some((event) => event.action === "gc")).toBe(false)
    }),
    30_000,
  )
})
