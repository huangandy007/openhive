import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
 * 010 T007 · AI 资产治理的两个 HTTP 出口（FR-006 / US3）。
 *
 * 判据分三层，**每一层都落在可以观测的东西上**：
 *
 * 1. **门**：未登录 401 / 普通民警 403 / 业务专家与系统管理员各见各的（read ≠ review ≠ admin）。
 *    路由必须在（403 不是 404——`LEARNINGS #002-02`）。
 * 2. **动作**：审核 / 发布 / 上下架走 009 的 7 状态机，判据是**库里那一行与共享根里的目录**
 *    一起变，而不是只看回包。
 * 3. **两道关分离**：业务专家不能发布（无 admin），系统管理员不能替业务审核（无 review）。
 *    这一条是 T002 权限矩阵在资产域的落点，缺了它「两类管理员分权」只测了账号那半边。
 *
 * ⚠️ 授权排在读体之前（`#004-09`）：民警递畸形 JSON 必须拿 403，而不是 400。
 *
 * ⚠️ 不复用 009 的 `transitionAsset` 测试夹具：那边只证明服务层对，这里证明**出口接线**
 * （身份 → 治理授权 → 合成授权行 → 服务层）对。两者都绿才叫「后台动作可用」。
 */

const it = testEffect(Layer.empty)

const SECRET = "b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6"

const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "920001",
  name: "系统管理员甲",
  isAdmin: true,
}
const EXPERT: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "920003",
  name: "业务专家丙",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "920002",
  name: "民警乙",
  isAdmin: false,
}
/** 自定义角色：只有 `asset-governance/read`，没有任何动作权。 */
const READER: TokenSubject = {
  id: "dddddddd-4444-4444-8444-444444444444",
  policeNo: "920004",
  name: "只读丁",
  isAdmin: true,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const GOV = "/openhive/governance/assets"
const transitionUrl = (id: string) => `${GOV}/${id}/transition`

const ASSETS_ROOT = mkdtempSync(join(tmpdir(), "openhive-gov-assets-"))
const restoreAssetsRoot = restorePoint({ OPENHIVE_ASSETS_ROOT: ASSETS_ROOT })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
/**
 * PGlite 夹具把多条连接汇进同一个 PG 会话，而 `bun-sql` 的语句缓存是连接级的。
 * 与组织路由测试同一个前置（`#004-11` 的反面：这个变量只在本进程里通过 `process.env` 读）。
 */
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
  publishedAt: null,
  archivedAt: null,
  ...over,
})

const IDS = {
  /** 审核中：业务专家可以过、系统管理员不能替审。 */
  review: "asset-review-0001",
  /** 待技术发布：系统管理员可以发布，业务专家不能。 */
  pending: "asset-pending-0001",
  /** 已发布：可以下线。 */
  published: "asset-published-0001",
  /** 审核中、预备用驳回（驳回不删 `pending/`）。 */
  reject: "asset-reject-0001",
  /** 草稿：治理后台不允许作者动作。 */
  draft: "asset-draft-0001",
  /** 非 Skill：状态机不适用。 */
  mcp: "asset-mcp-0001",
} as const

