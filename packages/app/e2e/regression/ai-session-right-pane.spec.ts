import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

/**
 * 右栏「AI 会话」（006）在**真浏览器 ＋ 假后端**下的契约冒烟。
 *
 * ## 为什么要有这一条（缺口是哪一个）
 *
 * 006 的右栏有三层：
 * ① 纯函数（`projection.ts` / `route-session.ts` / `session-actions.ts`）——单测覆盖，有牙；
 * ② 组件（`SessionPanel` / `InstructionCardRow` / `SkillDrawer`）——happy-dom 组件测试覆盖；
 * ③ **生产组装那一层**（`layout-new.tsx` 的 `right={() => <AiSessionSlot />}` 起，经
 *    `AiSessionSlot` 的解析链到 `SessionPanel`）——**没有测试**。`ai-session-slot.tsx` 的文件头
 *    自己就写着「纯接线、挂不起来测（要活着的服务器）」，并把六处**只有读代码才看得见**的接线
 *    （④ 三根导航线 / ⑤ 两份在途守卫 / ⑥ 导出落盘）列在那儿。
 *
 * 本条把「要活着的服务器」这件事用**假后端**（`mockOpenCodeServer` 在浏览器里拦掉全部后端流量）
 * 满足掉，于是 ③ 第一次有了观测面。它不覆盖 ④⑤⑥ 的**行为**（那些仍然只有单测覆盖有判断的那一半），
 * 它覆盖的是这条链**真的接通了**：路由 → 会话 id → 目录 → 数据 → 面板。
 *
 * ## 最强的那条判据是哪一个
 *
 * `[data-slot="session-current"]` 显示的是**会话 payload 里的 title**。这条看着平平，其实是整条
 * 链的合流点：它非空 ⇒ ① 右栏问到了那场会话（`ServerSession.lineage.resolve`）；
 * ② 它拿会话身上的 `directory` 去取了那个目录的会话列表（`ensureDirSyncContext`）；
 * ③ 假后端按 `directory=` **过滤**了列表（`mock-server.ts`：`session.directory === directory`）
 * ——目录错一个字节，这个列表就是空的，`session-current` 就退回显示 `sessionID`。
 * ⇒ 一条断言同时钉住 006 的**设计断言**（`route-session.ts` 文件头：「新布局下目录不在 URL 里，
 * 目录必须再问一次会话」）。**URL 里没有目录可解**，这个 title 只可能来自会话 payload。
 *
 * ## 夹具从哪来（别从零搭）
 *
 * 逐字照同族 spec 的 harness（`#004-12`）：`e2e/regression/file-browser-sidebar-tab-switch.spec.ts`
 * 的 `setup()`（**新布局**那条 URL `/server/<base64 serverKey>/session/<id>` ＋
 * `opencode.window.browser.dat:tabs` 的初始 tab）＋ `mock-server.ts` 的 v2 protocol 形状。
 * ⚠️ **不能照抄 `session-request-docks.spec.ts` 的 URL**：那条走的是旧布局形态
 * `/<base64 dir>/session/<id>`，而 `route-session.ts` 明写它**不认**那种形态（新布局下会被
 * `NewLayoutLegacySessionRedirect` 重定向掉）⇒ 右栏在那条 URL 上**故意不亮**。
 *
 * ## 本机怎么跑（⚠️ 与 CI 的差异只有一处）
 *
 * `@playwright/test@1.59.1` 期望 `chromium_headless_shell-1217`，本机实装 `-1208` / `-1234`
 * ⇒ 默认 `launch()` 必失败（`npx playwright install chromium` 在本机约 18KB/s、要半小时，不可行）。
 * 故下面用**环境变量门控**顶一个已装的可执行文件：**CI 不设 `E2E_BROWSER` ⇒ 与上游行为完全一致**。
 *
 *   E2E_BROWSER="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" \
 *     bunx playwright test regression/ai-session-right-pane.spec.ts
 */
const directory = "C:/OpenHive/AiSessionPane"
const projectID = "proj_ai_session_pane"
const sessionID = "ses_ai_session_pane"
const title = "资金分析会话（右栏契约）"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({
  viewport: { width: 1440, height: 900 },
  // 见文件头「本机怎么跑」。CI 不设该变量 ⇒ 这一项不出现，行为与上游一致。
  ...(process.env.E2E_BROWSER ? { launchOptions: { executablePath: process.env.E2E_BROWSER } } : {}),
})

/**
 * 一条**带思考**的会话：user 提问 → assistant 先 reasoning 后 text。
 *
 * 形状照 `session-timeline-collapse-state.spec.ts` 的 `userMessage` / `assistantMessage`
 * （同族 harness，`#004-12`）——但注意 `mock-server.ts` 的 `currentMessage()` **只读**这几个字段
 * （`info.role` / `id` / `time` / `agent` / `modelID` / `providerID`，以及 `part.type` / `part.text`），
 * 所以这里的 `sessionID` / `messageID` / `parentID` 是为**读的人**留的：写清这条数据本来长什么样。
 * `part.id` 不给（`currentMessage` 不读它，reasoning 那条在 DTO 里就没有 id）。
 */
const 带思考的消息 = () => [
  {
    info: { id: "msg_think_user", sessionID, role: "user", time: { created: 1700000000000 } },
    parts: [{ type: "text", text: "帮我看看这个账户" }],
  },
  {
    info: {
      id: "msg_think_asst",
      sessionID,
      role: "assistant",
      time: { created: 1700000001000 },
      parentID: "msg_think_user",
      modelID: "test",
      providerID: "opencode",
      agent: "build",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      { type: "reasoning", text: "先查流水、再比对 IP 归属地……这段是思考，不该铺满右栏" },
      { type: "text", text: "结论：3 笔异常" },
    ],
  },
]

