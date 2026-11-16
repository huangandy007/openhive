/**
 * T010：检查器（三段两源 + 批量态）。
 *
 * 用例直挂 `检查器`，传入**幽灵动作表**（每个动作一层 spy）证明「检查器只调动作表」；
 * 编辑器里的端到端接线（失焦即存 → 一个批次、加节点映射）在 `editor.test.tsx`。
 *
 * 两段两源（`#010-06`）：可改区读 `文档`，「库里现在」读注入的 `快照`；本文件用
 * 两值都不同的夹具钉住「互不覆盖」，不给回退值留缝（`#005-47`）。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { 图文件, 节点, 边, 文字 } from "./file"
import { 外环色表, type 画布动作 } from "./canvas"
import { 检查器, type 节点快照 } from "./inspector"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

// ---------------------------------------------------------------------------
// 幽灵动作表（每个动作计数 + 记参）
// ---------------------------------------------------------------------------

function 幽灵动作表() {
  const 计数: Record<string, number> = {}
  const 参数: Record<string, unknown[][]> = {}
  const 记 = (名: string, 参: unknown[]) => {
    计数[名] = (计数[名] ?? 0) + 1
    ;(参数[名] ??= []).push(参)
  }
  const 动作: 画布动作 = {
    选择: (ids, 追加) => 记("选择", [ids, 追加]),
    移动: (目标) => 记("移动", [目标]),
    加边: (从, 到) => 记("加边", [从, 到]),
    加文字: (x, y) => 记("加文字", [x, y]),
    改字段: (类别, id, 补丁) => 记("改字段", [类别, id, 补丁]),
    删对象: (目标) => 记("删对象", [目标]),
    撤销: () => 记("撤销", []),
    重做: () => 记("重做", []),
    切换模式: (模式) => 记("切换模式", [模式]),
    加节点: (位置) => 记("加节点", [位置]),
    删除所选: () => 记("删除所选", []),
    重命名: (id) => 记("重命名", [id]),
    锁定切换: (ids) => 记("锁定切换", [ids]),
    对齐: (边, ids) => 记("对齐", [边, ids]),
    等距: (轴, ids) => 记("等距", [轴, ids]),
    自动布局: (模式) => 记("自动布局", [模式]),
    演示切换: () => 记("演示切换", []),
    补依据: (边id) => 记("补依据", [边id]),
    合并: () => 记("合并", []),
  }
  return { 动作, 计数, 参数 }
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function 造图(补丁: Partial<节点> = {}): 图文件 {
  return {
    格式: 1,
    标题: "检查器测试",
    创建于: "2026-11-16T10:00:00+08:00",
    更新于: "2026-11-16T10:00:00+08:00",
    设置: {
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    },
    节点: [
      {
        id: "n1",
        名称: "张三",
        类型: "人物",
        细类: "嫌疑人",
        来源: { kind: "实体", 实体: "ent1", 值: "张三" },
        属性: [{ 键: "身份证", 值: "3301…" }],
        出处: ["材料/1"],
        时间: { 首: "2026-01-01", 末: "2026-02-01" },
        备注: "旧备注",
        x: 100,
        y: 100,
        ...补丁,
      },
      { id: "n2", 名称: "李四", 类型: "人物", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x: 200, y: 100 },
    ],
    边: [],
    文字: [],
  }
}

const 快照: Readonly<Record<string, 节点快照>> = {
  ent1: { 值: "张三丰", 类型: "人物", 可信态: "已核实", 时间: { 首: "2025-12-01", 末: "2026-03-01" } },
}

/** 一条事实边（T019a 检查器边段夹具；R-F12）。 */
function 造边(补丁: Partial<边> = {}): 边 {
  return {
    id: "e1",
    从: "n1",
    到: "n2",
    标签: "转账",
    性质: "事实",
    方向: "有向",
    来源: { kind: "实体", 实体: "ent1", 值: "张三→李四" },
    时间: { 首: "2026-01-01", 末: "2026-02-01" },
    次数: 3,
    金额: { 值: "12000", 单位: "元" },
    证据: [{ 关系: "转账", 出处: "材料1#流水#12" }],
    出处: ["材料1#流水#12", "材料2#流水#3"],
    ...补丁,
  }
}

function 带边图(边补丁: Partial<边> = {}): 图文件 {
  return { ...造图(), 边: [造边(边补丁)] }
}

function 带文字图(补丁: Partial<文字> = {}): 图文件 {
  const 行: 文字 = { id: "t1", 内容: "备注", x: 50, y: 50, 字号: "中", ...补丁 }
  return { ...造图(), 文字: [行] }
}

function 挂检查器(选项: {
  选中: readonly string[]
  文档?: 图文件
  快照?: Readonly<Record<string, 节点快照>>
  载入中?: boolean
  刷新节点?: (实体id: string) => void
  刷新提示?: string
  打开档案?: (实体id: string, 标题: string) => void
  绑定?: (节点id: string) => void
  打开出处?: (材料: string, 行号: number) => void
  收起?: boolean
  收起变化?: (值: boolean) => void
}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 幽 = 幽灵动作表()
  const 文档 = 选项.文档 ?? 造图()
  // 选中用信号：M3 要断言「换选再回来」时提示消失。
  const [选中, set选中] = createSignal<readonly string[]>(选项.选中)
  // T014 收起态：默认展开；用例可注入初值，也可读回点击后的状态。
  const [收起, set收起] = createSignal(选项.收起 ?? false)
  挂过的.push(
    render(
      () => (
        <检查器
          选中={选中()}
          文档={文档}
          动作表={幽.动作}
          快照={选项.快照}
          载入中={选项.载入中}
          刷新节点={选项.刷新节点}
          刷新提示={选项.刷新提示}
          打开档案={选项.打开档案}
          绑定={选项.绑定}
          打开出处={选项.打开出处}
          收起={收起()}
          收起变化={选项.收起变化 ?? set收起}
        />
      ),
      host,
    ),
  )
  return { ...幽, set选中, 收起, set收起 }
}

const 取 = (选择器: string) => document.body.querySelector(选择器) as HTMLElement | null
const 文本 = (slot: string) => 取(`[data-slot='${slot}']`)?.textContent?.trim()

function 失焦(元素: HTMLInputElement | HTMLTextAreaElement) {
  元素.dispatchEvent(new FocusEvent("blur"))
}

function 选择(元素: HTMLSelectElement, 值: string) {
  元素.value = 值
  元素.dispatchEvent(new Event("change", { bubbles: true }))
}

function 勾选(元素: HTMLInputElement, 值: boolean) {
  元素.checked = 值
  元素.dispatchEvent(new Event("change", { bubbles: true }))
}

// ---------------------------------------------------------------------------
// 两段两源
// ---------------------------------------------------------------------------

