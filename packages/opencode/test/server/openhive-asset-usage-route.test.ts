import { Database } from "bun:sqlite"
import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * `GET /openhive/assets` 的 `usageStats`（2026-10-29）。
 *
 * 判据：① 有数的资产带上 `{ users, calls }`；② 没记录的资产**不出现**（不是 0 行）；
 * ③ 30 天窗口外的行不计；④ `days` 由服务端给（前端不硬编码）。
 *
 * 客户端契约写字面量（`#003-05`）：不 import 生产常量。
 */

const it = testEffect(Layer.empty)

const SECRET = "z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4"

const ME: TokenSubject = {
  id: "eeeeeeee-1111-4111-8111-111111111111",
  policeNo: "931001",
  name: "使用人",
  isAdmin: false,
}

const LIST = "/openhive/assets"

const ROOT = mkdtempSync(join(tmpdir(), "openhive-usage-route-"))
const restoreRoot = restorePoint({ OPENHIVE_DATA_ROOT: ROOT })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreRoot)
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: ME.id,
  ownerName: ME.name,
  department: "甲部门",
  visibility: "global",
  version: 1,
  status: "published",
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: 900,
  archivedAt: null,
  ...over,
})

const SOURCE_DDL = `
CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL);
CREATE TABLE part (
  id text PRIMARY KEY,
  message_id text NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
`

let pg: Awaited<ReturnType<typeof startProductionDb>>

const 现在 = Date.now()

function 写调用(db: Database, partId: string, sessionId: string, name: string, timeCreated: number) {
  db.query(
    "insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, 'msg_r', ?, ?, ?, ?)",
  ).run(
    partId,
    sessionId,
    timeCreated,
    timeCreated,
    JSON.stringify({
      type: "tool",
      tool: "skill",
      callID: "call_" + partId,
      state: {
        status: "completed",
        input: { name },
        output: "",
        title: "",
        metadata: {},
        time: { start: timeCreated, end: timeCreated },
      },
    }),
  )
}

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${ME.id}, ${ME.policeNo}, ${ME.name}, 'x', 'x', '基座单位', '甲部门', '基座科室', 1, 0, 'h', 0)
  `)
  await insertAsset(pg.db, 资产({ id: "usage-route-a1", name: "资金台账" }))
  await insertAsset(pg.db, 资产({ id: "usage-route-a2", name: "没人用的技能" }))
  await pg.db.execute(sql`
    insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
    values ('usage-route-p1', 'usage-route-a1', ${ME.id}, 1000),
           ('usage-route-p1', 'usage-route-a2', ${ME.id}, 1000)
  `)

  // 一个 30 天内的调用（a1 有数）＋ 一个 31 天前的调用（a2 有记录但窗口外）。
  mkdirSync(join(ROOT, ME.id), { recursive: true })
  const 源 = new Database(join(ROOT, ME.id, "opencode.db"), { create: true })
  源.exec(SOURCE_DDL)
  源.query("insert into session (id, project_id) values ('usage-route-s1', 'usage-route-p1')").run()
  写调用(源, "usage-route-prt1", "usage-route-s1", "资金台账", 现在 - 60_000)
  写调用(源, "usage-route-prt2", "usage-route-s1", "没人用的技能", 现在 - 31 * 24 * 60 * 60 * 1000)
  源.close()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
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

const get = (subject: TokenSubject, url: string) =>
  Effect.gen(function* () {
    const headers = new Headers()
    headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* Effect.promise(() => signToken(subject, SECRET))}`)
    return yield* openApp(url, { headers })
  })

const 用量 = Schema.Struct({
  days: Schema.Number,
  stats: Schema.Record(
    Schema.String,
    Schema.Struct({ users: Schema.Number, calls: Schema.Number }),
  ),
})

const 回包 = Schema.Struct({
  assets: Schema.Array(Schema.Struct({ id: Schema.String })),
  usageStats: 用量,
})

describe("GET /openhive/assets · usageStats", () => {
  it.live("有数的资产带 { users, calls }；没记录的不出现；窗口外不计；days 由服务端给", () =>
    Effect.gen(function* () {
      const response = yield* get(ME, LIST)
      expect(response.status).toBe(200)
      const body = Schema.decodeUnknownSync(回包)(JSON.parse(yield* Effect.promise(() => response.text())))

      expect(body.usageStats.days).toBe(30)
      expect(body.usageStats.stats["usage-route-a1"]).toEqual({ users: 1, calls: 1 })
      expect("usage-route-a2" in body.usageStats.stats).toBe(false)
    }),
  )

  it.live("用量统计坏了 ⇒ 列表仍 200，只是不带 usageStats（老内核兼容的那一档）", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        pg.db.execute(sql`alter table auth.asset_usage_event rename to asset_usage_event_parked`),
      )
      try {
        const response = yield* get(ME, LIST)
        expect(response.status).toBe(200)
        const body = JSON.parse(yield* Effect.promise(() => response.text())) as Record<string, unknown>
        // 不含该键 ≠ 给个空表：前端 §7 的第三档是「这一项不出现」，给 `{days,stats:{}}` 会被渲染成「还没人用过」。
        expect("usageStats" in body).toBe(false)
        expect(Array.isArray(body["assets"])).toBe(true)
      } finally {
        yield* Effect.promise(() =>
          pg.db.execute(sql`alter table auth.asset_usage_event_parked rename to asset_usage_event`),
        )
      }
    }),
  )
})
