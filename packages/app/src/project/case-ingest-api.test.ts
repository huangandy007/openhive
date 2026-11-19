import { describe, expect, test } from "bun:test"
import { PATH, createCaseIngestApi } from "./case-ingest-api"

/**
 * 016 T017 · 入库新出口的客户端用例（扫描 / 重跑 / 设置 / 报告）。
 *
 * 服务端回包形状照 T016 的 `case-ingest-routes.ts` 逐字；解码一律「不认识就整份判错」，
 * 不把坏形状降级成 `0 / false / null`（`#002-02`：不知道 ≠ 空）。
 */

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const 扫描行 = {
  合计: 5,
  候选: {
    目录独有: [{ path: "资料/新.xlsx" }],
    未入队: [{ materialId: "m1", path: "资料/旧.xlsx" }],
    未识别: [{ materialId: "m2", path: "资料/怪.xlsx", 原因码: "未识别:无匹配适配器" }],
  },
  样本: ["资料/新.xlsx"],
  截断: false,
}

const 设置行 = { autoEnqueue: true, autoEnableTrusted: false, updatedAt: 1700000000 }

const 报告行 = {
  id: "r1",
  jobId: "j1",
  materialId: "m1",
  adapterId: "jin-liu",
  adapterVersion: "1.2.0",
  ruleVersion: "1",
  sourceSha256: "abc",
  gates: [],
  warnings: [],
  skippedRows: [],
  enrich: null,
  admission: { 结论: "采纳" },
  createdAt: 1700000000,
}

describe("入库扫描客户端", () => {
  test("scan：GET 固定路径 + projectId 编码，整份扫描结果原样解析", async () => {
    const 收到: string[] = []
    const api = createCaseIngestApi(async (url) => {
      收到.push(url)
      return 回(扫描行)
    })
    const 结果 = await api.scan("p 1/甲")
    expect(收到).toEqual([`${PATH.scan}?projectId=${encodeURIComponent("p 1/甲")}`])
    expect(结果).toEqual({ kind: "ok", value: 扫描行 })
  })

  test("scan：合计不是非负整数 / 缺一类候选 / 截断不是布尔 ⇒ 整份判错", async () => {
    for (const 坏 of [
      { ...扫描行, 合计: "5" },
      { ...扫描行, 候选: { 目录独有: [], 未入队: [] } },
      { ...扫描行, 截断: "false" },
      { ...扫描行, 候选: { ...扫描行.候选, 未识别: [{ materialId: "m2", path: "a.xlsx" }] } },
    ]) {
      const api = createCaseIngestApi(async () => 回(坏))
      expect((await api.scan("p1")).kind, JSON.stringify(坏)).toBe("error")
    }
  })
})

describe("重跑客户端", () => {
  test("rerun：POST 体带 projectId 与范围；结果原样解析", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createCaseIngestApi(async (url, init) => {
      收到.push({ url, init })
      return 回({ 已入队: 4, 跳过: [{ path: "a.xlsx", 原因: "已在跑" }], 失败: [] })
    })
    const 结果 = await api.rerun({ projectId: "p1", 范围: ["未入队", "未识别"] })
    expect(收到[0]?.url).toBe(PATH.rerun)
    expect(收到[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(收到[0]?.init?.body))).toEqual({ projectId: "p1", 范围: ["未入队", "未识别"] })
    expect(结果).toEqual({
      kind: "ok",
      value: { 已入队: 4, 跳过: [{ path: "a.xlsx", 原因: "已在跑" }], 失败: [] },
    })
  })

  test("rerun：错误回包带回 error 与 code（非成员 403）", async () => {
    const api = createCaseIngestApi(async () => 回({ error: "不是该项目成员", code: "forbidden" }, 403))
    expect(await api.rerun({ projectId: "p1" })).toEqual({
      kind: "error",
      message: "不是该项目成员",
      code: "forbidden",
    })
  })
})

describe("设置客户端", () => {
  test("readSettings / writeSettings：路径、方法、只带传了的键", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createCaseIngestApi(async (url, init) => {
      收到.push({ url, init })
      return 回(设置行)
    })
    expect(await api.readSettings("p1")).toEqual({ kind: "ok", value: 设置行 })
    expect(收到[0]?.url).toBe(`${PATH.settings}?projectId=p1`)

    expect(await api.writeSettings({ projectId: "p1", autoEnqueue: false })).toEqual({ kind: "ok", value: 设置行 })
    expect(收到[1]?.url).toBe(PATH.settings)
    expect(收到[1]?.init?.method).toBe("POST")
    expect(JSON.parse(String(收到[1]?.init?.body))).toEqual({ projectId: "p1", autoEnqueue: false })
  })

  test("设置回包形状不对 ⇒ 判错；updatedAt 可空", async () => {
    const 坏 = createCaseIngestApi(async () => 回({ autoEnqueue: "true", autoEnableTrusted: false, updatedAt: null }))
    expect((await 坏.readSettings("p1")).kind).toBe("error")

    const 空时间 = createCaseIngestApi(async () => 回({ autoEnqueue: true, autoEnableTrusted: false, updatedAt: null }))
    expect(await 空时间.readSettings("p1")).toEqual({
      kind: "ok",
      value: { autoEnqueue: true, autoEnableTrusted: false, updatedAt: null },
    })
  })
})

describe("入库报告客户端", () => {
  test("report：默认路径带 materialId；report 可为 null；历史=1 换成 reports", async () => {
    const 收到: string[] = []
    const api = createCaseIngestApi(async (url) => {
      收到.push(url)
      if (url.includes("历史=1")) return 回({ reports: [] })
      if (url.includes("materialId=m-none")) return 回({ report: null })
      return 回({ report: 报告行 })
    })
    expect(await api.report({ projectId: "p1", materialId: "m1" })).toEqual({ kind: "ok", value: { report: 报告行 } })
    expect(收到[0]).toBe(`${PATH.report}?projectId=p1&materialId=m1`)
    expect(await api.report({ projectId: "p1", materialId: "m-none" })).toEqual({
      kind: "ok",
      value: { report: null },
    })
    expect(await api.report({ projectId: "p1", materialId: "m1", 历史: true })).toEqual({
      kind: "ok",
      value: { reports: [] },
    })
    expect(收到[2]).toBe(`${PATH.report}?projectId=p1&materialId=m1&历史=1`)
  })

  test("report：报告行字段类型不对 ⇒ 判错", async () => {
    const api = createCaseIngestApi(async () => 回({ report: { ...报告行, createdAt: "昨天" } }))
    expect((await api.report({ projectId: "p1", materialId: "m1" })).kind).toBe("error")
  })
})
