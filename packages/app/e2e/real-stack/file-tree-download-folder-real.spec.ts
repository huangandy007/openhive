import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · **前端拦下「下载文件夹」**的端到端回归（005 加固轮）。
 *
 * ## 用户原话
 *
 * 「我们暂时在前端下载文件夹时给出只能下载单个文件的弹窗交互，终止下载。如果只是下载单个文件就
 * 发行下载。」
 *
 * ## 为什么这条必须落真栈
 *
 * 判据「终止下载」＝「那个请求**根本没发出去**」，而**组件层证不了这件事**：
 * `file-tree.test.tsx` 数的是 `onDownload` 被喊了几次——它只能证明「这个组件没往上喊」，证不了
 * 「这条路上再没有别的东西把请求发了」。真栈这里数的是 `page` 上真发出去的
 * `GET /openhive/file/download`（数法与 `ai-session-real.spec.ts:109` 那处相同）。
 *
 * ⚠️ 第二条（单个文件）不是凑数：它给第一条的「0 次」**装上牙齿**——若那条计数根本没在工作
 * （pathname 对不上 / 端口判据写错），第一条的「0 次」会**假绿**。文件那条同时钉「照旧发行」，
 * 所以它的计数必须 ≥ 1，两条合起来才说明这个计数器**分得清两类**（`LEARNINGS #006-28`：
 * 一声不吭地宽容，就是把盲区伪装成通过）。
 *
 * ## 不量几何、不量落盘
 *
 * 「弹窗是不是真的弹出在页面居中」在 `file-tree-delete-dialog-real.spec.ts` 已经量过（同一个
 * `DialogV2` 壳、同一套 `dialog.show()`），这里不重复；「字节有没有真的落到盘上」那条路
 * （`<a download>` ＋ blob）本轮一个字没动，也不在判据里。
 */

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

/**
 * 下载弹窗——量的是**对话框那一层**（`DialogV2` 的 `[data-slot='dialog-content']`），不是我们自己
 * 那个 `[data-slot='file-download-dialog']` 壳：那个壳是 `display: contents`、**没有盒**，
 * `toBeVisible()` 这种要盒的判据在它身上**恒不成立**（`LEARNINGS #005-32`；删除那条 spec 的
 * `弹窗` 常量同理）。
 */
const 弹窗 = (page: Page) =>
  page.locator("[data-slot='dialog-content']").filter({ has: page.locator("[data-slot='file-download-dialog']") })

/**
 * 数**真发出去**的下载请求。判端口而不是判 host：页面同源打的是前门（3010），
 * 内核自己也有一份 `/openhive/file/download` 出口——只判路径会把「测试自己调的」也算进来。
 */
function 数下载请求(page: Page) {
  const 请求: string[] = []
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (u.port === String(readStack().front) && u.pathname.endsWith("/openhive/file/download")) 请求.push(u.search)
  })
  return 请求
}

/** 右键某一项、点菜单里的「下载」。菜单项按**文案**定位（`LEARNINGS #005-22`：`data-slot` 会被覆盖）。 */
async function 右键点下载(page: Page, 路径: string) {
  await 行(page, 路径).click({ button: "right" })
  await page.locator("[role='menuitem']", { hasText: "下载" }).first().click()
}

test("右键**文件夹**点「下载」⇒ 弹窗说清「只能下载单个文件」，且**一个下载请求都没发出去**", async ({
  page,
  context,
}) => {
  const 甲 = await 建真项目(`下载拦截回归·文件夹·${Date.now()}`)
  // 真目录＋里面的真文件：用户点的正是这种「有内容的文件夹」（空目录是另一回事，见
  // `file-tree-empty-dir-real.spec.ts`）。
  mkdirSync(path.join(甲.directory, "资料", "8·17"), { recursive: true })
  writeFileSync(path.join(甲.directory, "资料", "8·17", "话单.csv"), "主叫,被叫\n138,139\n")
  writeFileSync(path.join(甲.directory, "账目.xlsx"), "a\n")

  await 进项目(page, context, 甲.id)
  await expect(行(page, "资料")).toBeVisible({ timeout: 30_000 })

  const 下载请求 = 数下载请求(page)
  await 右键点下载(page, "资料")

  // ── 被测属性 ①：弹窗真的开出来，且说清是**哪一个**文件夹 ──
  await expect(弹窗(page), "对着文件夹点「下载」应当开出一条弹窗").toBeVisible()
  await expect(page.locator("[data-slot='file-download-name']")).toHaveText("资料")

  // ── 被测属性 ②：终止下载——这一层一个请求都没发出去 ──
  expect(下载请求, "文件夹这条路上一个 /openhive/file/download 都不该发出去（发出去必然 400）").toEqual([])

  // ── 收起弹窗 ≠ 下载：用户能做的只有「知道了」 ──
  await page.locator("[data-slot='file-download-ok']").click()
  await expect(弹窗(page), "点「知道了」后弹窗应当关掉").toBeHidden()
  expect(下载请求, "关掉弹窗之后也不该补发请求").toEqual([])

  // 纯读＋拦的动作不该有副作用：盘上那份原样还在。
  expect(existsSync(path.join(甲.directory, "资料", "8·17", "话单.csv")), "拦截不该动盘上的东西").toBe(true)
})

test("右键**单个文件**点「下载」⇒ 不出现「拦截」弹窗，请求照旧发出去（给上一条的「0 次」装上牙齿）", async ({
  page,
  context,
}) => {
  const 乙 = await 建真项目(`下载拦截回归·文件·${Date.now()}`)
  writeFileSync(path.join(乙.directory, "话单.csv"), "主叫,被叫\n138,139\n")

  await 进项目(page, context, 乙.id)
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })

  const 下载请求 = 数下载请求(page)
  await 右键点下载(page, "话单.csv")

  // 「照旧发行」：这次请求**必须**真的发出去（若发不出去，上一条的「0 次」就只是计数器坏了）。
  await expect
    .poll(() => 下载请求.length, { message: "单个文件这条路上请求必须真的发出去——否则上一条的 0 次没有意义" })
    .toBeGreaterThan(0)
  expect(decodeURIComponent(下载请求[0]!), "请求应当带着被点的那一项").toContain("path=话单.csv")

  // 而且**没有**被拦：文件这一支不该有 `file-download-dialog`（那张「只能下载单个文件」的）。
  await expect(弹窗(page), "单个文件不该被拦成弹窗").toBeHidden()

  // 传输本身另有**一张**弹窗（2026-10-18 用户裁定）：下载完成后停在「下载完成」，
  // 点「关闭」才收。它和「拦截」弹窗是两个槽位，`弹窗(page)` 那个过滤式判据对它是恒 Hidden 的。
  const 传输 = page.locator("[data-slot='file-transfer-dialog']")
  await expect(传输, "单个文件下载应当开传输弹窗").toBeVisible({ timeout: 15_000 })
  await expect(传输.locator("[data-slot='file-transfer-title']")).toHaveText("下载完成")
  await 传输.locator("[data-slot='file-transfer-close']").click()
  await expect(传输, "点「关闭」后传输弹窗应当收起来").toBeHidden()
})
