import { describe, expect, test } from "bun:test"
import { 包裹, 切行首, 插入代码块, 插入分隔线, 插入表格, 插入引用 } from "./markdown-actions"

const 选 = (value: string, start: number, end = start) => ({ value, start, end })

describe("行内包裹", () => {
  test("粗体：包住选区，整段仍被选中", () => {
    expect(包裹(选("第一行", 0, 3), "bold")).toEqual({ value: "**第一行**", start: 2, end: 5 })
  })

  test("粗体：再按一次拆掉（选区落回原文）", () => {
    expect(包裹(选("**第一行**", 2, 5), "bold")).toEqual({ value: "第一行", start: 0, end: 3 })
  })

  test("空选区：光标落在两个标记中间", () => {
    expect(包裹(选("甲乙", 1), "italic")).toEqual({ value: "甲**乙", start: 2, end: 2 })
  })

  test("粗体里的选区按斜体，不会被当成已有斜体拆掉", () => {
    // `**粗**` 里选中 `粗`：外侧的单星号属于粗体标记，不是斜体。
    expect(包裹(选("**粗**", 2, 3), "italic")).toEqual({ value: "***粗***", start: 3, end: 4 })
  })

  test("删除线与行内代码", () => {
    expect(包裹(选("划掉", 0, 2), "strike")).toEqual({ value: "~~划掉~~", start: 2, end: 4 })
    expect(包裹(选("code", 0, 4), "code")).toEqual({ value: "`code`", start: 1, end: 5 })
  })

  test("链接：有选区时选中 url 占位符", () => {
    expect(包裹(选("看这里", 0, 3), "link")).toEqual({ value: "[看这里](url)", start: 6, end: 9 })
  })

  test("链接：空选区插入 []()，光标在方括号中间", () => {
    expect(包裹(选("甲乙", 1), "link")).toEqual({ value: "甲[](url)乙", start: 2, end: 2 })
  })
})

describe("行前缀", () => {
  test("标题：加级别、换级别、同级再按取消", () => {
    expect(切行首(选("标题", 0), "h1")).toEqual({ value: "# 标题", start: 0, end: 4 })
    expect(切行首(选("# 标题", 0), "h3")).toEqual({ value: "### 标题", start: 0, end: 6 })
    expect(切行首(选("### 标题", 0), "h3")).toEqual({ value: "标题", start: 0, end: 2 })
  })

  test("无序列表：加、取消、从有序转过来", () => {
    expect(切行首(选("一", 0), "ul")).toEqual({ value: "- 一", start: 0, end: 3 })
    expect(切行首(选("- 一", 0), "ul")).toEqual({ value: "一", start: 0, end: 1 })
    expect(切行首(选("1. 一", 0), "ul")).toEqual({ value: "- 一", start: 0, end: 3 })
  })

  test("有序列表：从无序转过来并重新编号", () => {
    expect(切行首(选("- 一\n- 二", 0, 7), "ol")).toEqual({
      value: "1. 一\n2. 二",
      start: 0,
      end: 9,
    })
  })

  test("多行选区逐行加前缀；空行不留下 `- ` / `> `", () => {
    expect(切行首(选("一\n\n二", 0, 4), "ul")).toEqual({ value: "- 一\n\n- 二", start: 0, end: 8 })
  })

  test("CRLF 不丢", () => {
    expect(切行首(选("一\r\n二", 0, 4), "quote")).toEqual({ value: "> 一\r\n> 二", start: 0, end: 8 })
  })

  test("引用：再按一次取消", () => {
    expect(切行首(选("> 一", 0), "quote")).toEqual({ value: "一", start: 0, end: 1 })
  })
})

describe("插入块", () => {
  test("分隔线：前后补空行，光标落到块后", () => {
    expect(插入分隔线(选("甲", 1))).toEqual({ value: "甲\n\n---", start: 6, end: 6 })
  })

  test("代码块：空选区插入围栏，光标在中间", () => {
    expect(插入代码块(选("甲", 1))).toEqual({ value: "甲\n```\n\n```", start: 6, end: 6 })
  })

  test("代码块：有选区时包住原文，原文仍被选中", () => {
    expect(插入代码块(选("甲\n乙", 2, 3))).toEqual({ value: "甲\n```\n乙\n```", start: 6, end: 7 })
  })

  test("表格：插入两列表头，并选中「列1」", () => {
    const 结论 = 插入表格(选("", 0))
    expect(结论.value).toBe("| 列1 | 列2 |\n| --- | --- |\n|  |  |")
    expect(结论.value.slice(结论.start, 结论.end)).toBe("列1")
  })

  test("图片：alt 去掉扩展名；路径有空格时尖括号包住", () => {
    expect(插入引用(选("", 0), "image", "卷宗/附件/图 1.png")).toEqual({
      value: "![图 1](<卷宗/附件/图 1.png>)",
      start: 23,
      end: 23,
    })
  })

  test("附件：alt 用文件名；有选区时用选中文字", () => {
    expect(插入引用(选("", 0), "attachment", "卷宗/名单.pdf")).toEqual({
      value: "[名单.pdf](卷宗/名单.pdf)",
      start: 19,
      end: 19,
    })
    expect(插入引用(选("名单", 0, 2), "attachment", "卷宗/名单.pdf").value).toBe("[名单](卷宗/名单.pdf)")
  })
})
