#!/usr/bin/env node
/**
 * storybook ＋ 真 Chromium 的 axe 审计（**零新依赖**）。
 *
 * ## 为什么是这个形状
 *
 * 本仓的 [FE] 组件要有一层 **运行时 a11y 审计**：jsx-a11y 那道 lint 门只判「静态可判」的那一半
 * （键盘可达 / 可访问名称 / aria 角色用法，见 `script/oxlintrc.openhive.json`），**对比度 / 焦点顺序
 * / 屏幕阅读器行为**它看不见——那部分要 axe ＋ 真浏览器。而 axe 只照得到**有 story 的组件**
 * （storybook 的 glob 决定），所以「组件没有 story」＝「这一层没有审计」。见 005 的
 * `packages/app/src/project/project-anchor.stories.tsx` 与 006 的 `ai-session/*.stories.tsx`。
 *
 * ## 为什么不用 `@storybook/addon-vitest`
 *
 * `packages/storybook` 已声明该 addon，但全仓**没有任何 vitest 配置**、**没有任何包声明 vitest**
 * ⇒ 它是**惰性**的（`preview.tsx` 也写着 `a11y: { test: "todo" }`），要变成门禁得改上游
 * `packages/storybook/package.json` ＋ 加 vitest 配置——那是另一笔要单独权衡的账。
 * 本脚本改用**仓库已有的** Playwright ＋ `@storybook/addon-a11y` 的传递依赖 axe-core
 * （躺在 `node_modules/.bun/axe-core@<版本>/…`）⇒ **不动任何 `package.json`、不碰 `bun.lock`**
 * （本仓第一号约束：最小化与上游的合并冲突）。
 *
 * ## ⚠️ 必须用 `node` 跑，**不能用 `bun` 跑**（实测，2026-10-08）
 *
 * Bun 的 node 兼容层接不上 Playwright 的 CDP 传输层：`chromium.launch()` 下浏览器进程**能起来**
 * （`DEBUG=pw:browser*` 看得到 `pid=`），但 `--remote-debugging-pipe` 握手**永远不完成**，`launch`
 * 一直挂到定时器把它掐掉；`connectOverCDP` 同样挂在 ws 那一步。**已排除的可能性**：不是浏览器坏
 * （裸 `msedge --headless --dump-dom about:blank` 正常返回、退出码 0）、不是端口/防火墙（裸
 * `WebSocket` 连 DevTools 端点 **128ms** 接上）、不是 binary 版本（同一台机器上换运行时即通）。
 * 对照实测（同机 / 同 binary / 同一次会话）：
 *
 * ```
 * node -e 'chromium.launch({executablePath: …/chromium-1234/chrome-win64/chrome.exe})'  ⇒ ✓ 534ms
 * bun  …同一行代码…                                                                  ⇒ ✗ 挂到超时
 * ```
 *
 * ⇒ 结论落在**运行时**上。故本文件用 `node` 运行（它同样能直接跑 `.ts`，Node ≥ 23 默认剥类型），
 * 且**刻意不 import 任何 `Bun.*`**，保持运行时中立。
 *
 * ## 用法
 *
 *   # 先起 storybook（另开一个终端）：
 *   bun --cwd packages/storybook storybook --port 6017 --ci --no-open
 *   # 再跑本脚本（从 packages/app 下跑，让 node 能解析到 @playwright/test）：
 *   node e2e/a11y/storybook-axe-audit.ts
 *   node e2e/a11y/storybook-axe-audit.ts "App/OpenHive"       # 换前缀
 *   AXE_BROWSER=<可执行文件路径> node e2e/a11y/storybook-axe-audit.ts   # 指定浏览器
 *
 * 退出码：有任何违例 ⇒ 1（可当门禁）；否则 0。
 * ⚠️ **发现真缺陷时按 frontend-testing 护栏 HALT**——本脚本不改产品码，只出证据。
 *
 * ## 几何那一半（同一次渲染里顺带做，不额外起页面）
 *
 * 本脚本还兜住**另一类只有真浏览器能验的东西：几何**。理由是同一句话——happy-dom 没有 CSS
 * 引擎。具体到本 feature：`instruction-cards.tsx` 的 `ResizeObserver` 在无 CSS 引擎的环境里
 * **不存在**（它自己判了 `typeof ResizeObserver === "undefined"` 就跳过）⇒ 量到的宽恒为 0
 * ⇒ 走「不限宽」那一支 ⇒ **溢出永远不会发生**。于是「指令卡空间不足时溢出收「⋯」，不用横向
 * 滚动条」（006 `spec.md` 的验收标准）在**两个测试层里都到达不了**，只有这里能到。
 *
 * 对**任何**带 `[data-slot="card-row"]` 的 story 跑三条**不变量**（不重抄产品那条算式
 * ——`LEARNINGS #002-06`）：① 不横向滚动；② 卡片守恒（`可见 ＋ 收进 == 总数`，总数由夹具在外层
 * 容器上用 `data-fixture-cards` 自报，**不挂在产品组件上**）；③ 溢出钮与收进数同真同假。
 * 外加一条**跨 story 的单调性**：量到的宽越大，显示的卡不能更少（正反两条一起才夹得住
 * 「测量是活的」，见 `LEARNINGS #005-07`）。
 * ⚠️ 它**不是像素基线**（那要 Docker 固定渲染环境 ＋ 人审裁决）：这里判的是可写成不变量的几何。
 */
