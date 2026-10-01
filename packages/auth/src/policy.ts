/**
 * 002 锁定的认证策略常量。
 *
 * 取值来源：
 * - 默认密码：design-v2 §4.1（`2026-09-06-openhive-design-v2.md:147`）——统一派发，靠首次强制改密兜底
 * - 哈希算法：plan.md 依赖清单（argon2id），用 Bun.password 内建实现，零外部依赖
 * - 凭证有效期：spec.md FR-004 / Assumptions（约 2 小时，到期需重新登录）
 */

/** 承载默认密码的环境变量。 */
export const DEFAULT_PASSWORD_ENV = "OPENHIVE_DEFAULT_PASSWORD"

/**
 * 解析派发给新账号 / 重置用的**默认密码**。
 *
 * ## 没有默认值，缺失即抛
 *
 * 这里**刻意不设兜底**（照 `jwtSecret(env)` 先例）。曾经的写法是 `policy.ts` 里一个
 * `DEFAULT_PASSWORD = "admin@123456"` 常量，问题不在于它写在源码里，而在于
 * **兜底会让「生产忘了配」变成静默使用一个公开的示例口令**——而全系统没有一处会红。
 * 调用方（网关）在**层构造期**调它，所以抛 = 进程起不来 = 看得见的失败。
 *
 * ## 与 design-v2 正文那个示例值的关系
 *
 * design-v2 §4.1 把 `admin@123456` 当**公开示例**写在正文里，那是**文档**在说明
 * 「首次怎么登录」（引导链依赖它）。2026-09-30 的 D5 裁定：**保留文档正文的示例值**，
 * 关系在这里说清——正文那个是**示例**，本函数解析出来的才是**部署实际使用的值**。
 * 二者不一致是**正常的**，也不需要同步：示例值不会被任何代码路径读走。
 *
 * ⚠️ **生产部署必须配**；不配则进程起不来（上面那条刻意的设计）。
 *
 * ## 只拒「没配」与「配了个空白」，不校验强度
 *
 * 空串与纯空白**抛**：它们「看起来配了、实际等于没配」，是部署排查时最费劲的一种。
 * **不设长度地板**——默认密码是「首次登录用、强制改密兜底」的**临时**口令
 * （`must_change_pw = 1`），不是长期凭证；强度要求的落点是改密那一侧
 * （`changePassword` 拒绝新密码等于默认密码），不是这里。
 */
export function defaultPassword(env: Record<string, string | undefined>): string {
  const password = env[DEFAULT_PASSWORD_ENV]
  if (!password || password.trim() === "") {
    throw new Error(
      `缺少环境变量 ${DEFAULT_PASSWORD_ENV}（或它的值是空白）——` +
        `默认密码没有兜底值：公开的示例口令等于没有口令`,
    )
  }
  // 不 trim：空格可以是密码的一部分，只有**纯**空白才算「没配」。
  return password
}

/** 密码哈希算法。Bun.password 内建，无需引入第三方密码库。 */
export const PASSWORD_HASH_ALGORITHM = "argon2id" as const

/** 登录凭证有效期（秒）。2 小时。 */
export const TOKEN_TTL_SECONDS = 2 * 60 * 60

/** 多久没活跃就算僵尸账户（天）。design-v2 §4.3 定 90 天。 */
export const ZOMBIE_INACTIVE_DAYS = 90

/** 停用后沙箱与数据保留多久再归档/删除（天）。FR-010 定 30 天。 */
export const DEACTIVATED_RETENTION_DAYS = 30

/** 承载登录凭证的 Cookie 名。 */
export const SESSION_COOKIE_NAME = "openhive_session"

/** 签发凭证所需的密钥环境变量。取值由部署方生成，MUST NOT 在仓库里放默认值。 */
export const JWT_SECRET_ENV = "AUTH_JWT_SECRET"

/**
 * 「最后活跃时间」的**节流窗口**（秒）。
 *
 * design-v2 §4.1 说 `last_active_at`「请求时更新」，而今天的客户端是**轮询**的
 * （`/session`、事件流）——不节流的话这一条 UPDATE 会成为全系统最高频的写。
 * 60 秒的滞后对它唯一的消费者（§4.3 的「超过 90 天未活跃」）没有任何影响。
 */
export const ACTIVITY_THROTTLE_SECONDS = 60

/** 覆盖节流窗口的环境变量。不设即用默认值。 */
export const ACTIVITY_THROTTLE_SECONDS_ENV = "OPENHIVE_ACTIVITY_THROTTLE_SECONDS"

/**
 * 解析节流窗口。**读 env 记录，不直接读 `process.env`**（照 `router.ts` 的 `dataRoot(env)`
 * 先例）——调用方与测试因此都能注入。
 *
 * 读不出正整数时**抛**，不静默退回默认值：`NaN` 会一路变成 `last_active_at <= NaN`，
 * 那个比较在 SQL 里恒为 NULL（不为真）⇒ 这一列**再也不更新**，而全系统没有一处会红
 * ——僵尸账户识别只是慢慢变不准（`LEARNINGS #002-02` 那类静默失效）。
 * 调用方（网关）在**层构造期**调它，所以在这里抛 = 进程起不来 = 看得见的失败。
 */
export function activityThrottleSeconds(env: Record<string, string | undefined>): number {
  const raw = env[ACTIVITY_THROTTLE_SECONDS_ENV]
  if (raw === undefined) return ACTIVITY_THROTTLE_SECONDS

  const seconds = Number(raw)
  if (!Number.isInteger(seconds) || seconds <= 0) {
    // 报错带上原值：`Number("")` 是 0、`Number("六十")` 是 NaN，不带原值的话
    // 「我明明配了 60」和「我配了个空格」在日志里长得一模一样。
    throw new Error(`${ACTIVITY_THROTTLE_SECONDS_ENV} 必须是正整数秒，收到 ${JSON.stringify(raw)}`)
  }
  return seconds
}

/**
 * 引导首个管理员的警号。**只在「表里一个管理员都没有」时生效**，引导跑通即可撤掉。
 *
 * 名字里带 `BOOTSTRAP` 而不是 `INITIAL_ADMIN` 之类，是为了让它在部署脚本里一眼可辨——
 * 它是个**一次性**开关，长驻在环境里没有意义（逻辑上也无害，见 `bootstrap.ts`）。
 */
export const BOOTSTRAP_ADMIN_POLICE_NO_ENV = "OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO"
