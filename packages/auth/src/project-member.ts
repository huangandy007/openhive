export * as ProjectMember from "./project-member"

import { authSchema } from "./user"
import { boolean, integer, text } from "drizzle-orm/pg-core"
import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "./migrate"

/**
 * **项目级共享态**（PG `auth` schema）的模型：`project_member` / `project_archive`（005 T004，
 * FR-004 / FR-010，Q3 裁定）＋ `project_meta`（006，FR-003 的名单那一半）。
 *
 * 三张表同住本文件、不是各开一个：它们回答的是**同一个问题**（「这个项目在共享层面是什么」），
 * 且共用底下的 `idsOf`（`#002-06`：同一个判断别在两处各写一份——`in (...)` 的编参正是那种
 * 「两处一漂，一处注入 / 一处语法错」的东西）。`rbac.ts` 收 `auth.role` 与授权表也是同一取向。
 *
 * ⚠️ **表的真相来源是 `migrations/0005_project_member.sql` ＋ `migrations/0006_project_meta.sql`**，
 * 这里只负责类型安全查询。改结构时两侧都要动——只改一侧会被 `project-member.test.ts` 的防漂移断言
 * 拦下（同 `rbac.ts` / `user.ts` 的做法）。
 *
 * 判定（「这个身份 ＋ 这个动作 ⇒ 能不能」）**不在这里**，在
 * `packages/core/src/project/membership.ts`（U5 裁定：判定写 core 纯函数、接线在执行层）。
 * core 与本包**互不依赖**（实测：本包 deps 只有 drizzle-orm / hono），所以这个模型只回答
 * 「库里有什么」，不回答「所以能不能」——两侧的分工写在那个文件的头部。
 *
 * ## 读写辅助：T004 留白，T018 兑现
 *
 * T004 落地时**刻意一个查询函数都没写**——「有消费者才写取数」（`rbac.ts` 的 `grantsFor()` 也是
 * T006 有了会话创建这个消费者才加的）。当时的判断是：在消费者出现前先写一份「猜的形状」，
 * 很可能把口径钉错（`LEARNINGS #004-07`：判据的形状由**被调方**定义，不是调用方的直觉），
 * 而且那份猜的形状没有调用点、不会被任何门禁提醒。
 *
 * **T018 就是那个消费者**（建项目要写 owner 行、列项目要读成员数与归档态），所以下面这几个函数
 * 的形状由真实调用点定，不是照着前端想象出来的。三个刻意的选择：
 *
 * ① **收的是「能跑 SQL 的东西」而不是 drizzle 的 `PgDatabase`**（同 `rbac.ts` 的 `GrantTarget`、
 *    `migrate.ts` 的 `MigrationTarget`）——这样调用方递真库还是 PGlite 都行，测试不必给驱动搭替身。
 * ② **出口是 camelCase 且只吐调用方要的列**：改名只在贴着 SQL 的这里做一次（同 `grantsFor` 的
 *    理由）。单条查询（`membersOf`）**不吐 `project_id`**——按定义它就是查询参数，吐回去等于给
 *    调用方一个「可以拿错行」的机会；批量查询（`archiveStatesOf` / `memberCountsOf` / `rolesOf`）
 *    则**以 `project_id` 为 Map 的键**——那里的 projectId 是「这一行属于谁」，不吐就没法归位。
 * ③ **`membersOf` 的 `order by` 是语义不是修饰**：`time_created` 只有**秒**粒度，同一次建项目里
 *    两个成员极易同秒，所以次级键 `user_id` 必需——否则成员面板的名单顺序会随 PG 的返回顺序漂。
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

/**
 * 项目的**名字与类型**（**项目级共享事实**，0006）。
 *
 * 为什么非要有这张表：名字的家在上游 `project` 表里，而那张表活在**每用户 SQLite**——
 * 于是「甲建的共享项目」在乙那份库里**一行都没有**，列表出口既取不出名单、也取不出名字
 * （详见迁移 `0006_project_meta.sql` 的头两节）。名单那一半由 `project_member` 给，这一半给不了：
 * 名字是**项目**的属性，不是**成员关系**的属性。
 *
 * `type` 一并落在这里，是为了让「被邀进一个项目的人」拿到**它真实的类型**，而不是消费侧
 * 一句写死的 `"shared"`（今天没有规则拦着「把成员邀进私有项目」）。
 */
