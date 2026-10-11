import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

/**
 * 「这场会话打不开」＋「复探 403/404 之后标签该怎么办」（2026-10-11）在**真浏览器 ＋ 假后端**下的接线判据。
 *
 * ## 补的是哪两个缺口（都是用户报的那串 F12 报错引出来的）
 *
 * **A · 整页空白**：会话取不到（归档 ⇒ 403）时，右栏的解析链只 `setDirectory(undefined)`，
 * 中栏那一页又被 `pageVisible` 藏掉 ⇒ **屏幕上什么都没有**，而服务端那句「项目已归档，请先找回」
 * 到不了用户眼前。修法是让解析链把失败**留在手里**（`right-pane-source.ts` 的 `failure`）⇒
 * 右栏画一张卡片（`right-pane-failure.ts` 解说法 / `right-pane-unavailable.tsx` 画）。
 *
 * **B · 23 条 404 幽灵标签**：`localStorage` 里存着 23 个指向**已经消失的临时沙箱**的会话标签，
 * 每次加载都逐个复探，而失败被 `.catch(() => undefined)` 吞掉、永不清掉 ⇒ 每刷新一次再 404 一轮。
 * 修法是复探失败时判一次「这个标签还活着吗」（`titlebar-tab-liveness.ts`）⇒ 404 收掉、403 留着。
 *
 * ## 为什么这两条必须落在这一层（而不是单测）
 *
 * 判断**已经**被单测钉死了：`right-pane-failure.test.ts`（5 条：403/404/断网/空体/合成 not-found）、
 * `titlebar-tab-liveness.test.ts`（6 条，含「403 **不许**剪」）、`right-pane-unavailable.test.tsx`
 * （4 条：画什么、钮接没接）。**这一段是它们前面那句「谁在什么时候调用它」**——纯接线，
 * 在 happy-dom 里挂不起来（要一串 provider ＋ 真路由 ＋ 真 `localStorage`）。
 * 与同族 spec 同因同法（`#004-12`）：`ai-session-right-pane.spec.ts` 也是为「生产组装那一层」
 * 才存在的。
 *
 * ## ⚠️ 夹具为什么是「假后端 ＋ 自己再拦一层」，不是改 `mock-server.ts`
 *
 * `mock-server.ts` 是**上游文件**（`git log upstream/dev -- e2e/utils/mock-server.ts` 有历史），
 * 改它＝给「最小化与官方合并冲突」这条第一号约束加冲突面；而它现有的 `/session/:id` 分支
 * 只回一种 200 体（`session ?? {}`）、`/api/session/:id` 分支的 404 体也不是本机实测的形状。
 * 故本 spec 在 `mockOpenCodeServer` **之后**再挂一条 `page.route`——Playwright 的路由是
 * **后注册先匹配**，所以这条只覆盖 `/session/<id>` 这一个形状，其余照旧落到假后端，
 * `mock-server.ts` 一个字节都不动。
 *
 * ## 两种错误是**逐字抄实测**
 *
 * - 归档会话 ⇒ `403` ＋ `{"error":"项目已归档，请先找回"}`（内核 4711 实测；归档中间件那句
 *   人话**只有这一个出处**）
 * - 不存在 ⇒ `404` ＋ `{"name":"NotFoundError","data":{"message":"Session not found: <id>"}}`
 *   （内核 4711 实测）
 *
 * ## ⚠️ 为什么把协议钉成 **v1**（这一条是本轮实测定的，不是随手抄的默认值）
 *
 * 同族 spec 大多用 `protocol: "v2"`，但**部署跑的是 v1**（`#006-27` 实测：v1 分支
 * `context/global-sync/bootstrap.ts:234`）。而这两种协议把**同一个 HTTP 错误交到手里的形状不同**
 * （2026-10-11 本轮探针实测，两行都是浏览器里真打印出来的）：
 *
 * | | 403（未声明状态） | 404（**已**声明状态） |
 * |---|---|---|
 * | **v1**（legacy SDK ＋ `throwOnError`） | `Error{cause:{status:403, body:{error:"项目已归档，请先找回"}}}` | `Error{cause:{status:404, body:{name:"NotFoundError",…}}}` |
 * | **v2**（`@opencode-ai/client`） | `ClientError{reason:"UnexpectedStatus", cause:{status:403}}`——**体被丢掉了** | **裸体** `{name:"NotFoundError",…}`——不是 `Error`、没有 `cause`、**没有状态码** |
 *
 * v2 那一行意味着：`ClientError` 的**体没了**（`packages/client/src/generated/client.ts:172`
 * 只在已声明状态上 `throw await json(response)`，其余 `new ClientError(…, {cause:{status}})`）
 * ⇒ 「项目已归档，请先找回」这句话在 v2 下**取不回来**。故断言服务端那句话只能在 v1 下做，
 * 而**v1 正是生产**。裸体那一支由单测钉（`titlebar-tab-liveness.test.ts` 的 v2 用例 ＋
 * `right-pane-failure.test.ts` 的同名用例），本条 spec 不重复钉它。
 *
 * ## ⚠️ 一条判据的射程（别指望这条 spec 判到的性质）
 *
 * 单测能分开「状态码那一支」与「谓词兜底那一支」（合成 not-found 没有 `cause.status`、
 * v2 裸体连 `Error` 都不是），本条 spec 判不了——因为 v1 的真实 404 **两条支路都认得出**。
 * 所以这里只判**接线通没通**（假后端真回 403/404 时，标签与卡片各自的结局对不对），
 * 分支判别留给定 `titlebar-tab-liveness.test.ts` / `right-pane-failure.test.ts`。
 *
 * ## 本机怎么跑（⚠️ 与 CI 的差异只有一处，同同族 spec）
 *
 *   E2E_BROWSER="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" \
 *     bunx playwright test regression/right-pane-unavailable.spec.ts
 *
 * 本机 `@playwright/test@1.59.1` 期望的 `chromium_headless_shell-1217` 没装（装它要半小时），
 * 故用**环境变量门控**顶一个已装的可执行文件：**CI 不设 `E2E_BROWSER` ⇒ 与上游行为完全一致**。
 */
