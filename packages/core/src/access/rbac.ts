export * as AccessRbac from "./rbac"

import type { Permission } from "@opencode-ai/schema/permission"

/**
 * RBAC 判定（FR-007）——**角色授予的行 → `Permission.Ruleset`**。
 *
 * 位置：表在 **auth 的 PG**（`auth.role` / `auth.user_role` / `auth.role_resource`，
 * 用户 2026-10-04 裁定 D0-3 ①），逻辑在 **core**（裁定 D0-2）。而 core **不依赖 auth**
 * （实测 `packages/auth/package.json` 的 deps 只有 `drizzle-orm` / `hono`）⇒ 这里**碰不到库**，
 * 只认「已经取出来的授权行」。取行那一步（user → 角色 → 授权 的 join）归 **T005/T006**——
 * 那两处住在 `packages/opencode`，而**全仓只有它同时依赖 auth 与 core**（实测）。
 *
 * 出口为什么是 `Permission.Ruleset`：用户 2026-10-04 二选一裁定。它直接喂 T003 的
 * `AccessIssue.issue`，形成「角色表 → ruleset → capability」一条直线，而**执行器仍然只认
 * capability、不回查角色表**（FR-002）。若出口改成 `boolean`，接线处还得再包一层把布尔翻回
 * ruleset——那层包装正是「同一个判断在两处各写一份」的入口（`LEARNINGS #002-06`）。
 *
 * 「角色为主 + 用户例外」（design-v2 §14.3 标题）：**不加第 4 张表**（用户 2026-10-04 裁定）——
 * 「例外」= 给这一个用户单独分配一个（自定义）角色，用现有三张表表达。F9 的「授权组」走的
 * 也是这条路（`role_type='group'` 的自定义 role）。今天不建投机结构。
 */

/**
 * 资源类型（design-v2 §14.3：`resource_type ∈ {skill, mcp, knowledge_base}`）。
 * 这三个值是**DB 里 CHECK 约束钉住的**（见 `packages/auth/src/migrations/0004_rbac.sql`），
 * 这里复述一份是为了让 core 侧的类型与那个约束同名、同值。
 *
 * ⚠️ 写成**运行时的数组**、类型由它导出（而不是裸联合）：这份值有两处写法（这里 ＋ SQL 的
 * CHECK），`LEARNINGS #003-05` 要求镜像**写成能被惊醒的样子**——防漂移断言要拿得到值才写得出来。
 * 裸联合在运行时取不到任何东西，于是「改一边必须改另一边」就只剩注释里的一句愿望。
 * 钉住这条镜像的是 `packages/opencode/test/server/openhive-rbac-closed-set.test.ts`
 * （全仓只有 `packages/opencode` 同时看得见 auth 的库与 core 的值，见本文件头部）。
 */
export const RESOURCE_TYPES = ["skill", "mcp", "knowledge_base"] as const
export type ResourceType = (typeof RESOURCE_TYPES)[number]

/**
 * 权限动作（design-v2 §11.2：读 / 写 / 审 / 管）。
 *
 * ⚠️ **存 ASCII，不存中文**：这四个词的**中文只是文档里的散文**。它们要进 DB、进规则字符串、
 * 跨语言比对——编码成 `读/写/审/管` 就在每个边界上多一层转换，而这一层转换没有任何校验兜着。
 * 同样一份值也写在 `0004_rbac.sql` 的 CHECK 里，两边改动必须同步——防漂移断言同上
 * （`openhive-rbac-closed-set.test.ts` 把 DB 里 CHECK 的闭集读出来与它与 `RESOURCE_TYPES` 比对）。
 */
export const PERMS = ["read", "write", "review", "admin"] as const
export type Perm = (typeof PERMS)[number]

/**
 * **唯一会投影成工具调用**的动作。
 *
 * 是常量而不是散落的 `"read"` 字面量：`resolve()`（v2 投影）与 `AccessSession.sessionRuleset`
 * 的 mcp 那一段（v1 投影）都要按它筛授权行——两处各写一个字符串字面量就是「同一个判断两处各写
 * 一份」的最小形态（`LEARNINGS #002-06`），改一处漏一处，而漏掉的那处**不报错、不变红**。
 */
export const READ: Perm = "read"

/**
 * 一条授权 = `role_resource` 的一行（角色那一维已由调用方 join 掉：这里只关心「这个用户名下
 * **有哪些**授权」，不关心它们出自哪个角色）。
 *
 * ⚠️ **`resourceType` / `perm` 刻意是 `string`，不是上面的窄联合**。取行那一步跨包：auth 的
 * `grantsFor()` 从 PG 取行，PG 侧的保证是 **CHECK 约束**（`0004_rbac.sql`，由 `rbac.test.ts`
 * 打真库验），不是 TS 类型。收窄成联合会逼接线处写一次**无意义的 cast**，或者逼 auth 复制一份
 * 联合——后者是「同一个判断两处各写一份」（`LEARNINGS #002-06`），改一处漏一处。
 * 未知值在这里**天然被跳过**（`TOOL_OF` 查不到 ⇒ 不产 allow），只剩 `resolve()` 的 fail-closed
 * 基线罩着它——**别把它读成「反正有 `ask` 兜底」**（`ask` 可被「总是允许」批掉，见 `resolve()`）。
 */
