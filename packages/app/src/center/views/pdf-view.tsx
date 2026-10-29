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
 * 一张「纸」的外观：白底 + 投影 + 页缝。
 *
 * **逐字抄 docx-preview 给 Word 页配的那条默认样式**（`docx-preview.js:3288`：
 * `background: white; box-shadow: 0 0 10px rgba(0,0,0,.5); margin-bottom: 30px`）——
 * 用户 2026-10-29 说「希望 PDF 像 Word 打开的感觉」，而 Word 那边好看有一大半就是这三行。
 */
const 页类名 = "mx-auto mb-[30px] bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]"

/**
 * 适配中栏宽度的渲染比例。
 *
 * 量不到宽（隐藏的 tab、还没挂载、happy-dom 那种没有布局引擎的环境）一律退回 1：
 * 返回 0 会画出一张 0 宽的画布，NaN 会让 pdfjs 直接抛——两者在界面上都是「打不开」，
 * 而归因会指向文件坏（同 `#006-06` / `#005-32`：读数可疑时先怀疑测量）。
 */
export function 适配比例(可用宽: number, 页宽: number): number {
  if (!Number.isFinite(可用宽) || !Number.isFinite(页宽)) return 1
  if (可用宽 <= 0 || 页宽 <= 0) return 1
  return 可用宽 / 页宽
}

/**
 * 画布的**后备像素**长（不是 CSS 长）。
 *
 * 改前这里没有这一层：`canvas.width = viewport.width`（CSS 像素），于是 125% / 150% 缩放的屏上
 * 整张位图被拉伸到 1.25~1.5 倍设备像素 ⇒ 字发虚。这一乘就是「清晰」的全部来源。
 */
export function 画布像素(css长: number, 像素比: number): number {
  const 倍 = Number.isFinite(像素比) && 像素比 > 0 ? 像素比 : 1
  return Math.max(1, Math.round(css长 * 倍))
}

/** 容器里真正能放纸的宽度：客户宽扣掉左右内边距（`binary-view.tsx` 那个 `p-4`）。 */
function 可用内容宽(容器: HTMLElement): number {
  const 样 = getComputedStyle(容器)
  const 左 = Number.parseFloat(样.paddingLeft) || 0
  const 右 = Number.parseFloat(样.paddingRight) || 0
  return 容器.clientWidth - 左 - 右
}

/**
 * 交给 pdfjs 渲染一份 PDF：逐页画进各自的 canvas，每页套一张「纸」。
 *
 * ## 三件事合起来才是「像专业阅读器」
 *
 * 1. **清晰**：画布后备像素乘上屏幕像素比（`画布像素`），再用 CSS 长把它量回去；
 * 2. **适配宽度**：页宽按容器可用宽算比例（`适配比例`），A4 的 595 会撑满中栏；
 * 3. **像纸**：每页一个盒子（`页类名`：白底 + 投影 + 30px 页缝）。
 *
 * ## 为什么现在要留着自己这份文档
 *
 * 改前是「画完立刻 `destroy()`」——一次性预览的取舍。**适宽之后不行了**：窗口一改宽，
 * 那几页就得按新宽度重画，重画要 `getPage()`，文档不能已经销毁。于是改成**视图活着就留着**，
 * 由交回去的清理函数在换 tab / 卸载时销毁（`BinaryView` 会调用它）。代价是开着一份 PDF 期间
 * 多占一份文档内存——这是「改动窗口大小仍清晰」必须付的钱。
 *
 * ## 重画的守卫
 *
 * - 宽度变化 < 1px 不重画（滚动条出现/消失会带来十几像素的抖动，不设阈会来回画）；
 * - 变化走 150ms 去抖（拖窗口会连发几十次）；
 * - 重画在**离屏节点里画完再一次性换上**，中途不闪；
 * - 代次令牌作废迟到的旧画（与 `BinaryView` 的 `token` 同一手法）；
 * - 重画失败只留痕、保留已画好的画面——它没有 await 的调用方，抛出去没人接。
 *
 * **加密的 PDF 单独认出来**（见下方 catch）：文件没坏，只是锁着。
 *
 * 导出仅供测试直接驱动——生产路径是 `PdfView`。
 */
export const renderPdf: BytesRenderer = async (bytes, container, 报进度) => {
  await 配好worker脚本()
  const task = getDocument({ data: bytes })
  let pdf: Awaited<typeof task.promise>
  try {
    pdf = await task.promise
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
    await task.destroy()
    if (原因 instanceof PasswordException) throw 需要密码("PDF 是加密的，pdfjs 报 PasswordException")
    throw 原因
  }

  const 倍 = (() => {
    const 比 = typeof window === "undefined" ? 1 : window.devicePixelRatio
    return Number.isFinite(比) && 比 > 0 ? 比 : 1
  })()
  let 上次宽 = Number.NaN
  let 代次 = 0

  /**
   * 画全部页。
   *
   * `渐进 = true`（首屏）：**画完一页就交一页**——用户一两秒内看到第一页，
   * 剩下的在后面生长，这正是「打开大文件不像假死」的正主。
   * `渐进 = false`（窗口缩放后的重画）：离屏画完再**一次性换上**——重画时屏幕上
   * 已经有旧的一份，逐页替换会让它一段一段地闪。
   */
  async function 画一次(渐进: boolean) {
    const 我的 = ++代次
    const 宽 = 可用内容宽(container)
    上次宽 = 宽
    const 盒们: HTMLElement[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      if (我的 !== 代次) return
      const 原 = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 适配比例(宽, 原.width) })
      const css宽 = Math.round(viewport.width)
      const css高 = Math.round(viewport.height)
      const canvas = document.createElement("canvas")
      canvas.dataset.page = String(number)
      canvas.width = 画布像素(css宽, 倍)
      canvas.height = 画布像素(css高, 倍)
      canvas.style.width = `${css宽}px`
      canvas.style.height = `${css高}px`
      canvas.style.display = "block"
      const 盒 = document.createElement("div")
      盒.dataset.slot = "pdf-page"
      盒.className = 页类名
      盒.appendChild(canvas)
      await page.render({ canvas, viewport, transform: 倍 === 1 ? undefined : [倍, 0, 0, 倍, 0, 0] }).promise
      if (我的 !== 代次) return
      // 先上屏、再报进度：报进度的那一刻，页面必须已经看得见（用例就是按这条钉的）。
      if (渐进) container.appendChild(盒)
      else 盒们.push(盒)
      报进度?.({ 文字: `排版中 · 第 ${number} / ${pdf.numPages} 页`, 已: number, 共: pdf.numPages })
    }
    if (我的 !== 代次) return
    if (!渐进) container.replaceChildren(...盒们)
  }

  let 定时: ReturnType<typeof setTimeout> | undefined
  const 观察 =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => {
          if (定时 !== undefined) clearTimeout(定时)
          定时 = setTimeout(() => {
            定时 = undefined
            if (Math.abs(可用内容宽(container) - 上次宽) < 1) return
            void 画一次(false).catch((原因: unknown) => {
              console.warn(`[openhive] pdf-view 按新宽度重画失败，保留原画面`, 原因)
            })
          }, 150)
        })
  观察?.observe(container)

  await 画一次(true)

  return () => {
    观察?.disconnect()
    if (定时 !== undefined) clearTimeout(定时)
    代次++ // 让在飞的重画作废
    void task.destroy()
  }
}

/** PDF 预览视图（FR-007 的 .pdf）。 */
export const PdfView: ViewComponent = (props) => (
  <BinaryView name="pdf-view" path={props.path} load={props.load} render={renderPdf} />
)