test("右栏在会话路由上从假后端契约里渲染出来", async ({ page }) => {
  const 后端请求: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.port !== new URL(server).port) return
    后端请求.push(`${request.method()} ${url.pathname}${url.search}`)
  })

  await setup(page)
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)

  // ① 三层组装接通了：`layout-new` → `AiSessionSlot`（`ready` 三样齐）→ `SessionPanel`。
  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()

  // ② 合流点（见文件头）：title 来自会话 payload ⇒ 目录是从会话身上解出来的、且列表契约被消费。
  await expect(面板.locator('[data-slot="session-current"]')).toHaveText(title)
  // 对照：中栏标题与右栏那一条是两个不同的投影，都该在（少一个说明挂错了栏）。
  await expect(page.locator('[data-slot="session-current"]')).toHaveCount(1)

  // ③ Hero 输入框（T010 / FR-007）——「对话优先」的视觉中心真的在。
  await expect(面板.locator('[data-slot="session-hero"] [data-component="prompt-input"]')).toBeVisible()

  // ④ T015 / T016 那几颗钮是真的接上了（钮在 ＝ 接线点没被删；钮背后的判断由单测钉）。
  for (const slot of ["session-new", "session-export", "session-delete"]) {
    await expect(面板.locator(`[data-slot="${slot}"]`)).toBeVisible()
  }

  // ⑤ 把「目录哪来的」直接记下来：右边那条链**问过会话**（`lineage.resolve` → `session.get`），
  //    再拿解出来的目录去**取列表**。⚠️ 这两个是观测到的**事实**，不是对 `right-pane-source.ts`
  //    的转述（`#004-04`：写「A 走的是 B」要去代码/实测核，不能照记忆）。按参数解析、不拼字符串，
  //    免得在编码形状上与实现耦合（`#002-06`：同一个形状别两处各写一份）。
  const 路径与查询 = 后端请求.map((r) => r.slice(r.indexOf(" ") + 1))
  expect(路径与查询).toContain(`/api/session/${sessionID}`)
  const 列表目录 = 后端请求
    .filter((r) => r.includes(" /api/session?"))
    .map((r) => new URL(`http://localhost${r.slice(r.indexOf(" ") + 1)}`).searchParams.get("directory"))
  expect(列表目录).toContain(directory)
})

/**
 * 思考全文的显示：`settings.general.showReasoningSummaries` 这根线**端到端**的观测面。
 *
 * ## 这条补的是哪个缺口
 *
 * 组件的两条测试（`session-panel.test.tsx` 的「思考过程的显示」那组）钉的是「**prop → 渲染**」；
 * 缺口在**它前面一段**：`ai-session-slot.tsx` 读设置、把值喂给 `SessionPanel` 的那一行。实测
 * 变异 M3（2026-10-11）：把那一行换成**写死的 `false`**，`tsgo -b` 与全部组件测试**照样全绿**
 * ——「slot 真的读了设置」当时**没有任何自动判据**。这条就把它补上：从 `localStorage` 里的
 * 设置出发，经真 `SettingsProvider` / 真 `AiSessionSlot` / 真 `SessionPanel` 到真 DOM。
 *
 * ## 为什么是假后端而不是真栈
 *
 * 被测性质**全在前端**（设置 → prop → 渲染），与内核会不会真思考**无关**；而真栈要造出
 * 一个 reasoning part，得先接一个假模型服务器（`test/real-stack/serve.ts` 目前没有这个口子）
 * ——那是为这条判据凭空造一套测试基建，换不来多一分的覆盖面。故按同族 spec 的既有 harness。
 *
 * ## 断言为什么是这个顺序
 *
 * 先等 `text-part` 落屏（**证明夹具真到了右栏**），再数 `reasoning-part`。反过来的话，
 * 「0 个」在消息还没加载时**恒真**——那是一条永远绿的假判据（`#002-06`）。
 */
test("右栏思考全文：设置关 ⇒ 不铺（0 个 reasoning-part），而回答照旧落屏", async ({ page }) => {
  await setup(page, { showReasoningSummaries: false, items: 带思考的消息() })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)

  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  // 先证明夹具到了（这条落了 ⇒ 消息真的过了一遍假后端到右栏）。
  await expect(面板.locator('[data-component="text-part"]')).toHaveCount(1)
  await expect(面板.locator('[data-component="text-part"]')).toContainText("结论：3 笔异常")
  // 再数思考：设置关着，思考**一个字都不该铺**。
  await expect(面板.locator('[data-component="reasoning-part"]')).toHaveCount(0)
})

test("右栏思考全文：设置开 ⇒ 照旧展开（反面，防「把思考一律藏掉」冒充修好了）", async ({ page }) => {
  await setup(page, { showReasoningSummaries: true, items: 带思考的消息() })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)

  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  await expect(面板.locator('[data-component="text-part"]')).toHaveCount(1)
  await expect(面板.locator('[data-component="reasoning-part"]')).toHaveCount(1)
})

async function setup(page: Page, options: { showReasoningSummaries?: boolean; items?: unknown[] } = {}) {
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "ai-session-pane",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: options.items ?? [] }),
  })

  await page.addInitScript(
    ({ directory, server, sessionID, showReasoningSummaries }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          general: {
            newLayoutDesigns: true,
            // `undefined` 时**不写这个键**：默认那条用例要保持「用户从没碰过这个开关」的原样。
            ...(showReasoningSummaries === undefined ? {} : { showReasoningSummaries }),
          },
        }),
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
    { directory, server, sessionID, showReasoningSummaries: options.showReasoningSummaries },
  )
}
