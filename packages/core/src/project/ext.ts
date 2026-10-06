export * as ProjectExt from "./ext"

import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import type { DatabaseMigration } from "../database/migration"

/**
 * openhive 自有项目扩展表 `project_ext`（**个人态 4 字段**，T003）。
 *
 * ## 为什么不给上游 `project` 表加列
 *
 * 六个生命周期字段（`type` / `project_type` / `shared_directory` / `last_accessed_at` /
 * `archived` / `archived_at`）走**另起一张表**——宪法 §一 行 57 的处方原话是「新增独立文件/表；
 * 不碰表结构」，U4 裁定（2026-10-06）照此落。上游 `packages/core/src/project/sql.ts` 一字不动。
 *
 * ## 为什么只有 4 个而不 6 个
 *
 * Q3 裁定（2026-10-06）：`archived` / `archived_at` **拆出去**落业务 PG 的 `project_archive`
 * （见 `0005_project_member.sql`）——FR-010「归档后成员失权」要求归档状态是**项目级共享态**，
 * 而本表在**每用户库**里，一份/人，推不出「成员失权」。落这里的 4 个字段是各人自己的那份。
 *
 * ## 为什么建表钩子挂在 `database/router.ts` 而不是 `database/migration/`
 *
 * `database/migration/*`、`migration.gen.ts`、`schema.gen.ts` **全是上游生成物或上游清单**
 * （`packages/core/script/migration.ts` 产出）⇒ 往里加文件等于每次 `git merge upstream/dev`
 * 都冲突，且上游重跑生成器会把我们的文件挤掉（宪法 §一 NON-NEGOTIABLE）。
 *
 * 改走 upstream 已经导出的 `DatabaseMigration.applyOnly(db, input)`：它接受**任意** `Migration[]`，
 * 借同一本 `migration` journal 记账、幂等重放。钩子挂在 fork 自有的 `router.ts` 的每用户库那一层
 * ——那里是**唯一**「新库开出来」的必经之路（`Database.node` 是进程级单例，请求期读写的都是
 * `forUser` 建的那一份，见 `router.ts` 顶部注释与 003 的消费侧实测）。
 *
 * ⚠️ **边界（如实登记）**：钩子只覆盖**每用户库**。进程级那份主库（`Database.node`，
 * `Global.Path.data/opencode.db`）由上游 `database.ts` 建，**没有**这张表——而 `database.ts` 是上游
 * 文件，为它加钩子就破坏了「上游一字不动」。当前没有任何消费者在**无身份**上下文里查
 * `project_ext`（D0-1 定的消费者是建会话那条路径，它带 `User.Service`、必走每用户库）。
 * 将来若出现 CLI / 后台任务要读它，**先回来改这条注释**，别默认它在那里。
 */

/**
 * `type` 的闭集。**导出成运行时数组**，别只写成裸联合——`#004-03` 的教训：裸联合在运行时取不到值，
 * 「SQL 里的 CHECK」与「TS 里的联合」两份写法就**无从写防漂移断言**，谁漂了都不报错、不变红。
 * 守着这条的是 `test/project-ext.test.ts` 的「`type` 只收 private/shared」。
 */
export const PROJECT_TYPES = ["private", "shared"] as const

export type ProjectExtType = (typeof PROJECT_TYPES)[number]

/**
 * 列形状（给查询侧做类型，也是「本表长什么样」的唯一 TS 声明）。
 *
 * 三个**刻意的选择**（设计文档没写死、由本 task 定，写在这里免得下次靠猜）：
 *
 * - `project_id` **带外键**（`ON DELETE CASCADE`）——照上游 `project_directory` 的先例，同一类
 *   「项目作用域的扩展表」。代价是**行序有要求**：`project` 行必须先落（plan.md R1 说的
 *   「`project` 行与 `project_ext` 行须同步创建 ⇒ 收成一个写入模块」正是这条约束的落地口径）。
 * - `shared_directory` **可空**——设计原话「仅共享项目有值」。
 * - `last_accessed_at` **NOT NULL 但无默认值**：叫「最近访问时间」（「最近」tab 排序 +
 *   3 个月无操作归档判断），由写入侧在建项目时给出。**不设 DB 默认值**是刻意的——
 *   `DEFAULT (strftime(...))` 会把「时间由谁决定」劈成两处（`#002-06`）。
 */
export const ProjectExtTable = sqliteTable("project_ext", {
  project_id: text().primaryKey(),
  type: text().$type<ProjectExtType>().notNull(),
  project_type: text().notNull(),
  shared_directory: text(),
  last_accessed_at: integer().notNull(),
})

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase

/**
 * 按 `projectId` 取**这一行**。**D0-1 裁定（2026-10-06）的必给接口**，不是可选项：
 * 建会话那条路径靠它拿到项目身份，再由服务端拼出 `join(沙箱根, 目录)` 写进 `session.directory`
 * （客户端给不出位置 ⇒ `anchor-workspace.ts` 那条不变量原样保留）。
 *
 * 查不到给 `undefined`、**不抛**：R5 已裁定「查不到就落沙箱根，不做隐式建项目」，
 * 所以「没有扩展行」是**正常路径**，不是异常。
 *
 * 传进来的 `db` 必须是**该用户的**那一份（`DatabaseRouter.forUser` 的产物，或请求期被连接钩子
 * 路由过的那份）——本函数**不做任何身份校验**，校验在连接路由那一层（宪法 §四：权限下沉执行层）。
 */
export function findByProjectID(db: Database, projectID: string) {
  return db
    .select()
    .from(ProjectExtTable)
    .where(eq(ProjectExtTable.project_id, projectID))
    .get()
    .pipe(Effect.orDie)
}

export interface InsertProjectExtInput {
  readonly projectId: string
  readonly type: ProjectExtType
  /** 自由文本（设计 §224：单案 / 串并 / 专项行动 / 考核督导 / 内勤文字…）。**没有闭集**：调用方给什么存什么。 */
  readonly projectType: string
  /** 仅共享项目有值（bare 仓库路径）；私有项目传 `null`。 */
  readonly sharedDirectory: string | null
  /** Unix **毫秒**（本表是 SQLite 侧，与上游 `project.time_created` 同一刻度）。 */
  readonly lastAccessedAt: number
}

/**
 * 落一行扩展行（T018 的「建项目」是第一个调用点）。
 *
 * 两个刻意的选择：
 *
 * ① **`Effect.orDie`，绝不吞错**——本表带外键（`project_id → project(id)`，见上面的列注释），
 *    所以「`project` 行还没落就写扩展行」会撞 FK。吞掉它的后果不是「少一行」而是**静默的错项目**：
 *    `project-location.ts` 的中间件拿本表判断「这个项目在不在」，查不到就落沙箱根（R5 那条
 *    **正常路径**）⇒ 「建项目失败」与「这个项目本来就不存在」在结果上一模一样、不报错、不变红。
 *    `LEARNINGS #002-02`：一个把失败咽下去的错误处理，就是一个看着还在、其实没有的门。
 * ② **不收事务句柄**（对照 `ProjectDirectories.create(input, tx?)`）。理由不是省事：建项目那一步
 *    要写**两个不同的库**（每用户 SQLite ＋ 业务 PG 的 `project_member`），**没有**一个能盖住两者的
 *    事务可开 ⇒ 只给这一半加事务能力，会给人「这一步是原子的」的错觉，而那正是最该说清楚的地方。
 *    真需要原子性时，那是跨库补偿（saga）的问题，不是本函数签名的问题。
 */
export function insertProjectExt(db: Database, input: InsertProjectExtInput) {
  return db
    .insert(ProjectExtTable)
    .values({
      project_id: input.projectId,
      type: input.type,
      project_type: input.projectType,
      shared_directory: input.sharedDirectory,
      last_accessed_at: input.lastAccessedAt,
    })
    .run()
    .pipe(Effect.orDie)
}

/**
 * 建表迁移。`id` **不带上游那种时间戳前缀**，一眼可辨是 fork 产出的：
 * `applyOnly` 在**老库**上会用 `id.startsWith(\`${prefix}_\`)` 去匹配 `__drizzle_migrations` 的
 * 时间戳（`migration.ts` 那段 legacy 分支），拿一个上游样子的时间戳去撞它没有好处。
 *
 * 平铺 `CREATE TABLE`（**不写** `IF NOT EXISTS`）：journal 保证只跑一次，重复跑应当**当场炸**
 * 而不是静默放过——上游的迁移文件也全是这个写法。
 */
export const migration = {
  id: "openhive_project_ext",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`project_ext\` (
          \`project_id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`project_type\` text NOT NULL,
          \`shared_directory\` text,
          \`last_accessed_at\` integer NOT NULL,
          CONSTRAINT \`fk_project_ext_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`project_ext_type_check\` CHECK (\`type\` IN ('private', 'shared'))
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
