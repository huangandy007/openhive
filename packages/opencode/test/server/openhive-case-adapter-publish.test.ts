import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { addMember } from "@opencode-ai/auth/project-member"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 016 T002 · M10 识别卡校验的两个接线点：治理台发布闸 与 项目启用闸。
 *
 * 判据不只看状态码：坏包必须**状态没变、目录没搬**（发布）／**启用行没写**（启用），
 * 且响应体逐条列出 `problems`（`code = ingest_gate_failed`）。
 *
 * 校验规则本身只在 `packages/asset-service/src/ingest-gate.test.ts` 里钉；本文件证明
 * 「两个出口真的调用了那一份」——包好坏用最小夹具构造，不重复规则。
 */

const it = testEffect(Layer.empty)

const SECRET = "d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6"

const 管理员: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440030",
  policeNo: "930001",
  name: "管理员",
  isAdmin: true,
}
const 属主: TokenSubject = {
  id: "660e8400-e29b-41d4-a716-446655440031",
  policeNo: "930002",
  name: "项目属主",
  isAdmin: false,
}

/** 客户端契约：写字面量，不 import 生产常量（`#003-05`）。 */
const GOV = "/openhive/governance/assets"
const transitionUrl = (id: string) => `${GOV}/${id}/transition`
const ENABLE = "/openhive/project/assets/enable"

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-ingest-wiring-"))
const ASSETS_ROOT = join(SANDBOX, "assets")
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")
const DATA_ROOT = join(SANDBOX, "data")

const restoreEnv = restorePoint({
  OPENHIVE_ASSETS_ROOT: ASSETS_ROOT,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD,
  PG_POOL_MAX: "1",
})
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

afterAll(restoreEnv)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {
    // Windows 上 PG / SQLite 句柄可能仍被持有；清理失败不该变成测试失败（同既有出口用例）。
  }
})

const 项目 = "proj_ingest_gate_wiring"

const IDS = {
  /** 待技术发布，`pending/` 里是**坏包**（converter 缺 convert.ts）。 */
  badPublish: "asset_ingest_bad_publish",
  /** 待技术发布，`pending/` 里是合法包（对照：不能把好包一起拦）。 */
  goodPublish: "asset_ingest_good_publish",
  /** 迭代中，`pending/` 里是坏包（`publish_iteration` 同样被拦）。 */
  badIteration: "asset_ingest_bad_iteration",
  /** 已发布，共享目录里是坏包（启用闸）。 */
  badEnable: "asset_ingest_bad_enable",
  /** 已发布，共享目录里是合法包（启用对照）。 */
  goodEnable: "asset_ingest_good_enable",
  /** 待技术发布，合法包 + 非空 attributeKeys（词表注入的端到端证据）。 */
  goodVocabPublish: "asset_ingest_good_vocab",
  /** 待技术发布，attributeKeys 含词表外键。 */
  badVocabPublish: "asset_ingest_bad_vocab",
  /** 已发布，两份包 adapter id 相同（启用侧唯一性）。 */
  dupEnableA: "asset_ingest_dup_enable_a",
  dupEnableB: "asset_ingest_dup_enable_b",
  /** 已启用但操作者看不见（别的部门）的包；adapter id 与下面那份相同。 */
  hiddenOccupied: "asset_ingest_hidden_occupied",
  /** 可见的一份，adapter id 与隐藏那份相同（A11：占位不看可见性）。 */
  visibleDup: "asset_ingest_visible_dup",
} as const

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "status">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  summary: "",
  precautions: "",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: 属主.id,
  ownerName: 属主.name,
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
  iterationNote: "",
  iterationWorkspace: null,
  ...over,
})

function 写文件(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
}

