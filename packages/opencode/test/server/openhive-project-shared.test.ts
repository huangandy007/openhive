import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, realpathSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { addMember } from "@opencode-ai/auth/project-member"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Git } from "../../src/git"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T016（FR-011 / FR-012）：**会话彻底私有 ＋ 文件并发靠 git**。
 *
 * ## 两半各钉什么
 *
 * - **FR-011**「会话彻底私有——成员会话只存自己 db，任何人（含 owner）不可见」：
 *   003 的 `tenant-db-isolation.test.ts` 已钉住「任意两个用户之间跨库不可见」这个**一般**情形。
 *   本条钉的是 FR-011 点名的那**具体**情形：**同属一个共享项目的 owner 与 member**。
 *   它不是那条的复述——共享项目引入了一条新的潜在泄漏路径（「共享项目 ⇒ 会话也共享」），
 *   而那正是 FR-011 要挡的东西。
 * - **FR-012**「文件并发 MUST 靠 git（各自 commit、冲突 merge），不做实时协同编辑」：
 *   Q2 裁定的载体是共享 bare 仓库 `/shared/{projectId}.git`（由 **T018** 建，本条只**用**它）。
 *   本条走完整流程：两个检出各自 commit ⇒ 第二个 push 被拒（非快进）⇒ merge 出冲突 ⇒
 *   解冲突后 push 成功 ⇒ 两次提交都留在裸仓库里。**并**在流程中钉住「不做实时协同」那半：
 *   对方推上来的改动，自己不 fetch/merge 就**看不见**。
 *
 * ## oracle 一律不经过被测对象（`LEARNINGS #002-02`）
 *
 * 会话落在哪个库：**用 `bun:sqlite` 直接读库文件**（不经 HTTP、不经我们自己的查询函数）；
 * 「互相看不见」：走 HTTP 的 404（那是**终点**判据，与「库文件里有没有」是两条独立的事，
 * `LEARNINGS #004-09`）；git 那半的 oracle 是**裸仓库自己**（`git --git-dir=<bare> log/show`），
 * 不是两个检出各自的说法。
 *
 * ## harness 与 `openhive-project.test.ts` 同源（`LEARNINGS #004-12`）
 *
 * 同一个被测子系统（真应用 ＋ 真 PG ＋ 每用户 SQLite ＋ 身份注入），故整套约法照抄：
 * `OPENHIVE_DATA_ROOT` 只能走 `process.env`（塞 `ConfigProvider` 会被**无声忽略**）、
 * 建真应用必须像真部署那样配 `OPENHIVE_DEFAULT_PASSWORD`、身份走 cookie 不走自造头。
 *
 * ## ★ 开工探针实测（2026-10-06，临时探针文件已删）——**成员带项目头会被无声忽略**
 *
 * | 请求 | 结果 |
 * |---|---|
 * | owner 带 `x-openhive-project: <共享项目>` 建会话 | **200**，`projectID` = 项目 id，`directory` = `{workspaces}/{ALICE}/{projectId}` |
 * | **member** 带同一个头建会话 | **200**，但 `projectID` = `"global"`，`directory` = `{workspaces}/{BOB}`（**没有项目段**） |
 * | member 不带头建会话 | 200，同上 |
 *
 * 即**项目头对非创建者不生效**：`project_ext`（个人态）里只有创建者那一行，成员那头查不到 ⇒
 * 中间件**静默退回沙箱根**（T017 的文件头早写过这个退化路径，这里取到的是它在会话链上的实例）。
 * 「成员进不去共享项目的工作目录」是**真缺口**，但修它 = 给成员建 `project_ext` / 沙箱目录
 * ＝新能力（T018 / T021 的地界），**不在本条出参内** ⇒ 只记进 `state.md` 挂账，不在这里补。
 * ⚠️ 因此下面**不用带头的会话**去钉隔离：那会把一个**退化路径**当成预期行为钉死（`#002-02` 的反面）。
 * 带头的只有**对照**那一条（owner），它的作用是证明「头这条机制本身是活的」——没有它，
 * 「两个人都进不去项目」也能让隔离全绿。
 */

const it = testEffect(Layer.empty)

