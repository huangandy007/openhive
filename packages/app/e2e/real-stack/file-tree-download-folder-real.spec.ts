import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { readZipEntries, readZipText } from "./zip-entries"

/**
 * 2026-10-20 · **打包下载**的真栈回归（文件夹 / 多选）。
 *
 * ## 为什么必须落真栈
 *
 * 这条路上有三件事只有真栈证得了：
 * ① 服务端真的产出了一个**可解压的 zip**（组件测试只到 Blob 为止）；
 * ② `Content-Length` / `x-openhive-file-count` 与真实字节对得上；
 * ③ 浏览器真的按 `Content-Disposition` 给出的名字落盘（`<a download>` 那一跳）。
 *
 * ## zip 用本地读取器解析
 *
 * `packages/app` 不依赖 zip.js；为此加依赖会动 `bun.lock`。见 `zip-entries.ts` 文件头。
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

const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/** 数**真发出去**的打包请求（判端口：页面同源打前门，内核自己也有一份同名出口）。 */
function 数打包请求(page: Page) {
  const 请求: Array<{ method: string; body: string | null }> = []
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (u.port === String(readStack().front) && u.pathname.endsWith("/openhive/file/archive")) {
      请求.push({ method: r.method(), body: r.postData() })
    }
  })
  return 请求
}

/** 右键某一项、点菜单里的「下载」（按文案定位；`data-slot` 会被覆盖，`#005-22`）。 */
async function 右键点下载(page: Page, 路径: string, 文案 = "下载") {
  await 行(page, 路径).click({ button: "right" })
  await page.locator("[role='menuitem']", { hasText: 文案 }).first().click()
}

/** 等下载事件并返回它——调用前先建 promise，别在点击之后才等（事件可能已经过去）。 */
const 等下载 = (page: Page) => page.waitForEvent("download", { timeout: 30_000 })

test("右键**文件夹**点「下载」⇒ 得到 `资料.zip`，包内结构与正文逐字正确", async ({ page, context }) => {
  const 甲 = await 建真项目(`打包下载·文件夹·${Date.now()}`)
  mkdirSync(path.join(甲.directory, "资料", "8·17"), { recursive: true })
  writeFileSync(path.join(甲.directory, "资料", "8·17", "话单.csv"), "主叫,被叫\n138,139\n")

  await 进项目(page, context, 甲.id)
  await expect(行(page, "资料")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "资料/8·17/话单.csv")).toBeVisible({ timeout: 30_000 })

  const 请求 = 数打包请求(page)
  const 下载事件 = 等下载(page)
  await 右键点下载(page, "资料")
  const 下载 = await 下载事件

  // ── 请求形状：一次 POST，带着选中集与包名 ──
  await expect.poll(() => 请求.length, { timeout: 15_000 }).toBe(1)
  expect(请求[0]!.method).toBe("POST")
  expect(JSON.parse(请求[0]!.body ?? "{}")).toEqual({ paths: ["资料"], name: "资料.zip" })

  // ── 落盘文件名 ──
  expect(下载.suggestedFilename()).toBe("资料.zip")

  // ── 包内容 ──
  const 包 = await 下载.path()
  expect(包, "浏览器应当给出一个临时文件路径").toBeTruthy()
  const entries = readZipEntries(包!)
  expect(entries.map((e) => e.name).sort()).toEqual(
    ["资料/", "资料/8·17/", "资料/8·17/话单.csv"].sort(),
  )
  expect(entries.find((e) => e.name === "资料/8·17/话单.csv")?.directory).toBe(false)
  expect(readZipText(包!, "资料/8·17/话单.csv")).toBe("主叫,被叫\n138,139\n")

  // ── 传输弹窗：停在完成态，摘要用服务端文件数与实际字节 ──
  const 传输 = page.locator("[data-slot='file-transfer-dialog']")
  await expect(传输.locator("[data-slot='file-transfer-title']")).toHaveText("下载完成", { timeout: 15_000 })
  await expect(传输.locator("[data-slot='file-transfer-summary']")).toHaveText(/^1 个文件 · /)
})

test("Ctrl 选中两个文件后右键已选中的行 ⇒ `下载选中的 2 项`，包内保留完整相对路径", async ({
  page,
  context,
}) => {
  const 乙 = await 建真项目(`多选打包${Date.now()}`)
  mkdirSync(path.join(乙.directory, "资料"), { recursive: true })
  mkdirSync(path.join(乙.directory, "账目"), { recursive: true })
  writeFileSync(path.join(乙.directory, "资料", "话单.csv"), "主叫,被叫\n138,139\n")
  writeFileSync(path.join(乙.directory, "账目", "报销.xlsx"), "假装的表格")

  await 进项目(page, context, 乙.id)
  await expect(行(page, "资料"), "顶层行应当在树上").toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "资料/话单.csv")).toBeVisible({ timeout: 30_000 })
  await expect(行(page, "账目/报销.xlsx")).toBeVisible({ timeout: 30_000 })

  await 行(page, "资料/话单.csv").click()
  await 行(page, "账目/报销.xlsx").click({ modifiers: ["Control"] })

  const 请求 = 数打包请求(page)
  const 下载事件 = 等下载(page)
  await 行(page, "资料/话单.csv").click({ button: "right" })
  const 菜单项 = page.locator("[role='menuitem']", { hasText: "下载选中的 2 项" })
  await expect(菜单项).toBeVisible()
  await 菜单项.click()
  const 下载 = await 下载事件

  await expect.poll(() => 请求.length, { timeout: 15_000 }).toBe(1)
  const 体 = JSON.parse(请求[0]!.body ?? "{}") as { paths: string[]; name: string }
  expect(体.paths).toEqual(["资料/话单.csv", "账目/报销.xlsx"])
  expect(体.name).toMatch(/^多选打包\d+-\d{8}-\d{4}\.zip$/)
  expect(下载.suggestedFilename()).toBe(体.name)

  const 包 = await 下载.path()
  expect(包, "浏览器应当给出一个临时文件路径").toBeTruthy()
  const entries = readZipEntries(包!)
  expect(entries.map((e) => e.name).sort()).toEqual(["账目/报销.xlsx", "资料/话单.csv"].sort())
  expect(readZipText(包!, "资料/话单.csv")).toBe("主叫,被叫\n138,139\n")
  expect(readZipText(包!, "账目/报销.xlsx")).toBe("假装的表格")

  const 传输 = page.locator("[data-slot='file-transfer-dialog']")
  await expect(传输.locator("[data-slot='file-transfer-summary']")).toHaveText(/^2 个文件 · /)
})
