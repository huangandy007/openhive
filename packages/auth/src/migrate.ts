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
 */
export interface MigrationTarget {
  execute(query: SQL): PromiseLike<unknown>
}

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

/** 按分隔符切开一条由人写的 SQL 文件，逐条执行（多语句在同一批里不可移植）。 */
async function runFile(db: MigrationTarget, file: string): Promise<void> {
  const text = await Bun.file(join(MIGRATIONS_DIR, file)).text()
  for (const statement of text.split(BREAKPOINT).map((chunk) => chunk.trim())) {
    if (statement) await db.execute(sql.raw(statement))
  }
}

async function appliedVersions(db: MigrationTarget): Promise<Set<string>> {
  const result = await db.execute(sql`select version from auth._migration`)
  return new Set(rowsOf(result).map((row) => String(row.version)))
}

/**
 * 应用 `migrations/` 下尚未执行的迁移，返回本次实际应用的版本号（按顺序）。
 *
 * 幂等：已记账的版本会跳过，因此可以每次部署都无脑调一次。
 */
export async function migrate(db: MigrationTarget): Promise<string[]> {
  for (const statement of BOOTSTRAP) {
    await db.execute(sql.raw(statement))
  }

  const applied = await appliedVersions(db)
  const pending = upFiles(await readdir(MIGRATIONS_DIR)).filter((file) => !applied.has(versionOf(file)))

  for (const file of pending) {
    await runFile(db, file)
    await db.execute(
      sql`insert into auth._migration (version, applied_at) values (${versionOf(file)}, ${nowSeconds()})`,
    )
  }

  return pending.map(versionOf)
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

  await runFile(db, `${version}.down.sql`)
  await db.execute(sql`delete from auth._migration where version = ${version}`)
}
