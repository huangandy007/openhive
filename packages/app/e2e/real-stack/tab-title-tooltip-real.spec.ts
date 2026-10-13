import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-13 · **中栏 tab 的标题提示**（用户实报：「鼠标移动到中栏打开的 Tab 页面时，能够提示 Tab 页面的
 * 文件名（全名），目前文件名较长时会被截断显示，用『…』」；同日用户裁定：只给**文件名**、不带目录，
 * 且**只在被截断时**弹）。
 *
 * ## 为什么这一条只能在真栈上判
 *
 * 「这个 span 被截了吗」是两个几何数的比较（`scrollWidth` / `clientWidth`），
 * 「悬停之后弹的是什么」是一个**真指针事件**与浮层的产物 —— 两样 happy-dom 都给不出：
 * 它没有排版引擎（`LEARNINGS #006-06`：那两个数恒为 0），hover / focus 也**打不开**浮层
 * （2026-10-09 探针实测，`LEARNINGS #006-18`）。`tab-bar.test.tsx` 那三条能钉「判定与接线」（几何靠喂），
 * 钉不住「屏幕上弹出来的那串字」。
 *
 * ## 五条判据
 *
 * ① **前提**：长名文件开出来后，标题**真的**被截断（`scrollWidth > clientWidth`）——这条不成立，
 *    下面的正向判据就是**假红**（没截断本来就不该弹）；
 * ② 悬停标题 ⇒ `[data-component='tooltip-v2']` 的文本 **=== 文件名全名**（逐字）。
 *    这一条同时是标题壳那层 `min-w-0` 的**唯一守护者**（实测：拆掉它，红在这里）；
 * ③ **短名**文件的 tab 悬停标题 ⇒ **一条提示都不出现**（等过 `openDelay` 400ms 那个窗再看）；
 * ④ 同一张短名 tab 上改悬停**关闭钮** ⇒ 「关闭 〈全名〉」照常出现 —— 既是③的**自证**
 *    （同一张 tab 上 hover 是有效的，只是标题那颗不弹），也证明 `inactive` 没连坐别处；
 * ⑤ tab 宽度 ≤ 176px（`max-w-44`）且标题**仍是截断态**。⚠️ **回归绳、不是守护者**——
 *    拆掉 `min-w-0` 它照样绿（理由与实测见 ② 之后那段注释）。
 *
 * 夹具体例抄自同族的 `richtext-reading-size-real.spec.ts`（只换判据点，`LEARNINGS #004-12`），
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
 * 一张 tab 的标题 span。这一份 spec 每次只开**一个**文件 ⇒ 它就是第一张，取 `first()` 而不是按名字
 * 拼选择器——判据里的名字是**长名 / 短名两份夹具**，按名字取会让选择器在两条用例里长得不一样。
 */
const 标题 = (page: Page) => page.locator("[data-slot='tab-title']").first()

/** 悬停提示的内容（`TooltipV2` 走 Portal 挂在 body 上，故不挂在本页的子树里）。 */
const 提示 = (page: Page) => page.locator("[data-component='tooltip-v2']")

/** 标题此刻的几何：内容多宽、看得见多宽。截断的判据就是这两个数。 */
const 量标题 = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-slot='tab-title']")
    if (!el) return null
    return { 内容: el.scrollWidth, 看得见: el.clientWidth, 文字: el.textContent ?? "" }
  })

/** tab 盒子有多宽（`max-w-44` ＝ 176px）。 */
const 量tab宽 = (page: Page) =>
  page.evaluate(() => document.querySelector("[data-slot='tab']")?.getBoundingClientRect().width ?? null)

/** 认一认「这一张标题此刻多大」，红了要看得见实得值。 */
const 这标题 = (量: { 内容: number; 看得见: number; 文字: string } | null) =>
  量 ? `【文字「${量.文字}」 内容 ${量.内容} / 看得见 ${量.看得见}】` : "（没找到标题）"

/** 长名夹具：`max-w-44` 那一档（176px）显然装不下，判据①要的就是它**真的**被截。 */
const 长名 = "2026-10-12-关于某某资金流向的初步核查情况说明（第2版）.md"
/** 短名夹具：176px 装得下，故标题那颗提示**不该**弹（用户裁定的那一半）。 */
const 短名 = "纪要.md"

