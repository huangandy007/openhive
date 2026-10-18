import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createSheetStore, SheetGrid, type SheetUiState } from "./sheet-grid"
import type { SheetMeta } from "./sheet-model"

// happy-dom 的 ResizeObserver 回调不触发；virtual-core 首帧会主动量一次，够用。
if (!("ResizeObserver" in globalThis)) {
  // 测试垫片；happy-dom 的全局类型已声明 ResizeObserver，赋值无需抑制。
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// ⚠️ happy-dom 没有布局，`offsetWidth/offsetHeight` 恒 0。@tanstack/virtual-core 首帧用这两个值
// 覆盖 `initialRect`（`dist/esm/index.js` 的 `getRect`）⇒ 不垫这一下，虚拟列表渲染 **0 行**，
// 「虚拟滚动只渲染窗口」的用例会假红（其实是环境没视口）。
for (const [属性, 尺寸] of [
  ["offsetWidth", 800],
  ["offsetHeight", 600],
] as const) {
  Object.defineProperty(HTMLElement.prototype, 属性, {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.slot === "sheet-scroll" ? 尺寸 : 0
    },
  })
}

function 元(over: Partial<SheetMeta> = {}): SheetMeta {
  return {
    sheetNames: ["明细"],
    sheetName: "明细",
    startRow: 0,
    startCol: 0,
    totalRows: 4,
    totalCols: 2,
    header: ["姓名", "金额"],
    preview: [
      ["姓名", "金额"],
      ["张三", "1200"],
      ["李四", "300"],
      ["王五", "50"],
    ],
    columnTypes: ["text", "number"],
    ...over,
  }
}

function 挂(meta = 元(), initial?: SheetUiState) {
  const store = createSheetStore(meta, "full", { rows: 0, cols: 0 })
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => <SheetGrid store={store} initial={initial} />, host)
  return {
    host,
    store,
    dispose,
    卸: () => {
      dispose()
      host.remove()
    },
  }
}

const 表头 = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="sheet-header"]')
const 数据行 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="sheet-row"]')]
const 行号 = (row: HTMLElement) => row.querySelector<HTMLElement>('[role="rowheader"]')?.textContent

/**
 * 等一个元素出现。Kobalte 的 portal 浮层不是同步渲染的：点完触发器立刻查会读到 null
 * （`LEARNINGS #006-31`：判据读早了）。后续打开列清单 / 筛选浮层的用例都用它。
 */
