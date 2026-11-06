import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import type { CaseDetailApi, 产物复核结果, 复核项 } from "../case-detail-api"
import { ArtifactReview } from "./artifact-review"

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

const 产物 = {
  id: "mat-1",
  path: "报告/分析.md",
  file_name: "分析.md",
  kind: "产物",
  fingerprint: "f-1",
}

const 条 = (over: Partial<复核项> = {}): 复核项 => ({
  fact_type: "entity",
  fact_id: "e-张",
  值: "张三",
  原文: "[[fact:entity:e-张]]",
  引用时间: 1_760_000_000,
  变更时间: null,
  需复核: false,
  trust_state: "自动抽取",
  ...over,
})

const 回 = (over: Partial<产物复核结果> = {}): 产物复核结果 => ({
  产物,
  引用: [条()],
  需复核: 0,
  缺口: [],
  ...over,
})

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "本用例不取档案" }),
    materialFacts: async () => ({ kind: "error", message: "本用例不取材料" }),
    timeline: async () => ({ kind: "error", message: "本用例不取时间线" }),
    money: async () => ({ kind: "error", message: "本用例不取资金" }),
    graph: async () => ({ kind: "error", message: "本用例不取关系图" }),
    review: async () => ({ kind: "ok", value: 回() }),
    ...over,
  }
}

describe("产物引用复核", () => {
  test("有要复核的 ⇒ 横幅说「有 1 条引用的依据已更新，请复核」，那条行 data-needs-review=true", async () => {
    const host = mount(() => (
      <ArtifactReview
        projectId="p"
        path="报告/分析.md"
        api={假api({
          review: async () => ({
            kind: "ok",
            value: 回({
              引用: [条({ 需复核: true, 变更时间: 1_760_000_100 })],
              需复核: 1,
            }),
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='artifact-review-banner']") !== null)
    expect(host.querySelector("[data-slot='artifact-review-banner']")!.textContent).toContain(
      "有 1 条引用的依据已更新，请复核",
    )
    expect(host.querySelector("[data-slot='artifact-review-row']")!.getAttribute("data-needs-review")).toBe("true")
    expect(host.querySelector("[data-slot='artifact-review-needs']")!.textContent).toContain("请复核")
  })

  test("没有要复核的 ⇒ 不摆横幅，引用照样列出", async () => {
    const host = mount(() => (
      <ArtifactReview
        projectId="p"
        path="报告/分析.md"
        api={假api({
          review: async () => ({ kind: "ok", value: 回({ 引用: [条(), 条({ fact_id: "r-1", 值: "张三 → 李四 转账" })] }) }),
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='artifact-review-row']").length === 2)
    expect(host.querySelector("[data-slot='artifact-review-banner']")).toBeNull()
    expect(host.querySelector("[data-slot='artifact-review-title']")!.textContent).toContain("引用了 2 条事实")
    expect(host.querySelector("[data-slot='artifact-review-row']")!.getAttribute("data-needs-review")).toBe("false")
  })

  test("没登记过 ⇒ 摆缺口那句话（不摆空壳）", async () => {
    const host = mount(() => (
      <ArtifactReview
        projectId="p"
        path="报告/没有.md"
        api={假api({
          review: async () => ({
            kind: "ok",
            value: { 产物: null, 引用: [], 需复核: 0, 缺口: ["这个路径下还没有登记过引用：保存一次带 [[fact:…]] 标记的报告就会登记"] },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='artifact-review-gap']") !== null)
    expect(host.querySelector("[data-slot='artifact-review-gap']")!.textContent).toContain("还没有登记过引用")
    expect(host.querySelectorAll("[data-slot='artifact-review-row']").length).toBe(0)
  })

  test("产物为 null ⇒ 不摆标题、不摆「0 条事实 / 没有引用任何事实」（没读到的东西不下断言）", async () => {
    const host = mount(() => (
      <ArtifactReview
        projectId="p"
        path="报告/没有.md"
        api={假api({
          review: async () => ({
            kind: "ok",
            value: {
              产物: null,
              引用: [],
              需复核: 0,
              缺口: ["这个路径下还没有登记过引用：保存一次带 [[fact:…]] 标记的报告就会登记"],
            },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='artifact-review-gap']") !== null)
    expect(host.querySelector("[data-slot='artifact-review-title']")).toBeNull()
    expect(host.querySelector("[data-slot='artifact-review-empty']")).toBeNull()
    expect(host.textContent).not.toContain("0 条事实")
    expect(host.textContent).not.toContain("没有引用任何事实")
  })

  test("引用的事实已被排除 ⇒ 行内用文字标「已排除」（不只靠颜色）", async () => {
    const host = mount(() => (
      <ArtifactReview
        projectId="p"
        path="报告/分析.md"
        api={假api({
          review: async () => ({ kind: "ok", value: 回({ 引用: [条({ trust_state: "已排除" })] }) }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='artifact-review-row']") !== null)
    const 标签 = host.querySelector("[data-slot='artifact-review-excluded']")
    expect(标签).not.toBeNull()
    expect(标签!.textContent).toContain("已排除")
  })

  test("取数失败如实说", async () => {
    const host = mount(() => (
      <ArtifactReview
        projectId="p"
        path="报告/分析.md"
        api={假api({ review: async () => ({ kind: "error", message: "不是该项目成员" }) })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='artifact-review-error']") !== null)
    expect(host.querySelector("[data-slot='artifact-review-error']")!.textContent).toBe("不是该项目成员")
    expect(host.querySelector("[data-slot='artifact-review-title']")).toBeNull()
  })
})
