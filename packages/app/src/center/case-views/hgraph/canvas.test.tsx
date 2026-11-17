/**
 * T018：画布视觉规格（形状 / 边几何 / 外环 / 弱线 / 图例挂载）。
 *
 * 组件级断言只读 DOM 属性，**不重算几何**：偏移、档、形状都由 `geometry.ts` 的纯函数
 * 给出（纯函数侧在 `geometry.test.ts` 钉数值），这里钉「画布确实用了它们」（`#002-06`）。
 *
 * 深色主题不验（宪法 §八）。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { 边, 图文件, 节点, 设置, 文字 } from "./file"
import { 画布, 是双指平移, type 画布动作, type 模式, type 坐标换算 } from "./canvas"
import { 角色边 } from "./edge"

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

function 造图(节点们: 节点[], 边们: 边[], 设置补丁: Partial<设置> = {}, 文字们: 文字[] = []): 图文件 {
  return {
    格式: 1,
    标题: "画布测试",
    创建于: "2026-11-16T10:00:00+08:00",
    更新于: "2026-11-16T10:00:00+08:00",
    设置: { ...默认设置, ...设置补丁 },
    节点: 节点们,
    边: 边们,
    文字: 文字们,
  }
}

function 造文字(内容: string, 补丁: Partial<文字> = {}): 文字 {
  return { id: "t1", 内容, x: 100, y: 100, 字号: "中", ...补丁 }
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
    加边: (从, 到) => 记("加边", [从, 到]),
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
    readonly 模式?: 模式
    readonly 坐标换算?: 坐标换算
    readonly 屏幕命中?: (x: number, y: number) => Element | null
    readonly 容器尺寸?: { readonly 宽: number; readonly 高: number }
    readonly 检查器宽?: number
    readonly 让位请求?: { readonly id: string; readonly 序号: number }
    readonly 可见?: { readonly 节点: ReadonlySet<string>; readonly 边: ReadonlySet<string> }
    readonly 强度阈值?: number
    readonly 恢复强度?: () => void
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
          坐标换算={额外.坐标换算}
          屏幕命中={额外.屏幕命中}
          容器尺寸={额外.容器尺寸}
          检查器宽={额外.检查器宽}
          让位请求={额外.让位请求}
          可见={额外.可见}
          强度阈值={额外.强度阈值}
          恢复强度={额外.恢复强度}
        />
      ),
      host,
    ),
  )
  // 前提（`#005-18` / `#013-12`）：组件确实渲染出了元素，避免「整块没挂上」把缺失断言衬成假绿。
  expect(host.firstElementChild !== null).toBe(true)
}

const 全部 = (选择器: string) => [...document.querySelectorAll(选择器)]
const 取 = (选择器: string) => document.querySelector(选择器)
const 边组们 = () => 全部("[data-slot='hgraph-edge']")
const 节点组 = (id: string) => 取(`[data-slot='hgraph-node'][data-node-id='${id}']`)
const 条目数 = () => 全部("[data-slot='hgraph-legend'] [data-slot='hgraph-legend-item']").length
const 点 = (选择器: string) => {
  const 元素 = 取(选择器)
  expect(元素 !== null).toBe(true)
  元素!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

/** 按一次完整指针序列（down → up），目标元素上的事件会冒泡到画布容器。 */
const 按一下 = (
  元素: Element,
  起: { readonly x: number; readonly y: number },
  修饰: PointerEventInit = {},
) => {
  元素.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 起.x,
      clientY: 起.y,
      ...修饰,
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
      ...修饰,
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

  test("FR-052 未选中节点：已识别类型是类型色浅底 + 类型色描边；未识别回退中性", () => {
    挂(
      造图(
        [
          造节点("号码", 100, 100, { 类型: "号码" }),
          造节点("账户", 200, 100, { 类型: "账户" }),
          造节点("地点", 300, 100, { 类型: "地点" }),
          造节点("组织", 400, 100, { 类型: "组织" }),
          造节点("未分类", 500, 100, { 类型: "未分类" }),
        ],
        [],
      ),
    )
    const 形 = (id: string) => 节点组(id)!.querySelector("[data-slot='hgraph-node-shape']")!

    // 号码 / 账户 / 地点：浅底与 1.5px 描边都取类型色（与 `graph.tsx` 同一张映射）。
    expect(形("号码").getAttribute("fill")).toBe("var(--v2-state-bg-info)")
    expect(形("号码").getAttribute("stroke")).toBe("var(--v2-state-border-info)")
    expect(形("账户").getAttribute("fill")).toBe("var(--v2-state-bg-success)")
    expect(形("账户").getAttribute("stroke")).toBe("var(--v2-state-border-success)")
    expect(形("地点").getAttribute("fill")).toBe("var(--v2-state-bg-warning)")
    expect(形("地点").getAttribute("stroke")).toBe("var(--v2-state-border-warning)")
    expect(形("号码").getAttribute("stroke-width")).toBe("1.5")
    // 主判据：不再是「一排灰斑」。
    for (const id of ["号码", "账户", "地点"]) {
      expect(形(id).getAttribute("fill") === "var(--v2-background-bg-layer-02)").toBe(false)
      expect(形(id).getAttribute("stroke") === "var(--v2-border-border-strong)").toBe(false)
    }
    // 组织：已识别但没有状态浅底槽 ⇒ 浅底 layer-03、描边回退中性（设计补色表缺口）。
    expect(形("组织").getAttribute("fill")).toBe("var(--v2-background-bg-layer-03)")
    expect(形("组织").getAttribute("stroke")).toBe("var(--v2-border-border-strong)")
    // 未识别类型保持中性回退，不新造色。
    expect(形("未分类").getAttribute("fill")).toBe("var(--v2-background-bg-layer-02)")
    expect(形("未分类").getAttribute("stroke")).toBe("var(--v2-border-border-strong)")
  })

  test("FR-052 选中态仍是品牌金（精修 FR-053 延后，本次不改）", () => {
    挂(造图([造节点("号码", 100, 100, { 类型: "号码" })], []), undefined, { 选中: ["号码"] })
    const 形 = 节点组("号码")!.querySelector("[data-slot='hgraph-node-shape']")!
    expect(形.getAttribute("fill")).toBe("var(--v2-brand-gold)")
    expect(形.getAttribute("stroke")).toBe("var(--v2-brand-gold-deep)")
    expect(形.getAttribute("stroke-width")).toBe("3")
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
    expect(环 !== null).toBe(true)
    expect(环!.getAttribute("data-ring-tier")).toBe("3")
    expect(节点组("孤")!.querySelector("[data-slot='hgraph-node-ring']") === null).toBe(true)
  })

  test("#14 手动外环 {档:1} 且 0 条边 ⇒ tier \"1\"（冻结生效）", () => {
    挂(造图([造节点("a", 100, 100, { 外环: { 档: 1 } })], []))
    const 环 = 节点组("a")!.querySelector("[data-slot='hgraph-node-ring']")
    expect(环 !== null).toBe(true)
    expect(环!.getAttribute("data-ring-tier")).toBe("1")
  })
})

