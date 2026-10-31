import { describe, expect, test } from "bun:test"
import { 去Markdown, 渲染Markdown } from "./markdown"

/**
 * 资产 Markdown（2026-10-31）。
 *
 * ⚠️ 文件名是 `.test.tsx` 而不是简报里的 `.test.ts`：被测模块 `markdown.tsx` 里有 JSX，
 * 而 `test:unit` 只 preload 了 `happydom.ts`、**没有** `solid-jsx.ts`（见 `package.json`
 * 的脚本）。本机实测（2026-10-31）`.ts` 用例 import 任何 `.tsx` 模块都会在模块加载期报
 * `Export named 'jsxDEV' not found in solid-js/dist/solid.js`——那是编译产物的问题，不是
 * 用例的断言。`.test.tsx` 走 `test:components`（preload 了 `solid-jsx.ts`），同一批断言照跑。
 *
 * 断言纪律：一条输入只喂一个被禁标签（happy-dom 的 `NodeIterator` 会停摆，见
 * `center/views/richtext-view.tsx` 里那段注释）；「元素不存在」用布尔式，不用 `toBeNull()`
 * （`#009-01`）。
 */
describe("渲染Markdown", () => {
  test("# 标题 ⇒ 出 <h1>", () => {
    expect(渲染Markdown("# 标题")).toContain("<h1")
  })

  test("**粗体** ⇒ 出 <strong>", () => {
    expect(渲染Markdown("**粗**")).toContain("<strong")
  })

  test("<script> 整段被净化掉", () => {
    const 净 = 渲染Markdown("<script>alert(1)</script>")
    expect(净.includes("<script")).toBe(false)
  })

  test("<img> 上的 onerror 被摘掉（raw HTML 是不可信输入）", () => {
    const 净 = 渲染Markdown("<img src=x onerror=alert(1)>")
    expect(净.includes("onerror")).toBe(false)
  })
})

describe("去Markdown（卡片两行预览用的近似实现）", () => {
  test("标题前缀", () => {
    expect(去Markdown("## 小标题")).toBe("小标题")
  })

  test("粗体", () => {
    expect(去Markdown("**加粗**")).toBe("加粗")
  })

  test("行内代码", () => {
    expect(去Markdown("运行 `bun test`")).toBe("运行 bun test")
  })

  test("列表前缀", () => {
    expect(去Markdown("- 一\n- 二")).toBe("一\n二")
  })

  test("链接 ⇒ 文字", () => {
    expect(去Markdown("[官网](https://example.com)")).toBe("官网")
  })

  test("图片 ⇒ alt", () => {
    expect(去Markdown("![示意图](a.png)")).toBe("示意图")
  })

  test("围栏代码块的 ``` 行去掉、内容留下", () => {
    expect(去Markdown("```\n代码\n```")).toBe("代码")
  })

  test("引用前缀", () => {
    expect(去Markdown("> 引用")).toBe("引用")
  })

  test("水平线整行去掉", () => {
    expect(去Markdown("---")).toBe("")
  })

  test("表格：分隔行去掉，竖线换成空格", () => {
    expect(去Markdown("| 项目 | 值 |\n| --- | --- |\n| 金额 | 100 |")).toBe("项目 值\n金额 100")
  })
})
