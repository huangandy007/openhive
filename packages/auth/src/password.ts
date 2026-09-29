import { eq } from "drizzle-orm"
import { AccountWriteError, pgErrorCode } from "./pg-errors"
import { DEFAULT_PASSWORD, PASSWORD_HASH_ALGORITHM } from "./policy"
import { type UserAccountTarget, user } from "./user"

/**
 * 密码哈希与校验。算法由 `policy.ts` 锁定为 argon2id，用 Bun 内建实现（零外部依赖）。
 *
 * 这里是**唯一**接触密码哈希的地方：录入（T006）、改密（T013）、重置（T017）都走这两个函数，
 * 免得哪天算法要换时满仓库找 `Bun.password`。
 *
 * 本模块同时承载「改密」这条**状态流转**（plan.md 文件结构把 改密/重置 归在 `password.ts`）——
 * 哈希原语与用它们的流程放在一起，改动密码策略时只有一个文件要看。
 */

/** 把明文密码哈希成可入库的串（含算法、参数、随机盐，故同一密码每次结果不同）。 */
export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: PASSWORD_HASH_ALGORITHM })
}

/** 校验明文密码与库里存的哈希是否匹配。 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash)
}

/** 当前密码不对。与登录失败不同，这里**允许**说清楚——用户已经通过鉴权，不构成枚举信号。 */
export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("当前密码不正确")
    this.name = "InvalidCurrentPasswordError"
  }
}

/** 新密码为空。 */
export class EmptyNewPasswordError extends Error {
  constructor() {
    super("新密码不能为空")
    this.name = "EmptyNewPasswordError"
  }
}

/** 新密码满足「非空」，但仍不能要——它等于默认密码或当前密码。 */
export class WeakNewPasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WeakNewPasswordError"
  }
}

export interface PasswordChangeInput {
  /** 改谁的密码。调用方从**已验签的凭证**里取，不从前端传。 */
  userId: string
  currentPassword: string
  newPassword: string
}

/**
 * 用户自助改密：校验当前密码 → 换新哈希 → 解除 `must_change_pw`（FR-006「改密成功后解除该状态」）。
 *
 * 为什么**必须校验当前密码**：design-v2 §8.3（`2026-09-06-openhive-design-v2.md:321`）把弹窗画成
 * 「当前密码 + 新密码（强度条）+ 确认」——服务端不验的话，那个输入框就是个摆设，而**光有会话凭证
 * 就能改掉密码**意味着凭证一旦被劫持，攻击者可以把真正的用户锁在门外。验一下，这个框才有意义。
 *
 * 为什么**拒绝空密码**（不是「策略」，是地板）：空密码的账号，任何人输空串都能登进去——
 * 这是本功能自己就能制造出来的坏状态，一行挡住。**注意：真正的密码强度策略没有实现**——
 * design-v2 只画了「强度条」，没写规则，故不擅自定一套（见 state.md 待裁定）。
 *
 * **本节全部是「地板」，不是「强度策略」**：下面三条都只拦「填了等于没填」的输入，不需要先定
 * 长度/字符类规则，所以不受上面那条待裁定事项的阻塞。尤其是「新密码 = 默认密码」——
 * 默认密码是写在文档里的公开值，放行它等于账号停在人尽皆知的口令上，而 `must_change_pw`
 * 已被清成 0：此后它与「正常改过密」完全同形，任何测试和运维视图都看不出区别（FR-006 的全部
 * 价值就建立在「默认密码公开、不改等于人人可冒用」之上）。
 */
export async function changePassword(db: UserAccountTarget, input: PasswordChangeInput): Promise<void> {
  // 空白串要按「空」处理：`length === 0` 挡不住 "   "，而 "   " 正是可登录的密码。
  if (input.newPassword.trim().length === 0) throw new EmptyNewPasswordError()
  if (input.newPassword === DEFAULT_PASSWORD) throw new WeakNewPasswordError("新密码不能是系统默认密码")

  const [record] = await db.select().from(user).where(eq(user.id, input.userId))
  if (!record) throw new Error(`账号不存在：${input.userId}`)

  if (!(await verifyPassword(input.currentPassword, record.passwordHash))) throw new InvalidCurrentPasswordError()

  // ⚠️ 这条**必须**排在验密之后。放在前面会变成「猜当前密码」的预言机：
  // 攻击者拿候选密码当 newPassword 传进来，猜中得 Weak、猜错得 InvalidCurrent，一次一比特。
  if (input.newPassword === input.currentPassword) throw new WeakNewPasswordError("新密码不能与当前密码相同")

  // 哈希在 try **之外**算：否则 `Bun.password.hash` 自己抛的错也会被包成「写库失败」。
  const passwordHash = await hashPassword(input.newPassword)

  try {
    await db.update(user).set({ passwordHash, mustChangePw: 0 }).where(eq(user.id, input.userId))
  } catch (cause) {
    // 这条 update 的参数里带 `password_hash`，原始 drizzle 错误会把参数内联进 message——
    // 不能让它跟着错误对象走（见 `AccountWriteError`）。
    throw new AccountWriteError(pgErrorCode(cause))
  }
}

/**
 * 管理员重置密码回默认值，并重新竖起强制改密（FR-007，design-v2 §4.1 `:148`）。
 *
 * 与 `changePassword` 的三处**刻意不同**：
 *
 * 1. **不校验当前密码**。管理员不知道也不该知道民警的密码——「不知道旧密码也能换掉」正是重置的用途。
 *    真正的门禁在调用方：这条只能由管理员后台（已鉴权 + 已判 is_admin）触发。**本函数自己不做鉴权**，
 *    它是一条能力，谁能拿到由网关决定。
 * 2. **不收新密码参数**，固定回 `DEFAULT_PASSWORD`。让管理员自选新密码是另一个产品行为
 *    （等于让他知道民警的密码），design-v2 没写，不擅自加。
 * 3. **`must_change_pw` 置 1**。默认密码是写在文档里的公开值（`policy.ts`），重置完不强制改密
 *    等于把账号留在一个谁都能进的状态——那正好是 FR-006 要防的事。
 *
 * 账号不存在时**报错而不静默成功**：静默的话，管理员会转告民警「用默认密码登录」，
 * 而民警登不进来、两边都不知道为什么。`changePassword` 出于需要读行顺带也有这条，
 * 这里显式读一次是为了对齐——多一次 SELECT 换一个看得见的失败。
 */
export async function resetPassword(db: UserAccountTarget, userId: string): Promise<void> {
  const [record] = await db.select().from(user).where(eq(user.id, userId))
  if (!record) throw new Error(`账号不存在：${userId}`)

  const passwordHash = await hashPassword(DEFAULT_PASSWORD)

  try {
    await db.update(user).set({ passwordHash, mustChangePw: 1 }).where(eq(user.id, userId))
  } catch (cause) {
    throw new AccountWriteError(pgErrorCode(cause))
  }
}
