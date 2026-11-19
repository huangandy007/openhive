import { afterEach, describe, expect, test } from "bun:test"
import { onSessionExpired } from "../auth/session-expired"
import { PATH, createCaseMaterialsApi } from "./case-materials-api"

const 原fetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = 原fetch
})

/** 把进程的 `fetch` 换成替身；`preconnect` 原样借过来（同 `capability-action-api.test.ts`）。 */
function 设服务(回: () => Response) {
  const 替身 = async () => 回()
  globalThis.fetch = Object.assign(替身, { preconnect: 原fetch.preconnect })
}

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
  adapterId: "jin-liu" as string | null,
  adapterVersion: "1.2.0" as string | null,
  reasonCode: "未识别:无匹配适配器" as string | null,
  progress: {
    阶段: "转换" as const,
    已处理: 300,
    总数: 1200,
    更新时间: 1700000000,
  } as { 阶段: "读表" | "探测" | "转换" | "写入" | "富化"; 已处理?: number; 总数?: number; 更新时间: number } | null,
  probe: {
    状态: "已识别" as const,
    适配器id: "jin-liu",
    版本: "1.2.0",
    完成秒: 1700000001,
  } as {
    状态: "探测中" | "已识别" | "未识别"
    适配器id?: string
    版本?: string
    原因码?: string
    完成秒?: number
  } | null,
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

  test("默认发送收到 401 ⇒ 喊会话过期（登录门据此重探），结论仍是 error、不抛", async () => {
    const 声: string[] = []
    const 退订 = onSessionExpired(() => 声.push("401"))
    设服务(() => new Response(null, { status: 401 }))
    try {
      const api = createCaseMaterialsApi()
      const 结果 = await api.read("p1")
      // 空体 401 落成「非 JSON」仍是 error；关键是不抛、并且喊了一声。
      expect(结果.kind).toBe("error")
    } finally {
      退订()
    }
    expect(声).toEqual(["401"])
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

  test("read：+5 字段原样解析；缺省 / null 一律 null，不猜", async () => {
    const 缺省 = {
      id: "m2",
      path: "资料/流水.xlsx",
      kind: "资金",
      status: "未入队" as const,
      detail: null,
      queueAhead: 0,
      factCount: 0,
      numberCount: 0,
      parseable: true,
    }
    const api = createCaseMaterialsApi(async () =>
      回({ materials: [视图行, 缺省], parseableExtensions: [".xlsx"] }),
    )
    const 结果 = await api.read("p1")
    expect(结果.kind).toBe("ok")
    if (结果.kind !== "ok") return
    expect(结果.value.materials[0]).toEqual(视图行)
    expect(结果.value.materials[1]).toEqual({
      ...缺省,
      adapterId: null,
      adapterVersion: null,
      reasonCode: null,
      progress: null,
      probe: null,
    })
  })

  test("read：progress 阶段 / probe 状态不在闭集，或字段类型不对 ⇒ 整份判错（不知道 ≠ null）", async () => {
    const 坏 = [
      { ...视图行, progress: { ...视图行.progress, 阶段: "解码" } },
      { ...视图行, progress: { ...视图行.progress, 已处理: "300" } },
      { ...视图行, progress: { ...视图行.progress, 总数: -1 } },
      { ...视图行, probe: { 状态: "已完成" } },
      { ...视图行, probe: { 状态: "未识别", 原因码: 7 } },
      { ...视图行, adapterId: 7 },
      { ...视图行, probe: "已识别" },
    ]
    for (const 行 of 坏) {
      const api = createCaseMaterialsApi(async () => 回({ materials: [行], parseableExtensions: [".xlsx"] }))
      const 结果 = await api.read("p1")
      expect(结果.kind, JSON.stringify(行)).toBe("error")
    }
  })

  test("read：未识别 可选参数 ⇒ URL 追加 &未识别=1；不传时行为不变", async () => {
    const 收到: string[] = []
    const api = createCaseMaterialsApi(async (url) => {
      收到.push(url)
      return 回({ materials: [], parseableExtensions: [] })
    })
    await api.read("p1", true)
    await api.read("p1")
    expect(收到[0]).toBe(`${PATH.materials}?projectId=p1&未识别=1`)
    expect(收到[1]).toBe(`${PATH.materials}?projectId=p1`)
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
