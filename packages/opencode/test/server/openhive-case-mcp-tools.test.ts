import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  build_source_profile,
  explore_entity,
  find_crossings,
  get_citation,
  list_source_profiles,
  money_flow,
  query_entities,
  query_events,
  query_relations,
  query_rows,
  query_timeline,
  revoke_source_profile,
  search_materials,
  归一化限制,
  校验成员,
  解析实体,
  type 工具上下文,
  type 工具结果,
} from "../../src/server/openhive/case-mcp-tools"
import { 工具名, 分发表 } from "../../src/server/openhive/case-mcp-server"
import { addCitation, createMaterial, getMaterial, insertFactRows } from "../../src/server/openhive/case-store"
import { claimNextJob, enqueueMaterial, runJob } from "../../src/server/openhive/case-ingest"
import { insertEvent, insertRelation, setMaterialText, upsertEntity } from "../../src/server/openhive/case-fact-store"
import { 建实体, 建材料 } from "./openhive-case-fact-fixture"

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
/**
 * Task 5 A1：两个不同对手方。独立项目：给戊再加关系会改掉 `aggregate_money(账号)`
 * 的汇总 / 对手方全量断言（`#005-34`）。
 */
const 身份对手 = { userId: "u-工具-甲", projectId: "p-工具-对手" }
const 账号对手 = "6222…对手"
const 项目乙 = "p-工具-乙"
/**
 * `query_rows` 大页自限用独立项目：40 行 × 长备注 ⇒ 单页 > 30 KB。独立项目是 `#005-34`
 * 的要求——往既有项目里加明细会改掉那些用例的全量断言。
 */
const 身份大页 = { userId: "u-工具-甲", projectId: "p-工具-大页" }
const 大页材料 = "m-大页"
/** 单行 `备注` 1000 字节（ASCII）⇒ 一行明细序列化 ≈ 1.2 KB，40 行 ≈ 48 KB。 */
const 长备注 = "x".repeat(1000)
const 大页行数 = 40
/**
 * T7a D3：同 path 重传用独立项目（`#005-34`）——旧行「未入队」、新行「已解析」，
 * 两条材料共享 `path`，`未解析材料份数` 必须只认最新行。
 */
const 身份重传 = { userId: "u-工具-甲", projectId: "p-工具-重传" }
const 重传账号 = "6217000099990000"
const 重传对手 = "重传对手"
const 重传旧材料 = "m-重传旧"
const 重传文件 = new Map<string, Uint8Array>()
let 重传新材料 = ""
/**
 * T7a B7：只有一份**产物**材料的独立项目。产物 `parse_status` 恒为「未入队」（design §5.5），
 * 但它不算「待翻译」——否则任何生成过产物的项目都会永久答「材料未翻译」。
 */
const 身份产物 = { userId: "u-工具-甲", projectId: "p-工具-产物" }
const 产物账户 = "6217000088880000"

