import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { Effect, Option, Stream } from "effect"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { DatabaseConnectionRouting } from "../src/database/connection-routing"
import { it } from "./lib/effect"

/**
 * `DatabaseConnectionRouting.routed` —— **两支 sqlite 共用的那一份**取连接路由逻辑（T005）。
 *
 * 为什么它值得有自己的测试，而不是只靠 `database-routing.test.ts` 那条端到端的：
 * `#sqlite` 是**条件解析**的（`bun` → `sqlite.bun.ts`、`node` → `sqlite.node.ts`），
 * 而本机 bun **不提供 `node:sqlite`**（加载 `sqlite.node.ts` 即 `No such built-in module`）
 * ⇒ node 那一支在本机一行都跑不到。逻辑抽成一份放在这里，至少保证
 * **node 支调用的那个函数**是被测过的；剩下的残差见文件末尾。
 *
 * 这里用哨兵连接而不是真库：被测的就是「**选哪个连接**」，哨兵让这条断言变成
 * 「结果认得出来」，不落盘、不依赖文件系统行为。
 */
const probe = (tag: string): Connection => ({
  execute: () => Effect.succeed([{ tag }]),
  executeRaw: () => Effect.succeed([{ tag }]),
  executeValues: () => Effect.succeed([[tag]]),
  executeUnprepared: () => Effect.succeed([{ tag }]),
  executeStream: () => Stream.die("哨兵不该被流式调用"),
})

const withHook = <A, E, R>(self: Effect.Effect<A, E, R>, tag: string | undefined) =>
  Effect.provideService(self, DatabaseConnectionRouting.Hook, {
    resolve: () => (tag === undefined ? Option.none() : Option.some(Effect.succeed(probe(tag)))),
  })

/** 取 `routed` 选中的连接跑了什么——这是本组唯一要断言的东西。 */
const selected = (fallbackTag: string, hookTag: string | undefined) =>
  Effect.flatMap(DatabaseConnectionRouting.routed(Effect.succeed(probe(fallbackTag))), (c) =>
    c.executeRaw("", []),
  ).pipe((self) => withHook(self, hookTag))

describe("取连接路由：选哪个连接（T005）", () => {
  it.effect("有钩子且钩子给了连接：用钩子给的，不用本层的", () =>
    Effect.gen(function* () {
      expect(yield* selected("local", "routed")).toEqual([{ tag: "routed" }])
    }),
  )

  // 「不认识这个 fiber」——非 HTTP 入口（CLI / TUI / ACP）走的就是这条，
  // 行为必须与加钩子之前逐字相同，否则是零回归层面的破坏。
  it.effect("有钩子但钩子说 None：回退本层连接", () =>
    Effect.gen(function* () {
      expect(yield* selected("local", undefined)).toEqual([{ tag: "local" }])
    }),
  )

  // 门关着 / 没装路由层的场景：连钩子都没有。
  it.effect("没有钩子：回退本层连接", () =>
    Effect.gen(function* () {
      const rows = yield* Effect.flatMap(DatabaseConnectionRouting.routed(Effect.succeed(probe("local"))), (c) =>
        c.executeRaw("", []),
      )

      expect(rows).toEqual([{ tag: "local" }])
    }),
  )
})

/**
 * ⚠️ **这两条是形状守卫，不是行为验证**——它们读源码文本，证明不了 node 支跑起来对。
 *
 * 存在的理由：`sqlite.node.ts` 在本机加载即报错，**漏接不会有任何东西变红**
 * （正是 `#002-01` 那类「另一条路径上没人跑」的缺口）。行为验证交给
 * `database-routing.test.ts`（端到端，走 bun 支）+ 上面三条（共用逻辑）。
 * 真要在 node 条件下验证，需要 CI 提供 node 运行时——**那才是补齐，这里只是护栏。**
 */
describe("两支 sqlite 都接了路由（形状守卫）", () => {
  const source = (file: string) => readFileSync(new URL(`../src/database/${file}`, import.meta.url), "utf8")

  for (const file of ["sqlite.bun.ts", "sqlite.node.ts"]) {
    test(`${file}：普通查询与事务路径都接了`, () => {
      const text = source(file)

      expect(text).toContain("routed(localAcquirer)")
      // 事务那条最容易被漏：`SqlClient.reserve` 用的就是它，漏了事务会写回错库。
      expect(text).toContain("routed(localTransactionAcquirer)")
    })
  }
})
