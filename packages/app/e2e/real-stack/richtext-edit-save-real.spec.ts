import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-12 · **中栏打开的文档能改、能存**（用户实报「打开的文件现在不能复制，编辑，修改，和保存」的
 * 第三、四步）。内核那一半（第九个出口 `/openhive/file/write`）由
 * `packages/opencode/test/server/openhive-file-ops.test.ts` 钉；组件那一半由
 * `center/views/richtext-view.test.tsx` ＋ `center/center-content.test.tsx` 钉。
 *
 * **那两层都绿了，这一份仍然要写**，因为它证明的是两件那两层**证不了**的事：
 *
 * ① **浏览器真的会把 CRLF 折成 LF**。内核那组用例里的「客户端送回来的形状」是**我按 HTML 规范
 *    抄的**（`换行归一` 那个 helper 自己 `replace(/\r\n/g,"\n")`）——那是**前提**，不是实测。
 *    真栈这里是**真的 `<textarea>`** 取值，中间没有我替它决定的环节。
 * ② **信封**（BOM / CRLF / 首尾空行）走完「真内核 ＋ 真前端 ＋ 真磁盘」一圈之后还在不在。
 *    内核那条断言是在内核自己的夹具上量的；这里量的字节是**经前端与内核两跳之后**落盘的，
 *    任何一跳里多解一次 / 多 trim 一次都藏不住。
 *
 * ## 判据为什么落在**字节**上
 *
 * `readFileSync(f, "utf8")` 会把 BOM 与 CRLF 的差别一起读成「看着一样」（CRLF 在文本里还是
 * `\r\n`，但 BOM 更阴：它是个零宽的不可见字符，断言里写没写它，肉眼看不出）。所以期望值一律
 * 拼成 `Buffer` 深比较——「信封还在不在」这件事只有字节说了算。
 */

/** 项目里那篇文档：BOM ＋ CRLF ＋ 尾部两个空行。三样都是**要活着回来的**。 */
const 原正文 = "# 纪要\r\n\r\n第一行\r\n\r\n\r\n"
const 带信封 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(原正文, "utf8")])

/** 读口交回来的正文（客户端拿到的 `base`）：BOM 被 `TextDecoder` 吃掉、首尾空白被 trim。 */
const 底本 = "# 纪要\r\n\r\n第一行"

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

/**
 * 等「当前项目被**认领**」这一档真的到 —— 锚点行的名字离开空态（`data-state="empty"` 是它没项目时的形态）。
 *
 * ⚠️ 这一步挡的是**挂具伪影**、不是产品缺陷。启动期浏览器并发打 `/openhive/auth/me` 与
 * `/openhive/project`，而真栈的库是 PGlite（单 PG 会话 ＋ **实例级**预编译语句名）⇒ 同进程并发准备
 * 同一句 SQL 就撞 `42P05 duplicate_prepared_statement`，症状就是启动那两条 **500**。
 * 证据三条：① 内核日志里 `DrizzleQueryError … already exists` 共 **3022 条，最早一条
 * 2026-10-08T01:42:28Z**（早于本 spec 四天 ⇒ 与本次改动无关）；② 成因与取舍写在
 * `packages/opencode/src/server/openhive/pg.ts` 文件头；③ `LEARNINGS #002-05` / `#005-02` 记着它。
 * 撞上时前端既没身份也没清单，锚点停在「未选择项目」、文件树一片空白，**这一页不会自愈**。
 *
 * 真用户在这一刻**有出口**（不是拿这句话搪塞）：项目面板会说「项目清单没取到」并给一颗重试钮，
 * 点它把清单**与认领一起**补回来——由 `project-list-failure-real.spec.ts` 在真栈上钉着（2026-10-11）。
 * 测试挂具取的是**另一个等价出口**：重载一次。
 *
 * 判据是**可观测的就绪条件**、不是等时间（`#006-31`）：没有它，一次启动撞上伪影就红在 30 秒后那句
 * `element(s) not found` 上，读起来像「这个 spec 本来就飘」（`#006-17` 同族：缺陷态下前提没成立）。
 * 重载有上限，真坏了照样红、且红在下面那条断言上；每次重载都在输出里**报一声**，不藏。
 */
