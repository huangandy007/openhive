/**
 * 010 T014 · 两类管理员分权验收矩阵（SC-002 / T003）
 *
 * 本文件只测**管理员 A vs 管理员 B**：系统管理员（`gov-system-admin`，6 板块）与业务专家
 * （`gov-business-expert`，3 板块）各见各的功能、互不越界。**普通民警 vs 管理员**是 FR-013，
 * 按 `tasks.md` 的分工归 T015，本文件不覆盖。
 *
 * 四件事：
 * ① **可见面**：`/me` 回给两人的板块集——各自恰好、交集只有 AI 资产治理、并集是全部八页；
 * ② **读矩阵**：8 板块 × 2 身份 = 16 个请求；期望网格在测试里写成**字面量**（`#003-05`：
 *    客户端契约不跟着实现漂）；
 * ③ **写矩阵**：五个有**板级**写出口的板块逐格打——专家撞账号 / 组织 / 数据源，管理员撞
 *    模板库 / 数据项目权限。`assets` 的写是**资产级**授权（板级只有 read 门槛），不属板级
 *    分权，明确排除；`usage-cost` / `audit-log` 没有写出口；
 * ④ **被拒之后**：越权写递的是**合法载荷**，仍拿 403（授权在解析之前，`#004-09`）⇒ 库里
 *    没多出那一行 ＋ 每个越权动作各留一条 `governance.denied`（写动作的 `detail.perm`
 *    必须记 `write`，不是 `read`）。
 *
 * ## 为什么另起一份矩阵文件，而不收进各板块自己的测试
 *
 * 各板块的测试保证「这一格没被人动坏」；矩阵保证「**格子之间的关系**没被同时动坏」——
 * 比如把模板库从专家挪给管理员，两边的各自测试可能都还绿（期望跟着改了），但交集不再
 * 只有 AI 资产治理、并集不再覆盖八页。关系断言只有放在一张表里才写得出来。
 *
 * 本文件自带 401 自查：矩阵里的「非 403」若因为认证整体失效而变成「人人 401」，
 * 正向对照会先红，不会把「门都不在」误读成「分权对了」。
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

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

/** 系统管理员：6 板块（账号 / 组织 / 资产治理 / 用量 / 审计 / 数据源）。 */
const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "930001",
  name: "系统管理员甲",
  isAdmin: true,
}
/** 业务专家：3 板块（资产治理 / 模板库 / 数据项目权限）。 */
const EXPERT: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "930003",
  name: "业务专家丙",
  isAdmin: true,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const ACCOUNTS = "/openhive/governance/accounts"
const ORG_TREE = "/openhive/governance/org/tree"
const ORG_NODES = "/openhive/governance/org/nodes"
const ASSETS = "/openhive/governance/assets"
const TEMPLATES = "/openhive/governance/templates"
const PROJECTS = "/openhive/governance/projects"
const USAGE = "/openhive/governance/usage-cost"
const AUDIT_LOG = "/openhive/governance/audit-log"
const SOURCES = "/openhive/governance/data-sources"
const ME = "/openhive/auth/me"

/** 八页全集，顺序跟导航注册表一致（`src/governance/sections.ts`）。 */
const 全部板块 = [
  "account-manage",
  "org-tree",
  "asset-governance",
  "template-lib",
  "data-project-perm",
  "usage-cost",
  "audit-log",
  "data-source",
] as const
type 板块 = (typeof 全部板块)[number]

/** 每个板块的**读**出口。 */
const 读出口: Record<板块, string> = {
  "account-manage": ACCOUNTS,
  "org-tree": ORG_TREE,
  "asset-governance": ASSETS,
  "template-lib": TEMPLATES,
  "data-project-perm": PROJECTS,
  "usage-cost": USAGE,
  "audit-log": AUDIT_LOG,
  "data-source": SOURCES,
}

/**
 * 期望网格：**字面量**，不 import `auth/src/governance.ts` 的模板。
 *
 * 顺序与 `/me` 的投影顺序相同（模板里 grant 的首次出现序），`toEqual` 因此也钉顺序。
 */
const 系统管理员期望 = {
  身份: "系统管理员",
  subject: ADMIN,
  boards: ["account-manage", "org-tree", "asset-governance", "usage-cost", "audit-log", "data-source"],
} as const
const 业务专家期望 = {
  身份: "业务专家",
  subject: EXPERT,
  boards: ["asset-governance", "template-lib", "data-project-perm"],
} as const

