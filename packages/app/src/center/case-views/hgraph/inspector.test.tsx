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
import type { 图文件, 节点 } from "./file"
import type { 画布动作 } from "./canvas"
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

function 挂检查器(选项: {
  选中: readonly string[]
  文档?: 图文件
  快照?: Readonly<Record<string, 节点快照>>
  载入中?: boolean
  刷新节点?: (实体id: string) => void
}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 幽 = 幽灵动作表()
  const 文档 = 选项.文档 ?? 造图()
  // 选中用信号：M3 要断言「换选再回来」时提示消失。
  const [选中, set选中] = createSignal<readonly string[]>(选项.选中)
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
        />
      ),
      host,
    ),
  )
  return { ...幽, set选中 }
}

const 取 = (选择器: string) => document.body.querySelector(选择器) as HTMLElement | null
const 文本 = (slot: string) => 取(`[data-slot='${slot}']`)?.textContent?.trim()

function 失焦(元素: HTMLInputElement) {
  元素.dispatchEvent(new FocusEvent("blur"))
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
  test("选中 2 个：对齐/等距可用、合并 disabled、删除可用", () => {
    const 幽 = 挂检查器({ 选中: ["n1", "n2"], 快照 })

    expect(取("[data-slot='hgraph-batch']")).not.toBeNull()
    const 对齐 = 取("[data-slot='hgraph-batch-align-左']") as HTMLButtonElement
    const 等距 = 取("[data-slot='hgraph-batch-space-水平']") as HTMLButtonElement
    expect(对齐.disabled).toBe(false)
    expect(等距.disabled).toBe(false)
    const 合并 = 取("[data-slot='hgraph-batch-merge']") as HTMLButtonElement
    expect(合并.disabled).toBe(true)
    expect(合并.getAttribute("title")).toBe("合并（下个任务做）")
    expect((取("[data-slot='hgraph-batch-delete']") as HTMLButtonElement).disabled).toBe(false)

    对齐.click()
    expect(幽.参数.对齐![0]).toEqual(["左", ["n1", "n2"]])
    等距.click()
    expect(幽.参数.等距![0]).toEqual(["水平", ["n1", "n2"]])
    ;(取("[data-slot='hgraph-batch-delete']") as HTMLButtonElement).click()
    expect(幽.计数.删除所选).toBe(1)
  })

  test("选中 1 个：不出现批量面板，单个详情可改", () => {
    挂检查器({ 选中: ["n1"], 快照 })
    expect(取("[data-slot='hgraph-batch']")).toBeNull()
    expect(取("[data-slot='hgraph-field-名称']")).not.toBeNull()
  })

  test("没有选中：只给提示，不显示空属性或伪造快照", () => {
    挂检查器({ 选中: [] })
    expect(文本("hgraph-inspector-hint")).toContain("选中")
    expect(取("[data-slot='hgraph-field-名称']")).toBeNull()
    expect(取("[data-slot='hgraph-snapshot-empty']")).toBeNull()
  })
})
