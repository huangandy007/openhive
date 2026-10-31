import { describe, expect, test } from "bun:test"
import { 行数上界 } from "@/ai-session/send-to-session"
import { 提取正文, 构造起草提示 } from "./起草提示"

const 提示 = (over: Partial<Parameters<typeof 构造起草提示>[0]> = {}) =>
  构造起草提示({ 名称: "资金流向研判", 字段: "description", 上限: 2000, 现有: "", markdown: true, ...over })

describe("构造起草提示", () => {
  test("指名资产名、字段中文名与字数上限", () => {
    const 结果 = 提示()
    expect(结果).toContain("资金流向研判")
    expect(结果).toContain("介绍")
    expect(结果).toContain("2000")
  })

  test("功能描述：定位是「一句话 / 悬停」", () => {
    const 结果 = 提示({ 字段: "summary", 上限: 200, markdown: false })
    expect(结果).toContain("功能描述")
    expect(结果).toContain("200")
    expect(结果).toContain("一句话")
    expect(结果).toContain("悬停")
  })

  test("注意事项：只写资产专属的，产品级「人工复核」不归它写", () => {
    const 结果 = 提示({ 字段: "precautions", 上限: 1000, markdown: true })
    expect(结果).toContain("注意事项")
    expect(结果).toContain("1000")
    expect(结果).toContain("人工复核")
  })

  test("三个字段的措辞互不相同（不是同一个模板换个名字）", () => {
    const 介绍 = 提示()
    const 功能 = 提示({ 字段: "summary", 上限: 200, markdown: false })
    const 注意 = 提示({ 字段: "precautions", 上限: 1000, markdown: true })
    expect(介绍).not.toBe(功能)
    expect(功能).not.toBe(注意)
    expect(介绍).not.toBe(注意)
  })

  test("markdown 字段要求用 Markdown；纯文本字段不要求", () => {
    expect(提示({ markdown: true })).toContain("Markdown")
    expect(提示({ 字段: "summary", 上限: 200, markdown: false })).not.toContain("用 Markdown")
  })

  test("要求只输出正文并用 ``` 围栏包起来", () => {
    const 结果 = 提示()
    expect(结果).toContain("只输出正文")
    expect(结果).toContain("```")
  })

  test("现有为空 ⇒ 不出现「原内容」那句", () => {
    expect(提示({ 现有: "" })).not.toContain("原内容")
    expect(提示({ 现有: "   \n " })).not.toContain("原内容")
  })

  test("现有非空 ⇒ 附上现有内容，并要求在原内容基础上修订", () => {
    const 结果 = 提示({ 现有: "旧的介绍正文" })
    expect(结果).toContain("原内容")
    expect(结果).toContain("旧的介绍正文")
  })

  /**
   * 中栏 → 右栏一次最多 50 行（`send-to-session.ts` 的 `行数上界`）。原先把现有内容整段塞进去，
   * 「介绍」这种列表式 Markdown 一长就永远发不出去，还报「请少选点」——这个按钮上没有「选」
   * 这个动作（2026-10-31 复审 I-2）。
   */
  test("现有内容很长 ⇒ 按行数上限截断，指令整体不超过上界", () => {
    const 六十行 = Array.from({ length: 60 }, (_, i) => `第${i}行`).join("\n")
    const 结果 = 提示({ 现有: 六十行 })
    expect(结果.split("\n").length <= 行数上界).toBe(true)
    expect(结果).toContain("第0行")
    expect(结果).toContain("其余已省略")
    expect(结果.includes("第59行")).toBe(false)
  })

  // `数行` 按 `/\r\n|\r|\n/` 切：孤立 `\r`（老式 Mac 换行）也算一行。这里若按 `/\r?\n/` 算，
  // 预算会算少，实际行数照样撞上限。
  test("孤立 \\r 换行的现有内容同样按行数截断", () => {
    const 六十段 = Array.from({ length: 60 }, (_, i) => `第${i}行`).join("\r")
    const 结果 = 提示({ 现有: 六十段 })
    expect(结果.split(/\r\n|\r|\n/).length <= 行数上界).toBe(true)
    expect(结果).toContain("其余已省略")
  })
})

describe("提取正文", () => {
  test("有围栏 ⇒ 取围栏块里的内容（围栏后可带语言名）", () => {
    expect(提取正文("这是说明\n```markdown\n# 标题\n正文\n```\n后面还有话")).toBe("# 标题\n正文")
  })

  test("无围栏 ⇒ 整段 trim", () => {
    expect(提取正文("  正文  \n")).toBe("正文")
  })

  /**
   * 提示词明确要求 AI「用 Markdown 写（标题 / 粗体 / 列表 / **代码块**）」——正文里带代码块
   * 是预期之内的事。闭合围栏若取第一个 ```，代码块及其后的正文会被整段截掉
   * （探针实得 `"# 标题"`，2026-10-31 复审 I-1）。
   */
  test("围栏里的正文自己带代码块 ⇒ 不能截断", () => {
    const 回复 = "```markdown\n# 标题\n\n```ts\nconst a = 1\n```\n\n结尾\n```"
    expect(提取正文(回复)).toBe("# 标题\n\n```ts\nconst a = 1\n```\n\n结尾")
  })

  test("围栏未闭合 ⇒ 丢掉开头那行标记，正文照收", () => {
    expect(提取正文("```markdown\n正文没闭合")).toBe("正文没闭合")
  })

  test("空回复 / 只有围栏没有内容 ⇒ 空串", () => {
    expect(提取正文("")).toBe("")
    expect(提取正文("   \n")).toBe("")
    expect(提取正文("```\n\n```")).toBe("")
  })
})
