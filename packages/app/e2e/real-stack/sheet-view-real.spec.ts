import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { cpus, tmpdir, totalmem } from "os"
import path from "path"
import * as XLSX from "xlsx"

/**
 * 2026-10-18 · **中栏表格阅读器（Excel 式浏览）的真栈实测**。
 *
 * ## 为什么只能真栈量
 *
 * 粘性表头、冻结行号、拖拽跟手、虚拟滚动的几何都是**浏览器排版**的产物；happy-dom 没有
 * CSS 引擎与布局（`LEARNINGS #005-07` / `#006-33`）。同理，Worker 生命周期与 JS 堆只有真浏览器给得出。
 *
 * 本文件对应计划 Task 14 的四张表：几何、操作耗时、规模档位横幅、内存/Worker。**只记实得**，
 * 量不到的（浏览器任务管理器的进程内存）在 spec §14 里如实登记，不在本文件里伪装成已覆盖。
 *
 * ## 夹具
 *
 * 全部在 `beforeAll` 里造到 `tmpdir()`（不进仓库），并写进真内核建出的项目目录：
 * - `大表.xlsx`：50,000 数据行 × 40 列（首屏 201 行、全量档）；
 * - `超大.csv`：100,001 数据行 × 10 列（超 10 万行 ⇒ 预览档）；
 * - `两表.xlsx`：两张工作表（只显示第一张）；
 * - `小表.xlsx`：20 行 × 5 列（分屏同文件用）；
 * - `纪要.md`：切 Tab / Worker 终止用。
 *
 * 夹具按需生成（同名文件已在就不重造），生成成本 ~数秒/21MB，120s 的用例超时足够。
 */

const readStack = () => {
  const 值: unknown = JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8"))
  const kernel = 取字段(值, "kernel")
  const front = 取字段(值, "front")
  const token = 取字段(值, "token")
  if (typeof kernel !== "number" || typeof front !== "number" || typeof token !== "string") {
    throw new Error("真栈状态文件形状不对（openhive-real-stack.json）")
  }
  return { kernel, front, token }
}

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

/** 从 JSON 里取字符串字段（JSON.parse 的 `any` 不进类型断言——`no-unsafe-type-assertion` 连它都报）。 */
function 取字段(value: unknown, 键: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  return Reflect.get(value, 键)
}

async function kernelJson(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("Cookie", COOKIE())
  const res = await fetch(`${KERNEL()}${url}`, { ...init, headers })
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = 取字段(建.body, "id")
  expect(typeof id, "建项目应当回一个服务端给的 string id").toBe("string")
  if (typeof id !== "string") throw new Error("建项目没有回 id")

  const 列 = await kernelJson("/openhive/project")
  const 行 = Array.isArray(列.body) ? 列.body.find((item) => 取字段(item, "id") === id) : undefined
  const 目录 = 取字段(行, "directory")
  expect(typeof 目录, "列项目应当给出这一行的 directory").toBe("string")
  if (typeof 目录 !== "string") throw new Error("项目清单没有给出 directory")
  return { id, directory: 目录 }
}

/** PGlite `42P05` 伪影的守卫，逐字抄自 `richtext-reading-size-real.spec.ts`（理由见那份文件头）。 */
async function 等认领(page: Page): Promise<boolean> {
  try {
    await expect(page.locator("[data-slot='project-anchor-name']")).not.toHaveAttribute("data-state", "empty", {
      timeout: 20_000,
    })
    return true
  } catch {
    return false
  }
}

async function 等到认领上(page: Page) {
  let 认领上了 = false
  for (let 次 = 0; 次 <= 3 && !认领上了; 次 += 1) {
    if (次 > 0) {
      console.warn(`[真栈] 启动第 ${次} 次没认领上项目（挂具的 PGlite 42P05 伪影），重载再来一遍`)
      await page.reload()
    }
    认领上了 = await 等认领(page)
  }
  expect(
    认领上了,
    "重载 3 次仍没认领上项目 —— 真栈挂具的 PGlite 42P05 伪影（见注释），不是被测属性。重跑仍红才怀疑产品。",
  ).toBe(true)
}

const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

const 网格 = (page: Page) => page.locator("[data-slot='sheet-grid']")
const 表头 = (page: Page) => page.locator("[data-slot='sheet-header']")
const 数据行 = (page: Page) => page.locator("[data-slot='sheet-row']")

/** 把滚动容器滚到某个位置（`locator.evaluate` 的元素类型是 HTMLElement | SVGElement，这里显式收窄）。 */
const 滚到 = (page: Page, 位置: { top?: number; left?: number }) =>
  page.evaluate((位置) => {
    const element = document.querySelector("[data-slot='sheet-scroll']")
    if (!(element instanceof HTMLElement)) return
    if (位置.top !== undefined) element.scrollTop = 位置.top
    if (位置.left !== undefined) element.scrollLeft = 位置.left
  }, 位置)

const 下一帧 = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))

