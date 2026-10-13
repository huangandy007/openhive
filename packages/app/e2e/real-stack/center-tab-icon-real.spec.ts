import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-13 · **中栏 tab 前面的图标是个文件夹**（用户实报）。
 *
 * ## 用户实报（原话）
 *
 * 「在中栏打开的左栏文件，其 Tab 页面的标签，其前面（文件名）的图标是一个文件夹图标，
 * 我希望这个图标和左栏文件 Tab 页面对应文件前面的图标一致。」
 *
 * ## 根因（读代码定的，不是猜）
 *
 * tab 的图标取的是**来源模块**的图标（`tab-bar.tsx` 原来的 `MODULE_ICONS` ← `RAIL_ENTRIES`），
 * 而「项目管理」那颗入口的图标正是 `folder`（`rail/entries.ts`）⇒ 用户停在项目管理模块，
 * **每一张文件 tab 前面就都是一个文件夹**。这不是写错——`openhive-DESIGN.md` §4.5 原来就写着
 * 「tab 结构 ＝ **模块图标** + 文件名」，代码与规格一致；**是那条规格被用户改掉**。
 *
 * 修法：与左栏文件树用**同一个** `FileIcon`（`ui/components/file-icon`），按文件名 / 扩展名选
 * 图标；颜色仍按来源模块（用户裁定：形状换、颜色不换）。
 *
 * ## 为什么这条必须落真栈
 *
 * 三件要证的事，happy-dom 一件都证不了（`LEARNINGS #005-07` / `#006-33`：那里没有 CSS 引擎）：
 *
 * 1. **两处图标真的是同一枚**（`<use>` 的 href 尾段逐字相同）——「一致」是这条需求的原话，
 *    只有把左栏那一行与中栏那张 tab **同时**量出来才算证过。
 * 2. **颜色真的落到了像素上**。`FileIcon` 的 mono 变体画的是 `fill="currentColor"` 的遮罩矩形
 *    ——上游 `Icon` 读的是 `--icon-base`，它读的是 `currentColor`。**换了属性名**，而
 *    `currentColor` 的解析要 CSS 引擎：喂错属性名时**不报错、不变红**，只是颜色退回继承值。
 * 3. **静止态就可见**（不是只在 hover 时才画出来）。同族反例：2026-10-13 的隔线就是这样
 *    ——上游 `::after` 平时 `opacity: 0`，只传颜色等于「给一条看不见的线上了色」。
 *
 * ## 探针实测（2026-10-13，本机真栈）
 *
 * 见下方 test 里两处 `console.log` 的实得输出。
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

/** 备一个项目、一篇 md，并在中栏打开它（**不分屏**：要的是一张 tab、一棵树，越干净越好）。 */
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

interface 量到的 {
  左栏图标: string | null
  中栏图标: string | null
  中栏图标fill: string
  中栏图标色: string
  期望模块色: string
  中栏图标盒: { w: number; h: number }
}

/** 一次把两处图标＋颜色都量出来（同一帧、同一份 DOM，不留两次读数之间的缝）。 */
async function 量(page: Page): Promise<量到的 | null> {
  return page.evaluate(() => {
    // ⚠️ 泛型形式（不是 `as HTMLElement | null`）：`no-unsafe-type-assertion` 在 `page.evaluate` 里
    //    把 `document.querySelector(...)` 读成 `any`，断言会被判「from `any`」。
    const 左 = document.querySelector<HTMLElement>(
      "[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='黄怡群/123.md']",
    )
    const 中 = document.querySelector<HTMLElement>(
      "[data-component='tab-bar'] [data-slot='tab'] [data-slot='tab-icon']",
    )
    if (!左 || !中) return null

    const 尾段 = (root: HTMLElement) => {
      const use = root.querySelector("use")
      const href = use?.getAttribute("href") ?? null
      return href ? (href.split("#").pop() ?? null) : null
    }
    /** `FileIcon` 的 mono 变体：一个 `fill="currentColor"` 的遮罩矩形（`ui/components/file-icon.tsx`）。 */
    const 矩形 = 中.querySelector<SVGRectElement>("svg[data-component='file-icon'] rect")

    // 把模块身份色 token 在**当场**解出来（不写死 rgb：token 随主题变，写死就成了第二个真相源）。
    const 探针 = document.createElement("span")
    探针.style.color = "var(--v2-avatar-bg-gray)"
    document.body.appendChild(探针)
    const 期望 = getComputedStyle(探针).color
    探针.remove()

    const 盒 = 中.querySelector<SVGSVGElement>("svg[data-component='file-icon']")?.getBoundingClientRect()
    if (!盒) return null

    return {
      左栏图标: 尾段(左),
      中栏图标: 尾段(中),
      中栏图标fill: 矩形 ? getComputedStyle(矩形).fill : "",
      中栏图标色: getComputedStyle(中).color,
      期望模块色: 期望,
      中栏图标盒: { w: Math.round(盒.width), h: Math.round(盒.height) },
    }
  })
}

