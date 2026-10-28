import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * Task 2（2026-10-28）· `GET /openhive/project/tree` = **一次请求交回整棵树**。
 *
 * ## 它替掉的那条链，以及为什么必须替
 *
 * 原本前端 `openhive-files.ts` 的 `listProjectFiles` 是**一个目录一条 `GET /file`**：真栈实测
 * 单趟 46–72ms，测试1027 那个项目 370 个目录 ⇒ 光排队就 17–27 秒（前端后来加了并发上限 8 才勉强
 * 能用）。本端点把整条链收成**一趟**，遍历规则（顺序、空目录补自己、ignored、隐藏根）整组迁到
 * `project-tree-scan.ts` 并用 15 条纯函数用例钉住（Task 1）。
 *
 * ## 这一层测的是**接线**，不是遍历规则
 *
 * 顺序 / 截断那类判据在 `openhive-project-tree-scan.test.ts`（Task 1），本文件只钉三件事：
 * ① 真目录真读出来、**形状与顺序与前端 walk 逐字相同**；
 * ② **没有项目通道 ⇒ 400**（形状判据把「沙箱根」挡在门外，否则交回的是**跨项目的一棵树**）；
 * ③ `.gitignore` 在这一层**真的生效**（文件名过滤走 `ignore`，与上游 `/file` 同一份规则）。
 *
 * ## 目录从哪来：**不由客户端说了算**
 *
 * `?directory=` 到这一层已经被 `projectLocationLayer` 的 `rewriteRequest` 改写成
 * `{沙箱根}/{本人 id}/{projectId}`（探针实测：带项目头时确实是这个形状，不带时停在沙箱根）。本端点
 * **不自己拼目录**、也不信客户端的原值——判据在 `project-tree.ts` 里，与
 * `middleware/project-location.ts` 的 `projectIdOfSessionDirectory` **同形**。
 *
 * ⚠️ **「第一段等于本人 id」那半句本文件测不到**（与 `projectIdOfSessionDirectory` 同一条不可达线：
 * 目录只有锚定层与项目定位层两个来源、都在本人沙箱里）。如实记成缺口，**不写一条假装覆盖它的用例**
 * （`LEARNINGS #002-02`）。
 *
 * ## 夹具整段抄自兄弟出口（`LEARNINGS #004-12`）
 *
 * 真 auth 库 ＋ `startProductionDb` ＋ 签发令牌的 `as()` ＋ 裸 SQL 种 `project` / `project_ext`：
 * 抄自 `openhive-file-ops.test.ts` / `openhive-project-directory.test.ts`，**只换判据点**。
 * 自己发明一遍就是把那些隐性约定（`OPENHIVE_DATA_ROOT` 只能走 `process.env`、口令要像一次真部署
 * 那样配、身份走 Cookie 名）再踩一遍。
 *
 * ## 项目目录是**真 git 仓库**（不是假 `.git` 目录）
 *
 * 隔离规则读的是 `location.project.directory`，而它由 `Project.resolve` 给出：**不是仓库**时
 * 退回 `path.parse(input).root`（盘符根）⇒ `.gitignore` 会去 `D:\.gitignore` 找，第三组会红成
 * 「忽略规则怎么不生效」——红在夹具上而不是被测对象上。生产建项目也无条件 `git init`
 * （`project.ts` 第 ② 步），所以这是**按生产常态种**（`LEARNINGS #006-11`）。
 *
 * ## 已知不覆盖
 *
 * - 形状判据里「第一段等于本人 id」（见上）；
 * - **500 那条分支**（某层目录读失败 ⇒ `{ error: "读取文件树失败" }`）没写用例：要在进程内造出
 *   「某一层读失败」只能靠权限 / 句柄故障，本机造不稳定；
 * - **截断**（`truncated`）不在本层测：上限是 5 万条，造 5 万个文件不现实；规则由 Task 1 的用例钉住，
 *   本层只断言正常项目 `truncated === false`。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
}

/**
 * 客户端报「当前项目」的通道。
 *
 * ⚠️ 字面量**不是**生产常量的副本：本文件刻意不 import `middleware/project-location.ts` 的
 * `PROJECT_HEADER`——import 过来就变成「生产改什么测试跟着改什么」，改名也测不出来
 * （`LEARNINGS #003-05` 的假镜像）。
 */
const PROJECT_HEADER = "x-openhive-project"

