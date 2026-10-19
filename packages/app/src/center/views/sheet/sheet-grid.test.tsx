import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createSheetStore, SheetGrid, type SheetUiState } from "./sheet-grid"
import { 列标, type SheetMeta } from "./sheet-model"

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

function 挂(meta = 元(), initial?: SheetUiState, onChange?: (state: SheetUiState) => void) {
  const store = createSheetStore(meta, "full", { rows: 0, cols: 0 })
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => <SheetGrid store={store} initial={initial} onChange={onChange} />, host)
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

/**
 * happy-dom 没有布局：`scrollTop/scrollLeft` 既不钳位、`scrollHeight/clientHeight` 也恒 0
 * （`LEARNINGS #006-33`）。滚动的「内容不够高 ⇒ 赋值被钳位」这条真实行为只能自己装一个：
 * 覆盖实例属性，按 `量()` 现算内容高度/宽度，赋值时按浏览器口径夹在 [0, 可滚范围]。
 */
function 造滚动视口(
  scroll: HTMLElement,
  量: () => { 内容高: number; 内容宽?: number; 视口高?: number; 视口宽?: number },
) {
  let top = 0
  let left = 0
  const 视口高 = () => 量().视口高 ?? 600
  const 视口宽 = () => 量().视口宽 ?? 800
  const 最大顶 = () => Math.max(0, 量().内容高 - 视口高())
  const 最大左 = () => Math.max(0, (量().内容宽 ?? 0) - 视口宽())
  Object.defineProperties(scroll, {
    clientHeight: { configurable: true, get: 视口高 },
    clientWidth: { configurable: true, get: 视口宽 },
    scrollHeight: { configurable: true, get: () => 量().内容高 },
    scrollWidth: { configurable: true, get: () => 量().内容宽 ?? 0 },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, 最大顶()))
      },
    },
    scrollLeft: {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = Math.max(0, Math.min(value, 最大左()))
      },
    },
  })
  return {
    读: () => ({ top, left }),
    设: (下一: { top?: number; left?: number }) => {
      if (下一.top !== undefined) scroll.scrollTop = 下一.top
      if (下一.left !== undefined) scroll.scrollLeft = 下一.left
    },
  }
}

