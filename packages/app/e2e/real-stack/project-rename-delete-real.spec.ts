import { expect, test, type Page, type BrowserContext } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-16 · **项目改名与删除**的真栈端到端（spec §10 判据 12）。
 *
 * ## 为什么这条必须落真栈
 *
 * 单测喂的是手写的清单、组件测试喂的是手写的 `projects` —— 两层都**假定了名清单与
 * 会话清单是「本来就对」的**。而这条要钉的是**跨两个存储**的一件事：
 * 名字存在两处（每用户 SQLite 的 `project.name` ＋ PG 的 `project_meta.name`），
 * 而**两处的写入点是同一段代码里的两行**——只有真内核 + 真 PG + 真每用户库才验得了
 * 「两行都真的落了」。
 *
 * 删除那一半同理：它要证明「删完之后**会话还读得出来**」（spec §4.3 那条实测结论）——
 * 而那需要真 PG ＋ 真的会话行 ＋ 目录真的不在盘上。
 *
 * ## 跑法前提
 *
 * 本 spec **会删掉自己的项目**（它自己建的）⇒ 在持久态上跑会留下一条「目录已删」的记录。
 * 与 `file-op-error-real.spec.ts` 的注意事项相同：请给它自己的临时 `REAL_STACK_STATE_DIR`。
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

/**
 * 取项目清单（**有限重试**：扛真栈 PGlite 的 `42P05` 并发撞车）。
 *
 * 真栈把多条连接汇进**同一个 PG 会话**（`pglite-socket`，见 `LEARNINGS #002-05`/`#005-02`）⇒
 * 前端在改名 / 删除之后会**自动重拉**清单，我这条**直读**`/openhive/project` 与它并发时，
 * 两句同一个 `handleList` 各自 prepare 同一句 SQL（`archiveStatesOf` / `membershipsOf`）就撞
 * `42P05 duplicate_prepared_statement` ⇒ `handleList` 偶发 500（实测内核日志：
 * `PostgresError: prepared statement … already exists`）。**生产走多连接池不会撞**——
 * 这是夹具假红、不是产品缺陷。所以这里**等条件不等时间**（`#006-31`）：重试到「200 ＋ 数组」，
 * 最多 3 次、间退 300ms 等并发的那一跳过去；**不**靠加大断言超时掩盖。
 */
