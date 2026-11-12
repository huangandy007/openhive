import { afterAll, beforeAll, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  find_crossings,
  get_citation,
  query_entities,
  query_events,
  query_relations,
  search_materials,
  归一化限制,
  校验成员,
  解析实体,
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
/**
 * 任务 4 的种子全部落在这个**独立项目**里：甲、丁 的既有用例做全量等值断言
 * （`query_entities` 默认不返回「已排除」断言 `ids === ["e-好"]`），再种实体就会改掉它们（`#005-34`）。
 */
const 身份戊 = { userId: "u-工具-甲", projectId: "p-工具-戊" }
/**
 * 解析实体的同值多行用例落在这个**独立项目**里：同一项目里再种实体会改掉既有用例的
 * 全量等值断言（`#005-34`）。
 */
const 身份解析 = { userId: "u-工具-甲", projectId: "p-工具-解析" }
/** 同值多行合并 / 同秒排序各用独立项目：避免与既有断言互相影响（`#005-34`）。 */
const 身份合并 = { userId: "u-工具-甲", projectId: "p-工具-合并" }
const 身份同秒 = { userId: "u-工具-甲", projectId: "p-工具-同秒" }
/** 资金聚合 / 交叉的合并 id 用例：各自独立项目。 */
const 身份聚合 = { userId: "u-工具-甲", projectId: "p-工具-聚合" }
const 身份叉 = { userId: "u-工具-甲", projectId: "p-工具-叉" }
const 项目乙 = "p-工具-乙"

/** 资金账户的规范值（brief 里的账户值原样照用）。 */
const 账号 = "6222…8888"
/**
 * 任务 10 的两个新匹配值：必须是**新的**账户 / 户名，不往「账号」已有 4 行和「张三」上再加
 * （`#005-34`：同一项目里改既有行数会改掉别的用例的全量断言）。
 */
const 户名新 = "户名新甲"
const 本方账号 = "6217000011112222"
/** 户名行的对手账号（生产里账号列与户名列并存）——必须不等于 `户名新`，否则旧分支就能命中。 */
const 户名对手账号 = "6217000033334444"

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
  // ⚠️ `participants` 存的是**实体规范值**，不是 id：唯一写口 `case-extract.ts:433` 写的是
  // `项实体.canonicalValue`（`case-ingest.ts:573` 原样落库），而实体 id 是 `事实id(...)` 的
  // sha256 前 32 位，永远不等于规范值。按 id 种会让用例假绿在生产恒空的实现上（`#006-11`）。
  await insertEvent(库(), {
    id: "ev-1",
    projectId: 身份丁.projectId,
    type: "签约",
    occurredAt: 1_760_000_000,
    occurredRaw: "2026年3月5日 14时",
    precision: "到分",
    participants: ["参与人"],
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
      counterpartyName: "甲户名",
      ownerAccount: "622200000001",
      direction: "收",
      amount: "50.00",
      balance: "900.00",
    },
    // 工作表名合法含 `#`（`case-store.ts:423-432`）：按固定段数拆的实现会永远拒掉这一行。
    {
      projectId: 身份丁.projectId,
      materialId: "m-甲",
      sheet: "Sheet#1",
      rowNo: 2,
      counterparty: "乙",
      amount: "10.00",
      balance: "890.00",
    },
  ])
  // 明细行的引用：行级 `fact_id` 是不透明键 `m-甲#Sheet1#2`，供 row 分支按 `fact_type='row'` 查。
  await addCitation(库(), {
    id: "c-行-1",
    projectId: 身份丁.projectId,
    factType: "row",
    factId: "m-甲#Sheet1#2",
    materialId: "m-甲",
    locator: { sheet: "Sheet1", row: 2 },
    extractMethod: "机器",
  })

  // —— 任务 4 的种子：资金聚合 / 交叉（全部走生产出口，落在独立项目 戊）——
  for (const [id, value, type] of [
    ["e-账", 账号, "账户"],
    ["e-对手甲", "对手甲", "人"],
    ["e-张三", "张三", "人"],
    ["e-李四", "李四", "人"],
    ["e-号N", "13800001111", "号码"],
    ["e-号M", "13900002222", "号码"],
  ] as const) {
    await upsertEntity(库(), { id, projectId: 身份戊.projectId, type, canonicalValue: value, aliases: [] })
  }
  // `e-号X` 是**已排除实体**：`upsertEntity` 不写 `trust_state`，用计划 5 的共享夹具种。
  // 两条通往它的关系都正常 ⇒ 只钉「回查实体时也要过滤已排除」这一条判据。
  await 建实体(库(), {
    id: "e-号X",
    projectId: 身份戊.projectId,
    type: "号码",
    value: "号X",
    trustState: "已排除",
  })
  // 规范值相同、类型不同的一对（`case_entity_type` 只收固定枚举，所以用「人」「号码」）：
  // 两侧都按 id 解析 ⇒ 两边 id 不同、value 相同，`甲.id === 乙.id` 挡不住，必须再比 value
  // （复审 Minor 5；不依赖 type 排序，避免 collation 换顺序后用例漂）。
  await upsertEntity(库(), {
    id: "e-同A",
    projectId: 身份戊.projectId,
    type: "人",
    canonicalValue: "同名值",
    aliases: [],
  })
  await upsertEntity(库(), {
    id: "e-同B",
    projectId: 身份戊.projectId,
    type: "号码",
    canonicalValue: "同名值",
    aliases: [],
  })
  // 转账两条（出/入各一）＋ 一条**连着同一账户的同案非转账**关系，证明汇总按 type 过滤。
  // ⚠️ 这条关系的**一端必须是账户 e-账**：brief 原写 e-张三→e-对手甲，那样它根本不在
  // `(from_id = 账户 or to_id = 账户)` 的取数范围内，删掉 `type = '转账'` 汇总也不变 ⇒
  // 变异 1 不可判别。改成 e-账→e-对手甲 后，交叉用例的交集不受影响（张三仍连通号N/号M）。
  await insertRelation(库(), {
    id: "r-出",
    projectId: 身份戊.projectId,
    fromId: "e-账",
    toId: "e-对手甲",
    type: "转账",
    amount: 1000,
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-入",
    projectId: 身份戊.projectId,
    fromId: "e-对手甲",
    toId: "e-账",
    type: "转账",
    amount: 2500.5,
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-同",
    projectId: 身份戊.projectId,
    fromId: "e-账",
    toId: "e-对手甲",
    type: "通话",
    sourceKind: "data",
    trustState: "自动抽取",
  })
  // 交叉：号码N 在两人之间都通（进交集）；号码M 的乙侧关系已排除（不该进交集）。
  await insertRelation(库(), {
    id: "r-甲N",
    projectId: 身份戊.projectId,
    fromId: "e-张三",
    toId: "e-号N",
    type: "通话",
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-乙N",
    projectId: 身份戊.projectId,
    fromId: "e-李四",
    toId: "e-号N",
    type: "通话",
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-甲M",
    projectId: 身份戊.projectId,
    fromId: "e-张三",
    toId: "e-号M",
    type: "通话",
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-乙M",
    projectId: 身份戊.projectId,
    fromId: "e-李四",
    toId: "e-号M",
    type: "通话",
    sourceKind: "data",
    trustState: "已排除",
  })
  // 号X：两条关系都**不是**已排除，已排除的是实体本身 ⇒ 业务上不该进共同关联。
  await insertRelation(库(), {
    id: "r-甲X",
    projectId: 身份戊.projectId,
    fromId: "e-张三",
    toId: "e-号X",
    type: "通话",
    sourceKind: "data",
    trustState: "自动抽取",
  })
  await insertRelation(库(), {
    id: "r-乙X",
    projectId: 身份戊.projectId,
    fromId: "e-李四",
    toId: "e-号X",
    type: "通话",
    sourceKind: "data",
    trustState: "自动抽取",
  })
  // 一笔**转账**到「已排除」实体：只钉 `aggregate_money` 对手方 join 的端点过滤。
  // 账户取张三而不是 e-账，避免改掉既有 `账号` 汇总期望（出 1 笔 1000.00）。
  await insertRelation(库(), {
    id: "r-张X转",
    projectId: 身份戊.projectId,
    fromId: "e-张三",
    toId: "e-号X",
    type: "转账",
    amount: 100,
    sourceKind: "data",
    trustState: "自动抽取",
  })
  // 余额明细：amount/balance 是 numeric，按 `FactRowInput` 的契约一律传 string。
  // ⚠️ `started_at` 与 `row_no` **逆序配对**：若两者同序，删掉 SQL 的 `order by started_at`
  // 后（PGlite 会走主键索引、按 row_no 返回）结果仍是 100/900，变异不可判别（2026-11-06 实测）。
  // 三个余额值不变：100.00 / 500.00 / 900.00，按 `started_at` 升序是 100→500→900。
  await insertFactRows(库(), [
    {
      projectId: 身份戊.projectId,
      materialId: "m-流水",
      sheet: "Sheet1",
      rowNo: 1,
      counterparty: 账号,
      startedAt: 300,
      amount: "30.00",
      balance: "900.00",
    },
    {
      projectId: 身份戊.projectId,
      materialId: "m-流水",
      sheet: "Sheet1",
      rowNo: 2,
      counterparty: 账号,
      startedAt: 100,
      amount: "10.00",
      balance: "100.00",
    },
    {
      projectId: 身份戊.projectId,
      materialId: "m-流水",
      sheet: "Sheet1",
      rowNo: 3,
      counterparty: 账号,
      startedAt: 200,
      amount: "20.00",
      balance: "500.00",
    },
    // 第 4 行 `started_at` 为 null（不传）：`nulls last` 会让它排最后，拿数组末行当「末」
    // 就会得到 777.00。它只参与极值，不参与首末。
    {
      projectId: 身份戊.projectId,
      materialId: "m-流水",
      sheet: "Sheet1",
      rowNo: 4,
      counterparty: 账号,
      amount: "40.00",
      balance: "777.00",
    },
  ])
  // —— 任务 10：`aggregate_money` 明细匹配扩到户名 / 本方账号 ——
  // 两条新行各自**只**靠新谓词命中：户名行是生产里「账号列与户名列并存」的常态形状
  // （`counterparty` 填账号、`counterparty_name` 填户名 → `case-rows.ts:191-194`），按户名查时
  // 旧谓词只可能命中 `counterparty = 那个账号`（≠ 户名），故仍只有新分支能命中；本方账号行的
  // `counterparty` / `counterparty_name` / `caller` / `callee` 都为空。否则旧分支就会把用例
  // 点绿、删掉新 `or` 分支的变异不可判别。实体也必须是新的，不复用 e-账 / 张三。
  await upsertEntity(库(), { id: "e-户名新", projectId: 身份戊.projectId, type: "人", canonicalValue: 户名新, aliases: [] })
  await upsertEntity(库(), {
    id: "e-本方新",
    projectId: 身份戊.projectId,
    type: "账户",
    canonicalValue: 本方账号,
    aliases: [],
  })
  await insertFactRows(库(), [
    {
      projectId: 身份戊.projectId,
      materialId: "m-流水",
      sheet: "户名匹配",
      rowNo: 1,
      counterparty: 户名对手账号,
      counterpartyName: 户名新,
      startedAt: 400,
      amount: "1.00",
      balance: "321.00",
    },
    {
      projectId: 身份戊.projectId,
      materialId: "m-流水",
      sheet: "本方匹配",
      rowNo: 1,
      ownerAccount: 本方账号,
      startedAt: 500,
      amount: "2.00",
      balance: "654.00",
    },
  ])
  // ⚠️ `participants` 存的是**实体规范值**，不是 id（`case-extract.ts:433` → `case-ingest.ts:573`）。
  // 种 id 会让「按 id 比」的错误实现在用例里假绿、在生产恒空（`#006-11`）。
  await insertEvent(库(), {
    id: "ev-同",
    projectId: 身份戊.projectId,
    type: "同框",
    occurredAt: 1_760_000_100,
    occurredRaw: "2026年3月7日",
    precision: "到日",
    participants: ["张三", "李四"],
    summary: "两人同框",
    trustState: "自动抽取",
  })
  await insertEvent(库(), {
    id: "ev-单",
    projectId: 身份戊.projectId,
    type: "同框",
    occurredAt: 1_760_000_200,
    occurredRaw: "2026年3月8日",
    precision: "到日",
    participants: ["张三"],
    summary: "只有张三",
    trustState: "自动抽取",
  })
  // participants 里混一个「已排除」实体的规范值：事件本身正常，只钉 §9.1 的值过滤。
  await insertEvent(库(), {
    id: "ev-排参",
    projectId: 身份戊.projectId,
    type: "同框",
    occurredAt: 1_760_000_300,
    occurredRaw: "2026年3月9日",
    precision: "到日",
    participants: ["号X", "张三"],
    summary: "含已排除实体",
    trustState: "自动抽取",
  })
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
  // 限定的是「材料范围」，不是「材料类型」（Minor 2）。
  expect(结果.口径).toContain("材料范围仅限本项目")
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
  // r-跨 也是甲→乙 且非「已排除」，不带时间窗时必然命中 ⇒ 断言据实列出。
  // 判别力仍在 from 侧：只查 from 时 r-2（丙→甲）会消失。
  const 结果 = await query_relations(ctx(身份丁), { 实体: "甲" })
  const 行们 = 结果.数据 as Record<string, unknown>[]
  expect(行们.map((行) => 行.id).sort()).toEqual(["r-1", "r-2", "r-跨"].sort())
  expect(结果.口径).toContain("numeric")
  // 金额必须是字符串（`amount::text` 出库）：数字化的那一刻就丢了「勿自行转浮点」这条契约。
  expect(行们.find((行) => 行.id === "r-1")!.amount).toBe("1000.00")
})

