import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-14 · **中栏选中一段内容，发给右栏 AI 会话**（用户实报：想把手头的表格 / 文档里的一段
 * 直接丢给 AI 问问）。两条已接好的生产路径（Task 3 / Task 4）：
 *
 * ① **拖**：中栏拖选一段（表格 / 正文）⇒ 松在右栏输入框 ⇒ 当正文插进去（`send-to-session.ts` 的
 *    `发送到会话`，载荷走 `dataTransfer` 的 `text/plain`，`session-panel.tsx` 的 `onDrop` 接线）；
 * ② **右键**：中栏选中一段 ⇒ 右键 ⇒ 我们的菜单出现 ⇒ 点「发送到会话」⇒ 文本进输入框
 *    （`center/content-menu.tsx` 的 `ContextMenu`，读 `window.getSelection()`）。
 *
 * 另钉一条**对照**：没选中时右键 ⇒ 我们的菜单**不出现**（**我们不接管**——我们没拦原生菜单，
 * 「复制」那份不该被我们吞，`LEARNINGS #006-32` 那条底线）。本用例**只**量我们的菜单不出现；
 * 「原生菜单照出」是从 Kobalte 源码推出的（Task 4 已核），**本 spec 未直接量**。
 *
 * ## 为什么这一份落在真栈、而组件层（`session-panel.test.tsx` / `content-menu.test.tsx`）盖不住
 *
 * 三层测试各钉自己那一段，接缝只在真栈量得到：
 * - **原生选区**：`window.getSelection()` 只在真浏览器里是真选区，happy-dom 那份是替身；
 * - **原生拖拽**：`dataTransfer` 的 `text/plain` 是浏览器在 `dragstart` 前填好的，只有真拖给得出
 *   制表符分隔的表格原文（`"张三\t1200\r\n…"`）；
 * - **焦点归位**：点完菜单项之后、不许先 `click()` 输入框、直接裸键盘接着打字——这量的是
 *   `controller.restoreFocus()` 有没有把焦点放回编辑器，组件层只能断 `document.activeElement`
 *   的代理值（`#005-17`：`.type()` 自己会聚焦，判别力为零）。
 *
 * ## ⚠️ dev 挂具的双重挂载：两条插入用例标 `test.fixme`（不是 skip、不删）
 *
 * 真栈的 Vite 起的是 **dev server**，`vite-plugin-solid`（serve 模式）把 `solid-js` 解析到
 * `dist/dev.js`，其中 `devComponent` 给**每个**组件（含局部的 `右栏主体`）包一层
 * `createComputation(() => untrack(...))`，导出组件再叠一层 `@solid-refresh` 的 `HMRComp`。
 * `ready()` 在 serverSync 数据落定那一刻**同目录重算一次**（`data` 引用变了、目录字符串不变）
 * ⇒ dev 下 `SessionPanel` **挂载两次**，第二次的 `订阅会话输入` 把模块级收件口盖成**孤儿 store
 * 的闭包**（收件口是 last-writer-wins 的模块级槽：`send-to-session.ts:31` 定义、`:47` 赋值；
 * 订阅处 `session-panel.tsx:583-587`），可见编辑器读的是第一个 store ⇒ `发送到会话` 落在
 * 孤儿 store 上、输入框一个字不插。
 * 这两条插入判据（拖 / 右键）在 dev 挂具下**恒红**——红的不是产品、是挂具伪影
 * （`LEARNINGS #005-41`：伪影是「故障来源不真」，不是「产品行为不用管」）⇒ 标 `test.fixme`
 * 入库，等 dev 双挂载被修掉、或挂具生产化之后转绿。
 *
 * ⚠️ **生产 build 未验，是未闭合开口**：生产 `solid.js` 的 `createComponent = untrack(() =>
 * Comp(props))` 无 dev 包装、组件只跑一次（源码读实），组件层测试（`bun test` 走生产 solid.js）
 * 全绿是旁证——但**没有真跑过生产 build 的 e2e**，那条链在生产里通不通，本文件不写成已覆盖。
 *
 * 真栈里**已证到、且照跑照绿**的：右键菜单出现、「发送到会话」项点得动、**没选中右键菜单
 * 不出现**（对照那条）、两层 `display: contents` 未动布局（Step 5 的几何 spec）。
 */

/**
 * 从一个 JSON 值里取顶层的字段（原样，不做类型判断；不是对象就 `undefined`）。
 * 整段照 `center-session-edit-real.spec.ts`（`LEARNINGS #004-12`）。
 */