import { chromium, type Browser } from "@playwright/test"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SB = process.env.STORYBOOK_URL ?? "http://localhost:6017"
const TITLE_PREFIX = process.argv[2] ?? "App/OpenHive/AiSession"

/** axe-core 在 bun store 里的实际路径（版本会漂，动态取，别写死版本号）。 */
function axeFile(): string {
  const store = resolve(HERE, "../../../../node_modules/.bun")
  const dir = readdirSync(store).find((d) => d.startsWith("axe-core@"))
  if (!dir) throw new Error(`找不到 axe-core（在 ${store} 里）——它应是 @storybook/addon-a11y 的传递依赖`)
  return join(store, dir, "node_modules", "axe-core", "axe.min.js")
}

/**
 * 起一个能连上的 Chromium。
 *
 * 本机 `%LOCALAPPDATA%/ms-playwright` 里的 chromium revision 与 `@playwright/test@1.59.1` 期望的
 * **对不上**（期望 `chromium_headless_shell-1217`，实装 `-1208` / `-1234`）⇒ **默认 launch 必失败**，
 * 必须显式给 `executablePath`。故按「完整 chromium → headless shell → 系统 Edge」逐个试，
 * 取第一个起得来的。可用 `AXE_BROWSER=<路径>` 指定。
 */
async function launchBrowser(): Promise<Browser> {
  type Opt = Parameters<typeof chromium.launch>[0]
  const 候选: { 名: string; opts: Opt }[] = []
  if (process.env.AXE_BROWSER) 候选.push({ 名: process.env.AXE_BROWSER, opts: { executablePath: process.env.AXE_BROWSER, headless: true } })
  const mp = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : undefined
  if (mp && existsSync(mp)) {
    const 全部 = readdirSync(mp)
    for (const d of 全部.filter((x) => x.startsWith("chromium-")).sort().reverse()) {
      const exe = join(mp, d, "chrome-win64/chrome.exe")
      if (existsSync(exe)) 候选.push({ 名: `${d}（完整 chromium）`, opts: { executablePath: exe, headless: true } })
    }
    for (const d of 全部.filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
      const exe = join(mp, d, "chrome-headless-shell-win64/chrome-headless-shell.exe")
      if (existsSync(exe)) 候选.push({ 名: `${d}（headless shell）`, opts: { executablePath: exe, headless: true } })
    }
  }
  候选.push({ 名: "系统 Edge（channel）", opts: { channel: "msedge" } })

  for (const c of 候选) {
    try {
      const b = await chromium.launch({ ...c.opts, timeout: 30000 })
      console.log(`chromium: ${c.名}`)
      return b
    } catch (e) {
      console.log(`  ✗ 起不来：${c.名} —— ${String(e).split("\n")[0].slice(0, 120)}`)
    }
  }
  console.error("没有任何可用的 Chromium——用 AXE_BROWSER=<可执行文件路径> 指定一个")
  process.exit(3)
  // 兜底 `throw`：`consistent-return` **不把 `process.exit` 当终止**（它只认 `throw` / `return`），
  // 少了这一行会报「Async function expected a return value」。留着它，退出码 3 才区分得出来
  // 「没有可用浏览器」与「有违例（1）/ 没匹配的 story（2）」。实测 2026-10-08。
  throw new Error("unreachable: process.exit(3) 未生效")
}

