/**
 * T014 · 从库加入节点（选择器）。
 *
 * 用例直挂 `选择器`，注入替身 `list` / `profile` 与幽灵 `onAdd` / `onClose`：
 * 钉住「一次批量、一次撤销」的入参形状、类型前端筛选、已在图上的禁用，
 * 以及 R59「出处恒空、不伪造」。
 *
 * 界面文案「库中无记录属性 / 未取到出处」在检查器只读区（加入后节点被选中）：
 * 本文件的 #4 钉节点载荷为空数组，`inspector.test.tsx` 钉那两句文案。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { EntityApi, 实体清单项 } from "@/project/entity-api"
import type { CaseDetailApi, 实体档案, 档案关系, 引用 } from "@/center/case-detail-api"
import type { 操作 } from "@/project/hgraph-api"
import type { 节点 } from "./file"
import { 选择器, 可信度映射, 关系边, 时间跨度, 属性们 } from "./entity-picker"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const 落定 = async () => {
  await flush()
  await flush()
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 本地时区当天中午的秒数：`日期文本` 是本地时区，正午不会跨日。 */
const 秒 = (年: number, 月: number, 日: number) => new Date(年, 月 - 1, 日, 12).getTime() / 1000

function 清单项(补丁: Partial<实体清单项> & { id: string }): 实体清单项 {
  return {
    type: "人",
    canonical_value: 补丁.id,
    trust_state: "已确认",
    关联数: 0,
    事件参与数: 0,
    权重: 0,
    分组: "核心",
    created_at: 0,
    ...补丁,
  }
}

/** 四行：两个「人」、两个「账号」——类型筛选的期望数字是 2。 */
const 行们: 实体清单项[] = [
  清单项({ id: "e1", canonical_value: "张三", subtype: "嫌疑人", 关联数: 3 }),
  清单项({ id: "e2", canonical_value: "张三丰", trust_state: "存疑" }),
  清单项({ id: "e3", type: "账号", canonical_value: "张三的卡" }),
  清单项({ id: "e4", type: "账号", canonical_value: "李四的卡" }),
]

function 档案(补丁: Partial<实体档案> & { id: string }): 实体档案 {
  return {
    type: "人",
    canonical_value: 补丁.id,
    aliases: [],
    attrs: {},
    trust_state: "已确认",
    created_at: 0,
    关系: [],
    事件: [],
    关系总数: 0,
    关系数据总数: 0,
    关系人总数: 0,
    事件总数: 0,
    对方数: 0,
    引用: [],
    引用总数: 0,
    待确认: { 实体: 0, 关系: 0, 事件: 0, 合计: 0 },
    一句话: "",
    ...补丁,
  }
}

function 关系(首: number | null, 末: number | null): 档案关系 {
  return {
    id: `r${首}-${末}`,
    type: "转账",
    方向: "出",
    对方id: "x",
    对方值: "x",
    对方类型: "人",
    对方细类: null,
    source_kind: "交易",
    basis: null,
    trust_state: "已确认",
    首,
    末,
    次数: 1,
    金额: null,
  }
}

const 引用一条: 引用 = {
  id: "c1",
  materialId: "m1",
  fileName: "流水.xlsx",
  path: "材料/流水.xlsx",
  // 切片 locator（R59）：没有工作表/行号 ⇒ 行级出处拼不出，只能空数组。
  locator: { start: 0, end: 4 },
  extractMethod: "机器",
  confidence: 1,
}

/**
 * e1 的快照：两条关系，**第一条不是极值**（首 15 / 末 14，第二条才是 14 / 15）。
 * 变异「取首条」会立刻红。
 */
const e1档案 = 档案({
  id: "e1",
  canonical_value: "张三",
  type: "人",
  subtype: "嫌疑人",
  trust_state: "已确认",
  attrs: { 开户行: "招商银行" },
  关系: [关系(秒(2023, 11, 15), 秒(2023, 11, 14)), 关系(秒(2023, 11, 14), 秒(2023, 11, 15))],
  引用: [引用一条],
  引用总数: 1,
})

/**
 * e2：库里有引用、但没有属性——节点仍建，`属性: []`，`出处: []`（R59）。
 */
const e2档案 = 档案({
  id: "e2",
  canonical_value: "张三丰",
  attrs: {},
  引用: [引用一条],
  引用总数: 1,
})

type 列表入参 = Parameters<EntityApi["list"]>[0]

function 挂选择器(选项: {
  list?: (input: 列表入参) =>
    | Awaited<ReturnType<EntityApi["list"]>>
    | ReturnType<EntityApi["list"]>
  profile?: (id: string) =>
    | Awaited<ReturnType<CaseDetailApi["profile"]>>
    | ReturnType<CaseDetailApi["profile"]>
  已有节点?: readonly 节点[]
  摆放?: (序号: number) => { readonly x: number; readonly y: number }
  模式?: "加入" | "绑定"
} = {}) {
  const list调用: 列表入参[] = []
  const profile调用: Array<[string, string]> = []
  const 加过: 操作[][] = []
  const 绑定过: Array<[实体清单项, 实体档案]> = []
  let 关过 = 0

  const 实体api: Pick<EntityApi, "list"> = {
    list: async (input) => {
      list调用.push(input)
      if (选项.list !== undefined) return await 选项.list(input)
      return { kind: "ok", value: { 行们, 总数: 行们.length, 缺口: [] } }
    },
  }
  const 详情api: Pick<CaseDetailApi, "profile"> = {
    profile: async (projectId, id) => {
      profile调用.push([projectId, id])
      if (选项.profile !== undefined) return await 选项.profile(id)
      if (id === "e1") return { kind: "ok", value: e1档案 }
      if (id === "e2") return { kind: "ok", value: e2档案 }
      return { kind: "ok", value: 档案({ id, canonical_value: id }) }
    },
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <选择器
          projectId="p 1"
          实体api={实体api}
          详情api={详情api}
          已有节点={选项.已有节点 ?? []}
          摆放={选项.摆放 ?? ((序号) => ({ x: 100 + 序号 * 10, y: 200 + 序号 * 10 }))}
          模式={选项.模式}
          onAdd={(操作们) => 加过.push([...操作们])}
          onBind={(行, 值) => 绑定过.push([行, 值])}
          onClose={() => {
            关过 += 1
          }}
        />
      ),
      host,
    ),
  )
  // 前提（`#005-18` / `#013-12`）：选择器确实渲染出了元素，避免「整块没挂上」把缺失断言衬成假绿。
  expect(host.firstElementChild !== null).toBe(true)

  return { list调用, profile调用, 加过, 绑定过, 关过: () => 关过 }
}

