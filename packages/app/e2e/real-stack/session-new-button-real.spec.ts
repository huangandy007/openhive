import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-29 · 左栏「会话」tab 那颗「新建会话」钮**在真浏览器里真是首页同款**：
 * 透明底 ＋ 灰字 ＋ 对比度够读，且行高没被撑高。
 *
 * ## 用户实报（原话，2026-10-29）
 *
 * 「请将项目管理中左栏会话Tab页面中的"＋新建会话"按钮改成 `images/screen/2026-10-29_081430.png`
 * 图片中按钮的样式，确保整个系统在视觉上的一致性。」
 *
 * 改法：那颗钮从**深色实心**（`ButtonV2 variant="contrast"`，2026-10-10 那版）换成**首页那颗**
 * （`pages/home/home-sessions-view.tsx` 的 `data-action="home-new-session"`）的同一档——
 * `variant="ghost-muted"` ＋ `icon="edit"` ＋ `h-7 px-2`。「一致」＝照搬，不新搓色值。
 *
 * ## 为什么这一条必须落**真栈**（组件层那条管不了一半）
 *
 * happy-dom **没有 CSS 引擎**（`LEARNINGS #005-07`）⇒ `session-list.test.tsx` 那条只能钉
 * 「**用了哪一档**」（`data-component='button-v2'` ＋ `data-variant='ghost-muted'` ＋ `icon='edit'`）；
 * 而用户真正在意的事——**底真的是透明的、字真的是灰的、灰字在浅底上够不够读**——
 * 在那个层里**一个字都量不出来**（`#006-12`：mock 给 200、真后端给 500 那种契约漂移）。
 * 两层各钉一半，谁都替代不了谁（`#004-02`：一份东西两个投影）。
 *
 * ## 本节还兼一份对照：**改前**那颗钮的读数
 *
 * 探针**先量、先打印、再断言**。所以把 `session-list.tsx` 那颗钮临时还原成 2026-10-10 的
 * `contrast` 版再跑一遍同一份 spec，就能拿到「改前」的读数（深底/近白字），而那条断言**应当红**
 * ——于是同一次运行既是**真栈变异验证**，也是「换对了没有」的两臂对照（`#005-28` 的两臂口径）。
 *
 * ## ⚠️ 判据的射程（别把它读成「好看已经验过了」）
 *
 * 这里量的是**几何 ＋ 计算色 ＋ 对比度**，**不是**审美。看得顺不顺眼、跟旁边那几颗钮搭不搭，
 * 本仓没有任何一层量得出来——只能人看。
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
  return { status: res.status, body: res.ok ? await res.json() : await res.text() }
}

/** 建一个私有项目，返回 `{ id, directory }`。目录**问服务端要、不自己拼**（`#003-05`）。 */
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

/** 进项目并切到左栏「会话」tab。 */
async function 进项目并切会话(page: Page, context: BrowserContext, id: string) {
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
  await page.locator("[data-slot='sidebar-tab'][data-tab='session']").click()
}

/**
 * 探针：把「这颗钮看起来怎么样」量成一组数。
 *
 * ⚠️ 三个坑都绕开了：
 * - `getBoundingClientRect()` 先断**非零**（`#005-32`：`display: contents` 的壳恒为零矩形，
 *   读数「整齐得可疑」时先怀疑测量）；
 * - 底色取 **computed**，并且**往上找出第一层不透明的底**：`ghost-muted` 这一档的底是
 *   `background-color: transparent`，真正垫在下面的是标题行／页面那一层（`#005-18` 第四问：
 *   判据的射程里得真有被量的那个盒子）；
 * - 对比度按 WCAG 相对亮度算，**不四舍五入**（后面用阈值判，浮点尾巴不影响）。
 */
