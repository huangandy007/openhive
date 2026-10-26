/**
 * 使用面数据源（T017）：拉取时机之外的三个可观测行为——
 * 成功写清单、失败留错误且**不吞清单**、旧回包不覆盖新回包。
 */

import { describe, expect, test } from "bun:test"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import type { CatalogApi, CatalogOutcome } from "./asset-catalog-api"
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

/** 每次调用挂起，由测试决定何时、**以什么顺序**回包（`待回[i]` 是第 i 次请求）。 */
function 手动(): { api: CatalogApi; 待回: Array<(out: CatalogOutcome<readonly AssetMetadata[]>) => void> } {
  const 待回: Array<(out: CatalogOutcome<readonly AssetMetadata[]>) => void> = []
  const api: CatalogApi = {
    list: () =>
      new Promise((resolve) => {
        待回.push(resolve)
      }),
  }
  return { api, 待回 }
}

const 等一轮 = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("使用面数据源 · 拉取语义", () => {
  test("成功 ⇒ 清单写进去、错误清空", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.refresh()
    待回[0]!({ kind: "ok", value: [资产("a1")] })
    await 等一轮()

    expect(目录.assets().map((a) => a.id)).toEqual(["a1"])
    expect(目录.error()).toBeUndefined()
  })

  test("失败 ⇒ 错误留下，已有清单不清空（旧清单比白屏有用）", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.refresh()
    待回[0]!({ kind: "ok", value: [资产("a1")] })
    await 等一轮()

    目录.refresh()
    待回[1]!({ kind: "failed", message: "连接服务失败，请检查网络后重试" })
    await 等一轮()

    expect(目录.error()).toContain("连接服务失败")
    expect(目录.assets().map((a) => a.id)).toEqual(["a1"])
  })

  test("旧回包晚到 ⇒ 丢弃，不覆盖后发的新清单", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.refresh() // 第一次
    目录.refresh() // 第二次
    待回[1]!({ kind: "ok", value: [资产("新")] }) // 新的一次先回
    await 等一轮()
    待回[0]!({ kind: "ok", value: [资产("旧")] }) // 旧的那次后回
    await 等一轮()

    expect(目录.assets().map((a) => a.id)).toEqual(["新"])
  })

  test("失败后再次成功 ⇒ 错误清空（错误不是粘住的）", async () => {
    const { api, 待回 } = 手动()
    const 目录 = createAssetCatalog(api)

    目录.refresh()
    待回[0]!({ kind: "rejected", message: "登录状态已失效，请重新登录" })
    await 等一轮()
    expect(目录.error()).toContain("重新登录")

    目录.refresh()
    待回[1]!({ kind: "ok", value: [] })
    await 等一轮()

    expect(目录.error()).toBeUndefined()
  })
})
