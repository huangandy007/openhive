import { afterAll, beforeAll, describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 需求 2 · 「其他」兜底桶 ＋ 治理后台批量改分类（2026-10-27）。
 *
 * ## 兜底的口径
 *
 * 「其他」= **分类不在启用清单里**的资产：管理员停用的分类、库里根本没有的分类 id。
 * `category` 是 NOT NULL，所以没有「无分类」这种情形——这不是「分类为空」的桶。
 *
 * ## 两条出口，各证一半
 *
 * - 使用面 `GET /openhive/assets?category=__other__`：只回兜底桶，并带上 `categoryNames`
 *   （**含停用分类**——卡片要标原分类，名字必须来自库，不能拿 seed 常量冒充）。
 * - 治理面 `POST /openhive/governance/assets/batch-category`：管理员把资产挪出兜底桶。
 *   授权 `admin`（不是 `review`/`read`）、授权先于读体（`#004-09`）、整批原子
 *   （有一个 id 不存在就一个都不写）、只给**真改了**的行留审计。
 *
 * ## 判据落在可观测处
 *
 * 列表与库里那一行；审计表里的行数与 `detail.from/to`。不只看状态码。
 */

const it = testEffect(Layer.empty)

const SECRET = "b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6"

const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "940001",
  name: "系统管理员甲",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "940002",
  name: "民警乙",
  isAdmin: false,
}
/** 自定义角色：只有 `asset-governance/read`——证明批量写要的是 `admin`，不是「能进后台」。 */
const READER: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "940003",
  name: "只读丙",
  isAdmin: true,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const LIST = "/openhive/assets"
const BATCH = "/openhive/governance/assets/batch-category"
/** 与前端 `filter.ts` 的兜底 id 逐字相同（两边各写一份字面量，刻意不共享）。 */
const 兜底 = "__other__"

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "status">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: OFFICER.id,
  ownerName: OFFICER.name,
  department: "基座部门",
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
  /** 停用分类里的资产：落进兜底桶。 */
  offDisabled: "asset-other-disabled",
  /** 库里没有这个分类 id：也落进兜底桶。 */
  offGhost: "asset-other-ghost",
  /** 启用分类里的资产：不进兜底桶。 */
  normal: "asset-other-normal",
  /** 批量改分类的两条：只服务治理出口的用例，不与上面的断言交叉。 */
  batch1: "asset-batch-category-1",
  batch2: "asset-batch-category-2",
} as const

/** 被停用的 seed 分类 id，以及改名后的标记名——证明名字读的是库，不是 seed 常量。 */
const 停用分类 = "supervision"
const 停用分类新名 = "督导考核（已停用）"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, OFFICER, READER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-asset-reader', '资产只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-asset-reader', 'governance', 'asset-governance', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${READER.id}, 'test-asset-reader')`)

  // 停用一类、改个标记名：兜底桶的判据与原名文案都只从库里来。
  await pg.db.execute(sql`
    update auth.asset_category set enabled = false, name = ${停用分类新名} where id = ${停用分类}
  `)

  await insertAsset(pg.db, 资产({ id: IDS.offDisabled, name: "停用类资产", status: "published", category: 停用分类 }))
  await insertAsset(pg.db, 资产({ id: IDS.offGhost, name: "孤儿分类资产", status: "published", category: "ghost-category" }))
  await insertAsset(pg.db, 资产({ id: IDS.normal, name: "正常分类资产", status: "published" }))
  await insertAsset(pg.db, 资产({ id: IDS.batch1, name: "待挪分类一", status: "published", category: "ghost-category" }))
  await insertAsset(pg.db, 资产({ id: IDS.batch2, name: "待挪分类二", status: "published" }))
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
const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const as = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", cookie(yield* token(subject)).Cookie)
    return yield* openApp(url, { ...init, headers })
  })

const get = (subject: TokenSubject | null, url: string) => as(subject, url)

const post = (subject: TokenSubject | null, url: string, body?: unknown) =>
  as(subject, url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })

const Asset = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: Schema.String,
  status: Schema.String,
})
const ListResponse = Schema.Struct({
  assets: Schema.Array(Asset),
  total: Schema.Number,
  categoryNames: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const ErrorResponse = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) })
const BatchResponse = Schema.Struct({ updated: Schema.Number })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 库里的分类（**裸 SQL**，不经被测对象）。 */
async function 库分类(id: string): Promise<string> {
  if (!pg) throw new Error("真库没起来")
  const [row] = rowsOf(await pg.db.execute(sql`select category from auth.asset where id = ${id}`))
  if (!row) throw new Error(`资产不存在：${id}`)
  return String(row.category)
}

async function 审计条数(): Promise<number> {
  if (!pg) throw new Error("真库没起来")
  const [row] = rowsOf(
    await pg.db.execute(
      sql`select count(*) as n from auth.audit_event where action = 'asset.category' and result = 'ok'`,
    ),
  )
  return Number(row?.n ?? 0)
}

