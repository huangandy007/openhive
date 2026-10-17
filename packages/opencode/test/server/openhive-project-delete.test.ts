import { afterAll, beforeAll, describe, expect } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
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
 * 2026-10-16 · **项目删除出口**（`POST /openhive/project/delete`）。
 *
 * ## 这条钉的是「删干净了」与「留底是真留底」两件事，它们**方向相反**
 *
 * - **删干净**（判据 3/7）：项目从清单消失、盘上目录没了、共享 bare 仓库没了、
 *   MinIO 备份清空、PG 三表那些行没了。
 * - **留底**（判据 4）：**会话行仍在**、而且**读得出来**——这是「删除 ≠ 清空一切」的全部内容。
 *
 * ⚠️ **两个方向必须同时钉**：只钉前者，一个「把每用户库一并清空」的实现会全绿（而它删掉了
 * 民警的聊天记录）；只钉后者，「什么都没删」也会冒充成绿。
 *
 * ## 观测面
 *
 * - MinIO：**假 S3 到达的请求**（`fakeS3.requests` / `s3.keys()`，不经 `Minio.Interface.get`）；
 * - PG 三表：`pg.db` 上的**裸 SQL**（不经 `membershipsOf` / `archiveStatesOf` / `projectMetaOf`）；
 * - 盘上：`existsSync`；
 * - 会话「读得出来」：**公开出口** `GET /session/:sessionID/message`——它是 spec §4.3 那条实测
 *   结论（目录删了照样读得出来）的**判据化**。
 *
 * ## 与 `openhive-project-archive.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ **假 S3** ＋ 身份注入，整套约法照抄、只换判据点。
 * ⚠️ **本文件只建一个 app**——一个文件建第二个 app 会让路由在首查炸 500
 * （`openhive-project-archive.test.ts` 文件头逐字记着那条实测边界）。
 *
 * ## 用例编排（2026-10-16 裁定 15 拆分）
 *
 * brief 原稿把「有 MinIO 备份可清」与「未归档」混在同一条用例里（先归档再删），于是「已归档也能删」
 * 那条性质**没有独立观测面**；又写 `type: "private"` 却断 `existsSync(bareOf(...))`（私有项目**没有**
 * bare 仓库）⇒ **假红**。故拆成：
 * - **A**：**未归档**的共享项目——沙箱目录 + bare 仓库 + 会话留底（不含 MinIO）。
 * - **B**：**已归档**的项目——MinIO 备份清空 + 沙箱/bare 不在 + PG 三表清零。
 */
