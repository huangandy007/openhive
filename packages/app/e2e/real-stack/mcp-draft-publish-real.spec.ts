import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * 2026-11-03 · 新建 MCP → 指定人员 → 提交审核 → 业务审 → 技术发布（真栈）。
 *
 * 这条切片钉住三个刚补上的入口，而且**只有真栈能钉住**：
 *
 * ① 新建表单里的「指定人员」不是摆设——选出来的人要经 `POST /openhive/assets/draft` 落成
 *    `auth.role_resource` 的 read 行，再经 `GET /openhive/assets/:id/readers` 回到发布弹窗预填；
 * ② 远程连接的请求头真的随连接下发——试连打到一个**只认对 Authorization** 的 fixture server：
 *    头丢了就是 401，发布直接失败；
 * ③ 作者动作「提交审核」在治理台草稿行上真的能按（按钮画出来 ≠ 服务端认这个作者）。
 *
 * 两道审核关沿用 serve.ts 的种子：李四（`gov-system-admin`）发布、王五（`gov-business-expert`）审核。
 * 两人的令牌都由内核侧 `signToken` 签发并交到 `STACK_FILE`——本 spec 不登录、不签名、不种 SQL。
 *
 * 为什么王五不走登录出口：PGlite 下「多连接 ＋ bun-sql 语句缓存」会撞
 * `42P05 duplicate_prepared_statement`（`packages/auth/src/db.ts` 有记），
 * 资产页并发请求 ＋ 一次登录就会把它打出来。令牌换成内核签发不改变
 * 「服务端按真实身份鉴权」这层证据，只是绕开 PGlite 的这个已知残留。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    sandbox: string
    admin: string
    adminName: string
    adminToken: string
    business: string
    businessName: string
    businessToken: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`

/** 本 spec 目录（playwright 把 spec 转成 CJS，`import.meta.dir` 不存在）。 */
const 本目录 = path.dirname(fileURLToPath(import.meta.url))

/**
 * bun 的**可执行文件**路径。
 *
 * playwright 的 worker 跑在 node 里，而本机 PATH 上的 `bun` 是 npm 装的 `.cmd` 包装
 * （node 的 `spawn` 不认裸 `bun`，win32 下报 ENOENT）。真正的 exe 藏在包装目录的
 * `node_modules/bun/bin/` 下——按 PATH 逐个探，避开「把某台机器的安装路径写进仓库」。
 * `BUN_BIN` 留给 CI / 特殊安装方式的覆盖口。
 */
const BUN =
  [
    process.env.BUN_BIN,
    path.join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe"),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .map((dir) => path.join(dir, "node_modules", "bun", "bin", "bun.exe")),
  ].find((candidate): candidate is string => candidate !== undefined && existsSync(candidate)) ?? "bun"

const 请求头值 = "Bearer e2e-secret"

async function 作为(context: BrowserContext, token: string) {
  await context.clearCookies()
  await context.addCookies([{ name: "openhive_session", value: token, url: FRONT() }])
}

/** 与 `governance-console-real.spec.ts` 的 `起页` 逐字同形（`#004-12`）。 */
async function 起页(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await expect(page.locator("[data-slot='topbar-user']")).toBeVisible()
}

/** 从顶栏真实入口打开治理后台，并切到「AI 资产治理」。 */
async function 打开资产治理(page: Page) {
  await 起页(page)
  await page.locator("[data-slot='topbar-user']").click()
  await page.locator("[data-slot='topbar-menu-item']", { hasText: "用户管理" }).click()
  await expect(page.locator("[data-slot='governance-console']")).toBeVisible()
  await page.locator("button[data-section='asset-governance']").click()
  await expect(page.locator("[data-slot='asset-governance']")).toBeVisible()
}

/** 按状态筛选，等列表把这一档拉回来。 */
async function 筛选(page: Page, value: string) {
  await page.locator("[data-slot='asset-filter-status']").selectOption(value)
}

const 行 = (page: Page, name: string) =>
  page.locator("[data-slot='asset-row']", { hasText: name })

/** fixture server：只认对 Authorization，否则 401（发布试连会因此失败）。 */
async function 起试连服务器(): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(
    BUN,
    ["run", path.join(本目录, "../../../asset-service/src/fixtures/mcp-http-probe-server.ts")],
    {
      cwd: path.join(本目录, "../../../asset-service"),
      env: { ...process.env, PORT: "0", REQUIRED_AUTH: 请求头值 },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("试连 fixture 15s 未 READY")), 15_000)
    let buffer = ""
    let 错误 = ""
    child.stderr.on("data", (chunk: Buffer) => {
      错误 += chunk.toString()
    })
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      const line = buffer.split("\n").find((item) => item.startsWith("READY "))
      if (line === undefined) return
      clearTimeout(timer)
      resolve(Number(line.slice("READY ".length)))
    })
    child.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`试连 fixture 退出，code=${code}；stderr=${错误}`))
    })
  })
  return { url: `http://127.0.0.1:${port}/mcp`, child }
}

