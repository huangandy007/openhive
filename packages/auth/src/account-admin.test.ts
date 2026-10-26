import { describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "./migrate"
import { accountById, listAccounts } from "./account-admin"
import { findZombieAccounts } from "./zombie"

/**
 * 010 T005 · 账号管理的读取面（FR-004）。
 *
 * 判据全部打在**真库**（PGlite）上：搜索、筛选、分页、统计都是 SQL 里的事，
 * 假对象替身测不出 `ilike` / `coalesce` / `limit` 的真实行为。
 *
 * 两条刻意写下的纪律：
 * - **僵尸判定只留一处规则、两份实现**（SQL 与 `lastSeenAtOf`），所以这里有一条
 *   **对账测试**：筛选结果必须与 `findZombieAccounts` 的 id 集合相等（`#002-06`）。
 *   改一边不改另一边会红——而不是靠人记得同时改两处。
 * - **列表项不含证件号 / 手机号 / 密码哈希**：断言的是键集合，不是「值为空」。
 *   多吐一列不报错，但会把 PII 每页 50 行地送到前端（「出口只吐要用的列」）。
 */

const NOW = 2_000_000_000
const DAY = 24 * 60 * 60
const 天前 = (days: number) => NOW - days * DAY

interface 夹具 {
  readonly id: string
  readonly policeNo: string
  readonly name: string
  readonly org: string
  readonly dept: string
  readonly section: string
  readonly status: number
  readonly isAdmin: number
  readonly createdAt: number
  readonly lastLoginAt: number | null
  readonly lastActiveAt: number | null
}

/**
 * 五个人把每一支都覆盖到：
 * - u1：10 天前登录 ⇒ 不是僵尸
 * - u2：200 天前登录 ⇒ 僵尸（回退链第二级）
 * - u3：停用 ⇒ 不进僵尸名单（僵尸只筛启用账号）
 * - u4：从没登录、100 天前建号 ⇒ 僵尸（回退链第三级）
 * - u5：50 天前活跃 ⇒ 不是僵尸（回退链第一级）
 */
const 夹具: readonly 夹具[] = [
  {
    id: "u1",
    policeNo: "000001",
    name: "张三",
    org: "甲单位",
    dept: "经侦支队",
    section: "一大队",
    status: 1,
    isAdmin: 0,
    createdAt: 天前(400),
    lastLoginAt: 天前(10),
    lastActiveAt: null,
  },
  {
    id: "u2",
    policeNo: "000002",
    name: "李四",
    org: "乙单位",
    dept: "刑侦支队",
    section: "二大队",
    status: 1,
    isAdmin: 0,
    createdAt: 天前(500),
    lastLoginAt: 天前(200),
    lastActiveAt: null,
  },
  {
    id: "u3",
    policeNo: "000003",
    name: "王五",
    org: "甲单位",
    dept: "治安支队",
    section: "三大队",
    status: 0,
    isAdmin: 0,
    createdAt: 天前(300),
    lastLoginAt: null,
    lastActiveAt: null,
  },
  {
    id: "u4",
    policeNo: "000004",
    name: "赵六",
    org: "丙单位",
    dept: "经侦支队",
    section: "一大队",
    status: 1,
    isAdmin: 1,
    createdAt: 天前(100),
    lastLoginAt: null,
    lastActiveAt: null,
  },
  {
    id: "u5",
    policeNo: "000005",
    name: "钱七",
    org: "丁单位",
    dept: "法制支队",
    section: "四大队",
    status: 1,
    isAdmin: 0,
    createdAt: 天前(600),
    lastLoginAt: 天前(90),
    lastActiveAt: 天前(50),
  },
]

async function freshDb() {
  const db = drizzle({ client: new PGlite() })
  await migrate(db)

  for (const row of 夹具) {
    await db.execute(sql`
      insert into auth.user (
        id, police_no, name, id_card, phone, org, dept, section,
        status, is_admin, password_hash, created_at, last_login_at, last_active_at
      ) values (
        ${row.id}, ${row.policeNo}, ${row.name}, ${`id-${row.id}`}, ${`phone-${row.id}`},
        ${row.org}, ${row.dept}, ${row.section}, ${row.status}, ${row.isAdmin},
        'hash', ${row.createdAt}, ${row.lastLoginAt}, ${row.lastActiveAt}
      )
    `)
  }

  return db
}

describe("010 T005 · 列账号（搜索 / 筛选 / 分页 / 统计）", () => {
  test("默认按警号升序、全量返回，统计是全局的", async () => {
    const db = await freshDb()

    const result = await listAccounts(db, { now: NOW })

    expect(result.items.map((item) => item.policeNo)).toEqual(["000001", "000002", "000003", "000004", "000005"])
    // 注册总数 = 5（含停用）；启用数 = 4（u3 停用）。
    expect(result.total).toBe(5)
    expect(result.enabled).toBe(4)
    expect(result.matched).toBe(5)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(50)
  })

  test("q 同时命中警号 / 姓名 / 单位 / 部门 / 科室，且大小写与子串都认", async () => {
    const db = await freshDb()

    const byPoliceNo = await listAccounts(db, { q: "00000", now: NOW })
    expect(byPoliceNo.items).toHaveLength(5)

    const byName = await listAccounts(db, { q: "张", now: NOW })
    expect(byName.items.map((item) => item.name)).toEqual(["张三"])

    const byOrg = await listAccounts(db, { q: "甲", now: NOW })
    expect(byOrg.items.map((item) => item.name)).toEqual(["张三", "王五"])

    const byDept = await listAccounts(db, { q: "经侦", now: NOW })
    expect(byDept.items.map((item) => item.name)).toEqual(["张三", "赵六"])

    const bySection = await listAccounts(db, { q: "四大队", now: NOW })
    expect(bySection.items.map((item) => item.name)).toEqual(["钱七"])
  })

  test("英文关键字不区分大小写", async () => {
    const db = await freshDb()
    await db.execute(sql`update auth.user set name = 'Alice' where id = 'u1'`)

    expect((await listAccounts(db, { q: "alice", now: NOW })).items.map((item) => item.id)).toEqual(["u1"])
    expect((await listAccounts(db, { q: "ALICE", now: NOW })).items.map((item) => item.id)).toEqual(["u1"])
  })

  test("q 里的 % 与 _ 当字面量，不是通配符", async () => {
    const db = await freshDb()
    await db.execute(sql`update auth.user set name = '百%分' where id = 'u1'`)

    // 不转义的话 `%` ⇒ `%%%` 命中全库、`_` ⇒ `%_%` 命中所有非空姓名。
    expect((await listAccounts(db, { q: "%", now: NOW })).items.map((item) => item.id)).toEqual(["u1"])
    expect((await listAccounts(db, { q: "_", now: NOW })).items).toEqual([])
  })

  test("status 过滤：停用名单只回停用的那些人", async () => {
    const db = await freshDb()

    const disabled = await listAccounts(db, { status: 0, now: NOW })

    expect(disabled.items.map((item) => item.id)).toEqual(["u3"])
    // 统计仍是全库口径，不随筛选缩水——顶部两张卡说的是「注册总数 / 启用数」。
    expect(disabled.total).toBe(5)
    expect(disabled.enabled).toBe(4)
    expect(disabled.matched).toBe(1)
  })

  test("分页：pageSize 截断、page 翻页，matched 是分页前的命中数", async () => {
    const db = await freshDb()

    const first = await listAccounts(db, { page: 1, pageSize: 2, now: NOW })
    expect(first.items.map((item) => item.id)).toEqual(["u1", "u2"])
    expect(first.matched).toBe(5)

    const last = await listAccounts(db, { page: 3, pageSize: 2, now: NOW })
    expect(last.items.map((item) => item.id)).toEqual(["u5"])
    expect(last.matched).toBe(5)
  })

  test("page / pageSize 越界被夹到合法区间（不留 0 或负数给 SQL）", async () => {
    const db = await freshDb()

    const result = await listAccounts(db, { page: 0, pageSize: 0, now: NOW })

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(1)
    expect(result.items).toHaveLength(1)

    const huge = await listAccounts(db, { pageSize: 5000, now: NOW })
    expect(huge.pageSize).toBe(200)
    expect(huge.items).toHaveLength(5)
  })

  test("列表项只吐表格要的列：没有 password_hash / id_card / phone", async () => {
    const db = await freshDb()

    const [item] = (await listAccounts(db, { now: NOW })).items
    if (!item) throw new Error("列表没有返回行")

    expect(Object.keys(item).sort()).toEqual(
      [
        "createdAt",
        "deactivatedAt",
        "dept",
        "id",
        "isAdmin",
        "lastActiveAt",
        "lastLoginAt",
        "name",
        "org",
        "policeNo",
        "section",
        "status",
      ].sort(),
    )
  })

  test("空库：total / enabled / matched 都是 0，items 是空数组（不是 null）", async () => {
    const db = await freshDb()
    await db.execute(sql`delete from auth.user`)

    const result = await listAccounts(db, { now: NOW })

    expect(result).toEqual({ total: 0, enabled: 0, matched: 0, page: 1, pageSize: 50, items: [] })
  })
})

describe("010 T005 · 僵尸筛选与 findZombieAccounts 对账", () => {
  test("zombieOnly 的 id 集合 === findZombieAccounts 的 id 集合（两份实现必须同真）", async () => {
    const db = await freshDb()

    const listed = await listAccounts(db, { zombieOnly: true, now: NOW })
    const zombies = await findZombieAccounts(db, NOW)

    expect(listed.items.map((item) => item.id).sort()).toEqual(zombies.map((item) => item.id).sort())
    // 具体值也钉住：u2（200 天前登录）与 u4（建号 100 天、从没登录）。
    expect(listed.items.map((item) => item.id)).toEqual(["u2", "u4"])
  })

  test("恰好 90 天不算僵尸，91 天才算（边界与 findZombieAccounts 同口径）", async () => {
    const db = await freshDb()
    await db.execute(sql`delete from auth.user`)
    await db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at, last_login_at)
      values
        ('edge1', '000101', '乙', 'x', 'x', 'x', 'x', 'x', 1, 0, 'h', ${NOW - 400 * DAY}, ${NOW - 90 * DAY}),
        ('edge2', '000102', '丙', 'x', 'x', 'x', 'x', 'x', 1, 0, 'h', ${NOW - 400 * DAY}, ${NOW - 91 * DAY})
    `)

    const listed = await listAccounts(db, { zombieOnly: true, now: NOW })
    const zombies = await findZombieAccounts(db, NOW)

    expect(listed.items.map((item) => item.id)).toEqual(["edge2"])
    expect(zombies.map((item) => item.id)).toEqual(["edge2"])
  })

  test("zombieOnly 与 q 叠加：先按搜索缩，再筛僵尸", async () => {
    const db = await freshDb()

    const result = await listAccounts(db, { q: "经侦", zombieOnly: true, now: NOW })

    expect(result.items.map((item) => item.id)).toEqual(["u4"])
  })
})

describe("010 T005 · 账号详情", () => {
  test("详情带证件号与手机号（管理员要用），但仍不带 password_hash", async () => {
    const db = await freshDb()

    const detail = await accountById(db, "u1")

    expect(detail).toMatchObject({
      id: "u1",
      policeNo: "000001",
      name: "张三",
      idCard: "id-u1",
      phone: "phone-u1",
      org: "甲单位",
      dept: "经侦支队",
      section: "一大队",
      status: 1,
      isAdmin: 0,
    })
    expect(Object.keys(detail ?? {})).not.toContain("passwordHash")
  })

  test("未知 id 回 undefined（不是抛错、也不是空对象）", async () => {
    const db = await freshDb()

    expect(await accountById(db, "nobody")).toBeUndefined()
  })
})