const directory = "C:/OpenHive/RightPaneFail"
const projectID = "proj_right_pane_fail"
/** 正常会话：全程 200，作**对照**用（防「把标签全清了」冒充修好）。 */
const 正常会话 = "ses_fail_ok"
/** 归档会话：`/api/session/<id>` ⇒ 403（实测形态）。 */
const 归档会话 = "ses_fail_archived"
/** 幽灵会话：`/api/session/<id>` ⇒ 404（实测形态）——用户 `localStorage` 里那 23 条的同类。 */
const 幽灵会话 = "ses_fail_ghost"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const 标签存储键 = "opencode.window.browser.dat:tabs"

type 错误应答 = { status: number; body: unknown }

test.use({
  viewport: { width: 1440, height: 900 },
  // 见文件头「本机怎么跑」。CI 不设该变量 ⇒ 这一项不出现，行为与上游一致。
  ...(process.env.E2E_BROWSER ? { launchOptions: { executablePath: process.env.E2E_BROWSER } } : {}),
})

/** 标签条上那个可以点的东西。⚠️ `href` 在 `[data-titlebar-tab-link]` 上（`titlebar-tab-nav.tsx`），
 *  `data-titlebar-tab` 那层没有——查一个从不存在的名字的判据不是红、是**空转**（`#005-22`）。 */
const 标签 = (page: Page, sessionID: string) =>
  page.locator(`[data-titlebar-tab-link][href*="/session/${sessionID}"]`)

const 盘上的标签 = (page: Page) =>
  page.evaluate((key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "[]")
      return Array.isArray(value) ? (value as { sessionId?: string }[]) : []
    } catch {
      return []
    }
  }, 标签存储键)

