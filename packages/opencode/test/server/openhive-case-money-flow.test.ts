import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import type { Queryable } from "../../src/server/openhive/case-store"
import {
  aggregate_money,
  money_flow,
  余额走势截断缺口,
  解析实体,
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
  种人说话数据集,
  种人说空字段数据集,
  种多对手数据集,
  种无参与者数据集,
  种他者参与者数据集,
  种无时间数据集,
  种金额乱序数据集,
  type P3数据集,
  type 人说话数据集,
  type 人说空字段数据集,
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
let 人说: 人说话数据集
let 人说空: 人说空字段数据集
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
  人说 = await 种人说话数据集(db(), 文件)
  人说空 = await 种人说空字段数据集(db(), 文件)
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
  单笔最大: { id: string; 金额: string; 时间: number | null; 精度: string | null }[]
  集中度: Record<string, string>
  外币行数: number
  人说的笔: 人说行[]
}

/** 人说的笔的行形状（契约：`aggregate_money` / `money_flow` 同形）。 */
type 人说行 = {
  id: string
  方向: string
  对手: string
  金额: string | null
  首: number | null
  末: number | null
  精度: string | null
  次数: number | null
}

describe("aggregate_money 的人说的笔", () => {
  test("笔录转账按关系行列出：方向 / 对手 / 金额 / 首末 / 精度 / 次数", async () => {
    const 数据 = (await aggregate_money(ctx(), { 账户: 数据集.账号.A })).数据 as { 人说的笔: 人说行[] }
    // 末降序：A→B 的笔录（04-02）在前，A→李四 的笔录（04-01）在后。
    // 对手都是「李四」：A→B 那条的对手是账户 B，展示名按唯一户名对齐到人「李四」
    //（与「对手方」的 coalesce 同优先序）。
    expect(数据.人说的笔).toEqual([
      {
        id: expect.any(String),
        方向: "出",
        对手: "李四",
        金额: "5000.00",
        首: expect.any(Number),
        末: expect.any(Number),
        精度: "到日",
        次数: null,
      },
      {
        id: expect.any(String),
        方向: "出",
        对手: "李四",
        金额: "10000.00",
        首: expect.any(Number),
        末: expect.any(Number),
        精度: "到日",
        次数: null,
      },
    ])
  })

  test("数据关系一条都不进人说的笔（A→B 机器合计 30000 不许出现）", async () => {
    const 数据 = (await aggregate_money(ctx(), { 账户: 数据集.账号.A })).数据 as { 人说的笔: 人说行[] }
    expect(数据.人说的笔.map((行) => 行.金额)).toEqual(["5000.00", "10000.00"])
    expect(数据.人说的笔.map((行) => 行.金额)).not.toContain("30000.00")
  })

  test("内部选项 方向：只作用于人说的笔，汇总与对手方不变", async () => {
    const 入 = await aggregate_money(ctx(), { 账户: 数据集.账号.B }, { 方向: "入" })
    const 入数据 = 入.数据 as { 人说的笔: 人说行[]; 汇总: { 方向: string; 笔数: number; 合计: string }[] }
    // B 的归属集 = {B, 李四}（李四经未撤销户名唯一对齐到 B），A→李四 的笔录也算 B 的入账
    // ⇒ 两条入向：A→B 5000（04-02）在前，A→李四 10000（04-01）在后（末降序）。
    // 这与下面的汇总 3 笔 35000 是同一口径——brief 原稿写 1 条与它自己的 SQL / 设计 §4 冲突，
    // 实得 2 条，按设计与既有 `money_flow` 用例（B 入 3 笔 35000）据实修正。
    expect(入数据.人说的笔.map((行) => [行.方向, 行.金额])).toEqual([
      ["入", "5000.00"],
      ["入", "10000.00"],
    ])
    // 汇总仍是全账户口径（方向只是明细栏的过滤，不是汇总的过滤）。
    expect(入数据.汇总).toEqual([{ 方向: "入", 笔数: 3, 合计: "35000.00" }])

    const 出 = await aggregate_money(ctx(), { 账户: 数据集.账号.B }, { 方向: "出" })
    expect((出.数据 as { 人说的笔: 人说行[] }).人说的笔).toEqual([])
  })

  test("上限 20：先按方向过滤再截断；命中上限才加缺口", async () => {
    const 全部 = await aggregate_money(ctx(人说.项目), { 账户: 人说.主账号 })
    const 全部数据 = 全部.数据 as { 人说的笔: 人说行[] }
    expect(全部数据.人说的笔).toHaveLength(20)
    // 最新的一笔是「入」（07-22）：排在第一位，同时它是最容易被「先截断」吃掉的那条。
    expect(全部数据.人说的笔[0]!.方向).toBe("入")
    expect(全部.缺口).toContain("人说的笔已截到前 20 条，可能还有更多")

    const 入 = await aggregate_money(ctx(人说.项目), { 账户: 人说.主账号 }, { 方向: "入" })
    const 入数据 = 入.数据 as { 人说的笔: 人说行[] }
    expect(入数据.人说的笔.map((行) => [行.方向, 行.对手])).toEqual([["入", "人说入账人"]])
    expect(入.缺口).not.toContain("人说的笔已截到前 20 条，可能还有更多")

    // 21 条出向、上限 20 ⇒ 20 条 + 截断缺口。若实现是「先 limit 20 再过滤」，
    // 入向那条会占掉一个名额，这里只能拿到 19 条。
    const 出 = await aggregate_money(ctx(人说.项目), { 账户: 人说.主账号 }, { 方向: "出" })
    expect((出.数据 as { 人说的笔: 人说行[] }).人说的笔).toHaveLength(20)
  })

  test("对手过滤同口径：带对手时只剩与它的往来", async () => {
    const 对手 = await 解析实体(ctx(人说.项目), 人说.对手人名们[0]!, "对手")
    const 结果 = await aggregate_money(ctx(人说.项目), { 账户: 人说.主账号 }, { 对手id: 对手.id })
    const 数据 = 结果.数据 as { 人说的笔: 人说行[] }
    expect(数据.人说的笔.map((行) => [行.方向, 行.对手, 行.金额])).toEqual([
      ["出", 人说.对手人名们[0]!, "101.00"],
    ])
  })

  test("时间窗同口径：窗口外的笔录不出现", async () => {
    const 全部 = await aggregate_money(ctx(人说.项目), { 账户: 人说.主账号 })
    const 入行 = (全部.数据 as { 人说的笔: 人说行[] }).人说的笔.find((行) => 行.方向 === "入")!
    const 窗 = await aggregate_money(ctx(人说.项目), { 账户: 人说.主账号, 止: 入行.首! - 1 })
    expect((窗.数据 as { 人说的笔: 人说行[] }).人说的笔.map((行) => 行.对手)).not.toContain("人说入账人")
  })

  test("缺金额 / 缺时间的人说笔：金额与首末回 null，不编 0、不丢行", async () => {
    const 数据 = (await aggregate_money(ctx(人说空.项目), { 账户: 人说空.主账号 })).数据 as { 人说的笔: 人说行[] }
    expect(数据.人说的笔).toHaveLength(1)
    expect(数据.人说的笔[0]).toEqual({
      id: expect.any(String),
      方向: "出",
      对手: 人说空.对手,
      金额: null,
      首: null,
      末: null,
      精度: null,
      次数: null,
    })
  })

  test("口径写明两栏各列一条、人说的笔按关系行", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    expect(结果.口径).toContain("人说的笔只列 source_kind=human 的转账关系")
    expect(结果.口径).toContain("两栏各列一条")
  })
})

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
    // 精度随行返回：表格「2026-04-01 10:00:00」解析成「到秒」，读端据此决定显不显示时分
    // （页面不得替抽取器补一个更精确的时刻，`#002-06` 同一前提单出处）。
    expect(数据.单笔最大.map((条) => 条.精度)).toEqual(["到秒", "到秒"])
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

  test("人说的笔随方向透传；摘要报笔数；人说的笔不进单笔榜", async () => {
    const 收 = await money_flow(ctx(), { 账户: 数据集.账号.B, 方向: "收" })
    const 收数据 = 收.数据 as 流数据
    // B 的账户归属集含人「李四」（唯一户名对齐）⇒ A→李四 10000 与 A→B 5000 都算 B 的「入」，
    // 共 2 条（末降序）。这也是既有「汇总 入 3 笔 35000」的构成：20000 机器 + 15000 人说的。
    expect(收数据.人说的笔.map((行) => [行.方向, 行.金额])).toEqual([
      ["入", "5000.00"],
      ["入", "10000.00"],
    ])
    expect(收.摘要).toContain("人说的 2 笔")
    // 单笔榜只认资金交易事件：5000 那笔笔录不在榜上，榜仍是两笔流水。
    expect(收数据.单笔最大.map((条) => 条.金额)).toEqual(["20000.00", "10000.00"])

    // 方向=付：人说的笔被清空（证明 `目标方向` 真的下沉到了 aggregate_money，
    // 而不是在 JS 里按汇总过滤）。
    const 付 = await money_flow(ctx(), { 账户: 数据集.账号.B, 方向: "付" })
    expect((付.数据 as 流数据).人说的笔).toEqual([])
  })

  test("人说的笔与 aggregate_money 逐行相等（同一口径，不另算一份）", async () => {
    const 流 = await money_flow(ctx(), { 账户: 数据集.账号.A })
    const 汇 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    expect((流.数据 as 流数据).人说的笔).toEqual((汇.数据 as { 人说的笔: 人说行[] }).人说的笔)
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
    // 默认：aggregate_money 12（人说的笔 +1）+ 账户再解析 1 + 单笔最大 1 = 14。
    expect(await 计次({ 账户: 数据集.账号.B })).toBe(14)
    // C3：方向多一条「无参与者行」计数 ⇒ 15。
    expect(await 计次({ 账户: 数据集.账号.B, 方向: "收" })).toBe(15)
    // C1：时间窗多一条「无 occurred_at」计数 ⇒ 15。
    expect(await 计次({ 账户: 数据集.账号.B, 止: 1775059199 })).toBe(15)
    // C2/N1：解析对手 1 + 账户全量汇总 1 ⇒ 16（对手谓词换共享函数后不再读归属值）。
    expect(await 计次({ 账户: 数据集.账号.B, 对手: "张三" })).toBe(16)
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
