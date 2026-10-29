/**
 * 使用面数据源（T017 / 需求 6）：可观测行为——
 * 成功写清单、失败留错误且**不吞清单**、旧回包不覆盖新回包、筛选变化回到第 1 页、
 * 空间全取消短路成空集（不发请求）、每页条数改动会持久化。
 */

import { describe, expect, test } from "bun:test"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import type { CatalogApi, CatalogOutcome, CatalogPage, CatalogQuery } from "./asset-catalog-api"
import type { FavoriteApi, FavoriteOutcome } from "./favorite-api"
import { createAssetCatalog } from "./asset-catalog"

const 资产 = (id: string): AssetMetadata => ({
  id,
  name: `资产 ${id}`,
  type: "skill",
  description: "",
  icon: "skill",
  category: "intelligence",
  tags: [],
  ownerId: "u-1",
  ownerName: "甲民警",
  department: "经侦支队",
  visibility: "global",
  version: 1,
  status: "published",
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1,
  updatedAt: 1,
  publishedAt: 1,
  archivedAt: null,
})

const 页 = (
  ids: readonly string[],
  total = ids.length,
  page = 1,
  pageSize = 20,
  categoryNames: Readonly<Record<string, string>> = {},
  favoritedIds: readonly string[] = [],
): CatalogPage => ({
  assets: ids.map(资产),
  total,
  page,
  pageSize,
  categoryNames,
  favoritedIds,
})

/** 每次调用挂起，由测试决定何时、**以什么顺序**回包（`待回[i]` 是第 i 次请求）。 */
function 手动(): {
  api: CatalogApi
  请求: CatalogQuery[]
  待回: Array<(out: CatalogOutcome<CatalogPage>) => void>
} {
  const 请求: CatalogQuery[] = []
  const 待回: Array<(out: CatalogOutcome<CatalogPage>) => void> = []
  const api: CatalogApi = {
    list: (query = {}) => {
      请求.push(query)
      return new Promise((resolve) => {
        待回.push(resolve)
      })
    },
  }
  return { api, 请求, 待回 }
}

const 等一轮 = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 收藏的替身：同 `手动()`，记下每次送的目标态，由测试决定何时回。 */
function 手动收藏(): {
  api: FavoriteApi
  请求: Array<{ readonly assetId: string; readonly favorited: boolean }>
  待回: Array<(out: FavoriteOutcome) => void>
} {
  const 请求: Array<{ readonly assetId: string; readonly favorited: boolean }> = []
  const 待回: Array<(out: FavoriteOutcome) => void> = []
  const api: FavoriteApi = {
    set: (assetId, favorited) => {
      请求.push({ assetId, favorited })
      return new Promise((resolve) => {
        待回.push(resolve)
      })
    },
  }
  return { api, 请求, 待回 }
}

describe("使用面数据源 · 拉取语义", () => {
  test("成功 ⇒ 清单与总数写进去、错误清空", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"], 1) })
    await 等一轮()

    expect(目录.assets().map((a) => a.id)).toEqual(["a1"])
    expect(目录.total()).toBe(1)
    expect(目录.error()).toBeUndefined()
  })

  test("失败 ⇒ 错误留下，已有清单不清空（旧清单比白屏有用）", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"]) })
    await 等一轮()

    目录.reload()
    待回[1]!({ kind: "failed", message: "连接服务失败，请检查网络后重试" })
    await 等一轮()

    expect(目录.error()).toContain("连接服务失败")
    expect(目录.assets().map((a) => a.id)).toEqual(["a1"])
  })

  test("旧回包晚到 ⇒ 丢弃，不覆盖后发的新清单", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({}) // 第一次
    目录.load({ category: "x" }) // 第二次
    待回[1]!({ kind: "ok", value: 页(["新"]) }) // 新的一次先回
    await 等一轮()
    待回[0]!({ kind: "ok", value: 页(["旧"]) }) // 旧的那次后回
    await 等一轮()

    expect(目录.assets().map((a) => a.id)).toEqual(["新"])
  })

  test("分类名随回包换新；失败时与清单一起留着；空集短路时清掉（需求 2）", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({ category: "__other__" })
    待回[0]!({ kind: "ok", value: 页(["a1"], 1, 1, 20, { supervision: "督导考核（已停用）" }) })
    await 等一轮()
    expect(目录.categoryNames()).toEqual({ supervision: "督导考核（已停用）" })

    // 失败不清清单，那分类名也不该清：卡片还挂着旧清单，名字得跟得上。
    目录.reload()
    待回[1]!({ kind: "failed", message: "连接服务失败，请检查网络后重试" })
    await 等一轮()
    expect(目录.categoryNames()).toEqual({ supervision: "督导考核（已停用）" })

    // 空间全取消：清单被本地清空，名字留着就是上一屏的残留。
    目录.load({ spaces: [] })
    await 等一轮()
    expect(目录.categoryNames()).toEqual({})
  })

  test("失败后再次成功 ⇒ 错误清空（错误不是粘住的）", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({ kind: "rejected", message: "登录状态已失效，请重新登录" })
    await 等一轮()
    expect(目录.error()).toContain("重新登录")

    目录.reload()
    待回[1]!({ kind: "ok", value: 页([]) })
    await 等一轮()

    expect(目录.error()).toBeUndefined()
  })
})

