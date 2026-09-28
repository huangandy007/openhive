/**
 * 002 锁定的认证策略常量。
 *
 * 取值来源：
 * - 默认密码：design-v2 §4.1（`2026-09-06-openhive-design-v2.md:147`）——统一派发，靠首次强制改密兜底
 * - 哈希算法：plan.md 依赖清单（argon2id），用 Bun.password 内建实现，零外部依赖
 * - 凭证有效期：spec.md FR-004 / Assumptions（约 2 小时，到期需重新登录）
 */

/** 管理员录入账号时派发的统一默认密码。 */
export const DEFAULT_PASSWORD = "admin@123456"

/** 密码哈希算法。Bun.password 内建，无需引入第三方密码库。 */
export const PASSWORD_HASH_ALGORITHM = "argon2id" as const

/** 登录凭证有效期（秒）。2 小时。 */
export const TOKEN_TTL_SECONDS = 2 * 60 * 60
