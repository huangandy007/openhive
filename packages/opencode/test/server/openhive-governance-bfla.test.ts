/**
 * 010 T015 · 越权（BFLA）：**普通民警凭证调管理员能力被拒**（FR-013 / SC-005）
 *
 * 本文件测「普通民警 **对** 管理员」，与 T014 的「管理员**之间**」互补：
 * 两条都绿才叫分权矩阵两个方向都闭合，**不互相替代**。
 *
 * 三条能力各测**双向**，判据是「**同一出口、同一载荷、只换身份**」：
 * 1. 录入账号        `POST accounts`（合法载荷）
 * 2. 重置他人密码    `POST accounts/:id/password`
 * 3. 停用他人账号    `POST accounts/:id/disable`
 *
 * 每一对都是「民警 403 ＋ 副作用未发生」与「管理员成功 ＋ 副作用真的发生」：
 * 只测被拒会让「把所有人都拒掉」也全绿（SC-005 原文），所以正向是判据的一半。
 *
 * ## 为什么这里**不能**用 404 当拒绝
 *
 * 路由未挂载时这三个路径本来就落到 SPA 兜底（200 text/html）或 404。**404 不是授权拒绝**
 * （`#002-02`），断言 404 会得到一条永远绿的假测试。故 403 的判据附带两项：
 * 响应必须是 `application/json`、`error` 文案必须是「没有…权限」；而**管理员走同一条必须通**
 * ——同一路径有人能通，才证明路由真的在、拒绝来自门而不是缺席。
 *
 * ## 身份有效是前提的一部分
 *
 * 民警是**真账号**（`status=1`、`is_admin=0`、无任何治理角色）。但「身份有效」不能只靠
 * 夹具的自述，要靠**响应**证明：同一出口、同一载荷，**无凭证 401 / 民警凭证 403**——401 与
 * 403 的分界正是「认不出你」与「认出你、但你不够格」（本文件第一组用例）。
 *
 * ⚠️ 这一组**不调 `/me`**：`/me` 走网关池、治理出口走治理池，两个客户端在同一 PGlite 实例上
 * 会准备同一句 `select … from auth.user where id = $1`，服务端报 `42P05`
 * （`test-support.ts:67` 的夹具硬约束）。 `/me` 的可见面投影在
 * `openhive-governance-visibility.test.ts` 里单独验。
 */

import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

const it = testEffect(Layer.empty)

const SECRET = "b5f1c2d3e4a5968778695a4b3c2d1e0f"

/** 管理员：`gov-system-admin`。 */
const ADMIN: TokenSubject = {
  id: "eeeeeeee-5555-4555-8555-555555555555",
  policeNo: "960001",
  name: "越权测试管理员",
  isAdmin: true,
}
/** 普通民警：**真账号**、无治理角色。 */
const OFFICER: TokenSubject = {
  id: "ffffffff-6666-4666-8666-666666666666",
  policeNo: "960002",
  name: "越权测试民警",
  isAdmin: false,
}
/**
 * 民警被**误配了管理员角色**（`user_role` 里有 `gov-system-admin`）、但 `is_admin=0`。
 * 这一格钉的是 `authorizeGovernance` 的 `is_admin` 总开关：只看授权表的话，他「有权限」。
 */
const ROLE_ONLY: TokenSubject = {
  id: "99999999-7777-4777-8777-777777777777",
  policeNo: "960003",
  name: "误配角色的民警",
  isAdmin: false,
}
/**
 * **已停用的管理员**（`is_admin=1`、`status=0`，角色也在）。
 * 钉的是同一句判定里的 `status === 1`：停用即失去全部治理能力，不必等凭证过期。
 */
const SUSPENDED: TokenSubject = {
  id: "88888888-8888-4888-8888-888888888888",
  policeNo: "960004",
  name: "已停用的管理员",
  isAdmin: true,
}