describe("使用面数据源 · 分页语义", () => {
  test("翻页保持条件；筛选变化回到第 1 页", async () => {
    const { api, 请求, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({ category: "intelligence" })
    目录.goPage(3)
    await 等一轮()
    expect(请求[1]?.page).toBe(3)
    expect(请求[1]?.category).toBe("intelligence")

    待回[1]!({ kind: "ok", value: 页([], 100, 3) })
    await 等一轮()
    expect(目录.page()).toBe(3)

    // 换分类 ⇒ 页码归 1（同分类重入不该归 1，下一页那条钉的就是这个）。
    目录.load({ category: "internal-doc" })
    expect(请求[2]?.page).toBe(1)
    expect(目录.page()).toBe(1)
  })

  test("同条件重入不把用户翻到的页顶回去", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({ category: "intelligence" })
    目录.goPage(2)
    待回[1]!({ kind: "ok", value: 页([], 40, 2) })
    await 等一轮()

    目录.load({ category: "intelligence" })
    await 等一轮()
    expect(目录.page()).toBe(2)
  })

  test("空间全取消 ⇒ 本地空集、不发请求", async () => {
    const { api, 请求, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"]) })
    await 等一轮()
    expect(目录.assets().length).toBe(1)

    目录.load({ spaces: [] })
    await 等一轮()
    expect(请求.length).toBe(1) // 没有第二个请求
    expect(目录.assets()).toEqual([])
    expect(目录.total()).toBe(0)
  })

  test("改每页条数 ⇒ 回到第 1 页并持久化；白名单外的值忽略", async () => {
    const 持久化: number[] = []
    const { api, 请求, 待回 } = 手动()
    const 目录 = createAssetCatalog(api, { persistPageSize: (size) => 持久化.push(size) })

    目录.load({})
    目录.goPage(2)
    待回[1]!({ kind: "ok", value: 页([], 60, 2, 20) })
    await 等一轮()

    目录.setPageSize(50)
    await 等一轮()
    expect(目录.page()).toBe(1)
    expect(目录.pageSize()).toBe(50)
    expect(请求.at(-1)?.pageSize).toBe(50)
    expect(持久化).toEqual([50])

    目录.setPageSize(30)
    expect(目录.pageSize()).toBe(50)
    expect(持久化).toEqual([50])
  })
})

describe("使用面数据源 · 收藏（2026-10-29）", () => {
  test("拉回一页 ⇒ favorited() 就是回包里「我收藏的」那组；换一页就跟着换", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1", "a2"], 2, 1, 20, {}, ["a2"]) })
    await 等一轮()
    expect([...目录.favorited()]).toEqual(["a2"])

    目录.goPage(2)
    待回[1]!({ kind: "ok", value: 页(["a3"], 3, 2, 20, {}, []) })
    await 等一轮()
    expect([...目录.favorited()]).toEqual([])
  })

  test("空间全取消短路 ⇒ 收藏也清空（旧页的收藏不能留在空集上）", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"], 1, 1, 20, {}, ["a1"]) })
    await 等一轮()
    expect(目录.favorited().has("a1")).toBe(true)

    目录.load({ spaces: [] })
    await 等一轮()
    expect([...目录.favorited()]).toEqual([])
  })

  test("收藏成功 ⇒ 集合加进去、卡片的人数换成服务端回的值、错误清空", async () => {
    const { api, 待回 } = 手动()
    const { api: 收藏Api, 请求, 待回: 待收藏 } = 手动收藏()
    const 目录 = createAssetCatalog(api, { favoriteApi: 收藏Api })

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"]) })
    await 等一轮()

    目录.setFavorite("a1", true)
    expect(请求).toEqual([{ assetId: "a1", favorited: true }])
    expect(目录.favoriteBusy()).toBe("a1")

    待收藏[0]!({ kind: "ok", value: { assetId: "a1", favorited: true, favoriteCount: 7 } })
    await 等一轮()

    expect(目录.favorited().has("a1")).toBe(true)
    expect(目录.favoriteBusy()).toBe(undefined)
    expect(目录.assets()[0]?.favoriteCount).toBe(7)
    expect(目录.error()).toBe(undefined)
  })

  test("取消成功 ⇒ 集合去掉（不是「翻一下」，是照服务端回的目标态）", async () => {
    const { api, 待回 } = 手动()
    const { api: 收藏Api, 待回: 待收藏 } = 手动收藏()
    const 目录 = createAssetCatalog(api, { favoriteApi: 收藏Api })

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"], 1, 1, 20, {}, ["a1"]) })
    await 等一轮()

    目录.setFavorite("a1", false)
    待收藏[0]!({ kind: "ok", value: { assetId: "a1", favorited: false, favoriteCount: 0 } })
    await 等一轮()

    expect(目录.favorited().has("a1")).toBe(false)
    expect(目录.assets()[0]?.favoriteCount).toBe(0)
  })

  test("失败 ⇒ 集合与清单都不动，只留一句错误（乐观改状态会把用户骗一次）", async () => {
    const { api, 待回 } = 手动()
    const { api: 收藏Api, 待回: 待收藏 } = 手动收藏()
    const 目录 = createAssetCatalog(api, { favoriteApi: 收藏Api })

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"]) })
    await 等一轮()

    目录.setFavorite("a1", true)
    待收藏[0]!({ kind: "rejected", message: "无权使用该资产" })
    await 等一轮()

    expect(目录.favorited().has("a1")).toBe(false)
    expect(目录.assets()[0]?.favoriteCount).toBe(0)
    expect(目录.error()).toBe("无权使用该资产")
    expect(目录.favoriteBusy()).toBe(undefined)
  })

  test("在飞的时候再点 ⇒ 只发一条（回包顺序才有定数）", async () => {
    const { api, 待回 } = 手动()
    const { api: 收藏Api, 请求, 待回: 待收藏 } = 手动收藏()
    const 目录 = createAssetCatalog(api, { favoriteApi: 收藏Api })

    目录.load({})
    待回[0]!({ kind: "ok", value: 页(["a1"]) })
    await 等一轮()

    目录.setFavorite("a1", true)
    目录.setFavorite("a1", false)
    expect(请求.length).toBe(1)

    待收藏[0]!({ kind: "ok", value: { assetId: "a1", favorited: true, favoriteCount: 1 } })
    await 等一轮()
    expect(目录.favorited().has("a1")).toBe(true)
  })

  test("usage 由 load 成功时的回包重建；空间全取消时清空", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({
      kind: "ok",
      value: { ...页([]), usageStats: { days: 30, stats: { a1: { users: 2, calls: 5 } } } },
    })
    await 等一轮()
    expect(目录.usage()).toEqual({ days: 30, stats: { a1: { users: 2, calls: 5 } } })

    目录.load({ spaces: [] })
    await 等一轮()
    expect(目录.usage()).toBeUndefined()
  })

  test("拉取失败 ⇒ usage 保留上一份（一次网络抖动不等于没有用量）", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.load({})
    待回[0]!({
      kind: "ok",
      value: { ...页([]), usageStats: { days: 30, stats: { a1: { users: 2, calls: 5 } } } },
    })
    await 等一轮()
    expect(目录.usage()).toEqual({ days: 30, stats: { a1: { users: 2, calls: 5 } } })

    目录.reload()
    待回[1]!({ kind: "failed", message: "网络断了" })
    await 等一轮()
    expect(目录.error()).toBe("网络断了")
    expect(目录.usage()).toEqual({ days: 30, stats: { a1: { users: 2, calls: 5 } } })
  })
})
