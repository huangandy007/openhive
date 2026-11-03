import { describe, expect, test } from "bun:test"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import type { CatalogApi, CatalogOutcome, CatalogPage } from "./asset-catalog-api"
import { createMcpCapability } from "./mcp-capability"

/**
 * 能力面板 MCP 组的数据源（2026-11-03）。
 *
 * 与服务端保持同一份判据：`GET /openhive/assets?type=mcp` 已经按读者收敛过（服务端不再二次过滤，
 * `#002-06`）；这里只负责「按需取一次、把三态分开」，不做第二套可见性判断。
 *
 * 断言纪律（`#009-01`）：不比较节点；这里也不比 promise，只比落定后的信号值。
 */
const 一页 = (assets: readonly AssetMetadata[], total = assets.length): CatalogPage => ({
  assets,
  total,
  page: 1,
  pageSize: 100,
  categoryNames: {},
  favoritedIds: [],
  writableIds: [],
})

const 资产 = (id: string, name: string, description = ""): AssetMetadata => ({
  id,
  name,
  description,
  type: "mcp",
  status: "published",
  visibility: "global",
  summary: "",
  precautions: "",
  icon: "mcp",
  category: "intelligence",
  tags: [],
  ownerId: "u1",
  ownerName: "李四",
  department: "x",
  version: 1,
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1,
  updatedAt: 1,
  publishedAt: 1,
  archivedAt: null,
  iterationNote: "",
  iterationWorkspace: null,
})

function 假接口(结果: CatalogOutcome<CatalogPage>, 记录?: { 次数: number; 查询?: unknown }): CatalogApi {
  return {
    list: async (query) => {
      if (记录 !== undefined) {
        记录.次数 += 1
        记录.查询 = query
      }
      return 结果
    },
  }
}

const 等 = async () => {
  // `load()` 是 fire-and-forget；等微任务队列把回包落进信号。
  await new Promise((r) => setTimeout(r, 0))
}

describe("createMcpCapability（2026-11-03）", () => {
  test("初始是「还没读到」：list undefined、无错误、不忙", () => {
    const 能力 = createMcpCapability(假接口({ kind: "ok", value: 一页([]) }))
    expect(能力.list()).toBeUndefined()
    expect(能力.error()).toBeUndefined()
    expect(能力.busy()).toBe(false)
  })

  test("load 成功 ⇒ 只收展示字段，并按 type=mcp 且一页取满", async () => {
    const 记录 = { 次数: 0 } as { 次数: number; 查询?: unknown }
    const 能力 = createMcpCapability(
      假接口({ kind: "ok", value: 一页([资产("m1", "GoNavi", "数据库工作台"), 资产("m2", "话单查询")]) }, 记录),
    )

    能力.load()
    expect(能力.busy()).toBe(true)
    await 等()

    expect(能力.busy()).toBe(false)
    expect(能力.error()).toBeUndefined()
    expect(能力.list()).toEqual([
      { id: "m1", name: "GoNavi", description: "数据库工作台" },
      { id: "m2", name: "话单查询", description: "" },
    ])
    expect(记录.查询).toEqual({ type: "mcp", page: 1, pageSize: 100 })
  })

  test("服务端拒绝 ⇒ 错误原文落 error，list 仍是 undefined（不把失败画成 0 台）", async () => {
    const 能力 = createMcpCapability(假接口({ kind: "rejected", message: "登录状态已失效，请重新登录" }))
    能力.load()
    await 等()

    expect(能力.error()).toBe("登录状态已失效，请重新登录")
    expect(能力.list()).toBeUndefined()
    expect(能力.busy()).toBe(false)
  })

  test("网络失败 ⇒ 走 failed 分支，同样不产生空清单", async () => {
    const 能力 = createMcpCapability(假接口({ kind: "failed", message: "连接服务失败，请检查网络后重试" }))
    能力.load()
    await 等()

    expect(能力.error()).toBe("连接服务失败，请检查网络后重试")
    expect(能力.list()).toBeUndefined()
  })

  test("在飞期间再点一次 ⇒ 不发第二个请求（连点不放大）", async () => {
    const 记录 = { 次数: 0 } as { 次数: number; 查询?: unknown }
    const 能力 = createMcpCapability(假接口({ kind: "ok", value: 一页([]) }, 记录))

    能力.load()
    能力.load()
    await 等()

    expect(记录.次数).toBe(1)
  })

  test("读成功后重试会刷新（不是只认第一次）", async () => {
    let 第几次 = 0
    const 能力 = createMcpCapability({
      list: async () => {
        第几次 += 1
        return { kind: "ok", value: 一页(第几次 === 1 ? [资产("m1", "GoNavi")] : [资产("m1", "GoNavi"), 资产("m2", "话单查询")]) }
      },
    })

    能力.load()
    await 等()
    expect(能力.list()?.length).toBe(1)

    能力.load()
    await 等()
    expect(能力.list()?.length).toBe(2)
  })

  test("先失败后重试成功 ⇒ error 清空", async () => {
    let 第几次 = 0
    const 能力 = createMcpCapability({
      list: async () => {
        第几次 += 1
        return 第几次 === 1
          ? { kind: "failed", message: "连接服务失败，请检查网络后重试" }
          : { kind: "ok", value: 一页([资产("m1", "GoNavi")]) }
      },
    })

    能力.load()
    await 等()
    expect(能力.error()).not.toBeUndefined()

    能力.load()
    await 等()
    expect(能力.error()).toBeUndefined()
    expect(能力.list()?.length).toBe(1)
  })
})
