import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { Alerts } from "./alerts"
import type { CaseDetailApi } from "../case-detail-api"
import type { CaseAlertsApi, 提醒行 } from "../../project/case-alerts-api"

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
  内容: "出 2 笔 6000 元、入 2 笔 6000 元",
  事实: { 账户: "e-账" },
  created_at: 1_700_000_000,
  read_at: null,
  handled_at: null,
}
const 另一条: 提醒行 = { ...未读, id: "al-2", rule_id: "号码多账户", 标题: "号码 138 关联了 3 个账户" }

/** `Alerts` 收两个 api：详情那个本页不用，但 `CaseView` 统一传。 */
function 假详情api(): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "未用" }),
    materialFacts: async () => ({ kind: "error", message: "未用" }),
    timeline: async () => ({ kind: "error", message: "未用" }),
    money: async () => ({ kind: "error", message: "未用" }),
    graph: async () => ({ kind: "error", message: "未用" }),
  }
}

function 假提醒api(over: Partial<CaseAlertsApi> = {}): CaseAlertsApi {
  return {
    list: async () => ({ kind: "ok", value: [未读, 另一条] }),
    refresh: async () => ({ kind: "ok", value: { 新建: 0, 提醒: [未读, 另一条] } }),
    markRead: async () => ({ kind: "ok", value: { 已读: 1 } }),
    ...over,
  }
}

