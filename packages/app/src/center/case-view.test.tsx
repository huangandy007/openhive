import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { CaseView } from "./case-view"
import type { CaseDetailApi, 实体档案 } from "./case-detail-api"
import type { CaseAlertsApi } from "../project/case-alerts-api"

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
  review: async () => ({ kind: "error", message: "本用例不取复核" }),
  trust: async () => ({ kind: "error", message: "本用例不裁决" }),
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

  test("材料路径 ⇒ 渲染材料抽取结果；标题取 file_name，api 收到解码后的路径", async () => {
    // ⚠️ `file_name` 与 `path` **必须不同**，否则「标题渲染的是哪一个」这条断言分辨不出来。
    const 收到: string[] = []
    const 材料api: CaseDetailApi = {
      ...api,
      materialFacts: async (_projectId, path) => {
        收到.push(path)
        return {
          kind: "ok",
          value: {
            材料: { id: "m-1", path: "材料/话单.xlsx", file_name: "话单（甲）.xlsx", kind: "话单", parse_status: "已解析", parse_detail: null },
            分组: [],
            缺口: [],
          },
        }
      },
    }
    const host = mount(() => (
      <CaseView path={`case://p-1/material/${encodeURIComponent("材料/话单.xlsx")}`} api={材料api} />
    ))
    await 等(() => host.querySelectorAll("[data-slot='material-facts-title']").length === 1)
    expect(host.querySelector("[data-slot='material-facts-title']")!.textContent).toContain("话单（甲）.xlsx")
    // 传下去的必须是解码后的 `arg`，不是 tab 里那串 `%E6%9D%90%E6%96%99…`。
    expect(收到).toEqual(["材料/话单.xlsx"])
  })

  test("档案页点「时间线」⇒ 通过 open 交出一条新 tab 的标题与路径", async () => {
    const 收到: Array<{ title: string; path: string }> = []
    const host = mount(() => (
      <CaseView path="case://p-1/entity/e-%E5%BC%A0" api={api} open={(输入) => 收到.push(输入)} />
    ))
    await 等(() => host.querySelectorAll("[data-slot='entity-open-timeline']").length === 1)
    host.querySelector<HTMLElement>("[data-slot='entity-open-timeline']")!.click()
    expect(收到).toEqual([{ title: "张三 · 时间线", path: "case://p-1/timeline/e-%E5%BC%A0" }])
  })

  test("时间线 / 资金 / 关系图路径各自渲染对应视图", async () => {
    for (const [view, slot] of [
      ["timeline", "timeline-event"],
      ["money", "money-summary"],
      ["graph", "graph-node"],
    ] as const) {
      const host = mount(() => (
        <CaseView
          path={`case://p-1/${view}/e-%E5%BC%A0`}
          api={{
            ...api,
            timeline: async () => ({
              kind: "ok",
              value: { 数据: [{ id: "ev-1", type: "见面", occurred_at: 1, participants: [], summary: "见面" }] },
            }),
            money: async () => ({ kind: "ok", value: { 数据: { 汇总: [{ 方向: "出", 笔数: 1, 合计: "1.00" }] } } }),
            graph: async () => ({
              kind: "ok",
              value: {
                节点: [
                  { id: "e-张", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1 },
                  { id: "e-李", type: "人", value: "李四", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 },
                ],
                边: [{ id: "r-1", from: "e-张", to: "e-李", type: "通话", times: 1, amount: null, trust_state: "自动抽取" }],
                缺口: [],
              },
            }),
          }}
        />
      ))
      await 等(() => host.querySelectorAll(`[data-slot='${slot}']`).length > 0)
      document.body.innerHTML = ""
    }
  })

  test("关系图点节点 ⇒ 面板「打开档案」交出实体档案；「以此为中心」交出同一视图的新中心", async () => {
    // 第二参数是「开在哪一栏」的提示：只有「打开档案」要求去另一栏（分屏时并排看），
    // 「以此为中心」是钻取，仍在原栏换图。
    const 收到: Array<{ title: string; path: string; 选项?: unknown }> = []
    const host = mount(() => (
      <CaseView
        path="case://p-1/graph/e-%E5%BC%A0"
        api={{
          ...api,
          graph: async () => ({
            kind: "ok",
            value: {
              节点: [
                { id: "e-张", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1 },
                { id: "e-李", type: "人", value: "李四", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 },
              ],
              边: [{ id: "r-1", from: "e-张", to: "e-李", type: "通话", times: 1, amount: null, trust_state: "自动抽取" }],
              缺口: [],
            },
          }),
        }}
        open={(输入, 选项) => 收到.push({ ...输入, 选项 })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 2)
    // SVG 的 `<g>` 在 happy-dom 里没有 `.click()`，走真实事件派发（同 `graph.test.tsx`）。
    host.querySelector<SVGGElement>("[data-slot='graph-node'][data-node-id='e-李']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    // 点节点只开检视面板，不直接跳档案（改版后的交互：hover 聚焦、点选钉住、面板里再动）。
    expect(收到).toEqual([])
    host.querySelector<HTMLElement>("[data-slot='graph-panel-open']")!.click()
    expect(收到).toEqual([
      { title: "李四 · 人", path: "case://p-1/entity/e-%E6%9D%8E", 选项: { 另一栏: true } },
    ])

    host.querySelector<HTMLElement>("[data-slot='graph-panel-focus']")!.click()
    expect(收到.at(-1)).toEqual({
      title: "李四 · 关系图",
      path: "case://p-1/graph/e-%E6%9D%8E",
      选项: undefined,
    })
  })

  test("提醒路径 ⇒ 渲染提醒清单（注入的提醒 api）", async () => {
    const 提醒api: CaseAlertsApi = {
      list: async () => ({
        kind: "ok",
        value: [
          {
            id: "al-1",
            rule_id: "资金对称",
            标题: "张三 短期资金进出高度对称",
            内容: "出 2 笔、入 2 笔",
            事实: null,
            created_at: 1,
            read_at: null,
            handled_at: null,
          },
        ],
      }),
      refresh: async () => ({ kind: "ok", value: { 新建: 0, 提醒: [] } }),
      markRead: async () => ({ kind: "ok", value: { 已读: 1 } }),
    }
    const host = mount(() => <CaseView path="case://p-1/alerts/all" api={api} 提醒api={提醒api} />)
    await 等(() => host.querySelectorAll("[data-slot='alert-row']").length === 1)
    expect(host.textContent).toContain("张三 短期资金进出高度对称")
  })
})