async function 进项目(page: Page, context: BrowserContext, id: string) {
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await 等到认领上(page)
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

async function 展开(page: Page) {
  await expect(行(page, "卷宗")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
}

/**
 * 双击打开一个文件（调用方负责先 `展开`），并等 `[data-component='sheet-view']` 出现。
 *
 * ⚠️ 大文件（表格档 >5MB）会先弹「这个文件较大」（`big-file-dialog.tsx`），不点「仍然打开」
 * 就永远等不到视图。这里等「弹窗或视图」二者先到，弹窗先到就点确认。
 *
 * 返回值是**双击到表头出现**的毫秒数；若中间有确认弹窗，时长里包含点确认的那一下，
 * 调用方打印时要说明（`LEARNINGS #006-29`：数字要带着口径说）。
 */
async function 打开表格(page: Page, 路径: string): Promise<{ 毫秒: number; 有确认弹窗: boolean }> {
  const t0 = Date.now()
  await 行(page, 路径).dblclick()
  const 确认 = page.locator("[data-slot='big-file-open']")
  const 视图 = page.locator("[data-component='sheet-view']")
  const 来源 = await Promise.race([
    确认.waitFor({ state: "visible", timeout: 8_000 }).then(() => "dialog" as const).catch(() => "timeout" as const),
    视图.waitFor({ state: "visible", timeout: 8_000 }).then(() => "view" as const).catch(() => "timeout" as const),
  ])
  if (来源 === "dialog") await 确认.click()
  await expect(视图).toBeVisible({ timeout: 30_000 })
  await expect(表头(page)).toBeVisible({ timeout: 60_000 })
  return { 毫秒: Date.now() - t0, 有确认弹窗: 来源 === "dialog" }
}

/** 等全量档的最后一个分块落地。 */
async function 等全量(page: Page) {
  await expect(网格(page)).toHaveAttribute("data-mode", "full", { timeout: 30_000 })
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const g = document.querySelector("[data-slot='sheet-grid']")
          if (!(g instanceof HTMLElement)) return Number.MAX_SAFE_INTEGER
          const 载 = g.getAttribute("data-loaded-rows")
          const 总 = g.getAttribute("data-total-rows")
          // 属性缺失时不能落进 `Number(null) - Number(null) === 0` 的假通过。
          if (载 === null || 总 === null) return Number.MAX_SAFE_INTEGER
          // 两个属性都在但都是 "0" 时，0 - 0 同样会假通过；总行数必须 > 0。
          if (Number(总) <= 0) return Number.MAX_SAFE_INTEGER
          return Number(载) - Number(总)
        }),
      { timeout: 90_000, message: "50k 行应当在全量档加载完" },
    )
    .toBe(0)
}

const 读列宽 = (page: Page) =>
  page.evaluate(() => {
    const 头 = document.querySelector("[data-slot='sheet-header']")
    if (!(头 instanceof HTMLElement)) return [] as number[]
    return getComputedStyle(头)
      .gridTemplateColumns.split(" ")
      .map((value) => Number.parseFloat(value))
  })

/** 在 `测试列`（0 起，含行号列则 +1）的右边界拖拽。返回中途/终点后的整条列宽串。 */
async function 拖列宽(page: Page, 列: number, 位移: number) {
  const 柄 = page.locator(`[data-column='${列}'] [data-slot='sheet-col-resize']`)
  const 框 = await 柄.boundingBox()
  expect(框, `第 ${列} 列应有拖拽热区`).not.toBeNull()
  const x = 框!.x + 框!.width / 2
  const y = 框!.y + 框!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 位移 / 2, y, { steps: 4 })
  const 半程 = await 读列宽(page)
  await page.mouse.move(x + 位移, y, { steps: 4 })
  await page.mouse.up()
  const 终点 = await 读列宽(page)
  return { 半程, 终点 }
}

/** 页面主线程 JS 堆（字节）。⚠️ 不含 Worker 堆 —— 这一点在 spec §14 如实登记。 */
async function 量主线程堆(context: BrowserContext, page: Page): Promise<number> {
  const cdp = await context.newCDPSession(page)
  await cdp.send("Performance.enable")
  const { metrics } = await cdp.send("Performance.getMetrics")
  const value = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? -1
  await cdp.detach()
  return value
}

/** 浏览器里所有 dedicated worker 的 URL。 */
async function 量Worker(context: BrowserContext): Promise<string[]> {
  const session = await context.browser()!.newBrowserCDPSession()
  const { targetInfos } = await session.send("Target.getTargets")
  await session.detach()
  return targetInfos.filter((target) => target.type === "worker").map((target) => target.url)
}

const 是表格Worker = (url: string) => url.includes("sheet-parse-worker")

/** 同步翻列排序；在页面里量「点击 → DOM 更新」这一段（不含 Playwright 往返）。 */
const 量排序 = (page: Page, column: number) =>
  page.evaluate((column) => {
    const 首行 = () => document.querySelector("[data-slot='sheet-row']")?.getAttribute("data-row") ?? null
    const 钮 = document.querySelector(`[data-column='${column}'] [data-slot='sheet-sort']`)
    if (!(钮 instanceof HTMLElement)) return { ms: -1, before: 首行(), after: 首行() }
    const before = 首行()
    const t0 = performance.now()
    钮.click()
    return { ms: performance.now() - t0, before, after: 首行() }
  }, column)