const 等元素 = async <T extends HTMLElement>(找: () => T | null, timeout = 1000): Promise<T> => {
  const start = Date.now()
  for (;;) {
    const found = 找()
    if (found) return found
    if (Date.now() - start > timeout) throw new Error("等元素超时")
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe("网格骨架", () => {
  test("role=grid、表头、首行数据、行号从 2 开始（首行是表头）", () => {
    const { host, 卸 } = 挂()
    expect(host.querySelector('[role="grid"]')).not.toBeNull()
    expect(表头(host)?.textContent).toContain("姓名")
    expect(表头(host)?.textContent).toContain("金额")
    expect(数据行(host)[0]?.textContent).toContain("张三")
    expect(行号(数据行(host)[0])).toBe("2")
    // rowcount 含表头行：3 条数据 + 1 行表头。
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("4")
    卸()
  })

  test("固定列宽模板：行号 56px + 每列估算宽度", () => {
    const { host, 卸 } = 挂()
    const 模板 = 表头(host)?.style.gridTemplateColumns ?? ""
    expect(模板.startsWith("56px ")).toBe(true)
    expect(模板.split(" ")).toHaveLength(3)
    卸()
  })

  test("单行不折行：行高 28px、cell 有截断类", () => {
    const { host, 卸 } = 挂()
    const row = 数据行(host)[0]
    expect(row.style.height).toBe("28px")
    const cell = row.querySelector<HTMLElement>('[role="gridcell"]')
    expect(cell?.className).toContain("truncate")
    expect(cell?.getAttribute("title")).toBe("张三")
    卸()
  })

  test("虚拟滚动：只渲染视口窗口，不把 1000 行全铺进 DOM", () => {
    const 大 = 元({
      totalRows: 1001,
      preview: Array.from({ length: 201 }, (_, i) => (i === 0 ? ["姓名", "金额"] : [`第${i}行`, String(i)])),
    })
    const { host, 卸 } = 挂(大)
    const 渲染行数 = 数据行(host).length
    expect(渲染行数).toBeGreaterThan(0)
    expect(渲染行数).toBeLessThan(100)
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("1001")
    卸()
  })

  test("外壳数据属性：loaded/total/mode 可观测", () => {
    const { host, 卸 } = 挂()
    const grid = host.querySelector<HTMLElement>('[data-slot="sheet-grid"]')
    expect(grid?.getAttribute("data-loaded-rows")).toBe("4")
    expect(grid?.getAttribute("data-total-rows")).toBe("4")
    expect(grid?.getAttribute("data-mode")).toBe("full")
    卸()
  })

  test("HTML 内容按文本渲染，不生成元素", () => {
    const { host, 卸 } = 挂(
      元({
        header: ["内容"],
        totalCols: 1,
        preview: [["内容"], ["<img src=x onerror=alert(1)>"]],
        columnTypes: ["text"],
      }),
    )
    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>")
    卸()
  })
})

describe("列宽交互", () => {
  test("拖拽列边界：宽度按位移变化，所有行共用同一模板", () => {
    const { host, 卸 } = 挂()
    try {
      const handle = 表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')
      expect(handle).not.toBeNull()
      const 前 = 表头(host)?.style.gridTemplateColumns

      handle!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 260 }))
      window.dispatchEvent(new MouseEvent("pointerup"))

      const 后 = 表头(host)?.style.gridTemplateColumns
      expect(后).not.toBe(前)
      expect(后).toContain("px")
      expect(数据行(host)[0]?.style.gridTemplateColumns).toBe(后!)
    } finally {
      卸()
    }
  })

  test("双击边界按内容自适应，且受 64–320 初始钳制", () => {
    // 初始态把金额列设为 200px：若双击没接线，宽度会停在 200，不会误判为绿
    // （`LEARNINGS #005-47`：默认值满足断言会假绿）。
    const 初始: SheetUiState = {
      headerIsFirstRow: true,
      columns: [{ index: 1, letter: "B", name: "金额", type: "number", width: 200, hidden: false }],
      filters: [],
      scrollTop: 0,
      scrollLeft: 0,
    }
    const { host, 卸 } = 挂(元(), 初始)
    try {
      expect(表头(host)?.style.gridTemplateColumns?.split(" ")[2]).toBe("200px")
      const handle = 表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-col-resize"]')
      handle!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
      // 金额列内容 "1200" 宽 28 + 16 = 44 ⇒ 钳到 64
      expect(表头(host)?.style.gridTemplateColumns?.split(" ")[2]).toBe("64px")
    } finally {
      卸()
    }
  })

  test("初始列在首行不是表头时从第 0 行取样", () => {
    const 长格 = "1".repeat(50)
    const 初始: SheetUiState = {
      headerIsFirstRow: false,
      columns: [],
      filters: [],
      scrollTop: 0,
      scrollLeft: 0,
    }
    const { host, 卸 } = 挂(
      元({
        totalRows: 3,
        preview: [
          ["张三", 长格],
          ["李四", "300"],
          ["王五", "50"],
        ],
      }),
      初始,
    )
    try {
      // 首行是数据行：50 个字符宽 350 + 16 ⇒ 钳到 320；旧实现从第 1 行取样只得 64。
      expect(表头(host)?.style.gridTemplateColumns?.split(" ")[2]).toBe("320px")
    } finally {
      卸()
    }
  })

  test("宽度变化写进 onChange 的状态", () => {
    let 最后: any
    const store = createSheetStore(元(), "full", { rows: 0, cols: 0 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} onChange={(state) => (最后 = state)} />, host)
    try {
      const handle = host.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')!
      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 250 }))
      window.dispatchEvent(new MouseEvent("pointerup"))
      expect(最后.columns[0].width).toBeGreaterThan(64)
    } finally {
      dispose()
      host.remove()
    }
  })
})

