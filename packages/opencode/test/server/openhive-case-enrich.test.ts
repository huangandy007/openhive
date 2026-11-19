import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { 富化, 键分类, 查案件库账号 } from "../../src/server/openhive/case-enrich"
import { 建参考库, 建外部服务客户端, type 参考条目 } from "../../src/server/openhive/case-reference-store"
import type { FactRowInput } from "../../src/server/openhive/case-store"

/**
 * 016 T012（N4 富化层）：键分类受控表 / 三类处置 / 参考库容器 / 外部服务客户端。
 *
 * 真库只用于用例 6：钉「案件库一条语句覆盖全部值」——PGlite 量不出往返，但语句数是形状，
 * 能钉住「不许循环 execute」（`#013-09` 的教训：逐行语句 = O(N×RTT)）。
 */

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

/** 最小行：用例只关心账号 / extras / 出处。 */
function 行(over: Partial<FactRowInput> = {}): FactRowInput {
  return { projectId: "prj-enrich", materialId: "m1", sheet: "表1", rowNo: 2, ...over }
}

const 账号 = "6222021234567890123"

/** 空参考库（版本仍要有值：报告要写参考库版本）。 */
function 空库(版本 = "ref-v1") {
  return 建参考库(async () => ({ 版本, 条目: [] }))
}

describe("参考类处置", () => {
  test("用例 1 · 命中 ⇒ 产属性观察（带材料#表#行 出处）", async () => {
    const 参考库 = 建参考库(async () => ({
      版本: "ref-v1",
      条目: [{ 类别: "开户行", 值: 账号, 结果: "招商银行" }] satisfies 参考条目[],
    }))
    const r = await 富化(
      { projectId: "prj-enrich", materialId: "m1", rows: [行({ ownerAccount: 账号 })] },
      { 参考库, 案件库: async () => new Map() },
    )
    expect(r.属性们).toContainEqual({ 归属: "本方", 键: "开户行", 值: "招商银行", 出处: "m1#表1#2" })
    expect(r.统计.参考库版本).toBe("ref-v1")
    expect(r.统计.补全数).toBeGreaterThan(0)
  })

  test("用例 2 · 未命中 ⇒ 留空 + 告警，函数正常 resolve 不判失败", async () => {
    const r = await 富化(
      { projectId: "prj-enrich", materialId: "m1", rows: [行({ ownerAccount: 账号 })] },
      { 参考库: 空库(), 案件库: async () => new Map() },
    )
    expect(r.属性们).toHaveLength(0)
    expect(r.告警们.length).toBeGreaterThan(0)
    expect(r.告警们.some((w) => w.键 === "开户行" && w.值 === 账号)).toBe(true)
    expect(r.告警们.every((w) => w.原因 !== "")).toBe(true)
    expect(r.统计.未补全数).toBeGreaterThan(0)
  })

  test("用例 12 · 带空格 / 横线的账号先归一化再查参考库与案件库（适配器通路）", async () => {
    // 四层通路 `toFactRows` 已归一化；适配器通路 `转换行` 不归一化 ⇒ 产键必须自己归一化，
    // 否则参考类全告警、匹配类全未匹配（静默降质）。
    const 参考库 = 建参考库(async () => ({
      版本: "ref-v1",
      条目: [{ 类别: "开户行", 值: "6222021234567890", 结果: "招商银行" }] satisfies 参考条目[],
    }))
    const 案件库收到: string[] = []
    const r = await 富化(
      { projectId: "prj-enrich", materialId: "m1", rows: [行({ ownerAccount: "6222 0212-3456 7890" })] },
      {
        参考库,
        案件库: async (值们) => {
          案件库收到.push(...值们)
          return new Map()
        },
      },
    )
    expect(r.属性们).toContainEqual({ 归属: "本方", 键: "开户行", 值: "招商银行", 出处: "m1#表1#2" })
    expect(案件库收到).toContain("6222021234567890")
  })

  test("用例 13 · 同一账号两行 ⇒ 两条观察（出处各不同），补全数按归属+键+值去重", async () => {
    const 参考库 = 建参考库(async () => ({
      版本: "ref-v1",
      条目: [{ 类别: "开户行", 值: 账号, 结果: "招商银行" }] satisfies 参考条目[],
    }))
    const r = await 富化(
      {
        projectId: "prj-enrich",
        materialId: "m1",
        rows: [行({ rowNo: 2, ownerAccount: 账号 }), 行({ rowNo: 3, ownerAccount: 账号 })],
      },
      { 参考库, 案件库: async () => new Map() },
    )
    const 开户行们 = r.属性们.filter((a) => a.键 === "开户行")
    expect(开户行们).toHaveLength(2)
    expect([...new Set(开户行们.map((a) => a.出处))].sort()).toEqual(["m1#表1#2", "m1#表1#3"])
    expect(r.统计.补全数).toBe(1)
  })
})

