import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 2026-10-28 · **能力面板的说明预览**（用户两条要求：① 卡片里不再显示说明，悬停时在卡片右侧弹出
 * 顶层预览框、不能被遮挡；② 卡片悬停给灰底）。
 *
 * ## 为什么单测 ＋ 组件测都绿了，这一份仍然要写
 *
 * 那两层钉的是**结构**（卡片里没有 `<p>`、弹的是**这一张**的说明、盒子挂在 body 下、`position: fixed`）。
 * 而用户这句话里的四个词——「右侧」「顶层」「不能被遮挡」「灰底」——**一个都量不出来**：
 * happy-dom 没有布局引擎（`#005-07`），`hover:` 是 CSS 伪类，`sr-only` 是 CSS 裁剪。
 * 所以本 spec 在真浏览器里量真几何、真层叠、真计算样式。
 *
 * ## 为什么必须 Portal ＋ fixed（根因已在前一处实测坐定）
 *
 * 左栏三层壳（`aside[three-pane-left]` / `three-pane-left-card` / 面板）都是 `overflow: hidden`
 * ⇒ 留在裁剪树里的浮层**必被裁**，`z-index` 救不了。同一根因的实测与判据在
 * `session-nav-real.spec.ts` 的 ③b（右栏版）。
 *
 * ## ⚠️ 前置断言不是装饰
 *
 * 「越界那一点命中的是预览自己」只有在**预览真的越出了左栏**时才有意义；没有那条前置，
 * 一个把预览缩在栏内的实现也能让它恒绿（`#005-47` 那一族：缺陷态下你搭的前提可能自己不成立）。
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

/** 建真项目并拿到它落在沙箱里的真目录（同 `file-tree-empty-dir-real.spec.ts`）。 */
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
}

/** 这行说明必须**够长**（要看出预览是个真盒子），但含义仍然是一句人话。 */
const 说明 = "按对手方聚合最近三个月的流水，标出每笔的摘要与余额，并给出月度合计。"

