export * as ProjectMember from "./project-member"

import { authSchema } from "./user"
import { boolean, integer, text } from "drizzle-orm/pg-core"

/**
 * 005 T004 · `project_member` / `project_archive` 两张表的模型（FR-004 / FR-010，Q3 裁定）。
 *
 * ⚠️ **表的真相来源是 `migrations/0005_project_member.sql`**，这里只负责类型安全查询。
 * 改结构时两侧都要动——只改一侧会被 `project-member.test.ts` 的防漂移断言拦下
 * （同 `rbac.ts` / `user.ts` 的做法）。
 *
 * 判定（「这个身份 ＋ 这个动作 ⇒ 能不能」）**不在这里**，在
 * `packages/core/src/project/membership.ts`（U5 裁定：判定写 core 纯函数、接线在执行层）。
 * core 与本包**互不依赖**（实测：本包 deps 只有 drizzle-orm / hono），所以这个模型只回答
 * 「库里有什么」，不回答「所以能不能」——两侧的分工写在那个文件的头部。
 *
 * ## 今天**刻意没有**查询辅助函数
 *
 * `rbac.ts` 里那个 `grantsFor()` 是 **T006** 才加的，加它的理由是「链 A 的会话创建要取授权行」
 * ——**有消费者才写取数**。本 feature 的消费者是 T010（成员面板）/ T013–T015（归档 / 找回），
 * 它们住在 `packages/opencode`（只有它同时依赖 auth 与 core）。在消费者出现之前先写一份
 * 「猜的形状」，很可能把口径钉错（`LEARNINGS #004-07`：判据的形状由**被调方**定义，
 * 不是调用方的直觉），而且那份猜的形状没有调用点、不会被任何门禁提醒。
 *
 * ## 约束只在迁移里，模型侧不复述
 *
 * 主键 `(project_id, user_id)`、`role` 的 CHECK 闭集、`project_member_single_owner`
 * 这个**部分唯一索引**、`project_archive_coherence_check`——drizzle 1.0 的列构建器表达不了它们
 * （本项目不用 drizzle-kit 生成迁移，见 `user.ts` 的同款注释）。它们是**数据层的事实**，
 * 由 `project-member.test.ts` 打真库逐条验证（`LEARNINGS #002-02`：没跑过被测路径的不是测试）。
 */

/** 成员关系（项目级共享态，落 PG 的 `auth` schema——见迁移头部对 Q3 的解释）。 */
export const projectMember = authSchema.table("project_member", {
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  /** `owner` / `member`；闭集由迁移的 CHECK 钉住，**不设只读角色**（FR-004）。 */
  role: text("role").notNull(),
  /** Unix **秒**（`src/time.ts` 的 `nowSeconds()`，不是毫秒）。 */
  timeCreated: integer("time_created").notNull(),
})

/**
 * 归档状态（**项目级共享态**——FR-010「归档后成员失权」要求它不是个人态，Q3 裁定）。
 *
 * `archived` 与 `archived_at` 的**一致性**由 `project_archive_coherence_check` 钉住：
 * 「已归档但没有时间」与「没归档却带着时间」两种组合在库里都插不进去。
 * 之所以要有 `archived` 这一列而不是「行在 = 已归档」：找回是一次 **UPDATE**，
 * 行留下来带着完整语义，而不是靠「行在不在」这种隐式状态（那种写法在一个
 * `DELETE` 写错时会把「已归档」静默翻成「未归档」，而看起来一切正常）。
 */
export const projectArchive = authSchema.table("project_archive", {
  projectId: text("project_id").primaryKey(),
  archived: boolean("archived").notNull(),
  /** 归档时刻（Unix **秒**）；未归档时为 `NULL`（由上面那条 CHECK 与 `archived` 绑死）。 */
  archivedAt: integer("archived_at"),
})

export type ProjectMemberRow = typeof projectMember.$inferSelect
export type ProjectArchiveRow = typeof projectArchive.$inferSelect
