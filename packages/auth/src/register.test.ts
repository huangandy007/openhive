import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { InvalidCredentialsError, login } from "./login"
import { migrate } from "./migrate"
import { verifyPassword } from "./password"
import { AccountWriteError, pgErrorCode } from "./pg-errors"
import {
  DuplicatePoliceNoError,
  InvalidStatusError,
  MissingFieldError,
  provisionUser,
  registerUser,
  type RegisterInput,
} from "./register"
import { DEPLOYED_DEFAULT_PASSWORD, PUBLIC_EXAMPLE_PASSWORD } from "./test-support"
import { user } from "./user"

// 两个值的含义、以及「为什么必须不同」写在 `test-support.ts` 那两条常量上——一处定义，
// 免得 7 个测试文件各写一份、各自漂走。这里的短名字只为本文件的可读性。
const PW = DEPLOYED_DEFAULT_PASSWORD
const EXAMPLE = PUBLIC_EXAMPLE_PASSWORD

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

// 正向对照。没有它，上面那几条 `not.toContain(...)` **全部可能空转**——
// 一个恒返回 `""` 的 walker 能让任何「不含哈希」的断言通过。本 feature 已经有 3 条
// 首跑即绿的假绿（state.md 记着），失败模式同源：断言方向单一，没人验它真的看得见东西。
describe("脱敏断言的工具本身可信（正向对照）", () => {
  // `delete probe.stack` 不是洁癖，是这条断言能否成立的前提：`Error` 的 `stack` 首行**就是**
  // `message` 的文本，所以只要 stack 还在，「message 可达」这半句即使 walker 整个跳过
  // `message` 键也照样绿（实测：改成 `if (key === "message") continue` → 34 条全绿）。
  // 删掉 stack，这条断言才真的只可能由 `message` 满足。
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

async function rowOf(policeNo: string) {
  const [row] = await db.select().from(user).where(eq(user.policeNo, policeNo))
  if (!row) throw new Error(`未找到警号 ${policeNo} 的账号`)
  return row
}

/** 取全部匹配行（可为空）。`rowOf` 找不到会抛，断言「**没有**留下东西」时不能用它。 */
function rowsOfPoliceNo(policeNo: string) {
  return db.select().from(user).where(eq(user.policeNo, policeNo))
}

const SECRET = "test-secret"

describe("管理员录入账号", () => {
  test("8 个业务字段逐字落库，默认用户名 = 警号", async () => {
    await registerUser(db, INPUT, PW)

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
    await registerUser(db, { ...INPUT, status: 0 }, PW)

    expect((await rowOf(INPUT.policeNo)).status).toBe(0)
  })

  test("存的是**配置里那个**默认密码的哈希：可验通，不是明文，且不是文档示例值", async () => {
    await registerUser(db, INPUT, PW)

    const { passwordHash } = await rowOf(INPUT.policeNo)
    expect(await verifyPassword(PW, passwordHash)).toBe(true)
    expect(passwordHash).not.toBe(PW)
    // ⚠️ **这条才是本 task 的判据**：上一条只能证明「存了个能验通的哈希」，
    // 一个仍在用硬编码常量的实现**照样能满足它**（只要测试传的 PW 恰好等于那个常量）。
    // 这里断言「**公开示例值验不通**」——它把「读了配置」与「还用着旧常量」分开。
    // 变异检验：把 `registerUser` 里的 `defaultPassword` 换回字面量 `"admin@123456"`，本条必红。
    expect(await verifyPassword(EXAMPLE, passwordHash)).toBe(false)
  })

  test("录入即标记需改密", async () => {
    await registerUser(db, INPUT, PW)

    expect((await rowOf(INPUT.policeNo)).mustChangePw).toBe(1)
  })

  test("is_admin 不在 8 字段内，默认关闭；最后登录/活跃时间留空", async () => {
    await registerUser(db, INPUT, PW)

    const row = await rowOf(INPUT.policeNo)
    expect(row.isAdmin).toBe(0)
    expect(row.lastLoginAt).toBeNull()
    expect(row.lastActiveAt).toBeNull()
  })

  test("created_at 记的是 Unix 秒（毫秒会顶穿 PG integer，首行就插不进去）", async () => {
    await registerUser(db, INPUT, PW)

    const { createdAt } = await rowOf(INPUT.policeNo)
    expect(Math.abs(createdAt - Math.floor(Date.now() / 1000))).toBeLessThan(60)
  })

  test("生成的 id 互不相同，且与落库的行一致", async () => {
    const first = await registerUser(db, INPUT, PW)
    const second = await registerUser(db, { ...INPUT, policeNo: "000124" }, PW)

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
      expect(await failureOf(registerUser(db, { ...INPUT, [field]: "   " }, PW))).toBeInstanceOf(MissingFieldError)
      // 断言「没落库」而不是只看抛错：校验若写在 insert **之后**，同样会抛、同样会留下半条数据。
      expect(await db.select().from(user)).toEqual([])
    })
  }

  test("空串同样拒绝——它不是「留空」，是「没填」", async () => {
    expect(await failureOf(registerUser(db, { ...INPUT, name: "" }, PW))).toBeInstanceOf(MissingFieldError)
  })

  // 上面那条参数化循环覆盖不到 `validate` 里 `typeof value !== "string"` 这半边：
  // `"   "` 是字符串，走的是 `.trim()` 那一半。而这一半不是多余的（见 register.ts 的注释）——
  // 网关交进来的是 `JSON.parse` 的产物，`null` / 缺键在 `RegisterInput` 类型上不存在、运行时会到。
  // 把它删掉，`.trim()` 撞上 undefined 抛 TypeError，一次「少填一个字段」就变成 500。
  describe("字段不是字符串（网关给的 JSON 里合法，类型上不存在）", () => {
    /**
     * 造一个「网关那一侧」的输入：在合法的 8 字段上覆写其中一个。
     *
     * 用 `Object.assign` 而不是 `JSON.parse(...) as RegisterInput`：后者要一次 `as`，
     * 而 oxlint 的 `no-unsafe-type-assertion` 会拦（从 `any` 收窄、从 `unknown` 收窄都拦），
     * 本项目的门禁判据又是「本次改动文件 **0 命中**」。`Object.assign` 的返回类型是
     * `RegisterInput & Record<string, unknown>`，**不需要断言**就能赋给 `RegisterInput`，
     * 而运行时那个字段确实已被换成 `null` / `undefined` / 数字——正是网关解析 JSON 后
     * 可能交过来的东西。断言省了，被模拟的那条边界一个没少。
     */
    function fromGateway(patch: Record<string, unknown>): RegisterInput {
      return Object.assign({}, INPUT, patch)
    }

    test("字段是 null 时拒绝", async () => {
      expect(await failureOf(registerUser(db, fromGateway({ phone: null }), PW))).toBeInstanceOf(MissingFieldError)
      expect(await db.select().from(user)).toEqual([])
    })

    test("字段是 undefined 时拒绝——`.trim()` 撞上它会抛 TypeError，把「少填一个」变成 500", async () => {
      const thrown = await errorOfType(registerUser(db, fromGateway({ phone: undefined }), PW), MissingFieldError)

      expect(thrown.field).toBe("phone")
      expect(await db.select().from(user)).toEqual([])
    })

    test("数字、布尔、数组同样拒绝——它们也不是「填了」", async () => {
      for (const value of [123, true, [], {}]) {
        expect(await failureOf(registerUser(db, fromGateway({ name: value }), PW))).toBeInstanceOf(MissingFieldError)
      }
    })
  })

  test("报出是哪个字段：后台要能把提示落到对应输入框上", async () => {
    const thrown = await errorOfType(registerUser(db, { ...INPUT, phone: "  " }, PW), MissingFieldError)

    expect(thrown.field).toBe("phone")
  })

  // design-v2 §4.1 的列注释就是定义：`status INTEGER NOT NULL -- 状态（1 启用 / 0 停用）`。
  // 越界的值不会「表现成某种状态」——僵尸扫描按 `= 1`、归档按 `= 0`，两个都匹配不上，
  // 账号就**从两边的视野里同时消失**：既不提醒也不归档，还没有任何报错。
  test("status 只接受 1（启用）/ 0（停用），越界值拒绝", async () => {
    expect(await failureOf(registerUser(db, { ...INPUT, status: 2 }, PW))).toBeInstanceOf(InvalidStatusError)
  })

  test("status 的 0 与 1 本身合法——别把合法的 0 当成「空」", async () => {
    await registerUser(db, { ...INPUT, status: 0 }, PW)
    await registerUser(db, { ...INPUT, status: 1, policeNo: "000124" }, PW)

    expect(await db.select().from(user)).toHaveLength(2)
  })
})

describe("警号唯一性（FR-001）", () => {
  test("重复警号被拒，抛可识别的领域错误", async () => {
    await registerUser(db, INPUT, PW)

    expect(await failureOf(registerUser(db, INPUT, PW))).toBeInstanceOf(DuplicatePoliceNoError)
  })

  test("错误信息带上警号，后台可直接转成提示语", async () => {
    await registerUser(db, INPUT, PW)

    const thrown = await errorOf(registerUser(db, INPUT, PW))
    expect(thrown.message).toContain(INPUT.policeNo)
  })

  // 这组是「排错线索」与「敏感数据」的分离。线索要留，数据不能跟着走——两者不矛盾：
  // SQLSTATE 足够定位问题，而原始 drizzle 错误的 **message 内联了查询参数**
  // （drizzle-orm/errors.js：`Failed query: ...\nparams: ...`），这条 insert 的参数里
  // 同时有 password_hash、id_card、phone。把原始错误挂上 cause = 把三样一起交出去。
  test("抛出错误的可达图里没有密码哈希——原始错误内联了 params", async () => {
    await registerUser(db, INPUT, PW)

    const thrown = await errorOf(registerUser(db, INPUT, PW))

    expect(textReachableFrom(thrown)).not.toContain("$argon2")
  })

  test("身份证号与手机号同样不随错误外泄", async () => {
    await registerUser(db, INPUT, PW)

    const text = textReachableFrom(await errorOf(registerUser(db, INPUT, PW)))

    expect(text).not.toContain(INPUT.idCard)
    expect(text).not.toContain(INPUT.phone)
  })

  test("排错线索不丢：SQLSTATE 仍可达", async () => {
    await registerUser(db, INPUT, PW)

    // 与非唯一冲突那条路（下面）不同，这里断言的是「领域错误本身仍能回答
    // 『PG 到底报了什么码』」——它是排查时唯一真正需要的字段。
    expect(pgErrorCode(await errorOf(registerUser(db, INPUT, PW)))).toBe("23505")
  })

  // 名字里的「原样」已被 I2 改掉：不再原样抛出（那条 insert 的参数里带敏感数据），
  // 改抛不带参数的 `AccountWriteError`。但**语义**不变——仍绝不能被翻译成「警号重复」。
  test("非唯一冲突的错误不被误判成重复警号，且带上 SQLSTATE", async () => {
    // 把表删掉，制造一个 42P01（undefined_table）——它和 23505 一样是 PG 错误，
    // 但含义完全不同。
    await db.execute(sql`drop table auth.user`)

    const thrown = await errorOfType(registerUser(db, INPUT, PW), AccountWriteError)
    expect(thrown).not.toBeInstanceOf(DuplicatePoliceNoError)
    // 排查要用的那一半没丢。
    expect(thrown.sqlState).toBe("42P01")
  })

  test("换一个警号仍可录入", async () => {
    await registerUser(db, INPUT, PW)

    expect((await registerUser(db, { ...INPUT, policeNo: "000124" }, PW)).id).not.toBe("")
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
    const { id, workspace } = await provisionUser(db, INPUT, root, PW)

    expect(workspace).toBe(join(root, id))
    expect((await stat(workspace)).isDirectory()).toBe(true)
  })

  test("账号与沙箱一次办成：落库的 id 就是沙箱目录名", async () => {
    const { id } = await provisionUser(db, INPUT, root, PW)

    expect((await rowOf(INPUT.policeNo)).id).toBe(id)
  })

  test("落库被拒时不留垃圾目录——反转顺序后这条靠清理达成", async () => {
    const first = await provisionUser(db, INPUT, root, PW)

    // 同警号第二次录入：新目录已经建出来了（id 是新生成的 UUID），落库才撞上 UNIQUE。
    expect(await failureOf(provisionUser(db, INPUT, root, PW))).toBeInstanceOf(Error)
    // ⚠️ 这条断言在**反转前后都成立**，变的只是它为什么成立：
    // 原来靠「先落库、还没轮到建目录」，现在靠「落库失败后把刚建的空目录删掉」。
    expect(await readdir(root)).toEqual([first.id])
  })

  test("落库被拒时抛的仍是「警号重复」，不是清理目录时撞上的那个错", async () => {
    await provisionUser(db, INPUT, root, PW)

    // 清理动作排在重抛之前，它自己的失败**绝不能盖掉**管理员真正要知道的原因。
    expect(await failureOf(provisionUser(db, INPUT, root, PW))).toBeInstanceOf(DuplicatePoliceNoError)
  })

  test("建目录失败时把错抛出去，不静默返回一个没有沙箱的账号", async () => {
    // 让 root 的父级是个普通文件——mkdir 必然失败，用来模拟磁盘/权限类故障。
    const blocker = join(root, "blocker")
    await writeFile(blocker, "")

    expect(await failureOf(provisionUser(db, INPUT, join(blocker, "sub"), PW))).toBeInstanceOf(Error)
  })

  /**
   * T022（002 评审 I5）。**这条是本次的核心**。
   *
   * 上面那条只钉了「错抛出去了」，**没管库里那行**——而先前的顺序是「先落库、后建目录」，
   * `createWorkspace` 失败时**账号行已经插进去了**。后果不只是难看：
   *
   * - 那个账号有**默认口令的 hash**、`status` **取自录入表单**（正常录入新民警就是 1），
   *   而 `login` 的判据只卡 `status !== 1` 与密码 ⇒ **它会放它进来**。
   *   一次管理员看到的「失败」，实际留下了一个能过认证、却没有沙箱的账号。
   * - 它同时**挡住重试**：同警号再录一次撞 UNIQUE，管理员在界面上只会看到「该警号已录入」，
   *   而那个账号用不了 —— 他没有第二条路，只能进库。
   *
   * 处置是**反转顺序**（先建目录、后落库），所以下面钉的是**不变量**：
   * 目录建不出来时，账号行**根本还没被插**。
   *
   * ⚠️ **诚实标注**：这两条断言**分不出**「反转顺序」与「落库失败后补偿删除」——
   * 两者都满足。差别只在**崩溃窗口**（前者的半成品是空目录、后者是账号行），而崩溃测不到。
   * 选反转顺序是基于「结构上做不到」而不是基于这几条断言，别把它们读成在钉机制。
   */
  test("建目录失败时，库里不留账号行——失败的操作不该留下半个账号", async () => {
    const blocker = join(root, "blocker")
    await writeFile(blocker, "")

    expect(await failureOf(provisionUser(db, INPUT, join(blocker, "sub"), PW))).toBeInstanceOf(Error)

    expect(await rowsOfPoliceNo(INPUT.policeNo)).toEqual([])
  })

  /**
   * ⚠️ **这条钉的是一个「反转顺序才出现」的新风险**：改之前是「先落库后建目录」，
   * 非法输入在**落库那一步之前**就被 `validate` 挡下，根本走不到文件系统。
   * 反转到「先建目录」后，校验若排在建目录之后，非法输入就会**留下一个垃圾目录**——
   * 而这是本 task 自己引入的，不是既有的。
   *
   * 诚实标注：这条是**实现落笔之后补的**（不像上面两条先写后跑）。它的判别力
   * 由变异检验给（把 `validate` 挪到 `createWorkspace` 之后 ⇒ 本条红），不是由 RED 给。
   */
  test("输入非法时连目录都不建——校验必须排在建目录之前", async () => {
    const bad = { ...INPUT, name: "" }

    expect(await failureOf(provisionUser(db, bad, root, PW))).toBeInstanceOf(MissingFieldError)
    expect(await readdir(root)).toEqual([])
  })

  test("建目录失败之后，那个警号登不进来——上面那条的后果面", async () => {
    const blocker = join(root, "blocker")
    await writeFile(blocker, "")

    await failureOf(provisionUser(db, INPUT, join(blocker, "sub"), PW))

    // 「库里有行」是机制，「登得进来」才是后果。这一条让上面那条不必靠读代码才懂。
    const thrown = await failureOf(login(db, { policeNo: INPUT.policeNo, password: PW }, SECRET))
    expect(thrown).toBeInstanceOf(InvalidCredentialsError)
  })
})
