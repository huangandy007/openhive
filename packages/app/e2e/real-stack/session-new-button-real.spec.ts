import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-10 · 左栏「会话」tab 那颗「新建会话」钮**在真浏览器里真是深色实心、字真看得清**。
 *
 * ## 用户实报（原话）
 *
 * 「目前项目管理左栏"会话"Tab页面的"新建会话"图标按钮不明显，我担心初始用户难以找到，为了突出，
 * 我希望把这里的图标设计成 `images/screen/2026-10-10_192112.png` 这种样式，请你修改。」
 *
 * 改法：那颗钮从**裸的全角「＋」**（无底色、只有 hover 才现形）换成仓里现成的设计系统钮
 * `ButtonV2 variant="contrast"`（`packages/ui/src/v2/components/button-v2.tsx`）——深色实心 ＋ 近白字。
 *
 * ## 为什么这一条必须落**真栈**（组件层那条管不了一半）
 *
 * happy-dom **没有 CSS 引擎**（`LEARNINGS #005-07`）⇒ `session-list.test.tsx` 那条只能钉
 * 「**用了哪一档**」（`data-component='button-v2'` ＋ `data-variant='contrast'` ＋ 带字）；
 * 而用户真正在意的三件事——**底真的是深的、字真的是浅的、这两者的对比度够看**——
 * 在那个层里**一个字都量不出来**（`#006-12`：mock 给 200、真后端给 500 那种契约漂移）。
 * 两层各钉一半，谁都替代不了谁（`#004-02`：一份东西两个投影）。
 *
 * ## 本节还兼一份对照：**改前**那颗钮的读数
 *
 * 探针**先量、先打印、再断言**。所以把 `session-list.tsx` 那颗钮临时还原成旧实现再跑一遍同一份 spec，
 * 就能拿到「改前」的两次读数（旧钮的底/字/对比度/盒子），而那条断言**应当红** ——
 * 于是同一次运行既是**真栈变异验证**，也是「到底显眼了没有」的两臂对照（`#005-28` 的两臂口径）。
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
 * - 底色取 **computed**（`button-v2.css` 里 `contrast` 那一档挂的是 `background-image` 三层渐变，
 *   `backgroundColor` 会是 `rgba(0,0,0,0)` ⇒ 必须看 `backgroundImage`；
 *   所以这里**同时**读两个，并把 `contrast` 那条链上的**头一层**当底色实得值）；
 * - 对比度按 WCAG 相对亮度算，**不四舍五入**（后面用阈值判，浮点尾巴不影响）。
 */
async function 量这颗钮(page: Page) {
  return await page.locator("[data-slot='session-new']").evaluate((el) => {
    const e = el as HTMLElement
    const r = e.getBoundingClientRect()
    const cs = getComputedStyle(e)
    const 底色 = cs.backgroundColor
    const 字色 = cs.color
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
    const 前 = 解析(字色)
    // **实底**从哪儿取：`contrast` 那一档把底挂在 `background-image` 上（三层渐变），
    // 而 `backgroundColor` 是透明 ⇒ 光看 `backgroundColor` 会把「深色实心」读成「什么都没有」。
    // 取法：`background-image` 里**第一段不带 alpha 的** `rgb(...)` —— 那是这一叠渐变最上面那层
    // **不透明**的底（上面可能还压着 `rgba(255,255,255,0.2)` 这种提亮层，它不算底）。
    const 实底 =
      (底色 !== "rgba(0, 0, 0, 0)" && 底色 !== "transparent" ? 解析(底色) : null) ??
      解析(cs.backgroundImage.match(/\brgb\([^)]+\)/)?.[0] ?? "") ??
      null
    const 对比度 =
      前 && 实底
        ? (() => {
            const a = 亮度(前)
            const b = 亮度(实底)
            const [浅, 深] = a > b ? [a, b] : [b, a]
            return (浅 + 0.05) / (深 + 0.05)
          })()
        : null
    const 条 = e.closest("[data-slot='session-list-bar']") as HTMLElement | null
    return {
      data_component: e.getAttribute("data-component"),
      data_variant: e.getAttribute("data-variant"),
      data_slot: e.getAttribute("data-slot"),
      文案: e.textContent?.trim() ?? "",
      有图标: e.querySelector("[data-slot='icon-svg']") !== null,
      盒: { 宽: Math.round(r.width * 100) / 100, 高: Math.round(r.height * 100) / 100 },
      底色backgroundColor: 底色,
      底色backgroundImage: cs.backgroundImage.slice(0, 200),
      实底: 实底 ? `rgb(${实底.r}, ${实底.g}, ${实底.b})` : null,
      实底亮度: 实底 ? Math.round(亮度(实底) * 10000) / 10000 : null,
      字色,
      对比度: 对比度 === null ? null : Math.round(对比度 * 100) / 100,
      工具栏高: 条 ? Math.round(条.getBoundingClientRect().height * 100) / 100 : null,
      主题: document.documentElement.getAttribute("data-theme") ?? document.documentElement.className,
      可见: cs.visibility !== "hidden" && cs.display !== "none" && Number.parseFloat(cs.opacity) > 0,
    }
  })
}

