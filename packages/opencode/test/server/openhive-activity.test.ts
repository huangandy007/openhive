/**
 * 003 T017 · 「最后活跃时间」的**接线**：网关有没有每个请求刷、拿的是哪个窗口。
 *
 * **与 `packages/auth/src/activity.test.ts` 的分工**（别把两边写重）：
 * 那边测「刷得对不对」（NULL 补写、窗口内外、只碰自己那一行），
 * 这边测「有没有被调用」——挂在网关的哪一层、凭证认不出时动不动库、窗口值从配置进没进来、
 * 以及**写失败时这次请求会怎样**。逻辑错了那组红，接线错了这组红。
 *
 * 用**真应用**（`HttpApiApp.routes`，含 `createRoutes` 的全部接线）而不是最小路由：
 * 刷活跃挂在 `AuthGateway.layer` 这个**全局中间件**上（装在合并路由之上），最小路由测不出
 * 「它到底覆盖了哪些请求」。
 *
 * ⚠️ **不覆盖**（`LEARNINGS #002-02`：测不了的写成缺口，不写成覆盖）：
 * ① **真实时钟下的节流**——窗口判据本身由上面那组领域用例钉着，这里只钉「配置值进没进来」，
 *    靠的是把行摆到一个确定的过去时刻，用例里没有 sleep；
 * ② **多进程同时刷同一行**——单进程夹具起不了两个实例（同 `openhive-bootstrap.test.ts`）。
 *
 * 用**真库**（PGlite 经 TCP，002 的夹具）：这一跳要穿过 `connect(process.env)` → drizzle → PG
 * 三种形状，替身会让被测对象消失（`LEARNINGS #002-01`）。
 */

import { afterAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { ACTIVITY_THROTTLE_SECONDS_ENV, SESSION_COOKIE_NAME } from "@opencode-ai/auth/policy"
import { registerUser, type RegisterInput } from "@opencode-ai/auth/register"
import { restorePoint, withProductionDb } from "@opencode-ai/auth/test-support"
import { nowSeconds } from "@opencode-ai/auth/time"
import { signToken } from "@opencode-ai/auth/token"
import { user } from "@opencode-ai/auth/user"
import { AuthGateway } from "../../src/server/openhive/gateway"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"

/** 夹具递进来的那个真库客户端。 */
type Db = Parameters<Parameters<typeof withProductionDb>[0]>[0]

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
const POLICE_NO = "000001"

/**
 * 临时根，理由与 `openhive-gateway.test.ts` 逐字相同：带合法凭证访问 `/session` 会真的去开
 * 这个用户的库，默认根是本机真实数据目录——测试不许碰它。
 *
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`：`DatabaseRouter.layer` 读的是
 * `dataRoot(process.env)`，塞进 `ConfigProvider` 会被无声忽略。
 */
const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-activity-"))
const DATA_ROOT = path.join(SANDBOX, "data")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  // Windows 上 SQLite 的 `-wal`/`-shm` 句柄可能仍被持有，`rm` 会 EBUSY。
  // 清不掉就留给系统——**清理失败不该变成测试失败**，那与被测对象无关。
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

/** 网关开着的最小环境。db 那一半由 `withProductionDb` 临时塞进 `process.env`。 */
const ON: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
}

const input = (policeNo: string): RegisterInput => ({
  policeNo,
  name: "张三",
  idCard: "110101199001011234",
  phone: "13800000000",
  org: "市局",
  dept: "刑侦支队",
  section: "一大队",
  status: 1,
})

/**
 * 真应用 + 指定环境变量。**一个夹具一个**，理由同 `openhive-gateway.test.ts`：
 * 每个 `app()` 会自建自己的 PG 客户端，而同一台 PGlite 上两个客户端
 * **执行同一句 SQL 文本**必撞 42P05。
 */
function app(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
}

/**
 * 发一次**带身份**的请求，把服务端推到「处理完一个已认证请求」。
 *
 * 取登出是因为它最便宜：身份门豁免它、它自己也**不碰库**（只回一个清 Cookie 的 204）。
 * 于是这次请求里唯一会碰库的地方就是**刷活跃自己**——断言因此是单一判据，
 * 不会被登录顺带写的 `last_login_at` 搅进来。
 */
const request = (gateway: ReturnType<typeof app>, cookie?: string) =>
  Effect.runPromise(
    gateway(AuthGateway.PATH.logout, { method: "POST", headers: cookie ? { Cookie: cookie } : {} }),
  )

/**
 * 这个人的有效会话 Cookie。**直接签，不走登录端点**——登录会写 `last_login_at`（还有一串
 * argon2 开销），那是另一件事；混进来会让「刷没刷 last_active_at」的判据不再单一。
 *
 * `encodeURIComponent` 与网关 `setCookieHeader` 里那一句对齐：两边不对称的话，
 * 这里造出来的 Cookie 会因为编码差异读不出来，而症状看着像「验签坏了」。
 */
