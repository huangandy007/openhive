import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { assetById, insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 迭代出口（2026-11-01，设计 §6）：`POST /openhive/assets/:id/iteration[/submit|/abort]`。
 *
 * 三条判据在这里钉死：
 * 1. **授权在读体之前**（`LEARNINGS #004-09`）：非作者递畸形 JSON 也拿 403，不是 400；
 * 2. 别人的 `projectId` ⇒ 400，且**一个目录都没建**（不给人「这个项目 id 存在吗」的探针）；
 * 3. 状态不对 ⇒ 409，元数据一个字不动。
 *
 * ⚠️ 与 `openhive-asset-content.test.ts` 逐行对齐 app 构造方式（同一个出口，改路由要一起跑）：
 * 身份靠 `OPENHIVE_REQUIRE_USER_ID=1` ＋ `AUTH_JWT_SECRET`，`handler` 要带 `HttpApiApp.context`。
 *
 * ⚠️ 每条用例用**不同的调用者 / 资产**：`沙箱根/<userId>` 是跨用例共享的磁盘事实，
 * 用同一个 id 断言「没有建目录」会被前一条用例建出来的目录打成假红（`#005-34`）。
 */

const it = testEffect(Layer.empty)
const SECRET = "i1t2e3r4a5t6i7o8n9t0e1s2t3s4e5c6r7e8t9"

const 我: TokenSubject = { id: "u-iter-me", policeNo: "950001", name: "甲作者", isAdmin: false }
const 同事: TokenSubject = { id: "u-iter-mate", policeNo: "950002", name: "乙同事", isAdmin: false }
/** 以下三个各供一条**失败面**用例：断言它自己的沙箱目录不存在，互不干扰。 */
const 外人: TokenSubject = { id: "u-iter-foreign", policeNo: "950003", name: "丙外人", isAdmin: false }
const 空说明: TokenSubject = { id: "u-iter-empty", policeNo: "950004", name: "丁空说明", isAdmin: false }
const 草稿主: TokenSubject = { id: "u-iter-draft", policeNo: "950005", name: "戊草稿", isAdmin: false }
/** 自己库里给**别人的 PG 项目**留过一行 `project_ext`（历史残留）：不能凭这行越权。 */
const 陈旧: TokenSubject = { id: "u-iter-stale", policeNo: "950006", name: "己陈旧", isAdmin: false }

const 我的项目 = "p-iter-mine"
const 同事的项目 = "p-iter-mate"
/** 多租户改造前建的老项目：只在属主自己的 SQLite 里有行，PG 名册不认识（`#010-06`）。 */
const 我的老项目 = "p-iter-legacy"

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "ownerId" | "ownerName" | "status">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  summary: "",
  precautions: "",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  department: "经侦支队",
  visibility: "global",
  version: 2,
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: 1_500,
  archivedAt: null,
  iterationNote: "",
  iterationWorkspace: null,
  ...over,
})

const IDS = {
  start: "asset-iter-start",
  badJson: "asset-iter-badjson",
  foreign: "asset-iter-foreign",
  draft: "asset-iter-draft",
  emptyNote: "asset-iter-empty-note",
  submitOk: "asset-iter-submit-ok",
  submitMissing: "asset-iter-submit-missing",
  abort: "asset-iter-abort",
  mateAbort: "asset-iter-mate-abort",
  legacy: "asset-iter-legacy",
  stale: "asset-iter-stale",
  // 提交审核（Task 4，2026-11-01）：每条用例一套新 id，不复用上面的资产（`#005-34`）。
  subDraft: "asset-sub-draft",
  subAgain: "asset-sub-again",
  subOther: "asset-sub-other",
  subMissingDraft: "asset-sub-missing-draft",
  subPublished: "asset-sub-published",
  subMcp: "asset-sub-mcp",
  /** 属主自己建的 MCP 草稿：端点自己的类型门必须拒它（不靠服务层）。 */
  subMyMcp: "asset-sub-my-mcp",
} as const

