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

/**
 * ⑤⑥⑦⑧ **右栏不自动跟随底部**——真栈几何实测（2026-10-08 用户肉眼报出，两轮）。
 *
 * 用户原话（第一轮）：「当我输入问题之后，AI 助手的回答不能实时显示在我能够看见的地方，我需要通过
 * 鼠标滚动才能够看到」。根因不在渲染层：右栏滚动容器（`session-panel.tsx` 的
 * `[data-slot="session-turns"]`）是个**裸 `overflow-y-auto`**，全仓在它上面没有一条自动滚动逻辑
 * （上游会话页一直有 `createAutoScroll`，右栏当年没接）。修法见该文件「自动跟随底部」那一段。
 *
 * 用户原话（第二轮，同一个功能的另一半）：「当滚动条不在最底部……这个时候我输入一个问题，AI 助手
 * 此时回答我依然看不到，正确的方式应当是……用户敲回车键后，滚动条应当自动滚动到底部」⇒ 提交要
 * 把原语那条**粘性**的 `userScrolled` 清掉（`自动跟随.resume()`）。⑧ 就是它。
 *
 * ## 为什么这几条必须在这里、单测断不了
 *
 * 判据是**几何**的（「内容长高之后视野还在不在底部」），而 happy-dom 不跑布局、
 * `scrollHeight`/`clientHeight`/`scrollTop` 恒为 0（`LEARNINGS #005-07` / `#006-15`）。
 * 单测那边用一副**假几何**钉了「提交 ⇒ 回到底部」这条（`session-panel.test.tsx` 的 ③④），
 * 但「内容长高就跟随」（`ResizeObserver` 那条支路）在 happy-dom 里**压根回调不了** ⇒ 只能在这里。
 *
 * ## 内容怎么长高：**两条路，各有各的用例，别混**
 *
 * 真栈**没有模型**（本文件头「缺口 ④ 不命中」已记）⇒ 没有回包、没有流式，`message[]` 只能靠
 * 用户自己的提交长出来。⇒
 *
 * - ⑤⑦⑧ 走**真提交**（「从 Hero 真提交 → 等它真的出现在 turn 区」），**一次 DOM 注入都没有**。
 * - ⑥ 的**后半段**是个例外，它需要一次**人造长高**（`长高一截`）：它要测的是「用户滚上去时，
 *   **被动**长出来的内容不许把人拽走」，而「被动长高」在本栈**无从产生**（没有模型 ⇒ 没有流式）。
 *   这一笔是**人造的**，据实写在用例里（`#005-13`：人造注入要在用例里自陈）。但它**不降低**
 *   这条用例的真度：内容长高这件事**照旧从产品码那条路走**——`ResizeObserver` 观测的是
 *   `[data-slot="session-turns-content"]`（`contentRef`），把高内容 append 进**那一层**，
 *   观测器照常触发 ⇒ 走 `scrollToBottom(false)` ⇒ 走的正是生产路径，被换掉的只是**长高的来源**。
 *   ⚠️ append 到**那一层的末尾**是刻意的：那也是 `<For>` 下一次插 turn 的位置，而 ⑥ 之后
 *   **不再提交**，所以不会有 DOM 协调把注入节点挪走/删掉；反过来，若注入进 `<For>` 的中间，
 *   就会踩到「新 turn 插到注入块之前」那件事（见下）。
 *
 * ⚠️ 真提交那条路**必须是真提交**：DOM 注入一个「假 turn」会踩 Solid 的插入点——`<For>` 的自有
 * 节点与注入节点在同一父层，**新 turn 会插到注入块之前**，于是「新的一轮在不在下面」这个几何
 * 前提当场失真（⑤⑦⑧ 全都靠这个前提）。
 *
 * ## 视口要调小：让「能滚」变成可证的前置条件，而不是假设
 *
 * 默认 1440×900 下右栏高约 637px，要提交很多轮才撑得满。把视口压到 1440×**420**，
 * 两三句话就能滚。**每一条都先断言「真的能滚」**——撑不满时 `距底` 恒为 0，
 * 「跟到底」就是一条恒真的测量、看着是绿的（`LEARNINGS #006-06`：判据先要有非零的量）。
 *
 * ## 四条的分工（缺一条都不够）
 *
 * - ⑤ **被测属性（第一处现场）**：内容长高 ⇒ 视野落到底部。
 * - ⑥ **对照（会坏的那一格）**：用户滚上去之后**被动长高**（人造，见上）⇒ 视野**不许被拽走**。
 *   它是「无脑跳到底」那种实现——直接在上面写 `scrollTop = scrollHeight`，也就是**不接原语时
 *   最容易写出的那份**——唯一会红的地方；而在**本轮这条修复的语境里它更重要了**：用户要的
 *   「提交就回到底部」让「看见新内容」变得唾手可得，最容易走的歪路就是**无条件**跳到底
 *   （那样 ⑤⑦⑧ 全绿、只有 ⑥ 红）。⚠️ 它在**修复前后都是绿的**（修复前压根没人动滚动），
 *   **据实记**：它的价值是**哨兵**，不是缺陷探测器（`LEARNINGS #005-15`：别让注释比断言强）。
 * - ⑦ **真路**：与⑤同一件事，但判据取用户那句话说的事实本身——「新出现的一轮落在**视野里**」，
 *   用 `toBeInViewport`。⑤ 量的是滚动量，⑦ 量的是「看不看得见」；两者在多数坏法下同红，
 *   但⑦是**唯一**直接对上第一轮原话的那条。
 * - ⑧ **被测属性（第二处现场，第二轮原话）**：滚上去之后再提交 ⇒ 视野**立刻**回到底部，**并且
 *   继续跟随**（再提交一条，仍到底——用户原话「然后实时显示输出的信息给用户」）。分两段是因为
 *   这是两件事：头一条证明「提交会拉到底」，第二条证明拉到底之后**跟随是真的回来了**，不是
 *   一次性跳转留下的假象。**每个落点一条断言**（`#005-12`：同一个修法落在 N 处就写 N 条）。
 *
 * ## 本栈**仍然观测不到**的（据实记，不假装覆盖）
 *
 * 「真模型**流式**输出」的那条路——本栈没有模型（文件头「缺口 ④ 不命中」）⇒ ⑥ 的被动长高是
 * **人造**的（一次 append 而不是上百次小增长）。⑥ 证明的是这条判据本身（长高 ⇒ 走
 * `scrollToBottom(false)` ⇒ 有 `userScrolled` 就不拽），但「流式下**反复**触发时还是同一结论」
 * 这一层只有接上真模型才能实测到。⇒ 已记进 006 的缺口表（`LEARNINGS #002-02`：测不了要写成
 * **缺口**，不能写成覆盖）。
 */
