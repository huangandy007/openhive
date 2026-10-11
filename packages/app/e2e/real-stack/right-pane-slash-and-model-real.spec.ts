import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

/**
 * 右栏「`/` 命令面板 ＋ 底栏模型选择器」的真栈验收（2026-10-11）。
 *
 * 为什么这一层非有不可（`LEARNINGS #005-07` / `#006-08`）：
 * - **池子的条数**：组件层的 `data.command` 是夹具喂的，真池子有多少条只有真内核答得出
 *   （探针实测 118 条）；
 * - **几何**：弹层在不在视口内、底栏那颗钮坐在哪一行、列表滚不滚得动，happy-dom 量不出来；
 * - **接缝**：`ai-session-slot.tsx` 那一层挂不起来测（要活着的服务器连接），
 *   「slot 有没有把 `useCommand()` 供上、有没有把原生 `ModelSelectorPopoverV2` 接上」
 *   只有真栈看得见。
 *
 * ## 2026-10-11 第二轮：T3–T7 全部换成**原生弹层**的判据（用户下达）
 *
 * 第一轮那颗钮喂的是 `view.model`（一个 `PromptInputV2SelectControl`）⇒ 原生件走它自己的
 * **fallback** 分支（`session-ui/v2/components/prompt-input/index.tsx:228-244`）渲染
 * `PromptInputV2ConfiguredSelect` → `PromptInputV2Select`：一个平铺 `RadioGroup`
 * （`index.tsx:551-599`），**没有搜索框、没有分组、没有「管理模型」、也没有滚动容器**
 * ——用户实测原话：「点击后列表无法滚动选择，同时还没有管理模型和搜索模型的功能」。
 *
 * 正解是喂 `modelControl`（`index.tsx:43` 那个槽），渲染**上游自己那颗富弹层**
 * `ModelSelectorPopoverV2`（`components/dialog-select-model.tsx:225`）。它要一个
 * `ModelState`（`= ReturnType<typeof useLocal>["model"]`），而 `useLocal()` 在右栏原本取不到
 * ⇒ 右栏自挂 `SDKProvider` ＋ `LocalProvider`（`ai-session-slot.tsx`）。
 *
 * ## 这一轮**退掉**的一级：`会话记的`（服务端 `session.model`）
 *
 * 第一轮的 T5 钉的是「模型三级源」（本栏选的 → **会话记的** → 应用默认）里那一级
 * `session.model`。换成原生之后，`useLocal()` 的记忆是它自己的
 * （`localStorage: model-selection.v1`，按 `scope + 目录 + 会话 id` 记，见
 * `context/local.tsx:264-276` 的 `write()`），**不读服务端那一级**。
 * ⇒ T5 改为钉**原生那条记忆**：选中 ⇒ 钮上当场变；**重开页面** ⇒ 还是它。
 * ⚠️ 服务端 `session.model` 仍然写（提交时带出去，同前），只是不再作为**显示**的来源；
 * 中栏从来就没读过它（它读 `prompt.model` ＋ `local.session.restore(用户消息)`），
 * 所以右栏这一改是与上游**对齐**，不是功能丢失。代价如实记进
 * `docs/superpowers/specs/006-ai-session/state.md`。
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

/** 打开真栈、落在右栏、把 Hero 输入框里打上 `text`。 */
async function 开右栏并打字(page: Page, text: string) {
  const 会话 = await 建真会话("斜杠与模型验收会话")
  await setup(page, 会话)
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)
  const 面板 = page.locator('[data-component="session-panel"]')
  await expect(面板).toBeVisible()
  const 输入 = 面板.locator('[data-slot="session-hero"] [data-component="prompt-input"]')
  await expect(输入).toBeVisible()
  await 输入.click()
  await 输入.fill(text)
  await page.waitForTimeout(700)
  return { 面板, 输入, 会话 }
}

