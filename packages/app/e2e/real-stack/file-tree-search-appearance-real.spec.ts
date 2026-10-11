import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · **文件 tab 的搜索框真的长成了图里那样**（005 加固轮 ⑦-⑨）。
 *
 * ## 用户实报（原话）
 *
 * 「把项目管理 文件 Tab 页面上的搜索框改成 `images/screen/2026-10-10_192210.png` 图片的样式。」
 * 三条裁定：风格 ⇒ **复用设计系统 `TextInputV2`**；占位 ⇒ **「搜索文件」**；高度 ⇒ **保持 24px 与钮齐平**。
 *
 * ## 为什么这一条必须落**真栈**（组件层那条一个字都量不到）
 *
 * happy-dom 没有 CSS 引擎（`#005-07` / `#006-22`）——它只能读 `className` **串**，读不到任何一个
 * 几何量。`file-tree.test.tsx` 里那条已钉住**结构**（换成了 `TextInputV2`、放大镜在、占位对），
 * 而本轮的**全部风险都在 CSS 侧**，恰恰是它读不到的那一半：
 *
 * ① **`!h-6` 到底压没压过设计系统写死的 `height: 28px`**——`text-input-v2.css` 里
 *    `[data-component="text-input-v2"]` 是**类选择器**、`height: 28px` 是普通声明；
 *    我们那两条（`!h-6` / `!w-full`）靠 Tailwind 的 `!important` 才赢得下来。**这是用户裁定的
 *    「与钮齐平」整条的实现**——`!important` 没生效的话高度会**静静**留在 28px，而结构那条用例
 *    依然全绿（它读的是 DOM 形状，不是盒子）。
 * ② **圆角 / 底色 / 底纹**是不是真从设计系统那道样式表里落下来了（样式表没进这个页面的 CSS 图
 *    也是同一个症状：组件在、样子不在）。
 * ③ **放大镜真画出来了**——v2 图标是 `<use href="#opencode-v2-icon-…">` 引一份运行时插进 `<body>`
 *    的 sprite；sprite 没插进去时 `<svg>` 照样在、盒也有，**里面是空的**。要量的不只是「有一个
 *    svg」，还有「它指的那个 `#id` 在文档里」。
 * ④ **它在工具栏里跟那五颗钮真的齐平**——同高、同中线。这条只能靠 `getBoundingClientRect()`。
 *
 * 同族的坑：`#005-32`（量错了对象 ⇒ 读数整齐得像产品坏）、`#006-06`（拿量不出东西的属性当判据，
 * 恒绿）。所以本 spec 把**原始读数整个 `console.log` 出来**，断言之外留一份可核对的数。
 *
 * ## 亮底是**钉死的前提**，不是判据的巧合
 *
 * 图是**亮底**的。oc-2 主题亮色的 `v2-background-bg-base = #FCFCFC`（暖白），暗色是
 * `var(--v2-grey-1100)`（近黑）——**同一个组件、两种底色**。不钉 `colorScheme` 的话，这条断言
 * 会跟着跑测机器的系统偏好变（Playwright 默认虽是 `light`，那是默认、不是契约）。
 * 故本 spec 显式 `test.use({ colorScheme: "light" })`：它钉的是**亮底那一格**，暗底不是同一条判据。
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

/** 工具栏那五颗钮的 `data-action`（顺序即设计 §6.1 的表格顺序）。 */
const 五颗 = ["collapse-all", "expand-all", "create", "rename", "delete"] as const

/**
 * 一次取齐所有读数。
 *
 * ⚠️ 查询一律**从 `[data-slot='sandbox-tree']` 往下**：文件 tab 是**双树**
 * （`dual-file-tree.tsx`：上树＝沙箱、下树＝MinIO），两棵树各有一颗搜索框。默认收起态下树不渲染，
 * 但「今天只有一个」不是判据——`dual-file-tree.test.tsx` 那条也是这么限定作用域的。
 */
