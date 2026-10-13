import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-13 · **分屏的隔线不明显**（用户实报）。
 *
 * ## 用户实报（原话）
 *
 * 「目前分屏的隔线不明显，需要通过灰度颜色提高视觉识别。」
 *
 * ## 根因（读上游 `resize-handle.css` 定的，不是猜）
 *
 * 上游那条 `::after` 有**两条**默认，而调用方原来只补了第一条：
 *
 * ```css
 * [data-component="resize-handle"] {
 *   &::after { content: ""; opacity: 0; transition: opacity .15s }    ← ② 平时全透明
 *   &:hover::after, &:active::after { opacity: 1 }                    ← 只有 hover / 拖拽才有线
 * }
 * ```
 * ⚠️ 本文件是块注释（`/** … ` ＋ 星号斜杠）：正文里**不能**出现嵌套的注释收尾符
 * （`LEARNINGS #004-06`——那两枚字符会提前闭合块注释，其后整份文件被吞、报 `Unexpected token`；
 * 上面那段 css 里的行内注释本来是那两个字符夹着的，已改成箭头）。
 *
 * ① `::after` **没有 `background`** —— `three-pane.tsx` 早就踩过，修法是调用方给颜色；
 * ② `::after` 平时 **`opacity: 0`** —— 这一条**没人补**，于是 `center-split.tsx` 传的
 *    `after:bg-v2-border-border-strong` 只是**给了一条平时看不见的线上了色**：
 *    隔线在静止态**压根不存在**，鼠标移上去才出现一下。
 *
 * 修法从**调用方**补可见性（不动上游 CSS，第一号约束）：
 * `after:opacity-100` 常显 ＋ `after:bg-v2-border-border-strong`（20% alpha，静止态）
 * ＋ `hover:after:bg-v2-icon-icon-muted`（实心灰 #808080，悬停加深）。全是灰度，不碰品牌金。
 *
 * ## 为什么这条必须落真栈
 *
 * 三件要证的事，happy-dom 一件都证不了（`LEARNINGS #005-07` / `#006-33`：那里没有 CSS 引擎）：
 *
 * 1. **`after:opacity-100` 到底压没压住上游的 `opacity: 0`** —— 这是**层叠**问题，不是
 *    「类名挂对了没有」。上游 `resize-handle.css` 是以 `layer(components)` 进来的，而 layer 序是
 *    `theme, base, components, utilities` ⇒ utilities 层的 utility 应当压得住。**但这是推断**，
 *    真栈给的是浏览器算完的那一个数。⚠️ 同族反例 `#006-33`：那处上游规则**无层级**，utility
 *    压不住、必须写 `!`。两处长得像、结论相反 ⇒ 只能一处一处量。
 * 2. **静止态那条线的颜色**（`getComputedStyle(el, "::after")` 给的 backgroundColor）。
 * 3. **悬停时确实加深了**（同一处、只差「鼠标在不在上面」这一个变量）。
 *
 * ## 探针实测（2026-10-13，本机真栈）
 *
 * | 现场 | `::after` opacity | `::after` background | 宽 |
 * |---|---|---|---|
 * | 静止态（修后） | 见下方断言 | 见下方断言 | 3px |
 * | 悬停态 | 1 | 加深一档 | 3px |
 */

const readStack = (): { kernel: number; front: number; token: string } =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8"))

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

/** `body` 定型成 `unknown`（不是 `any`）——下面的取值一律走 `取字段`，别把 `any` 带出去。 */
async function kernelJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), "content-type": "application/json" },
  })
  const body: unknown = res.ok ? await res.json() : await res.text()
  return { status: res.status, body }
}

/**
 * 从真内核回的 JSON 里取一个字符串字段。
 *
 * ⚠️ 走 `Reflect.get` 而不是 `as { … }`：`no-unsafe-type-assertion` **连 `unknown` → 具体形状的收窄也报**
 * （「type … is more narrow than the original type」），不是只报 `any`。这条注释是清 warning 时记下的。
 */
function 取字段(b: unknown, 键: string): string | undefined {
  if (typeof b !== "object" || b === null || !(键 in b)) return undefined
  const v: unknown = Reflect.get(b, 键)
  return typeof v === "string" ? v : undefined
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = 取字段(建.body, "id")
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()

  const 列 = await kernelJson("/openhive/project")
  const 行 = Array.isArray(列.body) ? 列.body.find((r) => 取字段(r, "id") === id) : undefined
  const 目录 = 取字段(行, "directory")
  expect(目录, "列项目应当给出这一行的 directory").toBeTruthy()
  return { id: id!, directory: 目录! }
}

