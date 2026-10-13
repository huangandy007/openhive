import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-13 · **分屏菜单点外面不消失**（用户实报）。
 *
 * ## 用户实报（原话）
 *
 * 「点击中栏的分屏按钮后，会弹出『左右分屏』、『上下分屏』的功能列表，目前没有选择任意一项，
 * 功能列表不会消失。我希望能够用鼠标点击功能列表以外区域任何位置，功能列表能够关闭消失。」
 *
 * ## 根因（读代码定的，不是猜）
 *
 * 分屏菜单（`[data-slot='split-menu']`）与溢出「⋯」菜单都是**手写 `<div>`**，只靠 `tab-bar.tsx`
 * 里那个 `菜单()` signal 开关——全文件**没有任何外部点击监听**（`grep` 实测：`pointerdown` /
 * `contains` / `EventListener` 一处都没有）。于是它们只在「再点一次触发钮」或「选中某一项」时关，
 * 点别处一直是开着的。修法照本仓浮层范式（`ui/src/components/popover.tsx:99`）：
 * 听 `document` 的 `pointerdown`（capture），落在**当前菜单那一区之外**就收。
 *
 * ## 为什么这条也要落真栈
 *
 * 组件测（`center/tab-bar.test.tsx`）用的是 `document.body.dispatchEvent`——它证的是「接线接上了」。
 * 真栈证的是另一层：**一次真指针点**（`page.mouse.click`）在**真布局**里落到菜单之外时，
 * 那条 document 级 capture 监听真的收到、菜单真的从 DOM 里摘掉。⚠️ 同族反例 `LEARNINGS #005-30`：
 * 若菜单是 `modal` 的，`locator.click()` 会被 inert 挡住、量到的是 Playwright 的规矩不是产品行为
 * ——本菜单是手写 div、非 modal，故这里直接用 `page.mouse.click` 走真指针。
 *
 * ## 探针实测（2026-10-13，本机真栈）
 *
 * 见下方两处 `console.log` 的实得输出。
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

/** 备一个项目、一篇 md，并在中栏打开它（要一张 tab ＋ 一颗分屏钮）。 */
async function 开一篇(page: Page, context: BrowserContext, 项目名: string) {
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
}

test("分屏菜单点**外面**就收（用户实报：此前点列表以外任何地方都不消失）", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000)
  await 开一篇(page, context, `分屏菜单收·${Date.now()}`)

  const 菜单 = page.locator("[data-slot='split-menu']")

  // ── 前提：只有一张 tab 也能点开分屏菜单（`664e55bd05` 取掉的那道闸，顺带再钉一次） ──────────
  await page.locator("[data-slot='split-button']").click()
  await expect(菜单, "点分屏钮应当弹出菜单").toBeVisible({ timeout: 10_000 })
  const 盒 = await 菜单.boundingBox()
  console.log("[分屏菜单] 打开后的盒子：", JSON.stringify(盒))

  // ── 主判据：一次**真指针**点在菜单之外 ⇒ 菜单从 DOM 里摘掉 ──────────────────────────────
  //
  // 取 (150, 400)：视口 1440×900，左栏 rail(56) + 侧栏(280) ⇒ x=150 落在左侧栏里，离右上角
  // 那个分屏菜单（`box` 的 x 应在 ~950+）很远。手写 div 菜单非 modal，不用绕 inert（`#005-30`）。
  await page.mouse.click(150, 400)

  await expect(菜单, "点菜单以外的位置之后，菜单应当消失").toHaveCount(0)

  // ── 反面对照：菜单已经没了，这一句不是「从没开过」的假绿（上面已断言开过） ─────────────────
  console.log("[分屏菜单] 点外面之后 count =", await 菜单.count())

  await page.screenshot({ path: testInfo.outputPath("分屏菜单-点外面之后.png") })
})
