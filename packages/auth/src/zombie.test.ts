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