const 量 = (page: Page) =>
  page.evaluate((五颗) => {
    const 圆 = (n: number) => Math.round(n)
    const 盒 = (el: Element | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        左: 圆(r.left),
        上: 圆(r.top),
        宽: 圆(r.width),
        高: 圆(r.height),
        中线: 圆(r.top + r.height / 2),
      }
    }
    const 上树 = document.querySelector<HTMLElement>("[data-slot='sandbox-tree']")
    const 工具栏 = 上树?.querySelector<HTMLElement>("[data-slot='file-tree-toolbar']") ?? null
    const 壳 = 上树?.querySelector<HTMLElement>("[data-slot='file-tree-search']") ?? null
    const 件 = 壳?.querySelector<HTMLElement>("[data-component='text-input-v2']") ?? null
    const 输入 = 件?.querySelector<HTMLInputElement>("input[data-action='search']") ?? null
    const 镜 = 件?.querySelector<HTMLElement>("[data-slot='text-input-v2-leading-icon'] [data-slot='icon-svg']") ?? null
    const 引 = 镜?.querySelector("use")?.getAttribute("href") ?? null
    const 样式 = 件 ? getComputedStyle(件) : null

    return {
      工具栏: 盒(工具栏),
      壳: 盒(壳),
      件: 盒(件),
      输入: 盒(输入),
      钮: 五颗.map((action) => 盒(工具栏?.querySelector(`[data-action='${action}']`) ?? null)),
      镜: 盒(镜),
      // 件内图标**总数**：1 ⇒ 只有左放大镜，右侧没多长出复制 / 清除钮（那两个没传 `show*Button`）。
      件内图标数: 件?.querySelectorAll("[data-slot='icon-svg']").length ?? -1,
      镜引: 引,
      镜引得到符号吗: 引 ? document.querySelector(引) !== null : false,
      占位: 输入?.getAttribute("placeholder") ?? null,
      // CSS 侧（`getComputedStyle`）——组件层一个字都读不到的那半边。
      高: 样式?.height ?? null,
      宽: 样式?.width ?? null,
      圆角: 样式?.borderTopLeftRadius ?? null,
      底色: 样式?.backgroundColor ?? null,
      底纹: 样式?.backgroundImage ?? null,
    }
  }, 五颗 as unknown as string[])

/**
 * 一棵够筛的树：三个顶层条目（末条用于第 4 条用例的「边打边筛」）。
 *
 * ⚠️ **必须在 `进项目` 之前调**——本 spec 第一版把它放在后面，4 条里红了 1 条、红的落点是
 * 「等树上那三行」的 30s 超时（`element(s) not found`），读起来像偶发 flake，其实是**竞态**：
 * 文件清单是**文件 pane 挂载那一刻取一次**的，之后**不再看盘**（这正是 ⑦-⑧ 要给右键菜单加
 * 一颗「刷新」的原因）⇒ 先切到文件 tab、再往盘上写，写进去的那几个文件**永远不回来**。
 * 同一形状的 30s 超时在 `file-tree-copy-path-real.spec.ts` 里被记成了「3 次里 1 次偶发」。
 */
function 备好树(directory: string) {
  writeFileSync(path.join(directory, "话单.csv"), "主叫,被叫\n138,139\n")
  writeFileSync(path.join(directory, "资金流水.xlsx"), "a\n")
  writeFileSync(path.join(directory, "报告.docx"), "b\n")
}

/** 等上树把那三行渲染出来。 */
const 等树 = (page: Page) =>
  expect(page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row']").first()).toBeVisible({
    timeout: 30_000,
  })

/** 树里现在看得见的文件名（顶层，全收缩态）。 */
const 可见行 = (page: Page) =>
  page.locator("[data-slot='sandbox-tree'] [data-slot='file-tree-row']").allTextContents()

test.use({ colorScheme: "light" })

test("搜索框是 **24px**：`!h-6` 压过了设计系统写死的 28px，且与五颗钮同高、同中线", async ({ page, context }) => {
  const 甲 = await 建真项目(`搜索框外观·齐平·${Date.now()}`)
  备好树(甲.directory)
  await 进项目(page, context, 甲.id)
  await 等树(page)

  const 读 = await 量(page)
  console.log(`[齐平] ${JSON.stringify(读, null, 2)}`)

  // 前提：这五个盒子都在。缺一个 ⇒ 下面的读数没有意义（`#003-01`：先证明测量）。
  expect(读.件, "设计系统那颗输入框应当在").not.toBeNull()
  expect(读.钮.every((b) => b !== null), "工具栏五颗钮应当都在").toBe(true)

  // ① 用户裁定的 24px——**这一条就是 `!h-6` 的守护者**（拆掉它，这里读回 28）。
  expect(读.件!.高, "搜索框盒高应当是 24px（`!h-6` 压过设计系统的 28px）").toBe(24)
  // ② 「与钮齐平」：同高 ＋ 同中线。两条分开断——同高不等于齐平（错位同样同高）。
  expect(new Set(读.钮.map((b) => b!.高)), "五颗钮应当都是 24px").toEqual(new Set([24]))
  expect(new Set(读.钮.map((b) => b!.中线)), "五颗钮中线应当一致").toEqual(new Set([读.钮[0]!.中线]))
  expect(读.件!.中线, "搜索框中线应当与钮齐平").toBe(读.钮[0]!.中线)
  // ③ 工具栏本身没被撑高（24 是整条工具栏的高，不是框自己的高）。
  expect(读.工具栏!.高, "工具栏本身应当是 24px").toBe(24)
  // ④ `!w-full`：框撑满那层 `flex-1` 的壳，而不是设计系统写死的 280px。
  expect(读.壳, "壳应当在").not.toBeNull()
  expect(读.件!.宽, "搜索框应当撑满它那层壳").toBe(读.壳!.宽)
  expect(读.件!.宽, "壳应当有实际宽度").toBeGreaterThan(0)
})

