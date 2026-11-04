import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 右栏收窄到最小时，**模型选择不许盖住发送按钮**（2026-11-04 用户报障）。
 *
 * ## 现象
 *
 * 用户原话：「我感觉『模型选择』在『发送』按钮上面，因为当右栏很窄的时候，点不到发送按钮，
 * 每次打开的都是模型选择。」真栈实测（2026-11-04，1600×900）属实：
 * 右栏 ≤300px 时发送钮中心的 `elementsFromPoint` 栈顶是 `button[data-action="prompt-model"]`。
 *
 * ## 根因（两段缺一不可，探针实测定的）
 *
 * ① **不收缩**：底栏左侧控件组 `div.flex.min-w-0.flex-1` 自己会缩（240 时算得 162px），
 *    但模型控件被 `TooltipV2` 包了一层 `div[data-component="tooltip-v2-trigger"]`
 *    （`ui/src/v2/components/tooltip-v2.tsx:101` 的 `as="div"`）。`model-control.tsx` 调
 *    `TooltipV2` 时没传 `class` ⇒ 那层是 `min-width: auto`，自动最小尺寸 = 按钮里
 *    整串模型名（`.truncate` 是 `white-space: nowrap`）⇒ 实测恒 **220px**，溢出控件组右缘 91px。
 * ② **画在上面**：`ButtonV2` 自带 `position: relative`（`ui/src/v2/components/button-v2.css:8`），
 *    发送钮是 `static` ⇒ 定位元素整层后画，溢出的那一段盖住后出现的静态兄弟。
 *
 * ## 为什么只有真栈能钉住
 *
 * 这是**纯粹的布局 + 层叠**：happy-dom 不跑 CSS（`#006-22`），宽 162/220、谁画在谁上面，
 * 组件层一条都量不出来。所以判据落在这里，组件层不补假绿。
 *
 * ## 判据怎么取
 *
 * - **不重叠**：模型钮右缘 ≤ 发送钮左缘（窄栏下模型钮该缩、该出省略号）；
 * - **可点**：发送钮中心 `elementsFromPoint` 落回 `prompt-submit`，且 `click({ trial: true })`
 *   不报「被别的元素接管」——trial 是 Playwright 自己的命中检查，**不发消息**（不触模型）；
 * - **没缩没**：模型钮自身仍可见、仍有宽度，且它中心的命中仍归它（防止「靠隐藏控件换绿」）。
 */

const readStack = () =>
  JSON.parse(readFileSync(path.join(tmpdir(), "openhive-real-stack.json"), "utf8")) as {
    kernel: number
    front: number
    token: string
    sandbox: string
    alice: string
  }

const FRONT = () => `http://127.0.0.1:${readStack().front}`
const KERNEL = () => `http://127.0.0.1:${readStack().kernel}`
const COOKIE = () => `openhive_session=${readStack().token}`
const directory = () => path.join(readStack().sandbox, "workspaces", readStack().alice)

/** 右栏拖拽下限（`workspace/three-pane.tsx:14` 的 `RIGHT_PANE_MIN`，那边没导出）。 */
const 右栏下限 = 240

async function 建真会话(title: string): Promise<string> {
  const res = await fetch(`${KERNEL()}/api/session?directory=${encodeURIComponent(directory())}`, {
    method: "POST",
    headers: { Cookie: COOKIE(), "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  expect(res.ok, `真内核建会话失败：${res.status}`).toBe(true)
  return ((await res.json()) as { data: { id: string } }).data.id
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "openhive_session", value: readStack().token, url: FRONT() }])
})

/** 同 `right-pane-slash-and-model-real.spec.ts` 的 `setup`（`#004-12`：抄同族 harness）。 */
async function setup(page: Page, sessionID: string) {
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory: directory(), server: FRONT(), sessionID },
  )
}

/** 右栏（含底栏）——所有选择器都收窄到这里，别撞上中栏那套同形控件。 */
const 右栏 = (page: Page) => page.locator("[data-slot='three-pane-right']")
const 模型钮 = (page: Page) => 右栏(page).locator("[data-action='prompt-model']")
const 发送钮 = (page: Page) => 右栏(page).locator("[data-action='prompt-submit']")