async function 量这颗钮(page: Page) {
  return await page.locator("[data-slot='session-new']").evaluate((el) => {
    const e = el as HTMLElement
    const r = e.getBoundingClientRect()
    const cs = getComputedStyle(e)
    const 解析 = (s: string) => {
      const m = s.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const v = m[1].split(",").map((x) => Number.parseFloat(x.trim()))
      return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }
    }
    const 亮度 = (c: { r: number; g: number; b: number }) => {
      const f = (x: number) => {
        const s = x / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const 对比 = (甲: ReturnType<typeof 解析>, 乙: ReturnType<typeof 解析>) =>
      甲 && 乙
        ? (() => {
            const a = 亮度(甲)
            const b = 亮度(乙)
            const [浅, 深] = a > b ? [a, b] : [b, a]
            return Math.round(((浅 + 0.05) / (深 + 0.05)) * 100) / 100
          })()
        : null
    // 「这个钮背后的底」＝自己或祖先里第一层**不透明**的 background-color。
    const 有效底 = (() => {
      let 节点: HTMLElement | null = e
      while (节点) {
        const c = 解析(getComputedStyle(节点).backgroundColor)
        if (c && c.a >= 0.99) return c
        节点 = 节点.parentElement
      }
      const c = 解析(getComputedStyle(document.body).backgroundColor)
      return c && c.a >= 0.99 ? c : null
    })()
    const 字色 = 解析(cs.color)
    const 图标 = e.querySelector<SVGElement>("[data-slot='icon-svg']")
    const 图标色 = 图标 ? 解析(getComputedStyle(图标).color) : null
    const 条 = e.closest("[data-slot='session-list-bar']") as HTMLElement | null
    return {
      data_component: e.getAttribute("data-component"),
      data_variant: e.getAttribute("data-variant"),
      data_icon: e.getAttribute("data-icon"),
      data_slot: e.getAttribute("data-slot"),
      文案: e.textContent?.trim() ?? "",
      有图标: 图标 !== null,
      盒: { 宽: Math.round(r.width * 100) / 100, 高: Math.round(r.height * 100) / 100 },
      底色backgroundColor: cs.backgroundColor,
      底色backgroundImage: cs.backgroundImage.slice(0, 120),
      有效底: 有效底 ? `rgb(${有效底.r}, ${有效底.g}, ${有效底.b})` : null,
      字色: cs.color,
      字色对比度: 对比(字色, 有效底),
      图标色: 图标色 ? `rgb(${图标色.r}, ${图标色.g}, ${图标色.b})` : null,
      图标对比度: 对比(图标色, 有效底),
      工具栏高: 条 ? Math.round(条.getBoundingClientRect().height * 100) / 100 : null,
      主题: document.documentElement.getAttribute("data-theme") ?? document.documentElement.className,
      可见: cs.visibility !== "hidden" && cs.display !== "none" && Number.parseFloat(cs.opacity) > 0,
    }
  })
}

test("左栏「会话」tab 的「新建会话」钮：透明底 ＋ 灰字 ＋ 对比度够读，且行高没被撑高", async ({
  page,
  context,
}) => {
  const 甲 = await 建真项目(`新建钮外观·${Date.now()}`)
  await 进项目并切会话(page, context, 甲.id)

  const 钮 = page.locator("[data-slot='session-new']")
  await expect(钮, "会话 tab 里应当有一颗「新建会话」钮").toBeVisible({ timeout: 30_000 })

  const 读数 = await 量这颗钮(page)
  // 先打印**再**断言：这样把产品临时还原成 2026-10-10 的深色版重跑一次，这一行就是「改前」的
  // 基线读数（断言那时会红，但基线已经拿到了）。
  console.log("【新建会话钮读数】" + JSON.stringify(读数, null, 2))

  // ── 前提：盒子非零（`#005-32`：零矩形底下所有几何判据都是空的） ──────────────
  expect(读数.盒.宽 > 0 && 读数.盒.高 > 0, "量到的盒子必须非零，否则下面的几何判据全是空转").toBe(true)
  expect(读数.可见, "前提：这颗钮得真的可见").toBe(true)

  // ── 什么钮、哪一档（与组件层那条同源，真栈这里再钉一次「真浏览器里也是它」） ──
  expect(读数.data_component).toBe("button-v2")
  expect(读数.data_variant).toBe("ghost-muted")
  expect(读数.data_icon).toBe("edit")

  // ── 用户要的那件事：**带字**（可发现性由这四个字承担，不靠一块深色） ────────────
  expect(读数.文案).toBe("新建会话")
  expect(读数.有图标, "edit 图标要在").toBe(true)

  // ── 用户要的那件事：**浅底灰字**（不再是 2026-10-10 那版的深色实心） ────────────
  // ① 自己身上不许有底：`ghost-muted` 的底就是透的，hover 才现形。
  expect(读数.底色backgroundColor, "钮自己不挂底色（hover 才现形）").toBe("rgba(0, 0, 0, 0)")
  // ② 有效底必须解析得出（找得到垫在下面的那一层，否则下面的对比度是空转）。
  expect(读数.有效底 !== null, "必须找得到钮背后的实底，否则对比度判据是空转").toBe(true)
  // ③ 字的颜色就是 token 里那个 muted 灰（`--v2-text-text-muted` = grey-700 = #5C5C5C）。
  //    固定值而不是「随便一个非黑」：浅底上够读这件事靠的正是这一档，换档就要重新量。
  expect(读数.字色, "字色应当是 muted 那一档（grey-700）").toBe("rgb(92, 92, 92)")
  // ④ 「字看得清」是可判形的：WCAG AA 正文线 4.5:1。这不是审美。
  expect(读数.字色对比度!, `灰字/浅底对比度应当够读（实测 ${读数.字色对比度}）`).toBeGreaterThanOrEqual(
    4.5,
  )
  // ⑤ 图标是**非文字**，按 WCAG 1.4.11 的 3:1。它天生比字浅一档（`--v2-icon-icon-muted` = grey-600），
  //    所以门槛单独写 3，不拿 4.5 去卡它（否则这条会在「本来就是浅一档」上恒红，逼人改设计）。
  expect(读数.图标对比度!, `图标/浅底对比度应当达到 3:1（实测 ${读数.图标对比度}）`).toBeGreaterThanOrEqual(3)

  // ── 行高不变：`h-7` 是 28px，正好等于标题行高，列表不该被推下去 ──
  expect(读数.工具栏高, "标题行仍是 28px（换钮不许把会话列表推下去）").toBe(28)
  expect(读数.盒.高, "钮高 ≤ 标题行高，才谈得上塞得进去").toBeLessThanOrEqual(28)
})
