import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-11 · 图标栏那颗「项目管理」是**左栏的乒乓开关**，而在真浏览器里它量得出来。
 *
 * ## 用户实报（原话）
 *
 * 「点击『AI 会话』图标（高亮），右栏的 AI 会话界面会出现，再次点击（高亮消失），右栏隐藏，
 * 中栏的宽度自动适应屏幕大小……我现在需要你实现图标栏的『项目管理』图标也实现这种乒乓开关，
 * 控制显示或隐藏的是左栏，隐藏时中栏自动适应屏幕大小，一定要真实现」。
 *
 * ## 为什么这一条必须落**真栈**（组件层那组管不了一半）
 *
 * `workspace-entry.test.tsx` 那组只能钉 DOM 形状（左栏整根在不在、那颗图标读什么轴）
 * ——happy-dom **没有 CSS 引擎**（`LEARNINGS #005-07`）⇒「**中栏的宽度自动适应屏幕大小**」
 * 这半句在那个层里**一个字都量不出来**。用户真正要的恰恰是它，所以这里量的是**几何**：
 * 展开时「左栏盒宽 ≈ 侧栏宽 ＋ 中栏宽 W1」，点一下 ⇒ 左栏盒**不存在**、中栏宽 **W2 > W1**，
 * 再点 ⇒ 两个数**回到原值**。两层各钉一半，谁都替代不了谁（`#004-02`：一份东西两个投影）。
 *
 * ## 探针**先量、先打印、再断言**
 *
 * 与 `session-new-button-real.spec.ts` 同一个道理：把产品临时还原成改动之前的样子再跑同一份
 * spec，就能拿到「改前」的读数（那时三条断言里至少两条会红：左栏压根收不起来），而这次运行的
 * 那几行 `console.log` 就是改前的基线。
 *
 * ## ⚠️ 判据的射程
 *
 * 这里量的是**几何 ＋ ARIA**，不是「好不好看」。另外**没量**的一件事：左栏收起再展开之后，
 * 里面那些状态（文件树展开的目录 / 搜索词 / 选中行）**会被重置**——用户 2026-10-11 明确接受
 * （与「AI 会话」那颗逐字同因：收起走的是**卸载**，不是隐藏）。别把本节读成「状态也保住了」。
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

/** 进三栏工作台。**按生产常态种**（`#006-11`）：有身份、有当前项目、走新布局。 */
async function 进工作台(page: Page, context: BrowserContext, projectId: string) {
  await context.addCookies([
    { name: "openhive_session", value: readStack().token, url: FRONT() },
    { name: "openhive_project", value: projectId, url: FRONT() },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })
  await page.goto("/")
}

/**
 * 探针：把三栏此刻的几何 ＋ 那颗图标读出来的轴，一起量成一组数。
 *
 * ⚠️ `display: contents` / 未挂载的壳**恒为零矩形**（`#005-32`），读数「整齐得可疑」时先怀疑
 * 测量——所以这里把「盒子在不在（`null`）」和「宽度多少」分开报，不拿 0 冒充「不在」。
 */
async function 量三栏(page: Page) {
  return await page.evaluate(() => {
    const 取 = (slot: string) => document.querySelector<HTMLElement>(`[data-slot='${slot}']`)
    const 盒 = (slot: string) => {
      const el = 取(slot)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        宽: Math.round(r.width * 100) / 100,
        高: Math.round(r.height * 100) / 100,
        左: Math.round(r.left * 100) / 100,
      }
    }
    const 图标 = document.querySelector<HTMLElement>("[data-slot='rail-entry'][aria-label='项目管理']")
    return {
      左栏: 盒("three-pane-left"),
      左栏包裹: 盒("three-pane-left-group"),
      中栏: 盒("three-pane-center"),
      图标: 图标
        ? {
            ariaPressed: 图标.getAttribute("aria-pressed"),
            ariaCurrent: 图标.getAttribute("aria-current"),
            有竖条: 图标.querySelector("[data-slot='rail-entry-bar']") !== null,
          }
        : null,
      视口宽: window.innerWidth,
      主题: document.documentElement.getAttribute("data-theme") ?? document.documentElement.className,
    }
  })
}