/** 现造一份真 xlsx 字节（与 `explore/dataset.ts` 同法；仓内不存二进制夹具）。 */
function 造工作簿(行们: (string | number)[][], 表名: string): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(行们), 表名)
  // `XLSX.write` 的返回类型是 `any`（同一批 tarball 里 dataset.ts 也这么写）；做成 `Uint8Array`
  // 后交给生产入口当字节流。不加 `as ArrayBuffer`：那会多一条 `no-unsafe-type-assertion`。
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

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
      // 非缺省值：`extras` 断言 `{}` 会被「实现硬编码 `{}`」满足（`#005-47`）。
      extras: { 备注: "转出工资" },
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
    // 外币行：`get_citation` 的行分支必须把 `currency` 带出来，否则抽验时等于把 USD 金额
    // 当人民币展示（评审必修 1）。金额/备注取自`dataset.ts` 的 2/25 行。
    {
      projectId: 身份丁.projectId,
      materialId: "m-甲",
      sheet: "Sheet1",
      rowNo: 3,
      counterparty: "赵六",
      counterpartyName: "赵六",
      direction: "付",
      amount: "300.00",
      balance: "18000.00",
      currency: "USD",
      extras: { 备注: "货款" },
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

  // —— 任务 6 的种子：原文切片（`case_citation.locator` 的四种形态各一条）——
  // 1) 真区间：切出来的必须是「这一片」，不是整篇（前后都放了不该出现的句子）。
  const 切片正文 = "前言，与本案无关。2026年2月20日，李四向张三账户6222021234567890123转账8000元。后记。"
  await createMaterial(库(), {
    id: "m-切片",
    projectId: 身份丁.projectId,
    fileName: "笔录-切片.txt",
    kind: "笔录",
    fingerprint: "fp-工具-丁-切片",
    path: "笔录-切片.txt",
  })
  await setMaterialText(库(), 身份丁.projectId, "m-切片", 切片正文)
  await addCitation(库(), {
    id: "c-关系-切片",
    projectId: 身份丁.projectId,
    factType: "relation",
    factId: "r-1",
    materialId: "m-切片",
    locator: {
      start: 切片正文.indexOf("2026年2月20日"),
      end: 切片正文.indexOf("8000元。") + "8000元。".length,
    },
    extractMethod: "机器",
  })
  // 2) 材料没有正文（xlsx 没有 text_content）：两条同一材料的引用只允许说一次缺口。
  await createMaterial(库(), {
    id: "m-无正文",
    projectId: 身份丁.projectId,
    fileName: "无正文.xlsx",
    kind: "资金",
    fingerprint: "fp-工具-丁-无正文",
    path: "无正文.xlsx",
  })
  for (const id of ["c-无正文-1", "c-无正文-2"]) {
    await addCitation(库(), {
      id,
      projectId: 身份丁.projectId,
      factType: "relation",
      factId: "r-2",
      materialId: "m-无正文",
      locator: { start: 0, end: 3 },
      extractMethod: "机器",
    })
  }
  // 3) locator 越过正文长度：夹到末尾，缺口里明说。
  await createMaterial(库(), {
    id: "m-越界",
    projectId: 身份丁.projectId,
    fileName: "越界.txt",
    kind: "笔录",
    fingerprint: "fp-工具-丁-越界",
    path: "越界.txt",
  })
  await setMaterialText(库(), 身份丁.projectId, "m-越界", "短正文")
  await addCitation(库(), {
    id: "c-越界",
    projectId: 身份丁.projectId,
    factType: "relation",
    factId: "r-跨",
    materialId: "m-越界",
    locator: { start: 0, end: 999 },
    extractMethod: "机器",
  })
  // 4) 非区间 locator（`{page}`）：正文存在也不许拿整篇充数。
  await createMaterial(库(), {
    id: "m-非切片",
    projectId: 身份丁.projectId,
    fileName: "非切片.txt",
    kind: "笔录",
    fingerprint: "fp-工具-丁-非切片",
    path: "非切片.txt",
  })
  await setMaterialText(库(), 身份丁.projectId, "m-非切片", "整篇正文不该被当成切片。")
  await addCitation(库(), {
    id: "c-非切片",
    projectId: 身份丁.projectId,
    factType: "event",
    factId: "ev-2",
    materialId: "m-非切片",
    locator: { page: 1 },
    extractMethod: "人工",
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

  // —— Task 5 A1：两个不同对手方（对手方按「对手 + 方向」分组会出 3 行，但只有 2 个对手）——
  await upsertEntity(库(), {
    id: "e-账对",
    projectId: 身份对手.projectId,
    type: "账户",
    canonicalValue: 账号对手,
    aliases: [],
  })
  for (const [id, value] of [
    ["e-对手A", "对手甲二"],
    ["e-对手B", "对手乙二"],
  ] as const) {
    await upsertEntity(库(), { id, projectId: 身份对手.projectId, type: "人", canonicalValue: value, aliases: [] })
  }
  for (const [id, fromId, toId, amount] of [
    ["r-对出A", "e-账对", "e-对手A", 100],
    ["r-对入A", "e-对手A", "e-账对", 200],
    ["r-对出B", "e-账对", "e-对手B", 300],
  ] as const) {
    await insertRelation(库(), {
      id,
      projectId: 身份对手.projectId,
      fromId,
      toId,
      type: "转账",
      amount,
      sourceKind: "data",
      trustState: "自动抽取",
    })
  }

  // —— 大页自限：40 行长备注，单页 > 30 KB（`09` §3.4 / I1）——
  await 建材料(库(), {
    id: 大页材料,
    projectId: 身份大页.projectId,
    path: "资金/大页.xlsx",
    kind: "资金",
    parseStatus: "已解析",
  })
  await insertFactRows(
    库(),
    Array.from({ length: 大页行数 }, (_, i) => ({
      projectId: 身份大页.projectId,
      materialId: 大页材料,
      sheet: "Sheet1",
      rowNo: i + 1,
      // 时间递增 ⇒ 翻页顺序可确定（升序 / 同键按行号）。
      startedAt: 10_000 + i,
      amount: "10.00",
      direction: "收" as const,
      counterparty: `1390000${String(i).padStart(4, "0")}`,
      extras: { 备注: 长备注 },
    })),
  )

  // —— T7a D3：同 path 重传（旧行「未入队」、新行「已解析」），造法与 `case-row-query.test.ts` 同形 ——
  // 旧行用 `createMaterial` 建（默认「未入队」）；新行走生产入口 `enqueueMaterial` → `claimNextJob`
  // → `runJob`，`fingerprint` 不同 ⇒ 同 path 落第二行（`createMaterial` 的幂等键是
  // `(project_id, fingerprint)`，不是 path）。
  await createMaterial(库(), {
    id: 重传旧材料,
    projectId: 身份重传.projectId,
    fileName: "重传.xlsx",
    kind: "资金",
    fingerprint: "fp-重传-旧",
    path: "资金/重传.xlsx",
  })
  // `created_at` 只有秒精度，`未解析材料份数` 的 `distinct on (path)` 用
  // `order by path, created_at desc, id desc` 破平——同一秒建两行时谁算「最新」由随机 id 决定。
  // 走生产入口就必须让两行落在不同秒：等一整秒，别用裸 SQL 改时间。
  await Bun.sleep(1100)
  重传文件.set(
    "p-工具-重传/资金/重传.xlsx",
    造工作簿(
      [
        ["交易时间", "查询账号", "本方户名", "对方账号", "对方户名", "借贷标志", "交易金额", "余额", "备注", "币种"],
        ["2026-02-10 10:00:00", 重传账号, "重传户名", "6217000099990001", 重传对手, "付", "100.00", "900.00", "货款", "CNY"],
      ],
      "流水",
    ),
  )
  const 重传入队 = await enqueueMaterial(库(), {
    projectId: 身份重传.projectId,
    path: "资金/重传.xlsx",
    sourcePath: "p-工具-重传/资金/重传.xlsx",
    fileName: "重传.xlsx",
    fingerprint: "fp-重传-新",
    kind: "资金",
  })
  if (!重传入队.enqueued) throw new Error("重传材料没有入队")
  重传新材料 = 重传入队.materialId
  const 重传作业 = await claimNextJob(库())
  if (重传作业?.materialId !== 重传新材料) {
    throw new Error(`认领到别人的作业：期望 ${重传新材料}，实得 ${String(重传作业?.materialId)}`)
  }
  const 重传结果 = await runJob(
    库(),
    {
      readFile: async (路径: string) => {
        const 字节 = 重传文件.get(路径)
        if (!字节) throw new Error(`没有这个文件：${路径}`)
        return 字节
      },
    },
    重传作业,
  )
  if (重传结果 !== "完成") throw new Error(`重传材料没有跑完：${重传结果}`)
  await upsertEntity(库(), {
    id: "e-重传账",
    projectId: 身份重传.projectId,
    type: "账户",
    canonicalValue: 重传账号,
    aliases: [],
  })
  await upsertEntity(库(), {
    id: "e-重传对手",
    projectId: 身份重传.projectId,
    type: "人",
    canonicalValue: 重传对手,
    aliases: [],
  })
  // 一笔转账 ⇒ `aggregate_money` 有数据（空结果会走另一条判据，测不到「非空结果也报未翻译缺口」）。
  await insertRelation(库(), {
    id: "r-重传转账",
    projectId: 身份重传.projectId,
    fromId: "e-重传账",
    toId: "e-重传对手",
    type: "转账",
    amount: 100,
    sourceKind: "data",
    trustState: "自动抽取",
  })

  // —— T7a B7：只有一份产物材料的项目（`kind='产物'` 只登记不解析，design §5.5）——
  await createMaterial(库(), {
    id: "m-产物",
    projectId: 身份产物.projectId,
    fileName: "分析报告.docx",
    kind: "产物",
    fingerprint: "fp-产物",
    path: "产物/分析报告.docx",
  })
  // 账户实体存在、但任何事实里都没有它 ⇒ 材料已翻译时应落判定表第 2 条；
  // 若产物被误算成「待翻译」，第 4 条会把它改口成「项目内资金材料未翻译」。
  await upsertEntity(库(), {
    id: "e-产物账",
    projectId: 身份产物.projectId,
    type: "账户",
    canonicalValue: 产物账户,
    aliases: [],
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
  // `外币行数` 是这个夹具里没有外币行时的**必给**键（§3.4：字段缺席会被模型讲成「没有依据」），
  // 不是放宽断言——契约新增字段，值恒为 0。
  // `首末` 是 T2 新增的键（供 money_flow 复用）：夹具的关系都没有 first_at/last_at ⇒ 两个 null。
  expect(结果.数据).toEqual({
    汇总: [{ 方向: "入", 笔数: 2, 合计: "300.00" }],
    首末: { 首: null, 末: null },
    对手方: [{ 对手方: "转账对手", 方向: "入", 笔数: 2, 合计: "300.00" }],
    余额走势: null,
    外币行数: 0,
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

test("query_events 含已排除=true 时才回显已排除实体的规范值", async () => {
  // 同一事件 `ev-排参` 对照：缺省 / false 走剔除，显式 true 原样回显（口径开关，不是可见性隐藏）。
  const 缺省 = (await query_events(ctx(身份戊), { 类型: "同框" })).数据 as {
    id: string
    participants: string[]
  }[]
  const 含排除 = (await query_events(ctx(身份戊), { 类型: "同框", 含已排除: true })).数据 as {
    id: string
    participants: string[]
  }[]
  expect(缺省.find((行) => 行.id === "ev-排参")!.participants).toEqual(["张三"])
  expect(含排除.find((行) => 行.id === "ev-排参")!.participants).toEqual(["号X", "张三"])
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
  expect(数据.明细行.extras).toEqual({ 备注: "转出工资" })
  expect(数据.引用.map((条) => 条.material_id)).toEqual(["m-甲"])
  // 规范化键：`02` 不是 2 的「另一个 id」，命中后引用要按 `#2` 查得到。
  const 补零 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#02" })
  expect((补零.数据 as { 引用: Record<string, unknown>[] }).引用).toHaveLength(1)
  // 有引用时 `缺口` 必须为空数组（七字段信封里 `缺口` 必填）：否则「无引用」的那条提示会变成常驻噪音。
  expect(结果.缺口).toEqual([])
})

test("get_citation 明细行必须带币种：外币行不能只回金额", async () => {
  // 评审必修 1：行分支是**手工投影**（不走 `行视图`），漏了 `currency` 时 USD 行只回
  // `amount: "300.00"`，模型/民警会把它当人民币。改前实得 `undefined`。
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#3" })
  // 不用 `as` 取子对象：本仓 oxlint 对 unknown 的窄化断言会记一条新告警。
  expect(结果.数据).toMatchObject({
    明细行: { currency: "USD", amount: "300.00" },
  })
  // 既有 extras 断言不破：投影不能为了补币种把备注吞掉。
  expect(结果.数据).toMatchObject({ 明细行: { extras: { 备注: "货款" } } })
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

// —— 任务 6：出处原文（`09` §13.1 D7）——

/**
 * 按点路径从 `unknown` 里取值（断言用）：只用 `typeof` 收窄 + `Reflect.get`，不写 `as`——
 * 本仓 oxlint 的 `no-unsafe-type-assertion` 会对「unknown 窄化断言」记告警，既有测试里那些
 * 是历史存量，新用例不再添。
 */
function 取(根: unknown, 路径: string): unknown {
  let 当前: unknown = 根
  for (const 段 of 路径.split(".")) {
    if (当前 === null || typeof 当前 !== "object") return undefined
    当前 = Reflect.get(当前, 段)
  }
  return 当前
}

test("get_citation 明细行：材料定位取材料的项目内路径，extras 备注原样回显", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#2" })
  // 深等：`rowNo` 必须是数字（实现写成字符串 "2" 时这里红）。
  expect(取(结果.数据, "材料定位")).toEqual({ path: "甲笔录.txt", sheet: "Sheet1", rowNo: 2 })
  expect(取(结果.数据, "明细行.extras")).toEqual({ 备注: "转出工资" })
  // 行级 locator（`{sheet,row}`）不是原文区间：不编，给 null；也不该为它报「没有正文」
  // （缺口在既有用例里已断言为 []）。
  expect(取(结果.数据, "引用")).toHaveLength(1)
  expect(取(结果.数据, "引用.0.原文切片")).toBeNull()
})

test("get_citation 关系引用按 locator 切原文：切的是这一片，不是整篇", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "relation", 事实id: "r-1" })
  expect(取(结果.数据, "引用")).toHaveLength(1)
  // 逐字：前后「前言」「后记」都不许出现。
  expect(取(结果.数据, "引用.0.原文切片")).toBe("2026年2月20日，李四向张三账户6222021234567890123转账8000元。")
  // 含：钉住切的是**这条关系**那一片（不是别处的同款句子）。
  expect(取(结果.数据, "引用.0.原文切片")).toContain("转账8000元")
  expect(结果.缺口).toEqual([])
})

test("get_citation 材料没有正文：原文切片 null，缺口同一份材料只说一次", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "relation", 事实id: "r-2" })
  expect(取(结果.数据, "引用")).toHaveLength(2)
  expect(取(结果.数据, "引用.0.原文切片")).toBeNull()
  expect(取(结果.数据, "引用.1.原文切片")).toBeNull()
  expect(结果.缺口.filter((句) => 句.includes("没有原文正文"))).toHaveLength(1)
})

test("get_citation locator 越过正文：夹到末尾并在缺口里写明", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "relation", 事实id: "r-跨" })
  expect(取(结果.数据, "引用.0.原文切片")).toBe("短正文")
  expect(结果.缺口.join()).toContain("locator 超出原文长度，已夹到末尾")
})