test("左栏「会话」tab 的「新建会话」钮：深色实心 ＋ 近白字 ＋ 对比度够看，且行高没被撑高", async ({
  page,
  context,
}) => {
  const 甲 = await 建真项目(`新建钮外观·${Date.now()}`)
  await 进项目并切会话(page, context, 甲.id)

  const 钮 = page.locator("[data-slot='session-new']")
  await expect(钮, "会话 tab 里应当有一颗「新建会话」钮").toBeVisible({ timeout: 30_000 })

  const 读数 = await 量这颗钮(page)
  // 先打印**再**断言：这样把产品临时还原成旧实现重跑一次，这一行就是「改前」的基线读数
  //（断言那时会红，但基线已经拿到了）。
  console.log("【新建会话钮读数】" + JSON.stringify(读数, null, 2))

  // ── 前提：盒子非零（`#005-32`：零矩形底下所有几何判据都是空的） ──────────────
  expect(读数.盒.宽 > 0 && 读数.盒.高 > 0, "量到的盒子必须非零，否则下面的几何判据全是空转").toBe(true)
  expect(读数.可见, "前提：这颗钮得真的可见").toBe(true)

  // ── 什么钮、哪一档（与组件层那条同源，真栈这里再钉一次「真浏览器里也是它」） ──
  expect(读数.data_component).toBe("button-v2")
  expect(读数.data_variant).toBe("contrast")

  // ── 用户要的那件事：**带字**（「不明显」的正面解药） ────────────────────────
  expect(读数.文案).toBe("新建会话")
  expect(读数.有图标, "plus 图标要在（全角「＋」字符换掉了）").toBe(true)

  // ── 用户要的那件事：**深色实心** ────────────────────────────────────────────
  // 底必须解析得出（透明 ⇒ 解析不出 ⇒ 直接判它不合格：旧钮就是透明的）。
  expect(读数.实底 !== null, "底色必须解析得出实色（透明 = 旧钮那种「什么底都没有」）").toBe(true)
  // 「深」是可判形的：相对亮度要低（近黑 ≈ 0.02；纯白是 1）。
  expect(读数.实底亮度!, `实底亮度应当很低才叫「深色实心」（实测 ${读数.实底}，亮度 ${读数.实底亮度}）`)
    .toBeLessThan(0.2)
  // 「字看得清」也是可判形的：WCAG AA 正文线 4.5:1。这不是审美。
  expect(读数.对比度!, `字/底对比度应当够读（实测 ${读数.对比度}）`).toBeGreaterThanOrEqual(4.5)

  // ── 行高不变：`size="small"` 是 24px，塞进 `h-7`(28px) 的标题行，列表不该被推下去 ──
  expect(读数.工具栏高, "标题行仍是 28px（换钮不许把会话列表推下去）").toBe(28)
  expect(读数.盒.高, "钮高 ≤ 标题行高，才谈得上塞得进去").toBeLessThanOrEqual(28)
})
