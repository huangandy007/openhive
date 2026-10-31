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