// ---------------------------------------------------------------------------
// DOM 取值
// ---------------------------------------------------------------------------

const 取 = (选择器串: string) => document.body.querySelector(选择器串) as HTMLElement | null
const 文本 = (slot: string) => 取(`[data-slot='${slot}']`)?.textContent?.trim()
const 行数 = () => document.body.querySelectorAll("[data-slot='hgraph-picker-row']").length

function 输入(值: string) {
  const 框 = 取("[data-slot='hgraph-picker-q']") as HTMLInputElement
  框.value = 值
  框.dispatchEvent(new Event("input", { bubbles: true }))
}

function 点搜索() {
  ;(取("[data-slot='hgraph-picker-search']") as HTMLButtonElement).click()
}

function 选类型(值: string) {
  const 下拉 = 取("[data-slot='hgraph-picker-type']") as HTMLSelectElement
  下拉.value = 值
  下拉.dispatchEvent(new Event("change", { bubbles: true }))
}

const 勾选框 = (id: string) =>
  取(`[data-slot='hgraph-picker-check'][data-entity-id='${id}']`) as HTMLInputElement | null

function 勾选(id: string, 状态 = true) {
  const 框 = 勾选框(id)!
  框.checked = 状态
  框.dispatchEvent(new Event("change", { bubbles: true }))
}

function 点加入() {
  ;(取("[data-slot='hgraph-picker-add']") as HTMLButtonElement).click()
}

/** 绑定模式：点整行（不是勾选框）——「再点另一行就换」是行选择语义。 */
function 点行(id: string) {
  const 行 = 取(`[data-slot='hgraph-picker-row'][data-entity-id='${id}']`)
  if (行 === null) throw new Error(`没有行 ${id}`)
  行.click()
}

const 绑定键 = () => 取("[data-slot='entity-picker-bind']") as HTMLButtonElement | null

// 关系页（修复轮 T7 / FR-031）

const 页签 = (tab: "实体" | "关系") =>
  取(`[data-slot='hgraph-picker-tab'][data-tab='${tab}']`) as HTMLButtonElement | null

function 点页签(tab: "实体" | "关系") {
  const 钮 = 页签(tab)
  if (钮 === null) throw new Error(`没有页签 ${tab}`)
  钮.click()
}

function 点关系(id: string) {
  const 钮 = 取(`[data-slot='hgraph-picker-relations'][data-entity-id='${id}']`) as HTMLButtonElement | null
  if (钮 === null) throw new Error(`没有「关系」按钮 ${id}`)
  钮.click()
}

const 关系行 = (id: string) => 取(`[data-slot='hgraph-picker-relation-row'][data-relation-id='${id}']`)
const 关系行数 = () => document.body.querySelectorAll("[data-slot='hgraph-picker-relation-row']").length

function 勾选关系(id: string, 状态 = true) {
  const 框 = 取(`[data-slot='hgraph-picker-relation-check'][data-relation-id='${id}']`) as HTMLInputElement | null
  if (框 === null) throw new Error(`没有关系勾选框 ${id}`)
  框.checked = 状态
  框.dispatchEvent(new Event("change", { bubbles: true }))
}

const 加关系键 = () => 取("[data-slot='hgraph-picker-relation-add']") as HTMLButtonElement | null

// ---------------------------------------------------------------------------
// 验收 #1 · 搜索
// ---------------------------------------------------------------------------

