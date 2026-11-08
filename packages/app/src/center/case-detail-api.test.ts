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

  test("trust 走 POST，体字段名与服务端一致；没有原因时连键都不带", async () => {
    let 地址 = ""
    let 手法: string | undefined
    let 头: unknown
    let 正文: string | undefined
    const api = createCaseDetailApi(async (url, init) => {
      地址 = url
      手法 = init?.method
      头 = init?.headers
      const 体 = init?.body
      正文 = typeof 体 === "string" ? 体 : undefined
      return 回包({ ok: true, trustState: "已确认" })
    })

    const 回 = await api.trust({ projectId: "p", factType: "entity", factId: "e-张", action: "确认" })
    expect(回.kind).toBe("ok")
    expect(回.kind === "ok" ? 回.value.trustState : undefined).toBe("已确认")
    expect(地址).toBe("/openhive/case/facts/trust")
    expect(手法).toBe("POST")
    expect(头).toMatchObject({ "content-type": "application/json" })
    // `JSON.stringify` 丢掉 undefined 的键：服务端 `handleTrust` 看到的是「没有 reasonKind 这个字段」。
    expect(JSON.parse(正文 ?? "null")).toEqual({
      projectId: "p",
      factType: "entity",
      factId: "e-张",
      action: "确认",
    })
  })

  test("trust 把排除原因原样放进体里", async () => {
    let 正文: string | undefined
    const api = createCaseDetailApi(async (_url, init) => {
      const 体 = init?.body
      正文 = typeof 体 === "string" ? 体 : undefined
      return 回包({ ok: true, trustState: "已排除" })
    })
    await api.trust({
      projectId: "p",
      factType: "entity",
      factId: "e-张",
      action: "排除",
      reasonKind: "材料本身有问题",
      reasonText: "原件重复报送",
    })
    expect(JSON.parse(正文 ?? "null")).toEqual({
      projectId: "p",
      factType: "entity",
      factId: "e-张",
      action: "排除",
      reasonKind: "材料本身有问题",
      reasonText: "原件重复报送",
    })
  })

  test("trust 的 409 冲突把服务端 code 交出来", async () => {
    const api = createCaseDetailApi(async () =>
      回包({ error: "这条事实已经被别人排除", code: "trust_conflict" }, 409),
    )
    expect(
      await api.trust({ projectId: "p", factType: "entity", factId: "e-张", action: "确认" }),
    ).toEqual({ kind: "error", message: "这条事实已经被别人排除", code: "trust_conflict" })
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

  test("graph 的 强度编码：传了就带上，没传就不写（不写空串）", async () => {
    const 看到的: string[] = []
    const api = createCaseDetailApi(async (url) => {
      看到的.push(url)
      return 回包({ 节点: [], 边: [], 缺口: [] })
    })
    await api.graph("p", "e-张", 2, ["转账"], "强")
    await api.graph("p", "e-张", 1)
    expect(new URL(看到的[0], "http://localhost").searchParams.get("强度")).toBe("强")
    expect(new URL(看到的[1], "http://localhost").searchParams.get("强度")).toBeNull()
  })
})
