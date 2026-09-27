import { describe, expect, test } from "bun:test"
import { createViewRegistry, extensionOf } from "./view-registry"

describe("中栏内容视图注册表（FR-007 / FR-008）", () => {
  test("注册一个视图后，可按其扩展名查找到它", () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".docx"], component: view })

    expect(registry.resolve(".docx")).toBe(view)
  })

  test("一个视图可认领多个扩展名，都查到同一个组件（文档类 = .doc + .docx）", () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".doc", ".docx"], component: view })

    expect(registry.resolve(".doc")).toBe(view)
    expect(registry.resolve(".docx")).toBe(view)
  })

  test("查找不区分大小写：用户的 .DOCX 文件也要命中 .docx 的视图", () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".docx"], component: view })

    expect(registry.resolve(".DOCX")).toBe(view)
  })

  test("注册时扩展名写大写也等价", () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".DOCX"], component: view })

    expect(registry.resolve(".docx")).toBe(view)
  })

  test("同一扩展名被两个视图认领时抛错，不静默覆盖", () => {
    const registry = createViewRegistry()
    registry.register({ extensions: [".pdf"], component: () => null })

    expect(() => registry.register({ extensions: [".pdf"], component: () => null })).toThrow(".pdf")
  })

  test("同批注册中途冲突时整批不生效，不留半注册状态", () => {
    const registry = createViewRegistry()
    registry.register({ extensions: [".zip"], component: () => null })

    expect(() => registry.register({ extensions: [".tar", ".zip"], component: () => null })).toThrow()

    expect(registry.resolve(".tar")).toBeUndefined()
  })

  test("从文件路径取扩展名：带点、小写、取最后一个点之后（路径分隔符无关）", () => {
    expect(extensionOf("报告.docx")).toBe(".docx")
    expect(extensionOf("a/b/报告.DOCX")).toBe(".docx")
    expect(extensionOf("C:\\专案\\报告.docx")).toBe(".docx")
    expect(extensionOf("report.tar.gz")).toBe(".gz")
  })

  test("无点 / 纯 dotfile / 结尾是点时取不到扩展名（同 path.extname 语义）", () => {
    expect(extensionOf("Makefile")).toBeUndefined()
    expect(extensionOf(".gitignore")).toBeUndefined()
    expect(extensionOf("a/b/.gitignore")).toBeUndefined()
    expect(extensionOf("report.")).toBeUndefined()
    expect(extensionOf("")).toBeUndefined()
  })
})
