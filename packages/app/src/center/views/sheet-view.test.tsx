import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import * as XLSX from "xlsx"
import type { FileContent } from "@/center/file-content"
import { 清空会话改过 } from "@/center/session-edits"
import { setCurrentProject } from "@/project/current-project"
import { 加密的Office容器 } from "./__fixtures__/office"
import { 缓存键, 记上次表, 清空UI状态, 清空数据 } from "./sheet/sheet-state-cache"
import { 列上界, 行上界, 是加密工作簿, renderSheet, SheetView } from "./sheet-view"

// 组件测试一律走主线程解析：Bun 里 `Worker` 存在，但 Vite 的 worker 入口转换不在这条链上，
// 真起一个 Worker 会让用例依赖运行时细节。`解析表格` 以 `typeof Worker === "undefined"` 判降级，
// 这里显式抹掉即可（生产不受影响，测试文件不进打包）。**文件结束必须还原**：这是进程级全局，
// 同进程里别的测试文件不该继承这份垫片。
const 原Worker = globalThis.Worker
// @ts-expect-error 测试垫片
globalThis.Worker = undefined

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
// 「网格里出现单元格文本」的断言会假红（其实是环境没视口）。与 `sheet-grid.test.tsx` 同一垫片。
const 视口尺寸 = [
  ["offsetWidth", 800],
  ["offsetHeight", 600],
] as const
const 原视口描述符 = 视口尺寸.map(([属性]) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, 属性))
for (const [属性, 尺寸] of 视口尺寸) {
  Object.defineProperty(HTMLElement.prototype, 属性, {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.slot === "sheet-scroll" ? 尺寸 : 0
    },
  })
}

afterAll(() => {
  globalThis.Worker = 原Worker
  视口尺寸.forEach(([属性], index) => {
    const 原描述符 = 原视口描述符[index]
    // 原来没有自有描述符就删掉，别在原型上留一个假 getter。
    if (原描述符) Object.defineProperty(HTMLElement.prototype, 属性, 原描述符)
    else Reflect.deleteProperty(HTMLElement.prototype, 属性)
  })
})

function 工作簿字节(表: unknown[][], 名 = "明细"): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(表), 名)
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

const 加密工作簿 = () => 加密的Office容器(["/encryption"])

function 二进制内容(bytes: Uint8Array): FileContent {
  let 串 = ""
  for (const byte of bytes) 串 += String.fromCharCode(byte)
  return { type: "binary", content: btoa(串), encoding: "base64" }
}

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

function 容器() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  return host
}

const 等状态 = async (host: HTMLElement, 目标: string) => {
  for (let i = 0; i < 300; i++) {
    const 视图 = host.querySelector<HTMLElement>("[data-component='sheet-view']")
    if (视图?.getAttribute("data-state") === 目标) return 视图
    await new Promise((r) => setTimeout(r, 10))
  }
  const 视图 = host.querySelector<HTMLElement>("[data-component='sheet-view']")
  throw new Error(`没等到 data-state=${目标}，实得 ${视图?.getAttribute("data-state")}`)
}

/**
 * `renderSheet` 在**首屏 meta** 就 resolve（不等全量）。档位/截断/分块都在
 * `onDone` 之后才到，所以任何读预览/列截断横幅、`data-loaded-rows` 的断言都必须等，
 * 不能 `await renderSheet(...)` 后立刻读（`LEARNINGS #006-31`：判据读早了）。
 */