/** 合法 converter 包（字段最小但齐全）。 */
function 写好包(dir: string, id: string, 技能名: string, 属性键: string[] = []) {
  mkdirSync(join(dir, "test"), { recursive: true })
  写文件(join(dir, "SKILL.md"), `---\nname: ${技能名}\ndescription: 测试用\n---\n`)
  写文件(join(dir, "convert.ts"), "// 转换器\n")
  写文件(
    join(dir, "adapter.json"),
    JSON.stringify({
      id,
      name: 技能名,
      version: "1.0.0",
      kind: "converter",
      materialType: "资金",
      attributeKeys: 属性键,
      match: { requiredHeaders: ["交易时间"], optionalHeaders: [], priority: 100 },
      admission: { checks: ["金额可解析"], thresholds: { 金额可解析: 0.99, 其余: 1 } },
      entry: { command: "bun run convert.ts", input: "xlsx", output: "json" },
      output: { file: "result.json" },
    }),
  )
}

/** 坏包：converter 缺 `convert.ts`（四件套缺件）。 */
function 写坏包(dir: string, id: string, 技能名: string) {
  mkdirSync(join(dir, "test"), { recursive: true })
  写文件(join(dir, "SKILL.md"), `---\nname: ${技能名}\ndescription: 测试用\n---\n`)
  写文件(
    join(dir, "adapter.json"),
    JSON.stringify({
      id,
      name: 技能名,
      version: "1.0.0",
      kind: "converter",
      materialType: "资金",
      attributeKeys: [],
      match: { requiredHeaders: ["交易时间"], optionalHeaders: [], priority: 100 },
      admission: { checks: ["金额可解析"], thresholds: { 金额可解析: 0.99, 其余: 1 } },
      entry: { command: "bun run convert.ts", input: "xlsx", output: "json" },
      output: { file: "result.json" },
    }),
  )
}

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [管理员, 属主]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${管理员.id}, 'gov-system-admin')`)
  await addMember(pg.db, { projectId: 项目, userId: 属主.id, role: "owner", timeCreated: 1_000 })

  await insertAsset(pg.db, 资产({ id: IDS.badPublish, name: "坏包发布", status: "pending_tech" }))
  await insertAsset(pg.db, 资产({ id: IDS.goodPublish, name: "好包发布", status: "pending_tech" }))
  await insertAsset(pg.db, 资产({ id: IDS.badIteration, name: "坏包迭代", status: "iterating" }))
  await insertAsset(pg.db, 资产({ id: IDS.badEnable, name: "坏包启用", status: "published", publishedAt: 900 }))
  await insertAsset(pg.db, 资产({ id: IDS.goodEnable, name: "好包启用", status: "published", publishedAt: 900 }))
  await insertAsset(pg.db, 资产({ id: IDS.goodVocabPublish, name: "词表好包发布", status: "pending_tech" }))
  await insertAsset(pg.db, 资产({ id: IDS.badVocabPublish, name: "词表坏包发布", status: "pending_tech" }))
  await insertAsset(pg.db, 资产({ id: IDS.dupEnableA, name: "重复包甲", status: "published", publishedAt: 900 }))
  await insertAsset(pg.db, 资产({ id: IDS.dupEnableB, name: "重复包乙", status: "published", publishedAt: 900 }))
  // A11：操作者（属主）看不见的「别的部门」资产，已直接启用；adapter id 与后面那份相同。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.hiddenOccupied,
      name: "隐藏占用包",
      status: "published",
      publishedAt: 900,
      ownerId: 管理员.id,
      ownerName: 管理员.name,
      visibility: "department",
      department: "别的部门",
    }),
  )
  await insertAsset(pg.db, 资产({ id: IDS.visibleDup, name: "可见重复包", status: "published", publishedAt: 900 }))
  // 直接写启用行：走启用出口会因 `canReadAsset` 403（看不见就启不了），那正是本用例要绕开的前提。
  await pg.db.execute(sql`
    insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
    values (${项目}, ${IDS.hiddenOccupied}, ${管理员.id}, 1)
  `)

  写坏包(join(ASSETS_ROOT, "pending", IDS.badPublish), "bad-publish", "坏包发布")
  写好包(join(ASSETS_ROOT, "pending", IDS.goodPublish), "good-publish", "好包发布")
  写坏包(join(ASSETS_ROOT, "pending", IDS.badIteration), "bad-iteration", "坏包迭代")
  写坏包(join(ASSETS_ROOT, "global", "skills", IDS.badEnable), "bad-enable", "坏包启用")
  写好包(join(ASSETS_ROOT, "global", "skills", IDS.goodEnable), "good-enable", "好包启用")
  写好包(join(ASSETS_ROOT, "pending", IDS.goodVocabPublish), "vocab-good", "词表好包发布", ["对方:开户行"])
  写好包(join(ASSETS_ROOT, "pending", IDS.badVocabPublish), "vocab-bad", "词表坏包发布", ["对方:不存在键"])
  写好包(join(ASSETS_ROOT, "global", "skills", IDS.dupEnableA), "dup-adapter", "重复包甲")
  写好包(join(ASSETS_ROOT, "global", "skills", IDS.dupEnableB), "dup-adapter", "重复包乙")
  写好包(join(ASSETS_ROOT, "dept", "别的部门", "skills", IDS.hiddenOccupied), "hidden-adapter", "隐藏占用包")
  写好包(join(ASSETS_ROOT, "global", "skills", IDS.visibleDup), "hidden-adapter", "可见重复包")
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_ASSETS_ROOT: ASSETS_ROOT,
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

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* Effect.promise(() => signToken(subject, SECRET))}`)
    return yield* openApp(url, { ...init, headers })
  })