describe("选择器 · 搜索", () => {
  test("#1 搜索「张」：list 收到 {projectId, q:'张', limit:50}；行数 = 夹具行数", async () => {
    const 器 = 挂选择器()
    await 落定()

    输入("张")
    点搜索()
    await 落定()

    expect(器.list调用.at(-1)).toEqual({ projectId: "p 1", q: "张", limit: 50 })
    expect(行数()).toBe(4)
    expect(文本("hgraph-picker-row-e1")).toContain("张三")
  })

  test("T019a 搜索竞态：先发的慢响应后到，不得覆盖后发的新结果", async () => {
    const 待 = new Map<string, (回: Awaited<ReturnType<EntityApi["list"]>>) => void>()
    const 器 = 挂选择器({
      list: (输入) => {
        if (输入.q === "") return Promise.resolve({ kind: "ok", value: { 行们, 总数: 行们.length, 缺口: [] } })
        return new Promise<Awaited<ReturnType<EntityApi["list"]>>>((resolve) => 待.set(输入.q!, resolve))
      },
    })
    await 落定()

    const 框 = 取("[data-slot='hgraph-picker-q']") as HTMLInputElement
    const 回车 = () => 框.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    输入("慢")
    回车()
    await flush()
    输入("快")
    回车()
    await flush()

    // 「快」先回：新结果落地。
    待.get("快")!({ kind: "ok", value: { 行们: [清单项({ id: "快1", canonical_value: "快结果" })], 总数: 1, 缺口: [] } })
    await 落定()
    // 「慢」后回：旧请求必须作废，不能把新结果顶掉。
    待.get("慢")!({ kind: "ok", value: { 行们: [清单项({ id: "慢1", canonical_value: "慢结果" })], 总数: 1, 缺口: [] } })
    await 落定()

    expect(文本("hgraph-picker-row-快1")).toContain("快结果")
    expect(勾选框("慢1") === null).toBe(true)
    expect(行数()).toBe(1)
    expect(器.list调用.map((入参) => 入参.q)).toEqual(["", "慢", "快"])
  })

  test("#1b 搜索框回车也发起同一次搜索", async () => {
    const 器 = 挂选择器()
    await 落定()

    输入("李")
    取("[data-slot='hgraph-picker-q']")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    )
    await 落定()

    expect(器.list调用.at(-1)).toEqual({ projectId: "p 1", q: "李", limit: 50 })
  })
})

// ---------------------------------------------------------------------------
// 验收 #2 · 类型前端筛选
// ---------------------------------------------------------------------------

describe("选择器 · 类型筛选", () => {
  test("#2 选「人」：只剩夹具里 type==='人' 的 2 行（不发第二次 list）", async () => {
    const 器 = 挂选择器()
    await 落定()
    const 搜索次数 = 器.list调用.length

    选类型("人")
    await flush()

    expect(行数()).toBe(2)
    expect(勾选框("e1") !== null).toBe(true)
    expect(勾选框("e3") === null).toBe(true)
    // 纯前端筛选：不改搜索条件、不再打接口。
    expect(器.list调用.length).toBe(搜索次数)
  })
})

// ---------------------------------------------------------------------------
// 验收 #3 · 加入 1 个（逐字断言节点载荷）
// ---------------------------------------------------------------------------

