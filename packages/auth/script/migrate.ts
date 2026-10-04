#!/usr/bin/env bun
import { runMigrate } from "../src/migrate-cli"

/**
 * 部署时把待应用的迁移跑到最新（**D-05** 的可执行路径）。
 *
 * ```bash
 * bun run --filter @opencode-ai/auth migrate
 * ```
 *
 * 读 `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE`——缺任何一个**当场退出非零**，
 * 不做任何「跳过」或默认值（理由见 `../src/migrate-cli.ts` 头部的注释）。
 *
 * 逻辑在 `../src/migrate-cli.ts`（放 `src/` 才测得到），本文件只是入口。
 */
if (import.meta.main) {
  try {
    await runMigrate()
  } catch (error) {
    // 失败要**响**：退出码非零 + 一句人话（`resolveDatabaseUrl` 抛的是「缺少环境变量 PG_X」）。
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
