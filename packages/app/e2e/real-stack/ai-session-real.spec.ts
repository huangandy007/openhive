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
/**
 * 起栈的产物文件（`stack.ts` 在 `vite.listen()` 之后、`STACK_READY` 之前写它 ⇒ **端口就绪即已写入**）。
 *
 * ⚠️ **每次现读，不在模块级缓存**（2026-10-08 修）：Playwright 完全可能在 `webServer` 起栈**之前**
 * 就加载本文件（`testDir` 收集阶段），那时模块级 `const` 会把**上一套栈**冻在里面——默认形态下
 * 恰好是同一个端口（3010/4711，看不出差别），但**换端口并行跑第二套栈时**（`REAL_STACK_FRONT_PORT`
 * / `REAL_STACK_KERNEL_PORT`，`stack.ts` 支持）就会把测试**打到另一套栈上**：读的是别人的会话、
 * 写的是别人的数据，而断言照样绿。这正是「测量打到别的对象上」那一族（`#003-01`）。
 * 现读之后，端口只剩一个产地（`stack.ts` 写下的那份），与 `webServer.url` 就绪同一件事。
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

/** 真内核出口（测试侧**直接用凭证打内核**，当 oracle 用——不经被测的前端）。 */
async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : undefined }
}

async function 建真会话(title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory())}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  const json = (await res.json()) as { data: { id: string } }
  return json.data.id
}

