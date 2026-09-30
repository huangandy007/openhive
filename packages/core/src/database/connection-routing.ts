export * as DatabaseConnectionRouting from "./connection-routing"

import { Context, Effect, Option } from "effect"
import type * as Fiber from "effect/Fiber"
import type { Acquirer, Connection } from "effect/unstable/sql/SqlConnection"
import type { SqlError } from "effect/unstable/sql/SqlError"

/**
 * 「**取连接点路由**」的缝（T005）。
 *
 * `sqlite.bun.ts` 的 `acquirer` 是唯一能换库的地方：`Client.make` 的 `getConnection`
 * **每条查询都回调它**，返回哪个 connection 就落到哪个文件（实测见 `state.md`「T005 探针结论」）。
 * 但 `sqlite.bun.ts` 是**上游自有文件**，路由的实现不该长在里面——所以只在这里放**一个可选钩子**，
 * 默认（无钩子）逐字等于上游行为。
 *
 * ⚠️ **为什么不并进 `router.ts`**：`sqlite.bun.ts` 要 import 本文件，而 `router.ts` 已经
 * import 了 `database.ts`、后者又 import 了 `#sqlite` ⇒ 并进 `router.ts` 会形成
 * `sqlite.bun.ts → router.ts → database.ts → #sqlite → sqlite.bun.ts` 的**循环**。
 * 而 `database.ts` 在**模块求值期**就调用 `layerFromPath(path())`，谁先被求值都可能踩到
 * 尚未初始化的绑定（TDZ）。**本文件刻意不 import 任何本仓库的模块**，故无此风险。
 *
 * 分工：**这里只有 tag 与类型**；钩子的**实现**（读身份、选库、打断重入）全在 `router.ts`。
 */
export interface Interface {
  /**
   * 这次查询该用哪个连接。`None` = 不路由，调用方退回**本层自己的**连接。
   *
   * 收 `fiber` 而不是 `Context`：判定要同时看身份（`User.Service`）与重入保护（`Disabled`），
   * 而且必须看**发起查询的那个 fiber**——第三轮实测证明查询跑在调用方 fiber 里。
   */
  readonly resolve: (fiber: Fiber.Fiber<unknown, unknown>) => Option.Option<Acquirer>
}

/** 「按身份选库」的钩子。**不提供它 = 上游原样**（回退本层连接）。 */
export class Hook extends Context.Service<Hook, Interface>()("@opencode/openhive/DatabaseConnectionRouting") {}

/**
 * 把「本层自己的连接」包成「按发起查询的 fiber 的身份路由的连接」（T005）。
 *
 * **为什么抽在这里、不写进各支的 `sqlite.*.ts`**：`#sqlite` 是**条件解析**的
 * （`bun` → `sqlite.bun.ts`、`node` → `sqlite.node.ts`），而 `bun test` 只加载得到 bun 那一支
 * ——两份各写一遍的话，node 那份**永远不会被测到**，正是 `#002-01` 咬过两次的形状
 * （一个维度上咬一口，另一口留在没人跑的那条路径上）。抽成一份，就由 bun 支的测试覆盖同一段代码。
 *
 * ⚠️ 残差（别当成已覆盖）：本机 bun **不提供 `node:sqlite`**，`sqlite.node.ts` 加载即报
 * `No such built-in module`，所以 node 那一支**只到「调用点接对了」这一层**，
 * 「node 条件下真跑起来路由生效」仍**未验证**，需 CI 提供 node 运行时。
 *
 * 断言的理由：`Acquirer` 的**类型标注**带 `Scope`，但 `transactionAcquirer`
 * （`reserve` 给回来的就是它）实际是 `Effect.uninterruptibleMask(...)`，
 * 它从 fiber 上下文 `getUnsafe` 取 Scope，**R 通道上并不要求 Scope**。
 * 不收窄的话 `client.export` / `loadExtension` 的 R 会多出一个 `Scope`，
 * 与 `SqliteClient` 接口（无 R）对不上——那是上游的两行，不去动它。
 */
export const routed = <C extends Connection>(
  fallback: Effect.Effect<C, SqlError>,
): Effect.Effect<C, SqlError> =>
  Effect.withFiber((fiber) =>
    Option.match(Context.getOption(fiber.context, Hook), {
      onNone: () => fallback,
      onSome: (hook) =>
        Option.match(hook.resolve(fiber), {
          onNone: () => fallback,
          onSome: (acquirer) => acquirer as Effect.Effect<C, SqlError>,
        }),
    }),
  )

/**
 * 重入保护：解析路由期间把它放进 context，钩子见它即**不再路由**。
 *
 * 没有它必**死锁**（不是报错）：per-user 树在**调用方 fiber** 里构建，而它的构建体自己就要跑
 * 6 条 PRAGMA + `DatabaseMigration.apply`；那些建层期查询会再次命中钩子、以**同一个 key**
 * 重入 `LayerMap`，把这次构建拖成超时（T005 探针 Q3-② 实测：5s 挂住、无错误）。
 */
export class Disabled extends Context.Service<Disabled, true>()(
  "@opencode/openhive/DatabaseConnectionRoutingDisabled",
) {}