/** Git 那半要走**上游 `Git` 服务**，不是自己 `spawn`（`project.ts` 的 `gitInit` 注释已裁定）。 */
const itGit = testEffect(LayerNode.compile(LayerNode.group([Git.node])))

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = { id: "550e8400-e29b-41d4-a716-446655440000", policeNo: "020601", name: "张三", isAdmin: false }
const BOB: TokenSubject = { id: "660e8400-e29b-41d4-a716-446655440001", policeNo: "020602", name: "李四", isAdmin: false }

/**
 * 出口路径与头名（**客户端契约**，写字面量、刻意不 import 生产常量——import 过来就变成
 * 「生产改什么测试跟着改什么」，改名也测不出来，`LEARNINGS #003-05`）。
 */
const PROJECT_PATH = "/openhive/project"
const PROJECT_HEADER = "x-openhive-project"

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-shared-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")
const SHARED_ROOT = path.join(SANDBOX, "shared")
const CHECKOUT_ROOT = path.join(SANDBOX, "checkouts")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 建真应用（`HttpApiApp.routes`）的测试必须像一次真部署那样把口令配上（T020 起）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上 SQLite / git 句柄可能仍被持有，清理失败不该变成测试失败
})

/** 真 auth 库（文件级夹具）：`project_member` 的外键指向 `auth.user(id)`。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // `project_member.user_id` 有外键 ⇒ 两个身份必须先有 `auth.user` 行。
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

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: SHARED_ROOT,
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

/** 用真实签发器造令牌——**不手搓 JWT**。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/** 读 JSON 体。**过一遍 `Schema` 而不是 `as`**（`Response.json()` 是 `any`，`as` 会被 oxlint 拦）。 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    // ⚠️ **先断内容类型，不能只断状态码**——未匹配的路径会被 SPA 兜底回 `200 text/html`
    // （`openhive-project.test.ts` 文件头那条实测），那时只断状态码会**假绿**。
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 以某人的身份发一个请求；额外头（项目头那类）从 `init.headers` 进。 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

const ProjectEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  memberCount: Schema.optional(Schema.Number),
})

/** `POST /openhive/project` —— 建一个项目。 */
const createProjectAs = (subject: TokenSubject, type: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, PROJECT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `T016-${type}`, type }),
    })
    expect(response.status).toBe(200)
    return yield* json(ProjectEntry, response)
  })

const SessionInfo = Schema.Struct({ id: Schema.String })

/** 建会话；`projectId` 给了就带项目头。 */
const createSessionAs = (subject: TokenSubject, projectId?: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/session", {
      method: "POST",
      ...(projectId === undefined ? {} : { headers: { [PROJECT_HEADER]: projectId } }),
    })
    expect(response.status).toBe(200)
    return (yield* json(SessionInfo, response)).id
  })

const listSessionsAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/session")
    expect(response.status).toBe(200)
    return (yield* json(Schema.Array(SessionInfo), response)).map((session) => session.id)
  })

/** 以某人身份直取某条会话的 HTTP 状态码。 */
const getSessionAs = (subject: TokenSubject, sessionId: string) =>
  Effect.gen(function* () {
    const response = yield* as(subject, `/session/${sessionId}`)
    return response.status
  })

/** 把 BOB 加进 ALICE 建的项目当 member。**用生产的 `addMember`**（T021 的邀请出口今天还不存在）。 */
const addMemberTo = (projectId: string, subject: TokenSubject) =>
  Effect.promise(() =>
    addMember(pg!.db, {
      projectId,
      userId: subject.id,
      role: "member",
      // Unix **秒**（`src/time.ts` 的 `nowSeconds()` 口径）；同一批写入要共用一个时刻。
      timeCreated: Math.floor(Date.now() / 1000),
    }),
  )

/** 某个用户的库文件。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/** 某个用户库里 `session` 表里的全部 id（**直接读文件**，不经过被测对象）。 */
const sessionIdsIn = (userId: string): string[] => {
  const file = userDb(userId)
  if (!existsSync(file)) return []
  const db = new Sqlite(file)
  try {
    return db
      .query<{ id: string }, []>("SELECT id FROM session")
      .all()
      .map((row) => row.id)
  } finally {
    db.close()
  }
}