export const projectMeta = authSchema.table("project_meta", {
  projectId: text("project_id").primaryKey(),
  name: text("name").notNull(),
  /** `private` / `shared`；闭集由迁移的 CHECK 钉住，**且**有防漂移断言比对 core 的 `PROJECT_TYPES`。 */
  type: text("type").notNull(),
})

export type ProjectMemberRow = typeof projectMember.$inferSelect
export type ProjectArchiveRow = typeof projectArchive.$inferSelect
export type ProjectMetaRow = typeof projectMeta.$inferSelect

/** 能跑 SQL 的句柄（形状同 `rbac.ts` 的 `GrantTarget` / `migrate.ts` 的 `MigrationTarget`）。 */
export interface ProjectMemberTarget {
  execute(query: SQL): PromiseLike<unknown>
}

export interface AddMemberInput {
  readonly projectId: string
  readonly userId: string
  readonly role: string
  /** Unix **秒**（`src/time.ts` 的 `nowSeconds()`）；调用方给，不在这里取——同一批写入要共用一个时刻。 */
  readonly timeCreated: number
}

/** 成员行**只吐调用方要的两列**（`projectId` 是查询参数，不吐回去，见文件头 ②）。 */
export interface MemberOfProject {
  readonly userId: string
  readonly role: string
}

export interface ArchiveState {
  readonly archived: boolean
  /** Unix **秒**；未归档为 `null`（与 `archived` 的一致性由迁移那条 CHECK 钉死）。 */
  readonly archivedAt: number | null
}

/**
 * PG `boolean` ⇒ JS `boolean`，**把两种驱动的形状都收掉**。
 *
 * 不是防御性编程：`LEARNINGS #002-01` 咬的正是这条维度——同一列在 PGlite 与生产 bun-sql 下
 * 形状不同，而本包的测试**只能跑 PGlite**（无 Docker / PG 二进制，`#002-05`），所以
 * 「生产驱动下这列长什么样」是**测不到的**。`Boolean()` 在这里是**错的**：`Boolean("f")` 是
 * `true`（任何非空字符串都真），那会把「没归档」读成「已归档」——一个静默的反向。
 * PG 的文本协议吐 `t` / `f`，解析成 boolean 的驱动吐 `true` / `false`，两种都认。
 *
 * 判据：只认**明确为真**的那几种写法，其余一律 false（含 `null` / 缺失列 / 未知形状）。
 */
function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === 1
}

/**
 * 记一条成员关系（T018 建项目时写 owner 行 / T021 邀请时写 member 行）。
 *
 * ⚠️ **不吞错**：撞主键（重复邀请）与撞部分唯一索引（第二个 owner）都必须抛出去由调用方处置。
 * 这两条约束是**数据层的事实**，在上面的 `describe` 组里打真库验过；在这里 catch 掉就等于
 * 把那两条验证变成装饰。
 */