test("能力面板：说明只在悬停时从卡片右侧弹出，愈出左栏那一段不被裁，卡片悬停有灰底（真栈）", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000)

  const 甲 = await 建真项目(`能力预览·${Date.now()}`)
  // 种一个**自带技能**（内核 `Skill.Service` 扫 `.opencode/{skill,skills}/**\/SKILL.md`）：
  // 走的是生产发现链，不是往库里塞种子（`#006-35` / `#006-28`）。
  const 技能目录 = path.join(甲.directory, ".opencode", "skill", "资金速查")
  mkdirSync(技能目录, { recursive: true })
  writeFileSync(path.join(技能目录, "SKILL.md"), `---\nname: 资金速查\ndescription: ${说明}\n---\n\n# 资金速查\n`)

  await 进项目(page, context, 甲.id)
  await page.goto("/")
  await page.locator("[data-slot='sidebar-tab'][data-tab='capability']").click()

  const 卡 = page.locator("[data-slot='capability-item-local']").first()
  await expect(卡, "项目里那个自带技能该作为一条卡片出现").toBeVisible({ timeout: 30_000 })

  // ── ① 卡片里没有说明那一段（说明改由预览承载） ──────────────────────────────
  expect(await 卡.locator("p").count(), `卡片里不该再有说明段落｜卡内文字=${await 卡.innerText()}`).toBe(0)
  expect(await 卡.textContent(), "说明仍应以读屏可见的形式留在卡里").toContain(说明)

  // ── 前置：悬停**之前**没有预览；卡片底色是「没有灰底」的那一档 ────────────────
  const 预览 = page.locator("[data-slot='capability-hover-preview']")
  await expect(预览).toHaveCount(0)
  const 底色 = () =>
    卡.evaluate((元素) => getComputedStyle(元素).backgroundColor)
  const 悬停前底色 = await 底色()

  // ── ② 悬停 ⇒ 卡片灰底 ＋ 右侧弹出预览，内容是这一张的说明 ────────────────────
  await 卡.hover()
  await expect(预览).toBeVisible({ timeout: 10_000 })
  await expect(预览).toHaveText(说明)

  const 悬停后底色 = await 底色()
  console.log(`[能力预览] 底色 悬停前=${悬停前底色} 悬停后=${悬停后底色}`)
  // ① 悬停态与静止态**不同**是「有 hover 效果」的判据；② 悬停后必须**真有颜色**（不是透明）——
  // 只断「不同」的话，一个把静止态改坏（比如底色写成透明）的实现也能过。
  expect(悬停后底色, `悬停时卡片该有灰底（与静止态不同）｜前=${悬停前底色} 后=${悬停后底色}`).not.toBe(
    悬停前底色,
  )
  expect(悬停后底色, "悬停后的底色不该是透明的").not.toMatch(/^rgba\(.*,\s*0\)$|^transparent$/)

  // ── ③ 真几何：预览在卡片**右侧 8px**、纵向对着卡片中线 ──────────────────────
  const 量 = await page.evaluate(() => {
    const 预览盒 = document.querySelector<HTMLElement>("[data-slot='capability-hover-preview']")
    const 卡盒 = document.querySelector<HTMLElement>("[data-slot='capability-item-local']")
    const 栏 = document.querySelector<HTMLElement>("[data-slot='three-pane-left-card']")
    if (!预览盒 || !卡盒 || !栏) throw new Error("没找到预览盒 / 卡片 / 左栏卡（选择器换地方了？）")
    const 预 = 预览盒.getBoundingClientRect()
    const 卡 = 卡盒.getBoundingClientRect()
    const 栏盒 = 栏.getBoundingClientRect()
    const 中 = 预.top + 预.height / 2
    // 取预览**最右端**往前 6px 的一点：这一片离卡片最远，越出左栏最多。
    const 探x = 预.right - 6
    // ⚠️ 预览是 `pointer-events: none`（它自己不该接事件，否则会吃掉卡片的 mouseleave）——
    // 而 `elementsFromPoint` 走的是**命中测试**，会把这层整个跳过（首跑实测：栈里根本没有预览，
    // 栈顶是中栏里那个 `aside`）。所以探针**临时**把指针命中打开再量，量完立刻还原：
    // 这里问的是「谁画在上面」（层叠与裁剪），不是「谁接事件」。
    const 原 = 预览盒.style.pointerEvents
    预览盒.style.pointerEvents = "auto"
    const 栈 = document.elementsFromPoint(探x, 中).map((el) => {
      const slot = el.getAttribute("data-slot")
      return `${el.tagName.toLowerCase()}${slot ? `[data-slot="${slot}"]` : ""}`
    })
    预览盒.style.pointerEvents = 原
    return {
      预左: 预.left,
      预右: 预.right,
      预中: 中,
      预宽: 预.width,
      卡右: 卡.right,
      卡中: 卡.top + 卡.height / 2,
      栏右: 栏盒.right,
      探x,
      探x在栏外: 探x > 栏盒.right,
      栈顶: 栈[0] ?? "",
      栈,
    }
  })
  console.log(`[能力预览] 实得几何=${JSON.stringify(量)}`)
  expect(量.预左, `预览该从卡片右缘再往右 8px 起｜卡右=${量.卡右} 预左=${量.预左}`).toBeCloseTo(量.卡右 + 8, 0)
  expect(量.预中, `预览该纵向对着卡片中线｜卡中=${量.卡中} 预中=${量.预中}`).toBeCloseTo(量.卡中, 0)
  expect(量.预宽, "预览该是个有宽度的真盒子（不是一条缝）").toBeGreaterThan(100)

  // ── ④ 顶层：越出左栏的那一段命中栈顶必须是预览自己（不是中栏） ──────────────────
  expect(
    量.探x在栏外,
    `前置：这一屏预览该真的越出左栏（不越界的话下面那条就是空转）｜${JSON.stringify(量)}`,
  ).toBe(true)
  expect(量.栈顶, `预览越出左栏的那一段该画得出来（栈顶应是它自己）｜${JSON.stringify(量.栈)}`).toBe(
    'div[data-slot="capability-hover-preview"]',
  )

  // ── ⑤ 移开 ⇒ 预览收掉（它跟着指针，不常驻） ─────────────────────────────────
  await page.locator("[data-slot='capability-group-skill']").hover()
  await expect(预览).toHaveCount(0)
})
