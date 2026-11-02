export * as OpenhiveMcpChildEnv from "./openhive-child-env"

/**
 * 【这是要保留的定制】openhive：本地 MCP 子进程的环境净化。
 *
 * 业务 MCP 的命令由资产管理员填写，等价于「受审核的任意代码执行」；但它**不该**顺带拿到
 * 平台的数据库与对象存储凭据。内核自己的 `.env` 里有 `PG*` / `OPENHIVE_MINIO_*`，直接
 * `...process.env` 起子进程等于把「能执行命令」升级成「能连平台库」。
 *
 * 被剥掉的名字分三类：整键（连接串 / 配置原文；**按大小写无关比较**——Windows 上
 * `database_url` 与 `DATABASE_URL` 是同一个进程环境项）、前缀（`PG*`、`OPENHIVE_MINIO*`）、
 * 凭据字样（SECRET / PASSWORD / TOKEN / CREDENTIAL / API_KEY / PRIVATE_KEY，忽略大小写）。
 * 需要某台 MCP 专用变量时，把它写进资产的 `environment`——那份是显式授权的。
 */
const 整键 = new Set(["DATABASE_URL", "OPENCODE_CONFIG_CONTENT"])
const 前缀 = [/^PG/i, /^OPENHIVE_MINIO/i]
const 凭据字样 = /(SECRET|PASSWORD|TOKEN|CREDENTIAL|API_KEY|PRIVATE_KEY)/i

export function 净化子进程环境(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const 结果: Record<string, string> = {}
  for (const [键, 值] of Object.entries(env)) {
    if (值 === undefined) continue
    if (整键.has(键.toUpperCase())) continue
    if (前缀.some((模式) => 模式.test(键))) continue
    if (凭据字样.test(键)) continue
    结果[键] = 值
  }
  return 结果
}
