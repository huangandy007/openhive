import { getDocument, GlobalWorkerOptions, PasswordException } from "pdfjs-dist"
import type { ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"
import { 加载失败, 需要密码 } from "./unsupported-format"

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
 *
 * 那块 worker 脚本**没到**同样是我们这边的问题：抛 `加载失败` 落 `load-failed`（动作：重开这张
 * 标签），而不是让 rejection 一路兜成 `error`（「可能已经损坏」）——后者让民警去怀疑一份好卷宗。
 *
 * ✅ 这条分支有测试钉着（`load-failed.test.tsx`），但**测法有个前提**：得先把 `workerSrc` 清回
 * 空串。Bun 里 pdfjs 的 Node 分支在模块加载时就把它兜成了 `"./pdf.worker.mjs"`，于是上面那句
 * `if (GlobalWorkerOptions.workerSrc) return` 会提前返回、这条 `import` 在本环境根本执行不到
 * （与 `document-view.tsx` 认加密流那块不同——那边没有这道前置 return，直接就可达）。
 * 清空不是造状态，是把值摆回它在**浏览器里的初值**：那才正是这条分支在生产里每次首访必经的原因。
 */
async function 配好worker脚本(): Promise<void> {
  if (GlobalWorkerOptions.workerSrc) return
  const 模块 = await import("pdfjs-dist/build/pdf.worker.min.mjs?url").catch((原因: unknown) => {
    throw 加载失败(`PDF 的 worker 脚本没加载出来（${原因 instanceof Error ? 原因.message : "原因不明"}）`)
  })
  if (模块.default) GlobalWorkerOptions.workerSrc = 模块.default
}

/**
 * 交给 pdfjs 渲染一份 PDF：逐页画进各自的 canvas。
 *
 * 页尺寸取 viewport 原始尺寸（`scale: 1`）——缩放 / 适配宽度属后续，容器 `overflow-auto` 先兜住。
 * 渲染完立刻 `destroy()` 装载任务：不销毁会把整份文档连同 worker 留在内存里，
 * 而 001 的预览是一次性的（换 tab 即整体重渲）。
 *
 * **加密的 PDF 单独认出来**（见下方 catch）：文件没坏，只是锁着。
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
  } catch (原因) {
    // 加密的 PDF：我们没给 `onPassword`，pdfjs 拿空密码去试、试不过就抛 `PasswordException`
    // （`PasswordResponses.NEED_PASSWORD`）。**必须单独认出来**——它此前会一路被兜成 `error`
    // →「这个文件打不开 · 可能已经损坏」，而文件一点没坏、只是锁着：民警该做的是去要密码，
    // 不是把文件退回去重新取证。同 `.doc` / XMind 8 / 压缩方式那几处误归因
    // （机制见 `unsupported-format.ts`）。
    //
    // 按**类型**认而不是按 message 文本：文本是 pdfjs 的内部措辞，它改一个词这里就静默失效
    // （又悄悄退回「可能已经损坏」）。这个类与 `getDocument` 来自同一个模块实例，
    // 不存在「自己造的类跨 chunk 有两份」那个坑——那两处标记错的理由不适用这里。
    if (原因 instanceof PasswordException) throw 需要密码("PDF 是加密的，pdfjs 报 PasswordException")
    throw 原因
  } finally {
    await task.destroy()
  }
}

/** PDF 预览视图（FR-007 的 .pdf）。 */
export const PdfView: ViewComponent = (props) => (
  <BinaryView name="pdf-view" path={props.path} load={props.load} render={renderPdf} />
)
