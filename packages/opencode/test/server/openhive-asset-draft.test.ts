import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { assetById } from "@opencode-ai/asset-service/asset"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 入库出口（2026-11-01，设计 §4.4）：`POST /openhive/assets/draft`。
 *
 * 一条成功面 ＋ 三条失败面，各自钉一个判据：
 * 1. **成功** ⇒ 库里有行（`status: draft`），且 `<资产根>/draft/<id>` 有副本——`storage` 漏传
 *    会造出一个「永远提交不了」的草稿（提交审核只从 `/draft/<id>` 取内容）；
 * 2. `skillPath` 带 `../..` ⇒ 403，且 `<资产根>/draft` 一个目录都不多；
 * 3. 不是成员的项目 ⇒ **400 而不是 404**（404 会变成「这个项目 id 存在吗」的探针）；
 * 4. `skillPath` 字面在项目内、真身是项目外的链接 ⇒ 403（`#009-03`：只比字面路径会被
 *    junction / symlink 绕过）。第 2、4 条都断言「没有新增草稿目录」——拒绝必须发生在复制之前。
 *
 * ⚠️ 与 `openhive-asset-iteration.test.ts` 逐行对齐 app 构造方式（同一个出口家族）：
 * 身份靠 `OPENHIVE_REQUIRE_USER_ID=1` ＋ `AUTH_JWT_SECRET`，`handler` 要带 `HttpApiApp.context`。
 */

const it = testEffect(Layer.empty)
const SECRET = "d1r2a3f4t5p6o7s8t9a0b1c2d3e4f5g6h"

const 我: TokenSubject = { id: "u-draft-me", policeNo: "960001", name: "甲作者", isAdmin: false }
const 同事: TokenSubject = { id: "u-draft-mate", policeNo: "960002", name: "乙同事", isAdmin: false }

const 我的项目 = "p-draft-mine"
const 同事的项目 = "p-draft-mate"

const 资产根 = mkdtempSync(join(tmpdir(), "openhive-draft-assets-"))
/** 配置里的原值。本机 `%TEMP%` 是 8.3 短名——出口自己会过 `canonicalRoot`。 */
const 原始沙箱根 = mkdtempSync(join(tmpdir(), "openhive-draft-ws-"))
const 沙箱根 = WorkspaceRoot.canonicalRoot(原始沙箱根)
/** 项目外的目录：junction 的落点（用来证「字面在项目内、真身在外」必须被拒）。 */
const 项目外 = mkdtempSync(join(tmpdir(), "openhive-draft-outside-"))
const 数据根 = mkdtempSync(join(tmpdir(), "openhive-draft-data-"))
const restoreAssetsRoot = restorePoint({ OPENHIVE_ASSETS_ROOT: 资产根 })
const restoreWorkspaceRoot = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 原始沙箱根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
/** PGlite 夹具把多条连接汇进同一个 PG 会话，`bun-sql` 的语句缓存是连接级的（同治理测试）。 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

/**
 * 每用户库的根：请求期 `Database.Service` 从这里取。
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
afterAll(() => rmSync(项目外, { recursive: true, force: true }))
afterAll(() => {
  try {
    rmSync(数据根, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [我, 同事]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${我的项目}, ${我.id}, 'owner', 0),
           (${同事的项目}, ${同事.id}, 'owner', 0)
  `)
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

const 入库 = (subject: TokenSubject | null, body: unknown) =>
  发(subject, "/openhive/assets/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

/** `<资产根>/draft` 下的目录条数；目录还没建时算 0。 */
const 草稿目录数 = () => (existsSync(join(资产根, "draft")) ? readdirSync(join(资产根, "draft")).length : 0)

/** 回包契约：写字面量（`#003-05`），不 import 生产常量。 */
const 回包 = Schema.Struct({
  assetId: Schema.String,
  name: Schema.String,
  status: Schema.String,
  visibility: Schema.String,
})