test("点「项目管理」⇒ 左栏整根让位、中栏真的变宽；再点 ⇒ 两个数都回到原值", async ({ page, context }) => {
  const 项目 = await 建真项目(`左栏开关·${Date.now()}`)
  await 进工作台(page, context, 项目.id)

  const 图标 = page.locator("[data-slot='rail-entry'][aria-label='项目管理']")
  await expect(图标, "图标栏里应当有那颗「项目管理」").toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-slot='three-pane-left']"), "进门左栏就在").toBeVisible({
    timeout: 30_000,
  })

  const 展开 = await 量三栏(page)
  // 先打印**再**断言：临时还原成改动之前的实现重跑一次，这一行就是「改前」的基线读数。
  console.log("【展开】" + JSON.stringify(展开, null, 2))

  // ── 前提：盒子非零（零矩形底下所有几何判据都是空转） ────────────────────────
  expect(展开.左栏 !== null && 展开.中栏 !== null, "三栏都该在").toBe(true)
  expect(展开.左栏!.宽 > 0 && 展开.中栏!.宽 > 0, "量到的盒子必须非零").toBe(true)
  // 前提：这是一次**真的**三栏排布（左栏 ＋ 中栏 ≤ 视口），不是「左栏挤掉了中栏」
  expect(展开.左栏!.宽 + 展开.中栏!.宽, "左栏 ＋ 中栏 不该超过视口").toBeLessThanOrEqual(展开.视口宽)
  // 那颗图标的读法：**开关**（`aria-pressed`），不是模块（`aria-current`）
  expect(展开.图标!.ariaPressed, "展开时它是按下的（高亮）").toBe("true")
  expect(展开.图标!.ariaCurrent, "开关不写 aria-current（那条轴留给真正的模块页）").toBeNull()
  expect(展开.图标!.有竖条, "展开时它有选中态（浅金底 ＋ 左侧竖条）").toBe(true)

  // ── 点一下：整根不在（连 ResizeHandle 一起），中栏把让出来的宽度吃掉 ─────────
  await 图标.click()
  await expect(page.locator("[data-slot='three-pane-left']")).toHaveCount(0)
  const 收起 = await 量三栏(page)
  console.log("【收起】" + JSON.stringify(收起, null, 2))

  expect(收起.左栏, "左栏整根不在（不是宽度变 0）").toBeNull()
  expect(收起.左栏包裹, "连 `ResizeHandle` 那层包裹一起让位").toBeNull()
  expect(收起.图标!.ariaPressed, "收起时高亮消失").toBe("false")
  expect(收起.图标!.有竖条, "高亮消失到连竖条都不见").toBe(false)
  // 报告里的「中栏宽 W2 > W1」，就是用户那句「中栏的宽度自动适应屏幕大小」
  expect(
    收起.中栏!.宽,
    `中栏应当吃掉左栏让出的宽度（收起后 ${收起.中栏!.宽} > 展开时 ${展开.中栏!.宽}）`,
  ).toBeGreaterThan(展开.中栏!.宽)

  // ── 再点一下：原样回来（两个数都回到原值，不是「差不多的另一个宽度」） ────────
  await 图标.click()
  await expect(page.locator("[data-slot='three-pane-left']")).toBeVisible()
  const 回来 = await 量三栏(page)
  console.log("【回来】" + JSON.stringify(回来, null, 2))

  expect(回来.左栏!.宽, "左栏宽度回到原值").toBe(展开.左栏!.宽)
  expect(回来.中栏!.宽, "中栏宽度回到原值").toBe(展开.中栏!.宽)
  expect(回来.图标!.ariaPressed).toBe("true")
})

test("在别的模块上点它：模块切回「项目管理」且左栏**一次到位**地出现（不是先关一次）", async ({
  page,
  context,
}) => {
  const 项目 = await 建真项目(`左栏开关·跨模块·${Date.now()}`)
  await 进工作台(page, context, 项目.id)

  const 图标 = page.locator("[data-slot='rail-entry'][aria-label='项目管理']")
  await expect(图标).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-slot='three-pane-left']")).toBeVisible({ timeout: 30_000 })
  const 展开 = await 量三栏(page)

  // 先离开项目管理：左栏让位（模块门），中栏变宽
  await page.locator("[data-slot='rail-entry'][aria-label='资金分析']").click()
  await expect(page.locator("[data-slot='three-pane-left']")).toHaveCount(0)
  const 别的模块 = await 量三栏(page)

  // 在别的模块上点「项目管理」：**一次到位**——既切回模块，左栏也就出现（不是「先关一次」）
  await 图标.click()
  await expect(page.locator("[data-slot='three-pane-left']")).toBeVisible()
  const 切回来 = await 量三栏(page)
  console.log("【跨模块】" + JSON.stringify({ 别的模块, 切回来 }, null, 2))

  expect(切回来.左栏 !== null, "左栏回来了").toBe(true)
  expect(切回来.左栏!.宽, "左栏宽度回到默认（与本条开头那次展开逐字相同）").toBe(展开.左栏!.宽)
  expect(切回来.中栏!.宽, "中栏把宽度让回给左栏").toBeLessThan(别的模块.中栏!.宽)
  expect(切回来.图标!.ariaPressed, "那颗图标又是按下的").toBe("true")
  expect(切回来.图标!.ariaCurrent, "它始终不写 aria-current").toBeNull()

  // 再点一下是**收起**——「切回来」那一支只该在别的模块上生效，不能在 project 上再来一次
  await 图标.click()
  await expect(page.locator("[data-slot='three-pane-left']")).toHaveCount(0)
  expect((await 量三栏(page)).图标!.ariaPressed).toBe("false")
})
