import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-10 · **空文件夹可见性**的端到端回归（任务 ③）。
 *
 * ## 用户实报
 *
 * 「新建的文件夹建完就看不见」（文件名 tab 的文件树）。
 *
 * ## 为什么这条必须落真栈，单测 / 组件测试替代不了
 *
 * 单测喂的是**手写的清单**、组件测试喂的是**手写的 `paths`**——两层都在假定「清单里已经有
 * 空目录那条」这个前提。而缺陷的根因恰恰在**那个前提自己**：真实链路上，读侧
 * （`project/openhive-files.ts` 的 `walk`，走上游 `GET /file?path=`）**从来不把空目录放进
 * 清单**，因为它只 `files.push` 文件、目录只用来往下走。所以两层的绿都建立在一个真栈上
 * 不成立的前提上（`LEARNINGS #006-18`：单测全绿 ≠ 那条接线接上了）。
 *
 * 这一条从**磁盘**开始种，走完 读侧 → 建树（`project/file-tree-model.ts`）→ 渲染，是这条
 * 链上唯一一处「三个环节同框」的观测点。
 *
 * ## 种什么
 *
 * 三样刻意同框，把「看不见」与「看不见的全部理由」分开：
 * - `话单.csv` —— 普通文件（对照组：它一直在）；
 * - `资料` —— **空目录**（被测对象）；
 * - `有内容的/里面.csv` —— 非空目录（对照：它的**目录行**是靠「里面那个文件」被反推出来的，
 *   而它自己**从来不是**一条清单项——这正是不改结构就补不上空目录的原因）。
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
}

/** 现在树上画出来的行（`data-path` ＋ `data-type`，按 DOM 顺序）。 */
const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

const 全部行 = (page: Page) =>
  page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row']").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-path") ?? "?"),
  )

test("空目录在真栈上是**一条目录行**，且与文件同在（任务 ③ 端到端）", async ({ page, context }) => {
  const 甲 = await 建真项目(`空目录回归·${Date.now()}`)
  mkdirSync(path.join(甲.directory, "资料"), { recursive: true })
  mkdirSync(path.join(甲.directory, "有内容的"), { recursive: true })
  writeFileSync(path.join(甲.directory, "话单.csv"), "主叫,被叫\n138,139\n")
  writeFileSync(path.join(甲.directory, "有内容的", "里面.csv"), "a\n")

  await 进项目(page, context, 甲.id)
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()

  // 等树落下来（对照组那个文件先到就够——它就是「取数成功了」的信号）。
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })

  // ── 被测对象：空目录。断言三条，缺一条都不算修好 ──
  // ① 它在（不是消失）；② 它**看得见**（在 DOM 里与被盖住是两回事）；③ 它被认成**目录**
  //    （⇒ 有展开箭头、「选中它 ⇒ 在它下面新建」的落点才是它自己，见 `file-tree.tsx:278`）。
  await expect(行(page, "资料"), "空目录必须自己占一条行").toBeVisible()
  expect(await 行(page, "资料").getAttribute("data-type"), "空目录必须是 directory，不是 file").toBe("directory")

  // ── 对照组：非空目录（靠子文件反推出来的）与普通文件 ──
  await expect(行(page, "有内容的")).toBeVisible()
  expect(await 行(page, "有内容的").getAttribute("data-type")).toBe("directory")
  expect(await 行(page, "话单.csv").getAttribute("data-type")).toBe("file")

  // ── 排序：目录在前。空目录也走**上游那一份**排序规则（`file-tree-model.ts` 的诱饵法全部意义所在）──
  const 顺序 = await 全部行(page)
  expect(顺序.indexOf("资料"), "空目录要排在文件前面").toBeLessThan(顺序.indexOf("话单.csv"))
  expect(顺序.indexOf("有内容的")).toBeLessThan(顺序.indexOf("话单.csv"))

  // ── 读侧那一问：空目录在**原始出口**里就是带尾分隔符的一条（本轮补的值）──
  // 排掉「界面碰巧对、出口其实没有」这种可能：建树那侧认的是**这个尾分隔符**。
  const 根 = await kernelJson(`/file?path=`, { headers: { "x-openhive-project": 甲.id } })
  const 资料项 = (根.body as { name: string; path: string; type: string }[]).find((项) => 项.name === "资料")
  expect(资料项?.type, "上游出口里 资料 就是 directory").toBe("directory")
  expect(资料项?.path, "目录项的 path 带上游那个尾分隔符，建树那侧据此认出它").toMatch(/[\\/]$/)
})

test("**通过界面**新建一个文件夹 ⇒ 它建完就看得见（用户实报的那个动作）", async ({ page, context }) => {
  const 乙 = await 建真项目(`新建文件夹回归·${Date.now()}`)
  writeFileSync(path.join(乙.directory, "话单.csv"), "a\n")

  await 进项目(page, context, 乙.id)
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
  await expect(行(page, "话单.csv")).toBeVisible({ timeout: 30_000 })

  // 什么都不选中 ⇒ 落点是项目根（工具栏那条路径）。真敲字：`fill` 绕开 keydown，而 Enter 是提交闸门。
  await page.locator("[data-slot='file-tree-action-create']").click()
  await page.locator("[data-slot='file-tree-create-dir']").click()
  const 输入条 = page.locator("[data-slot='file-tree-create-input']")
  await expect(输入条).toBeVisible()
  await 输入条.type("八月的资料")
  await 输入条.press("Enter")

  // ⚠️ 这一条断言就是用户那句话本身：「建完就看不见」⇒ **建完必须看得见**。
  // 不用 `waitForTimeout` 之后 count——那会把「最终看得见」和「当下看不见」混成一条判据。
  await expect(行(page, "八月的资料"), "新建的文件夹必须在树上看得见").toBeVisible({ timeout: 15_000 })
  expect(await 行(page, "八月的资料").getAttribute("data-type"), "新建的文件夹是目录行").toBe("directory")
})
