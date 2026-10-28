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
import type { ProjectEnablement } from "./enable-state"
import { createAssetFilter, 兜底分类ID } from "./filter"

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
  categoryNames: Readonly<Record<string, string>>
}> = {}): AssetCatalog & { 翻页: number[]; 改条数: number[]; 查询: unknown[] } {
  const [清单] = createSignal<readonly AssetMetadata[]>(over.assets ?? [])
  const [总数, set总数] = createSignal(over.total ?? 0)
  const [页码, set页码] = createSignal(over.page ?? 1)
  const [每页, set每页] = createSignal(over.pageSize ?? 20)
  const [分类名] = createSignal<Readonly<Record<string, string>>>(over.categoryNames ?? {})
  const [错误] = createSignal<string | undefined>(over.error)
  const 翻页: number[] = []
  const 改条数: number[] = []
  const 查询: unknown[] = []
  return {
    assets: 清单,
    total: 总数,
    page: 页码,
    pageSize: 每页,
    categoryNames: 分类名,
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

function 挂(catalog: AssetCatalog | undefined, filter = createAssetFilter()) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => <AssetCenter filter={filter} catalog={catalog} />, host)
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
      expect(源.查询.at(0)).toEqual({
        type: "skill",
        spaces: ["global", "department", "targeted", "personal"],
        category: undefined,
        q: "",
      })
    } finally {
      卸()
    }
  })
})

