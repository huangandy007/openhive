import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · 「项目清单取不到」在真前端 ↔ 真后端下的对账。
 *
 * ## 用户实报的现场
 *
 * 「当只有一个项目的时候，似乎不显示新建会话的图标和会话列表信息」＋ F12 里
 * `GET /openhive/project` 是 500（另有 `/lsp`、`/command` 两条 500，同一根因同一秒发生）。
 *
 * ## 核查结论：代码里**没有**「只有一个项目」这条分支
 *
 * 全仓 grep 项目数条件（`length === 1` / `> 1` / `<= 1`）无一落在会话列表/侧栏上；判据是
 * **选没选中项目**，与项目个数无关（同屏只差一个 cookie 的实测：A 未选中 ⇒ `session-new` 0 条、
 * 一片空白；B 只把 `openhive_project` 换成真 id ⇒ 1 条 ＋「暂无会话」）。
 *
 * 那三条 500 是**挂具伪影**：真栈用 PGlite（单 PG 会话＋实例级预编译语句名），同进程两个并发
 * 请求准备同一句 SQL 就撞 `42P05 prepared statement already exists`（`LEARNINGS #002-05`/`#005-02`）；
 * 生产走多连接池撞不到。内核日志里那 6 条 `DrizzleQueryError … already exists` 就是它。
 *
 * ## 但那条 500 撞出一个**真的**产品行为（本 spec 钉的就是它）
 *
 * `拉清单` 拿到 `undefined` 时**不写缝、不报错、也不重试** ⇒ `projectList()` 永久停在
 * `undefined`：左栏会话 tab 一体空白（那里要 `/session?directory=…`，而目录正是从清单推出来的），
 * 项目面板**同时**说「还没有项目」。民警能拿到的两个读数**都是假的、且都不会再变**——
 * 连「再来一次」的入口都没有。
 *
 * ## 为什么必须落在真栈（组件层够不着）
 *
 * 出错的一线是**接线**：清单怎么进缝只有 `拉清单` 一处（进门、建完、归档、找回、重试都过它），
 * 而「失败长什么样」到不到得了面板，桩看不见（同 `#006-18` 的分工）。本 spec 用
 * `page.route` **把那条出口打进 500**，走的是真前端 → 真内核那条链，量的是**屏幕上真的长出了
 * 什么**——而不是「我以为它会调用哪个函数」。
 *
 * ⚠️ 注入的是**浏览器侧**的网络故障（`route.fulfill`），不动内核：这既绕开了挂具的 PGlite 伪影
 * （那条 500 时有时无、且不是被测属性），又刚好复现了用户看到的那一层症状——前端收到一个
 * 「列清单」的 500。**「重试之后真的能从服务端拿到清单」那一步是真的**（放开 route 后
 * `route.continue()` 打真内核）。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    token: string
    front: number
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

/** 真内核出口（测试侧**直接用真券打内核**，当 oracle 用——不经被测的前端）。 */
async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

/** 建一个私有项目，返回 `{ id, name }`。目录**问服务端要、不自己拼**（`#003-05`）。 */
async function 建真项目(名: string): Promise<{ id: string; name: string; directory: string }> {
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
  return { id: id!, name: 名, directory: 行!.directory! }
}

/** 进三栏工作台。**按生产常态种**（`#006-11`）：有身份、有当前项目、走新布局。 */
async function 进工作台(page: Page, context: BrowserContext, projectId: string) {
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: projectId, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
}

test("清单取不到 ⇒ 面板说一句话 ＋ 一颗重试钮；放开路由点重试 ⇒ 项目行与「＋」一起回来", async ({
  page,
  context,
}) => {
  const 甲 = await 建真项目(`清单取不到·${Date.now()}`)

  /*
    打进缺陷态：**只拦「列清单」这一条出口**（GET），其余（建 / 归档 / 找回 / touch）一律放行。

    ⚠️ `page.route` 的匹配是 LIFO 的，而本 spec 不需要叠在任何上层 route 之上（真栈没有 mock），
    所以后注册的这条就是唯一一层。
  */
  let 拦着 = true
  let 拦了几次 = 0
  await page.route("**/openhive/project", async (route) => {
    if (拦着 && route.request().method() === "GET") {
      拦了几次 += 1
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "注入的故障：清单取不到" }),
      })
      return
    }
    await route.continue()
  })

  await 进工作台(page, context, 甲.id)

  // 前提①：那条出口**真的被拦到了**（否则下面「面板说没取到」可能只是「压根没发请求」——
  // 一条恒真的判据，`#006-06`）。
  await expect
    .poll(() => 拦了几次, { message: "进门那次列清单必须真的被拦到", timeout: 30_000 })
    .toBeGreaterThan(0)

  // 前提②：工作台真的渲染出来了（锚点行在）。
  await expect(page.locator("[data-slot='project-anchor-toggle']")).toBeVisible({ timeout: 30_000 })

  // ── 被测属性 ②：用户实报的那一条——左栏会话 tab 的「＋」与列表都不在 ──────────────
  // ⚠️ 这一步在**开面板之前**做：面板是一块 `absolute z-10` 的浮层，开出来就盖住左栏 tab 栏，
  // 那时点 tab 会被它挡住（Playwright 的 actionability 检查会一直重试到超时——实测 199 次）。
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()
  await expect(
    page.locator("[data-slot='session-new']"),
    "清单取不到时左栏会话 tab 没有「＋」（这正是用户报的现象）",
  ).toHaveCount(0)

  // 前提③：面板真的开出来了（它是锚点行下面的浮层）。
  await page.locator("[data-slot='project-anchor-toggle']").click()
  await expect(page.locator("[data-component='project-panel']"), "面板应当开出来").toBeVisible({
    timeout: 30_000,
  })

  // ── 被测属性 ①：一句话 ＋ 一颗钮（那句「还没有项目」是**假话**，不许出现） ────────
  await expect(page.locator("[data-slot='project-panel-load-failed']")).toHaveText("项目清单没取到")
  await expect(page.locator("[data-slot='project-panel-retry']")).toBeVisible()
  await expect(
    page.locator("[data-slot='project-panel-empty']"),
    "取不到 ≠ 一个都没有：不许说「还没有项目」",
  ).toHaveCount(0)

  // ── 放开路由 ＋ 点那颗钮 ────────────────────────────────────────────────────
  拦着 = false
  await page.locator("[data-slot='project-panel-retry']").click()

  // 那句话收起来（成功了就不该再赖着）
  await expect(page.locator("[data-slot='project-panel-load-failed']")).toHaveCount(0)
  // 项目行出现（重试真的再问了一次服务端，不是只把提示抹掉）
  await expect(page.locator("button[data-slot='project-item']", { hasText: 甲.name })).toBeVisible({
    timeout: 30_000,
  })

  // ── 被测属性 ③：那颗「＋」回来了（用户诉求的正面） ────────────────────────────
  // ⚠️ 这一步**不只是**「清单回来了」的推论：`＋` 还要求**当前项目**被认出来，而认领那一步
  // （`还原启动项目`）当初正是被这次失败挡掉的——只补拉清单不补认领的实现，会在这里红。
  await expect(page.locator("[data-slot='session-new']")).toHaveCount(1, { timeout: 30_000 })
})
