import { beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { login } from "./login"
import { migrate } from "./migrate"
import {
  EmptyNewPasswordError,
  InvalidCurrentPasswordError,
  WeakNewPasswordError,
  changePassword,
  hashPassword,
  resetPassword,
  verifyPassword,
} from "./password"
import { AccountWriteError } from "./pg-errors"
import { registerUser } from "./register"
import { DEPLOYED_DEFAULT_PASSWORD, PUBLIC_EXAMPLE_PASSWORD } from "./test-support"

/** 哈希原语那组用例的素材，取值无所谓——它们测的是 argon2id 本身，不涉及任何策略值。 */
const PLAIN = "admin@123456"

// 两个值的含义、以及「为什么必须不同」写在 `test-support.ts` 那两条常量上——一处定义，
// 免得 7 个测试文件各写一份、各自漂走。这里的短名字只为本文件的可读性。
const PW = DEPLOYED_DEFAULT_PASSWORD
const EXAMPLE = PUBLIC_EXAMPLE_PASSWORD

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

const SECRET = "test-secret"
const NEW_PASSWORD = "XunLuo@2026"

const ACCOUNT = {
  policeNo: "000123",
  name: "张三",
  idCard: "110101199001010011",
  phone: "13800000000",
  org: "市公安局",
  dept: "刑侦支队",
  section: "一大队",
  status: 1,
}

async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)
  return db
}

type Db = Awaited<ReturnType<typeof freshDb>>

/**
 * 账号当前落库的 `password_hash`——用来断言「失败时哈希一个字节都没动」。
 *
 * 只回哈希不回 `must_change_pw`：驱动交回来的列值是 `unknown`，取它就是一次不安全的断言；
 * 而「改密状态有没有被动过」用登录结果断言更好（见下面两条失败用例）——它断言的是**行为**，不是列。
 */
async function storedHashOf(db: Db, id: string): Promise<string> {
  const result = await db.execute(sql`select password_hash as hash from auth.user where id = ${id}`)
  const [row] = result.rows
  if (!row) throw new Error(`账号不存在：${id}`)
  return String(row.hash)
}

/** 跑一次应当失败的操作，把抛出的错交回来；没抛则得到 undefined。 */
async function failureOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action
    return undefined
  } catch (cause) {
    return cause
  }
}

/** 同上，但要求抛的是 Error 并交回来——省掉调用点的 `as Error` 断言（同 login.test.ts）。 */
async function errorOf(action: Promise<unknown>): Promise<Error> {
  const thrown = await failureOf(action)
  if (!(thrown instanceof Error)) throw new Error(`期望抛出 Error，实际拿到：${String(thrown)}`)
  return thrown
}

/**
 * 收集一个错误**可达**的全部文本（自有属性递归 + `message` / `stack`）。
 *
 * 不能只 `JSON.stringify(error)`：`Error` 的 `message` / `stack` 不可枚举，
 * 那样得到的是 `"{}"`——一条什么都测不到的假绿断言（同 register.test.ts 的用法）。
 */
function textReachableFrom(value: unknown, seen = new Set<unknown>()): string {
  // 原语逐个点名，而不是 `String(value)` 兜底：后者在函数 / symbol 上会走「对象的默认字符串化」，
  // 拿回 `[object Object]` 之类的噪声——真漏了哈希也会被这段噪声糊过去（oxlint no-base-to-string）。
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  // 剩下的是 null / undefined / 函数 / symbol：取不到有意义的文本。
  if (typeof value !== "object" || value === null) return ""
  if (seen.has(value)) return ""
  seen.add(value)

  const parts: string[] = []
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && "value" in descriptor) parts.push(textReachableFrom(descriptor.value, seen))
  }
  return parts.join("\n")
}

/**
 * 同 `errorOf`，但要求抛的正是 `type`，交回**窄化后**的实例。
 *
 * 为什么要它：`errorOf` 交回 `Error`，想读子类字段就得 `thrown as AccountWriteError`——
 * 那是一次 `no-unsafe-type-assertion`（断言把类型系统的警报掐掉，而错误对象的形状是运行时事实）。
 * 在测试里还好，但本项目的门禁判据是「**本次改动文件 0 命中**」，于是断言必须先过 lint 这一关。
 * `instanceof` 是运行时真检查，说错了会当场报出来，比断言诚实。
 */
async function errorOfType<T extends Error>(
  action: Promise<unknown>,
  type: new (...args: never[]) => T,
): Promise<T> {
  const thrown = await errorOf(action)
  if (!(thrown instanceof type)) throw new Error(`期望 ${type.name}，实际拿到 ${thrown.name}：${thrown.message}`)
  return thrown
}

