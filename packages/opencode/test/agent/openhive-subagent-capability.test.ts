import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { expect, test } from "bun:test"
import type { Agent } from "../../src/agent/agent"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import { Permission } from "../../src/permission"

/**
 * **I2（2026-10-05）· 子会话必须继承 capability 的 allow。**
 *
 * ## 洞长在哪
 *
 * `deriveSubagentSessionPermission`（上游文件 `src/agent/subagent-permissions.ts`）从父会话的
 * 规则集里**只留下 deny**（`rule.action === "deny"`）。这个取舍在上游是对的：子代理由自己的
 * `agent.permission` 说话，不该白拿父会话的授权。
 *
 * 但 004 的 capability 是**成对**下发的：「整体 deny ＋ 逐条 allow」（`AccessSession.sessionRuleset`）。
 * 只把 deny 传下去 ⇒ 父会话里那条 `{ skill, "*", deny }` 到了子会话**仍然是硬拒**，而配对的
 * `{ skill, "fund-analysis", allow }` 被丢掉了 ⇒ **父会话授过的 skill，在子会话里用不了**。
 * 不是「弹个询问」，是 `evaluate` 判 `deny`——**功能整个哑掉**，且不报错、不变红。
 *
 * ## 判定口径（本文件钉死的那一条）
 *
 * 上游丢 allow 是为了「子会话别白拿父会话的授权」。而 004 引入的**硬拒**会让这条取舍变成
 * 过拒。所以口径取**最小的一侧**：
 *
 * > 父会话里**某 permission 被整体 deny 时**（`{ permission, "*", deny }`），
 * > 该 permission 的那些 allow **照原序留下**。
 *
 * 三个后果，各自有测试：
 * - 受管 skill：授过的照旧放行 ①、没授的照旧硬拒 ②；
 * - **非受管**的 allow（没有整体 deny 罩着它）**照旧被丢** ③ —— 上游语义没被放宽；
 * - `mcp` 那对（granted 时是 `{fund_db_*, "*", allow}`、**没有**整体 deny 罩着）**照旧不继承** ④
 *   —— 这是**已知缺口**不是设计目标，④ 把它钉在明面上（见那条注释）。
 *
 * ## 判据用真判决器
 *
 * 这里的 `Permission.evaluate` 就是链 A 的 `evaluate`（`src/permission/index.ts`），
 * 而且**照 `src/session/prompt.ts` 的写法**合并：`merge(subagent.permission, 派生结果)`
 * ——派生结果在后 ⇒ 它是最后的话事人。断言写成「子会话到底放不放」，不是「数组里有没有某条」。
 *
 * ⚠️ 上游那四条（`plan-mode-subagent-bypass.test.ts`）的父会话规则集是 `[]` 或只有
 * `{ bash, "*", deny }`，两边的 allow 一个都没有 ⇒ 本次改动**在它们身上逐字等价**
 * （`blanketDenied` 为空 ⇒ 新增的那个 `||` 分支永不成立）。它们不用改，也不该改。
 */

/**
 * 子代理桩。默认自带 `task` / `todowrite` 授权——`deriveSubagentSessionPermission` 会给
 * **没有**这两项的子代理各补一条整体 deny（上游行为），留着它们会让下面每条 `toEqual`
 * 都被两条无关规则淹没。自带授权 ⇒ 派生结果里只剩被测的那几条。
 */
function subagent(permission: Parameters<typeof Permission.fromConfig>[0] = { task: "allow", todowrite: "allow" }): Agent.Info {
  return {
    name: "general",
    mode: "subagent",
    permission: Permission.fromConfig(permission),
    options: {},
  } satisfies Agent.Info
}

/** 复刻 `src/session/prompt.ts` 的合并写法：派生结果在后。 */
const effective = (parent: PermissionV1.Ruleset, agent: Agent.Info = subagent()) =>
  Permission.merge(agent.permission, deriveSubagentSessionPermission({ parentSessionPermission: parent, subagent: agent }))

/** capability 授过 `fund-analysis` 时的父会话规则集（与 `sessionRuleset` 逐字同形）。 */
const GRANTED: PermissionV1.Ruleset = [
  { permission: "skill", pattern: "*", action: "deny" },
  { permission: "skill", pattern: "fund-analysis", action: "allow" },
]

/** 一条授权行都没有时：只有整体 deny（同样是 `sessionRuleset` 的形状）。 */
const UNGRANTED: PermissionV1.Ruleset = [{ permission: "skill", pattern: "*", action: "deny" }]