const 等条件 = async (条件: () => boolean, 说明: string) => {
  for (let i = 0; i < 300; i++) {
    if (条件()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`等条件超时：${说明}`)
}

function 多表工作簿(表?: { 名: string; 行: unknown[][]; 隐藏?: boolean }[]): Uint8Array<ArrayBuffer> {
  const 内容 = 表 ?? [
    { 名: "甲表", 行: [["内容"], ["甲表数据"]] },
    { 名: "乙表", 行: [["内容"], ["乙表数据"]] },
    { 名: "丙表", 行: [["内容"], ["丙表数据"]], 隐藏: true },
  ]
  const book = XLSX.utils.book_new()
  for (const item of 内容) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(item.行), item.名)
  内容.forEach((item, index) => {
    if (item.隐藏) XLSX.utils.book_set_sheet_visibility(book, index, 1)
  })
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

const 标签 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="sheet-tab"]')]
const 当前表 = (host: HTMLElement) =>
  host.querySelector('[data-slot="sheet-tab"][aria-selected="true"]')?.getAttribute("data-sheet")

/** 首列宽（模板串第一项是行号列 56px）。 */
const 首列宽 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-slot="sheet-header"]')?.style.gridTemplateColumns.split(" ")[1]

function 拖宽首列(host: HTMLElement, 起: number, 止: number) {
  const 拖拽 = host.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')!
  拖拽.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 起 }))
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: 止 }))
  window.dispatchEvent(new MouseEvent("pointerup"))
}

const 网格 = (host: HTMLElement) => host.querySelector('[role="grid"]')
const 表头 = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="sheet-header"]')
const 数据行 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="sheet-row"]')]

beforeEach(() => {
  清空会话改过()
  清空UI状态()
  清空数据()
  // 模块级信号跨用例活着：不归零会让「换项目」用例继承上一条的项目身份。
  setCurrentProject(undefined)
})