const 资产根 = mkdtempSync(join(tmpdir(), "openhive-iter-assets-"))
/** 配置里的原值。本机 `%TEMP%` 是 8.3 短名（`…\ADMINI~1\…`）——出口必须自己规范化。 */
const 原始沙箱根 = mkdtempSync(join(tmpdir(), "openhive-iter-ws-"))
/**
 * 回包应有的形状：与内核锚定侧同一个 `WorkspaceRoot.canonicalRoot`（长名）。
 *
 * ⚠️ **不能拿 `原始沙箱根` 当期望**：在本机它和规范根逐字不同（8.3 短名 vs 长名），
 * 这正是 `#006-23`「resolve≠同形」的形状；出口若漏掉规范化，下面所有 `workspace`
 * 断言都会红（变异 #11 实证）。
 */
const 沙箱根 = WorkspaceRoot.canonicalRoot(原始沙箱根)
const 数据根 = mkdtempSync(join(tmpdir(), "openhive-iter-data-"))
const restoreAssetsRoot = restorePoint({ OPENHIVE_ASSETS_ROOT: 资产根 })
const restoreWorkspaceRoot = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 原始沙箱根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
/** PGlite 夹具把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的（同治理测试）。 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

/**
 * 每用户库的根：请求期 `Database.Service` 从 `Global`/`Flag` 之外的这条环境变量取。
 * 必须**在 `realApp()` 构造之前**写好（app 的 layer 构造期就会定下根）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = 数据根

afterAll(restoreAssetsRoot)
afterAll(restoreWorkspaceRoot)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
})
afterAll(() => rmSync(资产根, { recursive: true, force: true }))
afterAll(() => rmSync(原始沙箱根, { recursive: true, force: true }))
afterAll(() => {
  try {
    rmSync(数据根, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/** 共享根里造一份「线上已发布」的 skill。 */
function 造线上(id: string) {
  const directory = join(资产根, "global", "skills", id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "SKILL.md"), "v1", "utf8")
}

/** 草稿副本（`<资产根>/draft/<id>`）：提交审核唯一的内容来源（Task 2，设计 §4.5）。 */
function 造草稿副本(id: string) {
  const directory = join(资产根, "draft", id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "SKILL.md"), "草稿内容", "utf8")
}

/** 工作副本（迭代中作者手里那份）。 */
function 造工作副本(id: string) {
  const directory = join(沙箱根, 我.id, 我的项目, ".openhive", "iterations", id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "SKILL.md"), "v2", "utf8")
  return directory
}

const 工作副本相对 = (id: string) => `${我.id}/${我的项目}/.openhive/iterations/${id}`
const 工作副本绝对 = (id: string) => join(沙箱根, 我.id, 我的项目, ".openhive", "iterations", id)

/**
 * 往**某个用户自己的**每用户库里种一行「他建过这个项目」——老项目在 PG 名册里的唯一替代证据。
 *
 * 走 `DatabaseRouter`（与请求期**同一条**建库 / 迁移路径），不自己拉 `bun:sqlite`：`project_ext`
 * 是建库钩子建的（`#004-12`）。裸 SQL 只用来绕开 drizzle 的 `.$default()`。
 * `project` 行不能省：`project_ext.project_id` 有外键。
 */
