import { afterAll, beforeAll, describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 需求 4 · 业务分类出口（2026-10-27）：
 * 使用面 `GET /openhive/categories`、管理面 `GET/POST /openhive/governance/categories`。
 *
 * 判据四块：
 * ① **使用面登录即可读**，只回启用项、按 `sort_order` 排；停用的当场消失。
 * ② **管理面按 `asset-governance` 板块授权**：read 能看列表（含停用），admin 才能写。
 * ③ **写动作的四种收场**：新建 201、重名 409、空名 400、未知 id 404；空补丁也是 400。
 * ④ **没有删除这条出口**：DELETE 打不动（分类要停用不要删——资产行的 `category` 存 id）。
 *    注意本应用**未注册的路径落到 SPA 兜底（200 + HTML）**，所以这条不能用状态码判——
 *    实测 `DELETE` 拿到的是 HTML 而非 JSON，判据是「没有 JSON 处理器跑过 ＋ 那一行还在」。
 *    同理，别的用例里的 404 都是**处理器自己回的**，不是路由没命中。
 *
 * 表规则一条都不在这里断言（在 `asset-service/category-store.test.ts`）——本文件只钉接线。
 */

const it = testEffect(Layer.empty)

const SECRET = "c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6"

const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "930001",
  name: "系统管理员甲",
  isAdmin: true,
}
const EXPERT: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "930003",
  name: "业务专家丙",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "930002",
  name: "民警乙",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const 使用面 = "/openhive/categories"
const 管理面 = "/openhive/governance/categories"
const 编辑 = (id: string) => `${管理面}/${id}`

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, EXPERT, OFFICER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '甲部门', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
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

const as = (subject: TokenSubject | null, url: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const headers = new Headers(init?.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const get = (subject: TokenSubject | null, url: string) => as(subject, url)

const post = (subject: TokenSubject | null, url: string, body: unknown) =>
  as(subject, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const 分类 = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  sortOrder: Schema.Number,
  enabled: Schema.Boolean,
  builtin: Schema.Boolean,
})
const 列表 = Schema.Struct({ categories: Schema.Array(分类) })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    return Schema.decodeUnknownSync(schema)(JSON.parse(yield* Effect.promise(() => response.text())))
  })

describe("需求 4 · 使用面分类出口", () => {
  it.live("无凭证 ⇒ 401", () =>
    Effect.gen(function* () {
      expect((yield* get(null, 使用面)).status).toBe(401)
    }),
  )

  it.live("登录即读：回 seed 九类，按 sortOrder 升序", () =>
    Effect.gen(function* () {
      const response = yield* get(OFFICER, 使用面)
      expect(response.status).toBe(200)

      const { categories } = yield* json(列表, response)
      expect(categories.map((row) => row.name)).toEqual([
        "情报研判",
        "案件办理",
        "审讯深挖",
        "报捕起诉",
        "文书写作",
        "内勤文字",
        "方案制作",
        "督导考核",
        "专项行动",
      ])
      expect(categories.every((row) => row.enabled)).toBe(true)
    }),
  )

  it.live("停用的分类当场消失，管理面仍看得见", () =>
    Effect.gen(function* () {
      const 停用 = yield* post(ADMIN, 编辑("supervision"), { enabled: false })
      expect(停用.status).toBe(200)

      const { categories } = yield* json(列表, yield* get(OFFICER, 使用面))
      expect(categories.some((row) => row.id === "supervision")).toBe(false)

      const 管理 = yield* json(列表, yield* get(ADMIN, 管理面))
      expect(管理.categories.find((row) => row.id === "supervision")?.enabled).toBe(false)

      // 启回来（后续用例要用干净的起点）
      expect((yield* post(ADMIN, 编辑("supervision"), { enabled: true })).status).toBe(200)
    }),
  )
})

describe("需求 4 · 管理面分类出口", () => {
  it.live("普通民警：列表 403（没进门的 read）", () =>
    Effect.gen(function* () {
      expect((yield* get(OFFICER, 管理面)).status).toBe(403)
    }),
  )

  it.live("业务专家：能读列表（含停用项），但写是 403（板块只给 read/review）", () =>
    Effect.gen(function* () {
      expect((yield* get(EXPERT, 管理面)).status).toBe(200)
      expect((yield* post(EXPERT, 管理面, { name: "越权分类" })).status).toBe(403)
      expect((yield* post(EXPERT, 编辑("intelligence"), { name: "越权改名" })).status).toBe(403)
    }),
  )

  it.live("系统管理员：新建 201，使用面立刻可见（闭集读库，不是读常量）", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, 管理面, { name: "资金分析" })
      expect(response.status).toBe(201)

      const 新 = yield* json(分类, response)
      expect(新.id.startsWith("cat_")).toBe(true)
      expect(新).toMatchObject({ name: "资金分析", enabled: true, builtin: false })

      const { categories } = yield* json(列表, yield* get(OFFICER, 使用面))
      expect(categories.map((row) => row.id)).toContain(新.id)
    }),
  )

  it.live("重名 409 / 空名 400 / 非法 sortOrder 400", () =>
    Effect.gen(function* () {
      expect((yield* post(ADMIN, 管理面, { name: "情报研判" })).status).toBe(409)
      expect((yield* post(ADMIN, 管理面, { name: "   " })).status).toBe(400)
      expect((yield* post(ADMIN, 管理面, { name: "甲", sortOrder: 1.5 })).status).toBe(400)
    }),
  )

  it.live("改名不换 id；改排序立刻生效；空补丁 400；未知 id 404", () =>
    Effect.gen(function* () {
      const 改名 = yield* post(ADMIN, 编辑("planning"), { name: "方案与报告", sortOrder: 5 })
      expect(改名.status).toBe(200)
      expect(yield* json(分类, 改名)).toMatchObject({ id: "planning", name: "方案与报告", sortOrder: 5 })

      const { categories } = yield* json(列表, yield* get(OFFICER, 使用面))
      expect(categories[0]).toMatchObject({ id: "planning", name: "方案与报告" })

      expect((yield* post(ADMIN, 编辑("planning"), {})).status).toBe(400)
      expect((yield* post(ADMIN, 编辑("不存在的分类"), { enabled: false })).status).toBe(404)

      // 还原，别让后面的用例顺序依赖这条
      expect((yield* post(ADMIN, 编辑("planning"), { name: "方案制作", sortOrder: 70 })).status).toBe(200)
    }),
  )

  it.live("没有删除这条出口：DELETE 落静态兜底（非 JSON），分类仍在", () =>
    Effect.gen(function* () {
      const response = yield* as(ADMIN, 编辑("intelligence"), { method: "DELETE" })
      // 本应用未注册的路径一律落到 SPA 兜底（**200 + HTML**，见 `DEBUG` 实测），
      // 所以判据不是状态码，而是「没有任何 JSON 处理器跑过」＋「那一行还在」。
      expect(response.headers.get("content-type") ?? "").not.toContain("application/json")

      const { categories } = yield* json(列表, yield* get(ADMIN, 管理面))
      expect(categories.some((row) => row.id === "intelligence")).toBe(true)
    }),
  )
})
