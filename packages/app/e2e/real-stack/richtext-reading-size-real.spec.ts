import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-12 · **中栏文档的正文可读性**（用户实报「打开的文件显示的文字字号较小，不适合阅读，
 * 不适合不同年龄阶段的用户阅读」）。
 *
 * ## 为什么这一条只能在真栈上判
 *
 * 「正文字号是多少」是个 **computed style** 上的数，而组件层跑在 happy-dom 里——**它没有排版
 * 引擎，也没有样式表**（`LEARNINGS #005-07`：className 串能断，算出来的字号断不了）。
 * 所以 `richtext-view.test.tsx` 那 24 条能钉住「钮把值改没改」，钉不住「屏幕上真的变大了」。
 * 这一份量的是 `getComputedStyle(...).fontSize`——**样式真的落到正文上**才有的数。
 *
 * ## 判据（三面）
 *
 * ① `.md` 预览的正文（`<p>`）　② `.txt` 预览的正文（`<pre>`）　③ 编辑框（`<textarea>`）
 * —— 后两个是「同一个正文的另一面」，改了正文的面就得跟着改，漏一个民警就会看到
 * 「预览里字大、点编辑字又小了」。
 *
 * 夹具体例抄自同族的 `richtext-edit-save-real.spec.ts`（只换判据点，`LEARNINGS #004-12`），
 * 包括那段 PGlite `42P05` 伪影的守卫——理由与证据见下面 `等认领`，**一个字都没改**。
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

/** 认领上（撞伪影就重载，上限 3 次；用尽仍没认领上＝这一轮环境不对，当场点名叫挂具）。 */
async function 等到认领上(page: Page) {
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
}

/** 树上一行。 */
const 行 = (page: Page, 路径: string) =>
  page.locator(`[data-slot='sandbox-tree'] [data-slot='file-tree-row'][data-path='${路径}']`)

/** 备一个项目、并把 `卷宗/<名字>` 写到盘上。 */
async function 备项目(项目名: string, 名字: string, 字节: string | Buffer) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "卷宗")
  mkdirSync(目录, { recursive: true })
  const 文件 = path.join(目录, 名字)
  writeFileSync(文件, 字节)
  return { id: 甲.id, 文件 }
}

/** 进项目：挂 cookie ＋ 打开新布局，等认领上，切到文件 tab。 */
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
  await 等到认领上(page)
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
}

/** 在（已进项目的）这一页上把某一行双击打开，等预览容器出现。重载之后也用它重新打开。 */
async function 打开(page: Page, 路径: string) {
  // ⚠️ 顺序不能换：`expand-all` 要等树**先落到 DOM 上**才有东西可展开（同 `center-pane-space-real`）。
  await expect(行(page, "卷宗")).toBeVisible({ timeout: 30_000 })
  // 树默认全收缩，不展开就看不见 `卷宗` 底下那一行。
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, 路径)).toBeVisible({ timeout: 30_000 })
  await 行(page, 路径).dblclick()
  await expect(page.locator("[data-component='richtext-view']")).toBeVisible({ timeout: 30_000 })
}

/**
 * 量「正文现在多大」。**这是这一份 spec 存在的全部理由**（见文件头）：字号是算出来的数，
 * happy-dom 给不出，只有真浏览器的 `getComputedStyle` 说了算。
 *
 * 取 `p, pre` 里的第一个：`.md` 渲染出的是 `<p>`（文件首行的 `#` 是 `<h1>`，不是正文），
 * `.txt` 渲染出的是一个 `<pre>`。两个面用同一条取法，免得两边各写一份（`LEARNINGS #005-45`）。
 */
const 量字号 = (page: Page) =>
  page.evaluate(() => {
    const 取 = (el: Element | null | undefined) => {
      if (!el) return null
      const 算 = getComputedStyle(el)
      return { 字号: 算.fontSize, 行距: 算.lineHeight }
    }
    const 容器 = document.querySelector("[data-component='richtext-view']")
    return {
      正文: 取(容器?.querySelector("p, pre")),
      编辑框: 取(document.querySelector("[data-slot='richtext-editor']")),
    }
  })

/**
 * 把一面归一成「字号几 px、行距几 px」两个数。
 *
 * 为什么要归一：`line-height: 1.75` 这种**单位数**，Chrome 的 `getComputedStyle` 给的是用值
 * （`28px`），但同一族的浏览器历史上也吐过原始数字（`1.75`）。两种都换算成像素再比，
 * 判据就钉在「几像素」上，不会红在一个与被测性质无关的表示形式上。
 */
const 归一 = (面: { 字号: string; 行距: string } | null) => {
  if (!面) return null
  const 字号 = Number.parseFloat(面.字号)
  const 行距数 = Number.parseFloat(面.行距)
  return { 字号, 行距: 面.行距.endsWith("px") ? 行距数 : 行距数 * 字号 }
}

/** 一枚期望：字号 px × 行距倍数（`16, 1.75` ⇒ 16px / 28px）。 */
const 应当是 = (字号: number, 倍数: number) => ({ 字号, 行距: 字号 * 倍数 })

const 默认档 = 16
const 行距倍数 = 1.75

