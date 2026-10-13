import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-13 · **AI 会话改了中栏开着的文档 ⇒ 那张 tab 亮圆点；点一下 ⇒ 中栏换成新正文**（用户实报：
 * 「在中栏浏览打开的文件，如果该文件通过 AI 会话进行了修改，用户要如何知道呢？知道后如何让最新的
 * 文档内容予以呈现呢？」）。
 *
 * ## 为什么单测 ＋ 组件测都绿了，这一份仍然要写（`LEARNINGS #006-27`）
 *
 * 这个功能**整条链**是「内核发事件 → SSE 送到浏览器 → 前端把**绝对路径**还原成**项目相对路径** →
 * 登记 → tab 亮圆点 → 点一下重读」。三层测试各钉了自己那一段，而**接缝**一个都没钉：
 *
 * | 段 | 谁钉的 | 那一段证不了的事 |
 * |---|---|---|
 * | 登记处 / 归一 / 圆点 / 重挂 | 单测 ＋ 组件测（`session-edits.test.ts` 等，66 条） | 喂进去的事件是**我按形状手搓的** |
 * | 内核发 `file.edited` | —— | 没有任何测试钉过「真模型改文件时它真的发出来」 |
 *
 * 这一份量的是接缝：**真模型 ＋ 真内核 ＋ 真浏览器**。其中三件只有真栈能证：
 *
 * ① **事件真的到浏览器**，且 `properties.file` 是**绝对路径**、事件的 `directory` 就是**本项目目录**
 *    （本仓 win32 上沙箱路径是 8.3 短名 `ADMINI~1`、而项目清单那一行是长名 `Administrator`
 *    —— `LEARNINGS #006-23` 那族：两边不同形时不报错、不变红，只是**圆点永远不出现**）；
 * ② **前端那一段还原真的接得上**（`归一事件路径` 在**真的**两个字符串之间跑，不是在夹具上）；
 * ③ **点一下真能换新**（重挂发生在中栏、重读走 `props.load` 那条真出口）。
 *
 * ## 判据为什么落在「中栏正文」上，而不是落在圆点上
 *
 * 圆点是**中间产物**。这条链要的最终结果只有一个：**民警看见新的那份**。所以本 spec 先钉
 * 「AI 真改了盘」（`file.edited` 的因），再钉「中栏**还没**换」（用户实报的那个现象本身），
 * 最后钉「点一下之后中栏**是**新正文」。只钉圆点的话，一个「亮着但点了没反应」的实现照样绿
 * （`LEARNINGS #005-25`：修的是行为、判据钉的却是中间产物）。
 *
 * ⚠️ **不钉「中栏一定停在旧正文」过长时间**：AI 那一轮跑完之前中栏当然是旧的，而这条断言在
 * AI 改盘**之前**是空的。所以顺序是：先等**圆点**（＝事件已到、盘已变），**再**断中栏仍是旧的
 * 那一句——那一刻它是有牙的。
 */

/**
 * 从一个 JSON 值里取顶层的字段（原样，不做类型判断；不是对象就 `undefined`）。
 *
 * 用它而不是 `as { id?: string }`：断言式读法在这份 spec 里吃 `no-unsafe-type-assertion`
 * （从 `unknown` 往窄里断也算，同族那两份 spec 各带 5 条）。而这条判据**本来就不该靠断言**
 * ——它读的是真内核回的形状，「字段在不在、是什么类型」当场问一句，比事后声明一个类型更接近
 * 这条 spec 想量的事。
 */
function 取字段(值: unknown, 名: string): unknown {
  if (typeof 值 !== "object" || 值 === null) return undefined
  for (const [键, 字段] of Object.entries(值)) if (键 === 名) return 字段
  return undefined
}