/**
 * 某条会话在库里的落点行；库文件不在 ⇒ `undefined`（**不 `new Sqlite` 去「顺便建一个」**）。
 *
 * ⚠️ 列名是 **`project_id`**（下划线）——**不要**照着 HTTP 响应体里的 `projectID` 写：
 * 那是 `Schema` 解码出来的**线上形状**（camelCase），库里的列是另一个名字。2026-10-06 实测
 * 写错时红成 `SQLiteError: no such column: projectID`，而它看着像「库搭错了」。
 *
 * 写成裸函数、**不做成泛型薄包装**：本文件只有这一处要读行，泛型参数只会用一次
 * （`no-unnecessary-type-parameters` 会报，而 T018 那份留泛型是因为它有**四**个同形包装共用）。
 */
const sessionRow = (userId: string, sessionId: string) => {
  const file = userDb(userId)
  if (!existsSync(file)) return undefined
  const db = new Sqlite(file)
  try {
    // `Statement.get` 的返回是 `T | null`，本函数的契约是 `undefined` ⇒ 末尾收敛一下
    // （否则 typecheck 报 `'T | null' is not assignable to 'T | undefined'`）。
    return (
      db
        .query<{ project_id: string | null; directory: string }, [string]>(
          "SELECT project_id, directory FROM session WHERE id = ?",
        )
        .get(sessionId) ?? undefined
    )
  } finally {
    db.close()
  }
}

/**
 * 归一化路径：断言钉的是**归属**，不是书写形式。
 *
 * ⚠️ **必须过 `realpathSync.native`，不能只做斜杠/大小写归一**。2026-10-06 本文件实测：
 * `SANDBOX` 由 `mkdtempSync(join(tmpdir(), …))` 得到，在 win32 上是 **8.3 短名**
 * （`…/Temp/ADMINI~1/…`），而被测对象（应用自己 realpath 过）写进库的是**长名**
 * （`…/Temp/Administrator/…`）⇒ 只归一斜杠与大小写时红成
 * `admini~1` vs `administrator` 两个看着「差不多」的路径。
 * 这条与 `LEARNINGS #003-04` 那笔「探了三种取法都返短名、复现不出来」**不矛盾**：
 * 那次三种取法**都是夹具侧**的取法（谁也不 realpath），所以差异不显现；**这次差异的一方
 * 是被测对象**——它 realpath。判据一句话：**比对两侧时，两侧要过同一个函数**
 * （同 `openhive-project.test.ts` 的 `canonical`，不是重新发明一个）。
 */
const canonical = (value: string) => {
  const real = (() => {
    try {
      return realpathSync.native(value)
    } catch {
      return value
    }
  })()
  return real.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
}

/** Q2 裁定的共享 bare 仓库路径（由 T018 建）。 */
const sharedBare = (projectId: string) => path.join(SHARED_ROOT, `${projectId}.git`)

// ─────────────────────────────────────────────────────────────────────────────
// git 那半的夹具：走上游 `Git` 服务（不是自己 spawn）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 提交身份走 **env** 而不是 `-c`：`Git.run` 的 `ChildProcess.make` 带 `extendEnv: true`，
 * env 会与进程环境**合并**，而 `-c` 得混进 `args` 里跟在它自己那串 `cfg` 后面，读起来是噪声。
 * 给死身份是必须的——否则测试会依赖这台机器的 `~/.gitconfig`（换机 / CI 上必红）。
 */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "T016",
  GIT_AUTHOR_EMAIL: "t016@example.invalid",
  GIT_COMMITTER_NAME: "T016",
  GIT_COMMITTER_EMAIL: "t016@example.invalid",
}

const gitRaw = (cwd: string, ...args: string[]) =>
  Effect.gen(function* () {
    const service = yield* Git.Service
    return yield* service.run(args, { cwd, env: GIT_ENV })
  })

