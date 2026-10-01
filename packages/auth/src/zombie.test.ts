import { beforeEach, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { InvalidCredentialsError, login } from "./login"
import { migrate } from "./migrate"
import { registerUser } from "./register"
import { DEPLOYED_DEFAULT_PASSWORD } from "./test-support"
import { user } from "./user"

const PW = DEPLOYED_DEFAULT_PASSWORD
import {
  disableAccounts,
  findArchivableAccounts,
  findZombieAccounts,
  LastAdminError,
  lastSeenAtOf,
  restoreAccount,
} from "./zombie"

const DAY = 24 * 60 * 60

async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)
  return db
}

type Db = Awaited<ReturnType<typeof freshDb>>

let db: Db
/** 判定基准时刻。用定值而非 nowSeconds()，边界用例才可复现。 */
const NOW = 1_800_000_000

/**
 * 录入一个账号，再把它的时间列摆成指定样子。
 *
 * 三列直接 UPDATE 而不走业务代码：`last_active_at` 至今**没有写入方**（它归网关，F3 才有），
 * 造这个状态只能手工摆。缺省即「从没写过」= NULL。
 */
async function account(
  policeNo: string,
  options: { createdDaysAgo: number; lastLoginDaysAgo?: number; lastActiveDaysAgo?: number; status?: number },
): Promise<string> {
  const { id } = await registerUser(db, {
    policeNo,
    name: `民警${policeNo}`,
    idCard: "110101199001010011",
    phone: "13800000000",
    org: "市公安局",
    dept: "刑侦支队",
    section: "一大队",
    status: options.status ?? 1,
  }, PW)

  const daysAgo = (days: number) => NOW - days * DAY
  const at = (days: number | undefined) => (days === undefined ? null : daysAgo(days))
  await db.execute(sql`
    update auth.user set
      created_at = ${daysAgo(options.createdDaysAgo)},
      last_login_at = ${at(options.lastLoginDaysAgo)},
      last_active_at = ${at(options.lastActiveDaysAgo)}
    where id = ${id}
  `)

  return id
}

async function policeNosOfZombies(): Promise<string[]> {
  return (await findZombieAccounts(db, NOW)).map((z) => z.policeNo)
}

async function statusOf(id: string): Promise<number> {
  const result = await db.execute(sql`select status from auth.user where id = ${id}`)
  return Number(result.rows[0]?.status)
}

const SECRET = "test-secret"

const credentials = (policeNo: string) => ({ policeNo, password: PW })

/**
 * 同上，但要求抛的确实是 `Error` 并交回来——留着逃出去的是字符串或 undefined 时，
 * 调用点的 `thrown.message` 会读成 undefined 而**断言照样通过**（同 login / password / register /
 * migrate 四个测试文件里同名的那只）。
 */
async function errorOf(action: Promise<unknown>): Promise<Error> {
  const thrown = await failureOf(action)
  if (!(thrown instanceof Error)) throw new Error(`期望抛出 Error，实际拿到：${String(thrown)}`)
  return thrown
}

/** 跑一次应当失败的登录，把抛出的错交回来；没抛则得到 undefined。 */
async function failureOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action
    return undefined
  } catch (cause) {
    return cause
  }
}

async function deactivatedAtOf(id: string): Promise<unknown> {
  const result = await db.execute(sql`select deactivated_at from auth.user where id = ${id}`)
  return result.rows[0]?.deactivated_at ?? null
}

/** 把停用时刻摆到指定的天数之前（`extraSeconds` 用于卡边界）。 */
async function setDeactivatedDaysAgo(id: string, days: number, extraSeconds = 0): Promise<void> {
  await db.execute(
    sql`update auth.user set deactivated_at = ${NOW - days * DAY - extraSeconds} where id = ${id}`,
  )
}

async function policeNosOfArchivable(): Promise<string[]> {
  return (await findArchivableAccounts(db, NOW)).map((a) => a.policeNo)
}

beforeEach(async () => {
  db = await freshDb()
})