/** 点「应用」筛选；同样在页面里量。 */
const 量应用筛选 = (page: Page) =>
  page.evaluate(() => {
    const 行数 = () => document.querySelector("[data-slot='sheet-grid']")?.getAttribute("data-visible-rows") ?? null
    const 钮 = [...document.querySelectorAll("[data-slot='column-filter'] button")].find(
      (button) => button.textContent?.trim() === "应用",
    )
    if (!(钮 instanceof HTMLElement)) return { ms: -1, before: 行数(), after: 行数() }
    const before = 行数()
    const t0 = performance.now()
    钮.click()
    return { ms: performance.now() - t0, before, after: 行数() }
  })

const 量清除筛选 = (page: Page) =>
  page.evaluate(() => {
    const 行数 = () => document.querySelector("[data-slot='sheet-grid']")?.getAttribute("data-visible-rows") ?? null
    const 钮 = [...document.querySelectorAll("[data-slot='sheet-filter-chips'] button")].find(
      (button) => button.textContent?.trim() === "清除全部",
    )
    if (!(钮 instanceof HTMLElement)) return { ms: -1, before: 行数(), after: 行数() }
    const before = 行数()
    const t0 = performance.now()
    钮.click()
    return { ms: performance.now() - t0, before, after: 行数() }
  })

/** 输入查找词 → 计数变化。**含 150ms 去抖**（用户感知的总时延）。 */
const 量查找 = (page: Page, 词: string) =>
  page.evaluate(
    (词) =>
      new Promise<number>((resolve) => {
        const 输入 = document.querySelector("[data-slot='sheet-find-input']")
        const 计数 = document.querySelector("[data-slot='sheet-find-count']")
        if (!(输入 instanceof HTMLInputElement) || !(计数 instanceof HTMLElement)) return resolve(-1)
        const t0 = performance.now()
        const 观察 = new MutationObserver(() => {
          if ((计数.textContent ?? "").includes("共 0 个")) return
          观察.disconnect()
          resolve(performance.now() - t0)
        })
        观察.observe(计数, { childList: true, subtree: true, characterData: true })
        setTimeout(() => {
          观察.disconnect()
          resolve(-1)
        }, 5_000)
        输入.value = 词
        输入.dispatchEvent(new Event("input", { bubbles: true }))
      }),
    词,
  )

const 中位 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? -1
}

// ---------------- 夹具 ----------------

/** SheetJS 的返回类型是 `any`；先收成 `unknown` 再断言，绕开 `no-unsafe-type-assertion`。 */
function 写出(簿: XLSX.WorkBook): ArrayBuffer {
  const 输出: unknown = XLSX.write(簿, { type: "array", bookType: "xlsx" })
  if (!(输出 instanceof ArrayBuffer)) throw new Error("SheetJS 没有按 array 返回 ArrayBuffer")
  return 输出
}

function 造大表(数据行: number, 列数: number): Uint8Array {
  const 表头 = ["编号", "类别", "姓名", "金额", "日期", ...Array.from({ length: 列数 - 5 }, (_, i) => `列${i + 6}`)]
  const 表: unknown[][] = [表头]
  for (let i = 0; i < 数据行; i += 1) {
    const 行数据: unknown[] = [数据行 - i, `类别${i % 5}`, `姓名${i}`, i * 1.5, new Date(2026, 0, 1 + (i % 365))]
    for (let c = 5; c < 列数; c += 1) 行数据.push(`列${c + 1}行${i}`)
    表.push(行数据)
  }
  const 簿 = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(簿, XLSX.utils.aoa_to_sheet(表), "明细")
  return new Uint8Array(写出(簿))
}

function 造大CSV(数据行: number): string {
  const 行: string[] = ["列1,列2,列3,列4,列5,列6,列7,列8,列9,列10"]
  for (let i = 0; i < 数据行; i += 1) {
    行.push(`姓名${i},${i},2026-10-01,备注${i},城市${i % 10},ID${i},正常,类型${i % 3},部门${i % 6},13800000000`)
  }
  return 行.join("\n")
}

function 造小表(数据行: number): Uint8Array {
  const 表: unknown[][] = [["编号", "姓名", "金额", "城市", "备注"]]
  for (let i = 0; i < 数据行; i += 1) 表.push([i + 1, `姓名${i}`, i * 12.5, `城市${i % 3}`, `备注${i}`])
  const 簿 = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(簿, XLSX.utils.aoa_to_sheet(表), "小表")
  return new Uint8Array(写出(簿))
}

function 造两表(): Uint8Array {
  const 簿 = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    簿,
    XLSX.utils.aoa_to_sheet([
      ["姓名", "金额"],
      ["张三", 100],
      ["李四", 200],
    ]),
    "第一张",
  )
  XLSX.utils.book_append_sheet(簿, XLSX.utils.aoa_to_sheet([["不该显示"], ["第二张的数据"]]), "第二张")
  return new Uint8Array(写出(簿))
}

/**
 * 造一份夹具（同参数文件已存在就复用）；返回写盘后的绝对路径。
 * `指纹` 把生成参数写进缓存名——改了行数/列数就不会静默复用旧夹具。
 */
function 备夹具(目录: string, 名字: string, 指纹: string, 造: () => string | Uint8Array): string {
  const 文件 = path.join(tmpdir(), `openhive-sheet-real-${名字}-${指纹}`)
  try {
    readFileSync(文件)
  } catch {
    writeFileSync(文件, 造())
  }
  const 目标 = path.join(目录, 名字)
  writeFileSync(目标, readFileSync(文件))
  return 目标
}

