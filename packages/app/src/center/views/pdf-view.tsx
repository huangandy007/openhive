import { getDocument } from "pdfjs-dist"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"

/**
 * 交给 pdfjs 渲染一份 PDF：逐页画进各自的 canvas。
 *
 * 页尺寸取 viewport 原始尺寸（`scale: 1`）——缩放 / 适配宽度属后续，容器 `overflow-auto` 先兜住。
 * 渲染完立刻 `destroy()` 装载任务：不销毁会把整份文档连同 worker 留在内存里，
 * 而 001 的预览是一次性的（换 tab 即整体重渲）。
 *
 * ⚠️ 未配 `GlobalWorkerOptions.workerSrc`，pdfjs 会退回主线程渲染（大文件会卡住界面）——
 * 这是 Vite 构建期配置，**本环境无法验证**，留作待决项在真实浏览器核对时定夺（见 state.md）。
 *
 * 导出仅供测试直接驱动——生产路径是 `PdfView`。
 */
export const renderPdf: BytesRenderer = async (bytes, container) => {
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