const 种自建项目 = async (subject: TokenSubject, projectId: string) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const router = yield* DatabaseRouter.Service
        const db = (yield* router.forUser(subject.id)).db
        yield* db.run(
          sql`INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated)
              VALUES (${projectId}, ${`/tmp/${projectId}`}, '[]', 1700000000000, 1700000000000)`,
        )
        yield* db.run(
          sql`INSERT OR IGNORE INTO project_ext (project_id, type, project_type, shared_directory, last_accessed_at)
              VALUES (${projectId}, 'private', '单案', NULL, 1700000000000)`,
        )
      }),
    ).pipe(Effect.provide(DatabaseRouter.layer({ root: 数据根 }))),
  )
}

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [我, 同事, 外人, 空说明, 草稿主, 陈旧]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${我的项目}, ${我.id}, 'owner', 0),
           (${我的项目}, ${空说明.id}, 'member', 0),
           (${我的项目}, ${草稿主.id}, 'member', 0),
           (${同事的项目}, ${同事.id}, 'owner', 0)
  `)

  // 老项目（多租户改造前）：证据只在属主**自己**库的 `project_ext` 里；PG 里**故意不建**
  // `project_member` / `project_meta`——这正是 `#010-06` 描述的形态。
  await 种自建项目(我, 我的老项目)
  // 反向夹具：陈旧自己库里给同事的 **PG 已知项目**留过一行历史残留。回落有界：只要 PG
  // 认识这个项目，这行就不能当授权证据。
  await 种自建项目(陈旧, 同事的项目)

  // 成功面 / 失败面各用独立夹具，杜绝执行顺序依赖。
  await insertAsset(pg.db, 资产({ id: IDS.start, name: "发起成功", ownerId: 我.id, ownerName: 我.name, status: "published" }))
  造线上(IDS.start)

  await insertAsset(pg.db, 资产({ id: IDS.badJson, name: "畸形体", ownerId: 我.id, ownerName: 我.name, status: "published" }))

  await insertAsset(
    pg.db,
    资产({ id: IDS.foreign, name: "他人项目", ownerId: 外人.id, ownerName: 外人.name, status: "published" }),
  )
  造线上(IDS.foreign)

  await insertAsset(
    pg.db,
    资产({
      id: IDS.draft,
      name: "草稿不能迭代",
      ownerId: 草稿主.id,
      ownerName: 草稿主.name,
      status: "draft",
      version: 1,
      visibility: "personal",
      publishedAt: null,
    }),
  )

  await insertAsset(
    pg.db,
    资产({ id: IDS.emptyNote, name: "空说明", ownerId: 空说明.id, ownerName: 空说明.name, status: "published" }),
  )
  造线上(IDS.emptyNote)

  // 迭代中、工作副本在位：提交应成功。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.submitOk,
      name: "可提交",
      ownerId: 我.id,
      ownerName: 我.name,
      status: "iterating",
      version: 3,
      iterationNote: "补一条统计口径",
      iterationWorkspace: 工作副本相对(IDS.submitOk),
    }),
  )
  造工作副本(IDS.submitOk)

  // 迭代中、但工作副本不存在：提交必须 409，且不落半截 pending。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.submitMissing,
      name: "工作副本没了",
      ownerId: 我.id,
      ownerName: 我.name,
      status: "iterating",
      version: 3,
      iterationNote: "补一条统计口径",
      iterationWorkspace: 工作副本相对(IDS.submitMissing),
    }),
  )

  // 迭代中、pending 已有内容：放弃应删掉它。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.abort,
      name: "可放弃",
      ownerId: 我.id,
      ownerName: 我.name,
      status: "iterating",
      version: 3,
      iterationNote: "补一条统计口径",
      iterationWorkspace: 工作副本相对(IDS.abort),
    }),
  )
  造工作副本(IDS.abort)
  mkdirSync(join(资产根, "pending", IDS.abort), { recursive: true })
  writeFileSync(join(资产根, "pending", IDS.abort, "SKILL.md"), "v2", "utf8")

  // 别人（同事）的迭代中资产：非作者放弃必须 403。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.mateAbort,
      name: "别人的迭代",
      ownerId: 同事.id,
      ownerName: 同事.name,
      status: "iterating",
      version: 3,
      iterationWorkspace: `${同事.id}/${同事的项目}/.openhive/iterations/${IDS.mateAbort}`,
    }),
  )

  // 老项目里属主自己的资产：发起必须成功（只查 PG 会误判成「不属于你」）。
  await insertAsset(
    pg.db,
    资产({ id: IDS.legacy, name: "老项目资产", ownerId: 我.id, ownerName: 我.name, status: "published" }),
  )
  造线上(IDS.legacy)

  // 陈旧在**同事的 PG 项目**里发起：自己库里有残留 `project_ext` 行也不该放行。
  await insertAsset(
    pg.db,
    资产({ id: IDS.stale, name: "越权试探", ownerId: 陈旧.id, ownerName: 陈旧.name, status: "published" }),
  )
  造线上(IDS.stale)

  // 提交审核（Task 4）：草稿 / 审核中 / 别人的草稿 / 草稿副本缺失，各一条、各用新 id。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.subDraft,
      name: "可提交草稿",
      ownerId: 我.id,
      ownerName: 我.name,
      status: "draft",
      version: 1,
      visibility: "personal",
      publishedAt: null,
    }),
  )
  造草稿副本(IDS.subDraft)

  await insertAsset(
    pg.db,
    资产({
      id: IDS.subAgain,
      name: "已送审",
      ownerId: 我.id,
      ownerName: 我.name,
      status: "in_review",
      version: 2,
      visibility: "personal",
      publishedAt: null,
    }),
  )

  await insertAsset(
    pg.db,
    资产({
      id: IDS.subOther,
      name: "别人的草稿",
      ownerId: 同事.id,
      ownerName: 同事.name,
      status: "draft",
      version: 1,
      visibility: "personal",
      publishedAt: null,
    }),
  )
  造草稿副本(IDS.subOther)

  // 草稿行在、但 `<资产根>/draft/<id>` 不在：Task 2 的 `draft_content_missing`
  // 只有编译期穷尽 switch 守着，这里补它的**运行期**落点（必须 409）。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.subMissingDraft,
      name: "草稿副本没了",
      ownerId: 我.id,
      ownerName: 我.name,
      status: "draft",
      version: 1,
      visibility: "personal",
      publishedAt: null,
    }),
  )

  // 已发布：从没提交过（本轮 400 文案不能说「已经提交过了」）。
  await insertAsset(
    pg.db,
    资产({ id: IDS.subPublished, name: "已发布资产", ownerId: 我.id, ownerName: 我.name, status: "published" }),
  )

  // 别人的 MCP：提交者「我」没有写权，应得 403。批次 3 起类型门放行 MCP，403 由授权判据给出；
  // 「预检先于类型门」的次序改由 `openhive-assets-mcp-submit.test.ts` 的知识库用例钉住。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.subMcp,
      name: "别人的 MCP",
      type: "mcp",
      ownerId: 同事.id,
      ownerName: 同事.name,
      status: "draft",
      version: 1,
      visibility: "personal",
      publishedAt: null,
    }),
  )

  // 属主自己的 MCP 草稿：批次 3 起端点的类型门放行 MCP，提交应成功（下方用例）。
  await insertAsset(
    pg.db,
    资产({
      id: IDS.subMyMcp,
      name: "我的 MCP",
      type: "mcp",
      ownerId: 我.id,
      ownerName: 我.name,
      status: "draft",
      version: 1,
      visibility: "personal",
      publishedAt: null,
    }),
  )
})

