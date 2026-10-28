import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-14 · **AI 会话的「用户输入索引 / 快速跳转」**（用户实报：「不能在大段会话里快速找回自己
 * 问过的那句话及其回答」；点名照 DeepSeek 的形态做）。
 *
 * ## 为什么单测 ＋ 组件测都绿了，这一份仍然要写（`LEARNINGS #006-27`）
 *
 * 这一处要的四件事里，**三件在 happy-dom 里量不出来**（没有布局引擎，`#005-07` / `#006-30` / `#006-33`），
 * 第四件（真鼠标悬停）也做不到：
 *
 * | 用户要的 | 组件层钉了什么 | 只有真栈能钉的 |
 * |---|---|---|
 * | ① 右缘一列短横、最下面那枚是最近一轮 | 谁画出来了、`data-active` 落哪一枚 | 那一列**落在滚动条内侧的那条留白里**（真滚动条宽 ＋ 真盒宽） |
 * | ② 鼠标移上去 ⇒ 呼出索引面板 | 直派 `mouseenter` ⇒ 面板是监听器那一块的后代 | 真指针移进去 ⇒ 面板真出来、**右缘与轨对齐**（从轨上展开的样子） |
 * | ③ 停在某一行 ⇒ 弹出预览 | 弹的是**那一行**的全文（含截断） | 预览真弹在面板**左边**、与那一行**对齐**、长句真截断 |
 * | ④ 点一条 ⇒ 跳过去 ＋ 不被拽回 | 收到的是**哪一轮**、`scrollTo` 的参数 | **真滚到那一轮的气泡上**（真几何 ＋ smooth 动画）＋ 之后内容长高**不把视野拽回底部** |
 *
 * ## 本栈没有模型（据实记，`#002-02`）
 *
 * 「轮」＝**用户消息**（`session-panel.tsx` 的 `轮次()` 只筛 `role === "user"`），所以本 spec 需要的是
 * **多条用户消息 ＋ 一个滚得动的盒**，两样都不需要模型：三轮由内核 `noReply: true` 直接落库（见
 * `落一轮` 的注释——本机的 UI 提交链路整条是哑的，那是既有状况），几何靠 `长高一截` 人造
 * （同目录 `ai-session-real.spec.ts` 的挂具整段搬来，`#004-12`）。
 * ⇒ **没覆盖**的是「真模型边流式边跳走」那一层：`LEARNINGS #006-31` 记过流式期间的读数会随就绪
 * 状态变，本栈造不出流式。
 */

/**
 * 起栈的产物文件（`stack.ts` 在端口就绪前写它）。
 *
 * ⚠️ **每次现读、不在模块级缓存**（同 `ai-session-real.spec.ts` 那条注释）：Playwright 可能在
 * `webServer` 起栈**之前**就加载本文件，那时模块级 `const` 会把**上一套栈**冻在里面 ⇒ 打到别的
 * 栈上，读别人的会话、写别人的数据，而断言照样绿（`#003-01`）。
 */
const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    sandbox: string
    alice: string
  }

/**
 * ⚠️ **为什么本文件要摘掉 Playwright 的一条默认参数**（2026-10-14 实测坐定）。
 *
 * ① 的那条判据是「那一列短横**落在滚动条内侧**」，它的前提是**这一栏真的有一条滚动条**。
 * 而无头模式下 Playwright 会给 Chrome 添一条 `--hide-scrollbars`
 * （`playwright-core@1.64.0/lib/coreBundle.js:44759`，**只在 `options.headless` 那一支里**）
 * ⇒ 滚动条**根本不画** ⇒ `offsetWidth - clientWidth` **恒 0**（首跑实测：`滚动条宽: 0`）。
 * 于是「短横不压滚动条」写成断言就是一条**恒真的空转**，而它读起来像在守着东西
 * （`#005-47` 那一族；同族还有 `#006-06` 的 `scrollWidth - clientWidth` 恒 0）。
 *
 * ⇒ 本文件把这条默认参数**摘掉**（`ignoreDefaultArgs`，只摘这一条、别的一律不动），
 * 让滚动条真出现。摘掉之后前提立得住（见 ① 里 `滚动条宽 > 0` 那条前置断言）。
 *
 * ⚠️ `launchOptions` 在 `test.use` 里是**整份替换**、不是深合并 ⇒ 项目级那一条
 * `executablePath`（本机 `@playwright/test@1.59.1` 期望的 headless shell 没装，见
 * `playwright.config.ts`）必须在这里**再写一遍**，否则浏览器起不来。
 */
