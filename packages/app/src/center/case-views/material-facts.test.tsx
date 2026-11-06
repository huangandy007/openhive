import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { MaterialFacts } from "./material-facts"
import type { CaseDetailApi, 材料事实清单结果 } from "../case-detail-api"

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

const 清单: 材料事实清单结果 = {
  材料: {
    id: "m-1",
    path: "材料/话单.xlsx",
    file_name: "话单.xlsx",
    kind: "话单",
    parse_status: "解析完成",
    parse_detail: { rows: 2 },
  },
  分组: [
    {
      sheet: "Sheet#1",
      行们: [
        {
          row_no: 2,
          事实们: [
            { fact_type: "entity", fact_id: "e-张", 值: "张三", trust_state: "自动抽取" },
            { fact_type: "relation", fact_id: "r-1", 值: "张三 → 李四 通话", trust_state: "自动抽取" },
          ],
        },
      ],
    },
    { sheet: "通话明细", 行们: [] },
  ],
  缺口: ["这份材料有 3 行没抽成事实"],
}

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "本用例不取档案" }),
    materialFacts: async () => ({ kind: "ok", value: 清单 }),
    timeline: async () => ({ kind: "ok", value: { 数据: [] } }),
    money: async () => ({ kind: "ok", value: { 数据: {} } }),
    graph: async () => ({ kind: "ok", value: { 节点: [], 边: [], 缺口: [] } }),
    ...over,
  }
}

describe("材料抽取结果", () => {
  test("按工作表分组，行上列出这一行的全部事实", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    const 组们 = [...host.querySelectorAll<HTMLElement>("[data-slot='material-facts-sheet']")]
    expect(组们.map((组) => 组.textContent)).toEqual(["Sheet#1", "通话明细"])
    const 行 = host.querySelector<HTMLElement>("[data-slot='material-facts-row']")!
    expect(行.textContent).toContain("第 2 行")
    expect(行.textContent).toContain("张三")
    expect(行.textContent).toContain("张三 → 李四 通话")
  })

  test("空工作表与空分组都说清楚，不画一片空白", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.textContent!.includes("通话明细"))
    expect(host.querySelectorAll("[data-slot='material-facts-empty-sheet']").length).toBe(1)
  })

  test("缺口如实列出来（截断 / 未抽取的都要说）", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.textContent!.includes("这份材料有 3 行没抽成事实"))
    expect(host.querySelectorAll("[data-slot='material-facts-gap']").length).toBe(1)
  })

  test("解析未完成时把 parse_detail 摆出来（哪一步卡住要比「未完成」有用）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: { ...清单, 材料: { ...清单.材料, parse_status: "解析失败", parse_detail: { reason: "第 3 列缺表头" } } },
          }),
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='material-facts-detail']").length === 1)
    expect(host.querySelector("[data-slot='material-facts-detail']")!.textContent).toContain("第 3 列缺表头")
  })

  test("解析完成时不摆 parse_detail（那是给失败看的，不是常驻噪音）", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(host.querySelector("[data-slot='material-facts-detail']")).toBeNull()
  })

  test("取数失败如实说（404 的原文照搬）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="没有.xlsx"
        api={假api({ materialFacts: async () => ({ kind: "error", message: "这个项目里没有这份材料" }) })}
      />
    ))
    await 等(() => host.textContent!.includes("这个项目里没有这份材料"))
    expect(host.querySelector("[data-slot='material-facts-sheet']")).toBeNull()
  })

  test("一份事实都没有时给一句话，不是空壳", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({ kind: "ok", value: { ...清单, 分组: [], 缺口: [] } }),
        })}
      />
    ))
    await 等(() => host.textContent!.includes("这份材料还没有登记事实"))
  })
})
