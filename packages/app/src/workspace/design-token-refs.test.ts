import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * openhive 自有代码引用的 v2 token，**名字是否真的存在**。
 *
 * 守的是**引用完整性**，不是值对不对——「值对不对」归 `packages/ui` 的
 * `theme/brand-paint.test.ts`（它钉死了换皮的三处载体）；这里管的是另一半：
 * **引用了一个根本没有的 token 时，什么都不会报错**。
 *
 * **为什么这种错会静默**（本文件存在的全部理由）：
 * - 写 `var(--v2-typo-name)` 时 CSS 不报错，只是该声明整条失效——组件少个颜色、少个底色，
 *   构建、类型检查、所有既有测试**全绿**。
 * - Tailwind 工具类（`bg-v2-…`）更隐蔽：v2 的 token 经生成物
 *   `packages/ui/src/styles/tailwind/colors.css` 的 `--color-v2-*` 转成工具类，而那个文件开头
 *   第一行就是 `--color-*: initial`（**把 Tailwind 默认调色板整个清空**）。名字对不上时
 *   Tailwind **压根不生成这条类**——元素拿不到任何样式，同样全绿。
 * 而既有测试断言的是「源码里有这个类名字符串」（如 `text-v2-text-text-muted`），
 * **不是**「这条类真的生成出来了」——所以拼错一个 token，既有测试一个都不会红。
 *
 * **为什么落在这里、而不是 lint 门里**：lint 规则看的是单个文件的 AST，判不了「这个名字在
 * 另一个包的文件里有没有定义」——它是**跨文件的数据**，天然属于测试。门与测试在这件事上是分工的：
 * 门管「**有没有新写死的色值**」（形状/来源，单文件可判），本文件管「**引用的名字存不存在**」
 * （跨文件一致性）。
 *
 * ⚠️ **扫描范围与 lint 门严格同口径**：同为 openhive 自有那四个目录（`lint:openhive` 扫的就是它们），
 * 同为「除 `*.test.*` 之外」。口径一致的用意是：门与测试对同一片代码给出**同一套判断**，
 * 不会出现「门放行的东西测试骂」。扩范围时两处要一起扩——只改一处会让这份对照失真。
 *
 * ⚠️ 本文件**只读、不跑 CSS 引擎**：它证的是「名字存在」，不是「浏览器解析出来是对的」。
 * 后者（token 存在但被别的层叠覆盖、`@layer` 顺序、真实渲染值）需要真浏览器——那部分本轮没做。
 */

const 仓库根 = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..")

/** 与 `package.json` 的 `lint:openhive` 同口径的四个目录。 */
const 自有目录 = ["rail", "center", "topbar", "workspace"].map((d) => join(仓库根, "packages/app/src", d))

function 收集源文件(目录: string): string[] {
  const 出: string[] = []
  for (const 项 of readdirSync(目录)) {
    const 路径 = join(目录, 项)
    if (statSync(路径).isDirectory()) {
      出.push(...收集源文件(路径))
      continue
    }
    if (!/\.(ts|tsx)$/.test(路径)) continue
    // 测试文件不算「产品引用」——它们里面本就写着 token 名字做断言
    if (/\.test\.(ts|tsx)$/.test(路径)) continue
    出.push(路径)
  }
  return 出
}

/**
 * 一个 v2 名字的形状：`v2-` 后跟若干 `-` 分隔的段，**且不以 `-` 结尾**。
 *
 * ⚠️ 「不以 `-` 结尾」是**必需的，不是洁癖**：源码注释里存在通配写法（如 `text-v2-icon-*`、
 * `bg-v2-…`）。若允许尾随 `-`，`text-v2-icon-*` 会被抠成 `v2-icon-` 去查定义，查不到，
 * 于是这条通配注释被当成「悬空 token」误报——一份红在假阳性上的测试，等于没有测试。
 */
const 名 = String.raw`v2-[a-z0-9]+(?:-[a-z0-9]+)*`

/** `var(--v2-x)` 形式的直接引用。 */
const 变量引用 = new RegExp(String.raw`var\(--(${名})\)`, "g")

/**
 * Tailwind 颜色工具类形式的引用（`bg-v2-…` / `hover:text-v2-…` / `group-hover:bg-v2-…`）。
 *
 * 前缀表只收 Tailwind v4 里**会去消费 `--color-*` 的那些**。刻意收窄的代价是漏掉冷门前缀，
 * 收益是不把 `data-v2-foo` 这类**不是颜色**的名字误当颜色查。
 */