describe("提醒清单", () => {
  test("列出提醒：未读带标记，标题与内容都在", async () => {
    const host = mount(() => <Alerts projectId="p" api={假详情api()} 提醒api={假提醒api()} />)
    await 等(() => host.querySelectorAll("[data-slot='alert-row']").length === 2)
    const 首行 = host.querySelector("[data-slot='alert-row']")!
    expect(首行.getAttribute("data-read")).toBe("false")
    expect(首行.querySelector("[data-slot='alert-unread']")).not.toBeNull()
    expect(host.textContent).toContain("张三 短期资金进出高度对称")
    expect(host.textContent).toContain("出 2 笔 6000 元、入 2 笔 6000 元")
  })

  test("重新比对 ⇒ 调 refresh，并把「新建 N 条」说给用户", async () => {
    let 比对次数 = 0
    const host = mount(() => (
      <Alerts
        projectId="p"
        api={假详情api()}
        提醒api={假提醒api({
          refresh: async () => {
            比对次数 += 1
            return { kind: "ok", value: { 新建: 1, 提醒: [未读, 另一条] } }
          },
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='alert-row']").length === 2)
    host.querySelector<HTMLElement>("[data-slot='alerts-refresh']")!.click()
    await 等(() => host.textContent!.includes("新建 1 条"))
    expect(比对次数).toBe(1)
  })

  test("单条与全部已读都走 markRead，成功后本地翻成已读", async () => {
    const 调用: string[][] = []
    const host = mount(() => (
      <Alerts
        projectId="p"
        api={假详情api()}
        提醒api={假提醒api({
          markRead: async (_projectId, ids) => {
            调用.push([...ids])
            return { kind: "ok", value: { 已读: ids.length } }
          },
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='alert-read']").length === 2)

    host.querySelector<HTMLElement>("[data-slot='alert-read']")!.click()
    await 等(() => host.querySelectorAll("[data-slot='alert-row'][data-read='true']").length === 1)
    expect(调用).toEqual([["al-1"]])

    host.querySelector<HTMLElement>("[data-slot='alerts-read-all']")!.click()
    await 等(() => host.querySelectorAll("[data-slot='alert-row'][data-read='true']").length === 2)
    // 只剩第二条未读 ⇒ 「全部标为已读」只把还剩下的那个交出去。
    expect(调用.at(-1)).toEqual(["al-2"])
  })

  test("没有提醒 ⇒ 一句话，不是空壳", async () => {
    const host = mount(() => (
      <Alerts projectId="p" api={假详情api()} 提醒api={假提醒api({ list: async () => ({ kind: "ok", value: [] }) })} />
    ))
    await 等(() => host.querySelector("[data-slot='alerts-empty']") !== null)
    expect(host.textContent).toContain("没有提醒")
  })

  test("取数失败如实说", async () => {
    const host = mount(() => (
      <Alerts
        projectId="p"
        api={假详情api()}
        提醒api={假提醒api({ list: async () => ({ kind: "error", message: "不是该项目成员" }) })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='alerts-error']") !== null)
    expect(host.textContent).toContain("不是该项目成员")
  })

  test("重新比对失败 ⇒ 只报错，不残留「新建」或载入文案", async () => {
    let 次数 = 0
    const host = mount(() => (
      <Alerts
        projectId="p"
        api={假详情api()}
        提醒api={假提醒api({
          refresh: async () => {
            次数 += 1
            return 次数 === 1
              ? { kind: "ok", value: { 新建: 1, 提醒: [未读, 另一条] } }
              : { kind: "error", message: "比对失败" }
          },
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='alert-row']").length === 2)
    host.querySelector<HTMLElement>("[data-slot='alerts-refresh']")!.click()
    await 等(() => host.textContent!.includes("新建 1 条"))

    host.querySelector<HTMLElement>("[data-slot='alerts-refresh']")!.click()
    await 等(() => host.querySelector("[data-slot='alerts-error']") !== null)
    expect(host.textContent).toContain("比对失败")
    expect(host.textContent).not.toContain("新建 1 条")
    expect(host.textContent).not.toContain("正在读取提醒")
  })

  test("慢的初始 list 晚到不覆盖刚 refresh 的结果", async () => {
    const 待回: Array<(回: Awaited<ReturnType<CaseAlertsApi["list"]>>) => void> = []
    const 提醒api = 假提醒api({
      list: () =>
        new Promise((resolve) => {
          待回.push(resolve)
        }),
      refresh: async () => ({
        kind: "ok",
        value: { 新建: 3, 提醒: [{ ...未读, id: "al-新", 标题: "刷新后的提醒" }] },
      }),
    })
    const host = mount(() => <Alerts projectId="p" api={假详情api()} 提醒api={提醒api} />)
    await 等(() => 待回.length === 1)

    host.querySelector<HTMLElement>("[data-slot='alerts-refresh']")!.click()
    await 等(() => host.textContent!.includes("刷新后的提醒"))

    待回[0]!({ kind: "ok", value: [{ ...未读, id: "al-旧", 标题: "旧列表的提醒" }] })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.textContent).toContain("刷新后的提醒")
    expect(host.textContent).not.toContain("旧列表的提醒")
  })

  test("注入的 api 抛 ⇒ 收成错误，不停在「正在读取提醒…」", async () => {
    const host = mount(() => (
      <Alerts
        projectId="p"
        api={假详情api()}
        提醒api={假提醒api({
          list: async () => {
            throw new Error("网络断了")
          },
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='alerts-error']") !== null)
    expect(host.textContent).toContain("网络断了")
    expect(host.textContent).not.toContain("正在读取提醒")
  })

  test("换项目时迟到的旧回包不覆盖新项目（onCleanup 真的作废了旧请求）", async () => {
    const [项目, set项目] = createSignal("p1")
    const 待回: Array<(回: Awaited<ReturnType<CaseAlertsApi["list"]>>) => void> = []
    const 提醒api = 假提醒api({
      list: () =>
        new Promise((resolve) => {
          待回.push(resolve)
        }),
    })
    const host = mount(() => <Alerts projectId={项目()} api={假详情api()} 提醒api={提醒api} />)
    await 等(() => 待回.length === 1)
    set项目("p2")
    await 等(() => 待回.length === 2)

    待回[1]!({ kind: "ok", value: [{ ...未读, id: "al-新", 标题: "新项目的提醒" }] })
    await 等(() => host.textContent!.includes("新项目的提醒"))

    待回[0]!({ kind: "ok", value: [{ ...未读, id: "al-旧", 标题: "旧项目的提醒" }] })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.textContent).not.toContain("旧项目的提醒")
  })
})