describe("需求 2 · 使用面「其他」兜底桶", () => {
  it.live("category=__other__ 只回兜底桶；categoryNames 带上停用分类的名字（读库，不读 seed）", () =>
    Effect.gen(function* () {
      const body = yield* json(ListResponse, yield* get(OFFICER, `${LIST}?category=${兜底}`))
      const ids = body.assets.map((asset) => asset.id)

      expect(ids).toContain(IDS.offDisabled)
      // 库里根本没有的分类 id 也算兜底：否则历史数据/直写库的行会从两面同时消失。
      expect(ids).toContain(IDS.offGhost)
      expect(ids).not.toContain(IDS.normal)
      expect(ids).not.toContain(IDS.batch2)

      // 总数与列表同一份条件：不是写死的数字，而是「这一页就是全部」。
      expect(body.total).toBe(body.assets.length)
      // 停用分类的名字来自库（本夹具把它改过名）：seed 常量里没有这个「（已停用）」。
      expect(body.categoryNames?.[停用分类]).toBe(停用分类新名)
    }),
  )

  it.live("不给 category ⇒ 兜底桶不吞正常分类（三条都在）", () =>
    Effect.gen(function* () {
      const body = yield* json(ListResponse, yield* get(OFFICER, LIST))
      const ids = body.assets.map((asset) => asset.id)

      expect(ids).toContain(IDS.normal)
      expect(ids).toContain(IDS.offDisabled)
      expect(ids).toContain(IDS.offGhost)
    }),
  )
})

describe("需求 2 · 治理面批量改分类", () => {
  it.live("门：无凭证 401、普通民警 403、只有 read 的角色也 403（写要 admin）", () =>
    Effect.gen(function* () {
      expect((yield* post(null, BATCH, { ids: [IDS.batch1], category: "case-handling" })).status).toBe(401)
      expect((yield* post(OFFICER, BATCH, { ids: [IDS.batch1], category: "case-handling" })).status).toBe(403)
      const readOnly = yield* post(READER, BATCH, { ids: [IDS.batch1], category: "case-handling" })
      expect(readOnly.status).toBe(403)
      expect((yield* json(ErrorResponse, readOnly)).error).toContain("没有")
      // 授权先于读体：没有 admin 的人递畸形 JSON 也拿 403，不是 400（`#004-09`）。
      expect((yield* post(READER, BATCH, "不是对象")).status).toBe(403)
    }),
  )

  it.live("参数：空 ids / 非字符串 / 超上限 / 目标为兜底项 / 目标分类停用或不存在 ⇒ 400", () =>
    Effect.gen(function* () {
      const 坏体 = [
        {},
        { ids: [], category: "case-handling" },
        { ids: [1], category: "case-handling" },
        { ids: [""], category: "case-handling" },
        { ids: Array.from({ length: 101 }, (_, i) => `id-${i}`), category: "case-handling" },
        { ids: [IDS.batch1] },
        { ids: [IDS.batch1], category: 兜底 },
        { ids: [IDS.batch1], category: 停用分类 },
        { ids: [IDS.batch1], category: "no-such-category" },
      ]
      for (const body of 坏体) {
        const response = yield* post(ADMIN, BATCH, body)
        expect(response.status).toBe(400)
        expect((yield* json(ErrorResponse, response)).error).toBeTruthy()
      }
      // 一条都不该被改。
      expect(yield* Effect.promise(() => 库分类(IDS.batch1))).toBe("ghost-category")
    }),
  )

  it.live("整批原子：有一个 id 不存在 ⇒ 404，存在的那些也一个都不改", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, BATCH, { ids: [IDS.batch1, "asset-nope"], category: "case-handling" })

      expect(response.status).toBe(404)
      expect((yield* json(ErrorResponse, response)).error).toContain("asset-nope")
      expect(yield* Effect.promise(() => 库分类(IDS.batch1))).toBe("ghost-category")
    }),
  )

  it.live("成功：两条都挪过去、回 updated=2、逐条留审计（from → to）、重复调用幂等", () =>
    Effect.gen(function* () {
      const before = yield* Effect.promise(() => 审计条数())

      const body = yield* json(
        BatchResponse,
        yield* post(ADMIN, BATCH, { ids: [IDS.batch1, IDS.batch2], category: "case-handling" }),
      )
      expect(body.updated).toBe(2)

      expect(yield* Effect.promise(() => 库分类(IDS.batch1))).toBe("case-handling")
      expect(yield* Effect.promise(() => 库分类(IDS.batch2))).toBe("case-handling")

      const 审计 = yield* Effect.promise(async () => {
        if (!pg) throw new Error("真库没起来")
        return rowsOf(
          await pg.db.execute(
            sql`select target_id, detail::jsonb ->> 'from' as from_category, detail::jsonb ->> 'to' as to_category
                from auth.audit_event where action = 'asset.category' and result = 'ok' order by id asc`,
          ),
        )
      })
      expect(审计.map((row) => String(row.target_id)).sort()).toEqual([IDS.batch1, IDS.batch2].sort())
      expect(审计.every((row) => row.to_category === "case-handling")).toBe(true)
      expect(审计.map((row) => String(row.from_category)).sort()).toEqual(["ghost-category", "intelligence"])
      expect(yield* Effect.promise(() => 审计条数())).toBe(before + 2)

      // 幂等：一条都没改 ⇒ updated=0，审计也不涨（「没改也算改」会灌水）。
      const 再 = yield* json(
        BatchResponse,
        yield* post(ADMIN, BATCH, { ids: [IDS.batch1, IDS.batch2], category: "case-handling" }),
      )
      expect(再.updated).toBe(0)
      expect(yield* Effect.promise(() => 审计条数())).toBe(before + 2)
    }),
  )

  it.live("挪走之后使用面的兜底桶里就没有它了", () =>
    Effect.gen(function* () {
      const body = yield* json(ListResponse, yield* get(OFFICER, `${LIST}?category=${兜底}`))
      const ids = body.assets.map((asset) => asset.id)

      expect(ids).not.toContain(IDS.batch1)
      expect(ids).not.toContain(IDS.batch2)
    }),
  )
})