test("底色 / 圆角 / 底纹是从设计系统那张样式表落下来的（`text-input-v2.css` 真进了这个页面）", async ({
  page,
  context,
}) => {
  const 乙 = await 建真项目(`搜索框外观·底色·${Date.now()}`)
  备好树(乙.directory)
  await 进项目(page, context, 乙.id)
  await 等树(page)

  const 读 = await 量(page)

  // 圆角：`text-input-v2.css` 的 `border-radius: 6px`（不是浏览器默认的 0 / Tailwind 的别的档）。
  expect(读.圆角, "圆角应当是设计系统的 6px").toBe("6px")
  // 底色：oc-2 **亮色** 的 `v2-background-bg-base` = `#FCFCFC` 暖白（见文件头：亮底是钉死的前提）。
  expect(读.底色, "底色应当是 oc-2 亮色主题的暖白 #FCFCFC").toBe("rgb(252, 252, 252)")
  // 底纹：那道 `linear-gradient(...)` 是这张样式表的签名——底色对了但底纹丢了，说明只落了一部分。
  expect(读.底纹, "底纹应当是设计系统那道渐变").toContain("linear-gradient")
})

test("左侧放大镜**真画出来了**：14×14 的 <svg>，且它 `<use>` 指的那个 sprite 符号在文档里", async ({
  page,
  context,
}) => {
  const 丙 = await 建真项目(`搜索框外观·放大镜·${Date.now()}`)
  备好树(丙.directory)
  await 进项目(page, context, 丙.id)
  await 等树(page)

  const 读 = await 量(page)

  expect(读.镜, "放大镜应当在").not.toBeNull()
  // 盒得真有尺寸——`display: contents` / 未挂载那些壳会读成零矩形（`#005-32`）。
  expect(读.镜!.宽, "放大镜应当有宽度").toBe(14)
  expect(读.镜!.高, "放大镜应当有高度").toBe(14)
  // ⚠️ 这一条是 `<svg>` 在、**里面是空的**那种失败的唯一守护者：v2 图标是 `<use href="#…">`
  // 引一份运行时插进 `<body>` 的 sprite（`icon.tsx` 的 `ensureSprite`），sprite 没插进去时
  // svg 照样在、盒也有——只是什么都不画。
  expect(读.镜引, "放大镜应当用 <use> 引一个符号").toBe("#opencode-v2-icon-magnifying-glass")
  expect(读.镜引得到符号吗, "那个符号得真的在文档里，否则图标是空的").toBe(true)
  // 右侧**没有**多长出复制 / 清除钮（那两个 prop 没传）。
  expect(读.件内图标数, "件内应当只有左侧这一枚图标").toBe(1)
})

test("占位是「搜索文件」，且换成这颗框之后**照样打得进字、边打边筛**", async ({ page, context }) => {
  const 丁 = await 建真项目(`搜索框外观·能打·${Date.now()}`)
  备好树(丁.directory)
  await 进项目(page, context, 丁.id)
  await 等树(page)

  const 读 = await 量(page)
  expect(读.占位, "占位应当是「搜索文件」").toBe("搜索文件")

  // 换壳有没有打断交互——这是本轮最该防的回归（用户要的就是这颗框好用）。
  // ⚠️ 用 `.fill()` 会**先聚焦**（`#005-17`），那样量不到「这颗壳拦不拦焦点」；用裸键盘 + 先点一下。
  const 输入框 = page.locator("[data-slot='sandbox-tree'] input[data-action='search']")
  await 输入框.click()
  await 输入框.pressSequentially("话单", { delay: 20 })

  await expect.poll(() => 可见行(page), { timeout: 5_000 }).toEqual(["话单.csv"])
  // 值也真进了那个 input（不是被壳的某处吃掉了）。
  await expect(输入框).toHaveValue("话单")
})