describe("AssetCenter · 「其他」桶标原分类（需求 2）", () => {
  const 资产 = (id: string, category: string): AssetMetadata => ({
    id,
    name: `资产${id}`,
    type: "skill",
    description: "",
    icon: "skill",
    category,
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

  const 选择 = (category: string) => {
    const filter = createAssetFilter()
    filter.selectCategory(category)
    return filter
  }

  test("「其他」模式：名字取服务端的 categoryNames（含停用分类）；查不到退回 id", () => {
    const 源 = 数据源({
      assets: [资产("a", "supervision"), 资产("b", "ghost-category")],
      total: 2,
      categoryNames: { supervision: "督导考核（已停用）" },
    })
    const { host, 卸 } = 挂(源, 选择(兜底分类ID))
    try {
      const 徽章 = [...host.querySelectorAll<HTMLElement>('[data-slot="asset-card-category"]')]
      expect(徽章.map((el) => el.textContent)).toEqual(["原分类：督导考核（已停用）", "原分类：ghost-category"])
      // 查询进的是保留值：服务端据此翻成「分类不在启用清单里」。
      expect(源.查询.at(0)).toMatchObject({ category: "__other__" })
    } finally {
      卸()
    }
  })

  test("不按分类收窄 / 选了真实分类 ⇒ 一枚都不画（它只在兜底桶里出现）", () => {
    const 源 = 数据源({ assets: [资产("a", "intelligence")], total: 1, categoryNames: { intelligence: "情报研判" } })
    for (const filter of [createAssetFilter(), 选择("intelligence")]) {
      const { host, 卸 } = 挂(源, filter)
      try {
        // 断言写布尔值而不是 `toBeNull()`：真红了的时候，bun 会去序列化 happy-dom 的 DOM 节点，
        // 节点带环形引用（parentNode / ownerDocument），打印 diff 直接把堆爆掉（实测 16GiB 分配失败），
        // 用例看起来是「挂死」而不是「红」。布尔值失败只打印 false。
        expect(host.querySelector('[data-slot="asset-card-category"]') === null).toBe(true)
      } finally {
        卸()
      }
    }
  })
})

/**
 * 项目级启用（2026-10-27 / Task 7）：中栏只做三件事——**把集合标到卡上、把上限/错误说出来、
 * 把开关交给 `ProjectEnablement`**。服务端权威与竞态丢弃在 `enable-state.test.ts` 守，这里钉接线。
 *
 * `enablement` 省略时整块形态与加它之前逐字相同（不画计数条、卡片不带启用按钮）——那是老用例
 * 仍然要绿的前提。
 */
describe("AssetCenter · 项目级启用（2026-10-27）", () => {
  const 启用资产 = (id: string): AssetMetadata => ({
    id,
    name: `资产${id}`,
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

  /**
   * 启用状态替身：**未提供的成员给空实现**（brief 的口径）。`{ projectId: undefined }` 按「没给」
   * 处理 ⇒ 落到空实现 `() => undefined`，正是「还没选项目」。
   */
  function 假启用(over: Partial<ProjectEnablement> = {}): ProjectEnablement {
    const 空 = () => undefined
    return {
      projectId: over.projectId ?? 空,
      enabled: over.enabled ?? (() => new Set<string>()),
      enabledCount: over.enabledCount ?? (() => 0),
      limit: over.limit ?? (() => 20),
      auto: over.auto ?? (() => new Set<string>()),
      // 需求 5a：默认「开」与服务端同口径（无行 = 开）。用例要测关闭态就显式传 false。
      autoDelivery: over.autoDelivery ?? (() => true),
      autoDeliveryBusy: over.autoDeliveryBusy ?? (() => false),
      setAutoDelivery: over.setAutoDelivery ?? (() => {}),
      error: over.error ?? 空,
      busy: over.busy ?? 空,
      skills: over.skills ?? 空,
      // 中栏不看这个字段，但接口上是必填：「这次读到底了没有」是面板三态判据（终审 I2）。
      readDone: over.readDone ?? (() => true),
      bind: over.bind ?? (() => {}),
      toggle: over.toggle ?? (() => {}),
      reload: over.reload ?? (() => {}),
    }
  }

  /** 中栏夹具：默认两张卡（a1 / a2），数据源走本文件既有的 `数据源` 替身。 */
  function 挂中栏(over: { enablement?: ProjectEnablement; catalog?: AssetCatalog } = {}) {
    const 源 = over.catalog ?? 数据源({ assets: [启用资产("a1"), 启用资产("a2")], total: 2 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(
      () => <AssetCenter filter={createAssetFilter()} catalog={源} enablement={over.enablement} />,
      host,
    )
    return {
      host,
      卸: () => {
        dispose()
        host.remove()
      },
    }
  }

  test("没有项目：卡片上的启用按钮禁用，提示先选项目", async () => {
    const 假 = 假启用({ projectId: undefined })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      const 按钮 = host.querySelector<HTMLButtonElement>('[data-slot="asset-card-enable"]')!
      expect(按钮.disabled).toBe(true)
      expect(按钮.title).toContain("选择项目")
      // 没项目时整条计数都不该出现（布尔断言，避开 `#009-01`）
      expect(host.querySelector('[data-slot="asset-enable-count"]') === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("有项目：顶部显示「已启用 3/20」，卡片按集合标已启用", async () => {
    // ⚠️ `enabledCount` 故意与 `enabled().size` 不等（3 vs 1）：相等的话把计数行换成 `enabled().size`
    // 也全绿，「一律用 enabledCount」就没被钉住（`#005-18` 默认值满足断言）。
    const 假 = 假启用({ projectId: () => "p1", enabled: () => new Set(["a1"]), enabledCount: () => 3, limit: () => 20 })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      expect(host.querySelector('[data-slot="asset-enable-count"]')!.textContent).toContain("已启用 3/20")
      expect(host.querySelector('[data-asset-id="a1"] [data-slot="asset-card-enable"]')!.getAttribute("aria-pressed")).toBe(
        "true",
      )
    } finally {
      卸()
    }
  })

  test("达到上限：未启用的卡片按钮禁用并提示先停用", async () => {
    const 假 = 假启用({
      projectId: () => "p1",
      enabled: () => new Set(["a1"]),
      enabledCount: () => 20,
      limit: () => 20,
    })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      const 按钮 = host.querySelector<HTMLButtonElement>('[data-asset-id="a2"] [data-slot="asset-card-enable"]')!
      expect(按钮.disabled).toBe(true)
      expect(按钮.title).toContain("停用")
      // ⚠️ 达上限时**已启用**的那张必须仍可点「停用」，否则 20/20 时用户一个也停不掉（2026-10-27 实现者提出的坑）
      const 已启用的 = host.querySelector<HTMLButtonElement>('[data-asset-id="a1"] [data-slot="asset-card-enable"]')!
      expect(已启用的.disabled).toBe(false)
    } finally {
      卸()
    }
  })

  test("busy 只禁那一张：busyId 对得上才转忙", async () => {
    const 假 = 假启用({ projectId: () => "p1", busy: () => "a2" })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      const 别的 = host.querySelector<HTMLButtonElement>('[data-asset-id="a1"] [data-slot="asset-card-enable"]')!
      const 忙的 = host.querySelector<HTMLButtonElement>('[data-asset-id="a2"] [data-slot="asset-card-enable"]')!
      expect(别的.disabled).toBe(false)
      expect(忙的.disabled).toBe(true)
      expect(忙的.title).toContain("正在切换")
    } finally {
      卸()
    }
  })

  test("错误如实显示，不当成「没有错误」", async () => {
    const 假 = 假启用({ projectId: () => "p1", error: () => "每个项目最多启用 20 个 skill，请先停用一个" })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      expect(host.querySelector('[data-slot="asset-enable-error"]')!.textContent).toContain("最多启用 20")
    } finally {
      卸()
    }
  })

  /**
   * 自动送达（需求 5a）：中栏只做两件接线——**把自动名单标到卡上**、**把一键开关交回去**。
   * 开关的竞态与失败处理在 `enable-state.test.tsx` 守着；这里钉「点了真的会发」。
   *
   * 嵌套在本 describe 里只是为了让 `假启用 / 挂中栏` 这两个夹具够得着；用例名已写明是哪一块。
   */
  describe("自动送达（需求 5a）", () => {
  test("有项目：开关显示「自动送达：开」，点一下请求关闭", () => {
    const 请求: boolean[] = []
    const 假 = 假启用({ projectId: () => "p1", setAutoDelivery: (enabled) => 请求.push(enabled) })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      const 开关 = host.querySelector<HTMLButtonElement>('[data-slot="asset-auto-delivery"]')!
      expect(开关.textContent?.trim()).toBe("自动送达：开")
      expect(开关.getAttribute("aria-pressed")).toBe("true")
      开关.click()
      expect(请求).toEqual([false])
    } finally {
      卸()
    }
  })

  test("已关闭：显示「关」，点一下请求打开", () => {
    const 请求: boolean[] = []
    const 假 = 假启用({
      projectId: () => "p1",
      autoDelivery: () => false,
      setAutoDelivery: (enabled) => 请求.push(enabled),
    })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      const 开关 = host.querySelector<HTMLButtonElement>('[data-slot="asset-auto-delivery"]')!
      expect(开关.textContent?.trim()).toBe("自动送达：关")
      expect(开关.getAttribute("aria-pressed")).toBe("false")
      开关.click()
      expect(请求).toEqual([true])
    } finally {
      卸()
    }
  })

  test("开关忙时禁用（避免连点发出互相打架的两趟）", () => {
    const 假 = 假启用({ projectId: () => "p1", autoDeliveryBusy: () => true })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      const 开关 = host.querySelector<HTMLButtonElement>('[data-slot="asset-auto-delivery"]')!
      expect(开关.disabled).toBe(true)
      expect(开关.getAttribute("aria-busy")).toBe("true")
    } finally {
      卸()
    }
  })

  test("自动送达的卡片带「自动」标记，别的不带", () => {
    const 假 = 假启用({ projectId: () => "p1", auto: () => new Set(["a1"]) })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      expect(host.querySelector('[data-asset-id="a1"] [data-slot="asset-card-auto"]')?.textContent).toBe("自动")
      // 布尔断言避开 `#009-01`
      expect(host.querySelector('[data-asset-id="a2"] [data-slot="asset-card-auto"]') === null).toBe(true)
    } finally {
      卸()
    }
  })

  test("没有项目：开关整块不出现（与计数条同一条规矩）", () => {
    const 假 = 假启用({ projectId: undefined })
    const { host, 卸 } = 挂中栏({ enablement: 假 })
    try {
      expect(host.querySelector('[data-slot="asset-auto-delivery"]') === null).toBe(true)
    } finally {
      卸()
    }
  })
})
})
