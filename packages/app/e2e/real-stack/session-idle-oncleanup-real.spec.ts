import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * `session.idle` 事件 ⇒ 控制台**不许**出现 Solid 的
 * `cleanups created outside a 'createRoot' or 'render' will never be run`（2026-10-13 用户 F12 实报）。
 *
 * ## 被测的是什么
 *
 * `context/notification.tsx` 的 `lookup`（上游文件，本仓逐字未改）在**流回调**里读
 * `serverSync().ensureDirSyncContext(directory)`：
 *
 * ```ts
 * const unsub = serverSDK().event.listen((e) => {          // ← 流回调：没有 Solid owner
 *   if (event.type !== "session.idle" && event.type !== "session.error") return
 *   handleSessionIdle(e.name, event, …)                     // → lookup(directory, sessionID)
 * })
 * ```
 *
 * 而 `ensureDirSyncContext` 是 `context/server-sync.tsx:734` 的
 * `createRefCountMap((dir) => …, (dir) => inner.disableMcp(dir), directoryKey)`，
 * 它**无条件**在返回闭包的第一行调 `onCleanup(...)`（`utils/refcount.ts`）。
 * 无 owner 时 Solid 报那条 warning，**并且**登记不上的那个释放回调永不执行
 * ⇒ `refCounts` 只增不减 ⇒ `remove`（`inner.disableMcp(dir)`）**永不跑**。
 * ⇒ 这不只是控制台一行字，是**该目录的 MCP 上下文泄漏**：每来一次 `session.idle` 就给它记一次引用。
 *
 * ## 为什么只有这一层量得到
 *
 * warning 的触发条件是「`onCleanup` 时 `getOwner() === null`」——这是 **Solid 运行时的 owner 语义**，
 * 而 owner 在 `await` / `.then` / **事件回调**里会丢。happy-dom 下同一段代码的 owner 传播未必同形，
 * 单测里断「有没有这条 warning」可能是**假绿**。这里在**真浏览器 ＋ 真栈**上跑，README 的坑
 * （`LEARNINGS #006-31`：等条件不等时间）都按实测来。
 *
 * ## 判据设计（2026-10-13 探针实测的数字，逐条对上）
 *
 * 只断「0 条 warning」是**不够**的：一个字都没发出去时它也是 0 条 —— 上一轮探针就这么假绿过
 * （`非 GET 外呼 0 条`、`右栏 turn 文本 = ""`，因为没选模型，提交**静默不发**，同 `#006-27`）。
 * 所以先钉两条**活体证据**，再断被测属性：
 *
 * 1. 模型钮必须**落定**（`svg[data-component="provider-icon"]` 出现）——在那之前
 *    `local.model.current()` 恒空、钮上是占位文案「Select model」，点候选**不生效**
 *    （实测：点了候选钮上还是「Select model」）；这一步与 `right-pane-slash-and-model-real.spec.ts`
 *    的 `等钮落定` 逐字同源。
 * 2. 提交后**真的有一条外呼** `POST …/prompt_async`。
 * 3. 助手回答**在内核里完成**（`GET /session/<id>/message` 里那条 `time.completed` 落地）——
 *    这是 `session.idle` 的前因，也是**内核的真相**，不依赖右栏的渲染形状。
 *
 * ## 探针实测（2026-10-13，本机真栈，端口 3013/4713）
 *
 * | 现场 | warning 条数 | 外呼 | 助手回答 |
 * |---|---|---|---|
 * | 正常态 | **1** | 1 条 `prompt_async` | 「好」 |
 * | 变异态（把 `lookup` 首行短路成 `return undefined`） | **0** | 1 条 | 「好」 |
 * | 消息没发出去（对照组：没选模型） | **0** | 0 条 | 空 |
 *
 * 第 3 行是「这条判据会假绿」的实证；第 2 行是「warning 确实出自那一句」的实证。
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

/** 底栏模型控件那颗钮（与 `right-pane-slash-and-model-real.spec.ts` 的 `模型钮` 同源）。 */
const 模型钮 = (面板: Locator) =>
  面板.locator(
    '[data-slot="session-hero"] [data-component="prompt-input-v2"] button[aria-label="Choose model"], [data-slot="session-hero"] [data-component="prompt-input-v2"] button[data-action="prompt-model"]',
  )
const 候选项 = (page: Page) => page.locator('[data-option-key]:not([data-option-key="action:manage"])')
const 搜索框 = (page: Page) => page.locator('input[placeholder="Search models"]')

/**
 * 等底栏那颗钮**落定**＝等 `local.model.current()` 认出模型（`svg[data-component="provider-icon"]` 出现）。
 *
 * 不落定就选不动模型（实测：点候选之后钮上仍是占位文案）⇒ 提交**静默不发**（`#006-27`）
 * ⇒ 下面那条「0 条 warning」变成一条恒真的空测量（`LEARNINGS #006-06`：判据先要有非零的量）。
 */
