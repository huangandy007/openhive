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

/**
 * 010 T008 · **MinIO 没配时治理兜底归档的处置**：503 明说，而不是 500 或静默失败。
 *
 * ## 为什么单独一个文件
 *
 * 它要一份**没有 `OPENHIVE_MINIO_*`** 的 env，而在一个进程里建第二个 app 会让 app 的第一条
 * PG 查询撞 `Connection closed`（起因与排查过程见 `openhive-project-archive.test.ts` 文件头
 * 「一个文件只建一个 app」；处置同 `#004-12`：同族接缝测试的手段整段搬、按需要分文件）。
 * 这里它是**唯一**的 app。
 *
 * ## 两条用例钉的是同一件事的两个方向
 *
 * ① 有 admin 的人（业务专家）⇒ **503**（能力有、配置缺）；
 * ② 没有 admin 的人（只读）⇒ **403**（而**不是** 503）——授权排在配置检查之前，
 *    否则「这台机器配没配 MinIO」就成了任何人凭状态码能读出的部署信息
 *    （`archive.ts` ④ 那条次序的实测说明；治理出口的文件头也逐字复述了这一条）。
 */

const it = testEffect(Layer.empty)

const SECRET = "d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6"

const EXPERT: TokenSubject = {
  id: "88888888-aaaa-4aaa-8aaa-888888888888",
  policeNo: "940001",
  name: "业务专家辛",
  isAdmin: true,
}
const READER: TokenSubject = {
  id: "99999999-bbbb-4bbb-8bbb-999999999999",
  policeNo: "940002",
  name: "只读壬",
  isAdmin: true,
}
const OWNER: TokenSubject = {
  id: "aaaaaaa1-cccc-4ccc-8ccc-aaaaaaaaaaa1",
  policeNo: "940003",
  name: "创建人癸",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const GOV_ARCHIVE = (id: string) => `/openhive/governance/projects/${id}/archive`

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-gov-projects-bare-"))
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = join(SANDBOX, "data")

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [EXPERT, READER, OWNER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-project-reader', '数据项目只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-project-reader', 'governance', 'data-project-perm', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${READER.id}, 'test-project-reader')`)
})

afterAll(async () => {
  await pg?.stop()
})

/** **刻意不配任何 `OPENHIVE_MINIO_*`**（文件头）。 */
const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: join(SANDBOX, "shared"),
}

const handler = HttpRouter.toWebHandler(
  HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
  { disableLogger: true },
).handler

const openApp = (url: string, init?: RequestInit) =>
  Effect.promise(() =>
    Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
  )

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    headers.set("Cookie", cookie(yield* token(subject)).Cookie)
    return yield* openApp(url, { ...init, headers })
  })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

const ErrorResponse = Schema.Struct({ error: Schema.String })

describe("T008 · MinIO 未配", () => {
  it.live("有 admin 的人归档 ⇒ 503，且项目没被标成已归档（零副作用）", () =>
    Effect.gen(function* () {
      const created = yield* as(OWNER, PROJECT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "未配 MinIO 的项目", type: "shared" }),
      })
      const { id } = yield* json(Schema.Struct({ id: Schema.String }), created)

      const response = yield* as(EXPERT, GOV_ARCHIVE(id), { method: "POST" })
      expect(response.status).toBe(503)
      expect((yield* json(ErrorResponse, response)).error).toContain("MinIO")

      if (!pg) throw new Error("真库没起来")
      const rows = yield* Effect.promise(() =>
        pg!.db.execute(sql`select archived from auth.project_archive where project_id = ${id}`),
      )
      expect(rowsOf(rows)).toEqual([])
    }),
  )

  it.live("没有 admin 的人归档 ⇒ 403（而不是 503：授权排在配置之前）", () =>
    Effect.gen(function* () {
      const response = yield* as(READER, GOV_ARCHIVE("00000000-0000-4000-8000-000000000000"), { method: "POST" })
      expect(response.status).toBe(403)
    }),
  )
})