describe("表格视图：字节 → 网格", () => {
  test("旧导出不变：行上界 1000、列上界 64", () => {
    expect(行上界).toBe(1000)
    expect(列上界).toBe(64)
  })

  test("真 xlsx 字节渲染成网格，单元格文本落到表里", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["姓名", "金额"], ["张三", 1200]]), host, { 强制主线程: true })
    expect(网格(host)).not.toBeNull()
    expect(host.textContent).toContain("张三")
    expect(host.textContent).toContain("1200")
  })

  test("UTF-8 中文 CSV 不作乱码", async () => {
    const host = 容器()
    await renderSheet(new TextEncoder().encode("姓名,金额\n张三,1200\n"), host, { 强制主线程: true })
    expect(host.textContent).toContain("张三")
    expect(host.textContent).toContain("姓名")
  })

  test("CSV 日期按规范串给，不给序列号", async () => {
    const host = 容器()
    await renderSheet(new TextEncoder().encode("姓名,日期\n张三,2026-10-01\n"), host, { 强制主线程: true })
    expect(host.textContent).toContain("2026-10-01")
    expect(host.textContent).not.toContain("46296")
  })

  test("真 xlsx 日期按规范串给，不给序列号", async () => {
    const host = 容器()
    await renderSheet(
      工作簿字节([["姓名", "日期"], ["张三", new Date(Date.UTC(2026, 9, 1))]]),
      host,
      { 强制主线程: true },
    )
    expect(host.textContent).toContain("2026-10-01")
    expect(host.textContent).not.toContain("46296")
  })

  test("长短不一的行按最宽行补齐，列不错位", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["姓名", "金额", "备注"], ["张三", 1200]]), host, { 强制主线程: true })
    // 行号列也有一个 `role="columnheader"`，这里只数数据列（带 `data-column` 的表头格）。
    expect(表头(host)?.querySelectorAll('[role="columnheader"][data-column]').length).toBe(3)
    expect(数据行(host)[0]?.querySelectorAll('[role="gridcell"]').length).toBe(3)
  })

  test("文件读不出表格结构：渲染器抛错", async () => {
    const host = 容器()
    await expect(
      renderSheet(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), host, { 强制主线程: true }),
    ).rejects.toThrow()
    expect(网格(host)).toBeNull()
  })

  test("单元格里的 HTML 当文本", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["<img src=x onerror=alert(1)>"]]), host, { 强制主线程: true })
    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>")
  })

  test("预览档：只物化前 3 行 × 2 列，并明说原表总数与截断范围", async () => {
    const 表 = [["A", "B", "C"], ...Array.from({ length: 5 }, (_, i) => [`第${i}行`, String(i), "x"])]
    const host = 容器()
    await renderSheet(工作簿字节(表), host, {
      强制主线程: true,
      limits: {
        首屏行数: 1,
        预览行数: 3,
        预览列数: 2,
        全量行上限: 2,
        全量格上限: 100,
        全量列上限: 2,
        分块行数: 2,
      },
    })
    await 等条件(() => host.textContent?.includes("原表共 6 行 × 3 列") ?? false, "预览档横幅")
    expect(host.textContent).toContain("前 3 行")
    expect(host.textContent).toContain("前 2 列")
    await 等条件(
      () => host.querySelector<HTMLElement>('[data-slot="sheet-grid"]')?.getAttribute("data-loaded-rows") === "4",
      "预览档物化 4 行（表头 + 3 数据行）",
    )
  })

  test("全量档列截断：明说前 2 列", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["A", "B", "C"], ["1", "2", "3"]]), host, {
      强制主线程: true,
      limits: {
        首屏行数: 10,
        预览行数: 10,
        预览列数: 2,
        全量行上限: 100,
        全量格上限: 1000,
        全量列上限: 2,
        分块行数: 2,
      },
    })
    await 等条件(() => host.textContent?.includes("前 2 列") ?? false, "全量档列截断横幅")
    expect(host.textContent).not.toContain("前 3 列")
  })

  test("加密的工作簿：渲染器抛错，由壳落「需要密码」", async () => {
    const host = 容器()
    await expect(renderSheet(加密工作簿(), host, { 强制主线程: true })).rejects.toThrow(/加密/)
    expect(网格(host)).toBeNull()
  })

  test("多张工作表：底部标签栏列出全部表，默认第一张，别的表不混进来", async () => {
    const host = 容器()
    await renderSheet(多表工作簿(), host, { 强制主线程: true })
    expect(标签(host).map((el) => el.textContent)).toEqual(["甲表", "乙表", "丙表（隐藏）"])
    expect(当前表(host)).toBe("甲表")
    expect(host.textContent).toContain("甲表数据")
    expect(host.textContent).not.toContain("乙表数据")
  })

  test("点「乙表」标签：网格换成乙表，标签栏不消失，甲表内容不残留", async () => {
    const host = 容器()
    await renderSheet(多表工作簿(), host, { 强制主线程: true })
    标签(host)[1].click()
    await 等条件(() => host.textContent?.includes("乙表数据") ?? false, "乙表数据")
    expect(host.textContent).not.toContain("甲表数据")
    expect(当前表(host)).toBe("乙表")
    expect(标签(host)).toHaveLength(3)
    expect(网格(host)).not.toBeNull()
    expect(数据行(host)[0]?.textContent).toContain("乙表数据")
  })

  // 隐藏工作表在最常见的口径里是「辅助表/中间结果」：用户仍要看得见、点得着，只是标注出来。
  test("隐藏工作表：标签带「（隐藏）」，照样能切过去", async () => {
    const host = 容器()
    await renderSheet(多表工作簿(), host, { 强制主线程: true })
    const 隐藏 = host.querySelector<HTMLElement>('[data-sheet="丙表"]')!
    expect(隐藏.textContent).toContain("（隐藏）")
    隐藏.click()
    await 等条件(() => host.textContent?.includes("丙表数据") ?? false, "隐藏表的数据")
    expect(当前表(host)).toBe("丙表")
  })

  test("单张工作表：没有标签栏", async () => {
    const host = 容器()
    await renderSheet(工作簿字节([["姓名"], ["张三"]]), host, { 强制主线程: true })
    expect(host.querySelector('[data-slot="sheet-tabs"]')).toBeNull()
  })

  test("两张表各记各的列宽：切走再切回来还是自己那份", async () => {
    const 键 = 缓存键("", "/p/多表.xlsx", 0)
    const bytes = 多表工作簿([
      { 名: "甲表", 行: [["姓名", "金额"], ["甲行", "1"]] },
      { 名: "乙表", 行: [["地址", "备注"], ["乙行", "2"]] },
    ])
    const host = 容器()
    await renderSheet(bytes, host, { 强制主线程: true, 缓存键: 键 })
    // 首列默认 = max(64, 表头宽 + 16) = 64px。
    expect(首列宽(host)).toBe("64px")
    拖宽首列(host, 200, 300)
    expect(首列宽(host)).toBe("164px")

    标签(host)[1].click()
    await 等条件(() => host.textContent?.includes("乙行") ?? false, "切到乙表")
    // 乙表自己那份默认值，不继承甲表拖过的宽度。
    expect(首列宽(host)).toBe("64px")

    标签(host)[0].click()
    await 等条件(() => host.textContent?.includes("甲行") ?? false, "切回甲表")
    expect(首列宽(host)).toBe("164px")
  })

  // 换表必须把上一趟解析终止掉：否则旧表的分块会追进**新表**的 store（`视图()` 已经指向新表），
  // 用户看到的是「乙表的表头 + 甲表的数据」。这里靠「让出后还有分块没发」的那一拍切表来钉。
  test("换表时上一趟解析被终止：旧表的分块不会追进新表", async () => {
    const bytes = 多表工作簿([
      { 名: "甲表", 行: [["内容"], ["甲一"], ["甲二"], ["甲三"]] },
      { 名: "乙表", 行: [["内容"], ["乙一"]] },
    ])
    const host = 容器()
    await renderSheet(bytes, host, {
      强制主线程: true,
      // 首屏只给 2 行 ⇒ 剩下的行走「让出后全量重读 + 分块」这条路，切表正好落在让出那一拍。
      limits: { 首屏行数: 1, 预览行数: 10, 预览列数: 4, 全量行上限: 100, 全量格上限: 1000, 全量列上限: 4, 分块行数: 1 },
    })
    标签(host)[1].click()
    await 等条件(() => host.textContent?.includes("乙一") ?? false, "切到乙表")
    // 乙表只有表头 + 1 行；多出来的就是旧表漏进来的分块。
    await 等条件(
      () => host.querySelector<HTMLElement>('[data-slot="sheet-grid"]')?.getAttribute("data-loaded-rows") === "2",
      "乙表只该有 2 行",
    )
    expect(host.textContent).not.toContain("甲一")
  })

  // 「上次看的表」只是我们自己的记忆：文件被换掉后那张表可能已经不存在。
  // 这时退回第一张，别让一个过期的记忆把好好的文件判成打不开。
  test("记住的表已不存在：退回第一张，不报错", async () => {
    const 键 = 缓存键("", "/p/换过.xlsx", 0)
    记上次表(键, "丁表")
    const host = 容器()
    await renderSheet(多表工作簿(), host, { 强制主线程: true, 缓存键: 键 })
    await 等条件(() => 当前表(host) === "甲表", "退回第一张表")
    expect(host.textContent).toContain("甲表数据")
  })

  // 缓存键 + 「上次看的表」：切走再打开同一个文件，应当停在用户上次看的那张表，而不是每次都回第一张。
  test("重新打开：回到上次看的那张表", async () => {
    const 键 = 缓存键("", "/p/再看.xlsx", 0)
    const bytes = 多表工作簿()
    const 第一 = 容器()
    const 卸第一 = await renderSheet(bytes, 第一, { 强制主线程: true, 缓存键: 键 })
    标签(第一)[1].click()
    await 等条件(() => 第一.textContent?.includes("乙表数据") ?? false, "第一次打开切到乙表")
    卸第一()

    const 第二 = 容器()
    const 卸第二 = await renderSheet(bytes, 第二, { 强制主线程: true, 缓存键: 键 })
    await 等条件(() => 当前表(第二) === "乙表", "重新打开停在乙表")
    expect(第二.textContent).toContain("乙表数据")
    卸第二()
  })

  test("cleanup 卸载网格", async () => {
    const host = 容器()
    const cleanup = await renderSheet(工作簿字节([["姓名"], ["张三"]]), host, { 强制主线程: true })
    expect(网格(host)).not.toBeNull()
    cleanup()
    expect(网格(host)).toBeNull()
  })
})