test("query_relations 默认不返回「已排除」，含已排除=true 才返回", async () => {
  expect(ids计(await query_relations(ctx(身份丁), { 实体: "甲" }))).not.toContain("r-排")
  expect(ids计(await query_relations(ctx(身份丁), { 实体: "甲", 含已排除: true }))).toContain("r-排")
})

test("query_relations 时间窗按「有交集」判，不是按首末时间都在窗内", async () => {
  // r-跨: first_at=100, last_at=300；窗口 [200, 400] ⇒ 应命中
  expect(ids计(await query_relations(ctx(身份丁), { 实体: "甲", 起: 200, 止: 400 }))).toContain("r-跨")
})

test("query_relations 不返回端点「已排除」的关系（§9.1）", async () => {
  // r-甲X / r-张X转 都连着「已排除」实体 e-号X，关系本身正常 ⇒ 只有端点过滤能挡住。
  const 结果 = await query_relations(ctx(身份戊), { 实体: "张三" })
  expect(JSON.stringify(结果.数据)).not.toContain("号X")
  expect(ids计(结果)).not.toContain("r-甲X")
  expect(ids计(结果)).not.toContain("r-张X转")
  // 正常关系必须仍在：删掉整条取数也会「不含号X」。
  expect(ids计(结果)).toContain("r-甲N")
})

