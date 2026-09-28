import { describe, expect, test } from "bun:test"

/**
 * 换皮的**落点守卫**（T017）。
 *
 * 运行时真正生效的 v2 变量不是 `v2/styles/theme.css` 里那份。`ThemeProvider` 会把
 * `themes/oc-2.json` 的 `v2Overrides` 写进一个**没有 `@layer` 包裹**的 `<style id="oc-theme">`，
 * 而 `theme.css` 整体在 `@layer theme { … }` 里。按层叠规则**无层级样式压过任何层级**（与加载
 * 顺序无关），所以：**改了 `theme.css` 却没重新生成 `oc-2.json`，换皮是静默失效的。**
 *
 * 而 `oc-2.json` 由 `script/build-oc2-v2-overrides.ts` 从 `theme.css` 的 `:root` 生成
 * （脚本把 `:root` 当作 light 的源）——于是品牌色的真相链是三段：
 *
 *   ① `theme.css` 的 `:root`               —— 上游源文件，生成器的输入
 *   ② `theme.css` 的 `[data-color-scheme="light"]` —— 静态 CSS 路径（非 app 环境仍走它）
 *   ③ `oc-2.json` 的 `light.v2Overrides`   —— 运行时真正的载体
 *
 * 任务里写的是「① ② 两处同改」，③ 是查证后补上的第三处。本文件把三处钉在一起：漏改任意一处
 * 或把它改回蓝色，这里就红。
 */

const 主题CSS = await Bun.file(new URL("../v2/styles/theme.css", import.meta.url)).text()
const OC2: { light: { v2Overrides: Record<string, string> } } = await Bun.file(
  new URL("./themes/oc-2.json", import.meta.url),
).json()

/** 抠出某个选择器的声明块。与生成器同款写法（`… {\n … \n  }`），免得两处口径漂移。 */
function 取块(css: string, 选择器正则: string) {
  const 块 = css.match(new RegExp(`\\n\\s*${选择器正则} \\{([\\s\\S]*?)\\n\\s*\\}`))?.[1]
  if (块 === undefined) throw new Error(`theme.css 里找不到 ${选择器正则} 块`)
  return 块
}

const 变量值 = (块: string, 名: string) => 块.match(new RegExp(`--${名}:\\s*([^;]+);`))?.[1]?.trim()

const 根块 = 取块(主题CSS, ":root")
const 浅色块 = 取块(主题CSS, '\\[data-color-scheme="light"\\]')

/** DESIGN.md §1.1 品牌金三档。 */
const 品牌金 = {
  "v2-brand-gold-light": "#F59E0B",
  "v2-brand-gold": "#D97706",
  "v2-brand-gold-deep": "#B45309",
}

/**
 * DESIGN.md §1（暖白 / 暖黑 / 去蓝）+ plan.md 的 v2 语义 token 映射表。
 *
 * 值写成 `var(--v2-brand-gold)` 而不是重复 hex：品牌金只在「品牌金三档」里定义一次，
 * 语义层引用它——这样改品牌色是改一行，不是改八行。
 */
const 语义换皮 = {
  "v2-background-bg-base": "#FCFCFC", // §1.2 暖白
  "v2-background-bg-accent": "var(--v2-brand-gold)", // §1.1 主金：tab 激活顶边
  "v2-background-bg-accent-soft": "#FEF3C7", // §1.3 选中态浅金
  "v2-text-text-base": "#1C1A18", // §1.2 暖黑
  "v2-text-text-accent": "var(--v2-brand-gold)", // §1.1 主金：链接 / 高亮
  "v2-text-text-accent-hover": "var(--v2-brand-gold-deep)", // §1.1 深金：hover 加深
  "v2-icon-icon-accent": "var(--v2-brand-gold)", // §1.1 主金：图标 / logo 描边
  "v2-icon-icon-accent-hover": "var(--v2-brand-gold-deep)",
  "v2-border-border-focus": "var(--v2-brand-gold)", // 琥珀焦点环（plan.md ②）
}

const 全部 = { ...品牌金, ...语义换皮 }

describe("品牌色换皮：三处载体一致（T017）", () => {
  for (const [名, 期望] of Object.entries(全部)) {
    test(`${名} = ${期望}（:root / light 块 / oc-2.json 三处一致）`, () => {
      expect(变量值(根块, 名)).toBe(期望)
      expect(变量值(浅色块, 名)).toBe(期望)
      // ③ 运行时载体：oc-2.json 的 key 不带 `--` 前缀
      expect(OC2.light.v2Overrides[名]).toBe(期望)
    })
  }

  test("蓝色强调色已经清干净：浅色块里不再有 blue 出现在 accent / focus 槽位", () => {
    for (const 名 of ["v2-background-bg-accent", "v2-text-text-accent", "v2-icon-icon-accent", "v2-border-border-focus"]) {
      expect(变量值(浅色块, 名) ?? "").not.toContain("blue")
    }
  })
})

describe("字体栈：内网零加载（DESIGN §2.1）", () => {
  test("sans 栈是系统字体（PingFang SC / Microsoft YaHei），不再是 Inter", () => {
    const 栈 = 变量值(根块, "v2-font-family-sans") ?? ""

    expect(栈).toContain("PingFang SC")
    expect(栈).toContain("Microsoft YaHei")
    expect(栈).not.toContain("Inter")
  })

  test("字体不在 oc-2.json 里（生成器刻意滤掉字体与 avatar-fg）——故 theme.css 一处改动即生效", () => {
    expect(OC2.light.v2Overrides["v2-font-family-sans"]).toBeUndefined()
  })
})

describe("换皮的既有边界：原语色阶与暗色块不动（DESIGN §6.2 / 任务约束）", () => {
  test("原语色阶仍是上游中性灰/蓝，没有被就地改成金色（绝不手改原语）", async () => {
    const 原语 = await Bun.file(new URL("../v2/styles/colors.css", import.meta.url)).text()

    expect(原语).toContain("--v2-grey-50: #ffffffff")
    expect(原语).toContain("--v2-blue-600: #")
  })

  test("暗色块不参与换皮：dark 块里 accent 仍是 blue（§6.2 只改 light 一套）", () => {
    const 暗块 = 取块(主题CSS, '\\[data-color-scheme="dark"\\]')

    expect(变量值(暗块, "v2-icon-icon-accent")).toContain("blue")
  })
})
