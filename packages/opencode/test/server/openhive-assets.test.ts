import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
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
 * T017 · **使用面**的资产列表出口（`GET /openhive/assets`）。
 *
 * ## 这条出口与治理出口不是一回事
 *
 * `/openhive/governance/assets` 回**全量**（草稿也在），因为它服务管理员；这条回的是
 * 「**这个读者能看见的已发布资产**」。两者的收敛规则只有一份实现——009 的
 * `canReadAsset()`（作者恒可读；有授权行 `read`；否则按 `global` / 同部门 `department`
 * 放行，`personal` 只给作者）。这里证明的是**出口把它接上了**，不是再证一遍规则。
 *
 * ## 本轮口径（用户裁定）
 *
 * **只列 `published`**。草稿 / 待审 / 迭代中 / 已下线 / 已归档一律不出现——半成品与
 * 下线资产不进「我能用的东西」这一面。
 *
 * ## 判据落在可观测处
 *
 * 四条可见性（全局 / 同部门 / 异部门 / 个人）、一条授权行例外、一条状态门、一条参数闭集。
 * 变异验证：删掉 `canReadAsset` 过滤 ⇒ 异部门与个人两条红；删掉状态条件 ⇒ 状态门那条红。
 */

const it = testEffect(Layer.empty)

const SECRET = "b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6"

