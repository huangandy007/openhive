import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { CaseAlertEntry } from "./case-alert-entry"
import type { CaseAlertsApi, 提醒行 } from "./case-alerts-api"

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

const 未读: 提醒行 = {
  id: "al-1",
  rule_id: "资金对称",
  标题: "张三 短期资金进出高度对称",
  内容: "出 2 笔、入 2 笔",
  事实: null,
  created_at: 1,
  read_at: null,
  handled_at: null,
}

function 假api(over: Partial<CaseAlertsApi> = {}): CaseAlertsApi {
  return {
    list: async () => ({ kind: "ok", value: [未读] }),
    refresh: async () => ({ kind: "ok", value: { 新建: 1, 提醒: [未读] } }),
    markRead: async () => ({ kind: "ok", value: { 已读: 1 } }),
    ...over,
  }
}

describe("右栏提醒入口", () => {
  test("有未读 ⇒ 「新提醒 1 条」，并带 data-unread", async () => {
    const host = mount(() => <CaseAlertEntry projectId={() => "p"} api={假api()} onOpen={() => {}} />)
    await 等(() => host.querySelector("[data-slot='case-alert-count']") !== null)
    expect(host.querySelector("[data-slot='case-alert-count']")!.textContent).toContain("新提醒 1 条")
    expect(host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread")).toBe("1")
  })

  test("全部已读 ⇒ 说「没有新提醒」，入口仍在（还能点进清单看历史）", async () => {
    // ⚠️ 不能只 `await 等(textContent 含「没有新提醒」)`：**初始渲染**（列表还没回来）就已经是
    // 0 条、已经写着这句话，条件第一次就成立 ⇒ 用例从没等到回包，去掉 `read_at === null`
    // 过滤（变异 C）也照样绿。这里拿住回包、落地后再断言。
    let 回包!: () => void
    const api = 假api({
      list: () =>
        new Promise((resolve) => {
          回包 = () => resolve({ kind: "ok", value: [{ ...未读, read_at: 2 }] })
        }),
    })
    const host = mount(() => <CaseAlertEntry projectId={() => "p"} api={api} onOpen={() => {}} />)
    await 等(() => 回包 !== undefined)
    回包()
    await 等(() => host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread") === "0")
    expect(host.textContent).toContain("没有新提醒")
    expect(host.querySelector("[data-slot='case-alert-count']")).toBeNull()
  })

  test("点入口回调 onOpen", async () => {
    let 次数 = 0
    const host = mount(() => <CaseAlertEntry projectId={() => "p"} api={假api()} onOpen={() => (次数 += 1)} />)
    await 等(() => host.querySelector("[data-slot='case-alert-count']") !== null)
    host.querySelector<HTMLElement>("[data-slot='case-alert-entry']")!.click()
    expect(次数).toBe(1)
  })

  test("没有项目 ⇒ 一句「未选择项目」，一次请求都不发", () => {
    let 发过 = 0
    const host = mount(() => (
      <CaseAlertEntry
        projectId={() => undefined}
        api={假api({
          list: async () => {
            发过 += 1
            return { kind: "ok", value: [] }
          },
        })}
        onOpen={() => {}}
      />
    ))
    expect(host.textContent).toContain("未选择项目")
    expect(发过).toBe(0)
  })

  test("换项目时迟到的旧回包不覆盖新项目（onCleanup 真的作废了旧请求）", async () => {
    const [项目, set项目] = createSignal<string | undefined>("p1")
    const 待回: Array<(回: Awaited<ReturnType<CaseAlertsApi["list"]>>) => void> = []
    const api = 假api({
      list: () =>
        new Promise((resolve) => {
          待回.push(resolve)
        }),
    })
    const host = mount(() => <CaseAlertEntry projectId={项目} api={api} onOpen={() => {}} />)
    await 等(() => 待回.length === 1)
    set项目("p2")
    await 等(() => 待回.length === 2)

    待回[1]!({ kind: "ok", value: [未读] })
    await 等(() => host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread") === "1")

    待回[0]!({ kind: "ok", value: [未读, { ...未读, id: "al-旧2" }, { ...未读, id: "al-旧3" }] })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread")).toBe("1")
  })
})
