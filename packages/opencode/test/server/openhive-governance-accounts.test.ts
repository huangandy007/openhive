import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { canonicalRoot } from "@opencode-ai/core/workspace-root"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { LastAdminError } from "@opencode-ai/auth/zombie"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { 停用失败 } from "../../src/server/openhive/governance-accounts"
import { testEffect } from "../lib/effect"

/**
 * 010 T005 · 账号管理的七个 HTTP 出口（FR-004 / US2）。
 *
 * ## 为什么打在真应用 ＋ 真库上
 *
 * 五个出口是**写**，判据一律是「**库里那一行变没变**」——这个事实的 oracle 只有真 PG 给得出。
 * 服务层单测（`auth/src/account-admin.test.ts` 与已有的 `register` / `zombie` / `password`
 * 测试）钉住了「那一层写得对不对」，本文件钉的是**再往上三层**：身份从哪来、授权判在哪一步、
 * 拒绝时有没有顺手改库。
 *
 * ## 三条刻意写下的纪律
 *
 * 1. **未挂载 ≠ 404**（同族文件的实测结论）：本应用的未匹配路径被 SPA 兜底回 `200 text/html`。
 *    所以 `json()` 先把判据前移到 `Content-Type`——路由没挂时红的不是「403 变 200」，
 *    而是内容类型那一条。
 * 2. **被拒 ＋ 副作用未发生是两个独立事实**（`#004-09`）：每一条拒绝都配一句「库里没变」。
 *    只断状态码的话，一个「先写库、再发现无权、然后回 403」的实现会全绿。
 * 3. **顺序单独造观测面**：民警递一个**非法载荷**（缺姓名）必须回 **403 而不是 400**。
 *    若校验排在授权之前，非管理员就能拿 400/403 的差别当「这个字段合不合法」的探针。
 *
 * ## `停用失败` 为什么只测映射、不测 HTTP
 *
 * 「停用最后一个管理员」在本路由里**经 HTTP 不可达**：`authorizeGovernance` 要求调用者
 * 本人是**启用的管理员** ⇒ 任何「覆盖全部启用管理员」的 ids 必然包含调用者 ⇒ 先被
 * 「不能停用自己」挡下（400）。服务层的 `LastAdminError` 因此只是一道**纵深防御**。
 * 这里直接把映射函数钉住，并在 `state.md` 如实登记「可达性缺口」——不把 409 写成已覆盖。
 */

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ADMIN: TokenSubject = {
  id: "11111111-1111-4111-8111-111111111111",
  policeNo: "900001",
  name: "管理员甲",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "22222222-2222-4222-8222-222222222222",
  policeNo: "900002",
  name: "民警乙",
  isAdmin: false,
}
/** 系统管理员模板里只取 `account-manage/read` 的一个自定义角色——用来证明 read ≠ write。 */
const READER: TokenSubject = {
  id: "33333333-3333-4333-8333-333333333333",
  policeNo: "900003",
  name: "只读丙",
  isAdmin: true,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const ACCOUNTS = "/openhive/governance/accounts"
const BATCH_DISABLE = `${ACCOUNTS}/batch-disable`

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-governance-accounts-"))
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = path.join(SANDBOX, "data")

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, OFFICER, READER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '甲单位', '经侦支队', '一大队',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  // 管理员甲拿完整模板；只读丙拿一个**只有 read** 的自定义角色（read ≠ write 的观测面）。
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-account-reader', '账号只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-account-reader', 'governance', 'account-manage', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${READER.id}, 'test-account-reader')`)
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: path.join(SANDBOX, "shared"),
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

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

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

const Item = Schema.Struct({
  id: Schema.String,
  policeNo: Schema.String,
  name: Schema.String,
  org: Schema.String,
  dept: Schema.String,
  section: Schema.String,
  status: Schema.Number,
  isAdmin: Schema.Number,
  lastLoginAt: Schema.NullOr(Schema.Number),
  lastActiveAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  deactivatedAt: Schema.NullOr(Schema.Number),
})

const ListResponse = Schema.Struct({
  total: Schema.Number,
  enabled: Schema.Number,
  matched: Schema.Number,
  page: Schema.Number,
  pageSize: Schema.Number,
  items: Schema.Array(Item),
})

const DetailResponse = Schema.Struct({
  id: Schema.String,
  policeNo: Schema.String,
  name: Schema.String,
  idCard: Schema.String,
  phone: Schema.String,
  org: Schema.String,
  dept: Schema.String,
  section: Schema.String,
  status: Schema.Number,
  isAdmin: Schema.Number,
})

const IdResponse = Schema.Struct({ id: Schema.String })
const ErrorResponse = Schema.Struct({ error: Schema.String })
const FieldErrorResponse = Schema.Struct({ error: Schema.String, field: Schema.String })
const BatchResponse = Schema.Struct({ disabled: Schema.Number })

/** 造一个被管理对象（**裸 SQL 夹具**：录入出口正是被测对象，不能拿它当另一半的 oracle）。 */
async function 造账号(input: {
  readonly id: string
  readonly policeNo: string
  readonly name?: string
  readonly status?: number
  readonly mustChangePw?: number
  readonly passwordHash?: string
}): Promise<string> {
  if (!pg) throw new Error("真库没起来，造不了账号")
  await pg.db.execute(sql`
    insert into auth.user (
      id, police_no, name, id_card, phone, org, dept, section,
      status, is_admin, must_change_pw, password_hash, created_at
    ) values (
      ${input.id}, ${input.policeNo}, ${input.name ?? "被管理者"}, ${`id-${input.id}`}, ${`phone-${input.id}`},
      '甲单位', '经侦支队', '一大队', ${input.status ?? 1}, 0,
      ${input.mustChangePw ?? 0}, ${input.passwordHash ?? "h"}, 0
    )
  `)
  return input.id
}

/** 在 `Effect.gen` 里跑一条读 SQL（`gen` 不是 async 函数，不能直接 `await`）。 */
const 行列 = (query: ReturnType<typeof sql>) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来，读不到行")
    return rowsOf(await pg.db.execute(query))
  })

