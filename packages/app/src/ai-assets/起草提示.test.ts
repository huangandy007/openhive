import { describe, expect, test } from "bun:test"
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
})

describe("提取正文", () => {
  test("有围栏 ⇒ 取围栏块里的内容（围栏后可带语言名）", () => {
    expect(提取正文("这是说明\n```markdown\n# 标题\n正文\n```\n后面还有话")).toBe("# 标题\n正文")
  })

  test("无围栏 ⇒ 整段 trim", () => {
    expect(提取正文("  正文  \n")).toBe("正文")
  })

  test("围栏未闭合 ⇒ 回退整段 trim", () => {
    expect(提取正文("```\n没闭合")).toBe("```\n没闭合")
  })

  test("空回复 / 只有围栏没有内容 ⇒ 空串", () => {
    expect(提取正文("")).toBe("")
    expect(提取正文("   \n")).toBe("")
    expect(提取正文("```\n\n```")).toBe("")
  })
})