const 量滚动 = (page: Page) =>
  page.evaluate(() => {
    // ⚠️ 数一遍匹配个数，不只取第一个：右栏若哪天渲染出两个 `session-turns`（或中栏那页
    // 也长出一个），`querySelector` 会**静默**量到另一个元素，而所有判据照旧有个数
    // （`LEARNINGS #004-01`：数不对，缺口就看不见）。
    const 全部 = document.querySelectorAll<HTMLElement>('[data-slot="session-turns"]')
    const el = 全部[0]
    if (!el) throw new Error('没找到 [data-slot="session-turns"]（右栏滚动容器换地方了？）')
    const 可滚量 = el.scrollHeight - el.clientHeight
    return {
      可滚量,
      距底: 可滚量 - el.scrollTop,
      匹配数: 全部.length,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    }
  })

/** 右栏压矮到几句话就能滚（宽度不动，免得踩响应式断点）。 */
const 压矮 = (page: Page) => page.setViewportSize({ width: 1440, height: 420 })

const 打开右栏 = async (page: Page, 标题: string) => {
  const 起始会话 = await 建真会话(标题)
  await setup(page, 起始会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${起始会话}`)
  await expect(page.locator('[data-slot="session-turns"]')).toBeVisible()
}

/** 从 Hero 真提交一句话，等它**真的**出现在 turn 区里（乐观插入到账）。 */
async function 提交一条(page: Page, 标记: string) {
  const hero = page.locator('[data-slot="session-hero"]')
  await expect(hero.locator('[data-component="prompt-input"]')).toBeVisible()
  await hero.locator('[data-component="prompt-input"]').fill(标记)
  await hero.locator('[data-action="prompt-submit"]').click()
  // 锚在 `[data-slot="session-turns"]`（不是整根右栏）：表头那个会话题名按钮也会承载这句话
  // （内核收到首条消息后把标题改成它）——测试 ④ 的注释里记着这一条实测。
  await expect(page.locator('[data-slot="session-turns"]').getByText(标记).last()).toBeVisible({
    timeout: 30_000,
  })
}

/**
 * 一直提交到 turn 区**滚得够多**为止（返回提交了几次）。
 *
 * ⚠️ **目标是「滚得够多」，不是「刚刚能滚」**（2026-10-08 第一次跑实测打回的一版）：第一版把判据
 * 写成 `可滚量 > 1`，于是循环在第一句话**刚**撑满时立刻停手——实测那一刻 `可滚量` 只有 **26px**，
 * 于是 ⑥ 那条「用户滚到顶」的前置（`距底 > 50`）当场红了，红在**前置**上、读起来像「scroll 没生效」。
 * 26px 的「滚到顶」也确实不是用户说的「滚上去看东西」：真判据需要一个能容人的余量。
 *
 * 为什么是循环而不是定次数：每轮的高度取决于真实渲染，猜不准；而「提交 N 次」是个**猜出来的数**，
 * 「能滚多少」是个**可量的判据**（`LEARNINGS #003-04`：数字落笔前先量，量不成写成命令/条件）。
 */
async function 提交到能滚(page: Page, 目标 = 200, 上限 = 8): Promise<number> {
  for (let i = 1; i <= 上限; i++) {
    await 提交一条(page, `撑高${i}·${Date.now()}`)
    const { 可滚量 } = await 量滚动(page)
    if (可滚量 >= 目标) return i
  }
  const { 可滚量 } = await 量滚动(page)
  throw new Error(`提交了 ${上限} 次 turn 区只滚得动 ${可滚量}px（目标 ${目标}）⇒ 前置撑不住，不测下去`)
}

/**
 * 模拟「用户往上滚去看历史」：滚到顶 ＋ 同步派发一次 `scroll`（⑥⑧ 共用）。
 *
 * ⚠️ `dispatchEvent` 是**必须**的：`scrollTop` 赋值触发的原生 scroll 事件是**异步**投递的，
 * 不等它就得靠 `waitForTimeout` 猜一个数（猜出来的等待在慢机器上就是 flake）。同步派发让
 * `handleScroll` 当场跑掉 ⇒ 断言拿到的几何是**处理器跑完之后**的。
 *
 * 返回滚动前后的几何，并且**在这里就把前置断言掉**（`真的滚上去了`）——理由与 `提交到能滚` 相同：
 * 两个用例各写一份同样的诊断串，迟早会分叉（`#002-06`）。⚠️ 消息里带**实测的数**：这条若是红的，
 * 只报「距底 0」分不清「压根没有可滚的量」还是「置 0 之后被弹回底部」——两者排查方向相反
 * （`LEARNINGS #003-04`：数字要落成实测）。被弹回底部那一支的成因见 `#006-17`（原语按
 * 「距它**上次记下的那个位置** < 2px」判 `isAuto`，窗口 1500ms）。
 */
async function 滚到顶(page: Page) {
  const 滚前 = await 量滚动(page)
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-slot="session-turns"]')!
    el.scrollTop = 0
    el.dispatchEvent(new Event("scroll"))
  })
  const 滚后 = await 量滚动(page)
  expect(
    滚后.距底,
    `前置：真的滚上去了（否则 scroll 没生效，后面那条判据就没有意义）` +
      `｜滚前 可滚量=${滚前.可滚量} 距底=${滚前.距底} scrollTop=${滚前.scrollTop}` +
      ` clientHeight=${滚前.clientHeight} 匹配数=${滚前.匹配数}` +
      `｜置 0 之后 距底=${滚后.距底} scrollTop=${滚后.scrollTop}`,
  ).toBeGreaterThan(150)
  return { 滚前, 滚后 }
}