describe("僵尸账户筛选：超 90 天未活跃的启用账户（FR-009）", () => {
  test("从没登录过、建号已超 90 天 → 算僵尸（默认密码多半还没改，正是最该处理的一类）", async () => {
    await account("000001", { createdDaysAgo: 200 })

    expect(await policeNosOfZombies()).toEqual(["000001"])
  })

  test("最后一次登录在 100 天前 → 算僵尸", async () => {
    await account("000002", { createdDaysAgo: 200, lastLoginDaysAgo: 100 })

    expect(await policeNosOfZombies()).toEqual(["000002"])
  })

  test("5 天前登录过 → 不算僵尸", async () => {
    await account("000003", { createdDaysAgo: 200, lastLoginDaysAgo: 5 })

    expect(await policeNosOfZombies()).toEqual([])
  })

  test("last_active_at 比 last_login_at 新时以它为准（design-v2：它比登录更准）", async () => {
    await account("000004", { createdDaysAgo: 200, lastLoginDaysAgo: 100, lastActiveDaysAgo: 3 })

    expect(await policeNosOfZombies()).toEqual([])
  })

  test("已停用的账户不出现——要找的是「还开着但没人用」的", async () => {
    await account("000005", { createdDaysAgo: 200, status: 0 })

    expect(await policeNosOfZombies()).toEqual([])
  })

  test("恰好 90 天不算，90 天零 1 秒才算（要求是「**超过** 90 天」）", async () => {
    await account("000006", { createdDaysAgo: 90 })
    const justOver = await account("000007", { createdDaysAgo: 200 })
    await db.execute(sql`update auth.user set created_at = ${NOW - 90 * DAY - 1} where id = ${justOver}`)

    expect(await policeNosOfZombies()).toEqual(["000007"])
  })

  test("返回最后一次有活着迹象的时刻，供后台展示「多久没来了」", async () => {
    await account("000008", { createdDaysAgo: 200, lastLoginDaysAgo: 120 })

    const [zombie] = await findZombieAccounts(db, NOW)

    expect(zombie?.lastSeenAt).toBe(NOW - 120 * DAY)
  })

  // **对账测试**：筛选走 SQL 的 coalesce，返回的 lastSeenAt 走 JS 的 lastSeenAtOf，
  // 是同一规则的两份实现。若两者漂移（比如 SQL 只看 last_active_at、JS 看整条链），这里会红。
  test("SQL 的筛选规则与返回的 lastSeenAt 说的是同一件事", async () => {
    await account("000010", { createdDaysAgo: 200 })
    await account("000011", { createdDaysAgo: 200, lastLoginDaysAgo: 100 })
    await account("000012", { createdDaysAgo: 200, lastLoginDaysAgo: 5 })
    await account("000013", { createdDaysAgo: 200, lastLoginDaysAgo: 100, lastActiveDaysAgo: 3 })
    await account("000014", { createdDaysAgo: 200, status: 0 })

    const zombieIds = new Set((await findZombieAccounts(db, NOW)).map((z) => z.id))
    const cutoff = NOW - 90 * DAY

    for (const row of await db.select().from(user)) {
      expect(zombieIds.has(row.id)).toBe(row.status === 1 && lastSeenAtOf(row) < cutoff)
    }
  })
})

describe("一键批量停用（FR-009）", () => {
  test("把选中的账号置为停用，且只动它们", async () => {
    const zombie = await account("000021", { createdDaysAgo: 200 })
    const alive = await account("000022", { createdDaysAgo: 200, lastLoginDaysAgo: 1 })

    await disableAccounts(db, [zombie])

    expect(await statusOf(zombie)).toBe(0)
    expect(await statusOf(alive)).toBe(1)
  })

  test("停用后不再出现在僵尸名单里（名单收敛，点几次不会越点越多）", async () => {
    const zombie = await account("000023", { createdDaysAgo: 200 })

    await disableAccounts(db, [zombie])

    expect(await policeNosOfZombies()).toEqual([])
  })

  test("空名单一行也不动（管理员一个都没勾就点了停用）", async () => {
    await account("000024", { createdDaysAgo: 200 })

    await disableAccounts(db, [])

    expect(await policeNosOfZombies()).toEqual(["000024"])
  })
})