test("会话取不到（403 归档）⇒ 右栏把那句服务端的话读出来，而不是整页空白", async ({ page }) => {
  const 后端 = await setup(page, {
    tabs: [归档会话],
    错误: { [归档会话]: { status: 403, body: { error: "项目已归档，请先找回" } } },
  })
  await page.goto(`/server/${base64Encode(server)}/session/${归档会话}`)

  const 卡片 = page.locator('[data-component="right-pane-unavailable"]')
  await expect(卡片).toBeVisible()
  // 先证明夹具真的开了火（403 真被回给了这场会话）——否则下面那条「卡片在」可能来自别的失败，
  // 而它长得一样（`#003-01`：先怀疑测量）。
  await expect.poll(() => 后端.some((r) => r.startsWith("403 ") && r.endsWith(`/session/${归档会话}`))).toBe(true)
  // 那句话**来自服务端**（`cause.body.error`），不是前端编的：假后端这里逐字写的就是归档中间件
  // 会回的那句。拆掉 `right-pane-failure.ts` 取 `body.error` 那一支 ⇒ 这里会读到「请求失败」。
  await expect(卡片.locator('[data-slot="unavailable-title"]')).toHaveText("项目已归档，请先找回")
  // 「这场会话打不开」与「还没问回来」在界面上相反：后者什么都不该画。这条防「pending 也画卡片」。
  // （反面：能画出来 ⇒ 那一刻 `ready` 必空 ⇒ 会话面板一个都不该有。）
  await expect(page.locator('[data-component="session-panel"]')).toHaveCount(0)
  // 标签确实开着（`localStorage` 里种了）⇒ 调用方要传「关闭标签」这颗钮。⚠️ 这是**接线**判据：
  // 钮在 ＝ `ai-session-slot.tsx` 的 `有标签()` 认出了这场会话。钮点了干什么由组件测试钉。
  await expect(卡片.locator('[data-slot="unavailable-close"]')).toBeVisible()
})

test("复探拿到 404 ⇒ 那个标签自己收掉（盘上的那份也要收，否则每次刷新再 404 一轮）", async ({ page }) => {
  const 后端 = await setup(page, {
    tabs: [正常会话, 幽灵会话],
    错误: {
      [幽灵会话]: { status: 404, body: { name: "NotFoundError", data: { message: `Session not found: ${幽灵会话}` } } },
    },
  })
  await page.goto(`/server/${base64Encode(server)}/session/${正常会话}`)

  // 先证明夹具真到了（对照那条标签在 ⇒ 标签条渲染了、复探真的发生过）。
  // ⚠️ 顺序不能反（`#002-06`）：「幽灵不在」在标签条还没渲染时**恒真**，那是一条永远绿的假判据。
  await expect(标签(page, 正常会话)).toHaveCount(1)
  await expect(page.locator('[data-component="session-panel"]')).toBeVisible()
  // 复探**真的发生过**、且真的回了 404（不然「幽灵被剪」可能只是它压根没被探过）。
  await expect.poll(() => 后端.some((r) => r.startsWith("404 ") && r.endsWith(`/session/${幽灵会话}`))).toBe(true)

  // ① 界面上：那个可以点的东西没了。
  await expect(标签(page, 幽灵会话)).toHaveCount(0)
  // ② 盘上：**这条才是根因的判据**。只收界面不收盘 ⇒ 下次刷新它又回来、又 404 一次，
  //    用户报的「每次打开一堆报错」原样复发。`persisted` 在本机浏览器里是同步存储，
  //    但仍用 `poll` 等条件不等时间（`#006-31`）。
  await expect
    .poll(async () => (await 盘上的标签(page)).filter((tab) => tab.sessionId === 幽灵会话).length, { timeout: 10_000 })
    .toBe(0)
  // ③ 对照：正常那个**不许**被顺手清掉（不然「把标签全清了」也能让上面两条绿）。
  await expect
    .poll(async () => (await 盘上的标签(page)).some((tab) => tab.sessionId === 正常会话), { timeout: 10_000 })
    .toBe(true)
})