export interface Grant {
  readonly resourceType: string
  readonly resourceId: string
  readonly perm: string
}

/**
 * 资源类型 → **承载它的工具名**（工具断言里的 `action` 维）。
 *
 * ⚠️ **这是 T004 第一版的修正，不是补丁**（用户 2026-10-04 裁定「改 resolve()」）。
 * 第一版把规则写成 `{ action: perm, resource: "<类型>:<id>" }`，而**所有消费者读的都是
 * `{ action: <工具名>, resource: <工具实参> }`**——实测：
 *
 *   packages/core/src/plugin/agent.ts:109-140   `{ action: "read", resource: "*.env", effect: "ask" }`
 *   packages/core/src/permission/saved.ts:62    「总是允许」存的就是这两列
 *   packages/core/src/tool/registry.ts:113      `whollyDisabled(permission(tool, name), permissions)`
 *   packages/core/src/tool/skill.ts:76          `permission.assert({ action: "skill", resources: [skill.name] })`
 *   packages/opencode/src/tool/skill.ts:28      `ctx.ask({ permission: "skill", patterns: [params.name] })`
 *
 * `Wildcard.match` 是**全串锚定**（`^…$`，`packages/core/src/util/wildcard.ts`），两边字段都对不上
 * ⇒ 第一版产出的 ruleset **一条都命中不了、全部落回 `ask`**：不报错、不变红、typecheck 照绿。
 * `LEARNINGS #003-05` 的「假镜像」形状——写的时候以为对上了，其实只在一边成立。
 *
 * ## 今天只有 `skill` 一行，其余两类**走别的投影**（不是漏掉）
 *
 * - `skill` → `"skill"`：两条链都有一个叫 `skill` 的工具，断言形状**同构**（上面那两行实测）。
 * - `mcp` → **不在这张表里，走 `AccessSession.sessionRuleset` 的第二段**（T007 / FR-005）。
 *   原因就是这张表的形状容不下它：`TOOL_OF` 是「一个类型 → **一个**工具名」，而 mcp 的工具名
 *   是 `<server 前缀>_<工具名>`（前缀随 server 变，且由 `McpCatalog.toolName` 生成），
 *   它的**另一个出口**（资源工具）根本不是工具名——是 `{ permission: "read", patterns: ["mcp:<server>:*"] }`
 *   （`packages/opencode/src/session/tools.ts`），**与文件读取同名**。
 *   所以它要**一对规则、两套名字**，且名字由调用方翻译（core 够不着 `sanitize`）。
 *   ⚠️ 这条投影**只对链 A 生效**；链 B（v2 / CLI）的 MCP 尚无落点，仍是缺口。
 * - `knowledge_base` → **全仓 `packages/` 下零命中**，没有对应工具：真缺口。
 *
 * ⚠️ 没有映射的类型**不产 allow**（用户 2026-10-04 裁定）——它只会被 `resolve()` 的 fail-closed
 * 基线罩着，**授权本身不生效**。这不是「已覆盖」，是**挂账的缺口**：`access-rbac.test.ts` 的 ③
 * 有一条断言把它钉在明面上，将来接上时必须**同时**改这张表和那条断言（`LEARNINGS #002-02`）。
 *
 * ⚠️ **本段旧版写的是「落回上游兜底 `ask`（保守：不会误放行）」——那句话是错的**（2026-10-05 改正）：
 * 落回 `ask` 会弹窗，而两条链的弹窗都带「总是允许」（`packages/core/src/permission/saved.ts`
 * 存的就是那两列）⇒ 恰是「没规则」的那批动作可以被民警自己批成持久 allow。「有 `ask` 兜底」
 * 不是安全的一侧，这正是 `resolve()` 必须补 fail-closed 基线的原因。
 */
/**
 * ⚠️ 写法分两步是刻意的（`satisfies` 管写入侧、宽类型管读取侧）：
 * - `satisfies Partial<Record<ResourceType, string>>` ⇒ **写这张表时**键打错会当场红；
 * - 导出的类型放宽成 `Record<string, string | undefined>` ⇒ **读它的地方**（`resolve()` /
 *   `sessionRuleset()`）可以直接拿一个 `string` 去索引，不必反过来给它补一次 cast
 *   ——那个 cast 正是「明明库里有 CHECK 兜着，却要在类型层假装不确定」的假动作。
 */
const TOOL_OF_TABLE = {
  skill: "skill",
} satisfies Partial<Record<ResourceType, string>>