let 项目: { id: string; directory: string }
let 机器 = ""

test.beforeAll(async () => {
  项目 = await 建真项目(`表格真栈·${Date.now()}`)
  const 目录 = path.join(项目.directory, "卷宗")
  mkdirSync(目录, { recursive: true })

  备夹具(目录, "大表.xlsx", "50000x40", () => 造大表(50_000, 40))
  备夹具(目录, "超大.csv", "100001", () => 造大CSV(100_001))
  备夹具(目录, "两表.xlsx", "2sheets", 造两表)
  备夹具(目录, "小表.xlsx", "20rows", () => 造小表(20))
  writeFileSync(path.join(目录, "纪要.md"), "# 纪要\n\n第一行\n")

  机器 = `${cpus()[0]?.model ?? "未知 CPU"} × ${cpus().length} / 内存 ${Math.round(totalmem() / 1024 ** 3)} GB / ${process.platform}`
  console.log(`[实测] 机器：${机器}`)
})

// ---------------- 用例 ----------------

test("5万行×40列：首屏、前 200 行、粘性表头、冻结行号", async ({ page, context }) => {
  await 进项目(page, context, 项目.id)
  await 展开(page)

  const 首屏 = await 打开表格(page, "卷宗/大表.xlsx")
  console.log(
    `[实测] 首屏（双击${首屏.有确认弹窗 ? "、点「仍然打开」" : ""} → 表头出现，含取 21MB 字节）：${首屏.毫秒} ms`,
  )

  await expect
    .poll(async () => Number(await 网格(page).getAttribute("data-loaded-rows")), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(201)
  await expect(网格(page)).toHaveAttribute("data-mode", "full")
  await expect(数据行(page).first()).toBeVisible()
  console.log(
    `[实测] 表头出现后已载行数：${await 网格(page).getAttribute("data-loaded-rows")}（首屏档目标为表头 + 前 200 数据行 = 201）`,
  )

  // 纵向滚 500 行：表头还在容器顶部。
  // ⚠️ 必须等第二个分块落地：虚拟列表的总高度按**已载行数**算，首屏 200 行时最大滚动量
  // 只有 ~5000px（实测 4973），设 14000 会被浏览器夹到上限——那是数据没到，不是滚动坏了。
  await expect
    .poll(async () => Number(await 网格(page).getAttribute("data-loaded-rows")), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(600)
  await 滚到(page, { top: 500 * 28 })
  await 下一帧(page)

  // 虚拟滚动的**本质**是「渲染窗口跟着滚动位置前移」；只断 `scrollTop` 变没变，浏览器里行
  // 仍钉在 1–30 也会全绿（2026-10-19 实测：41578 行全载、滚动条全长，但首行永远是 1）。
  // 等条件不等时间：滚到第 500 个数据行后，渲染窗口里必须出现 `data-row=501`。
  // ⚠️ 用一条属性选择器直接找行；`数据行(page).locator("[data-row='501']")` 找的是行的**后代**，
  // 永远为 0（一次假红，2026-10-19 实得窗口 493–532 却 count=0）。
  await expect
    .poll(async () => page.locator("[data-slot='sheet-row'][data-row='501']").count(), { timeout: 5_000 })
    .toBeGreaterThan(0)
  const 滚后窗口 = await page.evaluate(() => {
    const 行们 = [...document.querySelectorAll("[data-slot='sheet-row']")]
    return { 首: 行们[0]?.getAttribute("data-row") ?? null, 数: 行们.length }
  })
  expect(滚后窗口.数, `虚拟滚动应只渲染窗口内的行，实得 ${滚后窗口.数} 行`).toBeLessThan(100)
  console.log(`[实测] 滚到第 500 个数据行后：首行 data-row=${滚后窗口.首}，渲染 ${滚后窗口.数} 行`)

  // 拖选两行两列 → dragstart 写出的 `text/plain` 必须是一行数据一条（字段用制表符）。
  // 用**真浏览器 Range** 造选区：happy-dom 造不出真实 `intersectsNode`，组件测试只能垫假 Range，
  // 矩形推导的真语义只有真栈能验。`DataTransfer` 也是真实例，读到的就是右栏会收到的载荷。
  const 拖拽载荷 = await page.evaluate(() => {
    const 行们 = [...document.querySelectorAll("[data-slot='sheet-row']")]
    const 首行 = 行们[0]
    const 次行 = 行们[1]
    if (!(首行 instanceof HTMLElement) || !(次行 instanceof HTMLElement)) return null
    const 格 = (row: HTMLElement, col: number) => row.querySelector<HTMLElement>(`[role='gridcell'][data-col='${col}']`)
    const 起 = 格(首行, 0)
    const 止 = 格(次行, 1)
    if (!起 || !止) return null
    const range = document.createRange()
    range.setStart(起.firstChild ?? 起, 0)
    range.setEnd(止.firstChild ?? 止, 止.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const 载荷 = new DataTransfer()
    document
      .querySelector("[data-slot='sheet-scroll']")
      ?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: 载荷 }))
    return 载荷.getData("text/plain")
  })
  expect(拖拽载荷, "dragstart 应写出 text/plain 载荷").not.toBeNull()
  const 载荷行 = 拖拽载荷!.split("\n")
  // 表头行 + 两条数据：模型靠第一行知道每个字段是什么。
  expect(载荷行, `拖拽载荷应为「表头 + 两行数据」，实得 ${JSON.stringify(拖拽载荷)}`).toHaveLength(3)
  expect(载荷行[0], "第一行应是所选两列的字段名").toBe("编号\t类别")
  for (const line of 载荷行) expect(line.split("\t"), `字段应以制表符分隔，实得 ${JSON.stringify(line)}`).toHaveLength(2)
  console.log(`[实测] 拖选两行两列的 text/plain 载荷（含表头）：${JSON.stringify(拖拽载荷)}`)

  const 竖向 = await page.evaluate(() => {
    const 滚 = document.querySelector("[data-slot='sheet-scroll']")
    const 头 = document.querySelector("[data-slot='sheet-header']")
    if (!(滚 instanceof HTMLElement) || !(头 instanceof HTMLElement)) return null
    const 滚框 = 滚.getBoundingClientRect()
    return { scrollTop: 滚.scrollTop, 滚顶: 滚框.top, 头顶: 头.getBoundingClientRect().top }
  })
  expect(竖向, "应当有滚动容器与表头").not.toBeNull()
  expect(竖向!.scrollTop, "纵向应真的滚了 500 行").toBe(500 * 28)
  expect(Math.abs(竖向!.头顶 - 竖向!.滚顶), `表头没有粘在顶部（表头顶 ${竖向!.头顶} / 容器顶 ${竖向!.滚顶}）`).toBeLessThanOrEqual(1)
  console.log(`[实测] 纵向滚 500 行后：表头顶 ${竖向!.头顶}，容器顶 ${竖向!.滚顶}`)

  // 横向滚到最右：行号列还在左侧。
  await page.evaluate(() => {
    const element = document.querySelector("[data-slot='sheet-scroll']")
    if (element instanceof HTMLElement) element.scrollLeft = element.scrollWidth
  })
  await 下一帧(page)
  const 横向 = await page.evaluate(() => {
    const 滚 = document.querySelector("[data-slot='sheet-scroll']")
    const 号 = document.querySelector("[data-slot='sheet-row'] [role='rowheader']")
    if (!(滚 instanceof HTMLElement) || !(号 instanceof HTMLElement)) return null
    const 滚框 = 滚.getBoundingClientRect()
    return { scrollLeft: 滚.scrollLeft, 滚左: 滚框.left, 号左: 号.getBoundingClientRect().left }
  })
  expect(横向, "应当有滚动容器与行号列").not.toBeNull()
  expect(横向!.scrollLeft, "横向应真的滚到最右").toBeGreaterThan(500)
  expect(横向!.号左 - 横向!.滚左, `行号列没有冻结（行号左 ${横向!.号左} / 容器左 ${横向!.滚左}）`).toBeLessThanOrEqual(1)
  console.log(`[实测] 横向滚 ${横向!.scrollLeft}px 后：行号左 ${横向!.号左}，容器左 ${横向!.滚左}`)
})

