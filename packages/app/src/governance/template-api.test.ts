/**
 * 模板库客户端（010 T011）：把内核的四条出口翻成三种结论。
 *
 * 不连网：`send` 是替身。要钉的仍是那几条老纪律——401 / 4xx / 5xx 各归哪一态、
 * 返回体形状不对会不会被当成空列表、id 有没有转义进路径。
 *
 * 路径用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import { createTemplateApi, type GovernanceFetch, type TemplateRow } from "./template-api"

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: GovernanceFetch
  calls: Array<{ readonly input: string; readonly init?: RequestInit }>
} {
  const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = []
  const send: GovernanceFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

const 模板 = (id: string, overrides: Partial<TemplateRow> = {}): TemplateRow => ({
  id,
  kind: "report",
  name: "资金分析报告",
  scope: "全单位",
  content: "# 一、案情",
  status: "active",
  createdBy: "u-甲",
  createdAt: 1_700_000_000,
  updatedBy: "u-甲",
  updatedAt: 1_700_000_000,
  updatedByName: "甲专家",
  updatedByPoliceNo: "940001",
  ...overrides,
})

describe("模板库客户端 · 列表", () => {
  test("不给 kind ⇒ 裸路径；给 kind ⇒ 查询串带上", async () => {
    const 全部 = 替身(() => json({ templates: [] }))
    expect(await createTemplateApi(全部.send).list()).toEqual({ kind: "ok", value: [] })
    expect(全部.calls[0]?.input).toBe("/openhive/governance/templates")

    const 按类 = 替身(() => json({ templates: [模板("t1", { kind: "graph" })] }))
    const out = await createTemplateApi(按类.send).list("graph")
    expect(按类.calls[0]?.input).toBe("/openhive/governance/templates?kind=graph")
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value[0]?.kind).toBe("graph")
  })

  test("返回体缺一列 / 类型不对 / 不是 templates ⇒ failed（不是「大概是空表」）", async () => {
    for (const 坏 of [
      { templates: [{ ...模板("t1"), updatedAt: "1700000000" }] },
      { templates: [{ ...模板("t1"), kind: "video" }] },
      { templates: [{ ...模板("t1"), status: "deleted" }] },
      { items: [] },
      {},
    ]) {
      expect((await createTemplateApi(替身(() => json(坏)).send).list()).kind).toBe("failed")
    }
  })
})

describe("模板库客户端 · 写出口", () => {
  test("新建：POST 体逐字是 { kind, name, scope, content }，201 回模板", async () => {
    const { send, calls } = 替身(() => json(模板("t1"), 201))

    const out = await createTemplateApi(send).create({
      kind: "report",
      name: "资金分析报告",
      scope: "全单位",
      content: "# 一、案情",
    })

    expect(calls[0]?.input).toBe("/openhive/governance/templates")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ kind: "report", name: "资金分析报告", scope: "全单位", content: "# 一、案情" }),
    )
    expect(out.kind).toBe("ok")
  })

  test("编辑 / 停用：id 进路径且被转义", async () => {
    const 编辑 = 替身(() => json(模板("a/b")))
    expect((await createTemplateApi(编辑.send).update("a/b", { name: "新名" })).kind).toBe("ok")
    expect(编辑.calls[0]?.input).toBe("/openhive/governance/templates/a%2Fb")
    expect(编辑.calls[0]?.init?.method).toBe("POST")
    expect(编辑.calls[0]?.init?.body).toBe(JSON.stringify({ name: "新名" }))

    const 停用 = 替身(() => json(模板("a b", { status: "disabled" })))
    const 结局 = await createTemplateApi(停用.send).disable("a b")
    expect(停用.calls[0]?.input).toBe("/openhive/governance/templates/a%20b/disable")
    expect(停用.calls[0]?.init?.method).toBe("POST")
    expect(结局.kind).toBe("ok")
    if (结局.kind === "ok") expect(结局.value.status).toBe("disabled")
  })
})

describe("模板库客户端 · 结论三态", () => {
  test("401 ⇒ rejected「登录状态已失效」；403 / 409 ⇒ rejected 原样带服务端消息", async () => {
    expect(await createTemplateApi(替身(() => new Response(null, { status: 401 })).send).list()).toEqual({
      kind: "rejected",
      message: "登录状态已失效，请重新登录",
    })

    const 无权限 = await createTemplateApi(
      替身(() => json({ error: "没有模板库管理权限" }, 403)).send,
    ).list()
    expect(无权限).toEqual({ kind: "rejected", message: "没有模板库管理权限" })

    const 撞名 = await createTemplateApi(
      替身(() => json({ error: "该类模板下已有同名模板「甲」" }, 409)).send,
    ).create({ kind: "report", name: "甲", scope: "", content: "" })
    expect(撞名).toEqual({ kind: "rejected", message: "该类模板下已有同名模板「甲」" })
  })

  test("400 带 field ⇒ 结论里保留 field", async () => {
    const out = await createTemplateApi(
      替身(() => json({ error: "模板名称不能为空", field: "name" }, 400)).send,
    ).create({ kind: "report", name: " ", scope: "", content: "" })

    expect(out).toEqual({ kind: "rejected", message: "模板名称不能为空", field: "name" })
  })

  test("5xx ⇒ failed；网络抛错 ⇒ failed；两者都不冒充「被拒」", async () => {
    const 服务错 = await createTemplateApi(替身(() => json({ error: "boom" }, 500)).send).list()
    expect(服务错.kind).toBe("failed")

    const 断网 = await createTemplateApi(() => Promise.reject(new Error("ECONNREFUSED"))).list()
    expect(断网.kind).toBe("failed")
  })
})
