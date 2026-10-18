import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-18 · **上传换成 XHR** 之后的真栈回归。
 *
 * ## 为什么必须落真栈
 *
 * 为了让弹窗画得出**上传字节进度**，发送层从 `fetch` 换成了 XHR（`openhive-file-ops.ts` 的
 * `sendViaXhr`）。这条换法有一条**只在真环境里才犯**的错：multipart 的 `boundary` 由平台写进
 * `content-type`，手写那个头就会丢 boundary ⇒ 服务端 `formData()` 当场解不开。而替身
 * （`假Xhr`）里同一个 `FormData` 两种写法都「成功」——**单测看不见这一条**。
 *
 * 所以这条 spec 判三件事：
 * ① 请求真发出去、服务端真收下（盘上出现字节**逐字相同**的文件）；
 * ② 传输弹窗在完成态**停住**（用户裁定：点「关闭」才收）；
 * ③ 文件树重取后真的多出那一行（上传成功会拨清单，`收下` 那条）。
 *
 * ⚠️ 不断言「正在上传」那一帧：小文件在这一枪里传得太快，抓那一帧是**跟挂具赛跑**，
 * 不是判产品（`LEARNINGS #006-31`：等条件，不等时间；能稳的就只有完成的**条件**）。
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

test("右键**文件夹**点「上传」⇒ 传输弹窗在完成态停住，字节真的落到那个目录、树上多出一行", async ({
  page,
  context,
}) => {
  const 甲 = await 建真项目(`上传传输·${Date.now()}`)
  mkdirSync(path.join(甲.directory, "资料"), { recursive: true })

  const 文件名 = `上传-${Date.now()}.csv`
  const 正文 = "主叫,被叫\n138,139\n"
  const 源 = path.join(tmpdir(), 文件名)
  writeFileSync(源, 正文)

  await 进项目(page, context, 甲.id)
  await expect(行(page, "资料")).toBeVisible({ timeout: 30_000 })

  // 走**用户那条路**：右键「上传」由接线层点隐藏的 `<input type=file>` ⇒ Playwright 收 filechooser。
  // Playwright 的官方写法：等待与点击**并发**挂上——filechooser 在菜单项点击的回调里同步打开，
  // 先 await 点击会把「等」挂晚。
  const [选文件] = await Promise.all([page.waitForEvent("filechooser"), 右键点菜单项(page, "资料", "上传")])
  await 选文件.setFiles(源)

  // ── ① 传输弹窗开出来，并停在「上传完成」（用户裁定：不自动关） ──
  const 传输 = page.locator("[data-slot='file-transfer-dialog']")
  await expect(传输, "上传应当开传输弹窗").toBeVisible({ timeout: 15_000 })
  await expect(传输.locator("[data-slot='file-transfer-title']")).toHaveText("上传完成", { timeout: 30_000 })
  await expect(传输.locator("[data-slot='file-transfer-summary']")).toContainText("1 个文件")

  // 停住：不点「关闭」它就一直在。
  await expect(传输).toBeVisible()
  await 传输.locator("[data-slot='file-transfer-close']").click()
  await expect(传输, "点「关闭」后传输弹窗应当收起来").toBeHidden()

  // ── ② 服务端真收下了：盘上的字节逐字相同（这条才证明 boundary 没丢） ──
  const 落点 = path.join(甲.directory, "资料", 文件名)
  await expect.poll(() => existsSync(落点), { message: "上传完成后盘上应当有那个文件" }).toBe(true)
  expect(readFileSync(落点, "utf8"), "落盘的正文应当与选中的文件逐字相同").toBe(正文)
  expect(existsSync(源), "源文件不该被动过").toBe(true)

  // ── ③ 文件树重取后多出那一行 ──
  // 树默认全收缩（`#005-36`）：先点开「资料」那一层的箭头，再等新行。
  await 行(page, "资料").locator("[data-slot='file-tree-chevron']").click()
  await expect(行(page, `资料/${文件名}`), "上传成功后树应当重取到新文件").toBeVisible({ timeout: 30_000 })
})

/**
 * 右键某一项、点菜单里的某一项。菜单项按**文案**定位（`LEARNINGS #005-22`：`data-slot` 会被覆盖）。
 * 菜单项在 `pointerup` 上才触发 `onSelect`（`#006-37`）——Playwright 的 `.click()` 发的正是真实指针序列。
 */
async function 右键点菜单项(page: Page, 路径: string, 文案: string) {
  await 行(page, 路径).click({ button: "right" })
  await page.locator("[role='menuitem']", { hasText: 文案 }).first().click()
}
