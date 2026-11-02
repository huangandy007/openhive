import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { ConfigProvider } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { evaluate as evaluateV1 } from "../../src/permission"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 接线（spec §3.4.3 / I5+I6）：**可见即可用**必须真的落在会话规则集里。
 *
 * 纯函数那一半（`openhive-access-mcp.test.ts`）验的是「给了名单怎么拼规则」；本文件验
 * 「名单**从哪来**」——`capabilityFor` 是否真的把 `scanUsableMcpServers` 的结果传进了第四参。
 * 把 `access.ts` 里那个第四参删掉，纯函数那 15 条**一条都不会红**（`#002-02`）。
 *
 * 夹具要点：
 * - 配置走 `OPENCODE_CONFIG_CONTENT`（受信通道，沙箱不可写）；
 * - 配置键**就是资产 id**（spec §3.3.1），所以 `naming.server` 与资产行天然对齐；
 * - 两个 server 的名字互不为前缀（避开 C1 的 fail-closed）。
 */
const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "770e8400-e29b-41d4-a716-446655440002",
  policeNo: "020603",
  name: "王五",
  isAdmin: false,
}

const 可见资产 = "asset-mcp-visible-0001"
const 手写键 = "handwritten.mcp"
/** 只在库里、不在 `Config.mcp` 的第二台：可见 ≠ 可配置，它不该凭空产出规则。 */
const 仅库内资产 = "asset-mcp-db-only-0002"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-mcp-visible-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const previousConfigContent = process.env.OPENCODE_CONFIG_CONTENT
process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
  mcp: {
    [可见资产]: { type: "remote", url: "http://127.0.0.1:9/" },
    [手写键]: { type: "remote", url: "http://127.0.0.1:9/" },
  },
})

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousConfigContent === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
  else process.env.OPENCODE_CONFIG_CONTENT = previousConfigContent
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

const 资产 = (overrides: Partial<AssetMetadata> & Pick<AssetMetadata, "id">): AssetMetadata => ({
  name: "话单查询 MCP",
  type: "mcp",
  description: "测试用 MCP 资产",
  summary: "",
  precautions: "",
  icon: "mcp",
  category: "intelligence",
  tags: [],
  ownerId: ALICE.id,
  ownerName: ALICE.name,
  department: "x",
  visibility: "global",
  version: 1,
  status: "published",
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1000,
  updatedAt: 1000,
  publishedAt: 1000,
  archivedAt: null,
  iterationNote: "",
  iterationWorkspace: null,
  ...overrides,
})

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${ALICE.id}, '020603', '王五', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)
  // 只有「可见资产」在库里，且是 published + global、**零授权行**；手写键没有任何资产行。
  await insertAsset(pg.db, 资产({ id: 可见资产 }))
  // 第二台只在库里（published + global、归 ALICE）：配置里没有这个键 ⇒ 不进规则集。
  await insertAsset(pg.db, 资产({ id: 仅库内资产 }))
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
}

const handler = HttpRouter.toWebHandler(
  HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
  { disableLogger: true },
).handler

const openApp = (url: string, init?: RequestInit) =>
  Effect.promise(() =>
    Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
  )

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* Effect.promise(() => signToken(subject, SECRET))}`)
    return yield* openApp(url, { ...init, headers })
  })

function storedRuleset(userId: string, sessionId: string): PermissionV1.Ruleset {
  const db = new Sqlite(path.join(DATA_ROOT, userId, "opencode.db"))
  try {
    const rows = db
      .query<{ permission: string }, [string]>("SELECT permission FROM session WHERE id = ?")
      .all(sessionId)
    if (rows.length !== 1) throw new Error(`期望恰好一条会话行，实得 ${rows.length}`)
    return Schema.decodeUnknownSync(PermissionV1.Ruleset)(JSON.parse(rows[0].permission))
  } finally {
    db.close()
  }
}

describe("可见即可用 · capability 接线（真应用 + 真库）", () => {
  it.live(
    "可见资产（零授权行）⇒ 两条 allow；配置里有、资产库没有的键 ⇒ 两条 deny",
    () =>
      Effect.gen(function* () {
        const response = yield* as(ALICE, "/session", { method: "POST" })
        expect(response.status).toBe(200)
        const id = (yield* Effect.map(Effect.promise(() => response.json()), (body) =>
          Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(body),
        )).id

        const stored = storedRuleset(ALICE.id, id)
        // sanitize 只替换 [^a-zA-Z0-9_-]，连字符原样保留 ⇒ 工具前缀带 "-"（与 read 的 mcp:<原样 server>:* 不同）。
        expect(stored).toEqual([
          { permission: "skill", pattern: "*", action: "deny" },
          { permission: "asset-mcp-visible-0001_*", pattern: "*", action: "allow" },
          { permission: "read", pattern: `mcp:${可见资产}:*`, action: "allow" },
          { permission: "handwritten_mcp_*", pattern: "*", action: "deny" },
          { permission: "read", pattern: `mcp:${手写键}:*`, action: "deny" },
        ])

        expect(evaluateV1("asset-mcp-visible-0001_query", "*", stored).action).toBe("allow")
        expect(evaluateV1("read", `mcp:${可见资产}:ledger`, stored).action).toBe("allow")
        expect(evaluateV1("handwritten_mcp_query", "*", stored).action).toBe("deny")
        expect(evaluateV1("read", `mcp:${手写键}:ledger`, stored).action).toBe("deny")
        // 读文件不落在本规则集里 ⇒ 上游兜底 `ask`（不是 deny，也不是 allow；
        // 纯函数用例 `openhive-access-mcp.test.ts` 把它写成「读文件仍是上游的 ask」）。
        expect(evaluateV1("read", "src/index.ts", stored).action).toBe("ask")

        // 可见 ≠ 可配置：库里有、`Config.mcp` 里没有的那台不产出任何规则（I6 的另一半）。
        expect(stored).toHaveLength(5)
        expect(stored.some((rule) => rule.pattern.includes(仅库内资产))).toBe(false)
      }),
    30_000,
  )
})
