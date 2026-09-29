import { integer, pgSchema, text } from "drizzle-orm/pg-core"

/** 账号表所在的 schema：与 core 的每用户 SQLite、业务 `public` schema 物理分开。 */
export const authSchema = pgSchema("auth")

/**
 * 用户表模型（design-v2 §4.1，`2026-09-06-openhive-design-v2.md:124-145`）。
 *
 * ⚠️ **表的真相来源是 `migrations/0001_init.sql`**，这里只负责类型安全查询。
 * 改结构时两侧都要动——只改一侧会被 `user.test.ts` 的防漂移断言拦下。
 *
 * 两点刻意留白：
 * - 列名逐个显式写出，不依赖 drizzle 的 casing 推断——迁移里的列名是硬事实。
 * - `police_no` 的 UNIQUE 只存在于迁移里（drizzle 1.0 的列构建器没有列级 `unique()`，
 *   且本项目不用 drizzle-kit 生成迁移），模型侧以本注释标注，不在类型层复述。
 */
export const user = authSchema.table("user", {
  id: text("id").primaryKey(),
  policeNo: text("police_no").notNull(),
  name: text("name").notNull(),
  idCard: text("id_card").notNull(),
  phone: text("phone").notNull(),
  org: text("org").notNull(),
  dept: text("dept").notNull(),
  section: text("section").notNull(),
  status: integer("status").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin").default(0),
  mustChangePw: integer("must_change_pw").default(1),
  lastLoginAt: integer("last_login_at"),
  lastActiveAt: integer("last_active_at"),
  createdAt: integer("created_at").notNull(),
})
