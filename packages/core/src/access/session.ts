export * as AccessSession from "./session"

import { AccessRbac } from "./rbac"
import { PermissionV1 } from "../v1/permission"

/**
 * **授权行 → 链 A（opencode v1）的会话规则集**（T006 / FR-004）。
 *
 * ## 为什么住在 core、而不是某一侧的 server 目录
 *
 * 这是纯函数（认「已经取出来的授权行」，碰不到库），两条链都该看得到它。放进
 * `packages/opencode/src/server/` 会在两个方向上出问题：
 * - **取行**那一步（user → 角色 → 授权 的 join）**必须**在 `packages/opencode` 做——
 *   全仓只有它同时依赖 `auth` 与 `core`（实测）。那是**接线**，留在了
 *   `packages/opencode/src/server/openhive/access.ts`。
 * - 而**形状**（授权行怎么说成一条 v1 规则集）是**判定**，按 D0-1 的裁定落 core
 *   （与 `AccessRbac.resolve` 的 v2 投影并列）。放 opencode 的话，
 *   `src/session/prompt.ts`（T006 的第二处消费者）就得 import `src/server/…`
 *   —— 那是一条**今天全仓不存在的边**（`src/session/` → `src/server/`，实测为零命中），
 *   方向是反的。
 *
 * ## v2 与 v1 是同一判定的两个投影
 *
 * `AccessRbac.resolve()` 出 v2（`{action, resource, effect}`，喂链 B 与 capability）；
 * 本文件出 v1（`{permission, pattern, action}`，喂链 A 的 `evaluate`）。字段名不同、
 * **匹配语义同源**——两边都用 `@opencode-ai/core/util/wildcard` 的 `Wildcard.match`，
 * 且都是「后者胜」（`findLast`）。这条等式是**实测**的，见
 * `packages/opencode/test/server/openhive-access.test.ts`：那里拿链 A 的真判决器
 * （`src/permission` 的 `evaluate`）直接验，不复刻匹配器（`LEARNINGS #003-05`：
 * 镜子复刻出来就是假的——写的时候以为对上了，其实只在一边成立）。
 */

/**
 * 受 RBAC 管辖、且**能**用「整体 deny ＋ 逐条 allow」这套写法的**资源类型**。
 *
 * ⚠️ 与 `AccessRbac.TOOL_OF` 的**键集今天相等**（都只有 `skill`），但**不是同一个概念**，
 * 所以是两张表、不互相派生：
 * - `TOOL_OF` 说的是「这个类型**投到哪个工具**」；
 * - `GOVERNED` 说的是「这个工具**能不能**先整体拒掉再逐条开」。
 *
 * 将来 `TOOL_OF` 多了 `mcp`，`GOVERNED` **不能**跟着加：链 A 的 MCP 资源工具用的是
 * `{ permission: "read", patterns: ["mcp:<server>:*"] }`（`packages/opencode/src/session/tools.ts`
 * 实测），**与文件读取同名**——给它补一条整体 `deny read:*` 会把民警读文件一起拒掉。
 * `openhive-access.test.ts` ⑥ 把这两张表的键集钉成相等断言，**故意**是条警报：加 mcp 时它会红，
 * 逼人回来回答「这个工具名是不是被别的用途共用了」。
 *
 * 派生就没这条警报了（表与断言同源 ⇒ 恒真）——所以**手写**，不写成 `Object.keys(TOOL_OF)`。
 */
export const GOVERNED: readonly AccessRbac.ResourceType[] = ["skill"]

/**
 * 授权行 → **一条会话规则集**，形状是「**先整体 deny，再逐条 allow**」。
 *
 * 顺序是语义不是排版：链 A 的 `evaluate` 取 `findLast`（**后者胜**，
 * `packages/opencode/src/permission/index.ts` 的 `evaluate`）——授过的 skill 两条都命中、
 * 取到后面的 allow；没授的只有整体 deny 命中。
 *
 * 🔴 **零授权也照样出一条 deny，绝不返回空集**：空集 ⇒ 落回上游兜底 `ask`，而 skill 工具
 * 带 `always`（`packages/opencode/src/tool/skill.ts`）⇒ 界面上给民警一个「总是允许」的按钮 ⇒
 * **没被授予的 skill，民警可以自己把自己批进去**，且那条 allow 会进 `approved`、压过整条
 * 会话规则集（`ask` 把 `approved` 排在最后）。一条 deny 把这条路堵死：deny 不进询问，
 * 就没有「总是允许」可点。这正是宪法反模式「用前端隐藏资源替代权限校验」。
 */
export function sessionRuleset(grants: readonly AccessRbac.Grant[]): PermissionV1.Ruleset {
  const rules: PermissionV1.Rule[] = []

  // ① 先铺整体 deny（每个受管类型一条）。
  for (const type of GOVERNED) {
    const tool = AccessRbac.TOOL_OF[type]
    if (tool === undefined) continue
    rules.push({ permission: tool, pattern: "*", action: "deny" })
  }

  // ② 再逐条 allow。`resolve()` 只产 allow（`role_resource` 表没有 effect 列）。
  //    v2 的 `{action, resource, effect}` → v1 的 `{permission, pattern, action}`：字段改名，
  //    匹配语义同源（见文件头）。
  for (const rule of AccessRbac.resolve(grants)) {
    rules.push({ permission: rule.action, pattern: rule.resource, action: rule.effect })
  }

  return rules
}

/**
 * 把**客户端送来的规则**并进既有规则集（capability 必须留到最后）。
 *
 * 🔴 修的是 `packages/opencode/src/session/prompt.ts` 的一处越权：那里在 `input.tools`
 * 非空时**整体覆盖** `session.permission`，而 `input.tools` 是**客户端发来的**
 * （`PromptInput.tools`）——于是 `tools: { skill: true }` 就能把 capability 整个抹掉，
 * **一次请求绕过 RBAC**。同一形状在会话创建端点上也有一份（客户端可在 `CreateInput.permission`
 * 里自带规则），所以本函数在**两处**被调用，调用点都传「客户端在前、既有在后」。
 *
 * 本函数把客户端规则排在**前面**、既有规则（capability）留在**后面**：`evaluate` 取
 * `findLast` ⇒ capability 永远是最后的话事人。
 *
 * 幂等：按 `(permission, pattern, action)` 去重、**保留首次出现**。并进来是会被逐次写回
 * `session.permission` 的——不去重会随每次 prompt 增长（同一条规则翻倍），既泄漏存储、
 * 也让「这条会话到底有什么规则」没法直读。
 */
export function mergeClientRules(
  client: PermissionV1.Ruleset,
  existing: PermissionV1.Ruleset,
): PermissionV1.Rule[] {
  const seen = new Set<string>()
  const merged: PermissionV1.Rule[] = []
  for (const rule of [...client, ...existing]) {
    const key = `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(rule)
  }
  return merged
}
