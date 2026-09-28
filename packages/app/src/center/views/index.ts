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
// ⑤ 图片、⑥ 图文 .md/.txt、⑦ 思维导图 .xmind（T014）；③ 演示 .ppt/.pptx 为 T018（方案未定）
//
// 另有第 11 行「代码」——design-v2 §9.1 的内容类型表把它单列，且 FR-009 明确要求它
// **降级为可选工作区**：故它不是一个「预览视图」，而是 T016 的代码视图（默认不打开编辑器）。
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
viewRegistry.register({
  extensions: [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"],
  load: async () => (await import("./image-view")).ImageView,
})
viewRegistry.register({
  extensions: [".md", ".txt"],
  load: async () => (await import("./richtext-view")).RichtextView,
})
viewRegistry.register({
  extensions: [".xmind"],
  load: async () => (await import("./mindmap-view")).MindmapView,
})

/**
 * 代码类扩展名（T016）：源码 + 脚本 + 配置三类文本格式。
 *
 * `.md` / `.txt`（图文）与 `.csv`（表格）已有归属，故不在此列——**重复认领会抛错**
 * （`view-registry` 的 `register`），本文件在导入时即会炸，不会静默抢走别人的归属。
 */
const 代码扩展名 = [
  // 源码
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".py", ".java", ".kt", ".go", ".rs", ".rb", ".php", ".cs", ".swift", ".scala", ".lua", ".r", ".pl", ".m",
  ".c", ".h", ".cc", ".cpp", ".hpp",
  // 脚本
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".sql",
  // 配置
  // ⚠️ `.env` 这一项认的是 `xxx.env` 这种**带主名**的文件。名字就叫 `.env` 的那些（点开头）
  //    在 `extensionOf` 眼里**没有扩展名**（点的左边没有名字），落 T015 的降级——
  //    **别把这一项读成「.env 文件已支持」**。（代码审查曾把这一项判成「永不命中」，
  //    复核后不成立：`点在首位`才算无扩展名，`点在中间`照常切出后缀。）
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg", ".env", ".properties",
  ".xml", ".html", ".htm", ".css", ".scss", ".less",
] as const

viewRegistry.register({
  extensions: 代码扩展名,
  load: async () => (await import("./code-view")).CodeView,
})