test("query_relations 给不存在的实体 ⇒ not_found", async () => {
  await expect(query_relations(ctx(身份丁), { 实体: "查无此人" })).rejects.toMatchObject({ code: "not_found" })
})

test("解析实体：同值「人/组织」两行 ⇒ 取后建的组织行，关系也取得到", async () => {
  // 存量旧行（纠正前落库的「人」）先建；重解析后新「组织」行后建（`created_at` 取当前时间）。
  await 建实体(库(), {
    id: "e-旧人行-解析",
    projectId: 身份解析.projectId,
    value: "柏加派出所",
    type: "人",
    createdAt: 100,
  })
  await upsertEntity(库(), {
    id: "e-组织行-解析",
    projectId: 身份解析.projectId,
    type: "组织",
    canonicalValue: "柏加派出所",
    aliases: [],
  })
  await upsertEntity(库(), {
    id: "e-张三-解析",
    projectId: 身份解析.projectId,
    type: "人",
    canonicalValue: "张三",
    aliases: [],
  })
  await insertRelation(库(), {
    id: "r-解析",
    projectId: 身份解析.projectId,
    fromId: "e-张三-解析",
    toId: "e-组织行-解析",
    type: "同案",
    basis: "笔录记载",
    sourceKind: "human",
    trustState: "自动抽取",
  })

  const 解析 = await 解析实体(ctx(身份解析), "柏加派出所", "实体")
  // 产出原始值：类型字符串必须是纠正后的「组织」，不是旧的「人」行。
  expect(解析.type).toBe("组织")
  expect(解析.id).toBe("e-组织行-解析")

  // 关系挂在组织行上：解析到旧「人」行时这里会是 0 条，与图谱页画出关系相矛盾。
  const 结果 = await query_relations(ctx(身份解析), { 实体: "柏加派出所" })
  const 关系ids = ids计(结果)
  expect(关系ids.length).toBe(1)
  expect(关系ids[0]).toBe("r-解析")
})