const OPEN: Record<string, string | undefined> = { OPENHIVE_REQUIRE_USER_ID: "1", AUTH_JWT_SECRET: SECRET }

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() => Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)))
}

const openApp = realApp(OPEN)
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const 发起 = (subject: TokenSubject | null, assetId: string, body: unknown) =>
  发(subject, `/openhive/assets/${assetId}/iteration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

const 提交 = (subject: TokenSubject | null, assetId: string) =>
  发(subject, `/openhive/assets/${assetId}/iteration/submit`, { method: "POST" })

const 放弃 = (subject: TokenSubject | null, assetId: string) =>
  发(subject, `/openhive/assets/${assetId}/iteration/abort`, { method: "POST" })

const 读错误 = (response: Response) =>
  Effect.gen(function* () {
    const 体 = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }))(
      JSON.parse(yield* Effect.promise(() => response.text())),
    )
    return 体.error
  })

const 回包 = Schema.Struct({
  assetId: Schema.String,
  status: Schema.String,
  version: Schema.Number,
  workspace: Schema.optional(Schema.NullOr(Schema.String)),
})

/** 使用面列表（`GET /openhive/assets`）：只看本用例关心的两处。 */
const 列表回包 = Schema.Struct({
  assets: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })),
  writableIds: Schema.Array(Schema.String),
})

const 读行 = (id: string) => Effect.promise(() => assetById(pg!.db, id))

describe("迭代出口 · 成功面", () => {
  it.live("作者发起 ⇒ 200、回带绝对 workspace、落库正确；随后使用面列表仍能看到它（iterating）且 writableIds 含它", () =>
    Effect.gen(function* () {
      const response = yield* 发起(我, IDS.start, { note: "补一条统计口径", projectId: 我的项目 })
      expect(response.status).toBe(200)

      const 体 = Schema.decodeUnknownSync(回包)(JSON.parse(yield* Effect.promise(() => response.text())))
      expect(体.assetId).toBe(IDS.start)
      expect(体.status).toBe("iterating")
      expect(体.version).toBe(3)
      // 前端要把这个路径塞进给 AI 的指令里：必须是平台原生绝对路径（win32 反斜杠），
      // 且是**规范化后的根**——与内核锚定侧同形（`#006-23`；配置原值在本机是 8.3 短名）。
      expect(体.workspace).toBe(工作副本绝对(IDS.start))
      expect(existsSync(工作副本绝对(IDS.start))).toBe(true)
      expect(existsSync(join(资产根, "global", "skills", IDS.start, "SKILL.md"))).toBe(true)

      const 行 = yield* 读行(IDS.start)
      expect(行?.iterationNote).toBe("补一条统计口径")
      // 落库的是**相对沙箱根**那一段（`#010-04`：换根不用搬库）。
      expect(行?.iterationWorkspace).toBe(工作副本相对(IDS.start))

      // 后续这两条断言**故意放在本用例里**（`#005-34`）：它们要的是「刚发起完」这个状态，
      // 若另起一条用例来断言，就会依赖上一条用例的副作用——单跑 / `-t` 过滤 /
      // `--only-failures` 重跑时都会红。自己发起、自己断言，用例才与执行顺序无关。
      // 验的是「迭代中不再从浏览面消失」：旧实现把 status 写死成 published ⇒ 这一行整条
      // 不见 ⇒ 详情退回打开时的快照、作者也没有提交 / 放弃的入口，设计 §7 的「迭代中」
      // 两态一次都渲染不出来。
      const 列表响应 = yield* 发(我, "/openhive/assets?pageSize=100")
      expect(列表响应.status).toBe(200)
      const 列表体 = Schema.decodeUnknownSync(列表回包)(
        JSON.parse(yield* Effect.promise(() => 列表响应.text())),
      )

      const 列表行 = 列表体.assets.find((asset) => asset.id === IDS.start)
      expect(列表行?.status).toBe("iterating")
      // 作者有 write：前端据此显示「提交 / 放弃」。
      expect(列表体.writableIds).toContain(IDS.start)
    }),
  )

  it.live("老项目（只在属主自己库里有 project_ext）⇒ 属主发起成功，不误判成「不属于你」", () =>
    Effect.gen(function* () {
      // 夹具自证：「老」的含义是 PG 完全不认识它（`#010-06` 那 11/13 条的形态）。
      const 名册 = rowsOf(
        yield* Effect.promise(() =>
          pg!.db.execute(sql`select 1 from auth.project_member where project_id = ${我的老项目}`),
        ),
      )
      expect(名册).toHaveLength(0)
      const 项目元 = rowsOf(
        yield* Effect.promise(() => pg!.db.execute(sql`select 1 from auth.project_meta where project_id = ${我的老项目}`)),
      )
      expect(项目元).toHaveLength(0)

      const response = yield* 发起(我, IDS.legacy, { note: "老项目也补一条口径", projectId: 我的老项目 })
      expect(response.status).toBe(200)

      const 体 = Schema.decodeUnknownSync(回包)(JSON.parse(yield* Effect.promise(() => response.text())))
      expect(体.assetId).toBe(IDS.legacy)
      expect(体.status).toBe("iterating")
      // 工作副本按**老项目 id** 落，而不是退回别的项目目录。
      const 绝对 = join(沙箱根, 我.id, 我的老项目, ".openhive", "iterations", IDS.legacy)
      expect(体.workspace).toBe(绝对)
      expect(existsSync(绝对)).toBe(true)

      const 行 = yield* 读行(IDS.legacy)
      expect(行?.status).toBe("iterating")
      expect(行?.iterationWorkspace).toBe(`${我.id}/${我的老项目}/.openhive/iterations/${IDS.legacy}`)
    }),
  )

  it.live("作者提交 ⇒ 200，工作副本进 pending，版本不变（发起时已经 +1）", () =>
    Effect.gen(function* () {
      const response = yield* 提交(我, IDS.submitOk)
      expect(response.status).toBe(200)

      const 体 = Schema.decodeUnknownSync(回包)(JSON.parse(yield* Effect.promise(() => response.text())))
      expect(体.assetId).toBe(IDS.submitOk)
      expect(体.status).toBe("iterating")
      expect(体.version).toBe(3)
      // 提交不改变工作副本指向：它还在作者手里。
      expect(体.workspace).toBe(工作副本绝对(IDS.submitOk))

      expect(existsSync(join(资产根, "pending", IDS.submitOk, "SKILL.md"))).toBe(true)
      expect((yield* 读行(IDS.submitOk))?.status).toBe("iterating")
    }),
  )

  it.live("作者放弃 ⇒ 200，回到 published、版本回退、两列清空、pending 目录删除", () =>
    Effect.gen(function* () {
      const response = yield* 放弃(我, IDS.abort)
      expect(response.status).toBe(200)

      const 体 = Schema.decodeUnknownSync(回包)(JSON.parse(yield* Effect.promise(() => response.text())))
      expect(体.assetId).toBe(IDS.abort)
      expect(体.status).toBe("published")
      expect(体.version).toBe(2)
      // 放弃后没有工作副本可指——回 `null` 而不是编一个路径。
      expect(体.workspace).toBeNull()

      const 行 = yield* 读行(IDS.abort)
      expect(行?.status).toBe("published")
      expect(行?.version).toBe(2)
      expect(行?.iterationNote).toBe("")
      expect(行?.iterationWorkspace).toBeNull()
      expect(existsSync(join(资产根, "pending", IDS.abort))).toBe(false)
    }),
  )
})

