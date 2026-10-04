import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
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
 * T012（验收 · FR-010 / SC-001）：**用户 A 读不到用户 B 的会话/项目**。
 *
 * ## 为什么不是「再写一条 core 单测」
 *
 * T005 已经有 `packages/core/test/database-routing.test.ts` 证「同一段查询代码按身份落到不同库」
 * ——那条测的是**机制**。本任务要的是**验收**：把整棵**真应用的接线**（身份门 → 取连接钩子 →
 * 每用户库）跑起来，从 HTTP 这一层问「A 能不能看见 B 的东西」。两者不可互相替代：
 * 机制绿不保证接线装对了（`multi-tenant-routing.test.ts` 那组守卫的存在就是这个道理）。
 *
 * 所以这里用**真应用**（`HttpApiApp.routes`）+ **真实签发器**（`signToken`），**不 mock**。
 *
 * ## 双向都要验（任务书 Step 4 原话：「过紧也是缺陷」，见 `plan.md` R3）
 *
 * 只证「A 看不见 B」是不够的——把库全部指向一个空文件也能让这句成立。
 * 每一条隔离断言都配一条「**A 看得见自己的**」，把「过紧」这种失败一起挡住。
 *
 * ## oracle 不经过被测对象
 *
 * 「会话落在谁的库里」一律用 `bun:sqlite` **直接读库文件**断言，不调我们自己的接口
 * （`LEARNINGS #002-02`：拿被测对象证明被测对象，等于没证）。
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
const BOB: TokenSubject = {
  id: "660e8400-e29b-41d4-a716-446655440001",
  policeNo: "020602",
  name: "李四",
  isAdmin: false,
}

/**
 * 每个测试文件一套临时根。**不用固定路径**：固定路径会把上一轮跑出来的库文件留下来，
 * 于是「bob 的库里没有 alice 的会话」可能只是因为那文件本来就在——假绿。
 */
