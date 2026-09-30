export * as DatabaseConnectionRouting from "./connection-routing"

import { Context } from "effect"
import type * as Fiber from "effect/Fiber"
import type * as Option from "effect/Option"
import type { Acquirer } from "effect/unstable/sql/SqlConnection"

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
 * 重入保护：解析路由期间把它放进 context，钩子见它即**不再路由**。
 *
 * 没有它必**死锁**（不是报错）：per-user 树在**调用方 fiber** 里构建，而它的构建体自己就要跑
 * 6 条 PRAGMA + `DatabaseMigration.apply`；那些建层期查询会再次命中钩子、以**同一个 key**
 * 重入 `LayerMap`，把这次构建拖成超时（T005 探针 Q3-② 实测：5s 挂住、无错误）。
 */
export class Disabled extends Context.Service<Disabled, true>()(
  "@opencode/openhive/DatabaseConnectionRoutingDisabled",
) {}