test("query_relations：按值查询合并同值多行的关系（旧/新行各挂一条）", async () => {
  // 实体从不删除、重灌只删本材料的引用：材料 A 重灌后关系挂「组织」行，
  // 材料 B 未重灌、关系仍挂旧「人」行。按值查询只过滤「最新一行」会静默丢 B 的关系。
  await 建实体(库(), {
    id: "e-合并旧人",
    projectId: 身份合并.projectId,
    value: "柏加派出所",
    type: "人",
    createdAt: 100,
  })
  await 建实体(库(), {
    id: "e-合并新组织",
    projectId: 身份合并.projectId,
    value: "柏加派出所",
    type: "组织",
    createdAt: 200,
  })
  await upsertEntity(库(), { id: "e-合并甲", projectId: 身份合并.projectId, type: "人", canonicalValue: "甲", aliases: [] })
  await upsertEntity(库(), { id: "e-合并乙", projectId: 身份合并.projectId, type: "人", canonicalValue: "乙", aliases: [] })
  for (const [id, fromId, toId] of [
    ["r-合并-旧", "e-合并甲", "e-合并旧人"],
    ["r-合并-新", "e-合并乙", "e-合并新组织"],
  ] as const) {
    await insertRelation(库(), {
      id,
      projectId: 身份合并.projectId,
      fromId,
      toId,
      type: "同案",
      basis: "笔录记载",
      sourceKind: "human",
      trustState: "自动抽取",
    })
  }

  const 结果 = await query_relations(ctx(身份合并), { 实体: "柏加派出所" })
  // 原始数字 + 集合比较：只按单个 id 过滤时是 1 条（Expected 2 / Received 1）。
  const 关系ids = ids计(结果).sort()
  expect(关系ids.length).toBe(2)
  expect(关系ids).toEqual(["r-合并-旧", "r-合并-新"].sort())
})

