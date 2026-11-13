import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import {
  aggregate_money,
  money_flow,
  余额走势截断缺口,
  type 工具上下文,
} from "../../src/server/openhive/case-mcp-tools"
import {
  insertEvent,
  insertParticipants,
  insertRelation,
  upsertEntity,
} from "../../src/server/openhive/case-fact-store"
import {
  种P3数据集,
  种多对手数据集,
  种无参与者数据集,
  种他者参与者数据集,
  种无时间数据集,
  种金额乱序数据集,
  type P3数据集,
  type 多对手数据集,
  type 老数据数据集,
  type 他者参与者数据集,
  type 无时间数据集,
  type 金额乱序数据集,
} from "../fixtures/p3/dataset"

/**
 * `money_flow`（09 §4.2）：某账户的资金流。
 *
 * 汇总 / 对手方 / 外币行数 / 空原因 / 时间窗 / 账户解析全部复用 `aggregate_money`；
 * 本工具只补首末（其实也由汇总 SQL 的窗口聚合给出）、集中度、单笔最大。
 * 数据走生产入口（`#006-35`），不裸种事实表；多对手 / 老数据各自独立项目（`#005-34`）。
 */

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: P3数据集
let 多对手: 多对手数据集
let 老数据: 老数据数据集
let 他者: 他者参与者数据集
let 无时间: 无时间数据集
let 金额乱序: 金额乱序数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-资金流"

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种P3数据集(db(), 文件)
  多对手 = await 种多对手数据集(db(), 文件)
  老数据 = await 种无参与者数据集(db(), 文件)
  他者 = await 种他者参与者数据集(db(), 文件)
  无时间 = await 种无时间数据集(db(), 文件)
  金额乱序 = await 种金额乱序数据集(db(), 文件)
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db(): Queryable {
  if (!库) throw new Error("真库没起来")
  return 库
}

function ctx(项目 = 数据集.projectId): 工具上下文 {
  return { db: db(), 身份: { userId: 用户, projectId: 项目 } }
}

type 对手行 = {
  对手方: string
  方向: string
  笔数: number
  合计: string
  首: number | null
  末: number | null
}
type 流数据 = {
  笔数: number
  收入合计: string
  支出合计: string
  首末: { 首: number | null; 末: number | null }
  汇总: { 方向: string; 笔数: number; 合计: string }[]
  对手排行: 对手行[]
  单笔最大: { id: string; 金额: string; 时间: number | null }[]
  集中度: Record<string, string>
  外币行数: number
}

