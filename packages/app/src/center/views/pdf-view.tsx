import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"

/**
 * 把 pdfjs 的 worker 脚本地址配好（配一次就够）。
 *
 * **不配不是「变慢」，是彻底打不开。** pdfjs 只在 Node 分支里给 `workerSrc` 兜底
 * （`build/pdf.mjs` 里那个 `if (isNodeJS)` 静态块），浏览器分支**没有任何回退**——
 * `PDFWorker.workerSrc` 的 getter 在值为空时无条件抛 `No "GlobalWorkerOptions.workerSrc"
 * specified.`，而 `getDocument()` 会同步走到它。于是民警看到的是 `error` 降级＝「这个文件打不开 ·
 * 可能已经损坏」——把「我们没配 worker」说成了「卷宗坏了」，归因是反的。
 *
 * **为什么是动态导入、且只在拿到地址时才赋值**：`?url` 是 Vite 专有写法，Bun 不认。写成模块顶层
 * 的静态导入，Bun 装载本模块时直接抛 `SyntaxError: Missing 'default' export`（整个视图注册表测试
 * 连模块都加载不进来）；写成动态导入，Bun 只是把那个 1.2MB 的 worker 脚本执行一遍、`default` 给到
 * `undefined`。Bun 里赋不上**不影响正确性**：Bun 满足 pdfjs 的 `isNodeJS` 判据
 * （`process + "" === "[object process]"`），`#initialize()` 会提前转假 worker、根本不读这个值。
 *
 * **验证到哪一步了**（别把「构建通过」当成「页面能看」）：
 * - ✅ `bun run build` 查实 Vite 真把 worker 出成了独立资产、`?url` 模块交回的就是它的地址
 *   （`dist/assets/pdf.worker.min-*.mjs` 1265413 字节；那个 120 字节的小 chunk 里是
 *   `export default "/assets/pdf.worker.min-*.mjs"`）。
 * - ⚠️ **还不能证明浏览器里真跑得起来**：组件测试与 `bun run dev` 走的都是 Node 分支，根本
 *   不读这个值（见上一段）。真正算数的是**在浏览器里看到 PDF 画面**——这是浏览器核对清单的
 *   第一条（见 state.md）。`pdf-view.test.tsx` 顶部有同样的注记。
 */
async function 配好worker脚本(): Promise<void> {
  if (GlobalWorkerOptions.workerSrc) return
  const 模块 = await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  if (模块.default) GlobalWorkerOptions.workerSrc = 模块.default
}

/**
 * 交给 pdfjs 渲染一份 PDF：逐页画进各自的 canvas。
 *
 * 页尺寸取 viewport 原始尺寸（`scale: 1`）——缩放 / 适配宽度属后续，容器 `overflow-auto` 先兜住。
 * 渲染完立刻 `destroy()` 装载任务：不销毁会把整份文档连同 worker 留在内存里，
 * 而 001 的预览是一次性的（换 tab 即整体重渲）。
 *
 * 导出仅供测试直接驱动——生产路径是 `PdfView`。
 */
export const renderPdf: BytesRenderer = async (bytes, container) => {
  await 配好worker脚本()
  const task = getDocument({ data: bytes })
  try {
    const pdf = await task.promise
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const canvas = document.createElement("canvas")
      canvas.dataset.page = String(number)
      canvas.width = viewport.width
      canvas.height = viewport.height
      container.appendChild(canvas)
      await page.render({ canvas, viewport }).promise
    }
  } finally {
    await task.destroy()
  }
}

/** PDF 预览视图（FR-007 的 .pdf）。 */
export const PdfView: ViewComponent = (props) => (
  <BinaryView name="pdf-view" path={props.path} load={props.load} render={renderPdf} />
)
