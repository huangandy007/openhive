import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · 回归网：**从右键菜单进「重命名 / 新建」时，输入条要拿得到焦点**（用户实报）。
 *
 * ## 现象（用户原话）
 *
 * 「新建有问题，重命名不成功」——**工具栏**的 ＋ / ✏️ 都好好的，走**右键菜单**那两条则
 * 输入条看得见、字却进不去，磁盘一动不动。
 *
 * ## 根因（真栈实测，非推演）
 *
 * `packages/ui` 的 `ContextMenu` 默认 `modal: true` ⇒ Kobalte 的 `createFocusScope` 在菜单
 * 开着时**锁焦点**，并在**卸载那一刻**把焦点**归还**给「打开菜单时容器外的聚焦元素」——
 * 也就是被右键的那一行 `div[file-tree-row]`。焦点时间线实测（丙＝菜单那条路）：
 *
 * ```
 * 9018ms focus() → div[context-menu-item]{rename}
 * 9027ms focus() → input[file-tree-rename-input]   ⟵ inline-rename-input.tsx:40（★ 没跟着 focusin）
 * 9028ms focus() → div[context-menu-item]{rename}   ⟵ 7A3GDF4Y.jsx:146 onFocusOut
 * 9028ms focus() → div[context-menu-item]{rename}   ⟵ QZDH5R5B.jsx:391 onFocusIn
 * 9050ms focus() → div[file-tree-row](path=话单.csv) ⟵ 7A3GDF4Y.jsx:113（★ 真正的凶手）
 * 9051ms focusin  div[file-tree-row]
 * ```
 *
 * 同仓对照：`ai-session/session-list.tsx:230` 用的是 `<ContextMenu modal={false}>` ⇒ 那条路
 * 拿得到焦点。
 *
 * ## 判据（⑤ 门禁就是跑这个文件）
 *
 * 1. 菜单 ⇒「重命名」⇒ `document.activeElement` 是 `input[file-tree-rename-input]`；
 * 2. **裸键盘**（不先 focus）敲进去的字在输入条里；
 * 3. Enter 之后**磁盘上真的改了名**；
 * 4. 菜单 ⇒「新建文件」同上，磁盘上真的多了一个文件。
 *
 * ## ⚠️ 判据 4 **不是** `modal={false}` 的守护者（2026-10-11 变异实测，据实记）
 *
 * 把 `modal={false}` 拆掉做变异时：**判据 1-3（重命名）稳定红**，而**判据 4（新建）会假绿**。
 *
 * 根因是这条路径上的抢焦点是**竞态**而非确定性失败：`inline-rename-input.tsx:40` 的 rAF 与
 * Kobalte 焦点陷阱的抢回相差 1ms 级，谁赢看调度。同一份 spec 在「无 `modal={false}`」下
 * 跑两次，一次 create 红、一次 create 绿；而带焦点时间线钩子复现时稳定坏在
 * 「焦点被归还给 `div[file-tree-row]`」。
 *
 * ⇒ 判据 4 留着（它验证菜单⇒新建这条功能线，是正当的回归网），但**别拿它单独守护
 * `modal={false}`**——那个由判据 1-3 守（重命名输入条会自杀，结构性、稳定红）。
 *
 * ⚠️ 「裸键盘」是**要紧的**：Playwright 的 `.type()` / `.fill()` 会先把元素聚焦，
 * 于是「输入条在不在」与「字进不进得去」会分不出来（`LEARNINGS #006-18` 那一类：
 * 测得到 ≠ 用户用得到）。所以这里一律 `page.keyboard.type()`。
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

async function 建真项目(名: string) {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: 名, type: "private" }),
  })
  const id = (建.body as { id?: string }).id!
  const 列 = await kernelJson("/openhive/project")
  const directory = (列.body as { id: string; directory: string }[]).find((行) => 行.id === id)!.directory
  return { id, directory }
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

