/**
 * 003 T017 · 「最后活跃时间」的写入方。
 *
 * **挡在中间的是什么**：`auth.user.last_active_at` 从 002 建表起就是个**只读列**——全仓库
 * 没有任何地方写它。而 design-v2 §4.3 的僵尸账户识别（「超过 90 天未活跃」）要读它，
 * 于是 002 只好退到 `coalesce(last_active_at, last_login_at, created_at)` 三级回退
 * （`zombie.ts`），拿一个永远为 NULL 的列当第一优先级。本组测的就是把那一列填起来的函数。
 *
 * ⚠️ **本组测的是领域函数，不是接线**。「网关有没有每个请求调它」「节流窗口有没有从配置传进来」
 * 由 `packages/opencode/test/server/openhive-activity.test.ts` 那一组守——两边分工，
 * 别把「写对没写对」和「有没有被调用」混在一组里。
 *
 * 用**真库**（PGlite 经 TCP，002 的夹具）：本函数只发一条 UPDATE，但它带一个**跨驱动形状**
 * 的风险点（返回值 / 结果集在 PGlite 与 bun-sql 上形状不同，`LEARNINGS #002-01`），
 * 替身会让被测对象消失。
 */

import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { touchActivity } from "./activity"
import type { connect } from "./db"
import { migrate } from "./migrate"
import { registerUser, type RegisterInput } from "./register"
import { DEPLOYED_DEFAULT_PASSWORD, withProductionDb } from "./test-support"

const PW = DEPLOYED_DEFAULT_PASSWORD
import { user } from "./user"

/** 节流窗口取个小整数：用例里要把时间摆到窗口两侧，取值越大越难读。 */
const THROTTLE = 60

const POLICE_NO = "000001"
/** 第二个警号：用来问「改的是这一个人，还是所有人的行都被顺带刷了一遍」。 */
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

const rowOf = async (db: Db, id: string) => {
  const [row] = await db.select().from(user).where(eq(user.id, id))
  return row!
}

/**
 * 把库里的值摆到指定的过去某一刻。
 *
 * **直接改库而不是等时间流逝**：本函数判的是「距今够不够久」，而时间是从外面传进去的
 * （`now`），所以被测的两端都能摆到确定的位置上，用例里没有任何 sleep。
 */
const setLastActive = (db: Db, id: string, at: number | null) =>
  db.update(user).set({ lastActiveAt: at }).where(eq(user.id, id))

describe("最后活跃时间的写入方", () => {
  test("从没记过（NULL）⇒ 写上这一刻", async () => {
    // NULL 是最要紧的一支：这一列从建表起就一直是 NULL，所有存量账号都走这条。
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO), PW)

      await touchActivity(db, seeded.id, { now: 1000, throttleSeconds: THROTTLE })

      expect((await rowOf(db, seeded.id)).lastActiveAt).toBe(1000)
    })
  })

  test("窗口内（刚记过）⇒ 不写，值原地不动", async () => {
    // 这一条是节流本身：前端是轮询的（`/session`、事件流），不节流的话这条 UPDATE
    // 会成为全系统最高频的写。
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO), PW)
      await setLastActive(db, seeded.id, 1000)

      await touchActivity(db, seeded.id, { now: 1000 + THROTTLE - 1, throttleSeconds: THROTTLE })

      expect((await rowOf(db, seeded.id)).lastActiveAt).toBe(1000)
    })
  })

  test("窗口外 ⇒ 写上新的一刻", async () => {
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO), PW)
      await setLastActive(db, seeded.id, 1000)

      const now = 1000 + THROTTLE + 1
      await touchActivity(db, seeded.id, { now, throttleSeconds: THROTTLE })

      expect((await rowOf(db, seeded.id)).lastActiveAt).toBe(now)
    })
  })

  test("距今正好一个窗口 ⇒ 写（判据是「≥ 窗口」，不是「> 窗口」）", async () => {
    // 边界单独立一条：`<=` 写成 `<` 时，整组用例里只有这一个时刻会红。差一个刻度在
    // 60 秒的窗口上无所谓，但「判据到底是哪个」得是被钉住的，不是碰巧对的。
    await withProductionDb(async (db) => {
      await migrate(db)
      const seeded = await registerUser(db, input(POLICE_NO), PW)
      await setLastActive(db, seeded.id, 1000)

      const now = 1000 + THROTTLE
      await touchActivity(db, seeded.id, { now, throttleSeconds: THROTTLE })

      expect((await rowOf(db, seeded.id)).lastActiveAt).toBe(now)
    })
  })

  test("只碰自己那一行", async () => {
    // 爆炸半径。这条函数跑在每个已认证请求上，写错范围就是「一个人上线，全表被刷」——
    // 只断言目标行的话，一个 `where` 写漏的实现也会绿。
    await withProductionDb(async (db) => {
      await migrate(db)
      const bystander = await registerUser(db, input(OTHER_POLICE_NO), PW)
      const seeded = await registerUser(db, input(POLICE_NO), PW)
      await setLastActive(db, bystander.id, 500)

      await touchActivity(db, seeded.id, { now: 1000, throttleSeconds: THROTTLE })

      expect((await rowOf(db, bystander.id)).lastActiveAt).toBe(500)
    })
  })

  test("账号不存在（凭证还没过期的那段窗口）⇒ 安静返回，不报错", async () => {
    // 凭证有 2 小时 TTL，账号可能在它到期前被删掉。这种请求不该在「记活动」这一步炸——
    // 它连一行都匹配不到，最自然的结局就是什么都没发生。
    await withProductionDb(async (db) => {
      await migrate(db)

      // 显式接住两种结局再断言接到哪一种：单写一个 `await` 的话，这条用例的判据
      // 是「没有异常逃出去」——那是**看不见**的断言，读的人无从判断它到底测了什么。
      const outcome = await touchActivity(db, crypto.randomUUID(), {
        now: 1000,
        throttleSeconds: THROTTLE,
      }).then(
        () => "安静返回",
        () => "抛了",
      )

      expect(outcome).toBe("安静返回")
    })
  })
})