/**
 * 等 `/` 命令池稳定：服务端命令是 `void loadCommands(...)` **异步**填的（`state.md`「`sync.data.command`
 * 是异步填的」），v1 `/command` 那 3.9MB 清单要几秒才到 ⇒ 固定 700ms 不够。
 *
 * ⚠️ **「连续 N 拍不变」这条判据里藏着一个假稳态**（2026-10-11 实测修复）：开面板那一刻池子是**空的**
 * ——实测时间线 `+1579ms` 发 `GET /command`、`+3487ms` 响应、`+3777ms` 池子到 126 条——而
 * 「空池子连读 4 拍」也满足「稳定」⇒ 旧版**在数据到达前就返回 0**，T1 于是红过一次
 * （红的是断言、坏的是探针：`#006-26` 那一族）。修法：**空池子不算稳态**，并给一个总期限。
 */
async function 等命令池(page: Page, 面板: Locator) {
  let last = -1
  let stable = 0
  const 期限 = Date.now() + 45_000
  while (Date.now() < 期限) {
    const 条 = await 面板.locator('[data-suggestion-id^="custom."]').count()
    if (条 > 0 && 条 === last) {
      if (++stable >= 3) return 条
    } else {
      stable = 0
      last = 条
    }
    await page.waitForTimeout(500)
  }
  return last
}

/**
 * 底栏模型控件那颗钮。
 *
 * ⚠️ 它不在 `[data-component="prompt-input"]`（那是**文本框**）里——原生 `PromptInputV2` 的外壳是
 * `<form data-component="prompt-input-v2">`，文本框与底栏那排按钮（Add images / Choose model / Send）
 * 是**兄弟**。两个实现给这颗钮的记号**不一样**，而这条 spec 要在**改动前后都能开工**
 * （改之前必须能开到那颗钮、才谈得上「弹层里没有搜索框」这个**语义**上的红）：
 * - 旧（fallback 的 `PromptInputV2Select`）：`ButtonV2 aria-label={title}`
 *   （`session-ui/…/prompt-input/index.tsx:577`，title = `Choose model`）；
 * - 新（原生 `ModelSelectorPopoverV2` 的触发器）：`data-action="prompt-model"`
 *   ＋ `data-control-type="popover"`（`components/prompt-input-v2.tsx:520-534` 同款）。
 */
function 模型钮(面板: Locator): Locator {
  const 底座 = '[data-slot="session-hero"] [data-component="prompt-input-v2"]'
  return 面板.locator(`${底座} button[aria-label="Choose model"], ${底座} button[data-action="prompt-model"]`)
}

/** 原生弹层里的模型行（★ 上游 `dialog-select-model.tsx:472-475` 给每一行挂了 `data-option-key`）。 */
const 候选项 = (page: Page) => page.locator('[data-option-key]:not([data-option-key="action:manage"])')
/** 「管理模型」那一行（`dialog-select-model.tsx:507`，键是 `action:manage`）。 */
const 管理项 = (page: Page) => page.locator('[data-option-key="action:manage"]')
/**
 * 列表的**真正滚动容器**（`dialog-select-model.tsx:440` 的 `ScrollView`）。
 *
 * ⚠️ **两个盒子，只有一个滚**（2026-10-11 探针实测，`LEARNINGS #005-32` 同一族「量错了东西」）：
 * `ScrollView` 把 `data-slot` 和 `max-h-[220px]` 挂在**根**上，而根是 `overflow: hidden` 的**裁切盒**
 * （实测 `scrollHeight=220 clientHeight=220 overflowY=hidden` ⇒ 旧版取根，`scrollHeight >
 * clientHeight` 恒不成立、恒绿且空转）；真正滚的是它里面的 `div.scroll-view__viewport`
 * （`ui/src/components/scroll-view.css` 给它 `overflow-y: auto`，实测
 * `scrollHeight=478 clientHeight=220 overflowY=auto`）。
 *
 * 取 `[data-scrollable]`（`scroll-view.tsx:351` 上游给视口挂的记号，`scrollKeyOwner` 也靠它），
 * **不取类名**——类名是画法，记号是契约。
 */
const 滚动槽 = (page: Page) => page.locator('[data-slot="model-selector-scroll"] [data-scrollable]')
/** 搜索框（`dialog-select-model.tsx:370-373`）。 */
const 搜索框 = (page: Page) => page.locator('input[placeholder="Search models"]')

/** 打开底栏模型弹层，返回那颗钮。 */
async function 打开模型弹层(page: Page, 面板: Locator): Promise<Locator> {
  const 钮 = 模型钮(面板)
  await expect(钮, "底栏没有模型控件").toBeVisible()
  await 钮.click()
  return 钮
}

