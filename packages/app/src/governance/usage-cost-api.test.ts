/**
 * 用量/成本看板客户端（010 T009）：把一条只读报表翻成三种结论。
 *
 * 这一层不连网：`send` 是替身，返回手工造的 `Response`。钉的仍是那一套——
 * 哪些状态码算「被拒」（401 / 400：服务端明确说不）、哪些算「没说成」（5xx / 断网 / 形状不对），
 * 以及**每一列都严判**：少一列、数字写成字符串、`groupBy` 越界都当 `failed`，不猜默认值
 * （`#005-47`：默认值恰好满足断言，就成了假绿）。
 *
 * 路径与查询串用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import { createUsageApi, type GovernanceFetch, type UsageReport } from "./usage-cost-api"

function 替身(应答: (call: { input: string }) => Response | Promise<Response>): {
  send: GovernanceFetch
  calls: string[]
} {
  const calls: string[] = []
  const send: GovernanceFetch = async (input) => {
    calls.push(input)
    return 应答({ input })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

const 报表 = (overrides: Partial<UsageReport> = {}): UsageReport => ({
  collected: true,
  watermark: 1_759_000_000_000,
  from: 1_700_000_000_000,
  to: 1_700_002_592_000,
  groupBy: "org",
  metrics: { calls: 3, totalTokens: 505, estimatedCost: 0.85, activeOrgs: 2 },
  rows: [
    { key: "湖州市局", label: "湖州市局", calls: 2, inputTokens: 300, outputTokens: 130, cost: 0.75 },
    { key: "南浔分局", label: "南浔分局", calls: 1, inputTokens: 50, outputTokens: 25, cost: 0.1 },
  ],
  ...overrides,
})

describe("用量客户端 · 请求", () => {
  test("GET 同源路径；窗口与分组都进查询串（字面量断言）", async () => {
    const { send, calls } = 替身(() => json(报表()))
    await createUsageApi(send).report({ from: 1_700_000_000_000, to: 1_700_002_592_000, groupBy: "user" })

    expect(calls[0]).toBe(
      "/openhive/governance/usage-cost?from=1700000000000&to=1700002592000&groupBy=user",
    )
  })

  test("省略 from / to 时不写这两个参数（把缺省交给服务端）", async () => {
    const { send, calls } = 替身(() => json(报表()))
    await createUsageApi(send).report({ groupBy: "model" })
    expect(calls[0]).toBe("/openhive/governance/usage-cost?groupBy=model")
  })
})

describe("用量客户端 · 解析", () => {
  test("回包逐字段相等（含 rows 全部列）", async () => {
    const 期望 = 报表()
    const out = await createUsageApi(替身(() => json(期望)).send).report({ groupBy: "org" })
    expect(out).toEqual({ kind: "ok", value: 期望 })
  })

  test("collected:false 与 watermark:null 是合法回包（不是 failed）；空 rows 也是 ok", async () => {
    const 空 = 报表({
      collected: false,
      watermark: null,
      metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 },
      rows: [],
    })
    const out = await createUsageApi(替身(() => json(空)).send).report({ groupBy: "org" })
    expect(out).toEqual({ kind: "ok", value: 空 })
  })

  test("缺一列 / 数字写成字符串 / groupBy 越界 ⇒ failed（不猜默认值）", async () => {
    /** 一份形状正确的原样回包；下面每条只动一处，看严判抓不抓得住。 */
    const 好行: Record<string, unknown> = {
      key: "湖州市局",
      label: "湖州市局",
      calls: 2,
      inputTokens: 300,
      outputTokens: 130,
      cost: 0.75,
    }
    const 坏行们: Record<string, unknown>[] = []
    for (const 列 of ["key", "label", "calls", "inputTokens", "outputTokens", "cost"]) {
      const 缺 = { ...好行 }
      delete 缺[列]
      坏行们.push(缺)
    }
    坏行们.push({ ...好行, calls: "2" }, { ...好行, label: null })

    const 坏报表们: unknown[] = []
    for (const 行 of 坏行们) 坏报表们.push({ ...报表(), rows: [行] })

    const 好报表: Record<string, unknown> = { ...报表() }
    for (const 列 of ["collected", "watermark", "from", "to", "groupBy", "metrics", "rows"]) {
      const 缺 = { ...好报表 }
      delete 缺[列]
      坏报表们.push(缺)
    }
    坏报表们.push(
      { ...好报表, collected: "true" },
      { ...好报表, groupBy: "dept" },
      { ...好报表, watermark: "1759000000000" },
      { ...好报表, metrics: { calls: 3, totalTokens: 505, estimatedCost: 0.85 } },
    )

    for (const 坏 of 坏报表们) {
      const out = await createUsageApi(替身(() => json(坏)).send).report({ groupBy: "org" })
      expect(out).toEqual({ kind: "failed", message: "服务返回的数据格式不对" })
    }
  })
})

describe("用量客户端 · 结论", () => {
  test("401 ⇒ rejected（登录失效的原话，不看服务端体）", async () => {
    const out = await createUsageApi(替身(() => json({ error: "x" }, 401)).send).report({ groupBy: "org" })
    expect(out).toEqual({ kind: "rejected", message: "登录状态已失效，请重新登录" })
  })

  test("403 / 400 ⇒ rejected 且显示服务端原话", async () => {
    const 拒 = await createUsageApi(替身(() => json({ error: "没有用量看板权限" }, 403)).send).report({
      groupBy: "org",
    })
    expect(拒).toEqual({ kind: "rejected", message: "没有用量看板权限" })

    const 坏参 = await createUsageApi(替身(() => json({ error: "未知分组：dept" }, 400)).send).report({
      groupBy: "org",
    })
    expect(坏参).toEqual({ kind: "rejected", message: "未知分组：dept" })
  })

  test("5xx ⇒ failed（服务端原话）；断网 ⇒ failed（通用提示）", async () => {
    const 崩 = await createUsageApi(替身(() => json({ error: "分析库打不开" }, 500)).send).report({ groupBy: "org" })
    expect(崩).toEqual({ kind: "failed", message: "分析库打不开" })

    const 断 = await createUsageApi(替身(() => Promise.reject(new Error("boom"))).send).report({ groupBy: "org" })
    expect(断).toEqual({ kind: "failed", message: "连接服务失败，请检查网络后重试" })
  })
})