test.beforeEach(async ({ context }) => {
  // 把**真签发的**身份令牌塞进 cookie jar（令牌由内核侧产出，测试不签——见 `serve.ts`）。
  await context.addCookies([{ name: "openhive_session", value: readStack().token, url: FRONT() }])
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
    [FRONT(), KERNEL(), directory()] as const,
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
    if (u.port === String(readStack().front)) 后端请求.push({ method: r.method(), pathname: u.pathname, search: u.search })
  })

  await setup(page, 起始会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${起始会话}`)

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
      (r) => r.method === "GET" && r.pathname === "/session" && decodeURIComponent(r.search).includes(directory()),
    ),
    "右栏列会话应经同源前门（3010）打内核 GET /session，并带上本场目录",
  ).toBe(true)

  // ③ 真落库：点「新建会话」→ 真 SDK → 真内核 → 库里多出一行（oracle 走真内核，不经前端）。
  const 建前 = (await kernelJson(`/api/session?directory=${encodeURIComponent(directory())}`)).body as {
    data: unknown[]
  }
  await 面板.locator('[data-slot="session-new"]').click()
  await expect
    .poll(async () => {
      const 后 = (await kernelJson(`/api/session?directory=${encodeURIComponent(directory())}`)).body as {
        data: unknown[]
      }
      return 后.data.length
    }, { timeout: 20_000 })
    .toBe(建前.data.length + 1)
})

/**
 * ③ **三栏的接线**——本文件是全仓**唯一**能验它的地方。
 *
 * 「会话路由下中栏让位」这句判定住在 `pages/layout-new.tsx` 的一行 prop 上
 * （`routePageVisible={() => routeSessionID(location.pathname) === undefined}`），
 * 而它**只能**在真路由下求值：`workspace-entry.test.tsx` 裸挂组件（无 Router），
 * 单元层看得到 `CenterContent` 拿到 `pageVisible=false` 会怎样，**看不到**那一行有没有接上
 * （`#005-11`：横切机制在新出口上是否真生效，与机制本身「对不对」是两个事实）。
 *
 * 判据取**可见性**不取存在性：上游会话页在这一档只是 `display:none`（**藏 ≠ 卸**，
 * `center-content.tsx` 那个 `data-slot="center-page"` 的注释写了为什么不能卸——整页状态会丢）。
 * 所以「中栏没有第二个输入框」这句话在 DOM 上**是假的**：它一直在那儿，只是不露。
 * 用 `count()` 去数会恒为 1、永远绿；必须问 `toBeVisible()`。
 */
test("③ 会话路由下的三栏：中栏让位（空态可见、上游页不可见）、右栏有且仅有一个", async ({ page }) => {
  const 起始会话 = await 建真会话("三栏接线")
  await setup(page, 起始会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${起始会话}`)

  // 前提（对照）：右栏在，否则下面两条都在测空气。
  const 右栏 = page.locator('[data-component="session-panel"]')
  await expect(右栏).toHaveCount(1)
  await expect(右栏).toBeVisible()

  // 前提（对照）：中栏那页**确实挂在 DOM 里**——这一条是下面 `.not.toBeVisible()` 的对照。
  // 少了它，「不可见」在页面压根没渲染时**照样绿**（`#005-15`）。
  const 中栏页的输入框 = page.locator('[data-slot="center-page"] [data-component="prompt-input"]')
  await expect(中栏页的输入框).toHaveCount(1)

  // 被测属性①：中栏的上游会话页不露（那一行 prop 接上了）。
  await expect(中栏页的输入框).not.toBeVisible()

  // 被测属性②：中栏露出空态（不是一片空白）。两条各管一半：① 管「旧的不露」、② 管「新的有」。
  await expect(page.locator('[data-slot="center-empty"]')).toBeVisible()
})

/**
 * ④ **右栏同一条消息显示两遍**——真栈端到端（2026-10-08 用户肉眼报出）。
 *
 * 被测的是 `context/server-session.ts` 里**两个写入出口判据不一致**：乐观插入按**客户端**时钟、
 * 服务端回包按**内核**时钟（同 `id`、不同 `time.created`），而事件那条出口按
 * `messageKey = time.created + id` 做二分 ⇒ 找不到 ⇒ 再插一条。修法是先按 `id` 认一次身份。
 *
 * 复现网在单测层（`context/server-session-optimistic-duplicate.test.ts`），本格问的是**另一个问题**：
 * 那条链在真前端（真 composer → 真 SDK → 真内核 → 真流）上是不是真的走同一条路。
 * 单测喂的是手搓的 `apply({type:"message.updated"})`；这里的信封由**真内核**发出，
 * 时钟也是真的两枚（两个进程）——这正是单测证明不了的那一半。
 *
 * ⚠️ **采样窗口取峰值，不只断稳定态**：服务端回包晚于乐观插入，重复是**回包那一刻**才出现的，
 * 而「最终是 1」在修复前也可能成立（整页 fetch 那条出口按 `id` 去重，会把重复吃掉——
 * 这也正是这个缺陷在长驻页面里才看得见、刷新就消失的原因）。只看终值会漏掉被测的坏法。
 */
test("④ 右栏发消息：乐观插入与服务端回包只该留一条（真栈端到端）", async ({ page }) => {
  const 起始会话 = await 建真会话("右栏去重")
  await setup(page, 起始会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${起始会话}`)

  const 标记 = `去重标记${Date.now()}`
  const hero = page.locator('[data-slot="session-hero"]')
  await expect(hero.locator('[data-component="prompt-input"]')).toBeVisible()
  await hero.locator('[data-component="prompt-input"]').fill(标记)
  await hero.locator('[data-action="prompt-submit"]').click()

  const 右栏 = page.locator('[data-component="session-panel"]')

  // 前半条（`#005-13`）：先证明机制是活的——乐观插入把这句话放进了右栏。
  // 少了它，下面「峰值恰好 1」在一个字都没渲染时是 **0**、红在别处（读起来像渲染坏了）。
  //
  // ⚠️ **判据锚在 `[data-slot="session-turns"]`，不能锚在整根右栏**（2026-10-08 实测）：
  // 右栏**表头那个会话题名按钮**也会承载这句话——内核收到首条消息后把标题从建会话时的
  // 「右栏去重」改成了它（同一时刻 `session.title` 确实如此）。锚在整根右栏上时，
  // `getByText` 会**同时**命中「表头标题」与「turn 里的消息」⇒ 峰值**恒为 2**，
  // 与有没有重复**无关**——那条判据永远红、且红不出真因。
  // 这正是 `#006-06` 那一族：测量取错了对象，而它**看起来像结果**（「峰值 2」读作「重复了」）。
  const 消息出现 = 右栏.locator('[data-slot="session-turns"]').getByText(标记)
  await expect(消息出现.first()).toBeVisible({ timeout: 30_000 })

  // 被测属性：整段窗口内，这句话在右栏的 **turn 区**里任何时刻都只该出现一次。
  let 峰值 = 0
  for (let 采样 = 0; 采样 < 40; 采样++) {
    峰值 = Math.max(峰值, await 消息出现.count())
    await page.waitForTimeout(250)
  }
  expect(峰值, "右栏 turn 区里这句话在整段窗口内都应只出现一次（重复＝服务端回包又插了一条同 id 的）").toBe(1)

  // 第二个投影（`#004-02`）：同一个事实从结构上再钉一次——右栏只为 **user** 消息渲染 turn
  // （`session-panel.tsx` 的 `轮次()`），而重复出来的那条也是 user ⇒ 重复时这里是 2。
  await expect(右栏.locator('[data-component="session-turn"]')).toHaveCount(1)
})

async function setup(page: Page, sessionID: string) {
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      // ⚠️ `shouldDisplayTabsToast: false` **不是**可选的美化：那个「Introducing Tabs」引导浮层是
      // `fixed bottom-5 end-5 z-50`／192×240 —— 位置正好压住**右栏底部的 hero 输入框**
      // （`TabsInfoPopup` 在 layout 里，`components/help-button.tsx`）。不关它，右栏任何一次提交
      // 都会被它 `intercepts pointer events` ⇒ Playwright 重试到超时。症状读起来像「按钮点不动」，
      // 真因是一个**引导浮层的遮挡**（`#006-11` 是同族：那里是强制改密弹窗）。
      // `settings.tsx` 那侧写着「已是 boolean 就原样留着」⇒ 这里给 `false` 就管用，且**只影响本套真栈**。
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
