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

/** 备一个项目、一篇 md（带信封地写到盘上），并在中栏把它打开。 */
async function 开一篇md(page: Page, context: BrowserContext, 项目名: string) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "卷宗")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, "纪要.md"), 带信封)

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
      有取消: 钮("cancel"),
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

  // 等**可观测的完成**：回预览 ＋ 预览里是新正文（预览是新正文这件事本身就是「重新读了一次」）。
  await expect(page.locator("[data-slot='richtext-editor']")).toBeHidden({ timeout: 30_000 })
  await expect(page.locator("[data-component='richtext-view']")).toContainText("第二行", { timeout: 30_000 })
  await expect(page.locator("[data-slot='richtext-editor-note']")).toBeHidden()

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
  await expect(page.locator("[data-component='richtext-view']")).toContainText("补一句", { timeout: 30_000 })

  expect(
    读盘(甲.文件),
    "盘上是「打完字的新正文 ＋ 原样信封」，实得：" + JSON.stringify(读盘(甲.文件).toString("utf8")),
  ).toEqual(
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# 纪要\r\n\r\n第一行补一句\r\n\r\n\r\n", "utf8")]),
  )
})

/**
 * 存完之后**工具栏回到「只有编辑」那一档**，而不是停在编辑态或半路。
 *
 * 这条看着像琐事，钉的却是 `底本` 的**作废窗口**：存成功之后 `BinaryView` 重挂、读第二次，
 * 在它回来之前编辑钮**先不给**（`richtext-view.tsx` 的「存完之后底本先作废」）。停在这一档上
 * 才对；停在「编辑钮已经给了、而底本还是旧的」上，紧接的第二次保存会撞一句**错的**冲突话。
 */
test("存完 ⇒ 回预览、编辑钮回来", async ({ page, context }) => {
  await 开一篇md(page, context, `编辑·收尾·${Date.now()}`)

  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  await 点钮(page, "edit")
  await page.locator("[data-slot='richtext-editor']").fill("# 纪要\n\n第二行")
  await 点钮(page, "save")

  await expect(page.locator("[data-action='edit']")).toBeVisible({ timeout: 30_000 })
  const 现在 = await 界面(page)
  expect(现在.编辑框在).toBe(false)
  expect(现在.有保存, "回预览之后不该还挂着「保存」").toBe(false)
  // ⚠️ 这里**不**断「那句『丢掉吗』没留着」：本流程从没点过「取消」，`问着` 恒为 false ⇒ 那条
  // 断言在这一路上**永远为真**，是一条空转的绿（`LEARNINGS #005-47`）。那句话由真正走得过去的
  // 组件用例钉（`richtext-view.test.tsx` 的「改了还没存就点取消 / 继续改 / 丢掉」三条）。
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