/** 在共享根里造一个带文件的目录（流转会真的搬它）。 */
function 造目录(directory: string, content = "# 成果\n") {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "SKILL.md"), content, "utf8")
}

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, OFFICER, EXPERT, READER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-asset-reader', '资产只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-asset-reader', 'governance', 'asset-governance', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${READER.id}, 'test-asset-reader')`)

  await insertAsset(pg.db, 资产({ id: IDS.review, name: "资金流水分析", status: "in_review", updatedAt: 1_400 }))
  await insertAsset(pg.db, 资产({ id: IDS.pending, name: "话单碰撞分析", status: "pending_tech", updatedAt: 1_300 }))
  await insertAsset(
    pg.db,
    资产({ id: IDS.published, name: "涉案账户串并", status: "published", updatedAt: 1_200, publishedAt: 1_100 }),
  )
  await insertAsset(pg.db, 资产({ id: IDS.reject, name: "待驳回的规则", status: "in_review", updatedAt: 1_100 }))
  await insertAsset(
    pg.db,
    资产({ id: IDS.draft, name: "作者草稿", status: "draft", visibility: "personal", updatedAt: 1_000 }),
  )
  await insertAsset(
    pg.db,
    资产({ id: IDS.mcp, name: "话单查询 MCP", type: "mcp", status: "in_review", updatedAt: 1_500 }),
  )

  造目录(join(ASSETS_ROOT, "pending", IDS.review))
  造目录(join(ASSETS_ROOT, "pending", IDS.pending))
  造目录(join(ASSETS_ROOT, "pending", IDS.reject))
  造目录(join(ASSETS_ROOT, "global", "skills", IDS.published))
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
  type: Schema.String,
  status: Schema.String,
  visibility: Schema.String,
  department: Schema.String,
  version: Schema.Number,
  updatedAt: Schema.Number,
  publishedAt: Schema.NullOr(Schema.Number),
})
const ListResponse = Schema.Struct({ assets: Schema.Array(Asset) })
const TransitionResponse = Schema.Struct({ asset: Asset })
const ErrorResponse = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 库里的状态（**裸 SQL**，不经被测对象）。 */
async function 库状态(id: string): Promise<string> {
  if (!pg) throw new Error("真库没起来")
  const [row] = rowsOf(await pg.db.execute(sql`select status, published_at from auth.asset where id = ${id}`))
  if (!row) throw new Error(`资产不存在：${id}`)
  return String(row.status)
}

const 有文件 = (path: string) => existsSync(path)

describe("T007 · 读出口的门", () => {
  it.live("无凭证 ⇒ 401；普通民警 ⇒ 403（路由在，拒绝不是 404）", () =>
    Effect.gen(function* () {
      const anonymous = yield* get(null, GOV)
      expect(anonymous.status).toBe(401)

      const officer = yield* get(OFFICER, GOV)
      expect(officer.status).toBe(403)
      expect((yield* json(ErrorResponse, officer)).error).toContain("没有")
    }),
  )

  it.live("业务专家与系统管理员都能看全部状态（后台看的是全量，不是使用者的可见面）", () =>
    Effect.gen(function* () {
      for (const subject of [EXPERT, ADMIN]) {
        const body = yield* json(ListResponse, yield* get(subject, GOV))
        const ids = body.assets.map((asset) => asset.id)
        expect(ids).toContain(IDS.review)
        expect(ids).toContain(IDS.pending)
        expect(ids).toContain(IDS.draft)
        expect(ids).toContain(IDS.mcp)
      }
    }),
  )

  it.live("只读角色能看列表（read 就是进门），排序按 updatedAt 倒序", () =>
    Effect.gen(function* () {
      const body = yield* json(ListResponse, yield* get(READER, GOV))
      const 时间 = body.assets.map((asset) => asset.updatedAt)
      expect([...时间].sort((a, b) => b - a)).toEqual(时间)
      expect(body.assets[0]?.id).toBe(IDS.mcp)
    }),
  )
})

describe("T007 · 读出口的过滤", () => {
  it.live("status 过滤只回该状态；未知 status ⇒ 400（闭集在出口收窄，不靠库）", () =>
    Effect.gen(function* () {
      const 审核中 = yield* json(ListResponse, yield* get(EXPERT, `${GOV}?status=in_review`))
      expect(审核中.assets.map((asset) => asset.id).sort()).toEqual([IDS.mcp, IDS.reject, IDS.review].sort())

      const 非法 = yield* get(EXPERT, `${GOV}?status=published_maybe`)
      expect(非法.status).toBe(400)
      expect((yield* json(ErrorResponse, 非法)).error).toContain("状态")
    }),
  )

  it.live("type 过滤只回该类型；未知 type ⇒ 400", () =>
    Effect.gen(function* () {
      const mcp = yield* json(ListResponse, yield* get(EXPERT, `${GOV}?type=mcp`))
      expect(mcp.assets.map((asset) => asset.id)).toEqual([IDS.mcp])

      expect((yield* get(EXPERT, `${GOV}?type=plugin`)).status).toBe(400)
    }),
  )

  it.live("q 命中名称与描述；空 q 视作没传", () =>
    Effect.gen(function* () {
      const 命中 = yield* json(ListResponse, yield* get(EXPERT, `${GOV}?q=${encodeURIComponent("话单")}`))
      expect(命中.assets.map((asset) => asset.id)).toEqual([IDS.mcp, IDS.pending].sort())

      const 空 = yield* json(ListResponse, yield* get(EXPERT, `${GOV}?q=`))
      expect(空.assets.length).toBe(6)
    }),
  )
})

