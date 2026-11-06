import { describe, expect, test } from "bun:test"
import { createCaseDetailApi } from "./case-detail-api"

const 回包 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("案件详情 API 客户端", () => {
  test("profile 把参数放在 query 上，includeExcluded 只在为 true 时才带", async () => {
    const 看到的: string[] = []
    const api = createCaseDetailApi(async (url) => {
      看到的.push(url)
      return 回包({ id: "e-张" })
    })
    await api.profile("p 1", "e 张")
    await api.profile("p 1", "e 张", true)
    expect(看到的[0]).toBe("/openhive/case/entity?projectId=p+1&id=e+%E5%BC%A0")
    expect(看到的[1]).toContain("includeExcluded=true")
  })

  test("非 2xx 把服务端的 error 原样交出来，不抛", async () => {
    const api = createCaseDetailApi(async () => 回包({ error: "找不到这个实体", code: "entity_not_found" }, 404))
    expect(await api.profile("p", "x")).toEqual({ kind: "error", message: "找不到这个实体", code: "entity_not_found" })
  })

  test("网络异常收成 error（视图不需要 try/catch）", async () => {
    const api = createCaseDetailApi(async () => {
      throw new Error("连不上")
    })
    expect(await api.profile("p", "x")).toEqual({ kind: "error", message: "连不上" })
  })

  test("review 的 projectId / path 编码正确（路径含中文与斜杠）", async () => {
    const 看到的: string[] = []
    const api = createCaseDetailApi(async (url) => {
      看到的.push(url)
      return 回包({ 产物: null, 引用: [], 需复核: 0, 缺口: [] })
    })
    await api.review("p 1", "报告/分析.md")
    const 解析 = new URL(看到的[0]!, "http://localhost").searchParams
    expect(解析.get("projectId")).toBe("p 1")
    expect(解析.get("path")).toBe("报告/分析.md")
  })

  test("graph 的 跳数 / type 编码正确（type 用逗号连接）", async () => {
    const 看到的: string[] = []
    const api = createCaseDetailApi(async (url) => {
      看到的.push(url)
      return 回包({ 节点: [], 边: [], 缺口: [] })
    })
    await api.graph("p", "e-张", 2, ["转账", "通话"])
    // 按**解析后的值**断言，不断言百分号编码的字面量（编码细节随 `URLSearchParams` 走，
    // 断字面量等于把实现细节钉进测试）。⚠️ 键名同理：`跳数` 这个中文键会被
    // `URLSearchParams.toString()` 编码成 `%E8%B7%B3%E6%95%B0`，服务端用
    // `new URL(…).searchParams.get("跳数")` 读、解码后仍是同一个键。
    const 解析 = new URL(看到的[0]!, "http://localhost").searchParams
    expect(解析.get("跳数")).toBe("2")
    expect(解析.get("type")).toBe("转账,通话")
  })
})
