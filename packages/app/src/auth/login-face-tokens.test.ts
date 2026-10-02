/**
 * 登录页是**固定深色面**，所以它引用的颜色 token 必须**不随配色方案翻转**（审查 R-07，2026-10-02）。
 *
 * 为什么这条判据成立：DESIGN §6.1 的登录门面是「深色做门面」，它的底色走
 * `--v2-brand-login-surface`——那是个**品牌**槽位，不是语义槽位，`theme.css` 里就只有一份
 * `#0F172A`，**刻意不跟着明暗方案漂**（§6.2：进主界面后固定暖白，暗色块不参与换皮）。
 * 表面不漂，那画在它上面的字也不能漂：一旦某一侧的 token 在另一个方案下换成深色，
 * 就是深色画在深色上。这正是被修掉的那条：
 * `--v2-text-text-inverse` 浅色 = `--v2-grey-50`（近白），深色 = `--v2-grey-1100`（近黑），
 * 而它当时被用在品牌名上——换到深色方案就是 `#161616` 画在 `#0F172A` 上，约 **1.01:1**，肉眼不可见。
 * （色值取自 `packages/ui/src/v2/styles/colors.css` 的 `--v2-grey-1100`；`#242424` 是同一段里
 * `--v2-grey-1000` 的值，本注释原先写错成了它——复查 R2-04 改正。）
 *
 * ⚠️ **射程据实**：DESIGN §6.2 说 openhive **不启用暗色模式**（主界面固定浅色），所以今天
 * 页面上看不见这个缺陷——它是一条**潜伏**的错配（R-18「暗色模式未强制执行」是同一件事的另一面）。
 * 修它、并钉住这条判据，理由不是「现在已经坏了」，而是：这个面的**表面那一侧**是刻意不漂的，
 * 文字那一侧漂了就没道理；且两处都是同一个语义名下的近亲，改错了构建 / 类型 / 既有测试**全绿**。
 *
 * ⚠️ **只管我们自己写的这个文件**，不含它渲染出来的 `<Field>` / `<TextInputV2>` / `<ButtonV2>`
 * ——那些在 `packages/ui`，是上游组件，它们引用的语义 token 本就该随方案走（那部分不归本文件管）。
 *
 * ⚠️ **比的是声明，不是浏览器算出来的色**：`var(--v2-grey-50)` 与 `var(--v2-grey-1100)` 是两个
 * 不同的声明，作为「会不会漂」的判据已经够用。真算色要跑 CSS 引擎——本文件不做，理由同
 * `workspace/design-token-refs.test.ts`（那个文件管「名字存不存在」，本文件管「值漂不漂」）。
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const 仓库根 = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..")

const 读 = (相对路径: string) => readFileSync(join(仓库根, 相对路径), "utf8")

/**
 * 抠出一个 `选择器 { … }` 块里的 `--v2-x: 值` 声明表。
 *
 * 用**花括号配对**而不是正则到行尾：块里既有嵌套也有注释，正则抠不出边界。
 * 选择器找不到就抛——它改名了本文件必须跟着改，不能静默变成「什么都没扫到」。
 */
