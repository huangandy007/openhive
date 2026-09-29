import { describe, expect, test } from "bun:test"
import { hashPassword, verifyPassword } from "./password"

const PLAIN = "admin@123456"

describe("密码哈希与校验", () => {
  test("哈希后可用原密码校验通过", async () => {
    expect(await verifyPassword(PLAIN, await hashPassword(PLAIN))).toBe(true)
  })

  test("错误密码校验不通过", async () => {
    expect(await verifyPassword("admin@123457", await hashPassword(PLAIN))).toBe(false)
  })

  test("同一密码两次哈希不同（盐随机，避免一处泄露全体沦陷）", async () => {
    expect(await hashPassword(PLAIN)).not.toBe(await hashPassword(PLAIN))
  })

  test("哈希里不含明文密码", async () => {
    expect(await hashPassword(PLAIN)).not.toContain(PLAIN)
  })

  test("算法锁定为 argon2id", async () => {
    expect((await hashPassword(PLAIN)).startsWith("$argon2id$")).toBe(true)
  })
})
