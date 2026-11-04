import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * 2026-11-04 · **能力面板的 MCP 卡片**：与技能卡同高、简介两行截断、悬停出顶层详情。
 *
 * ## 为什么必须真栈
 *
 * 组件层（`capability-panel.test.tsx`）只能断 **className 机制**——happy-dom 不跑布局
 * （`#006-22`），「真的是 70px」「真的是两行」「详情真的画在别的容器之上」一个都量不出来。
 * 本 spec 在真浏览器里量真几何、真截断、真层叠。
 *
 * ## 数据从生产出口来
 *
 * MCP 走治理后台的真实流程：建草稿（指定张三）→ 提交审核 → 王五业务审 → 李四发布
 * （连接测试要打穿 fixture，同 `mcp-draft-publish-real.spec.ts`）。技能走内核的
 * `.opencode/skill/**\/SKILL.md` 发现链（同 `capability-hover-preview-real.spec.ts`）。
 * 不种 SQL，不直接写库（`#006-35` / `#006-28`）。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    alice: string
    admin: string
    adminToken: string
    business: string
    businessToken: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const 本目录 = path.dirname(fileURLToPath(import.meta.url))

/** 同 `mcp-draft-publish-real.spec.ts`：win32 下 node 的 `spawn` 不认裸 `/` 包装。 */
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

async function 打开资产治理(page: Page) {
  await 起页(page)
  await page.locator("[data-slot='topbar-user']").click()
  await page.locator("[data-slot='topbar-menu-item']", { hasText: "用户管理" }).click()
  await expect(page.locator("[data-slot='governance-console']")).toBeVisible()
  await page.locator("button[data-section='asset-governance']").click()
  await expect(page.locator("[data-slot='asset-governance']")).toBeVisible()
}

const 筛选 = (page: Page, value: string) =>
  page.locator("[data-slot='asset-filter-status']").selectOption(value)

const 行 = (page: Page, name: string) => page.locator("[data-slot='asset-row']", { hasText: name })

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

