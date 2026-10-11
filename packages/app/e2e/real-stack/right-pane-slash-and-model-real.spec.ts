import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 右栏「`/` 命令面板 ＋ 底栏模型选择器」的真栈验收（2026-10-11）。
 *
 * 为什么这一层非有不可（`LEARNINGS #005-07` / `#006-08`）：
 * - **池子的条数**：组件层的 `data.command` 是夹具喂的，真池子有多少条只有真内核答得出
 *   （探针实测 118 条）；
 * - **几何**：弹层在不在视口内、底栏那颗钮坐在哪一行，happy-dom 量不出来；
 * - **接缝**：`ai-session-slot.tsx` 那一层挂不起来测（要活着的服务器连接），
 *   「slot 有没有把 `useCommand()` 供上」只有真栈看得见。
 *
 * T5 是本轮**追加**的一条（控制器下达）：钉「会话记的」这一级——模型三源（本栏选的 →
 * 会话记的 → 应用默认）里 Task 4 审查发现「拆掉 `会话记的` 66 条组件测试仍全绿」的那一级
 * （没有组件守卫、是「合法 deferred」）。判据：用真内核建一场**带着非默认模型**的会话
 * （`deepseek/deepseek-flash`，默认是 `deepseek/deepseek-v4-pro`），**新开页面**（本栏
 * 「选过的」store 是内存态 ⇒ 一开页就空）落在这场上 ⇒ 底栏那颗钮显示这场会话里记的模型。
 * 变异验证在 ④ 步做：把 `ai-session-slot.tsx` 里 `会话记的:` 那一行拆掉 ⇒ T5 必须红
 * （回退到**空**——v1 下「应用默认」恒空（同 T3 注释 / F7），钮上同样没有 `flash` 字样。⚠️ 断言 `.toContain("flash")` 在「回退到某个默认模型」与「回退到空」两种情形下都成立，所以这条注释此前没让 T5 红、只是误导）。
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

/** 建一场**带着模型**的真会话（T5 用：`model` 形状 = 服务端 `Session.model` 的 `{ providerID, id }`）。 */
async function 建真会话带模型(title: string, model: { providerID: string; id: string }): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory())}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json" },
    body: JSON.stringify({ title, model }),
  })
  expect(res.ok, `真内核建会话（带模型）失败：${res.status}`).toBe(true)
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

/** 打开真栈、落在右栏、把 Hero 输入框里打上 `text`。 */
async function 开右栏并打字(page: Page, text: string) {
  const 会话 = await 建真会话("斜杠与模型验收会话")
  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)
  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  const 输入 = 面板.locator('[data-slot="session-hero"] [data-component="prompt-input"]')
  await expect(输入).toBeVisible()
  await 输入.click()
  await 输入.fill(text)
  await page.waitForTimeout(700)
  return { 面板, 输入 }
}

/**
 * 等 `/` 命令池稳定：服务端命令是 `void loadCommands(...)` **异步**填的（`state.md`「`sync.data.command`
 * 是异步填的」），v1 `/command` 3.9MB 清单要几秒才到 ⇒ 固定 700ms 不够。轮询 `custom.` 条目数，
 * 连续 4 拍不变才算稳（最多 ~30s）。
 */
async function 等命令池(page: Page, 面板: Locator) {
  let last = -1
  let stable = 0
  for (let i = 0; i < 60; i++) {
    const 条 = await 面板.locator('[data-suggestion-id^="custom."]').count()
    if (条 === last) {
      if (++stable >= 4) return 条
    } else {
      stable = 0
      last = 条
    }
    await page.waitForTimeout(500)
  }
  return last
}

/**
 * 底栏模型控件那颗钮。⚠️ 它不在 `[data-component="prompt-input"]`（那是**文本框**）里——
 * 原生 `PromptInputV2` 的外壳是 `<form data-component="prompt-input-v2">`，文本框与底栏那排
 * 按钮（Add images / Choose model / Send）是**兄弟**。按钮实测带 `aria-label="Choose model"`
 * （`session-ui/v2/components/prompt-input/index.tsx:577` 的 `aria-label={props.title}`）。
 */
