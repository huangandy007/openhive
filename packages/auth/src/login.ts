import { eq } from "drizzle-orm"
import { verifyPassword } from "./password"
import { nowSeconds } from "./time"
import { type SessionCookie, type TokenSubject, sessionCookie, signToken } from "./token"
import { type UserAccountTarget, type UserRow, user } from "./user"

/**
 * 登录：校验密码 → 签发短期凭证（design-v2 §4.1，`2026-09-06-openhive-design-v2.md:150`）。
 *
 * 本模块把 T003（用户表）/ T004（密码）/ T005（凭证）接在一起，是 [INT] 的落点。
 */

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
async function findByPoliceNo(db: UserAccountTarget, policeNo: string): Promise<UserRow | undefined> {
  const [record] = await db.select().from(user).where(eq(user.policeNo, policeNo))
  return record
}

/**
 * 校验凭证并签发短期登录凭证。
 *
 * 失败一律抛 `InvalidCredentialsError`，**不签发任何凭证、不刷新最后登录时间**。
 */
export async function login(db: UserAccountTarget, input: LoginInput, secret: string): Promise<LoginResult> {
  const record = await findByPoliceNo(db, input.policeNo)
  if (!record) throw new InvalidCredentialsError()

  if (!(await passwordMatches(input.password, record.passwordHash))) throw new InvalidCredentialsError()

  // 停用账号一律拒绝登录（FR-008 / design-v2 §4.3，`2026-09-06-openhive-design-v2.md:180`）。
  // 状态取值 1 启用 / 0 停用（同上 `:136`）——与本文件既有的 `isAdmin === 1` / `mustChangePw === 1` 同一读法。
  //
  // **这一句必须放在密码校验之后**（刻意，别往上挪）：置于校验之前的话，停用账号会**跳过 argon2**
  // 直接返回，耗时与「正常账号 + 错密码」明显不同，等于给外人一个探针去枚举「哪些警号被停用了」。
  // 放在之后，只有**已经出示正确密码**的人才会走到这里，对外观察不出任何差别。
  if (record.status !== 1) throw new InvalidCredentialsError()

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
