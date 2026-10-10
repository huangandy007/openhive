import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · 回归网：**右键菜单开着时，左键点菜单以外的地方要收掉**（用户实报 ④）。
 *
 * ## 现象（用户原话）
 *
 * 「右键后呼出右键弹窗，但是不选择对应的选项，弹窗不消失。我希望的是 windows 风格，
 * 鼠标左键单击弹窗以外的地方时，弹窗消失。」
 *
 * ## 根因（真栈实测，非推演 —— 读数在下表）
 *
 * Kobalte 的 `DismissableLayer` 默认把**触发器**排除在「外面」之外
 * （`chunk/LEK3K6R3.jsx:700` 的 `excludedElements={[context.triggerRef]}`）——而本组件的触发器
 * **就是整片树区域**（下表：触发器盒子与 `file-tree-region` 盒子**逐字相同**，`contains` 为真）
 * ⇒ 在树里任何地方左键都**不算点外面**。修复＝调用侧传 `excludedElements={[]}` 把那份豁免撤掉
 * （`{...others}` 排在 `excludedElements` 之后 ⇒ 调用方能覆盖，不动上游源码）。
 *
 * 修复前后同一份探针的读数：
 *
 * | 落点 | 在触发器盒子里？ | 修复前 | 修复后 |
 * |---|---|---|---|
 * | 树内另一行 `(200,829)` | **是**（触发器 `{69,145,262,696}` ＝ 树区域） | **不关**（缺陷） | 关 |
 * | 工具栏搜索框 `(135,129)`（同一面板、在树区域上边界 145 之上） | 否 | 关 | 关 |
 * | 树栏之外 `(395,413)` | 否 | 关 | 关 |
 *
 * ## 为什么必须是真栈 spec
 *
 * 这条判据的分界**就是几何**（「那一点落不落在触发器盒子里」），happy-dom **没有布局引擎**
 * ⇒ 组件层钉不出边界（`#006-18`：单测全绿 ≠ 接线接上）。组件层的两条用例在
 * `src/project/file-tree.test.tsx` / `src/ai-session/session-list.test.tsx` 各自的
 * 「左键点菜单以外」组里——两处落点、两条用例（`#005-12`）。
 *
 * ## 判据（⑤ 门禁就是跑这个文件）
 *
 * 1. 前提：`file-tree-region` 与它的 `ContextMenu` 触发器盒子**逐字相同**（缺陷的边界就在这里）；
 * 2. 右键一行 ⇒ 菜单开 ⇒ 左键点**树内另一行**（几何断言：那一点在树区域盒子里）⇒ 菜单收掉；
 * 3. 同上，左键点**树栏之外** ⇒ 也收掉（边界的另一侧，修复不许把这一侧弄坏）；
 * 4. 收掉之后**右键另一行照样能开**，且菜单挪到新位置（「能关」不等于「关了还能用」）。
 *
 * ## 变异记录（2026-10-11，把 `excludedElements={[]}` 拆掉重跑一次）
 *
 * 实得：`① 树内另一行 点(200,829) 最上层=div[file-tree-row] ⇒ 菜单还开着=true`
 * ⇒ 判据 2 红（`Expected: false / Received: true`），整条用例 `1 failed`；装回去 `1 passed`。
 *
 * ⚠️ 判据 3、4 在变异下**一次都没跑到**（第 2 条先红、用例当场中止）⇒ 这两条**没有被证明有牙**，
 * 它们与 `src/project/file-tree.test.tsx` 那组里对应两条是同一类（`#003-03` 第 ③ 类）。
 * ⚠️ 这个 spec **只在有真栈（Playwright ＋ 内核 ＋ 前端）时跑**，CI 尚未接线——本机是唯一读到过
 * 这些读数的机器（缺口登记在 `state.md` ⑦-④）。
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

async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

async function 建真项目(名: string) {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  const id = (建.body as { id?: string }).id!
  const 列 = await kernelJson("/openhive/project")
  const directory = (列.body as { id: string; directory: string }[]).find((行) => 行.id === id)!.directory
  return { id, directory }
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
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/**
 * 菜单开着吗——读**状态属性**，不读「节点在不在」。
 *
 * Kobalte 关闭时先播退场动画、动画结束才卸载 ⇒ 节点会一直在（`LEARNINGS #005-29`）；
 * 拿「节点在不在」当判据会读成「永远开着」。
 */
const 菜单开着 = (page: Page) =>
  page.evaluate(
    () => document.querySelector("[data-component='context-menu-content']")?.hasAttribute("data-expanded") ?? false,
  )

/** 菜单内容的左上角（视口坐标）——用来证明「右键另一行，菜单挪了地方」。 */
const 菜单盒 = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLElement>("[data-component='context-menu-content']")
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { 左: Math.round(r.left), 上: Math.round(r.top) }
  })