/** 树上一行。 */
const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/** 备一个项目、一篇 md、并在中栏打开它，然后**分屏**（左右）。 */
async function 开一篇并分屏(page: Page, context: BrowserContext, 项目名: string) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "黄怡群")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, "123.md"), "# 春天\n\n风解冰河的纽扣。\n")

  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: 甲.id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()

  // ⚠️ 顺序不能换：`expand-all` 要等树**先落到 DOM**（`center-pane-space-real.spec.ts:107` 记着这条）。
  await expect(行(page, "黄怡群")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "黄怡群/123.md")).toBeVisible({ timeout: 30_000 })
  await 行(page, "黄怡群/123.md").dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })

  // 分屏：栏尾那颗「分屏」钮 → 菜单里选「左右」。
  // ⚠️ 这条顺带钉住 2026-10-13 的另一处改动：**只有一张 tab 也能分屏**（门槛已删）。
  await page.locator("[data-slot='split-button']").click()
  const 项 = page.locator("[data-slot='split-menu-item'][data-split='左右']")
  await expect(项, "一张 tab 也该点得开分屏菜单").toBeVisible({ timeout: 10_000 })
  await 项.click()

  // ⚠️ 选择器**必须收窄到中栏分屏**：整页另有 2 个 `resize-handle`（three-pane 的左右栏、
  // 会话侧栏），不收窄就是 strict mode violation（2026-10-13 实测：resolved to 3 elements）。
  await expect(隔线(page)).toBeVisible({ timeout: 10_000 })
}

/** 中栏分屏那一条手柄（**不是**页面上另外那两个同组件实例）。 */
const 隔线 = (page: Page) => page.locator("[data-slot='center-split'] [data-component='resize-handle']")

interface 量到的 {
  opacity: string
  background: string
  width: string
  盒宽: number
  盒x: number
  盒y: number
  盒h: number
}

/** 取手柄 `::after`（那条 3px 的线）的**计算样式**＋手柄的几何。 */
async function 量隔线(page: Page): Promise<量到的 | null> {
  return page.evaluate(() => {
    // ⚠️ 泛型形式（不是 `as HTMLElement | null`）：`no-unsafe-type-assertion` 在 `page.evaluate` 里
    //    把 `document.querySelector(...)` 读成 `any`，断言会被判「from `any`」。
    const el = document.querySelector<HTMLElement>("[data-slot='center-split'] [data-component='resize-handle']")
    if (!el) return null
    const s = getComputedStyle(el, "::after")
    const b = el.getBoundingClientRect()
    return {
      opacity: s.opacity,
      background: s.backgroundColor,
      width: s.width,
      盒宽: Math.round(b.width),
      盒x: Math.round(b.x),
      盒y: Math.round(b.y),
      盒h: Math.round(b.height),
    }
  })
}

test("分屏隔线**静止态就画出来**（不再只在 hover 时出现），悬停再加深", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000)
  await 开一篇并分屏(page, context, `分屏隔线·${Date.now()}`)

  // 把鼠标挪到**远处**，确保量的是静止态（Playwright 的指针默认在 (0,0)，但别赌）。
  await page.mouse.move(5, 5)
  await page.waitForTimeout(300) // 让 `transition: opacity .15s` 落定

  const 静止 = await 量隔线(page)
  expect(静止, "分屏之后应当有一条 resize-handle").not.toBeNull()

  // ── ① 主判据：静止态可见（这一条就是「不明显」的根因） ─────────────────────────────
  //    上游默认是 `opacity: 0`；这条断的就是「utility 层压住了它」这个**层叠结论**。
  expect(
    静止!.opacity,
    `隔线静止态的 opacity 是 ${静止!.opacity}（实得 background=${静止!.background}）——` +
      `若是 "0"，说明 after:opacity-100 没压住上游 resize-handle.css 的 opacity: 0（层叠没生效）`,
  ).toBe("1")

  // ── ② 静止态是**灰的**（不是透明、也不是品牌金） ────────────────────────────────────
  expect(
    静止!.background,
    `隔线静止态应当是带透明度的灰（alpha-dark-20 / alpha-light-20），实得 ${静止!.background}`,
  ).toMatch(/^rgba\(/)

  // 截图存档（这张是给「看起来怎么样」用的；上面的计算样式才是判据）。
  const 图 = testInfo.outputPath("隔线-静止态.png")
  await page.screenshot({ path: 图 })

  // ── ③ 悬停**加深**（同一处、只差「鼠标在不在上面」这一个变量，见 `#005-18` 的对照要求） ────
  await page.mouse.move(静止!.盒x + 静止!.盒宽 / 2, 静止!.盒y + 静止!.盒h / 2)
  await page.waitForTimeout(300)
  const 悬停 = await 量隔线(page)
  expect(悬停, "悬停时应当仍量得到手柄").not.toBeNull()

  console.log("[隔线] 静止态：", JSON.stringify(静止))
  console.log("[隔线] 悬停态：", JSON.stringify(悬停))

  expect(
    悬停!.background,
    `悬停应当比静止态更深（静止 ${静止!.background} ⇒ 悬停 ${悬停!.background}）；` +
      `若两者相同，说明 hover:after:bg-* 没生效`,
  ).not.toBe(静止!.background)
  expect(悬停!.opacity, "悬停态也应当是可见的").toBe("1")
})