// 停用是**幂等**的：已经停用的账号再被停用一次，不该有任何变化。
// 会真的出事的场景不是「手滑点两次」，而是**前端拿着一张翻页前的旧名单**又点了一次批量停用
// （或脚本按 id 列表重放）——那一刻 `deactivated_at` 被改写成 now，30 天保留期**从头起算**。
// 停用日期是事实，不是「最后一次点停用的时间」。
describe("重复停用不改写停用时刻（FR-010 的起算点必须稳定）", () => {
  test("已停用 20 天，再停一次，时刻仍是 20 天前", async () => {
    const id = await account("000025", { createdDaysAgo: 200 })
    await disableAccounts(db, [id])
    await setDeactivatedDaysAgo(id, 20)

    await disableAccounts(db, [id])

    expect(Number(await deactivatedAtOf(id))).toBe(NOW - 20 * DAY)
  })

  // 数据不变式之外，再看它造成的**后果**：起算点被重置，账号就被从归档里救回来了——
  // 而「一直有人点」意味着它**永远不会**被归档，沙箱与账号数据无限期留在系统里。
  test("已停用 31 天（够归档了）的账号，被重复停用后仍算逾期", async () => {
    const id = await account("000026", { createdDaysAgo: 400, status: 0 })
    await setDeactivatedDaysAgo(id, 31)

    // 必须显式传 NOW：默认的 nowSeconds() 是**真实当前时刻**，落在 NOW 之前，
    // 于是「时钟被重置」这件事在 `findArchivableAccounts(db, NOW)` 眼里看不出来——
    // 上次跑这条就是这么蒙混过去的（假绿）。
    await disableAccounts(db, [id], NOW)

    expect(await policeNosOfArchivable()).toEqual(["000026"])
  })

  // `NULL + status=0` 是 design-v2 §4.1 明写的第三态：「停用但时刻未知」（002 之前的历史数据）。
  // 给它补一个 `now` 不等于「补全了数据」，而是**声称我们知道它是刚停的**——它在库里待了多久
  // 就白待了，30 天后会被当成逾期对象归档掉。宁可漏，不可误删。
  test("重复停用不会给「时刻未知」的老数据补一个假时刻", async () => {
    const id = await account("000027", { createdDaysAgo: 400, status: 0 })

    await disableAccounts(db, [id])

    expect(await deactivatedAtOf(id)).toBeNull()
  })
})

describe("停用后保留 30 天（FR-010 / T016）", () => {
  test("停用时记下停用时刻——没有它，「是否已满 30 天」无从判定", async () => {
    const id = await account("000031", { createdDaysAgo: 200 })

    await disableAccounts(db, [id])

    const at = await deactivatedAtOf(id)
    expect(at).not.toBeNull()
    expect(Math.abs(Number(at) - Math.floor(Date.now() / 1000))).toBeLessThan(60)
  })

  test("恢复：状态回到启用，并**清掉**停用时刻", async () => {
    const id = await account("000032", { createdDaysAgo: 200 })
    await disableAccounts(db, [id])

    await restoreAccount(db, id)

    expect(await statusOf(id)).toBe(1)
    // 清掉这一条是**要点**：留着的话，账号虽然恢复了，逾期清单仍会把它当成待归档对象。
    expect(await deactivatedAtOf(id)).toBeNull()
  })

  test("恢复后能正常登录——停用被拒（T011）随之解除", async () => {
    const id = await account("000033", { createdDaysAgo: 200 })
    await disableAccounts(db, [id])
    const before = await failureOf(login(db, credentials("000033"), SECRET))
    await restoreAccount(db, id)

    const after = await login(db, credentials("000033"), SECRET)

    expect(before).toBeInstanceOf(InvalidCredentialsError)
    expect(after.subject.id).toBe(id)
  })

  test("逾期清单只列停用**超过** 30 天的", async () => {
    const longAgo = await account("000034", { createdDaysAgo: 400, status: 0 })
    const recent = await account("000035", { createdDaysAgo: 400, status: 0 })
    await setDeactivatedDaysAgo(longAgo, 31)
    await setDeactivatedDaysAgo(recent, 3)

    expect(await policeNosOfArchivable()).toEqual(["000034"])
  })

  // 边界与 90 天那条**刚好相反**，别照抄：FR-009 的原文是「超过 90 天」（严格小于），
  // FR-010 的原文是「保留 30 天」——保留期满即到期，故是「满 30 天」（小于等于）。
  test("停用**满** 30 天即可归档，差 1 秒还不行", async () => {
    const justUnder = await account("000036", { createdDaysAgo: 400, status: 0 })
    const exact = await account("000037", { createdDaysAgo: 400, status: 0 })
    await setDeactivatedDaysAgo(justUnder, 30, -1)
    await setDeactivatedDaysAgo(exact, 30)

    expect(await policeNosOfArchivable()).toEqual(["000037"])
  })

  // 这是**刻意的保守**：002 之前停用的账号没有停用时刻（那时还没这列）。
  // 若把 NULL 当成「很早就停用了」，一次误删就再也回不来——FR-010 要的恰恰是「避免误删」。
  // 宁可漏归档，不可误删：NULL 一律不进清单，留给人判断。
  test("没有停用时刻的停用账号**不**进逾期清单（迁移前的老数据，宁可漏不可误删）", async () => {
    await account("000038", { createdDaysAgo: 400, status: 0 })

    expect(await policeNosOfArchivable()).toEqual([])
  })

  test("启用中的账号不进逾期清单", async () => {
    await account("000039", { createdDaysAgo: 400, status: 1 })

    expect(await policeNosOfArchivable()).toEqual([])
  })

  // ⚠️ 这条**单独**钉不住「恢复要清 deactivated_at」——恢复后 status 已是 1，
  // 上面那条 status = 0 就把它挡住了（变异验证实测：不清也只红一条）。
  // 真正钉住清空的是上面那条「恢复：…并**清掉**停用时刻」——它断言的是**数据不变式**本身。
  test("恢复后不再出现在逾期清单里", async () => {
    const id = await account("000040", { createdDaysAgo: 400, status: 0 })
    await setDeactivatedDaysAgo(id, 60)

    await restoreAccount(db, id)

    expect(await policeNosOfArchivable()).toEqual([])
  })

  test("逾期清单带回停用时刻，供后台显示「已停用多久」", async () => {
    const id = await account("000041", { createdDaysAgo: 400, status: 0 })
    await setDeactivatedDaysAgo(id, 45)

    const [archivable] = await findArchivableAccounts(db, NOW)

    expect(archivable?.deactivatedAt).toBe(NOW - 45 * DAY)
  })
})

