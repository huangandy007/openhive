export * as GovernanceAuthz from "./governance-authz"

/**
 * 治理板块准入的**唯一接线点**（010 T010 / FR-009）。
 *
 * 判定本身仍是 `@opencode-ai/auth/governance` 的 `authorizeGovernance`（T003，一字不改）；
 * 本模块只补一件事：**拒绝要留痕**。此前 5 个治理模块各自写了一个一模一样的 `有权()`
 * 闭包（`#002-06` 的形状），谁都能漏掉记账——收成一处之后，「所有治理 403 都有审计行」
 * 变成接线时看得见的事实，而不是 5 份实现各自的自觉。
 *
 * ## 为什么记录放在这里、而不在各出口的 `forbidden()` 里
 *
 * 各模块的 `forbidden()` 只有一块板子的固定文案，不拿 `perm`；而审计要回答「他缺哪个动作」
 * （管理员缺 `admin` 与普通民警缺 `write` 是两种事）。`进()` 手里正好有 `perm`，
 * 且它是**返回 `false` 之前的最后一个动作**——不会出现「回了 403 但忘了记」。
 *
 * ## 不记的两种情况
 *
 * - **无凭证 401**：出口在 `Option.isNone(身份)` 就返回了，根本走不到这里（见 `audit.ts` 文件头）。
 * - **判定本身炸了**（库断连等）：那是 500，`Effect.promise` 的 defect 照旧向上抛；
 *   审计行写不进去，业务也已经失败——不额外吞异常（同各出口的 `Effect.die`）。
 */

import { authorizeGovernance, type GovernancePerm } from "@opencode-ai/auth/governance"
import { Effect } from "effect"
import { OpenhiveAudit } from "./audit"
import type { OpenhivePg } from "./pg"

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

/**
 * 「这人能不能在本板块做这个动作」＋ 不能就记一行 `governance.denied`。
 *
 * ⚠️ 调用方必须把它排在**一切副作用之前**（`#004-09`）：它既是授权门，也是拒绝审计的
 * 唯一落点，排在解析之后会让「民警递畸形 JSON」拿到 400 且不留痕。
 */
export function 进(
  deps: Deps,
  userId: string,
  board: string,
  perm: GovernancePerm,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    // 每请求查库，不缓存（改授权应立即生效，见 `governance.ts` 文件头）。
    const allowed = yield* Effect.promise(() => authorizeGovernance(deps.pg(), { userId, board, perm }))
    if (allowed) return true
    yield* OpenhiveAudit.记治理(deps, userId, {
      board,
      action: "governance.denied",
      result: "denied",
      detail: { perm },
    })
    return false
  })
}