test("aggregate_money：按值查询合并同值多行——旧/新行各一笔转账都算进笔数与合计", async () => {
  await 建实体(库(), {
    id: "e-聚合旧人",
    projectId: 身份聚合.projectId,
    value: "合并账户甲",
    type: "人",
    createdAt: 100,
  })
  await 建实体(库(), {
    id: "e-聚合新组织",
    projectId: 身份聚合.projectId,
    value: "合并账户甲",
    type: "组织",
    createdAt: 200,
  })
  await upsertEntity(库(), {
    id: "e-聚合对手",
    projectId: 身份聚合.projectId,
    type: "人",
    canonicalValue: "转账对手",
    aliases: [],
  })
  for (const [id, toId, amount] of [
    ["r-聚合-旧", "e-聚合旧人", 100],
    ["r-聚合-新", "e-聚合新组织", 200],
  ] as const) {
    await insertRelation(库(), {
      id,
      projectId: 身份聚合.projectId,
      fromId: "e-聚合对手",
      toId,
      type: "转账",
      amount,
      sourceKind: "data",
      trustState: "自动抽取",
    })
  }

  const 结果 = await aggregate_money(ctx(身份聚合), { 账户: "合并账户甲" })
  // 原始数字/字符串：只按单个 id 过滤时「入」是 1 笔 / 200.00（另一笔挂在旧「人」行上）。
  expect(结果.数据).toEqual({
    汇总: [{ 方向: "入", 笔数: 2, 合计: "300.00" }],
    对手方: [{ 对手方: "转账对手", 方向: "入", 笔数: 2, 合计: "300.00" }],
    余额走势: null,
  })
})

test("find_crossings：甲按值解析时合并同值多行——关系挂在旧行也能进共同关联", async () => {
  await 建实体(库(), {
    id: "e-叉旧人",
    projectId: 身份叉.projectId,
    value: "柏加派出所",
    type: "人",
    createdAt: 100,
  })
  await 建实体(库(), {
    id: "e-叉新组织",
    projectId: 身份叉.projectId,
    value: "柏加派出所",
    type: "组织",
    createdAt: 200,
  })
  await upsertEntity(库(), { id: "e-叉乙", projectId: 身份叉.projectId, type: "人", canonicalValue: "李四叉", aliases: [] })
  await upsertEntity(库(), { id: "e-叉王", projectId: 身份叉.projectId, type: "人", canonicalValue: "王叉", aliases: [] })
  for (const [id, fromId] of [
    ["r-叉-旧", "e-叉旧人"],
    ["r-叉-乙", "e-叉乙"],
  ] as const) {
    await insertRelation(库(), {
      id,
      projectId: 身份叉.projectId,
      fromId,
      toId: "e-叉王",
      type: "同案",
      basis: "笔录记载",
      sourceKind: "human",
      trustState: "自动抽取",
    })
  }

  // 甲展示行是纠正后的组织行；另一条关系挂在旧「人」行上——只按单个 id 算时交集为空。
  const 结果 = await find_crossings(ctx(身份叉), { 甲: "柏加派出所", 乙: "李四叉" })
  // 整份数据等值断言（数组元素，不是子串）：交集为空时共同关联会变成 []。
  expect(结果.数据).toEqual({
    共同关联: [{ id: "e-叉王", type: "人", value: "王叉", trust_state: "自动抽取" }],
    共同时空: [],
  })
})

test("解析实体：两行 created_at 同秒 ⇒ 仍取纠正后的组织行（非「人」型优先）", async () => {
  // `created_at` 是整数秒：同秒创建时 `created_at desc` 打平，回落 `type asc` 会命中旧「人」行。
  await 建实体(库(), {
    id: "e-同秒旧人",
    projectId: 身份同秒.projectId,
    value: "柏加派出所",
    type: "人",
    createdAt: 500,
  })
  await 建实体(库(), {
    id: "e-同秒组织",
    projectId: 身份同秒.projectId,
    value: "柏加派出所",
    type: "组织",
    createdAt: 500,
  })

  const 解析 = await 解析实体(ctx(身份同秒), "柏加派出所", "实体")
  expect(解析.type).toBe("组织")
  expect(解析.id).toBe("e-同秒组织")
})