function 模型钮(面板: Locator): Locator {
  return 面板.locator('[data-slot="session-hero"] [data-component="prompt-input-v2"] [aria-label="Choose model"]')
}

test("T1 · `/` 的池子＝服务端命令全集 ＋ 上游内建（不是本机那 2 条开发工具 skill）", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "/")
  await 等命令池(page, 面板)

  const 项 = await 面板.locator("[data-suggestion-id]").evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute("data-suggestion-id") ?? "", 文字: (el.textContent ?? "").trim() })),
  )

  // ① 条数：真内核那边 `GET /command` 实测 118 条。断言「≥100」是为了不把 118 这个数字焊死
  //    （沙箱里装了哪些 skill 会变），同时足以把「只有 2 条」那个旧缺陷钉死。
  expect(项.length, `池子只有 ${项.length} 条：${JSON.stringify(项.slice(0, 5))}`).toBeGreaterThanOrEqual(100)
  // ② 里面有**服务端命令**（`custom.` 前缀是 `右栏斜杠源` 给服务端那一支的 id 形状）。
  expect(项.filter((一条) => 一条.id.startsWith("custom.")).length).toBeGreaterThan(0)
  // ③ 里面有**上游内建**（id 不带 `custom.` 前缀的那一支）——这是旧的 skill 池子从来没有的一半。
  expect(项.filter((一条) => !一条.id.startsWith("custom.")).length).toBeGreaterThan(0)
  // ④ 每一行的 `label` 都带斜杠（原生浮层画的就是 `label`）。
  expect(项.every((一条) => 一条.文字.startsWith("/"))).toBe(true)

  console.log(`【T1 池子条数】${项.length} 条（自定义 ${项.filter((一条) => 一条.id.startsWith("custom.")).length} / 内建 ${项.filter((一条) => !一条.id.startsWith("custom.")).length}）`)
})

test("T2 · 选中一条**服务端命令** ⇒ token 留在正文里（不是选中即执行那一半）", async ({ page }) => {
  const { 面板, 输入 } = await 开右栏并打字(page, "/")
  await 等命令池(page, 面板)
  const 服务端那条 = 面板.locator('[data-suggestion-id^="custom."]').first()
  // 插入的是 `label` = `/${trigger}`（trigger = 命令名，`右栏斜杠命令` 拼的），**不是**整行 textContent
  // （textContent 还带着 title / description）。命令名 = `data-suggestion-id`（`custom.${item.name}`）去掉前缀。
  const 命令名 = ((await 服务端那条.getAttribute("data-suggestion-id")) ?? "").replace(/^custom\./, "")

  await 服务端那条.click()
  await page.waitForTimeout(300)

  // 正文里留下 `/<命令名>`（`machine.ts` 的 `replaceTrigger` 干的事），且**没有**发出去任何消息。
  expect(await 输入.innerText()).toContain(`/${命令名}`)
  expect(await 面板.locator('[data-slot="session-turns"] [data-component="session-turn"]').count()).toBe(0)
})

test("T3 · 底栏有模型控件：坐在输入框里、点开有候选", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "")
  const 钮 = 模型钮(面板)
  await expect(钮, "底栏没有模型控件").toBeVisible()

  const 盒 = await 钮.boundingBox()
  const 视口 = page.viewportSize()
  expect(盒, "控件没有盒").not.toBeNull()
  expect(盒!.width, "控件宽度为 0").toBeGreaterThan(0)
  expect(盒!.x, "控件跑到视口左边外面").toBeGreaterThanOrEqual(0)
  expect(盒!.x + 盒!.width, "控件跑到视口右边外面").toBeLessThanOrEqual(视口!.width)

  // ⚠️ 「按钮上写着当前模型」对**新会话**在**本部署（v1）**下不成立：v1 的 `loadProvidersQuery`
  // 只取 provider 清单、不取默认模型（`bootstrap.ts` 的 v1 分支 `normalizeProviderList(result.data!)`
  // 缺第三参 ⇒ `defaultModel: null`）⇒ 三级源里「应用默认」恒空、「当前模型键」回 `undefined`
  // ⇒ 钮上无字。这一半由 T5 钉（「会话记的」模型在重开时显示）。
  const 当前名 = (await 钮.innerText()).trim()
  console.log(`【T3 新会话模型钮】当前显示「${当前名}」（v1 无默认模型，预期为空）`)

  // 点开 ⇒ 菜单里有候选（候选条数 = 沙箱里已接入 provider 的模型数，这里只要求 > 0）。
  await 钮.click() // `MenuV2` 的触发器在真栈里认 `click`（真浏览器有完整的指针事件序列）
  await expect(
    page.locator('[role="menuitemradio"]').first(),
    `点开没有候选（沙箱里可能没接入 provider；当前显示「${当前名}」）`,
  ).toBeVisible({ timeout: 15000 })
  await page.keyboard.press("Escape")
})