describe("T018 · 图例挂载", () => {
  test("#16 图例在 svg 内：4 条 ⇒ 点 toggle 收起（0 条）⇒ 再点恢复 4 条", () => {
    挂(造图([造节点("a", 100, 100)], []))

    const 图例元素 = 取("[data-slot='hgraph-legend']")
    expect(图例元素 !== null).toBe(true)
    expect(图例元素!.closest("svg") !== null).toBe(true)
    expect(条目数()).toBe(4)

    点("[data-slot='hgraph-legend-toggle']")
    expect(条目数()).toBe(0)
    expect(取("[data-slot='hgraph-legend-collapsed']") !== null).toBe(true)

    点("[data-slot='hgraph-legend-collapsed']")
    expect(条目数()).toBe(4)
  })

  test("图例初始收起：编辑器演示态传 true ⇒ 挂载即收起", () => {
    挂(造图([造节点("a", 100, 100)], []), true)
    expect(条目数()).toBe(0)
    expect(取("[data-slot='hgraph-legend-collapsed']") !== null).toBe(true)
  })

  test("图例在 hgraph-viewport 之后、同属 hgraph-svg（R74），坐标 (12,48)（R108）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    const svg = 取("[data-slot='hgraph-svg']")
    const 视口 = 取("[data-slot='hgraph-viewport']")
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(svg !== null).toBe(true)
    expect(视口 !== null).toBe(true)
    expect(图例 !== null).toBe(true)
    expect(图例!.closest("[data-slot='hgraph-svg']")).toBe(svg!)
    expect(svg!.contains(视口)).toBe(true)
    expect(视口!.compareDocumentPosition(图例!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(图例!.getAttribute("transform")).toBe("translate(12 48)")
  })

  test("收起态文案恰为「图例」", () => {
    挂(造图([造节点("a", 100, 100)], []), true)
    const 收起 = 取("[data-slot='hgraph-legend-collapsed']")
    expect(收起 !== null).toBe(true)
    expect(收起!.textContent?.trim()).toBe("图例")
  })
})

describe("T018 修复轮 1 · 图例指针事件不冒泡成画布动作", () => {
  test("选中非空时点 toggle ⇒ 选择零调用、选中不变", () => {
    const { 动作, 计数 } = 记动作表()
    挂(造图([造节点("a", 100, 100)], []), undefined, { 选中: ["a"], 动作 })
    const 钮 = 取("[data-slot='hgraph-legend-toggle']")
    expect(钮 !== null).toBe(true)

    按一下(钮!, { x: 20, y: 24 })
    钮!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(计数.选择).toBeUndefined()
    expect(节点组("a")!.getAttribute("data-selected")).toBe("true")
  })

  test("图例上 dblclick ⇒ 加节点零调用", () => {
    const { 动作, 计数 } = 记动作表()
    挂(造图([造节点("a", 100, 100)], []), undefined, { 动作 })
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(图例 !== null).toBe(true)

    图例!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 20, clientY: 24 }))

    expect(计数.加节点).toBeUndefined()
  })

  test("右键图例 ⇒ 不弹「空白画布」菜单（无写入口）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(图例 !== null).toBe(true)

    图例!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 24 }))

    expect(取("[data-slot='hgraph-menu']") === null).toBe(true)
  })

  test("从图例上按下拖动 ⇒ 画布 transform 不变（不平移）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    const 视口 = 取("[data-slot='hgraph-viewport']")
    expect(视口 !== null).toBe(true)
    const 前 = 视口!.getAttribute("transform")
    const 图例 = 取("[data-slot='hgraph-legend']")
    expect(图例 !== null).toBe(true)

    拖一下(图例!, { x: 20, y: 24 }, { x: 160, y: 164 })

    expect(视口!.getAttribute("transform")).toBe(前)
  })
})

