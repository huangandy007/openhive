import { describe, expect } from "bun:test"
import { stat } from "fs/promises"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, type Scope } from "effect"
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
  })
})