export async function addMember(db: ProjectMemberTarget, input: AddMemberInput): Promise<void> {
  await db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${input.projectId}, ${input.userId}, ${input.role}, ${input.timeCreated})
  `)
}

export interface RemoveMemberInput {
  readonly projectId: string
  readonly userId: string
}

/**
 * 删掉一条成员关系（**T021**：owner 移除一个 member ／ member 退群，FR-004）。
 *
 * ## 为什么 `remove` 与 `leave` 共用这一个函数
 *
 * 两者在库里要做的事**逐字相同**：删掉 `(project_id, user_id)` 那一行。差的是**谁**被删
 * （`remove` 删别人、`leave` 删自己）以及 `ProjectMembership.decide` 认不认——而那是**调用点**
 * 的事（同 `markArchived` 的分工：`auth` 不依赖 `core`）。分开写成两个函数就是把同一句 `delete`
 * 写两遍，且两处一漂就有一侧静默不删（`LEARNINGS #002-06`）。
 *
 * ## 为什么它是 `addMember` 的反面，而 `markRestored` 不是 `markArchived` 的反面
 *
 * 记号上不追求对称：`markArchived` / `markRestored` 之所以分开，是因为「往回翻」要同时改
 * `archived` 与 `archived_at` 两列（那条一致性 CHECK 钉着），是两个字段、两种组合；
 * 而这里两个方向**动作一样**（一行进 / 一行出），多出的那个名字只会多一个漂移点。
 *
 * ## 只删**这个项目**里的那一行
 *
 * `where` 里两个条件缺一不可：漏掉 `project_id` ⇒ 同一个人被从**所有项目**里踢出去，
 * 而调用方只看到「本项目少了一个人」（`project-member.test.ts` 有一条两半的断言钉着它）。
 * 漏掉 `user_id` ⇒ 整个项目的成员一次清空。两条都不报错。
 *
 * ## 不吞错；但「删到 0 行」算成功（幂等）
 *
 * 调用方在删之前刚读过名单（`decide` 的 `target` 要用那个 role），所以正常情况下那一行一定在；
 * 两次移除撞在一起时，后来那次删到 0 行——此时**抛错才是错的**（第一次已经成功，
 * 第二次报「失败」会让界面把话反过来）。
 * ⚠️ **残差如实记**（同 `markRestored`）：`delete` 命中 0 行时同样成功返回，调用方分辨不出
 * 「删掉了」与「本来就没有」。真要防它得去数返回行数，而那条形状在 PGlite 与生产 bun-sql 下
 * 是否一致**没验过**（`LEARNINGS #002-01` 咬的正是这条维度）⇒ 不写没验过的判据。
 */
export async function removeMember(db: ProjectMemberTarget, input: RemoveMemberInput): Promise<void> {
  await db.execute(sql`
    delete from auth.project_member
    where project_id = ${input.projectId} and user_id = ${input.userId}
  `)
}

export interface MarkArchivedInput {
  readonly projectId: string
  /**
   * 归档时刻（Unix **秒**，`src/time.ts` 的 `nowSeconds()`）。
   *
   * 与 `archived = true` 是**一对**（迁移的 `project_archive_coherence_check` 钉着
   * `archived = (archived_at IS NOT NULL)`）⇒ 两者由**同一个**写入点决定，调用方给不了
   * 「只写一个」的组合。时刻由调用方给，不在这里取（同 `addMember`：同一批写入共用一个时刻）。
   */
  readonly archivedAt: number
}

/**
 * 把项目标成**已归档**（T013 / FR-008）。**判定的结果**由调用方先算好（`ProjectMembership.decide`），
 * 本函数只落库——同 `addMember` 的分工：`auth` 不依赖 `core`，所以「能不能」不在这里。
 *
 * 写 `archived = true` ＋ `archived_at`，**upsert**：找回（T014）之后还能再归档，那条路子会
 * 撞上已经存在的 `project_id` 主键——`insert` 会因主键冲突抛出去，而这是**正常流程**，不是异常。
 *
 * ⚠️ **本函数只管「归档」这一侧**：`archived = false` / `archived_at = null`（找回）是 T014 的事，
 * 刻意没在这里合一个 `archived: boolean` 参数——那样两个方向就共用一条写入路径，而它们的
 * 判据、调用点、失败后果都不一样（`LEARNINGS #002-06` 的取向：别把两件事塞进一个判定）。
 *
 * ⚠️ **不吞错**：写不进去（PG 抖一下）必须抛出去——归档流程的最后一步是它，静默失败会让
 * 沙箱已经删了、MinIO 已经有备份，而项目**看起来**没归档。
 */
export async function markArchived(db: ProjectMemberTarget, input: MarkArchivedInput): Promise<void> {
  await db.execute(sql`
    insert into auth.project_archive (project_id, archived, archived_at)
    values (${input.projectId}, true, ${input.archivedAt})
    on conflict (project_id) do update
      set archived = excluded.archived, archived_at = excluded.archived_at
  `)
}