const 工具类引用 = new RegExp(
  String.raw`(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|outline|divide|from|via|to|decoration|placeholder|caret|accent|shadow)-(${名})(?![\w-])`,
  "g",
)

/** 取出某个文件里所有匹配的第一捕获组。 */
function 抓(正则: RegExp, 文本: string): string[] {
  return [...文本.matchAll(new RegExp(正则.source, 正则.flags))].map((m) => m[1])
}

const 源文件 = 自有目录.flatMap(收集源文件)
const 源码 = 源文件.map((f) => ({ 文件: f, 文本: readFileSync(f, "utf8") }))

/** 语义/原语 token 的定义来源（`--v2-x: …`）。 */
const 定义来源 = [
  "packages/ui/src/v2/styles/colors.css",
  "packages/ui/src/v2/styles/theme.css",
].map((p) => join(仓库根, p))

const 已定义 = new Set<string>()
for (const 路径 of 定义来源) {
  for (const m of readFileSync(路径, "utf8").matchAll(/--(v2-[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/g)) 已定义.add(m[1])
}

/**
 * 运行时真正的载体：`ThemeProvider` 把它的 `v2Overrides` 写进一个**不带 `@layer`** 的
 * `<style id="oc-theme">`，按层叠规则压过 `@layer theme` 里的同名变量。键名不带 `--` 前缀。
 */
const OC2: { light: { v2Overrides: Record<string, string> } } = JSON.parse(
  readFileSync(join(仓库根, "packages/ui/src/theme/themes/oc-2.json"), "utf8"),
)
for (const 键 of Object.keys(OC2.light.v2Overrides)) 已定义.add(键)

/** Tailwind 工具类的**孪生**定义来源：生成物里的 `--color-v2-x`。 */
const 生成物 = readFileSync(join(仓库根, "packages/ui/src/styles/tailwind/colors.css"), "utf8")
const 已生成 = new Set<string>(
  [...生成物.matchAll(/--color-(v2-[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/g)].map((m) => m[1]),
)

describe("引用完整性：写了 var(--v2-x) 就得有 --v2-x", () => {
  const 引用 = new Map<string, string[]>()
  for (const { 文件, 文本 } of 源码) {
    for (const 名字 of 抓(变量引用, 文本)) {
      if (!引用.has(名字)) 引用.set(名字, [])
      引用.get(名字)!.push(文件)
    }
  }

  test(`扫到 ${引用.size} 个 var() 引用的 token，全部有定义`, () => {
    const 悬空 = [...引用.keys()].filter((n) => !已定义.has(n)).sort()
    expect(悬空).toEqual([])
  })

  test("扫描确实覆盖到了四个自有目录（防止目录挪走/改名后本文件静默变空）", () => {
    // ⚠️ 这条是**元断言**：上一条测试在「扫描到 0 个引用」时也会绿——
    // 而「什么都没扫到」与「全都对」是两件事。没有这条，目录一改名本文件就变成一句废话。
    expect(源文件.length).toBeGreaterThan(20)
    expect(引用.size).toBeGreaterThan(3)
  })
})

describe("引用完整性：写了 bg-v2-x 这类工具类，就得有 --color-v2-x 孪生", () => {
  const 引用 = new Map<string, string[]>()
  for (const { 文件, 文本 } of 源码) {
    for (const 名字 of 抓(工具类引用, 文本)) {
      if (!引用.has(名字)) 引用.set(名字, [])
      引用.get(名字)!.push(文件)
    }
  }

  test(`扫到 ${引用.size} 个工具类 token，生成物里都有孪生`, () => {
    const 无孪生 = [...引用.keys()].filter((n) => !已生成.has(n)).sort()
    expect(无孪生).toEqual([])
  })

  test("工具类背后的 --v2-x 本身也必须有定义（孪生只是壳，值在 token 里）", () => {
    // 两层都要查：缺孪生 → Tailwind 不生成这条类；有孪生但 token 没定义 →
    // 类生成出来了，值却解析不出来，同样是静默失效。
    const 无定义 = [...引用.keys()].filter((n) => !已定义.has(n)).sort()
    expect(无定义).toEqual([])
  })

  test("扫描确实覆盖到了工具类（同上：防空转）", () => {
    expect(引用.size).toBeGreaterThan(8)
  })
})
