import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { assetById, insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * `POST /openhive/assets/:id/submit` 对 MCP（2026-11-02 设计 §3.1.4，批次 3）。
 *
 * 判据两条：
 * 1. 作者提交自己的 MCP 草稿 ⇒ 200、库内 `in_review`（批次 3 打开了这个入口）；
 * 2. 没有写权的人提交 ⇒ 403，状态仍 `draft`（授权先于流转，`#004-09`）。
 *
 * 夹具照抄 `openhive-asset-iteration.test.ts` 的 app 构造／建库／发请求写法：同一个出口，
 * 身份靠 `OPENHIVE_REQUIRE_USER_ID=1` ＋ `AUTH_JWT_SECRET`，`handler` 要带 `HttpApiApp.context`。
 */

const it = testEffect(Layer.empty)
const SECRET = "s1u2b3m4i5t6m7c8p9a0s1s2w3o4r5d6"

const 作者: TokenSubject = { id: "u-mcp-submit-me", policeNo: "980001", name: "甲作者", isAdmin: false }
const 同事: TokenSubject = { id: "u-mcp-submit-mate", policeNo: "980002", name: "乙同事", isAdmin: false }

const IDS = {
  /** 作者提交成功；与失败面用不同 id，杜绝执行顺序依赖（`#005-34`）。 */
  ok: "asset-mcp-submit-ok",
  /** 无写权的人来提交。 */
  denied: "asset-mcp-submit-denied",
} as const

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "ownerId" | "ownerName">): AssetMetadata => ({
  type: "mcp",
  description: "测试用 MCP",
  summary: "",
  precautions: "",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  department: "经侦支队",
  visibility: "personal",
  version: 1,
  status: "draft",
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: null,
  archivedAt: null,
  iterationNote: "",
  iterationWorkspace: null,
  ...over,
})

const 资产根 = mkdtempSync(join(tmpdir(), "openhive-mcp-submit-assets-"))
const 数据根 = mkdtempSync(join(tmpdir(), "openhive-mcp-submit-data-"))
const restoreAssetsRoot = restorePoint({ OPENHIVE_ASSETS_ROOT: 资产根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
/** PGlite 夹具把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的（同治理测试）。 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
/** 每用户库的根必须在 `realApp()` 构造之前写好（app 的 layer 构造期就会定下根）。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = 数据根

afterAll(restoreAssetsRoot)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
})
afterAll(() => rmSync(资产根, { recursive: true, force: true }))
afterAll(() => {
  try {
    rmSync(数据根, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [作者, 同事]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  await insertAsset(pg.db, 资产({ id: IDS.ok, name: "我的 MCP（可提交）", ownerId: 作者.id, ownerName: 作者.name }))
  await insertAsset(pg.db, 资产({ id: IDS.denied, name: "我的 MCP（别人来提交）", ownerId: 作者.id, ownerName: 作者.name }))
})

const OPEN: Record<string, string | undefined> = { OPENHIVE_REQUIRE_USER_ID: "1", AUTH_JWT_SECRET: SECRET }

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() => Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)))
}

const openApp = realApp(OPEN)
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const 提交 = (subject: TokenSubject | null, assetId: string) =>
  发(subject, `/openhive/assets/${assetId}/submit`, { method: "POST" })

const 读行 = (id: string) => Effect.promise(() => assetById(pg!.db, id))

describe("MCP 提交审核", () => {
  it.live("作者提交 MCP 草稿 ⇒ 200，状态 in_review", () =>
    Effect.gen(function* () {
      const res = yield* 提交(作者, IDS.ok)
      expect(res.status).toBe(200)
      expect((yield* 读行(IDS.ok))?.status).toBe("in_review")
    }),
  )

  it.live("无写权的人提交 MCP ⇒ 403 且状态仍 draft", () =>
    Effect.gen(function* () {
      const res = yield* 提交(同事, IDS.denied)
      expect(res.status).toBe(403)
      // 拒绝发生在任何副作用之前：状态、版本都不动。
      expect((yield* 读行(IDS.denied))?.status).toBe("draft")
      expect((yield* 读行(IDS.denied))?.version).toBe(1)
    }),
  )
})
