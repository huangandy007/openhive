import { eq } from "drizzle-orm"
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
 */
export async function changePassword(db: UserAccountTarget, input: PasswordChangeInput): Promise<void> {
  if (input.newPassword.length === 0) throw new EmptyNewPasswordError()

  const [record] = await db.select().from(user).where(eq(user.id, input.userId))
  if (!record) throw new Error(`账号不存在：${input.userId}`)

  if (!(await verifyPassword(input.currentPassword, record.passwordHash))) throw new InvalidCurrentPasswordError()

  await db
    .update(user)
    .set({ passwordHash: await hashPassword(input.newPassword), mustChangePw: 0 })
    .where(eq(user.id, input.userId))
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

  await db
    .update(user)
    .set({ passwordHash: await hashPassword(DEFAULT_PASSWORD), mustChangePw: 1 })
    .where(eq(user.id, userId))
}
