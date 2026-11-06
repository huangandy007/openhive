import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { MaterialFacts } from "./material-facts"
import type { CaseDetailApi, 材料事实清单结果 } from "../case-detail-api"
import type { 结果 } from "../../project/entity-api"

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
    parse_status: "已解析",
    // 成功时 detail 照样有内容（模型/提示词版本/切片数…，服务端写得出来）——
    // 但页面不该摆它：那是机器噪声，不是给民警看的原因。
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
    review: async () => ({ kind: "ok", value: { 产物: null, 引用: [], 需复核: 0, 缺口: [] } }),
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

  test("「有问题」时把 parse_detail 摆出来（哪一步卡住要比「有问题」有用）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: { ...清单, 材料: { ...清单.材料, parse_status: "有问题", parse_detail: { reason: "第 3 列缺表头" } } },
          }),
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='material-facts-detail']").length === 1)
    expect(host.querySelector("[data-slot='material-facts-detail']")!.textContent).toContain("第 3 列缺表头")
  })

  test("「已解析」时即使 detail 非空也不摆（成功时的 detail 是机器噪声）", async () => {
    const host = mount(() => <MaterialFacts projectId="p" path="材料/话单.xlsx" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(host.querySelector("[data-slot='material-facts-detail']")).toBeNull()
  })

  test("回包未到之前说「正在读取抽取结果…」，到了就撤掉", async () => {
    const 在飞: Array<(值: 结果<材料事实清单结果>) => void> = []
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({ materialFacts: () => new Promise<结果<材料事实清单结果>>((收) => 在飞.push(收)) })}
      />
    ))
    await 等(() => 在飞.length === 1)
    expect(host.querySelector("[data-slot='material-facts-loading']")!.textContent).toContain("正在读取抽取结果")

    在飞[0]({ kind: "ok", value: 清单 })
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(host.querySelector("[data-slot='material-facts-loading']")).toBeNull()
  })

  test("换材料时迟到的旧回包不覆盖新结果（`onCleanup` 作废旧请求）", async () => {
    const 在飞: Array<(值: 结果<材料事实清单结果>) => void> = []
    const [路径, set路径] = createSignal("材料/旧.xlsx")
    const api = 假api({ materialFacts: () => new Promise<结果<材料事实清单结果>>((收) => 在飞.push(收)) })
    const host = mount(() => <MaterialFacts projectId="p" path={路径()} api={api} />)
    await 等(() => 在飞.length === 1)

    set路径("材料/新.xlsx")
    await 等(() => 在飞.length === 2)

    const 造 = (名: string): 材料事实清单结果 => ({
      ...清单,
      材料: { ...清单.材料, path: `材料/${名}.xlsx`, file_name: `${名}.xlsx`, parse_detail: null },
      分组: [{ sheet: 名, 行们: [{ row_no: 1, 事实们: [{ fact_type: "entity", fact_id: `e-${名}`, 值: 名, trust_state: "自动抽取" }] }] }],
    })

    // 先回新的，后回旧的。
    在飞[1]({ kind: "ok", value: 造("新") })
    await 等(() => host.querySelector("[data-slot='material-facts-title']")?.textContent?.includes("新.xlsx") === true)

    在飞[0]({ kind: "ok", value: 造("旧") })
    // 给旧回包足够的时间落地（若没被作废，这里之后屏幕上就是旧材料）。
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(host.textContent).not.toContain("旧")
    expect(host.querySelectorAll("[data-slot='material-facts-sheet']").length).toBe(1)
    expect(host.querySelector("[data-slot='material-facts-sheet']")!.textContent).toBe("新")
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

  test("缺口非空时不再摆「还没有登记事实」的通用空态（两句不能打架）", async () => {
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/排除.xlsx"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            value: {
              ...清单,
              分组: [],
              缺口: ["没有可见引用：可能还没解析，或引用的事实均已排除"],
            },
          }),
        })}
      />
    ))
    await 等(() => host.textContent!.includes("没有可见引用"))
    expect(host.querySelector("[data-slot='material-facts-empty']")).toBeNull()
    expect(host.textContent).not.toContain("这份材料还没有登记事实")
  })

  test("默认不带 includeExcluded；打开「显示已排除」后带 true，并按新回包更新", async () => {
    const 调用: Array<boolean | undefined> = []
    const 含排除: 材料事实清单结果 = {
      ...清单,
      分组: [
        {
          sheet: "Sheet#1",
          行们: [
            {
              row_no: 2,
              事实们: [
                ...清单.分组[0]!.行们[0]!.事实们,
                { fact_type: "entity", fact_id: "e-排除", 值: "被排除的人", trust_state: "已排除" },
              ],
            },
          ],
        },
      ],
      缺口: [],
    }
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="材料/话单.xlsx"
        api={假api({
          materialFacts: async (_projectId, _path, includeExcluded) => {
            调用.push(includeExcluded)
            return { kind: "ok", value: includeExcluded === true ? 含排除 : 清单 }
          },
        })}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='material-facts-sheet']").length === 2)
    expect(调用[0]).not.toBe(true)

    const 开关 = host.querySelector<HTMLElement>("[data-slot='material-facts-include-excluded']")!
    expect(开关.getAttribute("aria-pressed")).toBe("false")
    开关.click()

    await 等(() => 调用.length === 2)
    expect(调用[1]).toBe(true)
    await 等(() => host.textContent!.includes("被排除的人"))
    expect(
      host.querySelector("[data-slot='material-facts-include-excluded']")!.getAttribute("aria-pressed"),
    ).toBe("true")
  })

  test("产物路径 ⇒ 不摆抽取分组，改成引用复核区", async () => {
    const 产物行 = { id: "mat-1", path: "报告/分析.md", file_name: "分析.md", kind: "产物", fingerprint: "f-1" }
    const host = mount(() => (
      <MaterialFacts
        projectId="p"
        path="报告/分析.md"
        api={假api({
          materialFacts: async () => ({
            kind: "ok",
            // 产物行的真实状态恒为「未入队」（0031 的 CHECK）；这里按库里的实际值给夹具。
            value: { ...清单, 材料: { ...清单.材料, kind: "产物", parse_status: "未入队" } },
          }),
          review: async () => ({
            kind: "ok",
            value: { 产物: 产物行, 引用: [], 需复核: 0, 缺口: ["这份产物没有引用任何事实"] },
          }),
        })}
      />
    ))
    await 等(() => host.querySelector("[data-slot='artifact-review-title']") !== null)
    expect(host.querySelector("[data-slot='material-facts-sheet']")).toBeNull()
    // 产物没有 sheet / row 定位：材料事实清单那句「这份材料还没有登记事实」对产物是错的，不许露出来。
    expect(host.querySelector("[data-slot='material-facts-empty']")).toBeNull()
    expect(host.querySelector("[data-slot='artifact-review-gap']")!.textContent).toContain("没有引用任何事实")
  })
})