export const TOOL_OF: Readonly<Record<string, string | undefined>> = TOOL_OF_TABLE

/**
 * 把「某用户名下的全部授权行」解析成一条规则集。
 *
 * 出口是**两段**：**① fail-closed 基线（每个已映射类型一条整体 deny）→ ② 逐条 allow**。
 * 顺序是语义（`evaluate` 取 `findLast`，后者胜），与链 A 的
 * `AccessSession.sessionRuleset` ① 同构。
 *
 * ## ① 为什么必须有基线（2026-10-05 补，I7）
 *
 * 只有 ② 时，「没授过的 skill」落回上游 `evaluate` 的兜底 `ask`——而 `ask` **不是安全的一侧**：
 * 两条链的弹窗都带「总是允许」（`packages/core/src/permission/saved.ts` 存的就是那两列），
 * 点一次就把没授过的 skill 变成持久 allow。**「没规则」在这里等于「可自批」**。
 * 一条 deny 把这条路堵死：deny 不进询问，也就没有「总是允许」可点。
 *
 * ⚠️ 基线**只罩已映射的类型**（今天只有 `skill`）：给 `bash` / `read` / `edit` 这类**不归 RBAC 管**
 * 的工具补整体 deny 会让 agent 直接不能用（它们的规则集在别处，见 `access-rbac.test.ts` 的 ⑨）。
 *
 * ## ② 逐条 allow
 *
 * 映射约定（`access-rbac.test.ts` 拿下游真正的匹配器钉住，不是逐字段对字符串）：
 * - **只有 `perm === "read"` 产 allow**（用户 2026-10-04 裁定）。`write` / `review` / `admin`
 *   是**管理动作**（改内容 / 批上线 / 上下架），不是工具调用，今天也没有承载它们的工具；
 *   把它们也翻成工具断言等于凭空发明一条没人请求的权限。
 * - 其余不变式：`action` = `TOOL_OF[resourceType]`（工具名），`resource` = `resourceId`（工具实参），
 *   `effect` 恒为 `"allow"`。未映射的 `resourceType` 整条跳过（见 `TOOL_OF`）。
 *
 * why allow-only 的**另一半**照旧成立：`role_resource` 表里**没有 effect 列**（design-v2 §14.3
 * 只给了 `role_id, resource_type, resource_id, perm`）——这张表记的是「授了什么」，不记「禁了什么」。
 * 基线那条 deny 是**这条 projected 出口自己加的**（不属于任何授权行），别把它读成「表里有 deny 行」。
 *
 * 去重：同一条授权由两个角色各给一次时只出一条。不去重也不影响 `evaluate`（它取 `findLast`），
 * 但 ruleset 是**对两条链的契约**——重复项会让「这条证到底授了什么」没法直读。
 * 保持**首次出现**的顺序（调用方取行的顺序即输出顺序，可预测）。
 */
export function resolve(grants: readonly Grant[]): Permission.Ruleset {
  const seen = new Set<string>()
  // ⚠️ 累加用的必须是**可变**数组：`Permission.Ruleset` 是 `readonly Rule[]`（schema 里声明为
  // readonly），在它上面 `.push` 直接 typecheck 红。可变数组可以赋给 readonly 返回类型，
  // 所以出口形状不变——「出口就是 Ruleset」那条断言（⑧）照旧成立。
  const ruleset: Permission.Rule[] = []

  // ① fail-closed 基线。遍历的是**表**（不是 `grants`）：与「这人有没有该类授权」无关——
  //    谁都得先过这道门。`TOOL_OF_TABLE` 的键在写入侧被 `satisfies` 钉住，值就是工具名。
  for (const tool of Object.values(TOOL_OF_TABLE)) {
    ruleset.push({ action: tool, resource: "*", effect: "deny" })
  }

  // ② 逐条 allow。
  for (const grant of grants) {
    // 只有「使用」对应工具调用；写 / 审 / 管没有承载它们的工具（见上方 doc）。
    if (grant.perm !== READ) continue
    // 未映射的资源类型：不产 allow（显式缺口，见 TOOL_OF）——只剩 ① 的基线罩着它。
    const tool = TOOL_OF[grant.resourceType]
    if (tool === undefined) continue

    const rule: Permission.Rule = {
      action: tool,
      resource: grant.resourceId,
      effect: "allow",
    }
    // 键取「两个字段的拼接」而不是整个对象：对象的键序在这个形状里是构造出来的，
    // 但拼接是显式的——将来若有人给 Rule 加了字段，这里会立刻多出一个可见的分歧点，
    // 而不是靠 `JSON.stringify` 的键序悄悄决定去不去重。
    const key = `${rule.action}\u0000${rule.resource}`
    if (seen.has(key)) continue
    seen.add(key)
    ruleset.push(rule)
  }

  return ruleset
}
