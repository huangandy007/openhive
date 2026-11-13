import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 变更历史, 记变更 } from "../../src/server/openhive/case-fact-change"
import { 事实详情 } from "../../src/server/openhive/case-fact-read"
import { 合并实体, 拆分合并 } from "../../src/server/openhive/case-merge"
import { 户名对齐, 对齐到账户, 对齐代表 } from "../../src/server/openhive/case-party"
import { 建事件, 建关系, 建实体, 建引用, 建材料 } from "./openhive-case-fact-fixture"

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
  // 被并入的实体在快照的**五项上与主体 / 默认值不同**：canonicalValue 与主体不同，
  // aliases / attrs / createdAt / trustState 各有非默认值——拆分断言才有判别力（丢了或错存都会红）。
  // `type` 例外：合并本就要求同类型，它必然与主体同为默认「人」，这一项无从区分。
  // 主体 `-a` 的 attrs / createdAt / trustState 保持默认：`{}` / `1_760_000_000` / `自动抽取`。
  await 建实体(库(), {
    id: `${前缀}-c`,
    projectId: 项目,
    value: `${前缀}丙`,
    aliases: ["丙的别名"],
    attrs: { 来源: "笔录" },
    createdAt: 1_759_999_000,
    trustState: "已确认",
  })
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

  test("合并后参与者表与户名别名跟随，拆分原样恢复", async () => {
    await 建实体(库(), { id: "合2-a", projectId: 项目, value: "合2甲" })
    await 建实体(库(), { id: "合2-b", projectId: 项目, value: "合2乙" })
    await 建事件(库(), {
      id: "ev-合2",
      projectId: 项目,
      participants: ["合2甲", "合2乙"],
      参与者表: [
        { entityId: "合2-a", role: "参与人", ordinal: 0 },
        { entityId: "合2-b", role: "参与人", ordinal: 1 },
      ],
    })
    await 库().execute(sql`
      insert into auth.case_entity_alias (id, project_id, entity_id, kind, value, raw_value, source_kind, created_at)
      values ('al-合2', ${项目}, '合2-b', '户名', '乙的户名', '乙的户名', '人工', 1760000000)
    `)

    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "合2-a",
      mergedId: "合2-b",
      reasonText: "同一人",
      by: 甲,
    })
    expect(结果.movedRelations).toBe(0)

    const 参与者 = rowsOf(
      await 库().execute(sql`
        select entity_id from auth.case_event_participant
         where project_id = ${项目} and event_id = 'ev-合2' order by ordinal asc
      `),
    ).map((行) => String(行.entity_id))
    expect(参与者).toEqual(["合2-a", "合2-a"])

    const 别名 = rowsOf(
      await 库().execute(sql`
        select entity_id from auth.case_entity_alias where project_id = ${项目} and id = 'al-合2'
      `),
    )[0]
    expect(String(别名?.entity_id)).toBe("合2-a")

    const 拆分 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆分.未恢复).toEqual([])
    const 恢复后 = rowsOf(
      await 库().execute(sql`
        select entity_id from auth.case_event_participant
         where project_id = ${项目} and event_id = 'ev-合2' order by ordinal asc
      `),
    ).map((行) => String(行.entity_id))
    expect(恢复后).toEqual(["合2-a", "合2-b"])
    const 别名恢复 = rowsOf(
      await 库().execute(sql`
        select entity_id from auth.case_entity_alias where project_id = ${项目} and id = 'al-合2'
      `),
    )[0]
    expect(String(别名恢复?.entity_id)).toBe("合2-b")
  })

  test("拆分不覆盖被人动过的参与者行：进 未恢复，不静默", async () => {
    await 建实体(库(), { id: "合3-a", projectId: 项目, value: "合3甲" })
    await 建实体(库(), { id: "合3-b", projectId: 项目, value: "合3乙" })
    await 建实体(库(), { id: "合3-c", projectId: 项目, value: "合3丙" })
    await 建事件(库(), {
      id: "ev-合3",
      projectId: 项目,
      participants: ["合3乙"],
      参与者表: [{ entityId: "合3-b", role: "参与人", ordinal: 0 }],
    })
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "合3-a",
      mergedId: "合3-b",
      reasonText: "同一人",
      by: 甲,
    })
    // 合并之后被人改指到第三方：拆分不许覆盖，必须列出来。
    await 库().execute(sql`
      update auth.case_event_participant set entity_id = '合3-c'
       where project_id = ${项目} and event_id = 'ev-合3' and ordinal = 0
    `)
    const 拆分 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆分.未恢复).toContain("参与者:ev-合3#0")
    const 现状 = rowsOf(
      await 库().execute(sql`
        select entity_id from auth.case_event_participant
         where project_id = ${项目} and event_id = 'ev-合3' and ordinal = 0
      `),
    )[0]
    expect(String(现状?.entity_id)).toBe("合3-c")
  })

  // 整体可重入（#007-01）：重放一次合并不能重复写快照、也不能重复改指向。
  // 被并入行已经不在 ⇒ 安全失败 fact_not_found；既有留痕与参与者行维持原样。
  test("重放合并：安全失败，不重复写快照、不重复改指向", async () => {
    await 建实体(库(), { id: "合4-a", projectId: 项目, value: "合4甲" })
    await 建实体(库(), { id: "合4-b", projectId: 项目, value: "合4乙" })
    await 建事件(库(), {
      id: "ev-合4",
      projectId: 项目,
      participants: ["合4乙"],
      参与者表: [{ entityId: "合4-b", role: "参与人", ordinal: 0 }],
    })
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "合4-a",
      mergedId: "合4-b",
      reasonText: "同一人",
      by: 甲,
    })
    await expect(
      合并实体(库(), {
        projectId: 项目,
        survivorId: "合4-a",
        mergedId: "合4-b",
        reasonText: "同一人",
        by: 甲,
      }),
    ).rejects.toMatchObject({ code: "fact_not_found" })

    const 历史 = await 变更历史(库(), 项目, "entity", "合4-a")
    expect(历史.filter((条) => 条.action === "合并").map((条) => 条.id)).toEqual([结果.changeId])
    const 参与者 = rowsOf(
      await 库().execute(sql`
        select entity_id from auth.case_event_participant
         where project_id = ${项目} and event_id = 'ev-合4' order by ordinal asc
      `),
    ).map((行) => String(行.entity_id))
    expect(参与者).toEqual(["合4-a"])
  })

  // I-1：别名改指的**后果**——两个账户挂同值户名时 `户名对齐` 是 fail-closed（候选 2）；
  // 合并两账户后候选变 1、代表指向幸存账户。用例刻意用 `type=账户`（夹具默认是「人」，
  // 而 `户名对齐` 只认 `ae.type='账户'`）；同理 `对齐到账户` 从空集变出那个人。
  test("合并两个同户名账户后，人的户名对齐从 fail-closed 变为唯一对齐", async () => {
    await 建实体(库(), { id: "对齐1-a", projectId: 项目, type: "账户", value: "对齐1甲账户" })
    await 建实体(库(), { id: "对齐1-b", projectId: 项目, type: "账户", value: "对齐1乙账户" })
    await 建实体(库(), { id: "对齐1-人", projectId: 项目, value: "对齐1户名" })
    await 库().execute(sql`
      insert into auth.case_entity_alias (id, project_id, entity_id, kind, value, raw_value, source_kind, created_at)
      values ('al-对齐1-a', ${项目}, '对齐1-a', '户名', '对齐1户名', '对齐1户名', '人工', 1760000000),
             ('al-对齐1-b', ${项目}, '对齐1-b', '户名', '对齐1户名', '对齐1户名', '人工', 1760000000)
    `)

    const 对齐 = async () => {
      const 行 = rowsOf(
        await 库().execute(sql`
          select 代表, 候选数
            from ${户名对齐(项目, sql`'self'`, sql`'人'`, sql`${"对齐1户名"}`)} 对齐
        `),
      )[0]
      return { 代表: 行?.代表 === null || 行?.代表 === undefined ? null : String(行.代表), 候选数: Number(行?.候选数) }
    }
    const 代表 = async () =>
      String(
        rowsOf(
          await 库().execute(sql`
            select ${对齐代表(项目, sql`${"对齐1-人"}`, sql`'人'`, sql`${"对齐1户名"}`)} as 代表
          `),
        )[0]?.代表,
      )
    const 反向 = async () =>
      rowsOf(
        await 库().execute(sql`
          select id from ${对齐到账户(项目, ["对齐1-a"])} 反向 order by id asc
        `),
      ).map((行) => String(行.id))

    // 合并前：两个账户都挂「对齐1户名」⇒ 候选 2，fail-closed（代表 null、退回自己、反向空）。
    expect(await 对齐()).toEqual({ 代表: null, 候选数: 2 })
    expect(await 代表()).toBe("对齐1-人")
    expect(await 反向()).toEqual([])

    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "对齐1-a",
      mergedId: "对齐1-b",
      reasonText: "两个账户是同一个人的户名载体",
      by: 甲,
    })
    expect(结果.movedRelations).toBe(0)

    // 合并后：别名行改指幸存账户 ⇒ 候选 1，代表 = 幸存账户；反向对齐也认出那个人。
    expect(await 对齐()).toEqual({ 代表: "对齐1-a", 候选数: 1 })
    expect(await 代表()).toBe("对齐1-a")
    expect(await 反向()).toEqual(["对齐1-人"])

    // 拆分腿：别名行必须被认成「合并自己改的」，原样指回被并入账户（进 `未恢复` 就是
    // 没改指的证据）；对齐随之回到合并前的 fail-closed。这一腿也钉住别名改指本身——
    // 少了改指，拆分读到 entity_id 仍是被并入者，会把别名行判成「被人动过」。
    const 拆分 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆分.未恢复).toEqual([])
    expect(await 对齐()).toEqual({ 代表: null, 候选数: 2 })
    expect(await 代表()).toBe("对齐1-人")
  })

  // I-2：`未恢复` 的两个 push 分支（`当前 === undefined`）各走一次。合并后把别名行与
  // 参与者行**硬删**（前缀 id 隔离，不碰别的用例的数据），拆分必须：列出来、且不重建。
  test("拆分时被硬删的参与者行与别名行进 未恢复，且不被重建", async () => {
    await 建实体(库(), { id: "删1-a", projectId: 项目, value: "删1甲" })
    await 建实体(库(), { id: "删1-b", projectId: 项目, value: "删1乙" })
    await 建事件(库(), {
      id: "ev-删1",
      projectId: 项目,
      participants: ["删1乙"],
      参与者表: [{ entityId: "删1-b", role: "参与人", ordinal: 0 }],
    })
    await 库().execute(sql`
      insert into auth.case_entity_alias (id, project_id, entity_id, kind, value, raw_value, source_kind, created_at)
      values ('al-删1', ${项目}, '删1-b', '户名', '删1乙的户名', '删1乙的户名', '人工', 1760000000)
    `)
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "删1-a",
      mergedId: "删1-b",
      reasonText: "同一人",
      by: 甲,
    })

    await 库().execute(sql`
      delete from auth.case_event_participant
       where project_id = ${项目} and event_id = 'ev-删1' and ordinal = 0
    `)
    await 库().execute(sql`
      delete from auth.case_entity_alias where project_id = ${项目} and id = 'al-删1'
    `)

    const 拆分 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    // 文案逐字按 brief；先参与者后别名，顺序由拆分侧循环顺序决定。
    expect(拆分.未恢复).toEqual(["参与者:ev-删1#0", "别名:al-删1"])

    const 参与者行数 = rowsOf(
      await 库().execute(sql`
        select count(*)::int as n from auth.case_event_participant
         where project_id = ${项目} and event_id = 'ev-删1' and ordinal = 0
      `),
    )[0]
    expect(Number(参与者行数?.n)).toBe(0)
    const 别名行数 = rowsOf(
      await 库().execute(sql`
        select count(*)::int as n from auth.case_entity_alias
         where project_id = ${项目} and id = 'al-删1'
      `),
    )[0]
    expect(Number(别名行数?.n)).toBe(0)
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

    // 快照完整性：下面五项各有判别力（canonicalValue 与主体不同；aliases / attrs /
    // createdAt / trustState 都是非默认值）——少存或错存都会红。`entityType` 是例外：
    // 合并要求同类型，它必然与主体同值，这条断言只钉「恢复出来是这个类型」。
    const 恢复 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "合1-c" })
    if (恢复?.type !== "entity") throw new Error("形状不对")
    expect(恢复.entityType).toBe("人")
    expect(恢复.canonicalValue).toBe("合1丙")
    expect(恢复.aliases).toEqual(["丙的别名"])
    expect(恢复.attrs).toEqual({ 来源: "笔录" })
    expect(恢复.trustState).toBe("已确认")
    expect(恢复.createdAt).toBe(1_759_999_000)

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

  // 终审修复 A：拆分只退回「本次合并加进去的别名」，不能把主体的别名整份覆盖成合并前快照——
  // 那样会把后一次合并并进来的名字一并抹掉。A 并 B → A 并 C → 拆 A+B：B 的增量该走，
  // C 的规范值与别名必须还在主体上。
  test("A 并 B 再并 C 之后拆 A+B：只退回 B 的增量，C 的规范值与别名仍在主体上", async () => {
    await 场景("叠并")
    const 并B = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "叠并-a",
      mergedId: "叠并-b",
      reasonText: "先把乙并进来",
      by: 甲,
    })
    await 合并实体(库(), {
      projectId: 项目,
      survivorId: "叠并-a",
      mergedId: "叠并-c",
      reasonText: "再把丙并进来",
      by: 甲,
    })

    const 拆 = await 拆分合并(库(), { projectId: 项目, changeId: 并B.changeId, by: 甲 })
    expect(拆.restoredEntityId).toBe("叠并-b")

    const 主体 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "叠并-a" })
    if (主体?.type !== "entity") throw new Error("形状不对")
    // 精确集合，不只 toContain：多留下「叠并乙 / 乙的别名」同样要红。
    expect([...主体.aliases].sort()).toEqual(["曾用名", "丙的别名", "叠并丙"].sort())
    // 反例：C 的名字没被这次拆分误删（事实图里还认得出丙这个人）。
    expect(主体.aliases).toContain("叠并丙")
    expect(主体.aliases).toContain("丙的别名")
    // B 的规范值与别名正是本次合并的增量，应随拆分离去。
    expect(主体.aliases).not.toContain("叠并乙")
    expect(主体.aliases).not.toContain("乙的别名")
  })

  // fail-closed：主体别名在合并之后又被别的操作改过（增量里少了一个名字），
  // 说明口径对不上——拒拆，不静默写回旧快照（那会把那次改动抹掉）。
  test("合并后主体别名被人改过（少了一个增量名）⇒ 409 restore_conflict，别名不被覆盖", async () => {
    await 场景("别改")
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "别改-a",
      mergedId: "别改-b",
      reasonText: "先合",
      by: 甲,
    })
    await 库().execute(sql`
      update auth.case_entity set aliases = array_remove(aliases, '乙的别名')
       where project_id = ${项目} and id = '别改-a'
    `)

    await expect(
      拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 }),
    ).rejects.toMatchObject({ code: "restore_conflict" })

    const 主体 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "别改-a" })
    if (主体?.type !== "entity") throw new Error("形状不对")
    // 没被整份覆盖回合并前的快照：人删掉的那个名字没回来。
    expect(主体.aliases).not.toContain("乙的别名")
    expect(主体.aliases).toContain("别改乙")
    // 也没留半拆状态：被并入的实体没被恢复。
    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "别改-b" })).toBeUndefined()
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

    // 撞名检查在写之前抛；这里断的是「没留半拆状态」，不是对事务回滚的验证。
    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "撞1-b" })).toBeUndefined()
    const 主体 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "撞1-a" })
    if (主体?.type !== "entity") throw new Error("形状不对")
    expect(主体.aliases).toContain("撞1乙")
  })

  // M3：留痕是外部可写的 jsonb，`参与者们` 坏形（不是数组）必须 fail-closed 走
  // `restore_conflict`，而不是 `for...of` 拆字符串后抛 TypeError 以 500 掉出去。
  test("留痕里的 参与者们 不是数组 ⇒ 409 restore_conflict，不留半拆状态", async () => {
    await 建实体(库(), { id: "坏快照-a", projectId: 项目, value: "坏快照甲" })
    await 建实体(库(), { id: "坏快照-b", projectId: 项目, value: "坏快照乙" })
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "坏快照-a",
      mergedId: "坏快照-b",
      reasonText: "先合并",
      by: 甲,
    })
    await 库().execute(sql`
      update auth.case_fact_change
         set before = jsonb_set(before, '{参与者们}', '"不是数组"'::jsonb)
       where project_id = ${项目} and id = ${结果.changeId}
    `)

    await expect(
      拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 }),
    ).rejects.toMatchObject({ code: "restore_conflict" })

    // 校验在写之前抛：被并入的实体没被恢复，没有半拆状态。
    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "坏快照-b" })).toBeUndefined()
    const 主体 = await 事实详情(库(), { projectId: 项目, type: "entity", id: "坏快照-a" })
    if (主体?.type !== "entity") throw new Error("形状不对")
    expect(主体.aliases).toContain("坏快照乙")
  })
})

