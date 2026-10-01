import { eq, inArray, sql } from "drizzle-orm"
import { DEACTIVATED_RETENTION_DAYS, ZOMBIE_INACTIVE_DAYS } from "./policy"
import { nowSeconds } from "./time"
import { type UserAccountTarget, type UserRow, user } from "./user"

/**
 * 僵尸账户：超 90 天没活跃的启用账户（FR-009 / design-v2 §4.3，`2026-09-06-openhive-design-v2.md:180`）。
 *
 * 筛选与批量停用是**两步、由管理员确认**的：先把名单给人看，再按 id 停用。不做「自动清理」——
 * 停用是会影响真人登录的动作，名单里出现一个还在办案的民警就得有人能拦下来。
 */

const SECONDS_PER_DAY = 24 * 60 * 60

/** 状态取值：1 启用 / 0 停用（design-v2 `:136`，与 login.ts 同一读法）。 */
const ENABLED = 1
const DISABLED = 0

/** `is_admin` 取值：1 管理员 / 0 普通民警（与 `bootstrap.ts` 同一读法）。 */
const ADMIN = 1

/**
 * 这一批停用会把系统停成「一个管理员都没有」（002 评审 I9 的另一半，T024）。
 *
 * 连带停掉的人和发起停用的人可以是同一个——判据只看**停完之后还剩不剩**能登录的管理员，
 * 不看是谁点的。真按「不能停自己」写，防的是误操作，防不住「两个管理员互相停」。
 */
export class LastAdminError extends Error {
  constructor(policeNos: string[]) {
    super(`不能停用最后一个管理员（${policeNos.join("、")}）：停用后将没有人能管理账号`)
    this.name = "LastAdminError"
  }
}

/** 只用到三个时间列——收窄入参，纯函数才能被直接单测。 */
export type LastSeenFields = Pick<UserRow, "lastActiveAt" | "lastLoginAt" | "createdAt">

/**
 * 「最后一次有活着迹象」的时刻（Unix 秒）。
 *
 * 三级回退，缺省即「从没写过」：
 * - `last_active_at` —— 最准（design-v2 §4.1 说它「请求时更新」，比登录更细）
 * - `last_login_at` —— 登录过但没打过标记的账号
 * - `created_at` —— 建号后从没登录过
 *
 * ⚠️ **`last_active_at` 全仓库没有写入方**：它的写入点是网关每请求刷新，属 T018/F3 的活。
 * 因此**不能**照 design-v2 字面只比 `last_active_at`——那列眼下恒为 NULL，
 * `last_active_at < 截止线` 对 NULL 求值为 NULL（不为真），筛选会**永远返回 0 条**。
 * 而 0 条不会报错、不会变红，管理员只会看到「暂无僵尸账户」并信以为真。回退到 `created_at`
 * 才让这个功能今天就可用；等网关接上写入方后，回退链自然收敛到第一级。
 *
 * SQL 侧（`findZombieAccounts`）与 JS 侧（本函数）是同一规则的两份实现，
 * `zombie.test.ts` 里有一条**对账测试**把两者钉在一起，改一边不改另一边会红。
 */
export function lastSeenAtOf(row: LastSeenFields): number {
  return row.lastActiveAt ?? row.lastLoginAt ?? row.createdAt
}

/** 一条待处理的僵尸账户。 */
export interface ZombieAccount {
  id: string
  policeNo: string
  name: string
  /** 最后一次有活着迹象的时刻（Unix 秒）。取值规则见 `lastSeenAtOf`。 */
  lastSeenAt: number
}

/**
 * 筛出「启用、且超 90 天没活跃」的账户。
 *
 * 条件写成**一条 SQL 表达式**而不是 drizzle 的 `and(eq(...), lt(...))`：
 * 窄接口 `UserAccountTarget.where` 收的是 `SQL`，而 drizzle 的 `and()` 返回 `SQL | undefined`，
 * 拼起来要在调用点处理 undefined；整条 `sql` 模板顺带把 coalesce 写得看得见。
 *
 * `now` 默认取当前时刻，显式传入是为了让「恰好 90 天」这种边界用例可复现。
 *
 * 不排序：查出来是给管理员过目 + 勾选的名单，顺序不稳不影响正确性，前端要排再排。
 */
