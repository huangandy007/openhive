import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent } from "@/center/file-content"
import { 加密的Office容器 } from "./__fixtures__/office"
import { DocumentView } from "./document-view"

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

/** 逐字节拼串再 btoa——加密容器的字节上千，`String.fromCharCode(...bytes)` 会爆栈。 */
function 二进制内容(bytes: Uint8Array): FileContent {
  let 串 = ""
  for (const byte of bytes) 串 += String.fromCharCode(byte)
  return { type: "binary", content: btoa(串), encoding: "base64" }
}

const 视图 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='document-view']")

describe("Word 预览（FR-007 的 .doc/.docx）", () => {
  /**
   * 这条是本视图**最要紧的断言**：字节真的进了 docx-preview。
   * 若实现只是画个空壳（或把渲染器的失败吞掉），坏文件就会显示成「加载成功但一片空白」，
   * 与「文件本来就是空的」在界面上无从区分。
   */
  test("字节不是 docx：视图落到 error —— 证明字节真交给了 docx-preview，且失败没有自吞", async () => {
    const host = mount(() => (
      <DocumentView path="/p/坏.docx" load={async () => 字节([1, 2, 3, 4, 5, 6, 7, 8])} />
    ))

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("error")
  })

  test("读不到文件：停在 empty，不去调渲染器", async () => {
    const host = mount(() => <DocumentView path="/p/没.docx" load={async () => undefined} />)

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("empty")
  })

  /**
   * 真 `.doc`（Word 97–2003）是 OLE2 容器，而 docx-preview 只认 OOXML——这条路由**必失败**。
   * 失败归因因此必须落在「这种格式暂时看不了」上：说成「可能已经损坏」是**冤枉文件**，
   * 那份卷宗好好的，是这种老格式我们没接。
   *
   * 喂的只有 8 字节魔数（连容器都算不上，`CFB.read` 在它上面直接抛）：钉的是**前半段**——
   * 光凭魔数就得落 `unsupported`，且**解析不动的容器不许反过来被判成「这个文件是加密的」**。
   * 容器**开得动**的那条路（真老 `.doc` 的形状）在下一条。
   */
  test("老 .doc 的魔数：落 unsupported，不说文件坏了", async () => {
    const host = mount(() => (
      <DocumentView path="/p/老卷宗.doc" load={async () => 字节([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])} />
    ))

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("unsupported")
    expect(host.querySelector("[data-component='degraded-view']")?.getAttribute("data-reason")).toBe("unsupported")
  })

  /**
   * 真老 `.doc` 的**实际形状**：OLE2 容器**开得动**，里面是 `/WordDocument` 等流、**没有**加密流。
   * 与上一条的区别不是措辞而是路径——那条走的是 `CFB.read` 抛错的兜底分支，这条才走
   * 「容器看懂了、确认里面没锁」这条正路。少了它，「认加密流」那一步只在加密容器上被验过，
   * 而**不加密**的那半边（最容易写成「凡 OLE2 都当加密」）没人钉。
   *
   * 「这份容器确实开得动」由**上面那条加密用例**背书：它走的是同一个造包器，能落 `encrypted`
   * 就说明 `CFB.read` 在这个形状的字节上是成功的（读不动就只能落 `unsupported`）。
   *
   * ⚠️ 本条是**回归**测试，不是 TDD 出来的：写下来时实现已经是对的，它防的是以后改坏。
   */
  test("老 .doc 的真形状（容器开得动、无加密流）：仍落 unsupported，不被误判成加密", async () => {
    const host = mount(() => (
      <DocumentView path="/p/老卷宗.doc" load={async () => 二进制内容(加密的Office容器(["/WordDocument"]))} />
    ))

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("unsupported")
    expect(host.querySelector("[data-component='degraded-view']")?.getAttribute("data-reason")).toBe("unsupported")
  })

  /**
   * 加密的 Office 文档**也是 OLE2 容器**——与老 `.doc` 在头 8 字节上一模一样，可归因是**相反**的
   * 两件事：老 `.doc` 是「这种格式没接，换个工具打开」，加密文档是「文件一点没坏，去要密码」。
   *
   * 分得开靠的是容器里的**流名**（ECMA-376 把加密信息放在 `/EncryptionInfo` + `/EncryptedPackage`），
   * 不是魔数——只看魔数，这两类永远是同一件事，总要冤枉一头。
   *
   * 这与 `sheet-view` 认加密工作簿是**同一件事的两条路**：那边 SheetJS 自己会抛
   * `File is password-protected`，docx-preview 什么都不说，只能自己进容器看。
   * 漏了这条路的后果是**同一个文件按扩展名不同给两种说法**（`.xlsx` 说「要密码」、
   * `.docx` 说「换个工具打开」），民警照后者去换工具只会撞上同一个密码框。
   */
  test("加密的 Office 文档（OLE2 + 加密流）：落 encrypted，不说「这种格式没接」", async () => {
    const host = mount(() => (
      <DocumentView path="/p/加密卷宗.docx" load={async () => 二进制内容(加密的Office容器())} />
    ))

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("encrypted")
    const 降级 = host.querySelector("[data-component='degraded-view']")
    expect(降级?.getAttribute("data-reason")).toBe("encrypted")
    expect(降级?.textContent).toContain("密码")
    // 「这种格式暂时看不了」是 unsupported 那一档的说法——一份锁着的卷宗不该被说成这样
    expect(降级?.textContent).not.toContain("暂时看不了")
    expect(降级?.textContent).not.toContain("损坏")
  })

  /** 老 Excel 的加密流（`/encryption`）也是同一个「锁着」——两代流名都得认。 */
  test("老一代的加密流（/encryption）同样落 encrypted", async () => {
    const host = mount(() => (
      <DocumentView path="/p/老账册.doc" load={async () => 二进制内容(加密的Office容器(["/encryption"]))} />
    ))

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("encrypted")
  })
})
