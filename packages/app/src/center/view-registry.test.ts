import { describe, expect, test } from "bun:test"
import { createViewRegistry, extensionOf, type ViewComponent, type ViewLoader } from "./view-registry"

/** 注册表的契约是**懒加载**：注册的是「怎么拿到组件」，不是组件本身。 */
const 懒加载 = (view: ViewComponent): ViewLoader => async () => view

describe("中栏内容视图注册表（FR-007 / FR-008）", () => {
  test("注册一个视图后，可按其扩展名查找到它", async () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".docx"], load: 懒加载(view) })

    expect(await registry.resolve(".docx")!()).toBe(view)
  })

  /**
   * 这条是本次改造的**理由本身**：docx-preview / pdfjs / xlsx 三个预览库都随视图组件静态 import
   * 的话，用户点开第一个文件之前它们就已经进了首屏。契约存 loader 不存组件，才谈得上按需加载。
   */
  test("解析出的是 loader 而不是组件：不调用它就不加载", async () => {
    const registry = createViewRegistry()
    const view = () => null
    let 加载次数 = 0

    registry.register({
      extensions: [".docx"],
      load: async () => {
        加载次数++
        return view
      },
    })

    expect(registry.resolve(".docx")).toBeInstanceOf(Function)
    expect(加载次数).toBe(0)

    expect(await registry.resolve(".docx")!()).toBe(view)
    expect(加载次数).toBe(1)
  })

  test("一个视图可认领多个扩展名，都查到同一个组件（文档类 = .doc + .docx）", async () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".doc", ".docx"], load: 懒加载(view) })

    expect(await registry.resolve(".doc")!()).toBe(view)
    expect(await registry.resolve(".docx")!()).toBe(view)
  })

  test("查找不区分大小写：用户的 .DOCX 文件也要命中 .docx 的视图", async () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".docx"], load: 懒加载(view) })

    expect(await registry.resolve(".DOCX")!()).toBe(view)
  })

  test("注册时扩展名写大写也等价", async () => {
    const registry = createViewRegistry()
    const view = () => null

    registry.register({ extensions: [".DOCX"], load: 懒加载(view) })

    expect(await registry.resolve(".docx")!()).toBe(view)
  })

  test("同一扩展名被两个视图认领时抛错，不静默覆盖", () => {
    const registry = createViewRegistry()
    registry.register({ extensions: [".pdf"], load: async () => () => null })

    expect(() => registry.register({ extensions: [".pdf"], load: async () => () => null })).toThrow(".pdf")
  })

  test("同批注册中途冲突时整批不生效，不留半注册状态", () => {
    const registry = createViewRegistry()
    registry.register({ extensions: [".zip"], load: async () => () => null })

    expect(() => registry.register({ extensions: [".tar", ".zip"], load: async () => () => null })).toThrow()

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
