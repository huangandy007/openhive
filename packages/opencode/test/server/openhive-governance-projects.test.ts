import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { type FakeS3, startFakeS3 } from "@opencode-ai/core/test-support/fake-s3"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 010 T008 · **数据项目权限**的四条 HTTP 出口（FR-007 / US4）：管理员兜底撤销成员 / 归档项目。
 *
 * 判据分三层，每层都落在**可观测**的东西上：
 *
 * 1. **门**：未登录 401 / 普通民警 403 / 系统管理员 403（`data-project-perm` 只授业务专家）/
 *    只读 200 但动作 403。路由必须在（403 不是 404——`LEARNINGS #002-02`）。
 * 2. **读面**：列表**含已归档**且带 owner / 成员数（US4 场景②）；名单带警号与角色。
 * 3. **兜底动作**：撤销 member 真的少一行；撤销 owner **409 且库里没变**；归档**每个成员各进
 *    自己的前缀**、沙箱删空、标记最后落——以及「第二个成员上传失败 ⇒ 第一个成员的沙箱还在」
 *    那条次序不变量（005 已验过的同一条，这里验它**经治理出口**仍然成立）。
 *
 * ⚠️ 授权排在读体之前（`#004-09`）：没有 admin 的人递畸形 JSON 必须拿 403 而不是 400。
 *
 * ⚠️ **本文件只建一个 app**（`openhive-project-archive.test.ts` 文件头记过的实测：第二个 app
 * 的第一条 PG 查询会撞 `Connection closed`）。所以「MinIO 未配 ⇒ 503」那条住在
 * `openhive-governance-projects-unconfigured.test.ts`——那里它是唯一的 app。
 *
 * ⚠️ 夹具**走生产出口造数据**（建项目 / 邀请成员），只有「预置的已归档项目」与「沙箱里先放
 * 文件」是直接写库 / 写盘——前者是 005 归档出口的产物（本文件的归档用例会自己造一个），
 * 后者是用户在使用过程中自然会有的东西（`#006-35`：夹具尽量走生产出口）。
 */

const it = testEffect(Layer.empty)

const SECRET = "c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6"

const EXPERT: TokenSubject = {
  id: "11111111-aaaa-4aaa-8aaa-111111111111",
  policeNo: "930001",
  name: "业务专家甲",
  isAdmin: true,
}
const ADMIN: TokenSubject = {
  id: "22222222-bbbb-4bbb-8bbb-222222222222",
  policeNo: "930002",
  name: "系统管理员乙",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "33333333-cccc-4ccc-8ccc-333333333333",
  policeNo: "930003",
  name: "民警丙",
  isAdmin: false,
}
const READER: TokenSubject = {
  id: "44444444-dddd-4ddd-8ddd-444444444444",
  policeNo: "930004",
  name: "只读丁",
  isAdmin: true,
}
/** 项目的创建人（普通民警——owner 身份来自建项目这个动作，不来自治理授权）。 */
const OWNER: TokenSubject = {
  id: "55555555-eeee-4eee-8eee-555555555555",
  policeNo: "930005",
  name: "创建人戊",
  isAdmin: false,
}
const GANG: TokenSubject = {
  id: "66666666-ffff-4fff-8fff-666666666666",
  policeNo: "930006",
  name: "成员己",
  isAdmin: false,
}
const LI: TokenSubject = {
  id: "77777777-0000-4000-8000-777777777777",
  policeNo: "930007",
  name: "成员庚",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const GOV = "/openhive/governance/projects"
const PROJECT_PATH = "/openhive/project"
const INVITE_PATH = "/openhive/project/member/invite"

const GOV_MEMBERS = (id: string) => `${GOV}/${id}/members`
const GOV_REMOVE = (id: string) => `${GOV}/${id}/members/remove`
const GOV_ARCHIVE = (id: string) => `${GOV}/${id}/archive`

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-gov-projects-"))
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = join(SANDBOX, "data")

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

const s3: FakeS3 = startFakeS3()

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(() => {
  s3.stop()
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

  for (const subject of [EXPERT, ADMIN, OFFICER, READER, OWNER, GANG, LI]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }

  // 两个模板角色由迁移种下；另造一个「只有 data-project-perm 的 read」的自定义角色（进门 ≠ 动作）。
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
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

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: join(SANDBOX, "shared"),
  OPENHIVE_MINIO_ENDPOINT: new URL(s3.endpoint).host,
  OPENHIVE_MINIO_BUCKET: s3.bucket,
  OPENHIVE_MINIO_ACCESS_KEY: "test-access-key",
  OPENHIVE_MINIO_SECRET_KEY: "test-secret-key",
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

const ProjectRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  archived: Schema.Boolean,
  archivedAt: Schema.NullOr(Schema.Number),
  ownerId: Schema.NullOr(Schema.String),
  ownerName: Schema.NullOr(Schema.String),
  memberCount: Schema.Number,
})
const ListResponse = Schema.Struct({ projects: Schema.Array(ProjectRow) })
const MemberRow = Schema.Struct({
  userId: Schema.String,
  policeNo: Schema.String,
  name: Schema.String,
  role: Schema.String,
  timeCreated: Schema.Number,
})
const MembersResponse = Schema.Struct({ projectId: Schema.String, members: Schema.Array(MemberRow) })
const ArchiveResponse = Schema.Struct({ projectId: Schema.String, archived: Schema.Boolean })
const ErrorResponse = Schema.Struct({ error: Schema.String })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 建一个共享项目（**生产出口**），返回它的 id。 */
const 建项目 = (name: string) =>
  Effect.gen(function* () {
    const response = yield* post(OWNER, PROJECT_PATH, { name, type: "shared" })
    expect(response.status).toBe(200)
    const body = yield* json(Schema.Struct({ id: Schema.String }), response)
    return body.id
  })

/** 邀请一个成员（**生产出口**：owner 递警号）。 */
const 邀请 = (projectId: string, subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* post(OWNER, INVITE_PATH, { projectId, policeNo: subject.policeNo })
    expect(response.status).toBe(200)
  })