test("get_citation locator 不是 {start,end}：正文存在也不拿整篇充数", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "event", 事实id: "ev-2" })
  expect(取(结果.数据, "引用.0.原文切片")).toBeNull()
  // 这一条是「不编」而不是「没有正文」：正文有，缺的是可用的区间定位。
  expect(结果.缺口.join()).not.toContain("没有原文正文")
})

test("get_citation 材料不存在：材料定位给 null，引用照样返回", async () => {
  // 行仍可存在（库里刻意没有外键）；材料没了就不编路径。
  await insertFactRows(库(), [
    {
      projectId: 身份丁.projectId,
      materialId: "m-已删",
      sheet: "Sheet1",
      rowNo: 9,
      counterparty: "甲",
      amount: "1.00",
      balance: "2.00",
    },
  ])
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-已删#Sheet1#9" })
  expect(取(结果.数据, "材料定位")).toBeNull()
  expect(结果.缺口.join()).toContain("给不出材料定位")
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
  const 结果 = await aggregate_money(ctx(身份戊), { 账户: "张三" })
  // §9.1「不进统计」管到汇总与对手方：对手方被排除 ⇒ 那块为空；三块都空 ⇒ R5 下 `数据` 为 null。
  // 去掉端点过滤时这里会变成 { 汇总: [出 1 笔 100.00], 对手方: [号X…] }，断言才红。
  expect(结果.数据).toBeNull()
  // 张三在戊里没有任何「持有」关系（转账对象实体被排除、不计入）⇒ 空原因按判定表第 3 条。
  // 这条用例守的是「已排除实体不外泄」，空原因跟着判定表走，不是回归。
  expect(结果.空原因).toBe("实体没有关联账户")
  expect(JSON.stringify(结果)).not.toContain("号X")
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

// —— 任务 11：七字段信封（摘要 / 数据 / 口径 / 缺口 / 空原因 / 出处 / 下一步）——
// 每个工具两条：有数据、空数据。空数据那条用**真的查不到**的条件命中空分支，
// 不靠默认值满足断言（`#005-47`）。

test("search_materials 七字段：有数据时摘要/出处/下一步齐全，空原因为 null", async () => {
  const 结果 = await search_materials(ctx(身份甲), { 关键词: "张三" })
  expect(结果.摘要).toContain("命中 1 份材料")
  expect(结果.空原因).toBeNull()
  expect(结果.出处).toEqual([{ 事实: "命中材料「张三笔录.txt」", 代表: "m-甲", 可下钻: "query_rows" }])
  // `query_rows` 的 `材料` 必填：建议必须把它填成命中那份材料的 id，否则模型照抄必失败（I-1）。
  expect(结果.下一步[0]?.工具).toBe("query_rows")
  expect(结果.下一步[0]?.参数).toHaveProperty("材料")
  expect((结果.下一步[0]?.参数 as { 材料?: string }).材料).toBe("m-甲")
  expect(结果.缺口).toEqual([])
})

test("search_materials 七字段：查不到 ⇒ 无匹配行，数据/出处空、下一步仍有", async () => {
  const 结果 = await search_materials(ctx(身份甲), { 关键词: "绝无此词" })
  expect(结果.摘要).toContain("没有材料命中「绝无此词」")
  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toEqual([])
  expect(结果.出处).toEqual([])
  expect(结果.下一步[0]?.工具).toBe("query_entities")
})

test("query_entities 七字段：有数据时摘要含数量与首个实体，出处可下钻", async () => {
  const 结果 = await query_entities(ctx(身份甲), {})
  expect(结果.摘要).toContain("找到 1 个实体")
  expect(结果.摘要).toContain("王五")
  expect(结果.空原因).toBeNull()
  expect(结果.出处).toEqual([{ 事实: "实体「王五」", 代表: "e-好", 可下钻: "get_citation" }])
  // `query_relations` 全参数可选，但既然给了实体就该用首个规范值（I-1 / M-5）。
  expect(结果.下一步[0]?.工具).toBe("query_relations")
  expect(结果.下一步[0]?.参数).toHaveProperty("实体")
  expect((结果.下一步[0]?.参数 as { 实体?: string }).实体).toBe("王五")
})

test("query_entities 七字段：查不到 ⇒ 无匹配行，数据/出处空", async () => {
  const 结果 = await query_entities(ctx(身份甲), { 关键词: "查无此实体" })
  expect(结果.摘要).toContain("没有实体匹配")
  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toEqual([])
  expect(结果.出处).toEqual([])
  expect(结果.下一步[0]?.工具).toBe("search_materials")
})

test("query_relations 七字段：有数据时摘要给条数与端点数", async () => {
  const 结果 = await query_relations(ctx(身份丁), { 实体: "甲" })
  expect(结果.摘要).toContain("3 条关系")
  expect(结果.摘要).toContain("涉及 3 个端点")
  expect(结果.空原因).toBeNull()
  expect(结果.出处.length).toBe(3)
  // `times` 为 null 时不许渲染成「null 次」（M-1）；排序使 r-跨（有 last_at）排第一。
  expect(结果.出处[0]?.事实).toBe("关系 甲→乙，次数未知")
  expect(JSON.stringify(结果.出处)).not.toContain("null")
  // `aggregate_money` 的 `账户` 必填：必须用首个关系的端点填满（I-1）。
  expect(结果.下一步[0]?.工具).toBe("aggregate_money")
  expect(结果.下一步[0]?.参数).toHaveProperty("账户")
  expect((结果.下一步[0]?.参数 as { 账户?: string }).账户).toBe("甲")
})

test("query_relations 七字段：条件无命中 ⇒ 无匹配行，数据/出处空、不给不可执行的下一步", async () => {
  // 张三在戊里是「人」、零「持有」关系；项目**没有任何材料** ⇒ `未解析材料数 === 0`，
  // 「材料已翻译」闸不会替类型闸挡刀。这样两条闸（`可判持有` 与「人 / 组织」）都真的在起作用：
  // - 删掉 `可判持有 &&` ⇒ 实体没有关联账户（本用例红）；
  // - 类型过滤是「不存在的类型」⇒ 第 3 条不该生效，兜底「无匹配行」（R-Y）。
  //
  // ⚠️ 丁项目不能用于这条：它有 5 份 `createMaterial` 建的材料（默认 `未入队`），
  // `未解析材料数 > 0` ⇒ `已翻译` 闸先挡住第 3 条，删掉 `可判持有` 用例仍绿（T3 复审 D1 的假绿）。
  // 把丁的五份材料都走 `runJob` 置为已解析会连带删掉种子里的引用（`deleteCitationsOfMaterial`），
  // 是 brief 允许退开的那种级联。戊按构造没有材料，等价于「材料全部已翻译」。
  const 结果 = await query_relations(ctx(身份戊), { 实体: "张三", 类型: "不存在的类型" })
  expect(结果.摘要).toContain("没有关系命中")
  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toEqual([])
  expect(结果.出处).toEqual([])
  // 没有关系可拿端点 ⇒ 填不出 `aggregate_money` 必填的 `账户`，宁可一条建议都不给（I-1）。
  expect(结果.下一步).toEqual([])
})

test("query_relations 下一步的账户取查询实体的规范值，不是首条 from_value", async () => {
  // 丁里与「乙」相关的两条有效关系都是 甲→乙：首条 from_value 恒为「甲」，
  // 拿它当账户就是给错实体（A3）；查询主体「乙」的规范值才是对的。
  const 结果 = await query_relations(ctx(身份丁), { 实体: "乙" })
  expect((结果.数据 as unknown[]).length).toBe(2)
  expect(结果.下一步[0]?.工具).toBe("aggregate_money")
  expect(结果.下一步[0]?.参数).toEqual({ 账户: "乙" })
  // 没给 `实体` 时不知道查询主体是谁 ⇒ 不拿任意端点编户名（下一步留空）。
  expect((await query_relations(ctx(身份丁), {})).下一步).toEqual([])
})

test("query_events 七字段：有数据时摘要取最近一个（排序为 desc，首条最新）", async () => {
  const 结果 = await query_events(ctx(身份戊), {})
  // 三个事件按 occurred_at 倒序：ev-排参(300) → ev-单(200) → ev-同(100)
  expect(结果.摘要).toContain("3 个事件")
  expect(结果.摘要).toContain("最近一个是「含已排除实体」")
  expect(结果.空原因).toBeNull()
  expect(结果.出处.length).toBe(3)
  // `get_citation` 的 `事实类型` / `事实id` 必填，且必须指向最近那个事件（I-1）。
  expect(结果.下一步[0]?.工具).toBe("get_citation")
  expect(结果.下一步[0]?.参数).toEqual({ 事实类型: "event", 事实id: "ev-排参" })
})

test("query_events 七字段：类型无命中 ⇒ 无匹配行，数据/出处空、不给不可执行的下一步", async () => {
  const 结果 = await query_events(ctx(身份丁), { 类型: "不存在的事件类型" })
  expect(结果.摘要).toContain("时间窗内没有事件")
  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toEqual([])
  expect(结果.出处).toEqual([])
  // 一条事件都没有 ⇒ 抽验建议与结果自相矛盾（I-1）。
  expect(结果.下一步).toEqual([])
})

// Task 4 / 09 §4.5：`地点` 不是事件表的维度。传了它必须**明确拒答**（能力未就绪），
// 不许静默忽略后按时间窗返回事件——那会把「某地点发生了什么」答成「这段时间的所有事」。
test("query_events 带地点 ⇒ 能力未就绪，数据 null、缺口与下一步非空", async () => {
  const 结果 = await query_events(ctx(身份丁), { 地点: "城东宾馆" })
  expect(结果.摘要).toContain("按地点检索")
  expect(结果.空原因).toBe("能力未就绪")
  expect(结果.数据).toBeNull()
  // 缺口要说清「为什么答不了」，不能只说一句能力未就绪。
  expect(结果.缺口.length).toBeGreaterThan(0)
  expect(结果.缺口[0]).toContain("地点维度")
  // 下一步必须可执行：给替代查询，而不是空数组。
  expect(结果.下一步.length).toBeGreaterThan(0)
  expect(结果.下一步[0]?.工具).toBe("query_events")
  // 没给起止时参数必须是 `{}`：无条件写 `参数.起 = undefined` 会序列化成「键在值空」，
  // 模型原样回传时可能被当成「给了起」。同款写法见 `openhive-case-mcp-rows.test.ts:210/240`。
  expect(结果.下一步[0]?.参数).toEqual({})
  // `toEqual` 忽略值为 undefined 的键（`{ 起: undefined }` 与 `{}` 相等），单靠上一行钉不住空键：
  // 必须再看键集合，否则无条件赋值时用例如样绿（`#003-03`：变异要能红）。
  expect(Object.keys(结果.下一步[0].参数)).toEqual([])
})

test("query_events 带地点与时间窗 ⇒ 下一步参数原样带回起止（可直接重跑）", async () => {
  const 结果 = await query_events(ctx(身份丁), { 地点: "城东宾馆", 起: 100, 止: 200 })
  expect(结果.空原因).toBe("能力未就绪")
  expect(结果.下一步[0]?.参数).toEqual({ 起: 100, 止: 200 })
})

// 反向窗口本身就是坏入参：若先回「能力未就绪」，给出的下一步（原样带起止）重跑即抛
// `bad_input`，等于建议一个跑不通的查询。时间窗校验必须在地点判定之前。
test("query_events 地点 + 反向窗口 ⇒ bad_input（不给重跑即错的下一步）", async () => {
  // 用 `.catch` 取抛出的错误：`await expect(...).rejects` 在 bun 的类型里被当成非 Promise，
  // 会新增一条既有的 `await-thenable` 告警（:918 那处就有），不要为一条用例扩大告警面。
  const 错误 = await query_events(ctx(身份丁), { 地点: "城东宾馆", 起: 200, 止: 100 }).catch(
    (错误: unknown) => 错误,
  )
  expect(错误).toMatchObject({ code: "bad_input" })
})

test("get_citation 七字段（row 分支）：数据永不为空，空原因恒 null", async () => {
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#2" })
  expect(结果.摘要).toBe("明细行原文：m-甲#Sheet1#2")
  expect(结果.空原因).toBeNull()
  expect(结果.出处).toEqual([{ 事实: "明细行定位 m-甲#Sheet1#2", 代表: "m-甲#Sheet1#2", 可下钻: null }])
  // `query_rows` 的 `材料` 必填：必须带出这一行的材料 id（I-1）。
  expect(结果.下一步[0]?.工具).toBe("query_rows")
  expect(结果.下一步[0]?.参数).toEqual({ 材料: "m-甲" })
  // 有引用时缺口为空数组
  expect(结果.缺口).toEqual([])
})

test("get_citation 七字段（非 row）：引用为 0 条进缺口，不写成空原因", async () => {
  // e-乙 存在但没有种引用：数据非空 ⇒ 镜像校验不允许「空原因」；「没有引用」只能进缺口。
  const 结果 = await get_citation(ctx(身份丁), { 事实类型: "entity", 事实id: "e-乙" })
  expect(结果.摘要).toBe("entity 引用详情：e-乙")
  expect(结果.数据).not.toBeNull()
  expect(结果.空原因).toBeNull()
  expect(结果.缺口).toEqual(["该事实暂无引用记录"])
  expect(结果.出处).toEqual([{ 事实: "entity e-乙", 代表: "e-乙", 可下钻: null }])
  expect(结果.下一步).toEqual([])
})

test("aggregate_money 七字段：有数据时摘要给笔数/合计/对手数/明细行数", async () => {
  const 结果 = await aggregate_money(ctx(身份戊), { 账户: 账号 })
  expect(结果.摘要).toContain("出 1 笔 / 1000.00 元")
  expect(结果.摘要).toContain("入 1 笔 / 2500.50 元")
  // 对手方按「对手 + 方向」分组会出两行「对手甲」，但对手只有 1 个（I-2）。
  expect(结果.摘要).toContain("1 个对手")
  expect(结果.摘要).toContain("明细 4 行")
  expect(结果.空原因).toBeNull()
  expect(结果.出处).toEqual([
    { 事实: `账户「${账号}」的转账汇总`, 代表: 账号, 可下钻: "query_rows" },
  ])
  // 汇总来自关系（type=转账），下一步必须指向关系而不是明细行（A2）。
  expect(结果.下一步[0]?.工具).toBe("query_relations")
  expect(结果.下一步[0]?.参数).toEqual({ 实体: 账号, 类型: "转账" })
})

test("aggregate_money 对手个数按去重对手方计：两个不同对手 ⇒ 2（不是 3 行）", async () => {
  const 结果 = await aggregate_money(ctx(身份对手), { 账户: 账号对手 })
  // 汇总按方向分组；两个数逐字钉住（变异：`new Set(...).size` 写死 1 时下一句红）。
  expect(结果.摘要).toContain("出 2 笔 / 400.00 元")
  expect(结果.摘要).toContain("入 1 笔 / 200.00 元")
  // 对手方按「对手 + 方向」分组出 3 行，去重后才是 2 个对手（按行数计会成 3）。
  expect(结果.摘要).toContain("2 个对手")
  expect((结果.数据 as { 对手方: unknown }).对手方).toEqual([
    { 对手方: "对手乙二", 方向: "出", 笔数: 1, 合计: "300.00" },
    { 对手方: "对手甲二", 方向: "入", 笔数: 1, 合计: "200.00" },
    { 对手方: "对手甲二", 方向: "出", 笔数: 1, 合计: "100.00" },
  ])
})

test("aggregate_money 有数据时缺口不追加「三者都为空」", async () => {
  const 结果 = await aggregate_money(ctx(身份戊), { 账户: 账号 })
  // 反向用例：无条件追加时这条会红（M-6）。
  expect(结果.缺口.join()).not.toContain("三者都为空")
})

test("aggregate_money 七字段：无转账也无明细 ⇒ 数据 null（对象型不返回空壳）", async () => {
  // 号码实体：第 1、2 条只认「账户」（R-Y 的类型闸），第 3 条只认人 / 组织 ⇒ 全部不命中，
  // 项目里也没有未解析材料 ⇒ 兜底 `无匹配行`。这里守的是兜底值与空信封的七字段形状。
  const 账户 = "13800001111"
  const 结果 = await aggregate_money(ctx(身份戊), { 账户 })
  expect(结果.摘要).toContain("没有任何转账关系或明细流水")
  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toBeNull()
  expect(结果.出处).toEqual([])
  expect(结果.缺口.join()).toContain("三者都为空")
  // `query_entities` 全参数可选，但带上原始账户名才有用（I-1）。
  expect(结果.下一步[0]?.工具).toBe("query_entities")
  expect(结果.下一步[0]?.参数).toEqual({ 关键词: 账户 })
})

test("find_crossings 七字段：有数据时摘要给共同关联/共同时空数量", async () => {
  const 结果 = await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })
  expect(结果.摘要).toContain("共同关联 1 个、共同时空 1 条")
  expect(结果.空原因).toBeNull()
  expect(结果.出处).toEqual([
    { 事实: "「张三」与「李四」的交叉", 代表: "e-张三", 可下钻: "get_citation" },
  ])
  // `query_events` 全参数可选（I-1），保持空参数即可。
  expect(结果.下一步[0]?.工具).toBe("query_events")
  expect(结果.下一步[0]?.参数).toEqual({})
})

