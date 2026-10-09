import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 页面内观测器的落点（见 `装观测器`）。用全局增补声明，而不是在每一处写
 * `(window as unknown as { __观: … })` —— 那种写法每处都要断言一次、且断言本身没有任何保证
 * （2026-10-09 oxlint 复跑时，带出 `no-unsafe-type-assertion` 的正是它）。
 */
declare global {
  interface Window {
    __观?: { empty: number; loading: number }
  }
}

/**
 * 2026-10-09 · 切项目时左栏「会话」tab **不许把「还没问到」说成「一场都没有」**，在真前端 ↔ 真后端下的对账。
 *
 * ## 用户实报的现场
 *
 * 「我在左侧切换项目的时候，会话页面的会话列表不跟着变化，始终停止一个会话上」——追问后用户选定的是
 * 这一种：**切项目后，左栏先变空 / 显示「暂无会话」，过几秒才列出新项目的会话**。
 *
 * ## 根因（实测 ＋ 代码双证）
 *
 * **不是**「列表不刷新」（三轮真栈探针实测：列表每跳都跟着换），也**不是**「前端没发请求」
 * （探针实测：点击后 **+72ms** 就发出了 `GET /session?directory=…&roots=true&limit=55`）。
 * 是**那几秒里界面在说一句假话**：
 *
 * `sidebar-sessions.tsx` 的 `表` 拿的是 `ensureDirSyncContext(目录).data.session`，而**新目录的
 * store 一建出来就带 `session: []`**（`global-sync/child-store.ts` 的初值），**不是 `undefined`**
 * ⇒ `session-list.tsx` 空态那道守卫 `directory !== undefined && 列出()?.length === 0` 对它**成立**，
 * 于是画出「暂无会话」。而同一段注释自陈的用意正是「把『还没问到』与『问到了，没有』分开」
 * （`#002-02`）——**这道守卫对「在途」这一类完全无效**。
 *
 * ⇒ 判据是**第三态**：目录已知 ＋ 表还没取到 ⇒ 说「加载中…」；取到了且为空 ⇒ 才说「暂无会话」。
 *
 * ## 为什么必须落在真栈（组件层够不着）
 *
 * 出错的一线在**接线层** `sidebar-sessions.tsx`：它要 `useServerSync()`（要一个活着的服务器连接才建得
 * 起来），该文件头把「本文件不带测试」写在明处。组件测试只能钉**三态各画什么**
 * （`session-list.test.tsx`）——把在途错传成空表这件事，桩是看不见的（`#006-18` 的分工）。
 *
 * ## 判据为什么写成「一次都没出现过」
 *
 * 被测属性是**否定式**的（「那几秒里不许说暂无会话」），所以不能在某一刻采样——要在**从点击到列表
 * 出现之间**持续观测。用 `MutationObserver` 记「`session-empty` 有没有被插进来」，比轮询硬（轮询会
 * 漏掉一帧就消失的窗口；而这条判据的红绿两态都看不出「漏没漏」）。
 *
 * ⚠️ **`empty === 0` 单看会恒真**（数据来得快时那几秒根本不存在）——所以必须配一条**窗口证据**：
 * 同一次观测里要看到「加载中」**确实出现过**。没有它，这条用例在「列表瞬到」的机器上照样绿，
 * 而绿的不是被测属性（`#006-06` / `#005-13`：先证注入点之前确实发生了）。
 *
 * ## 为什么每次现建两个项目
 *
 * 窗口＝**某个目录在本次栈里第一次被锚定访问**的开销（探针实测：直打内核首次带项目 cookie
 * **2870ms**，随后 106 / 35ms；经前门首次 **8990ms**）。用**刚建的项目**保证这个窗口稳定存在，
 * 不去赌缓存命中（那是环境的隐变量，不是被测属性）。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

/** 真内核出口（测试侧**直接用真券打内核**，当 oracle 用——不经被测的前端）。 */
async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : undefined }
}

