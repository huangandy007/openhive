import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { addCitation, createMaterial, getMaterial } from "../../src/server/openhive/case-store"
import {
  deleteCitationsOfMaterial,
  insertEvent,
  insertRelation,
  setMaterialText,
  upsertEntity,
  删除本材料的事实,
} from "../../src/server/openhive/case-fact-store"

/** 起夹具的形状与理由逐字照 `openhive-case-store.test.ts`：只用 `pg.db`，不要再 `connect()`。 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  await pg?.stop()
})
function db() {
  if (!pg) throw new Error("真库没起来")
  return pg.db
}
const 项目 = "prj-fact"
const 材料 = "mat-fact"

beforeAll(async () => {
  await createMaterial(db(), {
    id: 材料,
    projectId: 项目,
    fileName: "笔录.txt",
    kind: "笔录",
    fingerprint: "fp-fact",
    path: "笔录.txt",
  })
})

describe("实体 upsert", () => {
  test("同 (项目, 类型, 规范值) 只留一行，别名合并，返回库里的 id", async () => {
    const a = await upsertEntity(db(), {
      projectId: 项目,
      id: "e-手工-1",
      type: "人",
      canonicalValue: "张三",
      aliases: ["张叁"],
    })
    const b = await upsertEntity(db(), {
      projectId: 项目,
      id: "e-手工-2",
      type: "人",
      canonicalValue: "张三",
      aliases: ["三哥"],
    })
    expect(b).toBe(a)
    // `aliases::text` 是 PG 的数组字面量（`{张叁,三哥}`）：字符串断言不依赖驱动怎么解析 text[]。
    const 行 = rowsOf(await db().execute(sql`
      select id, aliases::text as aliases from auth.case_entity
       where project_id = ${项目} and canonical_value = '张三'
    `))
    expect(行.length).toBe(1)
    expect(行[0]?.id).toBe(a)
    const 别名 = String(行[0]?.aliases)
    expect(别名).toContain("张叁")
    expect(别名).toContain("三哥")
    expect(别名.split(",").length).toBe(2)
  })
})

describe("删引用与删机器事实", () => {
  test("只删被本材料引用的机器事实；人工确认的留下；实体从不删", async () => {
    const 实体 = await upsertEntity(db(), {
      projectId: 项目,
      id: "e-人工", type: "人", canonicalValue: "李四", aliases: [],
    })
    await insertRelation(db(), {
      projectId: 项目, id: "r-机器", fromId: 实体, toId: 实体, type: "同案",
      basis: "供述指认", sourceKind: "human", trustState: "自动抽取",
    })
    await insertRelation(db(), {
      projectId: 项目, id: "r-人工", fromId: 实体, toId: 实体, type: "同案",
      basis: "供述指认", sourceKind: "human", trustState: "已确认",
    })
    await insertEvent(db(), {
      projectId: 项目, id: "ev-机器", type: "通话", occurredAt: null, occurredRaw: null,
      precision: null, participants: [实体], summary: null, trustState: "自动抽取",
    })
    for (const [factType, factId] of [["relation", "r-机器"], ["relation", "r-人工"], ["event", "ev-机器"]] as const) {
      await addCitation(db(), {
        id: `c-${factId}`, projectId: 项目, factType, factId, materialId: 材料,
        locator: { start: 0, end: 10 }, extractMethod: "机器",
      })
    }

    await 删除本材料的事实(db(), 项目, 材料)
    await deleteCitationsOfMaterial(db(), 项目, 材料)

    const 关系 = rowsOf(await db().execute(sql`select id from auth.case_relation where project_id = ${项目} order by id`))
    expect(关系.map((r) => r.id)).toEqual(["r-人工"])
    const 事件 = rowsOf(await db().execute(sql`select id from auth.case_event where project_id = ${项目}`))
    expect(事件.length).toBe(0)
    const 引用 = rowsOf(await db().execute(sql`select id from auth.case_citation where project_id = ${项目}`))
    expect(引用.length).toBe(0)
    const 实体行 = rowsOf(await db().execute(sql`select id from auth.case_entity where project_id = ${项目}`))
    expect(实体行.length).toBe(2)
  })
})

describe("text_content", () => {
  test("写进材料行，别的字段不动", async () => {
    await setMaterialText(db(), 项目, 材料, "第一段\n第二段")
    expect((await getMaterial(db(), 项目, 材料))?.parseStatus).toBe("未入队")
    const 行 = rowsOf(await db().execute(sql`
      select text_content from auth.case_material where project_id = ${项目} and id = ${材料}
    `))
    expect(行[0]?.text_content).toBe("第一段\n第二段")
  })
})

describe("跨项目隔离", () => {
  test("清理只删本项目：另一项目里同 id 的材料/事实/引用一条都不动", async () => {
    // 故意让乙项目用**同名**的材料 id 与事实 id：主键是 `(project_id, id)`，同名是合法的，
    // 这样「漏写 project_id 条件」才会真的删到别人头上——否则这条用例连变异都红不了。
    const 乙 = "prj-fact-乙"
    await createMaterial(db(), {
      id: 材料,
      projectId: 乙,
      fileName: "乙笔录.txt",
      kind: "笔录",
      fingerprint: "fp-乙",
      path: "乙笔录.txt",
    })
    const 实体乙 = await upsertEntity(db(), {
      projectId: 乙,
      id: "e-乙",
      type: "人",
      canonicalValue: "王五",
      aliases: [],
    })
    await insertRelation(db(), {
      projectId: 乙,
      id: "r-同案甲",
      fromId: 实体乙,
      toId: 实体乙,
      type: "同案",
      basis: "供述指认",
      sourceKind: "human",
      trustState: "自动抽取",
    })
    await addCitation(db(), {
      id: "c-乙",
      projectId: 乙,
      factType: "relation",
      factId: "r-同案甲",
      materialId: 材料,
      locator: { start: 0, end: 5 },
      extractMethod: "机器",
    })
    // 本项目侧另有一条引用指着**同名事实 id**（本项目里并不存在 r-同案甲）：
    // `删除本材料的事实` 的关系 DELETE 是经引用 join 过去的；没有这条引用，
    // 拆掉 `r.project_id = c.project_id` 也匹配不到乙项目的行，M4 会假绿。
    await addCitation(db(), {
      id: "c-甲-指空",
      projectId: 项目,
      factType: "relation",
      factId: "r-同案甲",
      materialId: 材料,
      locator: { start: 0, end: 5 },
      extractMethod: "机器",
    })

    await 删除本材料的事实(db(), 项目, 材料)
    await deleteCitationsOfMaterial(db(), 项目, 材料)

    const 关系 = rowsOf(await db().execute(sql`select id from auth.case_relation where project_id = ${乙}`))
    expect(关系.map((r) => r.id)).toEqual(["r-同案甲"])
    const 引用 = rowsOf(await db().execute(sql`select id from auth.case_citation where project_id = ${乙}`))
    expect(引用.map((r) => r.id)).toEqual(["c-乙"])
    const 实体行 = rowsOf(await db().execute(sql`select id from auth.case_entity where project_id = ${乙}`))
    expect(实体行.length).toBe(1)
  })
})
