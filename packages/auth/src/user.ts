import { type SQL } from "drizzle-orm"
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
 * - `lastLoginAt` / `lastActiveAt` / `createdAt` 的单位是 **Unix 秒**（integer 装不下毫秒），
 *   写入走 `src/time.ts` 的 `nowSeconds()`。
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
  // 停用时刻。**002 T016 追加的列**，不在 design-v2 §4.1 的原始 15 列里（该表已同步）。
  // 三分语义见 migrations/0002_deactivated_at.sql 顶部。
  deactivatedAt: integer("deactivated_at"),
})

export type UserRow = typeof user.$inferSelect
export type UserPatch = Partial<typeof user.$inferInsert>

/**
 * 读写 `auth.user` **一行**的最小面：按条件取行、按条件改行。
 *
 * 为什么不直接收 drizzle 实例：两种 PG 驱动的数据库类型**互不可赋值**
 * （PGlite 的 `execute` 解析成 `{ rows }`、bun-sql 解析成裸数组，根因见 state.md 裁定 ④）。
 * 收窄到用得到的方法，两种驱动都满足；`db.test.ts` 有类型标注钉住**生产驱动**也满足。
 *
 * **为什么这个接口被共享，而录入走的是另一个**：
 * 登录（T009）、改密（T013）、僵尸账户（T015）要的都是「取行 + 改行」，是同一件事；
 * 而录入只**插入**、不读不写既有行，收窄成 `UserInsertTarget` 才不会让它顺带拿到改任意账号的能力。
 *
 * 来历：前两处（`login.ts` / `password.ts`）各自抄了一份同样的形状，第三处出现时提上来的——
 * 当时在 `password.ts` 留了「出现第三处就该提到 `user.ts`」的话，T015 兑现它。
 */
export interface UserAccountTarget {
  select(): { from(table: typeof user): { where(clause: SQL): PromiseLike<UserRow[]> } }
  update(table: typeof user): { set(values: UserPatch): { where(clause: SQL): PromiseLike<unknown> } }
}
