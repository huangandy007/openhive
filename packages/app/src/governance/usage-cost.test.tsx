/**
 * 用量/成本看板（010 T009 / FR-008 / US5）。
 *
 * 判据只钉**界面这一层答应的事**：默认窗口与分组、切换即重拉、卡片与明细表来自同一次回包、
 * `collected:false` 时指标显示「—」而不是 0、空 / 加载 / 错误三态、切换时的代次守卫。
 *
 * 「统计口径对不对」的真判据在服务端（`packages/opencode/test/server/openhive-governance-usage.test.ts`）
 * ——这里只验它把服务端给的数**原样**展示（千分位与小数位是唯一加工）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { UsageApi, UsageOutcome, UsageQuery, UsageReport } from "./usage-cost-api"
import { UsageCost } from "./usage-cost"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const 歇一拍 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function 等到(条件: () => boolean, 上限毫秒 = 1000) {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限毫秒) throw new Error("等到超时")
    await 歇一拍()
  }
}

const 报表 = (overrides: Partial<UsageReport> = {}): UsageReport => ({
  collected: true,
  watermark: 1_759_000_000_000,
  from: 1_700_000_000_000,
  to: 1_700_002_592_000,
  groupBy: "org",
  metrics: { calls: 1234, totalTokens: 5678, estimatedCost: 0.8500000000000001, activeOrgs: 2 },
  rows: [
    { key: "湖州市局", label: "湖州市局", calls: 1000, inputTokens: 300, outputTokens: 130, cost: 0.75 },
    { key: "南浔分局", label: "南浔分局", calls: 234, inputTokens: 50, outputTokens: 25, cost: 0.1 },
  ],
  ...overrides,
})

interface 记录 {
  readonly queries: UsageQuery[]
}

function 假后端(覆写: Partial<UsageApi> = {}) {
  const 记录: 记录 = { queries: [] }
  const api: UsageApi = {
    report: async (query) => {
      记录.queries.push(query)
      return { kind: "ok", value: 报表() }
    },
    ...覆写,
  }
  return { api, 记录 }
}

function 挂上(api: UsageApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <UsageCost api={api} />, root))
  return root
}

const 有 = (selector: string) => document.querySelector<HTMLElement>(selector)
const 文章 = (selector: string) => 有(selector)?.textContent?.trim() ?? ""

function 按钮(selector: string): HTMLButtonElement {
  const 目标 = 有(selector)
  if (!(目标 instanceof HTMLButtonElement)) throw new Error(`不是按钮：${selector}`)
  return 目标
}

function 点击(selector: string) {
  按钮(selector).click()
}

const 卡片值 = (metric: string) => 文章(`[data-slot='usage-card'][data-metric='${metric}'] [data-slot='usage-card-value']`)
const 行们 = () => [...document.querySelectorAll<HTMLElement>("[data-slot='usage-row']")]
const 行内 = (key: string, slot: string) => 文章(`[data-slot='usage-row'][data-key='${key}'] [data-slot='${slot}']`)

const 一天 = 24 * 60 * 60 * 1000

describe("T009 · 首屏", () => {
  test("默认近 30 天 + 按单位：一次查询带出四张卡片、明细表与水位", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='usage-table']") !== null)

    expect(记录.queries).toHaveLength(1)
    const query = 记录.queries[0]
    expect(query.groupBy).toBe("org")
    expect(query.to! - query.from!).toBe(30 * 一天)

    expect(卡片值("calls")).toBe("1,234")
    expect(卡片值("totalTokens")).toBe("5,678")
    // 0.8500000000000001 不进界面：最多四位小数。
    expect(卡片值("estimatedCost")).toBe("0.85")
    expect(卡片值("activeOrgs")).toBe("2")

    expect(行们()).toHaveLength(2)
    expect(行内("湖州市局", "usage-row-label")).toBe("湖州市局")
    expect(行内("湖州市局", "usage-row-calls")).toBe("1,000")
    expect(行内("湖州市局", "usage-row-cost")).toBe("0.75")

    // 水位是毫秒、`格式化时间` 吃秒——只钉「翻成了本地时间」这个形状，不钉具体时刻（跨时区会漂）。
    expect(文章("[data-slot='usage-watermark']")).toMatch(/^数据截至 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  test("当前窗口与分组用 aria-pressed 标出来（键盘与读屏也能知道选的是哪个）", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='usage-table']") !== null)

    expect(按钮("[data-slot='usage-window'][data-days='30']").getAttribute("aria-pressed")).toBe("true")
    expect(按钮("[data-slot='usage-window'][data-days='7']").getAttribute("aria-pressed")).toBe("false")
    expect(按钮("[data-slot='usage-group'][data-group='org']").getAttribute("aria-pressed")).toBe("true")
  })
})

describe("T009 · 切换", () => {
  test("切窗口 ⇒ 以新的区间重拉（7 天）；重复点同一个不重拉", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 有("[data-slot='usage-table']") !== null)

    点击("[data-slot='usage-window'][data-days='7']")
    await 等到(() => 记录.queries.length === 2)
    expect(记录.queries[1].to! - 记录.queries[1].from!).toBe(7 * 一天)

    点击("[data-slot='usage-window'][data-days='7']")
    await 歇一拍()
    expect(记录.queries).toHaveLength(2)
  })

  test("切分组 ⇒ 以新分组重拉，表头跟着分组名走", async () => {
    const { api, 记录 } = 假后端({
      report: async (query) => {
        记录.queries.push(query)
        if (query.groupBy !== "user") return { kind: "ok", value: 报表() }
        return {
          kind: "ok",
          value: 报表({
            groupBy: "user",
            rows: [
              { key: "u1", label: "甲民警（930011）", calls: 2, inputTokens: 300, outputTokens: 130, cost: 0.75 },
            ],
          }),
        }
      },
    })
    挂上(api)
    await 等到(() => 有("[data-slot='usage-table']") !== null)

    点击("[data-slot='usage-group'][data-group='user']")
    await 等到(() => 行们().length === 1)

    expect(记录.queries[1].groupBy).toBe("user")
    expect(行内("u1", "usage-row-label")).toBe("甲民警（930011）")
    expect(文章("[data-slot='usage-table'] thead th")).toBe("人员")
  })

  test("切换请求先发、旧请求后回 ⇒ 旧回包被丢弃（代次守卫）", async () => {
    const 闸门: Array<() => void> = []
    const 结果 = (groupBy: "org" | "user"): UsageOutcome<UsageReport> => ({
      kind: "ok",
      value:
        groupBy === "user"
          ? 报表({
              groupBy: "user",
              rows: [
                { key: "u1", label: "甲民警（930011）", calls: 2, inputTokens: 300, outputTokens: 130, cost: 0.75 },
              ],
            })
          : 报表(),
    })
    const 记录: UsageQuery[] = []
    const api: UsageApi = {
      report: (query) =>
        new Promise((resolve) => {
          记录.push(query)
          闸门.push(() => resolve(结果(query.groupBy === "user" ? "user" : "org")))
        }),
    }

    挂上(api)
    await 等到(() => 记录.length === 1)

    // 第一代（按单位）还挂着，先切到人员——它的回包先到。
    点击("[data-slot='usage-group'][data-group='user']")
    await 等到(() => 记录.length === 2)
    闸门[1]()
    await 等到(() => 行们().length === 1)
    expect(行内("u1", "usage-row-label")).toBe("甲民警（930011）")

    // 旧的那一代这时才回：不能把界面拨回「按单位」的两行。
    闸门[0]()
    await 歇一拍()
    expect(行们()).toHaveLength(1)
    expect(行内("u1", "usage-row-label")).toBe("甲民警（930011）")
  })
})

describe("T009 · 状态", () => {
  test("collected:false ⇒ 四张卡片与水位全是「—」，并说明原因（不显示 0）", async () => {
    const 空 = 报表({
      collected: false,
      watermark: null,
      metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 },
      rows: [],
    })
    挂上({ report: async () => ({ kind: "ok", value: 空 }) })
    await 等到(() => 有("[data-slot='usage-notice']") !== null)

    for (const metric of ["calls", "totalTokens", "estimatedCost", "activeOrgs"]) {
      expect(卡片值(metric)).toBe("—")
    }
    expect(文章("[data-slot='usage-watermark']")).toBe("数据截至 —")
    expect(文章("[data-slot='usage-notice']")).toContain("分析库里还没有数据")
    expect(有("[data-slot='usage-table']")).toBeNull()
  })

  test("有数据但窗口内没有记录 ⇒ 空态文案带窗口天数", async () => {
    挂上({
      report: async () => ({
        kind: "ok",
        value: 报表({ metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 }, rows: [] }),
      }),
    })
    await 等到(() => 有("[data-slot='usage-empty']") !== null)

    expect(文章("[data-slot='usage-empty']")).toContain("近 30 天没有使用记录")
    expect(卡片值("calls")).toBe("0")
    expect(有("[data-slot='usage-notice']")).toBeNull()
  })

  test("首屏加载中 ⇒ 加载态；失败 ⇒ 错误框，重试按钮重拉", async () => {
    let 第几次 = 0
    const 记录: UsageQuery[] = []
    const api: UsageApi = {
      report: async (query) => {
        记录.push(query)
        第几次 += 1
        if (第几次 === 1) return { kind: "failed", message: "连接服务失败，请检查网络后重试" }
        return { kind: "ok", value: 报表() }
      },
    }

    挂上({ report: () => new Promise<UsageOutcome<UsageReport>>(() => {}) })
    await 等到(() => 有("[data-slot='usage-loading']") !== null)
    expect(文章("[data-slot='usage-loading']")).toContain("正在汇总用量")

    document.body.innerHTML = ""
    挂上(api)
    await 等到(() => 有("[data-slot='usage-error']") !== null)
    expect(文章("[data-slot='usage-error']")).toContain("连接服务失败")

    点击("[data-slot='usage-retry']")
    await 等到(() => 有("[data-slot='usage-table']") !== null)
    expect(记录).toHaveLength(2)
    expect(有("[data-slot='usage-error']")).toBeNull()
  })
})
