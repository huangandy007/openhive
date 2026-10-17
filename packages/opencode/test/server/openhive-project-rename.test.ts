import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
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
 * 2026-10-16 · **项目改名出口**（`POST /openhive/project/rename`）。
 *
 * ## 这条钉的为什么是「两处」
 *
 * 名字存在两处（spec §4.1）：每用户 SQLite 的 `project.name`（**owner 读的那份**）与
 * PG `auth.project_meta.name`（**成员读的那份**）。只写一处 ⇒「我改了，同事看到的还是旧的」，
 * 而且**不报错、不变红**——`handleList` 里 owner 读本地、成员读 PG（`ownEntries` 的
 * `named.get` 与影子行的 `meta.get` 兜底），
 * 两个读者各读各的，谁都不会发现另一半没变。
 *
 * 所以本文件的主判据是**两条**：① 本地那一份变了；② PG 那一份变了。
 * 「只钉其中一条」是本文件最该防的事——两条各钉一份写入动作，任何一条缺了都会红。
 *
 * ## 与 `openhive-project-archive.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入，整套约法照抄、只换判据点。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
/** 有身份、不是任何项目的成员——「非创建人 ⇒ 403」那条要用他。 */
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/** 出口路径（**客户端契约**，写**字面量**、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const RENAME_PATH = "/openhive/project/rename"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-rename-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/** ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`）。 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/** 改名不碰 MinIO ⇒ 这份 env **刻意不含**任何 `OPENHIVE_MINIO_*`（越少越稳）。 */
const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
}

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const asWho = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

const as = (url: string, init: RequestInit = {}) => asWho(ALICE, url, init)