/** 宽化成 `readonly 板块[]`：矩阵循环里要按任意板块查表。 */
const 期望可读: ReadonlyArray<{ 身份: string; subject: TokenSubject; boards: readonly 板块[] }> = [
  系统管理员期望,
  业务专家期望,
]

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-governance-split-"))
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = join(SANDBOX, "data")

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
// 同族文件一致：PGlite 的 socket 服务把多条连接汇进同一个 PG 会话，第二个连接再准备
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

  for (const subject of [ADMIN, EXPERT]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '分权单位', '分权部门', '分权科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
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

const get = (subject: TokenSubject | null, url: string) => 请求(subject, url)

const post = (subject: TokenSubject | null, url: string, body?: unknown) =>
  请求(subject, url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })

/** 会话回包只取 `governance` 一段：多出来的字段（比如把 `token` 顺带透出去）不该管这里。 */
const 会话自查 = Schema.Struct({ governance: Schema.optional(Schema.Array(Schema.String)) })

/** 会话回包的 `governance` 数组（`/me` 与登录响应同一份投影，这里读 `/me`）。 */
const 板块集 = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* get(subject, ME)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(会话自查)(JSON.parse(body)).governance ?? []
  })

/** 裸 SQL 数库里的行（不经被测对象）。 */
const 库行数 = (表: string, where: string) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    const [row] = rowsOf(await pg.db.execute(sql.raw(`select count(*)::int as n from ${表} where ${where}`)))
    return Number(row?.n ?? 0)
  })

/** 读审计表（**裸 SQL**）。 */
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
  name: "分权测试账号",
  idCard: "x",
  phone: "x",
  org: "分权单位",
  dept: "分权部门",
  section: "分权科室",
  status: 1,
})

const 不存在项目 = "00000000-0000-4000-8000-000000000000"

describe("T014 · 可见面（导航收敛）", () => {
  it.live("/me 给两类管理员各自的板块集：交集只有 AI 资产治理、并集是全部八页", () =>
    Effect.gen(function* () {
      const 甲 = yield* 板块集(ADMIN)
      const 乙 = yield* 板块集(EXPERT)

      expect(甲).toEqual([...系统管理员期望.boards])
      expect(乙).toEqual([...业务专家期望.boards])

      // 关系断言：各自数组「改了但看起来还像」时，这两条先红。
      const 交集 = 甲.filter((id) => 乙.includes(id))
      expect(交集).toEqual(["asset-governance"])
      const 并集 = [...new Set([...甲, ...乙])].sort()
      expect(并集).toEqual([...全部板块].sort())
    }),
  )
})

describe("T014 · 读矩阵（8 板块 × 2 管理员）", () => {
  it.live("无凭证 ⇒ 401：矩阵的「非 403」不能是「人人 401」的假绿", () =>
    Effect.gen(function* () {
      expect((yield* get(null, ACCOUNTS)).status).toBe(401)
      expect((yield* get(null, TEMPLATES)).status).toBe(401)
    }),
  )

  for (const { 身份, subject, boards } of 期望可读) {
    it.live(`${身份}：${boards.length} 个自有板块放行，其余 ${全部板块.length - boards.length} 个 403`, () =>
      Effect.gen(function* () {
        for (const board of 全部板块) {
          const response = yield* get(subject, 读出口[board])
          const 应放行 = boards.includes(board)
          if (应放行) expect({ 板块: board, 非403: response.status !== 403 }).toEqual({ 板块: board, 非403: true })
          else expect({ 板块: board, 状态: response.status }).toEqual({ 板块: board, 状态: 403 })
        }
      }),
    )
  }
})

