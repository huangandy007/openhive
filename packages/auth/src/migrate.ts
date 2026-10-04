import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { sql, type SQL } from "drizzle-orm"
import { nowSeconds } from "./time"

const MIGRATIONS_DIR = join(import.meta.dir, "migrations")

/**
 * 手写 SQL 文件里的语句分隔符（drizzle-kit 同款约定）。
 *
 * 一次性下发多条语句在各驱动上不可移植，所以运行器按本分隔符切分、逐条执行。
 */
const BREAKPOINT = "--> statement-breakpoint"

/**
 * 迁移运行器的前置物：先保证 schema 与记账表存在，再谈应用迁移。
 *
 * 记账表记录「哪些版本跑过了」，让 `migrate()` 可重复执行——部署跑两次不会撞
 * "relation already exists"，也不会重复应用。
 *
 * `applied_at` 的列类型是 bigint、但存的仍是 **Unix 秒**，与用户表时间列同单位
 * （见 `src/time.ts`）。类型放宽只是因为它是内部记账，不对任何外部契约负责。
 */
const BOOTSTRAP = [
  "create schema if not exists auth",
  "create table if not exists auth._migration (version text primary key, applied_at bigint not null)",
]

/**
 * 迁移运行器需要的最小数据库能力。PGlite（测试）与 bun-sql（生产）都满足。
 *
 * 返回值刻意收成 `unknown`（而不是 `{ rows }`）：两个 PG 方言的行结构**不一样**，
 * 见 `rowsOf`。收窄成其中一种会让另一个驱动在运行时静默拿到 `undefined`。
 *
 * `transaction` 走 **drizzle 的 `db.transaction()`**，不是 `execute("begin")`：
 * 生产驱动 bun-sql 见到裸 `BEGIN` 会直接拒绝（实测报
 * `ERR_POSTGRES_UNSAFE_TRANSACTION`，「Only use sql.begin, sql.reserved or max: 1」），
 * 而 `execute` 拿到的是一条条**各自成事务**的语句——用它写事务在 PGlite 上能过、
 * 在生产上必挂，正是 `LEARNINGS #002-01` 说的「随驱动而变的形状」。
 */
export interface MigrationTarget {
  execute(query: SQL): PromiseLike<unknown>
  transaction<T>(fn: (tx: MigrationTarget) => Promise<T>): Promise<T>
}

/**
 * 并发锁的键。
 *
 * advisory 锁的命名空间是**整个数据库**、且跨应用共享——同一台 PG 上跑别的系统时，
 * 大家用同一个键会互相挡住。所以这个数要**专属于本用途**（取值随意，固定即可）。
 * 别改它：改了之后，旧版 runner 与新版 runner 会各自持一把不同的锁，互斥就没了。
 */
const MIGRATION_LOCK_KEY = 424242

/**
 * 从查询结果里取出行。
 *
 * drizzle 的 PG 方言把行放在不同位置，这是实测结论（也由 `db.test.ts` 的
 * 「生产驱动满足 MigrationTarget」断言在编译期把关）：
 * - `drizzle-orm/pglite` → `{ rows: [...] }`
 * - `drizzle-orm/bun-sql` → `[...]`（直接就是行数组）
 */
export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (isRows(result)) return result
  if (isRowContainer(result)) return result.rows
  throw new Error(`无法从查询结果中取出行：${String(result)}`)
}

/** bun-sql 的形态：结果本身就是行数组。 */
function isRows(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value)
}

/** pglite 的形态：行挂在 `rows` 上。 */
function isRowContainer(value: unknown): value is { rows: Record<string, unknown>[] } {
  return typeof value === "object" && value !== null && isRows(Reflect.get(value, "rows"))
}

const versionOf = (file: string) => file.replace(/\.sql$/, "")

/** 只认 up 脚本：`*.down.sql` 是回滚脚本，不参与正向迁移。 */
function upFiles(names: string[]): string[] {
  return names.filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql")).sort()
}