test("时间窗起 > 止 ⇒ bad_input", async () => {
  await expect(query_events(ctx(身份丁), { 起: 500, 止: 100 })).rejects.toMatchObject({ code: "bad_input" })
})

test("query_events 按参与实体过滤（文本数组包含）", async () => {
  // 输入给的是实体 id（`e-参与`），`participants` 里存的是规范值（`参与人`）——
  // 这一条同时钉住「解析链」与「比规范值」。
  expect(ids计(await query_events(ctx(身份丁), { 参与实体: "e-参与" }))).toEqual(["ev-1"])
})

test("query_events 返回原始值、规范值、精度三件套", async () => {
  const 行 = (await query_events(ctx(身份丁), { 参与实体: "e-参与" })).数据 as Record<string, unknown>[]
  // `time_type` 断言 null 不是偷懒：`insertEvent` 的入参里没有这个字段（`case-ingest.ts` 也不写），
  // 生产库该列今天恒为 NULL。工具仍要把列**带出来**——键名在、值如实为 null，用例才钉得住「没被吞掉」。
  expect(行[0]).toMatchObject({ occurred_raw: "2026年3月5日 14时", precision: "到分", time_type: null })
  // 形状：`participants` 走 `array_to_json(...)::text` + `解JSON`。不加这条，把 `array_to_json` 拆掉仍绿。
  expect(Array.isArray(行[0]!.participants)).toBe(true)
  expect(行[0]!.participants).toEqual(["参与人"])
})

test("query_events 的 participants 剔除「已排除」实体的规范值", async () => {
  const 行们 = (await query_events(ctx(身份戊), { 类型: "同框" })).数据 as {
    id: string
    participants: string[]
  }[]
  // 事件本身正常、只有参与值落在已排除实体上：值必须被剔除，否则回答里会漏出「号X」。
  expect(行们.find((行) => 行.id === "ev-排参")!.participants).toEqual(["张三"])
  expect(JSON.stringify(行们)).not.toContain("号X")
})

test("解析实体规则写进 query_events / aggregate_money / find_crossings 的口径", async () => {
  // 规则只写在 query_relations 口径里时，另三个工具的回答会让模型对同名/重名实体自行猜（Minor 4）。
  for (const 口径 of [
    (await query_relations(ctx(身份丁), { 实体: "甲" })).口径,
    (await query_events(ctx(身份丁), {})).口径,
    (await aggregate_money(ctx(身份戊), { 账户: 账号 })).口径,
    (await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })).口径,
  ]) {
    expect(口径).toContain("type 升序、id 升序")
    // 只钉旧的排序尾句时，把口径改回「按 type 升序取第一条」仍绿——必须钉住新增的「取最新」。
    expect(口径).toContain("最新")
  }
  // 按值查询会合并同值多行的关系：三个关系类工具都要在口径里说清，否则模型以为只查了最新一行。
  for (const 口径 of [
    (await query_relations(ctx(身份丁), { 实体: "甲" })).口径,
    (await aggregate_money(ctx(身份戊), { 账户: 账号 })).口径,
    (await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })).口径,
  ]) {
    expect(口径).toContain("合并同值多行")
  }
})

test("get_citation 对实体返回事实 + 引用", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "entity", 事实id: "e-甲" })
  expect(结果.数据).toMatchObject({ 事实: { type: "entity" }, 引用: [{ material_id: "m-甲" }] })
})

test("get_citation 对明细行按 material#sheet#row 解析", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#2" })
  const 数据 = 结果.数据 as { 明细行: Record<string, unknown>; 引用: Record<string, unknown>[] }
  expect(数据.明细行.row_no).toBe(2)
  // 金额字符串原样返回；引用必须真的按 `fact_type='row'` 查到（种子里 `c-行-1`）。
  expect(数据.明细行.amount).toBe("50.00")
  // `01` §8.2：行分支要补 counterparty_name / owner_account / direction，
  // 且整份返回 extras（备注原文在里面）。这三列在 0035 就进了库，只是这里没往外给。
  expect(数据.明细行.counterparty_name).toBe("甲户名")
  expect(数据.明细行.owner_account).toBe("622200000001")
  expect(数据.明细行.direction).toBe("收")
  expect(数据.明细行.extras).toEqual({})
  expect(数据.引用.map((条) => 条.material_id)).toEqual(["m-甲"])
  // 规范化键：`02` 不是 2 的「另一个 id」，命中后引用要按 `#2` 查得到。
  const 补零 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#02" })
  expect((补零.数据 as { 引用: Record<string, unknown>[] }).引用).toHaveLength(1)
  // 有引用时 `缺口` 必须是 undefined：否则「无引用」的那条提示会变成常驻噪音。
  expect(结果.缺口).toBeUndefined()
})

