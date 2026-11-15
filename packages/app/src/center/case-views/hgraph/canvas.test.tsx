/**
 * T018：画布视觉规格（形状 / 边几何 / 外环 / 弱线 / 图例挂载）。
 *
 * 组件级断言只读 DOM 属性，**不重算几何**：偏移、档、形状都由 `geometry.ts` 的纯函数
 * 给出（纯函数侧在 `geometry.test.ts` 钉数值），这里钉「画布确实用了它们」（`#002-06`）。
 *
 * 深色主题不验（宪法 §八）。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { 边, 图文件, 节点, 设置 } from "./file"
import { 画布, type 画布动作 } from "./canvas"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const 默认设置: 设置 = {
  线宽度量: "按类型默认",
  次数阈值: [1, 2, 5, 10, 50],
  金额阈值: [10000, 50000, 200000, 1000000],
  外环阈值: [1, 2, 4, 8],
}

function 造节点(id: string, x: number, y: number, 补丁: Partial<节点> = {}): 节点 {
  return {
    id,
    名称: id,
    类型: "人",
    来源: { kind: "手写" },
    时间: { 首: "", 末: "" },
    x,
    y,
    ...补丁,
  }
}

function 造边(id: string, 从: string, 到: string, 补丁: Partial<边> = {}): 边 {
  return {
    id,
    从,
    到,
    标签: "",
    性质: "事实",
    方向: "无向",
    来源: { kind: "手写" },
    时间: { 首: "", 末: "" },
    ...补丁,
  }
}

function 造图(节点们: 节点[], 边们: 边[], 设置补丁: Partial<设置> = {}): 图文件 {
  return {
    格式: 1,
    标题: "画布测试",
    创建于: "2026-11-16T10:00:00+08:00",
    更新于: "2026-11-16T10:00:00+08:00",
    设置: { ...默认设置, ...设置补丁 },
    节点: 节点们,
    边: 边们,
    文字: [],
  }
}

function 幽灵动作表(): 画布动作 {
  return {
    选择: () => {},
    移动: () => {},
    加边: () => {},
    加文字: () => {},
    改字段: () => {},
    删对象: () => {},
    撤销: () => {},
    重做: () => {},
    切换模式: () => {},
    加节点: () => {},
    删除所选: () => {},
    重命名: () => {},
    锁定切换: () => {},
    对齐: () => {},
    等距: () => {},
    自动布局: () => {},
    演示切换: () => {},
  }
}

function 挂(
  文档: 图文件,
  图例初始收起?: boolean,
  额外: { readonly 适配请求?: number; readonly 档表?: ReadonlyMap<string, number> } = {},
) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <画布
          文档={文档}
          选中={[]}
          模式="指针"
          动作={幽灵动作表()}
          图例初始收起={图例初始收起}
          适配请求={额外.适配请求}
          档表={额外.档表}
        />
      ),
      host,
    ),
  )
}

const 全部 = (选择器: string) => [...document.querySelectorAll(选择器)]
const 取 = (选择器: string) => document.querySelector(选择器)
const 边组们 = () => 全部("[data-slot='hgraph-edge']")
const 节点组 = (id: string) => 取(`[data-slot='hgraph-node'][data-node-id='${id}']`)
const 条目数 = () => 全部("[data-slot='hgraph-legend'] [data-slot='hgraph-legend-item']").length
const 点 = (选择器: string) => {
  const 元素 = 取(选择器)
  expect(元素).not.toBeNull()
  元素!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

// ---------------------------------------------------------------------------
// 验收 #9–#16
// ---------------------------------------------------------------------------

describe("T018 · 画布边几何", () => {
  test("#9 两条平行边：都渲染，data-edge-offset = \"0\" / \"8\"", () => {
    挂(造图([造节点("a", 100, 100), 造节点("b", 300, 100)], [造边("e1", "a", "b"), 造边("e2", "b", "a")]))

    const 组们 = 边组们()
    expect(组们.length).toBe(2)
    expect(组们.map((元素) => 元素.getAttribute("data-edge-offset"))).toEqual(["0", "8"])
  })

  test("#10 有向边画箭头（1 个），无向边一律不画（0 个）", () => {
    挂(造图([造节点("a", 100, 100), 造节点("b", 300, 100)], [造边("e1", "a", "b", { 方向: "有向" })]))
    expect(全部("[data-slot='hgraph-edge-arrow']").length).toBe(1)
  })

  test("#10 无向边：hgraph-edge-arrow 0 个", () => {
    挂(造图([造节点("a", 100, 100), 造节点("b", 300, 100)], [造边("e1", "a", "b", { 方向: "无向" })]))
    expect(全部("[data-slot='hgraph-edge-arrow']").length).toBe(0)
  })

  test("#11 事实实线 / 推断虚线 \"4 3\"", () => {
    挂(
      造图(
        [造节点("a", 100, 100), 造节点("b", 300, 100), 造节点("c", 100, 300), 造节点("d", 300, 300)],
        [造边("e1", "a", "b", { 性质: "事实" }), 造边("e2", "c", "d", { 性质: "推断" })],
      ),
    )
    const 线们 = 全部("[data-slot='hgraph-edge-line']")
    expect(线们.length).toBe(2)
    expect(线们[0].getAttribute("stroke-dasharray")).toBeNull()
    expect(线们[1].getAttribute("stroke-dasharray")).toBe("4 3")
  })

  test("#15 弱线淡化：1 档 ⇒ stroke-opacity 0.55；4 档不写", () => {
    挂(
      造图(
        [造节点("a", 100, 100), 造节点("b", 300, 100), 造节点("c", 100, 300), 造节点("d", 300, 300)],
        [造边("e1", "a", "b", { 次数: 1 }), 造边("e2", "c", "d", { 次数: 10 })],
      ),
    )
    const 线们 = 全部("[data-slot='hgraph-edge-line']")
    expect(线们[0].getAttribute("stroke-opacity")).toBe("0.55")
    expect(线们[1].getAttribute("stroke-opacity")).toBeNull()
    expect(边组们().map((元素) => 元素.getAttribute("data-edge-tier"))).toEqual(["1", "4"])
  })
})

describe("T018 · 节点形状与外环", () => {
  test("#12 类型形状：人 / 号码 / 账户 / 地点 / 未知 ⇒ circle/rect/hexagon/diamond/circle；首字 = 号", () => {
    挂(
      造图(
        [
          造节点("n1", 100, 100, { 类型: "人" }),
          造节点("n2", 200, 100, { 类型: "号码", 名称: "号码甲" }),
          造节点("n3", 300, 100, { 类型: "账户" }),
          造节点("n4", 400, 100, { 类型: "地点" }),
          造节点("n5", 500, 100, { 类型: "未知" }),
        ],
        [],
      ),
    )
    expect(
      ["n1", "n2", "n3", "n4", "n5"].map((id) => 节点组(id)!.getAttribute("data-node-shape")),
    ).toEqual(["circle", "rect", "hexagon", "diamond", "circle"])
    const 首字们 = [...节点组("n2")!.querySelectorAll("text")].map((元素) => 元素.textContent)
    expect(首字们).toContain("号")
  })

  test("#12 类型首字按码点取，不劈开代理对", () => {
    挂(造图([造节点("n1", 100, 100, { 类型: "𠮷" })], []))
    const 首字们 = [...节点组("n1")!.querySelectorAll("text")].map((元素) => 元素.textContent)
    expect(首字们).toContain("𠮷")
  })

  test("#13 自动外环：5 条边的节点 tier = 3；孤立节点无环", () => {
    挂(
      造图(
        [
          造节点("a", 100, 100),
          造节点("b", 200, 100),
          造节点("c", 300, 100),
          造节点("d", 200, 200),
          造节点("e", 100, 200),
          造节点("f", 300, 200),
          造节点("孤", 500, 500),
        ],
        [
          造边("e1", "a", "b"),
          造边("e2", "a", "c"),
          造边("e3", "a", "d"),
          造边("e4", "a", "e"),
          造边("e5", "a", "f"),
        ],
      ),
    )
    const 环 = 节点组("a")!.querySelector("[data-slot='hgraph-node-ring']")
    expect(环).not.toBeNull()
    expect(环!.getAttribute("data-ring-tier")).toBe("3")
    expect(节点组("孤")!.querySelector("[data-slot='hgraph-node-ring']")).toBeNull()
  })

  test("#14 手动外环 {档:1} 且 0 条边 ⇒ tier \"1\"（冻结生效）", () => {
    挂(造图([造节点("a", 100, 100, { 外环: { 档: 1 } })], []))
    const 环 = 节点组("a")!.querySelector("[data-slot='hgraph-node-ring']")
    expect(环).not.toBeNull()
    expect(环!.getAttribute("data-ring-tier")).toBe("1")
  })
})

describe("T018 · 图例挂载", () => {
  test("#16 图例在 svg 内：4 条 ⇒ 点 toggle 收起（0 条）⇒ 再点恢复 4 条", () => {
    挂(造图([造节点("a", 100, 100)], []))

    const 图例元素 = 取("[data-slot='hgraph-legend']")
    expect(图例元素).not.toBeNull()
    expect(图例元素!.closest("svg")).not.toBeNull()
    expect(条目数()).toBe(4)

    点("[data-slot='hgraph-legend-toggle']")
    expect(条目数()).toBe(0)
    expect(取("[data-slot='hgraph-legend-collapsed']")).not.toBeNull()

    点("[data-slot='hgraph-legend-collapsed']")
    expect(条目数()).toBe(4)
  })

  test("图例初始收起：编辑器演示态传 true ⇒ 挂载即收起", () => {
    挂(造图([造节点("a", 100, 100)], []), true)
    expect(条目数()).toBe(0)
    expect(取("[data-slot='hgraph-legend-collapsed']")).not.toBeNull()
  })
})

describe("T018 · 标签档表接线（R75）", () => {
  test("适配后缩放 < 0.6：档表里 ≥3 档的节点标签保留，0 档的隐藏", () => {
    // 两节点相距 2000px ⇒ 适配视口缩放 ≈ 0.335（≥0.3、<0.6），落在「按档放行」区间。
    挂(
      造图([造节点("a", 0, 0, { 名称: "甲" }), 造节点("b", 2000, 0, { 名称: "乙" })], []),
      undefined,
      { 适配请求: 1, 档表: new Map([["a", 3]]) },
    )
    expect(节点组("a")!.querySelector("[data-slot='hgraph-node-label']")).not.toBeNull()
    expect(节点组("b")!.querySelector("[data-slot='hgraph-node-label']")).toBeNull()
  })
})
