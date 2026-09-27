import { createViewRegistry, type ViewRegistry } from "@/center/view-registry"
import { DocumentView } from "./document-view"
import { PdfView } from "./pdf-view"
import { SheetView } from "./sheet-view"

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
viewRegistry.register({ extensions: [".doc", ".docx"], component: DocumentView })
viewRegistry.register({ extensions: [".xls", ".xlsx", ".csv"], component: SheetView })
viewRegistry.register({ extensions: [".pdf"], component: PdfView })