/** 量底栏那三个盒子的几何 ＋ 命中测试（全在页面里做，省得把 rect 搬来搬去）。 */
async function 量底栏(page: Page) {
  return page.evaluate(() => {
    const aside = document.querySelector<HTMLElement>("[data-slot='three-pane-right']")
    if (!aside) throw new Error("右栏没了")
    const 模型 = aside.querySelector<HTMLElement>("[data-action='prompt-model']")
    const 发送 = aside.querySelector<HTMLElement>("[data-action='prompt-submit']")
    const 组 = 模型?.closest(".min-w-0.flex-1") as HTMLElement | null
    if (!模型 || !发送 || !组) throw new Error("底栏三个盒子没找全（选择器换地方了？）")
    const 盒 = (el: HTMLElement) => {
      const b = el.getBoundingClientRect()
      return { 左: b.left, 右: b.right, 宽: b.width, 高: b.height }
    }
    const 命中 = (el: HTMLElement) => {
      const b = el.getBoundingClientRect()
      const 栈 = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2)
      const 归谁 = 栈
        .map((node) => node.closest("[data-action]"))
        .find((node): node is HTMLElement => node !== null)
      return 归谁?.getAttribute("data-action") ?? null
    }
    const m = 盒(模型)
    const s = 盒(发送)
    // 模型名那一格：`scrollWidth > clientWidth` ⇔ 名字真的装不下、被截成省略号
    const 名 = 模型.querySelector<HTMLElement>("span.truncate")
    return {
      栏宽: aside.getBoundingClientRect().width,
      模型: m,
      发送: s,
      组: 盒(组),
      模型溢出组: m.右 - 盒(组).右,
      重叠宽: Math.min(m.右, s.右) - Math.max(m.左, s.左),
      发送钮中心归谁: 命中(发送),
      模型钮中心归谁: 命中(模型),
      模型名: (模型.textContent ?? "").trim(),
      模型名装不下: 名 ? 名.scrollWidth - 名.clientWidth : -1,
    }
  })
}

/** 拖右栏左侧手柄，把右栏收到 `目标` 宽（`edge="start"` ⇒ 往右拖才缩）。 */
async function 拖右栏到(page: Page, 目标: number) {
  for (let i = 0; i < 5; i++) {
    const 当前 = await page.evaluate(() => {
      const aside = document.querySelector("[data-slot='three-pane-right']")
      return aside ? Math.round(aside.getBoundingClientRect().width) : -1
    })
    const 差 = 当前 - 目标
    if (Math.abs(差) <= 1) return 当前
    const 手柄 = page.locator("[data-slot='three-pane-right-group'] [data-component='resize-handle']")
    const 盒 = await 手柄.boundingBox()
    if (!盒) throw new Error("右栏手柄没找到")
    const cx = 盒.x + 盒.width / 2
    const cy = 盒.y + 盒.height / 2
    const 步 = Math.max(-200, Math.min(200, 差))
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let k = 1; k <= 8; k++) {
      await page.mouse.move(cx + (步 * k) / 8, cy)
      await page.waitForTimeout(20)
    }
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
  return page.evaluate(() => {
    const aside = document.querySelector("[data-slot='three-pane-right']")
    return aside ? Math.round(aside.getBoundingClientRect().width) : -1
  })
}

/**
 * 选**目录里名字最长的那颗模型**（不写死名字）。
 *
 * 为什么必须选：这个 bug 是「模型名有多长」撑出来的——名字短时按钮本来就装得下，
 * 什么都不会溢出，用例就成了假绿（2026-11-04 实测：本栈默认那颗 `Big Pickle` 只有
 * 119.78px，而真机用户那颗 `DeepSeek V4.1 Flash 1017` 撑满 `max-w-[220px]`）。
 * ⇒ 先挑最长的，再看它在窄栏里会不会把发送钮盖住。挑完把名字与宽度打进日志，
 * 下面的 `前置` 断言负责确认「这次真的够长」。
 */
async function 选最长名的模型(page: Page): Promise<string> {
  await 模型钮(page).click()
  const 行 = page.locator('[data-option-key]:not([data-option-key="action:manage"])')
  await expect(行.first(), "模型弹层里一行都没有").toBeVisible({ timeout: 20_000 })
  const 候选 = await 行.evaluateAll((节点) =>
    节点.map((节点) => ({
      key: 节点.getAttribute("data-option-key") ?? "",
      text: (节点.textContent ?? "").trim(),
    })),
  )
  const 最长 = [...候选].sort((a, b) => b.text.length - a.text.length)[0]
  if (!最长) throw new Error("模型弹层是空的")
  console.log(`[窄右栏] 目录 ${候选.length} 条；选最长：「${最长.text}」(${最长.key})`)
  await page.locator(`[data-option-key="${最长.key}"]`).click()
  return 最长.text
}