/** 库里的成员名单（**裸 SQL**，不经被测对象）。 */
async function 库成员(projectId: string): Promise<Array<{ userId: string; role: string }>> {
  if (!pg) throw new Error("真库没起来")
  return rowsOf(
    await pg.db.execute(sql`
      select user_id, role from auth.project_member where project_id = ${projectId} order by user_id
    `),
  ).map((row) => ({ userId: String(row.user_id), role: String(row.role) }))
}

/** 库里的归档行（**裸 SQL**）。 */
async function 库归档(projectId: string): Promise<boolean> {
  if (!pg) throw new Error("真库没起来")
  const [row] = rowsOf(
    await pg.db.execute(sql`select archived from auth.project_archive where project_id = ${projectId}`),
  )
  if (!row) return false
  return row.archived === true || row.archived === "t" || row.archived === 1
}

/** 沙箱里某个项目的目录。 */
const 沙箱目录 = (subject: TokenSubject, projectId: string) => join(WORKSPACE_ROOT, subject.id, projectId)

/** 往沙箱里放一个文件（**夹具**：构造「用户平时就有文件」这个输入）。 */
function 放文件(subject: TokenSubject, projectId: string, rel: string, content: string) {
  const full = join(沙箱目录(subject, projectId), rel)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content, "utf8")
}

/** 夹具记下的、**属于这个项目**的 PUT 键（按 projectId 过滤 = 天然逐用例隔离）。 */
const 上传键 = (projectId: string) =>
  s3.requests.filter((request) => request.method === "PUT" && request.key.includes(`/${projectId}/`)).map((r) => r.key)

