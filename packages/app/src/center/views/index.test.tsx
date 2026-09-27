import { describe, expect, test } from "bun:test"
import { viewRegistry } from "./index"
import { DocumentView } from "./document-view"
import { PdfView } from "./pdf-view"

describe("应用级视图注册表（FR-007 的 10 类里 001 认领的两类）", () => {
  test(".doc / .docx 归 Word 预览", () => {
    expect(viewRegistry.resolve(".doc")).toBe(DocumentView)
    expect(viewRegistry.resolve(".docx")).toBe(DocumentView)
  })

  test(".pdf 归 PDF 预览", () => {
    expect(viewRegistry.resolve(".pdf")).toBe(PdfView)
  })

  test("扩展名大小写不敏感（民警的文件名常是 .DOCX）", () => {
    expect(viewRegistry.resolve(".DOCX")).toBe(DocumentView)
    expect(viewRegistry.resolve(".Pdf")).toBe(PdfView)
  })

  /** 守卫：未认领的扩展名**不兜底**——降级呈现是 T015 的显式职责，不是注册表静默塞个默认视图。 */
  test("没认领的扩展名解析不到（T013/T014 的格式此刻都不该有归属）", () => {
    expect(viewRegistry.resolve(".xlsx")).toBeUndefined()
    expect(viewRegistry.resolve(".png")).toBeUndefined()
    expect(viewRegistry.resolve(".dat")).toBeUndefined()
  })
})