async function 等钮落定(钮: Locator) {
  await expect(
    钮.locator('svg[data-component="provider-icon"]'),
    "右栏认不出本栏的模型（`local.model.current()` 恒空 ⇒ 钮上是占位文案），此时选模型不生效",
  ).toHaveCount(1, { timeout: 90_000 })
}

test("`session.idle` 之后控制台不许出现「cleanups created outside a 'createRoot'」", async ({ page }) => {
  test.setTimeout(240_000)

  // 收集控制台里那条 warning（真栈里它由 Solid 运行时打，不在页面上可读 ⇒ 只能从 console 事件取）。
  const 告警: string[] = []
  page.on("console", (m) => {
    const t = `[${m.type()}] ${m.text()}`
    if (/cleanups created outside/.test(t)) 告警.push(t)
  })

  const 会话 = await 建真会话(`onCleanup 泄漏${Date.now()}`)
  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)

  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板, "右栏没挂起来").toBeVisible({ timeout: 30_000 })
  const hero = page.locator('[data-slot="session-hero"]')
  const 输入 = hero.locator('[data-component="prompt-input"]')
  await expect(输入).toBeVisible({ timeout: 30_000 })

  // ── 前置 ①：选中一个模型（否则提交**静默不发**，见文件头的探针实测第 3 行） ──────────────
  const 钮 = 模型钮(面板)
  await expect(钮, "右栏没有模型控件").toBeVisible({ timeout: 30_000 })
  await 等钮落定(钮)
  const 当前 = (await 钮.innerText()).trim()
  await 钮.click()
  await expect(搜索框(page), "模型弹层里没有搜索框（喂的不是原生 ModelSelectorPopoverV2）").toBeVisible({
    timeout: 30_000,
  })
  const 目标 = 候选项(page).filter({ hasNotText: 当前 }).last()
  await expect(目标, "模型弹层里一条候选都没有（沙箱里的 provider 目录没就绪）").toBeVisible({ timeout: 30_000 })
  const 选中 = ((await 目标.innerText()) ?? "").trim()
  await 目标.click()
  await expect(钮, `点了「${选中}」，钮上的字没变成它 ⇒ 本场根本没选中模型`).toHaveText(选中, {
    timeout: 30_000,
  })

  // ── 前置 ②：提交，并钉住「消息真的发出去了」 ─────────────────────────────────────────
  //    判据取**外呼**，不取「输入框空了」（后者在静默不发时也成立）。
  const 外呼: string[] = []
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (r.method() === "POST" && /\/prompt_async$/.test(u.pathname)) 外呼.push(u.pathname)
  })

  await 输入.click()
  await 输入.fill("你好，请只回一个字")
  await hero.locator('[data-action="prompt-submit"]').click()

  await expect
    .poll(() => 外呼.length, {
      message: `提交后没有任何 prompt_async 外呼 ⇒ 消息根本没发出去，下面那条「0 条 warning」会是空测量`,
    })
    .toBeGreaterThan(0)

  // ── 前置 ③：等助手回答**在内核里完成**（＝`session.idle` 的前因） ─────────────────────
  //    不用右栏的 DOM 当判据：右栏只给**用户消息**渲染一个 `session-turn`，助手回答落在
  //    同一轮里（实测 `session-turn` 数恒为 1 ⇒ 拿它等会红在**前置**上，读起来像别的问题）。
  //    改用内核做 oracle（探针实测的形状）：`GET /session/<id>/message` 回**裸数组**，
  //    助手那条带 `time.completed`。⚠️ 实测首条 warning 恰恰出现在此刻（提交后 **1042ms**）。
  await expect
    .poll(
      async () => {
        const r = await fetch(`${KERNEL()}/session/${会话}/message?directory=${encodeURIComponent(directory())}`, {
          headers: { Cookie: COOKIE() },
        })
        const rows = (await r.json()) as { info?: { role?: string; time?: { completed?: number } } }[]
        return rows.filter((m) => m.info?.role === "assistant" && m.info.time?.completed !== undefined).length
      },
      {
        message: "内核里没有一条已完成的助手回答 ⇒ `session.idle` 没走到（那条 warning 的触发路径没被激活）",
        timeout: 120_000,
      },
    )
    .toBeGreaterThan(0)

  // ── 被测属性 ────────────────────────────────────────────────────────────────────
  //    再等一个小窗口，让「应该出现的 warning」有机会出现（断言的是 0 条，多等只会让假绿更难藏）。
  //    窗口取 5s：实测它出现在 1.0s 上下，留 5 倍余量。
  await page.waitForTimeout(5000)

  expect(
    告警,
    `控制台出现了 ${告警.length} 条「cleanups created outside a 'createRoot' or 'render'」` +
      `（＝ notification.tsx 在流回调里读 ensureDirSyncContext，createRefCountMap 的 onCleanup` +
      ` 没有 owner：释放回调永不执行 ⇒ 该目录的 MCP 上下文泄漏）`,
  ).toEqual([])
})