export async function findZombieAccounts(db: UserAccountTarget, now: number = nowSeconds()): Promise<ZombieAccount[]> {
  const cutoff = now - ZOMBIE_INACTIVE_DAYS * SECONDS_PER_DAY
  const lastSeen = sql`coalesce(${user.lastActiveAt}, ${user.lastLoginAt}, ${user.createdAt})`

  // 严格小于：要求是「**超过** 90 天」，正好 90 天的还不算。
  const rows = await db
    .select()
    .from(user)
    .where(sql`${user.status} = ${ENABLED} and ${lastSeen} < ${cutoff}`)

  return rows.map((row) => ({
    id: row.id,
    policeNo: row.policeNo,
    name: row.name,
    lastSeenAt: lastSeenAtOf(row),
  }))
}

/**
 * 按 id 批量停用（FR-009 的「一键」）。
 *
 * 只改 `status` + 记下 `deactivated_at`，**不删任何数据**——停用是可逆的（FR-010 要求 30 天内
 * 可恢复），而删除不可逆。
 *
 * 为什么必须记停用时刻：FR-010 的「保留 30 天再归档」需要一个起算点（T016）。不记的话，
 * 事后无法区分「刚停用」和「三年前就停了」，只能一律不敢归档。
 *
 * 空名单不必特判：`inArray(x, [])` 生成恒假条件，一行也动不了（`zombie.test.ts` 钉住了这条）。
 *
 * ### 为什么 `where` 里多一个 `status = 1`（幂等）
 *
 * 只按 id 更新的话，**已经停用的账号再停一次会把 `deactivated_at` 改写成当下**
 * （T016 起这列有了第二个消费方，这个洞才开始有后果）。那不是「刷新了一下数据」——
 * 停用日期是**事实**，而 FR-010 的 30 天保留期是从它起算的。被改写意味着保留期从头再来：
 * 前端拿着一张翻页前的旧名单又点了一次批量停用，就能把「明天该归档」推成「再等 30 天」，
 * 而**一直有人点就一直不归档**——沙箱和账号数据无限期留在系统里。
 *
 * 多余的一次改写还会毁掉第三种状态：`NULL + status=0` 是 design-v2 §4.1 明写的
 * 「停用但时刻未知」（002 之前的历史数据）。给它补一个 `now` 不是「补全了数据」，
 * 而是**声称我们知道它是刚停的**——那批数据此后 30 天就会被当成逾期对象归档掉，
 * 正是 FR-010「避免误删」要防的事。限制成「只动启用中的行」后，它原样留着。
 *
 * 于是 `disableAccounts` 变成幂等的：对已停用的 id 是一次 no-op，不是一次改写。
 * 代价是这列不再能回答「最后一次点停用是什么时候」——那本来也不是它该回答的问题。
 *
 * ### 不得把系统停成「一个管理员都没有」（T024，002 评审 I9 的另一半）
 *
 * 判据是**因果式**的：本批 id 覆盖了**当前全部**启用管理员才拦。表里本来就是 0 个启用管理员
 * （例如 T019 引导之前、或引导还没跑）时放行——那时没什么可保护的，拦下来只是让一个无害动作
 * 失败。
 *
 * 三条刻意的取舍，都别「顺手改好」：
 *
 * 1. **整批拒绝，不是跳过那一个**。跳过会让「同批的普通僵尸照常停用」，于是调用方看到「部分成功」，
 *    而多账号批量操作里最难查的正是**部分成功**——管理员只知道「点了一下」，不知道停掉了哪些。
 *    抛错则整批回到原样，可重试、可改选。代价是这批白勾了，得重新挑一遍——比悄悄停掉一半强。
 * 2. **拦的是「停」这个动作，不是把管理员从僵尸名单里滤掉**。一个 90 天没人用、却能录入账号和
 *    重置密码的账号是**特权休眠账号**，恰恰最该被管理员看见；从名单里滤掉 = 把它藏起来。
 * 3. **停用的管理员不算数**（判据里的 `status = 1`）。停用的人**登不进去**，把他算作「还有一个
 *    管理员」= 放行一个把系统锁死的动作。⚠️ 与 `bootstrap.ts` 的判据**不同**，别照抄那一边：
 *    那边的 `hasAdmin` 刻意不带 status，理由是「表里有没有管理员」是**一次性**开关的判据，
 *    带了 status 会让「引导过一个、后来停用了」变成「谁能再引导一次」——两处前提不同。
 *
 * 已知缺口（与 `bootstrapAdmin` 同一先例、同一登记方式）：**读-判-写之间有窗口**（TOCTOU）。
 * 两个管理员同时各自停用对方，可能都读到「还剩两个」而都放行。闭合它要么上事务 + 行锁、
 * 要么把判据下推成一条带子查询的 SQL，本任务都没做——生产里这个动作**今天没有调用方**
 * （治理后台属 F10），而调用方出现之前，窗口没人能走到。已记在 003 `state.md` 缺口表。
 */