describe("money_flow", () => {
  test("B：入 3 笔 35000、收支分列、首末、对手排行（含首末）、单笔最大、集中度", async () => {
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as 流数据
    expect(数据.笔数).toBe(3)
    expect(数据.收入合计).toBe("35000.00")
    expect(数据.支出合计).toBe("0.00")
    expect(数据.首末).toEqual({ 首: 1774972800, 末: 1775181600 })
    // I2：对手排行带组内首末（09 §4.2 / 11 §6 的数据契约）。
    expect(数据.对手排行).toEqual([
      {
        对手方: "张三",
        方向: "入",
        笔数: 3,
        合计: "35000.00",
        首: 1774972800,
        末: 1775181600,
      },
    ])
    expect(数据.单笔最大.map((条) => 条.金额)).toEqual(["20000.00", "10000.00"])
    expect(数据.集中度).toEqual({ 入: "100.0%" })
    expect(数据.外币行数).toBe(1)
    // 单笔口径是整句契约，不是关键词（C1：时间窗同样作用于单笔最大）。
    expect(结果.缺口).toContain(
      "单笔最大取资金交易事件（CNY、未排除、经基 1 涉及本账户），同样受时间窗限制（occurred_at 不在窗口内或无时间的事件不入榜）；方向按参与者角色（付款方 / 收款方）过滤；只有笔录人工关系、没有对应流水事件的笔不在榜上",
    )
    // 上游 `aggregate_money` 的余额走势缺口与本工具交付无关，不许整份透传（T7/T8 口径）。
    expect(结果.缺口).not.toContain(余额走势截断缺口)
  })

  test("与 aggregate_money 逐数相等（汇总 / 首末 / 对手方 / 外币行数同一口径）", async () => {
    const 流 = await money_flow(ctx(), { 账户: 数据集.账号.A })
    // 显式同参数比较：对手上限 20 与含首末都是内部选项，不显式传会拿默认 cap 10 比 20（m6）。
    const 汇总结果 = await aggregate_money(
      ctx(),
      { 账户: 数据集.账号.A },
      { 对手方上限: 20, 含首末: true },
    )
    const 流数据 = 流.数据 as 流数据
    const 汇总数据 = 汇总结果.数据 as {
      汇总: 流数据["汇总"]
      首末: 流数据["首末"]
      对手方: 对手行[]
      外币行数: number
    }
    expect(流数据.对手排行).toEqual(汇总数据.对手方)
    expect(流数据.汇总).toEqual(汇总数据.汇总)
    expect(流数据.首末).toEqual(汇总数据.首末)
    expect(流数据.外币行数).toBe(汇总数据.外币行数)
  })

  test("方向=付：所选方向没有人民币转账 ⇒ 汇总为空但空原因为 null，缺口说清", async () => {
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B, 方向: "付" })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as 流数据
    expect(数据.汇总).toEqual([])
    expect(数据.支出合计).toBe("0.00")
    // 整句全等（实得文案）：弱断言 `toContain("所选方向")` 挡不住文案漂移。
    expect(结果.缺口.at(-1)).toBe("所选方向（付）在本时间窗内没有人民币转账关系")
  })

  test("方向=收 + 对手=张三：只留入账", async () => {
    // 设计 09 §4.2 / 11 §6 的 `方向` 取值是 收 / 付 / 全部（brief 的用例写成了 aggregate_money
    // 的「入」，与同一 brief 的实现代码冲突；按设计取「收」）。
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B, 方向: "收", 对手: "张三" })
    const 数据 = 结果.数据 as 流数据
    expect(数据.对手排行).toHaveLength(1)
    expect(数据.单笔最大).toHaveLength(2)
  })

  test("C1 起止作用于单笔最大：止=1775059199 只剩 10000 那笔", async () => {
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B, 止: 1775059199 })
    const 数据 = 结果.数据 as 流数据
    // 20000 那笔发生在 4/3（1775181600 > 止），不许出现在窗口内的「大额」里。
    expect(数据.单笔最大.map((条) => 条.金额)).toEqual(["10000.00"])
    expect(数据.汇总).toEqual([{ 方向: "入", 笔数: 1, 合计: "10000.00" }])
  })

  test("C2 对手过滤作用于汇总：A 与陈三没有人民币往来 ⇒ 汇总与支出合计都归零", async () => {
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.A, 对手: "陈三" })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as 流数据
    // 修复前：汇总 = 出 3 笔 35000（全账户口径），同时缺口说「与所选对手没有往来」。
    expect(数据.汇总).toEqual([])
    expect(数据.支出合计).toBe("0.00")
    expect(数据.笔数).toBe(0)
    expect(数据.对手排行).toEqual([])
    expect(结果.缺口).toContain("与所选对手没有符合条件的往来")
    // N1：账户本身有 35000 出入 ⇒ 不许写「所选方向…没有人民币转账关系」（那是假话），
    // 这条空只能归因到「与所选对手没有往来」。整段子集全等，避免并列出现。
    expect(结果.缺口.filter((句) => 句.includes("没有人民币转账关系"))).toEqual([])
    expect(结果.缺口.at(-1)).toBe("与所选对手没有符合条件的往来")
  })

  test("I1 集中度分母取汇总方向合计（25 对手：300/520 = 57.7%，不是 300/470）", async () => {
    const 结果 = await money_flow(ctx(多对手.项目), { 账户: 多对手.主账号 })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as 流数据
    expect(数据.汇总).toEqual([{ 方向: "入", 笔数: 25, 合计: "520.00" }])
    expect(数据.收入合计).toBe("520.00")
    // 对手排行截到 20 条；分母若用这 20 条之和（470.00）会得到 63.8%。
    expect(数据.对手排行).toHaveLength(20)
    expect(数据.集中度).toEqual({ 入: "57.7%" })
  })

  test("C2 多对手：对手=对手1 时汇总 / 收支合计同步缩到该对手", async () => {
    const 结果 = await money_flow(ctx(多对手.项目), { 账户: 多对手.主账号, 对手: "对手1" })
    const 数据 = 结果.数据 as 流数据
    expect(数据.汇总).toEqual([{ 方向: "入", 笔数: 1, 合计: "100.00" }])
    expect(数据.笔数).toBe(1)
    expect(数据.收入合计).toBe("100.00")
    expect(数据.支出合计).toBe("0.00")
    // 单笔最大与首末也同口径缩到所选对手（计划 D-5：对手作用于四块，不只汇总）。
    expect(数据.首末).toEqual({ 首: 1780279200, 末: 1780279200 })
    expect(数据.单笔最大.map((条) => 条.金额)).toEqual(["100.00"])
    // 夹具只给对手账户落了户名别名、没有同名「人」实体 ⇒ 展示按规范值回落账号
    // （`账户展示名` 的 fail-closed 口径；本用例只关心金额口径缩没缩）。
    expect(数据.对手排行).toEqual([
      {
        对手方: 多对手.对手账号们[0]!,
        方向: "入",
        笔数: 1,
        合计: "100.00",
        首: 1780279200,
        末: 1780279200,
      },
    ])
    expect(数据.集中度).toEqual({ 入: "100.0%" })
  })

  test("对手5：首末与单笔最大同缩（全量最大 100.00、全量首 1780279200 / 末 1782352800）", async () => {
    const 结果 = await money_flow(ctx(多对手.项目), { 账户: 多对手.主账号, 对手: "对手5" })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as 流数据
    // 对不上「没缩」：全量最大是 100.00、全量首末跨 25 天；对手5 只有 06-05 的 10.00 一笔。
    expect(数据.单笔最大.map((条) => 条.金额)).toEqual(["10.00"])
    expect(数据.首末).toEqual({ 首: 1780624800, 末: 1780624800 })
    expect(数据.汇总).toEqual([{ 方向: "入", 笔数: 1, 合计: "10.00" }])
  })

  test("对手只在参与者表、不在 participants 文本时也命中（基 1 共享谓词）", async () => {
    // 生产确实会写出「本账户靠文本归属、对手靠参与者表」的事件（`case-translate-store.ts`）：
    // 旧实现手抄 `unnest(participants) = any(对手值们)`，会把这笔漏掉 ⇒ 单笔最大 []。
    const 项目 = "p-资金流对手表"
    const 主值 = "6222021234567897900"
    const 对手值 = "6222021234567897901"
    const 主 = await upsertEntity(db(), {
      projectId: 项目,
      id: "e-对手表-主",
      type: "账户",
      canonicalValue: 主值,
      aliases: [],
    })
    const 对手 = await upsertEntity(db(), {
      projectId: 项目,
      id: "e-对手表-对手",
      type: "账户",
      canonicalValue: 对手值,
      aliases: [],
    })
    // 关系让 aggregate_money 非空 ⇒ money_flow 不走空分支。
    await insertRelation(db(), {
      projectId: 项目,
      id: "r-对手表",
      fromId: 对手,
      toId: 主,
      type: "转账",
      amount: 100,
      times: 1,
      sourceKind: "data",
      trustState: "自动抽取",
    })
    await insertEvent(db(), {
      projectId: 项目,
      id: "ev-对手表",
      type: "资金交易",
      occurredAt: 1780279200,
      occurredRaw: null,
      precision: null,
      amount: "999.00",
      // 故意不含对手值：命中只能靠参与者表里的 entity_id。
      participants: [主值],
      summary: "对手表付款",
      trustState: "自动抽取",
    })
    await insertParticipants(db(), [
      {
        projectId: 项目,
        id: "ev-对手表#p0",
        eventId: "ev-对手表",
        entityId: 主,
        role: "收款方",
        mentionText: 主值,
        citationId: null,
        ordinal: 0,
      },
      {
        projectId: 项目,
        id: "ev-对手表#p1",
        eventId: "ev-对手表",
        entityId: 对手,
        role: "付款方",
        mentionText: 对手值,
        citationId: null,
        ordinal: 1,
      },
    ])
    const 结果 = await money_flow(ctx(项目), { 账户: 主值, 对手: 对手值 })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as 流数据
    expect(数据.单笔最大.map((条) => 条.金额)).toEqual(["999.00"])
  })

  test("C3 老数据（无参与者行）：方向不可判 ⇒ fail-closed 排除并写进缺口", async () => {
    const 无方向 = await money_flow(ctx(老数据.项目), { 账户: 老数据.主账号 })
    const 无方向数据 = 无方向.数据 as 流数据
    // 文本回退仍能认出事件（不是「事件没了」）。
    expect(无方向数据.单笔最大.map((条) => 条.金额)).toEqual(["500.00"])

    const 有方向 = await money_flow(ctx(老数据.项目), { 账户: 老数据.主账号, 方向: "收" })
    expect(有方向.空原因).toBeNull()
    const 有方向数据 = 有方向.数据 as 流数据
    // 关系侧汇总仍是入 1 笔 500：方向过滤只影响事件榜，不能与汇总自相矛盾地「空且无话」。
    expect(有方向数据.汇总).toEqual([{ 方向: "入", 笔数: 1, 合计: "500.00" }])
    expect(有方向数据.单笔最大).toEqual([])
    expect(有方向.缺口).toContain("1 条资金交易事件没有参与者角色，无法按方向过滤")
  })

  test("N2 有别人的参与者行、本账户只能靠文本归属：方向不可判也要写进缺口", async () => {
    const 全部 = await money_flow(ctx(他者.项目), { 账户: 他者.主账号 })
    const 全部数据 = 全部.数据 as 流数据
    // 文本回退认得出事件（不是「事件没了」）。
    expect(全部数据.单笔最大.map((条) => 条.金额)).toEqual(["500.00"])

    const 有方向 = await money_flow(ctx(他者.项目), { 账户: 他者.主账号, 方向: "收" })
    const 有方向数据 = 有方向.数据 as 流数据
    expect(有方向数据.汇总).toEqual([{ 方向: "入", 笔数: 1, 合计: "500.00" }])
    expect(有方向数据.单笔最大).toEqual([])
    expect(有方向.缺口).toContain("1 条资金交易事件没有参与者角色，无法按方向过滤")
  })

  test("N3 无发生时间的资金交易事件：给窗口即排除，缺口写实际条数", async () => {
    const 无窗 = await money_flow(ctx(无时间.项目), { 账户: 无时间.主账号 })
    const 无窗数据 = 无窗.数据 as 流数据
    expect(无窗数据.单笔最大.map((条) => 条.金额)).toEqual(["700.00"])

    const 有窗 = await money_flow(ctx(无时间.项目), { 账户: 无时间.主账号, 止: 1790000000 })
    const 有窗数据 = 有窗.数据 as 流数据
    expect(有窗数据.单笔最大).toEqual([])
    expect(有窗数据.汇总).toEqual([{ 方向: "入", 笔数: 1, 合计: "700.00" }])
    expect(有窗.缺口).toContain("1 条资金交易事件没有发生时间，已按时间窗排除")
  })

  test("单笔最大按数值排序：字符串序会先选出 9000 / 50000，12 笔只取数值前 10", async () => {
    const 结果 = await money_flow(ctx(金额乱序.项目), { 账户: 金额乱序.主账号 })
    expect(结果.空原因).toBeNull()
    const 数据 = 结果.数据 as 流数据
    // 旧实现 `order by amount`（绑定 text 别名）实得：
    // ["9000.00","8000.00","7000.00","6000.00","50000.00","5000.00","4000.00","3000.00","20000.00","100000.00"]
    // 入选集合与顺序都错（100000 差点被挤掉、3000 混进来）。
    expect(数据.单笔最大.map((条) => 条.金额)).toEqual([
      "100000.00",
      "50000.00",
      "30000.00",
      "20000.00",
      "9000.00",
      "8000.00",
      "7000.00",
      "6000.00",
      "5000.00",
      "4000.00",
    ])
    expect(结果.缺口).toContain("单笔最大已截到前 10 条，可能还有更多")
  })

  test("查询次数钉住（含 C1 / C3 / N1 新增计数的分档）", async () => {
    const 计次 = async (参数: Parameters<typeof money_flow>[1]): Promise<number> => {
      let 次 = 0
      const 柄 = {
        execute: async (...执行参数: Parameters<Queryable["execute"]>) => {
          次++
          return db().execute(...执行参数)
        },
      }
      const 结果 = await money_flow(
        { db: 柄 as Queryable, 身份: { userId: 用户, projectId: 数据集.projectId } },
        参数,
      )
      expect(结果.空原因).toBeNull()
      return 次
    }
    // 默认：aggregate_money 11 + 账户再解析 1 + 单笔最大 1 = 13。
    expect(await 计次({ 账户: 数据集.账号.B })).toBe(13)
    // C3：方向多一条「无参与者行」计数 ⇒ 14。
    expect(await 计次({ 账户: 数据集.账号.B, 方向: "收" })).toBe(14)
    // C1：时间窗多一条「无 occurred_at」计数 ⇒ 14。
    expect(await 计次({ 账户: 数据集.账号.B, 止: 1775059199 })).toBe(14)
    // C2/N1：解析对手 1 + 账户全量汇总 1 ⇒ 15（对手谓词换共享函数后不再读归属值）。
    expect(await 计次({ 账户: 数据集.账号.B, 对手: "张三" })).toBe(15)
  })
})

