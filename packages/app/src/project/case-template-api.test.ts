import { afterEach, describe, expect, test } from "bun:test"
import { TIMEOUT_MS, 超时提示 } from "./entity-api"
import {
  复位词表缓存,
  createCaseTemplateApi,
  是用户模板id,
  type 模板行,
  type 模板词表,
} from "./case-template-api"

afterEach(() => {
  复位词表缓存()
})

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const 行: 模板行 = {
  id: "用户:1",
  name: "通话",
  event_type: "通话",
  slots: { 谁: { 字段: "caller", 角色: "主叫" } },
  required: ["谁"],
  version: 1,
  verified_at: null,
  hit_count: 0,
  disabled_at: null,
}

const 词表体 = {
  槽们: ["谁", "和谁", "何时", "何时止", "何地", "多少钱", "其他"],
  事件类型们: [{ 值: "通话", 可选: true }, { 值: "资金交易", 可选: false, 原因: "不能建" }],
  字段们: [{ 值: "caller", 显示名: "主叫号码", 种类: "号码" }],
  槽可选字段们: { 谁: ["caller"], 和谁: [], 何时: [], 何时止: [], 何地: [], 多少钱: [], 其他: [] },
  其他不可选种类: ["金额", "时间", "方向"],
  角色们: [{ 值: "主体", 地点类: false }],
  默认角色: { 谁: "主体", 和谁: "对方", 何地: "地点" },
  实体类型们: ["人"],
  必填恒含: "谁",
} satisfies 模板词表

describe("模板客户端 · 取数", () => {
  test("list：URL 带 encodeURIComponent；含停用=true 才带参数；解包 list", async () => {
    const 收到: string[] = []
    const api = createCaseTemplateApi(async (url) => {
      收到.push(url)
      return 回({ list: [行] })
    })
    expect(await api.list("p 1/甲")).toEqual({ kind: "ok", value: [行] })
    expect(await api.list("p 1/甲", true)).toEqual({ kind: "ok", value: [行] })
    expect(收到[0]).toBe(`/openhive/case/card-templates?projectId=${encodeURIComponent("p 1/甲")}`)
    expect(收到[1]).toBe(`/openhive/case/card-templates?projectId=${encodeURIComponent("p 1/甲")}&含停用=true`)
  })

  test("vocab：模块级缓存一次；失败不缓存", async () => {
    let 次数 = 0
    let 结果: Response = 回(词表体)
    const api = createCaseTemplateApi(async () => {
      次数 += 1
      return 结果
    })
    const 首 = await api.vocab()
    expect(首).toEqual({ kind: "ok", value: 词表体 })
    expect(await api.vocab()).toEqual({ kind: "ok", value: 词表体 })
    expect(次数).toBe(1)

    复位词表缓存()
    结果 = 回({ error: "词表坏了" }, 500)
    expect(await api.vocab()).toEqual({ kind: "error", message: "词表坏了", code: undefined })
    // 失败不缓存：再问一次会再发
    expect((await api.vocab()).kind).toBe("error")
    expect(次数).toBe(3)
  })

  test("is 用户模板：前缀判定是 HTTP 协议的一部分", () => {
    expect(是用户模板id("用户:abc")).toBe(true)
    expect(是用户模板id("内置:资金/v1")).toBe(false)
  })
})

describe("模板客户端 · 写口", () => {
  test("create / update：方法 POST、JSON 体、projectId 与定义同层", async () => {
    const 收到: Array<{ url: string; init?: RequestInit }> = []
    const api = createCaseTemplateApi(async (url, init) => {
      收到.push({ url, init })
      return 回(行)
    })
    const 定义 = { name: "通话", eventType: "通话", slots: { 谁: { 字段: "caller" } }, required: ["谁" as const] }
    expect((await api.create({ projectId: "p-1", ...定义 })).kind).toBe("ok")
    expect((await api.update({ projectId: "p-1", id: "用户:1", ...定义 })).kind).toBe("ok")
    expect(收到[0]?.url).toBe("/openhive/case/card-template/create")
    expect(收到[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(收到[0]?.init?.body))).toEqual({ projectId: "p-1", ...定义 })
    expect(收到[1]?.url).toBe("/openhive/case/card-template/update")
    expect(JSON.parse(String(收到[1]?.init?.body))).toEqual({ projectId: "p-1", id: "用户:1", ...定义 })
  })

  test("disable / restore：POST {projectId,id}，成功体 {ok:true}", async () => {
    const 收到: string[] = []
    const api = createCaseTemplateApi(async (url, init) => {
      收到.push(`${url} ${init?.method} ${String(init?.body)}`)
      return 回({ ok: true })
    })
    expect(await api.disable({ projectId: "p-1", id: "用户:1" })).toEqual({ kind: "ok", value: { ok: true } })
    expect(await api.restore({ projectId: "p-1", id: "用户:1" })).toEqual({ kind: "ok", value: { ok: true } })
    expect(收到).toEqual([
      `/openhive/case/card-template/disable POST {"projectId":"p-1","id":"用户:1"}`,
      `/openhive/case/card-template/restore POST {"projectId":"p-1","id":"用户:1"}`,
    ])
  })

  test("preview：传草稿 template，不是 templateId", async () => {
    const 收到: Array<Record<string, unknown>> = []
    const api = createCaseTemplateApi(async (_url, init) => {
      收到.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return 回({ 卡片数: 0, 跳过: {}, 卡片们: [], 工作表们: [] })
    })
    const 定义 = { name: "通话", eventType: "通话", slots: { 谁: { 字段: "caller" } }, required: ["谁" as const] }
    await api.preview({ projectId: "p-1", materialId: "m-1", template: 定义 })
    expect(收到[0]).toEqual({ projectId: "p-1", materialId: "m-1", template: 定义 })
  })

  test("verify：成功带 卡片数 / 跳过；400 preview_failed 的 跳过 不许丢", async () => {
    const api = createCaseTemplateApi(async () =>
      回({ error: "预览没有产出任何卡片：请检查必填槽与数据", code: "preview_failed", 跳过: { "缺少「谁」": 20 } }, 400),
    )
    expect(await api.verify({ projectId: "p-1", id: "用户:1", materialId: "m-1" })).toEqual({
      kind: "error",
      message: "预览没有产出任何卡片：请检查必填槽与数据",
      code: "preview_failed",
      跳过: { "缺少「谁」": 20 },
    })

    const 好 = createCaseTemplateApi(async () =>
      回({ verified_at: 123, 卡片数: 3, 跳过: { "空行": 1 }, already: true }),
    )
    expect(await 好.verify({ projectId: "p-1", id: "用户:1", materialId: "m-1" })).toEqual({
      kind: "ok",
      value: { verified_at: 123, 卡片数: 3, 跳过: { "空行": 1 }, already: true },
    })
  })

  test("超时：AbortError ⇒ 中文超时话（不透浏览器原文）", async () => {
    const api = createCaseTemplateApi(async () => {
      throw new DOMException("signal is aborted without reason", "AbortError")
    })
    expect(await api.list("p-1")).toEqual({ kind: "error", message: 超时提示, code: "timeout" })
    expect(超时提示).toContain(String(TIMEOUT_MS / 1000))
  })
})
