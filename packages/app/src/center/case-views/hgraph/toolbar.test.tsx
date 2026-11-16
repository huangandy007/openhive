/**
 * T015：工具栏四组图标 + 模式按下态 + 危险色 + 300ms 悬停说明。
 *
 * 本文件只钉**工具栏自己**的可观测面（`#002-06`：同一前提只在一处判）：
 * - 四组容器与分组名；
 * - 模式按钮 `aria-pressed` 随当前模式变，动作按钮恒 `"false"`；
 * - 删除按钮的危险色 token、普通动作按钮不含；
 * - 单行不折行（happy-dom 量不出真宽，见用例内注释）；
 * - 悬停 300ms 才出说明，且说明带快捷键。
 *
 * 量几何 / 真浏览器观感不在 happy-dom 的能力内：`scrollWidth`/`clientWidth` 恒 0，
 * 这里只钉「布尔关系」与「没有 flex-wrap」，真栈补量写进 task-15 报告（`#013-12` 同族）。
 */
import { afterEach, describe, expect, test, vi } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { 边, 图文件, 节点, 设置, 文字 } from "./file"
import type { 画布动作, 模式 } from "./canvas"
import { 排列模式们, type 排列模式 } from "../graph-layout"
import { 工具栏 } from "./toolbar"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

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

function 两点图(): 图文件 {
  return {
    格式: 1,
    标题: "工具栏测试",
    创建于: "2026-11-17T10:00:00+08:00",
    更新于: "2026-11-17T10:00:00+08:00",
    设置: 默认设置,
    节点: [造节点("n1", 100, 100), 造节点("n2", 200, 100)],
    边: [] as 边[],
    文字: [] as 文字[],
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

function 挂工具栏(可选: { readonly 模式?: 模式; readonly 选中?: readonly string[] } = {}) {
  const [模式, set模式] = createSignal<模式>(可选.模式 ?? "指针")
  const 切换记录: 模式[] = []
  /** T016：`自动布局` 收到的模式原样记录（`undefined` = 调用方没传参）。 */
  const 布局记录: Array<排列模式 | undefined> = []
  const 动作: 画布动作 = {
    ...幽灵动作表(),
    切换模式: (下一) => {
      切换记录.push(下一)
      set模式(下一)
    },
    自动布局: (排列) => 布局记录.push(排列),
  }
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <工具栏 选中={可选.选中 ?? []} 文档={两点图()} 动作表={动作} 模式={模式()} />
      ),
      host,
    ),
  )
  return { 切换记录, 布局记录 }
}

const 取 = (选择器: string) => document.querySelector(选择器)
const 钮 = (slot: string) => 取(`[data-slot='${slot}']`) as HTMLButtonElement | null
const 组们 = () => [...document.querySelectorAll("[data-slot='hgraph-toolbar-group']")]

/**
 * 悬停：监听挂在按钮外层的定位包裹上（`pointerenter/leave` 不冒泡，也不合成祖先事件），
 * 所以直接派发到 `button.parentElement`，而不是按钮本身。
 */
const 悬停 = (按钮: Element) =>
  (按钮.parentElement ?? 按钮).dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }))
const 移开 = (按钮: Element) =>
  (按钮.parentElement ?? 按钮).dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }))

