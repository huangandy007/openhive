import { describe, expect, test } from "bun:test"
import { PATH, createSourceProfileApi } from "./source-profile-api"

/**
 * 016 T017 · 数据源档案客户端用例。
 *
 * 后端行是**蛇形**（`case-source-profile-store.ts` 的 `数据源档案行`），前端照原样消费；
 * 本任务不改后端、不自造驼峰（T017 的裁定）。
 */

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const 档案行 = {
  id: "s1",
  name: "八月流水平安",
  type: "资金" as const,
  header_set: ["交易时间", "金额"],
  mapping: { 交易时间: "交易时间", 金额: "金额" },
  hit_count: 3,
  created_at: 1700000000,
  updated_at: 1700000100,
  revoked_at: null,
}

describe("数据源档案客户端", () => {
  test("list：GET 路径带 projectId；含撤销 只认 true；蛇形字段原样解析", async () => {
    const 收到: string[] = []
    const api = createSourceProfileApi(async (url) => {
      收到.push(url)
      return 回({ list: [档案行] })
    })
    expect(await api.list({ projectId: "p 1", 含撤销: true })).toEqual({ kind: "ok", value: [档案行] })
    await api.list({ projectId: "p 1" })
    expect(收到[0]).toBe(`${PATH.list}?projectId=p%201&含撤销=true`)
    expect(收到[1]).toBe(`${PATH.list}?projectId=p%201`)
  })

  test("list：行的类型 / 字段类型不对 ⇒ 整份判错", async () => {
    for (const 坏 of [
      { ...档案行, type: "流水" },
      { ...档案行, header_set: "交易时间" },
      { ...档案行, mapping: { 金额: 1 } },
      { ...档案行, revoked_at: "null" },
      { ...档案行, hit_count: -1 },
    ]) {
      const api = createSourceProfileApi(async () => 回({ list: [坏] }))
      expect((await api.list({ projectId: "p1" })).kind, JSON.stringify(坏)).toBe("error")
    }
  })

  test("build：POST 体只带给了的键；回包 { id, created }", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createSourceProfileApi(async (url, init) => {
      收到.push({ url, init })
      return 回({ id: "s2", created: true })
    })
    expect(await api.build({ projectId: "p1", materialId: "m1", name: "话单档案" })).toEqual({
      kind: "ok",
      value: { id: "s2", created: true },
    })
    expect(收到[0]?.url).toBe(PATH.build)
    expect(收到[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(收到[0]?.init?.body))).toEqual({ projectId: "p1", materialId: "m1", name: "话单档案" })
  })

  test("build：mapping_invalid 带回 problems；其它错误带 code", async () => {
    const 映射坏 = createSourceProfileApi(async () =>
      回({ error: "映射不合法", code: "mapping_invalid", problems: ["金额 缺单位"] }, 400),
    )
    expect(await 映射坏.build({ projectId: "p1", materialId: "m1" })).toEqual({
      kind: "error",
      message: "映射不合法",
      code: "mapping_invalid",
      problems: ["金额 缺单位"],
    })

    const 冲突 = createSourceProfileApi(async () => 回({ error: "已有更相似的档案", code: "conflict" }, 409))
    expect(await 冲突.build({ projectId: "p1", materialId: "m1", 覆盖: false })).toEqual({
      kind: "error",
      message: "已有更相似的档案",
      code: "conflict",
    })
  })

  test("revoke：POST { projectId, id }；ok 只认 { ok: true }", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createSourceProfileApi(async (url, init) => {
      收到.push({ url, init })
      return 回({ ok: true })
    })
    expect(await api.revoke({ projectId: "p1", id: "s1" })).toEqual({ kind: "ok" })
    expect(收到[0]?.url).toBe(PATH.revoke)
    expect(JSON.parse(String(收到[0]?.init?.body))).toEqual({ projectId: "p1", id: "s1" })

    const 假成功 = createSourceProfileApi(async () => 回({ ok: false }))
    expect((await 假成功.revoke({ projectId: "p1", id: "s1" })).kind).toBe("error")
  })
})