const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
/** 有身份、不是任何项目的成员——「非创建人 ⇒ 403」那条要用他。 */
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/** 出口路径（**客户端契约**，写**字面量**、**刻意不 import** 生产常量——`LEARNINGS #003-05`）。 */
const PROJECT_PATH = "/openhive/project"
const DELETE_PATH = "/openhive/project/delete"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-delete-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`（`DatabaseRouter.layer` 读的是 `dataRoot(process.env)`，
 * 不是 Effect 的 `Config` 服务）——塞 `ConfigProvider` 会被**无声忽略**（同族测试的同款注释）。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上（T020 起）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

/**
 * 假 S3 与 `openApp` 的构造**次序是要求不是巧合**：配置服务在**层构造期**取值 ⇒
 * `OPEN` 必须在 `HttpApiApp.routes.pipe(...)` 求值之前就有 endpoint。
 */
const s3: FakeS3 = startFakeS3()

afterAll(restoreDefaultPassword)

afterAll(() => {
  s3.stop()
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite 句柄可能仍被持有，清理失败不该变成测试失败
})

/**
 * MinIO 那一组 env 名**逐字照抄** `openhive-project-archive.test.ts` 的 `MINIO` 常量
 * （`OPENHIVE_MINIO_ACCESS_KEY` / `OPENHIVE_MINIO_SECRET_KEY`，**没有** `_ID`/`_ACCESS_KEY` 后缀，
 * 也**没有** `USE_SSL`）。
 */
const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
  OPENHIVE_MINIO_ENDPOINT: new URL(s3.endpoint).host,
  OPENHIVE_MINIO_BUCKET: s3.bucket,
  OPENHIVE_MINIO_ACCESS_KEY: "test-access-key",
  OPENHIVE_MINIO_SECRET_KEY: "test-secret-key",
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

/** 某人的沙箱里、某个项目的目录（与内核拼法一致：`<workspaceRoot>/<userId>/<projectId>`）。 */
const projectDirOf = (userId: string, projectId: string) => path.join(WORKSPACE_ROOT, userId, projectId)
/** 共享 bare 仓库（共享项目才有）。 */
const bareOf = (projectId: string) => path.join(SHARED_ROOT, `${projectId}.git`)

/** PG 三表里某个项目的行数（**裸 SQL**，不经任何读侧函数）。 */
const 三表行数 = (projectId: string) =>
  Effect.promise(async () => {
    const r = await pg?.db.execute(sql`
      select
        (select count(*) from auth.project_member  where project_id = ${projectId}) as 成员,
        (select count(*) from auth.project_archive where project_id = ${projectId}) as 归档,
        (select count(*) from auth.project_meta    where project_id = ${projectId}) as 名字
    `)
    const 行 = rowsOf(r)[0] ?? {}
    return { 成员: Number(行.成员 ?? 0), 归档: Number(行.归档 ?? 0), 名字: Number(行.名字 ?? 0) }
  })

/** 建一个项目、回它的 id（共享项目 ⇒ 有 bare 仓库）。 */
const 建项目 = (name: string, type: "private" | "shared") =>
  Effect.gen(function* () {
    const created = yield* as(PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type }),
    })
    return yield* json(Entry, created)
  })

/**
 * 造一条会话 ＋ 一条用户消息（走**内核一等出口**，`noReply: true` ⇒ 不触模型、不需要 provider，
 * `LEARNINGS #006-35`）。回 `{ 会话ID, 文本 }`。
 *
 * ⚠️ `model` 字段**必须直接给**：不传时 `createUserMessage` 会走到 `provider.defaultModel()`，
 * 而本 harness 没有 provider 配置 ⇒ 500。给一个 `test/test-model` 只当**元数据落库**，
 * 不会真去调模型（`ag.model` 为空 ⇒ `same` 恒假 ⇒ 不走 `provider.getModel`）。
 */
