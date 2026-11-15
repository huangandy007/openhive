/**
 * 关系图 HTTP 客户端（012 · T007）。
 *
 * 四件事各一条：**地址与方法**照 T006 已交付的端点事实（`read` = GET + query；
 * `init` / `ops` / `export` = POST + JSON 体）、**非 2xx 收成 error 且带 code**、
 * **409 保留 `最新版本`**（这是 `请求` 会丢、所以必须走 `请求带错误体` 的那一项）、
 * **失败从不抛**。
 *
 * projectId 在**调用时**取（`currentProject()` 是模块级单例，测试没有应用上下文），
 * 所以工厂第二个参数就是那条缝——生产调用点不传它。
 */
import { describe, expect, test } from "bun:test"
import { PREFIX, createHgraphApi, type 操作 } from "./hgraph-api"

const 回包 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** 记录每一次 send 的入参——**唯一**的观测面（不 spy 全局 fetch）。 */
function 假发送(回: (url: string, init?: RequestInit) => Response | Promise<Response>, 项目 = "p 1") {
  const 看到: Array<{ url: string; init?: RequestInit }> = []
  const api = createHgraphApi(async (url, init) => {
    看到.push({ url, init })
    return await 回(url, init)
  }, () => 项目)
  return { api, 看到 }
}

describe("关系图 API 客户端", () => {
  test("读 = GET + query，projectId 在调用时取", async () => {
    const { api, 看到 } = 假发送(() => 回包({ 内容: "{}", 版本: "v1" }))

    expect(await api.读({ path: "分析/张三资金流向.hgraph" })).toEqual({
      kind: "ok",
      value: { 内容: "{}", 版本: "v1" },
    })
    expect(看到).toHaveLength(1)
    expect(看到[0]!.url).toBe(
      `${PREFIX}/read?${new URLSearchParams({ projectId: "p 1", path: "分析/张三资金流向.hgraph" }).toString()}`,
    )
    // GET 是 fetch 的默认方法：这里**不传** init（传一个 `method: "GET"` 也能跑，但没必要）。
    expect(看到[0]!.init).toBeUndefined()
  })

  test("初始化 = POST + JSON 体（projectId / path）", async () => {
    const { api, 看到 } = 假发送(() => 回包({ 内容: "{}", 版本: "v2", 写入: true }))

    expect(await api.初始化({ path: "分析/新图.hgraph" })).toEqual({
      kind: "ok",
      value: { 内容: "{}", 版本: "v2", 写入: true },
    })
    expect(看到[0]!.url).toBe(`${PREFIX}/init`)
    expect(看到[0]!.init?.method).toBe("POST")
    expect(JSON.parse(String(看到[0]!.init?.body))).toEqual({ projectId: "p 1", path: "分析/新图.hgraph" })
  })

  test("写 = POST + JSON 体，版本 / 批次 / 幂等键原样带上", async () => {
    const 操作: 操作[] = [{ 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 10, y: 20 }] }]
    const { api, 看到 } = 假发送(() =>
      回包({
        版本: "v3",
        结果: {
          映射: { tmp1: "n1" },
          复用: [],
          新增: { 节点: 0, 边: 0, 文字: 0 },
          更新: 1,
          删除: { 节点: 0, 边: 0 },
        },
        重放: false,
      }),
    )

    const 回 = await api.写({ path: "分析/新图.hgraph", 版本: "v2", 操作, 批次: "ai-1", 幂等键: "k1" })

    expect(回.kind).toBe("ok")
    expect(看到[0]!.url).toBe(`${PREFIX}/ops`)
    expect(看到[0]!.init?.method).toBe("POST")
    expect(JSON.parse(String(看到[0]!.init?.body))).toEqual({
      projectId: "p 1",
      path: "分析/新图.hgraph",
      版本: "v2",
      操作,
      批次: "ai-1",
      幂等键: "k1",
    })
  })

  test("409 收成 error 且**保留** `最新版本`（这是 `请求` 会丢的那一项）", async () => {
    const { api } = 假发送(() =>
      回包({ error: "图已被别人改过", code: "VERSION_CONFLICT", 最新版本: "v9" }, 409),
    )

    expect(await api.写({ path: "图.hgraph", 版本: "v1", 操作: [] })).toEqual({
      kind: "error",
      message: "图已被别人改过",
      code: "VERSION_CONFLICT",
      最新版本: "v9",
    })
  })

  test("非 2xx 收成 error 且带 code——从不抛", async () => {
    const { api } = 假发送(() => 回包({ error: "不是该项目成员", code: "FORBIDDEN" }, 403))

    expect(await api.读({ path: "图.hgraph" })).toEqual({
      kind: "error",
      message: "不是该项目成员",
      code: "FORBIDDEN",
    })
  })

  test("导出许可 = POST + JSON 体", async () => {
    const { api, 看到 } = 假发送(() => 回包({ 允许: true, 文件名: "专案A-张三资金流向-20261115-1003.png" }))

    expect(await api.导出许可({ path: "分析/张三资金流向.hgraph" })).toEqual({
      kind: "ok",
      value: { 允许: true, 文件名: "专案A-张三资金流向-20261115-1003.png" },
    })
    expect(看到[0]!.url).toBe(`${PREFIX}/export`)
    expect(看到[0]!.init?.method).toBe("POST")
    expect(JSON.parse(String(看到[0]!.init?.body))).toEqual({
      projectId: "p 1",
      path: "分析/张三资金流向.hgraph",
    })
  })

  test("没有当前项目 ⇒ 不发请求，直接给一句人话", async () => {
    const 看到: string[] = []
    const api = createHgraphApi(async (url) => {
      看到.push(url)
      throw new Error("不该发请求")
    }, () => undefined)

    const 回 = await api.读({ path: "图.hgraph" })

    expect(回.kind).toBe("error")
    expect(看到).toEqual([])
  })
})