/**
 * 真栈状态文件（`stack.ts` 在端口就绪前写它）。
 *
 * ⚠️ **每次现读、不在模块级缓存**（同 `ai-session-real.spec.ts` 那条注释）：Playwright 可能在
 * `webServer` 起栈**之前**就加载本文件，那时模块级 `const` 会把**上一套栈**冻在里面 ⇒ 打到
 * 另一套栈上，读别人的会话、写别人的数据，而断言照样绿（`#003-01`：测量打到别的对象上）。
 */
function readStack() {
  const 值: unknown = JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8"))
  const 要数 = (名: string) => {
    const 字段 = 取字段(值, 名)
    if (typeof 字段 !== "number") throw new Error(`真栈状态文件里的 ${名} 不是数字`)
    return 字段
  }
  const token = 取字段(值, "token")
  if (typeof token !== "string") throw new Error("真栈状态文件里没有 token")
  return { kernel: 要数("kernel"), front: 要数("front"), token }
}

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`

/** 打真内核的一个出口。`body` 是 `unknown`：形状由各调用点当场问（见 `取字段`）。 */
async function kernelJson(
  url: string,
  init: RequestInit = {},
  额外头: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${KERNEL()}${url}`, {
    ...init,
    headers: { Cookie: COOKIE(), ...额外头 },
  })
  const 体: unknown = res.ok ? await res.json() : await res.text()
  return { status: res.status, body: 体 }
}

async function 建真项目(名: string): Promise<{ id: string; directory: string }> {
  const 建 = await kernelJson(
    "/openhive/project",
    { method: "POST", body: JSON.stringify({ name: 名, type: "private" }) },
    { "content-type": "application/json" },
  )
  expect(建.status, "真内核建项目应成功").toBe(200)
  const id = 取字段(建.body, "id")
  expect(id, "建项目应当回一个服务端给的 id").toBeTruthy()
  if (typeof id !== "string") throw new Error("建项目回的 id 不是字符串")

  const 列 = await kernelJson("/openhive/project")
  const 表: unknown[] = Array.isArray(列.body) ? 列.body : []
  const 目录 = 表
    .map((行) => (取字段(行, "id") === id ? 取字段(行, "directory") : undefined))
    .find((x): x is string => typeof x === "string")
  expect(目录, "列项目应当给出这一行的 directory").toBeTruthy()
  if (typeof 目录 !== "string") throw new Error("列项目没给出这一行的 directory")
  return { id, directory: 目录 }
}

/**
 * 等「当前项目被**认领**」这一档真的到（`data-state` 离开 `empty`）。
 *
 * ⚠️ 这一步挡的是**挂具伪影**、不是产品缺陷：启动期浏览器并发打 `/openhive/auth/me` 与
 * `/openhive/project`，而真栈的库是 PGlite（单 PG 会话 ＋ 实例级预编译语句名）⇒ 同进程并发准备
 * 同一句 SQL 就撞 `42P05 duplicate_prepared_statement`，症状是启动那两条 **500**。理由与证据见
 * `project-list-failure-real.spec.ts` 与 `LEARNINGS #002-05` / `#005-02`。重载是测试挂具取的
 * 等价出口（真用户那一刻有「重试」钮）。
 *
 * 判据是**可观测的就绪条件**、不是等时间（`#006-31`）。
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

/** 中栏那张 tab（按标题里的文件名认，tab 上没有 `data-path`）。 */
const 那张tab = (page: Page, 文件名: string) => page.locator("[data-slot='tab']").filter({ hasText: 文件名 })

/** 圆点（`tab-bar.tsx` 的 `tab-edited-dot`）。 */
const 圆点 = (page: Page) => page.locator("[data-slot='tab-edited-dot']")

/** 中栏此刻的正文（`richtext-view` 渲染出来的那段文字）。 */
const 中栏正文 = (page: Page) => page.locator("[data-component='richtext-view']")

