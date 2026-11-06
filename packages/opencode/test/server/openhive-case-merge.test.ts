import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 变更历史, 记变更 } from "../../src/server/openhive/case-fact-change"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 合并实体, 拆分合并 } from "../../src/server/openhive/case-merge"
import { 建关系, 建实体 } from "./openhive-case-fact-fixture"

/**
 * `合并实体` / `拆分合并` 都走 `inTransaction` ⇒ 按 R-预2 把池留 1 条：PGlite 把多条连接
 * 汇进同一个 PG 会话，事务从池里另起一条再准备同一句带参 SQL 会 42P05（`db.ts` 的
 * `PG_POOL_MAX` 注记）。2026-11-06 本任务实测：用夹具自带的 `pg.db` 时，第二个用例起
 * 每条带参语句都红在 `42P05 prepared statement … already exists`。
 *
 * ⚠️ **不能用 `pg.db`**：`startProductionDb()` 给它自己那个客户端传的是固定 env（不含
 * `PG_POOL_MAX`），在 `process.env` 里配不进去（同 `openhive-case-trust.test.ts`）。
 * 所以走生产入口 `connect()` 自建一份。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 项目 = "p-合并"
const 甲 = "u-合并-甲"

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${甲}, '970041', '甲民警', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
})

afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})

async function 场景(前缀: string): Promise<void> {
  await 建实体(库(), { id: `${前缀}-a`, projectId: 项目, value: `${前缀}甲`, aliases: ["曾用名"] })
  await 建实体(库(), { id: `${前缀}-b`, projectId: 项目, value: `${前缀}乙`, aliases: ["乙的别名"] })
  // 被并入的实体必须带非空别名：拆分「快照完整性」断言（aliases）才钉得住，
  // 否则别名快照丢了也看见（`文本数组([])` 变异会假绿）。
  await 建实体(库(), { id: `${前缀}-c`, projectId: 项目, value: `${前缀}丙`, aliases: ["丙的别名"] })
  await 建关系(库(), { id: `${前缀}-r1`, projectId: 项目, fromId: `${前缀}-b`, toId: `${前缀}-c` })
  await 建关系(库(), { id: `${前缀}-r2`, projectId: 项目, fromId: `${前缀}-c`, toId: `${前缀}-b` })
  await 建关系(库(), { id: `${前缀}-r3`, projectId: 项目, fromId: `${前缀}-a`, toId: `${前缀}-b` })
}

describe("合并", () => {
  test("别名并集、关系改指、自环标已排除、被并入行消失", async () => {
    await 场景("合1")
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "合1-a",
      mergedId: "合1-b",
      reasonText: "两份笔录指的是同一个人",
      by: 甲,
    })
    expect(结果.movedRelations).toBe(3)
    expect(结果.selfLoops).toEqual(["合1-r3"])
    expect(结果.aliases.sort()).toEqual(["乙的别名", "曾用名", "合1乙"].sort())

    const 主体 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "合1-a" })
    if (主体?.type !== "entity") throw new Error("形状不对")
    expect(主体.aliases.sort()).toEqual(["乙的别名", "曾用名", "合1乙"].sort())

    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "合1-b" })).toBeUndefined()

    const r1 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "合1-r1" })
    if (r1?.type !== "relation") throw new Error("形状不对")
    expect(r1.fromId).toBe("合1-a")

    // 已排除默认不可见（§9.1 / R10）：这行正是要看它被标成了什么，必须显式要求带上。
    const r3 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "合1-r3", includeExcluded: true })
    if (r3?.type !== "relation") throw new Error("形状不对")
    expect(r3.fromId).toBe("合1-a")
    expect(r3.toId).toBe("合1-a")
    expect(r3.trustState).toBe("已排除")
  })

  test("留痕里存了恢复得回去的快照", async () => {
    const 历史 = await 变更历史(库(), 项目, "entity", "合1-a")
    const 合并条 = 历史.find((条) => 条.action === "合并")
    expect(合并条).toBeDefined()
    const 前 = 合并条?.before as { survivorAliases: string[]; 被并入: { id: string } }
    expect(前.被并入.id).toBe("合1-b")
    expect(前.survivorAliases).toEqual(["曾用名"])
  })

  test("跨类型合并 ⇒ 409 type_mismatch", async () => {
    await 建实体(库(), { id: "跨-人", projectId: 项目, type: "人", value: "跨甲" })
    await 建实体(库(), { id: "跨-号", projectId: 项目, type: "号码", value: "跨乙" })
    await expect(
      合并实体(库(), {
        projectId: 项目,
        survivorId: "跨-人",
        mergedId: "跨-号",
        reasonText: "试试",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "type_mismatch" })
  })

  test("同一个 id ⇒ 409 bad_input", async () => {
    await expect(
      合并实体(库(), {
        projectId: 项目,
        survivorId: "合1-a",
        mergedId: "合1-a",
        reasonText: "自己并自己",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "bad_input" })
  })

  test("缺依据 ⇒ 409 bad_input", async () => {
    await 建实体(库(), { id: "缺据-1", projectId: 项目, value: "缺据甲" })
    await 建实体(库(), { id: "缺据-2", projectId: 项目, value: "缺据乙" })
    await expect(
      合并实体(库(), { projectId: 项目, survivorId: "缺据-1", mergedId: "缺据-2", reasonText: "  ", by: 甲 }),
    ).rejects.toMatchObject({ code: "bad_input" })
  })

  test("被并入的实体不存在 ⇒ 409 fact_not_found", async () => {
    await expect(
      合并实体(库(), {
        projectId: 项目,
        survivorId: "合1-a",
        mergedId: "根本没有",
        reasonText: "试试",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "fact_not_found" })
  })
})

describe("拆分（撤销合并）", () => {
  test("恢复被并入行、别名与关系指向；再拆一次 ⇒ 409 already_split", async () => {
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "合1-a",
      mergedId: "合1-c",
      reasonText: "其实是同一个人",
      by: 甲,
    })

    const 拆 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆.restoredEntityId).toBe("合1-c")

    // 快照完整性：`before.被并入` 少存一样东西（type / canonicalValue / aliases / attrs /
    // createdAt / trustState），这里就必有一行红。只断 id 与 survivorAliases 钉不住快照。
    const 恢复 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "合1-c" })
    if (恢复?.type !== "entity") throw new Error("形状不对")
    expect(恢复.entityType).toBe("人")
    expect(恢复.canonicalValue).toBe("合1丙")
    expect(恢复.aliases).toEqual(["丙的别名"])
    expect(恢复.attrs).toEqual({})
    expect(恢复.trustState).toBe("自动抽取")
    expect(恢复.createdAt).toBe(1_760_000_000)

    const 主体 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "合1-a" })
    if (主体?.type !== "entity") throw new Error("形状不对")
    expect(主体.aliases).not.toContain("合1丙")

    await expect(
      拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 }),
    ).rejects.toMatchObject({ code: "already_split" })
  })

  test("拿一条不是合并的留痕去拆 ⇒ 409 not_a_merge", async () => {
    // 别从历史里「找」一条非合并留痕：合1-a 的历史只有合并与拆分，找不到就会拿到合并条，
    // 用例会以「拆成功了」的样子失败，看起来像实现错。**自己造一条**。
    const 别的留痕 = await 记变更(库(), {
      projectId: 项目,
      factType: "entity",
      factId: "合1-a",
      action: "确认",
      before: { trustState: "自动抽取" },
      after: { trustState: "已确认" },
      actor: { id: 甲, name: "甲民警", policeNo: "970041" },
    })
    await expect(
      拆分合并(库(), { projectId: 项目, changeId: 别的留痕, by: 甲 }),
    ).rejects.toMatchObject({ code: "not_a_merge" })
  })

  test("合并之后又手工改过某条关系：拆分不覆盖它，并把它列进「未恢复」", async () => {
    await 场景("拆2")
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "拆2-a",
      mergedId: "拆2-b",
      reasonText: "同一个人",
      by: 甲,
    })
    // 合并之后人把这条关系排除了（模拟「合并错了，关系也判错了」）
    await 库().execute(sql`
      update auth.case_relation set trust_state = '已排除' where project_id = ${项目} and id = '拆2-r1'
    `)
    const 拆 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆.未恢复).toContain("拆2-r1")
    const r1 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "拆2-r1", includeExcluded: true })
    if (r1?.type !== "relation") throw new Error("形状不对")
    expect(r1.trustState).toBe("已排除")
    expect(r1.fromId).toBe("拆2-a")
  })

  // 裁定 4：合并把 a→b 改成了 a→a 并标「已排除」，这是**合并自己**改的，不是人改的。
  // 按「合并后应有的长相」判，才判得出它没被动过；否则永远恢复不了。
  test("拆分把合并标掉的自环恢复回合并前的端点与状态", async () => {
    await 场景("拆3")
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "拆3-a",
      mergedId: "拆3-b",
      reasonText: "先合再说",
      by: 甲,
    })
    const 拆 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆.未恢复).toEqual([])
    const r3 = await 事实详情(库(), { projectId: 项目, type: "relation", id: "拆3-r3", includeExcluded: true })
    if (r3?.type !== "relation") throw new Error("形状不对")
    expect(r3.fromId).toBe("拆3-a")
    expect(r3.toId).toBe("拆3-b")
    expect(r3.trustState).toBe("自动抽取")
  })

  // 撞名分支确定可达（`case-merge.ts` 的 `撞 !== undefined`）：合并之后又有人新建了一个
  // 同类型、同规范值的实体。此时拆分不能硬插（会撞唯一索引），要回可解释的 409。
  test("被并入者的规范值已被别的实体占用 ⇒ 409 restore_conflict，且不留半拆状态", async () => {
    await 场景("撞1")
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "撞1-a",
      mergedId: "撞1-b",
      reasonText: "先合并",
      by: 甲,
    })
    // 合并把「撞1乙」变成了别名；人在此之后又新建了一个同类型、同规范值的实体。
    await 建实体(库(), { id: "撞1-新", projectId: 项目, value: "撞1乙" })

    await expect(
      拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 }),
    ).rejects.toMatchObject({ code: "restore_conflict" })

    // 事务回滚：被并入的行没有被偷偷插回来，主体也还停在合并后的样子。
    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "撞1-b" })).toBeUndefined()
    const 主体 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "撞1-a" })
    if (主体?.type !== "entity") throw new Error("形状不对")
    expect(主体.aliases).toContain("撞1乙")
  })
})