/**
 * T024（002 评审 I9 的另一半）：**一键批量停用不得把系统停成「一个管理员都没有」**。
 *
 * ## 为什么拦的是这个动作，**不是**那张名单
 *
 * 一个 90 天没人用、却能录入账号和重置密码的账号，是**特权休眠账号**——风险最高的一类，
 * 恰恰最该被管理员看见。把它从僵尸名单里滤掉 = 把它藏起来（task 原文点名不许这么做）。
 * 要拦的是那个**一次删掉一批**的动作。
 *
 * ## 判据是「会不会减到 0」，不是「含不含管理员」
 *
 * 表里有两个管理员时，停掉其中一个完全正常——真正不可接受的是**停完一个都不剩**。
 * 所以下面既钉「该拒的拒」，也钉「**不该拒的别拒**」（过紧也是缺陷）。
 *
 * ## 已裁定（2026-10-01）
 *
 * ① **整批拒绝、抛错**，不是「跳过那一个、其余照停」。第二条用例的
 * 「同批的普通僵尸也没被停」就是这两种实现的分界线。
 * ② **只在「本批真的会减到 0」时拦**；表里本来就是 0 个启用管理员（例如 T019 引导之前）
 * 时**放行**——那时没什么可保护的，拦下来只是让一个无害动作失败。
 */