// 缺口 #19（01 §3.8.4）：`money_flow` 是账户查询、`aggregate_money` 已标三档，
// 但成功路径重建信封时把 `身份` 与摘要后缀丢了（空路径 `{ ...汇总结果 }` 反而带着）。
describe("缺口 #19：资金流信封的身份三档", () => {
  test("成功路径：带身份档，摘要接后缀（与 aggregate_money 同源）", async () => {
    const 结果 = await money_flow(ctx(), { 账户: 数据集.账号.B })
    expect(结果.空原因).toBeNull()
    expect(结果.身份).toHaveLength(1)
    expect(结果.身份?.[0]?.实体).toBe(数据集.账号.B)
    expect(结果.身份?.[0]?.档).toBe("户名匹配")
    expect(结果.摘要).toContain("未核实身份")
  })

  test("空路径：信封仍带身份档（不许因本次改动丢）", async () => {
    // 独立项目 + 自己造账户：`-t` 单跑这条时不依赖别的用例（`#005-34`）。
    await upsertEntity(db(), {
      id: "e-无往来",
      projectId: "p-资金空档",
      type: "账户",
      canonicalValue: "6222020000000999",
      aliases: [],
    })
    const 结果 = await money_flow(ctx("p-资金空档"), { 账户: "6222020000000999" })
    expect(结果.空原因).not.toBeNull()
    expect(结果.身份?.[0]?.档).toBe("无匹配")
  })
})
