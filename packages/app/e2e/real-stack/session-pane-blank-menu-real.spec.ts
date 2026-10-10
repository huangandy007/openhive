import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-10 · 回归网：**会话 tab 的空白处右键要能呼出菜单**，而且**作用对象要跟着指针走**。
 *
 * ## 怎么来的
 *
 * 用户报的是**文件** tab（`file-tree-blank-menu-real.spec.ts` 钉的那一条）。修完之后按 ⑥ 步
 * grep「谁在按同一个前提做同一件事」（`LEARNINGS #002-06`），`session-pane-blank-probe.spec.ts`
 * 真栈实测出**会话** tab **逐字同型**（探针输出，非推演）：
 *
 * | | 会话 tab |
 * |---|---|
 * | `session-list-slot` bottom | 841 |
 * | `session-list` 根 bottom | **189** |
 * | 空白点(125,801) 最上层 | `div[session-list-slot]` ⇒ 菜单开 = **false** |
 *
 * ⇒ 同一个根因（pane 只有 `flex-1`、**自身不是 flex 容器**，子项的 `flex-1` 无剩余空间可分
 * ⇒ 高度＝内容高 ⇒ 空白落在 pane 上、不在 `ContextMenu` 触发区里）。
 *
 * ## 第二层（本文件第三条用例钉的就是它）
 *
 * 只把 pane 改成 flex 容器**不够**：`session-list-region`（`onContextMenu={记行}` 挂的那一层）
 * 也得 `flex-1`，否则空白落在 **`ContextMenu.Trigger`** 上 —— 菜单**照样开**，而 `记行` 没跑
 * ⇒ **作用对象停在上一次的残留**（右键行之后再右键空白，「重命名」指着那条行）。
 * 这不报错、也不变红，正是 `LEARNINGS #005-19` 那一类。
 *
 * ## 为什么只能落在真栈
 *
 * happy-dom **没有布局引擎**，量不出 flex 高度（`#005-07` / `#006-18`）。组件层那条
 * `session-list.test.tsx` 的「右键空白处 ⇒ 不动作」只能钉行为、钉不住「空白归谁」。
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

/** 建一个私有项目，返回 `{ id, directory }`。目录**问服务端要、不自己拼**（`#003-05`）。 */
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

/**
 * 在**项目目录**里建一场真会话。整段抄 `sidebar-session-nav-real.spec.ts`（`#004-12`）。
 *
 * ⚠️ 必须带 `x-openhive-project` 头：不带的话锚定会把 `?directory=` 改写成**沙箱根**，
 * 会话落到另一个目录里 —— 左栏那时列不到它，用例会红在一条**与本次缺陷无关**的前置上。
 */
async function 建项目内会话(projectId: string, directory: string, title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json", "x-openhive-project": projectId },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

async function 进项目会话页(page: Page, context: BrowserContext, id: string) {
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
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()
}

const 量盒子 = (page: Page) =>
  page.evaluate(() => {
    const 取 = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) }
    }
    const 域 = document.querySelector<HTMLElement>("[data-slot='session-list-region']")
    const 槽 = document.querySelector<HTMLElement>("[data-slot='session-list-slot']")
    const 滚 = (el: HTMLElement | null) =>
      el ? { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop } : null
    return {
      页签区: 取("[data-slot='session-list-slot']"),
      列表根: 取("[data-component='session-list']"),
      触发器: 取("[data-slot='session-list-slot'] [data-slot='context-menu-trigger']"),
      域: 取("[data-slot='session-list-region']"),
      标题行: 取("[data-slot='session-list-bar']"),
      空态: 取("[data-slot='session-empty']"),
      域滚: 滚(域),
      槽滚: 滚(槽),
    }
  })

/** 页签底 − 40：稳稳落在空白里，离所有盒子的边界都远（同 `file-tree-blank-menu-real.spec.ts`）。 */
async function 点空白(page: Page) {
  return page.evaluate(() => {
    const 槽 = document.querySelector<HTMLElement>("[data-slot='session-list-slot']")!
    const r = 槽.getBoundingClientRect()
    return { x: Math.round(r.x + 60), y: Math.round(r.bottom - 40) }
  })
}