type Entry = { id: string; type: string; title: string; name: string }
type 违例 = { id: string; impact: string | null; help: string; nodes: { target: unknown; html: string }[] }

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `Response.json()` 返回 `any`（lib 定义如此）；端点是本机自己的 storybook，形状由 storybook 保证。
const index = (await (await fetch(`${SB}/index.json`)).json()) as { entries: Record<string, Entry> }
const stories = Object.values(index.entries).filter(
  (e) => e.type === "story" && e.title.startsWith(TITLE_PREFIX),
)
if (stories.length === 0) {
  console.error(`没有匹配前缀「${TITLE_PREFIX}」的 story——先确认 storybook 已 pick up（查 ${SB}/index.json）`)
  process.exit(2)
}

const AXE = axeFile()
console.log(`axe: ${AXE}`)
console.log(`storybook: ${SB}｜前缀: ${TITLE_PREFIX}｜story 数: ${stories.length}\n`)

const browser = await launchBrowser()
const ctx = await browser.newContext({ viewport: { width: 480, height: 900 } })
let 违例总数 = 0

/**
 * 几何审计的每一格（**只有带 `[data-slot="card-row"]` 的 story 才有**——那是一条由**实测宽度**
 * 决定内容的行，见 `storybook-browser-audit` 文件头「几何那一半」）。
 */
type 几何 = {
  story: string
  theme: "light" | "dark"
  量到宽: number
  横向溢出: number
  可见: number
  有溢出钮: boolean
  收进: number
  总数: number | null
}
const 几何格: 几何[] = []
let 几何失败 = 0

