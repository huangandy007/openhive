import { connect } from "./db"
import { migrate } from "./migrate"

/**
 * 迁移 CLI 的逻辑（**D-05**）。
 *
 * 落点为什么在这：`docs/workspace/deploy-todo.md` 的 **D-05** 记着——`packages/auth` 的
 * `migrate()` 在生产里**唯一**的调用点是 003 引导首个管理员的 `bootstrap()`，而引导是
 * **一次性**的、跑通就该把变量撤掉 ⇒ **撤掉之后新迁移没人应用**。002 写的是「幂等、部署可
 * 无脑重复调」，但仓库里**没有那个「调」**：无 CLI、无脚本。004 要加 0004（RBAC 表），
 * 正好撞上这条欠账 ⇒ 用户 2026-10-04 裁定：**给迁移一个独立的 CLI**。
 *
 * ⚠️ **本 CLI 只做向上迁移，刻意不带 `rollback()`**（同上裁定）。
 * 003 给 **R11** 写下的**回归条件 ③**原文是：「**`rollback()` 有了生产调用者**——例如 D-05
 * 「谁在生产里跑迁移」的裁定给了它一个 CLI / 启动开关。那一刻它就从『没人用的函数』变成
 * 『库已经出问题、人很紧张时手边唯一的工具』，而静默放行的守卫恰是那时最不该有的东西」。
 * ⇒ 只做向上迁移 ⇒ 该条件**未触发**，维持 003 的「明确不做」裁定，本次一行不动 R11。
 * 🚩 **本 CLI 一旦加 `rollback` 子命令（或任何会调到 `rollback()` 的路径）⇒ R11 立即回归**，
 * 必须先把 `rollback()` 的 head 守卫修掉（修法方向见 003 `state.md` 的「R11 的裁定与回归条件」节）。
 *
 * ⚠️ **缺 `PG_*` 必须当场抛，不许静默跳过**：D-05 的病根就是「静默不跑」——今天不设引导变量，
 * 迁移一个字节都不做且不报错，而部署方以为跑过了。CLI 若把缺配置降级成跳过 / 默认值，
 * 就是把同一个病换个入口再得一遍。`connect()` 的 `resolveDatabaseUrl` 在**连库之前**就抛，
 * 且抛在 `try` 之外 —— 此时还没有连接要关。
 */

/** 拿一行输出（可注入，测试用）。 */
export type Log = (line: string) => void

/**
 * 把待应用的迁移跑到最新，返回**本次实际应用**的版本号（没有待应用时返回空数组）。
 *
 * `env` 默认 `process.env`——部署时读的就是它；测试里传 PGlite 那套（`withProductionDb`
 * 会顺手铺进 `process.env`）。
 *
 * 幂等由 `migrate()` 自己保证（记账表 ＋ 事务级 advisory lock，见 `./migrate.ts`），
 * 本函数只管「连上、跑、说一声、关掉」。
 */
export async function runMigrate(
  env: Record<string, string | undefined> = process.env,
  log: Log = console.log,
): Promise<string[]> {
  const db = connect(env)
  try {
    const applied = await migrate(db)
    // **没活干也要说一声**：运维必须能分清「跑了、没事干」与「根本没跑」。
    if (applied.length === 0) log("迁移：已是最新，没有待应用的版本")
    else for (const version of applied) log(`迁移：已应用 ${version}`)
    return applied
  } finally {
    // 显式关连接：CLI 是**一次性进程**，不关会让进程挂在自己开的连接池上不退出。
    await db.$client.close()
  }
}
