import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-14 · **中栏 `.md` 预览的版面**（用户实报「没有进行很好的渲染，一些格式展现不出来」）。
 *
 * ## 为什么这一条只能在真栈上判
 *
 * 根因是「**没有任何元素级样式落上去**」——`packages/ui/src/styles/base.css` 把 `h1..h6` 的
 * 字号字重、`ul/ol` 的符号、`*` 的 margin/padding、`a` 的颜色与下划线、`table` 的框线全清零，
 * 而上游把它救回来的那 385 行（`session-ui/src/components/markdown.css`）**每一条都嵌在
 * `[data-component="markdown"]` 里**，中栏预览的容器是 `[data-component="richtext-view"]`
 * ——一个选择器都命中不到。改前真栈实测（`getComputedStyle`）：`h1` 与 `p` **逐项相同**
 * （16px / 440 / 行距 28 / 外边距 0 / 无边框），`li` 的 `list-style` 是 `none` 且左内边距 0，
 * `table/th/td` 边框 0，`pre` 背景透明、内边距 0，`a` 的颜色就是正文黑、无下划线。
 *
 * 这些全是**算出来的样式** ⇒ happy-dom 给不出（它没有样式表与排版引擎，`LEARNINGS #005-07`），
 * 组件层只能钉「渲染器在容器上留了什么记号」（`richtext-view.test.tsx` 那 4 条）。
 *
 * ## 判据为什么取「相对关系」而不是钉死 px
 *
 * 正文那一档字号是**用户可调**的（`reading-size.ts`，`.md` 预览与 `.txt` 正文一起跟着走），
 * 所以这里钉的是「标题 **比** 正文大、两级之间**还有差**」「列表**有**符号**有**缩进」这类
 * 关系——钉死 `28px` 会把两条独立的性质缠在一起，改阅读字号档位时这里无辜变红。
 * （字号本身另有一份 spec：`richtext-reading-size-real.spec.ts`。）
 *
 * 夹具体例抄自同族的 `richtext-reading-size-real.spec.ts`（只换判据点，`LEARNINGS #004-12`），
 * 包括那段 PGlite `42P05` 伪影的守卫——**那一段一个字都没改**。
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
  // 用 `Headers` 而不是把两个对象展开合并：`init.headers` 的类型是 `HeadersInit`
  // （可能是 `Headers` / 二维数组 / 普通对象），展开它会同时踩上 `no-misused-spread`
  // 与 `no-useless-fallback-in-spread` 两条。
  const headers = new Headers(init.headers)
  headers.set("Cookie", COOKIE())
  const res = await fetch(`${KERNEL()}${url}`, { ...init, headers })
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
async function 备项目(项目名: string, 名字: string, 字节: string) {
  const 甲 = await 建真项目(项目名)
  const 目录 = path.join(甲.directory, "卷宗")
  mkdirSync(目录, { recursive: true })
  writeFileSync(path.join(目录, 名字), 字节)
  return { id: 甲.id }
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

/** 在（已进项目的）这一页上把某一行双击打开，等预览容器出现。 */
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
 * 一份把常用语法都用上、且**每个标签各留一处**的文档。
 *
 * 每样只写一处（而不是靠 `querySelector` 撞运气）：判据取的就是「这一处」，重复写反而会让
 * 「取到的是哪一处」变成一个需要解释的问题。
 */
const 文档 = [
  "# 一级标题",
  "",
  "## 二级标题",
  "",
  "正文一段，含 **粗体**、*斜体*、`行内代码` 与 [链接](https://example.com)。",
  "",
  "- 无序甲",
  "- 无序乙",
  "",
  "1. 有序甲",
  "2. 有序乙",
  "",
  "> 引用一句",
  "",
  "| 姓名 | 金额 |",
  "| --- | --- |",
  "| 张三 | 1200 |",
  "",
  "```js",
  "const a = 1",
  "```",
  "",
  "---",
  "",
].join("\n")

/** 打开一份 `.md` 并把六个结构各量一遍（算出来的样式）。 */
async function 量一份(page: Page, 项目名: string, 名字: string, context: BrowserContext) {
  const 甲 = await 备项目(项目名, 名字, 文档)
  await 进项目(page, context, 甲.id)
  await 打开(page, `卷宗/${名字}`)

  return page.evaluate(() => {
    const 容器 = document.querySelector("[data-component='richtext-view']")
    if (!容器) return null
    const 取 = (选择器: string) => {
      const el = 容器.querySelector(选择器)
      if (!el) return null
      const s = getComputedStyle(el)
      return {
        字号: Number.parseFloat(s.fontSize),
        字重: Number.parseFloat(s.fontWeight),
        列表: s.listStyleType,
        左内边距: Number.parseFloat(s.paddingLeft),
        下外边距: Number.parseFloat(s.marginBottom),
        左边框宽: Number.parseFloat(s.borderLeftWidth),
        下边框宽: Number.parseFloat(s.borderBottomWidth),
        背景: s.backgroundColor,
        颜色: s.color,
        装饰: s.textDecorationLine,
      }
    }
    return {
      记号: 容器.getAttribute("data-format"),
      h1: 取("h1"),
      h2: 取("h2"),
      p: 取("p"),
      无序: 取("ul"),
      无序项: 取("ul li"),
      有序项: 取("ol li"),
      引用: 取("blockquote"),
      代码块: 取("pre"),
      行内代码: 取("p code"),
      表: 取("table"),
      表头: 取("th"),
      单元格: 取("td"),
      链接: 取("p a"),
      分隔线: 取("hr"),
    }
  })
}

/**
 * 拿不到就当场红（而不是让后面的 `.` 链静默变成 `undefined` 比较）。
 *
 * 用 `throw` 而不是 `expect(…).not.toBeNull()`：断言**不缩窄类型**，返回处就得再补一个 `as`，
 * 而那个 `as` 会被 `no-unsafe-type-assertion` 记一笔（本仓 e2e 里这类命中已经很多）。
 * 泛型参数上的 `=== null` 是能正常缩窄的，所以这里既不用断言也拿得回**原本那个面**的类型
 * （返回联合类型的话，`h1.字号` 这种取值就过不了类型检查）。
 */
function 取<面>(面: 面 | null, 名: string): 面 {
  if (面 === null) throw new Error(`没量到 ${名}（不是本 spec 的被测属性，是前面那步没走通）`)
  return 面
}

test("标题不是正文：两级标题都比正文字号大、且两级之间有差、字重更重", async ({ page, context }) => {
  const 得 = 取(await 量一份(page, `版面·标题·${Date.now()}`, "格式.md", context), "预览容器")
  const h1 = 取(得.h1, "h1 标题")
  const h2 = 取(得.h2, "h2 标题")
  const p = 取(得.p, "正文 p")

  expect(h1.字号, `一级标题【${h1.字号}px】要比正文【${p.字号}px】大`).toBeGreaterThan(p.字号)
  expect(h2.字号, `二级标题【${h2.字号}px】要比正文【${p.字号}px】大`).toBeGreaterThan(p.字号)
  expect(h1.字号, `一级【${h1.字号}px】要比二级【${h2.字号}px】大（两级不是一个字号）`).toBeGreaterThan(h2.字号)
  expect(h1.字重, `一级标题【字重 ${h1.字重}】要比正文【字重 ${p.字重}】重`).toBeGreaterThan(p.字重)
})

test("列表有符号、有缩进，项与项之间分开", async ({ page, context }) => {
  const 得 = 取(await 量一份(page, `版面·列表·${Date.now()}`, "格式.md", context), "预览容器")
  const 无序 = 取(得.无序, "ul")
  const 无序项 = 取(得.无序项, "ul li")
  const 有序项 = 取(得.有序项, "ol li")

  expect(无序项.列表, `无序列出了符号吗（实得 list-style: ${无序项.列表}）`).toBe("disc")
  expect(有序项.列表, `有序列出了序号吗（实得 list-style: ${有序项.列表}）`).toBe("decimal")
  expect(无序.左内边距, `列表的缩进（实得 ${无序.左内边距}px，0 ＝ 贴着正文左缘）`).toBeGreaterThan(0)
  expect(无序项.下外边距, `项与项之间（实得 ${无序项.下外边距}px，0 ＝ 两行紧贴）`).toBeGreaterThan(0)
})

test("引用有左边的竖线、且颜色比正文淡", async ({ page, context }) => {
  const 得 = 取(await 量一份(page, `版面·引用·${Date.now()}`, "格式.md", context), "预览容器")
  const 引用 = 取(得.引用, "blockquote")
  const p = 取(得.p, "正文 p")

  expect(引用.左边框宽, `引用的左竖线（实得 ${引用.左边框宽}px）`).toBeGreaterThan(0)
  expect(引用.颜色, `引用的字色【${引用.颜色}】要与正文【${p.颜色}】分开`).not.toBe(p.颜色)
})

test("代码块有底色、有留白；行内代码也看得出是代码", async ({ page, context }) => {
  const 得 = 取(await 量一份(page, `版面·代码·${Date.now()}`, "格式.md", context), "预览容器")
  const 代码块 = 取(得.代码块, "pre")
  const 行内代码 = 取(得.行内代码, "p code")

  expect(代码块.背景, `代码块的底色（实得 ${代码块.背景}，透明 ＝ 与正文同底）`).not.toBe("rgba(0, 0, 0, 0)")
  expect(代码块.左内边距, `代码块的留白（实得 ${代码块.左内边距}px）`).toBeGreaterThan(0)
  expect(行内代码.背景, `行内代码的底色（实得 ${行内代码.背景}）`).not.toBe("rgba(0, 0, 0, 0)")
})

test("表格有框线、表头与表体分得开", async ({ page, context }) => {
  const 得 = 取(await 量一份(page, `版面·表格·${Date.now()}`, "格式.md", context), "预览容器")
  const 单元格 = 取(得.单元格, "td")
  const 表头 = 取(得.表头, "th")

  expect(单元格.下边框宽, `单元格的框线（实得 ${单元格.下边框宽}px，0 ＝ 像一段散着的字）`).toBeGreaterThan(0)
  expect(单元格.左内边距, `单元格内的留白（实得 ${单元格.左内边距}px）`).toBeGreaterThan(0)
  expect(表头.背景, `表头的底色（实得 ${表头.背景}，透明 ＝ 与表体一样）`).not.toBe("rgba(0, 0, 0, 0)")
})

test("链接看得出是链接：颜色与正文分开、带下划线", async ({ page, context }) => {
  const 得 = 取(await 量一份(page, `版面·链接·${Date.now()}`, "格式.md", context), "预览容器")
  const 链接 = 取(得.链接, "p a")
  const p = 取(得.p, "正文 p")

  expect(链接.颜色, `链接的字色【${链接.颜色}】要与正文【${p.颜色}】分开`).not.toBe(p.颜色)
  expect(链接.装饰, `链接的下划线（实得 text-decoration: ${链接.装饰}）`).toContain("underline")
})

/**
 * **对照**：`.txt` 预览的正文本身就是一个 `<pre>`，而 `.md` 里同一个标签名是**代码块**
 * ——两个渲染器往同一只容器里写（`BinaryView` 换文件时只 `replaceChildren()`，**容器不重挂**）。
 * 这条判的是「代码块的样式没有被裸挂在 `[data-component="richtext-view"]` 上」：
 * 少了那个 `data-format` 限定，话单正文会被涂上代码块的底色与内边距，而**别的判据一条都不会红**。
 */
test("对照：`.txt` 的正文没被代码块的样式咬到（底色仍透明、没有内边距）", async ({ page, context }) => {
  const 甲 = await 备项目(`版面·txt·${Date.now()}`, "摘录.txt", "第一行\n  缩进的第二行\n")
  await 进项目(page, context, 甲.id)
  await 打开(page, "卷宗/摘录.txt")

  const 实得 = await page.evaluate(() => {
    const 容器 = document.querySelector("[data-component='richtext-view']")
    const pre = 容器?.querySelector("pre") ?? null
    if (!pre) return null
    const s = getComputedStyle(pre)
    return { 记号: 容器?.getAttribute("data-format"), 背景: s.backgroundColor, 左内边距: Number.parseFloat(s.paddingLeft) }
  })

  const 得 = 取(实得, "txt 预览里正文那个 <pre>")
  expect(得.记号, `txt 的容器记号（实得 ${得.记号}，代码块的样式是按它分流的）`).toBe("text")
  expect(得.背景, `话单正文的底色（实得 ${得.背景}）`).toBe("rgba(0, 0, 0, 0)")
  expect(得.左内边距, `话单正文的左边距（实得 ${得.左内边距}px）`).toBe(0)
})