describe("T015 · 工具栏分组与模式按下态", () => {
  test("四组齐，分组名与归属正确（含「手」入口）", () => {
    挂工具栏()

    const 四组 = 组们()
    expect(四组.length).toBe(4)
    expect(四组.map((组) => 组.getAttribute("data-group"))).toEqual(["选择", "画", "排", "找+整"])

    // 组容器本身不是按钮；按钮必须真的落在某一组里（防止四组是空壳）。
    for (const 组 of 四组) {
      expect(组.querySelectorAll("button").length > 0).toBe(true)
    }

    const 手 = 钮("hgraph-mode-hand")
    expect(手 !== null).toBe(true)
    expect(手!.closest("[data-slot='hgraph-toolbar-group']")?.getAttribute("data-group")).toBe("选择")
    expect(钮("hgraph-mode-pointer") !== null).toBe(true)
    expect(钮("hgraph-mode-connect") !== null).toBe(true)
  })

  test("模式按钮 aria-pressed 随点击变；动作按钮恒 false；只有按下态带品牌金", async () => {
    挂工具栏()

    const 指针 = 钮("hgraph-mode-pointer")!
    const 手 = 钮("hgraph-mode-hand")!
    const 连线 = 钮("hgraph-mode-connect")!
    expect(指针.getAttribute("aria-pressed")).toBe("true")
    expect(手.getAttribute("aria-pressed")).toBe("false")
    expect(连线.getAttribute("aria-pressed")).toBe("false")

    手.click()
    await Promise.resolve()
    expect(手.getAttribute("aria-pressed")).toBe("true")
    expect(指针.getAttribute("aria-pressed")).toBe("false")

    连线.click()
    await Promise.resolve()
    expect(连线.getAttribute("aria-pressed")).toBe("true")
    expect(手.getAttribute("aria-pressed")).toBe("false")

    // 按下态：品牌金边框 + 浅金底。
    expect(连线.className.includes("border-v2-border-border-focus")).toBe(true)
    expect(连线.className.includes("bg-v2-background-bg-accent")).toBe(true)
    expect(指针.className.includes("border-v2-border-border-focus")).toBe(false)

    // 动作按钮：恒 false，且不借用模式按下态的金色边框 / 底色。
    const 动作钮们 = 组们()
      .flatMap((组) => [...组.querySelectorAll("button")])
      .filter((元素) => 元素.getAttribute("data-kind") === "action")
    expect(动作钮们.length > 5).toBe(true)
    for (const 元素 of 动作钮们) {
      expect(元素.getAttribute("aria-pressed")).toBe("false")
      expect(元素.className.includes("border-v2-border-border-focus")).toBe(false)
      expect(元素.className.includes("bg-v2-background-bg-accent")).toBe(false)
    }
  })

  test("删除按钮含危险色 token，普通动作按钮不含", () => {
    挂工具栏()

    const 删除 = 钮("hgraph-toolbar-delete")!
    const 加节点 = 钮("hgraph-toolbar-add-node")!
    expect(删除.className.includes("text-v2-state-fg-danger")).toBe(true)
    expect(加节点.className.includes("text-v2-state-fg-danger")).toBe(false)
    expect(删除.getAttribute("aria-pressed")).toBe("false")
  })

  test("单行不折行：没有 flex-wrap，且 scrollWidth <= clientWidth（布尔比较）", () => {
    挂工具栏()

    const 栏 = 取("[data-slot='hgraph-toolbar']") as HTMLElement | null
    expect(栏 !== null).toBe(true)
    expect(栏!.className.includes("flex-wrap")).toBe(false)
    // happy-dom 无布局 ⇒ 两个宽度都是 0；这条只证「当前实现不依赖 wrap」且留一个
    // 真宽下的同口径断言。真栈补量见报告。
    expect(栏!.scrollWidth <= 栏!.clientWidth).toBe(true)
  })
})

describe("T015 · 悬停 300ms 出说明（含快捷键）", () => {
  test("299ms 不出、300ms 出；说明含快捷键；移开后收回", async () => {
    vi.useFakeTimers()
    try {
      挂工具栏()
      const 手 = 钮("hgraph-mode-hand")!
      const 提示 = () => document.querySelector("[data-slot='hgraph-toolbar-tip']")

      悬停(手)
      vi.advanceTimersByTime(299)
      await Promise.resolve()
      expect(提示() === null).toBe(true)

      vi.advanceTimersByTime(1)
      await Promise.resolve()
      expect(提示() !== null).toBe(true)
      expect(提示()!.textContent ?? "").toContain("空格")

      移开(手)
      await Promise.resolve()
      expect(提示() === null).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  test("删除按钮的说明带 Delete 快捷键", async () => {
    vi.useFakeTimers()
    try {
      挂工具栏()
      const 删除 = 钮("hgraph-toolbar-delete")!
      悬停(删除)
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      const 提示 = document.querySelector("[data-slot='hgraph-toolbar-tip']")
      expect(提示 !== null).toBe(true)
      expect(提示!.textContent ?? "").toContain("Delete")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("T016 · 排列模式下拉原样透传", () => {
  test("默认环形；选『分层』后点自动布局 ⇒ 动作表收到的模式是 分层", async () => {
    const { 布局记录 } = 挂工具栏()
    const 下拉 = 取("[data-slot='hgraph-toolbar-layout-mode']") as HTMLSelectElement | null
    // `#013-12`：节点存在性用布尔比较，不用 toBeNull。
    expect(下拉 !== null).toBe(true)
    // 选项文案 = `排列模式们` 原值（不另起一套标签）。
    expect([...下拉!.options].map((项) => 项.value)).toEqual([...排列模式们])
    expect(下拉!.value).toBe("环形")

    // 默认值就按环形透传（不是 `undefined`，让编辑器走它自己的缺省）。
    钮("hgraph-toolbar-layout")!.click()
    expect(布局记录).toEqual(["环形"])

    下拉!.value = "分层"
    下拉!.dispatchEvent(new Event("change", { bubbles: true }))
    钮("hgraph-toolbar-layout")!.click()
    expect(布局记录).toEqual(["环形", "分层"])
  })
})
