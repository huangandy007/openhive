import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  query_relations,
  type 工具上下文,
} from "../../src/server/openhive/case-mcp-tools"
import { insertRelation, upsertEntity } from "../../src/server/openhive/case-fact-store"
import { 种探索数据集, type 探索数据集 } from "../fixtures/explore/dataset"

/**
 * 空原因四拆（`09` §3.5 的第 1–4 条）：证据驱动，按表序命中即用。
 *
 * 回放表（`openhive-case-explore-replay.test.ts`）也覆盖同样四个值，但它是**问题级**断言；
 * 这里直接调工具函数，把每条判据的**决定性证据**单独钉住（`#003-04`：实测要能当场复现）。
 *
 * 数据集只经生产出口种下（`种探索数据集`），不裸写事实表（`#006-28` / `#006-35`）。
 *
 * 起库方式与 `openhive-case-explore-seed.test.ts` / `openhive-case-relation-time.test.ts`
 * 一致：`startProductionDb()` 撑 PGlite，再自建 `PG_POOL_MAX=1` 的客户端。
 */
let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined
let 库: ReturnType<typeof connect> | undefined
let 数据集: 探索数据集
const 文件 = new Map<string, Uint8Array>()
const 用户 = "u-explore"
/**
 * 主项目里一个「既不是人、也不是账户」的实体（号码），且不出现在任何明细行里：
 * 第 1–3 条都不命中，用来把判定表第 4 条走**实体存在**的那条路（不是 not_found 那条）。
 * 走生产 DAO 种，不裸写事实表。
 */
const 无证据号码 = "19900001111"
/**
 * 主项目里一个「有转账、无持有」的人：查关系时类型过滤的判据（B4）。
 * 数据集里的 5 个人都有持有关系（周八是零关系），凑不出这个前提，所以按最小夹具补两个实体 + 一条转账。
 */
const 有转账无持有 = "钱十"
const 转账对手 = "郑十一"
/**
 * 第三个项目里一个「账户、但任何事实里都没有它」的实体：判定表第 2 条前置（R-W）的判据。
 * 流水里没有这个账号，实体又得存在，才能在「材料没读全」时走到第 2 条的门口。
 */
const 部分项目空账户 = "6222021234567890099"
/**
 * 第三个项目里一个「人、没有任何持有关系」的实体：判定表第 3 条前置（第 2 轮）的判据。
 * 「实体没有关联账户」与第 1、2 条一样是对**全案数据**的否证——材料没读全时，
 * 他的账户可能就在那份未解析的流水里。
 *
 * ⚠️ 不能用「孙九」：T3 的账户语境优先把「孙九」解析成部分项目账号 H（`dataset.ts:279`
 * 里 H 的户名就是孙九）⇒ 拿到的是账号，第 3 条前置根本走不到。换一个既不是户名、
 * 也不是对手名的新名字，保留「材料没读全 ⇒ 材料未翻译」的本意（`#004-03`）。
 */
const 部分项目无账户的人 = "郑十二"
/**
 * 主项目里一个「人、有持有关系、无明细/转账」的实体：第 1 条**类型闸**的判据。
 * 不能用「张三」——张三是账号 A 的户名，T3 的账户语境优先会把它解析成账号 A，
 * 类型闸走不到（实得 `空原因=null`）。持有关系的另一端建一个本项目不查询的账户，
 * 只为让夹具符合「人—持有→账户」的生产常态（`insertRelation` 的 `basis` 是库约束）。
 */
const 类型闸人 = "郑十三"
const 类型闸账 = "6222021234567890770"
/**
 * 第三项目里一个「既不是账户也不是人」的实体（号码）：第 1–3 条的类型闸都不接它。
 * 用来钉 D4——材料没读全时，摘要不许断言「没有任何」。
 */
const 部分项目号码 = "19900002222"

/** 沪秒：与 `cases.ts` / `case-time.ts` 同一判据（Asia/Shanghai，UTC+8）。 */
const 沪秒 = (文本: string): number => Date.parse(`${文本}+08:00`) / 1000