/** 建真项目（走内核生产出口，同 `capability-hover-preview-real.spec.ts`）。 */
async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await fetch(`${KERNEL()}/openhive/project`, {
    method: "POST",
    headers: { Cookie: `openhive_session=${readStack().token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = ((await 建.json()) as { id?: string }).id
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()

  const 列 = await fetch(`${KERNEL()}/openhive/project`, {
    headers: { Cookie: `openhive_session=${readStack().token}` },
  })
  const 行 = ((await 列.json()) as { id: string; directory?: string }[]).find((item) => item.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory").toBeTruthy()
  return { id: id!, directory: 行!.directory! }
}

test.describe("能力面板 MCP 卡片：同高、截断、悬停顶层详情", () => {
  let 试连: { url: string; child: ChildProcess }

  test.beforeAll(async () => {
    试连 = await 起试连服务器()
  })

  test.afterAll(() => {
    试连?.child.kill()
  })

  test("MCP 卡与技能卡同为 70px、简介两行截断、悬停详情画在最上层", async ({ page, context }) => {
    test.setTimeout(300_000)
    const 名称 = `E2E 能力卡 MCP ${Date.now()}`
    const 简介 = "MySQL、Postgres、Redis、Kafka、Milvus、OceanBase、ClickHouse… 一个工作台打通。查询、编辑、审计、同步；把结构化上下文交给编码 Agent，密码仍留在本机。"
    const 技能说明 = "按对手方聚合最近三个月的流水，标出每笔的摘要与余额，并给出月度合计。"

    // ── ① 治理后台：建 MCP（指定张三）→ 提交 → 业务审 → 发布 ─────────────────────
    await 作为(context, readStack().adminToken)
    await 打开资产治理(page)
    await page.locator("[data-slot='asset-create-mcp']").click()
    await expect(page.locator("[data-slot='mcp-create-form']")).toBeVisible()
    await page.locator("[name='mcp-create-name']").fill(名称)
    await page.locator("[name='mcp-create-description']").fill(简介)
    await page.locator("[data-slot='mcp-create-category']").selectOption("intelligence")
    await page.locator("[data-slot='mcp-create-user-search']").fill("张三")
    const 张三 = page.locator(`[data-slot='mcp-create-user-${readStack().alice}']`)
    await expect(张三).toBeVisible()
    await 张三.check()
    await page.locator("[name='mcp-create-url']").fill(试连.url)
    await page.locator("[name='mcp-create-header-key-0']").fill("Authorization")
    await page.locator("[name='mcp-create-header-value-0']").fill(请求头值)
    await page.locator("[data-slot='mcp-create-submit']").click()
    await expect(page.locator("[data-slot='mcp-create-form']")).toBeHidden()

    const 草稿行 = 行(page, 名称)
    await expect(草稿行.locator("[data-slot='asset-submit-review']")).toBeVisible()
    await 草稿行.locator("[data-slot='asset-submit-review']").click()
    await expect(page.locator("[data-slot='asset-notice']")).toContainText(`已提交审核「${名称}」`)

    await 作为(context, readStack().businessToken)
    await 打开资产治理(page)
    await 筛选(page, "in_review")
    const 待审行 = 行(page, 名称)
    await expect(待审行).toBeVisible()
    await 待审行.locator("[data-slot='asset-action-approve_business']").click()
    await page.locator("[data-slot='asset-confirm-submit']").click()
    await expect(page.locator("[data-slot='asset-notice']")).toContainText(`已通过审核「${名称}」`)

    await 作为(context, readStack().adminToken)
    await 打开资产治理(page)
    await 筛选(page, "pending_tech")
    const 发布行 = 行(page, 名称)
    await expect(发布行).toBeVisible()
    await 发布行.locator("[data-slot='asset-action-publish_tech']").click()
    await page.locator("[data-slot='asset-confirm-submit']").click()
    await expect(page.locator("[data-slot='asset-notice']")).toContainText(`已发布「${名称}」`, { timeout: 30_000 })

    // ── ② 张三的项目里种一个自带技能（生产发现链），用来量「同高」 ────────────────
    const 项目 = await 建真项目(`MCP 能力卡·${Date.now()}`)
    const 技能目录 = path.join(项目.directory, ".opencode", "skill", "资金速查")
    mkdirSync(技能目录, { recursive: true })
    writeFileSync(path.join(技能目录, "SKILL.md"), `---\nname: 资金速查\ndescription: ${技能说明}\n---\n\n# 资金速查\n`)

    await 作为(context, readStack().token)
    await context.addCookies([{ name: "openhive_project", value: 项目.id, url: FRONT() }])
    await page.addInitScript(() => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
      )
    })
    await page.goto("/")
    await page.locator("[data-slot='sidebar-tab'][data-tab='capability']").click()

    const 技能卡 = page.locator("[data-slot='capability-item-local']").first()
    await expect(技能卡, "项目里的自带技能该作为一张卡出现").toBeVisible({ timeout: 30_000 })
    const 技能高 = (await 技能卡.boundingBox())!.height

    // ── ③ MCP 卡：与技能卡同高、两行截断 ─────────────────────────────────────────
    await page.locator("[data-slot='capability-group-mcp']").click()
    const mcp卡 = page.locator("[data-slot='capability-mcp-item']", { hasText: 名称 }).first()
    await expect(mcp卡, "刚发布并授权给张三的 MCP 该出现在能力面板").toBeVisible({ timeout: 30_000 })

    const mcp量 = await mcp卡.evaluate((卡) => {
      const 简介 = 卡.querySelector<HTMLElement>("[data-slot='capability-mcp-desc']")!
      const r = 卡.getBoundingClientRect()
      const d = 简介.getBoundingClientRect()
      const cs = getComputedStyle(简介)
      return {
        卡高: r.height,
        简介高: d.height,
        lineClamp: cs.webkitLineClamp,
        scrollH: 简介.scrollHeight,
        clientH: 简介.clientHeight,
        全文: 简介.textContent,
      }
    })
    console.log(`[MCP 能力卡] 技能高=${技能高} 实得=${JSON.stringify(mcp量)}`)

    expect(mcp量.卡高, `MCP 卡该与技能卡同高｜技能=${技能高}`).toBeCloseTo(技能高, 0)
    expect(mcp量.卡高, "基准：能力面板的卡片高度是 70px（2026-11-04 实测）").toBeCloseTo(70, 0)
    expect(mcp量.lineClamp, "简介必须压成两行").toBe("2")
    expect(mcp量.简介高, "两行行高合计 32px ＋ 上间距 2px").toBeCloseTo(34, 0)
    // 真的截断了：DOM 里是全文，但可视高度装不下 ⇒ scrollHeight 必须更大。
    expect(mcp量.scrollH, `两行装不下这条简介才叫截断｜scrollH=${mcp量.scrollH} clientH=${mcp量.clientH}`).toBeGreaterThan(
      mcp量.clientH,
    )
    expect(mcp量.全文, "截断只是视觉的，DOM 里要保留全文（读屏可读）").toBe(简介)

    // ── ④ 悬停：右侧详情、置于最上层、不被左栏裁掉 ──────────────────────────────
    await mcp卡.hover()
    const 预览 = page.locator("[data-slot='capability-hover-preview']")
    await expect(预览).toBeVisible({ timeout: 10_000 })
    await expect(预览).toHaveText(简介)

    const 几何 = await page.evaluate(() => {
      const 预 = document.querySelector<HTMLElement>("[data-slot='capability-hover-preview']")
      const 卡 = document.querySelector<HTMLElement>("[data-slot='capability-mcp-item']")
      const 栏 = document.querySelector<HTMLElement>("[data-slot='three-pane-left-card']")
      if (!预 || !卡 || !栏) throw new Error("没找到预览盒 / MCP 卡 / 左栏卡（选择器换地方了？）")
      const p = 预.getBoundingClientRect()
      const c = 卡.getBoundingClientRect()
      const l = 栏.getBoundingClientRect()
      const 探x = p.right - 6
      const 探y = p.top + p.height / 2
      // 预览是 `pointer-events: none`，命中测试会跳过它；临时打开再量，量完还原
      //（同 `capability-hover-preview-real.spec.ts` ③ 的理由）。
      const 原 = 预.style.pointerEvents
      预.style.pointerEvents = "auto"
      const 栈 = document.elementsFromPoint(探x, 探y).map((el) => {
        const slot = el.getAttribute("data-slot")
        return `${el.tagName.toLowerCase()}${slot ? `[data-slot="${slot}"]` : ""}`
      })
      预.style.pointerEvents = 原
      return {
        预左: p.left,
        预中: p.top + p.height / 2,
        预宽: p.width,
        卡右: c.right,
        卡中: c.top + c.height / 2,
        栏右: l.right,
        探x,
        探x在栏外: 探x > l.right,
        栈顶: 栈[0] ?? "",
        栈,
      }
    })
    console.log(`[MCP 能力卡] 悬停几何=${JSON.stringify(几何)}`)

    expect(几何.预左, "详情该从卡片右缘再往右 8px 起").toBeCloseTo(几何.卡右 + 8, 0)
    expect(几何.预中, "详情纵向对着卡片中线").toBeCloseTo(几何.卡中, 0)
    expect(几何.预宽, "详情该是个有宽度的真盒子").toBeGreaterThan(100)
    expect(几何.探x在栏外, `前置：这一屏详情该真的越出左栏｜${JSON.stringify(几何)}`).toBe(true)
    expect(几何.栈顶, `越出左栏的那一段该画在最上层｜${JSON.stringify(几何.栈)}`).toBe(
      'div[data-slot="capability-hover-preview"]',
    )

    // ── ⑤ 移开 ⇒ 收掉 ───────────────────────────────────────────────────────────
    await page.locator("[data-slot='capability-group-mcp']").hover()
    await expect(预览).toHaveCount(0)
  })
})