describe("表格视图接进通用壳", () => {
  test("读不到文件：停在 empty，不渲染表格", async () => {
    const host = mount(() => <SheetView path="/p/没.xlsx" load={async () => undefined} />)
    await 等状态(host, "empty")
    expect(网格(host)).toBeNull()
  })

  test("拿到真表格字节：网格长在视图里，状态 ready", async () => {
    const host = mount(() => (
      <SheetView path="/p/名单.xlsx" load={async () => 二进制内容(工作簿字节([["姓名"], ["张三"]]))} />
    ))
    await 等状态(host, "ready")
    expect(网格(host)).not.toBeNull()
    expect(host.textContent).toContain("张三")
  })

  test("加密的工作簿：落「需要密码」，不说文件损坏", async () => {
    const host = mount(() => <SheetView path="/p/账册.xlsx" load={async () => 二进制内容(加密工作簿())} />)
    await 等状态(host, "encrypted")
    const 降级 = host.querySelector("[data-component='degraded-view']")
    expect(降级?.getAttribute("data-reason")).toBe("encrypted")
    expect(降级?.textContent).toContain("密码")
    expect(降级?.textContent).not.toContain("损坏")
  })

  test("换项目后同相对路径不串台：重新解析并显示新项目的内容", async () => {
    // 跨项目串台的根因：键只含 path+重载代，而换项目会把重载代重置为 0（`清空会话改过`）
    // ⇒ 项目乙打开同相对路径时命中项目甲的数据缓存，且**不解析本次字节**。
    const 路径 = "/p/同名.xlsx"
    const 甲字节 = 工作簿字节([["姓名"], ["甲项目数据"]])
    const 乙字节 = 工作簿字节([["姓名"], ["乙项目数据"]])

    setCurrentProject({ id: "项目甲", name: "甲" })
    const 第一 = 容器()
    const 卸第一 = render(() => <SheetView path={路径} load={async () => 二进制内容(甲字节)} />, 第一)
    const 第二 = 容器()
    let 卸第二: (() => void) | undefined
    try {
      await 等状态(第一, "ready")
      await 等条件(() => 第一.textContent?.includes("甲项目数据") ?? false, "甲项目内容")
      // 等 onDone 把数据缓存写进去（否则第二次本就不会命中，用例会假绿）。
      await 等条件(
        () => 第一.querySelector('[data-slot="sheet-grid"]')?.getAttribute("data-loaded-rows") === "2",
        "甲项目解析完成",
      )
      await new Promise((r) => setTimeout(r, 30))

      setCurrentProject({ id: "项目乙", name: "乙" })
      卸第二 = render(() => <SheetView path={路径} load={async () => 二进制内容(乙字节)} />, 第二)
      await 等状态(第二, "ready")
      await 等条件(() => 第二.textContent?.includes("乙项目数据") ?? false, "乙项目内容")
      expect(第二.textContent).not.toContain("甲项目数据")
    } finally {
      卸第二?.()
      第一.remove()
      第二.remove()
    }
  })

  test("切走再回来：列宽从模块级缓存恢复", async () => {
    // 同一个 path 重新挂载，缓存键含当前重载代（两条都是 0）。
    const bytes = 工作簿字节([["姓名", "金额"], ["张三", "1200"]])
    const load = async () => 二进制内容(bytes)
    const 列宽串 = (host: HTMLElement) =>
      host.querySelector<HTMLElement>('[data-slot="sheet-header"]')?.style.gridTemplateColumns ?? ""
    // 首列 = 行号列 56px + 数据列（模板串以空格分隔）。
    const 首列宽 = (host: HTMLElement) => 列宽串(host).split(" ")[1]

    const 第一 = mount(() => <SheetView path="/p/缓存.xlsx" load={load} />)
    await 等状态(第一, "ready")
    const 拖拽前 = 列宽串(第一)
    // 初始列宽 = max(64, 「姓名」文本宽 26 + 16)。
    expect(首列宽(第一)).toBe("64px")

    const 拖拽 = 第一.querySelector<HTMLElement>('[data-column="0"] [data-slot="sheet-col-resize"]')!
    拖拽.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
    const 宽度 = 列宽串(第一)
    // 直接钉到预期 px：只比「两次相等」的话，拖拽接线静默失效（两次都是默认值）也会绿。
    expect(宽度).not.toBe(拖拽前)
    expect(首列宽(第一)).toBe("164px")

    // 模拟切 Tab：卸载视图
    ;[...第一.querySelectorAll<HTMLElement>("[data-component='sheet-view']")].forEach((el) => el.replaceChildren())
    // 直接重新挂载同一个 path，读缓存
    const 第二 = mount(() => <SheetView path="/p/缓存.xlsx" load={load} />)
    await 等状态(第二, "ready")
    expect(列宽串(第二)).toBe(宽度)
  })
})