/** 读 JSON 体。**先断内容类型**——「未挂载」在本应用里落进 SPA 兜底、回 200 ＋ `text/html`。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 列表项的**线上形状**（逐字写字段名当契约钉死——`#003-05`）。 */
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
  lastAccessedAt: Schema.Number,
  archived: Schema.optional(Schema.Boolean),
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // `project_member.user_id` 有外键 ⇒ 会被加进项目的身份必须先有 `auth.user` 行。
  for (const subject of [ALICE, BOB]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
      on conflict (id) do nothing
    `)
  }
})

afterAll(async () => {
  await pg?.stop()
})

/**
 * **PG 那份名字**（`auth.project_meta.name`）——**直接打 `pg.db`**，不经 `projectMetaOf`。
 * oracle 一律不经过被测对象（同族测试的约法）。
 */
const pg名字 = (projectId: string) =>
  Effect.promise(async () => {
    const result = await pg?.db.execute(sql`select name from auth.project_meta where project_id = ${projectId}`)
    return rowsOf(result)[0]?.name
  })

/** 归档行（直接打 `pg.db`，不经 `archiveStatesOf`）——**变异 C 的观测面**（`archived` 缺键默认值）。 */
const 归档行 = (projectId: string) =>
  Effect.promise(async () => {
    const result = await pg?.db.execute(
      sql`select archived, archived_at from auth.project_archive where project_id = ${projectId}`,
    )
    return rowsOf(result)[0]
  })

/** 建一个项目、回它的 id。 */
const 建项目 = (name: string) =>
  Effect.gen(function* () {
    const created = yield* as(PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: "private" }),
    })
    return yield* json(Entry, created)
  })

describe("T-rename · 项目改名（spec §10 判据 1）", () => {
  it.live(
    "改名后**两处名字都变了**：清单里读到的是新名，且 PG `project_meta.name` 也是新名",
    () =>
      Effect.gen(function* () {
        const project = yield* 建项目("8·17专案")
        // 前置条件**真的成立**（`#002-02`：先证明机制活着，再钉被测那条）——
        // 否则「两处都变了」在一个压根没建的 id 上也可能看着绿。
        expect(project.name).toBe("8·17专案")
        expect(yield* pg名字(project.id)).toBe("8·17专案")

        const response = yield* as(RENAME_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, name: "8·17专案（改）" }),
        })

        // ① 被测属性之一：出口自述改名成功（与归档 / 找回 / 删除**同款**的「自述一个布尔」）。
        expect(response.status).toBe(200)
        const body = yield* json(
          Schema.Struct({ projectId: Schema.String, name: Schema.String, renamed: Schema.Boolean }),
          response,
        )
        expect(body.renamed).toBe(true)
        expect(body.name).toBe("8·17专案（改）")

        // ② 被测属性之二：**本地那份**（owner 读的）——经公开出口读，不直查 SQLite。
        const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
        expect(listed.find((entry) => entry.id === project.id)?.name).toBe("8·17专案（改）")

        // ③ 被测属性之三：**PG 那份**（成员读的）。这一条与 ② 是**两个**写入点，
        //    少写一处时另一处照样绿——所以必须分成两条断言。
        expect(yield* pg名字(project.id)).toBe("8·17专案（改）")
      }),
    30_000,
  )

  /**
   * **变异 C 的守护者**（2026-10-16 提前加）：**新项目没有归档行** ⇒ `archived` 缺键 ⇒ 默认
   * `false`（`?? false`），所以**能改名**。把它改成 `?? true` 时，这个项目会被判成「已归档」⇒
   * `decide` 的归档分支只放行 restore / delete ⇒ 改名 403，这条就红。
   *
   * 与判据 1 的差别：判据 1 的前置只钉了「`project_meta` 有名字行」，没钉「库里**没有归档行**」。
   * 这一条把「没有归档行」写成一个**显式前置**——它才是 `?? false` 这个默认值唯一的观测面。
   */
  it.live("新项目（库里没有归档行 ⇒ 未归档）也能改名：`archived` 缺键默认 `false` 不是 `true`", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("刚建出来就能改名")
      expect(yield* 归档行(project.id)).toBeUndefined()

      const response = yield* as(RENAME_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, name: "刚建出来就能改名（改）" }),
      })
      expect(response.status).toBe(200)
      const body = yield* json(Schema.Struct({ renamed: Schema.Boolean }), response)
      expect(body.renamed).toBe(true)
      // 名字**真的**改了（钉结果，不只钉出口的自述）。
      expect(yield* pg名字(project.id)).toBe("刚建出来就能改名（改）")
    }),
    30_000,
  )

  /**
   * **判据 2**：改名后**被邀成员那一侧读到的也是新名字**。
   *
   * 与上一条的差别是**读的人不同**：上一条 ② 读的是 owner 那条本地来源，这条读的是
   * 成员那条 PG 来源（`handleList` 对非自己建的项目走 `projectMetaOf`）。**两条来源不同
   * 才是 spec §4.1 那条推论的全部内容**——只钉 owner 那侧，「同事看到的还是旧的」照样绿。
   */
  it.live(
    "改名后**被邀成员**在清单里读到的也是新名字（钉结果，不只钉写入动作）",
    () =>
      Effect.gen(function* () {
        const project = yield* 建项目("乙也能看的项目")

        // 邀 BOB 进来：两段身份各发一次（档案链的入口与名字落点是两件事）。
        const 邀 = yield* as(`/openhive/project/member/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, policeNo: BOB.policeNo }),
        })
        expect(邀.status, "邀请应当成功——这条用例的前提是 BOB 真的成了成员").toBe(200)

        // 前置：**改名之前**，成员读到的是旧名（否则「读到新名」在一个本来就对的地方也可能绿）。
        const 改前 = yield* json(Schema.Array(Entry), yield* asWho(BOB, PROJECT_PATH))
        expect(改前.find((entry) => entry.id === project.id)?.name).toBe("乙也能看的项目")

        const 改名 = yield* as(RENAME_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, name: "乙也能看的项目（改）" }),
        })
        expect(改名.status).toBe(200)

        // ⚠️ **判据**：成员那一侧读到的也是新名。
        const 改后 = yield* json(Schema.Array(Entry), yield* asWho(BOB, PROJECT_PATH))
        expect(改后.find((entry) => entry.id === project.id)?.name).toBe("乙也能看的项目（改）")
      }),
    30_000,
  )

  /**
   * **判据 5 的改名那半**：非创建人 ⇒ 403。
   *
   * ⚠️ 观测面：BOB 有身份、**不是这个项目的成员**（不邀他）。这是唯一能问出「是不是
   * 授权拦下的」的组合——若邀请他进来，「403」与「member 本来就不许改名」两种情况**看起来一样绿**。
   */
  it.live("非创建人 ⇒ 403（说得清）", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("不是乙的项目")

      const response = yield* asWho(BOB, RENAME_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, name: "乙给改的名字" }),
      })

      expect(response.status).toBe(403)
      expect((yield* json(Schema.Struct({ error: Schema.String }), response)).error.length).toBeGreaterThan(0)
    }),
    30_000,
  )

  /**
   * **变异 D 的守护者（单起一条）**：非创建人改名被拒 ⇒ **零副作用**。
   *
   * 与上一条分开的理由见 `#004-09`：被拒与「门在副作用之前」是两条独立判据。并进上一条时
   * `#005-46` 会把变异 D 的红停在**排在前面**的状态码断言（500 vs 403），副作用那两句根本
   * 跑不到——所以这里只钉副作用、不在这里断状态码（状态码由上一条钉）。
   *
   * ⚠️ 变异 D 实测：判定挪到写库之后，`updateProjectName`（PG）**先**落笔，随后本地写
   * `deps.project.update` 在 BOB 的每用户 SQLite 里查不到那一行 ⇒ `NotFoundError` ⇒ 500。
   * 所以这条用例在变异 D 下红在 **PG 那句**（名字被改了）；本地那句在变异 D 下**恒绿**——
   * BOB 的 fiber 只能写 BOB 自己的库，物理上碰不到 owner 那份本地名字（每用户隔离）。
   * 本地那句在这里是**契约断言**，不是变异可证的性质——如实记，不谎称它被变异证过。
   */
  it.live("非创建人改名被拒 ⇒ 两处名字一个字没动（零副作用，单起一条钉 PG 那份）", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("不是乙的项目-零副作用")

      yield* asWho(BOB, RENAME_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, name: "乙给改的名字" }),
      })

      // 两条分开断（本地 / PG）——两个写入点。PG 那句有牙（变异 D 红它），本地那句是契约。
      expect(yield* pg名字(project.id)).toBe("不是乙的项目-零副作用")
      const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
      expect(listed.find((entry) => entry.id === project.id)?.name).toBe("不是乙的项目-零副作用")
    }),
    30_000,
  )

  it.live("空名字 / 全空白名字 ⇒ 400，且名字一个字没动", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("不该被清空")

      for (const 空 of ["", "   ", "\t\n"]) {
        const response = yield* as(RENAME_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, name: 空 }),
        })
        expect(response.status, `名字 ${JSON.stringify(空)} 应当被拒`).toBe(400)
      }

      const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
      expect(listed.find((entry) => entry.id === project.id)?.name).toBe("不该被清空")
    }),
    30_000,
  )
})