test("5万行×40列：列宽拖拽跟手、双击自适应", async ({ page, context }) => {
  await 进项目(page, context, 项目.id)
  await 展开(page)
  await 打开表格(page, "卷宗/大表.xlsx")
  await expect(数据行(page).first()).toBeVisible()

  const 前 = await 读列宽(page)
  expect(前.length, "表头的 grid-template-columns 应能解析出行号 + 40 列").toBe(41)

  // 拖 5 列（计划要求 5 列），每列拖完立刻双击自适应复原：
  // 既保证后续列的拖拽热区仍在视口内（累加 +500px 会把它推出右边界），
  // 也用同一列自己的初始估算宽做「回内容宽」判据（计划要求 ≥3 个边界）。
  const 拖后宽: number[] = []
  const 自适应宽: number[] = []
  for (let 列 = 1; 列 <= 5; 列 += 1) {
    const 起始宽 = (await 读列宽(page))[列 + 1]
    const { 半程, 终点 } = await 拖列宽(page, 列, 100)
    expect(Math.abs(半程[列 + 1] - 起始宽 - 50), `第 ${列} 列拖到一半应跟手 +50（起始 ${起始宽} → 半程 ${半程[列 + 1]}）`).toBeLessThanOrEqual(1)
    expect(Math.abs(终点[列 + 1] - 起始宽 - 100), `第 ${列} 列拖完应 +100（起始 ${起始宽} → 终点 ${终点[列 + 1]}）`).toBeLessThanOrEqual(1)
    拖后宽.push(终点[列 + 1])

    await page.locator(`[data-column='${列}'] [data-slot='sheet-col-resize']`).dblclick()
    const 宽 = (await 读列宽(page))[列 + 1]
    expect(Math.abs(宽 - 起始宽), `第 ${列} 列双击应回内容宽（拖后 ${终点[列 + 1]} → 自适应 ${宽}；初始估算 ${起始宽}）`).toBeLessThanOrEqual(1)
    自适应宽.push(宽)
  }
  console.log(`[实测] 列宽拖拽（5 列，各 +100px）：${自适应宽.map((v, i) => `${v}→${拖后宽[i]}→${v}px`).join(" / ")}`)
})