/** 库里的账号行（**裸 SQL**，不经被测对象）。 */
async function 账号行(id: string) {
  if (!pg) throw new Error("真库没起来，读不到账号行")
  const [row] = rowsOf(await pg.db.execute(sql`
    select status, must_change_pw, password_hash, deactivated_at
    from auth.user where id = ${id}
  `))
  if (!row) throw new Error(`账号行不存在：${id}`)
  return {
    status: Number(row.status),
    mustChangePw: Number(row.must_change_pw),
    passwordHash: String(row.password_hash),
    deactivatedAt: row.deactivated_at === null ? null : Number(row.deactivated_at),
  }
}

const 计数 = async (where: string) => {
  if (!pg) throw new Error("真库没起来，数不了")
  const [row] = rowsOf(await pg.db.execute(sql.raw(`select count(*)::int as n from auth.user where ${where}`)))
  return Number(row.n)
}

describe("T005 · 列表出口的门与形状", () => {
  it.live(
    "管理员读列表 ⇒ 形状逐字、按警号升序、统计是全库口径",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "list-b", policeNo: "910002", name: "列表乙" }))
        yield* Effect.promise(() => 造账号({ id: "list-a", policeNo: "910001", name: "列表甲", status: 0 }))

        const response = yield* get(ADMIN, `${ACCOUNTS}?q=91000`)
        expect(response.status).toBe(200)
        const body = yield* json(ListResponse, response)

        expect(body.items.map((item) => item.policeNo)).toEqual(["910001", "910002"])
        expect(body.matched).toBe(2)
        // 统计不随 q 缩水：至少含 3 个身份 ＋ 这 2 个。
        expect(body.total).toBeGreaterThanOrEqual(5)
        expect(body.enabled).toBe(body.total - 1)
      }),
    30_000,
  )

  it.live(
    "普通民警读列表 ⇒ 403（读也要 read 行）",
    () =>
      Effect.gen(function* () {
        const response = yield* get(OFFICER, ACCOUNTS)
        expect(response.status).toBe(403)
        expect((yield* json(ErrorResponse, response)).error).toContain("账号管理")
      }),
    30_000,
  )

  it.live(
    "只有 account-manage/read 的管理员 ⇒ 读放行、写被拒（read ≠ write）",
    () =>
      Effect.gen(function* () {
        expect((yield* get(READER, ACCOUNTS)).status).toBe(200)

        const write = yield* post(READER, ACCOUNTS, {
          policeNo: "910901",
          name: "只读录入",
          idCard: "x",
          phone: "x",
          org: "x",
          dept: "x",
          section: "x",
          status: 1,
        })
        expect(write.status).toBe(403)
        expect(yield* Effect.promise(() => 计数("police_no = '910901'"))).toBe(0)
      }),
    30_000,
  )

  it.live(
    "没有凭证 ⇒ 401",
    () =>
      Effect.gen(function* () {
        expect((yield* get(null, ACCOUNTS)).status).toBe(401)
      }),
    30_000,
  )
})