const ME: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "930001",
  name: "同部门民警",
  isAdmin: false,
}
const MATE: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "930002",
  name: "同部门同事",
  isAdmin: false,
}
const OUTSIDER: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "930003",
  name: "异部门民警",
  isAdmin: false,
}
/** 被单条授权行放行的人：与作者不同部门、不同人，但有 `read`。 */
const GRANTED: TokenSubject = {
  id: "dddddddd-4444-4444-8444-444444444444",
  policeNo: "930004",
  name: "被授权者",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const LIST = "/openhive/assets"

const ASSETS_ROOT = mkdtempSync(join(tmpdir(), "openhive-assets-read-"))
const restoreAssetsRoot = restorePoint({ OPENHIVE_ASSETS_ROOT: ASSETS_ROOT })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
/** PGlite 夹具把多条连接汇进同一个 PG 会话（与其它路由测试同一前置）。 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreAssetsRoot)
afterAll(() => rmSync(ASSETS_ROOT, { recursive: true, force: true }))

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "status">): AssetMetadata => ({
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
  global: "asset-read-global",
  sameDept: "asset-read-dept-same",
  otherDept: "asset-read-dept-other",
  mine: "asset-read-personal-mine",
  notMine: "asset-read-personal-other",
  granted: "asset-read-personal-granted",
  draft: "asset-read-draft",
  reviewing: "asset-read-review",
  pendingTech: "asset-read-pending-tech",
  iterating: "asset-read-iterating",
  offline: "asset-read-offline",
  archived: "asset-read-archived",
  mcp: "asset-read-mcp",
} as const

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const [subject, dept] of [
    [ME, "甲部门"],
    [MATE, "甲部门"],
    [OUTSIDER, "乙部门"],
    [GRANTED, "乙部门"],
  ] as const) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', ${dept}, '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  await insertAsset(pg.db, 资产({ id: IDS.global, name: "全单位可见的规范", status: "published" }))
  await insertAsset(
    pg.db,
    资产({ id: IDS.sameDept, name: "本部门研判模板", status: "published", visibility: "department", department: "甲部门" }),
  )
  await insertAsset(
    pg.db,
    资产({ id: IDS.otherDept, name: "别部门研判模板", status: "published", visibility: "department", department: "乙部门" }),
  )
  await insertAsset(
    pg.db,
    // 自己的个人资产：作者恒可读，但本轮口径是「只列已发布」——所以得是 published 才出现。
    资产({ id: IDS.mine, name: "我的个人稿件", status: "published", visibility: "personal", ownerId: ME.id }),
  )
  await insertAsset(
    pg.db,
    资产({ id: IDS.notMine, name: "别人的个人稿件", status: "published", visibility: "personal", ownerId: MATE.id }),
  )
  await insertAsset(
    pg.db,
    资产({ id: IDS.granted, name: "被点名授权的稿件", status: "published", visibility: "personal", ownerId: GRANTED.id }),
  )

  // 状态门：全部为 global，唯一区别是状态。
  await insertAsset(pg.db, 资产({ id: IDS.draft, name: "草稿", status: "draft" }))
  await insertAsset(pg.db, 资产({ id: IDS.reviewing, name: "待业务审核", status: "in_review" }))
  await insertAsset(pg.db, 资产({ id: IDS.pendingTech, name: "待技术发布", status: "pending_tech" }))
  await insertAsset(pg.db, 资产({ id: IDS.iterating, name: "迭代中", status: "iterating" }))
  await insertAsset(pg.db, 资产({ id: IDS.offline, name: "已下线", status: "offline" }))
  await insertAsset(pg.db, 资产({ id: IDS.archived, name: "已归档", status: "archived" }))
  await insertAsset(pg.db, 资产({ id: IDS.mcp, name: "话单查询 MCP", type: "mcp", status: "published" }))

  // 单条授权行：GRANTED 对 ME 的个人资产有 `read`——用来证明「授权行能越过空间判据」。
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-asset-reader', '单条资产只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-asset-reader', 'skill', ${IDS.mine}, 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${GRANTED.id}, 'test-asset-reader')`)
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

const get = (subject: TokenSubject | null, url: string) =>
  Effect.gen(function* () {
    const headers = new Headers()
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { headers })
  })

const 行 = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  status: Schema.String,
  visibility: Schema.String,
  department: Schema.String,
})
const 列表 = Schema.Struct({ assets: Schema.Array(行) })
const 错误 = Schema.Struct({ error: Schema.String })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    return Schema.decodeUnknownSync(schema)(JSON.parse(yield* Effect.promise(() => response.text())))
  })

const idsOf = (body: Readonly<{ assets: ReadonlyArray<{ id: string }> }>) => body.assets.map((asset) => asset.id)

describe("T017 · 使用面资产列表", () => {
  it.live("无凭证 ⇒ 401（使用面也要身份，浏览不是匿名）", () =>
    Effect.gen(function* () {
      expect((yield* get(null, LIST)).status).toBe(401)
    }),
  )

  it.live("普通民警（非管理员）⇒ 200：使用面不是治理后台，不需要治理授权", () =>
    Effect.gen(function* () {
      const response = yield* get(ME, LIST)
      expect(response.status).toBe(200)
    }),
  )

  it.live("可见性：全局跨部门可见；本部门只给同部门；别人的 personal 看不见；自己有 read 授权行的 personal 可见", () =>
    Effect.gen(function* () {
      const 我 = idsOf(yield* json(列表, yield* get(ME, LIST)))
      expect(我).toContain(IDS.global)
      expect(我).toContain(IDS.sameDept)
      expect(我).not.toContain(IDS.otherDept)
      expect(我).toContain(IDS.mine)
      expect(我).not.toContain(IDS.notMine)

      const 异部门 = idsOf(yield* json(列表, yield* get(OUTSIDER, LIST)))
      expect(异部门).toContain(IDS.global)
      expect(异部门).toContain(IDS.otherDept)
      expect(异部门).not.toContain(IDS.sameDept)
      expect(异部门).not.toContain(IDS.mine)

      // 与作者不同部门、不同人：空间判据不放行，但单条授权行放行。
      const 被授权 = idsOf(yield* json(列表, yield* get(GRANTED, LIST)))
      expect(被授权).toContain(IDS.mine)
      expect(被授权).toContain(IDS.granted)
    }),
  )

  it.live("状态门：只列 published——草稿 / 待审 / 待发布 / 迭代中 / 下线 / 归档一律不出现", () =>
    Effect.gen(function* () {
      const ids = idsOf(yield* json(列表, yield* get(ME, LIST)))
      for (const hidden of [
        IDS.draft,
        IDS.reviewing,
        IDS.pendingTech,
        IDS.iterating,
        IDS.offline,
        IDS.archived,
      ]) {
        expect(ids).not.toContain(hidden)
      }
      expect(ids).toContain(IDS.global)
    }),
  )

  it.live("type 过滤生效，未知类型 ⇒ 400（闭集在出口收窄）", () =>
    Effect.gen(function* () {
      const onlySkill = idsOf(yield* json(列表, yield* get(ME, `${LIST}?type=skill`)))
      expect(onlySkill).toContain(IDS.global)
      expect(onlySkill).not.toContain(IDS.mcp)

      const onlyMcp = idsOf(yield* json(列表, yield* get(ME, `${LIST}?type=mcp`)))
      expect(onlyMcp).toEqual([IDS.mcp])

      const bad = yield* get(ME, `${LIST}?type=unknown`)
      expect(bad.status).toBe(400)
      expect((yield* json(错误, bad)).error).toContain("未知资产类型")
    }),
  )

  it.live("q 过滤：命中名字，且不越过可见性（搜索不是侧信道）", () =>
    Effect.gen(function* () {
      const 命中 = idsOf(yield* json(列表, yield* get(ME, `${LIST}?q=${encodeURIComponent("研判模板")}`)))
      expect(命中).toContain(IDS.sameDept)
      expect(命中).not.toContain(IDS.otherDept)

      const 没命中 = idsOf(yield* json(列表, yield* get(ME, `${LIST}?q=${encodeURIComponent("不存在的词")}`)))
      expect(没命中).toEqual([])
    }),
  )
})
