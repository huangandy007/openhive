import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { sql } from "drizzle-orm"
import { query_rows, query_timeline, type 工具上下文 } from "../../src/server/openhive/case-mcp-tools"
import { 编码游标对象 } from "../../src/server/openhive/case-row-query"
import type { Queryable } from "../../src/server/openhive/case-store"
import { 种P3数据集, type P3数据集 } from "../fixtures/p3/dataset"
import { 建事件, 建实体 } from "./openhive-case-fact-fixture"

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-p3"

/** 2025 年窗口：项目里没有任何事件。 */
const 窗外起 = 1735660800
const 窗外止 = 1767110400

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种P3数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}
function ctx(库柄: Queryable = db(), projectId: string = 数据集.projectId): 工具上下文 {
  return { db: 库柄, 身份: { userId: 用户, projectId } }
}

/** 计数包装：`Queryable` 只有 `execute`，包一层就能钉住「最多 8 次查询」。 */
function 计数(库柄: Queryable): { db: Queryable; 次数: () => number } {
  let n = 0
  return {
    db: {
      execute: (q) => {
        n += 1
        return 库柄.execute(q)
      },
    },
    次数: () => n,
  }
}

describe("query_timeline（09 §4.3）", () => {
  test("地点分支先拒答：能力未就绪，不返回空", async () => {
    const 结果 = await query_timeline(ctx(), { 地点: "城东宾馆" })
    expect(结果.空原因).toBe("能力未就绪")
    expect(结果.数据).toBeNull()
    expect(结果.摘要).toContain("尚未支持")
  })

  test("实体与地点都不给 ⇒ bad_input", async () => {
    await expect(query_timeline(ctx(), {})).rejects.toThrow("实体与地点")
  })

  test("第一页：时间升序、缺时间条数、续页游标", async () => {
    const 结果 = await query_timeline(ctx(), { 实体: "李四", 限制: 1 })
    const 数据 = 结果.数据 as {
      事件们: { 类型: string; 时间: number; 参与者: string[] }[]
      缺时间条数: number
      下一页游标: string | null
    } | null
    expect(结果.空原因).toBeNull()
    expect(数据).not.toBeNull()
    expect(数据!.事件们).toHaveLength(1)
    // 4/1 那笔 10000 早于 4/3 的 20000、4/5 的 50 USD；升序先到 4/1。
    expect(数据!.事件们[0]!.类型).toBe("资金交易")
    expect(数据!.事件们[0]!.参与者.join()).toContain("付款方")
    expect(数据!.缺时间条数).toBe(1)
    expect(数据!.下一页游标).not.toBeNull()
    expect(结果.缺口.join()).toContain("1 个事件没有时间")
  })

  test("游标翻页：三笔有时间事件，第二页仍有游标、第三页归 null", async () => {
    const 第一页 = await query_timeline(ctx(), { 实体: "李四", 限制: 1 })
    const 游标1 = (第一页.数据 as { 下一页游标: string | null }).下一页游标
    expect(游标1).not.toBeNull()
    const 第二页 = await query_timeline(ctx(), { 实体: "李四", 限制: 1, 游标: 游标1! })
    const 数据2 = 第二页.数据 as { 事件们: { 时间: number }[]; 下一页游标: string | null } | null
    expect(第二页.空原因).toBeNull()
    expect(数据2!.事件们).toHaveLength(1)
    expect(数据2!.下一页游标).not.toBeNull()
    const 第三页 = await query_timeline(ctx(), { 实体: "李四", 限制: 1, 游标: 数据2!.下一页游标! })
    const 数据3 = 第三页.数据 as { 事件们: { 时间: number }[]; 下一页游标: string | null } | null
    expect(第三页.空原因).toBeNull()
    expect(数据3!.事件们).toHaveLength(1)
    expect(数据3!.下一页游标).toBeNull()
  })

  test("游标越过末页：空原因仍是无事件，缺口说明游标之后没有更多", async () => {
    const 结果 = await query_timeline(ctx(), {
      实体: "李四",
      游标: 编码游标对象({ t: 2147483647, id: "zzz" }),
    })
    expect(结果.空原因).toBe("无事件")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join("")).toContain("游标之后没有更多事件")
  })

  test("下一步：抽验后追加 query_rows（材料取材料 id，跟随后进入正确材料）", async () => {
    // 限制 10 > 3 笔有时间事件 ⇒ 没有下一页，`下一步` 只剩 get_citation + query_rows。
    const 结果 = await query_timeline(ctx(), { 实体: "李四", 限制: 10 })
    expect(结果.空原因).toBeNull()
    const 事件们 = (结果.数据 as { 事件们: { 时间: number }[] }).事件们
    const 最新 = 事件们[事件们.length - 1]!
    const 建议 = 结果.下一步 ?? []
    expect(建议.map((项) => 项.工具)).toEqual(["get_citation", "query_rows"])
    const 参数 = 建议[1]!.参数 as { 材料?: string; 时间起: number; 时间止: number }
    expect(参数.时间起).toBe(最新.时间)
    expect(参数.时间止).toBe(最新.时间)
    // 不看返回值自证：真调生产入口，跟随建议跑一次。
    expect(typeof 参数.材料).toBe("string")
    const 跟随 = await query_rows(ctx(), 参数)
    // 4/5 那笔是 50 USD：进入正确材料后应报「外币行全部未计入」；
    // 传文件名会报「材料未入库」——这条就是区分器。
    expect(跟随.空原因).toBe("外币行全部未计入")
  })

  test("对象存在但事件全无时间 ⇒ 时间全部缺失", async () => {
    const 结果 = await query_timeline(ctx(), { 实体: "周八" })
    expect(结果.空原因).toBe("时间全部缺失")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("1 个事件没有时间")
  })

  test("对象存在但没有任何事件 ⇒ 对象未登记", async () => {
    // `吴九` 在夹具的抽取器里声明了，但原文没出现 ⇒ 抽取层拒建，p-p3 里不存在。
    // p-p3 里能解析到的实体都落在事件参与者集合里（张三经户名对齐到账户 A）。
    // 只有 p-party 的「人李四」例外：X/Y 两个账户同名 ⇒ 对齐 fail-closed，事件里没有它。
    const 结果 = await query_timeline(ctx(db(), 数据集.对齐项目), { 实体: "李四" })
    expect(结果.空原因).toBe("对象未登记")
  })

  test("窗口内没有事件但对象有历史事件 ⇒ 无事件", async () => {
    const 结果 = await query_timeline(ctx(), { 实体: "李四", 起: 窗外起, 止: 窗外止 })
    expect(结果.空原因).toBe("无事件")
  })

  test("50 张卡片的查询预算：≤ 8 次", async () => {
    const 包装 = 计数(db())
    await query_timeline(ctx(包装.db), { 实体: "李四", 限制: 50 })
    // 解析实体 1 + 事件 1 + 统计 1 + 参与者 2（参与者表 + 已排除值）+ 出处 1 + 读身份标注 2 = 8
    expect(包装.次数()).toBeLessThanOrEqual(8)
  })

  test("户名别名解析路径的查询预算：9 次", async () => {
    // 「陈三」只在账户 C 的户名别名上、没有实体行 ⇒ 解析实体先查规范值（0 行）再走
    // `解析户名`（+1 次），比规范值命中多 1 次。账：解析 2 + 事件 1 + 统计 1 + 参与者 2
    // + 出处 1 + 读身份标注 2 = 9。
    const 包装 = 计数(db())
    const 结果 = await query_timeline(ctx(包装.db), { 实体: "陈三", 限制: 50 })
    expect(结果.空原因).toBeNull()
    expect(包装.次数()).toBe(9)
  })
})