/**
 * **人造**长高：往自动跟随的观测面（`contentRef` 那一层）末尾塞一段高内容（⑥ 用，理由见文件头
 * 「内容怎么长高」那一节）。返回塞进去的高度，好让调用方断言「这一下真的长高了」。
 */
async function 长高一截(page: Page, 高: number) {
  await page.evaluate((h) => {
    const 内容 = document.querySelector<HTMLElement>('[data-slot="session-turns-content"]')
    if (!内容) throw new Error('没找到 [data-slot="session-turns-content"]（自动跟随的观测面换地方了？）')
    const 假回答 = document.createElement("div")
    假回答.style.height = `${h}px`
    假回答.textContent = "（人造的一段内容：模拟 AI 回答长出来）"
    内容.appendChild(假回答)
  }, 高)
}

test("⑤ 右栏内容长高 ⇒ 自动跟到底部（真栈几何实测）", async ({ page }) => {
  await 压矮(page)
  await 打开右栏(page, "右栏自动跟随")
  await 提交到能滚(page)

  const 几何 = await 量滚动(page)
  // 前置：真的能滚（否则下面那条恒真）。放在被测属性**之前**是为了让 ⑤ 的自我描述成立
  // （`#004-14` 讲的是同一条纪律的另一面：书写顺序决定红的时候你读到哪条证据）。
  expect(几何.可滚量, "前置：turn 区应当真的能滚").toBeGreaterThan(1)

  // 被测属性：最后一条提交之后，视野底应当贴着内容底。
  expect(几何.距底, "内容长高之后视野应当跟到底部（修复前这里是 400 上下，即停在顶部）").toBeLessThan(2)
})