/** 落库夹具：谁什么状态、挂什么角色。 */
const 夹具 = [
  { subject: ADMIN, status: 1, role: "gov-system-admin" },
  { subject: OFFICER, status: 1, role: undefined },
  { subject: ROLE_ONLY, status: 1, role: "gov-system-admin" },
  { subject: SUSPENDED, status: 0, role: "gov-system-admin" },
] as const

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const ACCOUNTS = "/openhive/governance/accounts"

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-governance-bfla-"))
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = join(SANDBOX, "data")

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
// 同族文件一致：PGlite 的 socket 服务把多条连接汇进同一个 PG 会话，第二条连接再准备
// 同名语句会撞 `42P05`（`pg.ts` 文件头记过），故池只留一条。
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

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

  for (const { subject, status, role } of 夹具) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '越权单位', '越权部门', '越权科室',
              ${status}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
    if (role !== undefined) {
      await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${subject.id}, ${role})`)
    }
  }
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: join(SANDBOX, "shared"),
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

const 请求 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const post = (subject: TokenSubject | null, url: string, body?: unknown) =>
  请求(subject, url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })

const 错误体 = Schema.Struct({ error: Schema.String })
const 录入口回包 = Schema.Struct({ id: Schema.String })

/** 403 的两项附加判据：**是 JSON** ＋ 文案是「没有…权限」——不是 SPA 兜底、也不是 404。 */
const 断言拒之有道 = (subject: TokenSubject, url: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const response = yield* 请求(subject, url, init)
    expect(response.status).toBe(403)
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    expect(Schema.decodeUnknownSync(错误体)(JSON.parse(body)).error).toContain("没有")
  })

/** 裸 SQL：账号行（不经被测对象）。 */
const 账号行 = (id: string) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    const [row] = rowsOf(
      await pg.db.execute(
        sql`select id, status, is_admin, must_change_pw, password_hash, deactivated_at
            from auth.user where id = ${id}`,
      ),
    )
    if (!row) throw new Error(`账号不存在：${id}`)
    return {
      status: Number(row.status),
      mustChangePw: Number(row.must_change_pw),
      passwordHash: String(row.password_hash),
      deactivatedAt: row.deactivated_at,
    }
  })

const 警号计数 = (policeNo: string) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    const [row] = rowsOf(
      await pg.db.execute(sql`select count(*)::int as n from auth.user where police_no = ${policeNo}`),
    )
    return Number(row?.n ?? 0)
  })

/**
 * 夹具前态：录入出来的账号 `must_change_pw` 本来就是 1（`0001_init.sql` 的默认值）。
 * 先把目标落成 0，重置那一步「置 1」才是一次**可观测的变化**；否则它在重置前后都是 1，
 * 断言恒真、等于什么都没测（`#005-47`）。
 */
const 置改密标记 = (id: string, 值: number) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    await pg.db.execute(sql`update auth.user set must_change_pw = ${值} where id = ${id}`)
  })

const 审计 = (where: string) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    return rowsOf(
      await pg.db.execute(
        sql.raw(
          `select actor_id, board, action, target_type, target_id, result, detail
           from auth.audit_event where ${where} order by id asc`,
        ),
      ),
    )
  })

const 账号载荷 = (policeNo: string) => ({
  policeNo,
  name: "BFLA 测试账号",
  idCard: "x",
  phone: "x",
  org: "越权单位",
  dept: "越权部门",
  section: "越权科室",
  status: 1,
})

/** 管理员录入一个目标账号（走**生产出口**，不裸插行）。返回它的 id。 */
const 录目标 = (policeNo: string) =>
  Effect.gen(function* () {
    const response = yield* post(ADMIN, ACCOUNTS, 账号载荷(policeNo))
    expect(response.status).toBe(201)
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(录入口回包)(JSON.parse(body)).id
  })

describe("T015 · 前提：身份有效、权限不够", () => {
  /**
   * **不调 `/me`**：`/me` 走网关池、治理出口走治理池，两个客户端在同一 PGlite 实例上
   * 会准备同一句 `… where id = $1`，服务端报 `42P05`（`test-support.ts:67` 的夹具硬约束）。
   * 「身份有效」换一个更强、也更贴近判据的证据：**无凭证 401 / 有凭证 403** ——
   * 401 与 403 的分界正是「认不出你」与「认出你、但你不够格」。
   */
  it.live("无凭证 401 ／ 民警凭证 403——不是凭证无效，是权限不够", () =>
    Effect.gen(function* () {
      expect((yield* post(null, ACCOUNTS, 账号载荷("950000"))).status).toBe(401)
      expect((yield* post(OFFICER, ACCOUNTS, 账号载荷("950000"))).status).toBe(403)
      expect(yield* 警号计数("950000")).toBe(0)
    }),
  )
})