for (const story of stories) {
  for (const theme of ["light", "dark"] as const) {
    const page = await ctx.newPage()
    const url = `${SB}/iframe.html?id=${story.id}&viewMode=story${theme === "dark" ? "&globals=theme:dark" : ""}`
    // axe 的注入走「让 Playwright 自己读文件」（route.fulfill）——别 readFileSync 再内联，
    // 那在某些驱动 VM 里会因动态 import 缺失而失败。
    await page.route("**/axe.min.js", (route) => route.fulfill({ path: AXE, contentType: "application/javascript" }))
    await page.goto(url, { waitUntil: "load" })
    // 等确实渲染出来（**不是**一个短超时判「没渲染」）。首访某模块 Vite 要按需 transform，会慢。
    // 空态 story（`ContextEmpty` / `Closed`）本就不产内容 ⇒ 等到超时属**预期**，不当失败。
    const 有内容 = await page
      .waitForFunction(
        () => {
          const root = document.getElementById("storybook-root")
          return !!root && root.children.length > 0
        },
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false)
    await page.addScriptTag({ url: `${SB}/axe.min.js` })
    const 主题生效 = await page.evaluate(() => document.documentElement.classList.contains("dark"))
    // ⚠️ **页面里已经有一个 axe 在跑**：`@storybook/addon-a11y` 是活的，`preview.tsx` 的
    // `a11y: { test: "todo" }` 语义是「**跑**，但违规只标 todo、不判失败」⇒ 每渲染一条 story 它
    // 就会起一轮 axe，而 axe 有全局单例锁：`window.axe.run()` 在同一轮没跑完时**直接抛**
    // `Axe is already running.`（实测 2026-10-08，`session-panel--default` 那格撞上）。
    // 故这里**有界重试**等它跑完——这是审计夹具与 storybook 自带插件的**并发**，不是被测物的问题
    // （`#003-01`：先怀疑测量）。重试上限 20×250ms，超了照原样抛（不吞错）。
    const 跑一轮 = () =>
      page.evaluate(async () => {
        // @ts-expect-error axe 是运行时注入的全局
        return await window.axe.run(document.getElementById("storybook-root"), { resultTypes: ["violations"] })
      })
    let result: unknown
    for (let i = 0; ; i++) {
      try {
        result = await 跑一轮()
        break
      } catch (e) {
        if (i >= 20 || !String(e).includes("already running")) throw e
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    /**
     * 几何那一半（**只有这一处是真浏览器能给、happy-dom 给不了的**）。
     *
     * `instruction-cards.tsx` 的 `ResizeObserver` 在无 CSS 引擎的环境里**不存在**（它自己判了
     * `typeof ResizeObserver === "undefined"` 就跳过）⇒ 量到的宽恒为 0 ⇒ 走「不限宽」那一支
     * ⇒ 溢出**永远不会发生**。所以「空间不足收进 ⋯、不横向滚动」这条验收标准只有真浏览器能验。
     * 这里对**任何**带 `[data-slot="card-row"]` 的 story 都跑，判据只用**不变量**，不重抄产品
     * 那条算式（`#002-06`：同一个算式别两处各写一份——抄一份就等于给漂移留个家）。
     */
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `page.evaluate` 的返回是 `unknown`；形状由下方这一处自产自销。
    const 一格 = (await page.evaluate(() => {
      const 行 = document.querySelector('[data-slot="card-row"]')
      if (!行) return null
      const 溢出钮 = 行.querySelector('[data-slot="card-overflow"]')
      const 标签 = 溢出钮?.getAttribute("aria-label") ?? ""
      const 夹具 = 行.closest("[data-fixture-cards]")?.getAttribute("data-fixture-cards")
      // ⚠️ 溢出量**不能用 `scrollWidth - clientWidth`**：那一行没设 `overflow`（默认 `visible`），
      // 而 `overflow: visible` 的盒子其滚动区**等于** padding box ⇒ 那个差恒为 0，量不出溢出
      // （第一版就是这么写的，量出来的每格都是 0）。改量**实际渲染到的右边界**——这才是那句验收
      // 标准「不用横向滚动条」的字面意思：行里的东西有没有横着探出行外。
      const 行盒 = 行.getBoundingClientRect()
      const 内容右 = Math.max(
        行盒.left,
        ...Array.from(行.querySelectorAll('[data-slot="card"], [data-slot="card-overflow"]')).map(
          (e) => e.getBoundingClientRect().right,
        ),
      )
      return {
        量到宽: 行.clientWidth,
        横向溢出: Math.round(内容右 - 行盒.right),
        可见: 行.querySelectorAll('[data-slot="card"]').length,
        有溢出钮: 溢出钮 !== null,
        收进: 溢出钮 ? Number(标签.match(/还有 (\d+) 张/)?.[1] ?? -1) : 0,
        总数: 夹具 === null || 夹具 === undefined ? null : Number(夹具),
      }
    })) as Omit<几何, "story" | "theme"> | null

    await page.close()

    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `page.evaluate` 的返回是 `unknown`/error 类型；形状由 axe 的公开 API 保证（`resultTypes: ["violations"]`）。
    const 违例 = (result as { violations: 违例[] }).violations
    const 标签 = `${story.id} [${theme}]`

    // ⚠️ 几何这一段**必须排在下面那个 `continue` 之前**。第一版写在违例打印之后 ⇒ 只有
    // **有违例**的那一格留下了几何记录（2026-10-08 实测：几何 1 格 —— 恰好是唯一那条红的
    // `common-selected [dark]`），其余全被 `continue` 跳过。和 `LEARNINGS #004-14` 是同一个形状：
    // **书写顺序决定你拿到哪条证据**，而这里更隐蔽——它不是「红的顺序」，是「整段被跳过」。
    if (一格) {
      几何格.push({ ...一格, story: story.id, theme })
      const 账 = `量到宽=${一格.量到宽} 可见=${一格.可见} 收进=${一格.收进} 总数=${一格.总数 ?? "未声明"}`
      const 失格: string[] = []
      // 判据 ①（`spec.md` 的验收标准，逐字）：**不横向滚动**。
      if (一格.横向溢出 > 1) 失格.push(`横向溢出 ${一格.横向溢出}px`)
      // 判据 ②：**一张都不能丢**（守恒）。只在夹具自报了总数时验——它挂在外层容器上、不在产品码上。
      if (一格.总数 !== null && 一格.可见 + 一格.收进 !== 一格.总数)
        失格.push(`卡片不守恒：可见 ${一格.可见} ＋ 收进 ${一格.收进} ≠ 总数 ${一格.总数}`)
      if (一格.总数 !== null && 一格.可见 < 1) 失格.push("一张都没显示")
      // 判据 ③：`收进 > 0` 与 `有溢出钮` 必须同真同假（钮不在而数说收进了 ⇒ 那些卡凭空消失）。
      if ((一格.收进 > 0) !== 一格.有溢出钮) 失格.push(`溢出钮与收进数不符（${一格.有溢出钮}／${一格.收进}）`)
      if (失格.length === 0) console.log(`   ⊢ 几何 ✓ ${账}`)
      else {
        几何失败 += 失格.length
        console.log(`   ⊢ 几何 ❌ ${账} —— ${失格.join("；")}`)
      }
    }

    if (违例.length === 0) {
      console.log(`✅ ${标签}　theme-in-DOM=${主题生效}　内容=${有内容}　0 违例`)
      continue
    }
    违例总数 += 违例.length
    console.log(`❌ ${标签}　theme-in-DOM=${主题生效}　内容=${有内容}　${违例.length} 违例`)
    for (const v of 违例) {
      console.log(`     - ${v.impact} · ${v.id} · ${v.help}`)
      // 把**具体节点**打出来：只有 axe id 时下一个人还得重跑一遍才知道打的是哪个元素。
      for (const n of v.nodes) console.log(`         ${JSON.stringify(n.target)}  ${n.html.slice(0, 120)}`)
    }
  }
}

/**
 * 单调性（跨 story 的**一条**判据，`LEARNINGS #005-07` 的对照纪律）：
 * **量到的宽越大，显示的卡不能更少。** 只在同一份夹具（同一个`总数`）的两格之间比。
 *
 * 为什么值得单独一条：单看「窄的那格收进了 2 张」是**证不出**「测量是活的」的
 * ——「量到的宽恒为 0 ⇒ 永远全显示」这个坏法压根不会让窄的那格红（它只是「没收」），
 * 而「恒为 0」同样通不过「宽的那格一张都不该收」。两条**一起**才夹住它。
 */
for (const 总数 of new Set(几何格.map((g) => g.总数).filter((n) => n !== null))) {
  const 同批 = 几何格.filter((g) => g.总数 === 总数).sort((a, b) => a.量到宽 - b.量到宽)
  for (let i = 1; i < 同批.length; i++) {
    if (同批[i]!.可见 < 同批[i - 1]!.可见) {
      几何失败 += 1
      console.log(`   ⊢ 几何 ❌ 单调性：宽 ${同批[i]!.量到宽} 比窄的 ${同批[i - 1]!.量到宽} 显示得更少`)
    }
  }
}

await browser.close()
console.log(`\n合计 ${违例总数} 条违例｜几何 ${几何格.length} 格，${几何失败} 条失格`)
process.exit(违例总数 > 0 || 几何失败 > 0 ? 1 : 0)
