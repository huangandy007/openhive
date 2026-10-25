#!/usr/bin/env bun
/**
 * 用远端**真 PG** 跑资产服务的「真实例闸门」测试（默认 `bun test` 不跑）。
 *
 * ```bash
 * bun run --filter @opencode-ai/asset-service test:real-pg
 * ```
 *
 * 与 `packages/auth/script/test-real-pg.ts` 同一套约定（逐字沿用，不另造一份）：
 * 1. 从 `packages/opencode/.env` + `.env.local` 读远端 PG 凭据（bun 只从 cwd 加载 `.env*`，
 *    而这两份文件在 `packages/opencode/`，所以要显式读、不依赖当前 cwd）；
 * 2. 强制 `PG_DATABASE=openhive_test`、`OPENHIVE_TEST_PG=1`；
 * 3. 在该环境下跑 `src/real-pg.test.ts`。
 *
 * ⚠️ 用例会 `DROP SCHEMA auth CASCADE`。库名必须 `_test` 结尾，
 * `@opencode-ai/auth` 的 `real-pg-test-support.ts` 在执行 DROP 的同一条路径上有硬闸。
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const assetDir = join(import.meta.dir, "..")
const opencodeDir = join(assetDir, "..", "opencode")

function parseEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2]!.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]!] = value
  }
  return out
}

function readIfExists(file: string): Record<string, string> {
  try {
    return parseEnv(file)
  } catch {
    return {}
  }
}

const env: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) env[key] = value
}
Object.assign(env, readIfExists(join(opencodeDir, ".env")), readIfExists(join(opencodeDir, ".env.local")), {
  PG_DATABASE: "openhive_test",
  OPENHIVE_TEST_PG: "1",
})

console.log(`真 PG 测试 → ${env.PG_HOST}:${env.PG_PORT}/${env.PG_DATABASE}（角色 ${env.PG_USER}）`)

const proc = Bun.spawn(["bun", "test", "--timeout", "60000", "src/real-pg.test.ts"], {
  cwd: assetDir,
  env,
  stdio: ["inherit", "inherit", "inherit"],
})
process.exit(await proc.exited)
