import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { rowsOf, migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 批次 3 · Task 5（2026-11-02）· **按人授权**（`userIds`）与**选人搜索**。
 *
 * 业务背景：MCP 直连取数据，授权必须能精确到人——「指定人员」这一档此前只能选授权组
 * （批 1 的 `setAssetReadGroups`），组是共享容器，给一个人建组既重又容易误伤。
 * 本文件的判据分两层：
 *
 * 1. **发布**：`POST /openhive/governance/assets/:id/transition` 的 `userIds` 与 `groupIds`
 *    同规则；落库是私有角色 `personal:<userId>` 上的一条 `read`（spec §3.2.3）。
 * 2. **搜索**：`GET /openhive/governance/asset-readers` 只给治理管理员，只回 `id/name/dept`
 *    （不借账号板块的 PII）。
 *
 * ⚠️ 授权先于副作用（`#004-09`）：被选的人不存在时状态与授权行都不能动。
 * ⚠️ `auth.user.status` 的语义以 `login.ts` / `register.ts` 为准：**1 启用 / 0 停用**
 * （不是 brief 示意 SQL 里的 `status = 0`）。
 */

const it = testEffect(Layer.empty)

const SECRET = "r1s2t3u4v5w6x7y8z9a0b1c2d3e4f5g6"

const ADMIN: TokenSubject = {
  id: "11111111-1111-4111-8111-111111111111",
  policeNo: "960001",
  name: "系统管理员甲",
  isAdmin: true,
}
/** 只有 `asset-governance` 的 `read` + `review`：能进治理台，但选人搜索是 admin 动作。 */
const EXPERT: TokenSubject = {
  id: "22222222-2222-4222-8222-222222222222",
  policeNo: "960002",
  name: "业务专家乙",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "33333333-3333-4333-8333-333333333333",
  policeNo: "960003",
  name: "普通民警丙",
  isAdmin: false,
}
/** 被授权的个人之一。部门带前导空格：`register.ts` 刻意不 trim，返回时也不许改写。 */
const U2: TokenSubject = {
  id: "44444444-4444-4444-8444-444444444444",
  policeNo: "960101",
  name: "李四",
  isAdmin: false,
}
const U3: TokenSubject = {
  id: "55555555-5555-4555-8555-555555555555",
  policeNo: "960102",
  name: "王五",
  isAdmin: false,
}
const DISABLED: TokenSubject = {
  id: "66666666-6666-4666-8666-666666666666",
  policeNo: "960103",
  name: "停用赵六",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const GOV = "/openhive/governance/assets"
const READERS = "/openhive/governance/asset-readers"
const LIST = "/openhive/assets"
const transitionUrl = (id: string) => `${GOV}/${id}/transition`

const ASSETS_ROOT = mkdtempSync(join(tmpdir(), "openhive-gov-readers-"))
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
  summary: "",
  precautions: "",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: ADMIN.id,
  ownerName: ADMIN.name,
  department: "基座部门",
  visibility: "personal",
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
  iterationNote: "",
  iterationWorkspace: null,
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

  for (const subject of [ADMIN, EXPERT, OFFICER, U2, U3, DISABLED]) {
    const dept = subject.id === U2.id ? " 经侦支队" : "基座部门"
    const status = subject.id === DISABLED.id ? 0 : 1
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', ${dept}, '基座科室',
              ${status}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
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

const Asset = Schema.Struct({ id: Schema.String, visibility: Schema.String, status: Schema.String })
const ListResponse = Schema.Struct({ assets: Schema.Array(Asset), total: Schema.Number })
const TransitionResponse = Schema.Struct({ asset: Asset })
const Reader = Schema.Struct({ id: Schema.String, name: Schema.String, dept: Schema.String })
/** 审计 `detail`（text 列存 JSON）：只解本用例关心的键。 */
const 审计详情 = Schema.Struct({
  transition: Schema.String,
  visibility: Schema.optional(Schema.String),
  userIds: Schema.optional(Schema.Array(Schema.String)),
  groupIds: Schema.optional(Schema.Unknown),
})
const ReadersResponse = Schema.Struct({ users: Schema.Array(Reader) })
const ErrorResponse = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

const 列出的id = (body: { readonly assets: readonly { readonly id: string }[] }) => body.assets.map((a) => a.id)
const 有文件 = (path: string) => existsSync(path)

/** 某个人在某份资产上的授权行（读**库**，不信回包）。 */
async function 某人的读权(userId: string, assetId: string) {
  if (!pg) throw new Error("真库没起来")
  return (await grantsFor(pg.db, userId)).filter(
    (grant) => grant.resourceType === "skill" && grant.resourceId === assetId && grant.perm === "read",
  )
}

async function 授权行(assetId: string) {
  if (!pg) throw new Error("真库没起来")
  return rowsOf(
    await pg.db.execute(
      sql`select role_id, perm from auth.role_resource where resource_type = 'skill' and resource_id = ${assetId}`,
    ),
  )
}

describe("Task 5 · 治理发布接受 userIds（按人授权）", () => {
  it.live("targeted 只选人 ⇒ 200：被选的人有 read 且看得见，未选的人看不见（trim / 去重）", () =>
    Effect.gen(function* () {
      const id = "asset-readers-user-0001"
      const db = pg!.db
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id, name: "只发给李四的话术", status: "pending_tech" })),
      )
      造目录(join(ASSETS_ROOT, "pending", id))

      // 带空格、带重复：出口与 groupIds 同规则（trim + 去重）。
      const 发布 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        userIds: [` ${U2.id} `, U2.id],
      })

      expect(发布.status).toBe(200)
      expect((yield* json(TransitionResponse, 发布)).asset.visibility).toBe("targeted")
      expect(有文件(join(ASSETS_ROOT, "targeted", "skills", id, "SKILL.md"))).toBe(true)
      expect(有文件(join(ASSETS_ROOT, "pending", id))).toBe(false)

      // 授权行落在私有角色 `personal:<userId>` 上，恰好一行（重复项没有写出第二行）。
      const 行 = yield* Effect.promise(() => 授权行(id))
      expect(行).toHaveLength(1)
      expect(String(行[0]?.["role_id"])).toBe(`personal:${U2.id}`)
      expect(String(行[0]?.["perm"])).toBe("read")

      // 判据只有一份：同一个 `grantsFor()`（内存判定与 SQL 投影共同的上游）。
      expect(yield* Effect.promise(() => 某人的读权(U2.id, id))).toHaveLength(1)
      expect(yield* Effect.promise(() => 某人的读权(U3.id, id))).toHaveLength(0)

      // 读面：被选的人列出这条，组外的人没有。
      expect(列出的id(yield* json(ListResponse, yield* get(U2, LIST)))).toContain(id)
      expect(列出的id(yield* json(ListResponse, yield* get(U3, LIST)))).not.toContain(id)

      // 审计只放 id，不放姓名 / 部门（PII）。
      const [审计] = rowsOf(
        yield* Effect.promise(() =>
          db.execute(
            sql`select detail::text as detail from auth.audit_event where target_id = ${id} order by id desc limit 1`,
          ),
        ),
      )
      const 原始 = 审计?.["detail"]
      const detail = Schema.decodeUnknownSync(审计详情)(JSON.parse(typeof 原始 === "string" ? 原始 : "{}"))
      expect(detail.userIds).toEqual([U2.id])
      expect(detail.groupIds).toBeUndefined()
      expect(JSON.stringify(detail)).not.toContain(U2.name)
      expect(JSON.stringify(detail)).not.toContain("经侦支队")
    }),
  )

  it.live("targeted 既无组也无人 ⇒ 400（空数组同样），状态 / 目录 / 授权行零副作用", () =>
    Effect.gen(function* () {
      const id = "asset-readers-empty-0002"
      const db = pg!.db
      yield* Effect.promise(() => insertAsset(db, 资产({ id, name: "空指定人员", status: "pending_tech" })))
      造目录(join(ASSETS_ROOT, "pending", id))

      const 无参 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech", visibility: "targeted" })
      expect(无参.status).toBe(400)
      const 体 = yield* json(ErrorResponse, 无参)
      expect(体.error).toContain("授权组")
      expect(体.field).toBe("groupIds")

      const 空人 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        userIds: [],
      })
      expect(空人.status).toBe(400)

      const 两组皆空 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        groupIds: [],
        userIds: [],
      })
      expect(两组皆空.status).toBe(400)

      const [行] = rowsOf(
        yield* Effect.promise(() => db.execute(sql`select status, visibility from auth.asset where id = ${id}`)),
      )
      expect(String(行?.["status"])).toBe("pending_tech")
      expect(String(行?.["visibility"])).toBe("personal")
      expect(有文件(join(ASSETS_ROOT, "pending", id, "SKILL.md"))).toBe(true)
      expect(yield* Effect.promise(() => 授权行(id))).toHaveLength(0)
    }),
  )

  it.live("userIds 只能配合 targeted；项非法 ⇒ 400（与 groupIds 同规则）", () =>
    Effect.gen(function* () {
      const id = "asset-readers-shape-0003"
      const db = pg!.db
      yield* Effect.promise(() => insertAsset(db, 资产({ id, name: "非法载荷", status: "pending_tech" })))
      造目录(join(ASSETS_ROOT, "pending", id))

      const 范围越界 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "department",
        userIds: [U2.id],
      })
      expect(范围越界.status).toBe(400)
      expect((yield* json(ErrorResponse, 范围越界)).field).toBe("userIds")

      const 非数组 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        userIds: U2.id,
      })
      expect(非数组.status).toBe(400)

      const 空白项 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        userIds: ["  "],
      })
      expect(空白项.status).toBe(400)
      expect((yield* json(ErrorResponse, 空白项)).field).toBe("userIds")

      expect(yield* Effect.promise(() => 授权行(id))).toHaveLength(0)
    }),
  )

  it.live("重设时取消勾选的人不残留：先 [u2,u3] 再 [u2] ⇒ u3 的 read 行消失", () =>
    Effect.gen(function* () {
      const id = "asset-readers-reset-0004"
      const db = pg!.db
      yield* Effect.promise(() => insertAsset(db, 资产({ id, name: "重设读者", status: "pending_tech" })))
      造目录(join(ASSETS_ROOT, "pending", id))

      const 首次 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        userIds: [U2.id, U3.id],
      })
      expect(首次.status).toBe(200)
      expect(yield* Effect.promise(() => 某人的读权(U2.id, id))).toHaveLength(1)
      expect(yield* Effect.promise(() => 某人的读权(U3.id, id))).toHaveLength(1)

      // 第二次重设只能走另一条发布类动作：`publish_tech` 从 published 出发不是合法源状态。
      // 这里把资产拨回 iterating 并补上 pending（真实流程里由作者 start_iteration + 提交产生）。
      yield* Effect.promise(() =>
        db.execute(sql`update auth.asset set status = 'iterating', version = 2 where id = ${id}`),
      )
      造目录(join(ASSETS_ROOT, "pending", id), "# 新版本\n")

      const 重设 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_iteration",
        visibility: "targeted",
        userIds: [U2.id],
      })
      expect(重设.status).toBe(200)

      expect(yield* Effect.promise(() => 某人的读权(U2.id, id))).toHaveLength(1)
      expect(yield* Effect.promise(() => 某人的读权(U3.id, id))).toHaveLength(0)
      const 行 = yield* Effect.promise(() => 授权行(id))
      expect(行.map((row) => String(row["role_id"]))).toEqual([`personal:${U2.id}`])
    }),
  )

  it.live("userIds 里有不存在的用户 ⇒ 409（不是 500），状态与授权行零副作用", () =>
    Effect.gen(function* () {
      const id = "asset-readers-ghost-0005"
      const db = pg!.db
      yield* Effect.promise(() => insertAsset(db, 资产({ id, name: "幽灵用户", status: "pending_tech" })))
      造目录(join(ASSETS_ROOT, "pending", id))

      const 发布 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        userIds: ["ghost-user-9999"],
      })

      expect(发布.status).toBe(409)
      expect((yield* json(ErrorResponse, 发布)).error).toContain("用户不存在")
      const [行] = rowsOf(
        yield* Effect.promise(() => db.execute(sql`select status from auth.asset where id = ${id}`)),
      )
      expect(String(行?.["status"])).toBe("pending_tech")
      expect(yield* Effect.promise(() => 授权行(id))).toHaveLength(0)
    }),
  )
})

