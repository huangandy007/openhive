import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { MinioBar } from "./minio-bar"

/**
 * MinIO 常驻窄条（005 T019 / 设计 §2 ④、§5.1 步骤 1）：默认态只显示「⬆ MinIO 备份 · N 项」。
 *
 * happy-dom 没有 CSS 引擎——判据是**结构不变量**（说了什么、排在哪、点了通知谁）。
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 条 = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-component='minio-bar']")
const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()

/**
 * 数字槽**不在**吗？——返回**布尔**，不是节点（`LEARNINGS #005-01`：`toBeNull()` 的实得值
 * 若是被 Solid 渲染过的节点，红了会把整轮 `bun test` 挂死）。
 */
const 无槽 = (host: HTMLElement, slot: string) => 槽(host, slot) === null

describe("MinioBar MinIO 常驻窄条（设计 §2 ④ / §5.1）", () => {
  test("没有来源时只写「MinIO 备份」——**不编数字**（宁缺勿假）", () => {
    const host = mount(() => <MinioBar />)

    expect(文本(host, "minio-bar-label")).toBe("MinIO 备份")
    expect(无槽(host, "minio-bar-count")).toBe(true)
  })

  test("有来源时补上「· N 项」，且排在标签**之后**（设计 §5.1 的语序：MinIO 备份 · 2 项）", () => {
    const host = mount(() => <MinioBar count={2} />)

    expect(文本(host, "minio-bar-count")).toBe("· 2 项")
    const 顺序 = [...(条(host)?.querySelectorAll("[data-slot]") ?? [])].map((el) =>
      el.getAttribute("data-slot"),
    )
    expect(顺序.indexOf("minio-bar-label")).toBeLessThan(顺序.indexOf("minio-bar-count"))
  })

  test("明确 0 项时**照样显示**「· 0 项」——`undefined`（不知道）与 `0`（明确没有）不是一回事", () => {
    const host = mount(() => <MinioBar count={0} />)

    expect(文本(host, "minio-bar-count")).toBe("· 0 项")
  })

  test("点它喊 onOpen（本 task 接的是 §5.1 步骤 2①；2② 展开双树归 T012）", () => {
    let 喊过 = 0
    const host = mount(() => <MinioBar count={2} onOpen={() => 喊过++} />)

    条(host)?.click()

    expect(喊过).toBe(1)
  })

  test("未接线时是禁用态——不假装能点（同 ProjectAnchor 的口径）", () => {
    const host = mount(() => <MinioBar count={2} />)

    expect(条(host)?.disabled).toBe(true)
  })

  test("图标对读屏隐身——可读的名字就是那串文字，不多念一个图形名", () => {
    const host = mount(() => <MinioBar count={2} />)

    expect(槽(host, "minio-bar-icon")?.getAttribute("aria-hidden")).toBe("true")
  })
})
