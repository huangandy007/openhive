import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { CaseView } from "./case-view"
import type { CaseDetailApi, 实体档案 } from "./case-detail-api"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
afterEach(() => {
  document.body.innerHTML = ""
})

async function 等(条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}

const 档 = {
  id: "e-张", type: "人", canonical_value: "张三", aliases: [], attrs: {},
  trust_state: "自动抽取", created_at: 1, 关系: [], 事件: [], 引用: [], 一句话: "张三。",
} as 实体档案

const api: CaseDetailApi = {
  profile: async () => ({ kind: "ok", value: 档 }),
  materialFacts: async () => ({ kind: "error", message: "未用" }),
  timeline: async () => ({ kind: "ok", value: { 数据: [] } }),
  money: async () => ({ kind: "ok", value: { 数据: {} } }),
  graph: async () => ({ kind: "ok", value: { 节点: [], 边: [], 缺口: [] } }),
}

describe("案件视图外壳", () => {
  test("路径解析不了 ⇒ 说「打不开这个视图」，不去猜是谁", () => {
    const host = mount(() => <CaseView path="case://p-1/other/x" api={api} />)
    expect(host.querySelector("[data-slot='case-view-unopenable']")).not.toBeNull()
  })

  test("没注入 api ⇒ 说「案件视图未接入」，不偷偷发请求", () => {
    const host = mount(() => <CaseView path="case://p-1/entity/e-%E5%BC%A0" />)
    expect(host.querySelector("[data-slot='case-view-not-wired']")).not.toBeNull()
  })

  test("实体路径 ⇒ 渲染实体档案", async () => {
    const host = mount(() => <CaseView path="case://p-1/entity/e-%E5%BC%A0" api={api} />)
    await 等(() => host.querySelectorAll("[data-slot='entity-profile-title']").length === 1)
    expect(host.querySelector("[data-slot='entity-profile-title']")!.textContent).toContain("张三")
  })

  test("材料路径 ⇒ 渲染材料抽取结果", async () => {
    const 材料api: CaseDetailApi = {
      ...api,
      materialFacts: async () => ({
        kind: "ok",
        value: {
          材料: { id: "m-1", path: "话单.xlsx", file_name: "话单.xlsx", kind: "话单", parse_status: "解析完成", parse_detail: null },
          分组: [],
          缺口: [],
        },
      }),
    }
    const host = mount(() => (
      <CaseView path={`case://p-1/material/${encodeURIComponent("材料/话单.xlsx")}`} api={材料api} />
    ))
    await 等(() => host.querySelectorAll("[data-slot='material-facts-title']").length === 1)
    expect(host.querySelector("[data-slot='material-facts-title']")!.textContent).toContain("话单.xlsx")
  })
})
