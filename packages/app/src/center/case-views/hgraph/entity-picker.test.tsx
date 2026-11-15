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
import { render } from "solid-js/web"
import type { EntityApi, 实体清单项 } from "@/project/entity-api"
import type { CaseDetailApi, 实体档案, 档案关系, 引用 } from "@/center/case-detail-api"
import type { 操作 } from "@/project/hgraph-api"
import type { 节点 } from "./file"
import { 选择器, 时间跨度, 属性们 } from "./entity-picker"

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
  list?: (input: 列表入参) => Awaited<ReturnType<EntityApi["list"]>>
  profile?: (id: string) => Awaited<ReturnType<CaseDetailApi["profile"]>>
  已有节点?: readonly 节点[]
  摆放?: (序号: number) => { readonly x: number; readonly y: number }
} = {}) {
  const list调用: 列表入参[] = []
  const profile调用: Array<[string, string]> = []
  const 加过: 操作[][] = []
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
          onAdd={(操作们) => 加过.push([...操作们])}
          onClose={() => {
            关过 += 1
          }}
        />
      ),
      host,
    ),
  )

  return { list调用, profile调用, 加过, 关过: () => 关过 }
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
    expect(勾选框("e1")).not.toBeNull()
    expect(勾选框("e3")).toBeNull()
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
})
