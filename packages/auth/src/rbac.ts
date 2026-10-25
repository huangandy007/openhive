export * as Rbac from "./rbac"

import { authSchema } from "./user"
import { text } from "drizzle-orm/pg-core"
import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "./migrate"

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

/**
 * 角色类型（009 T004，FR-006）。闭集与 `0010_role_type.sql` 的 `role_type_check` 是同
 * 一份值的两处写法，`rbac.test.ts` 把 DB 里的 CHECK 定义读出来逐值比对。
 *
 * - `normal`：普通角色（存量角色、以及「角色为主 + 用户例外」里的例外角色）。
 * - `group`：授权组（design §3.4，跨部门定向授权）。
 *
 * ⚠️ 它**只是标记**，不是判定输入：`grantsFor()` 只 join `user_role` / `role_resource`。
 * 授权组的效力来自「组被授权的资产行」，不来自这一列本身。
 */
export const ROLE_TYPES = ["normal", "group"] as const
export type RoleType = (typeof ROLE_TYPES)[number]

export const role = authSchema.table("role", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 默认 `normal`：加列对存量角色是「全部归为普通角色」，不改变任何现有授权。 */
  roleType: text("role_type").notNull().default("normal"),
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

export interface GrantTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface GrantRow {
  readonly resourceType: string
  readonly resourceId: string
  readonly perm: string
}

/**
 * 取「某个用户名下的**全部**授权行」（T006 的取行那一步）。
 *
 * 这是「user → 角色 → 授权」那条 join 的**唯一**生产实现。T004 时它还不存在，
 * `rbac.test.ts` 用一条内联 join 顶着；T006 补上消费者后内联那份**删了**——
 * 同一个判断留两份写法，只要有一条不覆盖就会分叉（`LEARNINGS #002-06`）。
 *
 * ## 三个刻意的形状选择
 *
 * ① **出口是 camelCase**（`resourceType` / `resourceId` / `perm`）：下游
 * `AccessRbac.Grant` 就是这三个名字（core 与 auth 之间没有依赖，只能靠同名对齐）。
 * 改名只在**这里**、贴着 SQL 做一次；放到接线处就成了「两边各写一份改名」。
 * ② **`order by` 是必需的，不是修饰**：产出的规则集会**持久化到会话上**，
 * DB 返回顺序不定 ⇒ 同一份授权每次落库的字节都不一样。顺序钉死在
 * `(resource_type, resource_id, perm)`——与 `AccessRbac.resolve()` 的去重顺序配合，
 * 整条「授权行 → 规则集」是确定的。
 * ③ **`userId` 是查询参数**：`sql` 模板把它编成 `$1`，不做字符串拼接。
 * 注入面由 `rbac.test.ts` 的注入用例钉住（判据是「返回空」而不是「没报错」——
 * 拼接版也会正常返回，只是返回错的东西）。
 *
 * ⚠️ **驱动差异走 `rowsOf`**：PGlite 把行放在 `{ rows }`、生产 bun-sql 直接给数组。
 * 这是 `LEARNINGS #002-01` 咬过两次的那条维度，`migrate.ts` 已经有一份处理，
 * 这里复用它而不是再写一份取行（`#002-06`）。
 */
export async function grantsFor(db: GrantTarget, userId: string): Promise<GrantRow[]> {
  const result = await db.execute(sql`
    select rr.resource_type, rr.resource_id, rr.perm
    from auth.role_resource rr
    join auth.user_role ur on ur.role_id = rr.role_id
    where ur.user_id = ${userId}
    order by rr.resource_type, rr.resource_id, rr.perm
  `)
  return rowsOf(result).map((row) => ({
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    perm: String(row.perm),
  }))
}