beforeAll(async () => {
  pg = await startProductionDb()
  库 = connect({ ...process.env, PG_POOL_MAX: "1" })
  await migrate(库)
  数据集 = await 种探索数据集(db(), 文件)
  await upsertEntity(db(), {
    id: "e-空号",
    projectId: 数据集.projectId,
    type: "号码",
    canonicalValue: 无证据号码,
    aliases: [],
  })
  await upsertEntity(db(), {
    id: "e-钱十",
    projectId: 数据集.projectId,
    type: "人",
    canonicalValue: 有转账无持有,
    aliases: [],
  })
  await upsertEntity(db(), {
    id: "e-郑十一",
    projectId: 数据集.projectId,
    type: "人",
    canonicalValue: 转账对手,
    aliases: [],
  })
  // 第三个项目的流水只有明细行、不产实体（表格入库不建实体），而 `aggregate_money` 先解析实体。
  // 不给 H 建实体，调用会走 R-C 的「解析不到 + 有未解析材料」信封，第 1 条前置就测不到了。
  await upsertEntity(db(), {
    id: "e-部分H",
    projectId: 数据集.部分解析项目,
    type: "账户",
    canonicalValue: 数据集.账号.H,
    aliases: [],
  })
  await upsertEntity(db(), {
    id: "e-部分空账户",
    projectId: 数据集.部分解析项目,
    type: "账户",
    canonicalValue: 部分项目空账户,
    aliases: [],
  })
  await upsertEntity(db(), {
    id: "e-部分郑十二",
    projectId: 数据集.部分解析项目,
    type: "人",
    canonicalValue: 部分项目无账户的人,
    aliases: [],
  })
  await upsertEntity(db(), {
    id: "e-部分号码",
    projectId: 数据集.部分解析项目,
    type: "号码",
    canonicalValue: 部分项目号码,
    aliases: [],
  })
  // 第 1 条类型闸的夹具：人 + 一条持有关系（无明细、无转账）。持有关系必须带 basis。
  await upsertEntity(db(), {
    id: "e-郑十三",
    projectId: 数据集.projectId,
    type: "人",
    canonicalValue: 类型闸人,
    aliases: [],
  })
  await upsertEntity(db(), {
    id: "e-郑十三账",
    projectId: 数据集.projectId,
    type: "账户",
    canonicalValue: 类型闸账,
    aliases: [],
  })
  await insertRelation(db(), {
    id: "r-郑十三持有",
    projectId: 数据集.projectId,
    fromId: "e-郑十三",
    toId: "e-郑十三账",
    type: "持有",
    basis: "笔录称其名下账户",
    sourceKind: "human",
    trustState: "自动抽取",
  })
  await insertRelation(db(), {
    id: "r-钱十转账",
    projectId: 数据集.projectId,
    fromId: "e-钱十",
    toId: "e-郑十一",
    type: "转账",
    amount: 100,
    sourceKind: "data",
    trustState: "自动抽取",
    firstAt: 沪秒("2026-02-18T10:00:00"),
    lastAt: 沪秒("2026-02-18T10:00:00"),
    precision: "到秒",
    times: 1,
  })
})

afterAll(async () => {
  await 库?.$client.close()
  await pg?.stop()
})

function db() {
  if (!库) throw new Error("真库没起来")
  return 库
}

function ctx(projectId: string = 数据集.projectId): 工具上下文 {
  return { db: db(), 身份: { userId: 用户, projectId } }
}