describe("T007 · 审核与发布动作", () => {
  it.live("业务专家通过审核 ⇒ 200，库里 in_review → pending_tech", () =>
    Effect.gen(function* () {
      const response = yield* post(EXPERT, transitionUrl(IDS.review), { action: "approve_business" })
      expect(response.status).toBe(200)
      expect((yield* json(TransitionResponse, response)).asset.status).toBe("pending_tech")
      expect(yield* Effect.promise(() => 库状态(IDS.review))).toBe("pending_tech")
    }),
  )

  it.live("系统管理员发布 ⇒ 200，pending 目录搬进 global 发布目录，publishedAt 落库", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, transitionUrl(IDS.pending), { action: "publish_tech" })
      expect(response.status).toBe(200)
      const body = yield* json(TransitionResponse, response)
      expect(body.asset.status).toBe("published")
      expect(body.asset.publishedAt).not.toBeNull()

      expect(有文件(join(ASSETS_ROOT, "pending", IDS.pending))).toBe(false)
      expect(有文件(join(ASSETS_ROOT, "global", "skills", IDS.pending, "SKILL.md"))).toBe(true)
      expect(yield* Effect.promise(() => 库状态(IDS.pending))).toBe("published")
    }),
  )

  it.live("个人资产发布时带可见范围 ⇒ 200；库、文件、审计一起落地", () =>
    Effect.gen(function* () {
      const id = "asset-personal-scope-0001"
      if (!pg) throw new Error("真库没起来")
      const db = pg.db
      yield* Effect.promise(() =>
        insertAsset(
          db,
          资产({ id, name: "个人讲话稿", status: "pending_tech", visibility: "personal", updatedAt: 1_100 }),
        ),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      const response = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "department",
      })

      expect(response.status).toBe(200)
      expect((yield* json(TransitionResponse, response)).asset.visibility).toBe("department")
      // 部门目录是 `dept/`（`storage.ts:96`）。
      expect(有文件(join(ASSETS_ROOT, "dept", "基座部门", "skills", id, "SKILL.md"))).toBe(true)
      expect(有文件(join(ASSETS_ROOT, "pending", id))).toBe(false)

      // `detail` 是 text 列（0015 迁移），不是 jsonb：先在 SQL 里转 jsonb 取键，顺序无关。
      const [审计] = rowsOf(
        yield* Effect.promise(() =>
          db.execute(
            sql`select detail::jsonb->>'visibility' as visibility from auth.audit_event where target_id = ${id} order by id desc limit 1`,
          ),
        ),
      )
      expect(审计?.["visibility"]).toBe("department")
    }),
  )

  it.live("发布范围参数不合法 ⇒ 400；个人资产不带范围仍 409", () =>
    Effect.gen(function* () {
      const id = "asset-personal-scope-0002"
      if (!pg) throw new Error("真库没起来")
      const db = pg.db
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id, name: "个人讲话稿二", status: "pending_tech", visibility: "personal", updatedAt: 1_100 })),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      const 未知 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech", visibility: "world" })
      expect(未知.status).toBe(400)
      const 未知体 = yield* json(ErrorResponse, 未知)
      expect(未知体.error).toContain("未知可见范围")
      expect(未知体.field).toBe("visibility")

      const 个人 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech", visibility: "personal" })
      expect(个人.status).toBe(400)
      expect((yield* json(ErrorResponse, 个人)).error).toContain("部门或全局")

      const 缺省 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech" })
      expect(缺省.status).toBe(409)

      // 非发布动作带范围：服务层拒绝，出口翻 400。
      // 用**本用例自建**的资产，不借共享夹具（`IDS.review` 会被别的用例改成 pending_tech，
      // 那时先撞 `invalid_source`）。
      const 越界ID = "asset-scope-out-0003"
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id: 越界ID, name: "越界参数", status: "in_review", updatedAt: 1_100 })),
      )
      const 越界 = yield* post(EXPERT, transitionUrl(越界ID), {
        action: "approve_business",
        visibility: "global",
      })
      expect(越界.status).toBe(400)
      expect((yield* json(ErrorResponse, 越界)).error).toContain("不接受可见范围")
    }),
  )

  it.live("个人资产选「本部门」但部门为空 ⇒ 409，状态与 pending 目录零副作用", () =>
    Effect.gen(function* () {
      const id = "asset-scope-nodep-0004"
      if (!pg) throw new Error("真库没起来")
      const db = pg.db
      yield* Effect.promise(() =>
        insertAsset(
          db,
          资产({
            id,
            name: "无部门资源",
            status: "pending_tech",
            visibility: "personal",
            department: "",
            updatedAt: 1_100,
          }),
        ),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      const response = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech", visibility: "department" })

      expect(response.status).toBe(409)
      expect((yield* json(ErrorResponse, response)).error).toContain("没有部门信息")
      expect(yield* Effect.promise(() => 库状态(id))).toBe("pending_tech")
      expect(有文件(join(ASSETS_ROOT, "pending", id, "SKILL.md"))).toBe(true)
    }),
  )

  it.live("个人可见范围的资产发布 ⇒ 409（不是 500），库里状态与 pending 目录零副作用", () =>
    Effect.gen(function* () {
      const id = "asset-personal-0001"
      if (!pg) throw new Error("真库没起来")
      const db = pg.db
      yield* Effect.promise(() =>
        insertAsset(
          db,
          资产({ id, name: "个人讲话稿", status: "pending_tech", visibility: "personal", updatedAt: 1_100 }),
        ),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      const response = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech" })
      // 个人资产没有共享发布目录：这是业务前提不成立，不是内部故障（010 真栈实得 500 的回归）。
      expect(response.status).toBe(409)
      expect((yield* json(ErrorResponse, response)).error).toContain("个人资产")

      expect(yield* Effect.promise(() => 库状态(id))).toBe("pending_tech")
      expect(有文件(join(ASSETS_ROOT, "pending", id, "SKILL.md"))).toBe(true)
    }),
  )

  it.live("驳回必须带理由：缺理由 ⇒ 400 field=reason；带了 ⇒ 200 回草稿，pending 目录仍在", () =>
    Effect.gen(function* () {
      const 缺理由 = yield* post(EXPERT, transitionUrl(IDS.reject), { action: "reject_business" })
      expect(缺理由.status).toBe(400)
      expect((yield* json(ErrorResponse, 缺理由)).field).toBe("reason")
      expect(yield* Effect.promise(() => 库状态(IDS.reject))).toBe("in_review")

      const 带理由 = yield* post(EXPERT, transitionUrl(IDS.reject), {
        action: "reject_business",
        reason: "规则只适用于本专案",
      })
      expect(带理由.status).toBe(200)
      expect(yield* Effect.promise(() => 库状态(IDS.reject))).toBe("draft")
      expect(有文件(join(ASSETS_ROOT, "pending", IDS.reject))).toBe(true)
    }),
  )

  it.live("下线不搬目录（旧版仍可见），再归档才搬进 archive", () =>
    Effect.gen(function* () {
      const offline = yield* post(ADMIN, transitionUrl(IDS.published), { action: "take_offline" })
      expect(offline.status).toBe(200)
      expect(yield* Effect.promise(() => 库状态(IDS.published))).toBe("offline")
      expect(有文件(join(ASSETS_ROOT, "global", "skills", IDS.published, "SKILL.md"))).toBe(true)

      const archived = yield* post(ADMIN, transitionUrl(IDS.published), { action: "archive" })
      expect(archived.status).toBe(200)
      expect(yield* Effect.promise(() => 库状态(IDS.published))).toBe("archived")
      expect(有文件(join(ASSETS_ROOT, "archive", IDS.published, "SKILL.md"))).toBe(true)
    }),
  )
})