/** 认一认「这一面此刻多大」，红了要看得见实得值（不然只有一句 `expected 13px`）。 */
const 这面 = (面: { 字号: string; 行距: string } | null, 名: string) =>
  `${名}【字号 ${面?.字号 ?? "（没有这一面）"} / 行距 ${面?.行距 ?? "-"}】`

/**
 * ⚠️ 下面两条「默认档」的判据**不管接线**——2026-10-12 的变异记录（拆掉那句把 `--richtext-size`
 * 贴到根上的 `createEffect`）：这两条**照样绿**，因为 `index.css` 那条规则写着兜底值
 * `var(--richtext-size, 16px)`，而兜底值恰好等于默认档 ⇒ 变量没人贴时它给出的还是 16px
 * （`LEARNINGS #005-47`：期望值恰好等于下游的默认值 ⇒ 这条判据没在守东西）。
 * 接口那一头由**第三条**（放大 ⇒ 18px）守——它是那次变异里唯一变红的；快套里另有
 * `richtext-view.test.tsx` 直接读根上那个变量。
 */
test("`.md` 预览的正文默认是 16px、行距 1.75", async ({ page, context }) => {  const 甲 = await 备项目(`字号·md·${Date.now()}`, "纪要.md", "# 纪要\n\n第一行\n\n第二行\n")
  await 进项目(page, context, 甲.id)
  await 打开(page, "卷宗/纪要.md")

  const 现在 = await 量字号(page)
  expect(现在.正文, `md 预览应当有正文这一面；实得 ${这面(现在.正文, "md 正文")}`).not.toBeNull()
  expect(归一(现在.正文), `md 正文 ${这面(现在.正文, "md 正文")}`).toEqual(应当是(默认档, 行距倍数))
})

test("`.txt` 预览的正文默认也是 16px（两个扩展名同一个正文面）", async ({ page, context }) => {
  const 甲 = await 备项目(`字号·txt·${Date.now()}`, "摘录.txt", "第一行\n  缩进的第二行\n")
  await 进项目(page, context, 甲.id)
  await 打开(page, "卷宗/摘录.txt")

  const 现在 = await 量字号(page)
  expect(现在.正文, `txt 预览应当有正文这一面；实得 ${这面(现在.正文, "txt 正文")}`).not.toBeNull()
  expect(归一(现在.正文), `txt 正文 ${这面(现在.正文, "txt 正文")}`).toEqual(应当是(默认档, 行距倍数))
})

test("放大 ⇒ 预览与编辑框一起变大；刷新还在；再缩回来", async ({ page, context }) => {
  const 甲 = await 备项目(`字号·档·${Date.now()}`, "纪要.md", "# 纪要\n\n第一行\n\n第二行\n")
  await 进项目(page, context, 甲.id)
  await 打开(page, "卷宗/纪要.md")

  await page.locator("[data-action='larger']").click()
  const 放大后 = await 量字号(page)
  expect(归一(放大后.正文), `点放大后 md 正文 ${这面(放大后.正文, "md 正文")}`).toEqual(应当是(默认档 + 2, 行距倍数))

  // 同一个正文的另一面：进编辑态之后字号必须**跟着走**，否则民警会看到「预览字大、编辑字小」。
  await page.locator("[data-action='edit']").click()
  await expect(page.locator("[data-slot='richtext-editor']")).toBeVisible({ timeout: 30_000 })
  const 编辑 = await 量字号(page)
  expect(归一(编辑.编辑框), `点放大后编辑框 ${这面(编辑.编辑框, "编辑框")}`).toEqual(应当是(默认档 + 2, 行距倍数))

  // 存一次是为了退出编辑态（`cancel` 会问「丢掉吗」，一次没改的取消不问 —— 但这篇里我改过没有
  // 都不影响本 spec 的判据，故取更省事的那条：不点 cancel，直接刷新）。
  //
  // ⚠️ 刷新用的是**真浏览器**的刷新：设置要是只活在内存里，这一条会红（这正是它要钉的）。
  await page.reload()
  await 等到认领上(page)
  await page.locator("[data-slot='sidebar-tab'][data-tab='files']").click()
  await 打开(page, "卷宗/纪要.md")

  const 刷新后 = await 量字号(page)
  expect(归一(刷新后.正文), `刷新后 md 正文 ${这面(刷新后.正文, "md 正文")}`).toEqual(应当是(默认档 + 2, 行距倍数))

  // 18 往回**一下**就是默认档 16（五档表里默认档的上一档）；再一下必须到 14 —— 那才说明它是
  // **逐档走**，而不是「一点就回默认」。
  await page.locator("[data-action='smaller']").click()
  const 缩一下 = await 量字号(page)
  expect(归一(缩一下.正文), `缩一下后 md 正文 ${这面(缩一下.正文, "md 正文")}`).toEqual(应当是(默认档, 行距倍数))

  await page.locator("[data-action='smaller']").click()
  const 缩两下 = await 量字号(page)
  expect(归一(缩两下.正文), `缩两下后 md 正文 ${这面(缩两下.正文, "md 正文")}`).toEqual(应当是(默认档 - 2, 行距倍数))
})