describe("身份类处置", () => {
  const 证件号 = "110101199001011234"

  test("用例 3 · 命中产实名核验结论；未命中进待确认且不写空值", async () => {
    const 输入 = { projectId: "prj-enrich", materialId: "m1", rows: [行({ extras: { "属性:对方:证件号": 证件号 } })] }
    const 命中 = await 富化(输入, {
      参考库: 空库(),
      案件库: async () => new Map(),
      外部服务: { 核验: async (号) => (号 === 证件号 ? "张三" : undefined) },
    })
    expect(命中.属性们).toContainEqual({ 归属: "对方", 键: "实名核验结论", 值: "张三", 出处: "m1#表1#2" })
    expect(命中.待确认们).toHaveLength(0)
    expect(命中.补全明细们.some((d) => d.依据 === "外部核验")).toBe(true)

    const 未命中 = await 富化(输入, {
      参考库: 空库(),
      案件库: async () => new Map(),
      外部服务: { 核验: async () => undefined },
    })
    expect(未命中.属性们).toHaveLength(0)
    expect(未命中.待确认们).toHaveLength(1)
    expect(未命中.待确认们[0]).toMatchObject({ 键: "证件号", 值: 证件号, 出处: "m1#表1#2", 原因: "查不到" })
    // 「不写空值」：待确认里不会出现空串结果。
    expect(未命中.待确认们.every((p) => p.值 !== "")).toBe(true)
  })

  test("用例 14 · 同一证件号在本方与对方（自转）⇒ 两条结论（归属各一），服务只问 1 次", async () => {
    let 调次 = 0
    const r = await 富化(
      {
        projectId: "prj-enrich",
        materialId: "m1",
        rows: [行({ extras: { "属性:本方:证件号": 证件号, "属性:对方:证件号": 证件号 } })],
      },
      {
        参考库: 空库(),
        案件库: async () => new Map(),
        外部服务: {
          核验: async () => {
            调次 += 1
            return "张三"
          },
        },
      },
    )
    const 结论们 = r.属性们.filter((a) => a.键 === "实名核验结论")
    expect(结论们).toHaveLength(2)
    expect(结论们.some((a) => a.归属 === "本方")).toBe(true)
    expect(结论们.some((a) => a.归属 === "对方")).toBe(true)
    // 核验缓存仍按 (键,值)：同一证件号只问一次服务。
    expect(调次).toBe(1)
  })
})

describe("匹配类处置", () => {
  test("用例 4 · 命中记匹配命中；未命中记未匹配，不告警、不进待确认", async () => {
    // 参考库把开户行 / 卡种都补齐 ⇒ 本用例的告警数组只可能来自匹配类（必须为空）。
    const 参考库 = 建参考库(async () => ({
      版本: "ref-v1",
      条目: [
        { 类别: "开户行", 值: 账号, 结果: "招商银行" },
        { 类别: "卡种", 值: 账号, 结果: "借记卡" },
      ] satisfies 参考条目[],
    }))
    const 输入 = { projectId: "prj-enrich", materialId: "m1", rows: [行({ ownerAccount: 账号 })] }

    const 命中 = await 富化(输入, { 参考库, 案件库: async () => new Map([[账号, "entity-1"]]) })
    expect(命中.匹配命中们).toContainEqual({ 类别: "账号", 值: 账号, 实体id: "entity-1" })
    expect(命中.未匹配们).toHaveLength(0)
    expect(命中.告警们).toEqual([])
    expect(命中.待确认们).toEqual([])

    const 未命中 = await 富化(输入, { 参考库, 案件库: async () => new Map() })
    expect(未命中.匹配命中们).toHaveLength(0)
    expect(未匹配们包含(未命中.未匹配们, "账号", 账号)).toBe(true)
    expect(未命中.告警们).toEqual([])
    expect(未命中.待确认们).toEqual([])
  })

  test("用例 15 · 人名取 counterpartyName / extras.ownerName，不取账号原文", async () => {
    const 案件库收到: string[][] = []
    const r = await 富化(
      {
        projectId: "prj-enrich",
        materialId: "m1",
        rows: [
          行({
            ownerAccountRaw: "6222021234567890",
            counterpartyName: "李四",
            extras: { ownerName: "张三" },
          }),
        ],
      },
      {
        参考库: 空库(),
        案件库: async (值们) => {
          案件库收到.push([...值们])
          return new Map([
            ["张三", "entity-张"],
            ["李四", "entity-李"],
          ])
        },
      },
    )
    const 值集 = new Set(案件库收到.flat())
    expect(值集.has("张三")).toBe(true)
    expect(值集.has("李四")).toBe(true)
    // `ownerAccountRaw` 是账号原文，不是人名。
    expect(值集.has("6222021234567890")).toBe(false)
    expect(r.匹配命中们).toContainEqual({ 类别: "人名", 值: "张三", 实体id: "entity-张" })
    expect(r.匹配命中们).toContainEqual({ 类别: "人名", 值: "李四", 实体id: "entity-李" })
  })
})

function 未匹配们包含(们: readonly { 类别: string; 值: string }[], 类别: string, 值: string): boolean {
  return 们.some((x) => x.类别 === 类别 && x.值 === 值)
}