/**
 * 仓库里定义了哪些迁移版本（按文件名序，只含 up 脚本）——**「全部应当被应用的版本」的取数口**。
 *
 * 给测试用的：断言「migrate 应用了整批」时，期望值取这里，**不要写死 `["0001_init", …]`**。
 * 写死的话每加一个迁移都要回来改一串测试（`LEARNINGS #002-06`：会随编辑变的值别写死），
 * 004 加 `0004_rbac` 时就是这样一次撞击。
 *
 * 与 `rollback` 里那段「按文件序取已应用的最后一个」共用同一份 `upFiles` —— 两处**不是**
 * 各写一份判据，所以不会悄悄漂（`LEARNINGS #003-05`：假的镜像比没有镜像更危险）。
 */
export async function migrationVersions(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  return upFiles(await readdir(dir)).map(versionOf)
}

/**
 * 「逐条执行」这件事有**两代说法，别把第一代当成现状**。
 *
 * **第一代（002 时期，`0003_flags_not_null.sql` 的文件头就是为此写的）**：运行器**没有事务**
 * ——本函数逐条 `execute`（无 BEGIN/COMMIT），而记账 insert 排在它**之后**。于是
 * 「一个文件中途失败」会留下**改了库、没记账**，重试时从文件头重跑——**这就是当时每个
 * 迁移文件都必须自幂等的原因**。那段话原先写的是「见 `migrate.ts` 的已知缺口」，
 * 而本文件当时并没有这段记载（悬空引用）；T021 把它补在这里。
 *
 * **第二代（T021 起，即现状）**：整轮跑在**一个事务**里并持并发锁（见 `migrate`），
 * 中途失败**整轮回滚**，库回到本轮开始前的样子。于是「自幂等」**不再是运行器的依赖**：
 * 重试是在干净状态上重跑，不是接着半成品往下跑。
 *
 * ⚠️ 这不等于「可以开始写非幂等的迁移」——那是另一个判断，本任务没有做。已知还留着
 * 半边的正是 `rollback()`：它仍是「先跑 down、后删记账」，中途失败同样会留下
 * 「改了库、没记账」（见 003 `state.md` 缺口表）。
 *
 * 实现本身：按分隔符切开一条由人写的 SQL 文件，逐条执行（多语句在同一批里不可移植）。
 */
async function runFile(db: MigrationTarget, dir: string, file: string): Promise<void> {
  const text = await Bun.file(join(dir, file)).text()
  for (const statement of text.split(BREAKPOINT).map((chunk) => chunk.trim())) {
    if (statement) await db.execute(sql.raw(statement))
  }
}

async function appliedVersions(db: MigrationTarget): Promise<Set<string>> {
  const result = await db.execute(sql`select version from auth._migration`)
  return new Set(rowsOf(result).map((row) => String(row.version)))
}

/**
 * 应用 `dir` 下尚未执行的迁移，返回本次实际应用的版本号（按顺序）。
 *
 * 幂等：已记账的版本会跳过，因此可以每次部署都无脑调一次。
 *
 * `dir` 默认是仓库的 `migrations/`，**生产调用方不需要传**。留这个形参是为了让测试能拿一个
 * 装着「故意写坏的文件」的临时目录进来——不这样，就只能往 `migrations/` 里丢测试文件，
 * 而一个跑挂了没删掉的残骸会被**生产的下一次迁移**一起应用（见 `test-support.ts`
 * 的 `withTempMigrations`）。
 *
 * **整轮跑在一个事务里**（T021）。为什么不是「每个文件一个事务」：并发锁必须罩住
 * 「读账 → 应用 → 记账」这整段，而锁是**事务级**的（见下）——每文件一个事务的话，
 * 锁会随第一个文件的事务结束就撒手，第二个 runner 便能挤进来读到同一份旧账。
 * 顺带得到一个更强的性质：中途失败**整轮回滚**，不是只回滚那一个文件。
 *
 * 为什么是 `pg_advisory_xact_lock`（事务级）而不是会话语义那把：会话级的锁挂在
 * **具体某条连接**上，而 bun-sql 的客户端自带连接池（实测一次铺开 10 条），
 * `pg_advisory_lock` 与随后的 `pg_advisory_unlock` 很可能落到**不同连接**——
 * 解锁解了个寂寞，锁一直留在池里那条连接上，此后每次迁移都挂住。事务级那把由
 * 事务结束时自动释放，没有「锁在哪条连接上」这个问题。
 *
 * 等锁的那个 runner 拿到锁之后读到的是**新账**：PG 默认隔离级别是 READ COMMITTED，
 * 每条语句取新快照，而「读账」排在等锁之后。所以它看到前一个 runner 已提交的记账、
 * 本次返回空列表——正是出参要的「另一个等待后看到『已应用』」。
 */