test("右栏收窄到最小时，模型选择不盖住发送按钮", async ({ page }) => {
  test.setTimeout(180_000)
  const 会话 = await 建真会话("窄右栏发送钮验收会话")
  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)

  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  const 输入 = 面板.locator('[data-slot="session-hero"] [data-component="prompt-input"]')
  await expect(输入).toBeVisible()
  await 输入.click()
  await 输入.fill("窄右栏探测（不发送）")

  // 前置：发送钮要真是「可发」态，否则下面 trial 点不亮、红的原因就不是拦截了。
  await expect(发送钮(page), "底栏没有发送钮").toBeVisible()
  await expect(发送钮(page), "输入框有字后发送钮该可用").toBeEnabled({ timeout: 10_000 })

  /**
   * 前置（**没有它这条用例是假绿**，2026-11-04 实测）：
   *
   * 模型钮上的字要等 `useProviders` 那一支目录到齐才从占位文案 `Select model` 换成真模型名
   * （同 `right-pane-and-model-real.spec.ts` 的 `等钮落定`）。占位文案窄（实测 117px，
   * 而真名 220px），**溢出与重叠都是 0** ⇒ 直接量会在「目录还没到」的那一刻跑到绿。
   * 判据取 `provider-icon` 出现：它在按钮里由 `<Show when={当前()?.provider?.id}>` 包着，
   * 出现 ⇔ 本栏真认出了一个模型（不是等固定毫秒）。
   */
  await expect(
    模型钮(page).locator('svg[data-component="provider-icon"]'),
    "前置：模型钮该先认出模型（否则量到的是占位文案宽度，本用例会假绿）",
  ).toBeVisible({ timeout: 30_000 })

  // 换成长名模型（见 `选最长名的模型` 的注释），并等弹层关掉、钮上落定。
  const 候选行 = page.locator('[data-option-key]:not([data-option-key="action:manage"])')
  const 原名 = (await 模型钮(page).innerText()).trim()
  const 最长名 = await 选最长名的模型(page)
  await expect(候选行.first(), "选完弹层该关掉").toHaveCount(0, { timeout: 15_000 })
  await page.waitForTimeout(600)
  const 新名 = (await 模型钮(page).innerText()).trim()
  console.log(`[窄右栏] 钮上名字：「${原名}」→「${新名}」；候选最长：「${最长名}」`)

  // ① 基线：默认 360 宽时本来就不该重叠（防止修出来一个「哪儿都缩」的新问题）。
  const 基线 = await 量底栏(page)
  console.log(`[窄右栏] 基线=${JSON.stringify(基线)}`)
  expect(基线.栏宽, "前置：右栏默认宽 360（three-pane.tsx 的 RIGHT_PANE_DEFAULT）").toBeGreaterThan(340)
  expect(基线.重叠宽, `默认宽度下就不许重叠｜${JSON.stringify(基线)}`).toBeLessThanOrEqual(0)
  expect(基线.发送钮中心归谁, "默认宽度下发送钮该点得到").toBe("prompt-submit")

  // ② 收窄到下限 240
  const 实得 = await 拖右栏到(page, 右栏下限)
  await page.waitForTimeout(400)
  console.log(`[窄右栏] 拖到 ${实得}`)
  expect(Math.abs(实得 - 右栏下限), `前置：右栏该被拖到下限 ${右栏下限}`).toBeLessThanOrEqual(2)

  const 窄 = await 量底栏(page)
  console.log(`[窄右栏] 窄栏=${JSON.stringify(窄)}`)

  // 前置：名字真长到装不下——否则下面几条会「本来就成立」，等于空转（`#005-18` 假绿四问）。
  // ⚠️ 判据取**文字那格**的 `scrollWidth > clientWidth`，不能取「按钮宽 > 组宽」：修好之后
  // 按钮本来就该缩到组内，那个不等式恒不成立（2026-11-04 第一版写错，修完当场红）。
  expect(
    窄.模型名装不下,
    `前置：这颗模型名要长到装不下（被截成省略号）｜${JSON.stringify(窄)}`,
  ).toBeGreaterThan(0)

  expect(窄.重叠宽, `窄栏下模型钮不许压住发送钮｜${JSON.stringify(窄)}`).toBeLessThanOrEqual(0)
  expect(窄.模型溢出组, `窄栏下模型钮不许溢出控件组｜${JSON.stringify(窄)}`).toBeLessThanOrEqual(0.5)
  expect(窄.发送钮中心归谁, `窄栏下发送钮中心该归它自己｜${JSON.stringify(窄)}`).toBe("prompt-submit")

  // ③ Playwright 自己的命中检查：有别的元素接管就抛「intercepts pointer events」。
  //    trial = 只做可点性检查，**不真的发消息**（不发消息才不触模型）。
  await 发送钮(page).click({ trial: true, timeout: 10_000 })

  // ④ 反退化：模型钮不能靠「缩没了」换绿。
  expect(窄.模型.宽, `模型钮该还在、还看得见｜${JSON.stringify(窄)}`).toBeGreaterThan(24)
  expect(窄.模型名.length, "模型钮上的名字该还在（缩成省略号，但 DOM 里是全文）").toBeGreaterThan(0)
  expect(窄.模型钮中心归谁, `模型钮自己得点得到｜${JSON.stringify(窄)}`).toBe("prompt-model")
})
