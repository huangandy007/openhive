import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-12 · **中栏打开的文件没把中栏用起来**（用户实报）。
 *
 * ## 用户实报（原话）
 *
 * 「现在在中栏打开的文件，没有有效利用中栏的有效空间。左侧padding没有设置数据，这个要怎么解决。」
 *
 * 两条症状、两个根因，**必须分开钉**（`LEARNINGS #005-12`：同一个修法落在 N 处就写 N 条）：
 *
 * ## ① 宽度：内容栏被钉在 480px，卡片右侧七百多像素全空
 *
 * `center-split.tsx` 的「头栏」**不管有没有分屏**都拿一个**内联** `style={{ width: '480px' }}`
 * 配 `shrink-0`（默认值 `左右默认 = 480`）。于是**没分屏**时（屏幕上一栏）它仍然只占 480，
 * 剩下的卡片宽度不属于任何一栏 —— 2026-10-12 真栈实测：卡片 `1217px`、内容栏 `480px`，
 * **737px 空着**。用户截图上正文从 x≈320 折到 x≈800，正好 480，就是这么来的。
 *
 * 而内容自己并**没有**限宽：`binary-view.tsx:163` 的容器是 `w-full`，它的含块是内容栏
 * ⇒ 栏多宽、正文就多宽。所以「正文窄」不是正文的事，是**栏**的事。
 *
 * ## ② 内边距：内容区四边为零，正文贴卡片左缘
 *
 * `binary-view.tsx:163` 是 `class="w-full min-h-0 overflow-auto"` —— **四边零内边距**。
 * 同一个内容区的另外两张脸都留了：`degraded-view.tsx:82` 与 `code-view.tsx:135` 都是 `p-6`；
 * tab 栏的文字也缩进 16px（`tab-bar.tsx` 的 `px-1` ＋ tab 的 `px-3`）。
 * ⇒ 正文的左缘比它正上方那个 tab 的文字**还靠左 16px**，在卡片里贴边站。
 *
 * ## 为什么这两条必须落**真栈**
 *
 * 两条都是**几何**：happy-dom 没有布局引擎（`LEARNINGS #005-16` / `#006-06`），
 * 「栏有多宽」「正文在 x 等于几」在组件层**量不出来**——那里的 `getBoundingClientRect()`
 * 恒为零矩形，断言只会是空转的绿。真栈是唯一能给出这两个数的地方。
 */

/** 内容区的内边距。与 tab 栏文字的缩进同值（`tab-bar.tsx` 的 `px-1` ＋ tab 的 `px-3`）。 */
const 内容内边距 = 16

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = (建.body as { id?: string } | undefined)?.id
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()

  const 列 = await kernelJson("/openhive/project")
  const 行 = (列.body as { id: string; directory?: string }[] | undefined)?.find((行) => 行.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory").toBeTruthy()
  return { id: id!, directory: 行!.directory! }
}

async function 进项目(page: Page, context: BrowserContext, id: string) {
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: id, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

/** 树上一行。 */
const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/** 一篇短到**不折行**的 markdown：这条用例量的是盒子的左缘，正文长什么样无关紧要。 */
const 短诗 = "# 春天\n\n风解冰河的纽扣。\n"

/** 备一个项目、一篇 md，并在中栏把它打开。 */
async function 开一篇md(page: Page, context: BrowserContext, 项目名: string) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "黄怡群")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, "123.md"), 短诗)

  await 进项目(page, context, 甲.id)
  // ⚠️ 顺序不能换：`expand-all` 要等树**先落到 DOM 上**才有东西可展开。
  // 抢在树到之前点，它会**静默什么也没发生**（2026-10-12 实测：那一行仍折叠着，
  // 后面每条判据都红在「找不到行」上，读起来像判据写错了）。
  await expect(行(page, "黄怡群")).toBeVisible({ timeout: 30_000 })
  // 树默认全收缩（⑦-5），不展开就看不见 `黄怡群` 底下那一行。
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "黄怡群/123.md")).toBeVisible({ timeout: 30_000 })
  // 双击一行 ＝ 打开（`file-tree.tsx` 的 `双击`；与右键菜单第一项「打开」同一个 `onOpen`）。
  await 行(page, "黄怡群/123.md").dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })
}

interface 盒 {
  x: number
  y: number
  w: number
  h: number
  padLeft: string
}

/** 中栏这一串盒子的**真几何**（只有真浏览器给得出，见文件头）。 */
async function 量(page: Page) {
  return page.evaluate(() => {
    const 取 = (sel: string): 盒 | null => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
        padLeft: getComputedStyle(el).paddingLeft,
      }
    }
    const 正文 = document.querySelector("[data-component='richtext-view'] > *")
    return {
      卡片: 取("[data-slot='three-pane-center-card']"),
      内容栏: 取("[data-slot='center-pane'][data-pane='0']"),
      内容区: 取("[data-component='richtext-view']"),
      tab栏: 取("[data-slot='tab-bar']"),
      首个tab: 取("[data-slot='tab']"),
      正文左缘: 正文 ? Math.round(正文.getBoundingClientRect().x) : null,
    }
  })
}

test("未分屏时中栏内容栏**占满卡片**（不被钉在 480）", async ({ page, context }) => {
  await 开一篇md(page, context, `中栏占满·宽度·${Date.now()}`)
  const g = await 量(page)

  // 内容栏与卡片同宽。留 1px 给子像素舍入。
  expect(
    Math.abs(g.内容栏!.w - g.卡片!.w),
    `内容栏 ${g.内容栏!.w}px 应当占满卡片 ${g.卡片!.w}px（实测内容栏 x=${g.内容栏!.x}、卡片 x=${g.卡片!.x}）`,
  ).toBeLessThanOrEqual(1)
})

test("正文不贴卡片左缘：内容区按设计留内边距", async ({ page, context }) => {
  await 开一篇md(page, context, `中栏留白·内边距·${Date.now()}`)
  const g = await 量(page)

  expect(
    g.正文左缘! - g.卡片!.x,
    `正文左缘 ${g.正文左缘} 与卡片左缘 ${g.卡片!.x} 之间应当有 ${内容内边距}px 内边距`,
  ).toBe(内容内边距)
})
