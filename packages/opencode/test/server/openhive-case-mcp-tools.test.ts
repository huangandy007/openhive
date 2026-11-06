import { afterAll, beforeAll, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import {
  get_citation,
  query_entities,
  query_events,
  query_relations,
  search_materials,
  归一化限制,
  校验成员,
  type 工具上下文,
  type 工具结果,
} from "../../src/server/openhive/case-mcp-tools"
import { addCitation, createMaterial, insertFactRows } from "../../src/server/openhive/case-store"
import { insertEvent, insertRelation, setMaterialText, upsertEntity } from "../../src/server/openhive/case-fact-store"
import { 建实体 } from "./openhive-case-fact-fixture"

/**
 * MCP 工具层的取数（材料 / 实体）。
 *
 * ## 夹具为什么自己 `connect()`
 *
 * `校验成员` 与两个工具都只发**带参**查询；PGlite 把多条连接汇进同一个 PG 会话，
 * `bun-sql` 的语句缓存却是连接级的 ⇒ 用夹具自带的 `pg.db` 从第二条用例起会撞
 * `42P05 prepared statement … already exists`（`openhive-case-merge.test.ts` 实测）。
 * 所以照那边的做法：`startProductionDb()` 只负责起库，自己用生产入口
 * `connect({ ...process.env, PG_POOL_MAX: "1" })` 建**一个**客户端跑完全部用例。
 */
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 客户端: ReturnType<typeof connect> | undefined
const 库 = () => {
  if (!客户端) throw new Error("数据库夹具还没起来——beforeAll 没跑完")
  return 客户端
}

const 身份甲 = { userId: "u-工具-甲", projectId: "p-工具-甲" }
/** 别名检索、截断断言各自用一个**独立项目**：同一项目里种数据会按用例声明顺序影响别的用例（`#005-34`）。 */
const 身份丙 = { userId: "u-工具-甲", projectId: "p-工具-丙" }
const 身份截 = { userId: "u-工具-甲", projectId: "p-工具-截" }
/**
 * 任务 3 的种子全部落在这个**独立项目**里：同一个项目里再种实体，会改掉
 * 「query_entities 默认不返回已排除」那条既有用例的期望值（`#005-34`：不靠声明顺序躲）。
 */
const 身份丁 = { userId: "u-工具-甲", projectId: "p-工具-丁" }
const 项目乙 = "p-工具-乙"

const ctx = (身份: typeof 身份甲): 工具上下文 => ({ db: 库(), 身份 })
const ids = (结果: 工具结果) => (结果.数据 as { id: string }[]).map((行) => 行.id)
/** 任务 3 的用例用这个别名；与 `ids` 是同一种取法。 */
const ids计 = ids

/** 「转账」落在 40 字半径之外：正文够长，「片段」才真的被截过，而不是原文照抄。 */
const 转账正文 = `${"前言".repeat(40)}本笔资金于当日完成转账操作${"后续".repeat(40)}`

beforeAll(async () => {
  pg = await startProductionDb()
  客户端 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(客户端)

  // `project_member.user_id` 有指向 `auth.user(id)` 的外键，先有用户行才加得进成员表。
  await 客户端.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${身份甲.userId}, '970042', '工具民警甲', 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
  `)
  await 客户端.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${身份甲.projectId}, ${身份甲.userId}, 'member', 0)
  `)

  // 甲项目两份、乙项目一份。甲、乙各一份文件名都含「张三」，项目隔离才有判别力。
  await createMaterial(库(), {
    id: "m-甲",
    projectId: 身份甲.projectId,
    fileName: "张三笔录.txt",
    kind: "笔录",
    fingerprint: "fp-工具-甲",
    path: "张三笔录.txt",
  })
  await createMaterial(库(), {
    id: "m-正文",
    projectId: 身份甲.projectId,
    fileName: "资金流水.txt",
    kind: "资金",
    fingerprint: "fp-工具-正文",
    path: "资金流水.txt",
  })
  await setMaterialText(库(), 身份甲.projectId, "m-正文", 转账正文)
  await createMaterial(库(), {
    id: "m-乙",
    projectId: 项目乙,
    fileName: "张三话单.txt",
    kind: "话单",
    fingerprint: "fp-工具-乙",
    path: "张三话单.txt",
  })
  // 乙项目正文也含「转账」：正文检索同样必须被项目边界挡住。
  await setMaterialText(库(), 项目乙, "m-乙", "乙项目里的转账记录")

  await upsertEntity(库(), {
    projectId: 身份甲.projectId,
    id: "e-好",
    type: "人",
    canonicalValue: "王五",
    aliases: [],
  })
  // 「已排除」不在 `upsertEntity` 的入参里，用计划 5 的共享夹具写；它的 SQL 文本与 DAO
  // 不同，不会在 PGlite 的语句缓存上撞 42P05。
  await 建实体(库(), { id: "e-排", projectId: 身份甲.projectId, value: "李四", trustState: "已排除" })

  // —— 任务 3 的种子：关系 / 事件 / 出处（全部走生产出口，落在独立项目 丁）——
  await createMaterial(库(), {
    id: "m-甲",
    projectId: 身份丁.projectId,
    fileName: "甲笔录.txt",
    kind: "笔录",
    fingerprint: "fp-工具-丁",
    path: "甲笔录.txt",
  })
  for (const [id, value] of [["e-甲", "甲"], ["e-乙", "乙"], ["e-丙", "丙"], ["e-参与", "参与人"]] as const) {
    await upsertEntity(库(), { id, projectId: 身份丁.projectId, type: "人", canonicalValue: value, aliases: [] })
  }
  // 关系：r-1/r-2 覆盖「两头都算」，r-排 覆盖默认过滤，r-跨 覆盖时间窗交集。
  await insertRelation(库(), {
    id: "r-1",
    projectId: 身份丁.projectId,
    fromId: "e-甲",
    toId: "e-乙",
    type: "转账",
    amount: 1000,
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-2",
    projectId: 身份丁.projectId,
    fromId: "e-丙",
    toId: "e-甲",
    type: "通话",
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-排",
    projectId: 身份丁.projectId,
    fromId: "e-甲",
    toId: "e-乙",
    type: "转账",
    amount: 1000,
    sourceKind: "data",
    trustState: "已排除",
  })
  await insertRelation(库(), {
    id: "r-跨",
    projectId: 身份丁.projectId,
    fromId: "e-甲",
    toId: "e-乙",
    type: "转账",
    amount: 1000,
    sourceKind: "data",
    trustState: "自动抽取",
    firstAt: 100,
    lastAt: 300,
  })
  // 事件：ev-1 含 e-参与，ev-2 不含。
  await insertEvent(库(), {
    id: "ev-1",
    projectId: 身份丁.projectId,
    type: "签约",
    occurredAt: 1_760_000_000,
    occurredRaw: "2026年3月5日 14时",
    precision: "到分",
    participants: ["e-参与"],
    summary: "签约",
    trustState: "自动抽取",
  })
  await insertEvent(库(), {
    id: "ev-2",
    projectId: 身份丁.projectId,
    type: "交款",
    occurredAt: 1_760_000_000,
    occurredRaw: "2026年3月6日",
    precision: "到日",
    participants: [],
    summary: "交款",
    trustState: "自动抽取",
  })
  // 出处：e-甲 的引用落在 m-甲；明细行 m-甲#Sheet1#2 供 get_citation 的 row 分支用。
  await addCitation(库(), {
    id: "c-甲-1",
    projectId: 身份丁.projectId,
    factType: "entity",
    factId: "e-甲",
    materialId: "m-甲",
    locator: { page: 3, para: 2 },
    extractMethod: "机器",
  })
  await insertFactRows(库(), [
    {
      projectId: 身份丁.projectId,
      materialId: "m-甲",
      sheet: "Sheet1",
      rowNo: 2,
      counterparty: "甲",
      amount: "50.00",
      balance: "900.00",
    },
  ])
})

