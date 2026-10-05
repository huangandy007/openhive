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
 * `mcp` **不能**进 `GOVERNED`：链 A 的 MCP 资源工具用的是
 * `{ permission: "read", patterns: ["mcp:<server>:*"] }`（`packages/opencode/src/session/tools.ts`
 * 实测），**与文件读取同名**——给它补一条整体 `deny read:*` 会把民警读文件一起拒掉。
 * T007 因此给 mcp 另写了一段（见 `sessionRuleset` 的 ② 与 `McpServerNaming`），
 * 而不是往这两张表里塞。
 * `openhive-access.test.ts` ⑥ 把这两张表的键集钉成相等断言，**故意**是条警报：谁把 mcp 塞进
 * `TOOL_OF`，它会红，逼人回来回答「这个工具名是不是被别的用途共用了」。
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
export interface McpServerNaming {
  /**
   * 配置里的 server 名（`Config.mcp` 的键），**原样**。
   * 资源那一半的 pattern 是 `mcp:<server>:*`——`session/tools.ts` 的 `ask` 用的就是原样名
   * （它先把 `mcp.clients()` 的键列给模型，模型再把其中一个传回来），所以这里**不能**换写法。
   */
  readonly server: string
  /**
   * 该 server 的**工具名通配**，如 `fund.db` → `fund_db_*`。
   *
   * 🔴 **由调用方算好传进来，core 不自己拼**：翻译规则住在
   * `packages/opencode/src/mcp/catalog.ts` 的 `sanitize`（`McpCatalog.toolName` 用的就是它），
   * 而 **core 不依赖 opencode**（实测）——在这里抄一份 sanitize 就是
   * `LEARNINGS #003-05` 的假镜像（上游改了正则，这边不会红、只会静默失配）。
   *
   * ⚠️ **命名约束**：`sanitize(server) + "_"` **两两不得互为前缀**——否则两个 server 的工具名
   * 互相覆盖，授权随 `Config.mcp` 的**键序**漂移（不报错、不变红）。判据与例子见
   * {@link namingConflicts}；调用方**必须先跑一次那个函数**、有冲突就**拒绝建会话**。
   */
  readonly toolPattern: string
}

/**
 * 名单里的**前缀碰撞**：两个 server 的工具名通配互相覆盖 ⇒ 授权结果随 `Config.mcp` 的
 * **键序**漂移（`evaluate` 取 `findLast`，后者胜）。返回**冲突的名字对**；空数组 = 无冲突。
 *
 * ## 为什么会撞
 *
 * `toolPattern` 是 `sanitize(server) + "_" + "*"`（由调用方按 `McpCatalog.toolName` 算好），
 * 而工具名是 `sanitize(server) + "_" + sanitize(toolName)`。**那个 `_` 不是无歧义的分界**：
 * `sanitize` 把 `.` / `/` 之类一律换成 `_`（`packages/opencode/src/mcp/catalog.ts`），
 * 于是这些服务名会**产生同一个工具名**：
 *
 * | server A | A 的工具 | server B | B 的工具 | 撞在同一个工具名 |
 * |---|---|---|---|---|
 * | `fund`   | `db`      | `fund_db` | （其它） | `fund_db_…` |
 * | `a`      | `b/query` | `a_b`     | `query`  | `a_b_query` |
 *
 * 判据化成一条：把 `toolPattern` 末尾那个 `*` 去掉，得到 `sanitize(server) + "_"`；
 * 两个 server 碰撞 ⟺ **其中一个前缀是另一个的前缀**（`startsWith`，非严格 ⇒ 净化后同名也算）。
 * 例：`fund_db_` 是 `fund_db_prod_` 的前缀 ⇒ 撞；`fund_db_` 与 `fundx_` 互不为前缀 ⇒ 不撞。
 *
 * ## 为什么是「拒绝」而不是「换个顺序」
 *
 * 换个顺序只把「哪一边生效」挪个位置：撞键的两个 server 里**总有一个的工具被另一个的规则
 * 罩住**（要么被误 deny、要么被误 allow），且**不报错、不变红**。所以调用方应当
 * **拒绝建会话**（fail-closed）并要求改配置——见 `packages/opencode/src/server/openhive/access.ts`。
 *
 * ⚠️ 本函数**不碰 `sanitize`**：输入是已经翻译好的 `toolPattern`，它只做前缀比较
 * （core 不依赖 opencode；在这里抄一份 sanitize 就是 `LEARNINGS #003-05` 的假镜像）。
 */