const post = (subject: TokenSubject, url: string, body: unknown) =>
  as(subject, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const 校验失败响应 = Schema.Struct({
  error: Schema.String,
  code: Schema.String,
  problems: Schema.Array(Schema.String),
})
const 流转响应 = Schema.Struct({ asset: Schema.Struct({ status: Schema.String }) })
const 启用响应 = Schema.Struct({ enabled: Schema.Array(Schema.String) })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

async function 库状态(id: string): Promise<string> {
  if (!pg) throw new Error("真库没起来")
  const [row] = rowsOf(await pg.db.execute(sql`select status from auth.asset where id = ${id}`))
  if (!row) throw new Error(`资产不存在：${id}`)
  return String(row.status)
}

describe("016 T002 · 发布闸（治理台）", () => {
  it.live("坏包首次发布 ⇒ 409 ingest_gate_failed，problems 列出缺件，状态与目录都不变", () =>
    Effect.gen(function* () {
      const response = yield* post(管理员, transitionUrl(IDS.badPublish), { action: "publish_tech" })
      expect(response.status).toBe(409)
      const body = yield* json(校验失败响应, response)
      expect(body.code).toBe("ingest_gate_failed")
      expect(body.problems.some((项) => 项.includes("convert"))).toBe(true)
      expect(yield* Effect.promise(() => 库状态(IDS.badPublish))).toBe("pending_tech")
      expect(existsSync(join(ASSETS_ROOT, "global", "skills", IDS.badPublish))).toBe(false)
    }),
  )

  it.live("合法包首次发布 ⇒ 200（对照：闸不能把好包一起拦）", () =>
    Effect.gen(function* () {
      const response = yield* post(管理员, transitionUrl(IDS.goodPublish), { action: "publish_tech" })
      expect(response.status).toBe(200)
      expect((yield* json(流转响应, response)).asset.status).toBe("published")
      expect(yield* Effect.promise(() => 库状态(IDS.goodPublish))).toBe("published")
    }),
  )

  it.live("坏包迭代发布 ⇒ 409 ingest_gate_failed，仍是 iterating", () =>
    Effect.gen(function* () {
      const response = yield* post(管理员, transitionUrl(IDS.badIteration), { action: "publish_iteration" })
      expect(response.status).toBe(409)
      const body = yield* json(校验失败响应, response)
      expect(body.code).toBe("ingest_gate_failed")
      expect(body.problems.some((项) => 项.includes("convert"))).toBe(true)
      expect(yield* Effect.promise(() => 库状态(IDS.badIteration))).toBe("iterating")
    }),
  )

  it.live("F3a. 非空 attributeKeys 的合法包 ⇒ 200（词表注入端到端）", () =>
    Effect.gen(function* () {
      const response = yield* post(管理员, transitionUrl(IDS.goodVocabPublish), { action: "publish_tech" })
      expect(response.status).toBe(200)
      expect((yield* json(流转响应, response)).asset.status).toBe("published")
      expect(yield* Effect.promise(() => 库状态(IDS.goodVocabPublish))).toBe("published")
    }),
  )

  it.live("F3b. attributeKeys 含词表外键 ⇒ 409，problems 指出该键", () =>
    Effect.gen(function* () {
      const response = yield* post(管理员, transitionUrl(IDS.badVocabPublish), { action: "publish_tech" })
      expect(response.status).toBe(409)
      const body = yield* json(校验失败响应, response)
      expect(body.code).toBe("ingest_gate_failed")
      expect(body.problems.some((项) => 项.includes("对方:不存在键"))).toBe(true)
      expect(yield* Effect.promise(() => 库状态(IDS.badVocabPublish))).toBe("pending_tech")
    }),
  )
})

describe("016 T002 · 启用闸（项目）", () => {
  it.live("坏包启用 ⇒ 409 ingest_gate_failed，problems 列出缺件，启用行不写", () =>
    Effect.gen(function* () {
      const response = yield* post(属主, ENABLE, { projectId: 项目, assetId: IDS.badEnable })
      expect(response.status).toBe(409)
      const body = yield* json(校验失败响应, response)
      expect(body.code).toBe("ingest_gate_failed")
      expect(body.problems.some((项) => 项.includes("convert"))).toBe(true)
      if (!pg) throw new Error("真库没起来")
      const rows = yield* Effect.promise(async () =>
        rowsOf(
          await pg!.db.execute(sql`
            select 1 from auth.project_asset_enablement
             where project_id = ${项目} and asset_id = ${IDS.badEnable}
          `),
        ),
      )
      expect(rows.length).toBe(0)
    }),
  )

  it.live("合法包启用 ⇒ 200，启用集合含该 id（对照）", () =>
    Effect.gen(function* () {
      const response = yield* post(属主, ENABLE, { projectId: 项目, assetId: IDS.goodEnable })
      expect(response.status).toBe(200)
      expect((yield* json(启用响应, response)).enabled).toContain(IDS.goodEnable)
    }),
  )

  it.live("F3c. 同 adapter id 的第二份包 ⇒ 409（已占用 id 唯一性）", () =>
    Effect.gen(function* () {
      const 甲 = yield* post(属主, ENABLE, { projectId: 项目, assetId: IDS.dupEnableA })
      expect(甲.status).toBe(200)

      const 乙 = yield* post(属主, ENABLE, { projectId: 项目, assetId: IDS.dupEnableB })
      expect(乙.status).toBe(409)
      const body = yield* json(校验失败响应, 乙)
      expect(body.code).toBe("ingest_gate_failed")
      expect(body.problems.some((项) => 项.includes("dup-adapter"))).toBe(true)
    }),
  )

  it.live("F3d. 已启用但操作者看不见的包也占 adapter id ⇒ 409（A11）", () =>
    Effect.gen(function* () {
      // 隐藏包（别的部门）已直接写进启用行；操作者读不到它，但它的 adapter id 仍被项目占用。
      // 不过滤可见性 ⇒ 第二份同 id 包进来会让内核里出现两个同 id 适配器。
      const 响应 = yield* post(属主, ENABLE, { projectId: 项目, assetId: IDS.visibleDup })
      expect(响应.status).toBe(409)
      const body = yield* json(校验失败响应, 响应)
      expect(body.code).toBe("ingest_gate_failed")
      expect(body.problems.some((项) => 项.includes("hidden-adapter"))).toBe(true)

      if (!pg) throw new Error("真库没起来")
      const 行们 = yield* Effect.promise(async () =>
        rowsOf(
          await pg!.db.execute(sql`
            select 1 from auth.project_asset_enablement
             where project_id = ${项目} and asset_id = ${IDS.visibleDup}
          `),
        ),
      )
      expect(行们.length).toBe(0)
    }),
  )
})