test("5万行×40列：排序/筛选/查找耗时与主线程 JS 堆；切走 Worker 终止", async ({ page, context }) => {
  await 进项目(page, context, 项目.id)
  await 展开(page)

  // 先开一篇 md，留一张可切的 Tab。
  await 行(page, "卷宗/纪要.md").dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })

  const 开表前堆 = await 量主线程堆(context, page)
  const 开表前Worker = (await 量Worker(context)).filter(是表格Worker)
  expect(开表前Worker, "打开表格前不应有表格 Worker").toHaveLength(0)

  await 打开表格(page, "卷宗/大表.xlsx")
  await 等全量(page)

  const 全量后堆 = await 量主线程堆(context, page)
  console.log(
    `[实测] 主线程 JS 堆：开表前 ${(开表前堆 / 1024 ** 2).toFixed(1)} MB → 全量后 ${(全量后堆 / 1024 ** 2).toFixed(1)} MB` +
      `（增量 ${((全量后堆 - 开表前堆) / 1024 ** 2).toFixed(1)} MB；不含 Worker 堆）`,
  )

  // Worker 在解析完成后仍然存活（要等切走才终止）。
  const 开表后Worker = (await 量Worker(context)).filter(是表格Worker)
  // 开表前已断言为 0；全量后必须恰好 1 个——2 个意味着 dev 双重挂载（LEARNINGS #006-39）。
  expect(开表后Worker.length, "解析完成后表格 Worker 应仍存活且只有 1 个（由 view cleanup 终止）").toBe(1)
  console.log(`[实测] 表格打开且全量解析完毕后，dedicated worker 数：${开表后Worker.length}`)

  // 排序是「降 → 升 → 取消」三态循环：前两次各量一次；第 3 次量之前先空点
  // 两次（取消 + 落定一个方向），使被计量的那一次是在两个方向间切换——
  // 首行必然变化。否则第 3 次点到的可能是「取消」，首行与原始顺序相同。
  const 排序耗时: number[] = []
  for (let 次 = 0; 次 < 3; 次 += 1) {
    if (次 === 2) {
      await 量排序(page, 0)
      await 量排序(page, 0)
    }
    const 结果 = await 量排序(page, 0)
    expect(结果.ms, `第 ${次 + 1} 次排序应当量到耗时`).toBeGreaterThanOrEqual(0)
    expect(结果.after, `第 ${次 + 1} 次排序后首行应当变化（点击前 ${结果.before}）`).not.toBe(结果.before)
    排序耗时.push(结果.ms)
  }
  console.log(`[实测] 排序 3 次（点击 → DOM 更新）：${排序耗时.map((v) => v.toFixed(1)).join(" / ")} ms，中位 ${中位(排序耗时).toFixed(1)} ms`)

  // 筛选：类别列（5 个值 → 选中 1 个应剩 10,000 行）。
  const 筛选耗时: number[] = []
  const 清除耗时: number[] = []
  for (let 次 = 0; 次 < 3; 次 += 1) {
    await page.locator("[data-column='1'] [data-slot='sheet-col-filter']").click()
    await expect(page.locator("[data-slot='column-filter']")).toBeVisible()
    await page.locator("[data-slot='column-filter'] input[type='checkbox']").first().check()
    const 应用 = await 量应用筛选(page)
    expect(应用.ms, `第 ${次 + 1} 次筛选应当量到耗时`).toBeGreaterThanOrEqual(0)
    expect(应用.after, `第 ${次 + 1} 次筛选后可见行应减少`).not.toBe(应用.before)
    expect(Number(应用.after), "选中一个类别应剩 10,000 行").toBe(10_000)
    筛选耗时.push(应用.ms)

    const 清除 = await 量清除筛选(page)
    expect(清除.ms, `第 ${次 + 1} 次清除筛选应当量到耗时`).toBeGreaterThanOrEqual(0)
    expect(Number(清除.after), "清除筛选后应恢复 50,000 行").toBe(50_000)
    清除耗时.push(清除.ms)
  }
  console.log(
    `[实测] 筛选应用 3 次：${筛选耗时.map((v) => v.toFixed(1)).join(" / ")} ms，中位 ${中位(筛选耗时).toFixed(1)} ms；` +
      `清除 3 次中位 ${中位(清除耗时).toFixed(1)} ms`,
  )

  // 查找（含 150ms 去抖）。
  await page.locator("[data-slot='sheet-find-trigger']").click()
  await expect(page.locator("[data-slot='sheet-find-input']")).toBeVisible()
  const 查找耗时: number[] = []
  for (const 词 of ["姓名49999", "姓名4999", "类别0"]) {
    const ms = await 量查找(page, 词)
    expect(ms, `查找「${词}」应当量到耗时`).toBeGreaterThanOrEqual(0)
    查找耗时.push(ms)
  }
  console.log(
    `[实测] 查找 3 次（含 150ms 去抖）：${查找耗时.map((v) => v.toFixed(1)).join(" / ")} ms，中位 ${中位(查找耗时).toFixed(1)} ms`,
  )

  // 切到 md：表格视图卸载 ⇒ cleanup 终止 Worker。
  await page.locator("[data-slot='tab']", { hasText: "纪要.md" }).click()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(async () => (await 量Worker(context)).filter(是表格Worker).length, {
      timeout: 15_000,
      message: "切走之后表格 Worker 应当被终止（renderSheet cleanup → 任务.cancel）",
    })
    .toBe(0)
  console.log("[实测] 切到 md 后表格 Worker 数：0")
})

