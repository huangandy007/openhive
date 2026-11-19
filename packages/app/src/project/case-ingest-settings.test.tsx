import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { createCaseIngestApi } from "./case-ingest-api"
import { CaseIngestSettings } from "./case-ingest-settings"

/**
 * 016 T017 · 项目入库开关的组件用例。
 *
 * 非属主分支沿用 `#005-47` 三件套：`disabled` ＋ **不绑 handler** ＋ 原因文案可见。
 * 「点击」用 `dispatchEvent` 绕过浏览器对 disabled 的抑制；「没有发请求」用布尔比较（`#013-12`）。
 */

async function 等(条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
afterEach(() => {
  document.body.innerHTML = ""
})

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function 假服务() {
  const 记 = { 次数: 0, 写体: [] as unknown[] }
  const send = async (url: string, init?: RequestInit) => {
    记.次数 += 1
    if (init?.method === "POST") {
      const 体 = JSON.parse(String(init.body)) as Record<string, unknown>
      记.写体.push(体)
      return 回({ autoEnqueue: 体.autoEnqueue ?? true, autoEnableTrusted: 体.autoEnableTrusted ?? false, updatedAt: 1 })
    }
    return 回({ autoEnqueue: true, autoEnableTrusted: false, updatedAt: 1700000000 })
  }
  return { 记, api: createCaseIngestApi(send) }
}

describe("项目入库开关", () => {
  test("读数上屏：两个开关按服务端值渲染", async () => {
    const { api } = 假服务()
    const host = mount(() => <CaseIngestSettings projectId="p1" canManage={true} api={api} />)
    await 等(() => {
      const 入队 = host.querySelector<HTMLInputElement>("[data-slot='case-ingest-auto-enqueue']")
      return 入队 !== null && 入队.disabled === false
    })
    expect(host.querySelector<HTMLInputElement>("[data-slot='case-ingest-auto-enqueue']")!.checked).toBe(true)
    expect(host.querySelector<HTMLInputElement>("[data-slot='case-ingest-auto-trusted']")!.checked).toBe(false)
  })

  test("属主切换开关 ⇒ POST 只带改动的那个键，回包刷新显示", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => <CaseIngestSettings projectId="p1" canManage={true} api={api} />)
    const 入队 = host.querySelector<HTMLInputElement>("[data-slot='case-ingest-auto-enqueue']")!
    await 等(() => 入队.disabled === false)

    const 点前 = 记.次数
    入队.checked = false
    入队.dispatchEvent(new Event("change", { bubbles: true }))
    await 等(() => 记.写体.length === 1)

    expect(记.写体[0]).toEqual({ projectId: "p1", autoEnqueue: false })
    expect(记.次数).toBe(点前 + 1)
    await 等(() => 入队.checked === false)
  })

  test("非属主：开关置灰 + 原因可见 + 点击后 send 次数不增（handler 未绑）", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => <CaseIngestSettings projectId="p1" canManage={false} api={api} />)
    const 入队 = host.querySelector<HTMLInputElement>("[data-slot='case-ingest-auto-enqueue']")!
    await 等(() => host.querySelector("[data-slot='case-ingest-reason']") !== null)

    expect(入队.disabled).toBe(true)
    expect(host.querySelector("[data-slot='case-ingest-reason']")!.textContent).toContain("只有项目属主能修改")

    const 点前 = 记.次数
    // 去掉外观再改值（模拟绕过置灰）；真闸是「不绑 handler」。
    入队.disabled = false
    入队.checked = false
    入队.dispatchEvent(new Event("change", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(记.次数 === 点前).toBe(true)
    expect(记.写体.length === 0).toBe(true)
  })
})