/**
 * 等底栏那颗钮**落定**＝等 `local.model.current()` 认出模型。
 *
 * 判据是 `model-control.tsx` 里那句 `<Show when={当前()?.provider?.id}>` 包的
 * `svg[data-component="provider-icon"]`（`ui/src/components/provider-icon.tsx`）：
 * **图标出现 ⇔ 本栏认出了一个模型**，且不依赖弹层开着。
 *
 * 为什么非等不可（2026-10-11 探针实测）：右栏自挂的 `LocalProvider` 取的是**目录级** provider
 * 目录（`useProviders(() => sdk().directory)`，`explicit: true`），而那个子 store 要几秒才
 * `provider_ready`（时间线：弹层在 +2992ms 打开时 `data-selected-model` **0 条**，
 * 目录那条 `GET /provider?directory=…` 的响应在 **+3052ms**，钮上见字在 +5253ms）。
 * 在它 ready 之前 `current()` 恒空 ⇒ 钮上是占位文案（`dialog.model.select.title`），
 * 于是「点完钮上的字变了」这条判据成了**假绿**：字变是因为「占位 → 真名」，
 * 而不是因为「A 模型 → 我点的 B 模型」（`LEARNINGS #003-03` 第三类，必须据实记）。
 */
async function 等钮落定(钮: Locator) {
  await expect(
    钮.locator('svg[data-component="provider-icon"]'),
    "右栏认不出本栏的模型（`local.model.current()` 恒空 ⇒ 钮上没有 provider 图标）",
  ).toHaveCount(1, { timeout: 30_000 })
}

/**
 * 等**候选真的进到弹层里**再往下量。
 *
 * ⚠️ **这一条是 T5 的一次假红追出来的**（2026-10-11，`#003-03` 第②类：缺陷在**判据**不在产品）。
 * T5 原来的顺序是「开弹层 → 立刻量滚动盒」，而弹层在 provider 目录就绪之前是**空态**
 * （快照实测：`region "scrollable content"` 里只有一句 `No model results`，
 * `menuitem "Manage models"` 照常在）⇒ 那个滚动区里**一行都没有**，
 * 几何读数成 `scrollHeight=50 clientHeight=50`（**不是**就绪时的 `478/220`）⇒
 * `scrollHeight > clientHeight` 当场红，而红的原因**不是产品不滚、是我量的时刻没内容**。
 *
 * 同一个窗口在 T4 上是**反向**的坑：它 `await 候选项(page).count()` **一次取值**再
 * `toBeGreaterThan(1)`——数字不会自己重试 ⇒ 冷启动那一跑会读到 `0` 而红。
 * `T3` 早就写对了（`await expect(候选项(page).first()).toBeVisible()` 是**会重试**的），
 * 这条 helper 就是把 T3 那个写法提出来共用（`#005-12`：同一个修法落在几处就写几条判据）。
 */
async function 等候选到齐(page: Page) {
  await expect(
    候选项(page).first(),
    "弹层里一条候选都没有（目录级 provider 目录还没就绪，弹层停在 `No model results` 空态）",
  ).toBeVisible({ timeout: 30_000 })
}

test("T1 · `/` 的池子＝服务端命令全集 ＋ 上游内建（不是本机那 2 条开发工具 skill）", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "/")
  await 等命令池(page, 面板)

  const 项 = await 面板.locator("[data-suggestion-id]").evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute("data-suggestion-id") ?? "", 文字: (el.textContent ?? "").trim() })),
  )

  // ① 条数：真内核那边 `GET /command` 实测 118 条。断言「≥100」是为了不把 118 这个数字焊死
  //    （沙箱里装了哪些 skill 会变），同时足以把「只有 2 条」那个旧缺陷钉死。
  expect(项.length, `池子只有 ${项.length} 条：${JSON.stringify(项.slice(0, 5))}`).toBeGreaterThanOrEqual(100)
  // ② 里面有**服务端命令**（`custom.` 前缀是 `右栏斜杠源` 给服务端那一支的 id 形状）。
  expect(项.filter((一条) => 一条.id.startsWith("custom.")).length).toBeGreaterThan(0)
  // ③ 里面有**上游内建**（id 不带 `custom.` 前缀的那一支）——这是旧的 skill 池子从来没有的一半。
  expect(项.filter((一条) => !一条.id.startsWith("custom.")).length).toBeGreaterThan(0)
  // ④ 每一行的 `label` 都带斜杠（原生浮层画的就是 `label`）。
  expect(项.every((一条) => 一条.文字.startsWith("/"))).toBe(true)

  console.log(`【T1 池子条数】${项.length} 条（自定义 ${项.filter((一条) => 一条.id.startsWith("custom.")).length} / 内建 ${项.filter((一条) => !一条.id.startsWith("custom.")).length}）`)
})