describe("迭代出口 · 失败面", () => {
  it.live("无凭证 ⇒ 401", () =>
    Effect.gen(function* () {
      for (const 请求 of [发起(null, IDS.badJson, { note: "x", projectId: 我的项目 }), 提交(null, IDS.submitOk), 放弃(null, IDS.mateAbort)]) {
        expect((yield* 请求).status).toBe(401)
      }
    }),
  )

  it.live("非作者发起 ⇒ 403，且请求体根本没被读（畸形 JSON 也是 403，不是 400）", () =>
    Effect.gen(function* () {
      const response = yield* 发起(同事, IDS.badJson, "{ 这不是 JSON")
      // 403 不是 400：门在副作用（解析请求体）之前。若返回 400，说明有人把读体挪到了授权前面。
      expect(response.status).toBe(403)
      expect((yield* 读错误(response))).toContain("不能执行")
      expect((yield* 读行(IDS.badJson))?.status).toBe("published")
      // 授权在流转 + 建目录之前：这个人的沙箱里不该出现任何东西。
      expect(existsSync(join(沙箱根, 同事.id))).toBe(false)
    }),
  )

  it.live("非作者提交 / 放弃别人的迭代 ⇒ 403，状态与目录零副作用", () =>
    Effect.gen(function* () {
      const 提交响应 = yield* 提交(同事, IDS.submitOk)
      expect(提交响应.status).toBe(403)
      expect((yield* 读错误(提交响应))).toContain("不能执行")

      const 放弃响应 = yield* 放弃(我, IDS.mateAbort)
      expect(放弃响应.status).toBe(403)

      expect((yield* 读行(IDS.mateAbort))?.status).toBe("iterating")
      expect((yield* 读行(IDS.mateAbort))?.version).toBe(3)
    }),
  )

  it.live("资产不存在 ⇒ 404（存在性判在归属之前，不泄漏 403/400 差异），目录未建", () =>
    Effect.gen(function* () {
      // 用**不是任何资产属主**的外人：若「存在性」排在授权之后，这里会先拿 403；
      // 若排在读体之后，畸形体 / 空体会先拿 400。两者都会泄漏「这个 id 存不存在」之外的信息，
      // 也会把「资产不存在」这件事说成别的原因。
      const response = yield* 发起(外人, "asset-iter-does-not-exist", "{ 这不是 JSON")
      expect(response.status).toBe(404)

      const 说明 = yield* 读错误(response)
      expect(说明).toContain("资产不存在")
      expect(说明).not.toContain("不能执行")
      expect(说明).not.toContain("note")
      expect(说明).not.toContain("属于你")

      // 404 发生在 `transitionAsset()` / 建目录之前。
      expect(existsSync(join(沙箱根, 外人.id))).toBe(false)
      expect(existsSync(join(沙箱根, 外人.id, 我的项目, ".openhive"))).toBe(false)
    }),
  )

  it.live("别人的 projectId ⇒ 400，且没有建出任何目录（不是 404 探针）", () =>
    Effect.gen(function* () {
      // 同事的项目里没有外人的成员行；p-missing 更不存在。两者都必须是 400。
      for (const projectId of [同事的项目, "p-iter-missing"]) {
        const response = yield* 发起(外人, IDS.foreign, { note: "补一条口径", projectId })
        expect(response.status).toBe(400)
        expect((yield* 读错误(response))).toContain("不属于你")
      }
      expect(existsSync(join(沙箱根, 外人.id))).toBe(false)
      expect((yield* 读行(IDS.foreign))?.status).toBe("published")
    }),
  )

  it.live("PG 认识的项目 + 调用者不是成员 ⇒ 400（自己库里残留一行 project_ext 也不放宽）", () =>
    Effect.gen(function* () {
      // 夹具自证：同事是 `p-iter-mate` 的 PG 属主 ⇒ 项目是 PG 认识的；陈旧自己库里那行
      // `project_ext` 只是历史残留，不能当授权证据（回落**只**给 PG 完全不认识的项目）。
      const 名册 = rowsOf(
        yield* Effect.promise(() => pg!.db.execute(sql`select user_id from auth.project_member where project_id = ${同事的项目}`)),
      )
      expect(名册.map((行) => 行["user_id"])).toContain(同事.id)

      const response = yield* 发起(陈旧, IDS.stale, { note: "补一条口径", projectId: 同事的项目 })
      expect(response.status).toBe(400)
      expect((yield* 读错误(response))).toContain("不属于你")

      // 拒绝发生在 `transitionAsset()` 之前：一行元数据、一个目录都不该动。
      const 行 = yield* 读行(IDS.stale)
      expect(行?.status).toBe("published")
      expect(行?.iterationWorkspace).toBeNull()
      expect(existsSync(join(沙箱根, 陈旧.id))).toBe(false)
    }),
  )

  it.live("note 缺失 / 非字符串 / 空白 ⇒ 400，元数据未变、目录未建", () =>
    Effect.gen(function* () {
      const 缺 = yield* 发起(空说明, IDS.emptyNote, { projectId: 我的项目 })
      expect(缺.status).toBe(400)
      expect((yield* 读错误(缺))).toContain("note")

      const 类型错 = yield* 发起(空说明, IDS.emptyNote, { note: 123, projectId: 我的项目 })
      expect(类型错.status).toBe(400)
      expect((yield* 读错误(类型错))).toContain("note")

      // 空白说明是**服务层**的 `reason_required`（start_iteration 必填变更说明）⇒ 出口翻 400。
      const 空白 = yield* 发起(空说明, IDS.emptyNote, { note: "   ", projectId: 我的项目 })
      expect(空白.status).toBe(400)
      expect((yield* 读错误(空白))).toContain("变更说明")

      expect((yield* 读行(IDS.emptyNote))?.status).toBe("published")
      expect(existsSync(join(沙箱根, 空说明.id))).toBe(false)
    }),
  )

  it.live("状态不对（草稿不能发起迭代）⇒ 409，元数据未变、目录未建", () =>
    Effect.gen(function* () {
      const response = yield* 发起(草稿主, IDS.draft, { note: "补一条口径", projectId: 我的项目 })
      expect(response.status).toBe(409)

      const 行 = yield* 读行(IDS.draft)
      expect(行?.status).toBe("draft")
      expect(行?.version).toBe(1)
      expect(行?.iterationNote).toBe("")
      expect(行?.iterationWorkspace).toBeNull()
      expect(existsSync(join(沙箱根, 草稿主.id))).toBe(false)
    }),
  )

  it.live("提交时工作副本不存在 ⇒ 409，状态不回退、pending 不落半截", () =>
    Effect.gen(function* () {
      const response = yield* 提交(我, IDS.submitMissing)
      expect(response.status).toBe(409)
      expect((yield* 读错误(response))).toContain("工作副本不存在")

      expect((yield* 读行(IDS.submitMissing))?.status).toBe("iterating")
      expect((yield* 读行(IDS.submitMissing))?.version).toBe(3)
      expect(existsSync(join(资产根, "pending", IDS.submitMissing))).toBe(false)
    }),
  )
})

