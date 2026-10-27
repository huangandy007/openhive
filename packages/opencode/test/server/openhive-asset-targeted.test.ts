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
 * 需求 3b（2026-10-27）· 可见范围第四档「指定人员」（`targeted`）。
 *
 * ## 这一档是什么
 *
 * 发布人挑几个授权组：读**只**来自作者身份与 `auth.role_resource` 的授权行，**不给任何
 * 空间读权**——组外的同部门同事一样看不见。所以它不能做成「部门档 + 附加授权」（那样
 * 同部门全可见），必须是自己一档。
 *
 * ## 判据落在可观测处
 *
 * - 库：`auth.asset.visibility = 'targeted'` ＋ 一条 `role_resource(group, skill, id, read)`；
 * - 文件：`/assets/targeted/skills/<id>/SKILL.md` 在、`pending/` 不在；
 * - 读面：**同一部门**的组员在 `GET /openhive/assets` 里看得见、非组员看不见。后者是
 *   SQL 下推（`readableAssetCondition`）与判据（`canReadAsset`）同源的出口级证据。
 *
 * ## 客户端契约写字面量
 *
 * 路由与载荷字段在测试里逐字写（`#003-05`），不 import 生产常量——常量改了而契约没改，
 * 正是要红的时刻。
 */

const it = testEffect(Layer.empty)

const SECRET = "b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6"

const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "950001",
  name: "系统管理员甲",
  isAdmin: true,
}
/** 资产作者；也是本次发布的被发布对象所在的部门。 */
const OWNER: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "950002",
  name: "作者乙",
  isAdmin: false,
}
/** 授权组成员——与作者**同部门**：这一档的要点正是「同部门不等于可见」。 */
const MEMBER: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "950003",
  name: "组员丙",
  isAdmin: false,
}
/** 与作者同部门、但不在组里：必须看不见。 */
const OUTSIDER: TokenSubject = {
  id: "dddddddd-4444-4444-8444-444444444444",
  policeNo: "950004",
  name: "同部门丁",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const GOV = "/openhive/governance/assets"
const GROUPS = "/openhive/governance/asset-groups"
const LIST = "/openhive/assets"
const transitionUrl = (id: string) => `${GOV}/${id}/transition`

const ASSETS_ROOT = mkdtempSync(join(tmpdir(), "openhive-targeted-"))
const restoreAssetsRoot = restorePoint({ OPENHIVE_ASSETS_ROOT: ASSETS_ROOT })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
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
  ownerId: OWNER.id,
  ownerName: OWNER.name,
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

function 造目录(directory: string, content = "# 成果\n") {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "SKILL.md"), content, "utf8")
}

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, OWNER, MEMBER, OUTSIDER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
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

const Asset = Schema.Struct({ id: Schema.String, visibility: Schema.String })
const ListResponse = Schema.Struct({ assets: Schema.Array(Asset), total: Schema.Number })
const TransitionResponse = Schema.Struct({ asset: Asset })
const Group = Schema.Struct({ id: Schema.String, name: Schema.String, memberCount: Schema.Number })
const GroupListResponse = Schema.Struct({ groups: Schema.Array(Group) })
const ErrorResponse = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

const 列出的id = (body: { readonly assets: readonly { readonly id: string }[] }) => body.assets.map((a) => a.id)
const 有文件 = (path: string) => existsSync(path)

describe("需求 3b · 授权组出口", () => {
  it.live("管理员建组（带成员）⇒ 200；列表回组与成员数；普通民警 403", () =>
    Effect.gen(function* () {
      const 建 = yield* post(ADMIN, GROUPS, {
        id: "g_targeted_e2e",
        name: "电诈专案组",
        memberIds: [MEMBER.id],
      })
      // 与其它治理出口的「新建」同码（`category.create` / `org.create` 都是 201）。
      expect(建.status).toBe(201)

      const 列表 = yield* get(ADMIN, GROUPS)
      expect(列表.status).toBe(200)
      const 组 = (yield* json(GroupListResponse, 列表)).groups.find((g) => g.id === "g_targeted_e2e")
      expect(组?.name).toBe("电诈专案组")
      expect(组?.memberCount).toBe(1)

      // 组员是 `user_role` 的一行（判定只看这两张表）。
      const [成员行] = rowsOf(
        yield* Effect.promise(() =>
          pg!.db.execute(
            sql`select role_id from auth.user_role where user_id = ${MEMBER.id} and role_id = 'g_targeted_e2e'`,
          ),
        ),
      )
      expect(成员行).toBeDefined()
      // 建出来的角色必须是 `role_type = 'group'`：普通角色写授权行库照收，但永远不参与组判定。
      const [角色] = rowsOf(
        yield* Effect.promise(() => pg!.db.execute(sql`select role_type from auth.role where id = 'g_targeted_e2e'`)),
      )
      expect(String(角色?.role_type)).toBe("group")

      // 普通民警既不能看组名单也不能建组（不是 404：路由在，拒绝是 403）。
      expect((yield* get(OUTSIDER, GROUPS)).status).toBe(403)
      expect((yield* post(OUTSIDER, GROUPS, { id: "g_nope", name: "偷偷建组" })).status).toBe(403)
    }),
  )

  it.live("给已有组加成员 ⇒ 200 且成员数 +1", () =>
    Effect.gen(function* () {
      yield* post(ADMIN, GROUPS, { id: "g_targeted_member", name: "补员组", memberIds: [MEMBER.id] })

      const 加 = yield* post(ADMIN, `${GROUPS}/g_targeted_member/members`, { userId: OUTSIDER.id })
      expect(加.status).toBe(200)

      const 列表 = yield* get(ADMIN, GROUPS)
      const 组 = (yield* json(GroupListResponse, 列表)).groups.find((g) => g.id === "g_targeted_member")
      expect(组?.memberCount).toBe(2)
    }),
  )
})