/**
 * 出口路径。**字面量**——它是客户端契约（前端那条薄客户端也写字面量），改名必红。
 */
const 出口 = "/openhive/project/tree"

/** 顺序组那个项目：`a.txt` ＋ 空目录 ＋ `子\b.txt`。 */
const ALPHA = "prj_alpha_0001"
/** 忽略规则组那个项目（与 ALPHA 分开：``.gitignore` 一旦种进同一个目录，顺序组的逐字断言就变了）。 */
const IGNORED = "prj_ignored_0002"

const SANDBOX = realpathSync.native(mkdtempSync(path.join(tmpdir(), "openhive-project-tree-")))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/** 某人的沙箱根 = `join(OPENHIVE_WORKSPACE_ROOT, 本人 id)`（测试不创建它，只往下面建项目）。 */
const sandboxOf = (subject: TokenSubject) => path.join(WORKSPACE_ROOT, subject.id)

/** 某个项目的目录（= 中间件拼出来的那个 `join(沙箱根, projectId)`）。 */
const 项目目录 = (subject: TokenSubject, projectId: string) => path.join(sandboxOf(subject), projectId)

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（原因见 `tenant-db-isolation.test.ts` 上那条
 * 长注释：`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，不是 Effect 的 `Config` 服务）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/**
 * 真 auth 库（文件级夹具）：门开着时中间件每请求都要读一次 `auth.project_archive`
 * （「已归档 ⇒ 拒」那道门），读不到表就 500。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
}

const realApp = (env: Record<string, string | undefined>) => {
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

/** 身份那个 cookie 的 `名=值`（**不含头名那一层**）。 */
const sessionCookie = (value: string) => `${UserIdentity.COOKIE_NAME}=${value}`

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/**
 * 读 JSON 体。
 *
 * ⚠️ 这里刻意解成 `unknown`（不是具体的 `Schema.Struct`）：RED 态要的是「体里根本没有 `paths`」
 * 这种**直白的对象 diff**，而不是一句解码器报错。断言本身就是判据。
 */
const 体 = (response: Response) =>
  Effect.map(Effect.promise(() => response.json()), (body: unknown) => Schema.decodeUnknownSync(Schema.Unknown)(body))

/**
 * 以某人的身份发一个请求（照 `openhive-project-directory.test.ts` 的 `as()`）。
 * `project` 给了就带项目头；不给 ⇒ **整条项目通道缺席**（第二条用例要的就是这个）。
 */
const as = (subject: TokenSubject, url: string, project?: string) =>
  Effect.gen(function* () {
    const headers = new Headers()
    headers.set("Cookie", sessionCookie(yield* token(subject)))
    if (project !== undefined) headers.set(PROJECT_HEADER, project)
    return yield* openApp(url, { headers })
  })

/** 某个用户的库文件（建库钩子建的那个）。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/**
 * 造一个「项目已存在」的用户：先用 `GET /openhive/project`（**不带头、不依赖会话链**）触发建库钩子，
 * 再裸 SQL 补 `project` ＋ `project_ext` 两行。
 *
 * ⚠️ 两步都不能省：手搓 `CREATE TABLE` 与生产 schema 迟早不同形；`project` 行是
 * `project_ext.project_id` 外键的父行；时间列必须显式给（drizzle 的 `.$default()` 是运行时默认值，
 * 裸 SQL 绕不过去）。理由逐条见 `openhive-file-ops.test.ts` 的 `种项目`。
 */
const 种项目 = (subject: TokenSubject, projectId: string) =>
  Effect.gen(function* () {
    yield* as(subject, "/openhive/project")
    const db = new Sqlite(userDb(subject.id))
    try {
      db.run(
        "INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, '[]', 1700000000000, 1700000000000)",
        [projectId, 项目目录(subject, projectId)],
      )
      db.run(
        "INSERT OR IGNORE INTO project_ext (project_id, type, project_type, shared_directory, last_accessed_at) VALUES (?, 'private', '单案', NULL, 1700000000000)",
        [projectId],
      )
    } finally {
      db.close()
    }
  })

/**
 * 摆一个**真 git 仓库**作为项目目录（理由见文件头「项目目录是真 git 仓库」）。
 * 已存在时 `git init` 是幂等的，重复调无害。
 */
function 摆项目目录(subject: TokenSubject, projectId: string) {
  const 目录 = 项目目录(subject, projectId)
  mkdirSync(目录, { recursive: true })
  execFileSync("git", ["init", "--quiet"], { cwd: 目录, stdio: "ignore" })
  return 目录
}

describe("GET /openhive/project/tree · 一次请求交回整棵树", () => {
  /**
   * **主判据**：真目录 ⇒ 整棵树的路径清单，逐字等于前端 walk 的产出口径。
   *
   * 期望顺序**不是**字母序，是上游 `FileSystem.list` 的顺序（**目录在前、文件在后**，各自按
   * `localeCompare`）叠上 `扫树` 的规则（文件就地收、目录钻进去回来再补、空目录补自己）：
   * `空目录\` → `子\b.txt` → `a.txt`。`/?path=` 的实测体与本期望同一来源（探针记过），
   * 改期望前先去打一发 `/file?path=`，别凭感觉调。
   *
   * `truncated === false` 同一条断言里：正常项目必须明确说「没截断」，不能靠键缺席让人猜。
   */
  it.live(
    "整棵树：路径清单逐字相同（目录在前、空目录补自己）、truncated=false",
    () =>
      Effect.gen(function* () {
        yield* 种项目(ALICE, ALPHA)
        const 目录 = 摆项目目录(ALICE, ALPHA)
        mkdirSync(path.join(目录, "子"), { recursive: true })
        mkdirSync(path.join(目录, "空目录"), { recursive: true })
        writeFileSync(path.join(目录, "a.txt"), "甲的正文")
        writeFileSync(path.join(目录, "子", "b.txt"), "乙的正文")

        const response = yield* as(ALICE, 出口, ALPHA)
        expect(response.status).toBe(200)

        expect(yield* 体(response)).toEqual({ paths: ["空目录\\", "子\\b.txt", "a.txt"], truncated: false })
      }),
    30_000,
  )

  /**
   * **没有项目通道 ⇒ 400**，且**一条路径都不给**。
   *
   * 这一条今天恰好成立、也恰好是要挡的那种错：没有项目通道时 `projectLocationLayer` **不改写**，
   * `?directory=` 停在锚定层写的**沙箱根** `{根}/{本人 id}`——相对根只有 **1 段**，形状判据挡下它。
   * 没有这条判据的话，这个请求会 200 并交回**跨项目的一棵大树**（这个人所有项目都在沙箱根底下），
   * 错的、而且看着正常。
   *
   * 「一条路径都不给」与状态码是两条判据（`LEARNINGS #004-09`）：只钉状态码的话，一个
   * 「先读树、再回 400」的实现照样绿——而它已经在跨项目读了。
   */
  it.live(
    "没有项目上下文：400「没有项目上下文」，且体里没有 paths",
    () =>
      Effect.gen(function* () {
        yield* 种项目(ALICE, ALPHA)
        摆项目目录(ALICE, ALPHA)

        const response = yield* as(ALICE, 出口)

        expect(yield* 体(response)).toEqual({ error: "没有项目上下文" })
        expect(response.status).toBe(400)
      }),
    30_000,
  )

  /**
   * **`.gitignore` 在这一层真的生效**。
   *
   * 忽略规则不是 `扫树` 的事（它是纯函数，只认喂进来的 `ignored` 位）——读规则、算 `ignored`
   * 都在接线层。接线层漏掉这一半的话，整个清单把 `node_modules` / `dist` 一起交回来：不报错、
   * 不变红，只是树长得不像用户在编辑器里看到的那样。
   *
   * 断言写两半（`LEARNINGS #004-08`）：被忽略的**不在**，没被忽略的**在**——只写前半句的话，
   * 一个「什么都忽略」的实现照样绿。
   */
  it.live(
    ".gitignore 里的 ignored.txt 不进清单、没被忽略的照常在",
    () =>
      Effect.gen(function* () {
        yield* 种项目(ALICE, IGNORED)
        const 目录 = 摆项目目录(ALICE, IGNORED)
        writeFileSync(path.join(目录, ".gitignore"), "ignored.txt\n")
        writeFileSync(path.join(目录, "ignored.txt"), "不该出现")
        writeFileSync(path.join(目录, "kept.txt"), "该出现")

        const response = yield* as(ALICE, 出口, IGNORED)
        expect(response.status).toBe(200)

        const body = yield* 体(response)
        expect(body).toEqual({ paths: [".gitignore", "kept.txt"], truncated: false })
      }),
    30_000,
  )
})
