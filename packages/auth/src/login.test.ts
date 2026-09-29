import { beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { InvalidCredentialsError, login } from "./login"
import { migrate } from "./migrate"
import { DEFAULT_PASSWORD } from "./policy"
import { registerUser } from "./register"
import { verifyToken } from "./token"

const SECRET = "test-secret"

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

let db: Db
let userId: string

beforeEach(async () => {
  db = await freshDb()
  const created = await registerUser(db, ACCOUNT)
  userId = created.id
})

/** 跑一次应当失败的登录，把抛出的错交回来；没抛则得到 undefined。 */
async function failureOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action
    return undefined
  } catch (cause) {
    return cause
  }
}

/** 跑一次应当失败的登录，要求它抛的是 Error 并交回来——省掉调用点的 as 断言。 */
async function errorOf(action: Promise<unknown>): Promise<Error> {
  const thrown = await failureOf(action)
  if (!(thrown instanceof Error)) throw new Error(`期望抛出 Error，实际拿到：${String(thrown)}`)
  return thrown
}

/** 把某个账号的密码哈希换成畸形值——模拟库里出现无法解析的 hash。 */
async function corruptHashOf(policeNo: string, hash: string): Promise<void> {
  await db.execute(sql`update auth.user set password_hash = ${hash} where police_no = ${policeNo}`)
}

const credentials = (password: string) => ({ policeNo: ACCOUNT.policeNo, password })

describe("登录成功", () => {
  test("正确警号 + 正确密码，拿到可校验、且解析出本人 userId 的凭证", async () => {
    const result = await login(db, credentials(DEFAULT_PASSWORD), SECRET)

    expect((await verifyToken(result.token, SECRET)).id).toBe(userId)
  })

  test("凭证通过 httpOnly Cookie 下发", async () => {
    const { cookie } = await login(db, credentials(DEFAULT_PASSWORD), SECRET)

    expect(cookie.options.httpOnly).toBe(true)
    expect(cookie.value).not.toBe("")
  })

  test("登录成功把最后登录时间刷成当前时刻（Unix 秒）", async () => {
    await login(db, credentials(DEFAULT_PASSWORD), SECRET)

    const result = await db.execute(sql`select last_login_at::int8 as t from auth.user where id = ${userId}`)
    const [row] = result.rows
    expect(Math.abs(Number(row?.t) - Math.floor(Date.now() / 1000))).toBeLessThan(60)
  })

  test("透出 must_change_pw，供前端决定是否弹强制改密（T012 要用）", async () => {
    const result = await login(db, credentials(DEFAULT_PASSWORD), SECRET)

    expect(result.mustChangePw).toBe(true)
  })
})

describe("登录失败：统一提示（FR-005）", () => {
  test("密码错误 → InvalidCredentialsError，消息为「账号或密码错误」", async () => {
    const thrown = await errorOf(login(db, credentials("wrong-password"), SECRET))

    expect(thrown).toBeInstanceOf(InvalidCredentialsError)
    expect(thrown.message).toBe("账号或密码错误")
  })

  test("警号不存在 → 与密码错误完全同样的错误与消息，不泄露账号是否存在", async () => {
    const thrown = await errorOf(login(db, { policeNo: "999999", password: DEFAULT_PASSWORD }, SECRET))

    expect(thrown).toBeInstanceOf(InvalidCredentialsError)
    expect(thrown.message).toBe("账号或密码错误")
  })

  test("库里的 hash 畸形（verify 会抛）→ 仍按「账号或密码错误」处理，不是 500", async () => {
    // Bun.password.verify 对垃圾 hash 抛 UnsupportedAlgorithm。若任由它抛出去，
    // 调用方会回 500——与统一提示不一致，等于变相告诉对方「这个账号有异常」。
    await corruptHashOf(ACCOUNT.policeNo, "not-a-hash")

    const thrown = await errorOf(login(db, credentials(DEFAULT_PASSWORD), SECRET))

    expect(thrown).toBeInstanceOf(InvalidCredentialsError)
    expect(thrown.message).toBe("账号或密码错误")
  })

  test("空 hash（verify 返回 false，不抛）同样按「账号或密码错误」处理", async () => {
    await corruptHashOf(ACCOUNT.policeNo, "")

    expect(await failureOf(login(db, credentials(DEFAULT_PASSWORD), SECRET))).toBeInstanceOf(
      InvalidCredentialsError,
    )
  })

  test("登录失败不签发任何凭证，也不刷新最后登录时间", async () => {
    await failureOf(login(db, credentials("wrong-password"), SECRET))

    const result = await db.execute(sql`select last_login_at from auth.user where id = ${userId}`)
    expect(result.rows[0]?.last_login_at).toBeNull()
  })
})
