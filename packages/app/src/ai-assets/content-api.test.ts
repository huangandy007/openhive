/**
 * 资产内容编辑客户端（2026-10-31）：`PATCH /openhive/assets/:id`。
 *
 * 这一层不连网：`send` 是替身。路径用**字面量**断言（`#003-05`：不引 `PATH` 常量，
 * 否则实现和自己比对）。断言的重点是**请求是什么形状**与三种结论的分界。
 */

import { describe, expect, test } from "bun:test"
import { createContentApi, type ContentFetch } from "./content-api"

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: ContentFetch
  calls: Array<{ readonly input: string; readonly init?: RequestInit }>
} {
  const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = []
  const send: ContentFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

const 回包 = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "a1", name: "甲", description: "介绍", summary: "功能", precautions: "", ...over })

describe("内容编辑客户端", () => {
  test("成功：PATCH 到 /openhive/assets/a1，体是补丁本身，回包解析出 summary", async () => {
    const { send, calls } = 替身(() => new Response(回包(), { status: 200 }))
    const 结果 = await createContentApi(send).save("a1", { summary: "功能" })

    expect(calls[0]?.input).toBe("/openhive/assets/a1")
    expect(calls[0]?.init?.method).toBe("PATCH")
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ summary: "功能" })
    expect(结果.kind).toBe("ok")
    if (结果.kind === "ok") expect(结果.value["summary"]).toBe("功能")
  })

  test("403 ⇒ rejected，消息取服务端的 error", async () => {
    const { send } = 替身(() => json({ error: "无权修改该资产" }, 403))
    const 结果 = await createContentApi(send).save("a1", { summary: "x" })
    expect(结果).toEqual({ kind: "rejected", message: "无权修改该资产" })
  })

  test("401 ⇒ rejected（登录失效，不重试）", async () => {
    const { send } = 替身(() => new Response("", { status: 401 }))
    const 结果 = await createContentApi(send).save("a1", { summary: "x" })
    expect(结果).toEqual({ kind: "rejected", message: "登录状态已失效，请重新登录" })
  })

  test("500 ⇒ failed（服务端故障，不是「你这请求不对」）", async () => {
    const { send } = 替身(() => json({ error: "内部错误" }, 500))
    const 结果 = await createContentApi(send).save("a1", { summary: "x" })
    expect(结果.kind).toBe("failed")
    if (结果.kind === "failed") expect(结果.message).toBe("内部错误")
  })

  test("200 但回包不是对象（数组 / 字符串）⇒ failed", async () => {
    for (const body of [[], "x"]) {
      const { send } = 替身(() => json(body))
      const 结果 = await createContentApi(send).save("a1", { summary: "x" })
      expect(结果.kind).toBe("failed")
      if (结果.kind === "failed") expect(结果.message).toContain("格式不对")
    }
  })

  test("网络异常 ⇒ failed", async () => {
    const { send } = 替身(() => {
      throw new Error("boom")
    })
    const 结果 = await createContentApi(send).save("a1", { summary: "x" })
    expect(结果.kind).toBe("failed")
  })
})

/**
 * 迭代三个调用（2026-11-01，设计 §6）：`POST /openhive/assets/:id/iteration[/submit|/abort]`。
 *
 * 路径照旧写**字面量**（`#003-05`：不引 `PATH`，否则实现拿自己跟自己比对）。三态与 `save`
 * 同一套：4xx 是 `rejected`（带服务端的 `error`），网络 / 非 JSON 是 `failed`。
 */