test.use({
  launchOptions: {
    ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : {}),
    ignoreDefaultArgs: ["--hide-scrollbars"],
  },
})

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
  const json = (await res.json()) as { data: { id: string } }
  return json.data.id
}

/** 夹具：localStorage 那三份 ＋ URL 形状，逐字照 `ai-session-real.spec.ts` 的 `setup()`。 */
async function setup(page: Page, sessionID: string) {
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      // `shouldDisplayTabsToast: false` 不是美化：那个引导浮层 `fixed bottom-5 end-5 z-50` 正好压住
      // 右栏底部的 hero 输入框 ⇒ 不关它，本 spec 每一次提交都会被它 `intercepts pointer events`。
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

/** 右栏压矮到几句话就能滚（宽度不动，免得踩响应式断点）。 */
const 压矮 = (page: Page) => page.setViewportSize({ width: 1440, height: 420 })

/**
 * 由**内核**落一条用户消息（一轮），**不经 UI 的提交链路**。
 *
 * ## 为什么不从 Hero 提交（2026-10-14 换的挂具，据实记）
 *
 * 第一版是从 Hero 真填真点（`ai-session-real.spec.ts` 的 `提交一条` 那套），**在本机整条是哑的**：
 * 输入框收下字、按钮点得动、**一个请求都不发**、turn 区一个气泡都不出。取证（全部有实测输出）：
 *
 * - 同族既有 spec `ai-session-real.spec.ts -g "⑦"` **红在同一行、同一个错**（`element(s) not found`）；
 * - **基线对照**（`cp` 备份八个文件 → `git stash push -u` → 跑同一条 → `git stash pop`，内容逐字相同）
 *   ⇒ **基线也红在同一行** ⇒ 不是本次改动引入（`#006-02`）；
 * - trace 里**一条非 GET 请求都没有**（浏览器压根没发）；
 * - 内核日志在提交那一刻**没有任何 `stream providerID=` 行**；
 * - 一次性探针：建项目回体里**没有 `directory` 字段**、`[data-slot='project-anchor-name']` 的
 *   `data-state` 停在 `empty`（项目没认上）。
 *
 * 与 `LEARNINGS #006-27` 同族（部署跑的是 v1 协议，`defaultModel()` 恒 `undefined` ⇒ 认不出模型 ⇒
 * **静默不发**）。这是**本机的既有状况**，不是本 feature 的回归；但它不该再拖住本 spec 的判据——
 * 本 spec 要的是**多条用户消息 ＋ 一个滚得动的盒**，与「这句话怎么发出去的」无关。
 *
 * ## 这条路为什么更硬（不是绕过判据，而是换成上游自己的一条出口）
 *
 * `POST /session/:id/message` 的 body 里有 `noReply: true`（`session/prompt.ts:1601` 的 schema，
 * 第 1119 行 `if (input.noReply === true) return message`）⇒ **只落用户消息、不触模型**。它是
 * 内核的**一等公民**（路由 `groups/session.ts:96`），走的是**真落库**（不是 `#006-28` 那种绕开生产
 * 注册链的种 SQL）。实测：落两条 ⇒ 内核读回两条 ⇒ 前端 turn 区 `[data-message]` 两条、索引轨两枚刻度。
 */
async function 落一轮(会话: string, 文字: string) {
  const res = await fetch(`${KERNEL()}/session/${会话}/message?directory=${encodeURIComponent(directory())}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json" },
    body: JSON.stringify({ noReply: true, parts: [{ type: "text", text: 文字 }] }),
  })
  expect(res.ok, `内核落用户消息失败：${res.status}`).toBe(true)
}

/**
 * **人造**长高：往自动跟随的观测面（`contentRef` 那一层）末尾塞一段高内容。
 *
 * 目的是让滚动盒**真的滚得动**（本栈没有模型 ⇒ 光靠几句话撑不出滚动量）。它同时会触发那套自动
 * 跟随的 `ResizeObserver` ⇒ 视野被拉到底，这正是我们要的起点（用户看最新那一轮）。
 */
async function 长高一截(page: Page, 高: number) {
  await page.evaluate((h) => {
    const 内容 = document.querySelector<HTMLElement>('[data-slot="session-turns-content"]')
    if (!内容) throw new Error("没找到 [data-slot='session-turns-content']（自动跟随的观测面换地方了？）")
    const 假回答 = document.createElement("div")
    假回答.style.height = `${h}px`
    假回答.textContent = "（人造的一段内容：模拟 AI 回答长出来）"
    内容.appendChild(假回答)
  }, 高)
}

/** 这一栏的几何：盒 / 真滚动条 / 索引轨 / 刻度线 / 正文右缘。**一次取齐**，免得几次取样之间界面变过。 */
const 量几何 = (page: Page) =>
  page.evaluate(() => {
    const 盒 = document.querySelector<HTMLElement>('[data-slot="session-turns"]')
    if (!盒) throw new Error("没找到 [data-slot='session-turns']")
    const 轨 = document.querySelector<HTMLElement>('[data-slot="session-nav"]')
    const 线 = [...document.querySelectorAll<HTMLElement>('[data-slot="session-nav-tick-line"]')]
    const 气泡 = [...document.querySelectorAll<HTMLElement>('[data-slot="session-turns"] [data-message]')]
    const 盒盒 = 盒.getBoundingClientRect()
    const 右缘们 = (元素们: HTMLElement[]) => 元素们.map((元素) => 元素.getBoundingClientRect().right)
    return {
      /** 真滚动条的宽（`offsetWidth - clientWidth`；本元素没有边框）。 */
      滚动条宽: 盒.offsetWidth - 盒.clientWidth,
      盒左: 盒盒.left,
      盒右: 盒盒.right,
      盒顶: 盒盒.top,
      scrollTop: 盒.scrollTop,
      可滚量: 盒.scrollHeight - 盒.clientHeight,
      距底: 盒.scrollHeight - 盒.clientHeight - 盒.scrollTop,
      轨左: 轨?.getBoundingClientRect().left ?? Number.NaN,
      轨右: 轨?.getBoundingClientRect().right ?? Number.NaN,
      线右缘: 线.length ? Math.max(...右缘们(线)) : Number.NaN,
      线左缘: 线.length ? Math.min(...线.map((元素) => 元素.getBoundingClientRect().left)) : Number.NaN,
      刻度数: 线.length,
      /** 每枚短横线的**真实**宽高（用户 2026-10-14 定的：长 ×2/3、厚 ＋1px）＋ 它是不是「当前」。 */
      线们: 线.map((元素) => {
        const r = 元素.getBoundingClientRect()
        return { 宽: r.width, 高: r.height, 活跃: 元素.parentElement?.getAttribute("data-active") === "true" }
      }),
      正文右缘: 气泡.length ? Math.max(...右缘们(气泡)) : Number.NaN,
    }
  })

/** 索引面板 / 预览盒 / 行 —— 悬停那三步各要一份几何。 */
const 量浮层 = (page: Page) =>
  page.evaluate(() => {
    const 板 = document.querySelector<HTMLElement>('[data-slot="session-nav-panel"]')
    const 预览 = document.querySelector<HTMLElement>('[data-slot="session-nav-preview"]')
    const 行们 = [...document.querySelectorAll<HTMLElement>('[data-slot="session-nav-row"]')]
    return {
      面板个数: 板 ? 1 : 0,
      面板左: 板?.getBoundingClientRect().left ?? Number.NaN,
      面板右: 板?.getBoundingClientRect().right ?? Number.NaN,
      预览个数: 预览 ? 1 : 0,
      预览左: 预览?.getBoundingClientRect().left ?? Number.NaN,
      预览右: 预览?.getBoundingClientRect().right ?? Number.NaN,
      预览中: 预览 ? (预览.getBoundingClientRect().top + 预览.getBoundingClientRect().bottom) / 2 : Number.NaN,
      预览文字: 预览?.textContent ?? "",
      行数: 行们.length,
      行中们: 行们.map((行) => (行.getBoundingClientRect().top + 行.getBoundingClientRect().bottom) / 2),
      活跃刻度: [...document.querySelectorAll("[data-slot='session-nav-tick']")].findIndex(
        (枚) => 枚.getAttribute("data-active") === "true",
      ),
      活跃行: 行们.findIndex((行) => 行.getAttribute("data-active") === "true"),
    }
  })

/** 第 n 个用户气泡（`[data-message]`，`session-turn.tsx` 挂在消息容器上）此刻的顶边。 */
const 量第N个气泡 = (page: Page, 序号: number) =>
  page.evaluate((i) => {
    const 盒 = document.querySelector<HTMLElement>('[data-slot="session-turns"]')
    const 气泡 = document.querySelectorAll<HTMLElement>('[data-slot="session-turns"] [data-message]')[i]
    if (!盒 || !气泡) throw new Error(`没找到第 ${i} 个 [data-message] 气泡`)
    return { 气泡顶: 气泡.getBoundingClientRect().top, 盒顶: 盒.getBoundingClientRect().top }
  }, 序号)

/** 长句（>180 字、单行无换行）：③ 的截断要的就是它。 */
const 长句 =
  "这份资金分析请按账号把最近三个月的流水整理成表并按对手方聚合，同时标出每笔的摘要与余额".repeat(4) +
  "，另外附一张月度合计。"

test("索引轨（真栈）：落在滚动条内侧不压正文、悬停呼出与预览、点一条真跳过去且不被拽回", async ({ page }) => {
  test.setTimeout(180_000)

  await page.context().addCookies([{ name: "openhive_session", value: readStack().token, url: FRONT() }])
  await 压矮(page)
  const 会话 = await 建真会话(`索引轨·${Date.now()}`)
  // 三轮**先落库再进页面**：进来时 turn 区就已经是「三个用户轮次」的常态样子（页面只负责画出来）。
  await 落一轮(会话, `第一问·资金流向·${Date.now()}`)
  await 落一轮(会话, 长句)
  await 落一轮(会话, `第三问·话单·${Date.now()}`)

  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)
  await expect(page.locator("[data-slot='session-turns']")).toBeVisible()
  await expect(page.locator("[data-slot='session-turns'] [data-message]")).toHaveCount(3, { timeout: 30_000 })

  // 撑出滚动量（顺便把视野拉到底 —— 用户看最新那一轮的常态起点）。
  await 长高一截(page, 800)
  await expect.poll(async () => (await 量几何(page)).距底, { message: "前置：内容该把盒撑到滚得动，且视野贴底" }).toBeLessThan(4)

  // ── ① 那一列短横落在滚动条**内侧**的那条留白里 ────────────────────────────────
  const 几何 = await 量几何(page)
  // 落地就把实得几何打出来：这条判据的四个数（滚动条宽 / 盒右 / 线右缘 / 正文右缘）都是**量出来的**，
  // 留一行在报告里，下一轮谁改坏了这几个数能一眼看出是哪一个动的。
  console.log(`[索引轨] 实得几何=${JSON.stringify(几何)}`)
  expect(
    几何.滚动条宽,
    `前置：这一栏真的有滚动条（没有它，下面「不压滚动条」那条就是恒真的）｜${JSON.stringify(几何)}`,
  ).toBeGreaterThan(0)
  expect(几何.刻度数, "前置：三个用户轮次就该有三枚短横").toBe(3)
  // 被测属性一：短横的**右缘**不许越过滚动条的左缘（越过就是叠在滚动条上）。
  expect(
    几何.线右缘,
    `短横不该压在滚动条上｜滚动条宽=${几何.滚动条宽} 盒右=${几何.盒右} 线右缘=${几何.线右缘}`,
  ).toBeLessThanOrEqual(几何.盒右 - 几何.滚动条宽 - 1)
  // 被测属性二：短横的**左缘**不许越过正文的右缘（越过就是压着会话正文了）。
  expect(
    几何.线左缘,
    `短横不该压到正文上｜正文右缘=${几何.正文右缘} 线左缘=${几何.线左缘}`,
  ).toBeGreaterThanOrEqual(几何.正文右缘 - 1)

  // ── ①b 留白与短横尺寸（用户 2026-10-14 实报「短横压住输入输出的内容」） ────────────
  //
  // 用户原话两点：**内容离右栏边缘的间距增大 12px**、**短横长度缩到 2/3、厚度 ＋1px**。
  // 16 → 28px 的留白 ＋ 短横缩短（靠右对齐 ⇒ 左缘右移 5px）⇒ 内容与短横之间空出 **17px**
  // （与滚动条宽度无关：短横右偏移 = 滚动条宽＋2，正文右缘 = 盒右−滚动条宽−28 ⇒ 恒差 17）。
  expect(
    几何.盒右 - 几何.滚动条宽 - 几何.正文右缘,
    `正文右缘离盒右缘该是 28px（留白 16＋12）｜${JSON.stringify(几何)}`,
  ).toBeCloseTo(28, 0)

  const 活跃线 = 几何.线们.find((枚) => 枚.活跃)
  const 非活跃线 = 几何.线们.filter((枚) => !枚.活跃)
  // 14px × 2/3 ≈ 9.33 ⇒ 实现取 9（`toBeCloseTo(…, 0)` 容差 0.5，两值都收）
  expect(活跃线?.宽, `当前那枚短横该是 9px 长（原 14 × 2/3）｜${JSON.stringify(几何.线们)}`).toBeCloseTo(9, 0)
  expect(活跃线?.高, "当前那枚短横该是 3px 厚（原 2 ＋ 1）").toBeCloseTo(3, 0)
  非活跃线.forEach((枚, i) => {
    expect(枚.宽, `第 ${i + 1} 枚非活跃短横该是 8px 长（原 12 × 2/3）`).toBeCloseTo(8, 0)
    expect(枚.高, `第 ${i + 1} 枚非活跃短横该是 2px 厚（原 1 ＋ 1）`).toBeCloseTo(2, 0)
  })

  // ── ② 鼠标移到那一列上 ⇒ 索引面板出来，右缘与轨对齐（像从轨上展开） ──────────────
  await page.locator("[data-slot='session-nav']").hover()
  await expect(page.locator("[data-slot='session-nav-panel']")).toBeVisible({ timeout: 10_000 })
  const 板 = await 量浮层(page)
  expect(板.行数, "面板应当一行一轮").toBe(3)
  expect(板.面板右, `面板右缘该与轨右缘对齐（从轨上展开的样子）｜轨右=${几何.轨右}`).toBeCloseTo(几何.轨右, 0)

  // ── ③ 鼠标停在第二行上 ⇒ 预览往**左**弹出，内容是**那一行**的全文（长句截断 ＋「…」） ──
  const 行们 = page.locator("[data-slot='session-nav-row']")
  await 行们.nth(1).hover()
  await expect(page.locator("[data-slot='session-nav-preview']")).toBeVisible({ timeout: 10_000 })
  const 预 = await 量浮层(page)
  expect(预.预览右, `预览该弹在面板**左边**｜面板左=${预.面板左} 预览右=${预.预览右}`).toBeLessThanOrEqual(预.面板左)
  expect(预.预览文字.slice(0, 12), "预览弹的该是**第二行**那条（不是第一行）").toBe(长句.slice(0, 12))
  expect(预.预览文字.endsWith("…"), "长句该被截断并以「…」收尾").toBe(true)
  expect(预.预览中, "预览该对着它那一行的中线").toBeCloseTo(预.行中们[1] ?? Number.NaN, 0)

  // ── ③b 预览越出右栏的那一段**不许在右栏边界被裁掉**（2026-10-28 用户实报） ──────────────
  //
  // 用户原话：「显示完整输入信息没有在最前端，当 AI 助手宽度不够的时候，它会被中栏遮挡住」。
  // 修前实测的形状：预览 `left=926`、右栏卡左缘 `1081.5` ⇒ 越出 **155px**；越出那一片的
  // `elementsFromPoint` 栈顶是 `div[center-empty]`（中栏）、**预览不在栈里** ⇒ 不是「画上去被盖住」，
  // 是右栏壳（`three-pane-right-card` / `aside[three-pane-right]`，两层 `overflow: hidden`）在
  // 右栏边界把它**裁断了**——刀口正好落在右栏边界，看上去像被中栏挡住。
  // 判据：越出的那一段上，命中栈顶必须是预览自己。
  const 越界 = await page.evaluate(() => {
    const 预览 = document.querySelector<HTMLElement>('[data-slot="session-nav-preview"]')
    const 卡 = document.querySelector<HTMLElement>('[data-slot="three-pane-right-card"]')
    if (!预览 || !卡) throw new Error("没找到预览盒或右栏卡（选择器换地方了？）")
    const 预览盒 = 预览.getBoundingClientRect()
    const 卡盒 = 卡.getBoundingClientRect()
    const y = 预览盒.top + 预览盒.height / 2
    // 贴着预览左端 4px 取一点：这一段在修前**整段都在右栏卡之外**。
    const 探x = 预览盒.left + 4
    const 栈 = document.elementsFromPoint(探x, y).map((el) => {
      const slot = el.getAttribute("data-slot")
      return `${el.tagName.toLowerCase()}${slot ? `[data-slot="${slot}"]` : ""}`
    })
    return {
      预览左: 预览盒.left,
      预览右: 预览盒.right,
      卡左: 卡盒.left,
      y,
      探x,
      探x在卡外: 探x < 卡盒.left,
      栈顶: 栈[0] ?? "",
      栈,
    }
  })
  console.log(`[索引轨] ③b 越界实得=${JSON.stringify(越界)}`)
  expect(
    越界.探x在卡外,
    `前置：这一屏预览该真的越出右栏卡（不越界的话下面那条就是空转）｜${JSON.stringify(越界)}`,
  ).toBe(true)
  expect(
    越界.栈顶,
    `预览越出右栏的那一段该画得出来（栈顶应是它自己，不是中栏）｜${JSON.stringify(越界)}`,
  ).toBe('div[data-slot="session-nav-preview"]')

  // ── ④ 点第二行 ⇒ 强调色落到第二条 ＋ 视野真滚到**那一轮的气泡**上 ──────────────
  await 行们.nth(1).click()
  // 平滑滚动是动画 ⇒ 判据用 `poll` 等它落地（`#006-31`：等条件、不等时间）。
  await expect
    .poll(async () => Math.abs((await 量第N个气泡(page, 1)).气泡顶 - (await 量第N个气泡(page, 1)).盒顶), {
      message: "点第 2 条之后，第 2 轮的用户气泡该落到盒顶（真滚过去，不是换个强调色）",
    })
    .toBeLessThan(8)
  const 点后 = await 量浮层(page)
  expect(点后.活跃刻度, "强调色该落到**第 2 枚**短横上").toBe(1)
  expect(点后.活跃行, "面板里该是**第 2 行**带强调色").toBe(1)

  // ── ⑤ 跳走之后内容再长高 ⇒ 视野**不被拽回**底部（用户是自己选了看某一轮的） ────────
  const 跳后 = await 量几何(page)
  expect(跳后.距底, `前置：跳过去之后视野确实不在底部（否则下面那条没意义）｜${JSON.stringify(跳后)}`).toBeGreaterThan(
    100,
  )

  await 长高一截(page, 400)
  await expect
    .poll(async () => (await 量几何(page)).可滚量, {
      message: `前置：内容真的长高了（长高前 可滚量=${跳后.可滚量}）`,
    })
    .toBeGreaterThan(跳后.可滚量 + 200)

  const 之后 = await 量几何(page)
  // 「停在原处」最直接的形态是 **`scrollTop` 一字未动**（内容长高只让「距底」变大）。无脑跳到底的
  // 实现会把它打回底部（`scrollTop` 变回 ≈ 可滚量）⇒ 恰红这一条。⚠️ **不能写成「`scrollTop` ≈ 0」**：
  // 跳到的第 2 轮上面还有第 1 轮，`scrollTop` 本来就不是 0。
  expect(
    Math.abs(之后.scrollTop - 跳后.scrollTop),
    `用户点了索引去看某一轮 ⇒ 新内容不该把视野拽回底部｜跳后 scrollTop=${跳后.scrollTop}` +
      `｜长高后 scrollTop=${之后.scrollTop} 距底=${之后.距底}`,
  ).toBeLessThan(4)
})

/**
 * 把 `message-part.css:1221` 那条规则的**靶子结构**注进会话内容（`edit-tool > collapsible >
 * collapsible-trigger[aria-expanded=true]`）。**注入的是产品自己的选择器结构**，喂给真浏览器的是
 * 产品自己的 CSS —— 量的是真层叠，不是模拟。
 *
 * ⚠️ 本机没有模型 ⇒ 造不出**真**工具块（`noReply: true` 只落纯文本 part），所以只能这样把那条
 * CSS 规则摆到台面上。代价是：这条判据**同时守着上游那条 CSS** —— 它若被改（选择器或 z 值），
 * 下面那条前置断言（「注入头真的拿到了 sticky ＋ 正层级」）会红 ⇒ 提醒重新对齐（`#003-05`）。
 */
async function 注入吸顶折叠头(page: Page) {
  await page.evaluate(() => {
    const 内容 = document.querySelector<HTMLElement>('[data-slot="session-turns-content"]')
    if (!内容) throw new Error("没找到 [data-slot='session-turns-content']")
    const 块 = document.createElement("div")
    块.setAttribute("data-component", "edit-tool")
    块.innerHTML =
      '<div data-component="collapsible" class="tool-collapsible">' +
      '<div data-slot="collapsible-trigger" aria-expanded="true">（真实选择器结构的吸顶折叠头）</div>' +
      "</div>"
    内容.prepend(块)
    // 滚到顶 ⇒ 吸顶条落回它 sticky 的常态位置（贴滚动盒顶），与居中的索引面板重叠。
    const 盒 = document.querySelector<HTMLElement>('[data-slot="session-turns"]')
    if (盒) 盒.scrollTop = 0
  })
}

/**
 * 「呼出的索引面板没在最前面一层」——用户 2026-10-14 实报的第二条。
 *
 * ## 根因（2026-10-14 实测坐定，不是猜）
 *
 * 面板自己写着 `z-index: 20`，可它挂在一个 `z-index: 10` ＋ `position: absolute` 的壳里
 * （`position` 非 static ＋ `z-index` 非 auto ⇒ 浏览器把它当成一个 **stacking context**）
 * ⇒ 面板**对外**只有 **10**。而会话内容里有**两种自带 20 层**的吸顶条，都在同一个层叠上下文里
 * 跟它比：`message-part.css:1221`（编辑/写文件/打补丁工具块的折叠头）与 `session-turn.css:104`
 * （本轮改动表头），都是 `position: sticky` ＋ `z-index: 20` ⇒ **20 > 10 ⇒ 盖住面板**。
 * 实测（视口 1440×500）：注入头 `t=133..169`、面板 `t=155..283` ⇒ 重叠区取点，
 * `elementsFromPoint` 最上面的是 `collapsible-trigger`，面板的行被压在下面。
 *
 * ## 修法（2026-10-14）
 *
 * 载体（`session-nav.tsx` 的 `session-nav`，即上面那层 `absolute`）的层级 **10 → 30**：
 * 它才是与吸顶条同台比较的那一个（面板自己写多少都在它里面）。取 30 的边界见该文件注释
 * （高于会话内容里所有常驻元素、低于真浮层）。修后同一取点实得 `最上=session-nav-row`、
 * `最上是面板: true`（面板右缘同时因留白改动从 1400 移到 1388，重叠区随之右退）。
 *
 * ## 为什么 ① 段那条用例抓不到它
 *
 * 那条用例里的会话是内核 `noReply` 落的**纯文本**（本机没模型）⇒ 没有工具块 ⇒ 没有吸顶条。
 * 用户真实会话里**有**（他提问时正被盖住的正是「部分内容」= 这两种吸顶条）。
 */
test("索引面板不被会话内容里的吸顶条盖住（真栈）", async ({ page }) => {
  test.setTimeout(180_000)

  await page.context().addCookies([{ name: "openhive_session", value: readStack().token, url: FRONT() }])
  await 压矮(page)
  const 会话 = await 建真会话(`层叠·${Date.now()}`)
  await 落一轮(会话, `第一问·${Date.now()}`)
  await 落一轮(会话, `第二问·${Date.now()}`)
  await 落一轮(会话, `第三问·${Date.now()}`)

  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)
  await expect(page.locator("[data-slot='session-turns'] [data-message]")).toHaveCount(3, { timeout: 30_000 })
  await 长高一截(page, 800)
  await 注入吸顶折叠头(page)
  // 自动跟随的 `ResizeObserver` 可能把视野拉回底部 ⇒ 吸顶条就不在顶部了。等条件、不等时间
  // （`#006-31`）：钉住「真滚到了顶」再往下量。
  await expect
    .poll(async () => page.evaluate(() => document.querySelector<HTMLElement>('[data-slot="session-turns"]')!.scrollTop), {
      message: "前置：注入后该停在顶部（吸顶条才与面板重叠）",
    })
    .toBeLessThan(4)

  await page.locator("[data-slot='session-nav']").hover()
  await expect(page.locator("[data-slot='session-nav-panel']")).toBeVisible({ timeout: 10_000 })

  const 探 = await page.evaluate(() => {
    const 板 = document.querySelector<HTMLElement>('[data-slot="session-nav-panel"]')
    const 头 = document.querySelector<HTMLElement>('[data-component="edit-tool"] [data-slot="collapsible-trigger"]')
    if (!板 || !头) return { 有板: 板 !== null, 有头: 头 !== null }
    const r = 板.getBoundingClientRect()
    const h = 头.getBoundingClientRect()
    const t = Math.max(r.top, h.top)
    const b = Math.min(r.bottom, h.bottom)
    const l = Math.max(r.left, h.left)
    const rr = Math.min(r.right, h.right)
    const 重叠 = b > t && rr > l
    const cs = getComputedStyle(头)
    // `elementsFromPoint` 给的是 `Element[]`（不是 `HTMLElement[]`）⇒ 下面读记号走 `getAttribute`，
    // 不写 `as`（`no-unsafe-type-assertion`，也不该为了少一行把类型改窄）。
    const 栈 = 重叠 ? document.elementsFromPoint((l + rr) / 2, (t + b) / 2) : []
    return {
      有板: true,
      有头: true,
      头层级: { z: cs.zIndex, pos: cs.position },
      重叠,
      重叠区: 重叠 ? { t, b, l, rr } : null,
      最上: 栈.length
        ? (栈[0].getAttribute("data-slot") ?? 栈[0].getAttribute("data-component") ?? 栈[0].tagName)
        : null,
      最上是面板: 栈.length > 0 ? 板.contains(栈[0]) : false,
    }
  })
  console.log(`[层叠] 实得=${JSON.stringify(探)}`)
  expect(探.有头, "注入的吸顶折叠头该在 DOM 里").toBe(true)
  // 两条前置：诱饵**真的**拿到了产品 CSS 的层叠条件。少了它们，下面那条断言可能是空转
  // （`#005-47` / `#006-17`：缺陷态下，你搭的前提自己可能不成立）。
  expect(探.头层级?.pos, "前置：注入头得真拿到产品 CSS 的 position（否则本判据空转）").toBe("sticky")
  expect(Number(探.头层级?.z), "前置：注入头得真拿到产品 CSS 的正层级（否则本判据空转）").toBeGreaterThan(0)
  expect(探.重叠, "前置：吸顶条该与面板真有重叠区（否则「谁在上面」无从谈起）").toBe(true)
  expect(探.最上是面板, `面板不该被会话内容里的吸顶条盖住｜最上面是 ${探.最上}｜${JSON.stringify(探)}`).toBe(true)
})