describe("T007 · 两道关分离（业务专家 ≠ 系统管理员）", () => {
  it.live("业务专家不能发布 ⇒ 403（review 不蕴含 admin）", () =>
    Effect.gen(function* () {
      const response = yield* post(EXPERT, transitionUrl(IDS.pending), { action: "publish_tech" })
      expect(response.status).toBe(403)
      expect((yield* json(ErrorResponse, response)).error).toContain("admin")
    }),
  )

  it.live("系统管理员不能替业务审核 ⇒ 403（admin 不蕴含 review），也不能下线给专家的资产", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, transitionUrl(IDS.reject), { action: "approve_business" })
      expect(response.status).toBe(403)
      expect((yield* json(ErrorResponse, response)).error).toContain("review")

      // 下线只认 admin：业务专家同样不许。
      const 专家下线 = yield* post(EXPERT, transitionUrl(IDS.published), { action: "take_offline" })
      expect(专家下线.status).toBe(403)
    }),
  )

  it.live("只读角色能看不能动 ⇒ 403；普通民警同样 403（授权先于一切副作用）", () =>
    Effect.gen(function* () {
      for (const subject of [READER, OFFICER]) {
        const response = yield* post(subject, transitionUrl(IDS.mcp), { action: "approve_business" })
        expect(response.status).toBe(403)
      }
      expect(yield* Effect.promise(() => 库状态(IDS.mcp))).toBe("in_review")
    }),
  )
})