test("解析期间可滚动，切走再回来还能打开", async ({ page, context }) => {
  await 进项目(page, context, 项目.id)
  await 展开(page)

  await 行(page, "卷宗/纪要.md").dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })

  await 打开表格(page, "卷宗/大表.xlsx")
  const 解析中 = await page.evaluate(() => {
    const g = document.querySelector("[data-slot='sheet-grid']")
    const 进度 = document.querySelector("[data-slot='sheet-progress']")
    return {
      载入: g?.getAttribute("data-loaded-rows") ?? null,
      总数: g?.getAttribute("data-total-rows") ?? null,
      有进度横幅: 进度 !== null,
    }
  })
  console.log(
    `[实测] 表头出现时：已载 ${解析中.载入} / 共 ${解析中.总数}，进度横幅${解析中.有进度横幅 ? "在" : "已消失（首屏后解析已结束，未捕捉到解析中窗口）"}`,
  )

  // 滚动断言必须发生在解析进行中：进度横幅只在 loadedRows < totalRows 时渲染。
  const 进度横幅 = page.locator("[data-slot='sheet-progress']")
  await expect(进度横幅, "进度横幅应当可见——否则下面的滚动测的是「加载后」").toBeVisible()
  expect(Number(解析中.载入), "滚动时必须仍在解析中（已载 < 总数）").toBeLessThan(Number(解析中.总数))

  // 解析期间滚动列表（早于全量完成也应响应）。
  await 滚到(page, { top: 2_000 })
  await 下一帧(page)
  const 滚动后 = await page.evaluate(() => {
    const element = document.querySelector("[data-slot='sheet-scroll']")
    return element instanceof HTMLElement ? element.scrollTop : -1
  })
  expect(滚动后, "解析期间滚动应当生效").toBe(2_000)
  await expect(进度横幅, "滚动检查期间解析应仍未结束").toBeVisible()
  console.log("[实测] 解析期间滚动 2000px：生效（滚动前后进度横幅均在）")

  // 滚动位置恢复（spec §8.1）：等分块够长（≥600 行，可滚范围 > 14000）后滚到 14000，
  // 切走再切回，等全量落地后应原位恢复——首屏只有 201 行时不能把钳位后的值写回缓存。
  await expect
    .poll(async () => Number(await 网格(page).getAttribute("data-loaded-rows")), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(600)
  await 滚到(page, { top: 14_000 })
  await 下一帧(page)
  const 切走前位置 = await page.evaluate(() => {
    const element = document.querySelector("[data-slot='sheet-scroll']")
    return element instanceof HTMLElement ? element.scrollTop : -1
  })
  expect(切走前位置, "切走前应真的滚到 14000").toBe(14_000)
  console.log(`[实测] 切走前滚动位置：${切走前位置}px（已载 ≥600 行）`)

  // 切走（卸载并 cancel 解析），再切回来（重新解析）仍能打开。
  await page.locator("[data-slot='tab']", { hasText: "纪要.md" }).click()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 15_000 })
  await page.locator("[data-slot='tab']", { hasText: "大表.xlsx" }).click()
  await expect(表头(page)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator("[data-slot='sheet-parse-error']")).toHaveCount(0)
  await 等全量(page)
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const element = document.querySelector("[data-slot='sheet-scroll']")
          return element instanceof HTMLElement ? Math.abs(element.scrollTop - 14_000) : Number.MAX_SAFE_INTEGER
        }),
      { timeout: 30_000, message: "切回后应恢复到切走前的 14000px（容差 ±1）" },
    )
    .toBeLessThanOrEqual(1)
  const 切回后位置 = await page.evaluate(() => {
    const element = document.querySelector("[data-slot='sheet-scroll']")
    return element instanceof HTMLElement ? element.scrollTop : -1
  })
  expect(Math.abs(切回后位置 - 14_000), `切回后滚动位置应恢复（实得 ${切回后位置}）`).toBeLessThanOrEqual(1)
  console.log(`[实测] 切走再切回：全量后滚动位置恢复为 ${切回后位置}px（目标 14000，容差 ±1），无解析错误横幅`)
})

test("10万+ 行 CSV：预览档横幅写明总数与截断范围", async ({ page, context }) => {
  await 进项目(page, context, 项目.id)
  await 展开(page)
  const 打开 = await 打开表格(page, "卷宗/超大.csv")
  console.log(
    `[实测] 10 万行 CSV（预览档）双击→表头出现：${打开.毫秒} ms` +
      `（${打开.有确认弹窗 ? "含点「仍然打开」与" : "含"}取字节；按设计只物化 1001 行，不做全量解析）`,
  )

  const 网格属性 = await 网格(page).evaluate((element) => ({
    mode: element.getAttribute("data-mode"),
    loaded: Number(element.getAttribute("data-loaded-rows")),
    visible: Number(element.getAttribute("data-visible-rows")),
    total: Number(element.getAttribute("data-total-rows")),
  }))
  expect(网格属性.mode, "超过 10 万行应落预览档").toBe("preview")
  expect(网格属性.total, "原表行数应超过 10 万").toBeGreaterThan(100_000)
  expect(网格属性.loaded, "预览档只物化 1001 行（表头 + 1000 数据行）").toBe(1_001)
  expect(网格属性.visible, "预览档显示 1000 数据行").toBe(1_000)

  const 横幅 = page.locator("[data-slot='sheet-preview-banner']")
  await expect(横幅).toBeVisible()
  await expect(横幅).toContainText("前 1000 行")
  await expect(横幅).toContainText(`原表共 ${网格属性.total} 行`)
  console.log(`[实测] 预览档横幅：「${(await 横幅.textContent())?.trim()}」`)
})