describe("选择器 · 加入节点", () => {
  test("#3 加入 e1：一个「加节点」操作，名称/类型/细类/来源/属性/出处/时间/x/y 逐字", async () => {
    const 器 = 挂选择器()
    await 落定()

    勾选("e1")
    点加入()
    await 落定()

    expect(器.加过.length).toBe(1)
    expect(器.加过[0]!.length).toBe(1)
    const 操作 = 器.加过[0]![0]!
    expect(操作.操作).toBe("加节点")
    if (操作.操作 !== "加节点") throw new Error("形状不对")

    expect(操作.节点.length).toBe(1)
    const 点 = 操作.节点[0]! as Record<string, unknown>
    expect(点.名称).toBe("张三")
    expect(点.类型).toBe("人")
    expect(点.细类).toBe("嫌疑人")
    expect(点.来源).toEqual({
      kind: "实体",
      实体: "e1",
      值: "张三",
      库类型: "人",
      可信: "已确认",
    })
    expect(点.属性).toEqual([{ 键: "开户行", 值: "招商银行", 出处: [] }])
    // R59：引用只有切片 locator ⇒ 行级出处拼不出，一律空数组，不伪造。
    expect(点.出处).toEqual([])
    expect(点.时间).toEqual({ 首: "2023-11-14", 末: "2023-11-15" })
    expect(点.x).toBe(100)
    expect(点.y).toBe(200)
    expect(String(点.id)).toMatch(/^临时n\d+$/)
    // 成功加入后收起面板（由编辑器把新 id 设为选中）。
    expect(器.关过()).toBe(1)
    expect(器.profile调用).toEqual([["p 1", "e1"]])
  })

  test("#4 库取不到属性/出处：节点仍建，属性/出处都是空数组（不拦、不伪造）", async () => {
    const 器 = 挂选择器()
    await 落定()

    勾选("e2")
    点加入()
    await 落定()

    expect(器.加过.length).toBe(1)
    const 操作 = 器.加过[0]![0]!
    if (操作.操作 !== "加节点") throw new Error("形状不对")
    const 点 = 操作.节点[0]! as Record<string, unknown>
    expect(点.属性).toEqual([])
    expect(点.出处).toEqual([])
    expect(点.名称).toBe("张三丰")
    expect(器.关过()).toBe(1)
  })

  test("#5 profile 失败其一：另一个仍加入；失败者名字出现；onAdd 恰 1 次", async () => {
    const 器 = 挂选择器({
      profile: (id) =>
        id === "e4"
          ? { kind: "error", message: "实体不存在", code: "NOT_FOUND" }
          : { kind: "ok", value: 档案({ id, canonical_value: "张三" }) },
    })
    await 落定()

    // e4 是「李四的卡」——失败文案必须点名到人。
    勾选("e1")
    勾选("e4")
    点加入()
    await 落定()

    expect(器.加过.length).toBe(1)
    const 操作 = 器.加过[0]![0]!
    if (操作.操作 !== "加节点") throw new Error("形状不对")
    expect(操作.节点.length).toBe(1)
    expect((操作.节点[0]! as Record<string, unknown>).名称).toBe("张三")

    const 错 = 文本("hgraph-picker-error") ?? ""
    expect(错).toContain("取不到档案，未加入")
    expect(错).toContain("李四的卡")
    // 有失败项时面板保留（让人看见谁失败），不自动关。
    expect(器.关过()).toBe(0)
  })

  test("#6 已在图上的实体：勾选框 disabled + 「已在图上」，加入只含新勾的", async () => {
    const 已有节点: 节点[] = [
      {
        id: "n1",
        名称: "张三",
        类型: "人",
        来源: { kind: "实体", 实体: "e1", 值: "张三" },
        时间: { 首: "", 末: "" },
        x: 100,
        y: 100,
      },
    ]
    const 器 = 挂选择器({ 已有节点 })
    await 落定()

    const 框 = 勾选框("e1")!
    expect(框.disabled).toBe(true)
    expect(文本("hgraph-picker-row-e1")).toContain("已在图上")

    勾选("e2")
    点加入()
    await 落定()

    expect(器.加过.length).toBe(1)
    const 操作 = 器.加过[0]![0]!
    if (操作.操作 !== "加节点") throw new Error("形状不对")
    expect(操作.节点.length).toBe(1)
    expect((操作.节点[0]! as Record<string, unknown>).来源).toMatchObject({ 实体: "e2" })
  })

  test("#7 加入多个：onAdd 恰 1 次、1 条「加节点」、节点数 = 勾选数（一次批量）", async () => {
    const 器 = 挂选择器()
    await 落定()

    勾选("e1")
    勾选("e2")
    勾选("e3")
    点加入()
    await 落定()

    expect(器.加过.length).toBe(1)
    expect(器.加过[0]!.length).toBe(1)
    const 操作 = 器.加过[0]![0]!
    if (操作.操作 !== "加节点") throw new Error("形状不对")
    expect(操作.节点.length).toBe(3)
    // 摆放按加入序号 0/1/2 逐颗错开。
    expect(操作.节点.map((点) => [(点 as Record<string, unknown>).x, (点 as Record<string, unknown>).y])).toEqual([
      [100, 200],
      [110, 210],
      [120, 220],
    ])
    expect(new Set(操作.节点.map((点) => (点 as Record<string, unknown>).id)).size).toBe(3)
  })

  test("R91-2 摆放给小数 ⇒ 节点 x/y 取整（100.4 → 100，200.6 → 201）", async () => {
    // 服务端要求整数 x/y（hgraph-edit「x 必须是整数」）；`阶梯位置` 恰好整数，
    // 但注入的 `摆放` 若给小数，整批 `加节点` 会被拒。
    const 器 = 挂选择器({ 摆放: () => ({ x: 100.4, y: 200.6 }) })
    await 落定()

    勾选("e1")
    点加入()
    await 落定()

    expect(器.加过.length).toBe(1)
    const 操作 = 器.加过[0]![0]!
    expect(操作.操作).toBe("加节点")
    if (操作.操作 !== "加节点") throw new Error("形状不对")
    const 点 = 操作.节点[0]! as Record<string, unknown>
    expect(点.x).toBe(100)
    expect(点.y).toBe(201)
  })

  test("T019a 加入在飞时点「收起」：回来的结果不得再 onAdd、也不得二次 onClose", async () => {
    let 放: (回: Awaited<ReturnType<CaseDetailApi["profile"]>>) => void = () => {}
    const 器 = 挂选择器({
      profile: () => new Promise<Awaited<ReturnType<CaseDetailApi["profile"]>>>((resolve) => void (放 = resolve)),
    })
    await 落定()

    勾选("e1")
    点加入()
    await flush()

    // 请求还没回来，用户先收起面板。
    ;(取("[data-slot='hgraph-picker-close']") as HTMLButtonElement).click()
    await flush()
    expect(器.关过()).toBe(1)

    放({ kind: "ok", value: e1档案 })
    await 落定()

    expect(器.加过.length).toBe(0)
    expect(器.关过()).toBe(1)
  })

  test("全部失败 ⇒ 不调 onAdd，面板保留错误", async () => {
    const 器 = 挂选择器({
      profile: () => ({ kind: "error", message: "网络断了" }),
    })
    await 落定()

    勾选("e1")
    点加入()
    await 落定()

    expect(器.加过.length).toBe(0)
    expect(器.关过()).toBe(0)
    expect(文本("hgraph-picker-error") ?? "").toContain("取不到档案，未加入")
  })
})

// ---------------------------------------------------------------------------
// 绑定模式（FR-027 / R-F9）
// ---------------------------------------------------------------------------