test.describe("MCP 草稿 → 指定人员 → 提交 → 审核 → 发布", () => {
  let 试连: { url: string; child: ChildProcess }

  test.beforeAll(async () => {
    试连 = await 起试连服务器()
  })

  test.afterAll(() => {
    试连?.child.kill()
  })

  test.beforeEach(async ({ context }) => {
    await 作为(context, readStack().adminToken)
  })

  test("作者建草稿并选人 → 提交审核 → 王五业务审 → 李四发布（试连带请求头）", async ({ page, context }) => {
    const 名称 = `E2E 资金查询 MCP ${Date.now()}`
    await 打开资产治理(page)
    await page.locator("[data-slot='asset-create-mcp']").click()
    await expect(page.locator("[data-slot='mcp-create-form']")).toBeVisible()

    await page.locator("[name='mcp-create-name']").fill(名称)
    await page.locator("[name='mcp-create-description']").fill("按账户查流水（真栈 E2E）")
    await page.locator("[data-slot='mcp-create-category']").selectOption("intelligence")

    // 可见范围默认就是「指定人员」：选择器应当已经拉过组清单、并给出搜人框。
    await expect(page.locator("[data-slot='mcp-create-user-search']")).toBeVisible()
    await page.locator("[data-slot='mcp-create-user-search']").fill("王五")
    const 人 = page.locator(`[data-slot='mcp-create-user-${readStack().business}']`)
    await expect(人).toBeVisible()
    await 人.check()
    await expect(page.locator("[data-slot='mcp-create-users-selected']")).toContainText("王五")

    // 远程连接：地址 ＋ Authorization（值只认这一串，发布试连据此判真假）。
    await page.locator("[name='mcp-create-url']").fill(试连.url)
    await page.locator("[name='mcp-create-header-key-0']").fill("Authorization")
    await page.locator("[name='mcp-create-header-value-0']").fill(请求头值)
    await page.locator("[data-slot='mcp-create-submit']").click()

    // 建完自动切到草稿队列，并给出提示。
    await expect(page.locator("[data-slot='mcp-create-form']")).toBeHidden()
    await expect(page.locator("[data-slot='asset-notice']")).toContainText(`已新建 MCP 资产「${名称}」`)
    await expect(page.locator("[data-slot='asset-filter-status']")).toHaveValue("draft")

    // 作者动作：草稿行上出现「提交审核」。
    const 草稿行 = 行(page, 名称)
    await expect(草稿行).toBeVisible()
    await expect(草稿行.locator("[data-slot='asset-submit-review']")).toBeVisible()
    await 草稿行.locator("[data-slot='asset-submit-review']").click()
    await expect(page.locator("[data-slot='asset-notice']")).toContainText(`已提交审核「${名称}」`)

    // 提交后进入待业务审核队列（代码不是作者动作，界面上不该再有它）。
    await 筛选(page, "in_review")
    const 待审行 = 行(page, 名称)
    await expect(待审行).toBeVisible()
    await expect(待审行.locator("[data-slot='asset-submit-review']")).toHaveCount(0)

    // 王五（gov-business-expert）换成内核侧签发的真券过业务关。
    await 作为(context, readStack().businessToken)
    await 打开资产治理(page)
    await 筛选(page, "in_review")
    const 业务待审行 = 行(page, 名称)
    await expect(业务待审行).toBeVisible()
    await 业务待审行.locator("[data-slot='asset-action-approve_business']").click()
    await expect(page.locator("[data-slot='asset-confirm']")).toBeVisible()
    await page.locator("[data-slot='asset-confirm-submit']").click()
    await expect(page.locator("[data-slot='asset-notice']")).toContainText(`已通过审核「${名称}」`)

    // 李四发布：弹窗应预填作者创建时选的王五，且范围是「指定人员」。
    await 作为(context, readStack().adminToken)
    await 打开资产治理(page)
    await 筛选(page, "pending_tech")
    const 发布行 = 行(page, 名称)
    await expect(发布行).toBeVisible()
    await 发布行.locator("[data-slot='asset-action-publish_tech']").click()
    await expect(page.locator("[data-slot='asset-confirm']")).toBeVisible()
    await expect(page.locator("[data-slot='asset-publish-scope-targeted']")).toBeChecked()
    // 预填是真的从 `/readers` 读回来的：选择器还没搜过任何人，「已选」里就得有王五
    // （勾选框只在搜索结果里画，所以这里看的是 `users-selected` 而不是 checkbox）。
    await expect(page.locator("[data-slot='asset-publish-users-selected']")).toContainText("王五")
    await page.locator("[data-slot='asset-confirm-submit']").click()

    // 试连必须带着 Authorization 打穿 fixture（缺头 ⇒ 401 ⇒ 这里会停在错误上）。
    await expect(page.locator("[data-slot='asset-notice']")).toContainText(`已发布「${名称}」`, {
      timeout: 30_000,
    })
    await 筛选(page, "published")
    const 已发布行 = 行(page, 名称)
    await expect(已发布行).toBeVisible()
    await expect(已发布行).toContainText("指定人员")
  })
})
