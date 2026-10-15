import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 左栏文件树：多选后拖到目标文件夹松手 ⇒ **磁盘上真的搬过去了**。
 *
 * ## 为什么这条非得在真栈
 *
 * 组件层那份判据是**裸 `Event` 顶的**（happy-dom 没有 `DragEvent`）⇒ 它只能证明「事件到了，
 * 我的代码做了什么」，证明不了**浏览器会为可放目标触发 `drop`**。判据 30 / 31 才是那条链的牙。
 *
 * ## 拖拽走裸指针，不走 `locator.dragTo`
 *
 * 同 `send-to-session-real.spec.ts`（那份用 `page.mouse` 实测到了 `dragstart→dragover→drop`）
 * 与 `center-pane-space-real.spec.ts`（`#005-30`：`dragTo` 会卡在 actionability 上，
 * 量到的是 Playwright 的规矩、不是产品的行为）。
 *
 * ## 落盘判据读**真目录**
 *
 * `readdirSync` / `existsSync`（同 `file-tree-delete-dialog-real.spec.ts`）——界面说搬好了
 * 不算数，盘上真在那儿才算。
 *
 * ## 与 brief 的两处出入（都是 harness 修正，判据值一字未改）
 *
 * ① 树默认**全收缩**（`#005-36`，用户第 5 条「默认全部收缩」）⇒ `资料/甲.csv` 这类深层行在
 *    `进项目` 之后**根本不在 DOM 里**，等多久都不出现（真栈快照实测：只有 `资料` / `档案` 两个
 *    折叠态 treeitem）。故判据 30 前置**先等顶层行出现、再点 `[data-action='expand-all']`、再等
 *    深层行**（顺序同 `send-to-session-real.spec.ts`；expand-all 点早了会落在空 `节点表` 上、
 *    白点），并把「等树出现」那几句前置放宽到 30s（`#006-31`：把就绪变成可等的条件）。
 * ② brief 里两处 `拖行到行(...)` **缺 `await`**：不 await 的话盘读会跑在拖拽（含 `waitForTimeout`）
 *    之前——判据 30 恒读到「还没搬」、判据 31 恒读到「还没动」，全成空转。补上 `await`。
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
    // ⚠️ 身份走 **cookie**，不是 `Authorization: Bearer`（Bearer 拿到的是**没有响应体**的 401）。
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

/** 裸指针把一行拖到另一行上松手（`#005-30`：不走 `locator.dragTo`）。 */
async function 拖行到行(page: Page, 起: string, 落: string) {
  const 起盒 = await 行(page, 起).boundingBox()
  const 落盒 = await 行(page, 落).boundingBox()
  if (!起盒 || !落盒) throw new Error("行没有盒——这条用例的前提不成立")
  await page.mouse.move(起盒.x + 起盒.width / 2, 起盒.y + 起盒.height / 2)
  await page.mouse.down()
  // 多步移动：Chromium 要看到一次真正的位移才起拖（同 send-to-session-real.spec.ts 的 30 步）。
  await page.mouse.move(落盒.x + 落盒.width / 2, 落盒.y + 落盒.height / 2, { steps: 30 })
  await page.mouse.up()
  // 落盘是异步的（请求 + 重取清单），给足时间再读盘。
  await page.waitForTimeout(2000)
}

function 种盘(directory: string) {
  mkdirSync(path.join(directory, "资料"), { recursive: true })
  writeFileSync(path.join(directory, "资料", "甲.csv"), "甲")
  writeFileSync(path.join(directory, "资料", "乙.csv"), "乙")
  mkdirSync(path.join(directory, "档案"), { recursive: true })
}

test("判据 30：拖两行到一个文件夹上松手 ⇒ 磁盘上那两个真的在那文件夹里", async ({ page, context }) => {
  const { id, directory } = await 建真项目("多选拖拽-成功")
  // ⚠️ 种盘要在 `进项目` **之前**：树的清单是首屏取的，种晚了这一条就看不出东西。
  种盘(directory)
  await 进项目(page, context, id)

  // 前置：两行都在（证明这一条的前提活着，`#002-02`）
  // ⚠️ 树默认全收缩（`#005-36`）⇒ 得**先等清单画出来**再点全展开，否则 expand-all 那一下落在空
  // `节点表` 上（按钮恒在、点下去却什么都没展开，真栈实测：按钮 `[active]`、树仍折叠）。顺序同
  // `send-to-session-real.spec.ts`：顶层行 → expand-all → 深层行。
  await expect(行(page, "档案"), "目标文件夹应当在树上").toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "资料/甲.csv"), "种下去的文件应当在树上").toBeVisible({ timeout: 30_000 })

  await 行(page, "资料/甲.csv").click()
  await 行(page, "资料/乙.csv").click({ modifiers: ["Control"] })
  await 拖行到行(page, "资料/甲.csv", "档案")

  const 磁盘 = readdirSync(path.join(directory, "档案"))
  console.log(`[多选拖拽] 档案/ = ${JSON.stringify(磁盘)}`)
  expect(磁盘, "甲应当真的搬进档案了").toContain("甲.csv")
  expect(磁盘, "乙应当真的搬进档案了").toContain("乙.csv")
  expect(readdirSync(path.join(directory, "资料")), "原处不该还留着").toEqual([])
  expect(existsSync(path.join(directory, "资料", "甲.csv")), "旧位置必须真的没了").toBe(false)
})

test("判据 31：拖到源自己身上 ⇒ 磁盘上一个都没动", async ({ page, context }) => {
  const { id, directory } = await 建真项目("多选拖拽-非法")
  种盘(directory)
  await 进项目(page, context, id)

  await expect(行(page, "资料"), "源文件夹应当在树上").toBeVisible({ timeout: 30_000 })
  const 盘前 = readdirSync(path.join(directory, "资料"))
  await 拖行到行(page, "资料", "资料")

  console.log(`[非法落点] 资料/ = ${JSON.stringify(readdirSync(path.join(directory, "资料")))}`)
  expect(readdirSync(path.join(directory, "资料")), "非法落点不该动磁盘").toEqual(盘前)
  expect(existsSync(path.join(directory, "资料", "甲.csv")), "文件必须还在原处").toBe(true)
})