test("AI 会话改了中栏开着的文档 ⇒ 那张 tab 亮圆点；点一下 ⇒ 中栏真换成新正文", async ({ page, context }) => {
  // 这一条要等**真模型跑完一轮带工具调用的对话**（几十秒），默认 120s 的上限就是它。
  test.setTimeout(240_000)

  const 甲 = await 建真项目(`会话改文件·${Date.now()}`)
  const 目录 = path.join(甲.directory, "卷宗")
  mkdirSync(目录, { recursive: true })
  const 文件 = path.join(目录, "纪要.md")
  writeFileSync(文件, "# 纪要\r\n\r\n旧的第一行\r\n", "utf8")

  await 进项目(page, context, 甲.id)
  // ⚠️ 顺序不能换：`expand-all` 要等树**先落到 DOM 上**才有东西可展开（同 `center-pane-space-real`）。
  await expect(行(page, "卷宗")).toBeVisible({ timeout: 30_000 })
  await page.locator("[data-action='expand-all']").click()
  await expect(行(page, "卷宗/纪要.md")).toBeVisible({ timeout: 30_000 })

  // ① 中栏开着这一份，正文是**盘上那份**。
  await 行(page, "卷宗/纪要.md").dblclick()
  await expect(中栏正文(page)).toContainText("旧的第一行", { timeout: 30_000 })
  await expect(圆点(page), "还没让 AI 改过，此刻不该有圆点").toHaveCount(0)

  // ② 左栏切到「会话」、新建一场 ⇒ 右栏出现（用户的实际形态：中栏开着文件、右栏让 AI 干活）。
  // ⚠️ 走**左栏那颗钮**（客户端导航），不是 `page.goto`——整页重载会把中栏那张 tab 丢掉，
  //    那样这条用例测的就不是「中栏开着文件」这个前提了。
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()
  await page.locator("[data-slot='session-new']").click()

  const hero = page.locator("[data-slot='session-hero']")
  await expect(hero.locator("[data-component='prompt-input']")).toBeVisible({ timeout: 30_000 })

  // ③ 让 AI 改这份文件。**给绝对路径**（模型不必猜目录），并要求直接改。
  await hero
    .locator("[data-component='prompt-input']")
    .fill(`请用 write 工具把文件 ${文件} 的内容整体替换成下面这一行，不要问我，直接改：\n已被AI改过`)
  await hero.locator("[data-action='prompt-submit']").click()

  // ④ 圆点出现 ＝「盘上真的变了、事件真的到了浏览器、前端真的认出来了」。
  //    真模型跑一轮要几十秒（含工具调用），所以这条给足上限；它红了才是本 spec 要抓的东西。
  await expect(圆点(page), "AI 改完文件之后，那张 tab 上应当长出圆点").toHaveCount(1, { timeout: 120_000 })

  // ⑤ **先证因**：盘上确实是新正文（圆点若亮着而盘上没变，那是**假圆点**，得当场看见）。
  expect(
    readFileSync(文件, "utf8"),
    "AI 应当真的把盘上那份改了 —— 圆点亮的依据是「盘变了」，不是「AI 说了话」",
  ).toContain("已被AI改过")

  // ⑥ **用户实报的那个现象**：此刻中栏**还停在旧正文**（取数是一次性的）。这一句在 ④ 之后是**有牙**的
  //    ——若实现成了「收到事件就自动重读」，这句会红，而那是**产品该红**（不能把正在编辑的草稿冲掉）。
  await expect(中栏正文(page), "点它之前，中栏不该自己换掉（不打扰正在看的人）").toContainText("旧的第一行")

  // ⑦ 点那张 tab ⇒ 换新。
  await 那张tab(page, "纪要.md").click()
  await expect(中栏正文(page)).toContainText("已被AI改过", { timeout: 30_000 })
  // 圆点跟着消失（用户看见了）。**排在最后**：它是伴随信号，用户要的最终结果在中栏正文上。
  await expect(圆点(page), "用户看过了，圆点该收掉").toHaveCount(0)
})