describe("选择器 · 绑定模式", () => {
  test("单选：点 A 再点 B ⇒ 只有 B 选中；加入 footer 不在、绑定按钮在", async () => {
    const 器 = 挂选择器({ 模式: "绑定" })
    await 落定()

    expect(绑定键() !== null).toBe(true)
    expect(取("[data-slot='hgraph-picker-add']") === null).toBe(true)
    // 未选中：绑定按钮 disabled。
    expect(绑定键()!.disabled).toBe(true)

    点行("e1")
    await flush()
    expect(勾选框("e1")!.checked).toBe(true)
    expect(绑定键()!.disabled).toBe(false)

    点行("e2")
    await flush()
    expect(勾选框("e1")!.checked).toBe(false)
    expect(勾选框("e2")!.checked).toBe(true)
    expect(器.绑定过.length).toBe(0)
  })

  test("点「绑定到所选实体」⇒ profile(projectId, id) 一次，onBind 收到行与档案", async () => {
    const 器 = 挂选择器({ 模式: "绑定" })
    await 落定()

    点行("e2")
    await flush()
    绑定键()!.click()
    await 落定()

    expect(器.profile调用).toEqual([["p 1", "e2"]])
    expect(器.绑定过.length).toBe(1)
    expect(器.绑定过[0]![0].id).toBe("e2")
    expect(器.绑定过[0]![1].id).toBe("e2")
    // 绑定不落「加入」批，也不借用 onAdd。
    expect(器.加过.length).toBe(0)
  })

  test("profile 失败 ⇒ 零 onBind、错误文案、按钮仍可点", async () => {
    const 器 = 挂选择器({
      模式: "绑定",
      profile: () => ({ kind: "error", message: "实体不存在", code: "NOT_FOUND" }),
    })
    await 落定()

    点行("e1")
    await flush()
    绑定键()!.click()
    await 落定()

    expect(器.绑定过.length).toBe(0)
    expect(文本("hgraph-picker-error") ?? "").toContain("实体不存在")
    expect(绑定键()!.disabled).toBe(false)
  })

  test("默认仍是加入模式：加入按钮在、绑定按钮不在（既有路径不被换掉）", async () => {
    挂选择器()
    await 落定()

    expect(取("[data-slot='hgraph-picker-add']") !== null).toBe(true)
    expect(绑定键() === null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 纯函数（可单测的映射）
// ---------------------------------------------------------------------------

describe("选择器 · 纯函数", () => {
  test("时间跨度取全部关系的 min(首)/max(末)，不是首条", () => {
    expect(
      时间跨度([
        关系(秒(2023, 11, 15), 秒(2023, 11, 14)),
        关系(秒(2023, 11, 14), 秒(2023, 11, 16)),
        关系(null, null),
      ]),
    ).toEqual({ 首: "2023-11-14", 末: "2023-11-16" })
    expect(时间跨度([])).toEqual({ 首: "", 末: "" })
  })

  test("属性们：逐条 {键, 值(字符串), 出处: []}；非字符串值转成字符串", () => {
    expect(属性们({ 开户行: "招商银行", 卡号数: 2 })).toEqual([
      { 键: "开户行", 值: "招商银行", 出处: [] },
      { 键: "卡号数", 值: "2", 出处: [] },
    ])
    expect(属性们({})).toEqual([])
  })

  test("T019a 属性值为 null：与缺值同义，不进属性表（不写 \"null\"）", () => {
    expect(属性们({ 开户行: "招商银行", 空: null })).toEqual([{ 键: "开户行", 值: "招商银行", 出处: [] }])
  })
})

// ---------------------------------------------------------------------------
// 关系页（修复轮 T7 · FR-031 / R-F8）
// ---------------------------------------------------------------------------

/** r1：出 → A（有依据、已确认、有时间）。 */
const 关系A: 档案关系 = {
  id: "r1",
  type: "转账",
  方向: "出",
  对方id: "a1",
  对方值: "王某",
  对方类型: "人",
  对方细类: null,
  source_kind: "交易",
  basis: "银行流水第 12 页",
  trust_state: "已确认",
  首: 秒(2024, 1, 2),
  末: 秒(2024, 2, 3),
  次数: 3,
  金额: "5000.00",
}

/** r2：入 ← B（无依据、自动抽取、无时间、对方有细类）。 */
const 关系B: 档案关系 = {
  id: "r2",
  type: "收款",
  方向: "入",
  对方id: "b1",
  对方值: "李某的卡",
  对方类型: "账号",
  对方细类: "银行卡",
  source_kind: "交易",
  basis: null,
  trust_state: "自动抽取",
  首: null,
  末: null,
  次数: 1,
  金额: null,
}

/** 同一对方的第二条关系（钉「每个对方只取一次档案」）。 */
const 关系A二: 档案关系 = { ...关系A, id: "r3", type: "收款" }

const 张三档案 = 档案({ id: "e1", canonical_value: "张三", type: "人", 关系: [关系A, 关系B] })
const 张三档案全连A = 档案({ id: "e1", canonical_value: "张三", type: "人", 关系: [关系A, 关系A二] })
const 王某档案 = 档案({ id: "a1", canonical_value: "王某", type: "人" })
const 李某卡档案 = 档案({ id: "b1", canonical_value: "李某的卡", type: "账号", subtype: "银行卡" })

/** 本实体与 A 都已在图上（B 不在）。 */
const 图上本实体: 节点 = {
  id: "n1",
  名称: "张三",
  类型: "人",
  来源: { kind: "实体", 实体: "e1", 值: "张三" },
  时间: { 首: "", 末: "" },
  x: 100,
  y: 100,
}
const 图上A: 节点 = {
  id: "n2",
  名称: "王某",
  类型: "人",
  来源: { kind: "实体", 实体: "a1", 值: "王某" },
  时间: { 首: "", 末: "" },
  x: 200,
  y: 100,
}

function profile按表(表: Record<string, 实体档案>) {
  return (id: string): Awaited<ReturnType<CaseDetailApi["profile"]>> => {
    const 档 = 表[id]
    return 档 === undefined
      ? { kind: "error", message: "实体不存在", code: "NOT_FOUND" }
      : { kind: "ok", value: 档 }
  }
}

const 三档表 = profile按表({ e1: 张三档案, a1: 王某档案, b1: 李某卡档案 })

describe("选择器 · 关系页", () => {
  test("R-F8-1 点实体行「关系」⇒ 切到关系页、列出该实体既有关系", async () => {
    const 器 = 挂选择器({ profile: 三档表, 已有节点: [图上本实体, 图上A] })
    await 落定()

    点关系("e1")
    await 落定()

    expect(器.profile调用).toEqual([["p 1", "e1"]])
    expect(关系行数()).toBe(2)
    expect(文本("hgraph-picker-relation-title")).toContain("张三 的既有关系")
    // 行文案：对方值 · 对方类型(·细类) · 方向 · type · 首~末 · trust_state
    expect(关系行("r1")!.textContent).toContain("王某 · 人 · 出 · 转账 · 2024-01-02~2024-02-03 · 已确认")
    expect(关系行("r2")!.textContent).toContain("李某的卡 · 账号 · 银行卡 · 入 · 收款")
    expect(关系行("r2")!.textContent).toContain("—~—")
    // R59：脚注说明「按推断记、出处留空」。
    expect(文本("hgraph-picker-relation-note")).toContain("库中关系没有行级出处")
  })

  test("R-F8-2 选 r1（两端都在图上）⇒ 只有一条「加边」，逐字断言边载荷", async () => {
    const 器 = 挂选择器({ profile: 三档表, 已有节点: [图上本实体, 图上A] })
    await 落定()

    点关系("e1")
    await 落定()
    勾选关系("r1")
    expect(加关系键()!.disabled).toBe(false)
    加关系键()!.click()
    await 落定()

    expect(器.加过.length).toBe(1)
    expect(器.加过[0]!.length).toBe(1)
    const 操作 = 器.加过[0]![0]!
    expect(操作.操作).toBe("加边")
    if (操作.操作 !== "加边") throw new Error("形状不对")
    expect(操作.边.length).toBe(1)
    const 边 = 操作.边[0]!
    expect(边.从).toBe("n1")
    expect(边.到).toBe("n2")
    expect(边.标签).toBe("转账")
    expect(边.性质).toBe("推断")
    expect(边.方向).toBe("有向")
    expect(边.来源).toEqual({ kind: "关系", 关系们: ["r1"], 依据: "银行流水第 12 页" })
    expect(边.可信度).toBe("高")
    expect(边.时间).toEqual({ 首: "2024-01-02", 末: "2024-02-03" })
    expect(String(边.id)).toMatch(/^临时e\d+$/)
    // R59：不给行级出处，证据/出处都不写。
    expect(边.证据).toBeUndefined()
    expect(边.出处).toBeUndefined()
    expect(器.关过()).toBe(1)
    // A 已在图上 ⇒ 不再为对方取档案。
    expect(器.profile调用).toEqual([["p 1", "e1"]])
  })

  test("R-F8-3 B 不在图上 ⇒ 先补 B 快照「加节点」，再「加边」（从=B、到=本节点）", async () => {
    const 器 = 挂选择器({ profile: 三档表, 已有节点: [图上本实体] })
    await 落定()

    点关系("e1")
    await 落定()
    勾选关系("r2")
    加关系键()!.click()
    await 落定()

    expect(器.加过.length).toBe(1)
    const 操作们 = 器.加过[0]!
    expect(操作们.map((操作) => 操作.操作)).toEqual(["加节点", "加边"])
    const 加节点 = 操作们[0]!
    if (加节点.操作 !== "加节点") throw new Error("形状不对")
    expect(加节点.节点.length).toBe(1)
    const 新点 = 加节点.节点[0]!
    expect(新点.名称).toBe("李某的卡")
    expect(新点.类型).toBe("账号")
    expect(新点.细类).toBe("银行卡")
    const 加边 = 操作们[1]!
    if (加边.操作 !== "加边") throw new Error("形状不对")
    expect(加边.边.length).toBe(1)
    expect(加边.边[0]!.从).toBe(新点.id)
    expect(加边.边[0]!.到).toBe("n1")
    // 无依据 ⇒ 固定话术；自动抽取 ⇒ 中；时间 null ⇒ 空串。
    expect(加边.边[0]!.来源).toEqual({ kind: "关系", 关系们: ["r2"], 依据: "库中关系（库中未记录依据）" })
    expect(加边.边[0]!.可信度).toBe("中")
    expect(加边.边[0]!.时间).toEqual({ 首: "", 末: "" })
    expect(器.profile调用).toEqual([["p 1", "e1"], ["p 1", "b1"]])
    expect(器.关过()).toBe(1)
  })

  test("R-F8-4 某个对方档案取不到 ⇒ 跳过该条、点名、其余照加、面板不关", async () => {
    const 器 = 挂选择器({
      profile: (id) => (id === "b1" ? { kind: "error", message: "实体不存在", code: "NOT_FOUND" } : 三档表(id)),
      已有节点: [图上本实体, 图上A],
    })
    await 落定()

    点关系("e1")
    await 落定()
    勾选关系("r1")
    勾选关系("r2")
    加关系键()!.click()
    await 落定()

    expect(器.加过.length).toBe(1)
    const 操作们 = 器.加过[0]!
    expect(操作们.map((操作) => 操作.操作)).toEqual(["加边"])
    const 加边 = 操作们[0]!
    if (加边.操作 !== "加边") throw new Error("形状不对")
    expect(加边.边.length).toBe(1)
    expect(加边.边[0]!.来源).toMatchObject({ 关系们: ["r1"] })

    const 错 = 文本("hgraph-picker-error") ?? ""
    expect(错).toContain("取不到档案，未加入")
    expect(错).toContain("李某的卡")
    expect(器.关过()).toBe(0)
  })

  test("R-F8-5 全部对方取不到 ⇒ 不调 onAdd、错误保留、面板不关", async () => {
    const 器 = 挂选择器({
      profile: (id) =>
        id === "b1"
          ? { kind: "error", message: "实体不存在", code: "NOT_FOUND" }
          : { kind: "ok", value: id === "e1" ? 张三档案 : 王某档案 },
      已有节点: [图上本实体],
    })
    await 落定()

    点关系("e1")
    await 落定()
    勾选关系("r2")
    加关系键()!.click()
    await 落定()

    expect(器.加过.length).toBe(0)
    expect(器.关过()).toBe(0)
    expect(文本("hgraph-picker-error") ?? "").toContain("取不到档案，未加入")
  })

  test("R-F8-6 点「关系」时档案取不到 ⇒ 错误文案、留在实体页（空列表）", async () => {
    挂选择器({ profile: () => ({ kind: "error", message: "实体不存在", code: "NOT_FOUND" }) })
    await 落定()

    点关系("e1")
    await 落定()

    expect(文本("hgraph-picker-error") ?? "").toContain("实体不存在")
    expect(关系行数()).toBe(0)
    // 不切页：实体页的搜索框还在，关系页标题不在。
    expect(取("[data-slot='hgraph-picker-q']") !== null).toBe(true)
    expect(取("[data-slot='hgraph-picker-relation-title']") === null).toBe(true)
  })

  test("R-F8-7 本实体不在图上 ⇒ 同一批先补本实体快照（摆放 0）、再补对方（摆放 1）", async () => {
    const 器 = 挂选择器({ profile: 三档表, 已有节点: [] })
    await 落定()

    点关系("e1")
    await 落定()
    勾选关系("r1")
    加关系键()!.click()
    await 落定()

    const 操作们 = 器.加过[0]!
    expect(操作们.map((操作) => 操作.操作)).toEqual(["加节点", "加边"])
    const 加节点 = 操作们[0]!
    if (加节点.操作 !== "加节点") throw new Error("形状不对")
    expect(加节点.节点.length).toBe(2)
    expect(加节点.节点[0]!.名称).toBe("张三")
    expect([加节点.节点[0]!.x, 加节点.节点[0]!.y]).toEqual([100, 200])
    expect(加节点.节点[1]!.名称).toBe("王某")
    expect([加节点.节点[1]!.x, 加节点.节点[1]!.y]).toEqual([110, 210])
    const 加边 = 操作们[1]!
    if (加边.操作 !== "加边") throw new Error("形状不对")
    expect(加边.边[0]!.从).toBe(加节点.节点[0]!.id)
    expect(加边.边[0]!.到).toBe(加节点.节点[1]!.id)
  })

  test("R-F8-8 两个关系指向同一对方（不在图上）⇒ 对方档案只取一次、只补一颗节点", async () => {
    const 器 = 挂选择器({
      profile: (id) =>
        id === "e1" ? { kind: "ok", value: 张三档案全连A } : id === "a1" ? { kind: "ok", value: 王某档案 } : { kind: "error", message: "实体不存在" },
      已有节点: [图上本实体],
    })
    await 落定()

    点关系("e1")
    await 落定()
    勾选关系("r1")
    勾选关系("r3")
    加关系键()!.click()
    await 落定()

    const 操作们 = 器.加过[0]!
    expect(操作们.map((操作) => 操作.操作)).toEqual(["加节点", "加边"])
    const 加节点 = 操作们[0]!
    if (加节点.操作 !== "加节点") throw new Error("形状不对")
    expect(加节点.节点.length).toBe(1)
    const 加边 = 操作们[1]!
    if (加边.操作 !== "加边") throw new Error("形状不对")
    expect(加边.边.length).toBe(2)
    // 出边：从=本节点（n1），到=同一颗补出来的对方节点。
    expect(加边.边.map((边) => 边.从)).toEqual(["n1", "n1"])
    expect(加边.边.map((边) => 边.到)).toEqual([加节点.节点[0]!.id, 加节点.节点[0]!.id])
    expect(器.profile调用).toEqual([["p 1", "e1"], ["p 1", "a1"]])
  })

  test("R-F8-10 面板开着从关系页被切到绑定模式 ⇒ 仍显示实体清单（不留空白）", async () => {
    const [模式, set模式] = createSignal<"加入" | "绑定">("加入")
    const host = document.createElement("div")
    document.body.appendChild(host)
    挂过的.push(
      render(
        () => (
          <选择器
            projectId="p 1"
            实体api={{ list: async () => ({ kind: "ok", value: { 行们, 总数: 行们.length, 缺口: [] } }) }}
            详情api={{ profile: async (_项目, id) => 三档表(id) }}
            已有节点={[]}
            摆放={() => ({ x: 0, y: 0 })}
            模式={模式()}
            onAdd={() => {}}
            onBind={() => {}}
            onClose={() => {}}
          />
        ),
        host,
      ),
    )
    await 落定()

    点关系("e1")
    await 落定()
    expect(关系行数()).toBe(2)

    set模式("绑定")
    await flush()

    // 绑定模式没有页签，也不该被上一轮的「关系」页卡成空白：实体清单还在。
    expect(页签("实体") === null).toBe(true)
    expect(行数()).toBe(4)
    expect(绑定键() !== null).toBe(true)
  })

  test("R-F8-9 未勾选关系 ⇒ 加入按钮 disabled；绑定模式无页签与「关系」按钮", async () => {
    挂选择器({ profile: 三档表 })
    await 落定()

    expect(页签("实体") !== null).toBe(true)
    expect(页签("关系") !== null).toBe(true)
    点页签("关系")
    await flush()
    expect(文本("hgraph-picker-relation-title")).toContain("先在「实体」页选一个实体")
    expect(加关系键()!.disabled).toBe(true)

    document.body.innerHTML = ""
    挂选择器({ profile: 三档表, 模式: "绑定" })
    await 落定()
    expect(页签("实体") === null).toBe(true)
    expect(取("[data-slot='hgraph-picker-relations']") === null).toBe(true)
  })
})

describe("选择器 · 关系页纯函数", () => {
  test("可信度映射：已确认/已修正→高，自动抽取→中，存疑/已排除/未知→低", () => {
    expect(可信度映射("已确认")).toBe("高")
    expect(可信度映射("已修正")).toBe("高")
    expect(可信度映射("自动抽取")).toBe("中")
    expect(可信度映射("存疑")).toBe("低")
    expect(可信度映射("已排除")).toBe("低")
    expect(可信度映射("未知")).toBe("低")
  })

  test("关系边：出⇒从本到对方，入⇒从对方到本；性质推断、方向有向、id 缺省临时e", () => {
    const 出 = 关系边(关系A, "n1", "n2")
    expect(出.从).toBe("n1")
    expect(出.到).toBe("n2")
    expect(出.性质).toBe("推断")
    expect(出.方向).toBe("有向")
    expect(出.标签).toBe("转账")
    expect(出.id).toMatch(/^临时e\d+$/)

    const 入 = 关系边(关系B, "n1", "n2")
    expect(入.从).toBe("n2")
    expect(入.到).toBe("n1")

    expect(关系边(关系A, "n1", "n2", "临时e99").id).toBe("临时e99")
  })

  test("关系边：依据非空逐字用、null 用固定话术；时间 null ⇒ 空串；不写证据/出处", () => {
    const 有 = 关系边(关系A, "n1", "n2")
    expect(有.来源).toEqual({ kind: "关系", 关系们: ["r1"], 依据: "银行流水第 12 页" })
    expect(有.可信度).toBe("高")
    expect(有.时间).toEqual({ 首: "2024-01-02", 末: "2024-02-03" })

    const 无 = 关系边(关系B, "n1", "n2")
    expect(无.来源).toEqual({ kind: "关系", 关系们: ["r2"], 依据: "库中关系（库中未记录依据）" })
    expect(无.可信度).toBe("中")
    expect(无.时间).toEqual({ 首: "", 末: "" })

    // R59：没有行级出处 ⇒ 这两个键不出现（不是空数组占位）。
    expect(有.证据).toBeUndefined()
    expect(有.出处).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 主操作位置（2026-11-17 用户下达）
// 原布局把「加入选中的…」放在面板底部，长列表里要滚到末端才看得见；
// 现在它必须在标题行、紧挨「收起」左侧，且是带图标的主按钮（未悬停也高识别度）。
// ---------------------------------------------------------------------------

describe("选择器 · 主操作位置", () => {
  test("实体页：「加入选中的」在标题行、位于「收起」左侧，带图标且为浅灰底金边框主按钮", async () => {
    挂选择器()
    await 落定()

    const 面板 = 取("[data-slot='hgraph-entity-picker']")
    expect(面板 !== null).toBe(true)
    const 标题行 = 面板!.firstElementChild
    expect(标题行 !== null).toBe(true)

    const 加入 = 取("[data-slot='hgraph-picker-add']")
    const 收起 = 取("[data-slot='hgraph-picker-close']")
    expect(加入 !== null).toBe(true)
    expect(收起 !== null).toBe(true)

    // 同一行内、且在「收起」之前（收起左侧）。
    const 子们 = Array.from(标题行!.children)
    expect(子们.indexOf(加入!)).toBeGreaterThanOrEqual(0)
    expect(子们.indexOf(加入!)).toBeLessThan(子们.indexOf(收起!))

    // 图标 + 文字：文案保留，图标是设计系统的 svg。
    expect(加入!.textContent).toContain("加入选中的")
    expect(加入!.querySelector("[data-slot='icon-svg']") !== null).toBe(true)
    // 视觉：浅灰底 + 蜜蜂金边框，悬停加深边框（不再是黑色实心）。
    const 类们 = 加入!.className.split(/\s+/)
    expect(类们).toContain("bg-v2-background-bg-layer-01")
    expect(类们).toContain("border-[var(--v2-brand-gold)]")
    expect(类们).toContain("hover:border-[var(--v2-brand-gold-deep)]")
  })

  test("关系页：「加入选中的 N 条关系」同样在标题行、位于「收起」左侧", async () => {
    挂选择器({ profile: 三档表, 已有节点: [图上本实体, 图上A] })
    await 落定()

    点关系("e1")
    await 落定()

    const 面板 = 取("[data-slot='hgraph-entity-picker']")
    expect(面板 !== null).toBe(true)
    const 标题行 = 面板!.firstElementChild
    expect(标题行 !== null).toBe(true)
    const 加入 = 取("[data-slot='hgraph-picker-relation-add']")
    const 收起 = 取("[data-slot='hgraph-picker-close']")
    expect(加入 !== null).toBe(true)
    expect(收起 !== null).toBe(true)

    const 子们 = Array.from(标题行!.children)
    expect(子们.indexOf(加入!)).toBeGreaterThanOrEqual(0)
    expect(子们.indexOf(加入!)).toBeLessThan(子们.indexOf(收起!))
    expect(加入!.textContent).toContain("加入选中的")
    expect(加入!.querySelector("[data-slot='icon-svg']") !== null).toBe(true)
    const 类们 = 加入!.className.split(/\s+/)
    expect(类们).toContain("bg-v2-background-bg-layer-01")
    expect(类们).toContain("border-[var(--v2-brand-gold)]")
    expect(类们).toContain("hover:border-[var(--v2-brand-gold-deep)]")
  })
})
