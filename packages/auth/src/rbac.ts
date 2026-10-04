export * as Rbac from "./rbac"

import { authSchema } from "./user"
import { text } from "drizzle-orm/pg-core"

/**
 * RBAC 三张表的模型（FR-007，design-v2 §14.3）。
 *
 * ⚠️ **表的真相来源是 `migrations/0004_rbac.sql`**，这里只负责类型安全查询。
 * 改结构时两侧都要动——只改一侧会被 `rbac.test.ts` 的防漂移断言拦下（同 `user.ts` 的做法）。
 *
 * 三张表的关系（照 §14.3 原文，一字不改）：
 * ```text
 * role:           role_id, name
 * user_role:      user_id, role_id
 * role_resource:  role_id, resource_type, resource_id, perm
 * ```
 *
 * 判定（「这些行 ⇒ 一条 ruleset」）**不在这里**，在 `packages/core/src/access/rbac.ts`
 * （用户 2026-10-04 裁定 D0-2：RBAC 逻辑落 core）。这个包的模型只回答「库里有什么」，
 * 不回答「所以能不能」——两侧的分工写在那个文件的头部。
 *
 * ⚠️ **复合主键 / CHECK 只在迁移里**：drizzle 1.0 的列构建器没有列级 `unique()`，也没有
 * 复合主键与 CHECK 的表达（本项目不用 drizzle-kit 生成迁移，见 `user.ts` 的同款注释）。
 * 那些约束是**数据层的事实**，模型侧以注释标注、不在类型层复述；它们由 `rbac.test.ts`
 * 打真库验证（重复授权被拒、未知 perm 被拒、外键拦住悬空引用）。
 */

export const role = authSchema.table("role", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
})

export const userRole = authSchema.table("user_role", {
  userId: text("user_id").notNull(),
  roleId: text("role_id").notNull(),
})

export const roleResource = authSchema.table("role_resource", {
  roleId: text("role_id").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  perm: text("perm").notNull(),
})

export type RoleRow = typeof role.$inferSelect
export type UserRoleRow = typeof userRole.$inferSelect
export type RoleResourceRow = typeof roleResource.$inferSelect