describe("T019a · 悬空边（端点不在节点表）", () => {
  test("不渲染：两端缺一颗的边不进 DOM（组与线都没有）", () => {
    // 端点 n2 不在 `节点` 里 ⇒ 这条边画不出方向与端点，必须整条不渲染。
    挂(造图([造节点("n1", 100, 100)], [造边("悬空", "n1", "n2")]))
    expect(边组们().length).toBe(0)
    expect(取("[data-edge-id='悬空']") === null).toBe(true)
  })

  test("自环与正常边照旧：悬空边不影响其它边的渲染", () => {
    挂(
      造图(
        [造节点("n1", 100, 100), 造节点("n2", 300, 100)],
        [造边("正常", "n1", "n2"), 造边("自环", "n1", "n1"), 造边("悬空", "n2", "n9")],
      ),
    )
    // 自环两端都在节点表 ⇒ 照常渲染；悬空边仍被剔除。
    expect(边组们().length).toBe(2)
    expect(取("[data-edge-id='正常']") !== null).toBe(true)
    expect(取("[data-edge-id='自环']") !== null).toBe(true)
    expect(取("[data-edge-id='悬空']") === null).toBe(true)
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
    expect(取("[data-slot='hgraph-menu']") === null).toBe(true)
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
    expect(节点组("a")!.querySelector("[data-slot='hgraph-node-label']") !== null).toBe(true)
    expect(节点组("b")!.querySelector("[data-slot='hgraph-node-label']") === null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 修复轮 2026-11-16：R-F4（悬空边角标）/ R-F5（双指平移）/ R-F11（文字折行）
// ---------------------------------------------------------------------------

describe("T019a · 悬空边角标（R-F4）", () => {
  test("一条悬空边 ⇒ 角标「1 条边指向不存在的节点」＋ 可读 title", () => {
    挂(造图([造节点("n1", 100, 100)], [造边("悬空", "n1", "n2")]))
    const 角标 = 取("[data-slot='hgraph-dangling-badge']")
    expect(角标 !== null).toBe(true)
    expect(角标!.textContent?.trim()).toBe("1 条边指向不存在的节点")
    expect(角标!.getAttribute("title")).toBe("有 1 条边指向不存在的节点：读时不丢弃、不静默改文件")
  })

  test("两条悬空 ⇒ 「2 条」；悬空边本身仍不画线", () => {
    挂(造图([造节点("n1", 100, 100)], [造边("甲", "n1", "n2"), 造边("乙", "n3", "n1")]))
    expect(取("[data-slot='hgraph-dangling-badge']")!.textContent?.trim()).toBe("2 条边指向不存在的节点")
    expect(边组们().length).toBe(0)
  })

  test("无悬空 ⇒ 角标不存在（正常边不算）", () => {
    挂(造图([造节点("n1", 100, 100), 造节点("n2", 300, 100)], [造边("e1", "n1", "n2")]))
    expect(取("[data-slot='hgraph-dangling-badge']") === null).toBe(true)
  })

  test("只读态也显示（读侧事实，只读不是不提示的理由）", () => {
    挂(造图([造节点("n1", 100, 100)], [造边("悬空", "n1", "n2")]), undefined, { 只读: true })
    expect(取("[data-slot='hgraph-dangling-badge']")!.textContent?.trim()).toBe("1 条边指向不存在的节点")
  })
})

describe("T019a · 文字宽度与自动换行（R-F11 / FR-024）", () => {
  test("宽度 32 / 中号 ⇒ 4 个字折成 2 行（每行 2 字），字号走 16", () => {
    挂(造图([], [], {}, [造文字("甲乙丙丁", { 宽度: 32 })]))
    const 文 = 取("[data-slot='hgraph-text']")
    expect(文 !== null).toBe(true)
    // 选中 / 拖动仍按文字 id 找元素。
    expect(文!.getAttribute("data-text-id")).toBe("t1")
    expect(文!.getAttribute("font-size")).toBe("16")

    const 行们 = [...文!.querySelectorAll("tspan")]
    expect(行们.map((行) => 行.textContent)).toEqual(["甲乙", "丙丁"])
    // 第一行基线对齐元素 y；后续行按 字号 × 1.35 下移。
    expect(行们[0].getAttribute("dy")).toBe("0")
    expect(Number(行们[1].getAttribute("dy"))).toBeCloseTo(16 * 1.35, 5)
  })

  test("5 个字 / 宽度 32 ⇒ 3 个 tspan（2 + 2 + 1）", () => {
    挂(造图([], [], {}, [造文字("甲乙丙丁戊", { 宽度: 32 })]))
    const 行们 = [...取("[data-slot='hgraph-text']")!.querySelectorAll("tspan")]
    expect(行们.map((行) => 行.textContent)).toEqual(["甲乙", "丙丁", "戊"])
  })

  test("无宽度 ⇒ 1 个 tspan（不自动折），data-text-id 仍在", () => {
    挂(造图([], [], {}, [造文字("甲乙丙丁")]))
    const 文 = 取("[data-slot='hgraph-text']")
    expect(文!.getAttribute("data-text-id")).toBe("t1")
    const 行们 = [...文!.querySelectorAll("tspan")]
    expect(行们.map((行) => 行.textContent)).toEqual(["甲乙丙丁"])
  })
})

// ---------------------------------------------------------------------------
// 修复轮 2026-11-16：R-F12 前置（边可点选）/ R-F11 UI（文字预设色）
// ---------------------------------------------------------------------------

describe("T019a · 边可点选（R-F12 前置）", () => {
  const 两节点一边 = (补丁: Partial<边> = {}) =>
    造图([造节点("a", 100, 100), 造节点("b", 300, 100)], [造边("e1", "a", "b", 补丁)])

  test("点边线 ⇒ 选择([\"e1\"], false)，且该边带 data-selected", () => {
    const { 动作, 计数 } = 记动作表()
    挂(两节点一边(), undefined, { 动作 })

    const 线 = 取("[data-slot='hgraph-edge-line']")
    expect(线 !== null).toBe(true)
    expect(线!.getAttribute("class") ?? "").toContain("cursor-pointer")
    按一下(线!, { x: 200, y: 100 })

    expect(计数.选择).toEqual([[["e1"], false]])
  })

  test("Shift 点已选中的边 ⇒ 从选中里移除（保留其它选中）", () => {
    const { 动作, 计数 } = 记动作表()
    // 两条平行边都选中：Shift 移除 e1 后必须还剩 e2——空集会是「点空白」的答案，
    // 区分不开「切换语义」与「根本没命中边」。
    挂(
      造图([造节点("a", 100, 100), 造节点("b", 300, 100)], [造边("e1", "a", "b"), 造边("e2", "a", "b")]),
      undefined,
      { 动作, 选中: ["e1", "e2"] },
    )
    expect(取("[data-edge-id='e1']")!.getAttribute("data-selected")).toBe("true")

    按一下(取("[data-slot='hgraph-edge-line']")!, { x: 200, y: 100 }, { shiftKey: true })

    expect(计数.选择).toEqual([[["e2"], false]])
  })

  test("拖边（按下后移动再松手）⇒ 零次「移动」、选中仍落到该边", () => {
    const { 动作, 计数 } = 记动作表()
    挂(两节点一边(), undefined, { 动作 })

    拖一下(取("[data-slot='hgraph-edge-line']")!, { x: 100, y: 100 }, { x: 240, y: 160 })

    expect(计数.移动).toBeUndefined()
    expect(计数.选择).toEqual([[["e1"], false]])
  })

  test("双击边不建节点（保持现有语义）", () => {
    const { 动作, 计数 } = 记动作表()
    挂(两节点一边(), undefined, { 动作 })

    取("[data-slot='hgraph-edge-line']")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 200, clientY: 100 }),
    )

    expect(计数.加节点).toBeUndefined()
  })
})

describe("T019a · 文字预设色表（R-F11 UI）", () => {
  test("颜色 红 ⇒ fill 是 var(--v2-state-fg-danger)（不是原名「红」）", () => {
    挂(造图([], [], {}, [造文字("甲", { 颜色: "红" })]))
    expect(取("[data-slot='hgraph-text']")!.getAttribute("fill")).toBe("var(--v2-state-fg-danger)")
  })

  test("每个预设色名都落到主题槽位（默认/黑/红/橙/绿/蓝/金/灰）", () => {
    const 期望: Record<string, string> = {
      默认: "var(--v2-text-text-base)",
      黑: "var(--v2-text-text-base)",
      红: "var(--v2-state-fg-danger)",
      橙: "var(--v2-state-fg-warning)",
      绿: "var(--v2-state-fg-success)",
      蓝: "var(--v2-state-fg-info)",
      金: "var(--v2-brand-gold-deep)",
      灰: "var(--v2-text-text-muted)",
    }
    for (const [名, 色] of Object.entries(期望)) {
      document.body.innerHTML = ""
      挂(造图([], [], {}, [造文字("甲", { 颜色: 名 })]))
      expect(取("[data-slot='hgraph-text']")!.getAttribute("fill")).toBe(色)
    }
  })

  test("未知色名 / 未设颜色 ⇒ 默认色", () => {
    挂(造图([], [], {}, [造文字("甲", { 颜色: "紫" })]))
    expect(取("[data-slot='hgraph-text']")!.getAttribute("fill")).toBe("var(--v2-text-text-base)")

    document.body.innerHTML = ""
    挂(造图([], [], {}, [造文字("甲")]))
    expect(取("[data-slot='hgraph-text']")!.getAttribute("fill")).toBe("var(--v2-text-text-base)")
  })
})

describe("T019a · 滚轮手势判定：双指平移 vs 滚轮缩放（R-F5）", () => {
  test("鼠标滚轮（横向 0、整数档）⇒ false", () => {
    expect(是双指平移({ deltaX: 0, deltaY: 100 })).toBe(false)
    expect(是双指平移({ deltaX: 0, deltaY: -100 })).toBe(false)
  })

  test("触控板横向分量 ⇒ true", () => {
    expect(是双指平移({ deltaX: 3, deltaY: 0 })).toBe(true)
  })

  test("纵向占优（含精密触控板小数档）⇒ false（归缩放）", () => {
    // T006 收紧判据：不再是「纵向是小数 ⇒ 平移」，而是「横向分量占优 ⇒ 平移」。
    expect(是双指平移({ deltaX: 0, deltaY: 12.5 })).toBe(false)
    expect(是双指平移({ deltaX: 2, deltaY: -12.5 })).toBe(false)
  })

  test("Ctrl + 滚轮是捏合缩放 ⇒ false", () => {
    expect(是双指平移({ deltaX: 0, deltaY: 12.5, ctrlKey: true })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T006：滚轮判据改为「横向分量占优才平移」＋ 空格式平移的抓取光标
// ---------------------------------------------------------------------------

describe("T006 · 滚轮判据（横向占优）与空格平移光标", () => {
  const 变换 = () => 取("[data-slot='hgraph-viewport']")!.getAttribute("transform")
  const 容器 = () => 取("[data-slot='hgraph-canvas']") as HTMLElement
  const 滚 = (deltaX: number, deltaY: number, 修饰: WheelEventInit = {}) =>
    容器().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY, ...修饰 }))
  const 空手起落 = (key: "keydown" | "keyup") =>
    容器().dispatchEvent(new KeyboardEvent(key, { key: " ", bubbles: true, cancelable: true }))
  const 指针 = (类型: "pointerdown" | "pointermove" | "pointerup", x: number, y: number) =>
    容器().dispatchEvent(
      new PointerEvent(类型, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        buttons: 类型 === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    )

  test("精密触控板的小数 deltaY（3.75、无横向分量）⇒ 缩放比例变化", () => {
    // 恒等换算：happy-dom 没有布局（矩形恒 0），滚轮锚点由注入的换算给内容原点。
    挂(造图([造节点("a", 100, 100)], []), undefined, { 坐标换算: () => ({ x: 0, y: 0 }) })
    expect(变换()).toBe("translate(0 0) scale(1)")

    滚(0, 3.75)

    expect(变换()).toBe(`translate(0 0) scale(${1 / 1.15})`)
  })

  test("纯横向 deltaX 120 / deltaY 0 ⇒ 只平移，缩放不变", () => {
    挂(造图([造节点("a", 100, 100)], []), undefined, { 坐标换算: () => ({ x: 0, y: 0 }) })

    滚(120, 0)

    expect(变换()).toBe("translate(-120 0) scale(1)")
  })

  test("空格按住 ⇒ 容器光标 grab；松开空格 ⇒ default", () => {
    挂(造图([造节点("a", 100, 100)], []))
    expect(容器().style.cursor).toBe("default")

    空手起落("keydown")
    expect(容器().style.cursor).toBe("grab")

    空手起落("keyup")
    expect(容器().style.cursor).toBe("default")
  })

  test("空格 + 拖动中 ⇒ 光标 grabbing；松手回 grab（空格仍按住）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    空手起落("keydown")
    expect(容器().style.cursor).toBe("grab")

    指针("pointerdown", 10, 10)
    expect(容器().style.cursor).toBe("grabbing")

    指针("pointermove", 60, 60)
    expect(容器().style.cursor).toBe("grabbing")

    指针("pointerup", 60, 60)
    expect(容器().style.cursor).toBe("grab")
  })
})

// ---------------------------------------------------------------------------
// T015 / FR-012：「手」模式 = 左键拖任意位置平移（不选中、不拖节点、不框选）
// ---------------------------------------------------------------------------

describe("T015 · 手模式", () => {
  const 变换 = () => 取("[data-slot='hgraph-viewport']")!.getAttribute("transform")
  const 容器 = () => 取("[data-slot='hgraph-canvas']") as HTMLElement
  const 指针 = (类型: "pointerdown" | "pointermove" | "pointerup", x: number, y: number) =>
    容器().dispatchEvent(
      new PointerEvent(类型, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        buttons: 类型 === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    )

  test("手模式 ⇒ 悬停 grab；左键从节点上拖动仍是平移，节点不移动", () => {
    const { 动作, 计数 } = 记动作表()
    挂(造图([造节点("a", 100, 100)], []), undefined, {
      模式: "手",
      动作,
      坐标换算: (屏幕) => ({ x: 屏幕.clientX, y: 屏幕.clientY }),
    })
    expect(容器().style.cursor).toBe("grab")
    expect(变换()).toBe("translate(0 0) scale(1)")
    // 手模式下节点不能自己盖回 `cursor-pointer`，否则悬停在节点上光标不是 grab（FR-012）。
    expect((节点组("a")?.getAttribute("class") ?? "").includes("cursor-pointer")).toBe(false)

    // 按在节点上：手模式下也是平移，不是拖节点。
    指针("pointerdown", 10, 10)
    expect(容器().style.cursor).toBe("grabbing")

    指针("pointermove", 60, 70)
    expect(变换()).toBe("translate(50 60) scale(1)")

    指针("pointerup", 60, 70)
    expect(容器().style.cursor).toBe("grab")
    expect(计数.移动 === undefined).toBe(true)
    expect(计数.选择 === undefined).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// T007 / FR-013：连线松手与按下同一套 DOM 命中（含名字标签），落空给提示
// ---------------------------------------------------------------------------

describe("T007 · 连线松手命中", () => {
  const 两节点图 = () =>
    造图([造节点("n1", 100, 100, { 名称: "甲" }), 造节点("n2", 200, 100, { 名称: "乙" })], [])

  /** 只派发指针序列，不替调用方决定命中元素（命中由 `屏幕命中` 注入）。 */
  const 指针 = (元素: Element, 类型: "pointerdown" | "pointermove" | "pointerup", x: number, y: number) =>
    元素.dispatchEvent(
      new PointerEvent(类型, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        buttons: 类型 === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    )

  const 提示文案 = () => 取("[data-slot='hgraph-connect-hint']")?.textContent?.trim()

  test("松手落在目标节点的名字标签上 ⇒ 建边（与按下同为 closest('[data-node-id]') 命中）", () => {
    const { 动作, 计数 } = 记动作表()
    let 命中元素: Element | null = null
    挂(两节点图(), undefined, { 动作, 模式: "连线", 屏幕命中: () => 命中元素 })

    const 标签 = 节点组("n2")!.querySelector("[data-slot='hgraph-node-label']")
    // 先立「标签在文档里」前提（#013-12）：节点没有标签时这条用例不该绿。
    expect(标签 === null).toBe(false)
    命中元素 = 标签

    // 落点 (240,140) 距 n2 圆心 56.6px，在数学半径（15）之外——只有 DOM 命中能连上。
    拖一下(节点组("n1")!, { x: 100, y: 100 }, { x: 240, y: 140 })

    expect(计数["加边"]).toEqual([["n1", "n2"]])
    expect(提示文案()).toBeUndefined()
  })

  test("落在空白 ⇒ 不建边且提示「松手不在节点上，未建立连线」", () => {
    const { 动作, 计数 } = 记动作表()
    挂(两节点图(), undefined, { 动作, 模式: "连线", 屏幕命中: () => null })

    拖一下(节点组("n1")!, { x: 100, y: 100 }, { x: 700, y: 600 })

    expect(计数["加边"]).toBeUndefined()
    expect(提示文案()).toBe("松手不在节点上，未建立连线")
  })

  test("落在预览线上 ⇒ 仍视为空白（预览线 pointer-events: none，不参与命中）", () => {
    const { 动作, 计数 } = 记动作表()
    let 命中元素: Element | null = null
    挂(两节点图(), undefined, {
      动作,
      模式: "连线",
      // 命中的正是拖动中的预览线：它不是节点，仍按空白处理。
      屏幕命中: () => (命中元素 = 取("[data-slot='hgraph-connect']")),
    })

    const 起点 = 节点组("n1")!
    指针(起点, "pointerdown", 100, 100)
    指针(起点, "pointermove", 700, 600)

    const 线 = 取("[data-slot='hgraph-connect']")
    expect(线 === null).toBe(false)
    // 落点属性：`<line data-slot="hgraph-connect">` 的 `pointer-events` 属性为 "none"。
    expect(线!.getAttribute("pointer-events")).toBe("none")

    指针(起点, "pointerup", 700, 600)

    // 命中函数确实拿到过那条线（否则这条用例没测到「落在预览线上」）。
    expect(命中元素 === null).toBe(false)
    expect(命中元素!.getAttribute("data-slot")).toBe("hgraph-connect")
    expect(计数["加边"]).toBeUndefined()
    expect(提示文案()).toBe("松手不在节点上，未建立连线")
  })
})

describe("T008 · 检查器让位：容器缩放比与面板实宽", () => {
  const 变换 = () => 取("[data-slot='hgraph-viewport']")!.getAttribute("transform")

  test("容器比 < 1 时仍让位（面板 320 CSS px 换算成 viewBox 单位）", () => {
    // 380×340 容器 ⇒ 比 = min(380/760, 340/680) = 0.5；面板占 640 viewBox 单位，
    // 未覆盖区 = [0, 120]，中心 60。节点 200 ⇒ 平移 60 - 200 = -140。
    挂(造图([造节点("n1", 200, 100)], []), undefined, {
      容器尺寸: { 宽: 380, 高: 340 },
      让位请求: { id: "n1", 序号: 1 },
    })
    expect(变换()).toBe("translate(-140 0) scale(1)")
  })

  test("容器比 > 1 时居中位置按换算后的未覆盖区算", () => {
    // 1520×1360 ⇒ 比 = 2；面板占 160 单位，未覆盖区 = [0, 600]，中心 300。
    // 节点 700 ⇒ 平移 300 - 700 = -400（直接减 CSS px 会得到 -480）。
    挂(造图([造节点("n1", 700, 100)], []), undefined, {
      容器尺寸: { 宽: 1520, 高: 1360 },
      让位请求: { id: "n1", 序号: 1 },
    })
    expect(变换()).toBe("translate(-400 0) scale(1)")
  })

  test("检查器宽 40 ⇒ 让位距离按 40 算（不是常量 320）", () => {
    // 比 = 1：未覆盖区 = [0, 720]，中心 360；节点 740 ⇒ 平移 -380（按 320 算会是 -520）。
    挂(造图([造节点("n1", 740, 100)], []), undefined, {
      检查器宽: 40,
      让位请求: { id: "n1", 序号: 1 },
    })
    expect(变换()).toBe("translate(-380 0) scale(1)")
  })
})

// ---------------------------------------------------------------------------
// T010（FR-056）：事件卡
// ---------------------------------------------------------------------------

describe("T010 · 事件卡", () => {
  const 事件节点 = (id: string, 补丁: Partial<节点> = {}): 节点 =>
    造节点(id, 100, 100, {
      类型: "转账",
      来源: { kind: "事件", 实体: `ev_${id}` },
      时间: { 首: "2026-03-04 14:22:00", 末: "2026-03-04 14:22:00" },
      属性: [{ 键: "金额", 值: "12000元" }],
      ...补丁,
    })
  const 卡 = (id: string) => 节点组(id)?.querySelector("rect[data-node-shape='event-card']") ?? null
  /** 事件卡两行文本（按槽位取，不靠 DOM 次序）。 */
  const 两行 = (id: string) =>
    ["hgraph-event-card-line1", "hgraph-event-card-line2"].map(
      (槽) => 节点组(id)!.querySelector(`[data-slot='${槽}']`)?.textContent ?? null,
    )

  test("#1 渲染 96×34、rx=6 的 event-card（同时挂 hgraph-node-shape 槽）", () => {
    挂(造图([事件节点("ev")], []))
    const 卡元素 = 卡("ev")
    // #013-12：DOM 存在性用布尔比较（`toBeNull()` 在元素存在时也可能绿）。
    expect(卡元素 === null).toBe(false)
    expect(卡元素!.getAttribute("data-slot")).toBe("hgraph-node-shape")
    expect(卡元素!.getAttribute("width")).toBe("96")
    expect(卡元素!.getAttribute("height")).toBe("34")
    expect(卡元素!.getAttribute("rx")).toBe("6")
  })

  test("#2 两行文本逐字：日 / 时 / 分（未标同分）", () => {
    const 精度 = (值?: string) =>
      事件节点(`ev${值 ?? "未标"}`, {
        属性: [
          { 键: "金额", 值: "12000元" },
          ...(值 === undefined ? [] : [{ 键: "时间精度", 值 }]),
        ],
      })
    挂(造图([精度("日"), 精度("时"), 精度("分"), 精度()], []))
    expect(两行("ev日")).toEqual(["转 · 12000元", "03-04"])
    expect(两行("ev时")).toEqual(["转 · 12000元", "03-04 14时"])
    expect(两行("ev分")).toEqual(["转 · 12000元", "03-04 14:22"])
    // 未标 ⇒ 按「分」渲染（同一分支，不是第四种格式）。
    expect(两行("ev未标")).toEqual(["转 · 12000元", "03-04 14:22"])
  })

  test("#3 缺金额 ⇒ 第一行只有类型首字", () => {
    挂(造图([事件节点("ev", { 属性: [{ 键: "时间精度", 值: "分" }] })], []))
    expect(两行("ev")).toEqual(["转", "03-04 14:22"])
  })

  test("忽略 样式.形状：样式写 diamond 仍是 event-card 矩形，不画多边形", () => {
    挂(造图([事件节点("ev", { 样式: { 形状: "diamond" } })], []))
    // 忽略的证据：形状槽只有一个（那一个 rect），不是 polygon / circle，也没有第二块形状。
    const 形状们 = [...节点组("ev")!.querySelectorAll("[data-slot='hgraph-node-shape']")]
    expect(形状们.length).toBe(1)
    expect(形状们[0].tagName.toLowerCase()).toBe("rect")
    expect(形状们[0].getAttribute("data-node-shape")).toBe("event-card")
    expect(节点组("ev")!.querySelectorAll("polygon").length).toBe(0)
  })

  test("走原节点渲染路径：同一个 hgraph-node 组、同一条标签槽、同一套点选命中", () => {
    const { 动作, 计数 } = 记动作表()
    挂(
      造图([
        事件节点("ev", { 名称: "转给李四", x: 200, y: 150 }),
        造节点("n2", 500, 150, { 名称: "李四" }),
      ], []),
      undefined,
      { 动作, 坐标换算: () => ({ x: 200, y: 150 }) },
    )
    // 同一个节点组容器（不是另起一层/另写一套图层）。
    expect(全部("[data-slot='hgraph-node']").length).toBe(2)
    expect(节点组("ev")!.getAttribute("data-node-id")).toBe("ev")
    // 标签槽与普通节点同一条（`保留标签` + `截断标签`），事件卡不另写标签逻辑。
    expect(节点组("ev")!.querySelector("[data-slot='hgraph-node-label']")?.textContent).toBe("转给李四")
    expect(节点组("n2")!.querySelector("[data-slot='hgraph-node-label']")?.textContent).toBe("李四")
    // 命中：按在卡面 rect 上 ⇒ pointerdown 经 `closest` 读到外层 data-node-id，松手选中它。
    按一下(卡("ev")!, { x: 200, y: 150 })
    const 选择 = 计数["选择"] ?? []
    expect(选择.length).toBe(1)
    expect(选择[0]).toEqual([["ev"], false])
  })
})

// ---------------------------------------------------------------------------
// T012 · 手写事件识别与边线型渲染
// ---------------------------------------------------------------------------

describe("T012 · 手写事件的事件卡", () => {
  test("手写节点带 `时间精度` ⇒ 渲染 event-card", () => {
    挂(
      造图([
        造节点("h", 100, 100, {
          来源: { kind: "手写" },
          属性: [{ 键: "时间精度", 值: "分" }],
        }),
      ], []),
    )
    const 形状们 = [...节点组("h")!.querySelectorAll("[data-slot='hgraph-node-shape']")]
    expect(形状们.length).toBe(1)
    expect(形状们[0].getAttribute("data-node-shape")).toBe("event-card")
  })

  test("手写节点无 `时间精度` ⇒ 普通形状，不是事件卡", () => {
    挂(
      造图([
        造节点("h", 100, 100, {
          来源: { kind: "手写" },
          属性: [{ 键: "金额", 值: "12000元" }],
        }),
      ], []),
    )
    const 形状们 = [...节点组("h")!.querySelectorAll("[data-slot='hgraph-node-shape']")]
    expect(形状们.length).toBe(1)
    expect(形状们[0].getAttribute("data-node-shape") === "event-card").toBe(false)
  })
})

describe("T012 · 边线型渲染", () => {
  const 线 = (id: string) =>
    document.querySelector<SVGLineElement>(`[data-edge-id='${id}'] [data-slot='hgraph-edge-line']`)

  test("角色边 ⇒ 实线（无 stroke-dasharray）", () => {
    const 事件 = 造节点("ev", 100, 100, {
      来源: { kind: "手写" },
      属性: [{ 键: "时间精度", 值: "分" }],
    })
    const 参与 = 造节点("p", 400, 100)
    挂(造图([事件, 参与], [角色边(事件, "p", "付款方", "中", "e1")]))

    const 元素 = 线("e1")
    expect(元素 !== null).toBe(true)
    expect(元素!.getAttribute("stroke-dasharray") === null).toBe(true)
  })

  test("普通推断边 ⇒ 虚线 `4 3`", () => {
    挂(造图(
      [造节点("a", 100, 100), 造节点("b", 400, 100)],
      [造边("e2", "a", "b", { 性质: "推断", 标签: "联系" })],
    ))

    const 元素 = 线("e2")
    expect(元素 !== null).toBe(true)
    expect(元素!.getAttribute("stroke-dasharray")).toBe("4 3")
  })

  test("两事件之间的时序边 ⇒ 点线 `1 3`", () => {
    const 甲 = 造节点("e1", 100, 100, {
      来源: { kind: "手写" },
      属性: [{ 键: "时间精度", 值: "分" }],
    })
    const 乙 = 造节点("e2", 400, 100, {
      来源: { kind: "手写" },
      属性: [{ 键: "时间精度", 值: "分" }],
    })
    挂(造图(
      [甲, 乙],
      [造边("e3", "e1", "e2", { 性质: "推断", 标签: "先" })],
    ))

    const 元素 = 线("e3")
    expect(元素 !== null).toBe(true)
    expect(元素!.getAttribute("stroke-dasharray")).toBe("1 3")
  })
})

// ---------------------------------------------------------------------------
// T017 · 强度过滤「只看 ≥ N 档」
// ---------------------------------------------------------------------------

/**
 * 五颗节点、四条边，档位分别 1 / 2 / 3 / 4（`边.线宽档` 手动值 ⇒ `边档` 原样返回）。
 * 节点比边端点多一颗（e 只接 e4）：过滤只该动边，不该让任何节点消失。
 */
function 四档图(): 图文件 {
  return 造图(
    [
      造节点("a", 80, 100),
      造节点("b", 220, 100),
      造节点("c", 360, 100),
      造节点("d", 500, 100),
      造节点("e", 640, 100),
    ],
    [
      造边("e1", "a", "b", { 线宽档: 1 }),
      造边("e2", "b", "c", { 线宽档: 2 }),
      造边("e3", "c", "d", { 线宽档: 3 }),
      造边("e4", "d", "e", { 线宽档: 4 }),
    ],
  )
}

const 边id们 = () =>
  [...document.querySelectorAll("[data-slot='hgraph-edge']")]
    .map((组) => 组.getAttribute("data-edge-id"))
    .sort((甲, 乙) => {
      const 左 = 甲 ?? ""
      const 右 = 乙 ?? ""
      return 左 < 右 ? -1 : 左 > 右 ? 1 : 0
    })

describe("T017 · 强度过滤", () => {
  test("N=3：1–2 档边不渲染，正好 3 档与 4 档仍渲染（含边界），节点一颗不少", () => {
    挂(四档图(), undefined, { 强度阈值: 3 })

    expect(边id们()).toEqual(["e3", "e4"])
    expect(取("[data-edge-id='e3']")!.getAttribute("data-edge-tier")).toBe("3")
    expect(取("[data-edge-id='e4']")!.getAttribute("data-edge-tier")).toBe("4")
    // 过滤只作用于边：五颗节点全部仍在。
    expect(全部("[data-slot='hgraph-node']").length).toBe(5)
  })

  test("角落提示的条数 = 实际隐藏数（不是阈值，也不含演示可见已排除的边）", () => {
    // 第 5 条边被 `可见` 排除：它本来就不渲染，不能被算进「已隐藏 N 条」。
    const 图 = 造图(
      [
        造节点("a", 80, 100),
        造节点("b", 220, 100),
        造节点("c", 360, 100),
        造节点("d", 500, 100),
        造节点("e", 640, 100),
      ],
      [
        造边("e1", "a", "b", { 线宽档: 1 }),
        造边("e2", "b", "c", { 线宽档: 2 }),
        造边("e3", "c", "d", { 线宽档: 3 }),
        造边("e4", "d", "e", { 线宽档: 4 }),
        造边("e5", "e", "a", { 线宽档: 1 }),
      ],
    )
    挂(图, undefined, {
      强度阈值: 3,
      可见: { 节点: new Set(图.节点.map((点) => 点.id)), 边: new Set(["e1", "e2", "e3", "e4"]) },
    })

    // 实际隐藏 2 条（e1 / e2）；阈值是 3，演示可见已排除的 e5 不计入。
    const 文案元素 = 取("[data-slot='hgraph-strength-hidden-text']")
    expect(文案元素 !== null).toBe(true)
    expect(文案元素!.textContent?.trim()).toBe("已隐藏 2 条较弱关系")
    expect(取("[data-slot='hgraph-strength-hidden-note']") !== null).toBe(true)
  })

  test("一键恢复：点恢复后阈值回关闭，全部边回来、提示消失", () => {
    const 图 = 四档图()
    const [阈, set阈] = createSignal<number | undefined>(3)
    const host = document.createElement("div")
    document.body.appendChild(host)
    挂过的.push(
      render(
        () => (
          <画布
            文档={图}
            选中={[]}
            模式="指针"
            动作={幽灵动作表()}
            强度阈值={阈()}
            恢复强度={() => set阈(undefined)}
          />
        ),
        host,
      ),
    )

    expect(边id们()).toEqual(["e3", "e4"])
    const 恢复 = 取("[data-slot='hgraph-strength-restore']")
    expect(恢复 !== null).toBe(true)
    ;(恢复 as HTMLButtonElement).click()

    expect(边id们()).toEqual(["e1", "e2", "e3", "e4"])
    // `#013-12`：DOM 节点「不存在」用布尔比较，不用 toBeNull。
    expect(取("[data-slot='hgraph-strength-hidden-note']") === null).toBe(true)
  })

  test("图例保持纯说明：容器内没有 input / select / 档位控件", () => {
    挂(四档图())

    const 图例 = 取("[data-slot='hgraph-legend']")
    // 先立前提：图例确实在文档里，且四条说明都在——避免「容器没渲染」造成的假绿。
    expect(图例 !== null).toBe(true)
    expect(document.body.contains(图例!)).toBe(true)
    expect(条目数()).toBe(4)

    expect(
      图例!.querySelectorAll("input, select, textarea, [role='checkbox'], [role='slider'], [role='switch']").length,
    ).toBe(0)
    // 强度过滤控件 / 提示 / 恢复入口都不许长在图例里。
    expect(图例!.querySelector("[data-slot^='hgraph-strength']") === null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// FR-051 / FR-033（terminal review final-fix1a）
// ---------------------------------------------------------------------------

describe("FR-051 · 画布边界", () => {
  test("容器带 1px 描边、圆角 8、与外围不同的底色阶（全部走 v2 token 类）", () => {
    挂(造图([造节点("a", 100, 100)], []))
    const 容器 = 取("[data-slot='hgraph-canvas']")
    // 前提：画布真的挂上了（`#013-12`：先立存在前提，不用 toBeNull 兜底）。
    expect(容器 !== null).toBe(true)
    expect(document.body.contains(容器!)).toBe(true)

    const 类 = 容器!.classList
    expect(类.contains("border")).toBe(true) // 1px 描边宽度
    expect(类.contains("border-v2-border-border-muted")).toBe(true) // 描边色 token
    expect(类.contains("rounded-lg")).toBe(true) // 圆角 8（Tailwind lg = 0.5rem）
    // 与外围不同阶：外围是 bg-base，画布换成 layer-01。
    expect(类.contains("bg-v2-background-bg-layer-01")).toBe(true)
    expect(类.contains("bg-v2-background-bg-base")).toBe(false)

    const 原样 = 容器!.getAttribute("class") ?? ""
    expect(原样.includes("#")).toBe(false) // 不写 hex
    expect(原样.includes("[")).toBe(false) // 不写任意值
  })
})

describe("FR-033 · 外环双通道（类型色 + 连接数角标）", () => {
  /** 1 颗高连接数节点 + 5 条边 ⇒ 外环自动档 = 3（阈值 [1,2,4,8]）。 */
  function 高连接图(点补丁: Partial<节点> = {}): 图文件 {
    return 造图(
      [
        造节点("a", 100, 100, 点补丁),
        造节点("b", 200, 100),
        造节点("c", 300, 100),
        造节点("d", 200, 200),
        造节点("e", 100, 200),
        造节点("f", 300, 200),
      ],
      [
        造边("e1", "a", "b"),
        造边("e2", "a", "c"),
        造边("e3", "a", "d"),
        造边("e4", "a", "e"),
        造边("e5", "a", "f"),
      ],
    )
  }
  const 外环 = (id: string) => 节点组(id)!.querySelector("[data-slot='hgraph-node-ring']")
  const 角标 = (id: string) => 节点组(id)!.querySelector("[data-slot='hgraph-degree-badge']")

  test("外环「自动」（无 `外环.颜色`）⇒ 颜色取节点类型色（账户 ⇒ success），不是统一灰", () => {
    挂(高连接图({ 类型: "账户" }))
    const 环 = 外环("a")
    expect(环 !== null).toBe(true)
    expect(环!.getAttribute("stroke")).toBe("var(--v2-state-bg-success)")
  })

  /**
   * final-fix2 N1：未映射类型不能落回 `填充` 的默认 `layer-02`——那与画布底色/未选中
   * 填充同阶，高连接节点的粗环几乎看不见；回退到原先可见的 `border-strong`。
   */
  test("未映射类型（人）自动外环 ⇒ 回退 border-strong，不是 layer-02", () => {
    挂(高连接图({ 类型: "人" }))
    const 环 = 外环("a")
    expect(环 !== null).toBe(true)
    expect(环!.getAttribute("stroke")).toBe("var(--v2-border-border-strong)")
    expect(环!.getAttribute("stroke")).not.toBe("var(--v2-background-bg-layer-02)")
  })

  test("自动档 ≥3 ⇒ 角标文本 = 该节点连接数", () => {
    挂(高连接图())
    const 标 = 角标("a")
    expect(标 !== null).toBe(true)
    expect(标!.textContent?.trim()).toBe("5")
    // 连接少的节点（b 只有 1 条边，档 1）不挂角标。
    expect(角标("b") === null).toBe(true)
  })

  test("手动设色节点不显示角标：颜色照旧走预设色表", () => {
    挂(高连接图({ 外环: { 颜色: "红" } }))
    const 环 = 外环("a")
    expect(环 !== null).toBe(true)
    expect(环!.getAttribute("stroke")).toBe("var(--v2-state-border-danger)")
    expect(角标("a") === null).toBe(true)
  })

  /** final-fix2 N4：角标只服务「自动档」；手动设档（哪怕没设颜色）不显示。 */
  test("手动设档（外环.档=3、无颜色）⇒ 档仍是 3，但角标不显示", () => {
    挂(高连接图({ 外环: { 档: 3 } }))
    const 环 = 外环("a")
    expect(环 !== null).toBe(true)
    expect(环!.getAttribute("data-ring-tier")).toBe("3")
    expect(角标("a") === null).toBe(true)
  })
})
