/**
 * 中栏（T017 / 需求 6）：只钉两件本层负责的事——
 * **取数失败要看得见**，以及**页码条跟着数据源走**（没有数据源时不出现）。
 *
 * 其余行为（搜索词、详情盖层、焦点归还）由 `asset-grid` / `asset-detail` 各自的用例守着；
 * 查询组装与「条件变了回第 1 页」由 `asset-catalog.test.ts` 钉。
 */

import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetCenter } from "./asset-center"
import type { AssetCatalog } from "./asset-catalog"
import { createAssetFilter } from "./filter"

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

/** 手造一份数据源：只有本层读到的那几个信号 ＋ 回调记录。 */
function 数据源(over: Partial<{
  assets: readonly AssetMetadata[]
  total: number
  page: number
  pageSize: number
  error: string | undefined
}> = {}): AssetCatalog & { 翻页: number[]; 改条数: number[]; 查询: unknown[] } {
  const [清单] = createSignal<readonly AssetMetadata[]>(over.assets ?? [])
  const [总数, set总数] = createSignal(over.total ?? 0)
  const [页码, set页码] = createSignal(over.page ?? 1)
  const [每页, set每页] = createSignal(over.pageSize ?? 20)
  const [错误] = createSignal<string | undefined>(over.error)
  const 翻页: number[] = []
  const 改条数: number[] = []
  const 查询: unknown[] = []
  return {
    assets: 清单,
    total: 总数,
    page: 页码,
    pageSize: 每页,
    error: 错误,
    load: (query) => void 查询.push(query),
    goPage: (page) => {
      翻页.push(page)
      set页码(page)
    },
    setPageSize: (size) => {
      改条数.push(size)
      set每页(size)
    },
    reload: () => {},
    翻页,
    改条数,
    查询,
  }
}

function 挂(catalog: AssetCatalog | undefined) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => <AssetCenter filter={createAssetFilter()} catalog={catalog} />, host)
  return {
    host,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

describe("AssetCenter · 取数失败", () => {
  test("没有失败 ⇒ 不挂提示条", () => {
    const { host, 卸 } = 挂(数据源())
    try {
      expect(host.querySelector('[data-slot="asset-load-error"]')).toBeNull()
    } finally {
      卸()
    }
  })

  test("有失败原因 ⇒ 提示条可见，且文案是原因本身", () => {
    const { host, 卸 } = 挂(数据源({ error: "连接服务失败，请检查网络后重试" }))
    try {
      const 条 = host.querySelector('[data-slot="asset-load-error"]')
      expect(条).not.toBeNull()
      expect(条?.getAttribute("role")).toBe("alert")
      expect(条?.textContent).toContain("连接服务失败")
    } finally {
      卸()
    }
  })

  test("没有数据源（组件测试 / storybook）⇒ 不挂提示条、不挂页码条", () => {
    const { host, 卸 } = 挂(undefined)
    try {
      expect(host.querySelector('[data-slot="asset-load-error"]')).toBeNull()
      expect(host.querySelector('[data-slot="asset-pager"]')).toBeNull()
    } finally {
      卸()
    }
  })
})

describe("AssetCenter · 页码条", () => {
  test("总数 0 ⇒ 不挂页码条（空态只留一句「没有符合条件的资产」）", () => {
    const { host, 卸 } = 挂(数据源({ total: 0 }))
    try {
      expect(host.querySelector('[data-slot="asset-pager"]')).toBeNull()
    } finally {
      卸()
    }
  })

  test("有数据 ⇒ 页码条显示总数；点下一页走数据源", () => {
    const 源 = 数据源({ total: 25, page: 1, pageSize: 20 })
    const { host, 卸 } = 挂(源)
    try {
      expect(host.querySelector('[data-slot="asset-pager-total"]')?.textContent).toContain("25")
      host.querySelector<HTMLButtonElement>('[data-slot="asset-pager-next"]')?.click()
      expect(源.翻页).toEqual([2])
    } finally {
      卸()
    }
  })

  test("挂载时把左栏三组 ＋ 搜索词交给数据源（查询组装只在这一层）", () => {
    const 源 = 数据源({ total: 1 })
    const { 卸 } = 挂(源)
    try {
      expect(源.查询.at(0)).toEqual({ type: "skill", spaces: ["global", "department", "personal"], category: undefined, q: "" })
    } finally {
      卸()
    }
  })
})
