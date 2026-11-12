import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import {
  aggregate_money,
  query_relations,
  type 工具上下文,
} from "../../src/server/openhive/case-mcp-tools"
import { upsertEntity } from "../../src/server/openhive/case-fact-store"
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

  test("第 4 条：实体在、但第 1–3 条都不命中且有未解析材料 ⇒ 项目内资金材料未翻译", async () => {
    // 号码不是人 / 组织也不是账户，且不在任何明细行里 ⇒ 第 1–3 条都不成立；
    // 主项目里有一份排队中的流水 ⇒ 只能答「材料没翻译」，不能答「无匹配行」。
    const 结果 = await aggregate_money(ctx(), { 账户: 无证据号码 })
    expect(结果.空原因).toBe("项目内资金材料未翻译")
    expect(结果.数据).toBeNull()
    expect(结果.缺口.join()).toContain("1 份材料尚未解析，其中可能含资金流水")
    expect(结果.摘要).toContain("不能断定")
  })

  test("正向：主项目 A 有 5 笔转账 ⇒ 空原因仍是 null（第 1 条不是万能兜底）", async () => {
    const 结果 = await aggregate_money(ctx(), { 账户: 数据集.账号.A })
    expect(结果.空原因).toBeNull()
    expect(结果.数据).not.toBeNull()
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
})
