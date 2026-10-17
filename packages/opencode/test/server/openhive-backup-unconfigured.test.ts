import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
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
import { AnchorWorkspace } from "../../src/server/routes/instance/httpapi/middleware/anchor-workspace"
import { userIdentityLayer } from "../../src/server/routes/instance/httpapi/middleware/user-identity"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { OpenhiveArchive } from "../../src/server/openhive/archive"
import { OpenhiveBackup } from "../../src/server/openhive/backup"
import { OpenhivePg } from "../../src/server/openhive/pg"
import { testEffect } from "../lib/effect"

/**
 * Task 11（spec §10.3）：**MinIO 没配时备份出口的处置**——503 ＋「授权先于部署状态」。
 *
 * ## 为什么这个用例住在一个单独的文件里
 *
 * 与 `openhive-project-archive-unconfigured.test.ts` 同一条理由：那套 harness 有硬约束
 * **一个文件只建一个 app**（新 app 的第一条 PG 查询会 500，见归档测试文件头）。本文件就是
 * 那**唯一**的 app。
 *
 * ## 这条钉的是哪一句
 *
 * 授权次序 `401 → 400 → 403 → 503`（spec §9.1）：不许让没权限的人从「503 还是 403」读出
 * 这台机器配没配 MinIO。三条断言**必须同一个 app、按这个次序**：调换 403 与 503 会让第二条
 * 直接红成 503。
 *
 * `OPEN` **刻意只配一半**（endpoint ＋ bucket 有、两把密钥没有）：这正是要拦的那种部署——
 * 把它当「配好了」不会在配置处报错，只会在第一次外呼时炸在 SDK 里、报一个与配置无关的错。
 * 五个变量走同一个 `Config.option(Config.all({…}))`：缺一个 ⇒ `None`（`archive.ts:190-200`）。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
/** 有身份、但不是任何项目的成员——「授权先于配置」那条要用他。 */
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/** 出口路径（**客户端契约**，写字面量、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const BACKUP = "/openhive/project/backup"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-backup-bare-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（理由见同族测试的同款注释）。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/** **只配一半**——两把密钥刻意不写（见文件头）。 */
const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
  OPENHIVE_MINIO_ENDPOINT: "minio.invalid:9000",
  OPENHIVE_MINIO_BUCKET: "openhive",
}

/**
 * 与 `openhive-backup.test.ts` 同一份合并方式（Task 11 不接 `server.ts`，接线是 Task 12）：
 * 三个 `Layer.provide` 与将写进 `server.ts` 的那几行逐项一致。
 */
const appRoutes = Layer.merge(
  HttpApiApp.routes,
  OpenhiveBackup.routes.pipe(
    Layer.provide(OpenhiveArchive.MinioConfig.layer),
    Layer.provide(AnchorWorkspace.Config.layer),
    Layer.provide(OpenhivePg.layer),
    // 同 `openhive-backup.test.ts` 的那条注释：Task 12 接线时身份门在顶层 provide 链里包住
    // 所有路由；这里单独合并备份层，所以把同一个 `userIdentityLayer` 值供在它身上。
    Layer.provide(
      userIdentityLayer.pipe(Layer.provide(UserIdentity.Config.layer), Layer.provide(DatabaseRouter.layer())),
    ),
  ),
)

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    appRoutes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})() satisfies (url: string, init?: RequestInit) => Effect.Effect<Response>

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 以某人的身份发一个请求。 */
const asWho = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 以 ALICE（本文件里唯一建项目的人）的身份发一个请求。 */
const as = (url: string, init: RequestInit = {}) => asWho(ALICE, url, init)

/** 读 JSON 体。**先断内容类型**——「未挂载」在本应用里落进 SPA 兜底、回 200 ＋ `text/html`。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
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

describe("Task 11 · MinIO 没配：401 → 403 → 503（授权判定排在配置检查之前）", () => {
  it.live("没有身份 ⇒ 401；非成员 ⇒ 403；成员 ⇒ 503（配置态不泄漏给未授权的人）", () =>
    Effect.gen(function* () {
      // 成员项目走**真实建项目出口**（那里不碰 MinIO）。不要直接写 `project_member`——
      // 那会绕过生产注册链（`#006-28` 的反例）。
      const 建 = yield* as(PROJECT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `备份503·${Date.now()}`, type: "private" }),
      })
      const project = yield* json(Schema.Struct({ id: Schema.String }), 建)
      const 体 = (): RequestInit => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      })

      // ① 匿名：连体都不用解析就回 401（次序的第一段）。
      const 匿名 = yield* openApp(BACKUP, 体())
      expect(匿名.status).toBe(401)

      // ② 非成员：MinIO 明明没配，却拿到 403 而**不是** 503 ⇒ 部署状态不外泄。
      const 外人 = yield* asWho(BOB, BACKUP, 体())
      expect(外人.status).toBe(403)
      expect((yield* json(Schema.Struct({ code: Schema.String }), 外人)).code).toBe("forbidden")

      // ③ 成员：授权通过后才看见「配置不可用」，明说是 minio_unconfigured。
      const 成员 = yield* as(BACKUP, 体())
      expect(成员.status).toBe(503)
      expect((yield* json(Schema.Struct({ code: Schema.String }), 成员)).code).toBe("minio_unconfigured")
    }),
    30_000,
  )
})