async function 等认领(page: Page): Promise<boolean> {
  try {
    await expect(page.locator("[data-slot='project-anchor-name']")).not.toHaveAttribute("data-state", "empty", {
      timeout: 20_000,
    })
    return true
  } catch {
    return false
  }
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

  // 启动那次撞上 `42P05` 伪影 ⇒ 这一页废了，重载再来（理由与证据见上面 `等认领`）。
  // 冷启动（Vite 模块图还空着、一页 ~800 个模块请求）最容易撞上，所以给到 3 次重载；
  // 用尽仍没认领上就**当场红在这里**，并点名这是挂具——否则红的是 30 秒后那句「卷宗 找不到」，
  // 读起来像产品坏了（`#006-17`：缺陷态下前提不成立，而它的红长得像命中）。
  let 认领上了 = false
  for (let 次 = 0; 次 <= 3 && !认领上了; 次 += 1) {
    if (次 > 0) {
      console.warn(`[真栈] 启动第 ${次} 次没认领上项目（挂具的 PGlite 42P05 伪影），重载再来一遍`)
      await page.reload()
    }
    认领上了 = await 等认领(page)
  }
  expect(
    认领上了,
    "重载 3 次仍没认领上项目 —— 那是真栈挂具的 PGlite 42P05 伪影（见 `等认领` 的注释），不是本 spec 的" +
      "被测属性。真到这步说明这一轮环境不对：重跑；重跑仍红，才轮到怀疑产品。",
  ).toBe(true)

  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

/** 树上一行。 */
const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/**
 * 备一个项目、一篇 md（带信封地写到盘上），并在中栏把它打开。
 *
 * `同目录另写` 的键是**相对 `卷宗/` 的文件名**，值是要写的字节。必须**在 `进项目` 之前**
 * 写盘：文件树只在启动时与文件动作后取清单，页面跑起来之后往里塞文件它看不见；而
 * `page.reload()` 会清掉内存里的草稿，测「切文件草稿还在」时不能用重载来刷树。
 */
async function 开一篇md(
  page: Page,
  context: BrowserContext,
  项目名: string,
  同目录另写: Record<string, Buffer | string> = {},
) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "卷宗")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, "纪要.md"), 带信封)
  for (const [名, 内容] of Object.entries(同目录另写)) writeFileSync(path.join(目录, 名), 内容)

  await 进项目(page, context, 甲.id)
  // ⚠️ 顺序不能换：`expand-all` 要等树**先落到 DOM 上**才有东西可展开（同 `center-pane-space-real`）。
  await expect(行(page, "卷宗")).toBeVisible({ timeout: 30_000 })
  // 树默认全收缩（⑦-5），不展开就看不见 `卷宗` 底下那一行。
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "卷宗/纪要.md")).toBeVisible({ timeout: 30_000 })
  await 行(page, "卷宗/纪要.md").dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })

  return { id: 甲.id, 文件: path.join(目录, "纪要.md") }
}

/** 盘上那份的字节。**期望值一律拼 `Buffer` 深比较**（见文件头那条）。 */
const 读盘 = (文件: string) => readFileSync(文件)

/** 界面此刻是什么状态（编辑框 / 钮 / 预览文字 / 工具栏那句话）。 */
const 界面 = (page: Page) =>
  page.evaluate(() => {
    const 编 = document.querySelector<HTMLTextAreaElement>("[data-slot='richtext-editor']")
    const 钮 = (动作: string) => document.querySelector(`[data-action='${动作}']`) !== null
    return {
      编辑框在: 编 !== null,
      编辑框值: 编?.value ?? null,
      有编辑: 钮("edit"),
      有保存: 钮("save"),
      有预览: 钮("preview"),
      有重试: 钮("retry"),
      有载入盘上: 钮("load-disk"),
      状态: document.querySelector("[data-slot='richtext-save-state']")?.getAttribute("data-status") ?? null,
      说明: document.querySelector("[data-slot='richtext-editor-note']")?.textContent?.trim() ?? null,
      预览: document.querySelector("[data-component='richtext-view']")?.textContent ?? "",
    }
  })

/** 点工具栏那颗钮。**在编辑态里点 `save`**——`fill` 会先聚焦，`click` 不必绕 actionability。 */
async function 点钮(page: Page, 动作: string) {
  await page.locator(`[data-action='${动作}']`).click()
}