describe("参与者摘要剔除已排除（11 §7.1）", () => {
  test("参与者表指向已排除实体时，摘要里没有它", async () => {
    await 建实体(db(), { id: "e-参与甲", projectId: "p-排除", value: "参与甲" })
    await 建实体(db(), { id: "e-中心乙", projectId: "p-排除", value: "中心乙" })
    await 建事件(db(), {
      id: "ev-排除",
      projectId: "p-排除",
      type: "资金交易",
      participants: ["中心乙", "参与甲"],
      occurredAt: 1775000000,
      参与者表: [
        { entityId: "e-中心乙", role: "付款方", ordinal: 0 },
        { entityId: "e-参与甲", role: "收款方", ordinal: 1 },
      ],
    })
    await db().execute(sql`
      update auth.case_entity set trust_state = '已排除'
       where project_id = 'p-排除' and id = 'e-参与甲'
    `)
    const 结果 = await query_timeline(ctx(db(), "p-排除"), { 实体: "中心乙" })
    const 数据 = 结果.数据 as { 事件们: { 参与者: string[] }[] } | null
    expect(结果.空原因).toBeNull()
    expect(数据!.事件们).toHaveLength(1)
    expect(数据!.事件们[0]!.参与者.join()).toContain("付款方：中心乙")
    expect(数据!.事件们[0]!.参与者.join()).not.toContain("参与甲")
  })

  test("摘要按参与者表 ordinal 升序，值保持原文", async () => {
    await 建实体(db(), { id: "e-顺序甲", projectId: "p-排除", value: "顺序甲" })
    await 建实体(db(), { id: "e-顺序乙", projectId: "p-排除", value: "顺序乙" })
    await 建事件(db(), {
      id: "ev-顺序",
      projectId: "p-排除",
      type: "资金交易",
      participants: ["顺序甲", "顺序乙"],
      occurredAt: 1775000001,
      参与者表: [
        { entityId: "e-顺序乙", role: "收款方", ordinal: 0 },
        { entityId: "e-顺序甲", role: "付款方", ordinal: 1 },
      ],
    })
    const 结果 = await query_timeline(ctx(db(), "p-排除"), { 实体: "顺序甲" })
    const 数据 = 结果.数据 as { 事件们: { 参与者: string[] }[] } | null
    expect(数据!.事件们).toHaveLength(1)
    expect(数据!.事件们[0]!.参与者).toEqual(["收款方：顺序乙", "付款方：顺序甲"])
  })

  test("有参与者表行时，未被已解析行覆盖的掩码参与者仍以「参与者：值」追加", async () => {
    // 生产会写 `entity_id = null` 的参与者行（`case-translate-store.ts:224`），同时把两个
    // 规范值都写进 `participants`（`:173`）。旧实现只要表里有已解析行就整份丢掉文本回退
    // ⇒ 掩码对手消失，而 `query_events`（用 `值`）仍看得见。
    await 建实体(db(), { id: "e-掩码甲", projectId: "p-掩码", value: "解析甲" })
    await 建事件(db(), {
      id: "ev-掩码",
      projectId: "p-掩码",
      type: "资金交易",
      participants: ["解析甲", "6222****1234"],
      occurredAt: 1780279200,
      参与者表: [
        { entityId: "e-掩码甲", role: "付款方", ordinal: 0 },
        { entityId: null, role: "收款方", ordinal: 1, mentionText: "6222****1234" },
      ],
    })
    const 结果 = await query_timeline(ctx(db(), "p-掩码"), { 实体: "解析甲" })
    const 数据 = 结果.数据 as { 事件们: { 参与者: string[] }[] } | null
    expect(结果.空原因).toBeNull()
    expect(数据!.事件们).toHaveLength(1)
    // 表行在前（按 ordinal），未被覆盖的文本值追加在后。
    expect(数据!.事件们[0]!.参与者).toEqual(["付款方：解析甲", "参与者：6222****1234"])
  })

  test("参与者表没有行时回退文本值（参与者：规范值）", async () => {
    await 建实体(db(), { id: "e-回退丙", projectId: "p-排除", value: "回退丙" })
    await 建事件(db(), {
      id: "ev-回退",
      projectId: "p-排除",
      type: "见面",
      participants: ["回退丙"],
      occurredAt: 1775000002,
    })
    const 结果 = await query_timeline(ctx(db(), "p-排除"), { 实体: "回退丙" })
    const 数据 = 结果.数据 as { 事件们: { 参与者: string[] }[] } | null
    expect(数据!.事件们).toHaveLength(1)
    expect(数据!.事件们[0]!.参与者).toEqual(["参与者：回退丙"])
  })
})