describe("T014 · 写矩阵（五个板级写出口）", () => {
  /** 越权写：主体、板块、出口、**合法载荷**。 */
  const 越权写 = [
    {
      谁: "业务专家",
      subject: EXPERT,
      board: "account-manage" as const,
      url: ACCOUNTS,
      body: 账号载荷("939902"),
    },
    {
      谁: "业务专家",
      subject: EXPERT,
      board: "org-tree" as const,
      url: ORG_NODES,
      body: { parentId: null, name: "T014 专家不该建出来的部门" },
    },
    {
      谁: "业务专家",
      subject: EXPERT,
      board: "data-source" as const,
      url: SOURCES,
      body: { name: "T014 专家不该建出来的数据源", kind: "database", frequency: "daily" },
    },
    {
      谁: "系统管理员",
      subject: ADMIN,
      board: "template-lib" as const,
      url: TEMPLATES,
      body: { kind: "report", name: "T014 管理员不该建出来的模板" },
    },
    {
      谁: "系统管理员",
      subject: ADMIN,
      board: "data-project-perm" as const,
      url: `${PROJECTS}/${不存在项目}/archive`,
    },
    {
      谁: "系统管理员",
      subject: ADMIN,
      board: "data-project-perm" as const,
      url: `${PROJECTS}/${不存在项目}/members/remove`,
      body: { userId: ADMIN.id },
    },
  ]

  it.live("越权写递合法载荷 ⇒ 403（授权在解析之前，不是 400 字段探针）", () =>
    Effect.gen(function* () {
      for (const 例 of 越权写) {
        const response = yield* post(例.subject, 例.url, 例.body)
        expect({ 谁: 例.谁, 板块: 例.board, 状态: response.status }).toEqual({
          谁: 例.谁,
          板块: 例.board,
          状态: 403,
        })
      }
    }),
  )

  it.live("正向对照：每个写出口在**有权的一侧**确实可达——「一律 403」也是假绿", () =>
    Effect.gen(function* () {
      // 系统管理员：账号 / 组织 / 数据源。
      expect((yield* post(ADMIN, ACCOUNTS, 账号载荷("939901"))).status).toBe(201)
      expect((yield* post(ADMIN, ORG_NODES, { parentId: null, name: "T014 正面对照部门" })).status).toBe(201)
      expect(
        (yield* post(ADMIN, SOURCES, { name: "T014 正面对照数据源", kind: "database", frequency: "daily" })).status,
      ).toBe(201)

      // 业务专家：模板库 / 数据项目权限。
      expect((yield* post(EXPERT, TEMPLATES, { kind: "report", name: "T014 正面对照模板" })).status).toBe(201)
      // 归档一个不存在的项目：门已过、只是项目不在（404 ≠ 403，证明不是被授权挡住）。
      expect((yield* post(EXPERT, `${PROJECTS}/${不存在项目}/archive`)).status).toBe(404)
    }),
  )
})

describe("T014 · 被拒之后：库里没多出行 ＋ 审计留痕", () => {
  it.live("四个建行类越权写之后，目标行都不存在", () =>
    Effect.gen(function* () {
      expect(yield* 库行数("auth.user", "police_no = '939902'")).toBe(0)
      expect(yield* 库行数("auth.org_node", "name = 'T014 专家不该建出来的部门'")).toBe(0)
      expect(yield* 库行数("auth.data_source", "name = 'T014 专家不该建出来的数据源'")).toBe(0)
      expect(yield* 库行数("auth.template", "name = 'T014 管理员不该建出来的模板'")).toBe(0)

      // 正向对照造的行确实在——否则「不存在」也可能是夹具没生效。
      expect(yield* 库行数("auth.user", "police_no = '939901'")).toBe(1)
      expect(yield* 库行数("auth.template", "name = 'T014 正面对照模板'")).toBe(1)
    }),
  )

  it.live("六个越权写各留一条 governance.denied；写动作的 detail 记 write", () =>
    Effect.gen(function* () {
      const 板级 = [
        { 谁: "业务专家", actor: EXPERT.id, board: "account-manage", perm: "write" },
        { 谁: "业务专家", actor: EXPERT.id, board: "org-tree", perm: "write" },
        { 谁: "业务专家", actor: EXPERT.id, board: "data-source", perm: "write" },
        { 谁: "系统管理员", actor: ADMIN.id, board: "template-lib", perm: "write" },
        { 谁: "系统管理员", actor: ADMIN.id, board: "data-project-perm", perm: "admin" },
      ]

      for (const 例 of 板级) {
        const 行 = yield* 审计(
          `action = 'governance.denied' and actor_id = '${例.actor}' and board = '${例.board}'` +
            ` and result = 'denied' and detail like '%"perm":"${例.perm}"%'`,
        )
        expect({ 谁: 例.谁, 板块: 例.board, 有留痕: 行.length >= 1 }).toEqual({
          谁: 例.谁,
          板块: 例.board,
          有留痕: true,
        })
      }
    }),
  )
})