test("T4 · 选另一支 ⇒ 按钮上的名字当场变（「管这场会话」的可见那一半）", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "")
  const 钮 = 模型钮(面板)
  await 钮.click()
  await expect(page.locator('[role="menuitemradio"]').first()).toBeVisible({ timeout: 15000 })

  const 候选 = page.locator('[role="menuitemradio"]')
  const 条数 = await 候选.count()
  test.skip(条数 < 2, "沙箱里只有一个模型可挑（挑不动）")
  // 新会话在 v1 下钮上无字（「当前」= ""）⇒ 这时挑**任意一支**即可（`hasNotText: ""` 会匹配不到任何东西）。
  // ⚠️ 用 `.last()` 不用 `.first()`：菜单有 50+ 条、往**上**开，最上面那几条（`first()`）会顶出视口
  // 上方 ⇒ Playwright 的 actionability 检查（visible/enabled/stable）恒不通过（实测 2 分钟超时）；
  // 离按钮最近的**最后一条**在视口内、可点。
  const 当前 = (await 钮.innerText()).trim()
  const 目标 = 当前 ? 候选.filter({ hasNotText: 当前 }).last() : 候选.last()
  const 目标名 = ((await 目标.textContent()) ?? "").trim() || (await 目标.getAttribute("aria-label")) || ""

  await 目标.click()
  await page.waitForTimeout(300)

  expect((await 钮.innerText()).trim()).not.toBe(当前)
  console.log(`【模型切换】「${当前}」 → 「${目标名}」`)
})

test("T5 · 会话记的模型：新开页面（本栏没选过）⇒ 底栏显示会话里记的模型", async ({ page }) => {
  // 建一场**带着非默认模型**的会话：默认是 `deepseek/deepseek-v4-pro`，这里记 `deepseek/deepseek-flash`。
  const 会话 = await 建真会话带模型("斜杠与模型验收会话-T5", { providerID: "deepseek", id: "deepseek-flash" })

  // **新开页面**：`选过的` 是 `AiSessionSlot` 里的内存 store（一开页就空）⇒ 三个模型源里只剩
  // 「会话记的」这一级能供模型。若这场会话的 `session.model` 没有记上，或「会话记的」这一级断了，
  // 底栏就回退到**空**（v1 下「应用默认」恒空，见 T3 注释 / F7），钮上同样不会出现 `flash` 字样。
  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)
  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  const 输入 = 面板.locator('[data-slot="session-hero"] [data-component="prompt-input"]')
  await expect(输入).toBeVisible()
  const 钮 = 模型钮(面板)
  await expect(钮, "底栏没有模型控件").toBeVisible()

  const 当前名 = (await 钮.innerText()).trim()
  console.log(`【T5 会话记的】底栏显示「${当前名}」`)
  // `deepseek-flash` 的显示名是「DeepSeek V4.1 Flash」；即便候选清单滤掉了它（deprecated），
  // 钮上会退回键 `deepseek/deepseek-flash` —— 两种形态都含 `flash`，而 v1 下「应用默认」恒空
  // （见 T3 注释 / F7）：变异（拆掉 `会话记的:` 那一行）回退到**空名**、同样不含 `flash` ⇒ 这里必须红。
  expect(当前名.toLowerCase(), `会话记的模型没生效：显示「${当前名}」`).toContain("flash")
})