test("get_citation 明细行：工作表名含 # 也能定位", async () => {
  // `case-store.ts:423-432` 的契约：工作表名可合法含 `#`，按固定段数拆是错的。
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet#1#2" })
  const 明细行 = (结果.数据 as { 明细行: { sheet: string; row_no: number } }).明细行
  expect(明细行.sheet).toBe("Sheet#1")
  expect(明细行.row_no).toBe(2)
})

test("get_citation 明细行没有引用 ⇒ 缺口说明尚未在生产写入", async () => {
  // `m-甲#Sheet#1#2` 没有种引用；`fact_type='row'` 今天也没有生产写入者（只有测试手工种）。
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet#1#2" })
  expect((结果.数据 as { 引用: unknown[] }).引用).toEqual([])
  expect(结果.缺口?.join() ?? "").toContain("尚未在生产写入")
  expect(结果.缺口?.join() ?? "").toContain("material/sheet/row_no")
})

test("get_citation 事实id 形状不对 ⇒ bad_input", async () => {
  await expect(get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "没有井号" })).rejects.toMatchObject({ code: "bad_input" })
  // 多余的一段不是「多一个工作表」：按首/末 `#` 切，最后一段是行号 ⇒ 「多余」不是整数（R-T6-10）。
  await expect(get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#2#多余" })).rejects.toMatchObject({ code: "bad_input" })
  // 两段（缺行号）也要拒。
  await expect(get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1" })).rejects.toMatchObject({ code: "bad_input" })
})

test("get_citation 对「已排除」的实体照样能取到引用", async () => {
  // `事实详情` 的默认口径是「已排除不返回」；出处工具必须传 includeExcluded:true，
  // 否则模型问「这条为什么被排除」时得到 not_found（R-T6-11）。种子走共享夹具。
  await 建实体(库(), { id: "e-排引", projectId: "p-工具-丁", value: "已排除的人", trustState: "已排除" })
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "entity", 事实id: "e-排引" })
  expect((结果.数据 as { 事实: { id: string } }).事实.id).toBe("e-排引")
})

// —— 任务 4：资金聚合 / 交叉 ——

test("aggregate_money 汇总只算转账关系，出/入分开", async () => {
  // 账户 e-账：出 1000（r-出）、入 2500.50（r-入）、另有一条同案关系 r-同（不该计入）
  const 结果 = await aggregate_money(ctx(身份戊), { 账户: 账号 })
  expect((结果.数据 as { 汇总: unknown }).汇总).toEqual([
    { 方向: "出", 笔数: 1, 合计: "1000.00" },
    { 方向: "入", 笔数: 1, 合计: "2500.50" },
  ])
  expect(结果.缺口?.join()).toContain("未抽成关系")
  // 对手方：同一批关系按「对手方 ＋ 方向」分组，`sum desc` 定序（无 collation 依赖）。
  expect((结果.数据 as { 对手方: unknown }).对手方).toEqual([
    { 对手方: "对手甲", 方向: "入", 笔数: 1, 合计: "2500.50" },
    { 对手方: "对手甲", 方向: "出", 笔数: 1, 合计: "1000.00" },
  ])
})

test("aggregate_money 余额走势给首末与极值，并说明截断", async () => {
  const 结果 = await aggregate_money(ctx(身份戊), { 账户: 账号 })
  const 走势 = (结果.数据 as { 余额走势: { 首: string; 末: string; 最高: string; 最低: string; 行数: number } })
    .余额走势
  // 第 4 行 `started_at` 为 null、balance 777 —— 它不能当「末」（`nulls last` 会让它排最后）。
  expect(走势).toMatchObject({ 首: "100.00", 末: "900.00", 最高: "900.00", 最低: "100.00", 行数: 4 })
  expect(结果.缺口?.join()).toContain("超过 200 行")
})

test("aggregate_money 对手方不返回「已排除」实体（§9.1）", async () => {
  // 张三有一笔到 e-号X 的转账（关系本身正常）⇒ 只有端点过滤能挡住。
  const 数据 = (await aggregate_money(ctx(身份戊), { 账户: "张三" })).数据 as { 汇总: unknown[]; 对手方: unknown[] }
  expect(JSON.stringify(数据.对手方)).not.toContain("号X")
  expect(数据.对手方).toEqual([])
  // §9.1「不进统计」也要管到汇总：对手方被排除，这笔关系就不该算进「出」的笔数与合计。
  // 没这条时，同一次调用里 汇总 出 1 笔 100.00、对手方却为空 —— 自相矛盾。
  expect(数据.汇总).toEqual([])
})

