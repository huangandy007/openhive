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
  test("挂载即先比对（refresh），并用它自己的回包渲染「新提醒 1 条」", async () => {
    let 刷新 = 0
    let 列表 = 0
    const api = 假api({
      refresh: async () => {
        刷新 += 1
        return { kind: "ok", value: { 新建: 1, 提醒: [未读] } }
      },
      list: async () => {
        列表 += 1
        return { kind: "ok", value: [] }
      },
    })
    const host = mount(() => <CaseAlertEntry projectId={() => "提醒-首次"} api={api} onOpen={() => {}} />)
    await 等(() => host.querySelector("[data-slot='case-alert-count']") !== null)
    expect(刷新).toBe(1)
    expect(列表).toBe(0)
    expect(host.querySelector("[data-slot='case-alert-count']")!.textContent).toContain("新提醒 1 条")
    expect(host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread")).toBe("1")
  })

  test("全部已读 ⇒ 说「没有新提醒」，入口仍在（还能点进清单看历史）", async () => {
    // ⚠️ 不能等 `data-unread === "0"` 或「没有新提醒」：**初始渲染**（回包还没回来）就已经满足，
    // 用例会在回包落地前就绿。这里先等替身打出「可回包」标记，再用一个**宏任务**让消费方的
    // `.then`（微任务）先跑完，之后才断言最终文案。
    let 回包: (() => void) | undefined
    const api = 假api({
      refresh: () =>
        new Promise((resolve) => {
          回包 = () => resolve({ kind: "ok", value: { 新建: 0, 提醒: [{ ...未读, read_at: 2 }] } })
        }),
    })
    const host = mount(() => <CaseAlertEntry projectId={() => "提醒-全读"} api={api} onOpen={() => {}} />)
    await 等(() => 回包 !== undefined)
    回包!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread")).toBe("0")
    expect(host.textContent).toContain("没有新提醒")
    expect(host.querySelector("[data-slot='case-alert-count']")).toBeNull()
  })

  test("比对回 error ⇒ 只说「读取失败」，不退回 list 的旧结果", async () => {
    let 列表 = 0
    const api = 假api({
      refresh: async () => ({ kind: "error", message: "不是该项目成员" }),
      list: async () => {
        列表 += 1
        return { kind: "ok", value: [未读] }
      },
    })
    const host = mount(() => <CaseAlertEntry projectId={() => "提醒-错误"} api={api} onOpen={() => {}} />)
    await 等(() => host.querySelector("[data-slot='case-alert-error']") !== null)
    expect(host.textContent).toContain("读取失败")
    expect(host.textContent).not.toContain("没有新提醒")
    expect(host.textContent).not.toContain("新提醒 1 条")
    expect(列表).toBe(0)
    expect(host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread")).toBe("0")
  })

  test("注入的 api 抛 ⇒ 收成「读取失败」，不留 unhandled rejection", async () => {
    const host = mount(() => (
      <CaseAlertEntry
        projectId={() => "提醒-抛"}
        api={假api({
          refresh: async () => {
            throw new Error("网络断了")
          },
        })}
        onOpen={() => {}}
      />
    ))
    await 等(() => host.querySelector("[data-slot='case-alert-error']") !== null)
    expect(host.textContent).toContain("读取失败")
    expect(host.textContent).not.toContain("没有新提醒")
  })

  test("点入口回调 onOpen", async () => {
    let 次数 = 0
    const host = mount(() => (
      <CaseAlertEntry projectId={() => "提醒-点击"} api={假api()} onOpen={() => (次数 += 1)} />
    ))
    await 等(() => host.querySelector("[data-slot='case-alert-count']") !== null)
    host.querySelector<HTMLElement>("[data-slot='case-alert-entry']")!.click()
    expect(次数).toBe(1)
  })

  test("没有项目 ⇒ 一句「未选择项目」，一次请求都不发", () => {
    let 刷新 = 0
    let 列表 = 0
    const host = mount(() => (
      <CaseAlertEntry
        projectId={() => undefined}
        api={假api({
          refresh: async () => {
            刷新 += 1
            return { kind: "ok", value: { 新建: 0, 提醒: [] } }
          },
          list: async () => {
            列表 += 1
            return { kind: "ok", value: [] }
          },
        })}
        onOpen={() => {}}
      />
    ))
    expect(host.textContent).toContain("未选择项目")
    expect(刷新).toBe(0)
    expect(列表).toBe(0)
  })

  test("同一项目二次挂载不再打 refresh：同一会话只比对一次，改读清单", async () => {
    let 刷新 = 0
    let 列表 = 0
    const api = 假api({
      refresh: async () => {
        刷新 += 1
        return { kind: "ok", value: { 新建: 1, 提醒: [未读] } }
      },
      list: async () => {
        列表 += 1
        return { kind: "ok", value: [未读] }
      },
    })
    const 项目 = "提醒-二次"

    const 首屏 = document.createElement("div")
    document.body.appendChild(首屏)
    const 卸载 = render(() => <CaseAlertEntry projectId={() => 项目} api={api} onOpen={() => {}} />, 首屏)
    await 等(() => 首屏.querySelector("[data-slot='case-alert-count']") !== null)
    卸载()

    const 二屏 = document.createElement("div")
    document.body.appendChild(二屏)
    render(() => <CaseAlertEntry projectId={() => 项目} api={api} onOpen={() => {}} />, 二屏)
    await 等(() => 二屏.querySelector("[data-slot='case-alert-count']") !== null)

    expect(刷新).toBe(1)
    expect(列表).toBe(1)
  })

  test("换项目时迟到的旧回包不覆盖新项目（onCleanup 真的作废了旧请求）", async () => {
    const [项目, set项目] = createSignal<string | undefined>("提醒-旧")
    const 待回: Array<(回: Awaited<ReturnType<CaseAlertsApi["refresh"]>>) => void> = []
    const api = 假api({
      refresh: () =>
        new Promise((resolve) => {
          待回.push(resolve)
        }),
    })
    const host = mount(() => <CaseAlertEntry projectId={项目} api={api} onOpen={() => {}} />)
    await 等(() => 待回.length === 1)
    set项目("提醒-新")
    await 等(() => 待回.length === 2)

    待回[1]!({ kind: "ok", value: { 新建: 1, 提醒: [未读] } })
    await 等(() => host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread") === "1")

    待回[0]!({
      kind: "ok",
      value: { 新建: 3, 提醒: [未读, { ...未读, id: "al-旧2" }, { ...未读, id: "al-旧3" }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.querySelector("[data-slot='case-alert-entry']")!.getAttribute("data-unread")).toBe("1")
  })
})
