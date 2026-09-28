import { describe, expect, test } from "bun:test"
import { getDocument, PasswordException } from "pdfjs-dist"
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

/** 让「load → decode → render」整条短链跑完（坏字节那条路一个 tick 就够）。 */
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 等状态到位。**有上限地轮询**而不是睡固定一拍：加密那条路要走完 pdfjs 的装载，
 *  比「头几字节就不对」那条长（同 `mindmap-view.test.tsx` 的 `等到`，等不到时断言会报 `pending`）。 */
async function 等到状态(host: HTMLElement, 期望: string) {
  for (let i = 0; i < 100; i++) {
    if (视图(host)?.getAttribute("data-state") === 期望) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * 手搓一份**加密**的 PDF：`/Encrypt` 指向第 4 个对象（`/Filter /Standard`、`/V 1 /R 2`，
 * 40 位 RC4），`/O` 与 `/U` 是随便填的 32 字节——于是用空密码去校验必然对不上，
 * pdfjs 就会来要密码。
 *
 * 为什么手搓而不放样本文件：手上没有真加密样本，而这份造法的每一行都读得懂
 * （同 `__fixtures__/zip.ts` 造包器的理由）。`/ID` 与 xref 都按规范写对，是为了保证
 * pdfjs 走到的是**「密码不对」**那一步、而不是**「这文件坏了」**那一步——
 * 下面那条夹具自检就是钉这个的。
 */
function 加密PDF(): number[] {
  const 编码 = new TextEncoder()
  const 垃圾32 = "0".repeat(64)
  const 对象 = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${垃圾32}> /U <${垃圾32}> /P -1 >>`,
  ]
  let 文 = "%PDF-1.4\n"
  const 偏移: number[] = []
  for (const [i, 体] of 对象.entries()) {
    偏移.push(编码.encode(文).length)
    文 += `${i + 1} 0 obj\n${体}\nendobj\n`
  }
  const xref位置 = 编码.encode(文).length
  文 += `xref\n0 ${对象.length + 1}\n0000000000 65535 f \n`
  for (const 处 of 偏移) 文 += `${String(处).padStart(10, "0")} 00000 n \n`
  文 += `trailer\n<< /Size ${对象.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] >>\nstartxref\n${xref位置}\n%%EOF\n`
  return [...编码.encode(文)]
}

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

  /**
   * 夹具自检（钉的是夹具、不是产品代码）：这份手搓的 PDF 在 pdfjs 眼里**就是「要密码」的那一种**。
   *
   * 没有它，下一条会在**假绿**里过：夹具若写歪成「结构不对」，pdfjs 抛的就是别的错、
   * 照样落不到 `ready`——但落的是 `error`，下一条会红，所以更坏的情况是夹具碰巧被当成了
   * 「没有页面的合法 PDF」而落 `ready`。这条把「抛的是什么」钉死在 `PasswordException` 上。
   */
  test("夹具自检：这份加密 PDF 让 pdfjs 抛的就是 PasswordException（走的是密码那条路）", async () => {
    const 原因 = await getDocument({ data: new Uint8Array(加密PDF()) }).promise.then(
      () => undefined,
      (抛出的: unknown) => 抛出的,
    )

    expect(原因 instanceof PasswordException).toBe(true)
  })

  /**
   * 加密的 PDF 落 `encrypted`，**不能落 `error`**——理由同 `.doc` / XMind 8 / 压缩方式那几处：
   * 文件一点没坏，说成「可能已经损坏」就是让民警去怀疑一份好文件（归因反了）。
   *
   * pdfjs 本来认得出这种情况：没有 `onPassword` 时它抛 `PasswordException`，
   * 而我们此前没接这一支，于是它一路被兜成 `error`。
   */
  test("加密的 PDF：落「需要密码」，不说文件损坏", async () => {
    const host = mount(() => <PdfView path="/p/卷宗.pdf" load={async () => 字节(加密PDF())} />)

    await 等到状态(host, "encrypted")

    expect(视图(host)?.getAttribute("data-state")).toBe("encrypted")
    const 降级 = host.querySelector("[data-component='degraded-view']")
    expect(降级?.getAttribute("data-reason")).toBe("encrypted")
    expect(降级?.textContent).toContain("密码")
    // 「损坏」是 error 那一档的说法——一份锁着的文件不该被说成这样
    expect(降级?.textContent).not.toContain("损坏")
  })
})