afterAll(async () => {
  await 客户端?.$client.close()
  await pg?.stop()
})

test("不是项目成员 ⇒ not_a_member，查不到任何数据", async () => {
  await expect(校验成员(ctx({ userId: "u-外人", projectId: 身份甲.projectId }))).rejects.toMatchObject({
    code: "not_a_member",
  })
})

test("search_materials 只返回本项目", async () => {
  // 甲项目一份、乙项目一份，文件名都含「张三」
  const 结果 = await search_materials(ctx(身份甲), { 关键词: "张三" })
  expect(ids(结果)).toEqual(["m-甲"])
  expect(结果.口径).toContain("文件名与正文")
})

test("search_materials 正文命中返回片段而非全文", async () => {
  const 结果 = await search_materials(ctx(身份甲), { 关键词: "转账" })
  const 行 = (结果.数据 as { 片段: string | null }[])[0]!
  expect(行.片段).toContain("转账")
  expect(行.片段!.length).toBeLessThan(120)
})

test("query_entities 默认不返回「已排除」", async () => {
  const 结果 = await query_entities(ctx(身份甲), {})
  expect(ids(结果)).toEqual(["e-好"])
  expect(结果.口径).toContain("默认不含")
})

test("query_entities 含已排除=true 时带出来", async () => {
  expect(ids(await query_entities(ctx(身份甲), { 含已排除: true }))).toContain("e-排")
})

