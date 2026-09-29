/**
 * 从 drizzle 包装过的错误里取出 PG 的 SQLSTATE 错误码。
 *
 * drizzle 把驱动抛的原始错误包成 `DrizzleQueryError`，SQLSTATE 挂在它的 **`cause`** 上，
 * 所以要往里钻一层。用 `Reflect.get` 而不是 `as` 断言——错误对象的形状是运行时事实，
 * 断言只会把类型系统的警报掐掉（T003 实测）。
 *
 * ⚠️ **两个驱动的 cause 形状不同**，这是 002 收尾补测在真连接上实测出来的
 * （`production-driver.test.ts` 顶部有取证，`typeof` 逐项验过）：
 * - `drizzle-orm/pglite` → `cause.code = "23505"`
 * - `drizzle-orm/bun-sql`（生产）→ `cause.code = "ERR_POSTGRES_SERVER_ERROR"`（**驱动自己的内部码**）、
 *   `cause.errno = "23505"`（它自己的字段名，同为字符串）
 *
 * 所以**不能只认 `code`**：生产那支会让 `=== "23505"` 恒假，重复警号就静默不再翻成
 * `DuplicatePoliceNoError`——管理员看到内部报错而不是「该警号已录入」。先按 SQLSTATE 的形状
 * 认 `code`，认不出再退到 `errno`；两条都不像时返回 `undefined`，绝不把驱动的内部码当 SQLSTATE。
 *
 * 用到的码：
 * - `23505` unique_violation（警号重复）
 * - `42P01` undefined_table
 *
 * T003 时这段逻辑长在 `migrate.test.ts` 里；T008 起生产也要用，抽到此处，
 * 测试与生产共用同一份，避免两边各改各的。
 */

/** SQLSTATE 是固定 5 位、数字 + 大写字母（如 `23505` / `42P01`）。 */
const SQLSTATE = /^[0-9A-Z]{5}$/

export function pgErrorCode(thrown: unknown): string | undefined {
  const cause = typeof thrown === "object" && thrown !== null ? Reflect.get(thrown, "cause") : undefined
  if (typeof cause !== "object" || cause === null) return undefined

  const code: unknown = Reflect.get(cause, "code")
  if (typeof code === "string" && SQLSTATE.test(code)) return code

  const errno: unknown = Reflect.get(cause, "errno")
  return typeof errno === "string" && SQLSTATE.test(errno) ? errno : undefined
}

/**
 * 写账号库失败（非「警号重复」）。**刻意不携带原始错误对象**。
 *
 * 为什么不带：drizzle 包出来的是 `DrizzleQueryError`，而它的 `message` 就是
 * `` `Failed query: ${query}\nparams: ${params}` ``——**查询参数被内联进了消息**。
 * 本项目里带敏感数据的写语句不止一处：录入的 insert 参数含 `password_hash` / `id_card` /
 * `phone`，改密与重置的 update 参数含 `password_hash`。所以「把原始错误挂到 `cause` 上」
 * 或「原样抛出」都会把这些一并交给调用方——而调用方（F3 的网关）拿到错误后多半会记日志，
 * 于是脱敏在**呈现层**做已经来不及：日志里已经有一份了。
 *
 * 保留 SQLSTATE 就够了——那才是排查真正要用的那一半，且不含任何数据。
 * 想追原始堆栈时请**在抛出点**读，不要让它跟着错误对象走。
 */
export class AccountWriteError extends Error {
  /** PG 的 SQLSTATE（取不到则为 `undefined`）。 */
  readonly sqlState: string | undefined

  constructor(sqlState: string | undefined) {
    super(sqlState ? `账号写入失败（SQLSTATE ${sqlState}）` : "账号写入失败")
    this.name = "AccountWriteError"
    this.sqlState = sqlState
  }
}
