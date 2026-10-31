import { afterAll, beforeAll, describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import {
  addGroupMember,
  createAuthorizationGroup,
  grantAssetToGroup,
} from "@opencode-ai/asset-service/authorization"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 资产内容出口（2026-10-31）：`PATCH /openhive/assets/:id` ＋ 列表回包带 `writableIds`。
 *
 * ## 判据落在可观测处
 *
 * 1. **接上了**：作者改功能描述真的落库，回包是**读回来**的真值；
 * 2. **授权先于校验**：有资产但无 `write` 的人，送什么请求体都是 403（不是 400）——
 *    否则 400/403 的差别就是「校验规则长什么样」的探针（`#004-09`）；
 * 3. **可写集合与列表同源**：`writableIds` 只含本页里我有 `write` 的，
 *    判据是 `effectivePermissions()` 一份（`#002-06`）。
 *
 * 变异验证：
 * - 拆掉 `has("write")` ⇒ 「不是作者」「无权送非法长度」两条红；
 * - `writableIds` 改成全量 id ⇒ 列表那条红。
 */

const it = testEffect(Layer.empty)
const SECRET = "c1o2n3t4e5n6t7w8r9i0t1e2s3e4c5r6e7t8"

const ME: TokenSubject = { id: "dddddddd-1111-4111-8111-111111111111", policeNo: "940011", name: "甲作者", isAdmin: false }
const MATE: TokenSubject = { id: "eeeeeeee-2222-4222-8222-222222222222", policeNo: "940012", name: "甲同事", isAdmin: false }

const LIST = "/openhive/assets"

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  summary: "",
  precautions: "",
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

const IDS = {
  mine: "asset-content-mine",
  mates: "asset-content-mates",
  /** 只给「无权者」的独立夹具：不与任何写用例共享，杜绝执行顺序依赖。 */
  blocked: "asset-content-blocked",
} as const

/** 给 MATE 的显式 `write` 授权组（非作者拿写权：判据必须来自能力模型，不是作者身份）。 */
const WRITE_GROUP = "g_content_editor"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ME, MATE]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', ${"甲部门"}, '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  await insertAsset(pg.db, 资产({ id: IDS.mine, name: "我写的" }))
  await insertAsset(pg.db, 资产({ id: IDS.mates, name: "同事写的", ownerId: MATE.id, ownerName: MATE.name }))
  await insertAsset(pg.db, 资产({ id: IDS.blocked, name: "无权者只能读的" }))

  // 非作者拿写权，只能来自显式 `write` 授权行（空间只授读）。建组 → 加人 → 授权，
  // 走生产出口而不是手写 SQL（`#006-35`）；顺序调用，PGlite 夹具单连接。
  await createAuthorizationGroup(pg.db, { id: WRITE_GROUP, name: "内容编辑组" })
  await addGroupMember(pg.db, { groupId: WRITE_GROUP, userId: MATE.id })
  await grantAssetToGroup(pg.db, { groupId: WRITE_GROUP, assetId: IDS.mine, perm: "write" })
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