describe("批量停用不得停掉最后一个启用管理员（T024）", () => {
  /**
   * 把账号提成管理员。
   *
   * ⚠️ 直接改列而不是调 `bootstrapAdmin`：那个函数是**一次性**的——只在「一个管理员都没有」时
   * 生效（T019 刻意的设计，否则「把某警号提权」就成了能反复用的常开开关）。造第二个管理员
   * 只能直接改列；提权在仓库里**没有第二条业务路径**（F10 的账号管理才会有）。
   */
  async function promote(id: string): Promise<void> {
    await db.execute(sql`update auth.user set is_admin = 1 where id = ${id}`)
  }

  async function enabledAdminCount(): Promise<number> {
    const result = await db.execute(
      sql`select count(*)::int as n from auth.user where is_admin = 1 and status = 1`,
    )
    return Number(result.rows[0]?.n)
  }

  test("本批会停掉最后一个启用管理员 ⇒ 拒，且**同批的普通账号也没被停**", async () => {
    const boss = await account("000051", { createdDaysAgo: 200 })
    await promote(boss)
    const zombie = await account("000052", { createdDaysAgo: 200 })

    const thrown = await failureOf(disableAccounts(db, [boss, zombie]))

    expect(thrown).toBeInstanceOf(LastAdminError)
    // 「整批拒绝」与「跳过那一个」的分界线：后者会留下 `zombie` 已被停用、`boss` 还在。
    expect(await statusOf(zombie)).toBe(1)
    expect(await statusOf(boss)).toBe(1)
    expect(await enabledAdminCount()).toBe(1)
  })

  /** 点名的判据取自**库里查出来的那一行**，不是入参（入参是 id，人读不懂）。 */
  test("错误消息点名是哪个警号，而不是一句「操作失败」", async () => {
    const boss = await account("000051", { createdDaysAgo: 200 })
    await promote(boss)

    const thrown = await errorOf(disableAccounts(db, [boss]))

    expect(thrown.message).toContain("000051")
  })

  test("还有别的启用管理员 ⇒ 停掉其中一个，没问题", async () => {
    const first = await account("000053", { createdDaysAgo: 200 })
    const second = await account("000054", { createdDaysAgo: 200 })
    await promote(first)
    await promote(second)

    await disableAccounts(db, [first])

    expect(await statusOf(first)).toBe(0)
    expect(await statusOf(second)).toBe(1)
    expect(await enabledAdminCount()).toBe(1)
  })

  test("批里带了管理员但**没带全** ⇒ 照停（判据是会不会减到 0，不是含不含管理员）", async () => {
    const first = await account("000055", { createdDaysAgo: 200 })
    const second = await account("000056", { createdDaysAgo: 200 })
    const zombie = await account("000057", { createdDaysAgo: 200 })
    await promote(first)
    await promote(second)

    await disableAccounts(db, [first, zombie])

    expect(await statusOf(first)).toBe(0)
    expect(await statusOf(second)).toBe(1)
    expect(await statusOf(zombie)).toBe(0)
    expect(await enabledAdminCount()).toBe(1)
  })

  /**
   * 钉住判据里的 **`status = 1`**：管理员得是**能登录的**才算数。
   *
   * 少了这一半，实现就会只数 `is_admin = 1`，于是「只剩一个**已停用**的管理员」被当成
   * 「还有一个管理员」放行——而停用的人**登不进去**，系统照样锁死（T019 的引导注释里
   * 记着同一条：判据刻意是「表里有没有管理员」，那里的取舍不同，别照抄）。
   */
  test("已停用的管理员不算数：只剩它一个「管理员」时照样拒", async () => {
    const active = await account("000058", { createdDaysAgo: 200 })
    const dormant = await account("000059", { createdDaysAgo: 200, status: 0 })
    await promote(active)
    await promote(dormant)

    const thrown = await failureOf(disableAccounts(db, [active]))

    expect(thrown).toBeInstanceOf(LastAdminError)
    expect(await statusOf(active)).toBe(1)
  })

  test("表里本来就没有启用管理员 ⇒ 放行（没什么可保护的，不拦）", async () => {
    const zombie = await account("000060", { createdDaysAgo: 200 })

    await disableAccounts(db, [zombie])

    expect(await statusOf(zombie)).toBe(0)
  })
})

describe("lastSeenAtOf：三个时间列按活跃度优先级回退", () => {
  test("优先 last_active_at，其次 last_login_at，最后 created_at", () => {
    const withoutActivity = { lastActiveAt: null, lastLoginAt: null, createdAt: 100 }

    expect(lastSeenAtOf({ ...withoutActivity, lastActiveAt: 300 })).toBe(300)
    expect(lastSeenAtOf({ ...withoutActivity, lastLoginAt: 200 })).toBe(200)
    expect(lastSeenAtOf(withoutActivity)).toBe(100)
    // 三者都有时以最准的 last_active_at 为准
    expect(lastSeenAtOf({ lastActiveAt: 300, lastLoginAt: 200, createdAt: 100 })).toBe(300)
  })
})