describe("合并搬引用（缺口 #5）", () => {
  /** 引用行的「事实类型＋事实 id」按 id 排序读回，用来钉「哪些跟着走、哪些不动」。 */
  async function 读引用(前缀: string): Promise<unknown[]> {
    return rowsOf(
      await 库().execute(sql`
        select id, fact_type, fact_id
          from auth.case_citation
         where project_id = ${项目} and id like ${`${前缀}%`}
         order by id asc
      `),
    ).map((行) => [String(行.id), String(行.fact_type), String(行.fact_id)])
  }

  test("合并后被并入的 entity 引用改指主体，拆分按留痕原样恢复；主体自己的引用不动", async () => {
    await 建实体(库(), { id: "引1-a", projectId: 项目, value: "引1甲" })
    await 建实体(库(), { id: "引1-b", projectId: 项目, value: "引1乙" })
    await 建材料(库(), { id: "mat-引1", projectId: 项目, path: "引1/笔录.txt" })
    await 建引用(库(), {
      id: "引1-c0",
      projectId: 项目,
      factType: "entity",
      factId: "引1-a",
      materialId: "mat-引1",
    })
    await 建引用(库(), {
      id: "引1-c1",
      projectId: 项目,
      factType: "entity",
      factId: "引1-b",
      materialId: "mat-引1",
    })
    await 建引用(库(), {
      id: "引1-c2",
      projectId: 项目,
      factType: "entity",
      factId: "引1-b",
      materialId: "mat-引1",
    })
    // 非 entity 类型的引用：fact_id 碰巧等于被并入 id 也不能动（它指向的是别的事实）。
    await 建引用(库(), {
      id: "引1-x",
      projectId: 项目,
      factType: "event",
      factId: "引1-b",
      materialId: "mat-引1",
    })

    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "引1-a",
      mergedId: "引1-b",
      reasonText: "两份笔录是同一个人",
      by: 甲,
    })
    expect(结果.movedCitations).toBe(2)
    expect(await 读引用("引1-")).toEqual([
      ["引1-c0", "entity", "引1-a"],
      ["引1-c1", "entity", "引1-a"],
      ["引1-c2", "entity", "引1-a"],
      ["引1-x", "event", "引1-b"],
    ])

    const 拆 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆.未恢复引用).toEqual([])
    expect(await 读引用("引1-")).toEqual([
      ["引1-c0", "entity", "引1-a"],
      ["引1-c1", "entity", "引1-b"],
      ["引1-c2", "entity", "引1-b"],
      ["引1-x", "event", "引1-b"],
    ])
  })

  test("引用行在合并后被删（材料清理）⇒ 拆分列出「未恢复引用」，不静默", async () => {
    await 建实体(库(), { id: "引2-a", projectId: 项目, value: "引2甲" })
    await 建实体(库(), { id: "引2-b", projectId: 项目, value: "引2乙" })
    await 建材料(库(), { id: "mat-引2", projectId: 项目, path: "引2/笔录.txt" })
    await 建引用(库(), {
      id: "引2-c1",
      projectId: 项目,
      factType: "entity",
      factId: "引2-b",
      materialId: "mat-引2",
    })
    await 建引用(库(), {
      id: "引2-c2",
      projectId: 项目,
      factType: "entity",
      factId: "引2-b",
      materialId: "mat-引2",
    })

    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "引2-a",
      mergedId: "引2-b",
      reasonText: "同一个",
      by: 甲,
    })
    await 库().execute(sql`delete from auth.case_citation where project_id = ${项目} and id = '引2-c2'`)

    const 拆 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆.未恢复引用).toEqual(["引2-c2"])
    expect(await 读引用("引2-")).toEqual([["引2-c1", "entity", "引2-b"]])
  })

  test("旧留痕没有「引用们」⇒ 仍可拆，引用留在主体上（向后兼容，不报 restore_conflict）", async () => {
    await 建实体(库(), { id: "引3-a", projectId: 项目, value: "引3甲" })
    await 建实体(库(), { id: "引3-b", projectId: 项目, value: "引3乙" })
    await 建材料(库(), { id: "mat-引3", projectId: 项目, path: "引3/笔录.txt" })
    await 建引用(库(), {
      id: "引3-c1",
      projectId: 项目,
      factType: "entity",
      factId: "引3-b",
      materialId: "mat-引3",
    })

    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "引3-a",
      mergedId: "引3-b",
      reasonText: "同一个",
      by: 甲,
    })
    // 模拟修复前的合并留痕：before 里没有「引用们」。
    await 库().execute(sql`
      update auth.case_fact_change
         set before = before - '引用们'
       where project_id = ${项目} and id = ${结果.changeId}
    `)

    const 拆 = await 拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 })
    expect(拆.未恢复引用).toEqual([])
    expect(await 读引用("引3-")).toEqual([["引3-c1", "entity", "引3-a"]])
  })

  test("留痕里的「引用们」不是数组 ⇒ 409 restore_conflict，不留半拆状态", async () => {
    await 建实体(库(), { id: "引4-a", projectId: 项目, value: "引4甲" })
    await 建实体(库(), { id: "引4-b", projectId: 项目, value: "引4乙" })
    const 结果 = await 合并实体(库(), {
      projectId: 项目,
      survivorId: "引4-a",
      mergedId: "引4-b",
      reasonText: "先合并",
      by: 甲,
    })
    await 库().execute(sql`
      update auth.case_fact_change
         set before = jsonb_set(before, '{引用们}', '"不是数组"'::jsonb)
       where project_id = ${项目} and id = ${结果.changeId}
    `)

    await expect(
      拆分合并(库(), { projectId: 项目, changeId: 结果.changeId, by: 甲 }),
    ).rejects.toMatchObject({ code: "restore_conflict" })
    expect(await 事实详情(库(), { projectId: 项目, type: "entity", id: "引4-b" })).toBeUndefined()
  })
})