describe("受控键分类表", () => {
  test("用例 5 · 未登记键 fail-closed 进身份类 ⇒ 待确认，不进参考类", async () => {
    expect(键分类("星座")).toBe("身份类")
    expect(键分类("开户行")).toBe("参考类")
    expect(键分类("账号")).toBe("匹配类")

    const r = await 富化(
      { projectId: "prj-enrich", materialId: "m1", rows: [行({ extras: { "属性:对方:星座": "天秤" } })] },
      { 参考库: 空库(), 案件库: async () => new Map() },
    )
    expect(r.待确认们).toHaveLength(1)
    expect(r.待确认们[0]).toMatchObject({ 键: "星座", 值: "天秤", 原因: "查不到" })
    // 不得当参考类静默放行：既不产观察，也不进参考类的告警。
    expect(r.属性们).toHaveLength(0)
    expect(r.告警们).toHaveLength(0)
  })
})

describe("案件库批量查询（真库 · 语句计数）", () => {
  const 项目 = "prj-enrich-count"

  test("用例 6 · 30 个不同账号 ⇒ 案件库只被调 1 次、只发 1 条语句", async () => {
    const 方言 = new PgDialect()
    const 语句们: string[] = []
    const 参数们: unknown[] = []
    const 真库 = db()
    const 记账库 = {
      execute(query: SQL) {
        const 查询 = 方言.sqlToQuery(query)
        语句们.push(查询.sql)
        参数们.push(...查询.params)
        return 真库.execute(query)
      },
    }

    let 调用次数 = 0
    const rows = Array.from({ length: 30 }, (_, i) =>
      行({
        projectId: 项目,
        materialId: "m30",
        rowNo: 2 + i,
        ownerAccount: `62220212345678${String(i).padStart(5, "0")}`,
      }),
    )
    const r = await 富化(
      { projectId: 项目, materialId: "m30", rows },
      {
        参考库: 空库(),
        案件库: async (值们) => {
          调用次数 += 1
          return 查案件库账号(记账库, 项目, 值们)
        },
      },
    )

    expect(调用次数).toBe(1)
    expect(语句们).toHaveLength(1)
    expect(语句们[0]).toContain("case_entity")
    // 30 个不同账号都真的进了同一条语句的绑定参数（`文本数组` 走 JSON 参数，不在 SQL 文本里）。
    expect(
      rows.every((row) =>
        参数们.some((p) => typeof p === "string" && p.includes(String(row.ownerAccount))),
      ),
    ).toBe(true)
    // 参考类查内存库，不发语句；匹配未命中也不发第二条。
    expect(r.未匹配们.filter((x) => x.类别 === "账号")).toHaveLength(30)
  })
})

describe("外部服务客户端", () => {
  test("用例 7 · 并发在飞峰值 ≤ 4", async () => {
    let 在飞 = 0
    let 峰值 = 0
    const 客户端 = 建外部服务客户端(
      {
        核验: async () => {
          在飞 += 1
          峰值 = Math.max(峰值, 在飞)
          await new Promise((resolve) => setTimeout(resolve, 20))
          在飞 -= 1
          return "核验通过"
        },
      },
      { 并发上限: 4 },
    )
    const 结果 = await Promise.all(Array.from({ length: 6 }, (_, i) => 客户端.核验(`证件-${i}`)))
    expect(结果).toEqual(Array.from({ length: 6 }, () => "核验通过"))
    // 6 个任务、20ms 延时足够让前 4 个同时在飞：峰值必须真的顶到上限（不是 ≤ 4 的空断言）。
    expect(峰值).toBe(4)
  })

  test("用例 16 · 超时 ⇒ undefined（服务 200ms 才有结果，超时 50ms）", async () => {
    const 客户端 = 建外部服务客户端(
      {
        核验: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return "核验通过"
        },
      },
      { 超时ms: 50 },
    )
    expect(await 客户端.核验("110101199001011234")).toBeUndefined()
  })

  test("用例 17 · 服务抛错 ⇒ undefined ＋ 至少一条 WARN（不空 catch）", async () => {
    const 客户端 = 建外部服务客户端({
      核验: async () => {
        throw new Error("boom")
      },
    })
    const 告警: unknown[][] = []
    const 原warn = console.warn
    console.warn = ((...args: unknown[]) => {
      告警.push(args)
    }) as typeof console.warn
    try {
      expect(await 客户端.核验("110101199001011234")).toBeUndefined()
    } finally {
      console.warn = 原warn
    }
    expect(告警.length).toBeGreaterThanOrEqual(1)
  })

  test("用例 8 · 未命中负缓存 10 分钟：TTL 内不再问服务，过期后再问", async () => {
    let 调用 = 0
    let 现在 = 1_000
    const 客户端 = 建外部服务客户端(
      {
        核验: async () => {
          调用 += 1
          return undefined
        },
      },
      { 现在秒: () => 现在 },
    )
    expect(await 客户端.核验("110101199001011234")).toBeUndefined()
    expect(await 客户端.核验("110101199001011234")).toBeUndefined()
    expect(调用).toBe(1)

    现在 += 601
    expect(await 客户端.核验("110101199001011234")).toBeUndefined()
    expect(调用).toBe(2)
  })
})