describe("检查器 · 三段两源", () => {
  test("可改区读文档、库里现在读快照：两值同时显示，互不覆盖", () => {
    挂检查器({ 选中: ["n1"], 快照 })

    const 名称 = 取("[data-slot='hgraph-field-名称']") as HTMLInputElement | null
    expect(名称).not.toBeNull()
    expect(名称!.value).toBe("张三")
    // 库里现在是自己的值，不是文档值的副本。
    expect(文本("hgraph-snapshot-值")).toBe("张三丰")
    expect(文本("hgraph-snapshot-类型")).toBe("人物")
    expect(文本("hgraph-snapshot-可信态")).toBe("已核实")
    expect(文本("hgraph-snapshot-时间")).toBe("2025-12-01 ~ 2026-03-01")
    // 两值都有时这行必须出现（验收 #7），逐字断言。
    expect(文本("hgraph-snapshot-diff")).toBe("文件里记的是「张三」，库里现在是「张三丰」")
  })

  test("只读区读文档：来源 / 属性 / 出处 / 首末时间各自显示", () => {
    挂检查器({ 选中: ["n1"], 快照 })

    expect(文本("hgraph-readonly-来源")).toContain("实体")
    expect(文本("hgraph-readonly-来源")).toContain("张三")
    expect(文本("hgraph-readonly-属性")).toContain("身份证：3301…")
    expect(文本("hgraph-readonly-出处")).toContain("材料/1")
    expect(文本("hgraph-readonly-时间")).toBe("2026-01-01 ~ 2026-02-01")
  })

  /**
   * T002（014 关系图可用性）：`来源.kind = 事件` 是合法类别，徽标必须显示「事件」，
   * 不能被旧的 `default` 分支静默显示成「手写」。
   *
   * 元素存在性按 LEARNINGS `#013-12` 用布尔比较（`toBeNull()` 在本机 happy-dom 里会假绿）。
   */
  test("来源.kind = 事件 ⇒ 徽标文案含『事件』且不含『手写』", () => {
    挂检查器({ 选中: ["n1"], 文档: 造图({ 来源: { kind: "事件" } }) })

    const 徽标 = 取("[data-slot='hgraph-readonly-来源']")
    // 先立「元素在文档里」这个前提，再断文案——否则空串也能让「不含手写」通过。
    expect(徽标 === null).toBe(false)
    expect(document.body.contains(徽标)).toBe(true)
    const 文案 = 徽标?.textContent?.trim() ?? ""
    expect(文案).toContain("事件")
    expect(文案.includes("手写")).toBe(false)
  })

  test("没注入快照 ⇒ 明写「还没有接入库里的数据」，不伪造空属性", () => {
    挂检查器({ 选中: ["n1"] })

    expect(文本("hgraph-snapshot-empty")).toBe("还没有接入库里的数据")
    expect(取("[data-slot='hgraph-snapshot-值']")).toBeNull()
  })

  test("注入了快照但节点没绑库 ⇒ 「这条不在库里」，不拿别的实体回填", () => {
    挂检查器({ 选中: ["n2"], 快照 })

    expect(文本("hgraph-snapshot-empty")).toBe("这条不在库里")
    expect(取("[data-slot='hgraph-snapshot-值']")).toBeNull()
  })

  test("「刷新此节点」只在注入刷新口时出现；点击把库 id 交回去", () => {
    挂检查器({ 选中: ["n1"], 快照 })
    expect(取("[data-slot='hgraph-snapshot-refresh']")).toBeNull()

    document.body.innerHTML = ""
    const 刷过: string[] = []
    挂检查器({ 选中: ["n1"], 快照, 刷新节点: (id) => 刷过.push(id) })
    const 按钮 = 取("[data-slot='hgraph-snapshot-refresh']") as HTMLButtonElement | null
    expect(按钮).not.toBeNull()
    按钮!.click()
    expect(刷过).toEqual(["ent1"])
  })
})

// ---------------------------------------------------------------------------
// 失焦即存
// ---------------------------------------------------------------------------

describe("检查器 · 失焦即存", () => {
  test("逐字输入 0 次动作；失焦恰好 1 次改字段", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-名称']") as HTMLInputElement

    for (const 值 of ["张", "张三", "张三丰"]) {
      输入.value = 值
      输入.dispatchEvent(new Event("input", { bubbles: true }))
    }
    expect(幽.计数.改字段 ?? 0).toBe(0)

    失焦(输入)
    expect(幽.计数.改字段).toBe(1)
    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 名称: "张三丰" }])
    // 「库里现在」没有被文档编辑回填。
    expect(文本("hgraph-snapshot-值")).toBe("张三丰")
  })

  test("清空备注后失焦 ⇒ 补丁是 备注: null（不是空串）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-备注']") as HTMLInputElement
    expect(输入.value).toBe("旧备注")

    输入.value = ""
    失焦(输入)

    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 备注: null }])
  })

  test("必填字段清空不产生补丁（后端会拒 null）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-名称']") as HTMLInputElement

    输入.value = ""
    失焦(输入)

    expect(幽.计数.改字段 ?? 0).toBe(0)
  })

  test("值没变失焦不发补丁", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-类型']") as HTMLInputElement
    失焦(输入)
    expect(幽.计数.改字段 ?? 0).toBe(0)
  })

  test("清空细类后失焦 ⇒ 细类: null（可删键，不是空串）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-细类']") as HTMLInputElement
    expect(输入.value).toBe("嫌疑人")

    输入.value = ""
    失焦(输入)

    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 细类: null }])
  })

  test("改外环档后失焦 ⇒ 外环整个对象一起发，保留颜色", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 外环: { 档: 1, 颜色: "红" } }), 快照 })
    const 输入 = 取("[data-slot='hgraph-field-外环档']") as HTMLInputElement
    expect(输入.value).toBe("1")

    输入.value = "3"
    失焦(输入)

    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 外环: { 档: 3, 颜色: "红" } }])
  })
})

// ---------------------------------------------------------------------------
// T011 · 出现序（数字输入，失焦即存，清空 = 删键）
// ---------------------------------------------------------------------------