test("⑥ 对照：用户先滚到顶，被动的长高 ⇒ 视野不许被拽回来", async ({ page }) => {
  await 压矮(page)
  await 打开右栏(page, "右栏跟随对照")
  await 提交到能滚(page)

  const { 滚后 } = await 滚到顶(page)

  // 长高这件事**走产品那条路**（`ResizeObserver` → `scrollToBottom(false)`），只有「长高的来源」
  // 是人造的——本栈没有模型，产不出「被动长高」（见文件头）。⚠️ 这里**不能用 `提交一条` 代劳**：
  // 提交按第二轮的定义**就该**回到底部（⑧）⇒ 用它当替身，这条用例当场变成「与需求相反」的那条。
  const 高 = 400
  await 长高一截(page, 高)
  await expect
    .poll(async () => (await 量滚动(page)).可滚量, {
      message: `前置：内容真的长高了（长高前 可滚量=${滚后.可滚量}）；它不成立时下面那条判据是恒真的`,
    })
    .toBeGreaterThan(滚后.可滚量 + 高 / 2)

  const 之后 = await 量滚动(page)
  // 被测属性：「视野**停在原处**」最直接的形态是 `scrollTop` 还是 0（内容长高只让它距底更大）。
  // 「无脑跳到底」的实现会把它打回底部（`scrollTop` ≈ 可滚量）⇒ 恰红这一条。
  expect(
    之后.scrollTop,
    `用户已经在上面读东西 ⇒ 新内容不该把视野拽走` +
      `｜滚上去时 距底=${滚后.距底} scrollTop=${滚后.scrollTop}` +
      `｜长高之后 可滚量=${之后.可滚量} 距底=${之后.距底} scrollTop=${之后.scrollTop}`,
  ).toBeLessThan(2)
})

test("⑦ 真路：撑满的会话里从 Hero 提交 ⇒ 新的一轮落在**视野里**（用户原话的那条判据）", async ({ page }) => {
  await 压矮(page)
  await 打开右栏(page, "右栏跟随真路")
  await 提交到能滚(page)

  const 标记 = `看得见·${Date.now()}`
  await 提交一条(page, 标记)

  // 与测试 ④ 相反的一侧：那里问「这句话在 turn 区里出现几次」，这里问「它**看得见吗**」。
  // 修复前：提交把它追加在内容底、而视野停在顶部 ⇒ `toBeInViewport` 红（这正是用户报的现场）。
  // 断言前一行那句「新出现的一轮应当落在视野里，而不是要人往上滚才看得见」是这条用例的自我描述。
  await expect(page.locator('[data-slot="session-turns"]').getByText(标记).last()).toBeInViewport()
})

test("⑧ 滚上去之后再提交 ⇒ 视野回到底部，并继续跟随（第二轮原话）", async ({ page }) => {
  await 压矮(page)
  await 打开右栏(page, "右栏提交回到底部")
  await 提交到能滚(page)

  const { 滚后 } = await 滚到顶(page)

  const 第一条 = `回到底部·${Date.now()}`
  await 提交一条(page, 第一条)
  // 判据用 `poll` 而不是一次性断言：`resume()` 本身是同步的，但「内容长高」与「滚动落地」在真
  // 浏览器里各占一帧——这里给的是帧时序的余量，不是在断言「同一 tick 就到底」（把帧当契约的断言
  // 在慢机器上就是 flake）。⚠️ 前置（真的滚上去了）已经在 `滚到顶` 里断过：没有它，这条判据在
  // 「压根没可滚的量」时也绿（`#006-06` 同族）。
  await expect
    .poll(async () => (await 量滚动(page)).距底, {
      message: `提交之后就该回到底部（滚上去时 距底=${滚后.距底} scrollTop=${滚后.scrollTop}）`,
    })
    .toBeLessThan(2)
  // 第一轮原话的那条真路：新回答**看得见**（与 ⑤ 量滚动量不同，这条量的是「看不看得见」）。
  await expect(page.locator('[data-slot="session-turns"]').getByText(第一条).last()).toBeInViewport()

  // 第二段 = 用户原话的后半句「然后实时显示输出的信息给用户」：拉到底之后**跟随真的回来了**，
  // 而不只是这一下把人送到位。它排掉的是「回到底部是一次性动作、之后的增长不再跟」这一类——
  // 单看第一段是分不出来的（第一段红不了它）。
  const 第二条 = `继续跟·${Date.now()}`
  await 提交一条(page, 第二条)
  await expect
    .poll(async () => (await 量滚动(page)).距底, {
      message: `回到底部之后要**继续**跟随：第二条提交后新内容也落在视野里`,
    })
    .toBeLessThan(2)
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