/** 找回（T014 / FR-009）：把项目翻回**未归档**。**没有时刻参数**——未归档的 `archived_at` 就是 `NULL`。 */
export interface MarkRestoredInput {
  readonly projectId: string
}

/**
 * 把项目翻回**未归档**（T014 / FR-009）。`markArchived` 的**反方向**，刻意是两个函数而不是
 * 一个带 `archived: boolean` 的（理由写在 `markArchived` 的注释里：两方向的判据、调用点、
 * 失败后果都不一样）。
 *
 * `update` 而不是 `insert … on conflict do update`（对照 `markArchived` 的 upsert）：走得到这里
 * = 上一句刚从这个表里读出 `archived = true` ⇒ **那一行必然在**。写成 upsert 就等于允许
 * 「本来没有也行」，把「该翻的那一行找不着」也静默算成成功。
 *
 * ⚠️ **残差（如实记，不假装防住了）**：`update` 命中 0 行时它**同样成功返回**，调用方分辨不出。
 * 那条路今天**不可达**——没有任何代码删 `project_archive` 的行（`archived = false` 是「改」不是「删」，
 * 这正是本表要有那一列的理由，见模型注释）。真想防它得去数 `rowsOf(update)` 的行数，而那条形状
 * 在两种驱动下是否一致**没验过**（`LEARNINGS #002-01` 咬的正是这条维度）⇒ 不写没验过的判据。
 *
 * `archived = false` 与 `archived_at = null` **必须成对写**：迁移的
 * `project_archive_coherence_check` 钉着 `archived = (archived_at IS NOT NULL)`，只改一个会被库拒。
 */
export async function markRestored(db: ProjectMemberTarget, input: MarkRestoredInput): Promise<void> {
  await db.execute(sql`
    update auth.project_archive
    set archived = false, archived_at = null
    where project_id = ${input.projectId}
  `)
}

/**
 * 列一个项目的成员（T010 成员面板 / T018 列项目取成员数）。
 *
 * 顺序钉在 `(time_created, user_id)`，理由见文件头 ③——`user_id` 那个次级键不是可有可无的，
 * 去掉它这条查询在同秒成员上就是**不确定**的。
 */
export async function membersOf(db: ProjectMemberTarget, projectId: string): Promise<MemberOfProject[]> {
  const result = await db.execute(sql`
    select user_id, role
    from auth.project_member
    where project_id = ${projectId}
    order by time_created, user_id
  `)
  return rowsOf(result).map((row) => ({
    userId: String(row.user_id),
    role: String(row.role),
  }))
}

/**
 * 读一批项目的归档态：**没有那一行的项目，键在 Map 里缺席，不是 `{ archived: false }`**。
 *
 * 这一条是刻意的，两个理由：
 * ① 与前端那两个接缝（`packages/app/src/project/project-list.ts` / `project-files.ts`）同一个口径
 *    ——「**没有来源**」与「**来源说没有**」是两件事。`project_archive` 的行要到 **T013 归档**时才写，
 *    今天一条都没有；读成 `false` 等于替归档那条链**声称**「查过了，没归档」。
 * ② 默认值该由**调用方**定（今天列表给 `false` 是它的事，将来加「三个月无操作提醒」时
 *    可能要给别的）。在读的一侧焊死，就把那个决定固定在了错的地方。
 *
 * **为什么是批量而不是单条**（T018 收口时改的）：真消费者是「项目列表」那一步，它按定义要为一屏
 * 项目各取一次归档态 ⇒ 单条版本会被调用方循环 N 次（N 次往返，且「批量」这件事就没人写了）。
 * 形状由**调用点**定（`LEARNINGS #004-07`），而调用点这里要的是批量。
 */
export async function archiveStatesOf(
  db: ProjectMemberTarget,
  projectIds: readonly string[],
): Promise<Map<string, ArchiveState>> {
  if (projectIds.length === 0) return new Map()
  const result = await db.execute(sql`
    select project_id, archived, archived_at
    from auth.project_archive
    where project_id in (${idsOf(projectIds)})
  `)
  return new Map(
    rowsOf(result).map((row) => [
      String(row.project_id),
      {
        archived: asBool(row.archived),
        archivedAt: row.archived_at === null ? null : Number(row.archived_at),
      },
    ]),
  )
}

