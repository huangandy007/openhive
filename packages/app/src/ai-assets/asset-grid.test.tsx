import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetGrid } from "./asset-grid"
import { ASSET_CATEGORY_ROWS, createAssetFilter } from "./filter"

// happy-dom 的 ResizeObserver 回调不触发；virtual-core 首帧会主动量一次，够用。
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// ⚠️ happy-dom 没有布局，`offsetWidth/offsetHeight` 恒 0。virtual-core 首帧用这两个值覆盖
// `initialRect` ⇒ 不垫这一下，网格渲染 0 张卡（与 `sheet-grid.test.tsx` 同一处境）。
// 只认本组件的滚动槽，别的元素仍返回 0，避免把别的测试的几何一起改掉。
for (const [属性, 尺寸] of [
  ["offsetWidth", 800],
  ["offsetHeight", 600],
] as const) {
  Object.defineProperty(HTMLElement.prototype, 属性, {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.slot === "asset-grid-viewport" ? 尺寸 : 0
    },
  })
}

function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset-1",
    name: "资金流向研判",
    type: "skill",
    description: "按账户汇总资金往来",
    icon: "skill",
    category: ASSET_CATEGORY_ROWS[0].id,
    tags: ["资金"],
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
    createdAt: 1,
    updatedAt: 1,
    publishedAt: 1,
    archivedAt: null,
    ...over,
  }
}

function 挂(列表: readonly AssetMetadata[]) {
  const filter = createAssetFilter()
  const [搜索词, set搜索词] = createSignal("")
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => <AssetGrid filter={filter} search={搜索词} assets={() => 列表} />,
    host,
  )
  return {
    host,
    filter,
    set搜索词,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

const 卡片 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="asset-card"]')]
const 卡片名 = (host: HTMLElement) => 卡片(host).map((card) => card.textContent ?? "")
const 空态 = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="asset-empty"]')

