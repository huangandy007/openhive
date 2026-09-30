import { describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync } from "fs"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, Layer, type Scope } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { User } from "@opencode-ai/core/user"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

/**
 * T005：**同一条查询代码，按当前 fiber 的身份落到不同库文件**。
 *
 * 这是本 feature 的核心出参（`tasks.md` T005：「A/B 查询落各自 db 文件」）。
 *
 * 与 `database-router.test.ts`（T004）的分工：那边只测**注册表本身**（给它 userId，
 * 它给出该用户的库），**不读任何上下文**；本组测的是**取连接点**——`Database.Service`
 * 还是主树那一个、查询代码一字不改，落点却随身份变。
 *
 * 断言一律用 `bun:sqlite` **直接读库文件**，不经过我们自己的代码——否则就是拿被测对象
 * 去证明被测对象（`LEARNINGS #002-02`：没真正执行被测路径的，不是测试）。
 */

const alice = { id: "alice", policeNo: "0001", name: "爱丽丝", isAdmin: false }
const bob = { id: "bob", policeNo: "0002", name: "鲍勃", isAdmin: false }

const userDb = (root: string, userId: string) => path.join(root, userId, "opencode.db")

/** 直接读库文件里的 `probe` 表；文件不存在或表不存在都返回 `[]`。 */
function probeValues(file: string): string[] {
  if (!existsSync(file)) return []
  const db = new Sqlite(file)
  try {
    const rows = db.query("SELECT v FROM probe ORDER BY v").all() as Array<{ v: string }>
    return rows.map((row) => row.v)
  } catch {
    return [] // 表不存在
  } finally {
    db.close()
  }
}

describe("Database 取连接点按身份路由（T005）", () => {
  const withTmp = <A, E>(f: (tmp: string, root: string, mainFile: string) => Effect.Effect<A, E, Scope.Scope>) =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      return yield* f(tmp.path, path.join(tmp.path, "data"), path.join(tmp.path, "main.db"))
    })

  /**
   * 主树 = `Database.Service`（生产里是 `Database.node` 那一份）+ 路由层（提供注册表与钩子）。
   * 查询代码**只认主树那一份**，身份靠 `provideService(User.Service, …)` 注入。
   */
  const withEnv = <A, E>(
    root: string,
    mainFile: string,
    f: () => Effect.Effect<A, E, Scope.Scope | Database.Service | DatabaseRouter.Service>,
  ) =>
    f().pipe(
      Effect.provide(Layer.mergeAll(Database.layerFromPath(mainFile), DatabaseRouter.layer({ root }))),
    )

  const write = (value: string) =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.run(sql`CREATE TABLE IF NOT EXISTS probe (v TEXT)`).pipe(Effect.orDie)
      yield* db.run(sql`INSERT INTO probe (v) VALUES (${value})`).pipe(Effect.orDie)
    })

  it.effect(
    "两个用户的查询分别落到各自的库文件，主树那份一个都不落",
    () =>
      withTmp((tmp, root, mainFile) =>
        withEnv(root, mainFile, () =>
          Effect.gen(function* () {
            yield* write("alice").pipe(Effect.provideService(User.Service, alice))
            yield* write("bob").pipe(Effect.provideService(User.Service, bob))

            expect(probeValues(userDb(root, "alice"))).toEqual(["alice"])
            expect(probeValues(userDb(root, "bob"))).toEqual(["bob"])
            // 主树那份**不该**收到任何一条——否则就是「路由没生效、只是额外多写了一份」
            expect(probeValues(mainFile)).toEqual([])
          }),
        ),
      ),
    10_000,
  )

  /**
   * 非 HTTP 入口（CLI / TUI / ACP）**没有 `User`**，回退目标 = 现状的 `path()` 结果。
   * 判据按裁定条件 3：**按「谁在跑」而非「有没有 User」**——这里就是「确实没有身份」的那条。
   */
  /**
   * 事务路径。`SqlClient.reserve` **就是** `transactionAcquirer`——事务取连接走的是它，
   * 不是普通查询那条 `acquirer`。两条都路由才算完整：只路由前者的话，事务会写回主树。
   *
   * 直接驱动 `reserve` 而不是搭一个 drizzle 事务：它测的正是我们改动的那条路径，
   * 少一层与本次无关的机制（同 `LEARNINGS #002-02`：要么真跑被测路径，要么算缺口）。
   */
  it.effect(
    "事务路径（reserve）也按身份路由，不写回主树",
    () =>
      withTmp((tmp, root, mainFile) =>
        withEnv(root, mainFile, () =>
          Effect.gen(function* () {
            const { db } = yield* Database.Service

            yield* Effect.scoped(
              Effect.provideService(
                Effect.flatMap(db.$client.reserve, (connection) =>
                  Effect.flatMap(connection.executeRaw("CREATE TABLE IF NOT EXISTS probe (v TEXT)", []), () =>
                    connection.executeRaw("INSERT INTO probe (v) VALUES ('tx')", []),
                  ),
                ),
                User.Service,
                alice,
              ),
            ).pipe(Effect.orDie)

            expect(probeValues(userDb(root, "alice"))).toEqual(["tx"])
            expect(probeValues(mainFile)).toEqual([])
          }),
        ),
      ),
    10_000,
  )

  it.effect(
    "没有身份时回退到本层自己的库（CLI / TUI 路径）",
    () =>
      withTmp((tmp, root, mainFile) =>
        withEnv(root, mainFile, () =>
          Effect.gen(function* () {
            yield* write("local")

            expect(probeValues(mainFile)).toEqual(["local"])
            expect(probeValues(userDb(root, "alice"))).toEqual([])
          }),
        ),
      ),
    10_000,
  )
})