const 请求体 = (over: Record<string, unknown> = {}) => ({
  projectId: 我的项目,
  skillPath: "my-skill",
  name: "我的技能",
  description: "测试用",
  category: "intelligence",
  visibility: "personal",
  ...over,
})

describe("POST /openhive/assets/draft（2026-11-01）", () => {
  it.live("项目成员把项目内的 skill 目录入库 ⇒ 200，库里有行、<资产根>/draft/<id> 有副本", () =>
    Effect.gen(function* () {
      // 项目目录写在 <沙箱根>/<userId>/<projectId>，目录里先放一份 SKILL.md
      const 源 = join(沙箱根, 我.id, 我的项目, "my-skill")
      mkdirSync(源, { recursive: true })
      writeFileSync(join(源, "SKILL.md"), "---\nname: my-skill\ndescription: 测试\n---\n", "utf8")

      const res = yield* 入库(我, 请求体())
      expect(res.status).toBe(200)
      // 先断内容类型：路由不存在时会落进前端回退页（200 + text/html），
      // 直接 res.json() 会变成解析错误，红不到「契约」那一步。
      expect(res.headers.get("content-type") ?? "").toContain("application/json")
      const body = Schema.decodeUnknownSync(回包)(yield* Effect.promise(() => res.json()))
      expect(body.status).toBe("draft")
      expect(body.name).toBe("我的技能")
      expect(body.visibility).toBe("personal")

      // 「库里有行」——回包之外独立读一次库。
      const 行 = yield* Effect.promise(() => assetById(pg!.db, body.assetId))
      expect(行?.status).toBe("draft")
      expect(行?.ownerId).toBe(我.id)

      // 提交审核只从 <资产根>/draft/<id> 取内容：storage 漏传的草稿永远提交不了。
      expect(existsSync(join(资产根, "draft", body.assetId, "SKILL.md"))).toBe(true)
    }))

  it.live("skillPath 带 ../.. ⇒ 403，且 <资产根>/draft 下不新增任何目录", () =>
    Effect.gen(function* () {
      const 前 = 草稿目录数()
      const res = yield* 入库(我, 请求体({ skillPath: "../../../etc", name: "越界", description: "x" }))
      expect(res.status).toBe(403)
      const 后 = 草稿目录数()
      expect(后).toBe(前)
    }))

  it.live("skillPath 用 .. 指向项目外**真实存在**的目录 ⇒ 403，且不新增草稿目录", () =>
    Effect.gen(function* () {
      // `../../../etc` 在本机多半不存在，第三层（realpath fail-closed）会顺手兜住它；
      // `..` 则是**真实存在**的项目外目录（调用者自己的沙箱根），只有字面那一层能拒——
      // 这条让「只比字面路径」的变异一眼可见（`#009-03`）。
      const 前 = 草稿目录数()
      const res = yield* 入库(我, 请求体({ skillPath: "..", name: "兄弟目录", description: "x" }))
      expect(res.status).toBe(403)
      expect(草稿目录数()).toBe(前)
    }))

  it.live("不是成员的项目 ⇒ 400（不是 404，404 会成为探测）", () =>
    Effect.gen(function* () {
      const res = yield* 入库(我, 请求体({ projectId: 同事的项目, skillPath: "x", name: "x", description: "x" }))
      expect(res.status).toBe(400)
    }))

  it.live("skillPath 字面在项目内、真身是项目外链接 ⇒ 403，且不新增草稿目录", () =>
    Effect.gen(function* () {
      // 项目里放一个指向项目外的 junction：字面路径在项目内，realpath 落在项目外。
      writeFileSync(join(项目外, "SKILL.md"), "---\nname: 外面\n---\n", "utf8")
      mkdirSync(join(沙箱根, 我.id, 我的项目), { recursive: true })
      symlinkSync(项目外, join(沙箱根, 我.id, 我的项目, "越界链接"), "junction")

      const 前 = 草稿目录数()
      const res = yield* 入库(我, 请求体({ skillPath: "越界链接", name: "链接", description: "x" }))
      expect(res.status).toBe(403)
      expect(草稿目录数()).toBe(前)
    }))
})