/**
 * 在空白深处右键。**只负责点开、不负责关**——关菜单是调用方的事。
 * ⚠️ 早先这里在返回前就按了 Escape，于是调用方随后读菜单项一律「找不到」。
 *
 * `在触发区里` 是本条最要紧的读数：它问的是「这一点的**最上层元素**，是不是落在
 * `ContextMenu` 触发子树里」。修复前它是 `false`（最上层就是 pane 自己），而**「菜单开不开」
 * 只是它的下游** —— 只断「开」的话，第二层（region 不撑满 ⇒ 菜单开、对象残留）会漏过去。
 */
async function 点空白右键(page: Page) {
  const 点 = await 点空白(page)
  const 上 = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return { 名: "<null>", 在触发区里: false }
      const 触发 = document.querySelector("[data-slot='session-list-slot'] [data-slot='context-menu-trigger']")
      const slot = el.getAttribute("data-slot")
      return {
        名: `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}`,
        在触发区里: 触发 !== null && 触发.contains(el),
      }
    },
    [点.x, 点.y],
  )
  await page.mouse.click(点.x, 点.y, { button: "right" })
  await page.waitForTimeout(350)
  const 开 = await page.evaluate(() => {
    const c = document.querySelector("[data-component='context-menu-content']")
    return c?.hasAttribute("data-expanded") ?? false
  })
  console.log(`[会话空白右键] 点(${点.x},${点.y}) 最上层=${上.名} 在触发区里=${上.在触发区里} ⇒ 菜单开=${开}`)
  return { 开, ...上 }
}

/** 收尾：关掉菜单，免得影响下一段。 */
async function 关菜单(page: Page) {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(250)
}

/** 读「重命名」这一项的禁用态——它是「菜单作用对象是不是『无』」的探针（`要对象()` ＝ `!菜单对象()`）。 */
async function 读重命名禁用(page: Page) {
  const el = page.locator("[data-slot='context-menu-item'][data-action='rename']")
  await expect(el).toBeVisible({ timeout: 5000 })
  const a = await el.evaluate((n) => ({
    dataDisabled: n.hasAttribute("data-disabled"),
    aria: n.getAttribute("aria-disabled"),
  }))
  return a.dataDisabled || a.aria === "true"
}

test("无会话：列表撑满页签 ＋ 空白处右键要能呼出菜单（用户实报的那一处的同型）", async ({ page, context }) => {
  const 甲 = await 建真项目(`会话空白空·${Date.now()}`)
  mkdirSync(甲.directory, { recursive: true })

  await 进项目会话页(page, context, 甲.id)

  // 前提：取数确实到了（目录已知 ＋ 表在手 ⇒ 空态那句才出得来）。少了它，下面的「盒子」
  // 量的是「还没问到」那一屏 —— 那样得到的红与本次缺陷无关（`#002-02` 的第三态）。
  await expect(page.locator("[data-slot='session-empty']")).toBeVisible({ timeout: 30_000 })

  const 盒 = await 量盒子(page)
  console.log(`[无会话] 盒子 = ${JSON.stringify(盒)}`)

  // 判据 1：列表根撑满页签（会话 pane 里的 `flex-1` 真的生效了）
  expect(盒.列表根?.bottom, "session-list 根要撑满 session-list-slot").toBe(盒.页签区?.bottom)

  // 判据 1 续：触发器与 region 一路撑到底 —— 空白必须落进**挂着 `记行` 的那一层**
  expect(盒.触发器?.bottom, "context-menu-trigger 要撑满列表根（标题行以下）").toBe(盒.列表根?.bottom)
  expect(盒.域?.bottom, "session-list-region 要撑满触发器（它才是右键的作用面）").toBe(盒.列表根?.bottom)

  // 判据 2：这一点的最上层真的在触发子树里 ⇒ 菜单才可能开
  const 果 = await 点空白右键(page)
  expect(果.在触发区里, `空白点应落在 ContextMenu 触发区里；实测最上层=${果.名}`).toBe(true)
  expect(果.开, `空白处右键应开菜单；实测最上层=${果.名}`).toBe(true)
  await 关菜单(page)
})

