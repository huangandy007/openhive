/**
 * T018：图例（四条说明 + 可折叠）。
 *
 * 图例放在 `<svg>` 内、viewport 之后（R74）：T015 只序列化这个 svg，放外面导出会丢。
 * 折叠开关是**本地 UI 态**：不写文件、不进撤销栈、不调动作表。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { 图例 } from "./legend"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const 取 = (选择器: string) => document.body.querySelector(选择器)
const 条目数 = () => document.querySelectorAll("[data-slot='hgraph-legend'] [data-slot='hgraph-legend-item']").length
const 点 = (选择器: string) => {
  const 元素 = 取(选择器)
  expect(元素 !== null).toBe(true)
  元素!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function 挂(初始收起?: boolean) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <图例 初始收起={初始收起} />, host))
  // 前提（`#005-18` / `#013-12`）：图例确实渲染出了元素，避免「整块没挂上」把缺失断言衬成假绿。
  expect(host.firstElementChild !== null).toBe(true)
}

describe("T018 · 图例", () => {
  test("默认展开：四条说明齐（线粗 / 环粗 / 实虚 / 箭头）", () => {
    挂()
    expect(条目数()).toBe(4)
    const 文本 = 取("[data-slot='hgraph-legend']")!.textContent ?? ""
    expect(文本).toContain("线粗 = 关系强弱")
    expect(文本).toContain("环粗 = 连接多少")
    expect(文本).toContain("实线 = 事实，虚线 = 推断")
    expect(文本).toContain("箭头 = 方向")
    expect(取("[data-slot='hgraph-legend-collapsed']") === null).toBe(true)
  })

  test("初始收起：挂载即收起态（0 条 +「图例」），点开恢复 4 条", () => {
    挂(true)
    expect(条目数()).toBe(0)
    expect(取("[data-slot='hgraph-legend-collapsed']") !== null).toBe(true)

    点("[data-slot='hgraph-legend-collapsed']")
    expect(条目数()).toBe(4)
    expect(取("[data-slot='hgraph-legend-collapsed']") === null).toBe(true)
  })

  test("展开态点 toggle ⇒ 收起（0 条），再点收起条 ⇒ 恢复 4 条", () => {
    挂()
    expect(条目数()).toBe(4)
    点("[data-slot='hgraph-legend-toggle']")
    expect(条目数()).toBe(0)
    expect(取("[data-slot='hgraph-legend-collapsed']") !== null).toBe(true)
    点("[data-slot='hgraph-legend-collapsed']")
    expect(条目数()).toBe(4)
  })
})