/** 跑一条 git，非 0 就抛——**把命令与 stderr 一起带进失败信息**（否则只看到「期望真、实得假」）。 */
const gitOk = (cwd: string, ...args: string[]) =>
  Effect.gen(function* () {
    const result = yield* gitRaw(cwd, ...args)
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} 失败（cwd=${cwd}）：${result.stderr.toString("utf8").trim()}`)
    }
    return result.text()
  })

/** 对**裸仓库本身**跑一条 git（`--git-dir` 是顶层选项，跟 `-c` 一样排在子命令之前）。 */
const bareGit = (bare: string, ...args: string[]) =>
  Effect.gen(function* () {
    const service = yield* Git.Service
    const result = yield* service.run(["--git-dir", bare, ...args], { cwd: SANDBOX, env: GIT_ENV })
    if (result.exitCode !== 0) {
      throw new Error(`git --git-dir=<bare> ${args.join(" ")} 失败：${result.stderr.toString("utf8").trim()}`)
    }
    return result.text()
  })

const writeAt = (dir: string, name: string, text: string) => writeFileSync(path.join(dir, name), text, "utf8")
const readAt = (dir: string, name: string) => readFileSync(path.join(dir, name), "utf8")

describe("T016 · 会话私有（FR-011）", () => {
  /**
   * **对照**：先证明「项目头这条机制本身是活的」。
   *
   * 少了这条，下面那些「互相看不见」的用例在「谁都进不去项目」时**照样全绿**——
   * 而测出来的会是「头失效」而不是「隔离成立」（`LEARNINGS #002-02`：对照要证明机制是活的）。
   * 这也是**唯一**用带项目头建会话的用例，理由见文件头「成员带项目头会被无声忽略」那笔探针。
   */
  it.live(
    "对照：owner 带项目头建会话 ⇒ 头生效，落自己的库与项目目录",
    () =>
      Effect.gen(function* () {
        const project = yield* createProjectAs(ALICE, "shared")
        const sessionId = yield* createSessionAs(ALICE, project.id)

        const row = sessionRow(ALICE.id, sessionId)
        expect(row?.project_id).toBe(project.id)
        expect(canonical(row?.directory ?? "")).toBe(
          canonical(path.join(WORKSPACE_ROOT, ALICE.id, project.id)),
        )
      }),
    30_000,
  )

  /**
   * **主判据**：owner 与 member 同属一个共享项目，会话仍然**只存各自 db**，双向不可见。
   *
   * 两个方向都断：隔离那半（看不见对方）＋「过紧也是缺陷」那半（看得见自己的）。
   * 少了后者，把两边的库都指到同一个空文件也能全绿。
   */
  it.live(
    "owner 与 member 同属一个共享项目：互相看不见对方的会话（双向）",
    () =>
      Effect.gen(function* () {
        const project = yield* createProjectAs(ALICE, "shared")
        yield* addMemberTo(project.id, BOB)

        const aliceSession = yield* createSessionAs(ALICE)
        const bobSession = yield* createSessionAs(BOB)

        // ① 直取：不是「返回了但我没权限看」，是**根本没有**（404）。
        expect(yield* getSessionAs(BOB, aliceSession)).toBe(404)
        expect(yield* getSessionAs(ALICE, bobSession)).toBe(404)

        // ② 列表：隔离那半 ＋ 「看得见自己的」那半。
        const bobSees = yield* listSessionsAs(BOB)
        const aliceSees = yield* listSessionsAs(ALICE)
        expect(bobSees).not.toContain(aliceSession)
        expect(aliceSees).not.toContain(bobSession)
        expect(bobSees).toContain(bobSession)
        expect(aliceSees).toContain(aliceSession)
      }),
    30_000,
  )

  /**
   * **oracle 不经过被测对象**：直接读两个库文件。
   *
   * HTTP 那两条（上面）证的是**端点**，这条证的是**存储**——一个「列表接口过滤对了、
   * 但两条会话其实都写进了同一个库」的实现会绿在上面、红在这里（`LEARNINGS #004-09`：
   * 同一个出口里判据要分层）。
   */
  it.live(
    "两个库文件里各只有自己的会话（直接读库，不经过被测对象）",
    () =>
      Effect.gen(function* () {
        const project = yield* createProjectAs(ALICE, "shared")
        yield* addMemberTo(project.id, BOB)

        const aliceSession = yield* createSessionAs(ALICE)
        const bobSession = yield* createSessionAs(BOB)

        expect(sessionIdsIn(ALICE.id)).toContain(aliceSession)
        expect(sessionIdsIn(ALICE.id)).not.toContain(bobSession)
        expect(sessionIdsIn(BOB.id)).toContain(bobSession)
        expect(sessionIdsIn(BOB.id)).not.toContain(aliceSession)
      }),
    30_000,
  )

  /**
   * FR-011 的**反面**：「成员会话**只**存自己 db」——共享项目**不产生**共享的会话存储。
   *
   * 判据落在 Q2 裁定给共享项目的那**一个**目录上：`/shared/` 下只该有 `<projectId>.git`
   * 这一样东西。多出任何库文件都说明会话（或别的用户数据）被写进了共享区。
   */
  it.live(
    "共享根下只有 bare 仓库，没有库文件（共享项目不产生共享存储）",
    () =>
      Effect.gen(function* () {
        const project = yield* createProjectAs(ALICE, "shared")
        yield* addMemberTo(project.id, BOB)
        yield* createSessionAs(ALICE)
        yield* createSessionAs(BOB)

        // ⚠️ 断言的是「**非 `.git` 的条目为空集**」，不是「列表恰好等于本项目那一项」——
        // `SHARED_ROOT` 是**整个测试文件共用**的一个目录，兄弟用例各自也建了共享项目
        // （2026-10-06 实测：写成 `toEqual([...])` 时红成 4 项 vs 1 项，而那是**用例间的
        // 隐式耦合**、不是被测对象的性质——`openhive-project.test.ts` 里 CAROL 那条注释同款）。
        // 这条断言**带警报语义**（`LEARNINGS #004-02`）：将来谁往共享区多放一样东西就会红，
        // 逼人回来回答「这样东西该不该跟所有成员共享」——那正是 FR-011 要问的问题。
        expect(existsSync(sharedBare(project.id))).toBe(true)
        const entries = readdirSync(SHARED_ROOT)
        expect(entries).toContain(`${project.id}.git`)
        expect(entries.filter((name) => !name.endsWith(".git"))).toEqual([])
      }),
    30_000,
  )
})