test("query_entities 关键词命中别名，且 aliases 读回来是数组", async () => {
  // 独立项目：不污染「默认不返回已排除」那条（同一项目里后种的数据不该靠声明顺序躲开）。
  await upsertEntity(库(), {
    id: "e-别",
    projectId: "p-工具-丙",
    type: "人",
    canonicalValue: "张叁本名",
    aliases: ["张叁"],
  })
  const 行 = (await query_entities(ctx(身份丙), { 关键词: "张叁" })).数据 as Record<string, unknown>[]
  expect(行.map((条) => 条.id)).toEqual(["e-别"])
  // 形状断言：仓内没有「数组列读回形状」的先例可依，查询与解析必须成对
  // （`array_to_json(...)::text` ＋ `解JSON`）。少了这一条，把 SQL 与 JS 任一侧单改回去都不红。
  expect(Array.isArray(行[0]!.aliases)).toBe(true)
  expect(行[0]!.aliases).toContain("张叁")
  expect(行[0]!.attrs).toEqual({})
})

test("限制非整数 / 0 / 负数 ⇒ bad_input", async () => {
  for (const 限制 of [0, -1, 1.5, Number.NaN]) {
    await expect(query_entities(ctx(身份甲), { 限制 })).rejects.toMatchObject({ code: "bad_input" })
  }
})

test("超上限截到 200 并在缺口里说清", async () => {
  // 先钉「真的截到 200」——缺口文案里也有 200，只断言文案的话，删掉 `Math.min` 照样绿。
  expect(归一化限制(999)).toBe(200)
  const 结果 = await query_entities(ctx(身份甲), { 限制: 999 })
  expect(结果.缺口?.join()).toContain("200")
})

test("实得行数等于限制时缺口说「可能还有更多」", async () => {
  await upsertEntity(库(), { id: "e-截1", projectId: "p-工具-截", type: "人", canonicalValue: "截甲", aliases: [] })
  await upsertEntity(库(), { id: "e-截2", projectId: "p-工具-截", type: "人", canonicalValue: "截乙", aliases: [] })
  const 结果 = await query_entities(ctx(身份截), { 限制: 2 })
  expect(结果.缺口?.some((句) => 句.includes("已截到前 2 条"))).toBe(true)
})

// —— 任务 3：关系 / 事件 / 出处 ——

test("query_relations 按实体名（规范值）查两头都算", async () => {
  // e-甲 --转账--> e-乙 ；e-丙 --通话--> e-甲
  // 种子表里 r-跨 也是甲→乙 的转账（非「已排除」），不带时间窗时同样命中——断言据实列出。
  const 结果 = await query_relations(ctx(身份丁), { 实体: "甲" })
  expect(ids计(结果).sort()).toEqual(["r-1", "r-2", "r-跨"].sort())
  expect(结果.口径).toContain("numeric")
})

test("query_relations 默认不返回「已排除」，含已排除=true 才返回", async () => {
  expect(ids计(await query_relations(ctx(身份丁), { 实体: "甲" }))).not.toContain("r-排")
  expect(ids计(await query_relations(ctx(身份丁), { 实体: "甲", 含已排除: true }))).toContain("r-排")
})

test("query_relations 时间窗按「有交集」判，不是按首末时间都在窗内", async () => {
  // r-跨: first_at=100, last_at=300；窗口 [200, 400] ⇒ 应命中
  expect(ids计(await query_relations(ctx(身份丁), { 实体: "甲", 起: 200, 止: 400 }))).toContain("r-跨")
})

test("query_relations 给不存在的实体 ⇒ not_found", async () => {
  await expect(query_relations(ctx(身份丁), { 实体: "查无此人" })).rejects.toMatchObject({ code: "not_found" })
})

test("时间窗起 > 止 ⇒ bad_input", async () => {
  await expect(query_events(ctx(身份丁), { 起: 500, 止: 100 })).rejects.toMatchObject({ code: "bad_input" })
})

test("query_events 按参与实体过滤（文本数组包含）", async () => {
  // e-参与 出现在 ev-1.participants，不在 ev-2
  expect(ids计(await query_events(ctx(身份丁), { 参与实体: "e-参与" }))).toEqual(["ev-1"])
})

test("query_events 返回原始值、规范值、精度三件套", async () => {
  const 行 = (await query_events(ctx(身份丁), { 参与实体: "e-参与" })).数据 as Record<string, unknown>[]
  // `time_type` 断言 null 不是偷懒：`insertEvent` 的入参里没有这个字段（`case-ingest.ts` 也不写），
  // 生产库该列今天恒为 NULL。工具仍要把列**带出来**——键名在、值如实为 null，用例才钉得住「没被吞掉」。
  expect(行[0]).toMatchObject({ occurred_raw: "2026年3月5日 14时", precision: "到分", time_type: null })
})

test("get_citation 对实体返回事实 + 引用", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "entity", 事实id: "e-甲" })
  expect(结果.数据).toMatchObject({ 事实: { type: "entity" }, 引用: [{ material_id: "m-甲" }] })
})

test("get_citation 对明细行按 material#sheet#row 解析", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#2" })
  expect((结果.数据 as { 明细行: { row_no: number } }).明细行.row_no).toBe(2)
})

test("get_citation 事实id 形状不对 ⇒ bad_input", async () => {
  await expect(get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "没有井号" })).rejects.toMatchObject({
    code: "bad_input",
  })
})
