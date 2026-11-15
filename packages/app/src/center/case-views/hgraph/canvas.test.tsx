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

function 记动作表() {
  const 计数: Record<string, unknown[][]> = {}
  const 记 = (名: string, 参: unknown[]) => {
    ;(计数[名] ??= []).push(参)
  }
  const 动作: 画布动作 = {
    ...幽灵动作表(),
    选择: (ids, 追加) => 记("选择", [ids, 追加]),
    加节点: (位置) => 记("加节点", [位置]),
    移动: (目标) => 记("移动", [目标]),
  }
  return { 动作, 计数 }
}

function 挂(
  文档: 图文件,
  图例初始收起?: boolean,
  额外: {
    readonly 适配请求?: number
    readonly 档表?: ReadonlyMap<string, number>
    readonly 选中?: readonly string[]
    readonly 动作?: 画布动作
    readonly 只读?: true
    readonly 模式?: "指针" | "连线"
  } = {},
) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <画布
          文档={文档}
          选中={额外.选中 ?? []}
          模式={额外.模式 ?? "指针"}
          动作={额外.动作 ?? 幽灵动作表()}
          图例初始收起={图例初始收起}
          适配请求={额外.适配请求}
          档表={额外.档表}
          只读={额外.只读}
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

/** 按一次完整指针序列（down → up），目标元素上的事件会冒泡到画布容器。 */
const 按一下 = (元素: Element, 起: { readonly x: number; readonly y: number }) => {
  元素.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 起.x,
      clientY: 起.y,
    }),
  )
  元素.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: 0,
      clientX: 起.x,
      clientY: 起.y,
    }),
  )
}

/** 指针拖动序列（down → move → up），全部冒泡到画布容器。 */
const 拖一下 = (元素: Element, 起: { readonly x: number; readonly y: number }, 止: { readonly x: number; readonly y: number }) => {
  元素.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 起.x,
      clientY: 起.y,
    }),
  )
  元素.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      buttons: 1,
      clientX: 止.x,
      clientY: 止.y,
    }),
  )
  元素.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: 0,
      clientX: 止.x,
      clientY: 止.y,
    }),
  )
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
    // M-2：档 ⇒ 像素必须真的落到 stroke-width。R73 的表是 [1,1.5,2,3,4]，
    // 所以 1 档 = 1.5px（不是 1px）、4 档 = 4px。
    expect(线们[0].getAttribute("stroke-width")).toBe("1.5")
    expect(线们[1].getAttribute("stroke-width")).toBe("4")
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

  test("图例在 hgraph-viewport 之后、同属 hgraph-svg（R74），坐标 (12,48)（R108）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    const svg = 取("[data-slot='hgraph-svg']")
    const 视口 = 取("[data-slot='hgraph-viewport']")
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(svg).not.toBeNull()
    expect(视口).not.toBeNull()
    expect(图例).not.toBeNull()
    expect(图例!.closest("[data-slot='hgraph-svg']")).toBe(svg!)
    expect(svg!.contains(视口)).toBe(true)
    expect(视口!.compareDocumentPosition(图例!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(图例!.getAttribute("transform")).toBe("translate(12 48)")
  })

  test("收起态文案恰为「图例」", () => {
    挂(造图([造节点("a", 100, 100)], []), true)
    const 收起 = 取("[data-slot='hgraph-legend-collapsed']")
    expect(收起).not.toBeNull()
    expect(收起!.textContent?.trim()).toBe("图例")
  })
})

describe("T018 修复轮 1 · 图例指针事件不冒泡成画布动作", () => {
  test("选中非空时点 toggle ⇒ 选择零调用、选中不变", () => {
    const { 动作, 计数 } = 记动作表()
    挂(造图([造节点("a", 100, 100)], []), undefined, { 选中: ["a"], 动作 })
    const 钮 = 取("[data-slot='hgraph-legend-toggle']")
    expect(钮).not.toBeNull()

    按一下(钮!, { x: 20, y: 24 })
    钮!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(计数.选择).toBeUndefined()
    expect(节点组("a")!.getAttribute("data-selected")).toBe("true")
  })

  test("图例上 dblclick ⇒ 加节点零调用", () => {
    const { 动作, 计数 } = 记动作表()
    挂(造图([造节点("a", 100, 100)], []), undefined, { 动作 })
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(图例).not.toBeNull()

    图例!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 20, clientY: 24 }))

    expect(计数.加节点).toBeUndefined()
  })

  test("右键图例 ⇒ 不弹「空白画布」菜单（无写入口）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(图例).not.toBeNull()

    图例!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 24 }))

    expect(取("[data-slot='hgraph-menu']")).toBeNull()
  })

  test("从图例上按下拖动 ⇒ 画布 transform 不变（不平移）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    const 视口 = 取("[data-slot='hgraph-viewport']")
    expect(视口).not.toBeNull()
    const 前 = 视口!.getAttribute("transform")
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(图例).not.toBeNull()

    拖一下(图例!, { x: 20, y: 24 }, { x: 160, y: 164 })

    expect(视口!.getAttribute("transform")).toBe(前)
  })
})

describe("T019a · 悬空边（端点不在节点表）", () => {
  test("不渲染：两端缺一颗的边不进 DOM（组与线都没有）", () => {
    // 端点 n2 不在 `节点` 里 ⇒ 这条边画不出方向与端点，必须整条不渲染。
    挂(造图([造节点("n1", 100, 100)], [造边("悬空", "n1", "n2")]))
    expect(边组们().length).toBe(0)
    expect(取("[data-edge-id='悬空']")).toBeNull()
  })

  test("自环与正常边照旧：悬空边不影响其它边的渲染", () => {
    挂(造图([造节点("n1", 100, 100), 造节点("n2", 300, 100)], [造边("正常", "n1", "n2"), 造边("悬空", "n2", "n9")]))
    expect(边组们().length).toBe(1)
    expect(取("[data-edge-id='正常']")).not.toBeNull()
    expect(取("[data-edge-id='悬空']")).toBeNull()
  })
})

describe("T019a · 只读态（动作层 mode）不派发写动作", () => {
  test("指针模式：拖动节点、双击空白、右键、Delete / F2 / Ctrl+Z 全部零动作", () => {
    const { 动作, 计数 } = 记动作表()
    挂(造图([造节点("n1", 100, 100), 造节点("n2", 300, 100)], [造边("e1", "n1", "n2")]), undefined, {
      动作,
      只读: true,
    })
    const 布 = 取("[data-slot='hgraph-canvas']") as HTMLElement

    拖一下(节点组("n1")!, { x: 100, y: 100 }, { x: 200, y: 200 })
    取("[data-slot='hgraph-svg']")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 500, clientY: 500 }),
    )
    节点组("n1")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    for (const key of ["Delete", "F2", "z", "v"]) {
      布.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: key === "z" || key === "v", bubbles: true, cancelable: true }))
    }

    expect(Object.keys(计数)).toEqual([])
    expect(取("[data-slot='hgraph-menu']")).toBeNull()
  })

  test("连线模式：从节点拖到节点也不加边（模式不影响只读闸）", () => {
    const { 动作, 计数 } = 记动作表()
    挂(造图([造节点("n1", 100, 100), 造节点("n2", 300, 100)], []), undefined, {
      动作,
      只读: true,
      模式: "连线",
    })

    拖一下(节点组("n1")!, { x: 100, y: 100 }, { x: 300, y: 100 })

    expect(Object.keys(计数)).toEqual([])
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