export function namingConflicts(servers: readonly McpServerNaming[]): ReadonlyArray<readonly [string, string]> {
  const prefixes = servers.map((naming) => ({
    server: naming.server,
    // 末尾的 `*` 是通配符不是名字的一部分：去掉它才拿到「前缀」。
    prefix: naming.toolPattern.endsWith("*") ? naming.toolPattern.slice(0, -1) : naming.toolPattern,
  }))

  const conflicts: Array<readonly [string, string]> = []
  for (const [i, a] of prefixes.entries()) {
    for (const b of prefixes.slice(i + 1)) {
      if (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix)) conflicts.push([a.server, b.server])
    }
  }
  return conflicts
}

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
 *
 * ## `mcp`（T007 / FR-005）：为什么它不是 `GOVERNED` 那种「整体 deny ＋ 逐条 allow」
 *
 * 因为 MCP 的两个出口在链 A 里是**两条不同的权限通道**，各自要自己的形状（实测见
 * `packages/opencode/test/server/openhive-access-mcp.test.ts` 的表）：
 * - **server 工具**：`ask` 的 permission 是**工具名**（`sanitize(server) + "_" + sanitize(name)`）
 *   ⇒ 用 `toolPattern` 一条规则就能同时管住「看得见」与「放不放」；
 * - **资源工具**：`ask` 的 permission 是 `read`、pattern 是 `mcp:<server>:*` ⇒ 与**文件读取同名**，
 *   **不能**用整体 deny（会把民警读文件一起拒掉），只能逐 server 出 pattern ⇒
 *   也因此**无法隐藏**（`Permission.disabled` 把资源工具归一成 `read` 再判）：
 *   未授权 server 的资源**可见但不可用**，这是取舍、不是遗漏。
 *
 * 所以每个 server 出**两条**同向规则（未授 = 两条 deny，授过 = 两条 allow）。**没有 allow 就是
 * 有洞**：MCP 工具的 `ask` 带 `always: ["*"]` ⇒ 授过的 server 若不显式 allow，一样会弹
 * 「总是允许」——和上面 skill 那段是同一个洞，只是不再有 deny 挡着，是**放行侧**的洞。
 *
 * ⚠️ **`mcp` 省略时行为与 T006 逐字相同**（一条 mcp 授权行产不出任何规则）：既有调用点
 * （`src/session/prompt.ts`）不传它，而**名单从哪来归调用方**——core 读不到 `Config`，
 * 也不该去猜。
 */