test("有会话：右键行 ⇒ 重命名可用；右键空白 ⇒ 作用对象必须是「无」", async ({ page, context }) => {
  const 乙 = await 建真项目(`会话空白对象·${Date.now()}`)
  mkdirSync(乙.directory, { recursive: true })
  const 会话 = await 建项目内会话(乙.id, 乙.directory, `右键对象探针·${Date.now()}`)

  await 进项目会话页(page, context, 乙.id)

  const 行 = page.locator(`[data-slot='session-item'][data-session-id='${会话}']`)
  await expect(行, "前提：左栏会话 tab 里应当列出刚建的那一场").toBeVisible({ timeout: 30_000 })

  // 对照组：右键**会话行** ⇒ 有对象 ⇒ 重命名**可用**。没有这一步，「禁用」就分不出
  // 「判据生效」与「这一项永远是禁用的」。
  const 行盒 = (await 行.boundingBox())!
  await page.mouse.click(Math.round(行盒.x + 行盒.width / 2), Math.round(行盒.y + 行盒.height / 2), { button: "right" })
  await page.waitForTimeout(350)
  const 有对象 = await 读重命名禁用(page)
  console.log(`[对照·右键会话行] 重命名禁用 = ${有对象}`)
  await 关菜单(page)

  // 被测：右键**空白** ⇒ 无对象 ⇒ 重命名**禁用**。
  // ⚠️ 这一条钉的是**第二层**：若 region 不撑满，菜单**照样开**，但 `记行` 没跑 ⇒
  // `菜单对象` 停在上面那一行 ⇒ 这里读到的会是「可用」（残留），而不是「禁用」。
  const 果 = await 点空白右键(page)
  const 无对象 = await 读重命名禁用(page)
  console.log(`[被测·右键空白] 重命名禁用 = ${无对象}（最上层=${果.名}）`)
  await 关菜单(page)

  expect(有对象, "对照组：右键会话行时重命名应可用").toBe(false)
  expect(无对象, "右键空白处时重命名应禁用（菜单对象＝无，不是上一条的残留）").toBe(true)
})

test("30 场会话：只有列表区滚，标题行（＋）钉住", async ({ page, context }) => {
  const 丙 = await 建真项目(`会话空白滚动·${Date.now()}`)
  mkdirSync(丙.directory, { recursive: true })
  for (let i = 0; i < 30; i++) await 建项目内会话(丙.id, 丙.directory, `会话-${String(i).padStart(3, "0")}`)

  await 进项目会话页(page, context, 丙.id)
  await expect(page.locator("[data-slot='session-item']").first()).toBeVisible({ timeout: 30_000 })

  const 盒 = await 量盒子(page)
  console.log(`[30 场] 盒子 = ${JSON.stringify(盒)}`)

  // 判据 3：溢出的是**列表区**（不是页签）
  expect(盒.域滚, "session-list-region 必须在").not.toBeNull()
  expect(盒.域滚!.scrollHeight, "列表区内容要溢出").toBeGreaterThan(盒.域滚!.clientHeight)

  // 判据 3 续：滚轮 ⇒ 列表区动、页签不动（标题行还钉在原处）
  await page.mouse.move(200, 400)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(400)

  const 滚后 = await 量盒子(page)
  console.log(`[30 场·滚 600px] 域=${JSON.stringify(滚后.域滚)} 槽=${JSON.stringify(滚后.槽滚)} 标题行=${JSON.stringify(滚后.标题行)}`)

  expect(滚后.域滚!.scrollTop, "滚轮后列表区应滚下去").toBeGreaterThan(0)
  expect(滚后.槽滚!.scrollTop, "页签不应滚动").toBe(0)
  expect(滚后.标题行?.y, "标题行（＋）不应被滚走").toBe(盒.标题行?.y)
})