test("T2 · 选中一条**服务端命令** ⇒ token 留在正文里（不是选中即执行那一半）", async ({ page }) => {
  const { 面板, 输入 } = await 开右栏并打字(page, "/")
  await 等命令池(page, 面板)
  const 服务端那条 = 面板.locator('[data-suggestion-id^="custom."]').first()
  // 插入的是 `label` = `/${trigger}`（trigger = 命令名，`右栏斜杠命令` 拼的），**不是**整行 textContent
  // （textContent 还带着 title / description）。命令名 = `data-suggestion-id`（`custom.${item.name}`）去掉前缀。
  const 命令名 = ((await 服务端那条.getAttribute("data-suggestion-id")) ?? "").replace(/^custom\./, "")

  await 服务端那条.click()
  await page.waitForTimeout(300)

  // 正文里留下 `/<命令名>`（`machine.ts` 的 `replaceTrigger` 干的事），且**没有**发出去任何消息。
  expect(await 输入.innerText()).toContain(`/${命令名}`)
  expect(await 面板.locator('[data-slot="session-turns"] [data-component="session-turn"]').count()).toBe(0)
})

test("T3 · 底栏模型钮：坐在输入框里、点开弹**带搜索框**的层", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "")
  const 钮 = await 打开模型弹层(page, 面板)

  // 几何：钮坐在输入框那一排里、没有跑出视口（happy-dom 量不出来，`#005-07`）。
  const 盒 = await 钮.boundingBox()
  const 视口 = page.viewportSize()
  expect(盒, "控件没有盒").not.toBeNull()
  expect(盒!.width, "控件宽度为 0").toBeGreaterThan(0)
  expect(盒!.x, "控件跑到视口左边外面").toBeGreaterThanOrEqual(0)
  expect(盒!.x + 盒!.width, "控件跑到视口右边外面").toBeLessThanOrEqual(视口!.width)

  // ★ 这一条就是本轮要钉的**用户可见**差别：旧的平铺 `RadioGroup` 里**没有输入框**。
  await expect(搜索框(page), "弹层里没有搜索框（说明喂的不是原生 ModelSelectorPopoverV2）").toBeVisible()
  // 候选 ≥ 1（沙箱里已接入 provider），且「管理模型」在（旧的平铺菜单里也没有这一项）。
  await expect(候选项(page).first()).toBeVisible()
  await expect(管理项(page), "弹层里没有「管理模型」").toBeVisible()

  console.log(`【T3 模型钮】当前显示「${(await 钮.innerText()).trim()}」，候选 ${await 候选项(page).count()} 条`)
  await page.keyboard.press("Escape")
})

