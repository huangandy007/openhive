import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 010 T006 · 组织架构的五个 HTTP 出口（FR-005 / US2）。
 *
 * 与账号管理同一个打法：真应用 ＋ 真库，判据落在「库里那一行变没变」。
 * 这里多钉三件事：
 *
 * 1. **授权排在一切副作用之前**（`#004-09`）：民警递**非法载荷**必须拿 403 而不是 400，
 *    否则非管理员能拿 400/403 的差别当「字段合不合法」的探针。
 * 2. **改名要级联到 `auth.user`**：判据不是「树上的名字变了」，而是「账号的 org 列也变了」。
 * 3. **删除守卫**：有下级 / 有关联账号都必须 409，且树与账号都原样。
 */

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "910001",
  name: "管理员甲",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "910002",
  name: "民警乙",
  isAdmin: false,
}
/** 业务专家模板里**没有** `org-tree` 任何权限（T002 的矩阵）。 */
const EXPERT: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "910003",
  name: "业务专家丙",
  isAdmin: true,
}
/** 只有 `org-tree/read` 的自定义角色：read ≠ write 的观测面。 */
const READER: TokenSubject = {
  id: "dddddddd-4444-4444-8444-444444444444",
  policeNo: "910004",
  name: "只读丁",
  isAdmin: true,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const ORG = "/openhive/governance/org"
const TREE = `${ORG}/tree`
const NODES = `${ORG}/nodes`
const IMPORT = `${ORG}/import`
const renameUrl = (id: string) => `${NODES}/${id}/rename`
const nodeUrl = (id: string) => `${NODES}/${id}`

/**
 * 网关在**层构造期**解析默认口令（配了网关却缺它 ⇒ 直接抛）。本文件不开登录/改密端点，
 * 但只要 `OPENHIVE_REQUIRE_USER_ID=1`，构造期就会读一次——与账号路由测试同一个前置。
 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

/**
 * 被测代码的连接池钉到**一条连接**。
 *
 * PGlite 夹具把多条连接汇进同一个 PG 会话（预编译语句是会话级的），而 `bun-sql` 的
 * 语句缓存是**连接级**的 ⇒ `db.transaction()` 从池里独占一条连接后，随后那条
 * `authorizeGovernance` 换连接重新准备同一句带参 SQL，服务端报 `42P05`
 * （`@opencode-ai/auth/test-support` 的 T021 实测；本文件实测症状是**改名之后读树 500**）。
 * 生产不受影响（真 PG 的预编译语句按会话隔离），理由与读法见 `packages/auth/src/db.ts` 的 `poolMaxOf`。
 *
 * 必须在**首条请求之前**写进 `process.env`：`connect(process.env)` 是首条查询才读它。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

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
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-org-reader', '组织只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-org-reader', 'governance', 'org-tree', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${READER.id}, 'test-org-reader')`)
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

const del = (subject: TokenSubject | null, url: string) => as(subject, url, { method: "DELETE" })

const Node = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  level: Schema.Number,
  name: Schema.String,
  path: Schema.Array(Schema.String),
  childCount: Schema.Number,
  accountCount: Schema.Number,
})

const TreeResponse = Schema.Struct({ nodes: Schema.Array(Node) })
const ErrorResponse = Schema.Struct({ error: Schema.String })
const ImportResponse = Schema.Struct({ created: Schema.Number })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 在 `Effect.gen` 里读库（`gen` 不是 async 函数）。 */
const 读库 = (query: ReturnType<typeof sql>) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    return rowsOf(await pg.db.execute(query))
  })

/** 库里的账号 org（**裸 SQL**，不经被测对象）。 */
async function 账号org(id: string): Promise<string> {
  if (!pg) throw new Error("真库没起来")
  const [row] = rowsOf(await pg.db.execute(sql`select org from auth.user where id = ${id}`))
  if (!row) throw new Error(`账号不存在：${id}`)
  return String(row.org)
}

/** 建一个根节点（管理员），返回响应体。 */
const 建根 = (name: string) =>
  Effect.gen(function* () {
    const response = yield* post(ADMIN, NODES, { parentId: null, name })
    expect(response.status).toBe(201)
    return yield* json(Node, response)
  })

describe("T006 · 读出口的门与形状", () => {
  it.live("无凭证 ⇒ 401；民警 ⇒ 403（内容类型先立住，避免 SPA 兜底的假 200）", () =>
    Effect.gen(function* () {
      const anonymous = yield* get(null, TREE)
      expect(anonymous.status).toBe(401)

      const officer = yield* get(OFFICER, TREE)
      expect(officer.status).toBe(403)
      expect((yield* json(ErrorResponse, officer)).error).toContain("没有")
    }),
  )

  it.live("只读角色能看树、不能建节点（read ≠ write）", () =>
    Effect.gen(function* () {
      const read = yield* get(READER, TREE)
      expect(read.status).toBe(200)
      const body = yield* json(TreeResponse, read)
      expect(Array.isArray(body.nodes)).toBe(true)

      const write = yield* post(READER, NODES, { parentId: null, name: "只读不该建出来" })
      expect(write.status).toBe(403)
      expect((yield* json(ErrorResponse, write)).error).toContain("没有")
      expect((yield* 读库(sql`select count(*)::int as n from auth.org_node where name = '只读不该建出来'`))[0]?.n).toBe(0)
    }),
  )

  it.live("业务专家 ⇒ 403（模板里没有 org-tree 的授权）", () =>
    Effect.gen(function* () {
      expect((yield* get(EXPERT, TREE)).status).toBe(403)
      expect((yield* post(EXPERT, NODES, { parentId: null, name: "专家不该建出来" })).status).toBe(403)
    }),
  )
})

