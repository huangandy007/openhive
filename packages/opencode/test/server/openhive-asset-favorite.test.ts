import { afterAll, beforeAll, describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 资产收藏出口（2026-10-29）：`POST /openhive/asset-favorite` ＋ 列表回包带 `favoritedIds`。
 *
 * ## 判据落在可观测处
 *
 * 1. **出口接上了**：点一下真的往 `auth.asset_favorite` 写一行、`favorite_count` +1；
 * 2. **不越权**：读不到的资产（异部门 / 别人的个人）收藏不了——收藏不能成为绕过可见性的旁路；
 * 3. **幂等**：同一目标态重复送不会把计数翻倍，也不会把状态翻回去（双击 / 重试）；
 * 4. **只回「我」的**：列表的 `favoritedIds` 不夹带别人的收藏。
 *
 * 变异验证：
 * - 拆掉 `canReadAsset` 检查 ⇒ 「无权者收藏」几条红；
 * - 拆掉列表里的 `favoritedIds` ⇒ 列表那几条红。
 */

const it = testEffect(Layer.empty)

const SECRET = "f1a2v3o4r5i6t7e8s9e0c1r2e3t4k5e6y7"

const ME: TokenSubject = { id: "aaaaaaaa-1111-4111-8111-111111111111", policeNo: "940001", name: "甲民警", isAdmin: false }
const MATE: TokenSubject = { id: "bbbbbbbb-2222-4222-8222-222222222222", policeNo: "940002", name: "甲同事", isAdmin: false }
const OUTSIDER: TokenSubject = { id: "cccccccc-3333-4333-8333-333333333333", policeNo: "940003", name: "乙民警", isAdmin: false }

/** 客户端契约：字面量，不 import 生产常量（`#003-05`）。 */
const FAVORITE = "/openhive/asset-favorite"
const LIST = "/openhive/assets"

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: MATE.id,
  ownerName: MATE.name,
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

const IDS = {
  global: "asset-fav-global",
  sameDept: "asset-fav-dept-same",
  otherDept: "asset-fav-dept-other",
  othersPersonal: "asset-fav-personal-other",
  mcp: "asset-fav-mcp",
  kb: "asset-fav-kb",
} as const

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const [subject, dept] of [
    [ME, "甲部门"],
    [MATE, "甲部门"],
    [OUTSIDER, "乙部门"],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', ${dept}, '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  await insertAsset(pg.db, 资产({ id: IDS.global, name: "全单位可见" }))
  await insertAsset(pg.db, 资产({ id: IDS.sameDept, name: "本部门可见", visibility: "department", department: "甲部门" }))
  await insertAsset(pg.db, 资产({ id: IDS.otherDept, name: "别部门可见", visibility: "department", department: "乙部门" }))
  await insertAsset(pg.db, 资产({ id: IDS.othersPersonal, name: "别人的个人稿件", visibility: "personal", ownerId: MATE.id }))
  await insertAsset(pg.db, 资产({ id: IDS.mcp, name: "话单查询 MCP", type: "mcp" }))
  await insertAsset(pg.db, 资产({ id: IDS.kb, name: "涉案财物清单", type: "knowledge_base" }))
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

const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 发 = (subject: TokenSubject | null, url: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const headers = new Headers(init?.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const 收藏 = (subject: TokenSubject | null, body: unknown) =>
  发(subject, FAVORITE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const 结果 = Schema.Struct({ assetId: Schema.String, favorited: Schema.Boolean, favoriteCount: Schema.Number })
const 列表回包 = Schema.Struct({
  assets: Schema.Array(Schema.Struct({ id: Schema.String })),
  favoritedIds: Schema.Array(Schema.String),
})

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    return Schema.decodeUnknownSync(schema)(JSON.parse(yield* Effect.promise(() => response.text())))
  })

/** `auth.asset_favorite` 里这个人的行数——判「真的写了库」而不只看回包。 */
const 收藏行数 = (userId: string, assetId: string) =>
  Effect.promise(async () => {
    const rows = rowsOf(
      await pg!.db.execute(sql`
        select 1 from auth.asset_favorite where user_id = ${userId} and asset_id = ${assetId}
      `),
    )
    return rows.length
  })

const 缓存计数 = (assetId: string) =>
  Effect.promise(async () => {
    const rows = rowsOf(await pg!.db.execute(sql`select favorite_count from auth.asset where id = ${assetId}`))
    return Number(rows[0]?.favorite_count)
  })

describe("收藏出口 · 身份与越权", () => {
  it.live("无凭证 ⇒ 401", () =>
    Effect.gen(function* () {
      expect((yield* 收藏(null, { assetId: IDS.global, favorited: true })).status).toBe(401)
    }),
  )

  it.live("异部门的部门资产 ⇒ 403，且一行都不写", () =>
    Effect.gen(function* () {
      const response = yield* 收藏(ME, { assetId: IDS.otherDept, favorited: true })
      expect(response.status).toBe(403)
      expect(yield* 收藏行数(ME.id, IDS.otherDept)).toBe(0)
      expect(yield* 缓存计数(IDS.otherDept)).toBe(0)
    }),
  )

  it.live("别人的个人资产 ⇒ 403（收藏不能成为绕过可见性的旁路）", () =>
    Effect.gen(function* () {
      const response = yield* 收藏(ME, { assetId: IDS.othersPersonal, favorited: true })
      expect(response.status).toBe(403)
      expect(yield* 收藏行数(ME.id, IDS.othersPersonal)).toBe(0)
    }),
  )

  it.live("资产不存在 ⇒ 404，不是 500", () =>
    Effect.gen(function* () {
      const response = yield* 收藏(ME, { assetId: "asset-does-not-exist", favorited: true })
      expect(response.status).toBe(404)
    }),
  )

  it.live("体不合法（缺 assetId / favorited 不是布尔）⇒ 400", () =>
    Effect.gen(function* () {
      expect((yield* 收藏(ME, { favorited: true })).status).toBe(400)
      expect((yield* 收藏(ME, { assetId: IDS.global, favorited: "yes" })).status).toBe(400)
      expect((yield* 收藏(ME, { assetId: "", favorited: true })).status).toBe(400)
    }),
  )
})

describe("收藏出口 · 写与幂等", () => {
  it.live("收藏 ⇒ 写一行、计数 +1、回包是真的新状态", () =>
    Effect.gen(function* () {
      const body = yield* json(结果, yield* 收藏(ME, { assetId: IDS.global, favorited: true }))
      expect(body).toEqual({ assetId: IDS.global, favorited: true, favoriteCount: 1 })
      expect(yield* 收藏行数(ME.id, IDS.global)).toBe(1)
      expect(yield* 缓存计数(IDS.global)).toBe(1)
    }),
  )

  it.live("重复收藏同一目标态 ⇒ 幂等（计数不翻倍、行不重复）", () =>
    Effect.gen(function* () {
      const body = yield* json(结果, yield* 收藏(ME, { assetId: IDS.global, favorited: true }))
      expect(body.favorited).toBe(true)
      expect(body.favoriteCount).toBe(1)
      expect(yield* 收藏行数(ME.id, IDS.global)).toBe(1)
    }),
  )

  it.live("取消收藏 ⇒ 行删掉、计数回到 0", () =>
    Effect.gen(function* () {
      const body = yield* json(结果, yield* 收藏(ME, { assetId: IDS.global, favorited: false }))
      expect(body).toEqual({ assetId: IDS.global, favorited: false, favoriteCount: 0 })
      expect(yield* 收藏行数(ME.id, IDS.global)).toBe(0)
    }),
  )

  it.live("重复取消 ⇒ 幂等，计数不会被压成负数", () =>
    Effect.gen(function* () {
      const body = yield* json(结果, yield* 收藏(ME, { assetId: IDS.global, favorited: false }))
      expect(body.favoriteCount).toBe(0)
    }),
  )

  it.live("三类资产都能收藏（skill / mcp / knowledge_base）", () =>
    Effect.gen(function* () {
      for (const assetId of [IDS.mcp, IDS.kb]) {
        const body = yield* json(结果, yield* 收藏(ME, { assetId, favorited: true }))
        expect(body).toEqual({ assetId, favorited: true, favoriteCount: 1 })
      }
    }),
  )
})

describe("列表回包 · favoritedIds", () => {
  it.live("只回「我」收藏的：同页里别人的收藏不夹带", () =>
    Effect.gen(function* () {
      yield* json(结果, yield* 收藏(ME, { assetId: IDS.sameDept, favorited: true }))
      yield* json(结果, yield* 收藏(MATE, { assetId: IDS.global, favorited: true }))

      const 我的 = yield* json(列表回包, yield* 发(ME, LIST))
      expect(我的.favoritedIds).toContain(IDS.sameDept)
      // MATE 收藏了 global，我不该看见它出现在自己的列表里
      expect(我的.favoritedIds.includes(IDS.global)).toBe(false)

      const 他的 = yield* json(列表回包, yield* 发(MATE, LIST))
      expect(他的.favoritedIds).toContain(IDS.global)
      expect(他的.favoritedIds.includes(IDS.sameDept)).toBe(false)
    }),
  )

  it.live("只回**本页**的：筛选把资产筛掉之后，favoritedIds 也不再出现它", () =>
    Effect.gen(function* () {
      yield* json(结果, yield* 收藏(ME, { assetId: IDS.kb, favorited: true }))

      const 只要技能 = yield* json(列表回包, yield* 发(ME, `${LIST}?type=skill`))
      expect(只要技能.favoritedIds.includes(IDS.kb)).toBe(false)

      const 只要知识库 = yield* json(列表回包, yield* 发(ME, `${LIST}?type=knowledge_base`))
      expect(只要知识库.favoritedIds).toContain(IDS.kb)
    }),
  )

  it.live("取消之后就不再出现（读的是库，不是缓存）", () =>
    Effect.gen(function* () {
      yield* json(结果, yield* 收藏(ME, { assetId: IDS.sameDept, favorited: false }))
      const 我 = yield* json(列表回包, yield* 发(ME, LIST))
      expect(我.favoritedIds.includes(IDS.sameDept)).toBe(false)
    }),
  )
})