describe("资金空原因：判定表 1→4（09 §3.5）", () => {
  test("第 1 条：账户有持有证据、窗内 0 笔转账 ⇒ 确实没有交易", async () => {
    // D 是张三次账户：只有「张三—持有→D」一条关系，无明细、无转账。
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.D })
    expect(结果.空原因).toBe("确实没有交易")
    expect(结果.数据).toBeNull()
  })

  test("第 2 条：账户在实体表、任何事实里都没有它 ⇒ 账户未在材料中出现", async () => {
    // G 只注册了实体，无持有、无转账、无明细行。
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.G })
    expect(结果.空原因).toBe("账户未在材料中出现")
    expect(结果.数据).toBeNull()
  })

  test("第 3 条：人是实体但没有任何持有关系 ⇒ 实体没有关联账户", async () => {
    // 周八：人实体，笔录里明写「名下没有任何银行账户」，零关系零事件。
    const 结果 = await aggregate_money(ctx(), { 账户: "周八" })
    expect(结果.空原因).toBe("实体没有关联账户")
    expect(结果.数据).toBeNull()
  })

  test("第 4 条：实体解析不到但项目里有未解析材料 ⇒ 项目内资金材料未翻译（不抛 not_found）", async () => {
    // 副项目只有一份排队中的流水、零实体。解析实体必然 not_found；正确回答是「还没翻译完」。
    const 结果 = await aggregate_money(ctx(数据集.待解析项目), { 账户: 数据集.账号.A })
    expect(结果.空原因).toBe("项目内资金材料未翻译")
    expect(结果.数据).toBeNull()
    // 材料在认出列之前 `kind` 一律是「其他」⇒ 只能承认「可能含资金流水」，不能断言它是资金材料。
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
    expect(结果.下一步.length).toBeGreaterThan(0)
    // §5.2 纪律 3：不许把「材料没翻译」讲成「没有 / 查不到」。
    expect(结果.摘要).toContain("不能断定")
    expect(结果.摘要).not.toContain("没有任何")
  })

  test("第 1–3 条都不命中、主项目材料已全部翻译 ⇒ 兜底无匹配行，且不报未解析缺口", async () => {
    // 号码不是人 / 组织也不是账户，且不在任何明细行里 ⇒ 第 1–3 条都不成立。
    // 主项目三份材料都已解析（R-W 的夹具代价：那份排队中的流水挪去了副项目）
    // ⇒ 第 4 条也不成立，只能兜底。
    const 结果 = await aggregate_money(ctx(), { 账户: 无证据号码 })
    expect(结果.空原因).toBe("无匹配行")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).not.toContain("份材料尚未解析")
  })

  // —— T7a D4（裁定 R-AE）：**关系类**兜底摘要是可达的自相矛盾处 ——
  // 号码实体第 1–3 条都不接；关系类判定**没有第 4 条** ⇒ 第三项目还有 1 份排队中材料时，
  // `空原因` 落 `无匹配行`、缺口写「1 份材料尚未解析」，而摘要若还说「没有关系命中」，
  // 就是在没读全的项目上下「没有」的断言（`09` §5.2 纪律 2）。
  // 资金类没有这个问题：第 4 条先命中 `项目内资金材料未翻译`，兜底不可达（见裁定 R-AE）。
  test("关系兜底摘要：材料没读全时不说「没有关系命中」（号码实体 + 第三项目）", async () => {
    const 结果 = await query_relations(ctx(数据集.部分解析项目), { 实体: 部分项目号码 })
    expect(结果.空原因).toBe("无匹配行")
    expect(结果.数据).toEqual([])
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
    expect(结果.摘要).not.toContain("没有关系命中")
    expect(结果.摘要).toContain("未解析")
  })

  test("第 1 条前置：材料没读全 ⇒ 不答「确实没有交易」，答「项目内资金材料未翻译」", async () => {
    // H 在 2026-03-01 有明细行（有存在证据），但 2 月底之前窗内 0 笔转账。
    // 没有「已翻译」前置时第 1 条会误命中「确实没有交易」——材料没读全时这是错话。
    const 结果 = await aggregate_money(ctx(数据集.部分解析项目), {
      账户: 数据集.账号.H,
      止: 沪秒("2026-02-28T23:59:59"),
    })
    expect(结果.空原因).toBe("项目内资金材料未翻译")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
  })

  test("第 2 条前置：材料没读全 ⇒ 不答「账户未在材料中出现」", async () => {
    // 空账户在实体表里、任何事实里都没有它——材料已翻译时第 2 条成立；
    // 但第三个项目还有排队中的材料，没读全就不能说「没出现」。
    const 结果 = await aggregate_money(ctx(数据集.部分解析项目), { 账户: 部分项目空账户 })
    expect(结果.空原因).toBe("项目内资金材料未翻译")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
  })

  test("第 3 条前置：材料没读全 ⇒ 不答「实体没有关联账户」", async () => {
    // 郑十二是「人」、没有任何持有关系——材料已翻译时第 3 条成立；
    // 但第三个项目还有排队中的材料，没读全就不能说「没有关联账户」。
    const 结果 = await aggregate_money(ctx(数据集.部分解析项目), { 账户: 部分项目无账户的人 })
    expect(结果.空原因).toBe("项目内资金材料未翻译")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
  })

  test("非空结果也报「未翻译」缺口（未翻译不阻断取数）", async () => {
    // 2026-03-01 那份已解析流水里就有 H 的明细 ⇒ 数据非空、空原因为 null；
    // 但项目里还有一份排队中的材料，缺口必须说清「没读全」。
    const 结果 = await aggregate_money(ctx(数据集.部分解析项目), {
      账户: 数据集.账号.H,
      起: 沪秒("2026-03-01T00:00:00"),
      止: 沪秒("2026-03-01T23:59:59"),
    })
    expect(结果.空原因).toBeNull()
    expect(结果.数据).not.toBeNull()
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
  })

  test("第 1 条的类型闸：人是实体、有持有关系 ⇒ 不答「确实没有交易」", async () => {
    // 郑十三有 1 条持有关系、无明细行、窗内 0 笔转账。没有类型闸时第 1 条会误命中
    // 「确实没有交易」——但他不是账户，这句回答对「人」不成立。
    // 不能用「张三」：那是账号 A 的户名，账户语境优先会把它解析成账号（T3 语义变化）。
    const 结果 = await aggregate_money(ctx(), { 账户: 类型闸人 })
    expect(结果.空原因).toBe("无匹配行")
    expect(结果.数据).toBeNull()
  })

  test("正向：主项目 A 有 5 笔转账 ⇒ 空原因仍是 null（第 1 条不是万能兜底）", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    expect(结果.空原因).toBeNull()
    expect(结果.数据).not.toBeNull()
  })
})

