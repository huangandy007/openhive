/**
 * 从 drizzle 包装过的错误里取出 PG 的 SQLSTATE 错误码。
 *
 * drizzle 把驱动抛的原始错误包成 `DrizzleQueryError`，PG 的 `code` 挂在它的 **`cause`** 上，
 * 所以要往里钻一层。用 `Reflect.get` 而不是 `as` 断言——错误对象的形状是运行时事实，
 * 断言只会把类型系统的警报掐掉（T003 实测）。
 *
 * 用到的码：
 * - `23505` unique_violation（警号重复）
 * - `42P01` undefined_table
 *
 * T003 时这段逻辑长在 `migrate.test.ts` 里；T008 起生产也要用，抽到此处，
 * 测试与生产共用同一份，避免两边各改各的。
 */
export function pgErrorCode(thrown: unknown): string | undefined {
  const cause = typeof thrown === "object" && thrown !== null ? Reflect.get(thrown, "cause") : undefined
  if (typeof cause !== "object" || cause === null) return undefined

  const code: unknown = Reflect.get(cause, "code")
  return typeof code === "string" ? code : undefined
}