/**
 * 一次取一批项目的成员数（项目列表的 `memberCount`）。
 *
 * **零成员的项目键缺席**（不是 `0`）：`project_member` 里没有行就是没有行，`group by` 天然不给它
 * 产生一行——这里**不补 0**，补了就等于替「这个项目还没加人」编一个看着像查过的数。
 * 调用方的默认值口径与 `archiveStatesOf` 一致（`?? 0` 是调用方的决定）。
 */
export async function memberCountsOf(
  db: ProjectMemberTarget,
  projectIds: readonly string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map()
  const result = await db.execute(sql`
    select project_id, count(*) as n
    from auth.project_member
    where project_id in (${idsOf(projectIds)})
    group by project_id
  `)
  return new Map(rowsOf(result).map((row) => [String(row.project_id), Number(row.n)]))
}

/**
 * 一次取「**这个身份**在这批项目里各是什么角色」（T023：项目列表的 `role`）。
 *
 * ⚠️ **收的是 `userId` ＋ 一批 projectId，返回 `Map<projectId, role>`**——不是「按项目取全部成员，
 * 调用方再挑出自己那个」。后者把「我是谁」这件事交给了调用方：挑错了（或者干脆取了第一个）
 * 不报错、不变红，只是**给了错的人 owner 权限**（`LEARNINGS #004-01` 的同族形状：判据要锚在
 * 「做那件事的那一行」，而这里做那件事的是 `where user_id = ?`）。
 *
 * **没有那一行的项目，键在 Map 里缺席**（同 `archiveStatesOf` / `memberCountsOf` 的口径）：
 * 消费侧（`packages/opencode/src/server/openhive/project.ts`）据此**不给 `role` 键**，
 * 而前端的 `decide({ actor: undefined })` 因此 fail-closed（`RULES.archive` 只认 `owner`）。
 * 在这里补一个默认角色就等于替成员那条链**声称**「查过了」——正是这条要防的。
 *
 * 空数组在入口提前返回（同 `memberCountsOf`：`in ()` 是语法错，应当炸出来而不是被兜住）。
 */
export async function rolesOf(
  db: ProjectMemberTarget,
  input: { readonly userId: string; readonly projectIds: readonly string[] },
): Promise<Map<string, string>> {
  if (input.projectIds.length === 0) return new Map()
  const result = await db.execute(sql`
    select project_id, role
    from auth.project_member
    where user_id = ${input.userId} and project_id in (${idsOf(input.projectIds)})
  `)
  return new Map(rowsOf(result).map((row) => [String(row.project_id), String(row.role)]))
}

export interface RecordProjectInput {
  readonly projectId: string
  readonly name: string
  /** `private` / `shared`（迁移的 CHECK 是闭集的真相来源）。 */
  readonly type: string
}

/**
 * 记一个项目的**名字与类型**（006：`handleCreate` 注册性写入段的一步，**早于**可见性那一步）。
 *
 * ⚠️ **写的是 `insert`，不是 upsert**（对照 `markArchived` 的 upsert）——`project_id` 是建项目时
 * 现取的 UUID，**同一个 id 不会有第二次创建**。撞主键在这里意味着「同一个 id 被记了两次」，
 * 那是写入侧的 bug，**应当抛出来**而不是被 upsert 静默吞掉（`addMember` 同款：这两条约束是
 * 数据层的事实，catch 掉就等于把它们的验证变成装饰）。
 *
 * ⚠️ **私有项目也写**：这张表的消费者（`handleList`）对私有项目同样要用它取名字与类型——
 * 「被邀进一个私有项目」今天拦不住，那时成员看到的类型必须是 `private`。
 */
export async function recordProject(db: ProjectMemberTarget, input: RecordProjectInput): Promise<void> {
  await db.execute(sql`
    insert into auth.project_meta (project_id, name, type)
    values (${input.projectId}, ${input.name}, ${input.type})
  `)
}