describe("资金外币隔离（09 §3.5 总表 / §4.2 `外币行数` / §4.5 第 2 条）", () => {
  /**
   * 全外币：账户 F（赵六）的两行明细都是 USD（`dataset.ts` 的 2/25 300、2/26 200）。
   * 账户 F 没有任何 `转账` 关系，余额走势过滤掉外币后又为空 ⇒ 三块全空。
   * 空原因必须是 `外币行全部未计入`（表序：`项目内资金材料未翻译` 之后、`无匹配行` 之前），
   * 不是兜底、更不是第 1 条的「确实没有交易」——窗口里明明有 2 笔流水，只是不计入人民币口径。
   */
  test("全外币：空原因=外币行全部未计入、数据 null、缺口写外币行数、摘要不否认流水", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.F })
    expect(结果.空原因).toBe("外币行全部未计入")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("2 行非人民币未计入")
    // 有外币行时不能同时声称「也无明细流水」——窗口里明明有流水（只是不计入人民币口径）。
    expect(结果.缺口.join()).not.toContain("也无明细流水")
    // §5.2 纪律 2：不许把「只有外币行」讲成「没有任何流水」。
    expect(结果.摘要).not.toContain("没有任何")
    expect(结果.摘要).toContain("2 行外币流水")
  })

  /**
   * 混合：账户 A（张三主账户）7 行明细里 5 行 CNY、2 行 USD。
   * `外币行数` 必须报 2；`余额走势.行数` 只数人民币行（口径变化：改前是 7）。
   */
  test("混合币种：外币行数=2、余额走势只数人民币行（5 行）、缺口写明未计入", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    expect(结果.空原因).toBeNull()
    // 不用 `as` 窄化 `unknown`：本仓 oxlint 会记一条新告警（`toMatchObject` 同样能钉这两个值）。
    expect(结果.数据).toMatchObject({ 外币行数: 2, 余额走势: { 行数: 5 } })
    expect(结果.缺口.join()).toContain("2 行非人民币未计入")
  })

  /**
   * T7a 覆盖缺口：**带时间窗 + 有外币行**。F 的两行 USD 分别在 2/25（300）与 2/26（200）：
   * 窗口只圈 2/25 ⇒ 外币计数必须是 1（与余额走势同窗），不是全时段的 2。
   * 变异：把外币计数的 `明细基础条件` 换成不带时间窗的条件 ⇒ 计数变 2，本条红在「1 行」。
   */
  test("带时间窗：外币计数与余额走势同窗（只圈 2/25 ⇒ 1 行外币、数据 null）", async () => {
    const 结果 = await aggregate_money(ctx(), {
      账户: 数据集.账号.F,
      起: 沪秒("2026-02-25T00:00:00"),
      止: 沪秒("2026-02-25T23:59:59"),
    })
    expect(结果.空原因).toBe("外币行全部未计入")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("本窗口内 1 行非人民币未计入汇总与余额走势")
    expect(结果.摘要).toContain("1 行外币流水")
  })
})