describe("POST /openhive/assets/:id/submit（2026-11-01）", () => {
  const 提交路径 = (id: string) => `/openhive/assets/${id}/submit`
  const 提交审核 = (subject: TokenSubject | null, assetId: string) =>
    发(subject, 提交路径(assetId), { method: "POST" })

  it.live("作者提交自己的草稿 ⇒ 200，状态变 in_review，pending 有内容", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, IDS.subDraft)
      expect(res.status).toBe(200)

      const 体 = Schema.decodeUnknownSync(
        Schema.Struct({ assetId: Schema.String, status: Schema.String, version: Schema.Number }),
      )(JSON.parse(yield* Effect.promise(() => res.text())))
      expect(体.assetId).toBe(IDS.subDraft)
      expect(体.status).toBe("in_review")
      // submit_review 不改版本号（只有发起 / 放弃迭代才动它）。
      expect(体.version).toBe(1)

      expect(existsSync(join(资产根, "pending", IDS.subDraft, "SKILL.md"))).toBe(true)
      expect((yield* 读行(IDS.subDraft))?.status).toBe("in_review")
    }),
  )

  it.live("已经提交过（in_review）⇒ 400，文案「已经提交过了」", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, IDS.subAgain)
      expect(res.status).toBe(400)
      // 设计 §4.4 / D7：文案要让作者看懂「已经提交过了」，不是状态机那串内部话。
      expect((yield* 读错误(res))).toContain("已经提交过了")
      // 拒绝发生在流转之前：状态与草稿副本都没动。
      expect((yield* 读行(IDS.subAgain))?.status).toBe("in_review")
      expect(existsSync(join(资产根, "pending", IDS.subAgain))).toBe(false)
    }),
  )

  it.live("不是草稿（已发布）⇒ 400，但文案不能说「已经提交过了」", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, IDS.subPublished)
      expect(res.status).toBe(400)

      const 说明 = yield* 读错误(res)
      expect(说明).toContain("当前状态不能提交审核")
      // published 从没提交过：D7 只授权「重复提交」这一种说「已经提交过了」。
      expect(说明).not.toContain("已经提交过了")
    }),
  )

  it.live("非作者提交 ⇒ 403", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, IDS.subOther)
      expect(res.status).toBe(403)
      expect((yield* 读错误(res))).toContain("不能执行")
      expect((yield* 读行(IDS.subOther))?.status).toBe("draft")
      expect(existsSync(join(资产根, "pending", IDS.subOther))).toBe(false)
    }),
  )

  // 非作者提交别人的 MCP ⇒ 403。批次 3 起类型门放行 MCP，403 由授权判据给出；
  // 「授权先于类型门」的次序不再由本条钉住（类型门对 MCP 不再拒绝），此处只守拒绝本身。
  it.live("非作者提交别人的 MCP ⇒ 403", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, IDS.subMcp)
      expect(res.status).toBe(403)
      expect((yield* 读错误(res))).toContain("不能执行")
    }),
  )

  // 批次 3：MCP 也走业务审核（设计 §3.1.4），属主提交自己的 MCP 草稿应成功。
  // 服务层对 MCP 不落文件，所以不需要草稿副本——提交只改状态。
  it.live("属主提交自己的 MCP 草稿 ⇒ 200，状态 in_review", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, IDS.subMyMcp)
      expect(res.status).toBe(200)
      expect((yield* 读行(IDS.subMyMcp))?.status).toBe("in_review")
      expect((yield* 读行(IDS.subMyMcp))?.version).toBe(1)
    }),
  )

  it.live("资产不存在 ⇒ 404", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, "asset-sub-does-not-exist")
      expect(res.status).toBe(404)
      expect((yield* 读错误(res))).toContain("资产不存在")
    }),
  )

  it.live("没登录 ⇒ 401", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(null, IDS.subDraft)
      expect(res.status).toBe(401)
    }),
  )

  // Task 2 把 `submit_review` 的源改成 `<资产根>/draft/<id>`；副本缺失抛 `draft_content_missing`。
  // 出口把它映射成 409 这件事此前只有编译期穷尽 switch 守着——这里补**运行期**落点。
  it.live("草稿副本不存在 ⇒ 409，状态不变、pending 不落半截", () =>
    Effect.gen(function* () {
      const res = yield* 提交审核(我, IDS.subMissingDraft)
      expect(res.status).toBe(409)
      expect((yield* 读错误(res))).toContain("草稿内容不存在")

      expect((yield* 读行(IDS.subMissingDraft))?.status).toBe("draft")
      expect((yield* 读行(IDS.subMissingDraft))?.version).toBe(1)
      expect(existsSync(join(资产根, "pending", IDS.subMissingDraft))).toBe(false)
    }),
  )
})