describe("T016 · 文件并发靠 git（FR-012）", () => {
  /**
   * **主判据**：两个检出各自 commit ⇒ 第二个 push 被拒（非快进）⇒ merge 出冲突 ⇒
   * 解冲突后 push 成功 ⇒ 两次提交都留在裸仓库里。
   *
   * 一个用例走完整条流程（不是一个用例一件事，而是**这条流程本身就是被测的那一件事**：
   * 单独任何一步都不足以说明「并发靠 git」）。步骤编号与断言按 `LEARNINGS #004-14` 排：
   * 每一步**先断被测属性、再断伴随信号**（状态码 / exit code 是伴随信号）。
   */
  itGit.live(
    "两个检出各自 commit：第二个 push 被拒 ⇒ merge 解冲突 ⇒ 留痕（含「不实时同步」）",
    () =>
      Effect.gen(function* () {
        const project = yield* createProjectAs(ALICE, "shared")
        const bare = sharedBare(project.id)

        // ⓪ 前提：仓库是 **T018** 建的（本条只**用**它）。它不在 ⇒ 是 T018 的缺口，不是这里补建。
        expect(existsSync(bare)).toBe(true)
        // 且它必须是**裸**仓库——Q2 裁定的那个字面（`/shared/{projectId}.git` 是**远端**，
        // 不是谁的检出）。这一条只有 `git` 说得准（问文件长得像不像没用）。
        // ⚠️ **这条断言是承重的，别当装饰**（2026-10-06 实测）：把 `--bare` 从 T018 的
        // `git init` 上拿掉之后，**①–⑨ 全绿**——「两个检出推并合并」对裸不裸**不敏感**
        // （非裸仓库的当前分支是那个未出生的默认分支，我们推的 `trunk` 不是它，
        // `receive.denyCurrentBranch` 拦不住）。Q2 裁定那个字面就**只**挂在这一条上。
        expect((yield* bareGit(bare, "rev-parse", "--is-bare-repository")).trim()).toBe("true")

        // ① 检出①：铺底 —— 一次 commit 推上去，成为两个检出的公共基线。
        const checkoutA = path.join(CHECKOUT_ROOT, "a")
        yield* gitOk(SANDBOX, "clone", bare, checkoutA)
        // 分支名**显式给**：`git init --bare` 的默认分支名随机器的 `init.defaultBranch` 漂，
        // 而本条的判据与分支名无关（`LEARNINGS #002-06`：会漂的东西别写死）。
        yield* gitOk(checkoutA, "checkout", "-b", "trunk")
        writeAt(checkoutA, "notes.md", "初始\n")
        yield* gitOk(checkoutA, "add", "-A")
        yield* gitOk(checkoutA, "commit", "-m", "甲：建文件")
        yield* gitOk(checkoutA, "push", "-u", "origin", "trunk")

        // ② 检出②：从同一基线开出来（成员各自 clone）。
        const checkoutB = path.join(CHECKOUT_ROOT, "b")
        yield* gitOk(SANDBOX, "clone", bare, checkoutB)
        yield* gitOk(checkoutB, "checkout", "trunk")
        expect(readAt(checkoutB, "notes.md")).toBe("初始\n")

        // ③ 甲改同一行并推上去。
        writeAt(checkoutA, "notes.md", "甲的改动\n")
        yield* gitOk(checkoutA, "add", "-A")
        yield* gitOk(checkoutA, "commit", "-m", "甲：改那一行")
        yield* gitOk(checkoutA, "push")

        // ④ **「不做实时协同编辑」那半**：甲推上去了，乙**不动手就看不见**。
        //    这条不是顺手加的——它正是 FR-012 后半句的字面（没有推送/拉取就没有同步）。
        expect(readAt(checkoutB, "notes.md")).toBe("初始\n")

        // ⑤ 乙也改同一行 ⇒ 两个检出**分叉**。
        writeAt(checkoutB, "notes.md", "乙的改动\n")
        yield* gitOk(checkoutB, "add", "-A")
        yield* gitOk(checkoutB, "commit", "-m", "乙：也改那一行")

        // ⑥ 乙 push ⇒ **被拒**（非快进）。这是「并发」这件事的**证据本身**：
        //    没有这一条，「两个人都能推」与「第二个人覆盖了第一个人的」分不开。
        const rejected = yield* gitRaw(checkoutB, "push")
        expect(rejected.exitCode).not.toBe(0)
        expect(rejected.stderr.toString("utf8")).toContain("rejected")

        // ⑦ merge ⇒ **冲突**（git 自己报，不是我们猜的）。
        yield* gitOk(checkoutB, "fetch", "origin")
        const merge = yield* gitRaw(checkoutB, "merge", "origin/trunk")
        expect(merge.exitCode).not.toBe(0)
        // 冲突文件用 git 自己列的为准（不去读工作区里那串 `<<<<<<<` 标记——那是表示形式，不是事实）。
        const conflicted = yield* gitOk(checkoutB, "diff", "--name-only", "--diff-filter=U")
        expect(conflicted.split("\n").map((line) => line.trim())).toContain("notes.md")

        // ⑧ 解冲突（人来定内容）⇒ 提交 ⇒ push **成功**。
        writeAt(checkoutB, "notes.md", "甲的改动\n乙的改动\n")
        yield* gitOk(checkoutB, "add", "-A")
        yield* gitOk(checkoutB, "commit", "-m", "乙：解冲突")
        yield* gitOk(checkoutB, "push")

        // ⑨ **留痕**：oracle 是**第三个检出**——从共享仓库 clone 下来的新人（不是当事人自己的说法，
        //    也不是「拿 `--git-dir` 去窥探仓库内部」）。这更贴 FR-012 的字面：留痕的意思是
        //    **别人 clone 下来能看见两次提交、也能看见解出来的内容**。
        const checkoutC = path.join(CHECKOUT_ROOT, "c")
        yield* gitOk(SANDBOX, "clone", bare, checkoutC)
        yield* gitOk(checkoutC, "checkout", "trunk")
        const log = yield* gitOk(checkoutC, "log", "--oneline")
        expect(log).toContain("甲：建文件")
        expect(log).toContain("甲：改那一行")
        expect(log).toContain("乙：解冲突")
        // 解出来的内容也在：两个人的改动都在树里（这才是「冲突 merge」而不是「谁赢谁输」）。
        expect(readAt(checkoutC, "notes.md")).toBe("甲的改动\n乙的改动\n")
      }),
    90_000,
  )
})
