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
import type { 边, 图文件, 节点, 设置, 文字 } from "./file"
import { 画布, 是双指平移, type 画布动作, type 坐标换算 } from "./canvas"

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
    readonly 坐标换算?: 坐标换算
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
    挂(
      造图(
        [造节点("n1", 100, 100), 造节点("n2", 300, 100)],
        [造边("正常", "n1", "n2"), 造边("自环", "n1", "n1"), 造边("悬空", "n2", "n9")],
      ),
    )
    // 自环两端都在节点表 ⇒ 照常渲染；悬空边仍被剔除。
    expect(边组们().length).toBe(2)
    expect(取("[data-edge-id='正常']")).not.toBeNull()
    expect(取("[data-edge-id='自环']")).not.toBeNull()
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

// ---------------------------------------------------------------------------
// 修复轮 2026-11-16：R-F4（悬空边角标）/ R-F5（双指平移）/ R-F11（文字折行）
// ---------------------------------------------------------------------------

describe("T019a · 悬空边角标（R-F4）", () => {
  test("一条悬空边 ⇒ 角标「1 条边指向不存在的节点」＋ 可读 title", () => {
    挂(造图([造节点("n1", 100, 100)], [造边("悬空", "n1", "n2")]))
    const 角标 = 取("[data-slot='hgraph-dangling-badge']")
    expect(角标).not.toBeNull()
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
    expect(取("[data-slot='hgraph-dangling-badge']")).toBeNull()
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
    expect(文).not.toBeNull()
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
    expect(线).not.toBeNull()
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
