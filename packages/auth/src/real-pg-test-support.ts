import { sql } from "drizzle-orm"
import { connect } from "./db"
import { migrate } from "./migrate"

/**
 * 真 PG 闸门的唯一开关。
 *
 * 默认不设 ⇒ `*.real-pg.test.ts` 里的用例全部 skip，`bun test` 仍只跑 PGlite，
 * 不引入网络依赖、不需要远端凭据。
 */
export const REAL_PG_FLAG = "OPENHIVE_TEST_PG"

export function realPgEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[REAL_PG_FLAG] === "1"
}

/**
 * 破坏性操作前的硬闸：库名必须以 `_test` 结尾。
 *
 * `withRealPg` 会 `DROP SCHEMA auth CASCADE`。没有这道闸，一次手滑的
 * `OPENHIVE_TEST_PG=1 PG_DATABASE=openhive` 就能清掉验收库。
 * 这条闸不依赖调用方自觉——它就在执行 DROP 的那条路径上。
 */
export function assertDisposableDatabase(env: Record<string, string | undefined> = process.env): string {
  const name = env.PG_DATABASE ?? ""
  if (!name.endsWith("_test")) {
    throw new Error(
      `真 PG 测试拒绝对 "${name || "(未设置)"}" 执行破坏性操作：PG_DATABASE 必须以 _test 结尾（例如 openhive_test）`,
    )
  }
  return name
}

export type RealPg = ReturnType<typeof connect>

/**
 * 在一座**一次性真 PG 库**上跑一段用例：清空 `auth` schema → 跑全量迁移 → 交给回调。
 *
 * ⚠️ 会 `DROP SCHEMA auth CASCADE`；只允许 `_test` 库（见 {@link assertDisposableDatabase}）。
 * ⚠️ 同一个库上不要并行跑两个 `withRealPg`：它们会互相清库。真 PG 套件按串行看待。
 */
export async function withRealPg<T>(fn: (ctx: { db: RealPg; database: string }) => Promise<T>): Promise<T> {
  if (!realPgEnabled()) throw new Error(`未设置 ${REAL_PG_FLAG}=1`)

  const database = assertDisposableDatabase()
  const db = connect(process.env)
  try {
    await db.execute(sql.raw("drop schema if exists auth cascade"))
    await migrate(db)
    return await fn({ db, database })
  } finally {
    await db.$client.close()
  }
}
