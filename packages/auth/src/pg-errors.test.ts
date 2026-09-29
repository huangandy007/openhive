import { describe, expect, test } from "bun:test"
import { pgErrorCode } from "./pg-errors"

describe("pgErrorCode", () => {
  test("从被包装错误的 cause 上取 SQLSTATE", () => {
    // drizzle 把驱动错误包成 DrizzleQueryError，PG 的 code 挂在 cause 上。
    expect(pgErrorCode({ cause: { code: "23505" } })).toBe("23505")
  })

  // 002 收尾补测（production-driver.test.ts）在真连接上抓到：生产驱动这一支的形状**不一样**——
  // Bun 的 PostgresError 把 SQLSTATE 放在 `errno`（数字），而 `code` 是它自己的
  // `"ERR_POSTGRES_SERVER_ERROR"`。只读 `code` 会让 `=== "23505"` 恒假，
  // 于是重复警号在生产里**静默不再翻译**，管理员看到内部报错而非「该警号已录入」。
  // 形状照抄探针实测（见 production-driver.test.ts 顶部说明），不是编的。
  test("认生产驱动 (bun-sql) 的形态：SQLSTATE 在 cause.errno 上（同为字符串）", () => {
    expect(
      pgErrorCode({ cause: { name: "PostgresError", code: "ERR_POSTGRES_SERVER_ERROR", errno: "23505" } }),
    ).toBe("23505")
  })

  test("cause.code 不是 SQLSTATE 且没有 errno 时仍返回 undefined，不把驱动的内部码当 SQLSTATE", () => {
    expect(pgErrorCode({ cause: { code: "ERR_POSTGRES_SERVER_ERROR" } })).toBeUndefined()
  })

  test("取不到时返回 undefined，不抛", () => {
    expect(pgErrorCode(new Error("boom"))).toBeUndefined()
    expect(pgErrorCode(undefined)).toBeUndefined()
    expect(pgErrorCode(null)).toBeUndefined()
    expect(pgErrorCode("字符串不是错误对象")).toBeUndefined()
    expect(pgErrorCode({ cause: { code: 23505 } })).toBeUndefined()
  })
})