test("find_crossings 有数据时缺口不追加「都为空」", async () => {
  const 结果 = await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" })
  // 反向用例：无条件追加时这条会红（M-6）。
  expect(结果.缺口.join()).not.toContain("都为空")
})

test("find_crossings 七字段：两边都无交集 ⇒ 数据 null，缺口说明", async () => {
  const 结果 = await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "对手甲" })
  expect(结果.摘要).toContain("没有共同关联，也没有共同时空")
  expect(结果.空原因).toBe("无匹配行")
  expect(结果.数据).toBeNull()
  expect(结果.出处).toEqual([])
  expect(结果.缺口.join()).toContain("都为空")
  // `query_relations` 全参数可选，但仍用甲侧实体填进去（I-1）。
  expect(结果.下一步[0]?.工具).toBe("query_relations")
  expect(结果.下一步[0]?.参数).toEqual({ 实体: "张三" })
})

// —— Task 5 B3：`下一步` / `出处.可下钻` 必须 ⊆ 已注册工具名 ——
// 人工核对挡不住漂移：`query_rows` 未注册时 `下一步` 就已经指向过它。这里遍历 `工具名`
// 注册表里的全部 11 个工具的真实返回值（有数据 + 空数据各一条），把违规项收集起来
// `toEqual([])`——失败时一眼看出是谁指向了什么。
test("所有工具返回的 下一步 / 出处.可下钻 都指向已注册的工具名", async () => {
  const 已注册 = new Set(工具名 as readonly string[])
  // P4 三个数据源档案工具也要进入守卫（覆盖集合从 `工具名` 派生，不能手写名单绕过）。
  // 独立项目：写档案 / 撤销不会改掉别的用例的档案列表断言（`#005-34`）。
  const 身份档案 = { userId: "u-工具-甲", projectId: "p-工具-守卫-档案" }
  const 身份档案空 = { userId: "u-工具-甲", projectId: "p-工具-守卫-档案空" }
  await createMaterial(库(), {
    id: "m-守卫-档案",
    projectId: 身份档案.projectId,
    fileName: "守卫档案.xlsx",
    kind: "资金",
    fingerprint: "fp-守卫-档案",
    path: "守卫档案.xlsx",
  })
  await 库().execute(sql`
    update auth.case_material
       set format_fingerprints = ${JSON.stringify([{ 工作表: "Sheet1", 指纹: "fp-守卫-档案" }])}::text::jsonb
     where project_id = ${身份档案.projectId} and id = 'm-守卫-档案'
  `)
  await 库().execute(sql`
    insert into auth.case_table_format
      (project_id, fingerprint, header, mapping, method, unknown_columns, result, hit_count, created_at, updated_at)
    values (${身份档案.projectId}, 'fp-守卫-档案',
            ${JSON.stringify(["交易时间", "交易金额", "对方户名"])}::text::jsonb,
            ${JSON.stringify({ "0": "startedAt", "1": "amount", "2": "counterpartyName" })}::text::jsonb,
            '词典', 0,
            ${JSON.stringify({ 来源: {}, 待确认: [], 方法: "词典", 未知列: 0 })}::text::jsonb,
            0, 0, 0)
  `)
  const 档案列表 = await list_source_profiles(ctx(身份档案空), {})
  const 建档案 = await build_source_profile(ctx(身份档案), { 材料: "m-守卫-档案", 名称: "守卫档案" })
  // 用类型守卫取 id（不写 `as` 断言：本仓 oxlint 会把新断言记成一条新告警）。
  const 建数据 = 建档案.数据
  if (typeof 建数据 !== "object" || 建数据 === null || !("id" in 建数据)) {
    throw new Error("建档返回里没有 id")
  }
  const 撤销档案 = await revoke_source_profile(ctx(身份档案), { 档案: String(建数据.id) })
  // 每条都带工具名：既检查违规，也检查「有没有哪个工具漏了真实返回」（见末尾防漏断言）。
  const 结果们: { 工具: 工具名; 结果: 工具结果 }[] = [
    { 工具: "search_materials", 结果: await search_materials(ctx(身份甲), { 关键词: "张三" }) },
    { 工具: "search_materials", 结果: await search_materials(ctx(身份甲), { 关键词: "绝无此词" }) },
    { 工具: "query_entities", 结果: await query_entities(ctx(身份甲), {}) },
    { 工具: "query_entities", 结果: await query_entities(ctx(身份甲), { 关键词: "查无此实体" }) },
    { 工具: "query_relations", 结果: await query_relations(ctx(身份丁), { 实体: "甲" }) },
    {
      工具: "query_relations",
      结果: await query_relations(ctx(身份丁), { 实体: "甲", 类型: "不存在的类型" }),
    },
    { 工具: "query_events", 结果: await query_events(ctx(身份戊), {}) },
    { 工具: "query_events", 结果: await query_events(ctx(身份丁), { 类型: "不存在的事件类型" }) },
    { 工具: "aggregate_money", 结果: await aggregate_money(ctx(身份戊), { 账户: 账号 }) },
    { 工具: "aggregate_money", 结果: await aggregate_money(ctx(身份戊), { 账户: "李四" }) },
    // 第 11 个工具：必须有真实返回进入守卫（覆盖集合从 `工具名` 派生，缺了这条会指出漏了谁）。
    { 工具: "money_flow", 结果: await money_flow(ctx(身份戊), { 账户: 账号 }) },
    // 空数据（李四没有任何关系/明细）：空原因分支也要有真实返回进入守卫。
    { 工具: "money_flow", 结果: await money_flow(ctx(身份戊), { 账户: "李四" }) },
    {
      工具: "find_crossings",
      结果: await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "李四" }),
    },
    {
      工具: "find_crossings",
      结果: await find_crossings(ctx(身份戊), { 甲: "张三", 乙: "对手甲" }),
    },
    {
      工具: "get_citation",
      结果: await get_citation(ctx(身份丁), { 事实类型: "entity", 事实id: "e-甲" }),
    },
    {
      工具: "get_citation",
      结果: await get_citation(ctx(身份丁), { 事实类型: "row", 事实id: "m-甲#Sheet1#2" }),
    },
    { 工具: "query_rows", 结果: await query_rows(ctx(身份戊), {}) },
    { 工具: "query_rows", 结果: await query_rows(ctx(身份戊), { 账户: "不存在的账户" }) },
    { 工具: "query_timeline", 结果: await query_timeline(ctx(身份丁), { 实体: "参与人" }) },
    // 第 10 个工具：人 / 账户（有数据）+ 空数据（独立空项目）各一条。
    { 工具: "explore_entity", 结果: await explore_entity(ctx(身份戊), { 实体: "张三" }) },
    { 工具: "explore_entity", 结果: await explore_entity(ctx(身份戊), { 实体: 账号 }) },
    {
      工具: "explore_entity",
      结果: await explore_entity(ctx({ userId: "u-工具-甲", projectId: "p-工具-空" }), {
        实体: "查无此实体",
      }),
    },
    // P4：三个数据源档案工具各一条真实返回（list 空项目 / build / revoke）。
    { 工具: "list_source_profiles", 结果: 档案列表 },
    { 工具: "build_source_profile", 结果: 建档案 },
    { 工具: "revoke_source_profile", 结果: 撤销档案 },
  ]
  const 违规: string[] = []
  let 检查条数 = 0
  for (const { 结果 } of 结果们) {
    for (const 条 of 结果.下一步) {
      检查条数 += 1
      if (!已注册.has(条.工具)) 违规.push(`下一步 → ${条.工具}`)
    }
    for (const 条 of 结果.出处) {
      if (条.可下钻 === null) continue
      检查条数 += 1
      if (!已注册.has(条.可下钻)) 违规.push(`出处.可下钻 → ${条.可下钻}`)
    }
  }
  expect(违规).toEqual([])
  // 防空转：一条都没检查时「没有违规」没有意义。
  expect(检查条数).toBeGreaterThan(0)
  // 三个档案工具的真实返回也要满足信封七字段（只进覆盖集合不算「有真实调用」）。
  const 信封七字段 = ["摘要", "数据", "口径", "缺口", "空原因", "出处", "下一步"] as const
  for (const 结果 of [档案列表, 建档案, 撤销档案]) {
    for (const 键 of 信封七字段) expect(键 in 结果).toBe(true)
  }
  // 非空分支也真的走过：build 建出档案、revoke 成功（否则上面三条只是空转）。
  expect(建档案.数据).toMatchObject({ created: true })
  expect(撤销档案.数据).toEqual({ ok: true })
  // 防漏：期望覆盖集合从 `工具名` 注册表派生（不手写名单），每个注册工具都必须有真实
  // 返回进入本守卫。删掉 explore_entity 的三条（或将来新增工具忘了加）时，这条会指出
  // 漏了谁，而不是让违规检查空转通过。
  const 覆盖次数 = new Map<工具名, number>(工具名.map((名) => [名, 0]))
  for (const { 工具 } of 结果们) 覆盖次数.set(工具, (覆盖次数.get(工具) ?? 0) + 1)
  const 未覆盖 = [...覆盖次数].filter(([, 次]) => 次 === 0).map(([名]) => 名)
  expect(未覆盖).toEqual([])
})

