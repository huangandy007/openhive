import { beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import { verifyPassword } from "./password"
import { DEFAULT_PASSWORD } from "./policy"
import { registerUser } from "./register"
import { user } from "./user"

/** FR-003 的 8 个业务字段。警号即登录用户名。 */
const INPUT = {
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

beforeEach(async () => {
  db = await freshDb()
})

async function rowOf(policeNo: string) {
  const [row] = await db.select().from(user).where(eq(user.policeNo, policeNo))
  if (!row) throw new Error(`未找到警号 ${policeNo} 的账号`)
  return row
}

describe("管理员录入账号", () => {
  test("8 个业务字段逐字落库，默认用户名 = 警号", async () => {
    await registerUser(db, INPUT)

    const row = await rowOf(INPUT.policeNo)
    expect(row.policeNo).toBe(INPUT.policeNo)
    expect(row.name).toBe(INPUT.name)
    expect(row.idCard).toBe(INPUT.idCard)
    expect(row.phone).toBe(INPUT.phone)
    expect(row.org).toBe(INPUT.org)
    expect(row.dept).toBe(INPUT.dept)
    expect(row.section).toBe(INPUT.section)
    expect(row.status).toBe(INPUT.status)
  })

  test("status 由录入方给定，不被写成固定值", async () => {
    await registerUser(db, { ...INPUT, status: 0 })

    expect((await rowOf(INPUT.policeNo)).status).toBe(0)
  })

  test("存的是默认密码的哈希：可验通，且不是明文", async () => {
    await registerUser(db, INPUT)

    const { passwordHash } = await rowOf(INPUT.policeNo)
    expect(await verifyPassword(DEFAULT_PASSWORD, passwordHash)).toBe(true)
    expect(passwordHash).not.toBe(DEFAULT_PASSWORD)
  })

  test("录入即标记需改密", async () => {
    await registerUser(db, INPUT)

    expect((await rowOf(INPUT.policeNo)).mustChangePw).toBe(1)
  })

  test("is_admin 不在 8 字段内，默认关闭；最后登录/活跃时间留空", async () => {
    await registerUser(db, INPUT)

    const row = await rowOf(INPUT.policeNo)
    expect(row.isAdmin).toBe(0)
    expect(row.lastLoginAt).toBeNull()
    expect(row.lastActiveAt).toBeNull()
  })

  test("created_at 记的是 Unix 秒（毫秒会顶穿 PG integer，首行就插不进去）", async () => {
    await registerUser(db, INPUT)

    const { createdAt } = await rowOf(INPUT.policeNo)
    expect(Math.abs(createdAt - Math.floor(Date.now() / 1000))).toBeLessThan(60)
  })

  test("生成的 id 互不相同，且与落库的行一致", async () => {
    const first = await registerUser(db, INPUT)
    const second = await registerUser(db, { ...INPUT, policeNo: "000124" })

    expect(first.id).not.toBe("")
    expect(first.id).not.toBe(second.id)
    expect((await rowOf(INPUT.policeNo)).id).toBe(first.id)
  })
})