describe("迭代客户端（2026-11-01）", () => {
  test("发起：POST /openhive/assets/a1/iteration，体里带 note 与 projectId", async () => {
    const { send, calls } = 替身(() => json({ assetId: "a1", status: "iterating", version: 3 }))
    const 结果 = await createContentApi(send).iteration("a1", "补一条口径", "p1")

    expect(结果.kind).toBe("ok")
    expect(calls[0]?.input).toBe("/openhive/assets/a1/iteration")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ note: "补一条口径", projectId: "p1" })
  })

  test("发起：回包带 workspace 时原样交回；缺省时不编路径", async () => {
    const 带路径 = await createContentApi(async () =>
      json({ assetId: "a1", status: "iterating", version: 3, workspace: "D:/ws/u/p/.openhive/iterations/a1" }),
    ).iteration("a1", "说明", "p1")
    expect(带路径).toEqual({
      kind: "ok",
      value: { workspace: "D:/ws/u/p/.openhive/iterations/a1" },
    })

    const 无路径 = await createContentApi(async () => json({ assetId: "a1", status: "iterating", version: 3, workspace: null })).iteration(
      "a1",
      "说明",
      "p1",
    )
    expect(无路径).toEqual({ kind: "ok", value: {} })

    // 内核的 `workspace: null` 与「键完全不存在」都是「没有路径」；两条都要落到同一个空值。
    const 无键 = await createContentApi(async () => json({ assetId: "a1", status: "iterating", version: 3 })).iteration(
      "a1",
      "说明",
      "p1",
    )
    expect(无键).toEqual({ kind: "ok", value: {} })
  })

  test("提交 / 放弃：POST 到各自子路径，不带体也不发 Content-Type", async () => {
    const { send, calls } = 替身(() => json({ assetId: "a1", status: "iterating", version: 3 }))
    const api = createContentApi(send)
    await api.submitIteration("a1")
    await api.abortIteration("a1")

    expect(calls.map((项) => 项.input)).toEqual([
      "/openhive/assets/a1/iteration/submit",
      "/openhive/assets/a1/iteration/abort",
    ])
    for (const 调用 of calls) {
      expect(调用.init?.method).toBe("POST")
      expect(调用.init?.body).toBeUndefined()
      // 空体配 application/json 有些中间层会拒，所以不带体时不发这个头。
      expect(new Headers(调用.init?.headers).get("content-type")).toBeNull()
    }
  })

  test("409 ⇒ rejected，消息取服务端的 error（「还没提交」是用户能纠正的）", async () => {
    const { send } = 替身(() => json({ error: "资产还没有提交新版本" }, 409))
    const 结果 = await createContentApi(send).submitIteration("a1")
    expect(结果).toEqual({ kind: "rejected", message: "资产还没有提交新版本" })
  })

  test("401 ⇒ rejected（登录失效，不重试，与 save 同一句文案）", async () => {
    const 结果 = await createContentApi(async () => new Response("", { status: 401 })).iteration("a1", "说明", "p1")
    expect(结果).toEqual({ kind: "rejected", message: "登录状态已失效，请重新登录" })
  })

  test("网络异常 ⇒ failed，用该动作的提示语", async () => {
    const 抛 = () => {
      throw new Error("ECONNREFUSED")
    }
    expect(await createContentApi(抛).abortIteration("a1")).toEqual({
      kind: "failed",
      message: "操作失败，请检查网络后重试",
    })
    expect(await createContentApi(抛).submitIteration("a1")).toEqual({
      kind: "failed",
      message: "提交失败，请检查网络后重试",
    })
  })

  test("500 ⇒ failed，兜底文案带动作名（不是「保存失败」）", async () => {
    const 操作 = await createContentApi(async () => new Response("", { status: 500 })).abortIteration("a1")
    expect(操作).toEqual({ kind: "failed", message: "操作失败（HTTP 500）" })

    const 提交 = await createContentApi(async () => new Response("", { status: 500 })).submitIteration("a1")
    expect(提交).toEqual({ kind: "failed", message: "提交失败（HTTP 500）" })
  })

  test("200 但回包不是对象 ⇒ failed（形状不对不等于流转失败）", async () => {
    const 结果 = await createContentApi(async () => json([])).iteration("a1", "说明", "p1")
    expect(结果).toEqual({ kind: "failed", message: "服务返回的数据格式不对" })
  })
})