describe("T006 · 建节点", () => {
  it.live("管理员建三级 ⇒ 201，形状逐字、path 逐级拼出来", () =>
    Effect.gen(function* () {
      const org = yield* 建根("甲单位")
      expect(org).toMatchObject({ parentId: null, level: 1, path: ["甲单位"], childCount: 0, accountCount: 0 })

      const deptResponse = yield* post(ADMIN, NODES, { parentId: org.id, name: "经侦支队" })
      expect(deptResponse.status).toBe(201)
      const dept = yield* json(Node, deptResponse)
      expect(dept).toMatchObject({ level: 2, path: ["甲单位", "经侦支队"] })

      const sectionResponse = yield* post(ADMIN, NODES, { parentId: dept.id, name: "一大队" })
      const section = yield* json(Node, sectionResponse)
      expect(section).toMatchObject({ level: 3, path: ["甲单位", "经侦支队", "一大队"] })

      const tree = yield* json(TreeResponse, yield* get(ADMIN, TREE))
      expect(tree.nodes.map((node) => node.path.join("/"))).toContain("甲单位/经侦支队/一大队")
    }),
  )

  it.live("民警递非法载荷（空名）⇒ 403 而不是 400（授权在解析之前，`#004-09`）", () =>
    Effect.gen(function* () {
      const before = (yield* 读库(sql`select count(*)::int as n from auth.org_node`))[0]?.n

      const response = yield* post(OFFICER, NODES, { parentId: null, name: "" })

      expect(response.status).toBe(403)
      const after = (yield* 读库(sql`select count(*)::int as n from auth.org_node`))[0]?.n
      expect(after).toBe(before)
    }),
  )

  it.live("同级同名 ⇒ 409；第四级 ⇒ 400；父节点不存在 ⇒ 404", () =>
    Effect.gen(function* () {
      const org = yield* 建根("乙单位")
      const deptResponse = yield* post(ADMIN, NODES, { parentId: org.id, name: "刑侦支队" })
      const dept = yield* json(Node, deptResponse)
      const sectionResponse = yield* post(ADMIN, NODES, { parentId: dept.id, name: "二大队" })
      const section = yield* json(Node, sectionResponse)

      const duplicate = yield* post(ADMIN, NODES, { parentId: org.id, name: "刑侦支队" })
      expect(duplicate.status).toBe(409)
      expect((yield* json(ErrorResponse, duplicate)).error).toContain("同名")

      const tooDeep = yield* post(ADMIN, NODES, { parentId: section.id, name: "一组" })
      expect(tooDeep.status).toBe(400)
      expect((yield* json(ErrorResponse, tooDeep)).error).toContain("三级")

      const missingParent = yield* post(ADMIN, NODES, { parentId: "nobody", name: "孤儿" })
      expect(missingParent.status).toBe(404)
    }),
  )

  it.live("空名 / 非 JSON 体 ⇒ 400（管理员）；名字两端空格被 trim", () =>
    Effect.gen(function* () {
      const empty = yield* post(ADMIN, NODES, { parentId: null, name: "   " })
      expect(empty.status).toBe(400)

      const malformed = yield* as(ADMIN, NODES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
      expect(malformed.status).toBe(400)

      const spaced = yield* 建根("  丙单位  ")
      expect(spaced.name).toBe("丙单位")
    }),
  )
})

describe("T006 · 改名级联", () => {
  it.live("改单位名 ⇒ 204，树上名字变了、账号的 org 列也变了", () =>
    Effect.gen(function* () {
      const org = yield* 建根("丁单位")

      const response = yield* post(ADMIN, renameUrl(org.id), { name: "丁单位（新）" })
      expect(response.status).toBe(204)

      const tree = yield* json(TreeResponse, yield* get(ADMIN, TREE))
      const renamed = tree.nodes.find((node) => node.id === org.id)
      expect(renamed?.name).toBe("丁单位（新）")

      // 基座账号全都挂着「基座单位」；把「基座单位」改名，账号必须跟着走。
      const base = yield* 建根("基座单位")
      expect((yield* post(ADMIN, renameUrl(base.id), { name: "基座单位（新）" })).status).toBe(204)
      expect(yield* Effect.promise(() => 账号org(ADMIN.id))).toBe("基座单位（新）")
      expect(yield* Effect.promise(() => 账号org(OFFICER.id))).toBe("基座单位（新）")
    }),
  )

  it.live("改名撞同级同名 ⇒ 409，账号一列没变", () =>
    Effect.gen(function* () {
      const left = yield* 建根("戊单位")
      const right = yield* 建根("己单位")

      const response = yield* post(ADMIN, renameUrl(right.id), { name: "戊单位" })
      expect(response.status).toBe(409)

      const tree = yield* json(TreeResponse, yield* get(ADMIN, TREE))
      expect(tree.nodes.find((node) => node.id === right.id)?.name).toBe("己单位")
      expect(tree.nodes.find((node) => node.id === left.id)?.name).toBe("戊单位")
    }),
  )

  it.live("改不存在的节点 ⇒ 404；空名 ⇒ 400（管理员）", () =>
    Effect.gen(function* () {
      expect((yield* post(ADMIN, renameUrl("nobody"), { name: "随便" })).status).toBe(404)

      const org = yield* 建根("庚单位")
      expect((yield* post(ADMIN, renameUrl(org.id), { name: "  " })).status).toBe(400)
    }),
  )
})

describe("T006 · 删除守卫", () => {
  it.live("有下级 ⇒ 409；存在关联账号 ⇒ 409；叶子且无账号 ⇒ 204", () =>
    Effect.gen(function* () {
      const org = yield* 建根("辛单位")
      const deptResponse = yield* post(ADMIN, NODES, { parentId: org.id, name: "治安支队" })
      const dept = yield* json(Node, deptResponse)

      const notEmpty = yield* del(ADMIN, nodeUrl(org.id))
      expect(notEmpty.status).toBe(409)
      expect((yield* json(ErrorResponse, notEmpty)).error).toContain("下级")

      // 挂一个账号到「辛单位 / 治安支队 / 已挂科室」这条路径上——账号走裸 SQL，节点走公开出口。
      const sectionResponse = yield* post(ADMIN, NODES, { parentId: dept.id, name: "已挂科室" })
      expect(sectionResponse.status).toBe(201)
      if (!pg) throw new Error("真库没起来")
      const db = pg.db
      yield* Effect.promise(() =>
        db.execute(sql`
          insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
          values ('99999999-9999-4999-8999-999999999999', '910099', '临时警员', 'x', 'x', '辛单位', '治安支队', '已挂科室', 0, 0, 'h', 0)
        `),
      )

      // 账号挂在**科室**上：科室没有下级，删除时才会走到「有关联账号」那道门
      // （挂在部门上会先撞「还有下级」，两道门就混成一条判据了）。
      const section = (yield* json(TreeResponse, yield* get(ADMIN, TREE))).nodes.find(
        (node) => node.name === "已挂科室",
      )
      if (!section) throw new Error("找不到科室节点")
      const hasAccounts = yield* del(ADMIN, nodeUrl(section.id))
      expect(hasAccounts.status).toBe(409)
      expect((yield* json(ErrorResponse, hasAccounts)).error).toContain("账号")

      expect((yield* del(ADMIN, nodeUrl("nobody"))).status).toBe(404)

      yield* Effect.promise(() =>
        db.execute(sql`delete from auth.user where id = '99999999-9999-4999-8999-999999999999'`),
      )

      expect((yield* del(ADMIN, nodeUrl(section.id))).status).toBe(204)
      expect((yield* del(ADMIN, nodeUrl(dept.id))).status).toBe(204)
      expect((yield* del(ADMIN, nodeUrl(org.id))).status).toBe(204)
    }),
  )

  it.live("民警删除 ⇒ 403，且节点还在", () =>
    Effect.gen(function* () {
      const org = yield* 建根("壬单位")

      expect((yield* del(OFFICER, nodeUrl(org.id))).status).toBe(403)

      const tree = yield* json(TreeResponse, yield* get(ADMIN, TREE))
      expect(tree.nodes.some((node) => node.id === org.id)).toBe(true)
    }),
  )
})

describe("T006 · 从现有账号导入", () => {
  it.live("管理员导入 ⇒ 200，再导一次 created = 0（幂等）", () =>
    Effect.gen(function* () {
      const first = yield* post(ADMIN, IMPORT)
      expect(first.status).toBe(200)
      const body = yield* json(ImportResponse, first)

      // 改名用例已经把「基座单位」改成「基座单位（新）」；导入只缺部门与科室两级。
      const tree = yield* json(TreeResponse, yield* get(ADMIN, TREE))
      const base = tree.nodes.find((node) => node.path.join("/") === "基座单位（新）/基座部门/基座科室")
      expect(base?.level).toBe(3)
      expect(body.created).toBe(2)

      const second = yield* post(ADMIN, IMPORT)
      expect((yield* json(ImportResponse, second)).created).toBe(0)
    }),
  )

  it.live("只读角色不能导入（write）", () =>
    Effect.gen(function* () {
      expect((yield* post(READER, IMPORT)).status).toBe(403)
    }),
  )
})
