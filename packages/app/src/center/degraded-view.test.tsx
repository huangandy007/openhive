import { describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { DegradedView, type DegradedReason } from "./degraded-view"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 文案 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLElement>(`[data-slot='${slot}']`)?.textContent ?? ""

/** 五种原因**都**是「看不了」，但不是同一个「看不了」——下面逐个点名。 */
const 全部原因: DegradedReason[] = ["unsupported", "empty", "encrypted", "error", "load-failed"]

describe("降级呈现：内容区认不出 / 读不出时，必须说得出话（FR-007 / US3 AC3）", () => {
  test("说清是哪个文件、以及是哪种看不了", () => {
    const host = mount(() => <DegradedView reason="unsupported" name="台账.rtf" />)

    expect(host.querySelector("[data-component='degraded-view']")?.getAttribute("data-reason")).toBe("unsupported")
    expect(文案(host, "degraded-title")).not.toBe("")
    expect(文案(host, "degraded-detail")).toContain("台账.rtf")
  })

  test("五种原因各有各的说法——「这种格式没有预览」与「这个文件打不开」不是一回事", () => {
    const 说法 = 全部原因.map((reason) => {
      const host = mount(() => <DegradedView reason={reason} name="卷宗.pdf" />)
      // 文件名五种情况都一样，故下面的差异只可能来自文案本身
      return `${文案(host, "degraded-title")}｜${文案(host, "degraded-detail")}`
    })

    expect(new Set(说法).size).toBe(全部原因.length)
  })

  /**
   * 加密与「打不开」是**两件事**：前者文件一点没坏，缺的只是密码——民警的动作是去要密码，
   * 不是把文件退回去重新取证。混进 `error`（「可能已经损坏」）就是让他怀疑一份好文件。
   */
  test("加密的文件：说「需要密码」，不说「可能已经损坏」", () => {
    const host = mount(() => <DegradedView reason="encrypted" name="卷宗.pdf" />)

    expect(host.querySelector("[data-component='degraded-view']")?.getAttribute("data-reason")).toBe("encrypted")
    expect(文案(host, "degraded-title")).toContain("加密")
    expect(文案(host, "degraded-detail")).toContain("密码")
    expect(文案(host, "degraded-detail")).toContain("卷宗.pdf")
    expect(文案(host, "degraded-detail")).not.toContain("损坏")
  })

  test("配了图标，不只靠颜色说话（DESIGN §4.3）", () => {
    const host = mount(() => <DegradedView reason="error" name="坏.docx" />)

    expect(host.querySelector("[data-slot='degraded-icon'] [data-slot='icon-svg']")).not.toBeNull()
    expect(文案(host, "degraded-title")).not.toBe("")
    expect(文案(host, "degraded-detail")).not.toBe("")
  })

  test("文件名是不可信输入：原样当文字，不当 HTML", () => {
    const host = mount(() => <DegradedView reason="unsupported" name="<script>alert(1)</script>.bin" />)

    const 载体 = host.querySelector<HTMLElement>("[data-slot='degraded-detail']")
    expect(载体?.querySelector("script")).toBeNull()
    expect(载体?.textContent).toContain("<script>")
  })
})
