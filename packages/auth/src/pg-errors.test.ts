import { describe, expect, test } from "bun:test"
import { pgErrorCode } from "./pg-errors"

describe("pgErrorCode", () => {
  test("从被包装错误的 cause 上取 SQLSTATE", () => {
    // drizzle 把驱动错误包成 DrizzleQueryError，PG 的 code 挂在 cause 上。
    expect(pgErrorCode({ cause: { code: "23505" } })).toBe("23505")
  })

  test("取不到时返回 undefined，不抛", () => {
    expect(pgErrorCode(new Error("boom"))).toBeUndefined()
    expect(pgErrorCode(undefined)).toBeUndefined()
    expect(pgErrorCode(null)).toBeUndefined()
    expect(pgErrorCode("字符串不是错误对象")).toBeUndefined()
    expect(pgErrorCode({ cause: { code: 23505 } })).toBeUndefined()
  })
})