describe("改密（FR-006）", () => {
  let db: Db
  let userId: string

  beforeEach(async () => {
    db = await freshDb()
    const created = await registerUser(db, ACCOUNT, PW)
    userId = created.id
  })

  test("改密成功后 must_change_pw 解除——下次登录不再要求改密", async () => {
    await changePassword(db, { userId, currentPassword: PW, newPassword: NEW_PASSWORD }, PW)

    const next = await login(db, { policeNo: ACCOUNT.policeNo, password: NEW_PASSWORD }, SECRET)
    expect(next.mustChangePw).toBe(false)
  })

  test("改密后新密码生效、旧密码失效", async () => {
    await changePassword(db, { userId, currentPassword: PW, newPassword: NEW_PASSWORD }, PW)

    const hash = await storedHashOf(db, userId)
    expect(await verifyPassword(NEW_PASSWORD, hash)).toBe(true)
    expect(await verifyPassword(PW, hash)).toBe(false)
  })

  test("当前密码不对时拒绝，且账号状态原封不动", async () => {
    const before = await storedHashOf(db, userId)

    const thrown = await failureOf(
      changePassword(db, { userId, currentPassword: "not-the-current-one", newPassword: NEW_PASSWORD }, PW),
    )

    expect(thrown).toBeInstanceOf(InvalidCurrentPasswordError)
    expect(await storedHashOf(db, userId)).toBe(before)

    // 「状态没动」也要用**行为**验一遍：原密码照样能登，且照样要求改密。
    // 只查列的话，一个「顺手把 must_change_pw 清了、但哈希没换」的半成品实现能蒙混过关。
    const after = await login(db, { policeNo: ACCOUNT.policeNo, password: PW }, SECRET)
    expect(after.mustChangePw).toBe(true)
  })

  test("新密码为空时拒绝——空密码等于这个账号谁都能进", async () => {
    const before = await storedHashOf(db, userId)

    const thrown = await failureOf(
      changePassword(db, { userId, currentPassword: PW, newPassword: "" }, PW),
    )

    expect(thrown).toBeInstanceOf(EmptyNewPasswordError)
    expect(await storedHashOf(db, userId)).toBe(before)
    const after = await login(db, { policeNo: ACCOUNT.policeNo, password: PW }, SECRET)
    expect(after.mustChangePw).toBe(true)
  })

  // 与上一条是**同一个洞的两种填法**：空串挡住的只是「什么都没有」，挡不住「填一个已知口令」。
  // 默认密码是**全系统派发的**那个值，把它填回来等于账号停在「谁都知道」的状态，而 must_change_pw
  // 已被清成 0——与「正常改过密」完全同形，测试、运维视图都看不出区别。
  //
  // ⚠️ 判据是「等于**配置里那个**默认密码」，不是「等于文档里那个示例值」。差别在今天看不出来
  // （默认部署配的就是示例值），T020 之后就不是同一件事了：派发侧读配置，这一侧也必须读配置。
  // **判据只有一份**，与 T018 的 `assertSafeUserId`、T010 的限流判定同一条纪律。
  test("新密码 = 配置里那个默认密码时拒绝——它不是「改过密」，只是把派发口令又填了一遍", async () => {
    // 先真改过一次，让 **currentPassword ≠ PW**——这一步是这条用例有没有牙的关键。
    // 直接传 `currentPassword: PW, newPassword: PW` 的话，「新密码 = 当前密码」那条规则
    // 会抛出**同一个** `WeakNewPasswordError`，断言就成了「抛了就算过」。
    // 实测（2026-10-01）：把判据换回写死的 `"admin@123456"`，原写法的这条**照样绿**——
    // 它其实没在测「默认密码」那条规则（`LEARNINGS #002-02`）。
    await changePassword(db, { userId, currentPassword: PW, newPassword: NEW_PASSWORD }, PW)
    const before = await storedHashOf(db, userId)

    const thrown = await failureOf(
      changePassword(db, { userId, currentPassword: NEW_PASSWORD, newPassword: PW }, PW),
    )

    expect(thrown).toBeInstanceOf(WeakNewPasswordError)
    // 一个字节都没动：新密码仍是 NEW_PASSWORD，`must_change_pw` 也没被这次失败重新竖起。
    expect(await storedHashOf(db, userId)).toBe(before)
    const after = await login(db, { policeNo: ACCOUNT.policeNo, password: NEW_PASSWORD }, SECRET)
    expect(after.mustChangePw).toBe(false)
  })

  // ⚠️ **本条才是「判据读了配置」的判别式**：上一句只证明「等于 PW 的被拒」，一个仍拿
  // 写死的 `"admin@123456"` 去比的实现**照样满足它**（只要 PW 恰好就是那个常量）。
  //
  // 这里把新密码设成**文档示例值**——本次部署没拿它当默认密码，所以它就是一个普通的弱口令，
  // 不归这条规则管（强度是另一条待裁定的事，规则尚未定，`changePassword` 上方注释说明过）。
  //
  // 说清代价，别假装没有：这么一来，一个把新密码设成 `admin@123456` 的用户在**默认部署**
  // 之外是被放行的。但那条路径的本职是「不许停在**派发的**口令上」——派发值已经跟着配置走了，
  // 示例值不再派发给任何人；再拦它就等于把示例值重新写死回产品码，正是本 task 要拆的东西。
  //
  // 变异检验：把 `changePassword` 的 `defaultPassword` 换回字面量 `"admin@123456"`，本条必红。
  test("新密码 = 文档示例值（本次部署没用它）⇒ 放行——钉住判据跟着配置走，没在比常量", async () => {
    await changePassword(db, { userId, currentPassword: PW, newPassword: EXAMPLE }, PW)

    const hash = await storedHashOf(db, userId)
    expect(await verifyPassword(EXAMPLE, hash)).toBe(true)
    // 反向对照：放行的是示例值，不是「什么都放行」——配发的那个值仍然被拦。
    expect(await failureOf(
      changePassword(db, { userId, currentPassword: EXAMPLE, newPassword: PW }, PW),
    )).toBeInstanceOf(WeakNewPasswordError)
  })

  test("新密码全是空白时拒绝——`length === 0` 挡不住 \"   \"", async () => {
    const before = await storedHashOf(db, userId)

    const thrown = await failureOf(
      changePassword(db, { userId, currentPassword: PW, newPassword: "   " }, PW),
    )

    expect(thrown).toBeInstanceOf(EmptyNewPasswordError)
    expect(await storedHashOf(db, userId)).toBe(before)
  })

  // 覆盖的是「改密」这个动作本身应当**改变**什么。与上一条不同：这里当前密码不是默认密码
  // （先真改过一次），所以规则 2 拦不住它——但它同样会无条件清掉 must_change_pw。
  test("新密码与当前密码相同时拒绝——那不是改密，却会清掉强制改密标记", async () => {
    await changePassword(db, { userId, currentPassword: PW, newPassword: NEW_PASSWORD }, PW)
    const before = await storedHashOf(db, userId)

    const thrown = await failureOf(
      changePassword(db, { userId, currentPassword: NEW_PASSWORD, newPassword: NEW_PASSWORD }, PW),
    )

    expect(thrown).toBeInstanceOf(WeakNewPasswordError)
    expect(await storedHashOf(db, userId)).toBe(before)
  })

  // 上面那条**守不住顺序**：它传的 currentPassword 是对的，所以「相同」这个判断
  // 放在验密之前还是之后，它都绿。真正钉住顺序的是这一条——当前密码**错**、
  // 且与 newPassword 相同：只有「先验密」的实现才报 InvalidCurrentPassword。
  //
  // 反过来（先比相同）这条会拿到 WeakNewPasswordError，于是攻击者能用候选密码当
  // newPassword 传进来：猜中得 Weak、猜错得 InvalidCurrent，**一次一比特**。
  //
  // ⚠️ 前提要说准，别说过头：`userId` 取自**已验签的凭证**（`PasswordChangeInput` 的注释
  // 「调用方从已验签的凭证里取，不从前端传」），所以这**不是**「无需登录即可试出密码」——
  // 攻击者得先持有该账号的会话。真正的损失是**绕过登录接口的限频与审计**：本该在登录处
  // 被计数、被告警的密码枚举，改从这条路径走，一次告警都不产生。
  test("当前密码错误时，即便新密码与它相同也报「当前密码不正确」——顺序是这条的性质", async () => {
    const thrown = await errorOf(
      changePassword(db, { userId, currentPassword: "guessed-wrong", newPassword: "guessed-wrong" }, PW),
    )

    expect(thrown).toBeInstanceOf(InvalidCurrentPasswordError)
    expect(thrown).not.toBeInstanceOf(WeakNewPasswordError)
  })
})

