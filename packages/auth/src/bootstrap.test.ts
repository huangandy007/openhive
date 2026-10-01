/**
 * 003 T019 · 引导首个管理员。
 *
 * **挡在中间的是什么**：002 的 `registerUser` 恒定写 `isAdmin: 0`（提权刻意是另一条独立路径），
 * 而 F10 治理后台的**全部**能力都要求 `is_admin = 1`。于是全新部署上——一个管理员都没有——
 * 没有任何路径能产生第一个管理员：这是「系统第一天就锁死」。本组测的就是那条唯一的例外路径。
 *
 * ⚠️ **本组测的是领域函数，不是启动接线**。「跑不跑」（开关、排在迁移之后）由
 * `packages/opencode/test/server/openhive-bootstrap.test.ts` 那一组守——两边分工，
 * 别把「引导逻辑对不对」和「引导有没有被调用」混在一组里。
 *
 * 用**真库**（PGlite 经 TCP，002 的夹具）：引导要穿过 `connect()` → drizzle → PG 三种形状，
 * 替身会让被测对象消失（`LEARNINGS #002-01`）。
 */

import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { bootstrapAdmin } from "./bootstrap"
import type { connect } from "./db"
import { login } from "./login"
import { migrate } from "./migrate"
import { registerUser, type RegisterInput } from "./register"
import { DEPLOYED_DEFAULT_PASSWORD, withProductionDb } from "./test-support"
import { user } from "./user"

const PW = DEPLOYED_DEFAULT_PASSWORD

/** ≥32 字符，过 002 的密钥地板（`token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const POLICE_NO = "000001"
/** 第二个警号：用来问「指定的是**这一个**，还是随便哪个都能被提权」。 */
const OTHER_POLICE_NO = "000002"

type Db = ReturnType<typeof connect>

const input = (policeNo: string): RegisterInput => ({
  policeNo,
  name: "张三",
  idCard: "110101199001011234",
  phone: "13800000000",
  org: "市局",
  dept: "刑侦支队",
  section: "一大队",
  status: 1,
})

/** 全表。引导是**表级**的判断（「一个管理员都没有」），所以断言也多看全表而不是单行。 */
const allUsers = (db: Db) => db.select().from(user)

describe("引导首个管理员", () => {
  test("警号不存在、且一个管理员都没有 ⇒ 建出账号并置为管理员", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)

      expect(await bootstrapAdmin(db, POLICE_NO, PW)).toBe("created")

      const rows = await allUsers(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.policeNo).toBe(POLICE_NO)
      expect(rows[0]!.isAdmin).toBe(1)
    })
  })

  test("建出来的账号用默认口令就能登进去，且被要求先改密", async () => {
    // 这一条是 D5「首次怎么登录」那条链的落点：引导若建出一个登不进去、或登进去不用改密的
    // 账号，链条就断在这里——而它俩都不会在任何一条「表里有几行」的断言里露出来。
    await withProductionDb(async (db) => {
      await migrate(db)
      await bootstrapAdmin(db, POLICE_NO, PW)

      const result = await login(db, { policeNo: POLICE_NO, password: PW }, SECRET)

      expect(result.subject.isAdmin).toBe(true)
      expect(result.mustChangePw).toBe(true)
    })
  })

  test("警号已存在但没有管理员 ⇒ 只置管理员，不建第二行", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO), PW)

      expect(await bootstrapAdmin(db, POLICE_NO, PW)).toBe("promoted")

      const rows = await allUsers(db)
      // 行数 + id 一起断言：只看行数的话，「删了旧行建了个同名新行」也会绿，
      // 而那条路径会把账号原有的密码、组织归属一并换掉。
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seeded.id)
      expect(rows[0]!.isAdmin).toBe(1)
    })
  })

  test("表里已有管理员 ⇒ 完全无效：不建新账号", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      const first = await registerUser(db, input(POLICE_NO), PW)
      await db.update(user).set({ isAdmin: 1 }).where(eqId(first.id))

      expect(await bootstrapAdmin(db, OTHER_POLICE_NO, PW)).toBe("skipped")

      // 「不是再置一个」——判据是表级的那一句，指定谁都不该多出第二个管理员。
      const rows = await allUsers(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.policeNo).toBe(POLICE_NO)
    })
  })

  test("表里已有管理员 ⇒ 完全无效：已存在的普通账号也不会被提权", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      const first = await registerUser(db, input(POLICE_NO), PW)
      await db.update(user).set({ isAdmin: 1 }).where(eqId(first.id))
      const plain = await registerUser(db, input(OTHER_POLICE_NO), PW)

      expect(await bootstrapAdmin(db, OTHER_POLICE_NO, PW)).toBe("skipped")

      const [row] = await db.select().from(user).where(eqId(plain.id))
      expect(row!.isAdmin).toBe(0)
    })
  })

  test("引导不碰别人的行：只改指定警号那一行", async () => {
    // 「提权」的爆炸半径得钉死。表里没有管理员时，除目标外每一行都必须逐字不变——
    // 只断言目标行的话，一个「顺手把所有行都置成管理员」的实现也会绿。
    await withProductionDb(async (db) => {
      await migrate(db)
      const bystander = await registerUser(db, input(OTHER_POLICE_NO), PW)

      await bootstrapAdmin(db, POLICE_NO, PW)

      const [row] = await db.select().from(user).where(eqId(bystander.id))
      expect(row!.isAdmin).toBe(0)
    })
  })
})

/** `eq(user.id, …)` 的简写——每个断言都手写一遍只会让 `eq` 的导入显得可疑。 */
function eqId(id: string) {
  return eq(user.id, id)
}
