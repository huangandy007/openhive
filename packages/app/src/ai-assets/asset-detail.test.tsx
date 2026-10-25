import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { ASSET_CATEGORY_ROWS } from "./filter"
import { AssetDetail, 详情Tab列表 } from "./asset-detail"

/**
 * 资产详情（009 T007 / DESIGN §4.10）。
 *
 * 断言纪律（`#005-47` / `#006-22`）：只钉 `textContent` 全等与 `aria-selected` 这类**可区分**的值，
 * 不用 `className.includes(...)` 断 Tailwind 子串；空态与有值态各写一条，避免默认值满足断言。
 */
function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset-1",
    name: "资金流向研判",
    type: "skill",
    description: "按账户汇总资金往来",
    icon: "skill",
    category: ASSET_CATEGORY_ROWS[0].id,
    tags: ["资金", "研判"],
    ownerId: "u1",
    ownerName: "张三",
    department: "经侦支队",
    visibility: "global",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    // Unix 秒。取 UTC 正午 ⇒ 本机 +8 仍是同一天，日期断言不随运行时时区漂。
    createdAt: Date.UTC(2026, 9, 1, 12) / 1000,
    updatedAt: Date.UTC(2026, 9, 20, 12) / 1000,
    publishedAt: null,
    archivedAt: null,
    ...over,
  }
}

