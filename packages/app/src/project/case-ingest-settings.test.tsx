import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
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
/** 入库设置默认收起：用例要先点开才看得到开关。找不到按钮就当场报，别让后面等成超时。 */
function 展开(host: HTMLElement) {
  const 开关 = host.querySelector<HTMLButtonElement>("[data-slot='case-ingest-settings-toggle']")
  if (开关 === null) throw new Error("找不到入库设置的展开按钮")
  开关.click()
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
    展开(host)
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
    展开(host)
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

  test("写回包晚到：切到 B 后 A 的设置不覆盖 B、B 的保存中复位（B3）", async () => {
    let 放行写: (() => void) | undefined
    const 写闸 = new Promise<void>((resolve) => {
      放行写 = resolve
    })
    const send = async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await 写闸
        // A 的回包（若被误接到 B 上，会把 B 的「自动入队」改成 false）。
        return 回({ autoEnqueue: false, autoEnableTrusted: true, updatedAt: 2 })
      }
      if (url.includes("projectId=p1")) return 回({ autoEnqueue: true, autoEnableTrusted: false, updatedAt: 1 })
      return 回({ autoEnqueue: true, autoEnableTrusted: true, updatedAt: 3 })
    }
    const api = createCaseIngestApi(send)
    const [项目, set项目] = createSignal("p1")
    const host = mount(() => <CaseIngestSettings projectId={项目()} canManage={true} api={api} />)
    展开(host)
    const 入队 = host.querySelector<HTMLInputElement>("[data-slot='case-ingest-auto-enqueue']")!
    await 等(() => 入队.disabled === false && 入队.checked === true)

    // A 项目的写入在途。
    入队.checked = false
    入队.dispatchEvent(new Event("change", { bubbles: true }))
    await 等(() => 入队.disabled === true)

    // 切到 B：B 读到的是 autoEnqueue=true / autoEnableTrusted=true。
    set项目("p2")
    const 信任 = host.querySelector<HTMLInputElement>("[data-slot='case-ingest-auto-trusted']")!
    await 等(() => 信任.checked === true)
    // 切项目必须复位「保存中」，否则 B 的开关被 A 的在途写拖成置灰。
    expect(入队.disabled).toBe(false)

    放行写!()
    await new Promise((resolve) => setTimeout(resolve, 40))

    // A 的回包晚到：不得改写 B 的设置（`#010-05` / 代际保护）。
    expect(入队.checked).toBe(true)
    expect(入队.disabled).toBe(false)
  })

  test("非属主：开关置灰 + 原因可见 + 点击后 send 次数不增（handler 未绑）", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => <CaseIngestSettings projectId="p1" canManage={false} api={api} />)
    展开(host)
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

  test("默认收起：只露标题一行，两个开关不在 DOM 里", () => {
    const { api } = 假服务()
    const host = mount(() => <CaseIngestSettings projectId="p1" canManage={true} api={api} />)
    const 开关 = host.querySelector<HTMLButtonElement>("[data-slot='case-ingest-settings-toggle']")
    expect(开关 === null).toBe(false)
    expect(开关!.textContent).toContain("入库设置")
    // 与能力组头同一套图标：左侧 ◆、右侧 ›/⌄。
    expect(开关!.textContent).toContain("◆")
    expect(开关!.textContent).toContain("›")
    expect(开关!.getAttribute("aria-expanded")).toBe("false")
    // `#013-12`：DOM「不存在」用布尔比较。
    expect(host.querySelector("[data-slot='case-ingest-auto-enqueue']") === null).toBe(true)
    expect(host.querySelector("[data-slot='case-ingest-auto-trusted']") === null).toBe(true)
  })

  test("点开才出现两个开关与说明，再点收起", async () => {
    const { api } = 假服务()
    const host = mount(() => <CaseIngestSettings projectId="p1" canManage={true} api={api} />)
    const 开关 = host.querySelector<HTMLButtonElement>("[data-slot='case-ingest-settings-toggle']")!
    开关.click()
    await 等(() => host.querySelector("[data-slot='case-ingest-auto-enqueue']") !== null)

    expect(开关.getAttribute("aria-expanded")).toBe("true")
    expect(开关.textContent).toContain("⌄")
    // 说明要让用户知道「开 / 关」各自意味着什么，不是只有标签。
    expect(host.textContent).toContain("自动排队解析")
    expect(host.textContent).toContain("可信白名单")

    开关.click()
    await 等(() => host.querySelector("[data-slot='case-ingest-auto-enqueue']") === null)
    expect(开关.getAttribute("aria-expanded")).toBe("false")
  })
})