describe("检查器 · 出现序", () => {
  const 提示 = () => 文本("hgraph-field-出现序-提示")

  test("#6 改为 2 后失焦：恰好 1 次改字段，补丁是 出现序: 2", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-出现序']") as HTMLInputElement | null
    expect(输入).not.toBeNull()
    // 缺省不写 0，输入框留空（缺省值不在文档里伪造）。
    expect(输入!.value).toBe("")

    输入!.value = "2"
    失焦(输入!)

    expect(幽.计数.改字段).toBe(1)
    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 出现序: 2 }])
    expect(提示()).toBeUndefined()
  })

  test("#7 清空后失焦：补丁含 出现序: null（删键，不是 0）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 出现序: 2 }), 快照 })
    const 输入 = 取("[data-slot='hgraph-field-出现序']") as HTMLInputElement
    expect(输入.value).toBe("2")

    输入.value = ""
    失焦(输入)

    expect(幽.计数.改字段).toBe(1)
    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 出现序: null }])
    // 明确钉住「不是 0」：契约里 0 是合法步号，语义完全不同。
    expect((幽.参数.改字段![0]![2] as Record<string, unknown>).出现序).not.toBe(0)
  })

  test("非法输入（1.5 / abc / -1）不发补丁、保留旧值并就地提示", () => {
    for (const 非法 of ["1.5", "abc", "-1"]) {
      document.body.innerHTML = ""
      const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 出现序: 3 }), 快照 })
      const 输入 = 取("[data-slot='hgraph-field-出现序']") as HTMLInputElement

      输入.value = 非法
      失焦(输入)

      expect(幽.计数.改字段 ?? 0).toBe(0)
      expect(提示()).toBe("要填非负整数")
    }
  })

  test("值没变失焦不发补丁；缺省节点清空也不发（删不存在的键不算改动）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-出现序']") as HTMLInputElement

    // 缺省为空，失焦不动。
    输入.value = ""
    失焦(输入)
    expect(幽.计数.改字段 ?? 0).toBe(0)

    document.body.innerHTML = ""
    const 幽二 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 出现序: 4 }), 快照 })
    const 输入二 = 取("[data-slot='hgraph-field-出现序']") as HTMLInputElement
    输入二.value = "4"
    失焦(输入二)
    expect(幽二.计数.改字段 ?? 0).toBe(0)
  })

  test("M3 非法提示不跨选中残留：换选再回来、重新聚焦都清掉", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 出现序: 3 }), 快照 })
    const 输入 = 取("[data-slot='hgraph-field-出现序']") as HTMLInputElement

    输入.value = "abc"
    失焦(输入)
    expect(提示()).toBe("要填非负整数")

    // 重新聚焦即清：用户回来改时不该顶着上一条提示。
    输入.dispatchEvent(new FocusEvent("focus"))
    expect(提示()).toBeUndefined()

    // 再来一次非法，然后换选再换回来：提示不能跟着 id 复活。
    输入.value = "abc"
    失焦(输入)
    expect(提示()).toBe("要填非负整数")
    幽.set选中(["n2"])
    expect(提示()).toBeUndefined()
    幽.set选中(["n1"])
    expect(提示()).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 批量态
// ---------------------------------------------------------------------------

