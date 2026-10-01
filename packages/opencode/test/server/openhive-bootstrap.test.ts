/**
 * 003 T019 · 引导首个管理员的**接线**：开关读没读、什么时候跑。
 *
 * **与 `packages/auth/src/bootstrap.test.ts` 的分工**（别把两边写重）：
 * 那边测「引导逻辑对不对」（表里有没有管理员、提权提了谁、建出来的行长什么样），
 * 这边测「引导有没有被调用」——环境变量从哪读、跑在迁移之前还是之后、开关关掉时动不动库。
 * 逻辑错了那组红，接线错了这组红。
 *
 * 用**真应用**（`HttpApiApp.routes`，含 `createRoutes` 的全部接线）而不是最小路由：
 * 引导挂在 `AuthGateway.layer` 的**层构造期**，而层是装在 `createRoutes` 的中间件数组里的
 * （`Layer.buildWithMemoMap` 构建一次，见 `src/server/server.ts`）——最小路由测不出这件事。
 *
 * ⚠️ **不覆盖**（`LEARNINGS #002-02`：测不了的写成缺口，不写成覆盖）：
 * ① **「引导失败 ⇒ 进程起不来」这条语义在本夹具里验不到**。生产那条路是启动期显式
 *    `Layer.buildWithMemoMap`，层构造失败 = 监听器起不来；而 `HttpRouter.toWebHandler`
 *    是**惰性**建层（首个请求才建），失败会以一次请求失败的形式出现。见下面「库连不上」那条
 *    用例的注释——它钉的是「不静默跳过」，不是「进程退出」。
 * ② **多实例并发引导**（TOCTOU，见 `bootstrap.ts` 的注释）——单进程夹具起不了两个实例。
 *
 * 用**真库**（PGlite 经 TCP，002 的夹具）：引导要穿过 `connect(process.env)` → drizzle → PG
 * 三种形状，替身会让被测对象消失（`LEARNINGS #002-01`）。
 */

import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { BOOTSTRAP_ADMIN_POLICE_NO_ENV, DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { verifyPassword } from "@opencode-ai/auth/password"
import {
  DEPLOYED_DEFAULT_PASSWORD,
  PUBLIC_EXAMPLE_PASSWORD,
  restorePoint,
  withProductionDb,
} from "@opencode-ai/auth/test-support"
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
const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-bootstrap-"))
const DATA_ROOT = path.join(SANDBOX, "data")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/**
 * 引导建出来的管理员用的是**部署配的**默认口令，所以本文件也必须有这个变量——
 * 这一条不是可选的：网关开着（本文件就是）时，`routes` 的层构造期会解析它，缺失即抛。
 * 取值与理由写在 `@opencode-ai/auth/test-support` 上。
 */
const PW = DEPLOYED_DEFAULT_PASSWORD
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: PW })

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

/** 网关开着的最小环境。db 那一半由 `withProductionDb` 临时塞进 `process.env`。 */
const ON: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
}

/**
 * 真应用 + 指定环境变量。**一个夹具一个**，理由同 `openhive-gateway.test.ts`：
 * 每个 `app()` 的引导会自建一个 `bun-sql` 客户端，而同一台 PGlite 上两个客户端
 * **执行同一句 SQL 文本**必撞 42P05（`migrate()` 的 DDL 就是同一句），
 * 所以「起两个 app」在这里不是慢一点，是必挂。
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
 * 把服务端「推到启动完成」的那一次请求。
 *
 * 为什么要发请求：`HttpRouter.toWebHandler` 惰性建层，**层构造期那一段要等首个请求才跑**
 * （生产不是——`server.ts` 用 `Layer.buildWithMemoMap` 显式构建）。取登出是因为它最便宜：
 * 身份门豁免它、它本身也不碰库，于是这次请求唯一会碰库的地方就是**引导自己**。
 */
const boot = (gateway: ReturnType<typeof app>) =>
  Effect.runPromise(gateway(AuthGateway.PATH.logout, { method: "POST" }))