test("两张工作表：只显示第一张，并写明共 2 张表", async ({ page, context }) => {
  await 进项目(page, context, 项目.id)
  await 展开(page)
  await 打开表格(page, "卷宗/两表.xlsx")

  const 横幅 = page.locator("[data-slot='sheet-multi-sheet']")
  await expect(横幅).toBeVisible()
  await expect(横幅).toContainText("共 2 张表")
  await expect(横幅).toContainText("第一张")
  await expect(page.locator("[data-slot='sheet-grid']")).toContainText("张三")
  await expect(page.locator("[data-slot='sheet-grid']")).not.toContainText("第二张的数据")
  console.log(`[实测] 多表横幅：「${(await 横幅.textContent())?.trim()}」`)
})

test("分屏同文件：右栏挂载时继承列宽，之后不实时同步", async ({ page, context }) => {
  await 进项目(page, context, 项目.id)
  await 展开(page)
  await 打开表格(page, "卷宗/小表.xlsx")

  const 读两栏 = () =>
    page.evaluate(() => {
      const 读 = (pane: string) => {
        const 头 = document.querySelector(`[data-pane='${pane}'] [data-slot='sheet-header']`)
        if (!(头 instanceof HTMLElement)) return null
        return getComputedStyle(头).gridTemplateColumns
      }
      return { 左: 读("0"), 右: 读("1") }
    })

  // 先在左栏改列宽，再分屏打开同一文件：右栏应读到当时的缓存状态。
  // ⚠️ 必须先钉住「拖拽真的改变了左栏」——否则右栏即使没继承缓存，
  // 只要两栏都停在默认宽度，`挂载后.右 === 拖后左.左` 也会空转通过。
  const 拖前左 = await 读两栏()
  const 柄 = page.locator("[data-pane='0'] [data-column='0'] [data-slot='sheet-col-resize']")
  const 框 = await 柄.boundingBox()
  expect(框, "左栏第 0 列应有拖拽热区").not.toBeNull()
  await page.mouse.move(框!.x + 框!.width / 2, 框!.y + 框!.height / 2)
  await page.mouse.down()
  await page.mouse.move(框!.x + 框!.width / 2 + 120, 框!.y + 框!.height / 2, { steps: 6 })
  await page.mouse.up()
  const 拖后左 = await 读两栏()
  expect(拖后左.左, "第一次拖拽必须真的改变左栏列宽（否则继承判据会空转）").not.toBe(拖前左.左)

  await page.locator("[data-slot='split-button']").click()
  await page.locator("[data-slot='split-menu-item'][data-split='左右']").click()
  const 右栏 = page.locator("[data-slot='center-pane'][data-pane='1']")
  await expect(右栏).toBeVisible()
  await 右栏.click()
  await 行(page, "卷宗/小表.xlsx").dblclick()
  await expect(page.locator("[data-pane='0'] [data-slot='sheet-header']")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-pane='1'] [data-slot='sheet-header']")).toBeVisible({ timeout: 30_000 })
  const 挂载后 = await 读两栏()
  expect(挂载后.左, "分屏后左栏应保持拖后的列宽").toBe(拖后左.左)
  expect(挂载后.右, "右栏挂载时应继承左栏已保存的列宽（§8.1 共享缓存条目）").toBe(拖后左.左)
  console.log(
    `[实测] 分屏同文件：拖前左「${拖前左.左}」→ 拖后左「${拖后左.左}」；` +
      `分屏后左「${挂载后.左}」右「${挂载后.右}」`,
  )

  // 两栏都挂载后再拖左栏：右栏不跟随（共享是「挂载时读取」，不是实时同步）。
  const 柄2 = page.locator("[data-pane='0'] [data-column='0'] [data-slot='sheet-col-resize']")
  const 框2 = await 柄2.boundingBox()
  expect(框2, "左栏第 0 列应仍有拖拽热区").not.toBeNull()
  await page.mouse.move(框2!.x + 框2!.width / 2, 框2!.y + 框2!.height / 2)
  await page.mouse.down()
  await page.mouse.move(框2!.x + 框2!.width / 2 + 60, 框2!.y + 框2!.height / 2, { steps: 4 })
  await page.mouse.up()
  const 再拖后 = await 读两栏()
  expect(再拖后.左, "左栏自身应当再次变化").not.toBe(挂载后.左)
  expect(再拖后.右, "右栏不应跟随左栏实时变化").toBe(挂载后.右)
  console.log(`[实测] 再次拖左栏后：左「${再拖后.左}」右「${再拖后.右}」（右栏未跟随）`)
})