const 发 = (subject: TokenSubject | null, url: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const headers = new Headers(init?.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const 改内容 = (subject: TokenSubject | null, assetId: string, patch: unknown) =>
  发(subject, `${LIST}/${assetId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })

const 读摘要 = (assetId: string) =>
  Effect.promise(async () => {
    const rows = rowsOf(await pg!.db.execute(sql`select summary, precautions, updated_at from auth.asset where id = ${assetId}`))
    return rows[0]
  })

const 读错误 = (response: Response) =>
  Effect.gen(function* () {
    return Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }))(
      JSON.parse(yield* Effect.promise(() => response.text())),
    )
  })

describe("资产内容出口 · 权限", () => {
  it.live("无凭证 ⇒ 401", () =>
    Effect.gen(function* () {
      expect((yield* 改内容(null, IDS.mine, { summary: "x" })).status).toBe(401)
    }),
  )

  it.live("不是作者（只有 read）⇒ 403 且一字未写（独立夹具，不依赖执行顺序）", () =>
    Effect.gen(function* () {
      const response = yield* 改内容(MATE, IDS.blocked, { summary: "我要改" })
      expect(response.status).toBe(403)
      expect((yield* 读错误(response)).error).toBe("无权修改该资产")
      expect((yield* 读摘要(IDS.blocked))?.summary).toBe("")
    }),
  )

  it.live("资产不存在 ⇒ 404", () =>
    Effect.gen(function* () {
      expect((yield* 改内容(ME, "asset-content-missing", { summary: "x" })).status).toBe(404)
    }),
  )

  it.live("无权的人送非法长度 / 非字符串 ⇒ 仍回 403，而不是 400（授权先于一切内容校验）", () =>
    Effect.gen(function* () {
      // 长度与类型两种坏请求都试：只要鉴权在前，无权者就永远看不到 400 的校验口径。
      for (const 坏请求 of [{ summary: "一".repeat(500) }, { summary: 123 }]) {
        const response = yield* 改内容(MATE, IDS.blocked, 坏请求)
        expect(response.status).toBe(403)
        expect((yield* 读错误(response)).error).toBe("无权修改该资产")
      }
    }),
  )

  it.live("非作者但有显式 write 授权 ⇒ 列表可写、且真能改（判据是能力模型不是作者身份）", () =>
    Effect.gen(function* () {
      const 列表响应 = yield* 发(MATE, LIST)
      const 列表 = Schema.decodeUnknownSync(
        Schema.Struct({ writableIds: Schema.Array(Schema.String) }),
      )(JSON.parse(yield* Effect.promise(() => 列表响应.text())))
      expect(列表.writableIds).toContain(IDS.mine)
      expect(列表.writableIds).not.toContain(IDS.blocked)

      const response = yield* 改内容(MATE, IDS.mine, { precautions: "授权组给的写权" })
      expect(response.status).toBe(200)
      expect((yield* 读摘要(IDS.mine))?.precautions).toBe("授权组给的写权")
    }),
  )
})

describe("资产内容出口 · 写入", () => {
  it.live("作者改功能描述 ⇒ 200，回包是读回来的真值", () =>
    Effect.gen(function* () {
      const response = yield* 改内容(ME, IDS.mine, { summary: "从流水里找出可疑账户" })
      expect(response.status).toBe(200)
      const body = Schema.decodeUnknownSync(Schema.Struct({ summary: Schema.String }))(
        JSON.parse(yield* Effect.promise(() => response.text())),
      )
      expect(body.summary).toBe("从流水里找出可疑账户")
      expect((yield* 读摘要(IDS.mine))?.summary).toBe("从流水里找出可疑账户")
    }),
  )

  it.live("超长 ⇒ 400 且消息里带上限", () =>
    Effect.gen(function* () {
      const response = yield* 改内容(ME, IDS.mine, { summary: "一".repeat(201) })
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).toContain("200")
    }),
  )

  // 终审 I-2：`assets.ts` 的 `typeof 值 !== "string"` 守卫之前没有用例。
  // 有权限的人送脏类型必须得到 400（而不是 500 / 静默落库）。
  it.live("作者送非字符串 ⇒ 400（类型守卫在授权之后）", () =>
    Effect.gen(function* () {
      const response = yield* 改内容(ME, IDS.mine, { summary: 123 })
      expect(response.status).toBe(400)
      expect((yield* 读错误(response)).error).toContain("summary")
    }),
  )

  it.live("空请求体 / 没有可改字段 ⇒ 400", () =>
    Effect.gen(function* () {
      expect((yield* 改内容(ME, IDS.mine, {})).status).toBe(400)
      expect((yield* 改内容(ME, IDS.mine, { name: "想改名字" })).status).toBe(400)
    }),
  )
})

describe("资产列表 · writableIds", () => {
  it.live("只含我有 write 的那几条", () =>
    Effect.gen(function* () {
      const response = yield* 发(ME, LIST)
      const body = Schema.decodeUnknownSync(
        Schema.Struct({ writableIds: Schema.Array(Schema.String) }),
      )(JSON.parse(yield* Effect.promise(() => response.text())))
      expect(body.writableIds).toContain(IDS.mine)
      expect(body.writableIds).not.toContain(IDS.mates)
    }),
  )
})
