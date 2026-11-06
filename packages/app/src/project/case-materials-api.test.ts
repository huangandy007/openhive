import { describe, expect, test } from "bun:test"
import { PATH, createCaseMaterialsApi } from "./case-materials-api"

const 视图行 = {
  id: "m1",
  path: "资料/话单.xlsx",
  kind: "话单",
  // `as const`：不写的话字面量被放宽成 `string`，`toEqual`（参数类型 = 实得类型）过不了
  // typecheck；断言内容一字未改。
  status: "已解析" as const,
  detail: { reason: "有一列没认出来" },
  queueAhead: 0,
  factCount: 12,
  numberCount: 3,
  parseable: true,
}

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("材料状态客户端", () => {
  test("read：GET 到固定路径，projectId 走 encodeURIComponent，整份清单原样解析", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createCaseMaterialsApi(async (url, init) => {
      收到.push({ url, init })
      return 回({ materials: [视图行], parseableExtensions: [".xlsx", ".xls", ".csv"] })
    })

    const 结果 = await api.read("p 1/甲")

    expect(收到).toHaveLength(1)
    expect(收到[0]?.url).toBe(`${PATH.materials}?projectId=${encodeURIComponent("p 1/甲")}`)
    expect(结果).toEqual({
      kind: "ok",
      value: { materials: [视图行], parseableExtensions: [".xlsx", ".xls", ".csv"] },
    })
  })

  test("read：不认识的状态 / 形状不对 ⇒ 整份判错，不降级成「未入队」", async () => {
    for (const 回包 of [
      { materials: [{ ...视图行, status: "已完成" }], parseableExtensions: [".xlsx"] },
      { materials: [{ ...视图行, factCount: "12" }], parseableExtensions: [".xlsx"] },
      { materials: [视图行] },
      [],
    ]) {
      const api = createCaseMaterialsApi(async () => 回(回包))
      const 结果 = await api.read("p1")
      expect(结果.kind, JSON.stringify(回包)).toBe("error")
    }
  })

  test("read：错误回包把服务端的 error 与 code 原样带回来", async () => {
    const api = createCaseMaterialsApi(async () => 回({ error: "不是该项目成员", code: "forbidden" }, 403))
    expect(await api.read("p1")).toEqual({ kind: "error", message: "不是该项目成员", code: "forbidden" })
  })

  test("read：非 JSON 与网络异常都收成 error，不抛", async () => {
    const 非JSON = createCaseMaterialsApi(async () => new Response("nope", { status: 200 }))
    expect((await 非JSON.read("p1")).kind).toBe("error")

    const 断网 = createCaseMaterialsApi(async () => {
      throw new Error("网络断了")
    })
    expect(await 断网.read("p1")).toEqual({ kind: "error", message: "网络断了" })
  })

  test("parse：POST 固定路径与动作体；成功只认 { ok: true }", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createCaseMaterialsApi(async (url, init) => {
      收到.push({ url, init })
      return 回({ ok: true, status: "排队中" })
    })

    const 结果 = await api.parse({ projectId: "p1", path: "资料/话单.xlsx", action: "入队" })

    expect(结果).toEqual({ kind: "ok" })
    expect(收到[0]?.url).toBe(PATH.parse)
    expect(收到[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(收到[0]?.init?.body))).toEqual({
      projectId: "p1",
      path: "资料/话单.xlsx",
      action: "入队",
    })
  })

  test("parse：ok 不是 true / status 不认识 ⇒ 形状错误；错误回包带 code", async () => {
    const 假成功 = createCaseMaterialsApi(async () => 回({ ok: false, status: "排队中" }))
    expect((await 假成功.parse({ projectId: "p1", path: "a.xlsx", action: "入队" })).kind).toBe("error")

    const 冲突 = createCaseMaterialsApi(async () =>
      回({ error: "产物只登记不解析", code: "artifact_not_parseable" }, 409),
    )
    expect(await 冲突.parse({ projectId: "p1", path: "a.xlsx", action: "跳过" })).toEqual({
      kind: "error",
      message: "产物只登记不解析",
      code: "artifact_not_parseable",
    })
  })
})
