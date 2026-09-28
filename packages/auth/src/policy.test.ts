import { describe, expect, test } from "bun:test"
import { DEFAULT_PASSWORD, PASSWORD_HASH_ALGORITHM, TOKEN_TTL_SECONDS } from "./policy"

describe("锁定的认证策略", () => {
  test("默认密码与 design-v2 §4.1 一致", () => {
    expect(DEFAULT_PASSWORD).toBe("admin@123456")
  })

  test("凭证有效期 2 小时", () => {
    expect(TOKEN_TTL_SECONDS).toBe(7200)
  })
})

describe("argon2id 方案满足安全要求", () => {
  test("哈希不含明文密码", async () => {
    const hash = await Bun.password.hash(DEFAULT_PASSWORD, { algorithm: PASSWORD_HASH_ALGORITHM })

    expect(hash).not.toContain(DEFAULT_PASSWORD)
    expect(hash.startsWith("$argon2id$")).toBe(true)
  })

  test("同一密码两次哈希不同（盐随机，避免一处泄露全体沦陷）", async () => {
    const first = await Bun.password.hash(DEFAULT_PASSWORD, { algorithm: PASSWORD_HASH_ALGORITHM })
    const second = await Bun.password.hash(DEFAULT_PASSWORD, { algorithm: PASSWORD_HASH_ALGORITHM })

    expect(first).not.toBe(second)
  })

  test("哈希可被校验函数验证", async () => {
    const hash = await Bun.password.hash(DEFAULT_PASSWORD, { algorithm: PASSWORD_HASH_ALGORITHM })

    expect(await Bun.password.verify(DEFAULT_PASSWORD, hash)).toBe(true)
    expect(await Bun.password.verify("wrong-password", hash)).toBe(false)
  })
})