// —— I1：`query_rows` 自己按字节预算取页，续页游标落在**真正交付的**最后一行 ——
// 服务端截断发生在工具写完 摘要 / 出处 / 下一步 之后，而游标按未截断页尾签发：
// 若工具整页返回、服务端截掉尾部，被截掉的行用游标永远取不回来（§3.4 / `09` §4.4）。
test("query_rows 大页按 30 KB 字节预算自限：摘要行数与数据一致、续页不漏行", async () => {
  type 行 = { 定位: string; 备注: string | null }
  const 行们 = (结果: 工具结果) => 结果.数据 as 行[]
  const 全页 = Array.from({ length: 大页行数 }, (_, i) => `${大页材料}#Sheet1#${i + 1}`)

  const 第一 = await query_rows(ctx(身份大页), { 材料: 大页材料, 限制: 200 })
  const 数据1 = 行们(第一)
  // ① 工具自限：交付序列化 ≤ 30 KB（口径与 §3.4 一致：紧凑 JSON 的 byteLength）。
  expect(Buffer.byteLength(JSON.stringify(第一.数据))).toBeLessThanOrEqual(30 * 1024)
  expect(数据1.length).toBeGreaterThan(0)
  // 真的退让了：整页 40 行本来 > 30 KB，不截就会原样 40 行。
  expect(数据1.length).toBeLessThan(大页行数)
  // ② 摘要 / 出处按**交付的**行算：模型看到的行数必须等于数据里实际有几行。
  expect(第一.摘要).toContain(`取到 ${数据1.length} 行明细`)
  expect(第一.摘要).toContain("还有下一页")
  expect(第一.出处.map((条) => 条.代表)).toEqual(数据1.slice(0, 5).map((行) => 行.定位))
  // ③ 退让必须写进缺口（只说「还有下一页」不够：模型不知道本页已被字节上限砍过）。
  expect(第一.缺口.at(-1)).toContain(`只取前 ${数据1.length} 行`)
  expect(第一.缺口.at(-1)).toContain(`原请求 ${大页行数} 行`)
  // ④ 游标只从 `下一步` 拿，由内核按**真正交付的**最后一行签发。
  const 翻页 = 第一.下一步.find((条) => 条.工具 === "query_rows")
  expect(翻页).toBeDefined()
  expect(typeof (翻页!.参数 as { 游标?: unknown }).游标).toBe("string")

  const 第二 = await query_rows(ctx(身份大页), 翻页!.参数 as Parameters<typeof query_rows>[1])
  const 数据2 = 行们(第二)
  // 两页无交集，并集 == 种子全部行：被字节上限挡下的行不会永久跳过。
  const 第一定位 = new Set(数据1.map((行) => 行.定位))
  expect(数据2.some((行) => 第一定位.has(行.定位))).toBe(false)
  expect(第二.出处.some((条) => 第一.出处.some((甲) => 甲.代表 === 条.代表))).toBe(false)
  const 全部 = [...数据1, ...数据2].map((行) => 行.定位)
  expect(全部).toEqual(全页)
  expect(new Set(全部).size).toBe(大页行数)
})

