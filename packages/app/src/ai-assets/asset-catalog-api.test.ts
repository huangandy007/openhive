/**
 * AI 资产使用面客户端（T017）：把内核的一条出口翻成三种结论。
 *
 * 这一层不连网：`send` 是替身，返回手工造的 `Response`。与治理客户端同一批纪律——
 * 哪些状态码算「被拒」、哪些算「没说成」、返回体形状不对会不会被当成空列表。
 *
 * 路径用**字面量**断言（`#003-05`）：不引 `PATH` 常量，否则实现和自己比对。
 */

import { describe, expect, test } from "bun:test"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { createCatalogApi, type CatalogFetch } from "./asset-catalog-api"

function 替身(应答: (call: { input: string; init?: RequestInit }) => Response | Promise<Response>): {
  send: CatalogFetch
  calls: Array<{ readonly input: string; readonly init?: RequestInit }>
} {
  const calls: Array<{ readonly input: string; readonly init?: RequestInit }> = []
  const send: CatalogFetch = async (input, init) => {
    calls.push({ input, init })
    return 应答({ input, init })
  }
  return { send, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

const 资产 = (id: string, overrides: Partial<AssetMetadata> = {}): AssetMetadata => ({
  id,
  name: "资金流水分析",
  type: "skill",
  description: "按账号汇总资金流向",
  icon: "skill",
  category: "intelligence",
  tags: ["资金", "研判"],
  ownerId: "u-1",
  ownerName: "甲民警",
  department: "经侦支队",
  visibility: "global",
  version: 1,
  status: "published",
  favoriteCount: 0,
  usageCount: 3,
  rating: 4.5,
  ratingCount: 2,
  feedbackCount: 0,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_100,
  publishedAt: 1_700_000_100,
  archivedAt: null,
  ...overrides,
})

describe("使用面资产客户端", () => {
  test("GET 同源路径；无查询串时不带 ?；回包里行与分页字段整份保留", async () => {
    const rows = [资产("a1"), 资产("a2", { visibility: "department", department: "刑侦大队" })]
    const { send, calls } = 替身(() => json({ assets: rows, total: 25, page: 2, pageSize: 20 }))

    const out = await createCatalogApi(send).list()

    expect(calls[0]?.input).toBe("/openhive/assets")
    expect(out.kind).toBe("ok")
    if (out.kind === "ok") {
      expect(out.value.assets).toEqual(rows)
      expect(out.value.total).toBe(25)
      expect(out.value.page).toBe(2)
      expect(out.value.pageSize).toBe(20)
    }
  })

  test("type / q / category / 空间 / 分页 进查询串；q 两端空白裁掉、空 q 不进 URL", async () => {
    const { send, calls } = 替身(() => json({ assets: [], total: 0, page: 1, pageSize: 20 }))
    const api = createCatalogApi(send)

    await api.list({ type: "mcp", q: "  话单  " })
    await api.list({ q: "   " })
    await api.list({
      category: "intelligence",
      spaces: ["global", "department"],
      page: 2,
      pageSize: 50,
    })

    expect(calls[0]?.input).toBe("/openhive/assets?type=mcp&q=%E8%AF%9D%E5%8D%95")
    expect(calls[1]?.input).toBe("/openhive/assets")
    // 空间是**重复参数**（服务端逐值收窄），顺序按左栏闭集顺序。
    expect(calls[2]?.input).toBe(
      "/openhive/assets?category=intelligence&visibility=global&visibility=department&page=2&pageSize=50",
    )
  })

  test("401 ⇒ rejected（登录失效），不做成空列表", async () => {
    const { send } = 替身(() => new Response("", { status: 401 }))
    const out = await createCatalogApi(send).list()

    expect(out.kind).toBe("rejected")
    if (out.kind === "rejected") expect(out.message).toContain("重新登录")
  })

  test("4xx ⇒ rejected 且带服务端的 error 文案", async () => {
    const { send } = 替身(() => json({ error: "未知资产类型：unknown" }, 400))
    const out = await createCatalogApi(send).list({ type: "skill" })

    expect(out.kind).toBe("rejected")
    if (out.kind === "rejected") expect(out.message).toBe("未知资产类型：unknown")
  })

  test("5xx ⇒ failed（服务端故障，不是「你这请求不对」）", async () => {
    const { send } = 替身(() => json({ error: "内部错误" }, 500))
    const out = await createCatalogApi(send).list()

    expect(out.kind).toBe("failed")
  })

  test("网络异常 ⇒ failed，不当成空列表", async () => {
    const { send } = 替身(() => {
      throw new Error("ECONNREFUSED")
    })
    const out = await createCatalogApi(send).list()

    expect(out.kind).toBe("failed")
  })

  test("返回体不是 {assets:[...], total, page, pageSize} ⇒ failed（形状不对不猜空）", async () => {
    for (const body of [{ items: [] }, { assets: [] }, { assets: [], total: 0, page: 1 }]) {
      const { send } = 替身(() => json(body))
      const out = await createCatalogApi(send).list()

      expect(out.kind).toBe("failed")
      if (out.kind === "failed") expect(out.message).toContain("格式不对")
    }
  })

  test("categoryNames：服务端给的就原样带出（含停用分类的名字）；不给 = 空表；形状不对 ⇒ failed", async () => {
    const names = { supervision: "督导考核（已停用）", intelligence: "情报研判" }
    const 有名字 = await createCatalogApi(
      替身(() => json({ assets: [], total: 0, page: 1, pageSize: 20, categoryNames: names })).send,
    ).list()
    expect(有名字.kind).toBe("ok")
    if (有名字.kind === "ok") expect(有名字.value.categoryNames).toEqual(names)

    // 没有这一列（或服务端还没升级）不算形状变了：卡片退回显示分类 id，其余照常。
    const 没名字 = await createCatalogApi(
      替身(() => json({ assets: [], total: 0, page: 1, pageSize: 20 })).send,
    ).list()
    expect(没名字.kind).toBe("ok")
    if (没名字.kind === "ok") expect(没名字.value.categoryNames).toEqual({})

    // 有这一列但不是「id → 名字」的表：那是形状变了，不能当空表吞掉。
    for (const bad of [[], "x", { supervision: 1 }, null]) {
      const out = await createCatalogApi(
        替身(() => json({ assets: [], total: 0, page: 1, pageSize: 20, categoryNames: bad })).send,
      ).list()
      expect(out.kind).toBe("failed")
    }
  })

  test("favoritedIds：本页里我收藏过的原样带出；不给 = 空数组；元素不是字符串 ⇒ failed", async () => {
    const 有收藏 = await createCatalogApi(
      替身(() => json({ assets: [资产("a1")], total: 1, page: 1, pageSize: 20, favoritedIds: ["a1"] })).send,
    ).list()
    expect(有收藏.kind).toBe("ok")
    if (有收藏.kind === "ok") expect(有收藏.value.favoritedIds).toEqual(["a1"])

    // 没有这一列（旧内核 / 治理侧）不算形状变了：一条都不标「已收藏」，其余照常。
    const 没这列 = await createCatalogApi(
      替身(() => json({ assets: [], total: 0, page: 1, pageSize: 20 })).send,
    ).list()
    expect(没这列.kind).toBe("ok")
    if (没这列.kind === "ok") expect(没这列.value.favoritedIds).toEqual([])

    // 有这一列但不是字符串数组：形状变了，不能当空数组吞掉（否则「已收藏」会静默变「未收藏」）。
    for (const bad of [[1], "a1", { a1: true }, null]) {
      const out = await createCatalogApi(
        替身(() => json({ assets: [], total: 0, page: 1, pageSize: 20, favoritedIds: bad })).send,
      ).list()
      expect(out.kind).toBe("failed")
    }
  })

  test("一行缺列 / 枚举越界 ⇒ 整体 failed（不跳过坏行假装成功）", async () => {
    const 缺描述 = { ...资产("a1") } as Record<string, unknown>
    delete 缺描述["description"]
    for (const bad of [缺描述, { ...资产("a2"), status: "deleted" }, { ...资产("a3"), publishedAt: "x" }]) {
      const { send } = 替身(() => json({ assets: [bad], total: 1, page: 1, pageSize: 20 }))
      const out = await createCatalogApi(send).list()
      expect(out.kind).toBe("failed")
    }
  })
})

describe("使用统计 usageStats（2026-10-29）", () => {
  const 一页 = (extra: Record<string, unknown>) => ({
    assets: [资产("a1")],
    total: 1,
    page: 1,
    pageSize: 20,
    ...extra,
  })

  test("给了就整份保留：days 与 stats 原样交出去", async () => {
    const { send } = 替身(() =>
      json(一页({ usageStats: { days: 30, stats: { a1: { users: 3, calls: 12 } } } })),
    )

    const out = await createCatalogApi(send).list()

    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value.usageStats).toEqual({ days: 30, stats: { a1: { users: 3, calls: 12 } } })
  })

  test("旧内核没给 ⇒ 省略（不是形状错，也不是空表）", async () => {
    const { send } = 替身(() => json(一页({})))

    const out = await createCatalogApi(send).list()

    expect(out.kind).toBe("ok")
    if (out.kind === "ok") expect(out.value.usageStats).toBeUndefined()
  })

  test("形状不对 ⇒ 整页 failed（不猜默认 0）", async () => {
    const { send } = 替身(() => json(一页({ usageStats: { days: "30", stats: {} } })))

    const out = await createCatalogApi(send).list()

    expect(out.kind).toBe("failed")
  })
})