const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-tenant-db-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`，**不能走 `ConfigProvider`**。
 *
 * 原因在 `DatabaseRouter.layer` 里：它读的是 `dataRoot(process.env)`——**不是** Effect 的
 * `Config` 服务。所以 `anchor-workspace.test.ts` 那种「env 全塞 ConfigProvider」的写法在这里
 * 只对身份门与锚定有效，数据根塞进去会被无声忽略（那样库就落到默认的 `/data/...` 去了）。
 *
 * 值的生命周期只到**层构建**为止（`Layer.unwrap` 里求值一次），所以建完 handler 就可以还原——
 * 每用户库是查询期惰性开的，那时 `root` 早已是个闭包常量。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/**
 * ⚠️ **T020 遗留的修补（2026-10-01，T021 期间发现）**：本文件在 T012 落地时不需要这一行，
 * 因为那时网关还**没有**「默认口令」这个概念。T020 把 `defaultPassword(process.env)` 放进了
 * 网关的层构造期，并且选定「缺失即抛、进程起不来」——于是**任何建真应用
 * （`HttpApiApp.routes`）的测试，都必须像一次真部署那样把口令配上**，否则整个文件一起撞
 * 「缺少环境变量 OPENHIVE_DEFAULT_PASSWORD」。
 *
 * 实测基线：这两个文件（T012 / T013 的隔离验收）在 T020 落地后**共 9 条用例转红**，
 * 而 T020 自己的记录是绿的——它只跑了 `openhive-gateway.test.ts`。已在 T021 的收尾里单独
 * 提交修复（**不是** T021 引入的，也不是 T021 的改动能治的）。
 *
 * 为什么走 `process.env` 而不是 `OPEN` 那个 `ConfigProvider`：与上面 `OPENHIVE_DATA_ROOT`
 * 同因——网关读的是 `process.env`，塞进 `ConfigProvider` 会被**无声忽略**。
 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  // Windows 上 SQLite 的 `-wal`/`-shm` 句柄可能仍被持有，`rm` 会 EBUSY。
  // 清不掉就留给系统——**清理失败不该变成测试失败**，那与被测对象无关。
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

/**
 * ## T006（2026-10-04）：本文件现在还要求一个**真 auth 库**
 *
 * T006 把「按身份取 capability」接到了会话创建上（`@/server/openhive/access`）。门开着时
 * `POST /session` 会用 `connect(process.env)` 去查 `auth.role_resource`——**查不到就不把会话
 * 建出来**（fail-closed）：「取不到授权」与「没有任何授权」在会话那一层长得一样，若静默按
 * 「空授权」放行，skill 会落回**可自批的 `ask`**，正是 T006 要堵的洞。于是
 * **「门开 ⇒ 建会话须能连 auth 库」成了运行期契约**。本文件按 T020 的先例满足它——
 * `openhive-bootstrap.test.ts` 是同一形状：测试像一次真部署那样把配置配齐。
 *
 * ⚠️ **夹具必须是文件级，不能每用例一个。** 本文件的应用层是模块级构建的（下面的 `openApp`），
 * `HttpApiApp.routes` 的层构造**全文件只跑一次**，层里那个 auth 连接池
 * （`@/server/openhive/access` 的惰性闭包）也只建一次、**指向第一个用例那个端口**。
 * 照「每用例起一个 PGlite」写的话，第 2~4 条会连向一个已经关掉的端口——表现为
 * `POST /session` 500 而**第 1 条是绿的**，因果极难看出。夹具拆分的理由写在
 * `startProductionDb` 上（`@opencode-ai/auth/test-support`）。
 *
 * 库里**一条授权行都没有**（空库，只跑迁移）⇒ 每个用户拿到的是「一条整体 deny skill」。
 * 本文件断言的是**跨库隔离**，与授了什么无关；授权那一半归 `openhive-access.test.ts` 与
 * `packages/auth/src/rbac.test.ts`。
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

/** 用真实签发器造令牌——**不手搓 JWT**，免得测试自己写错格式还自以为对。 */
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

/**
 * 读 JSON 体。**过一遍 `Schema` 而不是 `as`**：`Response.json()` 是 `any`，
 * 直接 `as` 会被 oxlint 的 `no-unsafe-type-assertion` 命中（本文件要 0 命中），
 * 而断言掉的形状在测试里是**假绿的来源**之一（形状变了断言照样过）。
 */
const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.map(Effect.promise(() => response.json()), (body: unknown) => Schema.decodeUnknownSync(schema)(body))

const SessionInfo = Schema.Struct({ id: Schema.String })
const SessionList = Schema.Array(SessionInfo)

/** 某个用户的库文件。**主树那份（本进程自己的库）不在这些路径上**，故可用来证「没多写一份」。 */
const userDb = (userId: string) => path.join(DATA_ROOT, userId, "opencode.db")

/** 直接读库文件里的 `session` 表；文件或表不存在都返回 `[]`。 */
function sessionIdsIn(file: string): string[] {
  if (!existsSync(file)) return []
  const db = new Sqlite(file)
  try {
    // 用 `query<行类型, 参数类型>` 的泛型，不写 `as`——`as` 会被 oxlint 命中（同 `json` 那条注释）。
    const rows = db.query<{ id: string }, []>("SELECT id FROM session").all()
    return rows.map((row) => row.id)
  } catch {
    return [] // 表不存在（库还没被建起来）
  } finally {
    db.close()
  }
}

/** 以某人的身份发一个请求。 */
const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 以某人的身份建一个会话，返回它的 id。 */
const createSessionAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/session", { method: "POST" })
    expect(response.status).toBe(200)
    return (yield* json(SessionInfo, response)).id
  })

/** 以某人的身份列出会话 id。 */
const listSessionsAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* as(subject, "/session")
    expect(response.status).toBe(200)
    return (yield* json(SessionList, response)).map((session) => session.id)
  })

describe("跨库隔离（T012 · FR-010 / SC-001）", () => {
  it.live(
    "A 建的会话落在 A 自己的库文件里",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)

        expect(sessionIdsIn(userDb(ALICE.id))).toEqual([id])
        // B 的库**这一步还不该存在**——不是「存在但为空」，是根本没被碰过。
        expect(existsSync(userDb(BOB.id))).toBe(false)
      }),
    30_000,
  )

  it.live(
    "B 按 id 直取 A 的会话：被拒（不是「返回了但我没权限看」）",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)

        const response = yield* as(BOB, `/session/${id}`)

        expect(response.status).not.toBe(200)
        expect(response.status).toBe(404)
      }),
    30_000,
  )

  it.live(
    "B 列会话：看不到 A 的（双向：B 看得到自己的）",
    () =>
      Effect.gen(function* () {
        const aliceSession = yield* createSessionAs(ALICE)
        const bobSession = yield* createSessionAs(BOB)

        const bobSees = yield* listSessionsAs(BOB)
        const aliceSees = yield* listSessionsAs(ALICE)

        // 隔离那一半
        expect(bobSees).not.toContain(aliceSession)
        expect(aliceSees).not.toContain(bobSession)
        // 「过紧也是缺陷」那一半——少了这两条，把两边的库都指到同一个空文件也能全绿。
        expect(bobSees).toContain(bobSession)
        expect(aliceSees).toContain(aliceSession)
      }),
    30_000,
  )

  it.live(
    "各自的会话落在各自的库文件里（直接读文件，不经过被测对象）",
    () =>
      Effect.gen(function* () {
        const aliceSession = yield* createSessionAs(ALICE)
        const bobSession = yield* createSessionAs(BOB)

        expect(sessionIdsIn(userDb(ALICE.id))).toContain(aliceSession)
        expect(sessionIdsIn(userDb(ALICE.id))).not.toContain(bobSession)
        expect(sessionIdsIn(userDb(BOB.id))).toContain(bobSession)
        expect(sessionIdsIn(userDb(BOB.id))).not.toContain(aliceSession)
      }),
    30_000,
  )
})