export async function migrate(db: MigrationTarget, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  return db.transaction(async (tx) => {
    // 锁在读账之前：它保护的正是「读账 → 应用」这段不能被打断的窗口。
    //
    // 写成**无参**的 `sql.raw`（而不是 `${MIGRATION_LOCK_KEY}` 那样的绑定参数）：无参语句走
    // 简单查询协议、不占连接上的预编译语句位。键是我们自己源码里的常量、不进任何用户输入，
    // 所以这里拼接没有注入面（同 `BOOTSTRAP` 的用法）。
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`))

    for (const statement of BOOTSTRAP) {
      await tx.execute(sql.raw(statement))
    }

    const applied = await appliedVersions(tx)
    const pending = upFiles(await readdir(dir)).filter((file) => !applied.has(versionOf(file)))

    for (const file of pending) {
      await runFile(tx, dir, file)
      await tx.execute(
        sql`insert into auth._migration (version, applied_at) values (${versionOf(file)}, ${nowSeconds()})`,
      )
    }

    return pending.map(versionOf)
  })
}

/**
 * 回滚指定版本：执行它的 down 脚本并摘掉记账，让它重新变成「待应用」。
 *
 * **只允许回滚当前最后一个已应用的版本（head）**，其余一律拒绝。这不是洁癖，是两条后果：
 *
 * 1. 越过 head 回滚会让**账与 schema 永久背离**，且不可自愈。实测（PGlite）：
 *    `migrate()` 应用 0001+0002 之后回滚 `0001_init`，`0002_deactivated_at` 的记账**还在**，
 *    于是 `migrate()` 永远跳过它；而 `deactivated_at` 列已被 0001 的 down 带走。
 *    此后任何碰该列的查询（`disableAccounts` / `restoreAccount` / `findArchivableAccounts`）
 *    都报 42703，而运行器每次仍报「无待应用迁移」——**一路成功着的失败**，只能人工进库改。
 * 2. 一个版本的 down 脚本本来就假定「排在它之后的版本已经撤掉了」。
 *
 * 顺带把另外两种输入一并挡在门外：未应用的版本（原来只在注释里承诺「不提供」），
 * 以及带路径的版本号——`version` 会拼进 `runFile` 的文件名，`../../x` 读到的文件内容
 * 会直接交给 `sql.raw` 执行。`applied` 只可能含 `migrations/` 下的版本号，所以
 * 上面那道「必须在账上」的检查同时也是路径校验。
 */
export async function rollback(db: MigrationTarget, version: string): Promise<void> {
  const applied = await appliedVersions(db)
  if (!applied.has(version)) throw new Error(`迁移未应用，无法回滚：${version}`)

  // 取「已应用版本里按文件名排在最后的那一个」。用文件序而不是简单的 `applied` 大小，
  // 是为了正确处理「新迁移已写进仓库但还没应用」：那时 head 仍是上一个已应用的版本。
  const appliedInOrder = upFiles(await readdir(MIGRATIONS_DIR))
    .map(versionOf)
    .filter((candidate) => applied.has(candidate))
  const head = appliedInOrder.at(-1)
  if (version !== head) {
    throw new Error(`只能回滚最后一个已应用的版本（当前为 ${head}），不能回滚 ${version}`)
  }

  await runFile(db, MIGRATIONS_DIR, `${version}.down.sql`)
  await db.execute(sql`delete from auth._migration where version = ${version}`)
}
