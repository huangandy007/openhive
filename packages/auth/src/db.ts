import { drizzle } from "drizzle-orm/bun-sql"

const REQUIRED = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const

export function resolveDatabaseUrl(env: Record<string, string | undefined>): string {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`缺少环境变量 ${key}`)
  }
  return `postgres://${env.PG_USER}:${encodeURIComponent(env.PG_PASSWORD!)}@${env.PG_HOST}:${env.PG_PORT}/${env.PG_DATABASE}`
}

/**
 * 连生产 PG：走 Bun 内建 SQL 客户端（`drizzle-orm/bun-sql`），零新增驱动依赖。
 *
 * 连接是惰性的——构造时不碰网络，第一条查询才真正建连。因此本函数可以安全地
 * 在模块加载期调用；它抛错只有一种原因：PG_* 环境变量没配齐。
 */
export function connect(env: Record<string, string | undefined> = process.env) {
  return drizzle(resolveDatabaseUrl(env))
}