test("复探拿到 403（归档）⇒ 标签**留着**：归档是冻结不是删除，找回项目后它要能点回来", async ({ page }) => {
  const 后端 = await setup(page, {
    tabs: [正常会话, 归档会话],
    错误: { [归档会话]: { status: 403, body: { error: "项目已归档，请先找回" } } },
  })
  await page.goto(`/server/${base64Encode(server)}/session/${正常会话}`)

  await expect(标签(page, 正常会话)).toHaveCount(1)

  // ⚠️ **先把失败等出来，再判「标签还在」**——直接 `toHaveCount(1)` 会在复探还没回来时就读数，
  // 那时标签当然在，是一句**没有判别力**的绿（`#006-31`：同一个冷启动窗既能让宽松断言假绿、
  // 也能让严格断言假红）。复探失败的可观测指纹是标签改显示「未知会话」（`missingSession` ⇒
  // `session.tab.unknown`）：等它出现 ＝ 等那一次 403 真的**落地了**。
  // 前一行是这条时序的**证据**（403 真的回给了这场会话），后一行才是「失败落了地」的**界面**证据——
  // 两条都留着：只留界面那条，一旦哪天 `missingSession` 换了文案，红的理由会指向错的地方。
  // 反过来，若修法错成「一律剪」（把 403 也当 404），这个节点会随标签一起消失 ⇒ 这一步**超时红**，
  // 这正是我们要它咬住的那条性质。
  await expect.poll(() => 后端.some((r) => r.startsWith("403 ") && r.endsWith(`/session/${归档会话}`))).toBe(true)
  await expect(标签(page, 归档会话).locator('[data-titlebar-tab-title]')).toHaveText("未知会话")
  await expect(标签(page, 归档会话)).toHaveCount(1)
  await expect
    .poll(async () => (await 盘上的标签(page)).some((tab) => tab.sessionId === 归档会话), { timeout: 10_000 })
    .toBe(true)
})

async function setup(page: Page, options: { tabs: string[]; 错误: Record<string, 错误应答> }): Promise<string[]> {
  // 探针（看后端到底被打了哪个地址、哪种状态码）——判据本身不依赖它，但它让「夹具没生效」立刻可见。
  const 后端: string[] = []
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (/^\/(api\/)?session\/[^/]+$/.test(url.pathname)) 后端.push(`${response.status()} ${url.pathname}`)
  })
  await mockOpenCodeServer(page, {
    protocol: "v1",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "right-pane-unavailable",
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
        id: 正常会话,
        slug: 正常会话,
        projectID,
        directory,
        title: "正常会话（对照）",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })

  // 逐字见文件头「夹具为什么是假后端 ＋ 自己再拦一层」。**必须在 `mockOpenCodeServer` 之后**
  // （后注册先匹配），且只咬 `/api/session/<单段 id>` 这一个形状：会话列表（`/api/session?…`）、
  // 消息（`/api/session/<id>/message`）都落到假后端去。
  await page.route(
    (url) => /^\/(api\/)?session\/[^/]+$/.test(url.pathname),
    async (route, request) => {
      const id = new URL(request.url()).pathname.split("/").at(-1) ?? ""
      const 应答 = options.错误[id]
      if (!应答) return route.fallback()
      await route.fulfill({
        status: 应答.status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(应答.body),
      })
    },
  )

  await page.addInitScript(
    ({ directory, server, tabs }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      // 语言钉成中文：产品的用户是民警，界面与文案都是中文；而**未指名语言时**这个 e2e 环境
      // 检测到的是 `en-US`（headless Chromium 的 `navigator.languages`）⇒ 标签条那句兜底文案
      // 会读成 "Unknown Session"。判据若写死中文就会**因为环境语言而红**（本轮实测踩到），
      // 钉死 locale 比把断言改成英文好：被测事实是「中文产品里那句话是什么」，不是「英文怎么说」。
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "zh" }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(tabs.map((sessionId) => ({ type: "session", server, sessionId }))),
      )
    },
    { directory, server, tabs: options.tabs },
  )

  return 后端
}