function 取字段(值: unknown, 名: string): unknown {
  if (typeof 值 !== "object" || 值 === null) return undefined
  for (const [键, 字段] of Object.entries(值)) if (键 === 名) return 字段
  return undefined
}

function readStack() {
  const 值: unknown = JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8"))
  const 要数 = (名: string) => {
    const 字段 = 取字段(值, 名)
    if (typeof 字段 !== "number") throw new Error(`真栈状态文件里的 ${名} 不是数字`)
    return 字段
  }
  const token = 取字段(值, "token")
  if (typeof token !== "string") throw new Error("真栈状态文件里没有 token")
  return { kernel: 要数("kernel"), front: 要数("front"), token }
}

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

async function kernelJson(
  url: string,
  init: RequestInit = {},
  额外头: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...额外头 },
  })
  const 体: unknown = res.ok ? await res.json() : await res.text()
  return { status: res.status, body: 体 }
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson(
    "/openhive/project",
    { method: "POST", body: JSON.stringify({ name: 名, type: "private" }) },
    { "content-type": "application/json" },
  )
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = 取字段(建.body, "id")
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()
  if (typeof id !== "string") throw new Error("建项目回的 id 不是字符串")

  const 列 = await kernelJson("/openhive/project")
  const 表: unknown[] = Array.isArray(列.body) ? 列.body : []
  const 目录 = 表
    .map((行) => (取字段(行, "id") === id ? 取字段(行, "directory") : undefined))
    .find((x): x is string => typeof x === "string")
  expect(目录, "列项目应当给出这一行的 directory").toBeTruthy()
  if (typeof 目录 !== "string") throw new Error("列项目没给出这一行的 directory")
  return { id, directory: 目录 }
}

/** 等「当前项目被认领」（`data-state` 离开 `empty`），挡的是挂具 PGlite 42P05 伪影。 */
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

  let 认领上了 = false
  for (let 次 = 0; 次 <= 3 && !认领上了; 次 += 1) {
    if (次 > 0) {
      console.warn(`[真栈] 启动第 ${次} 次没认领上项目（挂具的 PGlite 42P05 伪影），重载再来一遍`)
      await page.reload()
    }
    认领上了 = await 等认领(page)
  }
  expect(认领上了, "重载 3 次仍没认领上项目 —— 挂具 PGlite 42P05 伪影，重跑").toBe(true)

  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

/** 树上一行。 */
const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/** 右栏输入框（contenteditable）。 */
const 右栏输入 = (page: Page) => page.locator("[data-slot='session-hero'] [data-component='prompt-input']")

/** 表格某一格（`sheet-view` 渲出来的 `<td>`）。 */
const 格 = (page: Page, 行序: number, 列序: number) =>
  page.locator("[data-component='sheet-view'] table tr").nth(行序).locator("td").nth(列序)

/**
 * 备一个项目、一篇 CSV（`姓名,金额 / 张三,1200 / 李四,880`），在中栏打开成表格，
 * 再把右栏会话框开出来（左栏会话 tab → 新建）。
 */
async function 开表格加右栏(page: Page, context: BrowserContext, 项目名: string) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "资料")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, "资金.csv"), "姓名,金额\r\n张三,1200\r\n李四,880\r\n", "utf8")

  await 进项目(page, context, 甲.id)
  // ⚠️ 顺序不能换：`expand-all` 要等树先落到 DOM 上才有东西可展开。
  await expect(行(page, "资料")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "资料/资金.csv")).toBeVisible({ timeout: 30_000 })
  await 行(page, "资料/资金.csv").dblclick()
  await expect(page.locator("[data-component='sheet-view']")).toBeVisible({ timeout: 30_000 })

  // 右栏会话框（走左栏那颗钮，客户端导航，不整页重载）。
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()
  await page.locator("[data-slot='session-new']").click()
  await expect(右栏输入(page)).toBeVisible({ timeout: 30_000 })
}

/** 只开表格（对照那条用：不需要右栏）。 */
async function 开表格(page: Page, context: BrowserContext, 项目名: string) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "资料")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, "资金.csv"), "姓名,金额\r\n张三,1200\r\n李四,880\r\n", "utf8")

  await 进项目(page, context, 甲.id)
  await expect(行(page, "资料")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "资料/资金.csv")).toBeVisible({ timeout: 30_000 })
  await 行(page, "资料/资金.csv").dblclick()
  await expect(page.locator("[data-component='sheet-view']")).toBeVisible({ timeout: 30_000 })
}