/**
 * 直接考「哪句说法算加密」这条判定——**不靠夹具**。
 *
 * 为什么单独考它：加密的工作簿从字节上造得出夹具（上面那条），但 SheetJS 的**说法**有好几条，
 * 而其中几条（Numbers 走的是 IWA，不是 CFB）在本环境造不出真文件来。判定写成纯函数之后，
 * 「哪句算、哪句不算」就有了被测的清单，而不是埋在 `catch` 里口口相传。
 */
describe("认「加密的工作簿」的说法", () => {
  test("SheetJS 那几条「要密码」的说法都认（含不叫 password-protected 的那条）", () => {
    // `xlsx.mjs` 的四个抛出点：:20062（BIFF 的 FilePass）/ :20501（`/encryption` 流）
    // / :26832（ECMA-376 加密包）/ :10754（Extensible 加密）。
    expect(是加密工作簿(new Error("File is password-protected"))).toBe(true)
    expect(是加密工作簿(new Error("File is password-protected: ECMA-376 Extensible"))).toBe(true)
    // Numbers（`:25472`）说的是 "Unsupported password protection"——**不含** `password-protected`，
    // 只认那段词就会把它漏过去，落 `error`（「这个文件打不开 · 可能已经损坏」），文件却好好的。
    expect(是加密工作簿(new Error("Unsupported password protection"))).toBe(true)
    // 这条要 `opts.password` 才抛得出，我们永不传密码；认它只为「宁可知乎是加密」。
    expect(是加密工作簿(new Error("Password is incorrect"))).toBe(true)
  })

  test("别的失败不认：认错了就是把「我们读不动」说成「你的文件锁着」", () => {
    // 老 `.doc`（WordDocument 流）走的就是这条——它是「格式没接」，不是加密
    expect(是加密工作簿(new Error("Cannot find Workbook stream"))).toBe(false)
    expect(是加密工作簿(new Error("Unsupported ZIP file"))).toBe(false)
    expect(是加密工作簿(new Error("Corrupted zip : missing 4 bytes"))).toBe(false)
    // 抛出来的不一定是 Error（渲染器可能交回任何东西），非 Error 一律不算
    expect(是加密工作簿("File is password-protected")).toBe(false)
    expect(是加密工作簿(undefined)).toBe(false)
    expect(是加密工作簿(null)).toBe(false)
  })
})
