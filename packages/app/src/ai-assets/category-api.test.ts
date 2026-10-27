/**
 * 【保留的定制 · 同步上游时不要丢】使用面分类客户端（需求 4）。
 *
 * 不连网：`send` 是替身。守三件事——
 * ① 打的是**同源字面量路径**（`#003-05`：不引 `PATH` 常量，否则实现和自己比对）；
 * ② 三态分得清：401 / 4xx 是「被拒」，5xx / 网络 / 形状不对是「没说成」；
 * ③ **只用 id 与名字**：服务端多回的三列（sortOrder / enabled / builtin）不留在结果里。
 */

import { describe, expect, test } from "bun:test"
import { createCategoryApi, type CategoryFetch } from "./category-api"

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: CategoryFetch
  calls: Array<{ readonly input: string; readonly init?: RequestInit }>
} {
  const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = []
  const send: CategoryFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

const 库行 = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  sortOrder: 10,
  enabled: true,
  builtin: true,
  ...overrides,
})

describe("使用面分类客户端", () => {
  test("GET 同源字面量路径；只留 id 与名字，服务端多回的列当场丢掉", async () => {
    const { send, calls } = 替身(() =>
      json({ categories: [库行("intelligence", "情报研判"), 库行("finance", "资金分析", { builtin: false })] }),
    )

    const out = await createCategoryApi(send).list()

    expect(calls[0]?.input).toBe("/openhive/categories")
    expect(calls[0]?.init).toBeUndefined()
    expect(out).toEqual({
      kind: "ok",
      value: [
        { id: "intelligence", name: "情报研判" },
        { id: "finance", name: "资金分析" },
      ],
    })
  })

  test("401 ⇒ 被拒（登录失效），不冒充空列表", async () => {
    const { send } = 替身(() => json({ error: "unauthorized" }, 401))
    expect(await createCategoryApi(send).list()).toEqual({
      kind: "rejected",
      message: "登录状态已失效，请重新登录",
    })
  })

  test("4xx ⇒ 被拒并带上服务端那句话；5xx ⇒ 没说成", async () => {
    const 四 = await createCategoryApi(替身(() => json({ error: "没有权限" }, 403)).send).list()
    expect(四).toEqual({ kind: "rejected", message: "没有权限" })

    const 五 = await createCategoryApi(替身(() => json({ error: "库炸了" }, 500)).send).list()
    expect(五).toEqual({ kind: "failed", message: "库炸了" })
  })

  test("连不上 ⇒ 没说成（一句人话）；畸形 JSON 同理", async () => {
    const 断网 = await createCategoryApi(
      替身(() => {
        throw new Error("ECONNREFUSED")
      }).send,
    ).list()
    expect(断网).toEqual({ kind: "failed", message: "连接服务失败，请检查网络后重试" })

    const 畸形 = await createCategoryApi(
      替身(() => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })).send,
    ).list()
    expect(畸形).toEqual({ kind: "failed", message: "服务返回的数据格式不对" })
  })

  test("形状不对一律没说成：缺列、空 id、sortOrder 不是数字、enabled 不是布尔", async () => {
    const 样子 = [
      { categories: [{ id: "a", name: "甲" }] },
      { categories: [库行("", "甲")] },
      { categories: [库行("a", "")] },
      { categories: [库行("a", "甲", { sortOrder: "10" })] },
      { categories: [库行("a", "甲", { enabled: "true" })] },
      { categories: [库行("a", "甲", { builtin: 1 })] },
      { categories: [{ id: "a", name: "甲", sortOrder: 10, enabled: true, builtin: true }, null] },
      { items: [] },
    ]
    for (const body of 样子) {
      const out = await createCategoryApi(替身(() => json(body)).send).list()
      expect(out).toEqual({ kind: "failed", message: "服务返回的数据格式不对" })
    }
  })
})