const 等到 = async (条件: () => boolean, 说明: string, timeout = 2000) => {
  const 起 = Date.now()
  for (;;) {
    if (条件()) return
    if (Date.now() - 起 > timeout) throw new Error(`等条件超时：${说明}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("资产卡片", () => {
  test("精简四件：名称、两行描述、空间徽章、状态徽章", () => {
    const { host, 卸 } = 挂([
      资产({ id: "a", name: "资金流向研判", description: "按账户汇总资金往来", status: "published" }),
    ])
    try {
      const card = 卡片(host)[0]
      expect(card).not.toBeNull()
      expect(card.querySelector('[data-slot="asset-card-name"]')?.textContent).toBe("资金流向研判")
      expect(card.querySelector('[data-slot="asset-card-description"]')?.textContent).toBe(
        "按账户汇总资金往来",
      )
      expect(card.querySelector('[data-slot="asset-card-description"]')?.className).toContain("line-clamp-2")
      expect(card.querySelector('[data-slot="asset-card-space"]')?.textContent).toBe("全局")
      expect(card.querySelector('[data-slot="asset-card-status"]')?.textContent).toBe("已发布")
      expect(card.querySelector('[data-slot="asset-card-icon"]')).not.toBeNull()
      expect(card.getAttribute("data-asset-id")).toBe("a")
    } finally {
      卸()
    }
  })

  test("卡片是静态条目（T007 才接点击）：有 listitem 角色、没有按钮语义", () => {
    const { host, 卸 } = 挂([资产()])
    try {
      const card = 卡片(host)[0]
      expect(card.getAttribute("role")).toBe("listitem")
      expect(card.getAttribute("role")).not.toBe("button")
      expect(card.getAttribute("tabindex")).toBeNull()
      expect(host.querySelector('[role="list"]')).not.toBeNull()
    } finally {
      卸()
    }
  })

  test("空间与状态徽章走字典文案，不硬编码", () => {
    const { host, 卸 } = 挂([
      资产({ id: "a", visibility: "department", status: "in_review" }),
      资产({ id: "b", visibility: "personal", status: "offline" }),
    ])
    try {
      const [甲, 乙] = 卡片(host)
      expect(甲.querySelector('[data-slot="asset-card-space"]')?.textContent).toBe("部门")
      expect(甲.querySelector('[data-slot="asset-card-status"]')?.textContent).toBe("审核中")
      expect(乙.querySelector('[data-slot="asset-card-space"]')?.textContent).toBe("个人")
      expect(乙.querySelector('[data-slot="asset-card-status"]')?.textContent).toBe("已下线")
    } finally {
      卸()
    }
  })
})

describe("网格筛选与搜索", () => {
  test("左栏类型切换 ⇒ 网格只剩该类型", () => {
    const { host, filter, 卸 } = 挂([
      资产({ id: "a", name: "技能甲", type: "skill" }),
      资产({ id: "b", name: "MCP 乙", type: "mcp" }),
    ])
    try {
      expect(卡片(host)).toHaveLength(1)
      filter.selectType("mcp")
      expect(卡片名(host)).toEqual([expect.stringContaining("MCP 乙")])
      expect(卡片(host)).toHaveLength(1)
    } finally {
      卸()
    }
  })

  test("左栏分类切换到空分类 ⇒ 空态文案", () => {
    const { host, filter, 卸 } = 挂([资产({ id: "a" })])
    try {
      filter.selectCategory(ASSET_CATEGORY_ROWS[1].id)
      expect(卡片(host)).toHaveLength(0)
      expect(空态(host)?.textContent).toContain("没有符合条件的资产")
    } finally {
      卸()
    }
  })

  test("搜索名称 / 描述 / 标签，忽略大小写；清空恢复", () => {
    const { host, set搜索词, 卸 } = 挂([
      资产({ id: "a", name: "FundFlow", description: "账户汇总", tags: ["xlsx"] }),
      资产({ id: "b", name: "话单分析", description: "通话记录", tags: ["cdr"] }),
    ])
    try {
      set搜索词("fund")
      expect(卡片(host)).toHaveLength(1)
      expect(卡片名(host)[0]).toContain("FundFlow")

      set搜索词("cdr")
      expect(卡片名(host)[0]).toContain("话单分析")

      set搜索词("账户")
      expect(卡片名(host)[0]).toContain("FundFlow")

      set搜索词("")
      expect(卡片(host)).toHaveLength(2)
    } finally {
      卸()
    }
  })

  test("搜索无命中 ⇒ 空态，且虚拟容器不残留旧行", () => {
    const { host, set搜索词, 卸 } = 挂([资产({ id: "a" })])
    try {
      set搜索词("不存在")
      expect(卡片(host)).toHaveLength(0)
      expect(空态(host)?.textContent).toContain("没有符合条件的资产")
      expect(host.querySelector('[data-slot="asset-row"]')).toBeNull()
    } finally {
      卸()
    }
  })
})

describe("虚拟滚动", () => {
  const 多条 = (n: number) =>
    Array.from({ length: n }, (_, index) => 资产({ id: `a${index}`, name: `资产 ${index}` }))

  test("300 条不铺满 DOM：只渲染视口附近的行", () => {
    const { host, 卸 } = 挂(多条(300))
    try {
      const 渲染数 = 卡片(host).length
      expect(渲染数).toBeGreaterThan(0)
      expect(渲染数).toBeLessThan(60)

      // 800px 宽 ⇒ 3 列；300 项 / 3 = 100 行 × 144px。
      const 内容 = host.querySelector<HTMLElement>('[role="list"]')
      expect(内容?.style.height).toBe("14400px")
    } finally {
      卸()
    }
  })

  test("滚动后渲染窗口跟着移动", async () => {
    const { host, 卸 } = 挂(多条(300))
    try {
      const viewport = host.querySelector<HTMLElement>('[data-slot="asset-grid-viewport"]')!
      const 首行号 = () =>
        Number(host.querySelector<HTMLElement>('[data-slot="asset-row"]')?.dataset.rowIndex ?? -1)
      expect(首行号()).toBe(0)

      // 虚拟器在 ref 的微任务里才接管滚动元素（`asset-grid.tsx` 的 ref 注释）；真实用户滚动
      // 不可能发生在渲染当拍，等一拍再模拟才对应现实时序。
      await new Promise((resolve) => setTimeout(resolve, 0))
      viewport.scrollTop = 144 * 50
      viewport.dispatchEvent(new Event("scroll"))
      await 等到(() => 首行号() > 40, "滚动后首行号前进")

      // 第 50 行起渲染 ⇒ 卡片名里应出现 150 附近的项，而不是恒从 0 开始。
      expect(卡片名(host).some((文本) => 文本.includes("资产 150"))).toBe(true)
    } finally {
      卸()
    }
  })
})
