import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { viewRegistry } from "./index"

/**
 * 注册表存的是 loader 不是组件，所以断言分两步：先取到 loader，再**调用**它。
 * 顺带这也钉住「注册表里没有视图组件本身的引用」——想绕开懒加载直接塞组件是塞不进去的。
 */
async function 解出(extension: string) {
  const load = viewRegistry.resolve(extension)
  // 分开抛：失败信息能直接说清是「压根没认领」还是「注册了但解不出组件」。
  if (!load) throw new Error(`没认领的扩展名：${extension}`)
  return load()
}

describe("应用级视图注册表（FR-007 的 10 类里 001 认领的几类）", () => {
  test(".doc / .docx 归 Word 预览", async () => {
    const { DocumentView } = await import("./document-view")
    expect(await 解出(".doc")).toBe(DocumentView)
    expect(await 解出(".docx")).toBe(DocumentView)
  })

  test(".pdf 归 PDF 预览", async () => {
    const { PdfView } = await import("./pdf-view")
    expect(await 解出(".pdf")).toBe(PdfView)
  })

  /** `.csv` 一并归表格：10 类的「表格」一项写的就是 `.xls/.xlsx/.csv`（spec 修订记录 2026-09-27b）。 */
  test(".xls / .xlsx / .csv 归表格视图", async () => {
    const { SheetView } = await import("./sheet-view")
    expect(await 解出(".xls")).toBe(SheetView)
    expect(await 解出(".xlsx")).toBe(SheetView)
    expect(await 解出(".csv")).toBe(SheetView)
  })

  test(".png / .jpg / .jpeg / .gif / .bmp / .webp 归图片预览", async () => {
    const { ImageView } = await import("./image-view")
    for (const 名 of [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]) {
      expect(await 解出(名)).toBe(ImageView)
    }
  })

  test(".md / .txt 归图文视图（`.rtf` 本轮不做，回落 T015 的未知扩展名降级）", async () => {
    const { RichtextView } = await import("./richtext-view")
    expect(await 解出(".md")).toBe(RichtextView)
    expect(await 解出(".txt")).toBe(RichtextView)
    expect(viewRegistry.resolve(".rtf")).toBeUndefined()
  })

  test(".xmind 归思维导图（design-v2 待决策点 #5 的落定，2026-09-27c）", async () => {
    const { MindmapView } = await import("./mindmap-view")
    expect(await 解出(".xmind")).toBe(MindmapView)
  })

  test("扩展名大小写不敏感（民警的文件名常是 .DOCX）", async () => {
    const [{ DocumentView }, { PdfView }, { SheetView }, { ImageView }] = await Promise.all([
      import("./document-view"),
      import("./pdf-view"),
      import("./sheet-view"),
      import("./image-view"),
    ])
    expect(await 解出(".DOCX")).toBe(DocumentView)
    expect(await 解出(".Pdf")).toBe(PdfView)
    expect(await 解出(".XLSX")).toBe(SheetView)
    expect(await 解出(".JPEG")).toBe(ImageView)
  })

  /** 代码不是「预览视图」而是 FR-009 的**可选工作区**：认领它只为给出「要看时才打开」的入口。 */
  test(".ts / .json 这类代码文件归代码视图（T016）", async () => {
    const { CodeView } = await import("./code-view")
    expect(await 解出(".ts")).toBe(CodeView)
    expect(await 解出(".json")).toBe(CodeView)
    // 认领的是一整类（源码 / 脚本 / 配置），不只样例这两个；大小写同样不敏感
    expect(await 解出(".SQL")).toBe(CodeView)
    expect(await 解出(".Yaml")).toBe(CodeView)
  })

  /** 守卫：未认领的扩展名**不兜底**——降级呈现是 T015 的显式职责，不是注册表静默塞个默认视图。 */
  test("没认领的扩展名解析不到（T018 的 .pptx 与压缩包此刻都不该有归属）", () => {
    expect(viewRegistry.resolve(".pptx")).toBeUndefined()
    expect(viewRegistry.resolve(".dat")).toBeUndefined()
    expect(viewRegistry.resolve(".zip")).toBeUndefined()
  })

  /**
   * 这条不是 DOM 断言，而是**守住懒加载本身**。三个预览库（docx-preview / pdfjs / xlsx）都是
   * 兆字节级，只要本文件里出现一行静态 `import ... from "./xxx-view"`，它们就悄悄回到首屏——
   * 而上面那些功能测试**全绿，看不出来**。首屏体积在单元测试里没有别的可观测面，所以直接读源码。
   */
  test("首屏不带三个预览库：视图模块只许动态 import", () => {
    const 源码 = readFileSync(`${import.meta.dir}/index.ts`, "utf8")

    expect(源码).not.toMatch(/^import\s[^\n]*from\s+["']\.\/[\w-]+-view["']/m)
    expect(源码).toMatch(/import\(["']\.\/[\w-]+-view["']\)/)
  })
})