/** 裸指针从第一格拖到最后一格，把整张表选上（`#005-30`：不走 `locator.dragTo`，那会卡在 actionability）。 */
async function 拖选表格(page: Page) {
  const 第一 = await 格(page, 0, 0).boundingBox()
  const 末 = await 格(page, 2, 1).boundingBox()
  if (!第一 || !末) throw new Error("表格没有盒")
  await page.mouse.move(第一.x + 2, 第一.y + 第一.height / 2)
  await page.mouse.down()
  await page.mouse.move(末.x + 末.width - 2, 末.y + 末.height / 2, { steps: 12 })
  await page.mouse.up()
}

/** 选区中心的坐标（用于「在选区内右键」或「从选区起拖」）。 */
async function 选区中点(page: Page) {
  return page.evaluate(() => {
    const s = window.getSelection()
    if (!s || s.rangeCount === 0) return null
    const r = s.getRangeAt(0).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
}

test.fixme("拖：表格选区松到右栏输入框 ⇒ 正文插进（张三 / 1200 在，@ 不在）", async ({ page, context }) => {
  await 开表格加右栏(page, context, `发到会话·拖·${Date.now()}`)
  await 拖选表格(page)

  const 中点 = await 选区中点(page)
  const 框 = await 右栏输入(page).boundingBox()
  if (!中点 || !框) throw new Error("选区或输入框没有盒")

  // 从选区中间按下、拖到输入框松手 —— 裸指针触发原生 dragstart（探针实测 dragstart→dragover→drop）。
  await page.mouse.move(中点.x, 中点.y)
  await page.mouse.down()
  await page.mouse.move(框.x + 框.width / 2, 框.y + 框.height / 2, { steps: 30 })
  await page.mouse.up()

  // 等条件不等时间（`#006-31`）：等文本出现，不用 waitForTimeout。
  await expect(右栏输入(page), "拖进去的表格正文里应有「张三」").toContainText("张三", { timeout: 10_000 })
  await expect(右栏输入(page), "拖进去的表格正文里应有「1200」").toContainText("1200")
  await expect(右栏输入(page), "正文路不补 @ 锚点").not.toContainText("@")
})

test.fixme("右键：选中 ⇒ 菜单出现 ⇒ 点发送到会话 ⇒ 文本进输入框，还能直接接着打字", async ({ page, context }) => {
  await 开表格加右栏(page, context, `发到会话·右键·${Date.now()}`)
  await 拖选表格(page)

  const 中点 = await 选区中点(page)
  if (!中点) throw new Error("没有选区")
  await page.mouse.click(Math.round(中点.x), Math.round(中点.y), { button: "right" })

  // 菜单出现（`ContextMenu.Content` 的 `data-component`）。
  await expect(page.locator("[data-component='context-menu-content']")).toBeVisible({ timeout: 5000 })

  // 点「发送到会话」（第二项）。
  const 发送项 = page.locator("[data-slot='context-menu-item']").filter({ hasText: "发送到会话" })
  await expect(发送项, "菜单里应有「发送到会话」这一项").toBeVisible({ timeout: 5000 })
  await 发送项.click()

  // 文本进了输入框。
  await expect(右栏输入(page), "点发送到会话之后，输入框里应有选中的「张三」").toContainText("张三", {
    timeout: 10_000,
  })

  // 顺带量「插完能不能直接接着打字」：不许先 click() 输入框，直接裸键盘（`#005-17`）。
  await page.keyboard.type("续")
  await expect(右栏输入(page), "不先点输入框、裸键盘接着打，字应当进去").toContainText("续")
})

test("对照：没选中时右键 ⇒ 我们的菜单不出现（我们不接管，原生菜单不被吞）", async ({ page, context }) => {
  await 开表格(page, context, `发到会话·对照·${Date.now()}`)

  // 没做过任何拖选，右击表格中间一格。我们的 handler 读到空选区 ⇒ stopPropagation（不冒泡到
  // Trigger）⇒ 我们没 preventDefault、**不接管**原生菜单（Kobalte 源码核实，见 Task 4）。
  const 中 = await 格(page, 1, 0).boundingBox()
  if (!中) throw new Error("表格没有盒")
  await page.mouse.click(Math.round(中.x + 中.width / 2), Math.round(中.y + 中.height / 2), { button: "right" })

  // 负断言没有「可等的条件」，只能等一个上界再判不在（同族两份 blank-menu spec 的 350ms 口径）。
  await page.waitForTimeout(350)
  await expect(
    page.locator("[data-component='context-menu-content']"),
    "没选中时右键，我们的菜单不该出现",
  ).toHaveCount(0)
})