async function 列项目() {
  for (let 试 = 0; 试 < 3; 试++) {
    const r = await kernelJson("/openhive/project")
    if (r.status === 200 && Array.isArray(r.body)) return r
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return kernelJson("/openhive/project")
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
}

/** 建一条**项目内**会话（真内核出口当 oracle，不经前端）。回它的 id。 */
async function 建会话(projectId: string, directory: string, title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json", "x-openhive-project": projectId },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

/**
 * 列**项目内**会话（同一条 URL 的 GET）。当 oracle 用。
 *
 * ⚠️ **这是 B 链（`GET /api/session?directory=`），不是产品的 A 链读路径**。
 * 产品 app 走 A 链 `/session...`（spec §4.3 的 v1 协议）；B 链在下面这条用例里
 * 只当「会话行还在」的独立观测面。产品读路径的强证据在路由测试的
 * `GET /session/:sessionID/message`（`openhive-project-delete.test.ts` 的 A ⑤）。
 */
async function 列会话(projectId: string, directory: string) {
  return kernelJson(`/api/session?directory=${encodeURIComponent(directory)}`, {
    headers: { "x-openhive-project": projectId },
  })
}

/**
 * 面板里**按名字**取一行。
 *
 * ⚠️ 两处记号都是**本 feature 与上游现成的**，不是猜的：
 * `data-slot='project-row'` 是 `活跃行` 的根（`project-panel.tsx:492`）；
 * `data-slot='project-item-name'` 是名字那一格（同文件 `:450`，`ItemBody` 里）。
 * 用**名字**过滤而不是按序取第 N 行：`hasText` 是子串匹配，所以先钉住名字这一格、再由它筛行。
 */
const 行 = (page: Page, 名字: string) =>
  page.locator("[data-slot='project-row']").filter({
    has: page.locator("[data-slot='project-item-name']", { hasText: 名字 }),
  })

test("建项目 → 改名 → 删除 → 清单里没了、**直接读会话读得出来**", async ({ page, context }) => {
  const 原名 = `真栈改名删除·${Date.now()}`
  const 新名 = `${原名}（改）`
  const 甲 = await 建真项目(原名)

  // ── 造一条会话（走内核一等出口；真栈上这条链是真的）──
  // ⚠️ 必须带 `x-openhive-project`：不带的话锚定会把 `?directory=` 改写成**沙箱根**，
  // 会话落到另一个目录里 —— 后面那条「会话还读得出来」会红在与被测属性无关的前置上。
  const 会话ID = await 建会话(甲.id, 甲.directory, `留底·${Date.now()}`)

  // ── 打开项目面板：锚点行那颗 toggle（`project-list-failure-real.spec.ts:132` 同一颗）──
  await 进项目(page, context, 甲.id)
  await page.locator("[data-slot='project-anchor-toggle']").click()
  await expect(page.locator("[data-component='project-panel']"), "面板应当开出来").toBeVisible({ timeout: 30_000 })

  const 我行 = 行(page, 原名)
  await expect(我行, "面板里应当有刚建的那个项目").toBeVisible({ timeout: 30_000 })

  // ── 改名：经界面（spec §8 的入口是 ⋯ 菜单 → 改名 → 就地输入框 → 回车）──
  // 悬停才出现的 ⋯（spec §11 取舍 1：触屏与不用电脑的人可能发现不了——这条**正是**那条缺口的现场）。
  await 我行.hover()
  await 我行.locator("[data-project-action='menu']").click()
  // ⚠️ 菜单项按 `data-project-action` 定位，**不按 `data-slot`**（`#005-22`：
  // `DropdownMenuItem` 把 `data-slot` 写在 `{...rest}` 之后，调用方传的那个名字在 DOM 里不存在）。
  await page.locator("[data-project-action='rename']").click()

  // ⚠️ 编辑态下名字格被**整颗换掉**（`project-panel.tsx:543-578` 的 `Show`：`project-item-name`
  // 被 `project-rename-input` 替换，不再是「输入框塞进按钮」）⇒ `我行` 那个
  // `has: project-item-name` 过滤器此刻匹配不到**任何**行，定位输入框**不能**再经过 `我行`。
  // 同一时刻只有一行在改（行级 `在改名` 信号），按「正在编辑的那一行」取即可
  // （同 `project-panel.test.tsx:1984-1986` 的取法）。
  const 框 = page
    .locator("[data-slot='project-row']")
    .filter({ has: page.locator("[data-slot='project-rename-input']") })
    .locator("[data-slot='project-rename-input']")
  await expect(框, "就地改名输入框应当出现").toBeVisible()
  await expect(框, "预填着原名").toHaveValue(原名)
  await 框.fill(新名)
  await 框.press("Enter")

  // ── 被测 ①：界面上那一行换成了新名 ──
  await expect(行(page, 新名), "改名之后那一行应当显示新名字").toBeVisible({ timeout: 15_000 })

  // ── 被测 ②：本地那份名字真的变了（owner 读的就是它）──
  const 列后 = await 列项目()
  const 行后 = (列后.body as { id: string; name: string }[]).find((entry) => entry.id === 甲.id)
  expect(行后?.name, "清单里读到的应当是**新**名字（本地那份）").toBe(新名)

  // ⚠️ PG 那一份（成员读的）**在真栈上从客户端读不到**（没有那个出口）。
  // 它的判据在 `packages/opencode/test/server/openhive-project-rename.test.ts` 里（真 PG 直查）。
  // 这条真栈 spec 因此**只**钉「本地那份 ＋ 界面」——**如实记**，不要写成「两处都验了」。

  // ── 删除：经界面（⋯ → 删除 → 确认框 → 确认）──
  // `dropTrees`（handleDelete 第 2 步、删沙箱目录）在 win32 上会被「文件树刚读过的句柄还没
  // 释放」撞 EBUSY（同 file-op-error-real.spec.ts 记的那条 transient handle lock；生产不撞）；
  // 而 `dropTrees` 是第 2 步、失败时后面每一步都**一字未动**（archive.ts:518 明写「可重入」）⇒
  // 有限重试删除，等条件（这一行从面板消失）不等时间（#006-31）。
  for (let 试 = 0; 试 < 3; 试++) {
    await 行(page, 新名).hover()
    await 行(page, 新名).locator("[data-project-action='menu']").click()
    await page.locator("[data-project-action='delete']").click()
    const 弹窗 = page.locator("[data-slot='project-action-dialog']")
    await expect(弹窗, "删除要先问一句").toBeVisible()
    await expect(弹窗.locator("[data-slot='project-action-hint']"), "那句「找不回来」是这一档的告示").toContainText(
      "找不回来",
    )
    await 弹窗.locator("[data-slot='project-action-ok']").click()
    // 等结果（有界）：这一行消失 = 成功（break）；超时仍 = 删除失败（EBUSY / 42P05 撞车）⇒ 重试。
    try {
      await expect(行(page, 新名), "删除后这一行应当消失").toHaveCount(0, { timeout: 10_000 })
      break
    } catch {
      // 等句柄释放 / 并发那一跳过去，再试。
      await page.waitForTimeout(1000)
    }
  }

  // ── 被测 ③：清单里没了（面板上 ＋ 服务端清单两处都读一遍）──
  await expect(行(page, 新名), "删完之后那一行应当从面板上消失").toHaveCount(0, { timeout: 15_000 })
  const 列最后 = await 列项目()
  expect(
    (列最后.body as { id: string }[]).some((entry) => entry.id === 甲.id),
    "服务端清单里也不该再有它",
  ).toBe(false)

  // ── 被测 ④：**会话还读得出来**（spec §4.3 那条实测结论的判据化）──
  // ⚠️ 直打内核出口，不经界面——项目与目录都没了，界面上已经没有它的落脚点
  // （那正是「纯留底」的形状）；**目录参数照传**（它已经被删了，而这条判据要的正是
  // 「目录不在也照样读得出来」）。
  const 会话表 = await 列会话(甲.id, 甲.directory)
  expect(会话表.status, "目录与项目都不在了，列会话应当照样通（200）").toBe(200)
  const 会话们 = (会话表.body as { data?: { id: string }[] } | undefined)?.data ?? []
  expect(会话们.some((s) => s.id === 会话ID), "会话应当仍在——「删除 ≠ 清空一切」").toBe(true)
})
