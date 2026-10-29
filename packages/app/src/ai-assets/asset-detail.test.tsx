import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetDetail, 详情Tab列表, type AssetDetailProps } from "./asset-detail"

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
    category: "intelligence", // 需求 4 起分类 id 来自服务端，这里只是夹具里的一个字符串
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

function 挂(over: Partial<AssetMetadata> = {}, extra: Partial<AssetDetailProps> = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  let 返回次数 = 0
  const dispose = render(
    () => <AssetDetail asset={资产(over)} onBack={() => (返回次数 += 1)} {...extra} />,
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

/**
 * 头部操作（2026-10-29，用户实报设计不妥）。
 *
 * ## 为什么删掉「▶ 让 AI 助手执行此 skill」
 *
 * 用户原话：AI 助手执行 skill 需要上下文，才知道「怎么执行」——一句「请使用 X」送进输入框，
 * 模型没有输入数据，点了也干不成事。留着一个点了做不成事的按钮，就是把不可达状态装成可达
 * （`#008-04`）。
 *
 * ## 为什么把「启用」搬进详情
 *
 * 用户在详情里读完介绍才决定「用不用得上」，此时要他退回卡片点启用，违背心智。判断只有一份
 * （`enable-button.ts`），卡片与详情共用（`#002-06`）。
 *
 * ⚠️ 断言纪律：元素不存在一律布尔式 `node === null`（`#009-01`：happy-dom 节点直断会让 bun
 * 序列化环形引用）。文案用全等不用 `toContain`（`#006-22`：「已启用」含「启用」）。
 */
describe("头部操作：启用（2026-10-29）", () => {
  const 启用按钮 = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>('[data-slot="asset-detail-enable"]')

  test("不给 onToggleEnabled ⇒ 不渲染启用按钮（storybook / 旧用法逐字不变）", () => {
    const { host, 卸 } = 挂()
    try {
      expect(启用按钮(host) === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("给了 ⇒ 文案「启用」、aria-pressed=false，点它把该资产交回去", () => {
    const 收到: AssetMetadata[] = []
    const { host, 卸 } = 挂({}, { onToggleEnabled: (asset) => 收到.push(asset) })
    try {
      const 按钮 = 启用按钮(host)
      if (!按钮) throw new Error("给了 onToggleEnabled 却没有启用按钮")
      expect(按钮.textContent?.trim()).toBe("启用")
      expect(按钮.getAttribute("aria-pressed")).toBe("false")

      按钮.click()

      expect(收到.map((asset) => asset.id)).toEqual(["asset-1"])
    } finally {
      卸()
    }
  })

  test("已启用 ⇒ 文案「已启用」、aria-pressed=true", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, enabled: true })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.textContent?.trim()).toBe("已启用")
      expect(按钮.getAttribute("aria-pressed")).toBe("true")
    } finally {
      卸()
    }
  })

  test("自动送达装进来的 ⇒ 文案「固定安装」（与卡片同一档说法）", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, auto: true })
    try {
      expect(启用按钮(host)?.textContent?.trim()).toBe("固定安装")
    } finally {
      卸()
    }
  })

  test("没选项目 ⇒ 禁用，title 写原因（禁用却不写原因是最糟的）", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, enableHint: "请先在左侧选择项目" })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.disabled).toBe(true)
      expect(按钮.getAttribute("title")).toBe("请先在左侧选择项目")
    } finally {
      卸()
    }
  })

  test("enableHint 是空串 ⇒ 不算禁用理由", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, enableHint: "" })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.disabled).toBe(false)
      expect(按钮.getAttribute("title") === null || 按钮.getAttribute("title") === "").toBe(true)
    } finally {
      卸()
    }
  })

  test("正在切换 ⇒ 禁用，title 是「正在切换…」，aria-busy=true", () => {
    const { host, 卸 } = 挂({}, { onToggleEnabled: () => {}, busy: true })
    try {
      const 按钮 = 启用按钮(host)!
      expect(按钮.disabled).toBe(true)
      expect(按钮.getAttribute("title")).toBe("正在切换…")
      expect(按钮.getAttribute("aria-busy")).toBe("true")
    } finally {
      卸()
    }
  })

  test("「让 AI 助手执行此 skill」不再存在——三类资产都没有", () => {
    for (const type of ["skill", "mcp", "knowledge_base"] as const) {
      const { host, 卸 } = 挂({ type })
      try {
        expect(
          host.querySelector('[data-slot="asset-detail-execute"]') === null,
          `${type} 资产上不该再出现执行按钮`,
        ).toBe(true)
      } finally {
        卸()
      }
    }
  })
})
