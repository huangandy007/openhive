import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createSheetStore, SheetGrid } from "./sheet-grid"
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

function 挂(meta = 元()) {
  const store = createSheetStore(meta, "full", { rows: 0, cols: 0 })
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => <SheetGrid store={store} />, host)
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
// oxlint-disable-next-line no-unused-vars -- 后续任务的浮层用例会用（本任务暂无浮层）。
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
