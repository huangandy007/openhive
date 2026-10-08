import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 006 · 右栏「AI 会话」在**真前端 ↔ 真后端**下的接缝对账（`fullstack-slice-testing` 步骤 3）。
 *
 * ## 圈定的单条切片
 *
 * **建会话落库 ＋ 列表可见**：`packages/app` 的右栏消费链（真 SDK 客户端 `session-actions.ts`
 * 的 `建会话` / `可列出的会话`）→ 真内核（`/api/session` 的 v2 出口）→ 真 SQLite（每用户库）。
 * 命中缺口 ②**契约真实性**（客户端调用的形状 vs 真路由、v2 `{data,cursor}` 形状）＋
 * ③**接缝粘合**（身份 cookie 通道 / 目录参数 / 错误面）。**缺口 ④ 不命中**：本切片是普通
 * 请求-响应，无流式（如实记，不硬造时序断言）。
 *
 * ## 这条对账在核什么（本仓第一次有真后端可对）
 *
 * 同目录 `regression/ai-session-right-pane.spec.ts` 是**假后端**（`mockOpenCodeServer` 拦掉全部流量）。
 * 本文件把那一层换成真栈，于是「前端以为后端会这么返回」这纸**善意的谎**第一次与真实碰面。
 *
 * ## 最强的那条断言是哪一个：**同源 vs 跨源的 cookie 对照**（测试 ①）
 *
 * 006 Step 5 的 ②-1 修法（cookie 环境通道）建立在一句假设上——「**浏览器对每一条同源请求自动附带**」。
 * 本测试在**真浏览器**里对**同一个内核**发两次 `fetch`，只差**同源 / 跨源**这一个变量：
 * 经前门（同源）⇒ 200；直连内核（跨源）⇒ 401。两者都由**真内核的身份证**给出，不是转述。
 * ⇒ 它同时证明：②-1 成立的前提是**同源**，而本仓 `bun run dev` 的跨源形态**不满足**这个前提
 * （SDK 客户端不设 `credentials`、内核 CORS 无 `credentials` 选项）。
 *
 * ## 起点对齐
 *
 * 夹具里那些 localStorage（`settings.v3` / `opencode.global.dat:server` / `…browser.dat:tabs`）
 * 与 URL 形状（新布局 `/server/<base64 serverKey>/session/<id>`）逐字照
 * `regression/ai-session-right-pane.spec.ts` 的 `setup()`（`LEARNINGS #004-12`：同族 harness 整段搬来）。
 */
const stack = JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
  kernel: number
  front: number
  token: string
  sandbox: string
  alice: string
}

const FRONT = `http://127.0.0.1:${stack.front}`
const KERNEL = `http://127.0.0.1:${stack.kernel}`
const COOKIE = `openhive_session=${stack.token}`
const directory = path.join(stack.sandbox, "workspaces", stack.alice)

/** 真内核出口（测试侧**直接用凭证打内核**，当 oracle 用——不经被测的前端）。 */
async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL}${url}`, {
    ...init,
    headers: { Cookie: COOKIE, ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : undefined }
}

async function 建真会话(title: string): Promise<string> {
  const res = await fetch(`${KERNEL}/api/session?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: { Cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  const json = (await res.json()) as { data: { id: string } }
  return json.data.id
}

test.beforeEach(async ({ context }) => {
  // 把**真签发的**身份令牌塞进 cookie jar（令牌由内核侧产出，测试不签——见 `serve.ts`）。
  await context.addCookies([{ name: "openhive_session", value: stack.token, url: FRONT }])
})

test("① cookie 通道：同源经前门带得上、跨源直连内核带不上（真浏览器实测）", async ({ page }) => {
  await page.goto("/")

  const 结果 = await page.evaluate(
    async ([front, kernel, dir]) => {
      const q = `?directory=${encodeURIComponent(dir)}`
      // 同源：经前门（与页面同源 ⇒ 浏览器自动带 cookie）。
      const 同源 = await fetch(`${front}/api/session${q}`, { headers: { accept: "application/json" } })
      // 跨源：直连内核（端口不同 ⇒ 默认 credentials:"same-origin" ⇒ **不带** cookie）。
      const 跨源 = await fetch(`${kernel}/api/session${q}`, { headers: { accept: "application/json" } })
      return { 同源: 同源.status, 跨源: 跨源.status }
    },
    [FRONT, KERNEL, directory] as const,
  )

  // 被测属性（放最前，`#004-14`：红时要先看到是哪条）。
  expect(结果.同源, "同源（经前门）应带得上身份 cookie").toBe(200)
  expect(结果.跨源, "跨源（直连内核）浏览器不带 cookie ⇒ 身份门应拒").toBe(401)
})

test("② 右栏真栈冒烟：真 SDK 建会话 → 真内核落库 → 右栏渲染", async ({ page }) => {
  const 起始会话 = await 建真会话("真栈起点会话")
  const 后端请求: { method: string; pathname: string; search: string }[] = []
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (u.port === String(stack.front)) 后端请求.push({ method: r.method(), pathname: u.pathname, search: u.search })
  })

  await setup(page, 起始会话)
  await page.goto(`/server/${base64Encode(FRONT)}/session/${起始会话}`)

  // ① 三层组装在**真后端**上接通了（假后端那条 spec 断的是同一件事，这里换真栈）。
  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  await expect(面板.locator('[data-slot="session-hero"] [data-component="prompt-input"]')).toBeVisible()

  // ② 数据面确实走了**同源反代**（不是直连内核、更不是 mock）：请求 host 是 3010。
  // 判据取**实测的形状**：右栏列会话打的是 v1 出口 `GET /session?directory=…`（兼容层
  // `createCompatibleApi` 那条），**不是** `/api/session`——后者是 v2 形状，本文件自己的
  // oracle（`建真会话`）才用它。所以这里钉两条：路径是 `/session`，且**带上了本场目录**。
  expect(
    后端请求.some(
      (r) => r.method === "GET" && r.pathname === "/session" && decodeURIComponent(r.search).includes(directory),
    ),
    "右栏列会话应经同源前门（3010）打内核 GET /session，并带上本场目录",
  ).toBe(true)

  // ③ 真落库：点「新建会话」→ 真 SDK → 真内核 → 库里多出一行（oracle 走真内核，不经前端）。
  const 建前 = (await kernelJson(`/api/session?directory=${encodeURIComponent(directory)}`)).body as {
    data: unknown[]
  }
  await 面板.locator('[data-slot="session-new"]').click()
  await expect
    .poll(async () => {
      const 后 = (await kernelJson(`/api/session?directory=${encodeURIComponent(directory)}`)).body as {
        data: unknown[]
      }
      return 后.data.length
    }, { timeout: 20_000 })
    .toBe(建前.data.length + 1)
})

async function setup(page: Page, sessionID: string) {
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
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
    { directory, server: FRONT, sessionID },
  )
}