test("中栏 tab 的图标与左栏文件树**同一枚**，且颜色取来源模块的身份色（不是继承来的文字色）", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000)
  await 开一篇(page, context, `中栏图标·${Date.now()}`)
  await page.waitForTimeout(300) // 让图标那一帧落定（同 `#006-31`：等条件不等时间；这里只是让渲染追上）

  const 实得 = await 量(page)
  expect(实得, "应当同时量到左栏那一行与中栏那张 tab").not.toBeNull()
  console.log("[图标] 实得：", JSON.stringify(实得))

  // ── ① 用户那条原话：两处**一致**（同一次取值、同一帧） ──────────────────────────────
  expect(实得!.中栏图标, "中栏 tab 上应当有一枚文件图标").toBeTruthy()
  expect(
    实得!.中栏图标,
    `中栏 tab 的图标是 ${实得!.中栏图标}，左栏那一行是 ${实得!.左栏图标}——两处应当同一枚`,
  ).toBe(实得!.左栏图标)

  // ── ② 而且是**文件类型**的图标，不再是模块的 folder（用户实报的那个） ──────────────
  expect(实得!.中栏图标, "`.md` 应当选到 Markdown 图标").toBe("Markdown")
  expect(String(实得!.中栏图标).startsWith("Folder"), "不该再是文件夹图标").toBe(false)

  // ── ③ 颜色**真的落上去了**：`currentColor` 被解析成来源模块的身份色 ──────────────────
  expect(实得!.中栏图标fill, `矩形应当被解析成一个具体颜色，实得 ${实得!.中栏图标fill}`).toMatch(/^rgb/)
  expect(
    实得!.中栏图标fill,
    `图标色应当是来源模块的身份色 ${实得!.期望模块色}，实得 ${实得!.中栏图标fill}`,
  ).toBe(实得!.期望模块色)

  // ── ④ 判别对照：当场把那个 token 换掉，看图标跟不跟 ────────────────────────────────
  //
  //    ⚠️ **不能**拿「图标色 != 标题文字色」当判别句。实测本主题下
  //    `--v2-avatar-bg-gray` 与 `--v2-text-text-muted` **都是 #5C5C5C**
  //    （`ui/v2/styles/theme.css:46` / `:125`）⇒ 那条句子两边一起对、也一起错
  //    （`LEARNINGS #005-47` 那一类：期望值恰好等于下游的默认值，判据空转）。
  //
  //    换成 `#005-18` 那条对照纪律：同一份 DOM、同一套钩子，**只差 token 变没变**这一个变量。
  //    跟了 ⇒ 颜色确实由 `color: var(--v2-avatar-bg-gray)` 那条线送到底；
  //    没跟 ⇒ 它继承的是别处的文字色（只是碰巧同值），而那在别的主题下就会露馅。
  const 对照 = await page.evaluate(() => {
    const 根 = document.documentElement
    const 原 = 根.style.getPropertyValue("--v2-avatar-bg-gray")
    根.style.setProperty("--v2-avatar-bg-gray", "rgb(1, 2, 3)")
    const 中 = document.querySelector<HTMLElement>("[data-component='tab-bar'] [data-slot='tab'] [data-slot='tab-icon']")
    const 矩形 = 中?.querySelector<SVGRectElement>("svg[data-component='file-icon'] rect")
    const 换后fill = 矩形 ? getComputedStyle(矩形).fill : ""
    const 换后图层色 = 中 ? getComputedStyle(中).color : ""
    if (原) 根.style.setProperty("--v2-avatar-bg-gray", 原)
    else 根.style.removeProperty("--v2-avatar-bg-gray")
    return { 换后fill, 换后图层色 }
  })
  console.log("[图标] 换 token 后：", JSON.stringify(对照))

  // 先证「换确实生效了」（否则下面那条会被读成一个假红：可能只是 token 定义在更靠近的层）。
  expect(
    对照.换后图层色,
    `把 --v2-avatar-bg-gray 换成 rgb(1, 2, 3) 之后，图标层自己的 color 就该变——没变说明覆盖没生效，` +
      `这条对照无效（实得 ${对照.换后图层色}）`,
  ).toBe("rgb(1, 2, 3)")
  expect(
    对照.换后fill,
    `token 一换、图标色就该跟着换（实得 ${对照.换后fill}）——没跟说明 currentColor 那条链没接上`,
  ).toBe("rgb(1, 2, 3)")

  // ── ⑤ 尺寸仍是 16（`FileIcon` 自带 `width:16px;height:16px`，与左栏 `h-4 w-4` 同档） ──
  expect(实得!.中栏图标盒, "图标应当是 16×16").toEqual({ w: 16, h: 16 })

  await page.screenshot({ path: testInfo.outputPath("中栏图标.png") })
})