test("① 父会话授过的 skill ⇒ 子会话照旧放行（allow 被继承）", () => {
  const ruleset = effective(GRANTED)

  expect(Permission.evaluate("skill", "fund-analysis", ruleset).action).toBe("allow")
})

test("① 对照：同一份规则集里没授的 skill 仍然是 deny（不是「一律放行」）", () => {
  const ruleset = effective(GRANTED)

  expect(Permission.evaluate("skill", "call-analysis", ruleset).action).toBe("deny")
})

test("② 一条授权都没有 ⇒ 子会话照旧硬拒（不凭空造 allow）", () => {
  const ruleset = effective(UNGRANTED)

  expect(Permission.evaluate("skill", "fund-analysis", ruleset).action).toBe("deny")
})

test("② 派生结果与父会话逐字相同（整体 deny 那条也还在）", () => {
  // 顺序也是语义（`evaluate` 取 `findLast`）：allow 必须在整体 deny **之后**。
  expect(deriveSubagentSessionPermission({ parentSessionPermission: GRANTED, subagent: subagent() })).toEqual(GRANTED)
})

/**
 * 🔴 **上游语义未被放宽**：没有被整体 deny 罩着的 allow，照旧一个都不传。
 *
 * 少了这条，改动可以偷懒写成「凡是 allow 就留下」——那样每个子会话都白拿父会话的全部授权，
 * 正是上游那个 filter 当初要拦住的事。`bash` 不是 capability 的受管 permission，没有
 * `{ bash, "*", deny }` 罩着它 ⇒ 必须照旧被丢。
 */
test("③ 非受管的 allow 照旧被丢（上游语义没放宽）", () => {
  const parent: PermissionV1.Ruleset = [{ permission: "bash", pattern: "src/**", action: "allow" }]

  expect(deriveSubagentSessionPermission({ parentSessionPermission: parent, subagent: subagent() })).toEqual([])
})

test("③ 父子会话的 deny 照旧传播（这条是上游既有行为，不能顺手改掉）", () => {
  const parent: PermissionV1.Ruleset = [
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "external_directory", pattern: "/tmp/**", action: "allow" },
  ]

  expect(deriveSubagentSessionPermission({ parentSessionPermission: parent, subagent: subagent() })).toEqual(parent)
})

/**
 * ⚠️ **已知缺口（钉在明面上，不是设计目标）**：`mcp` 那一对在**授过**的时候是
 * `{ fund_db_*, "*", allow }`——它**没有**整体 deny 罩着（整体 deny 只出现在未授权时），
 * 所以按上面的口径**照旧不继承** ⇒ 子会话里这个 server 的工具落回上游 `ask`。
 *
 * **为什么先不修**：要覆盖它就得把口径放宽成「父会话里某 permission 出现过 `pattern: "*"` 就
 * 继承它的 allow」，而那会把**客户端自带的**整体 allow（`CreateInput.permission` 可填）一并
 * 传进子会话——那是上游那个 filter 明确要拦的东西。两头都试过，取**不越权**的一侧：
 * 缺口是「多弹一次询问」（父会话本来就授过这个 server，不存在自批进去），
 * 放宽是「子会话白拿父会话的授权」。挂账见 `004/state.md`。
 *
 * 未授权时**没有**缺口：`{ call_db_*, "*", deny }` 是整体 deny ⇒ 照旧传播 ⇒ 子会话硬拒。
 */
test("④ 已知缺口：mcp 授过的 server 在子会话里不继承 allow（挂账，见注释）", () => {
  const parent: PermissionV1.Ruleset = [{ permission: "fund_db_*", pattern: "*", action: "allow" }]

  expect(deriveSubagentSessionPermission({ parentSessionPermission: parent, subagent: subagent() })).toEqual([])
})

test("④ 对照：mcp 未授权的 server 照旧硬拒（整体 deny 会传播）", () => {
  const parent: PermissionV1.Ruleset = [
    { permission: "call_db_*", pattern: "*", action: "deny" },
    { permission: "read", pattern: "mcp:call.db:*", action: "deny" },
  ]

  const ruleset = effective(parent)

  expect(Permission.evaluate("call_db_query", "*", ruleset).action).toBe("deny")
  expect(Permission.evaluate("read", "mcp:call.db:ledger", ruleset).action).toBe("deny")
})
