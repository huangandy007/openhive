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
 */
export type ResourceType = "skill" | "mcp" | "knowledge_base"

/**
 * 权限动作（design-v2 §11.2：读 / 写 / 审 / 管）。
 *
 * ⚠️ **存 ASCII，不存中文**：这四个词的**中文只是文档里的散文**。它们要进 DB、进规则字符串、
 * 跨语言比对——编码成 `读/写/审/管` 就在每个边界上多一层转换，而这一层转换没有任何校验兜着。
 * 同样一份值也写在 `0004_rbac.sql` 的 CHECK 里，两边改动必须同步（`rbac.test.ts` 有防漂移断言）。
 */
export type Perm = "read" | "write" | "review" | "admin"

/**
 * 一条授权 = `role_resource` 的一行（角色那一维已由调用方 join 掉：这里只关心「这个用户名下
 * **有哪些**授权」，不关心它们出自哪个角色）。
 */
export interface Grant {
  readonly resourceType: ResourceType
  readonly resourceId: string
  readonly perm: Perm
}

/**
 * 把「某用户名下的全部授权行」解析成一条 ruleset。
 *
 * 映射约定（`access-rbac.test.ts` 拿下游真正的匹配器钉住，不是逐字段对字符串）：
 * - `action`   = `perm`（`"read"` / `"write"` / `"review"` / `"admin"`）
 * - `resource` = `` `${resourceType}:${resourceId}` ``
 * - `effect`   = 一律 `"allow"`
 *
 * 为什么 effect 恒为 `"allow"`：`role_resource` 表里**没有 effect 列**（design-v2 §14.3 只给了
 * `role_id, resource_type, resource_id, perm`）——这张表记的是「授了什么」，不记「禁了什么」。
 * **没有规则 ≠ 允许**：未授的动作落回上游 `evaluate` 的兜底 `ask`，绝不在这一层补一条 allow
 * （`access-rbac.test.ts` 的 ⑤ 与 ⑥ 各钉一半）。
 *
 * 去重：同一条授权由两个角色各给一次时只出一条。不去重也不影响 `evaluate`（它取 `findLast`），
 * 但 ruleset 是**对两条链的契约**——重复项会让「这条证到底授了什么」没法直读。
 * 保持**首次出现**的顺序（调用方取行的顺序即输出顺序，可预测）。
 */
export function resolve(grants: readonly Grant[]): Permission.Ruleset {
  const seen = new Set<string>()
  // ⚠️ 累加用的必须是**可变**数组：`Permission.Ruleset` 是 `readonly Rule[]`（schema 里声明为
  // readonly），在它上面 `.push` 直接 typecheck 红。可变数组可以赋给 readonly 返回类型，
  // 所以出口形状不变——「出口就是 Ruleset」那条断言（⑦）照旧成立。
  const ruleset: Permission.Rule[] = []

  for (const grant of grants) {
    const rule: Permission.Rule = {
      action: grant.perm,
      resource: `${grant.resourceType}:${grant.resourceId}`,
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
