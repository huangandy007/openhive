import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createSignal, type JSX } from "solid-js"
import { CaseRerunDialog } from "./case-rerun-dialog"
import { createCaseIngestApi } from "./case-ingest-api"

/**
 * 016 T017 · 重跑弹窗的组件用例。
 *
 * 两条纪律在用例里落地：
 * - 「元素不存在」用**布尔比较**（`#013-12`）；
 * - 成员分支的按钮不只是 `disabled`：点击（`dispatchEvent`，绕过浏览器的 disabled 抑制）
 *   后 `send` 次数**不增**，证明 handler 根本没绑（`#005-47`）。
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

const 扫描行 = {
  合计: 2,
  候选: {
    目录独有: [],
    未入队: [
      { materialId: "m1", path: "资料/旧1.xlsx" },
      { materialId: "m2", path: "资料/旧2.xlsx" },
    ],
    未识别: [],
  },
  样本: ["资料/旧1.xlsx"],
  截断: false,
}

/** 真客户端 + 计数替身：只数 `send` 次数，顺便按 URL 回对应形状。 */
function 假服务(选项: { 截断?: boolean } = {}) {
  const 记 = { 次数: 0, 请求: [] as Array<{ url: string; body?: unknown }> }
  const send = async (url: string, init?: RequestInit) => {
    记.次数 += 1
    if (url.includes("/scan")) return 回({ ...扫描行, 截断: 选项.截断 ?? false })
    if (url.includes("/rerun")) {
      记.请求.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
      return 回({ 已入队: 4, 跳过: [{ path: "a.xlsx", 原因: "已在跑" }], 失败: [] })
    }
    return 回({ error: "未知路径", code: "not_found" }, 404)
  }
  return { 记, api: createCaseIngestApi(send) }
}

describe("重跑弹窗", () => {
  test("打开即扫描：合计与三类分项上屏，无截断警示；一键重跑发出对应范围并显示结果", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => <CaseRerunDialog projectId="p1" 是属主={true} api={api} />)

    await 等(() => host.querySelector("[data-slot='case-rerun-total']") !== null)
    expect(host.querySelector("[data-slot='case-rerun-total']")!.textContent).toContain("合计 2 个候选")
    expect(host.querySelector("[data-slot='case-rerun-counts']")!.textContent).toContain("目录独有 0")
    expect(host.querySelector("[data-slot='case-rerun-counts']")!.textContent).toContain("未入队 2")
    expect(host.querySelector("[data-slot='case-rerun-counts']")!.textContent).toContain("未识别 0")
    expect(host.querySelector("[data-slot='case-rerun-truncated']") === null).toBe(true)

    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='case-rerun-run']")!
    expect(按钮.disabled).toBe(false)
    按钮.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await 等(() => host.querySelector("[data-slot='case-rerun-result']") !== null)

    const 重跑请求 = 记.请求.find((项) => 项.url.includes("/rerun"))
    // 空类不提交：本案只有「未入队」非空 ⇒ 范围恰为一项（删掉非空过滤这条会红）。
    expect(重跑请求?.body).toEqual({
      projectId: "p1",
      范围: ["未入队"],
    })
    expect(host.querySelector("[data-slot='case-rerun-result']")!.textContent).toContain("已入队 4")
    expect(host.querySelector("[data-slot='case-rerun-result']")!.textContent).toContain("跳过 1")
  })

  test("截断=true ⇒ 出现警示文案", async () => {
    const { api } = 假服务({ 截断: true })
    const host = mount(() => <CaseRerunDialog projectId="p1" 是属主={true} api={api} />)
    await 等(() => host.querySelector("[data-slot='case-rerun-truncated']") !== null)
    expect(host.textContent).toContain("候选过多")
  })

  test("成员：按钮置灰 + 原因可见 + 点击后 send 次数不增（handler 未绑）", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => <CaseRerunDialog projectId="p1" 是属主={false} api={api} />)
    await 等(() => host.querySelector("[data-slot='case-rerun-total']") !== null)

    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='case-rerun-run']")!
    expect(按钮.disabled).toBe(true)
    expect(host.querySelector("[data-slot='case-rerun-reason']")!.textContent).toContain("需要项目属主")

    const 点前 = 记.次数
    // `disabled` 只是外观：happy-dom（同浏览器）不会给 disabled 控件派发点击，
    // 所以先去掉外观再点——模拟绕过置灰的手法。真闸是「不绑 handler」。
    按钮.disabled = false
    按钮.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    // 布尔比较：没有发出重跑请求（`#013-12`）。
    expect(记.次数 === 点前).toBe(true)
    expect(记.请求.length === 0).toBe(true)
  })

  test("切项目后，切走前发出的重跑晚到 ⇒ 旧回包不回写（#010-05）", async () => {
    let 放行重跑: (() => void) | undefined
    const 重跑闸 = new Promise<void>((resolve) => {
      放行重跑 = resolve
    })
    let 重跑已发 = false
    const send = async (url: string) => {
      if (url.includes("/scan")) {
        if (url.includes("projectId=p1")) return 回(扫描行)
        return 回({
          合计: 0,
          候选: { 目录独有: [], 未入队: [], 未识别: [] },
          样本: [],
          截断: false,
        })
      }
      if (url.includes("/rerun")) {
        重跑已发 = true
        await 重跑闸
        return 回({ 已入队: 4, 跳过: [], 失败: [] })
      }
      return 回({ error: "未知路径", code: "not_found" }, 404)
    }
    const api = createCaseIngestApi(send)
    const [项目, set项目] = createSignal("p1")
    const host = mount(() => <CaseRerunDialog projectId={项目()} 是属主={true} api={api} />)

    await 等(() => host.querySelector("[data-slot='case-rerun-total']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='case-rerun-run']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    await 等(() => 重跑已发)

    set项目("p2")
    await 等(() => host.querySelector("[data-slot='case-rerun-total']")?.textContent?.includes("合计 0") === true)
    放行重跑!()
    await new Promise((resolve) => setTimeout(resolve, 30))

    // 布尔比较：切项目后，旧项目的重跑结果不得出现（`#013-12`）。
    const 有旧结果 = host.querySelector("[data-slot='case-rerun-result']") !== null
    expect(有旧结果).toBe(false)
  })
})