describe("关系空原因：只有第 3 条与兜底（09 §3.5）", () => {
  test("人没有持有关系 ⇒ 实体没有关联账户", async () => {
    const 结果 = await query_relations(ctx(), { 实体: "周八" })
    expect(结果.空原因).toBe("实体没有关联账户")
    expect(结果.数据).toEqual([])
  })

  test("账户查关系查不到 ⇒ 兜底无匹配行（不冒充「没有交易」或「未出现」）", async () => {
    const 结果 = await query_relations(ctx(), { 实体: 数据集.账号.G })
    expect(结果.空原因).toBe("无匹配行")
    expect(结果.数据).toEqual([])
  })

  // —— T7a D2：`类型 === "持有"` 的**正向**路径（`可判持有` 为真的那一支）——
  // 周八是「人」、零持有；主项目材料已全部翻译 ⇒ 第 3 条成立。
  // 变异：把 `可判持有` 改成 `类型 === undefined` ⇒ 本用例红（实得「无匹配行」）。
  test("类型过滤=持有：人零持有 ⇒ 实体没有关联账户（可判持有的正向前提）", async () => {
    const 结果 = await query_relations(ctx(), { 实体: "周八", 类型: "持有" })
    expect(结果.空原因).toBe("实体没有关联账户")
    expect(结果.数据).toEqual([])
  })

  test("第 3 条前置：材料没读全 ⇒ 兜底无匹配行，不答「实体没有关联账户」", async () => {
    // 关系类不做第 4 条（理由不变）：命中不了就是兜底，但同样不许说「没有关联账户」。
    const 结果 = await query_relations(ctx(数据集.部分解析项目), { 实体: 部分项目无账户的人 })
    expect(结果.空原因).toBe("无匹配行")
    expect(结果.数据).toEqual([])
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
  })

  test("按类型过滤后查不到 ⇒ 兜底无匹配行（不反过来说人没有账户）", async () => {
    // 前提：钱十是「人」、参与过一笔转账（有转账）、但没有持有关系。
    const 有转账 = await query_relations(ctx(), { 实体: 有转账无持有, 类型: "转账" })
    expect(有转账.空原因).toBeNull()
    const 转账数据 = 有转账.数据
    expect(Array.isArray(转账数据) ? 转账数据.length : -1).toBe(1)
    // 2027 年窗外：类型过滤 + 空结果 ⇒ 只能兜底。没有类型闸时会答「实体没有关联账户」，
    // 可它明明是「转账」过滤命不中，与账户归属无关（09 §3.5 第 3 条）。
    const 结果 = await query_relations(ctx(), {
      实体: 有转账无持有,
      类型: "转账",
      起: 沪秒("2027-01-01T00:00:00"),
      止: 沪秒("2027-12-31T23:59:59"),
    })
    expect(结果.空原因).toBe("无匹配行")
    expect(结果.数据).toEqual([])
  })
})
