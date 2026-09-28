import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent } from "@/center/file-content"
import { PdfView } from "./pdf-view"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 让「load → decode → render」整条异步链跑完。 */
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

const 字节 = (bytes: number[]): FileContent => ({
  type: "binary",
  content: btoa(String.fromCharCode(...bytes)),
  encoding: "base64",
})

const 视图 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='pdf-view']")

describe("PDF 预览（FR-007 的 .pdf）", () => {
  /**
   * ⚠️ **这组测试跑在 pdfjs 的 Node 分支上，全绿不等于浏览器可用——别被它骗了。**
   *
   * Bun 满足 pdfjs 的 `isNodeJS` 判据（`process + "" === "[object process]"`），于是
   * `PDFWorker.#isWorkerDisabled` 为真、`#initialize()` 提前转假 worker，**根本不会去读**
   * `GlobalWorkerOptions.workerSrc`。所以即便那条配置丢了（在浏览器里会 100% 抛
   * `No "GlobalWorkerOptions.workerSrc" specified.`、PDF 彻底打不开），本文件照样全绿——
   * worker 配置是**这组测试覆盖不到的一条通路**。
   *
   * 真正算数的验收面是「浏览器里看到 PDF 画面」。改本文件前先读 `pdf-view.tsx` 顶部那段注释。
   */

  /** 同 `document-view`：证明字节真进了 pdfjs，且失败没有自吞。 */
  test("字节不是 PDF：视图落到 error —— 证明字节真交给了 pdfjs", async () => {
    const host = mount(() => <PdfView path="/p/坏.pdf" load={async () => 字节([1, 2, 3, 4, 5, 6, 7, 8])} />)

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("error")
  })

  test("读不到文件：停在 empty，不去调渲染器", async () => {
    const host = mount(() => <PdfView path="/p/没.pdf" load={async () => undefined} />)

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("empty")
  })
})