const 等到 = async (条件: () => boolean, 说明: string, timeout = 2000) => {
  const 起 = Date.now()
  for (;;) {
    if (条件()) return
    if (Date.now() - 起 > timeout) throw new Error(`等条件超时：${说明}`)
    await new Promise((r) => setTimeout(r, 10))
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

describe("滚动位置恢复", () => {
  const 大元 = () =>
    元({
      totalRows: 1001,
      preview: Array.from({ length: 201 }, (_, i) => (i === 0 ? ["姓名", "金额"] : [`第${i}行`, String(i)])),
    })
  const 初始 = (top: number): SheetUiState => ({
    headerIsFirstRow: true,
    columns: [],
    filters: [],
    scrollTop: top,
    scrollLeft: 0,
  })
  // 首屏 201 行内容高 = 表头 32 + 201 × 28；分块追加后按 store.rows.length 现算。
  const 视口量 = (store: ReturnType<typeof createSheetStore>) => () => ({ 内容高: 32 + store.rows.length * 28 })

  test("首屏内容不足时保持待恢复，分块够长后恢复 scrollTop", async () => {
    const { host, store, 卸 } = 挂(大元(), 初始(14000))
    try {
      const scroll = host.querySelector<HTMLElement>('[data-slot="sheet-scroll"]')!
      const 视口 = 造滚动视口(scroll, 视口量(store))
      // 等挂载首帧的恢复尝试跑完：201 行时最大可滚 ≈ 5060 < 14000 ⇒ 不能判定「位置丢了」，
      // 必须保持待恢复而不是把钳位后的 5060 写进去（这份断言就是钉这一点的）。
      await new Promise((r) => setTimeout(r, 50))
      expect(视口.读().top).toBe(0)

      store.appendChunk(
        201,
        Array.from({ length: 500 }, (_, i) => [`补${i}`, String(i)]),
      )
      await 等到(() => 视口.读().top === 14000, "分块后恢复到 14000")
      // scroll 垫片不派发 scroll 事件，这里无法证明「恢复期不把钳位值写回缓存」；
      // 该路径由真栈用例（解析中滚 14000 → 切 Tab 回来仍 14000）覆盖，见设计文档 §14.1。
    } finally {
      卸()
    }
  })

  test("待恢复期间用户主动滚动 ⇒ 取消待恢复，后续分块不再把位置拉回", async () => {
    const { host, store, 卸 } = 挂(大元(), 初始(14000))
    try {
      const scroll = host.querySelector<HTMLElement>('[data-slot="sheet-scroll"]')!
      const 视口 = 造滚动视口(scroll, 视口量(store))
      // 虚拟器在 ref 的微任务里才接管滚动元素（`sheet-grid.tsx` 的 ref 注释）；真实用户
      // 滚动不可能发生在渲染当拍。等一拍再模拟，才对应现实时序。
      await new Promise((r) => setTimeout(r, 0))
      视口.设({ top: 3000 })
      scroll.dispatchEvent(new Event("scroll"))
      expect(视口.读().top).toBe(3000)

      store.appendChunk(
        201,
        Array.from({ length: 500 }, (_, i) => [`补${i}`, String(i)]),
      )
      await new Promise((r) => setTimeout(r, 100))
      expect(视口.读().top, "用户主动滚动后，分块完成不得把位置拉回 14000").toBe(3000)
    } finally {
      卸()
    }
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
      columns: [{ index: 1, letter: "B", name: "金额", type: "number", width: 200, hidden: false, align: "right" }],
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

describe("列对齐", () => {
  const 格 = (row: HTMLElement, index: number) => row.querySelectorAll<HTMLElement>('[role="gridcell"]')[index]

  /** 对齐入口长在列筛选浮层里：打开漏斗 → 点「中」/「左」/「右」。 */
  async function 打开并选对齐(host: HTMLElement, column: number, align: "left" | "center" | "right") {
    const 漏斗 = 表头(host)?.querySelector<HTMLElement>(`[data-column="${column}"] [data-slot="sheet-col-filter"]`)
    漏斗!.click()
    const 浮层 = await 等元素(() =>
      document.querySelector<HTMLElement>(`[data-slot="column-filter"][data-column="${column}"]`),
    )
    const 按钮 = await 等元素(() =>
      浮层.querySelector<HTMLElement>(`[data-slot="sheet-col-align"][data-align="${align}"]`),
    )
    按钮.click()
    return 浮层
  }

  test("默认按类型：文本左对齐、数字右对齐（与改造前一致）", () => {
    const { host, 卸 } = 挂()
    const row = 数据行(host)[0]
    expect(格(row, 0).className).toContain("text-left")
    expect(格(row, 1).className).toContain("text-right")
    卸()
  })

  test("浮层里选居中：数据格变 text-center，写进 UI 状态，重新挂载按存过的恢复", async () => {
    let 最后: SheetUiState | undefined
    const { host, 卸 } = 挂(元(), undefined, (state) => (最后 = state))
    try {
      await 打开并选对齐(host, 0, "center")
      expect(格(数据行(host)[0], 0).className).toContain("text-center")
      expect(最后?.columns[0].align).toBe("center")

      卸()
      const 再挂 = 挂(元(), 最后)
      try {
        expect(格(数据行(再挂.host)[0], 0).className).toContain("text-center")
      } finally {
        再挂.卸()
      }
    } finally {
      host.remove()
    }
  })
})

describe("拖拽选区", () => {
  test("拖到右栏的载荷是 TSV：第一行是字段名，其后一行数据一条", () => {
    const { host, 卸 } = 挂()
    const 原选区 = window.getSelection
    try {
      const 滚动 = host.querySelector<HTMLElement>('[data-slot="sheet-scroll"]')!
      const 行们 = 数据行(host)
      const 格 = (row: HTMLElement, index: number) => row.querySelectorAll<HTMLElement>('[role="gridcell"]')[index]
      // 模拟「从张三行拖到李四行、两列」的线性选区：行元素与各自的格都被覆盖。
      const 选中 = new Set<Node>([
        行们[0],
        行们[1],
        格(行们[0], 0),
        格(行们[0], 1),
        格(行们[1], 0),
        格(行们[1], 1),
      ])
      Object.defineProperty(window, "getSelection", {
        configurable: true,
        writable: true,
        value: () => ({
          rangeCount: 1,
          isCollapsed: false,
          getRangeAt: () => ({ intersectsNode: (node: Node) => 选中.has(node) }),
        }),
      })
      let 载荷: string | undefined
      const event = new Event("dragstart", { bubbles: true, cancelable: true })
      Object.defineProperty(event, "dataTransfer", {
        value: {
          setData: (type: string, value: string) => {
            if (type === "text/plain") 载荷 = value
          },
        },
      })
      滚动.dispatchEvent(event)
      expect(载荷).toBe("姓名\t金额\n张三\t1200\n李四\t300")
    } finally {
      Object.defineProperty(window, "getSelection", { configurable: true, writable: true, value: 原选区 })
      卸()
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

describe("排序", () => {
  const 首行 = (host: HTMLElement) => 数据行(host)[0]

  test("点列头升序→降序→取消，行号始终是原始号", () => {
    const { host, 卸 } = 挂()
    try {
      // 箭头断言必须限定到被排序列：整表头 textContent 会掩盖「每列都画箭头」的回归。
      const 金额列头 = () => 表头(host)?.querySelector<HTMLElement>('[data-column="1"]')
      const 金额头 = 金额列头()?.querySelector<HTMLElement>('[data-slot="sheet-sort"]')!

      金额头.click()
      expect(首行(host)?.textContent).toContain("王五")
      expect(行号(首行(host)!)).toBe("4")
      expect(金额列头()?.textContent).toContain("▲")

      金额头.click()
      expect(首行(host)?.textContent).toContain("张三")
      expect(行号(首行(host)!)).toBe("2")
      expect(金额列头()?.textContent).toContain("▼")

      金额头.click()
      expect(首行(host)?.textContent).toContain("张三")
      expect(行号(首行(host)!)).toBe("2")
      expect(金额列头()?.textContent).not.toContain("▲")
      expect(金额列头()?.textContent).not.toContain("▼")
    } finally {
      卸()
    }
  })

  test("非单调数据：三次点击分别命中升序/降序/取消", () => {
    const { host, 卸 } = 挂(
      元({ preview: [["姓名", "金额"], ["李四", "300"], ["张三", "1200"], ["王五", "50"]] }),
    )
    try {
      // 三种态的首行两两不同（王五 / 张三 / 李四），才能把降序与取消从默认顺序里区分出来。
      const 金额列头 = () => 表头(host)?.querySelector<HTMLElement>('[data-column="1"]')
      const 金额头 = 金额列头()?.querySelector<HTMLElement>('[data-slot="sheet-sort"]')!

      金额头.click()
      expect(首行(host)?.textContent).toContain("王五")
      expect(行号(首行(host)!)).toBe("4")
      expect(金额列头()?.textContent).toContain("▲")

      金额头.click()
      expect(首行(host)?.textContent).toContain("张三")
      expect(行号(首行(host)!)).toBe("3")
      expect(金额列头()?.textContent).toContain("▼")

      金额头.click()
      expect(首行(host)?.textContent).toContain("李四")
      expect(行号(首行(host)!)).toBe("2")
      expect(金额列头()?.textContent).not.toContain("▲")
      expect(金额列头()?.textContent).not.toContain("▼")
    } finally {
      卸()
    }
  })

  test("排序与筛选叠加：先筛后排", async () => {
    // 筛选后保留两行（张三 / 张四，原顺序），删掉排序时顺序会停在原顺序 ⇒ 用例必红。
    const { host, 卸 } = 挂(
      元({ preview: [["姓名", "金额"], ["张三", "1200"], ["张四", "300"], ["王五", "50"]] }),
    )
    try {
      const 漏斗 = 表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-filter"]')!
      漏斗.click()
      const 浮层 = await 等元素(() => document.querySelector<HTMLElement>('[data-slot="column-filter"][data-column="0"]'))
      const 包含 = [...浮层.querySelectorAll("label")].find((item) => item.textContent?.trim() === "包含")
      包含!.querySelector<HTMLInputElement>('input[type="radio"]')!.click()
      const 输入 = await 等元素(() => 浮层.querySelector<HTMLInputElement>('[data-slot="column-filter-text"]'))
      输入.value = "张"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()

      const 金额头 = 表头(host)?.querySelector<HTMLElement>('[data-column="1"] [data-slot="sheet-sort"]')!
      金额头.click()
      expect(数据行(host)).toHaveLength(2)
      expect(首行(host)?.textContent).toContain("张四")
      expect(行号(首行(host)!)).toBe("3")
      expect(数据行(host).map((row) => row.querySelectorAll('[role="gridcell"]')[0]?.textContent)).toEqual([
        "张四",
        "张三",
      ])
    } finally {
      卸()
    }
  })
})

describe("查找", () => {
  const 打开查找 = async (host: HTMLElement) => {
    const 按钮 = [...host.querySelectorAll("button")].find((button) => button.textContent === "查找")
    按钮!.click()
    return 等元素(() => host.querySelector<HTMLInputElement>('[data-slot="sheet-find-input"]'))
  }

  test("输入去抖后显示命中计数；下一处切换", async () => {
    const { host, 卸 } = 挂()
    const 输入 = await 打开查找(host)
    输入.value = "张"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
    expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toBe("第 1 / 共 1 个")

    输入.value = "行"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
    expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toContain("共 0 个")
    卸()
  })

  test("隐藏列不搜", async () => {
    const { host, 卸 } = 挂()
    表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-hide-column"]')!.click()
    const 输入 = await 打开查找(host)
    输入.value = "张"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
    expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toContain("0 个")

    // 只断言「0 个」时，搜索压根没跑也满足（`#005-47`）。恢复姓名列后必须立刻命中，
    // 这条同时钉住「可见列变化会重跑去抖搜索」。
    host.querySelector<HTMLElement>('[data-slot="sheet-columns-trigger"]')!.click()
    const 清单 = await 等元素(() => document.querySelector<HTMLElement>('[data-slot="sheet-column-list"]'))
    const 姓名项 = [...清单.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
      input.closest("label")?.textContent?.includes("姓名"),
    )
    姓名项!.click()
    await new Promise((r) => setTimeout(r, 250))
    expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toBe("第 1 / 共 1 个")
    卸()
  })

  test("Esc 关闭查找条", async () => {
    const { host, 卸 } = 挂()
    const 输入 = await 打开查找(host)
    输入.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(host.querySelector('[data-slot="sheet-find"]')).toBeNull()
    卸()
  })

  test("焦点在查找条按钮上时 Esc 也关闭", async () => {
    const { host, 卸 } = 挂()
    try {
      await 打开查找(host)
      const 下一处 = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "下一处",
      )!
      下一处.click()
      下一处.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      expect(host.querySelector('[data-slot="sheet-find"]')).toBeNull()
    } finally {
      卸()
    }
  })

  test("Ctrl+F 只在网格内聚焦时接管", () => {
    const { host, 卸 } = 挂()
    const scroll = host.querySelector<HTMLElement>('[data-slot="sheet-scroll"]')!
    scroll.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))
    expect(host.querySelector('[data-slot="sheet-find"]')).not.toBeNull()
    卸()
  })

  test("Ctrl+F 在网格外聚焦时不接管", () => {
    const { host, 卸 } = 挂()
    const 外部 = document.createElement("input")
    document.body.appendChild(外部)
    try {
      外部.focus()
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))
      expect(host.querySelector('[data-slot="sheet-find"]')).toBeNull()
    } finally {
      外部.remove()
      卸()
    }
  })

  test("多处命中时下一处循环回绕", async () => {
    const { host, 卸 } = 挂(
      元({ preview: [["姓名", "金额"], ["张三", "1200"], ["张三丰", "300"], ["王五", "50"]] }),
    )
    try {
      const 输入 = await 打开查找(host)
      输入.value = "张"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))
      const 计数 = () => host.querySelector('[data-slot="sheet-find-count"]')?.textContent
      const 下一处 = () => [...host.querySelectorAll("button")].find((button) => button.textContent === "下一处")!

      expect(计数()).toBe("第 1 / 共 2 个")
      下一处().click()
      expect(计数()).toBe("第 2 / 共 2 个")
      下一处().click()
      expect(计数()).toBe("第 1 / 共 2 个")
    } finally {
      卸()
    }
  })

  test("筛选外的命中给出提示", async () => {
    const { host, 卸 } = 挂()
    try {
      // 走真实筛选浮层把「张」筛掉，只留「李四」；查找仍应在已加载数据里看到张三。
      const 漏斗 = 表头(host)?.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-filter"]')!
      漏斗.click()
      const 浮层 = await 等元素(() =>
        document.querySelector<HTMLElement>('[data-slot="column-filter"][data-column="0"]'),
      )
      const 包含 = [...浮层.querySelectorAll("label")].find((item) => item.textContent?.trim() === "包含")
      包含!.querySelector<HTMLInputElement>('input[type="radio"]')!.click()
      const 筛选输入 = await 等元素(() => 浮层.querySelector<HTMLInputElement>('[data-slot="column-filter-text"]'))
      筛选输入.value = "李"
      筛选输入.dispatchEvent(new Event("input", { bubbles: true }))
      ;[...浮层.querySelectorAll("button")].find((button) => button.textContent === "应用")!.click()
      expect(数据行(host)).toHaveLength(1)

      const 输入 = await 打开查找(host)
      输入.value = "张"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))
      expect(host.querySelector('[data-slot="sheet-find-count"]')?.textContent).toBe("第 1 / 共 1 个")
      expect(host.querySelector('[data-slot="sheet-find-hidden"]')).not.toBeNull()
    } finally {
      卸()
    }
  })

  /** 宽表夹具：10 列 × 300px（总宽 3056 > 容器 800），第 0 列与第 9 列各放一个可查的目标。 */
  function 宽表() {
    const 列数 = 10
    const 表头列 = Array.from({ length: 列数 }, (_, i) => `列${i}`)
    const meta = 元({
      totalRows: 3,
      totalCols: 列数,
      header: 表头列,
      preview: [
        表头列,
        [...Array(列数 - 1).fill("x"), "远端目标"],
        ["近端目标", ...Array(列数 - 1).fill("x")],
        [...Array(4).fill("x"), "中段目标", ...Array(列数 - 5).fill("x")],
      ],
      columnTypes: Array.from({ length: 列数 }, () => "text" as const),
    })
    const initial: SheetUiState = {
      headerIsFirstRow: true,
      columns: Array.from({ length: 列数 }, (_, i) => ({
        index: i,
        letter: 列标(i),
        name: `列${i}`,
        type: "text" as const,
        width: 300,
        hidden: false,
        align: "left" as const,
      })),
      filters: [],
      scrollTop: 0,
      scrollLeft: 0,
    }
    return { meta, initial, 列数 }
  }

  const 装宽表视口 = (host: HTMLElement, store: ReturnType<typeof createSheetStore>, 列数: number) => {
    const scroll = host.querySelector<HTMLElement>('[data-slot="sheet-scroll"]')!
    return 造滚动视口(scroll, () => ({ 内容高: 32 + store.rows.length * 28, 内容宽: 56 + 300 * 列数 }))
  }

  const 输入查找 = async (host: HTMLElement, 词: string) => {
    const 输入 = await 打开查找(host)
    输入.value = 词
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
  }

  test("命中远端列：横向滚入视口", async () => {
    const { meta, initial, 列数 } = 宽表()
    const { host, store, 卸 } = 挂(meta, initial)
    try {
      const 视口 = 装宽表视口(host, store, 列数)
      await 输入查找(host, "远端目标")

      const { left } = 视口.读()
      expect(left, "命中第 9 列时应横向滚动").toBeGreaterThan(0)
      // 列几何：x = 行号列宽 56 + Σ 前序列宽（9 × 300）；命中格必须整格落在视口内。
      const x = 56 + 300 * (列数 - 1)
      expect(left).toBeLessThanOrEqual(x)
      expect(x + 300).toBeLessThanOrEqual(left + 800)
    } finally {
      卸()
    }
  })

  test("命中左侧列：scrollLeft 不被无谓改动", async () => {
    const { meta, initial, 列数 } = 宽表()
    const { host, store, 卸 } = 挂(meta, initial)
    try {
      const 视口 = 装宽表视口(host, store, 列数)
      await 输入查找(host, "近端目标")
      expect(视口.读().left, "目标已在视口内时不应横向滚动").toBe(0)
    } finally {
      卸()
    }
  })

  test("命中已完整可见的中段列：scrollLeft 保持原值", async () => {
    const { meta, initial, 列数 } = 宽表()
    const { host, store, 卸 } = 挂(meta, initial)
    try {
      const 视口 = 装宽表视口(host, store, 列数)
      // 预置到中段：视口内容区 [1000, 1800]；第 4 列 x = 56 + 4×300 = 1256..1556 整格可见。
      视口.设({ left: 1000 })
      await 输入查找(host, "中段目标")
      // 若误走居中逻辑，目标会变成 1256 + 150 - (800 + 56) / 2 = 978。
      expect(视口.读().left, "目标已完整可见时不得再横向移动").toBe(1000)
    } finally {
      卸()
    }
  })

  test("命中列被冻结行号列遮住时仍横向滚入视口", async () => {
    const { meta, initial, 列数 } = 宽表()
    const { host, store, 卸 } = 挂(meta, initial)
    try {
      const 视口 = 装宽表视口(host, store, 列数)
      // scrollLeft=20 时第 0 列（x=56..356）头 36px 压在冻结行号列（内容坐标 20..76）下面，
      // 不得判成「已可见」；应滚回 0 让它完整露出。
      视口.设({ left: 20 })
      await 输入查找(host, "近端目标")
      expect(视口.读().left, "被行号列遮住的命中格必须滚入视口").toBe(0)
    } finally {
      卸()
    }
  })
})

describe("横幅与空态", () => {
  test("预览档：写出原表总数与截断范围", () => {
    const store = createSheetStore(
      元({ totalRows: 2000, totalCols: 100, preview: [["姓名", "金额"], ["张三", "1"]] }),
      "preview",
      { rows: 999, cols: 36 },
    )
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} />, host)
    const 横幅 = host.querySelector('[data-slot="sheet-preview-banner"]')?.textContent ?? ""
    expect(横幅).toContain("2000")
    expect(横幅).toContain("前 1000 行")
    expect(横幅).toContain("64 列")
    expect(横幅).toContain("Excel/WPS")
    dispose()
    host.remove()
  })

  test("全量档列截断：明说前 N 列", () => {
    const store = createSheetStore(元({ totalCols: 300 }), "full", { rows: 0, cols: 44 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} />, host)
    expect(host.querySelector('[data-slot="sheet-column-truncated"]')?.textContent).toContain("前 256 列")
    dispose()
    host.remove()
  })

  test("多工作表：写明总表数与当前表名", () => {
    const store = createSheetStore(元({ sheetNames: ["明细", "汇总"] }), "full", { rows: 0, cols: 0 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} />, host)
    const 文案 = host.querySelector('[data-slot="sheet-multi-sheet"]')?.textContent ?? ""
    expect(文案).toContain("共 2 张表")
    expect(文案).toContain("明细")
    dispose()
    host.remove()
  })

  test("首屏后解析中断：保留行 + 明说只显示前 N 行", () => {
    const { host, store, 卸 } = 挂()
    store.setError("解析线程崩溃")
    expect(数据行(host).length).toBeGreaterThan(0)
    expect(host.querySelector('[data-slot="sheet-parse-error"]')?.textContent).toContain("解析中断")
    卸()
  })

  test("零数据行：这张表没有数据", () => {
    const { host, 卸 } = 挂(元({ totalRows: 1, preview: [["姓名", "金额"]] }))
    expect(host.querySelector('[data-slot="sheet-empty"]')?.textContent).toContain("这张表没有数据")
    卸()
  })

  test("预览档解析中断：不并显截断横幅", () => {
    const store = createSheetStore(元({ totalRows: 2000 }), "preview", { rows: 999, cols: 36 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={store} />, host)
    store.setError("解析线程崩溃")
    expect(host.querySelector('[data-slot="sheet-preview-banner"]')).toBeNull()
    expect(host.querySelector('[data-slot="sheet-parse-error"]')).not.toBeNull()
    dispose()
    host.remove()
  })

  test("加载进度横幅：未载完显示，载完消失", () => {
    const 未载完 = createSheetStore(元({ totalRows: 10 }), "full", { rows: 0, cols: 0 })
    const host = document.createElement("div")
    document.body.appendChild(host)
    const dispose = render(() => <SheetGrid store={未载完} />, host)
    expect(host.querySelector('[data-slot="sheet-progress"]')?.textContent).toContain("已加载 3 行 / 共 9 行")
    dispose()
    host.remove()

    const 已载完 = createSheetStore(元(), "full", { rows: 0, cols: 0 })
    const host2 = document.createElement("div")
    document.body.appendChild(host2)
    const dispose2 = render(() => <SheetGrid store={已载完} />, host2)
    expect(host2.querySelector('[data-slot="sheet-progress"]')).toBeNull()
    dispose2()
    host2.remove()
  })
})
