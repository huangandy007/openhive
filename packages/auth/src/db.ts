const REQUIRED = ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE"] as const

export function resolveDatabaseUrl(env: Record<string, string | undefined>): string {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`缺少环境变量 ${key}`)
  }
  return `postgres://${env.PG_USER}:${encodeURIComponent(env.PG_PASSWORD!)}@${env.PG_HOST}:${env.PG_PORT}/${env.PG_DATABASE}`
}
