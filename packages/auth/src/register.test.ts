import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrate } from "./migrate"
import { verifyPassword } from "./password"
import { AccountWriteError, pgErrorCode } from "./pg-errors"
import { DEFAULT_PASSWORD } from "./policy"
import {
  DuplicatePoliceNoError,
  InvalidStatusError,
  MissingFieldError,
  provisionUser,
  registerUser,
} from "./register"
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

/** 跑一次应当失败的操作，要求它抛的是 Error 并交回来——省掉调用点的 as 断言。 */
async function errorOf(action: Promise<unknown>): Promise<Error> {
  const thrown = await failureOf(action)
  if (!(thrown instanceof Error)) throw new Error(`期望抛出 Error，实际拿到：${String(thrown)}`)
  return thrown
}

/**
 * 把一个错误**可达**的全部文本收集起来：自有属性（含 `cause` / `params` 这类）
 * 递归下去，`message` / `stack` 一并算上。
 *
 * 为什么不能只 `JSON.stringify(error)`：`Error` 的 `message` / `stack` 是**不可枚举**的，
 * 于是 `JSON.stringify(new Error("含密码"))` 得到的是 `"{}"`——一个什么都测不到的假绿断言。
 * 这里按属性描述符取值（跳过 getter），并记 `seen` 防环。
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

// FR-003 的原话是「MUST 填写 8 个业务字段」——「必填」不是「非 null」，空白串同样是没填。
// 这些字段全部 NOT NULL，于是「填了个空白」是**唯一**能造出「有行、但没有姓名」的路径：
// 库里会多出一个叫 "   " 的账号，后台列表上是一行看不出问题的空白，谁都不知道它是谁。
describe("录入输入校验（FR-003 的 8 个字段 MUST 填写）", () => {
  const TEXT_FIELDS = ["policeNo", "name", "idCard", "phone", "org", "dept", "section"] as const

  // 参数化遍历，而不是抽查两三个：漏掉哪个字段，就等于「这个字段能建出空账号」，
  // 而漏掉是静默的——没人会去数这里列了几个。
  for (const field of TEXT_FIELDS) {
    test(`${field} 只有空白时拒绝，且一行都不落库`, async () => {
      expect(await failureOf(registerUser(db, { ...INPUT, [field]: "   " }))).toBeInstanceOf(MissingFieldError)
      // 断言「没落库」而不是只看抛错：校验若写在 insert **之后**，同样会抛、同样会留下半条数据。
      expect(await db.select().from(user)).toEqual([])
    })
  }

  test("空串同样拒绝——它不是「留空」，是「没填」", async () => {
    expect(await failureOf(registerUser(db, { ...INPUT, name: "" }))).toBeInstanceOf(MissingFieldError)
  })

  test("报出是哪个字段：后台要能把提示落到对应输入框上", async () => {
    const thrown = await errorOfType(registerUser(db, { ...INPUT, phone: "  " }), MissingFieldError)

    expect(thrown.field).toBe("phone")
  })

  // design-v2 §4.1 的列注释就是定义：`status INTEGER NOT NULL -- 状态（1 启用 / 0 停用）`。
  // 越界的值不会「表现成某种状态」——僵尸扫描按 `= 1`、归档按 `= 0`，两个都匹配不上，
  // 账号就**从两边的视野里同时消失**：既不提醒也不归档，还没有任何报错。
  test("status 只接受 1（启用）/ 0（停用），越界值拒绝", async () => {
    expect(await failureOf(registerUser(db, { ...INPUT, status: 2 }))).toBeInstanceOf(InvalidStatusError)
  })

  test("status 的 0 与 1 本身合法——别把合法的 0 当成「空」", async () => {
    await registerUser(db, { ...INPUT, status: 0 })
    await registerUser(db, { ...INPUT, status: 1, policeNo: "000124" })

    expect(await db.select().from(user)).toHaveLength(2)
  })
})

describe("警号唯一性（FR-001）", () => {
  test("重复警号被拒，抛可识别的领域错误", async () => {
    await registerUser(db, INPUT)

    expect(await failureOf(registerUser(db, INPUT))).toBeInstanceOf(DuplicatePoliceNoError)
  })

  test("错误信息带上警号，后台可直接转成提示语", async () => {
    await registerUser(db, INPUT)

    const thrown = await errorOf(registerUser(db, INPUT))
    expect(thrown.message).toContain(INPUT.policeNo)
  })

  // 这组是「排错线索」与「敏感数据」的分离。线索要留，数据不能跟着走——两者不矛盾：
  // SQLSTATE 足够定位问题，而原始 drizzle 错误的 **message 内联了查询参数**
  // （drizzle-orm/errors.js：`Failed query: ...\nparams: ...`），这条 insert 的参数里
  // 同时有 password_hash、id_card、phone。把原始错误挂上 cause = 把三样一起交出去。
  test("抛出错误的可达图里没有密码哈希——原始错误内联了 params", async () => {
    await registerUser(db, INPUT)

    const thrown = await errorOf(registerUser(db, INPUT))

    expect(textReachableFrom(thrown)).not.toContain("$argon2")
  })

  test("身份证号与手机号同样不随错误外泄", async () => {
    await registerUser(db, INPUT)

    const text = textReachableFrom(await errorOf(registerUser(db, INPUT)))

    expect(text).not.toContain(INPUT.idCard)
    expect(text).not.toContain(INPUT.phone)
  })

  test("排错线索不丢：SQLSTATE 仍可达", async () => {
    await registerUser(db, INPUT)

    // 与非唯一冲突那条路（下面）不同，这里断言的是「领域错误本身仍能回答
    // 『PG 到底报了什么码』」——它是排查时唯一真正需要的字段。
    expect(pgErrorCode(await errorOf(registerUser(db, INPUT)))).toBe("23505")
  })

  // 名字里的「原样」已被 I2 改掉：不再原样抛出（那条 insert 的参数里带敏感数据），
  // 改抛不带参数的 `AccountWriteError`。但**语义**不变——仍绝不能被翻译成「警号重复」。
  test("非唯一冲突的错误不被误判成重复警号，且带上 SQLSTATE", async () => {
    // 把表删掉，制造一个 42P01（undefined_table）——它和 23505 一样是 PG 错误，
    // 但含义完全不同。
    await db.execute(sql`drop table auth.user`)

    const thrown = await errorOfType(registerUser(db, INPUT), AccountWriteError)
    expect(thrown).not.toBeInstanceOf(DuplicatePoliceNoError)
    // 排查要用的那一半没丢。
    expect(thrown.sqlState).toBe("42P01")
  })

  test("换一个警号仍可录入", async () => {
    await registerUser(db, INPUT)

    expect((await registerUser(db, { ...INPUT, policeNo: "000124" })).id).not.toBe("")
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