/** 建一个私有项目，返回 `{ id, name, directory }`。目录问服务端要、不自己拼（`#003-05` 的假镜像）。 */
async function 建真项目(名: string): Promise<{ id: string; name: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = (建.body as { id?: string } | undefined)?.id
  expect(id, "建项目应当回一个**服务端给的** id").toBeTruthy()

  const 列 = await kernelJson("/openhive/project")
  const 行 = (列.body as { id: string; directory?: string }[] | undefined)?.find((行) => 行.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory（左栏正是靠它取会话表）").toBeTruthy()
  return { id: id!, name: 名, directory: 行!.directory! }
}

/**
 * 在**项目目录**里建一场真会话，返回它的 id。
 *
 * ⚠️ 必须带 `x-openhive-project` 头：不带的话锚定会把 `?directory=` 改写成**沙箱根**，会话落到另一个
 * 目录里 —— 左栏那时列不到它，用例会红在一条**与本次缺陷无关**的前置上。
 */
async function 建项目内会话(projectId: string, directory: string, title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: {
      Cookie: COOKIE(),
      "content-type": "application/json",
      "x-openhive-project": projectId,
    },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

/**
 * 观测器（页面内）：从装上的那一刻起，记「左栏那两个标记有没有被插进 DOM」。
 *
 * ⚠️ 装在 `document.body` 的 `subtree` 上、记 `addedNodes`——**只记「新增」**，不记「已在那儿」。
 * 这样「重置计数器」就等于「从此刻起重新看」（调用点先等被测的那一屏稳定，再重置）。
 */
async function 装观测器(page: Page) {
  await page.evaluate(() => {
    const 观 = { empty: 0, loading: 0 }
    window.__观 = 观
    // `instanceof Element` 而不是 `nodeType === 1` ＋ 断言：Element 自己就有 `matches` /
    // `querySelector`，非元素（文本节点等）直接落 false —— 与原来的判据同义，但不靠断言。
    const 有 = (node: Node, sel: string) =>
      node instanceof Element && (node.matches(sel) || node.querySelector(sel) !== null)
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (有(node, "[data-slot='session-empty']")) 观.empty++
          if (有(node, "[data-slot='session-loading']")) 观.loading++
        }
    }).observe(document.body, { childList: true, subtree: true })
  })
}

/** 读回计数器（**不要**在这里顺便重置——重置是调用点显式做的一步）。 */
async function 读观测(page: Page) {
  // 还没装上观测器时（`undefined`）回**零值**：调用点拿到的永远是同一形状，不必再判空。
  return page.evaluate(() => window.__观 ?? { empty: 0, loading: 0 })
}

const 重置观测 = (page: Page) =>
  page.evaluate(() => {
    const 观 = window.__观
    if (观) {
      观.empty = 0
      观.loading = 0
    }
  })

test("切项目 ⇒ 左栏在会话表到手前说「加载中…」，一次都不说「暂无会话」", async ({ page, context }) => {
  const 甲 = await 建真项目(`切项目甲·${Date.now()}`)
  const 丙 = await 建真项目(`切项目丙·${Date.now()}`)
  const 甲一 = await 建项目内会话(甲.id, 甲.directory, "甲·一")
  await 建项目内会话(甲.id, 甲.directory, "甲·二")
  const 丙一 = await 建项目内会话(丙.id, 丙.directory, "丙·一")
  await 建项目内会话(丙.id, 丙.directory, "丙·二")

  // 起手在甲上：cookie 让前端启动时还原出锚点行与左栏目录（`还原启动项目`）。
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: 甲.id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  expect(new URL(page.url()).pathname, "前提：从项目页（非会话路由）切").toBe("/")

  // 前提①：甲那一屏**已经稳定**（它的列表真的列出来了）——否则甲的「在途」会被记进计数器里，
  // 而那不是本次要测的那一跳（`#005-13`：先证注入点之前确实发生了）。
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()
  await expect(page.locator(`[data-slot='session-item'][data-session-id='${甲一}']`)).toBeVisible()

  await 装观测器(page)
  await 重置观测(page)

  // ── 被测的那一跳：从锚点面板切到丙（本栈从未访问过它） ──
  await page.locator("[data-slot='project-anchor-toggle']").click()
  await page.locator("button[data-slot='project-item']", { hasText: 丙.name }).click()

  // 前提②：丙那一屏**确实到了**（列表里有它自己的会话）——不然「没说过假话」是因为什么都没发生。
  await expect(page.locator(`[data-slot='session-item'][data-session-id='${丙一}']`), {
    message: "切到丙之后左栏应当列出丙的会话",
    timeout: 30_000,
  }).toBeVisible()

  const 观 = await 读观测(page)

  // ── 被测属性（排在最前，`#004-14`）──
  expect(观.empty, "从切到丙到列表出现，左栏一次都不该说「暂无会话」").toBe(0)
  // ── 窗口证据：那几秒**真的发生过**，否则上面那条恒真（`#006-06`）──
  expect(观.loading, "在途窗口应当被观测到（否则这条判据是空测量）").toBeGreaterThan(0)
  // 对照：丙的**第二场**也在（证明列的是丙的表，不是把甲的行留在屏上）。
  await expect(page.locator(`[data-slot='session-item']`)).toHaveCount(2)
})

/**
 * 第二个投影（`#004-02`）：**取到了、确实一场都没有**时，那句「暂无会话」还是要说得出来。
 *
 * 少了这一条，把空态整个摘掉（永远不画）也能让上面那条绿——而那是一种更坏的「不撒谎」：
 * 用户再也分不出「这个项目是空的」与「还没问到」。
 */
test("零会话的项目 ⇒ 稳定之后仍然说「暂无会话」（别把空态整个摘掉）", async ({ page, context }) => {
  const 乙 = await 建真项目(`切项目乙·${Date.now()}`)

  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: 乙.id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()

  await expect(page.locator("[data-slot='session-empty']"), {
    message: "零会话的项目：表到手之后「暂无会话」这一句是真的，必须说得出来",
    timeout: 30_000,
  }).toBeVisible()
  await expect(page.locator("[data-slot='session-loading']")).toHaveCount(0)
})
