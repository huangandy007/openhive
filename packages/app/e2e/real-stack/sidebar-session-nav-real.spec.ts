import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-09 · 左栏「会话」tab 点一行 ⇒ **打开对应的 AI 会话**，在真前端 ↔ 真后端下的对账。
 *
 * ## 用户实报的现场
 *
 * 「项目管理左栏选择项目后，可以显示会话的名称列表，但是点击会话 tab 页面中的会话名称，
 * 无法打开其对应的 AI 会话界面。」——点击**成功**（事件发了、什么都没报错），**URL 一个字不动**。
 *
 * ## 根因（实测 ＋ 代码双证）
 *
 * 左栏切会话走 `session-actions.ts` 的 `会话路径(pathname, id)`，而它开口第一句是
 * `if (routeSessionID(pathname) === undefined) return undefined`——「**当前已经在会话路由上**，
 * 才拼得出目标」。这条前提对**右栏**成立（右栏整根只在会话路由下渲染：`ai-session-slot.tsx`
 * 的 `<Show when={提交态()}>`），对**左栏**恰恰不成立：左栏常驻，用户正是在**项目页**
 * （URL = `/`）上点它。`"/"` 解不出会话 id ⇒ 返回 `undefined` ⇒ 调用点那句
 * `if (去) navigate(去)` **静默跳过**（不报错、不变红，只有人盯着 URL 才看得见）。
 *
 * ⚠️ **不能**改 `会话路径` 那条前提：`session-actions.test.ts` 用例③ 已把「非会话路由 ⇒
 * `undefined`、一个字都不拼」钉成**正确契约**（它对右栏是对的）。左栏缺的那一半是**服务器 key**，
 * 而它手上**有**真连接（`useServerSDK()`）⇒ 修法是从 `serverSDK().server` 取 key 走
 * `sessionHref`，与 `context/prompt.tsx:104` 那个既有写法同源。
 *
 * ## 为什么只能落在真栈（单测挂不起来）
 *
 * 出错的是**接线层** `sidebar-sessions.tsx`：它要 `useServerSync()` / `useServerSDK()`，而那两个
 * provider 都得有**活着的服务器连接**才建得起来（该文件头把「本文件不带测试」写在明处）。
 * 组件测试里只能把这两个 context 桩掉——而桩上之后，「**服务器 key 从哪儿来**」正好测不到了，
 * 那正是本次缺陷的所在。真栈上没有任何桩。
 *
 * ## 判据为什么必须**从项目页**点
 *
 * 这条用例的全部意义就是「非会话路由下也拼得出来」。若改成从会话页点另一场，旧实现照样绿
 * ——那正是它唯一能用的处境。所以第一件事是断言此刻 URL **就是 `/`**（前提）。少了它，
 * 这条用例随时会退化成一条恒真的测量（`LEARNINGS #006-06` 同族）。
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

/** 真内核出口（测试侧**直接用真券打内核**，当 oracle 用——不经被测的前端）。 */
async function kernelJson(url: string, init: RequestInit = {}) {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...(init.headers ?? {}) },
  })
  return { status: res.status, body: res.ok ? await res.json() : undefined }
}

/**
 * 建一个私有项目，返回 `{ id, directory }`。
 *
 * ⚠️ **目录问服务端要、不自己拼**：`{沙箱根}/{userId}/{projectId}` 是
 * `@opencode-ai/auth/workspace` 的 `projectDirectory` 一句话；在本文件里重写一遍它就是
 * `LEARNINGS #003-05` 的假镜像（生产改口径、测试跟着一起错）。列出口是唯一的产地。
 *
 * ⚠️ **建项目那一下拿不到目录**（`handleCreate` 的出参只有 `{id,name,type,lastAccessedAt}`）
 * ⇒ 只能「建完再列一次」。这是服务端的形状，不是绕路。
 */
async function 建真项目(): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson("/openhive/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `左栏跳转·${Date.now()}`, type: "private" }),
  })
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = (建.body as { id?: string } | undefined)?.id
  expect(id, "建项目应当回一个**服务端给的** id").toBeTruthy()

  const 列 = await kernelJson("/openhive/project")
  const 行 = (列.body as { id: string; directory?: string }[] | undefined)?.find((行) => 行.id === id)
  expect(行?.directory, "列项目应当给出这一行的 directory（左栏正是靠它取会话表）").toBeTruthy()
  return { id: id!, directory: 行!.directory! }
}

/**
 * 在**项目目录**里建一场真会话。
 *
 * ⚠️ 必须带 `x-openhive-project` 头（或等价的项目 cookie）：不带的话锚定会把 `?directory=`
 * 改写成**沙箱根**（`middleware/project-location.ts` 的文件头），会话落到另一个目录里
 * ——左栏那时列不到它，用例会红在一条**与本次缺陷无关**的前置上。头是「意向」通道，
 * 这里正是它的用途。
 */
async function 建项目内会话(projectId: string, directory: string, title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: {
      Cookie: COOKIE(),
      "content-type": "application/json",
      "x-openhive-project": projectId,
    },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

test("左栏点会话项 ⇒ 从项目页跳到 /server/<key>/session/<id>（用户实报的那一条）", async ({
  page,
  context,
}) => {
  const 项目 = await 建真项目()
  const 会话 = await 建项目内会话(项目.id, 项目.directory, `左栏要能点开我·${Date.now()}`)

  // 「当前项目」的两条通道一起摆好：cookie 让**前端**启动时还原出锚点行与左栏目录
  // （`还原启动项目`），同时让**服务端**把左栏那一批 `?directory=` 落进同一个项目目录。
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: 项目.id, url: FRONT() },
  ])

  // 新布局开关 ＋ 关掉那个会截获点击的引导浮层（同 `ai-session-real.spec.ts` 的 `setup`，`#004-12`：
  // 同族 harness 整段搬来；`shouldDisplayTabsToast` 那条的理由见那边文件头的实测）。
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")

  // 前提①（**这条用例的全部意义**）：此刻 URL **就是**项目页，不是会话路由。
  expect(new URL(page.url()).pathname, "前提：从项目页（非会话路由）点左栏").toBe("/")

  // 前提②：切到「会话」tab 之后，那一场**真的列在眼前**。
  // 这一条同时钉住了「项目还原 ＋ 目录取数」两条链：少任何一条左栏都是空的，
  // 而「点一个不存在的行」不是本次要测的东西。
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()
  const 行 = page.locator(`[data-slot='session-item'][data-session-id='${会话}']`)
  await expect(行, "前提：左栏会话 tab 里应当列出刚建的那一场").toBeVisible()

  // ── 被测属性 ──
  await 行.click()

  // 修复前：这条恒不成立（URL 停在 `/`）——`会话路径("/", id)` 回 `undefined`，
  // `if (去) navigate(去)` 什么都没做。`poll` 只为一个理由：`navigate` 之后 Solid 改一次
  // history 占一帧；不把帧当契约（那不是被测的缺陷）。
  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: '点了左栏会话项之后 URL 应当落到那一场的会话路由（修复前这里恒为 "/"）',
      timeout: 15_000,
    })
    .toBe(`/server/${base64Encode(FRONT())}/session/${会话}`)

  // 第二个投影（`#004-02`）：用户那句话要的是「**打开其对应的 AI 会话界面**」——URL 对了
  // 还不够，右栏得真的把这一场渲染出来（URL 变了而右栏空着 ＝ 界面并没有打开）。
  await expect(page.locator('[data-component="session-panel"]')).toBeVisible()
})
