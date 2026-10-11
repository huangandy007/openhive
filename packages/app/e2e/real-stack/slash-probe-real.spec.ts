import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 探针（Phase 1 · 拿根因读数用，不是验收判据）：
 * 右栏 AI 会话框打一个 `/`，到底**弹不弹**、弹出**几条**、弹出后**看不看得见**。
 *
 * 三个待辨的假设（`superpowers:systematic-debugging` 的 Phase 1：先取证，不猜）：
 * - H1「连弹层都不出现」——`commands` 那根线没接上 / 触发没走。
 * - H2「弹了，但池子只有两条开发工具 skill」——线接了，**池子**是 `MANIFESTS` 那 2 条。
 * - H3「弹了、池子也对，但被祖先裁掉 / 跑到视口外」——几何问题（`#006-24` / `#005-32` 那一族）。
 *
 * 读数一次打全：`[data-suggestion-id]` 的**条数 + 文字**（H2）、弹层的**几何盒**与它
 * 相对输入框的位置（H3）、以及 hero 里**现有控件的清单**（第②项「模型选择器」的落点证据）。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    sandbox: string
    alice: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`
const directory = () => path.join(readStack().sandbox, "workspaces", readStack().alice)

async function 建真会话(title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory())}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "openhive_session", value: readStack().token, url: FRONT() }])
})

async function setup(page: Page, sessionID: string) {
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory: directory(), server: FRONT(), sessionID },
  )
}

test("探针：右栏打 `/` 的实测读数", async ({ page }) => {
  // ── 先问内核：**真实 skill 全集**（＝原生那条 `sync().data.command` 的源头）到底有多少条
  const 命令源 = await (async () => {
    for (const 路径 of ["/api/command", "/command"]) {
      const res = await fetch(`${KERNEL()}${路径}?directory=${encodeURIComponent(directory())}`, {
        headers: { Cookie: COOKIE(), accept: "application/json" },
      })
      if (!res.ok) continue
      const json = (await res.json()) as unknown
      const arr = (Array.isArray(json) ? json : ((json as { data?: unknown }).data ?? [])) as {
        name?: string
        source?: string
        description?: string
      }[]
      return {
        路径,
        条数: arr.length,
        清单: arr.map((c) => `${c.name}(${c.source ?? "?"})`).slice(0, 40),
      }
    }
    return { 路径: "都没有", 条数: -1, 清单: [] as string[] }
  })()
  console.log("【内核命令源】" + JSON.stringify(命令源, null, 2))

  const 起始会话 = await 建真会话("斜杠探针会话")
  await setup(page, 起始会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${起始会话}`)

  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  const hero = 面板.locator('[data-slot="session-hero"]')
  const 输入 = hero.locator('[data-component="prompt-input"]')
  await expect(输入).toBeVisible()

  // ── 打一个 `/`（`.fill` 会触发 `onInput`，而 `/` 面板正是由 `onInput` 触发的）
  await 输入.click()
  await 输入.fill("/")
  await page.waitForTimeout(700)

  const 读数 = await page.evaluate(() => {
    const 面板 = document.querySelector('[data-component="session-panel"]')
    const 弹层 = 面板?.querySelector("[data-suggestion-id]")?.parentElement ?? null
    const 项 = Array.from(面板?.querySelectorAll("[data-suggestion-id]") ?? []).map((el) => ({
      id: el.getAttribute("data-suggestion-id"),
      文字: (el.textContent ?? "").trim().slice(0, 60),
    }))
    const 盒 = (el: Element | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const hero = 面板?.querySelector('[data-slot="session-hero"]')
    const 输入 = hero?.querySelector('[data-component="prompt-input"]')
    return {
      右栏条数: 项.length,
      右栏项: 项,
      整页条数: document.querySelectorAll("[data-suggestion-id]").length,
      弹层盒: 盒(弹层),
      输入盒: 盒(输入),
      视口: { w: window.innerWidth, h: window.innerHeight },
      hero按钮: Array.from(hero?.querySelectorAll("button") ?? []).map(
        (b) => b.getAttribute("data-action") ?? b.getAttribute("aria-label") ?? (b.textContent ?? "").trim().slice(0, 20),
      ),
      hero文字: (hero?.textContent ?? "").trim().slice(0, 120),
    }
  })
  console.log("【探针读数】" + JSON.stringify(读数, null, 2))

  // 探针没有断言要「过」——只要求它跑到这儿（读数就是产出）。
  expect(读数.输入盒, "输入框必须有盒，否则后面读的都不是我要量的东西").not.toBeNull()
})
