import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent } from "@/center/file-content"
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
})