test("长名被截 ⇒ 悬停标题弹出文件名全名；且没把 tab 撑破", async ({ page, context }) => {
  const 甲 = await 备项目(`提示·长名·${Date.now()}`, 长名, "# 纪要\n\n第一行\n")
  await 进项目(page, context, 甲.id)
  await 打开(page, `卷宗/${长名}`)

  // ① 前提：这一张标题**真的**被截断了。不成立的话，下面那条正向判据即使绿也是空转。
  const 量 = await 量标题(page)
  expect(量, "长名那一张应当有标题").not.toBeNull()
  expect(量!.文字, "标题上的文字就是文件名（截断只发生在显示上，不改 DOM 里的字）").toBe(长名)
  expect(
    量!.内容 > 量!.看得见,
    `前提：标题此刻应当是**被截断**的。实得 ${这标题(量)}；两个数相等说明这一档宽度装得下，` +
      `那这条用例的前提就没成立（要么夹具名太短，要么 tab 宽度变了）。`,
  ).toBe(true)

  // ② 悬停标题 ⇒ 弹出来的就是全名。`toHaveText` 自己重试，覆盖 `openDelay` 400ms 那个窗。
  await 标题(page).hover()
  await expect(提示(page), "悬停被截断的标题应当弹出提示").toHaveText(长名, { timeout: 10_000 })

  /*
    ⑤ 提示壳挂上去之后，布局**没有**反过来被撑破：tab 仍不超过 176px，标题仍是截断态。

    ⚠️ **这两条不是 `min-w-0` 的守护者**——2026-10-13 实测：把 `min-w-0` 拆掉，它们**照样绿**
    （而且 ② 先红了 ⇒ 这一段的射程根本走不到，`LEARNINGS #005-46`）。两条各自兜不住的原因：
    tab 宽被 `max-w-44` 兜死（与壳无关）；而那次变异之后壳被摘掉、标题回到「直接挂在 tab 下」的形态，
    于是「仍被截断」也照样为真。留着它们是**回归绳**（万一有人把 `max-w-44` 拆了），不是守护者。
    `min-w-0` 的守护者就是 ②：那次变异下它是唯一变红的。
  */
  const 宽 = await 量tab宽(page)
  expect(宽, "tab 应当有宽度").not.toBeNull()
  expect(宽!, `tab 宽度不该超过 max-w-44（176px）。实得 ${宽}px`).toBeLessThanOrEqual(176)
  const 挂壳后 = await 量标题(page)
  expect(
    挂壳后!.内容 > 挂壳后!.看得见,
    `提示壳挂上之后标题仍应是被截断的（回归绳，见上面那段注释：它拦不住 min-w-0 那类变异）。` +
      `实得 ${这标题(挂壳后)}`,
  ).toBe(true)
})

test("短名放得下 ⇒ 标题不弹（同一张 tab 上关闭钮的提示照常弹）", async ({ page, context }) => {
  const 甲 = await 备项目(`提示·短名·${Date.now()}`, 短名, "# 纪要\n\n第一行\n")
  await 进项目(page, context, 甲.id)
  await 打开(page, `卷宗/${短名}`)

  const 量 = await 量标题(page)
  expect(量, "短名那一张应当有标题").not.toBeNull()
  expect(量!.文字).toBe(短名)
  expect(
    量!.内容 > 量!.看得见,
    `前提：短名这一档应当**放得下**（否则③问的就不是「放得下时不弹」了）。实得 ${这标题(量)}`,
  ).toBe(false)

  // ③ 悬停标题。⚠️ 这里**必须**等过 `openDelay`（400ms）那个窗再看：这是「证明一件事在某段时间里
  // 没发生」，等的是**必要的时间**、不是拿它当同步手段（`LEARNINGS #006-31` 警告的是后者）。
  // 取 1200ms ＝ 3 倍 openDelay，足够让「本该弹的那次」已经弹出来。
  await 标题(page).hover()
  await page.waitForTimeout(1200)
  await expect(提示(page), "短名的标题不该弹提示（用户裁定：只在被截断时弹）").toHaveCount(0)

  // ④ 同一张 tab、同一套 hover，改成停到关闭钮上 ⇒ 该弹的照弹。
  //    这既是③的自证（这一页的 hover 是有效的），也说明 `inactive` 只掐了标题那一颗。
  await page.locator("[data-slot='tab-close']").first().hover()
  await expect(提示(page), "关闭钮的提示不该被标题那颗连坐").toHaveText(`关闭 ${短名}`, { timeout: 10_000 })
})
