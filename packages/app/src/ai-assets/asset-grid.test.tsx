import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetGrid } from "./asset-grid"

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
    category: "intelligence", // 需求 4 起分类 id 来自服务端，这里只是夹具里的一个字符串
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

function 挂(列表: readonly AssetMetadata[], 原分类?: (asset: AssetMetadata) => string | undefined) {
  const 打开过: string[] = []
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(
    () => <AssetGrid assets={() => 列表} onOpen={(asset) => 打开过.push(asset.id)} 原分类={原分类} />,
    host,
  )
  return {
    host,
    打开过,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

const 卡片 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="asset-card"]')]
const 卡片名 = (host: HTMLElement) => 卡片(host).map((card) => card.textContent ?? "")

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

  test("卡片是列表项，内层真按钮负责打开详情（T007）", () => {
    const { host, 打开过, 卸 } = 挂([资产({ id: "a" })])
    try {
      const card = 卡片(host)[0]
      expect(card.getAttribute("role")).toBe("listitem")
      expect(card.getAttribute("tabindex")).toBeNull()
      expect(host.querySelector('[role="list"]')).not.toBeNull()

      const 按钮 = card.querySelector<HTMLButtonElement>('[data-slot="asset-card-open"]')
      expect(按钮?.tagName).toBe("BUTTON")
      expect(按钮?.getAttribute("aria-label")).toBe("查看资产：资金流向研判")
      按钮!.click()
      expect(打开过).toEqual(["a"])
    } finally {
      卸()
    }
  })

  test("「其他」模式才多一枚「原分类」徽章；不给就不画（需求 2）", () => {
    const { host, 卸 } = 挂([
      资产({ id: "a", category: "supervision" }),
      资产({ id: "b", category: "ghost" }),
    ])
    try {
      // 默认（不按分类收窄 / 选了某个真实分类）：卡片仍是精简四件，不带原分类。
      for (const card of 卡片(host)) expect(card.querySelector('[data-slot="asset-card-category"]')).toBeNull()
    } finally {
      卸()
    }

    // 「其他」模式：给什么名字显示什么名字（查不到 ⇒ 由上层退回 id）。
    const 第二 = 挂(
      [资产({ id: "a", category: "supervision" }), 资产({ id: "b", category: "ghost" })],
      (asset) => (asset.category === "supervision" ? "督导考核（已停用）" : asset.category),
    )
    try {
      const [甲, 乙] = 卡片(第二.host)
      expect(甲.querySelector('[data-slot="asset-card-category"]')?.textContent).toContain("督导考核（已停用）")
      expect(乙.querySelector('[data-slot="asset-card-category"]')?.textContent).toContain("ghost")
      // 名字长到放不下时靠省略号收口，所以全名要挂 title（悬停能读全）。
      expect(甲.querySelector('[data-slot="asset-card-category"]')?.getAttribute("title")).toBe(
        "原分类：督导考核（已停用）",
      )
    } finally {
      第二.卸()
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
