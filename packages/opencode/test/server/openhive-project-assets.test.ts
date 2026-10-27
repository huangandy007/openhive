import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { assetsRoot, publishDirectory } from "@opencode-ai/asset-service/storage"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { addMember } from "@opencode-ai/auth/project-member"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { projectDirectory } from "@opencode-ai/auth/workspace"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * Task 3 · **项目级 skill 启用/停用出口**（2026-10-27）。
 *
 * ## 它要钉的三件事（brief 的范围）
 *
 * ① 库里的关系行（`auth.project_asset_enablement`）；
 * ② 项目目录里的链接（`<项目>/.opencode/skill/<assetId>` → 共享发布目录）；
 * ③ HTTP 出口的授权与错误码（成员 / 非成员 / 不存在 / 非已发布 / 个人空间）。
 *
 * ## harness 与 `openhive-project.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 真 PG、每用户 SQLite、cookie 身份、`HttpApiApp.routes` 造真应用。只换判据点。
 *
 * ## ⚠️ 「未挂载」在本应用里**不是 404**——状态码证明不了路由挂上了
 *
 * 未匹配的路径被 SPA 兜底成 `200 text/html`（探针实测见 `openhive-project.test.ts` 文件头）。
 * ⇒ 本文件的 `json()` 把判据前移到 **`Content-Type`**：挂上的出口回 `application/json`，
 * 没挂的回 `text/html`。状态码仍然断，但它是**伴随信号**不是判据（`LEARNINGS #004-14`）。
 *
 * ## oracle 不经过被测对象（`LEARNINGS #002-02`）
 *
 * 库里那行用裸 SQL 读（不经 HTTP、不经 `enablementOf`）；链接用 `readlinkSync` /
 * `readFileSync` 直接看文件系统；只有「出口回了什么」读 HTTP 响应。
 *
 * ## 沙箱根要过 `WorkspaceRoot.canonicalRoot`
 *
 * `AnchorWorkspace.Config.root` 在配置解析时归一化（win32 展开 8.3 短名）。测试断言
 * 「链接落在哪个目录」时若拿原样的 `tmpdir()` 拼路径，本机短名（`ADMINI~1`）会让两侧
 * **同一个物理目录两种写法** ⇒ 红得像产品坏。两侧都从同一个 `canonicalRoot` 派生。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板。 */
const SECRET = "c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6"

const 我: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440020",
  policeNo: "020611",
  name: "我",
  isAdmin: false,
}
const 别人: TokenSubject = {
  id: "660e8400-e29b-41d4-a716-446655440021",
  policeNo: "020612",
  name: "别人",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`LEARNINGS #003-05`）。 */
const STATE = "/openhive/project/assets"
const ENABLE = "/openhive/project/assets/enable"
const DISABLE = "/openhive/project/assets/disable"

const 我的项目 = "proj_enable_1"
const 别人的项目 = "proj_enable_2"
const 已发布资产 = "asset_skill_ok"
const 草稿资产 = "asset_skill_draft"
const 个人资产 = "asset_skill_personal"

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-project-assets-"))
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")
/** 服务端实际用的沙箱根（`AnchorWorkspace.Config.root` 归一化后的形态）。 */
const 沙箱根 = WorkspaceRoot.canonicalRoot(WORKSPACE_ROOT)
const ASSETS_ROOT = join(SANDBOX, "assets")
const DATA_ROOT = join(SANDBOX, "data")

const restoreEnv = restorePoint({
  OPENHIVE_ASSETS_ROOT: ASSETS_ROOT,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD,
})

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

afterAll(restoreEnv)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 PG / SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

/** 资产夹具：只写本用例在意的字段，其余给生产形状的默认值。 */
const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "status">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: 我.id,
  ownerName: 我.name,
  department: "甲部门",
  visibility: "global",
  version: 1,
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: 900,
  archivedAt: null,
  ...over,
})

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  // `project_member.user_id` 有外键 ⇒ 两个身份要先有 `auth.user` 行。
  for (const subject of [我, 别人]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', '甲部门', 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
  }

  // 成员：我是「我的项目」owner；别人是「别人的项目」owner。
  await addMember(pg.db, { projectId: 我的项目, userId: 我.id, role: "owner", timeCreated: 1_000 })
  await addMember(pg.db, { projectId: 别人的项目, userId: 别人.id, role: "owner", timeCreated: 1_000 })

  // 已发布 / 全局 ⇒ 可启用。
  await insertAsset(pg.db, 资产({ id: 已发布资产, name: "资金分析", status: "published", visibility: "global" }))
  // 草稿 + 个人 ⇒ 先撞状态门（`asset_not_published`）。
  await insertAsset(pg.db, 资产({ id: 草稿资产, name: "草稿 skill", status: "draft", visibility: "personal" }))
  // 已发布 + 个人 ⇒ 撞「个人空间没有共享发布目录」那道门（`personal_not_linkable`）。
  await insertAsset(pg.db, 资产({ id: 个人资产, name: "个人 skill", status: "published", visibility: "personal" }))

  // 已发布目录：链接的落点必须真的存在（junction 的硬要求）。
  const 目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 已发布资产)
  mkdirSync(目标, { recursive: true })
  writeFileSync(join(目标, "SKILL.md"), "---\nname: 资金分析\ndescription: 测试\n---\n\n正文\n", "utf8")
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