test("编辑框里是**读回来那份**正文（行尾按平台规范化——浏览器把 CRLF 折成 LF）", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·初值·${Date.now()}`)

  // 工具栏是「给了存盘接缝」才渲染的（`richtext-view.tsx` 的 `<Show when={props.save}>`）。
  // 真栈这一层要是没接上（`layout-new.tsx` 少传一个 prop），这条会红在「找不到编辑钮」上。
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  const 现在 = await 界面(page)

  expect(现在.编辑框在, "点了编辑应当出现编辑框").toBe(true)
  // 逐行相同、**不看行尾风格**：`<textarea>` 的取值（HTML 的 API value）把 CRLF 折成 LF，
  // 这是平台行为、不是我们把正文改了。所以两边都归一之后再比（`实得`里带上原始行尾计数，
  // 免得这条在「浏览器哪天不折了」时仍然绿着——那时它该红，因为它是我据以写下面那条的前提）。
  const 归一 = (文本: string) => 文本.replace(/\r\n/g, "\n")
  expect(
    归一(现在.编辑框值 ?? ""),
    `编辑框里应当是读回来那份（实得原始值里 CR 有 ${(现在.编辑框值 ?? "").split("\r").length - 1} 个）`,
  ).toBe(归一(底本))
})

/**
 * **本组最要紧的一条**：改一处 ⇒ 落盘的是「新正文 ＋ 原样信封」。
 *
 * 三件事一起钉：改的那处**真的进了盘**、BOM 还在、CRLF 与尾部空行都还在。
 * 少了信封那半边，一道「直接 `writeFile(content)`」的实现也能把正文改对——而那正是
 * 「打开→保存一次，整份文件的形状就被改了」（git 上整份 diff）的来路。
 */
test("改一处存回去 ⇒ 盘上是「新正文 ＋ 原样信封」（BOM / CRLF / 尾空行都活着）", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·存盘·${Date.now()}`)
  // 前提：这一趟是**带信封**地写进去的（少了这条，「信封不变」在两个方向上都可能是空的）。
  expect(读盘(甲.文件), "前提：盘上那份本来就带 BOM").toEqual(带信封)

  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  // 送出去的是 **LF** 那一份：真 `<textarea>` 取值给的就是它（上一条量过），客户端不自作主张
  // 折回去——行尾风格由**盘上那份**决定（`handleWrite` 按原文件数 CRLF）。
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n第二行")
  await 点钮(page, "save")

  // 等**可观测的完成**：状态回 clean（保存回包已经落到 store），而不是等界面退出编辑态。
  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean", {
    timeout: 30_000,
  })
  await expect(page.locator("[data-slot='richtext-editor']")).toBeVisible()
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/# 纪要\n\n第二行/)

  expect(
    读盘(甲.文件),
    "盘上应当是「BOM ＋ 新正文（CRLF）＋ 尾部空行」，实得：" + JSON.stringify(读盘(甲.文件).toString("utf8")),
  ).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# 纪要\r\n\r\n第二行\r\n\r\n\r\n", "utf8")]))
})

/**
 * 民警的原话是「打开的文件不能**编辑**」——所以得有一条**真的拿键盘打字**的用例。
 *
 * ⚠️ 上一条用的是 `.fill()`：它**先聚焦再直接置值**（`LEARNINGS #005-17`），所以它绿着也
 * 证不出「裸键盘的字进得去」——焦点被别处抢走（`#005-34` 那族）、或蒙了一层遮罩时，
 * `.fill()` 照样成功。这一条走**真指针 ＋ 真按键**，判据落在**盘上的字节**上：
 * 字打进去了不算数，**存回盘上**才算。
 *
 * `Control+End` 到文末再打，于是新字接在最后一行尾巴上（判据要能说出它接在哪，见 `#005-19`）。
 */
test("编辑态里裸键盘打进去的字真的进得去，也真的存回盘上", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·键盘·${Date.now()}`)

  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  const 框 = page.locator("[data-slot='richtext-editor']")
  await 框.click()
  await page.keyboard.press("Control+End")
  await page.keyboard.type("补一句")

  await expect(框, "裸键盘打进去的字应当出现在编辑框里").toHaveValue(/补一句/)

  await 点钮(page, "save")
  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean", {
    timeout: 30_000,
  })
  await expect(框).toHaveValue(/补一句/)

  expect(
    读盘(甲.文件),
    "盘上是「打完字的新正文 ＋ 原样信封」，实得：" + JSON.stringify(读盘(甲.文件).toString("utf8")),
  ).toEqual(
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# 纪要\r\n\r\n第一行补一句\r\n\r\n\r\n", "utf8")]),
  )
})

/**
 * 存完**留在编辑态**（2026-10-19 用户裁定：保存不再是「退出编辑」的同义词）。
 * 判据三件一起：编辑框还在、保存钮还在、状态回 clean。
 */
test("存完 ⇒ 留在编辑态、状态显示已保存", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·收尾·${Date.now()}`)

  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n第二行")
  await 点钮(page, "save")

  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean", {
    timeout: 30_000,
  })
  const 现在 = await 界面(page)
  expect(现在.编辑框在).toBe(true)
  expect(现在.有保存).toBe(true)
  expect(现在.有编辑).toBe(false)
})

