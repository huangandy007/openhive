import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrate } from "./migrate"
import { verifyPassword } from "./password"
import { DEFAULT_PASSWORD } from "./policy"
import { provisionUser, registerUser } from "./register"
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

/** 跑一次应当失败的操作，把抛出的错交回来；没抛则得到 undefined。 */
async function failureOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action
    return undefined
  } catch (cause) {
    return cause
  }
}

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

describe("录入流程（账号 + 沙箱，FR-003）", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openhive-register-test-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("录入后沙箱目录存在，且落在 {root}/{id}", async () => {
    const { id, workspace } = await provisionUser(db, INPUT, root)

    expect(workspace).toBe(join(root, id))
    expect((await stat(workspace)).isDirectory()).toBe(true)
  })

  test("账号与沙箱一次办成：落库的 id 就是沙箱目录名", async () => {
    const { id } = await provisionUser(db, INPUT, root)

    expect((await rowOf(INPUT.policeNo)).id).toBe(id)
  })

  test("落库被拒时不留垃圾目录——这条钉住「先落库、后建目录」的顺序", async () => {
    const first = await provisionUser(db, INPUT, root)

    // 同警号第二次录入：PG 的 UNIQUE 先挡下，此时目录还没建。
    expect(await failureOf(provisionUser(db, INPUT, root))).toBeInstanceOf(Error)
    // 若顺序反了（先建目录），这里会多出一个目录。
    expect(await readdir(root)).toEqual([first.id])
  })

  test("建目录失败时把错抛出去，不静默返回一个没有沙箱的账号", async () => {
    // 让 root 的父级是个普通文件——mkdir 必然失败，用来模拟磁盘/权限类故障。
    const blocker = join(root, "blocker")
    await writeFile(blocker, "")

    expect(await failureOf(provisionUser(db, INPUT, join(blocker, "sub")))).toBeInstanceOf(Error)
  })
})