describe("T008 · 门", () => {
  it.live("无凭证 ⇒ 401；普通民警 ⇒ 403；系统管理员 ⇒ 403（板块没授给他）", () =>
    Effect.gen(function* () {
      expect((yield* get(null, GOV)).status).toBe(401)
      expect((yield* get(OFFICER, GOV)).status).toBe(403)

      const 系统管理员 = yield* get(ADMIN, GOV)
      expect(系统管理员.status).toBe(403)
      expect((yield* json(ErrorResponse, 系统管理员)).error).toContain("没有")
    }),
  )

  it.live("只读角色能看列表；撤销与归档都是 403（read ≠ admin）", () =>
    Effect.gen(function* () {
      expect((yield* get(READER, GOV)).status).toBe(200)
      expect((yield* post(READER, GOV_REMOVE("whatever"), { userId: "whoever" })).status).toBe(403)
      expect((yield* post(READER, GOV_ARCHIVE("whatever"))).status).toBe(403)
    }),
  )

  it.live("没有 admin 的人递畸形 JSON ⇒ 403（授权排在读体之前）", () =>
    Effect.gen(function* () {
      const response = yield* as(READER, GOV_REMOVE("whatever"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
      expect(response.status).toBe(403)
    }),
  )
})

describe("T008 · 读面", () => {
  it.live("列表含已归档项目，带创建人姓名与成员数（US4 场景②）", () =>
    Effect.gen(function* () {
      const 在册 = yield* 建项目("资金流水研判")
      yield* 邀请(在册, GANG)
      const 已归档 = yield* 建项目("话单碰撞分析")
      yield* 邀请(已归档, GANG)
      // 预置归档态：这是 005 归档出口的产物，本文件另有用例验证治理出口能造出来。
      if (!pg) throw new Error("真库没起来")
      yield* Effect.promise(() =>
        pg!.db.execute(sql`
          insert into auth.project_archive (project_id, archived, archived_at)
          values (${已归档}, true, 1700000000)
        `),
      )

      const body = yield* json(ListResponse, yield* get(EXPERT, GOV))
      const 一 = body.projects.find((row) => row.id === 在册)
      const 二 = body.projects.find((row) => row.id === 已归档)

      expect(一).toMatchObject({ name: "资金流水研判", type: "shared", archived: false, ownerId: OWNER.id, ownerName: OWNER.name, memberCount: 2 })
      expect(二).toMatchObject({ name: "话单碰撞分析", archived: true, archivedAt: 1_700_000_000, memberCount: 2 })
    }),
  )

  it.live("名单：带警号、姓名、角色与加入时间；未知项目 ⇒ 404", () =>
    Effect.gen(function* () {
      const id = yield* 建项目("名单测试")
      yield* 邀请(id, GANG)

      const body = yield* json(MembersResponse, yield* get(EXPERT, GOV_MEMBERS(id)))
      expect(body.projectId).toBe(id)
      expect(body.members.find((member) => member.userId === OWNER.id)).toMatchObject({
        policeNo: OWNER.policeNo,
        name: OWNER.name,
        role: "owner",
      })
      expect(body.members.find((member) => member.userId === GANG.id)).toMatchObject({ role: "member" })
      expect(body.members.every((member) => member.timeCreated > 0)).toBe(true)

      expect((yield* get(EXPERT, GOV_MEMBERS("00000000-0000-4000-8000-000000000000"))).status).toBe(404)
    }),
  )
})

describe("T008 · 兜底撤销成员", () => {
  it.live("撤销普通成员 ⇒ 200，库里少一行、其他人不动", () =>
    Effect.gen(function* () {
      const id = yield* 建项目("撤销测试")
      yield* 邀请(id, GANG)
      yield* 邀请(id, LI)

      const response = yield* post(EXPERT, GOV_REMOVE(id), { userId: GANG.id })
      expect(response.status).toBe(200)

      const 剩下 = yield* Effect.promise(() => 库成员(id))
      expect(剩下.map((member) => member.userId).sort()).toEqual([OWNER.id, LI.id].sort())
    }),
  )

  it.live("撤销创建人 ⇒ 409，且库里一个字没变（兜底 ≠ 撤掉 owner）", () =>
    Effect.gen(function* () {
      const id = yield* 建项目("撤 owner 测试")
      yield* 邀请(id, GANG)
      const 之前 = yield* Effect.promise(() => 库成员(id))

      const response = yield* post(EXPERT, GOV_REMOVE(id), { userId: OWNER.id })
      expect(response.status).toBe(409)
      expect((yield* json(ErrorResponse, response)).error).toContain("创建人")

      expect(yield* Effect.promise(() => 库成员(id))).toEqual(之前)
    }),
  )

  it.live("目标不在名单里 ⇒ 404；已归档项目 ⇒ 409（名单冻结）", () =>
    Effect.gen(function* () {
      const id = yield* 建项目("撤销边界测试")
      yield* 邀请(id, GANG)

      expect((yield* post(EXPERT, GOV_REMOVE(id), { userId: LI.id })).status).toBe(404)

      if (!pg) throw new Error("真库没起来")
      yield* Effect.promise(() =>
        pg!.db.execute(sql`
          insert into auth.project_archive (project_id, archived, archived_at)
          values (${id}, true, 1700000001)
        `),
      )
      expect((yield* post(EXPERT, GOV_REMOVE(id), { userId: GANG.id })).status).toBe(409)
      expect((yield* Effect.promise(() => 库成员(id))).length).toBe(2)
    }),
  )
})

describe("T008 · 兜底归档", () => {
  it.live("归档 ⇒ 每个成员各进自己的前缀、沙箱删空、标记最后落（列表随之变已归档）", () =>
    Effect.gen(function* () {
      const id = yield* 建项目("兜底归档目标")
      yield* 邀请(id, GANG)
      yield* 邀请(id, LI)
      放文件(OWNER, id, "报告.md", "# 创建人那份")
      放文件(GANG, id, "话单.csv", "13800000000,2026-10-01")
      放文件(LI, id, "资金.xlsx", "账户A,1000")

      const response = yield* post(EXPERT, GOV_ARCHIVE(id))
      expect(response.status).toBe(200)
      expect((yield* json(ArchiveResponse, response)).archived).toBe(true)

      // 谁的东西进了谁的前缀——每个成员那三个文件逐键全等。
      // ⚠️ 滤掉 `.git/`：建项目时沙箱里就有那个目录（`git init` 的产物，实测 19 个文件），
      // 它属于「用户平时就有的东西」，归档当然要一起传；要钉的是**文件进了谁的前缀**。
      const 键 = 上传键(id)
      expect(键.filter((key) => !key.includes("/.git/")).sort()).toEqual(
        [`${GANG.id}/${id}/话单.csv`, `${LI.id}/${id}/资金.xlsx`, `${OWNER.id}/${id}/报告.md`].sort(),
      )
      // 没有共享前缀、也没有串到别人的目录：每个键都落在**某个成员自己**的 `{userId}/{projectId}/` 下。
      expect(键.every((key) => [OWNER, GANG, LI].some((谁) => key.startsWith(`${谁.id}/${id}/`)))).toBe(true)

      expect(existsSync(沙箱目录(OWNER, id))).toBe(false)
      expect(existsSync(沙箱目录(GANG, id))).toBe(false)
      expect(existsSync(沙箱目录(LI, id))).toBe(false)
      expect(yield* Effect.promise(() => 库归档(id))).toBe(true)

      const body = yield* json(ListResponse, yield* get(EXPERT, GOV))
      expect(body.projects.find((row) => row.id === id)?.archived).toBe(true)
    }),
  )

  it.live("第二个成员上传失败 ⇒ 第一个成员的沙箱还在，且项目没被标成已归档（次序不变量）", () =>
    Effect.gen(function* () {
      const id = yield* 建项目("归档失败次序")
      yield* 邀请(id, GANG)
      yield* 邀请(id, LI)
      放文件(OWNER, id, "甲.md", "甲")
      放文件(GANG, id, "乙.md", "乙")

      // 乙的第一个对象起失败：`backupAll` 按成员逐个传完，所以「前一半成功、后一半失败」由构造保证。
      s3.failOn(403, (request) => request.key.includes(`/${id}/`))
      try {
        expect((yield* post(EXPERT, GOV_ARCHIVE(id))).status).toBe(500)
      } finally {
        s3.failWith(undefined)
      }

      // ⚠️ 顺序判据：全员传完才开删 ⇒ 中途失败时**谁的沙箱都还在**。
      expect(existsSync(沙箱目录(OWNER, id))).toBe(true)
      expect(existsSync(沙箱目录(GANG, id))).toBe(true)
      expect(yield* Effect.promise(() => 库归档(id))).toBe(false)
    }),
  )

  it.live("已归档再归档 ⇒ 409；不存在的项目 ⇒ 404", () =>
    Effect.gen(function* () {
      const id = yield* 建项目("重复归档")
      yield* 邀请(id, GANG)
      if (!pg) throw new Error("真库没起来")
      yield* Effect.promise(() =>
        pg!.db.execute(sql`
          insert into auth.project_archive (project_id, archived, archived_at)
          values (${id}, true, 1700000002)
        `),
      )
      expect((yield* post(EXPERT, GOV_ARCHIVE(id))).status).toBe(409)
      expect((yield* post(EXPERT, GOV_ARCHIVE("00000000-0000-4000-8000-000000000001"))).status).toBe(404)
    }),
  )
})