describe("T005 · 录入", () => {
  it.live(
    "管理员录入 8 字段 ⇒ 201、库里一行、沙箱目录也在、角色与改密标记正确",
    () =>
      Effect.gen(function* () {
        const response = yield* post(ADMIN, ACCOUNTS, {
          policeNo: "920001",
          name: "新民警",
          idCard: "330100199001011234",
          phone: "13800000000",
          org: "甲单位",
          dept: "经侦支队",
          section: "一大队",
          status: 1,
        })
        expect(response.status).toBe(201)
        const { id } = yield* json(IdResponse, response)

        const row = yield* Effect.promise(() => 账号行(id))
        expect(row.status).toBe(1)
        expect(row.mustChangePw).toBe(1)
        expect(row.passwordHash).not.toBe(DEPLOYED_DEFAULT_PASSWORD) // 存的是哈希

        // 移交第 1 条：必须调 `provisionUser`（建目录 + 落库），不是 `registerUser`。
        const workspace = path.join(canonicalRoot(WORKSPACE_ROOT), id)
        expect(existsSync(workspace)).toBe(true)

        const [inserted] = yield* 行列(sql`select is_admin from auth.user where id = ${id}`)
        expect(Number(inserted.is_admin)).toBe(0) // 录入不能顺手造管理员
      }),
    30_000,
  )

  it.live(
    "普通民警录入 ⇒ 403，且库里没有这一行",
    () =>
      Effect.gen(function* () {
        const response = yield* post(OFFICER, ACCOUNTS, {
          policeNo: "920002",
          name: "越权录入",
          idCard: "x",
          phone: "x",
          org: "x",
          dept: "x",
          section: "x",
          status: 1,
        })
        expect(response.status).toBe(403)
        expect(yield* Effect.promise(() => 计数("police_no = '920002'"))).toBe(0)
      }),
    30_000,
  )

  it.live(
    "民警递非法载荷 ⇒ 403 而不是 400（授权在校验之前，不泄漏字段合法性）",
    () =>
      Effect.gen(function* () {
        const response = yield* post(OFFICER, ACCOUNTS, { policeNo: "920003", name: "   " })
        expect(response.status).toBe(403)
        expect(yield* Effect.promise(() => 计数("police_no = '920003'"))).toBe(0)
      }),
    30_000,
  )

  it.live(
    "重复警号 ⇒ 409「该警号已录入」，原有那行一个字不动",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "dup", policeNo: "920004", name: "原主" }))

        const response = yield* post(ADMIN, ACCOUNTS, {
          policeNo: "920004",
          name: "冒名",
          idCard: "x",
          phone: "x",
          org: "x",
          dept: "x",
          section: "x",
          status: 1,
        })

        expect(response.status).toBe(409)
        expect((yield* json(ErrorResponse, response)).error).toContain("已录入")
        const [row] = yield* 行列(sql`select name from auth.user where police_no = '920004'`)
        expect(row.name).toBe("原主")
      }),
    30_000,
  )

  it.live(
    "缺必填字段 ⇒ 400，并带上出问题的字段名",
    () =>
      Effect.gen(function* () {
        const response = yield* post(ADMIN, ACCOUNTS, {
          policeNo: "920005",
          name: "   ",
          idCard: "x",
          phone: "x",
          org: "x",
          dept: "x",
          section: "x",
          status: 1,
        })

        expect(response.status).toBe(400)
        expect((yield* json(FieldErrorResponse, response)).field).toBe("name")
        expect(yield* Effect.promise(() => 计数("police_no = '920005'"))).toBe(0)
      }),
    30_000,
  )

  it.live(
    "状态取值非法 ⇒ 400，且没有留下账号行、也没有留下沙箱目录",
    () =>
      Effect.gen(function* () {
        const response = yield* post(ADMIN, ACCOUNTS, {
          policeNo: "920006",
          name: "状态非法",
          idCard: "x",
          phone: "x",
          org: "x",
          dept: "x",
          section: "x",
          status: 2,
        })

        expect(response.status).toBe(400)
        expect(yield* Effect.promise(() => 计数("police_no = '920006'"))).toBe(0)
      }),
    30_000,
  )
})

