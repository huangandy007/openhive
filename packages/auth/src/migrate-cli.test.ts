import { describe, expect, test } from "bun:test"
import { runMigrate } from "./migrate-cli"
import { withProductionDb } from "./test-support"

/**
 * 迁移 CLI（**D-05**）。
 *
 * `docs/workspace/deploy-todo.md` 的 D-05：`migrate()` 在生产里**唯一**的调用点是 003 引导
 * 首个管理员的 `bootstrap()`，而引导是**一次性**的、跑通就该撤变量 ⇒ **撤掉之后新迁移没人应用**。
 * 004 要加 0004（RBAC 表），正好撞上这条欠账。用户 2026-10-04 裁定：**给迁移一个独立 CLI**，
 * 路径 ＝ `bun run --filter @opencode-ai/auth migrate`。
 *
 * ⚠️ **本 CLI 不带 `rollback()`**（同上裁定）：003 给 R11 写下的**回归条件 ③**是
 * 「`rollback()` 有了生产调用者」。只做向上迁移 ⇒ 条件**未触发**，维持 003 的「明确不做」。
 * **本 CLI 一旦加 rollback 子命令 ⇒ R11 立即回归**（那句话也写进了 `migrate-cli.ts` 与 D-05 条目）。
 *
 * 本组钉的是 D-05 的两个「必须能分辨」：
 * ① 缺配置 ⇒ **当场抛**（病根恰恰是「静默不跑」）；
 * ② 没活干 ⇒ **说一声**（人得能分清「跑了、没事干」与「根本没跑」）。
 */

describe("迁移 CLI（D-05）", () => {
  /**
   * canary ① —— D-05 的病根是**静默**：迁移搭在引导变量的便车上，不设变量就一个字节都不做、
   * 也不报错，而部署方以为迁移跑过了。CLI 绝不能把这个病复制过来：**缺 `PG_*` 必须当场抛**，
   * 且要在**连库之前**抛（`connect()` → `resolveDatabaseUrl` 就是这么做的，这里钉住它没被换掉）。
   *
   * 这条红 ＝ 有人把「缺配置」改成了跳过、默认值或 warning。
   */
  /**
   * ⚠️ **刻意不写 `await expect(...).rejects.toThrow(...)`**：`bun-types` 把 `.rejects` 声明成
   * `Matchers<unknown>`（`toThrow` 返回 `void`），`await` 一个 `void` 会被 `await-thenable` 记一条
   * ——**全仓已有 98 处同类命中**（含 `packages/app` 与 `packages/core` 的既有测试），本机实测。
   * 本 feature 的门禁判据是「**本次新增 / 改动文件 0 命中**」，所以这里换个写法：
   * 断言照样真的被执行（不是悬空的 promise），且「它居然没抛」这件事自己会红。
   */
  test("缺 PG_*：当场抛错，不静默空操作", async () => {
    const failure = await runMigrate({}, () => {}).then(
      () => null,
      (error: unknown) => error,
    )

    if (!(failure instanceof Error)) throw new Error("期望 runMigrate 当场抛错（缺 PG_* 不许静默成功），实际它成功返回了")
    expect(failure.message).toMatch(/PG_HOST/)
  })

  /**
   * canary ② —— 真库（**生产驱动** `bun-sql` × PGlite socket，夹具见 `test-support`；
   * `withProductionDb` 顺手把 `PG_*` 铺进 `process.env`，正是 CLI 的默认入参）。
   *
   * 两半都要断，**第二半才是这条存在的理由**：
   * - **应用**：第一次跑得有活干（返回非空）；
   * - **幂等 ＋ 可见**：第二次跑返回空，**但仍要有输出**——「已是最新」与「根本没跑」在运维眼里
   *   必须能分开。`migrate()` 自身幂等已有测试覆盖（含生产驱动那半），这里钉的是 **CLI 说没说**。
   *
   * 刻意**不断言具体版本列表**（不写死 `["0001_init", …]`）：004 正要加 0004，写死了这条就会
   * 被下一个迁移撞红，而它要钉的根本不是「有哪些迁移」（`LEARNINGS #002-06`：会随编辑变的值别写死）。
   */
  test("真库：应用待迁移；第二次幂等，且仍有输出（不是静默退出）", async () => {
    await withProductionDb(async () => {
      const firstLines: string[] = []
      const applied = await runMigrate(process.env, (line) => firstLines.push(line))
      expect(applied.length).toBeGreaterThan(0)
      expect(firstLines.length).toBeGreaterThan(0)

      const secondLines: string[] = []
      const again = await runMigrate(process.env, (line) => secondLines.push(line))
      expect(again).toEqual([])
      expect(secondLines.length).toBeGreaterThan(0)
    })
  })
})