async function cookieFor(id: string) {
  const token = await signToken({ id, policeNo: POLICE_NO, name: "张三", isAdmin: false }, SECRET)
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`
}

const rowOf = async (db: Db, id: string) => {
  const [row] = await db.select().from(user).where(eq(user.id, id))
  return row
}

/** 把这一行的 `last_active_at` 摆到一个确定的过去时刻。 */
const setLastActive = (db: Db, id: string, at: number) =>
  db.update(user).set({ lastActiveAt: at }).where(eq(user.id, id))

/**
 * 在指定节流窗口下起一个网关、跑一段。
 *
 * ⚠️ **走 `process.env`（`restorePoint`）而不是 `ConfigProvider`**：网关读这个变量用的是
 * `process.env`，与 T019 的 `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO` 同一个读法
 * （`test-support.ts` 里 `OPENHIVE_DATA_ROOT` 那条也是同一类陷阱）。
 * **塞进 `ConfigProvider` 会被无声忽略**——而症状恰恰是下面「窗口很大」那条**照样绿**，
 * 因为默认窗口 60 秒在这个时间尺度上给出同一个结果：假绿。
 * 第一次写这组用例时就是这么写的，是下面「窗口很小」那条对照组把它揪出来的。
 */
async function withThrottle<T>(
  seconds: string,
  fn: (gateway: ReturnType<typeof app>) => Promise<T>,
): Promise<T> {
  const restore = restorePoint({ [ACTIVITY_THROTTLE_SECONDS_ENV]: seconds })

  try {
    return await fn(app(ON))
  } finally {
    restore()
  }
}

describe("刷最后活跃时间的接线", () => {
  test("带合法凭证的请求 ⇒ 这个人的 last_active_at 被刷上", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO))
      const before = nowSeconds()

      const response = await request(app(ON), await cookieFor(seeded.id))

      expect(response.status).toBe(204)
      // 不写死具体秒数（真实时钟，写了就是个会漂的断言），判「落在这之后」——
      // 这仍然能红：一个恒写 0 的实现、或者根本没写的实现，都过不了这一条。
      expect((await rowOf(db, seeded.id)).lastActiveAt).not.toBeNull()
      expect((await rowOf(db, seeded.id)).lastActiveAt!).toBeGreaterThanOrEqual(before)
    })
  })

  test("认不出凭证的请求 ⇒ 一行都不碰", async () => {
    // 两半都要断，理由与「身份只从会话取」那条一致：只测「没带」不够——
    // 一个「随便什么 Cookie 都当自己人」的实现会让**伪造的凭证也能刷别人的活跃时间**，
    // 而那是把「谁在线」这条运维信号交给外人来写。
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO))

      expect((await request(app(ON))).status).toBe(204)
      expect((await request(app(ON), `${SESSION_COOKIE_NAME}=nonsense`)).status).toBe(204)

      expect((await rowOf(db, seeded.id)).lastActiveAt).toBeNull()
    })
  })

  test("窗口值从配置进来：窗口很大 ⇒ 摆着的旧值不被覆盖", async () => {
    // 判据刻意不是「连着发两次请求、值不变」——两次调用很可能落在**同一个整数秒**里，
    // 那样即使节流被写死成 0，值也一样不变，是条永远绿的假测试（`LEARNINGS #002-02`）。
    // 改成把一个**确定的过去时刻**摆在行里：只要窗口生效，这次请求就绝不能盖掉它。
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO))
      const 摆着的 = nowSeconds() - 10
      await setLastActive(db, seeded.id, 摆着的)

      await withThrottle("3600", async (gateway) => {
        expect((await request(gateway, await cookieFor(seeded.id))).status).toBe(204)
      })

      expect((await rowOf(db, seeded.id)).lastActiveAt).toBe(摆着的)
    })
  })

  test("窗口值从配置进来：窗口很小 ⇒ 同一个旧值会被覆盖", async () => {
    // 上一条的对照组。两条合起来才证明「配置值真的走进了那句判断」——
    // 只有上一条的话，一个把窗口写死成 3600 的实现也会全绿。
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO))
      const 摆着的 = nowSeconds() - 10
      await setLastActive(db, seeded.id, 摆着的)

      await withThrottle("1", async (gateway) => {
        expect((await request(gateway, await cookieFor(seeded.id))).status).toBe(204)
      })

      expect((await rowOf(db, seeded.id)).lastActiveAt).toBeGreaterThan(摆着的)
    })
  })

  test("库连不上 ⇒ 刷活跃失败被吞掉，请求照常成功", async () => {
    // **这条钉的是 2026-10-01 的裁定**：记活动是**非关键路径**，不该把业务请求带下水。
    // 有人给它加上 fail-closed（失败即 500 / 让异常逃出去），这条就会红——那正是
    // 「PG 抖一下，全平台用不了」那条代价。
    //
    // ⚠️ 代价如实记：PG 长时间不可用时这一列会**静默停更**，僵尸识别偏保守
    // （把还活跃的人算成不活跃）——方向是安全的（宁可漏停，不可误停）。
    //
    // 不需要真库：这里要验的恰恰是**连不上**。PG_* 全给上，只把端口指到一个必然拒绝连接的号
    // ——不能靠「不设 PG_*」，那样抛在 `resolveDatabaseUrl`，验不到「连了但查不动」这一段。
    const restore = restorePoint({
      PG_HOST: "127.0.0.1",
      PG_PORT: "1",
      PG_USER: "postgres",
      PG_PASSWORD: "postgres",
      PG_DATABASE: "postgres",
    })

    try {
      const response = await request(app(ON), await cookieFor(crypto.randomUUID()))

      expect(response.status).toBe(204)
    } finally {
      restore()
    }
  })
})