describe("检查器 · 批量态", () => {
  test("选中 2 个：对齐/等距/合并/删除都可用（R-F12：合并不再占位）", () => {
    const 幽 = 挂检查器({ 选中: ["n1", "n2"], 快照 })

    expect(取("[data-slot='hgraph-batch']")).not.toBeNull()
    const 对齐 = 取("[data-slot='hgraph-batch-align-左']") as HTMLButtonElement
    const 等距 = 取("[data-slot='hgraph-batch-space-水平']") as HTMLButtonElement
    expect(对齐.disabled).toBe(false)
    expect(等距.disabled).toBe(false)
    const 合并 = 取("[data-slot='hgraph-batch-merge']") as HTMLButtonElement
    expect(合并.disabled).toBe(false)
    expect(合并.getAttribute("title")).not.toContain("下个任务")
    expect((取("[data-slot='hgraph-batch-delete']") as HTMLButtonElement).disabled).toBe(false)

    对齐.click()
    expect(幽.参数.对齐![0]).toEqual(["左", ["n1", "n2"]])
    等距.click()
    expect(幽.参数.等距![0]).toEqual(["水平", ["n1", "n2"]])
    合并.click()
    expect(幽.计数.合并).toBe(1)
    ;(取("[data-slot='hgraph-batch-delete']") as HTMLButtonElement).click()
    expect(幽.计数.删除所选).toBe(1)
  })

  test("选中 1 个：不出现批量面板，单个详情可改", () => {
    挂检查器({ 选中: ["n1"], 快照 })
    expect(取("[data-slot='hgraph-batch']")).toBeNull()
    expect(取("[data-slot='hgraph-field-名称']")).not.toBeNull()
  })

  test("没有选中：检查器整个不渲染（不显示空属性或伪造快照）", () => {
    挂检查器({ 选中: [] })
    // T014 / FR-050 必要更替：旧口径是「空面板里给一句提示」，新口径是未选中不渲染。
    expect(document.body.querySelector("[data-slot='hgraph-inspector']") === null).toBe(true)
    expect(取("[data-slot='hgraph-field-名称']") === null).toBe(true)
    expect(取("[data-slot='hgraph-snapshot-empty']") === null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// T014 · R59 空属性/空出处文案 与 R61 刷新回执
// ---------------------------------------------------------------------------

describe("检查器 · 从库加入后的空属性/出处（R59）", () => {
  test("已绑库节点属性为空 ⇒ 「库中无记录属性」；出处为空 ⇒ 「未取到出处」", () => {
    挂检查器({ 选中: ["n1"], 文档: 造图({ 属性: [], 出处: [] }), 快照 })

    expect(文本("hgraph-readonly-属性")).toBe("库中无记录属性")
    expect(文本("hgraph-readonly-出处")).toBe("未取到出处")
  })

  test("手写节点不冒充「库中无记录」：仍写 —", () => {
    挂检查器({ 选中: ["n2"], 快照 })

    expect(文本("hgraph-readonly-属性")).toBe("—")
    expect(文本("hgraph-readonly-出处")).toBe("—")
  })

  test("刷新提示按注入值显示（与库一致 / 只读未写回）", () => {
    挂检查器({ 选中: ["n1"], 快照, 刷新提示: "与库一致" })
    expect(文本("hgraph-refresh-note")).toBe("与库一致")

    document.body.innerHTML = ""
    挂检查器({ 选中: ["n1"], 快照, 刷新提示: "属性/出处/时间只读，未写回" })
    expect(文本("hgraph-refresh-note")).toBe("属性/出处/时间只读，未写回")
  })

  test("库里查不到时仍给「刷新」按钮（重试入口，R61）", () => {
    挂检查器({ 选中: ["n1"], 快照: {}, 刷新节点: () => {} })

    expect(文本("hgraph-snapshot-empty")).toBe("这条不在库里")
    expect(取("[data-slot='hgraph-snapshot-refresh']")).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// T014 · R63 打开档案（注入回调；未绑库 disabled；未注入不渲染）
// ---------------------------------------------------------------------------

describe("检查器 · 打开档案（R63）", () => {
  test("注入回调且已绑库：点击收到 (实体id, '名称 · 类型') 恰 1 次", () => {
    const 收到: Array<[string, string]> = []
    挂检查器({ 选中: ["n1"], 快照, 打开档案: (id, 标题) => 收到.push([id, 标题]) })

    const 钮 = 取("[data-slot='hgraph-open-archive']") as HTMLButtonElement | null
    expect(钮).not.toBeNull()
    expect(钮!.disabled).toBe(false)
    钮!.click()

    expect(收到).toEqual([["ent1", "张三 · 人物"]])
  })

  test("未绑库节点：按钮 disabled 且 title=「这条不在库里」", () => {
    挂检查器({ 选中: ["n2"], 快照, 打开档案: () => {} })

    const 钮 = 取("[data-slot='hgraph-open-archive']") as HTMLButtonElement | null
    expect(钮).not.toBeNull()
    expect(钮!.disabled).toBe(true)
    expect(钮!.getAttribute("title")).toBe("这条不在库里")
  })

  test("未注入回调：按钮不在 DOM（不放禁用假按钮）", () => {
    挂检查器({ 选中: ["n1"], 快照 })
    expect(取("[data-slot='hgraph-open-archive']")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// T018 · 外环「恢复自动」（R75）
// ---------------------------------------------------------------------------

describe("检查器 · 恢复自动（外环手动档删键）", () => {
  test("有 `外环` 时按钮在；点击 ⇒ 改字段(\"节点\", id, {外环:null})，算一步撤销", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 外环: { 档: 2, 颜色: "红" } }), 快照 })
    const 钮 = 取("[data-slot='hgraph-ring-auto']")
    expect(钮).not.toBeNull()
    expect(钮?.textContent?.trim()).toBe("恢复自动")

    钮?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(幽.计数.改字段).toBe(1)
    expect(幽.参数.改字段[0]).toEqual(["节点", "n1", { 外环: null }])
  })

  test("没有 `外环` 时不渲染按钮（自动档下没有「恢复」可言）", () => {
    挂检查器({ 选中: ["n1"], 快照 })
    expect(取("[data-slot='hgraph-ring-auto']")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 修复轮 2026-11-16：R-F12 检查器「边」段
// ---------------------------------------------------------------------------

describe("检查器 · 边段（R-F12）", () => {
  test("只选中一条边 ⇒ 渲染边段、不渲染节点段/快照段/空提示", () => {
    挂检查器({ 选中: ["e1"], 文档: 带边图() })

    expect(取("[data-slot='hgraph-inspector-edge']")).not.toBeNull()
    expect(取("[data-slot='hgraph-field-名称']")).toBeNull()
    expect(取("[data-slot='hgraph-inspector-snapshot']")).toBeNull()
    expect(取("[data-slot='hgraph-inspector-hint']")).toBeNull()
  })

  test("改标签后失焦 ⇒ 恰好一次改字段(\"边\", id, {标签})", () => {
    const 幽 = 挂检查器({ 选中: ["e1"], 文档: 带边图() })
    const 标签 = 取("[data-slot='hgraph-field-边标签']") as HTMLInputElement
    expect(标签.value).toBe("转账")

    标签.value = "x"
    失焦(标签)

    expect(幽.计数.改字段).toBe(1)
    expect(幽.参数.改字段![0]).toEqual(["边", "e1", { 标签: "x" }])
  })

  test("清空标签 ⇒ 补丁是 标签: \"\"（边标签是必填键，不是 null）", () => {
    const 幽 = 挂检查器({ 选中: ["e1"], 文档: 带边图() })
    const 标签 = 取("[data-slot='hgraph-field-边标签']") as HTMLInputElement

    标签.value = ""
    失焦(标签)

    expect(幽.参数.改字段![0]).toEqual(["边", "e1", { 标签: "" }])
  })

  test("清空备注 ⇒ 补丁是 备注: null；方向改一次 ⇒ {方向}", () => {
    const 幽 = 挂检查器({ 选中: ["e1"], 文档: 带边图({ 备注: "旧备注" }) })
    const 备注 = 取("[data-slot='hgraph-field-边备注']") as HTMLInputElement
    备注.value = ""
    失焦(备注)
    expect(幽.参数.改字段![0]).toEqual(["边", "e1", { 备注: null }])

    const 方向 = 取("[data-slot='hgraph-field-边方向']") as HTMLSelectElement
    选择(方向, "无向")
    expect(幽.参数.改字段![1]).toEqual(["边", "e1", { 方向: "无向" }])
  })

  test("只读区：次数 / 金额 / 证据（关系 → 出处；）/ 出处（、）", () => {
    挂检查器({ 选中: ["e1"], 文档: 带边图() })

    expect(文本("hgraph-edge-readonly-次数")).toBe("3")
    expect(文本("hgraph-edge-readonly-金额")).toBe("12000 元")
    expect(文本("hgraph-edge-readonly-证据")).toBe("转账 → 材料1#流水#12")
    expect(文本("hgraph-edge-readonly-出处")).toBe("材料1#流水#12、材料2#流水#3")
  })

  test("只读区空值一律 —（次数/金额/证据/出处）", () => {
    挂检查器({
      选中: ["e1"],
      文档: 带边图({ 次数: undefined, 金额: undefined, 证据: undefined, 出处: undefined }),
    })

    for (const slot of ["次数", "金额", "证据", "出处"]) {
      expect(文本(`hgraph-edge-readonly-${slot}`)).toBe("—")
    }
  })

  test("性质 事实→推断且缺依据 ⇒ 调 补依据(\"e1\")、零改字段（不生成非法边）", () => {
    const 幽 = 挂检查器({ 选中: ["e1"], 文档: 带边图({ 来源: { kind: "手写" }, 可信度: undefined }) })

    选择(取("[data-slot='hgraph-field-边性质']") as HTMLSelectElement, "推断")

    expect(幽.计数.补依据).toBe(1)
    expect(幽.参数.补依据![0]).toEqual(["e1"])
    expect(幽.计数.改字段 ?? 0).toBe(0)
  })

  test("性质 事实→推断且依据/可信度齐备 ⇒ 直接改字段 {性质:\"推断\"}", () => {
    const 幽 = 挂检查器({
      选中: ["e1"],
      文档: 带边图({ 来源: { kind: "手写", 依据: "两人同住" }, 可信度: "高" }),
    })

    选择(取("[data-slot='hgraph-field-边性质']") as HTMLSelectElement, "推断")

    expect(幽.计数.补依据 ?? 0).toBe(0)
    expect(幽.参数.改字段![0]).toEqual(["边", "e1", { 性质: "推断" }])
  })

  test("推断边改依据 ⇒ 来源保留原 kind 并与新依据合并", () => {
    const 幽 = 挂检查器({
      选中: ["e1"],
      文档: 带边图({
        性质: "推断",
        来源: { kind: "关系", 关系们: ["r1"], 依据: "旧依据" },
        可信度: "中",
      }),
    })
    const 依据 = 取("[data-slot='hgraph-field-边依据']") as HTMLInputElement
    expect(依据.value).toBe("旧依据")

    依据.value = "新依据"
    失焦(依据)

    expect(幽.参数.改字段![0]).toEqual([
      "边",
      "e1",
      { 来源: { kind: "关系", 关系们: ["r1"], 依据: "新依据" } },
    ])
  })

  test("推断边清空依据 ⇒ 不发补丁并提示「推断边必须有依据」", () => {
    const 幽 = 挂检查器({
      选中: ["e1"],
      文档: 带边图({ 性质: "推断", 来源: { kind: "手写", 依据: "旧依据" }, 可信度: "中" }),
    })
    const 依据 = 取("[data-slot='hgraph-field-边依据']") as HTMLInputElement

    依据.value = "   "
    失焦(依据)

    expect(幽.计数.改字段 ?? 0).toBe(0)
    expect(文本("hgraph-field-边依据-提示")).toBe("推断边必须有依据")
  })

  test("推断边改可信度 ⇒ 一次改字段 {可信度}", () => {
    const 幽 = 挂检查器({
      选中: ["e1"],
      文档: 带边图({ 性质: "推断", 来源: { kind: "手写", 依据: "同住" }, 可信度: "中" }),
    })

    选择(取("[data-slot='hgraph-field-边可信度']") as HTMLSelectElement, "高")

    expect(幽.参数.改字段![0]).toEqual(["边", "e1", { 可信度: "高" }])
  })

  test("线宽档填 9 ⇒ 零写 + 就地提示；填 3 ⇒ 改字段 {线宽档:3}；清空 ⇒ null", () => {
    const 幽 = 挂检查器({ 选中: ["e1"], 文档: 带边图({ 线宽档: 1 }) })
    const 输入 = 取("[data-slot='hgraph-field-线宽档']") as HTMLInputElement
    expect(输入.value).toBe("1")

    输入.value = "9"
    失焦(输入)
    expect(幽.计数.改字段 ?? 0).toBe(0)
    expect(文本("hgraph-field-线宽档-提示")).toBe("要填 0–4 的整数")

    输入.dispatchEvent(new FocusEvent("focus"))
    输入.value = "3"
    失焦(输入)
    expect(幽.参数.改字段![0]).toEqual(["边", "e1", { 线宽档: 3 }])

    输入.value = ""
    失焦(输入)
    expect(幽.参数.改字段![1]).toEqual(["边", "e1", { 线宽档: null }])
  })
})

// ---------------------------------------------------------------------------
// 修复轮 2026-11-16：R-F11 UI 检查器「文字」段
// ---------------------------------------------------------------------------

describe("检查器 · 文字段（R-F11 UI）", () => {
  test("选中文字 ⇒ 渲染文字段、不渲染节点段", () => {
    挂检查器({ 选中: ["t1"], 文档: 带文字图() })

    expect(取("[data-slot='hgraph-inspector-text']")).not.toBeNull()
    expect(取("[data-slot='hgraph-field-名称']")).toBeNull()
    expect(取("[data-slot='hgraph-inspector-hint']")).toBeNull()
  })

  test("内容失焦即存；改字号/对齐/颜色各发一次正确补丁", () => {
    const 幽 = 挂检查器({ 选中: ["t1"], 文档: 带文字图() })

    const 内容 = 取("[data-slot='hgraph-field-文字内容']") as HTMLTextAreaElement
    expect(内容.value).toBe("备注")
    内容.value = "新内容"
    失焦(内容)
    expect(幽.参数.改字段![0]).toEqual(["文字", "t1", { 内容: "新内容" }])

    选择(取("[data-slot='hgraph-field-字号']") as HTMLSelectElement, "大")
    expect(幽.参数.改字段![1]).toEqual(["文字", "t1", { 字号: "大" }])

    选择(取("[data-slot='hgraph-field-对齐']") as HTMLSelectElement, "左")
    expect(幽.参数.改字段![2]).toEqual(["文字", "t1", { 对齐: "左" }])

    选择(取("[data-slot='hgraph-field-颜色']") as HTMLSelectElement, "红")
    expect(幽.参数.改字段![3]).toEqual(["文字", "t1", { 颜色: "红" }])
  })

  test("颜色选「默认」⇒ 补丁 颜色: null（删键，不写预设名）", () => {
    const 幽 = 挂检查器({ 选中: ["t1"], 文档: 带文字图({ 颜色: "红" }) })

    选择(取("[data-slot='hgraph-field-颜色']") as HTMLSelectElement, "默认")
    expect(幽.参数.改字段![0]).toEqual(["文字", "t1", { 颜色: null }])
  })

  test("加粗勾选发 true、取消发 null", () => {
    const 幽 = 挂检查器({ 选中: ["t1"], 文档: 带文字图() })
    const 勾 = 取("[data-slot='hgraph-field-加粗']") as HTMLInputElement
    expect(勾.checked).toBe(false)

    勾选(勾, true)
    expect(幽.参数.改字段![0]).toEqual(["文字", "t1", { 加粗: true }])

    document.body.innerHTML = ""
    const 幽二 = 挂检查器({ 选中: ["t1"], 文档: 带文字图({ 加粗: true }) })
    const 勾二 = 取("[data-slot='hgraph-field-加粗']") as HTMLInputElement
    expect(勾二.checked).toBe(true)
    勾选(勾二, false)
    expect(幽二.参数.改字段![0]).toEqual(["文字", "t1", { 加粗: null }])
  })

  test("宽度填正整数 ⇒ 改字段；清空 ⇒ null；非法（abc / 0 / -3 / 1.5）零写 + 提示", () => {
    const 幽 = 挂检查器({ 选中: ["t1"], 文档: 带文字图({ 宽度: 120 }) })
    const 输入 = 取("[data-slot='hgraph-field-宽度']") as HTMLInputElement
    expect(输入.value).toBe("120")

    输入.value = "200"
    失焦(输入)
    expect(幽.参数.改字段![0]).toEqual(["文字", "t1", { 宽度: 200 }])

    输入.value = ""
    失焦(输入)
    expect(幽.参数.改字段![1]).toEqual(["文字", "t1", { 宽度: null }])

    for (const 非法 of ["abc", "0", "-3", "1.5"]) {
      输入.dispatchEvent(new FocusEvent("focus"))
      输入.value = 非法
      失焦(输入)
    }
    // 清空那次之后，非法值一次都不该发。
    expect(幽.计数.改字段).toBe(2)
    expect(文本("hgraph-field-宽度-提示")).toBe("要填正整数")
  })
})

// ---------------------------------------------------------------------------
// 绑定到库实体（FR-027 / R-F9）
// ---------------------------------------------------------------------------

describe("检查器 · 绑定到库实体（FR-027）", () => {
  test("手写节点 ⇒ 按钮在；点击把节点 id 交回去", () => {
    const 绑过: string[] = []
    挂检查器({ 选中: ["n2"], 绑定: (id) => 绑过.push(id) })

    const 键 = 取("[data-slot='hgraph-bind']") as HTMLButtonElement | null
    expect(键).not.toBeNull()
    expect(键!.textContent?.trim()).toBe("绑定到库实体")
    键!.click()
    expect(绑过).toEqual(["n2"])
  })

  test("推断节点 ⇒ 按钮也在", () => {
    const 图 = 造图()
    图.节点[1] = { ...图.节点[1]!, 来源: { kind: "推断", 依据: "两人同日同酒店" }, 可信度: "中" }
    挂检查器({ 选中: ["n2"], 文档: 图, 绑定: () => {} })

    expect(取("[data-slot='hgraph-bind']")).not.toBeNull()
  })

  test("已绑库（来源.kind=实体）⇒ 不渲染", () => {
    挂检查器({ 选中: ["n1"], 快照, 绑定: () => {} })

    expect(取("[data-slot='hgraph-bind']")).toBeNull()
  })

  test("未注入 绑定 ⇒ 不渲染（不放禁用假按钮）", () => {
    挂检查器({ 选中: ["n2"] })

    expect(取("[data-slot='hgraph-bind']")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 出处可点（FR-033 / R-F10）
// ---------------------------------------------------------------------------

describe("检查器 · 出处可点（FR-033）", () => {
  const 出处按钮s = () => [...document.body.querySelectorAll<HTMLElement>("[data-slot='hgraph-citation']")]

  test("节点出处能解析 ⇒ 渲染可点按钮（文字是原串），点击交出 (材料, 行号)", () => {
    const 收到: Array<[string, number]> = []
    挂检查器({
      选中: ["n1"],
      文档: 造图({ 出处: ["m1#t#12"] }),
      打开出处: (材料, 行号) => 收到.push([材料, 行号]),
    })

    const 键们 = 出处按钮s()
    expect(键们.length).toBe(1)
    expect(键们[0]!.textContent?.trim()).toBe("m1#t#12")
    键们[0]!.click()
    expect(收到).toEqual([["m1", 12]])
  })

  test("区间写法跳到起始行（起，不是末）", () => {
    const 收到: Array<[string, number]> = []
    挂检查器({
      选中: ["n1"],
      文档: 造图({ 出处: ["m1#t#12-40"] }),
      打开出处: (材料, 行号) => 收到.push([材料, 行号]),
    })

    出处按钮s()[0]!.click()
    expect(收到).toEqual([["m1", 12]])
  })

  test("出处解析不出 ⇒ 保留纯文本、无按钮", () => {
    挂检查器({ 选中: ["n1"], 文档: 造图({ 出处: ["没有井号"] }), 打开出处: () => {} })

    expect(出处按钮s().length).toBe(0)
    expect(文本("hgraph-readonly-出处")).toBe("没有井号")
  })

  test("未注入 打开出处 ⇒ 一律纯文本（不放禁用假按钮）", () => {
    挂检查器({ 选中: ["n1"], 文档: 造图({ 出处: ["m1#t#12"] }) })

    expect(出处按钮s().length).toBe(0)
    expect(文本("hgraph-readonly-出处")).toBe("m1#t#12")
  })

  test("多个出处：只有能解析的可点，解析不出的仍是文本", () => {
    const 收到: Array<[string, number]> = []
    挂检查器({
      选中: ["n1"],
      文档: 造图({ 出处: ["坏出处", "m1#t#6"] }),
      打开出处: (材料, 行号) => 收到.push([材料, 行号]),
    })

    const 键们 = 出处按钮s()
    expect(键们.map((键) => 键.textContent?.trim())).toEqual(["m1#t#6"])
    expect(文本("hgraph-readonly-出处")).toBe("坏出处、m1#t#6")
    键们[0]!.click()
    expect(收到).toEqual([["m1", 6]])
  })

  test("属性的出处逐个可点（每个属性自己的出处）", () => {
    const 收到: Array<[string, number]> = []
    挂检查器({
      选中: ["n1"],
      文档: 造图({
        出处: [],
        属性: [
          { 键: "身份证", 值: "3301…", 出处: ["m1#t#5", "m1#t#6"] },
          { 键: "开户行", 值: "招商银行", 出处: ["m2#t#9"] },
        ],
      }),
      打开出处: (材料, 行号) => 收到.push([材料, 行号]),
    })

    const 键们 = 出处按钮s()
    expect(键们.map((键) => 键.textContent?.trim())).toEqual(["m1#t#5", "m1#t#6", "m2#t#9"])
    键们[2]!.click()
    expect(收到).toEqual([["m2", 9]])
  })

  test("未注入时属性行保持原文本（不多出出处片段）", () => {
    挂检查器({
      选中: ["n1"],
      文档: 造图({
        属性: [{ 键: "身份证", 值: "3301…", 出处: ["m1#t#5"] }],
      }),
    })

    expect(文本("hgraph-readonly-属性")).toBe("身份证：3301…")
  })

  test("边证据：只有出处可点，关系部分仍是文本", () => {
    const 收到: Array<[string, number]> = []
    挂检查器({
      选中: ["e1"],
      文档: 带边图({ 证据: [{ 关系: "转账", 出处: "m1#t#12" }], 出处: [] }),
      打开出处: (材料, 行号) => 收到.push([材料, 行号]),
    })

    const 键们 = 出处按钮s()
    expect(键们.length).toBe(1)
    expect(键们[0]!.textContent?.trim()).toBe("m1#t#12")
    expect(文本("hgraph-edge-readonly-证据")).toBe("转账 → m1#t#12")
    键们[0]!.click()
    expect(收到).toEqual([["m1", 12]])
  })

  test("边出处：逐条可点；未注入时保持纯文本", () => {
    const 收到: Array<[string, number]> = []
    挂检查器({
      选中: ["e1"],
      文档: 带边图({ 证据: [] }),
      打开出处: (材料, 行号) => 收到.push([材料, 行号]),
    })

    const 键们 = 出处按钮s()
    expect(键们.map((键) => 键.textContent?.trim())).toEqual(["材料1#流水#12", "材料2#流水#3"])
    expect(文本("hgraph-edge-readonly-出处")).toBe("材料1#流水#12、材料2#流水#3")
    键们[1]!.click()
    expect(收到).toEqual([["材料2", 3]])
  })

  test("边证据 / 出处解析不出 ⇒ 无按钮、文本照旧", () => {
    挂检查器({
      选中: ["e1"],
      文档: 带边图({ 证据: [{ 关系: "转账", 出处: "没有井号" }], 出处: ["也没有"] }),
      打开出处: () => {},
    })

    expect(出处按钮s().length).toBe(0)
    expect(文本("hgraph-edge-readonly-证据")).toBe("转账 → 没有井号")
    expect(文本("hgraph-edge-readonly-出处")).toBe("也没有")
  })
})

// ---------------------------------------------------------------------------
// T011 · 事件两态 + 参与方段（手写可编 / 绑定只读）
// ---------------------------------------------------------------------------

/**
 * 事件夹具（T011）：
 * - `ev手写`：`来源.kind = 手写`（九格可编）；参与方一条已对上（角色边 `收款方`）、一条未对上
 *   （保留属性 `参与方·付款方` 的原文）；
 * - `ev绑定`：`来源.kind = 事件`（九格只读）；带一条未对上参与方，保证参与方段有内容；
 * - `李四`：角色边的对端实体节点（名字取自节点，不按姓名匹配——spec §Assumptions）。
 */
function 事件图(): 图文件 {
  return {
    ...造图(),
    节点: [
      {
        id: "ev手写",
        名称: "转账给李四",
        类型: "资金交易",
        来源: { kind: "手写" },
        属性: [
          { 键: "金额", 值: "12000元" },
          { 键: "时间精度", 值: "分" },
          { 键: "参与方·付款方", 值: "王*五" },
        ],
        出处: [],
        时间: { 首: "2026-03-04 14:22:00", 末: "2026-03-04 14:22:00" },
        x: 100,
        y: 100,
      },
      {
        id: "ev绑定",
        名称: "库转账",
        类型: "资金交易",
        来源: { kind: "事件", 实体: "event-1", 值: "库转账", 可信: "已核实" },
        属性: [
          { 键: "金额", 值: "5000元" },
          { 键: "参与方·付款方", 值: "王*五" },
        ],
        出处: ["m1#流水#7"],
        时间: { 首: "2026-03-04 09:00:00", 末: "2026-03-04 09:00:00" },
        x: 200,
        y: 100,
      },
      {
        id: "李四",
        名称: "李四",
        类型: "人物",
        来源: { kind: "实体", 实体: "ent2", 值: "李四" },
        时间: { 首: "", 末: "" },
        x: 300,
        y: 200,
      },
    ],
    边: [
      {
        id: "r1",
        从: "ev手写",
        到: "李四",
        标签: "收款方",
        性质: "推断",
        方向: "有向",
        来源: { kind: "手写", 依据: "手写事件「转账给李四」的收款方" },
        可信度: "中",
        时间: { 首: "", 末: "" },
      },
    ],
  }
}

describe("检查器 · T011 事件两态与参与方", () => {
  const 输入们 = () => [...document.body.querySelectorAll<HTMLElement>("input[data-slot^='hgraph-field-']")]

  test("手写事件九格有输入框、绑定事件没有；绑定态只留备注/外环可改", () => {
    // 手写态：名称/类型/细类/出现序都是输入框（九格可编）。
    挂检查器({ 选中: ["ev手写"], 文档: 事件图() })
    expect(取("[data-slot='hgraph-field-名称']")?.tagName).toBe("INPUT")
    expect(取("[data-slot='hgraph-field-类型']")?.tagName).toBe("INPUT")
    expect(取("[data-slot='hgraph-field-细类']")?.tagName).toBe("INPUT")
    expect(取("[data-slot='hgraph-field-出现序']")?.tagName).toBe("INPUT")
    // 手写事件没有可信态控件（data-model §2：手写不写 来源.可信）。
    expect(取("[data-slot='hgraph-field-可信态']") === null).toBe(true)

    document.body.innerHTML = ""
    // 绑定态：九格里没有输入框，值仍以只读文本可见。
    挂检查器({ 选中: ["ev绑定"], 文档: 事件图() })
    // T014 / FR-032 必要更替：外环颜色由自由文本输入框改为预设下拉（不再是 input）。
    expect(输入们().length).toBe(2)
    expect(输入们().map((项) => 项.getAttribute("data-slot"))).toEqual([
      "hgraph-field-外环档",
      "hgraph-field-备注",
    ])
    expect(取("[data-slot='hgraph-field-外环颜色']")?.tagName).toBe("SELECT")
    expect(文本("hgraph-field-名称")).toBe("库转账")
    expect(文本("hgraph-field-类型")).toBe("资金交易")
  })

  test("绑定事件无解绑控件（态只在加入时变化，无反向入口）", () => {
    挂检查器({ 选中: ["ev绑定"], 文档: 事件图() })

    // 前提：参与方段渲染出来了（本任务新增），下面「没有解绑」才有对象所指。
    expect(取("[data-slot='hgraph-event-participants']") === null).toBe(false)
    expect(取("[data-slot='hgraph-unbind']") === null).toBe(true)
    // 文案层也没有「解绑」入口；绑定入口只属于手写/推断节点。
    const 解绑键们 = [...document.body.querySelectorAll("button")].filter((键) =>
      (键.textContent ?? "").includes("解绑"),
    )
    expect(解绑键们.length).toBe(0)
    expect(取("[data-slot='hgraph-bind']") === null).toBe(true)
  })

  test("参与方行 = 角色：名字；未对上档案 ⇒ 灰字「未对上档案」且不调动作表", () => {
    const 幽 = 挂检查器({ 选中: ["ev手写"], 文档: 事件图() })

    expect(取("[data-slot='hgraph-event-participants']") === null).toBe(false)
    const 行们 = [...document.body.querySelectorAll<HTMLElement>("[data-slot='hgraph-event-participant-row']")]
    expect(行们.length).toBe(2)

    // 已对上档案（角色边）：只有 `角色：名字`，不带灰字。
    const 已对上 = 行们.find((行) => (行.textContent ?? "").includes("收款方：李四"))
    expect(已对上 === undefined).toBe(false)
    expect((已对上?.textContent ?? "").includes("未对上档案")).toBe(false)

    // 未对上档案（保留属性 `参与方·<角色>` 的原文）：灰字逐字「未对上档案」。
    const 未对上 = 行们.find((行) => (行.textContent ?? "").includes("付款方：王*五"))
    expect(未对上 === undefined).toBe(false)
    const 灰 = 未对上?.querySelector<HTMLElement>("[data-slot='hgraph-event-participant-unmatched']")
    expect(灰 === null).toBe(false)
    expect(灰?.textContent?.trim()).toBe("未对上档案")
    expect(灰?.className).toContain("text-v2-text-text-muted")

    // 不建节点、不改字段：参与方段只读文档。
    expect(幽.计数.加节点 ?? 0).toBe(0)
    expect(幽.计数.改字段 ?? 0).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// T014 · 四段骨架 / 收起窄条 / 未选中不渲染 / 档位与色值收口（FR-031/032/034/050）
// ---------------------------------------------------------------------------

describe("检查器 · T014 四段骨架与收起", () => {
  test("选中节点 ⇒ 头 / 可改 / 只读 / 操作脚四段齐", () => {
    挂检查器({ 选中: ["n1"], 快照 })

    // 段名沿用既有：可改区是 `hgraph-inspector-edit`，只读区是 `hgraph-inspector-readonly`。
    for (const 段 of [
      "hgraph-inspector-head",
      "hgraph-inspector-edit",
      "hgraph-inspector-readonly",
      "hgraph-inspector-actions",
    ]) {
      expect(document.body.querySelector(`[data-slot='${段}']`) === null).toBe(false)
    }

    // 只读区：灰底 + 🔒 + 悬停说明（FR-034）。
    const 只读 = 取("[data-slot='hgraph-inspector-readonly']") as HTMLElement
    expect(只读.className).toContain("bg-v2-background-bg-layer-01")
    expect((只读.textContent ?? "").includes("🔒")).toBe(true)
    expect(
      只读.querySelector("[data-slot='hgraph-inspector-readonly-lock']")?.getAttribute("title"),
    ).toBe("来自库快照，请在库中修改")

    // 头段：名称 / 类型·细类 / 来源徽标 / 收起入口（FR-034）。
    expect(文本("hgraph-inspector-head-title")).toBe("张三")
    const 头 = 文本("hgraph-inspector-head") ?? ""
    expect(头).toContain("人物 · 嫌疑人")
    expect(头).toContain("实体")
    expect(取("[data-slot='hgraph-inspector-collapse']") === null).toBe(false)

    // 操作脚：左主操作、右删除。
    expect(取("[data-slot='hgraph-inspector-neighbors']") === null).toBe(false)
    expect(取("[data-slot='hgraph-inspector-delete']") === null).toBe(false)
  })

  test("收起态是 40px 竖条「详情」+ 类型色点；展开体不在 DOM", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 收起: true, 快照 })

    const 容器 = 取("[data-slot='hgraph-inspector']") as HTMLElement
    expect(容器.style.width).toBe("40px")

    const 条 = 取("[data-slot='hgraph-inspector-collapsed']") as HTMLButtonElement
    expect(条 === null).toBe(false)
    expect((条.textContent ?? "").includes("详情")).toBe(true)

    const 点 = 条.querySelector<HTMLElement>("[data-slot='hgraph-inspector-collapsed-dot']")
    expect(点 === null).toBe(false)
    expect((点!.style.background ?? "") === "").toBe(false)

    // 收起时只剩窄条：头段与展开体都不渲染。
    expect(取("[data-slot='hgraph-inspector-head']") === null).toBe(true)
    expect(取("[data-slot='hgraph-inspector-actions']") === null).toBe(true)

    // 点窄条 ⇒ 展开（FR-050）。
    条.click()
    expect(幽.收起()).toBe(false)
  })

  test("类型色点取 graph.tsx 的类型色（号码 ⇒ info），不借用外环色", () => {
    // 号码在图例映射里是 `var(--v2-state-bg-info)`；外环没有颜色 ⇒ 旧实现会落成中性灰。
    // 这里同时钉展开头段与收起窄条两处，两处都读同一个 `头().色`。
    const 展开 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 类型: "号码" }) })
    const 色块 = 取("[data-slot='hgraph-inspector-head-color']") as HTMLElement
    expect(色块 !== null).toBe(true)
    expect(色块.style.background).toBe("var(--v2-state-bg-info)")

    展开.set选中([])
    const 收起 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 类型: "号码" }), 收起: true })
    const 窄条 = 取("[data-slot='hgraph-inspector-collapsed']") as HTMLButtonElement
    const 点 = 窄条.querySelector<HTMLElement>("[data-slot='hgraph-inspector-collapsed-dot']")
    expect(点 !== null).toBe(true)
    expect(点!.style.background).toBe("var(--v2-state-bg-info)")
    expect(收起.收起()).toBe(true)
  })

  test("选中边 ⇒ 头 / 边可改 / 边只读 / 操作脚四段齐；文字没有只读段", async () => {
    const 文档: 图文件 = {
      ...带边图(),
      文字: [{ id: "t1", 内容: "备注", x: 50, y: 50, 字号: "中" }],
    }
    const { set选中 } = 挂检查器({ 选中: ["e1"], 文档 })

    // 边用另一套槽位名：可改区 `-edge`、只读区 `-edge-readonly`。
    for (const 段 of [
      "hgraph-inspector-head",
      "hgraph-inspector-edge",
      "hgraph-inspector-edge-readonly",
      "hgraph-inspector-actions",
    ]) {
      expect(取(`[data-slot='${段}']`) === null).toBe(false)
    }
    // 节点那套只读槽位不该混进边面板。
    expect(取("[data-slot='hgraph-inspector-readonly']") === null).toBe(true)

    // 文字面板没有只读段（没有库快照来源），只有可改段。
    set选中(["t1"])
    await Promise.resolve()
    expect(取("[data-slot='hgraph-inspector-readonly']") === null).toBe(true)
    expect(取("[data-slot='hgraph-inspector-edge-readonly']") === null).toBe(true)
  })

  test("未选中 ⇒ 检查器不渲染（不是空壳、不占位）", () => {
    挂检查器({ 选中: [] })

    expect(document.body.querySelector("[data-slot='hgraph-inspector']") === null).toBe(true)
    expect(document.body.querySelector("[data-slot='hgraph-inspector-collapsed']") === null).toBe(true)
    expect(document.body.querySelector("[data-slot='hgraph-inspector-hint']") === null).toBe(true)
  })

  test("外环档 12 ⇒ 就地提示且不调用改字段（与线宽档同一实现点）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 快照 })
    const 输入 = 取("[data-slot='hgraph-field-外环档']") as HTMLInputElement

    输入.value = "12"
    失焦(输入)

    expect(幽.计数.改字段 ?? 0).toBe(0)
    expect(文本("hgraph-field-外环档-提示")).toBe("要填 0–4 的整数")
  })

  test("外环档清空 ⇒ 删键：外环只留颜色（与线宽档同语义）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 外环: { 档: 2, 颜色: "红" } }), 快照 })
    const 输入 = 取("[data-slot='hgraph-field-外环档']") as HTMLInputElement

    输入.value = ""
    失焦(输入)

    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 外环: { 颜色: "红" } }])
  })

  test("外环颜色是 <select>：7 预设 + 自动 = 8 个选项（色名取自外环色表）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 外环: { 颜色: "红" } }), 快照 })

    const 选 = 取("[data-slot='hgraph-field-外环颜色']") as HTMLSelectElement
    expect(选.tagName).toBe("SELECT")
    const 值们 = [...选.querySelectorAll("option")].map((项) => 项.value)
    expect(值们.length).toBe(8)
    expect(值们[0]).toBe("自动")
    expect(值们.slice(1)).toEqual(Object.keys(外环色表))

    选择(选, "蓝")
    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 外环: { 颜色: "蓝" } }])
  })

  test("外环颜色选「自动」⇒ 删键（外环整键 null）", () => {
    const 幽 = 挂检查器({ 选中: ["n1"], 文档: 造图({ 外环: { 颜色: "红" } }), 快照 })

    选择(取("[data-slot='hgraph-field-外环颜色']") as HTMLSelectElement, "自动")

    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 外环: null }])
  })
})