// 正向对照。没有它，上面那几条 `not.toContain(...)` **全部可能空转**——
// 一个恒返回 `""` 的 walker 能让任何「不含哈希」的断言通过（同 register.test.ts）。
describe("脱敏断言的工具本身可信（正向对照）", () => {
  // `delete probe.stack` 不是洁癖：`Error` 的 `stack` 首行**就是** `message` 的文本，
  // 不删掉它，这条断言在 walker 跳过 `message` 键时也照样绿（同 register.test.ts）。
  test("挂在 message 上的文本能被收集到——message 不可枚举，正是本函数要够到的东西", () => {
    const probe = new Error("marker-in-message")
    delete probe.stack

    expect(textReachableFrom(probe)).toContain("marker-in-message")
  })

  test("挂在嵌套 cause 上的文本也能被收集到", () => {
    const probe = new Error("外层", { cause: { deep: "marker-in-cause" } })
    delete probe.stack

    expect(textReachableFrom(probe)).toContain("marker-in-cause")
  })
})

/**
 * 改密/重置的 UPDATE 参数里也有 `password_hash`，和录入的 insert 是同一类问题
 * （LEARNINGS #002-01：踩到一个「随某维度而变」的东西就把它当**类**问题清一遍）。
 *
 * 构造手法：加一条 CHECK，让 `select` 能过、`update` 必失败——否则测不到写库那条路径。
 */