describe("筛选", () => {
  async function 打开筛选(host: HTMLElement, column: number) {
    const 漏斗 = 表头(host)?.querySelector<HTMLElement>(`[data-column="${column}"] [data-slot="sheet-col-filter"]`)
    漏斗!.click()
    // 按列号找**这一列**的浮层：上一条浮层即使还没退场，也不会被误读（`LEARNINGS #005-34`）。
    return 等元素(() =>
      document.querySelector<HTMLElement>(`[data-slot="column-filter"][data-column="${column}"]`),
    )
  }

  /** 浮层默认是「值」清单；要按文本拟条件得先切到「包含」。 */
  async function 设为包含(浮层: HTMLElement) {
    const label = [...浮层.querySelectorAll("label")].find((item) => item.textContent?.trim() === "包含")
    label!.querySelector<HTMLInputElement>('input[type="radio"]')!.click()
    return 等元素(() => 浮层.querySelector<HTMLInputElement>('[data-slot="column-filter-text"]'))
  }

  test("包含筛选：只剩命中行，摘要更新；清除恢复", async () => {
    const { host, 卸 } = 挂()
    try {
      const 浮层 = await 打开筛选(host, 0)
      const 输入 = await 设为包含(浮层)
      输入.value = "张"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

      expect(数据行(host)).toHaveLength(1)
      expect(数据行(host)[0]?.textContent).toContain("张三")
      expect(host.textContent).toContain("筛选后 1 行 / 共 3 行")
      expect(host.querySelector('[data-slot="sheet-filter-chips"]')?.textContent).toContain("姓名")

      ;[...host.querySelectorAll("button")].find((button) => button.textContent === "清除全部")!.click()
      expect(数据行(host)).toHaveLength(3)
    } finally {
      卸()
    }
  })

  test("多列 AND", async () => {
    const { host, 卸 } = 挂()
    try {
      const 浮层 = await 打开筛选(host, 0)
      const 输入 = await 设为包含(浮层)
      输入.value = "张"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

      const 浮层2 = await 打开筛选(host, 1)
      const 输入2 = await 设为包含(浮层2)
      输入2.value = "300"
      输入2.dispatchEvent(new Event("input", { bubbles: true }))
      ;[...浮层2.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

      expect(数据行(host)).toHaveLength(0)
      expect(host.querySelector('[data-slot="sheet-filter-empty"]')).not.toBeNull()
    } finally {
      卸()
    }
  })

  test("筛选空态 + 清除筛选", async () => {
    const { host, 卸 } = 挂()
    try {
      const 浮层 = await 打开筛选(host, 0)
      const 输入 = await 设为包含(浮层)
      输入.value = "不存在"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

      expect(host.querySelector('[data-slot="sheet-filter-empty"]')?.textContent).toContain("没有符合筛选")
      ;[...host.querySelectorAll("button")].find((button) => button.textContent === "清除筛选")!.click()
      expect(数据行(host)).toHaveLength(3)
    } finally {
      卸()
    }
  })

  test("隐藏列上的筛选保留并标注", async () => {
    const { host, 卸 } = 挂()
    try {
      const 浮层 = await 打开筛选(host, 1)
      const 输入 = await 设为包含(浮层)
      输入.value = "300"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

      表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-hide-column"]')!.click()
      expect(数据行(host)).toHaveLength(1)
      expect(host.querySelector('[data-slot="sheet-filter-chips"]')?.textContent).toContain("该列已隐藏")
    } finally {
      卸()
    }
  })
})

describe("列显示/隐藏", () => {
  test("隐藏单列后不渲染该列，计数更新", () => {
    const { host, 卸 } = 挂()
    try {
      const 隐藏 = 表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-hide-column"]')
      隐藏!.click()

      expect(表头(host)?.querySelector('[data-column="1"]')).toBeNull()
      expect(数据行(host)[0]?.querySelectorAll('[role="gridcell"]')).toHaveLength(1)
      expect(host.querySelector('[role="grid"]')?.getAttribute("aria-colcount")).toBe("1")
      expect(host.textContent).toContain("显示 1 / 2 列")
    } finally {
      卸()
    }
  })

  test("全部隐藏：空态 + 全部显示", () => {
    const { host, 卸 } = 挂()
    try {
      表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-hide-column"]')!.click()
      表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-hide-column"]')!.click()

      expect(host.querySelector('[data-slot="sheet-no-columns"]')).not.toBeNull()
      const 全部显示 = [...host.querySelectorAll("button")].find((button) => button.textContent === "全部显示")
      全部显示!.click()
      expect(host.querySelector('[role="grid"]')).not.toBeNull()
      expect(host.querySelector('[role="grid"]')?.getAttribute("aria-colcount")).toBe("2")
    } finally {
      卸()
    }
  })

  test("全部列清单：打开、取消勾选、搜索、全部显示", async () => {
    const { host, 卸 } = 挂()
    try {
      host.querySelector<HTMLElement>('[data-slot="sheet-columns-trigger"]')!.click()

      const 清单 = await 等元素(() => document.querySelector<HTMLElement>('[data-slot="sheet-column-list"]'))
      const 金额项 = [...清单.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
        input.closest("label")?.textContent?.includes("金额"),
      )
      金额项!.click()
      expect(host.querySelector('[data-column="1"]')).toBeNull()

      const 搜索 = 清单.querySelector<HTMLInputElement>('input[data-slot="sheet-column-search"]')!
      搜索.value = "姓"
      搜索.dispatchEvent(new Event("input", { bubbles: true }))
      expect(清单.textContent).toContain("姓名")
      expect(清单.textContent).not.toContain("金额")

      const 全部 = [...清单.querySelectorAll("button")].find((button) => button.textContent === "全部显示")
      全部!.click()
      expect(host.querySelector('[role="grid"]')?.getAttribute("aria-colcount")).toBe("2")
    } finally {
      卸()
    }
  })

  test("重置列宽回到初始估算宽度", async () => {
    const { host, 卸 } = 挂()
    try {
      expect(表头(host)?.style.gridTemplateColumns?.split(" ")[1]).toBe("64px")

      const handle = 表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')
      handle!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 260 }))
      window.dispatchEvent(new MouseEvent("pointerup"))
      expect(表头(host)?.style.gridTemplateColumns?.split(" ")[1]).toBe("124px")

      host.querySelector<HTMLElement>('[data-slot="sheet-columns-trigger"]')!.click()
      const 清单 = await 等元素(() => document.querySelector<HTMLElement>('[data-slot="sheet-column-list"]'))
      const 重置 = [...清单.querySelectorAll("button")].find((button) => button.textContent === "重置列宽")
      重置!.click()
      expect(表头(host)?.style.gridTemplateColumns?.split(" ")[1]).toBe("64px")
    } finally {
      卸()
    }
  })
})
