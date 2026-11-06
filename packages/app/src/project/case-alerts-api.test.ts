import { describe, expect, test } from "bun:test"
import { createCaseAlertsApi, 提醒路径 } from "./case-alerts-api"

const 回包 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("提醒 API 客户端", () => {
  test("list 读 query，refresh / read 走 POST + JSON 体", async () => {
    const 看到: Array<{ url: string; init?: RequestInit }> = []
    const api = createCaseAlertsApi(async (url, init) => {
      看到.push({ url, init })
      if (url.includes("/refresh")) return 回包({ 新建: 2, 提醒: [] })
      if (url.includes("/read")) return 回包({ 已读: 1 })
      return 回包({ 提醒: [] })
    })
    await api.list("p 1")
    await api.refresh("p 1")
    await api.markRead("p 1", ["al-1"])
    expect(看到[0]!.url).toBe("/openhive/case/alerts?projectId=p+1")
    expect(看到[1]!.init?.method).toBe("POST")
    expect(看到[2]!.init?.body).toBe(JSON.stringify({ projectId: "p 1", ids: ["al-1"] }))
  })

  test("非 2xx 收成 error，不抛", async () => {
    const api = createCaseAlertsApi(async () => 回包({ error: "不是该项目成员" }, 403))
    expect(await api.list("p")).toEqual({ kind: "error", message: "不是该项目成员", code: undefined })
  })

  test("提醒路径：alerts/all 也走伪路径编码（唯一构造器）", () => {
    expect(提醒路径("p 1")).toBe("case://p%201/alerts/all")
  })
})
