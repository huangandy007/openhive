import { eq, inArray, type SQL } from "drizzle-orm"
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
  // 两列的 NOT NULL 由 **0003 迁移**追加（0001 建表时是可空的）。
  // 可空时 `must_change_pw = NULL` 会被 login 的 `=== 1` 读成「不需改密」——fail-open。
  isAdmin: integer("is_admin").notNull().default(0),
  mustChangePw: integer("must_change_pw").notNull().default(1),
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

/**
 * 「一个人」在**跨层契约**上要的最小面：id（库里那个 UUID）＋ 警号 ＋ 姓名。
 *
 * ⚠️ **这三列不是随手挑的**：它们是 `packages/app/src/project/member-panel.tsx` 的
 * `MemberEntry` 要的东西（`policeId` / `name` / `role`），而 `role` 来自**另一张表**
 * （`project_member`），由调用点自己拼——本模块只管 `auth.user` 这一半。
 *
 * 为什么不是一个 `UserRow`：整行含 `passwordHash`、`idCard`。把整行原样交给调用方，
 * 就是让「成员名单」这条链**够得着**它不需要、也不该碰的列（同 `grantsFor` 只吐
 * `tool` / `pattern` 的取向——出口只吐调用方要的列）。
 */
export interface UserBrief {
  readonly id: string
  readonly policeNo: string
  readonly name: string
}

const briefOf = (row: UserRow): UserBrief => ({ id: row.id, policeNo: row.policeNo, name: row.name })

/**
 * 005 T021 · 按 **id** 批量取人（成员名单把 `project_member.user_id` 翻译成警号与姓名）。
 *
 * 回 **Map 而不是数组**：调用方按 id 归位（名单的顺序由 `project_member` 的 `time_created` 说了算，
 * 那是另一张表的事），而数组会让调用方再排一次序——那就成了「谁的顺序为准」的第二个答案。
 *
 * **缺席语义**：库里没有的 id **不在 Map 里**（同 `archiveStatesOf` 的口径——
 * 「没有来源」与「来源说没有」是两件事）。⚠️ 但在**本函数的调用点**这条分支不可达：
 * `project_member.user_id` 有指回 `auth.user(id)` 的外键 ⇒ 有成员行就必有用户行。
 * 所以调用方那一侧写 `??` 是**类型收敛**而不是可达分支（同 `project.ts` 的
 * `named.get(...)?.name ?? ""`）。
 *
 * ⚠️ **空数组必须短路**：`inArray` 落空时生成的判据与「不给条件」在形状上很近，
 * 而这里写错的后果是**回全表**——调用方是成员名单，多出来的每个人都会被画成一行。
 */
export async function usersByIds(db: UserAccountTarget, ids: readonly string[]): Promise<Map<string, UserBrief>> {
  if (ids.length === 0) return new Map()
  const rows = await db.select().from(user).where(inArray(user.id, [...ids]))
  return new Map(rows.map((row) => [row.id, briefOf(row)]))
}

/**
 * 005 T021 · 按 **警号**取一个人（邀请 / 移除时把界面说的警号翻译成库里的 id）。
 *
 * `undefined` ＝ 查无此警号。⚠️ **这条分支在这里是可达的**（上面的 `usersByIds` 不是）：
 * 警号是**客户端填的**，写错一个数字就走到这里 ⇒ 调用方必须自己决定怎么交代
 * （`member.ts` 把它翻成 400 的一句话，而不是一个静默的「邀请成功」）。
 *
 * 不做 `limit 1`：`police_no` 的 UNIQUE 只在迁移里（`user.ts` 文件头那条），而
 * 「靠库的约束保证只有一行」正是要让它**取不到第二行**时能看得出来——加 `limit` 反而
 * 把这个事实藏起来。`[0]` 对空数组是 `undefined`，语义正好。
 */
export async function userByPoliceNo(db: UserAccountTarget, policeNo: string): Promise<UserBrief | undefined> {
  const [row] = await db.select().from(user).where(eq(user.policeNo, policeNo))
  return row ? briefOf(row) : undefined
}