/**
 * 用户实报的第三条：没有自动保存。停手后不等点按钮，盘上就该有新字。
 */
test("停手后自动保存：不点保存，盘上也会出现新字", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·自动·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n自动保存进来的")

  await expect
    .poll(() => 读盘(甲.文件).toString("utf8"), { timeout: 15_000 })
    .toContain("自动保存进来的")
  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean")
  expect(await page.locator("[data-slot='richtext-editor']").isVisible()).toBe(true)
})

/**
 * 用户实报的第一条：去开别的文件，回来没保存的字全没了。
 * 这一条必须**真的换 tab 再换回来**——组件重挂之后字还在，才说明草稿在组件之外。
 */
test("打了字去开另一篇、再切回来 ⇒ 没保存的字还在", async ({ page, context }) => {
  // 另一篇必须在开页前就写进盘：开页后重载会清掉内存草稿，这条就测不到东西了。
  await 开一篇md(page, context, `编辑·切回·${Date.now()}`, { "另一篇.md": "# 另一篇\n" })

  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n切走之前的字")

  await 行(page, "卷宗/另一篇.md").dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-slot='richtext-editor']")).toBeHidden()

  // 中栏 tab 的定位口径见 `center-session-edit-real.spec.ts`（`data-slot='tab'` + 文件名）。
  await page.locator("[data-slot='tab']").filter({ hasText: "纪要.md" }).click()
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/切走之前的字/, { timeout: 30_000 })
})

/**
 * 盘上被别人改了 ⇒ 保存不许覆盖，界面进冲突态并给「载入盘上版本」。
 */
test("盘上被改过 ⇒ 保存进冲突态，点「载入盘上版本」换成盘上那份", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·冲突·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")

  // 打开之后、第一次保存之前，别处把盘上那份改了（这就是服务端 `base` 比的「变了没有」）。
  writeFileSync(甲.文件, "# 纪要\n\n别人改的\n", "utf8")

  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n我改的")
  await page.keyboard.press("Control+s")

  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "conflict", {
    timeout: 30_000,
  })
  await expect(page.locator("[data-action='retry']")).toBeVisible()
  await expect(page.locator("[data-action='load-disk']")).toBeVisible()
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/我改的/)

  await 点钮(page, "load-disk")
  await expect(page.locator("[data-slot='richtext-editor']")).toHaveValue(/别人改的/, { timeout: 30_000 })
})

/**
 * 保存不再退出编辑态之后，「回预览」是一条显式动作：先存、再切。
 */
test("点「预览」⇒ 保存后回预览，预览里是新正文", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·预览·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n预览里的新正文")
  await 点钮(page, "preview")

  await expect(page.locator("[data-component='richtext-view']")).toContainText("预览里的新正文", { timeout: 30_000 })
  expect(await page.locator("[data-slot='richtext-editor']").isVisible()).toBe(false)
  await expect
    .poll(() => 读盘(甲.文件).toString("utf8"), { timeout: 15_000 })
    .toContain("预览里的新正文")
})

/**
 * 预览里的项目内图片必须**真的显示出来**：`<img src="图.png">` 原样交给浏览器会去请求
 * 应用前门（404），`naturalWidth` 恒 0——这正是补丁要证明的事（spec §8.2）。
 */
test("预览里的项目内图片经 load 取字节后真的画出来（naturalWidth > 0）", async ({ page, context }) => {
  // 1×1 的合法 PNG。
  const 一像素 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  )
  await 开一篇md(page, context, `编辑·图片·${Date.now()}`, {
    "图.png": 一像素,
    "带图.md": "# 图\n\n![图](图.png)\n",
  })

  await 行(page, "卷宗/带图.md").dblclick()
  const 图 = page.locator("[data-component='richtext-view'] img")
  await expect(图).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => 图.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0)
})

/**
 * 预览里点**相对链接**不许把整个工作区导航走——那会把正在做的事（草稿、tab、会话）全丢。
 */