describe("引导首个管理员的接线", () => {
  test("开关没设 ⇒ 一个字段都不碰", async () => {
    // 这一条可以、也**必须**预先建表：开关没设时网关不跑迁移，客户端 A 是唯一跑 `migrate()`
    // 的人；开关设了的两条则相反（见 `app()` 的注释），不能调它。
    await withProductionDb(async (db) => {
      await migrate(db)

      const response = await boot(app(ON))

      // 先确认这次启动本身是成功的——不然「库里没行」可能只是「压根没跑起来」，
      // 一条永远绿的假测试（`LEARNINGS #002-02`）。
      expect(response.status).toBe(204)
      expect(await allUsers(db)).toHaveLength(0)
    })
  })

  test("开关设了 ⇒ 启动时跑一遍，且排在迁移之后", async () => {
    // 这一条**刻意不预先建表**：引导若排在迁移之前，`insert into auth.user` 会当场
    // 报 42P01（relation does not exist），请求随之失败。于是「先迁移、后引导」这个次序
    // 不是靠读代码确认的，是这条用例钉住的。
    await withProductionDb(async (db) => {
      const restore = restorePoint({ [BOOTSTRAP_ADMIN_POLICE_NO_ENV]: POLICE_NO })

      try {
        const response = await boot(app(ON))
        expect(response.status).toBe(204)
      } finally {
        restore()
      }

      const rows = await allUsers(db)
      expect(rows).toHaveLength(1)
      // 不加 `!`：本包没开 `noUncheckedIndexedAccess`（`packages/auth` 开了，那边同款断言要加），
      // 加了会被 `no-unnecessary-type-assertion` 判为多余。
      expect(rows[0].policeNo).toBe(POLICE_NO)
      expect(rows[0].isAdmin).toBe(1)
    })
  })

  test("引导出来的管理员，口令是**配置里那个**——不是文档示例值", async () => {
    await withProductionDb(async (db) => {
      const restore = restorePoint({ [BOOTSTRAP_ADMIN_POLICE_NO_ENV]: POLICE_NO })

      try {
        expect((await boot(app(ON))).status).toBe(204)
      } finally {
        restore()
      }

      const rows = await allUsers(db)
      expect(rows).toHaveLength(1)

      // ⚠️ **这两句合起来才是判据**：「拿配置值能验通」一句，一个仍写死
      // `"admin@123456"` 的实现**照样满足**（只要测试恰好拿它当配置值）——
      // 只有「文档示例值验不通」把「网关读了配置」与「网关还用着旧常量」分开
      // （`LEARNINGS #002-02`）。上一组用例断言的是行内容，验不到口令这一列。
      //
      // 走 `verifyPassword` 而不是再登录一次：登录会在 `routes` 那个客户端上**再准备一遍**
      // 引导已经在 `layer` 那个客户端上准备过的同一句取行 SQL，而同一台 PGlite 上两个客户端
      // 撞同一句 SQL 文本必报 42P05（见 `@opencode-ai/auth/test-support` 文件头）。
      // `verifyPassword` 是纯 JS（`Bun.password`），不碰库，把那个坑整个绕开。
      expect(await verifyPassword(PW, rows[0].passwordHash)).toBe(true)
      expect(await verifyPassword(PUBLIC_EXAMPLE_PASSWORD, rows[0].passwordHash)).toBe(false)
    })
  })

  test("开关设了但库连不上 ⇒ 不静默跳过，这次启动是失败的", async () => {
    // 钉的是「引导出错不许被吞掉」。有人给引导套一个 try/catch 让它「失败也继续启动」，
    // 这条就会红——而那正是 T019 要防的：系统带着「没有管理员」的状态安静地跑起来。
    //
    // ⚠️ 本夹具里表现为**这次请求失败**，不是**进程退出**：生产那条路是启动期显式建层
    // （`Layer.buildWithMemoMap`），层构造失败 = 监听器起不来；`toWebHandler` 是惰性建层。
    // 两者的差别记在文件头，这里不假装验到了后者。
    const restore = restorePoint({
      [BOOTSTRAP_ADMIN_POLICE_NO_ENV]: POLICE_NO,
      PG_HOST: "127.0.0.1",
      // 端口 1：本机必然拒绝连接。**不能靠「不设 PG_*」**——`connect()` 是惰性的，
      // 缺变量那一条会抛在 `resolveDatabaseUrl`，验不到「连上了但查询失败」这一段。
      PG_PORT: "1",
      PG_USER: "postgres",
      PG_PASSWORD: "postgres",
      PG_DATABASE: "postgres",
    })

    try {
      // 刻意**不写** `expect(...).rejects.toThrow()`：oxlint 的 `await-thenable` 认为 bun 的
      // `.rejects` 不是 thenable（第 161 条规则），而**顺着它去掉 `await` 会让这条断言空转**
      // ——拒绝没人接住，测试照绿。那正是 `LEARNINGS #002-02` 那类假绿，所以换个不会两难的形式：
      // 显式把两种结局都接住，再断言接到的是哪一种。
      const outcome = await boot(app(ON)).then(
        () => "启动成功",
        () => "启动失败",
      )
      expect(outcome).toBe("启动失败")
    } finally {
      restore()
    }
  })
})

/** 全表。引导是**表级**的判断，所以断言也多看全表而不是单行。 */
const allUsers = (db: Db) => db.select().from(user)