describe("Task 5 · GET /asset-readers（选人搜索）", () => {
  it.live("无凭证 401；业务专家（review）与普通民警 403（选人是 admin 动作）", () =>
    Effect.gen(function* () {
      expect((yield* get(null, READERS)).status).toBe(401)
      // 业务专家能进治理台（read + review），但选人搜索是发布辅助 ⇒ admin。
      expect((yield* get(EXPERT, READERS)).status).toBe(403)
      expect((yield* get(OFFICER, READERS)).status).toBe(403)
    }),
  )

  it.live("管理员搜索：只回 id/name/dept；q 命中姓名与警号；停用账号不出现", () =>
    Effect.gen(function* () {
      const 按姓名 = yield* get(ADMIN, `${READERS}?q=${encodeURIComponent("李四")}&limit=5`)
      expect(按姓名.status).toBe(200)
      const 体 = yield* json(ReadersResponse, 按姓名)
      expect(体.users).toHaveLength(1)
      expect(Object.keys(体.users[0]).sort()).toEqual(["dept", "id", "name"])
      expect(体.users[0].id).toBe(U2.id)
      expect(体.users[0].name).toBe(U2.name)
      // `register.ts` 不 trim 部门：返回也不许擅自改写（前导空格原样）。
      expect(体.users[0].dept).toBe(" 经侦支队")

      const 按警号 = yield* json(ReadersResponse, yield* get(ADMIN, `${READERS}?q=960102`))
      expect(按警号.users.map((user) => user.id)).toEqual([U3.id])

      // 停用账号（status = 0）不出现：搜索是「给谁发」，发不出去的人不该被选中。
      const 停用 = yield* json(ReadersResponse, yield* get(ADMIN, `${READERS}?q=${encodeURIComponent("停用赵六")}`))
      expect(停用.users).toHaveLength(0)
    }),
  )

  it.live("管理员按部门搜索：q 命中部门子串，字段仍只有 id/name/dept，别的部门不混进来", () =>
    Effect.gen(function* () {
      // 弹窗文案与 `aria-label` 写的是「按姓名或部门搜索人员」（终审 I-1）：
      // U2 的部门是 " 经侦支队"（带前导空格），搜子串「经侦」应当命中。
      const 按部门 = yield* get(ADMIN, `${READERS}?q=${encodeURIComponent("经侦")}&limit=5`)
      expect(按部门.status).toBe(200)
      const 体 = yield* json(ReadersResponse, 按部门)
      expect(体.users).toHaveLength(1)
      expect(体.users[0].id).toBe(U2.id)
      // 只回这三个键：部门命中也不许把警号 / 状态借出来。
      expect(Object.keys(体.users[0]).sort()).toEqual(["dept", "id", "name"])
      // 前导空格原样返回（与按姓名那一段同一口径）。
      expect(体.users[0].dept).toBe(" 经侦支队")
    }),
  )

  it.live("limit 夹在 1..50；空 q 返回启用账号；% 按字面量处理", () =>
    Effect.gen(function* () {
      const db = pg!.db
      // 55 条共用前缀，专门量上限与默认值；用例结束自清（`#005-34`）。
      yield* Effect.promise(async () => {
        for (let i = 0; i < 55; i += 1) {
          const id = `reader-limit-${String(i).padStart(2, "0")}`
          await db.execute(sql`
            insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
            values (${id}, ${`970${String(i).padStart(3, "0")}`}, ${`选人夹具 ${String(i).padStart(2, "0")}`},
                    'x', 'x', '基座单位', '基座部门', '基座科室', 1, 0, 'h', 0)
          `)
        }
      })

      const 搜索 = `${READERS}?q=${encodeURIComponent("选人夹具")}`
      const 超大 = yield* json(ReadersResponse, yield* get(ADMIN, `${搜索}&limit=999`))
      expect(超大.users).toHaveLength(50)

      const 一条 = yield* json(ReadersResponse, yield* get(ADMIN, `${搜索}&limit=1`))
      expect(一条.users).toHaveLength(1)

      // 非法 limit 回退还回落到默认 20。
      const 默认 = yield* json(ReadersResponse, yield* get(ADMIN, `${搜索}&limit=abc`))
      expect(默认.users).toHaveLength(20)

      // 出口约定 `limit` 只接受整数（先 `Math.trunc` 再夹 1..50）。
      // 注意：本驱动（drizzle + Bun.SQL）会隐式取整，所以这条只钉**出口契约**
      // （200 + 截断后的行数），不能证明 `Math.trunc` 本身；换原生驱动才可观察
      // （评审 F1 已据实记录「500 在本机生产连接路径未复现」）。
      const 小数 = yield* get(ADMIN, `${搜索}&limit=2.5`)
      expect(小数.status).toBe(200)
      expect((yield* json(ReadersResponse, 小数)).users).toHaveLength(2)

      // 空 q：返回全部**启用**账号（停用那条不在），且被 limit 截断。
      const 全部 = yield* json(ReadersResponse, yield* get(ADMIN, `${READERS}?limit=50`))
      expect(全部.users.some((user) => user.id === DISABLED.id)).toBe(false)
      expect(全部.users.some((user) => user.id === ADMIN.id)).toBe(true)

      // `%` 是通配符还是字面量：转义后没有人的姓名 / 警号含它 ⇒ 空。
      const 通配 = yield* json(ReadersResponse, yield* get(ADMIN, `${READERS}?q=%25`))
      expect(通配.users).toHaveLength(0)
    }).pipe(
      Effect.ensuring(Effect.promise(() => pg!.db.execute(sql`delete from auth.user where id like 'reader-limit-%'`))),
    ),
  )
})
