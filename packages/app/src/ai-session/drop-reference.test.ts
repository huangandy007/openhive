import { describe, expect, test } from "bun:test"
import { 拖入正文, 拖入路径 } from "./drop-reference"

/**
 * 拖进右栏会话框的「文件 / 文件夹路径引用」——纯判据（005 · 2026-10-13 用户提出）。
 *
 * 载荷格式 `file:<路径>` 是**上游已有的记号**（`components/file-tree.tsx` /
 * `file-tree-v2.tsx`），本仓 `project/dual-file-tree.tsx` 的起拖照抄同一形状。
 */
describe("拖入载荷 ⇒ 路径引用", () => {
  test("文件行：去掉 `file:` 前缀就得到路径", () => {
    expect(拖入路径("file:报告.docx")).toBe("报告.docx")
  })

  test("文件夹行：尾斜杠是引用的一部分，别吃掉", () => {
    // 起拖时给目录补的尾斜杠，是「这是个文件夹」的记号（同上游 `x-directory`）——
    // 吃掉了它就等于把一个文件夹说成一个文件。
    expect(拖入路径("file:资金流水/")).toBe("资金流水/")
  })

  test("不是 `file:` 载荷（从别处拖来的普通文字）⇒ 不认", () => {
    expect(拖入路径("报告.docx")).toBeUndefined()
  })

  test("载荷缺失（没有 dataTransfer）⇒ 不认", () => {
    expect(拖入路径(undefined)).toBeUndefined()
  })

  test("只有前缀、没有路径 ⇒ 不认（空引用等于什么都没拖）", () => {
    expect(拖入路径("file:")).toBeUndefined()
  })
})

describe("拖入正文：不是文件引用、但有内容的那一段", () => {
  test("表格拖选出来的制表符文本 ⇒ 原样交回（含换行）", () => {
    expect(拖入正文("张三\t1200\r\n李四\t880\r\n")).toBe("张三\t1200\r\n李四\t880\r\n")
  })

  test("普通一句话 ⇒ 交回", () => {
    expect(拖入正文("把这段问问")).toBe("把这段问问")
  })

  // 与 `拖入路径` 互斥：`file:` 那一路归它，这一路**不认**
  test("`file:` 引用不认（那是 `拖入路径` 的活）", () => {
    expect(拖入正文("file:报告.docx")).toBeUndefined()
  })

  test("没有载荷 / 空串 / 只有空白 ⇒ 不认", () => {
    expect(拖入正文(undefined)).toBeUndefined()
    expect(拖入正文("")).toBeUndefined()
    expect(拖入正文("   \r\n\t ")).toBeUndefined()
  })
})