function 挂(over: Partial<AssetMetadata> = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  let 返回次数 = 0
  const dispose = render(
    () => <AssetDetail asset={资产(over)} onBack={() => (返回次数 += 1)} />,
    host,
  )
  return {
    host,
    返回次数: () => 返回次数,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

const 槽 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent ?? ""
const 标签 = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot="asset-detail-tab"][data-tab="${id}"]`)!
const 面板 = (host: HTMLElement) => 槽(host, "asset-detail-panel")

describe("资产详情头部", () => {
  test("名称、空间/状态徽章、作者、评分、收藏与使用次数都来自元数据", () => {
    const { host, 卸 } = 挂({
      name: "资金流向研判",
      visibility: "department",
      status: "published",
      ownerName: "张三",
      department: "经侦支队",
      rating: 4.56,
      ratingCount: 12,
      favoriteCount: 5,
      usageCount: 37,
    })
    try {
      expect(文本(host, "asset-detail-name")).toBe("资金流向研判")
      expect(文本(host, "asset-detail-space")).toBe("部门")
      expect(文本(host, "asset-detail-status")).toBe("已发布")
      expect(文本(host, "asset-detail-author")).toBe("张三 · 经侦支队")
      expect(文本(host, "asset-detail-header-rating")).toBe("★ 4.6（12 人评分）")
      expect(文本(host, "asset-detail-favorites")).toBe("5 人收藏")
      expect(文本(host, "asset-detail-usage")).toBe("37 次使用")
      expect(槽(host, "asset-detail-back")?.getAttribute("aria-label")).toBe("返回资产列表")
    } finally {
      卸()
    }
  })

  test("没人评分时写「暂无评分」，不显示 0.0", () => {
    const { host, 卸 } = 挂({ rating: 0, ratingCount: 0 })
    try {
      expect(文本(host, "asset-detail-header-rating")).toBe("暂无评分")
    } finally {
      卸()
    }
  })

  test("头部不随 tab 切换重建（同一个节点）", () => {
    const { host, 卸 } = 挂()
    try {
      const 头部 = 槽(host, "asset-detail-header")
      标签(host, "reviews").click()
      expect(槽(host, "asset-detail-header")).toBe(头部)
      expect(文本(host, "asset-detail-name")).toBe("资金流向研判")
    } finally {
      卸()
    }
  })

  test("进入详情焦点落在「返回资产列表」；点它回调 onBack", () => {
    const { host, 返回次数, 卸 } = 挂()
    try {
      const 返回 = host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-back"]')
      expect(返回).not.toBeNull()
      expect(document.activeElement).toBe(返回)
      返回!.click()
      expect(返回次数()).toBe(1)
    } finally {
      卸()
    }
  })
})

describe("详情四 tab", () => {
  test("tab 栏是介绍/注意事项/评价/版本，默认选中介绍", () => {
    const { host, 卸 } = 挂()
    try {
      const tablist = host.querySelector('[role="tablist"]')
      expect(tablist).not.toBeNull()
      const 按钮 = [...host.querySelectorAll<HTMLButtonElement>('[data-slot="asset-detail-tab"]')]
      expect(按钮.map((el) => el.textContent)).toEqual(详情Tab列表.map((项) => 项.label))
      expect(按钮.map((el) => el.dataset.tab)).toEqual(["intro", "precautions", "reviews", "versions"])
      expect(按钮.every((el) => el.getAttribute("role") === "tab")).toBe(true)

      expect(标签(host, "intro").getAttribute("aria-selected")).toBe("true")
      for (const id of ["precautions", "reviews", "versions"]) {
        expect(标签(host, id).getAttribute("aria-selected")).toBe("false")
      }
      expect(面板(host)?.dataset.tab).toBe("intro")
      expect(面板(host)?.getAttribute("role")).toBe("tabpanel")
      expect(文本(host, "asset-detail-description")).toBe("按账户汇总资金往来")
      expect([...host.querySelectorAll('[data-slot="asset-detail-tag"]')].map((el) => el.textContent)).toEqual([
        "#资金",
        "#研判",
      ])
    } finally {
      卸()
    }
  })

  test("点 tab 只显示当前面板", () => {
    const { host, 卸 } = 挂()
    try {
      标签(host, "precautions").click()
      expect(面板(host)?.dataset.tab).toBe("precautions")
      expect(槽(host, "asset-detail-description")).toBeNull()
      expect(文本(host, "asset-detail-uncertainty")).toContain("必须经过人工复核")

      标签(host, "reviews").click()
      expect(面板(host)?.dataset.tab).toBe("reviews")
      expect(槽(host, "asset-detail-uncertainty")).toBeNull()
      expect(槽(host, "asset-detail-review-summary")).not.toBeNull()

      标签(host, "versions").click()
      expect(面板(host)?.dataset.tab).toBe("versions")
      expect(文本(host, "asset-detail-version")).toBe("v1")
    } finally {
      卸()
    }
  })

  test("键盘左右 / Home / End 切换，焦点跟着走", () => {
    const { host, 卸 } = 挂()
    try {
      标签(host, "intro").focus()
      标签(host, "intro").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      expect(标签(host, "precautions").getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement).toBe(标签(host, "precautions"))

      标签(host, "precautions").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
      expect(标签(host, "intro").getAttribute("aria-selected")).toBe("true")

      标签(host, "intro").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
      expect(标签(host, "versions").getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement).toBe(标签(host, "versions"))

      标签(host, "versions").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
      expect(标签(host, "intro").getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement).toBe(标签(host, "intro"))
    } finally {
      卸()
    }
  })
})

describe("详情各 tab 内容", () => {
  test("注意事项：显式不确定性标注 + 未填写专属注意事项的空态", () => {
    const { host, 卸 } = 挂()
    try {
      标签(host, "precautions").click()
      const 标注 = 文本(host, "asset-detail-uncertainty")
      expect(标注).toContain("AI 生成的结论可能存在偏差")
      expect(标注).toContain("必须经过人工复核")
      expect(文本(host, "asset-detail-precautions-empty")).toBe("该资产尚未填写专属注意事项。")
    } finally {
      卸()
    }
  })

  test("评价：有评分显示汇总；无评分显示空态；评价正文缺失时显式说明", () => {
    const 有分 = 挂({ rating: 4.56, ratingCount: 12, feedbackCount: 3 })
    try {
      标签(有分.host, "reviews").click()
      expect(文本(有分.host, "asset-detail-review-summary")).toContain("★ 4.6")
      expect(文本(有分.host, "asset-detail-review-summary")).toContain("12 人评分")
      expect(文本(有分.host, "asset-detail-review-summary")).toContain("3 条反馈")
      expect(文本(有分.host, "asset-detail-reviews-empty")).toBe("暂无评价内容。")
    } finally {
      有分.卸()
    }

    const 无分 = 挂({ rating: 0, ratingCount: 0, feedbackCount: 0 })
    try {
      标签(无分.host, "reviews").click()
      expect(文本(无分.host, "asset-detail-review-summary")).toContain("暂无评分")
    } finally {
      无分.卸()
    }
  })

  test("版本：版本号 + 更新日期；未发布不写发布日期；变更说明缺失时显式说明", () => {
    const { host, 卸 } = 挂({ version: 3, publishedAt: null })
    try {
      标签(host, "versions").click()
      expect(文本(host, "asset-detail-version")).toBe("v3")
      expect(文本(host, "asset-detail-updated")).toBe("更新于 2026-10-20")
      expect(槽(host, "asset-detail-published")).toBeNull()
      expect(文本(host, "asset-detail-changelog-empty")).toBe("暂无变更说明。")
    } finally {
      卸()
    }
  })

  test("已发布资产在版本 tab 显示发布日期", () => {
    const { host, 卸 } = 挂({ version: 2, publishedAt: Date.UTC(2026, 9, 18, 12) / 1000 })
    try {
      标签(host, "versions").click()
      expect(文本(host, "asset-detail-published")).toBe("发布于 2026-10-18")
    } finally {
      卸()
    }
  })
})