export function sessionRuleset(
  grants: readonly AccessRbac.Grant[],
  mcp?: readonly McpServerNaming[],
): PermissionV1.Ruleset {
  const rules: PermissionV1.Rule[] = []

  // ① 先铺整体 deny（每个受管类型一条）。
  for (const type of GOVERNED) {
    const tool = AccessRbac.TOOL_OF[type]
    if (tool === undefined) continue
    rules.push({ permission: tool, pattern: "*", action: "deny" })
  }

  // ② mcp：每个 server 两条同向规则（工具前缀 + 资源 pattern）。方向和授权行一致。
  for (const naming of mcp ?? []) {
    const granted = grants.some(
      (grant) =>
        grant.resourceType === "mcp" && grant.resourceId === naming.server && grant.perm === AccessRbac.READ,
    )
    const action = granted ? "allow" : "deny"
    rules.push({ permission: naming.toolPattern, pattern: "*", action })
    rules.push({ permission: "read", pattern: `mcp:${naming.server}:*`, action })
  }

  // ③ 再逐条 allow。🔴 **只取 `effect === "allow"` 那批**——`resolve()` 从 2026-10-05 起
  //    自带 ① fail-closed 基线（每个已映射类型一条整体 deny）。若把基线也搬进来，它会排在
  //    allow **之后** ⇒ `findLast` 取到它 ⇒ **把授过的 skill 一起拒掉**。
  //    链 A 这边的整体 deny 由本函数 ①（按 `GOVERNED`）承担，两张表的键集由
  //    `openhive-access.test.ts` ⑥ 钉同步；两条链的基线因此不会重复也不会缺席。
  //    v2 的 `{action, resource, effect}` → v1 的 `{permission, pattern, action}`：字段改名，
  //    匹配语义同源（见文件头）。
  for (const rule of AccessRbac.resolve(grants)) {
    if (rule.effect !== "allow") continue
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
 * ## 🔴 去重**只在每个来源内部做**（2026-10-05 修，I1）
 *
 * 旧版把两侧拼起来整体去重、保留首次出现。那是**错的**，因为**次序在这里是语义**
 * （`evaluate` 取 `findLast`）：一条在 `client` 里、一条在 `existing` 里、**键相同**的规则
 * **不是**重复项——它们处在不同位置，而**位置本身就是它们唯一的差别**。整体去重会把
 * `existing` 那份删掉，于是 capability 的 allow 从「整体 deny 之后」掉到「整体 deny 之前」：
 *
 * ```
 * client   = [{ skill, fund-analysis, allow }]                     ← 客户端回声 / 照抄回来的
 * existing = [{ skill, *, deny }, { skill, fund-analysis, allow }] ← capability
 * 整体去重 = [{ skill, fund-analysis, allow }, { skill, *, deny }]  ⇒ 授过的 skill 变成 deny
 * ```
 *
 * 授过的东西被拒（**过拒**，不是放行）——不报错、不变红，只是「这个功能今天用不了」。
 * 触发点很现实：`POST /session` 的 `CreateInput.permission`、`PATCH /session/:id` 的
 * `UpdatePayload.permission` 都是**客户端可填**的，客户端把从会话里读到的规则照抄回来就会撞键。
 *
 * ⇒ 规则：**`client` 里与 `existing` 撞键的一律丢弃**（既有的那份留在原位置、不动），
 * 两侧各自再去自身重复。一句话：**客户端不得把既有规则「提前」**。
 * 这也让本函数保持幂等——第二次并同一份 `client` 时，它的键已全在 `existing` 里 ⇒ 全丢 ⇒ 结果不变。
 */
/**
 * 规则的身份键（这三个字段就是 `PermissionV1.Rule` 的**全部**字段）。
 *
 * 单独抽出来是因为去重要在**两个循环**里各做一次（见下）：各写一遍模板串就是
 * 「同一个判断两处各写一份」（`LEARNINGS #002-06`），改一处漏一处。
 */
const ruleKey = (rule: PermissionV1.Rule) => `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`

export function mergeClientRules(
  client: PermissionV1.Ruleset,
  existing: PermissionV1.Ruleset,
): PermissionV1.Rule[] {
  const existingKeys = new Set(existing.map(ruleKey))
  const seen = new Set<string>()
  const merged: PermissionV1.Rule[] = []

  // 客户端侧：与既有规则**撞键的一律丢弃**——既有的那份留在原位置（最后），
  // 客户端规则不许把它挤到前面去（那会让整体 deny 变成最后命中）。
  for (const rule of client) {
    const key = ruleKey(rule)
    if (existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    merged.push(rule)
  }

  // 既有侧：次序**原样**保留，只去自身重复。`seen` 此刻全是「不在 existingKeys 里」的客户端键，
  // 所以这里的 `seen.has` 只会命中 `existing` 自己的重复项——不会误删既有规则。
  for (const rule of existing) {
    const key = ruleKey(rule)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(rule)
  }

  return merged
}
