import { test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · **⑥ 步「同类落点」的取证**（不是修，是量）。
 *
 * ## 起因
 *
 * 文件树「空白处右键呼不出菜单」的根因是：files pane 只有 `flex-1`、**自身不是 flex 容器**
 * ⇒ 子项的 `flex-1` 无剩余空间可分 ⇒ 高度＝内容高 ⇒ 空白落在 pane 上、不在触发器里。
 *
 * ## 同一前提的第二个落点（按结构读出来的，**本 spec 负责实测**）
 *
 * `@/ai-session/session-list.tsx:206` 的根写着 `flex min-h-0 w-full flex-1 flex-col`，
 * **逐字同型**于 `dual-file-tree.tsx:103`；而它的父级——会话 pane——用的是同一个 `PANE`
 * 常量，同样**没有** `flex flex-col` ⇒ 那个 `flex-1` 同样失效。
 *
 * 若成立，会话 tab 会有**两个**同型症状：
 * ① 空白处右键呼不出菜单（触发器 `session-list-body` 撑不到 pane 底）；
 * ② `session-list-bar`（标题行 ＋）的注释写着「常驻、不该被滚走」，而它今天应当会被滚走。
 *
 * ⚠️ **用户没报会话 tab**（只报了文件 tab），所以这一条**只登记、不动手**——
 * 本 spec 的唯一产出是「实测事实」，供挂账引用。
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

test("会话 tab：空白处右键与标题行常驻（同类落点取证）", async ({ page, context }) => {
  const 甲 = await 建真项目(`会话pane·${Date.now()}`)
  mkdirSync(甲.directory, { recursive: true })

  await 进项目会话页(page, context, 甲.id)
  await page.waitForTimeout(2500)

  const 盒 = await page.evaluate(() => {
    const 取 = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) }
    }
    const 槽 = document.querySelector<HTMLElement>("[data-slot='session-list-slot']")
    return {
      页签区: 取("[data-slot='session-list-slot']"),
      列表根: 取("[data-component='session-list']"),
      触发器: 取("[data-slot='session-list-body']"),
      标题行: 取("[data-slot='session-list-bar']"),
      空态: 取("[data-slot='session-empty']"),
      槽滚: 槽 ? { scrollHeight: 槽.scrollHeight, clientHeight: 槽.clientHeight } : null,
    }
  })
  console.log("[会话 tab] 盒子：")
  for (const [k, v] of Object.entries(盒)) console.log(`     ${k} = ${JSON.stringify(v)}`)

  // ① 空白处右键
  const 点 = await page.evaluate(() => {
    const 槽 = document.querySelector<HTMLElement>("[data-slot='session-list-slot']")!
    const r = 槽.getBoundingClientRect()
    return { x: Math.round(r.x + 60), y: Math.round(r.bottom - 40) }
  })
  const 上 = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return el ? `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[${el.getAttribute("data-slot")}]` : ""}` : "<null>"
    },
    [点.x, 点.y],
  )
  await page.mouse.click(点.x, 点.y, { button: "right" })
  await page.waitForTimeout(350)
  const 开 = await page.evaluate(() => {
    const c = document.querySelector("[data-component='context-menu-content']")
    return c?.hasAttribute("data-expanded") ?? false
  })
  console.log(`[会话 tab·空白右键] 点(${点.x},${点.y}) 最上层=${上} ⇒ 菜单开=${开}`)

  // ② 标题行「常驻」这条意图在不在（标题行在不在滚动容器之内）
  const 标题在滚动容器里 = await page.evaluate(() => {
    const 槽 = document.querySelector<HTMLElement>("[data-slot='session-list-slot']")!
    const 条 = document.querySelector<HTMLElement>("[data-slot='session-list-bar']")
    return 条 ? 槽.contains(条) && 槽.scrollHeight > 槽.clientHeight + 2 : null
  })
  console.log(`[会话 tab] 标题行会随页签滚动而滚走？（槽有溢出且含标题行）＝ ${标题在滚动容器里}`)
  console.log(
    `[会话 tab·判读] 列表根撑满页签？ ${盒.列表根?.bottom === 盒.页签区?.bottom}（列表根 bottom=${盒.列表根?.bottom} 页签 bottom=${盒.页签区?.bottom}）`,
  )
})
