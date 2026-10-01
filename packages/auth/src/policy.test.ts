import { describe, expect, test } from "bun:test"
import {
  ACTIVITY_THROTTLE_SECONDS,
  ACTIVITY_THROTTLE_SECONDS_ENV,
  activityThrottleSeconds,
  DEFAULT_PASSWORD_ENV,
  defaultPassword,
  PASSWORD_HASH_ALGORITHM,
  TOKEN_TTL_SECONDS,
} from "./policy"

/** 哈希测试用的口令。它**不是**产品默认值——那个由 `defaultPassword(env)` 解析。 */
const PLAIN = "admin@123456"

describe("锁定的认证策略", () => {
  test("凭证有效期 2 小时", () => {
    expect(TOKEN_TTL_SECONDS).toBe(7200)
  })
})

describe("默认密码走配置", () => {
  test("配了 ⇒ 用配的那个", () => {
    expect(defaultPassword({ [DEFAULT_PASSWORD_ENV]: "Abcd1234!" })).toBe("Abcd1234!")
  })

  test("没配 ⇒ 抛，不静默退回 admin@123456", () => {
    // 兜底是这个函数最坏的结局：**生产忘了配 = 静默使用一个公开的示例口令**，
    // 而全系统没有一处会红——正是本 task 要治的病，只是从「源码里看得见」
    // 变成「源码里看得见、生产上还是它」。调用点在启动期，所以抛 = 起不来 = 看得见。
    // （照 `jwtSecret(env)` 先例：那个也没有默认值。）
    expect(() => defaultPassword({})).toThrow()
  })

  test("配了空串 / 纯空白 ⇒ 同样抛", () => {
    // 「看起来配了、实际等于没配」是最难排查的一种：部署日志里那一行**有值**，
    // 而效果与没配一样。同 `activityThrottleSeconds` 注释里那句
    // 「我明明配了 60」与「我配了个空格」在日志里长得一模一样。
    for (const 值 of ["", "   ", "\t"]) {
      expect(() => defaultPassword({ [DEFAULT_PASSWORD_ENV]: 值 })).toThrow()
    }
  })

  test("密码里的空格是内容，不 trim（只拒纯空白）", () => {
    expect(defaultPassword({ [DEFAULT_PASSWORD_ENV]: " my pass " })).toBe(" my pass ")
  })
})

describe("活跃节流窗口走配置", () => {
  test("没配 ⇒ 用默认值", () => {
    expect(activityThrottleSeconds({})).toBe(ACTIVITY_THROTTLE_SECONDS)
  })

  test("配了 ⇒ 用配的那个数，默认值不参与", () => {
    expect(activityThrottleSeconds({ [ACTIVITY_THROTTLE_SECONDS_ENV]: "5" })).toBe(5)
  })

  test("配了个不是正整数的值 ⇒ 当场抛，不静默退回默认", () => {
    // 静默退回是这个函数最坏的结局：`NaN` 会一路变成 `last_active_at <= NaN`，
    // 那个比较在 SQL 里恒为 NULL（不为真）⇒ **这一列就再也不更新了**，而全系统
    // 没有任何地方会红——僵尸账户识别只是慢慢变得不准（`LEARNINGS #002-02` 那类静默失效）。
    // 调用方（网关）在**层构造期**调它，所以这里抛 = 进程起不来 = 看得见的失败。
    for (const 值 of ["六十", "0", "-1", "1.5", ""]) {
      expect(() => activityThrottleSeconds({ [ACTIVITY_THROTTLE_SECONDS_ENV]: 值 })).toThrow()
    }
  })
})

describe("argon2id 方案满足安全要求", () => {
  test("哈希不含明文密码", async () => {
    const hash = await Bun.password.hash(PLAIN, { algorithm: PASSWORD_HASH_ALGORITHM })

    expect(hash).not.toContain(PLAIN)
    expect(hash.startsWith("$argon2id$")).toBe(true)
  })

  test("同一密码两次哈希不同（盐随机，避免一处泄露全体沦陷）", async () => {
    const first = await Bun.password.hash(PLAIN, { algorithm: PASSWORD_HASH_ALGORITHM })
    const second = await Bun.password.hash(PLAIN, { algorithm: PASSWORD_HASH_ALGORITHM })

    expect(first).not.toBe(second)
  })

  test("哈希可被校验函数验证", async () => {
    const hash = await Bun.password.hash(PLAIN, { algorithm: PASSWORD_HASH_ALGORITHM })

    expect(await Bun.password.verify(PLAIN, hash)).toBe(true)
    expect(await Bun.password.verify("wrong-password", hash)).toBe(false)
  })
})