const 造会话 = (projectId: string, 文本: string) =>
  Effect.gen(function* () {
    const 建 = yield* as("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-openhive-project": projectId },
      body: JSON.stringify({}),
    })
    expect(建.status, "造会话这条前提必须真的成立").toBe(200)
    const 会话 = yield* json(Schema.Struct({ id: Schema.String }), 建)

    const 发 = yield* as(`/session/${会话.id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        noReply: true,
        parts: [{ type: "text", text: 文本 }],
      }),
    })
    expect(发.status, "造消息这条前提必须真的成立").toBe(200)
    return { 会话ID: 会话.id, 文本 }
  })

/** 删一个项目（发起人给 `subject`）。 */
const 删 = (subject: TokenSubject, projectId: string) =>
  asWho(subject, DELETE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  })

describe("T-delete · 项目删除（spec §10 判据 3 / 4 / 7）", () => {
  /**
   * **A｜未归档的共享项目**：删干净了，而会话还读得出来（两条方向相反的判据同一条用例）。
   *
   * 为什么是共享：bare 仓库是**共享项目才有**的东西，「盘上 bare 没了」这条判据在私有项目上
   * 没有观测面（`existsSync(bareOf(...))` 恒 false ⇒ 空转）。brief 原稿写 `private` 是假红。
   */
  it.live(
    "A｜未归档的共享项目：清单没了、沙箱与 bare 没了、PG 三表清了，**而会话还读得出来**",
    () =>
      Effect.gen(function* () {
        const project = yield* 建项目("要删的共享项目", "shared")
        // 盘上放一个文件（`handleCreate` 已建好沙箱目录与 bare 仓库）。
        writeFileSync(path.join(projectDirOf(ALICE.id, project.id), "话单.csv"), "主叫,被叫\n138,139\n", "utf8")

        // 造一条会话 ＋ 一条消息（删除的「留底」那一半就靠它）。
        const { 会话ID, 文本 } = yield* 造会话(project.id, "删除后这条聊天记录应当还在")

        // ── 前置条件逐条**先证明成立**（`#002-02`：先证明机制活着，再钉被测那条）──
        expect(existsSync(projectDirOf(ALICE.id, project.id))).toBe(true)
        expect(existsSync(bareOf(project.id))).toBe(true)
        // 删除前消息**真的读得出来**——否则「删除后读得出来」在一个本来就哑的现场也绿。
        const 读前 = yield* as(`/session/${会话ID}/message`)
        expect(读前.status).toBe(200)
        expect(yield* Effect.promise(() => 读前.text())).toContain(文本)

        // ── 被测动作 ──
        const response = yield* 删(ALICE, project.id)

        // ① 出口自述成功（与归档 / 找回 / 改名同款的「自述一个布尔」）。
        expect(response.status).toBe(200)
        expect(
          (yield* json(Schema.Struct({ projectId: Schema.String, deleted: Schema.Boolean }), response)).deleted,
        ).toBe(true)

        // ② 判据 3：从清单消失。
        const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
        expect(listed.some((entry) => entry.id === project.id)).toBe(false)

        // ③ 判据 7：盘上目录与 bare 仓库都没了。
        expect(existsSync(projectDirOf(ALICE.id, project.id))).toBe(false)
        expect(existsSync(bareOf(project.id))).toBe(false)

        // ④ spec §6 ②：PG 三表都清空了（成员关系**全体**删掉，不只发起人）。
        expect(yield* 三表行数(project.id)).toEqual({ 成员: 0, 归档: 0, 名字: 0 })

        // ⑤ 判据 4（**留底**，与上面五条方向相反）：会话行仍在、且**读得出来**。
        //    这是 spec §4.3 那条实测结论（目录删掉后读会话照样通）的判据化。
        const 读后 = yield* as(`/session/${会话ID}/message`)
        expect(读后.status, "目录没了之后读会话照样通（spec §4.3）").toBe(200)
        expect(yield* Effect.promise(() => 读后.text())).toContain(文本)

        // ⑥ 代价（R5）：`GET /session` 带该项目头 ⇒ 200，但**不再列出**这条会话——
        //    删除后 `project_ext` 行没了 ⇒ 头那道门查不到 ⇒ 落沙箱根，会话（目录在被删的项目里）
        //    自然不在沙箱根的清单里。「删了」与「从未存在」在这里不可区分，属 R5 的**已知代价**。
        const 会话表 = yield* as("/session", { headers: { "x-openhive-project": project.id } })
        expect(会话表.status, "目录没了之后列会话应当照样通（spec §4.3）").toBe(200)
        const 会话们 = yield* json(Schema.Array(Schema.Struct({ id: Schema.String })), 会话表)
        expect(会话们.some((s) => s.id === 会话ID)).toBe(false)
      }),
    60_000,
  )

  /**
   * **B｜已归档的项目也能删**（spec §7 的第二个出口）。先归档造出 MinIO 备份，
   * 删除必须把它们逐键清掉——「已归档也能删」与「备份清空」两条都只有在这个组合里才有观测面。
   */
  it.live(
    "B｜已归档的项目也能删：MinIO 备份清空、PG 三表清零、沙箱与 bare 不在",
    () =>
      Effect.gen(function* () {
        const project = yield* 建项目("归档后删掉的项目", "shared")
        writeFileSync(path.join(projectDirOf(ALICE.id, project.id), "资料.txt"), "要归档的内容", "utf8")

        // 归档（把文件传上 MinIO）——「有备份可清」这条前提的来源。
        const 归档 = yield* as("/openhive/project/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })
        expect(归档.status, "归档应当成功——它是「有 MinIO 备份可清」这条前提的来源").toBe(200)
        const 备份键 = s3.keys().filter((key) => key.includes(project.id))
        expect(备份键.length, "归档之后应当真的落到 MinIO 上").toBeGreaterThan(0)

        // ── 被测动作 ──
        const response = yield* 删(ALICE, project.id)

        expect(response.status).toBe(200)
        expect(
          (yield* json(Schema.Struct({ projectId: Schema.String, deleted: Schema.Boolean }), response)).deleted,
        ).toBe(true)

        // 判据 spec §6 ⑤：MinIO 备份清空（逐键删，不是整个桶）。
        expect(s3.keys().filter((key) => key.includes(project.id))).toEqual([])
        // spec §6 ②：PG 三表清零。
        expect(yield* 三表行数(project.id)).toEqual({ 成员: 0, 归档: 0, 名字: 0 })
        // 判据 7：盘上目录与 bare 都没了（bare 归档**不碰**，只有删除碰 ⇒ 这条在 B 上有牙）。
        expect(existsSync(projectDirOf(ALICE.id, project.id))).toBe(false)
        expect(existsSync(bareOf(project.id))).toBe(false)
      }),
    60_000,
  )

  /**
   * **判据 6：可重入**（spec §6 末段）——再点一次接着清、不报错。
   *
   * ⚠️ 这条**必须独立成一条用例**：混在 A 里，第二次调用发生在「第一次已经清干净」之后，
   * 而那时 A 的大多数断言已经跑过了 ⇒ 变异拆掉容错时它红不红**取决于排在哪儿**（`#005-46`）。
   *
   * ⚠️ 它同时钉着**裁定 14 的授权门**：第一次删完 `project_member` 已空 ⇒ 第二次调用
   * `members.length === 0` ⇒ 判定被跳过（`members.length > 0 && …` 的前半句为假）⇒ 放行。
   * 若门写成 brief 原稿的 `!decide(...)`（不带 `members.length > 0` 前置），`actor = null` ⇒
   * 403，这条当场红——那是**产品真的不可重入**，不是用例没牙。
   */
  it.live("再删一次 ⇒ 仍然 200（可重入），不是 500", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("删两次的项目", "private")

      const 第一次 = yield* 删(ALICE, project.id)
      expect(第一次.status).toBe(200)

      const 第二次 = yield* 删(ALICE, project.id)
      expect(第二次.status, "可重入：第二次应当照样 200").toBe(200)
      expect(
        (yield* json(Schema.Struct({ projectId: Schema.String, deleted: Schema.Boolean }), 第二次)).deleted,
      ).toBe(true)
    }),
    30_000,
  )

  /** **判据 5 的删除那半**：非创建人 ⇒ 403 ＋ 项目一个字没动。 */
  it.live("非创建人 ⇒ 403，且项目**原样都在**（清单里有、目录在、PG 三表没清）", () =>
    Effect.gen(function* () {
      const project = yield* 建项目("乙删不掉的", "shared")

      const response = yield* 删(BOB, project.id)

      expect(response.status).toBe(403)
      expect((yield* json(Schema.Struct({ error: Schema.String }), response)).error.length).toBeGreaterThan(0)
      // 零副作用：三个面各断一句（`#004-14`：被测属性 → 副作用 → 伴随信号）。
      const listed = yield* json(Schema.Array(Entry), yield* as(PROJECT_PATH))
      expect(listed.some((entry) => entry.id === project.id)).toBe(true)
      expect(existsSync(projectDirOf(ALICE.id, project.id))).toBe(true)
      expect(yield* 三表行数(project.id)).toEqual({ 成员: 1, 归档: 0, 名字: 1 })
    }),
    30_000,
  )
})