describe("需求 3b · 发布为「指定人员」", () => {
  it.live("组员（同部门）看得见；同部门非组员看不见；库、文件、授权行一起落地", () =>
    Effect.gen(function* () {
      const id = "asset-targeted-0001"
      const db = pg!.db
      // 自建自己的组：不借用前一个 describe 的夹具（用例之间不靠执行顺序）。
      yield* post(ADMIN, GROUPS, { id: "g_targeted_publish", name: "发布用专案组", memberIds: [MEMBER.id] })
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id, name: "专案组话术", status: "pending_tech", visibility: "personal" })),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      const 发布 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        groupIds: ["g_targeted_publish"],
      })
      expect(发布.status).toBe(200)
      expect((yield* json(TransitionResponse, 发布)).asset.visibility).toBe("targeted")

      // 落盘：`/targeted/`（**不在**部门目录下），pending 搬走。
      expect(有文件(join(ASSETS_ROOT, "targeted", "skills", id, "SKILL.md"))).toBe(true)
      expect(有文件(join(ASSETS_ROOT, "pending", id))).toBe(false)

      // 授权行：（组, 资产类型, 资产 id, read）。
      const 授权行 = rowsOf(
        yield* Effect.promise(() =>
          db.execute(
            sql`select role_id, perm from auth.role_resource where resource_type = 'skill' and resource_id = ${id}`,
          ),
        ),
      )
      expect(授权行).toHaveLength(1)
      expect(String(授权行[0]?.["role_id"])).toBe("g_targeted_publish")
      expect(String(授权行[0]?.["perm"])).toBe("read")

      // 读面：同一份资产，三种身份三种结局。
      const 组员看 = yield* json(ListResponse, yield* get(MEMBER, LIST))
      expect(列出的id(组员看)).toContain(id)

      const 组外看 = yield* json(ListResponse, yield* get(OUTSIDER, LIST))
      expect(列出的id(组外看)).not.toContain(id)

      // 作者本人照旧看得见（作者身份那一支）。
      const 作者看 = yield* json(ListResponse, yield* get(OWNER, LIST))
      expect(列出的id(作者看)).toContain(id)
    }),
  )

  it.live("指定人员缺组 / 非指定人员带组 ⇒ 400；状态与目录零副作用", () =>
    Effect.gen(function* () {
      const id = "asset-targeted-0002"
      const db = pg!.db
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id, name: "缺组话术", status: "pending_tech", visibility: "personal" })),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      const 缺组 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech", visibility: "targeted" })
      expect(缺组.status).toBe(400)
      const 缺组体 = yield* json(ErrorResponse, 缺组)
      expect(缺组体.error).toContain("授权组")
      expect(缺组体.field).toBe("groupIds")

      const 空组 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        groupIds: [],
      })
      expect(空组.status).toBe(400)

      const 越界组 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "department",
        groupIds: ["g_targeted_e2e"],
      })
      expect(越界组.status).toBe(400)

      // 全都没动：状态、目录、授权行。
      const [行] = rowsOf(
        yield* Effect.promise(() => db.execute(sql`select status, visibility from auth.asset where id = ${id}`)),
      )
      expect(String(行?.["status"])).toBe("pending_tech")
      expect(String(行?.["visibility"])).toBe("personal")
      expect(有文件(join(ASSETS_ROOT, "pending", id, "SKILL.md"))).toBe(true)
      expect(有文件(join(ASSETS_ROOT, "targeted", "skills", id))).toBe(false)
      const 授权行 = rowsOf(
        yield* Effect.promise(() => db.execute(sql`select 1 from auth.role_resource where resource_id = ${id}`)),
      )
      expect(授权行).toHaveLength(0)
    }),
  )

  it.live("组不存在 ⇒ 409 且没有写进任何授权行（失败不留半截）", () =>
    Effect.gen(function* () {
      const id = "asset-targeted-0003"
      const db = pg!.db
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id, name: "幽灵组话术", status: "pending_tech", visibility: "personal" })),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      const 发布 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        groupIds: ["g_ghost"],
      })

      // 组在**流转之前**验：不存在的组是发布前提不成立，状态与目录一点都不能动。
      expect(发布.status).toBe(409)
      expect((yield* json(ErrorResponse, 发布)).error).toContain("授权组")
      const [行] = rowsOf(
        yield* Effect.promise(() => db.execute(sql`select status, visibility from auth.asset where id = ${id}`)),
      )
      expect(String(行?.["status"])).toBe("pending_tech")
      expect(String(行?.["visibility"])).toBe("personal")
      expect(有文件(join(ASSETS_ROOT, "pending", id, "SKILL.md"))).toBe(true)
      const 授权行 = rowsOf(
        yield* Effect.promise(() => db.execute(sql`select 1 from auth.role_resource where resource_id = ${id}`)),
      )
      expect(授权行).toHaveLength(0)
    }),
  )
})