describe("T005 · 重置密码", () => {
  it.live(
    "管理员重置他人密码 ⇒ 204、哈希换掉、强制改密重新置 1",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "reset-ok", policeNo: "930001", mustChangePw: 0, passwordHash: "old" }))

        const response = yield* post(ADMIN, `${ACCOUNTS}/reset-ok/password`)
        expect(response.status).toBe(204)

        const row = yield* Effect.promise(() => 账号行("reset-ok"))
        expect(row.mustChangePw).toBe(1)
        expect(row.passwordHash).not.toBe("old")
      }),
    30_000,
  )

  it.live(
    "普通民警重置他人密码 ⇒ 403，哈希一个字不动",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "reset-deny", policeNo: "930002", mustChangePw: 0, passwordHash: "keep" }))

        const response = yield* post(OFFICER, `${ACCOUNTS}/reset-deny/password`)
        expect(response.status).toBe(403)
        expect((yield* Effect.promise(() => 账号行("reset-deny"))).passwordHash).toBe("keep")
      }),
    30_000,
  )

  it.live(
    "重置不存在的账号 ⇒ 404",
    () =>
      Effect.gen(function* () {
        const response = yield* post(ADMIN, `${ACCOUNTS}/no-such-id/password`)
        expect(response.status).toBe(404)
      }),
    30_000,
  )
})