test("T4 · 搜索框能**过滤**（输入就缩小候选、清空就还原）", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "")
  await 打开模型弹层(page, 面板)
  await expect(搜索框(page)).toBeVisible()
  await 等候选到齐(page)

  const 全部 = await 候选项(page).count()
  expect(全部, "候选一条都没有，过滤无从谈起").toBeGreaterThan(1)

  // ① 喂一个**必然无人匹配**的词 ⇒ 候选清零、并弹出原生那句空态文案（`dialog.model.empty`）。
  await 搜索框(page).fill("zzzz-不存在的模型-zzzz")
  await expect(候选项(page)).toHaveCount(0, { timeout: 5000 })
  await expect(page.getByText("No model results")).toBeVisible()

  // ② 清空 ⇒ 回到全量（证明 ① 是「过滤」而不是「把列表整没了」）。
  await 搜索框(page).fill("")
  await expect(候选项(page)).toHaveCount(全部, { timeout: 5000 })

  // ③ 喂**真子串** ⇒ 候选变少、且每一条都命中（取第一条的名字里的头一个词做关键词）。
  const 样本 = ((await 候选项(page).first().innerText()) ?? "").trim()
  const 关键词 = 样本.split(/[\s/_-]+/).filter((s) => s.length >= 3)[0] ?? 样本.slice(0, 4)
  await 搜索框(page).fill(关键词)
  await page.waitForTimeout(500)
  const 命中 = await 候选项(page).count()
  expect(命中, `搜「${关键词}」（取自「${样本}」）一条都没命中`).toBeGreaterThan(0)
  expect(命中, `搜「${关键词}」没有缩小候选（全量 ${全部}）`).toBeLessThan(全部)
  const 文案 = await 候选项(page).allInnerTexts()
  expect(文案.every((t) => t.toLowerCase().includes(关键词.toLowerCase())), `「${关键词}」的命中里混进了不匹配的：${JSON.stringify(文案.slice(0, 5))}`).toBe(true)

  console.log(`【T4 过滤】全量 ${全部} → 空词 0 → 还原 ${全部} → 搜「${关键词}」${命中} 条`)
})

test("T5 · 列表**滚得动**，并能选中最后一条（旧版平铺菜单没有滚动容器）", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "")
  const 钮 = await 打开模型弹层(page, 面板)
  await expect(搜索框(page)).toBeVisible()
  // ★ 先等候选到齐（理由见 `等候选到齐`：空态那个盒子只有 50px，量了会假红）。
  await 等候选到齐(page)

  // ① 有**真滚动容器**——注意量的是 `ScrollView` 内层那个视口，不是挂 `data-slot` 的裁切盒
  //    （两个盒子的区别见 `滚动槽` 的注释；旧版取根 ⇒ 恒等 ⇒ 空转）。
  const 槽 = 滚动槽(page)
  await expect(槽, "弹层里没有滚动容器").toBeVisible()
  const 量 = await 槽.evaluate((el) => {
    const 盒 = el as HTMLElement
    return { scrollHeight: 盒.scrollHeight, clientHeight: 盒.clientHeight, overflowY: getComputedStyle(盒).overflowY }
  })
  console.log(`【T5 滚动槽】scrollHeight=${量.scrollHeight} clientHeight=${量.clientHeight} overflowY=${量.overflowY}`)
  expect(量.overflowY, `卷起来的不是这个盒子（overflowY=${量.overflowY}），它只是外面的裁切层`).toBe("auto")
  expect(量.scrollHeight, `滚动容器里装不下内容（scrollHeight=${量.scrollHeight} ≤ clientHeight=${量.clientHeight}），这道判据会空转`).toBeGreaterThan(量.clientHeight)

  const 条数 = await 候选项(page).count()
  expect(条数, "候选太少，滚不动").toBeGreaterThan(5)

  // ② 滚到底 ⇒ **末条真的落进视口**。用户原话「点击后列表无法滚动选择」钉的就是这一条：
  //    光「有个能滚的盒子」还不够，滚到底之后末条得点得到（`scrollIntoView` 之外还有真实滚动）。
  const 目标 = 候选项(page).last()
  const 目标名 = ((await 目标.innerText()) ?? "").trim()
  await 槽.evaluate((el) => {
    ;(el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight
  })
  await page.waitForTimeout(300)
  const 落点 = await 目标.evaluate((el) => {
    const 行 = el.getBoundingClientRect()
    const 视口 = el.closest<HTMLElement>("[data-scrollable]")!.getBoundingClientRect()
    return {
      行上: Math.round(行.top),
      行下: Math.round(行.bottom),
      视口上: Math.round(视口.top),
      视口下: Math.round(视口.bottom),
    }
  })
  expect(落点.行上, `滚到底后末条「${目标名}」还在视口上方（${JSON.stringify(落点)}）`).toBeGreaterThanOrEqual(落点.视口上 - 1)
  expect(落点.行下, `滚到底后末条「${目标名}」还在视口下方（${JSON.stringify(落点)}）`).toBeLessThanOrEqual(落点.视口下 + 1)

  // ③ 点末条 ⇒ 钮上的字**变成它**（等条件，不等时长：见 `等钮落定`）。
  await 等钮落定(钮)
  const 前 = (await 钮.innerText()).trim()
  expect(前, `末条「${目标名}」本来就是当前认的模型，这一条证明不了「点是点上了」`).not.toBe(目标名)

  await 目标.click()
  await expect(钮, `点了最后一条「${目标名}」，钮上的字没变成它（还是「${前}」）`).toHaveText(目标名, { timeout: 30_000 })
  console.log(`【T5 滚动选最后一条】「${前}」 → 「${(await 钮.innerText()).trim()}」（末条「${目标名}」）`)
})

