import { type SQL, eq } from "drizzle-orm"
import { verifyPassword } from "./password"
import { nowSeconds } from "./time"
import { type SessionCookie, type TokenSubject, sessionCookie, signToken } from "./token"
import { user } from "./user"

/**
 * 登录：校验密码 → 签发短期凭证（design-v2 §4.1，`2026-09-06-openhive-design-v2.md:150`）。
 *
 * 本模块把 T003（用户表）/ T004（密码）/ T005（凭证）接在一起，是 [INT] 的落点。
 */

export type UserRow = typeof user.$inferSelect
export type UserPatch = Partial<typeof user.$inferInsert>

/**
 * 读写 `auth.user` 行的最小面。
 *
 * 为什么不直接收 drizzle 实例：两种 PG 驱动的数据库类型**互不可赋值**
 * （PGlite 的 `execute` 解析成 `{ rows }`、bun-sql 解析成裸数组，根因见 state.md 裁定 ④）。
 * 收窄到用得到的方法，两种驱动都满足；`db.test.ts` 有类型标注钉住**生产驱动**也满足。
 */
export interface UserLoginTarget {
  select(): { from(table: typeof user): { where(clause: SQL): PromiseLike<UserRow[]> } }
  update(table: typeof user): { set(values: UserPatch): { where(clause: SQL): PromiseLike<unknown> } }
}

export interface LoginInput {
  policeNo: string
  password: string
}

export interface LoginResult {
  /** 原始凭证。网关把它塞进 Cookie，本模块已用 `cookie` 备好描述。 */
  token: string
  cookie: SessionCookie
  subject: TokenSubject
  /** 是否需强制改密，供前端决定弹不弹窗（T012）。刻意**不放进凭证载荷**——那是线格式契约，改动面更大。 */
  mustChangePw: boolean
}

/**
 * 登录失败的**唯一**错误类型。
 *
 * FR-005 要求「账号不存在」与「密码错误」提示一致——所以两种情况抛同一个类型、同一句消息，
 * 调用方无从区分，也就无从泄露。任何细分错误类型都会让这条要求**在类型层面**失守。
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("账号或密码错误")
    this.name = "InvalidCredentialsError"
  }
}

/**
 * 校验密码，把「hash 无法解析」也归为「不匹配」。
 *
 * 实测（T004 交接）：`Bun.password.verify` 对空 hash 返回 `false`，但对**垃圾 hash 抛**
 * `UnsupportedAlgorithm`。放任它抛出去，调用方会回 500——与 FR-005 的统一提示不一致，
 * 等于变相告诉对方「这个账号有异常」，反而制造了一个可枚举的信号。
 *
 * ⚠️ 代价说清楚：hash 损坏的账号会被**静默**当成密码错误，用户永远登不进来，运维也看不到线索。
 * 这是拿可观测性换 FR-005，属于当前 conscious tradeoff；要补的话应是在此处接日志，而不是把错抛出去。
 */
async function passwordMatches(plain: string, hash: string): Promise<boolean> {
  try {
    return await verifyPassword(plain, hash)
  } catch {
    return false
  }
}

/** 按警号查账号。查不到返回 undefined。 */
async function findByPoliceNo(db: UserLoginTarget, policeNo: string): Promise<UserRow | undefined> {
  const [record] = await db.select().from(user).where(eq(user.policeNo, policeNo))
  return record
}

/**
 * 校验凭证并签发短期登录凭证。
 *
 * 失败一律抛 `InvalidCredentialsError`，**不签发任何凭证、不刷新最后登录时间**。
 */
export async function login(db: UserLoginTarget, input: LoginInput, secret: string): Promise<LoginResult> {
  const record = await findByPoliceNo(db, input.policeNo)
  if (!record) throw new InvalidCredentialsError()

  if (!(await passwordMatches(input.password, record.passwordHash))) throw new InvalidCredentialsError()

  await db.update(user).set({ lastLoginAt: nowSeconds() }).where(eq(user.id, record.id))

  const subject: TokenSubject = {
    id: record.id,
    policeNo: record.policeNo,
    name: record.name,
    isAdmin: record.isAdmin === 1,
  }
  const token = await signToken(subject, secret)

  return {
    token,
    cookie: sessionCookie(token),
    subject,
    mustChangePw: record.mustChangePw === 1,
  }
}
