import { describe, expect, test } from "bun:test"
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, Fiber, type Scope } from "effect"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

/**
 * T004：`Map<userId, 连接>` —— 惰性打开 + 复用 + 各自 PRAGMA。
 *
 * 这里只测**注册表本身**：给它一个 userId，它给出那个用户独有的 `Database.Interface`。
 * **「从请求的 `User` 上下文取 userId」是 T005 的事**，不在本组断言里。
 */
describe("DatabaseRouter", () => {
  describe("路径", () => {
    it.effect("默认根是 /data，可由 OPENHIVE_DATA_ROOT 覆盖", () =>
      Effect.sync(() => {
        expect(DatabaseRouter.dataRoot({})).toBe("/data")
        expect(DatabaseRouter.dataRoot({ OPENHIVE_DATA_ROOT: "/srv/data" })).toBe("/srv/data")
        // 空串（env 设了但没值）按没设处理，不要产出 `/" "/{userId}` 这种相对路径
        expect(DatabaseRouter.dataRoot({ OPENHIVE_DATA_ROOT: "" })).toBe("/data")
      }),
    )

    it.effect("用户库路径 = <root>/<userId>/opencode.db", () =>
      Effect.sync(() => {
        expect(DatabaseRouter.userDatabasePath("/srv/data", "u1")).toBe(
          path.join("/srv/data", "u1", "opencode.db"),
        )
      }),
    )

    /**
     * 校验与 002 的 `createWorkspace` **等价**（core 不能 import `@opencode-ai/auth`，
     * 故本地实现）：拦的是「拼出来的路径逃出根目录」这一类 userId。
     */
    it.effect("拒绝会逃出根目录的 userId", () =>
      Effect.sync(() => {
        for (const bad of ["", ".", "..", "a/b", "a\\b", "../evil", "a/../../b"])
          expect(() => DatabaseRouter.userDatabasePath("/data", bad)).toThrow()
      }),
    )
  })

  describe("多用户隔离", () => {
    const withRouter = <A, E>(
      root: string,
      f: (router: DatabaseRouter.Interface) => Effect.Effect<A, E, Scope.Scope>,
    ) =>
      Effect.gen(function* () {
        const router = yield* DatabaseRouter.Service
        return yield* f(router)
      }).pipe(Effect.provide(DatabaseRouter.layer({ root })))

    const withTmp = <A, E>(f: (root: string) => Effect.Effect<A, E, Scope.Scope>) =>
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        return yield* f(path.join(tmp.path, "data"))
      })

    const exists = (p: string) =>
      Effect.promise(() =>
        stat(p).then(
          () => true,
          () => false,
        ),
      )

    it.effect("一个用户一个库文件，各自 PRAGMA + 迁移都跑过", () =>
      withTmp((root) =>
        withRouter(root, (router) =>
          Effect.gen(function* () {
            const alice = yield* router.forUser("alice")
            const bob = yield* router.forUser("bob")

            yield* alice.db.run(sql`CREATE TABLE probe (v TEXT)`).pipe(Effect.orDie)
            yield* alice.db.run(sql`INSERT INTO probe (v) VALUES ('alice')`).pipe(Effect.orDie)

            // 迁移跑过 ⇒ 空库里也已经有真实业务表；PRAGMA 跑过 ⇒ WAL 生效
            expect(yield* alice.db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)).toMatchObject({
              journal_mode: "wal",
            })
            expect(
              yield* alice.db.get(sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'`),
            ).not.toMatchObject({ n: 0 })

            // 关键断言：bob 看不到 alice 写的任何东西（连表都不该有）
            expect(yield* bob.db.get(sql`SELECT count(*) AS n FROM sqlite_master WHERE name = 'probe'`)).toMatchObject({
              n: 0,
            })

            expect(yield* exists(path.join(root, "alice", "opencode.db"))).toBe(true)
            expect(yield* exists(path.join(root, "bob", "opencode.db"))).toBe(true)
          }),
        ),
      ),
    )

    it.effect("目录惰性创建：第一次取连接前不存在，取之后才有", () =>
      withTmp((root) =>
        withRouter(root, (router) =>
          Effect.gen(function* () {
            expect(yield* exists(path.join(root, "alice"))).toBe(false)
            yield* router.forUser("alice")
            expect(yield* exists(path.join(root, "alice"))).toBe(true)
            // 没碰过的用户不该被顺手建出来
            expect(yield* exists(path.join(root, "bob"))).toBe(false)
          }),
        ),
      ),
    )

    /**
     * 建库**失败不留缓存**（2026-10-02 代码审查 R-06）。
     *
     * `LayerMap` 底下是 `RcMap`，而 `RcMap.get` 在查表失败时做的是
     * `Deferred.doneUnsafe(entry.deferred, exit)`——**把失败也写进那个 Deferred**，而 entry
     * **不从 map 里删**。后果：同一个 userId 的第二次请求命中的是同一个 entry，
     * 直接**重放上一次的失败**。entry 要等引用计数归零 + `idleTimeToLive`（本模块给的是
     * **60 分钟**）才被回收 ⇒ 一次**瞬时**故障（磁盘满、目录被占、迁移撞锁）能让这个用户
     * **被自己那次失败锁住一个小时**，而这期间系统本身早已恢复正常。
     * 另外 `forUser` 是**每请求**走的（身份中间件塞的连接钩子），所以受害面是「该用户的全部请求」。
     *
     * 造法：把 `{root}/{userId}` **先占成一个文件**——`mkdir(dirname(库路径), {recursive:true})`
     * 会以 `EEXIST` 失败（实测过，不是推断）。随后**撤掉占位**，就是一次可恢复的瞬时故障。
     *
     * ⚠️ 这条钉的是「**失败了要能自愈**」，不是「失败长什么样」：两次都用 `Effect.exit` 观察，
     * 因为这条路上抛的是 **defect**（`Effect.promise` 的 rejection 就是 defect），
     * 只挡 typed error 的写法（`tapError`）在这里**一声不响**。
     */
    it.effect("第一次建库失败 ⇒ 不留缓存，下一次请求重试并成功（R-06）", () =>
      withTmp((root) =>
        withRouter(root, (router) =>
          Effect.gen(function* () {
            // 占出一个「不是目录」的 `{root}/u1`，让这一次建库必失败。
            // 根目录自己也要先建出来——`withTmp` 只给路径，不给目录（库目录是惰性建的）。
            yield* Effect.promise(() => mkdir(root, { recursive: true }))
            yield* Effect.promise(() => writeFile(path.join(root, "u1"), "占位"))
            const first = yield* Effect.exit(router.forUser("u1"))
            expect(first._tag).toBe("Failure")

            // 撤掉占位 —— 故障过去了
            yield* Effect.promise(() => rm(path.join(root, "u1"), { force: true }))

            const second = yield* Effect.exit(router.forUser("u1"))
            expect(second._tag).toBe("Success")
          }),
        ),
      ),
    )

    /**
     * **中断不算建库失败**，不逐出已经建好的库（复查 2026-10-02 · R2-03）。
     *
     * `forUser` 原先的判据是「`Exit` 不是 Success ⇒ `map.invalidate(userId)`」，而**中断也不是
     * Success**——于是「这个请求被取消」与「建库真的坏了」被当成同一件事。中断在这里是**日常**：
     * 每请求都会走 `forUser`（身份中间件塞的连接钩子），客户端断连、上游超时都会打断它。
     * 后果不是报错，是**无谓地逐出**：那个用户的库被从注册表里删掉，下一个请求重新 mkdir +
     * 开库 + 跑迁移；并且制造 `RcMap` 的交叉驱逐窗口（根因与残留见 `forUser` 的注释）。
     *
     * 造法：让**两次取用共享同一次建库**——第一个 fiber 起头建库（新用户，`mkdir` 处必然让出，
     * 所以这时 entry 已在 map 里、库还没建好），第二个 fiber 命中同一个 entry、挂在同一个
     * `Deferred` 上，此时打断它。真实场景就是「并发两个请求，第二个被客户端取消」。
     * 第一个照常拿到库；随后再取一次，**必须是同一次建库的产物**，而不是被逐出后新建的第二个。
     *
     * ⚠️ 判据是**对象同一性**（`toBe`），不是「能用」：新建的第二个库也能用——
     * 这正是这条缺陷难发现的原因（不会报错、不会变红，只是白白重建 + 埋下交叉驱逐）。
     */
    it.effect("中断（第二个取用被取消）不逐出正在建的库（R2-03）", () =>
      withTmp((root) =>
        withRouter(root, (router) =>
          Effect.gen(function* () {
            // `startImmediately`：两个 fiber 都必须**当场跑到各自的挂起点**，
            // 否则下面那次打断可能落在 `forUser` 之外（那就什么都没测到）。
            const builder = yield* router.forUser("alice").pipe(Effect.forkChild({ startImmediately: true }))
            const waiter = yield* router.forUser("alice").pipe(Effect.forkChild({ startImmediately: true }))
            yield* Fiber.interrupt(waiter)

            const first = yield* Fiber.join(builder)
            // 逐出过的话，这一枪会**再建一次**，拿回的是另一个 `Database.Interface`
            const second = yield* router.forUser("alice")

            expect(second).toBe(first)
          }),
        ),
      ),
    )

    /**
     * T007 出参之二：「`/data/{userId}/` **目录可写**（WAL 需在同目录建 `-wal`/`-shm`）」
     * （`isolation-scheme.md` §0.4 / §4）。
     *
     * 真往目录里写一个文件再读回来——**不是只看权限位**：win32 没有有意义的权限位
     * （见下一条的 skip 说明），位断言在那里恒真，等于没测。落盘才是 WAL 真正要的能力。
     */
    it.effect("目录可写：WAL 要在同目录建 -wal/-shm（只读目录会让 SQLite 打不开库）", () =>
      withTmp((root) =>
        withRouter(root, (router) =>
          Effect.gen(function* () {
            yield* router.forUser("alice")
            const canary = path.join(root, "alice", "canary")

            yield* Effect.promise(() => writeFile(canary, "wal-needs-this"))

            expect(yield* Effect.promise(() => readFile(canary, "utf8"))).toBe("wal-needs-this")
          }),
        ),
      ),
    )

    it.effect("同一用户重复取用是复用，不是重建", () =>
      withTmp((root) =>
        withRouter(root, (router) =>
          Effect.gen(function* () {
            const first = yield* router.forUser("alice")
            yield* first.db.run(sql`CREATE TABLE probe (v TEXT)`).pipe(Effect.orDie)
            yield* first.db.run(sql`INSERT INTO probe (v) VALUES ('kept')`).pipe(Effect.orDie)

            const second = yield* router.forUser("alice")

            expect(second).toBe(first)
            expect(yield* second.db.all(sql`SELECT v FROM probe`)).toEqual([{ v: "kept" }])
          }),
        ),
      ),
    )

    /**
     * T007 出参之三：「`0700`」（`isolation-scheme.md` §4 四条之一）。
     *
     * ⚠️ **本机（win32）跑不到**：实测 `mkdir({mode:0o700})` / 不传 mode / 建后 `chmod(0o700)`
     * 三者都得到 `666` —— 权限位在 Windows 上被完全忽略。故**显式 skip**，
     * 按 `LEARNINGS #002-02` 登记为**缺口而非覆盖**（见 `state.md`）。Linux CI 上真跑。
     *
     * 用 `test.skipIf` 而非 `it.effect`：`./lib/effect` 的 `it` 只挂了 `only`/`skip`，
     * **没有 `skipIf`**（`it.effect.skipIf` 是 undefined，会静默变成「跳过整条」或直接报错）。
     */
    test.skipIf(process.platform === "win32")("目录以 0700 建出（T007）", async () => {
      const mode = await Effect.runPromise(
        Effect.scoped(
          withTmp((root) =>
            withRouter(root, (router) =>
              Effect.gen(function* () {
                yield* router.forUser("alice")
                return (yield* Effect.promise(() => stat(path.join(root, "alice")))).mode & 0o777
              }),
            ),
          ),
        ),
      )

      expect(mode).toBe(0o700)
    })
  })
})