export interface MembershipOfUser {
  readonly projectId: string
  /** 加入时刻，Unix **秒**（`time_created`）。 */
  readonly timeCreated: number
}

/**
 * 列「**我**被记在哪些项目里」（006：项目列表的名单那一半）。
 *
 * 名单 = 「我自己建的」∪「我加入的」：前者在各人的 `project_ext` 里，后者**只在 PG 里**
 * ——邀一个人进项目**不会**给他写 `project_ext` 行（T016 实测：`touchProjectExt` 的注释逐字记着
 * 「成员没有 `project_ext` 行」）。所以只读 `project_ext` 的实现必然漏掉成员。
 *
 * 收的是 `userId`（不是「取全部成员再挑」）——同 `rolesOf`：把「我是谁」交给调用方，
 * 挑错了不报错、不变红，只是把别人的项目列给了我。
 *
 * **不吐 `role`**：角色由 `rolesOf` 一条批量查询按 `(userId, projectIds)` 给，两处各取一份
 * 就是同一个判定写两遍（`#002-06`）；本函数只回答「名单里有谁」。
 *
 * 顺序**不写 `order by`**：唯一消费者（`handleList`）要把两类行并起来后按
 * `(lastAccessedAt desc, project_id asc)` **全序**排——那是一个总的比较器，这里的返回顺序
 * 进不了出参。写一条用不上的排序就是替调用方**声称**一个它并不依赖的语义（`LEARNINGS #004-07`：
 * 形状由被调方定，而不是「顺手加一条看着更整齐的」）。
 */
export async function membershipsOf(db: ProjectMemberTarget, userId: string): Promise<MembershipOfUser[]> {
  const result = await db.execute(sql`
    select project_id, time_created
    from auth.project_member
    where user_id = ${userId}
  `)
  return rowsOf(result).map((row) => ({
    projectId: String(row.project_id),
    timeCreated: Number(row.time_created),
  }))
}

/** 一个项目的名字与类型（`projectMetaOf` 的值形状）。 */
export interface ProjectMeta {
  readonly name: string
  readonly type: string
}

/**
 * 一次取一批项目的名字与类型（006：`handleList` 给「只在成员名单里」的那些行取名）。
 *
 * **没有那一行的项目，键在 Map 里缺席**（同 `archiveStatesOf` / `memberCountsOf` / `rolesOf` 的口径）：
 * 0006 之前建的项目在 PG 里就没有名字行，读成某个默认值等于替它们**编**一个名字。
 * 调用方的默认值口径由调用方定（`handleList` 给 `""`，并把它登记成已知缺口）。
 *
 * 空数组在入口提前返回（同 `memberCountsOf`：`in ()` 是语法错，应当炸出来而不是被兜住）。
 */
export async function projectMetaOf(
  db: ProjectMemberTarget,
  projectIds: readonly string[],
): Promise<Map<string, ProjectMeta>> {
  if (projectIds.length === 0) return new Map()
  const result = await db.execute(sql`
    select project_id, name, type
    from auth.project_meta
    where project_id in (${idsOf(projectIds)})
  `)
  return new Map(
    rowsOf(result).map((row) => [
      String(row.project_id),
      { name: String(row.name), type: String(row.type) },
    ]),
  )
}

/**
 * 把 id 列表编成 SQL 的 `in (...)` 参数列。
 *
 * ⚠️ **绝不字符串拼接**——`sql` 模板把每个 id 编成独立的 `$n`（同 `grantsFor` 对 `userId` 的处置，
 * 那里的注入面由 `rbac.test.ts` 的注入用例钉着：「返回空」而不是「没报错」）。
 * 拼字符串的版本也会正常返回，只是返回**错的东西**，这正是它危险的地方。
 *
 * 空数组**不在这里兜**：`in ()` 是语法错，两个调用方都已在入口处提前返回空 Map。
 * 兜在这里会变成「语法错被一处 catch 掉」的第二种写法，而语法错**应当**炸出来（`#002-06`）。
 */
function idsOf(projectIds: readonly string[]) {
  return sql.join(
    projectIds.map((id) => sql`${id}`),
    sql`, `,
  )
}
