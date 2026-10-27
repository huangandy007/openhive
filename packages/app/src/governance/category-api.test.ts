/**
 * 【保留的定制 · 同步上游时不要丢】管理面分类客户端（需求 4）。
 *
 * 不连网：`send` 是替身。守四件事——
 * ① 三个动作打的是**同源字面量路径**（`#003-05`），编辑走 `POST <前缀>/<id>`；
 * ② 载荷只带给了的字段（`sortOrder` 省略时不出现，别塞 `undefined`）；
 * ③ 4xx 带 `field` 时原样带出（界面上要指到那个输入框）；
 * ④ **没有删除**：本模块导出的方法里不存在 remove/delete。
 */

import { describe, expect, test } from "bun:test"
import { createCategoryAdminApi, type CategoryFetch } from "./category-api"

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

const 行 = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  sortOrder: 10,
  enabled: true,
  builtin: true,
  ...overrides,
})

const 体 = (init: RequestInit | undefined) => JSON.parse(String(init?.body)) as unknown

describe("管理面分类客户端", () => {
  test("list：GET 同源路径；含停用项，五列整份保留", async () => {
    const rows = [行("intelligence", "情报研判"), 行("finance", "资金分析", { enabled: false, builtin: false })]
    const { send, calls } = 替身(() => json({ categories: rows }))

    const out = await createCategoryAdminApi(send).list()

    expect(calls[0]?.input).toBe("/openhive/governance/categories")
    expect(calls[0]?.init).toBeUndefined()
    expect(out).toEqual({ kind: "ok", value: rows })
  })

  test("create：POST 前缀，只带给了的字段；省略 sortOrder 时载荷里没有这个键", async () => {
    const { send, calls } = 替身(() => json(行("cat_1", "资金分析", { builtin: false }), 201))
    const api = createCategoryAdminApi(send)

    await api.create({ name: "资金分析" })
    await api.create({ name: "话单分析", sortOrder: 100 })

    expect(calls[0]?.input).toBe("/openhive/governance/categories")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(体(calls[0]?.init)).toEqual({ name: "资金分析" })
    expect(体(calls[1]?.init)).toEqual({ name: "话单分析", sortOrder: 100 })
  })

  test("update：POST 前缀/<id>（id 编码），载荷就是补丁", async () => {
    const { send, calls } = 替身(() => json(行("planning", "方案与报告", { sortOrder: 5 })))

    const out = await createCategoryAdminApi(send).update("planning", { name: "方案与报告", sortOrder: 5 })

    expect(calls[0]?.input).toBe("/openhive/governance/categories/planning")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(体(calls[0]?.init)).toEqual({ name: "方案与报告", sortOrder: 5 })
    expect(out.kind).toBe("ok")
  })

  test("4xx：被拒，带出 field（409 重名指到 name）", async () => {
    const { send } = 替身(() => json({ error: "已有同名分类「情报研判」", field: "name" }, 409))

    expect(await createCategoryAdminApi(send).create({ name: "情报研判" })).toEqual({
      kind: "rejected",
      message: "已有同名分类「情报研判」",
      field: "name",
    })
  })

  test("401 ⇒ 登录失效；5xx ⇒ 没说成；连不上 ⇒ 一句人话", async () => {
    expect(await createCategoryAdminApi(替身(() => json({}, 401)).send).list()).toEqual({
      kind: "rejected",
      message: "登录状态已失效，请重新登录",
    })
    expect(await createCategoryAdminApi(替身(() => json({ error: "库炸了" }, 500)).send).list()).toEqual({
      kind: "failed",
      message: "库炸了",
    })
    expect(
      await createCategoryAdminApi(
        替身(() => {
          throw new Error("ECONNREFUSED")
        }).send,
      ).list(),
    ).toEqual({ kind: "failed", message: "连接服务失败，请检查网络后重试" })
  })

  test("形状不对 ⇒ 没说成（缺列 / 空名 / 类型不对）", async () => {
    for (const body of [
      { categories: [{ id: "a", name: "甲", sortOrder: 1, enabled: true }] },
      { categories: [{ id: "", name: "甲", sortOrder: 1, enabled: true, builtin: true }] },
      { categories: [{ id: "a", name: "", sortOrder: 1, enabled: true, builtin: true }] },
      { categories: [{ id: "a", name: "甲", sortOrder: "1", enabled: true, builtin: true }] },
      { categories: [{ id: "a", name: "甲", sortOrder: 1, enabled: 1, builtin: true }] },
      {},
    ]) {
      expect(await createCategoryAdminApi(替身(() => json(body)).send).list()).toEqual({
        kind: "failed",
        message: "服务返回的数据格式不对",
      })
    }
  })

  test("没有删除这条出口：客户端也不提供", () => {
    const api = createCategoryAdminApi(替身(() => json({})).send)
    expect(Object.keys(api).filter((name) => /delete|remove/i.test(name))).toEqual([])
  })
})