// —— T7a D3：`未解析材料数` 的**消费端**回归 ——
// 单一口径在 `case-row-query.ts:333`（`distinct on (path)` 只认最新一行 + 排除产物）；
// `case-mcp-tools.ts` 只是转发。若有人把它改回自写 `count(*)`，本文件既有用例全绿——
// 因为没有一个项目同时有「旧行未入队 + 新行已解析」的同 path 材料。
test("aggregate_money 同 path 重传：只认最新一行的解析状态，不把旧「未入队」行当未解析材料", async () => {
  const 旧 = await getMaterial(库(), 身份重传.projectId, 重传旧材料)
  const 新 = await getMaterial(库(), 身份重传.projectId, 重传新材料)
  // 前提先钉住：两行同 path，旧行「未入队」、新行「已解析」——否则这条用例测不到 `distinct on`。
  expect(旧?.path).toBe(新?.path)
  expect(旧?.parseStatus).toBe("未入队")
  expect(新?.parseStatus).toBe("已解析")

  const 结果 = await aggregate_money(ctx(身份重传), { 账户: 重传账号 })
  expect(结果.空原因).toBeNull()
  // 不用 `as` 窄化 `unknown`（本仓 oxlint 会记一条新告警）：`toMatchObject` 同时钉住
  // 「非空、且就是那一笔」。
  expect(结果.数据).toMatchObject({ 汇总: [{ 方向: "出", 笔数: 1, 合计: "100.00" }] })
  // 最新一行已解析 ⇒ 项目里**没有**未解析材料：摘要 / 缺口 / 下一步都不许报「未翻译」。
  const 全文 = JSON.stringify(结果)
  expect(全文).not.toContain("材料未翻译")
  expect(全文).not.toContain("份材料尚未解析")
})