const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 以某人的身份发一个请求（身份走 cookie，不手搓头）。 */
const as = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject !== null) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const post = (subject: TokenSubject, url: string, body: unknown) =>
  as(subject, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/** 读 JSON 体：**先断内容类型**（见文件头「未挂载不是 404」）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const text = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(text))
  })

const 状态 = Schema.Struct({
  enabled: Schema.Array(Schema.String),
  enabledCount: Schema.Number,
  limit: Schema.Number,
})
const 错误 = Schema.Struct({ error: Schema.String, code: Schema.optional(Schema.String) })

/** `<项目目录>/.opencode/skill/<assetId>` —— 判链接的落点（字面量拼，不经生产常量）。 */
const 链接路径 = (projectId: string, assetId: string) =>
  join(projectDirectory(沙箱根, 我.id, projectId), ".opencode", "skill", assetId)

describe("项目级 skill 启用（真应用）", () => {
  it.live(
    "未挂载不是 404：挂上的出口回 application/json",
    () =>
      Effect.gen(function* () {
        const response = yield* as(我, `${STATE}?projectId=${我的项目}`)
        // 被测属性在 `json()` 里：Content-Type 不是 application/json 就当场红。
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body).toEqual({ enabled: [], enabledCount: 0, limit: 20 })
      }),
    30_000,
  )

  it.live(
    "启用：库里一行 + 项目目录里一条链接 + 返回计数 1",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 已发布资产 })
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body).toEqual({ enabled: [已发布资产], enabledCount: 1, limit: 20 })

        // oracle 不经过被测对象：裸 SQL 读库。
        const rows = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select asset_id, enabled_by from auth.project_asset_enablement where project_id = ${我的项目}
            `),
          ),
        )
        expect(rows).toEqual([{ asset_id: 已发布资产, enabled_by: 我.id }])

        // 链接真的在项目目录里，且指向 published 目录。
        const 链接 = 链接路径(我的项目, 已发布资产)
        const 目标 = publishDirectory(assetsRoot(process.env), "skill", { visibility: "global" }, 已发布资产)
        expect(readlinkSync(链接)).toBe(目标)
        expect(readFileSync(join(链接, "SKILL.md"), "utf8")).toContain("资金分析")

        // 审计：启用是治理动作，写一行 `asset.enable`（裸 SQL 读表，不经被测对象）。
        const 审计 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select action, board, target_id, result from auth.audit_event
               where action = 'asset.enable' and target_id = ${已发布资产}
            `),
          ),
        )
        expect(审计).toEqual([
          { action: "asset.enable", board: "asset-governance", target_id: 已发布资产, result: "ok" },
        ])
      }),
    30_000,
  )

  it.live(
    "重复启用是幂等的（200，仍是 1）",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 已发布资产 })
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body.enabledCount).toBe(1)
      }),
    30_000,
  )

  it.live(
    "停用：库行没了、链接没了",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, DISABLE, { projectId: 我的项目, assetId: 已发布资产 })
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body).toEqual({ enabled: [], enabledCount: 0, limit: 20 })

        const 剩余 = rowsOf(
          yield* Effect.promise(() =>
            pg!.db.execute(sql`
              select asset_id from auth.project_asset_enablement where project_id = ${我的项目}
            `),
          ),
        )
        expect(剩余).toEqual([])
        expect(existsSync(链接路径(我的项目, 已发布资产))).toBe(false)
      }),
    30_000,
  )

  it.live(
    "历史遗留的个人空间启用行：GET 不 500、也不建链接（对账跳过 personal）",
    () =>
      Effect.gen(function* () {
        // 夹具直接写库（输入）：模拟「启用入口拦住之前落下的行」或「直接写库」。
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
            values (${我的项目}, ${个人资产}, ${我.id}, 2)
          `),
        )

        const response = yield* as(我, `${STATE}?projectId=${我的项目}`)
        // 被测属性在 `json()` 里：对账碰到 personal 行若不算 target（`skillLinkTarget` 抛），
        // 这条会是 500 而不是 application/json。
        const body = yield* json(状态, response)
        expect(response.status).toBe(200)
        expect(body.enabled).toEqual([个人资产])
        expect(existsSync(链接路径(我的项目, 个人资产))).toBe(false)

        // 清掉夹具，别把状态漏给后面的用例。
        yield* Effect.promise(() =>
          pg!.db.execute(sql`
            delete from auth.project_asset_enablement
             where project_id = ${我的项目} and asset_id = ${个人资产}
          `),
        )
      }),
    30_000,
  )

  it.live(
    "草稿不可启用：409 asset_not_published",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 草稿资产 })
        expect(response.status).toBe(409)
        expect((yield* json(错误, response)).code).toBe("asset_not_published")
      }),
    30_000,
  )

  it.live(
    "个人空间的已发布 skill 也不可启用：409 personal_not_linkable（个人资产没有共享发布目录）",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: 个人资产 })
        expect(response.status).toBe(409)
        expect((yield* json(错误, response)).code).toBe("personal_not_linkable")
      }),
    30_000,
  )

  it.live(
    "不是成员：403",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 别人的项目, assetId: 已发布资产 })
        expect(response.status).toBe(403)
        expect((yield* json(错误, response)).code).toBe("forbidden")
      }),
    30_000,
  )

  it.live(
    "不存在的资产：404",
    () =>
      Effect.gen(function* () {
        const response = yield* post(我, ENABLE, { projectId: 我的项目, assetId: "asset_nope" })
        expect(response.status).toBe(404)
        expect((yield* json(错误, response)).code).toBe("not_found")
      }),
    30_000,
  )

  it.live(
    "缺身份：401 空体",
    () =>
      Effect.gen(function* () {
        const response = yield* as(null, `${STATE}?projectId=${我的项目}`)
        expect(response.status).toBe(401)
      }),
    30_000,
  )
})
