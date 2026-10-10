import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · **右键菜单「文件路径」真的把字放进了系统剪贴板**（005 加固轮 ⑦-⑧）。
 *
 * ## 用户实报（原话）
 *
 * 「我需要你在文件Tab页面的右键弹窗中添加『文件路径』功能…选定『文件路径』按钮后，即复制该文件/文件夹的
 * 路径信息，此时我就可以把路径粘贴到右栏的AI会话文本框中，为AI指定对应的文件/文件夹信息。」
 *
 * ## 为什么这一条必须落**真栈**（组件层那 4 条不管什么用）
 *
 * 组件层的判据走的是 `navigator.clipboard.readText()`——**happy-dom 自己那份内存里的剪贴板**
 * （2026-10-11 实测：write → read 能原样读回）。它证明的是「我们调用了写剪贴板的那条路」，
 * **不是**「字真的进了**操作系统的**剪贴板」——后者要真浏览器 ＋ `clipboard-read` / `clipboard-write`
 * 权限才谈得上，这也正是用户唯一在意的那件事（他要**粘贴**到会话框里）。
 * 同族的坑见 `LEARNINGS #006-12`（mock 给 200、真后端给 500 那种契约漂移）。
 *
 * ## 两条判据、两个动作对象
 *
 * ① **文件** ⇒ 剪贴板里是它在项目内的相对路径（`资料/8·17/话单.csv`）；
 * ② **目录** ⇒ 尾上补一个斜杠（`资料/8·17/`）。
 * 两条都得走，因为「目录」这一支与「文件」不是同一段代码（尾斜杠只在目录上补），
 * 而目录又恰是 `copy` / `move` 两项**禁用**的场合——`#005-12`：同一个修法落在 N 个动作上就写 N 条。
 *
 * ## 剪贴板是**全局态**，所以先放哨兵
 *
 * 不清就先复制的话，「读回来是对的」可能只是上一轮（或上一次跑）的遗留 ⇒ 每条用例先写一句哨兵、
 * **断言哨兵真的进去了**，判据才有判别力（组件层那条「不是上一次的残留」在屏幕之外的另一半）。
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

/** 系统剪贴板里现在是什么字（需要 `clipboard-read` 权限，见文件头上的 `test.use`）。 */
const 读剪贴板 = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

const 哨兵 = "哨兵：没被碰过才对"

/** 先把哨兵放进剪贴板，并**验证它真的进去了**——否则「读回来是对的」没有判别力。 */
async function 放哨兵(page: Page) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), 哨兵)
  expect(await 读剪贴板(page), "前提：哨兵得真的写进系统剪贴板，这条判据才谈得上判别力").toBe(哨兵)
}

/** 一棵 `资料/8·17/话单.csv` 的树，并把深层那一行打开（默认全收缩，⑦-5）。 */
async function 备好树(page: Page, directory: string, 要看到的行: string) {
  mkdirSync(path.join(directory, "资料", "8·17"), { recursive: true })
  writeFileSync(path.join(directory, "资料", "8·17", "话单.csv"), "主叫,被叫\n138,139\n")
  await expect(行(page, "资料")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, 要看到的行)).toBeVisible()
}

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test("右键一个**文件** ⇒ 系统剪贴板里是它在项目内的相对路径（可直接贴给会话框）", async ({ page, context }) => {
  const 甲 = await 建真项目(`复制路径回归·文件·${Date.now()}`)
  await 进项目(page, context, 甲.id)
  await 备好树(page, 甲.directory, "资料/8·17/话单.csv")
  await 放哨兵(page)

  await 行(page, "资料/8·17/话单.csv").click({ button: "right" })
  // 按 `data-action` 定位，**不按文案**：菜单项是我们自己画的，`data-action` 是调用方传的、
  // 不被宿主覆盖（会被覆盖的是 `data-slot`，见 `LEARNINGS #005-22`）。
  await page.locator("[data-action='copy-path']").click()

  await expect.poll(() => 读剪贴板(page), { timeout: 5_000 }).toBe("资料/8·17/话单.csv")

  // 提示：复制**不改变屏幕上任何东西** ⇒ 不吭声的话「复制成了」与「压根没复制」长得一模一样。
  // ⚠️ 按**文案**找，不按变体属性：新布局（`newLayoutDesigns: true`）走的是 **v2** toast
  // （`layout-new.tsx:58` 的 `setV2Toast(true)`），而 `data-variant` 只有 v1 挂在根上。
  await expect(page.getByText("已复制", { exact: false }).first(), "复制成功要吭一声").toBeVisible()
})

test("右键一个**文件夹** ⇒ 尾上补一个斜杠（路径自己说清「这是目录」），且这一项**可用**", async ({
  page,
  context,
}) => {
  const 乙 = await 建真项目(`复制路径回归·目录·${Date.now()}`)
  await 进项目(page, context, 乙.id)
  await 备好树(page, 乙.directory, "资料/8·17")
  await 放哨兵(page)

  await 行(page, "资料/8·17").click({ button: "right" })

  // ⚠️ 「可用」这一条**在这个真栈里也单独钉一次**：目录上 `复制` / `移动` 两项是**禁用**的
  // （服务端只搬单文件，`要文件()` 那条谓词），很容易顺手把这一项也划进去——而「复制一个目录的路径」
  // 恰恰是本项最常用的场合之一。组件层那条钉的是同一个道理，但真栈这里还多证明了一件事：
  // 它在真浏览器里**点得动**（`pointer-events` / 遮挡 / `inert` 这些在 happy-dom 里量不出来）。
  await expect(page.locator("[data-action='copy-path']"), "目录上这一项必须可点").not.toHaveAttribute(
    "aria-disabled",
    "true",
  )
  await page.locator("[data-action='copy-path']").click()

  await expect.poll(() => 读剪贴板(page), { timeout: 5_000 }).toBe("资料/8·17/")
})

test("右键的是**哪一行**，复制出来的就是哪一行——上一行不留残留", async ({ page, context }) => {
  const 丙 = await 建真项目(`复制路径回归·残留·${Date.now()}`)
  // 两个**根下**的文件：本条判的是「换了一行之后剪贴板跟着换」，与层次无关，
  // 所以不引入目录、也不需要先展开（默认全收缩，⑦-5）。
  writeFileSync(path.join(丙.directory, "话单.csv"), "a\n")
  writeFileSync(path.join(丙.directory, "资金.xlsx"), "b\n")

  await 进项目(page, context, 丙.id)
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })
  await 放哨兵(page)

  await 行(page, "话单.csv").click({ button: "right" })
  await page.locator("[data-action='copy-path']").click()
  await expect.poll(() => 读剪贴板(page), { timeout: 5_000 }).toBe("话单.csv")

  // 再来一次，换一行：剪贴板里必须是**新的**那一行（`#005-19`：「能开」与「开在谁身上」是两条判据）。
  await 行(page, "资金.xlsx").click({ button: "right" })
  await page.locator("[data-action='copy-path']").click()

  await expect.poll(() => 读剪贴板(page), { timeout: 5_000 }).toBe("资金.xlsx")
})
