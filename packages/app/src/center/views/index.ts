import { createViewRegistry, type ViewRegistry } from "@/center/view-registry"
import {
  代码扩展名,
  关系图扩展名,
  图片扩展名,
  图文扩展名,
  思维导图扩展名,
  文档扩展名,
  表格扩展名,
  PDF扩展名,
  网页扩展名,
} from "../file-type-extensions"

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
// ⑤ 图片、⑥ 图文 .md/.txt、⑦ 思维导图 .xmind（T014）；③ 演示 .ppt/.pptx 为 T018（方案未定）
//
// 另有第 11 行「代码」——design-v2 §9.1 的内容类型表把它单列，且 FR-009 明确要求它
// **降级为可选工作区**：故它不是一个「预览视图」，而是 T016 的代码视图（默认不打开编辑器）。
//
// 各类型的扩展名数组**不在本文件**：单一出处是 `../file-type-extensions.ts`（013 · T2），
// 新建文件清单（`project/file-create-catalog.ts`）认的是同一份。本文件只负责登记 loader。
//
// 一律注册成**动态** import 的 loader（`load:` 而不是组件本身）：三个预览库实测合计 976 kB
// （gzip 306 kB），静态引进来就等于让民警「点开第一个文件之前」先把 Word、PDF、表格三套渲染器
// 全下载完。写成 loader 后它们各自成 chunk（174 / 366 / 436 kB），只有真的打开那一类文件才会去拉。
// ⚠️ 别在这里改回静态 import —— `index.test.tsx` 里有一条守卫盯着这件事（它读本文件源码）。
viewRegistry.register({
  extensions: 文档扩展名,
  load: async () => (await import("./document-view")).DocumentView,
})
viewRegistry.register({
  extensions: 表格扩展名,
  load: async () => (await import("./sheet-view")).SheetView,
})
viewRegistry.register({
  extensions: PDF扩展名,
  load: async () => (await import("./pdf-view")).PdfView,
})
viewRegistry.register({
  extensions: 图片扩展名,
  load: async () => (await import("./image-view")).ImageView,
})
viewRegistry.register({
  extensions: 图文扩展名,
  load: async () => (await import("./richtext-view")).RichtextView,
})
viewRegistry.register({
  extensions: 思维导图扩展名,
  load: async () => (await import("./mindmap-view")).MindmapView,
})

/**
 * 关系图（012 · T007）。`.hgraph` 是**文件视图**（有写口，写走 `hgraph-api` 的 `ops`），
 * 不是 `case://` 数据轴视图——故注册在扩展名表里，不走 `case-view.tsx`。
 * 本轮只做「打开通道」，画布/编辑器是 T009/T010。
 */
viewRegistry.register({
  extensions: 关系图扩展名,
  load: async () => (await import("./hgraph-view")).HgraphView,
})

viewRegistry.register({
  extensions: 网页扩展名,
  load: async () => (await import("./html-view")).HtmlView,
})

viewRegistry.register({
  extensions: 代码扩展名,
  load: async () => (await import("./code-view")).CodeView,
})
