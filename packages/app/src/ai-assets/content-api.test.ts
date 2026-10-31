/**
 * 资产内容编辑客户端（2026-10-31）：`PATCH /openhive/assets/:id`。
 *
 * 这一层不连网：`send` 是替身。钉三件事——路径与方法、403 的原话、网络异常不被当成成功。
 */

import { describe, expect, test } from "bun:test"
import { createContentApi, PATH } from "./content-api"

const 回包 = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "a1", name: "甲", description: "介绍", summary: "功能", precautions: "", ...over })

describe("内容编辑客户端", () => {
  test("成功：PATCH 到 /openhive/assets/:id，回包解析出 summary", async () => {
    const 记录: { url?: string; init?: RequestInit } = {}
    const api = createContentApi(async (url, init) => {
      记录.url = url
      记录.init = init
      return new Response(回包(), { status: 200 })
    })
    const 结果 = await api.save("a1", { summary: "功能" })
    expect(记录.url).toBe(`${PATH.base}/a1`)
    expect(记录.init?.method).toBe("PATCH")
    expect(结果.kind).toBe("ok")
  })

  test("403 ⇒ rejected，消息取服务端的 error", async () => {
    const api = createContentApi(async () => new Response(JSON.stringify({ error: "无权修改该资产" }), { status: 403 }))
    const 结果 = await api.save("a1", { summary: "x" })
    expect(结果).toEqual({ kind: "rejected", message: "无权修改该资产" })
  })

  test("网络异常 ⇒ failed", async () => {
    const api = createContentApi(async () => {
      throw new Error("boom")
    })
    const 结果 = await api.save("a1", { summary: "x" })
    expect(结果.kind).toBe("failed")
  })
})
