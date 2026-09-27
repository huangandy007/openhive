import { createViewRegistry, type ViewRegistry } from "@/center/view-registry"

/**
 * 应用级视图注册表实例（FR-007 / FR-008 的落点）。
 *
 * 放在这里而不是 `view-registry.ts`：那里是**机制**（一张空的扩展名 → 视图的映射），
 * 这里是**本应用注册了哪些**——机制不该知道 Word 和 PDF 的存在，否则新增格式就得改机制。
 *
 * T004 当时故意没导出单例（「此刻无消费者，Simplicity First」）；001 的首个真实视图
 * （T012）到此认领它。**注入**给中栏而非被中栏 import：测试各用各的注册表，互不串味。
 * 数据轴（F6/F7）的视图将来同样在此登记。
 */
export const viewRegistry: ViewRegistry = createViewRegistry()

// FR-007「日常办公常见的 10 类文件」——001（T012–T014）认领其中几类：
// ① 文档 .doc/.docx（T012） ② 表格 .xls/.xlsx/.csv（T013） ④ PDF（T012）
// ③ 演示 .ppt/.pptx、⑤ 图片、⑥ 图文、⑦ 思维导图（T014）
//
// 一律注册成**动态** import 的 loader（`load:` 而不是组件本身）：三个预览库实测合计 976 kB
// （gzip 306 kB），静态引进来就等于让民警「点开第一个文件之前」先把 Word、PDF、表格三套渲染器
// 全下载完。写成 loader 后它们各自成 chunk（174 / 366 / 436 kB），只有真的打开那一类文件才会去拉。
// ⚠️ 别在这里改回静态 import —— `index.test.tsx` 里有一条守卫盯着这件事（它读本文件源码）。
viewRegistry.register({
  extensions: [".doc", ".docx"],
  load: async () => (await import("./document-view")).DocumentView,
})
viewRegistry.register({
  extensions: [".xls", ".xlsx", ".csv"],
  load: async () => (await import("./sheet-view")).SheetView,
})
viewRegistry.register({
  extensions: [".pdf"],
  load: async () => (await import("./pdf-view")).PdfView,
})