export async function disableAccounts(
  db: UserAccountTarget,
  ids: string[],
  now: number = nowSeconds(),
): Promise<void> {
  // 守卫排在写之前。`ids` 为空时下面 `every` 恒为 false ⇒ 放行，与「空名单一行也不动」一致。
  const admins = await db
    .select()
    .from(user)
    .where(sql`${user.isAdmin} = ${ADMIN} and ${user.status} = ${ENABLED}`)
  if (admins.length > 0 && admins.every((admin) => ids.includes(admin.id))) {
    throw new LastAdminError(admins.map((admin) => admin.policeNo))
  }

  await db
    .update(user)
    .set({ status: DISABLED, deactivatedAt: now })
    // 条件写成一条 `sql` 模板而不是 `and(...)`：`and()` 的返回类型是 `SQL | undefined`，
    // 而窄接口 `UserAccountTarget.where` 只收 `SQL`（同 `findZombieAccounts` 的处理）。
    .where(sql`${inArray(user.id, ids)} and ${user.status} = ${ENABLED}`)
}

/**
 * 恢复一个被停用的账号（FR-010「保留期内可恢复」）。
 *
 * 同时把 `deactivated_at` **清回 NULL**——这条比「状态改回来」更容易漏。
 *
 * 诚实标注：**今天这条清空是与查询冗余的**（变异验证实测：不清也只红 1 条）。因为
 * `findArchivableAccounts` 同时要求 `status = 0`，恢复后 `status = 1` 就已被挡在外面了。
 * 仍然清，是为了守住「**有值即当前处于停用中**」这条数据不变式——它只在「每个消费方都记得
 * 带上 status 过滤」时才成立，而靠每个查询的自觉来维持的不变式是个陷阱：
 * F3 的归档任务只要写漏一次 status 条件，动到的就是正在办案的民警的沙箱。
 * 让安全性长在**数据**上，不长在查询纪律上。
 *
 * **不按天数拦截**：FR-010 说的「保留期内可恢复」保留的是**沙箱/数据**，不是账号行本身；
 * 给账号恢复加一个 30 天的硬门槛是设计文档里没有的新规则，不擅自加。
 * 停用满 30 天后沙箱可能已被归档（F3），那时该走的是「恢复归档」而不是禁止恢复。
 */
export async function restoreAccount(db: UserAccountTarget, id: string): Promise<void> {
  await db.update(user).set({ status: ENABLED, deactivatedAt: null }).where(eq(user.id, id))
}

/** 一条已过保留期、可供归档的账号。 */
export interface ArchivableAccount {
  id: string
  policeNo: string
  name: string
  /** 停用时刻（Unix 秒）。保证非空——没有停用时刻的根本不进这个清单。 */
  deactivatedAt: number
}

/**
 * 列出停用已**超过 30 天**的账号，交 F3 的归档任务处置（FR-010）。
 *
 * 本 feature 只负责**筛出来**，不碰文件系统：002 的沙箱还只是 `createWorkspace` 建的空目录，
 * 归档/删除留到 F3（那时才有每用户 db 与真实研判产物）。经用户 2026-09-29 裁定。
 *
 * **`deactivated_at` 为 NULL 的停用账号一律不进清单**（刻意保守）：那是 002 之前停用、
 * 没有停用时刻的历史数据。把 NULL 当成「很久以前」会让一次误删再也回不来——
 * FR-010 要的恰恰是「避免误删」。宁可漏归档，留给人判断。
 */
export async function findArchivableAccounts(
  db: UserAccountTarget,
  now: number = nowSeconds(),
): Promise<ArchivableAccount[]> {
  const cutoff = now - DEACTIVATED_RETENTION_DAYS * SECONDS_PER_DAY

  // `<=`：正好满 30 天即到期（与僵尸账户的「超过 90 天」不同，那条要求是「超过」）。
  // NULL 比较结果为 NULL，天然被排除——正是上面要的保守行为，不必额外写 is not null。
  const rows = await db
    .select()
    .from(user)
    .where(sql`${user.status} = ${DISABLED} and ${user.deactivatedAt} <= ${cutoff}`)

  return rows.map((row) => ({
    id: row.id,
    policeNo: row.policeNo,
    name: row.name,
    // 走到这里的行 deactivatedAt 必非空（NULL 过不了上面的比较），但类型上仍是可空的，
    // 故这里退一步：真出现 null 就当 0 报出去，好过让它静默变成 undefined 传到界面。
    deactivatedAt: row.deactivatedAt ?? 0,
  }))
}