describe("T015 · 三条管理员能力的双向验收（同一出口、同一载荷、只换身份）", () => {
  it.live("录入账号：民警 403（库里 0 行）／管理员 201（库里 1 行）", () =>
    Effect.gen(function* () {
      yield* 断言拒之有道(OFFICER, ACCOUNTS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(账号载荷("950001")),
      })
      expect(yield* 警号计数("950001")).toBe(0)

      expect((yield* post(ADMIN, ACCOUNTS, 账号载荷("950002"))).status).toBe(201)
      expect(yield* 警号计数("950002")).toBe(1)
    }),
  )

  it.live("重置他人密码：民警 403（哈希一字不动）／管理员 204（哈希换掉、强制改密置 1）", () =>
    Effect.gen(function* () {
      const 目标 = yield* 录目标("950003")
      yield* 置改密标记(目标, 0)
      const 前 = yield* 账号行(目标)
      expect(前.mustChangePw).toBe(0)

      yield* 断言拒之有道(OFFICER, `${ACCOUNTS}/${目标}/password`, { method: "POST" })
      const 拒后 = yield* 账号行(目标)
      expect(拒后.passwordHash).toBe(前.passwordHash)
      expect(拒后.mustChangePw).toBe(0)

      expect((yield* post(ADMIN, `${ACCOUNTS}/${目标}/password`)).status).toBe(204)
      const 放行后 = yield* 账号行(目标)
      expect(放行后.passwordHash).not.toBe(前.passwordHash)
      expect(放行后.mustChangePw).toBe(1)
    }),
  )

  it.live("停用他人账号：民警 403（仍启用、无停用时刻）／管理员 204（已停用）", () =>
    Effect.gen(function* () {
      const 目标 = yield* 录目标("950004")
      const 前 = yield* 账号行(目标)
      expect(前.status).toBe(1)
      expect(前.deactivatedAt).toBeNull()

      yield* 断言拒之有道(OFFICER, `${ACCOUNTS}/${目标}/disable`, { method: "POST" })
      const 拒后 = yield* 账号行(目标)
      expect(拒后.status).toBe(1)
      expect(拒后.deactivatedAt).toBeNull()

      expect((yield* post(ADMIN, `${ACCOUNTS}/${目标}/disable`)).status).toBe(204)
      const 放行后 = yield* 账号行(目标)
      expect(放行后.status).toBe(0)
      expect(放行后.deactivatedAt).not.toBeNull()
    }),
  )
})

describe("T015 · 门在 `is_admin` / `status` 上，不只在授权表上", () => {
  /**
   * 为什么必须补这一组：上面三条用的是一个**没有任何角色**的民警——他即使把
   * `authorizeGovernance` 的 `is_admin` 判断整行删掉，也仍然会在「板块 read」那一跳被拒，
   * 三条用例照样全绿。那正是本 task 存在的理由（「T005 忘了加 isAdmin 判断」）**测不到**。
   * 这两个身份在授权表里**有** `gov-system-admin` 的全部行，唯一的拦截就是 `is_admin` / `status`。
   */
  it.live("有角色但非管理员、已停用的管理员：三条能力同样 403，目标账号一字不动", () =>
    Effect.gen(function* () {
      const 目标 = yield* 录目标("950005")
      const 前 = yield* 账号行(目标)

      for (const subject of [ROLE_ONLY, SUSPENDED]) {
        yield* 断言拒之有道(subject, ACCOUNTS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(账号载荷("950006")),
        })
        yield* 断言拒之有道(subject, `${ACCOUNTS}/${目标}/password`, { method: "POST" })
        yield* 断言拒之有道(subject, `${ACCOUNTS}/${目标}/disable`, { method: "POST" })
      }

      expect(yield* 警号计数("950006")).toBe(0)
      const 后 = yield* 账号行(目标)
      expect(后).toEqual(前)
    }),
  )
})

describe("T015 · 拒绝留痕（FR-009 同一口径）", () => {
  it.live("民警三次越权各留一条 governance.denied（account-manage / write / denied）", () =>
    Effect.gen(function* () {
      const 行 = yield* 审计(
        `action = 'governance.denied' and actor_id = '${OFFICER.id}' and board = 'account-manage'` +
          ` and result = 'denied' and detail like '%"perm":"write"%'`,
      )
      expect({ 留痕条数够三次: 行.length >= 3 }).toEqual({ 留痕条数够三次: true })
      // 管理员走同一条不该被记拒绝。
      const 管理员被拒 = yield* 审计(
        `action = 'governance.denied' and actor_id = '${ADMIN.id}' and board = 'account-manage'`,
      )
      expect(管理员被拒.length).toBe(0)
    }),
  )
})