describe("写库失败时不把密码哈希带出去", () => {
  let db: Db
  let userId: string

  beforeEach(async () => {
    db = await freshDb()
    userId = (await registerUser(db, ACCOUNT, PW)).id
  })

  test("改密失败：错误可达图里没有哈希，且换成了不带参数的 AccountWriteError", async () => {
    await db.execute(sql`alter table auth.user add constraint keep_changing check (must_change_pw = 1)`)

    const thrown = await errorOfType(
      changePassword(db, { userId, currentPassword: PW, newPassword: NEW_PASSWORD }, PW),
      AccountWriteError,
    )

    expect(textReachableFrom(thrown)).not.toContain("$argon2")
    // SQLSTATE 留下，排查线索不丢。
    expect(thrown.sqlState).toBe("23514")
  })

  test("重置失败：同上", async () => {
    // 先把标记落成 0，**否则 CHECK 加不上**：约束要求「当前」这一行就满足，
    // 而录入出来的账号 `must_change_pw` 是 1（重置要把它抬回 1，只能从 0 起才制造得出冲突）。
    await db.execute(sql`update auth.user set must_change_pw = 0`)
    await db.execute(sql`alter table auth.user add constraint stay_changed check (must_change_pw = 0)`)

    const thrown = await errorOf(resetPassword(db, userId, PW))

    expect(thrown).toBeInstanceOf(AccountWriteError)
    expect(textReachableFrom(thrown)).not.toContain("$argon2")
  })
})

describe("重置（FR-007）", () => {
  let db: Db
  let userId: string

  beforeEach(async () => {
    db = await freshDb()
    const created = await registerUser(db, ACCOUNT, PW)
    userId = created.id
  })

  test("重置回默认密码，且强制改密重新竖起——即使用户此前已改过密", async () => {
    await changePassword(db, { userId, currentPassword: PW, newPassword: NEW_PASSWORD }, PW)
    const before = await login(db, { policeNo: ACCOUNT.policeNo, password: NEW_PASSWORD }, SECRET)
    // 前提：用户自己改过密，标记已解除。没有这一步，测试就分不清「重置竖起了标记」
    // 和「标记本来就一直竖着」——后者是个漏了实现的假通过。
    expect(before.mustChangePw).toBe(false)

    await resetPassword(db, userId, PW)

    const after = await login(db, { policeNo: ACCOUNT.policeNo, password: PW }, SECRET)
    expect(after.mustChangePw).toBe(true)
    expect(after.subject.id).toBe(userId)
  })

  test("重置回**配置里那个**默认密码——用户自己设的失效，文档示例值也不是重置目标", async () => {
    await changePassword(db, { userId, currentPassword: PW, newPassword: NEW_PASSWORD }, PW)

    await resetPassword(db, userId, PW)

    const hash = await storedHashOf(db, userId)
    expect(await verifyPassword(NEW_PASSWORD, hash)).toBe(false)
    expect(await verifyPassword(PW, hash)).toBe(true)
    // ⚠️ **这条才是「重置读了配置」的判别式**：上面两句只证明「重置成了 PW」，一个仍写死
    // `"admin@123456"` 的实现只要测试恰好拿它当 PW 就照样绿。把「示例值验不通」也钉住，
    // 「读了配置」与「还用着旧常量」才分得开（`LEARNINGS #002-02`）。
    // 变异检验：把 `resetPassword` 的 `defaultPassword` 换回字面量，本条必红。
    expect(await verifyPassword(EXAMPLE, hash)).toBe(false)
  })

  test("重置后落库的是新哈希，不是把原哈希原样留下", async () => {
    const before = await storedHashOf(db, userId)

    await resetPassword(db, userId, PW)

    expect(await storedHashOf(db, userId)).not.toBe(before)
  })

  // 刻意不静默成功：管理员在后台点「重置」却没重置到任何人，他会转告民警「用默认密码登录」，
  // 而民警登不进来、两边都不知道为什么。宁可当场报错。
  test("重置不存在的账号 → 报错，不静默成功", async () => {
    const thrown = await errorOf(resetPassword(db, "not-a-real-id", PW))

    expect(thrown.message).toContain("账号不存在")
  })
})