test("固定上限写进缺口（对手方 10、共同时空 50）", async () => {
  expect((await aggregate_money(ctx(身份戊), { 账户: 账号 })).缺口?.join()).toContain("最多 10 条")
  expect((await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })).缺口?.join()).toContain("最多 50 条")
})

test("aggregate_money 本项目没有该账户的流水 ⇒ 余额走势 null 并说明", async () => {
  const 结果 = await aggregate_money(ctx(身份戊), { 账户: "对手甲" })
  expect((结果.数据 as { 余额走势: unknown }).余额走势).toBeNull()
  expect(结果.缺口?.join()).toContain("没有该账户的流水")
})

test("aggregate_money 账户不存在 ⇒ not_found", async () => {
  await expect(aggregate_money(ctx(身份戊), { 账户: "没有这个账户" })).rejects.toMatchObject({ code: "not_found" })
})

test("aggregate_money 账号列与户名列并存时，按户名查得到明细", async () => {
  // 种子行：counterparty = 户名对手账号（账号）、counterparty_name = 户名新、balance 非空
  // ⇒ 按户名查时只有 `counterparty_name = ?` 这一支能命中（旧谓词只会命中 counterparty 那个账号）。
  // 「只有户名列」的行会被 `counterparty` 兜底、旧谓词本来就命中，不构成判别用例，故不种那种形状。
  const 走势 = (await aggregate_money(ctx(身份戊), { 账户: 户名新 })).数据 as { 余额走势: { 行数: number } | null }
  expect(走势.余额走势).toMatchObject({ 行数: 1 })
})

test("aggregate_money 按本方账号查得到该账户的明细", async () => {
  // 种子行只设 owner_account，counterparty / counterparty_name / caller / callee 都不等于该值
  // ⇒ 只有 `owner_account = ?` 这一支能命中。
  const 走势 = (await aggregate_money(ctx(身份戊), { 账户: 本方账号 })).数据 as {
    余额走势: { 行数: number } | null
  }
  expect(走势.余额走势).toMatchObject({ 行数: 1 })
})

test("find_crossings 找出共同关联实体（另一端的交集）", async () => {
  // 甲—号码N（通话）、乙—号码N（通话）⇒ 共同关联含号码N
  const 结果 = await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })
  expect((结果.数据 as { 共同关联: { value: string }[] }).共同关联.map((行) => 行.value)).toEqual(["13800001111"])
})

test("find_crossings 不把「已排除」关系算进交集", async () => {
  // 甲—号码M 关系已排除、乙—号码M 正常 ⇒ 号码M 不该出现
  const 结果 = await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })
  expect(JSON.stringify(结果)).not.toContain("13900002222")
  // e-号X 是「已排除」实体、两条关系都正常 ⇒ 回查实体时也必须过滤掉它。
  expect(JSON.stringify(结果)).not.toContain("号X")
})

test("find_crossings 不同实体但规范值相同 ⇒ 也拒（id 相同挡不住）", async () => {
  // 两侧都按 id 解析：e-同A（人）与 e-同B（号码）id 不同、value 都是「同名值」。
  await expect(find_crossings(ctx(身份戊), { 甲: "e-同A", 乙: "e-同B" })).rejects.toMatchObject({
    code: "bad_input",
  })
})

test("find_crossings 甲和乙是同一实体 ⇒ bad_input", async () => {
  // `participants @> array[X,X]` 在多重集包含语义下对只含一个 X 的事件可能恒假（漏报），
  // 「找自己与自己的共同关联」本身也没有意义 ⇒ fail-closed，别静默返回空。
  await expect(find_crossings(ctx(身份戊), { 甲: "张三", 乙: "张三" })).rejects.toMatchObject({ code: "bad_input" })
})

test("find_crossings 共同时空按 participants 同时包含两人", async () => {
  const 结果 = await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })
  expect((结果.数据 as { 共同时空: { id: string }[] }).共同时空.map((行) => 行.id)).toEqual(["ev-同"])
})

test("find_crossings 任一方不存在 ⇒ not_found，文案说清是哪一方", async () => {
  await expect(find_crossings(ctx(身份戊), { 甲: "张三", 乙: "查无此人" })).rejects.toMatchObject({
    code: "not_found",
    message: expect.stringContaining("乙"),
  })
})