/** 被测的盒子：树区域、它上面那个触发器、工具栏搜索框。 */
const 量盒子 = (page: Page) =>
  page.evaluate(() => {
    const 盒 = (el: Element | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { 左: Math.round(r.left), 上: Math.round(r.top), 宽: Math.round(r.width), 高: Math.round(r.height) }
    }
    const 域 = document.querySelector<HTMLElement>("[data-slot='file-tree-region']")
    // 树区域**自己那个**触发器：往上找，不 `querySelector` 抓文档里第一个（同页还有别的 ContextMenu）。
    // ⚠️ 只能按 `context-menu-trigger` 查：调用方传的 `data-slot="file-tree-area"` 被 `packages/ui`
    // 的 `ContextMenuTrigger` 静默覆盖（写在 `{...rest}` 之后，`LEARNINGS #005-22`）⇒ 那个名字在
    // DOM 里**从来不存在**。顺手把病也钉在这里（`调用方用的名字存在吗` 应当是 `false`）。
    const 本处 = 域?.closest<HTMLElement>("[data-slot='context-menu-trigger']") ?? null
    return {
      调用方用的名字存在吗: document.querySelector("[data-slot='file-tree-area']") !== null,
      树区域: 盒(域),
      触发器: 盒(本处),
      树区域被触发器裹住吗: !!本处 && !!域 && 本处.contains(域),
      工具栏搜索框: 盒(document.querySelector("[data-slot='file-tree-search']")),
    }
  })

/** 左键点一个视口坐标，读菜单关没关。**点在哪儿**与**最上层是谁**一并记下来（`#003-01`：先证明测量）。 */
async function 左键点(page: Page, 名: string, x: number, y: number) {
  const 上 = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return el
        ? `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[${el.getAttribute("data-slot")}]` : ""}`
        : "<null>"
    },
    [x, y] as const,
  )
  await page.mouse.click(x, y)
  await page.waitForTimeout(300)
  const 开 = await 菜单开着(page)
  console.log(`[${名}] 点(${x},${y}) 最上层=${上} ⇒ 菜单还开着=${开}`)
  return { 开着: 开, 最上层: 上 }
}

const 点中心 = async (page: Page, sel: string) => {
  const b = await page.locator(sel).first().boundingBox()
  if (!b) throw new Error(`量不到 ${sel} 的盒子——前提不成立（#004-14：先立前提再判果）`)
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
}

test("右键菜单开着时：点树里另一行收掉、点栏外也收掉，且收掉后右键还能用", async ({ page, context }) => {
  const 甲 = await 建真项目(`右键关闭·${Date.now()}`)
  mkdirSync(path.join(甲.directory, "资料"), { recursive: true })
  writeFileSync(path.join(甲.directory, "话单.csv"), "a\n")
  writeFileSync(path.join(甲.directory, "资金.xlsx"), "a\n")

  await 进项目(page, context, 甲.id)
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })

  // ── 判据 1：缺陷的边界就在「那一点落不落在触发器盒子里」 ──
  const 盒 = await 量盒子(page)
  console.log(`[盒子] ${JSON.stringify(盒, null, 1)}`)
  expect(盒.树区域被触发器裹住吗, "前提：触发器要裹住整片树区域").toBe(true)
  expect(盒.触发器, "前提：触发器盒子 ＝ 树区域盒子（缺陷的边界就在这里）").toEqual(盒.树区域)
  expect(盒.调用方用的名字存在吗, "`file-tree-area` 这个名字在 DOM 里不存在（被 packages/ui 覆盖）").toBe(false)

  // ── 判据 2：树内**另一行**（在触发器之内、在菜单之外）⇒ 收掉 ──
  await 行(page, "话单.csv").click({ button: "right" })
  await page.waitForTimeout(300)
  const 菜单 = await 菜单盒(page)
  expect(await 菜单开着(page), "前提：右键之后菜单得先开着").toBe(true)

  const 行2 = await 点中心(page, "[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='资金.xlsx']")
  // 几何前提：这一点**确实落在树区域里**（否则「点树内」这句话不成立，测试测的是别的东西）
  const 域 = 盒.树区域!
  expect(
    行2.x >= 域.左 && 行2.x <= 域.左 + 域.宽 && 行2.y >= 域.上 && 行2.y <= 域.上 + 域.高,
    `点(${行2.x},${行2.y}) 要落在树区域盒子里 ${JSON.stringify(域)}`,
  ).toBe(true)

  const 点树内 = await 左键点(page, "① 树内另一行", 行2.x, 行2.y)
  expect(点树内.开着, `在树里左键点一下就该收掉（Windows 习惯）；实测最上层=${点树内.最上层}`).toBe(false)

  // ── 判据 3：树栏之外（边界的另一侧）⇒ 也收掉 ──
  await 行(page, "话单.csv").click({ button: "right" })
  await page.waitForTimeout(300)
  expect(await 菜单开着(page), "前提：重开之后菜单要开着").toBe(true)
  const 侧 = await page.evaluate(() => {
    const 槽 = document.querySelector<HTMLElement>("[data-slot='file-tree-slot']")!.getBoundingClientRect()
    return { x: Math.round(槽.right + 60), y: Math.round(槽.top + 300) }
  })
  const 点栏外 = await 左键点(page, "③ 树栏之外", 侧.x, 侧.y)
  expect(点栏外.开着, "树栏之外左键也应收掉").toBe(false)

  // ── 判据 4：收掉之后**右键另一行照样能开**，且菜单挪到新位置（「能关」≠「关了还能用」）──
  await 行(page, "话单.csv").click({ button: "right" })
  await page.waitForTimeout(300)
  await 行(page, "资金.xlsx").click({ button: "right" })
  await page.waitForTimeout(400)
  const 后 = await 菜单盒(page)
  expect(await 菜单开着(page), "右键另一行之后菜单要开着").toBe(true)
  expect(后, `菜单要跟着这一次右键挪地方（前 ${JSON.stringify(菜单)}）`).not.toEqual(菜单)
})
