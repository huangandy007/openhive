import { beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { login } from "./login"
import { migrate } from "./migrate"
import {
  EmptyNewPasswordError,
  InvalidCurrentPasswordError,
  changePassword,
  hashPassword,
  verifyPassword,
} from "./password"
import { DEFAULT_PASSWORD } from "./policy"
import { registerUser } from "./register"

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

describe("改密（FR-006）", () => {
  let db: Db
  let userId: string

  beforeEach(async () => {
    db = await freshDb()
    const created = await registerUser(db, ACCOUNT)
    userId = created.id
  })

  test("改密成功后 must_change_pw 解除——下次登录不再要求改密", async () => {
    await changePassword(db, { userId, currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD })

    const next = await login(db, { policeNo: ACCOUNT.policeNo, password: NEW_PASSWORD }, SECRET)
    expect(next.mustChangePw).toBe(false)
  })

  test("改密后新密码生效、旧密码失效", async () => {
    await changePassword(db, { userId, currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD })

    const hash = await storedHashOf(db, userId)
    expect(await verifyPassword(NEW_PASSWORD, hash)).toBe(true)
    expect(await verifyPassword(DEFAULT_PASSWORD, hash)).toBe(false)
  })

  test("当前密码不对时拒绝，且账号状态原封不动", async () => {
    const before = await storedHashOf(db, userId)

    const thrown = await failureOf(
      changePassword(db, { userId, currentPassword: "not-the-current-one", newPassword: NEW_PASSWORD }),
    )

    expect(thrown).toBeInstanceOf(InvalidCurrentPasswordError)
    expect(await storedHashOf(db, userId)).toBe(before)

    // 「状态没动」也要用**行为**验一遍：原密码照样能登，且照样要求改密。
    // 只查列的话，一个「顺手把 must_change_pw 清了、但哈希没换」的半成品实现能蒙混过关。
    const after = await login(db, { policeNo: ACCOUNT.policeNo, password: DEFAULT_PASSWORD }, SECRET)
    expect(after.mustChangePw).toBe(true)
  })

  test("新密码为空时拒绝——空密码等于这个账号谁都能进", async () => {
    const before = await storedHashOf(db, userId)

    const thrown = await failureOf(
      changePassword(db, { userId, currentPassword: DEFAULT_PASSWORD, newPassword: "" }),
    )

    expect(thrown).toBeInstanceOf(EmptyNewPasswordError)
    expect(await storedHashOf(db, userId)).toBe(before)
    const after = await login(db, { policeNo: ACCOUNT.policeNo, password: DEFAULT_PASSWORD }, SECRET)
    expect(after.mustChangePw).toBe(true)
  })
})