test("T6 · 「管理模型」点开是**原生那个对话框**", async ({ page }) => {
  const { 面板 } = await 开右栏并打字(page, "")
  await 打开模型弹层(page, 面板)
  await expect(管理项(page)).toBeVisible()
  // ★ 「管理模型」那一行**空态下也在**（快照实测）⇒ 它的可见性证明不了目录已就绪，而下面
  //   那句 `开关.count()` 是**一次取值**、不会重试 ⇒ 先等候选到齐（同 `等候选到齐` 里那条）。
  await 等候选到齐(page)

  await 管理项(page).click()
  const 对话框 = page.locator('[role="dialog"]')
  await expect(对话框, "点了「管理模型」没有弹出对话框").toBeVisible({ timeout: 10000 })
  // 原生那个对话框的判据：标题是 `dialog.model.manage` ＋ 它有按 provider 的开关
  // （`dialog.model.manage.provider.toggle`，`dialog-manage-models.tsx`）。用**文案**判，
  // 不用类名/结构（那些是实现的形状，会随上游变）。
  await expect(对话框).toContainText("Manage models")
  const 开关 = 对话框.locator('[role="switch"], input[type="checkbox"], [role="checkbox"]')
  expect(await 开关.count(), "「管理模型」对话框里一个开关都没有").toBeGreaterThan(0)
  console.log(`【T6 管理模型】对话框文案：${JSON.stringify((await 对话框.innerText()).slice(0, 120))}`)
})

test("T7 · 选中 ⇒ 钮上当场变；**重开页面**还是它（原生那条按会话的记忆）", async ({ page }) => {
  const { 面板, 会话 } = await 开右栏并打字(page, "")
  const 钮 = await 打开模型弹层(page, 面板)
  await expect(搜索框(page)).toBeVisible()

  // ★ 先**等本栏认出一个模型**：在它 ready 之前钮上是占位文案，此时点什么都「看起来变了」
  //   ——那条判据就成了假绿（理由与实测数字见 `等钮落定`）。
  await 等钮落定(钮)
  const 当前 = (await 钮.innerText()).trim()

  const 目标 = 候选项(page).filter({ hasNotText: 当前 }).last()
  const 目标名 = ((await 目标.innerText()) ?? "").trim()
  await 目标.click()

  // 等条件，不等时长：写回要走 `startTransition` ＋ 一次 `validModel` 复核。
  await expect(钮, `点了「${目标名}」，钮上的字没变成它（还是「${当前}」）`).toHaveText(目标名, { timeout: 15_000 })
  const 选后 = (await 钮.innerText()).trim()

  // ★ 重开页面：本栏**没有任何内存态**活下来（`AiSessionSlot` 整个重挂）⇒ 钮上的字只能来自
  // `useLocal()` 自己那份按 `scope + 目录 + 会话 id` 的记忆（`localStorage: model-selection.v1`）。
  // ⚠️ 重开后同样要等目录级 provider 目录就绪（`等钮落定`），所以超时给到 30s。
  await page.goto(`/server/${base64Encode(FRONT())}/session/${会话}`)
  const 面板二 = page.locator('[data-component="session-panel"]')
  await expect(面板二).toBeVisible()
  const 钮二 = 模型钮(面板二)
  await expect(钮二).toBeVisible()
  await expect(钮二, `重开页面后钮上不是「${选后}」`).toHaveText(选后, { timeout: 30_000 })

  console.log(`【T7 记忆】「${当前}」 → 「${选后}」；重开页面仍是「${(await 钮二.innerText()).trim()}」`)
})