const 焦点是 = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el) return "<没有焦点>"
    const slot = el.getAttribute("data-slot")
    return `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}`
  })

/** 对某一行开右键菜单、点某个菜单项。 */
async function 走菜单(page: Page, 行路径: string, 菜单项: string) {
  await page
    .locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${行路径}']`)
    .click({ button: "right" })
  await page.waitForTimeout(300)
  await page.locator(`[data-slot='context-menu-item'][data-action='${菜单项}']`).click()
  await page.waitForTimeout(600)
}

test("菜单 ⇒ 重命名：输入条要拿到焦点，裸键盘的字要进得去、磁盘要真改名", async ({ page, context }) => {
  const 甲 = await 建真项目(`菜单焦点改名·${Date.now()}`)
  mkdirSync(甲.directory, { recursive: true })
  writeFileSync(path.join(甲.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 甲.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")).toBeVisible({
    timeout: 30_000,
  })

  await 走菜单(page, "话单.csv", "rename")

  const 输入条 = page.locator("[data-slot='file-tree-rename-input']")
  await expect(输入条, "重命名输入条应当出现").toBeVisible({ timeout: 5000 })

  // 判据 1：焦点落在输入条上
  const 焦 = await 焦点是(page)
  console.log(`[菜单⇒重命名] 焦点 = ${焦}`)

  // 判据 2：**裸键盘**（不先 focus）敲进去
  await page.keyboard.type("改名后.csv")
  await page.waitForTimeout(150)
  const 条里的字 = await 输入条.inputValue()
  console.log(`[菜单⇒重命名] 输入条里的字 = ${JSON.stringify(条里的字)}`)

  // 判据 3：Enter 之后磁盘真变了
  await page.keyboard.press("Enter")
  await page.waitForTimeout(2000)
  const 磁盘 = readdirSync(甲.directory)
  console.log(`[菜单⇒重命名] 磁盘 = ${JSON.stringify(磁盘)}`)

  expect(焦, "焦点应在重命名输入条上").toContain("file-tree-rename-input")
  expect(条里的字, "裸键盘的字应进到输入条里").toBe("改名后.csv")
  expect(磁盘, "磁盘上应当改名成功").toContain("改名后.csv")
  expect(磁盘, "旧名应当没了").not.toContain("话单.csv")
})

test("菜单 ⇒ 新建文件：输入条要拿到焦点，裸键盘的字要进得去、磁盘要真建出来", async ({ page, context }) => {
  const 乙 = await 建真项目(`菜单焦点新建·${Date.now()}`)
  mkdirSync(乙.directory, { recursive: true })
  writeFileSync(path.join(乙.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 乙.id)
  await expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='话单.csv']")).toBeVisible({
    timeout: 30_000,
  })

  await 走菜单(page, "话单.csv", "create-file")

  const 输入条 = page.locator("[data-slot='file-tree-create-input']")
  await expect(输入条, "新建输入条应当出现").toBeVisible({ timeout: 5000 })

  const 焦 = await 焦点是(page)
  console.log(`[菜单⇒新建文件] 焦点 = ${焦}`)

  await page.keyboard.type("菜单建的.csv")
  await page.waitForTimeout(150)
  const 条里的字 = await 输入条.inputValue()
  // 落在哪个目录＝右键那一行所在的目录（话单.csv 在根 ⇒ 建在根）
  console.log(`[菜单⇒新建文件] 输入条里的字 = ${JSON.stringify(条里的字)}`)

  await page.keyboard.press("Enter")
  await page.waitForTimeout(2000)
  const 磁盘 = readdirSync(乙.directory)
  console.log(`[菜单⇒新建文件] 磁盘 = ${JSON.stringify(磁盘)}`)

  expect(焦, "焦点应在新建输入条上").toContain("file-tree-create-input")
  expect(条里的字, "裸键盘的字应进到输入条里").toBe("菜单建的.csv")
  expect(磁盘, "磁盘上应当建出来").toContain("菜单建的.csv")
})