describe("T007 · 动作收窄与错误翻译", () => {
  it.live("作者动作（提交审核）不走治理后台 ⇒ 400；未知动作 ⇒ 400", () =>
    Effect.gen(function* () {
      const 提交 = yield* post(ADMIN, transitionUrl(IDS.draft), { action: "submit_review" })
      expect(提交.status).toBe(400)
      expect((yield* json(ErrorResponse, 提交)).error).toContain("治理后台")

      const 未知 = yield* post(ADMIN, transitionUrl(IDS.draft), { action: "delete_everything" })
      expect(未知.status).toBe(400)
    }),
  )

  it.live("资产不存在 ⇒ 404；非 Skill ⇒ 400（7 状态机不套错表）", () =>
    Effect.gen(function* () {
      expect((yield* post(ADMIN, transitionUrl("asset-nope-0001"), { action: "take_offline" })).status).toBe(404)

      const 非技能 = yield* post(ADMIN, transitionUrl(IDS.mcp), { action: "publish_tech" })
      expect(非技能.status).toBe(400)
      expect((yield* json(ErrorResponse, 非技能)).error).toContain("Skill")
    }),
  )

  it.live("状态不允许该动作 ⇒ 409（系统管理员不能跳过业务审核）", () =>
    Effect.gen(function* () {
      const response = yield* post(EXPERT, transitionUrl(IDS.mcp), { action: "approve_business" })
      // 先撞类型（mcp 不走技能状态机），换一份技能资产再钉 invalid_source。
      expect(response.status).toBe(400)

      const 跳过 = yield* post(ADMIN, transitionUrl(IDS.draft), { action: "publish_tech" })
      expect(跳过.status).toBe(409)
    }),
  )

  it.live("民警递畸形请求体 ⇒ 403 而不是 400（授权排在读体之前，`#004-09`）", () =>
    Effect.gen(function* () {
      const response = yield* as(OFFICER, transitionUrl(IDS.review), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ 不是 JSON",
      })
      expect(response.status).toBe(403)
    }),
  )

  it.live("空体 / 非对象体 ⇒ 400（能进门的人拿到的是字段错误）", () =>
    Effect.gen(function* () {
      expect((yield* post(EXPERT, transitionUrl(IDS.review))).status).toBe(400)

      const 数组 = yield* as(EXPERT, transitionUrl(IDS.review), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[1,2,3]",
      })
      expect(数组.status).toBe(400)
    }),
  )
})