test("预览里点相对链接 ⇒ 不整页跳走", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·链接·${Date.now()}`, {
    "另一篇.md": "# 另一篇\n",
    "带链.md": "# 链\n\n[另一篇](另一篇.md)\n",
  })

  await 行(page, "卷宗/带链.md").dblclick()
  await expect(page.locator("[data-component='richtext-view'] a")).toBeVisible({ timeout: 30_000 })
  const 原址 = page.url()

  await page.locator("[data-component='richtext-view'] a").click()
  await page.waitForTimeout(300)

  expect(page.url()).toBe(原址)
})

/**
 * 「撤销钮真的回退」——`execCommand("undo")` 之后不把 textarea 的值同步回 store 的实现在这里红。
 *
 * ⚠️ 打字用 **ASCII**，不用中文。Playwright 的 `keyboard.type` 对 CJK 是**逐字** `insertText`
 * （模拟输入法提交），Chromium 把每个字算作一个撤销单元：打「追加」后撤销一次只退「加」。
 * 这不是产品缺陷——裸 textarea、零回写时同样如此（2026-10-19 对照实测）。用连续 ASCII
 * 字符时浏览器会把它们并成一组，一次撤销回到原值；撤销后 store 未同步的实现在这里红
 * （结尾显式点一次保存，把 store 冲刷到盘上）。
 * ⚠️ `fill` 不产生撤销历史，必须真键盘打字。
 */
test("撤销钮真的把刚打的字退回去", async ({ page, context }) => {
  const 甲 = await 开一篇md(page, context, `编辑·撤销·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  const 框 = page.locator("[data-slot='richtext-editor']")
  await 框.click()
  await page.keyboard.press("Control+End")
  const 原值 = await 框.inputValue()

  await page.keyboard.type("ab")
  await expect(框).toHaveValue(原值 + "ab")

  await 点钮(page, "undo")
  await expect(框).toHaveValue(原值, { timeout: 10_000 })

  // 撤销也必须回到 store：显式保存一次把它冲刷出来，盘上必须仍是原封不动的那份。
  // ⚠️ 「轮询盘上不含 ab」会假绿——800ms 防抖还没到点时，盘上本来就还没有 ab。
  await 点钮(page, "save")
  await expect(page.locator("[data-slot='richtext-save-state']")).toHaveAttribute("data-status", "clean", {
    timeout: 30_000,
  })
  expect(读盘(甲.文件), "撤销后保存不应改动盘上那份").toEqual(带信封)
})

/**
 * 工具栏是**正常流里的兄弟**，不是盖在正文上的浮层（`richtext-view.tsx` 的 `shrink-0`）。
 *
 * 这是**几何**，只有真浏览器给得出（`LEARNINGS #005-16` / `#006-33`：happy-dom 没有布局引擎，
 * 那里 `getBoundingClientRect()` 恒为零矩形，只能断类名——那是代理判据）。而「压住正文」
 * 恰恰是这一处最容易犯的错：`absolute` 的工具栏在组件层看不出任何异样。
 */
test("工具栏不压正文：它在 tab 栏之下、内容区之上，左缘与正文同一条竖线", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·几何·${Date.now()}`)
  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })

  const g = await page.evaluate(() => {
    const 取 = (sel: string) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    }
    const 正文 = document.querySelector("[data-component='richtext-view'] > *")
    return {
      卡片: 取("[data-slot='three-pane-center-card']"),
      工具栏: 取("[data-slot='richtext-editor-bar']"),
      内容区: 取("[data-component='richtext-view']"),
      钮: 取("[data-action='edit']"),
      正文左缘: 正文 ? Math.round(正文.getBoundingClientRect().x) : null,
    }
  })

  expect(g.工具栏, "给了存盘接缝就该有工具栏").not.toBeNull()
  // 内容区**整块**落在工具栏下缘之下 —— 工具栏若改成 `absolute`（浮层），这一条当场红。
  expect(
    g.内容区!.y,
    `内容区 y=${g.内容区!.y} 应当在工具栏下缘 ${g.工具栏!.y + g.工具栏!.h} 之下`,
  ).toBeGreaterThanOrEqual(g.工具栏!.y + g.工具栏!.h - 1)
  // `px-4`：钮的文字左缘与正文左缘落在同一条竖线上（同卡片左缘 ＋ 16）。
  expect(g.钮!.x - g.卡片!.x, "编辑钮左缘与卡片左缘之间应当隔 16px（与内容区的 p-4 同值）").toBe(16)
  expect(g.正文左缘! - g.卡片!.x, "正文左缘与卡片左缘之间应当隔 16px").toBe(16)
})