// —— T7a B7：`kind <> '产物'` 的例外在 mcp 侧（`case-row-query.test.ts:333` 只覆盖了明细行出口）——
test("aggregate_money 只有产物材料：产物不算待翻译，空结果不许答「材料未翻译」", async () => {
  const 结果 = await aggregate_money(ctx(身份产物), { 账户: 产物账户 })
  // 产物按设计永不解析（design §5.5）：账户在材料里没有出现，应落判定表第 2 条，
  // 而不是因为「有一份未入队的产物」被第 4 条改口成「项目内资金材料未翻译」。
  expect(结果.空原因).toBe("账户未在材料中出现")
  expect(结果.数据).toBeNull()
  expect(结果.摘要).not.toContain("材料还没翻译完")
  expect(结果.缺口).not.toContain("1 份材料尚未解析，其中可能含资金流水")
})

// —— P4-A Task 4：`query_events` 按用途查（`01` §3.11.6） ——
// 用途种子落在独立项目：往既有项目里加事件会改掉 `query_events` 的条数断言（`#005-34`）。
describe("query_events 按用途查（P4-A / 01 §3.11.6）", () => {
  const 身份用途 = { userId: "u-工具-甲", projectId: "p-用途-查" }
  const 身份用途旧 = { userId: "u-工具-甲", projectId: "p-用途-旧" }

  test("一级与二级都能过滤，返回里带 purpose 与依据", async () => {
    await 库().execute(sql`
      insert into auth.case_event (id, project_id, type, occurred_at, trust_state, created_at,
                                   purpose, purpose_l1, purpose_basis)
      values ('e-p1', 'p-用途-查', '资金交易', 1762387200, '自动抽取', 0,
              '停车', '消费', '{"规则":"消费.停车","命中":"P云","字段":"备注原文","词表":"v1.0"}'::jsonb),
             ('e-p2', 'p-用途-查', '资金交易', 1762387300, '自动抽取', 0,
              '转账', '转账', '{"规则":"转账.转账","命中":null,"字段":null,"词表":"v1.0"}'::jsonb)
    `)
    const 按二级 = await query_events(ctx(身份用途), { 用途: "停车" })
    expect(按二级.摘要).toContain("1 个事件")
    expect(按二级.数据).toHaveLength(1)
    const 二级行 = (按二级.数据 as { purpose: string; purpose_basis: Record<string, unknown> }[])[0]!
    expect(二级行.purpose).toBe("停车")
    // basis 原样带出（不脱敏、不截断）：模型要靠「规则 / 命中 / 词表」解释判定。
    expect(二级行.purpose_basis).toMatchObject({ 规则: "消费.停车", 词表: "v1.0" })
    // 口径要说清匹配的是哪两列、以及不参与文本扫描。
    expect(按二级.口径).toContain("purpose_l1")
    // 一级查询必须挑一条 `purpose ≠ 一级类` 的行（e-p1 的 purpose 是「停车」）：只比 `purpose`
    // 时这条会红。简报原稿用「转账」（purpose 也正好是一级类），钉不住 `or purpose_l1`（`#003-03`）。
    const 按一级 = await query_events(ctx(身份用途), { 用途: "消费" })
    expect(按一级.数据).toHaveLength(1)
    expect((按一级.数据 as { purpose_l1: string }[])[0]!.purpose_l1).toBe("消费")
    // 参数白名单在服务端 `收参数`：直接调工具测不到「模型传来的键被服务端丢掉」，
    // 必须经过一次分发入口（`#004-09`：门在入口，白名单漏键要能红）。
    const 经分发 = await 分发表.query_events(ctx(身份用途), { 用途: "停车" })
    expect((经分发.数据 as { purpose: string }[]).map((行) => 行.purpose)).toEqual(["停车"])
  })

  test("不认识的用途 fail-closed，并列出可用类", async () => {
    // 用 `.catch` 取抛出的错误（与 :1612 同法）：`rejects` 在 bun 的类型里被当成非 Promise，
    // 会新增一条 `await-thenable` 告警。
    const 错误 = await query_events(ctx(身份用途), { 用途: "餐饮费" }).catch((错误: unknown) => 错误)
    // 类名写错必须当场拒：静默返回空集时「查无结果」与「类名写错」无法区分（fail-closed）。
    expect(错误).toMatchObject({ code: "bad_input" })
    // 用 `instanceof` 窄化而不是 `as Error`：断言失败时这条会明确指出「没抛错或抛的不是 Error」。
    if (!(错误 instanceof Error)) throw new Error("未知的用途必须在取数前抛错")
    expect(错误.message).toContain("不认识的用途")
    expect(错误.message).toContain("餐饮")
  })

  test("用途传空串也 fail-closed，不能静默返回全量事件", async () => {
    // 空串（含纯空白）trim 后为空 = 传了但没给值。旧实现 `!== ""` 把它当「没传」跳过过滤，
    // 用户会拿到全量事件并以为已按用途筛过（fail-open）。经 `分发表` 入口：参数白名单在服务端。
    const 错误 = await 分发表.query_events(ctx(身份用途), { 用途: "  " }).catch((错误: unknown) => 错误)
    expect(错误).toMatchObject({ code: "bad_input" })
    if (!(错误 instanceof Error)) throw new Error("用途空串必须在取数前抛错")
    // 断具体文案：删掉空串校验后会落到「不认识的用途」，这句能区分「真的拒了空串」。
    expect(错误.message).toContain("用途不能为空")
  })

  test("用途为空且全项目都没判过 ⇒ 空原因「用途未结构化」", async () => {
    await 库().execute(sql`
      insert into auth.case_event (id, project_id, type, occurred_at, trust_state, created_at)
      values ('e-old', 'p-用途-旧', '资金交易', 1762387200, '自动抽取', 0)
    `)
    const r = await query_events(ctx(身份用途旧), { 用途: "停车" })
    expect(r.数据).toEqual([])
    // 「确实没有停车消费」与「这批数据还没判过用途」必须分开答（`09` §4.2）。
    expect(r.空原因).toBe("用途未结构化")
    expect(r.摘要).toContain("1 个事件还没有用途判定")
    expect(r.下一步.length).toBeGreaterThan(0)
    // 补判分支必须自己说清「没判过的卡片不参与过滤」，不能沿用主口径含糊过去。
    expect(r.口径).toContain("没有判过")
  })
})