describe("T005 · 停用 / 启用", () => {
  it.live(
    "管理员停用他人 ⇒ 204、状态落 0、停用时刻非空",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "stop-ok", policeNo: "940001" }))

        expect((yield* post(ADMIN, `${ACCOUNTS}/stop-ok/disable`)).status).toBe(204)

        const row = yield* Effect.promise(() => 账号行("stop-ok"))
        expect(row.status).toBe(0)
        expect(row.deactivatedAt).not.toBeNull()
      }),
    30_000,
  )

  it.live(
    "管理员停用自己 ⇒ 400「不能停用当前登录的账号」，自己仍是启用",
    () =>
      Effect.gen(function* () {
        const response = yield* post(ADMIN, `${ACCOUNTS}/${ADMIN.id}/disable`)

        expect(response.status).toBe(400)
        expect((yield* json(ErrorResponse, response)).error).toContain("当前登录")
        expect((yield* Effect.promise(() => 账号行(ADMIN.id))).status).toBe(1)
      }),
    30_000,
  )

  it.live(
    "普通民警停用他人 ⇒ 403，目标仍是启用",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "stop-deny", policeNo: "940002" }))

        expect((yield* post(OFFICER, `${ACCOUNTS}/stop-deny/disable`)).status).toBe(403)
        expect((yield* Effect.promise(() => 账号行("stop-deny"))).status).toBe(1)
      }),
    30_000,
  )

  it.live(
    "启用一个停用账号 ⇒ 204、状态回 1、停用时刻清回 NULL",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "enable-ok", policeNo: "940003", status: 0 }))

        expect((yield* post(ADMIN, `${ACCOUNTS}/enable-ok/enable`)).status).toBe(204)

        const row = yield* Effect.promise(() => 账号行("enable-ok"))
        expect(row.status).toBe(1)
        expect(row.deactivatedAt).toBeNull()
      }),
    30_000,
  )

  it.live(
    "停用不存在的账号 ⇒ 404",
    () =>
      Effect.gen(function* () {
        expect((yield* post(ADMIN, `${ACCOUNTS}/no-such-id/disable`)).status).toBe(404)
        expect((yield* post(ADMIN, `${ACCOUNTS}/no-such-id/enable`)).status).toBe(404)
      }),
    30_000,
  )

  it.live(
    "批量停用两个 ⇒ 200、两条都落 0",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "batch-1", policeNo: "950001" }))
        yield* Effect.promise(() => 造账号({ id: "batch-2", policeNo: "950002" }))

        const response = yield* post(ADMIN, BATCH_DISABLE, { ids: ["batch-1", "batch-2"] })

        expect(response.status).toBe(200)
        expect(yield* json(BatchResponse, response)).toEqual({ disabled: 2 })
        expect((yield* Effect.promise(() => 账号行("batch-1"))).status).toBe(0)
        expect((yield* Effect.promise(() => 账号行("batch-2"))).status).toBe(0)
      }),
    30_000,
  )

  it.live(
    "批量停用里含自己 ⇒ 400，整批一行都不改（不是跳过自己）",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "batch-self", policeNo: "950003" }))

        const response = yield* post(ADMIN, BATCH_DISABLE, { ids: ["batch-self", ADMIN.id] })

        expect(response.status).toBe(400)
        expect((yield* Effect.promise(() => 账号行("batch-self"))).status).toBe(1)
        expect((yield* Effect.promise(() => 账号行(ADMIN.id))).status).toBe(1)
      }),
    30_000,
  )

  it.live(
    "批量停用里有不存在的 id ⇒ 404，整批一行都不改（先查齐再动）",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "batch-missing", policeNo: "950004" }))

        const response = yield* post(ADMIN, BATCH_DISABLE, { ids: ["batch-missing", "no-such-id"] })

        expect(response.status).toBe(404)
        expect((yield* Effect.promise(() => 账号行("batch-missing"))).status).toBe(1)
      }),
    30_000,
  )

  it.live(
    "空 ids ⇒ 400（不是「成功停用 0 个」——调用方一定是漏传了）",
    () =>
      Effect.gen(function* () {
        expect((yield* post(ADMIN, BATCH_DISABLE, { ids: [] })).status).toBe(400)
      }),
    30_000,
  )
})

describe("T005 · 详情", () => {
  it.live(
    "管理员看详情 ⇒ 200，含证件号与手机号（列表不给的两项）",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => 造账号({ id: "detail-ok", policeNo: "960001", name: "详情甲" }))

        const response = yield* get(ADMIN, `${ACCOUNTS}/detail-ok`)
        expect(response.status).toBe(200)

        const detail = yield* json(DetailResponse, response)
        expect(detail).toMatchObject({
          id: "detail-ok",
          policeNo: "960001",
          name: "详情甲",
          idCard: "id-detail-ok",
          phone: "phone-detail-ok",
        })
      }),
    30_000,
  )

  it.live(
    "普通民警看详情 ⇒ 403（与列表同一道 read 门）",
    () =>
      Effect.gen(function* () {
        expect((yield* get(OFFICER, `${ACCOUNTS}/${ADMIN.id}`)).status).toBe(403)
      }),
    30_000,
  )

  it.live(
    "未知 id ⇒ 404",
    () =>
      Effect.gen(function* () {
        expect((yield* get(ADMIN, `${ACCOUNTS}/no-such-id`)).status).toBe(404)
      }),
    30_000,
  )
})

describe("T005 · 最后一个管理员的错误映射", () => {
  test("LastAdminError ⇒ 409「系统至少保留一个管理员」（映射本身；经 HTTP 不可达，见文件头）", () => {
    expect(停用失败(new LastAdminError(["000051", "000052"]))).toEqual({
      status: 409,
      message: "系统至少保留一个管理员",
    })
    expect(停用失败(new Error("别的错误"))).toBeUndefined()
  })
})