function 块(css: string, 选择器: string): Record<string, string> {
  const 头 = css.indexOf(`${选择器} {`)
  if (头 < 0) throw new Error(`CSS 里找不到选择器「${选择器}」——选择器改名了就得同步改本文件`)

  const 起 = css.indexOf("{", 头)
  let 深度 = 0
  let 尾 = css.length
  for (let i = 起; i < css.length; i++) {
    if (css[i] === "{") 深度++
    else if (css[i] === "}" && --深度 === 0) {
      尾 = i
      break
    }
  }

  // 块体里的注释一并去掉：注释里也会出现 `--v2-x: 值` 这种举例写法。
  const 体 = css.slice(起 + 1, 尾).replace(/\/\*[\s\S]*?\*\//g, "")
  const 表: Record<string, string> = {}
  for (const m of 体.matchAll(/--(v2-[a-z0-9]+(?:-[a-z0-9]+)*)\s*:\s*([^;]+);/g)) 表[m[1]] = m[2].trim()
  return 表
}

/**
 * 主题的三处载体（`LEARNINGS #001-04`）。按方案取值时的**优先级就是层叠的优先级**：
 * `oc-2.json` 的 `v2Overrides` 被 `ThemeProvider` 写进一个**不带 `@layer`** 的 `<style id="oc-theme">`，
 * 压过 `@layer theme` 里的同名变量；静态那一层再分「方案块」与「`:root` 兜底」。
 */
const oc2: { light: { v2Overrides: Record<string, string> }; dark: { v2Overrides: Record<string, string> } } =
  JSON.parse(读("packages/ui/src/theme/themes/oc-2.json"))

const 静态 = {
  // 原语（`--v2-grey-*` / `--v2-alpha-*` / `--v2-red-*` …）只在 `colors.css` 的 `:root` 里定义**一次**，
  // 不随方案走；主题的 `:root` 覆盖在它上面（与 `design-token-refs.test.ts` 同两个来源）。
  通用: { ...块(读("packages/ui/src/v2/styles/colors.css"), ":root"), ...块(读("packages/ui/src/v2/styles/theme.css"), ":root") },
  浅色: 块(读("packages/ui/src/v2/styles/theme.css"), '[data-color-scheme="light"]'),
  深色: 块(读("packages/ui/src/v2/styles/theme.css"), '[data-color-scheme="dark"]'),
}

/** 某 token 在某方案下**最终**的值：主题覆盖 → 该方案的静态块 → `:root` 兜底。 */
function 解(方案: "light" | "dark", 名: string): string | undefined {
  return oc2[方案].v2Overrides[名] ?? (方案 === "light" ? 静态.浅色[名] : 静态.深色[名]) ?? 静态.通用[名]
}

/**
 * 两个抓法**与 `design-token-refs.test.ts` 同款**（`var(--v2-x)` 与 Tailwind 颜色工具类）。
 * 那边管「名字有没有定义」，这边管「值漂不漂」，是同一批 token 的两个不同问题。
 */
const 名 = String.raw`v2-[a-z0-9]+(?:-[a-z0-9]+)*`
const 变量引用 = new RegExp(String.raw`var\(--(${名})\)`, "g")
const 工具类引用 = new RegExp(
  String.raw`(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|outline|divide|from|via|to|decoration|placeholder|caret|accent|shadow)-(${名})(?![\w-])`,
  "g",
)

/**
 * ⚠️ **去注释再扫**不是洁癖：这个文件头的注释里就写着 `shadow-[var(--v2-elevation-floating)]` 这类
 * 举例，留着会把**根本没被使用**的 token 算进来——而 `--v2-elevation-*` 恰恰是随方案漂的
 * （阴影值本来就要跟着明暗换）。一份红在假阳性上的测试等于没有测试。
 */
const 源码 = 读("packages/app/src/auth/login-page.tsx").replace(/\/\*[\s\S]*?\*\//g, "")

const 用在登录页的 = [
  ...new Set(
    [变量引用, 工具类引用].flatMap((正则) => [...源码.matchAll(new RegExp(正则.source, 正则.flags))].map((m) => m[1])),
  ),
].sort()

describe("登录页（固定深色面）：颜色 token 不随配色方案翻转", () => {
  test(`${用在登录页的.length} 个 token 在 light / dark 两套里同值`, () => {
    const 漂的 = 用在登录页的
      .filter((t) => 解("light", t) !== 解("dark", t))
      .map((t) => `${t}：light = ${JSON.stringify(解("light", t))} / dark = ${JSON.stringify(解("dark", t))}`)

    expect(漂的).toEqual([])
  })

  // ── 下面两条都是**元断言**：上一条在「什么都没扫到」或「名字拼错解不出来」时**也会绿**。
  //    「全都对」与「压根没查」是两件事，少了这两条，上一条随时会退化成一句废话。
  test("确实扫到了东西（防空转）", () => {
    expect(用在登录页的.length).toBeGreaterThan(3)
  })

  test("每个 token 都解得出来（拼错名字会静默变成「两边都 undefined，所以一样」）", () => {
    expect(用在登录页的.filter((t) => 解("light", t) === undefined)).toEqual([])
  })
})
