/**
 * 模板库页（010 T011 / FR-010 / DESIGN §4.11.7）。
 *
 * 判据只钉**界面这一层答应的事**：默认分段、切分段重拉、表格四列、空 / 加载 / 错误三态、
 * 新建与编辑把什么交给客户端、停用前必须说清「无法恢复启用」、失败留在框里。
 *
 * 「判重、停用幂等、谁有权限」的真判据在服务端（`openhive-governance-templates.test.ts`
 * 与 `packages/auth/src/template.test.ts`）——这里不重测。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { TemplateLib } from "./template-lib"
import type { NewTemplate, TemplateApi, TemplateKind, TemplateOutcome, TemplatePatch, TemplateRow } from "./template-api"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const 歇一拍 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function 等到(条件: () => boolean, 上限毫秒 = 1000) {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限毫秒) throw new Error("等到超时")
    await 歇一拍()
  }
}

const 行 = (id: string, overrides: Partial<TemplateRow> = {}): TemplateRow => ({
  id,
  kind: "report",
  name: "资金分析报告",
  scope: "全单位",
  content: "# 一、案情",
  status: "active",
  createdBy: "u-甲",
  createdAt: 1_700_000_000,
  updatedBy: "u-甲",
  updatedAt: 1_700_003_600,
  updatedByName: "甲专家",
  updatedByPoliceNo: "940001",
  ...overrides,
})

interface 记录 {
  readonly list: TemplateKind[]
  readonly create: NewTemplate[]
  readonly update: Array<{ id: string; patch: TemplatePatch }>
  readonly disable: string[]
}

function 假后端(
  应答: {
    list?: (kind: TemplateKind, 序号: number) => TemplateOutcome<readonly TemplateRow[]> | Promise<TemplateOutcome<readonly TemplateRow[]>>
    create?: (input: NewTemplate) => TemplateOutcome<TemplateRow> | Promise<TemplateOutcome<TemplateRow>>
    update?: (id: string, patch: TemplatePatch) => TemplateOutcome<TemplateRow>
    disable?: (id: string) => TemplateOutcome<TemplateRow>
  } = {},
) {
  const 记录: 记录 = { list: [], create: [], update: [], disable: [] }
  const api: TemplateApi = {
    list: async (kind = "report") => {
      记录.list.push(kind)
      return 应答.list ? await 应答.list(kind, 记录.list.length) : { kind: "ok", value: [行("t1", { kind })] }
    },
    create: async (input) => {
      记录.create.push(input)
      return 应答.create ? await 应答.create(input) : { kind: "ok", value: 行("t-new", input) }
    },
    update: async (id, patch) => {
      记录.update.push({ id, patch })
      return 应答.update ? 应答.update(id, patch) : { kind: "ok", value: 行(id, { ...patch }) }
    },
    disable: async (id) => {
      记录.disable.push(id)
      return 应答.disable ? 应答.disable(id) : { kind: "ok", value: 行(id, { status: "disabled" }) }
    },
  }
  return { api, 记录 }
}

function 挂上(api: TemplateApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <TemplateLib api={api} />, root))
  return root
}

const 槽 = (slot: string) => document.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 全 = (slot: string) => [...document.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`)]
const 行们 = () => 全("template-row")
const 行元素 = (id: string) => document.querySelector<HTMLElement>(`[data-slot='template-row'][data-id='${id}']`)
const 行内 = (id: string, slot: string) => 行元素(id)?.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 分段 = (kind: string) => document.querySelector<HTMLElement>(`[data-slot='template-kind'][data-kind='${kind}']`)

/**
 * 浮层开着的判据 = 节点在 **且** 带 `data-expanded`。
 *
 * 不能用「节点消失」判关：Kobalte 的存在层（presence）在 happy-dom 里等不到动画结束事件，
 * 关掉后节点**留在 DOM**、只把 `data-expanded` 摘掉（2026-10-26 探针实测）。真浏览器里节点会
 * 被移除，但那是渲染层的事——这条判据两头都成立。
 */
const 浮层开着 = (slot: string) =>
  document.querySelector(`[data-slot='${slot}'][data-expanded]`) !== null

function 点明(selector: string) {
  const 目标 = document.querySelector<HTMLElement>(selector)
  if (!目标) throw new Error(`没找到 ${selector}`)
  目标.click()
}

/** `data-slot` 挂在 `<label>` 上（`TextInputV2` 会把内层 `data-slot` 覆写成自己的），所以往里找。 */
function 输入(selector: string, 值: string) {
  const 目标 =
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`${selector} input, ${selector} textarea`) ??
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!目标) throw new Error(`没找到 ${selector}`)
  目标.value = 值
  目标.dispatchEvent(new Event("input", { bubbles: true }))
}

const 字段值 = (selector: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`${selector} input, ${selector} textarea`)?.value

function 提交表单(selector: string) {
  const 表单 = document.querySelector<HTMLFormElement>(selector)
  if (!表单) throw new Error(`没找到 ${selector}`)
  表单.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

describe("模板库 · 分段与列表", () => {
  test("挂载即按报告模板拉取；三个分段中只有报告模板是选中的", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 记录.list.length === 1)

    expect(记录.list).toEqual(["report"])
    expect(全("template-kind").map((el) => el.dataset.kind)).toEqual(["report", "graph", "metric"])
    expect(分段("report")?.getAttribute("aria-pressed")).toBe("true")
    expect(分段("graph")?.getAttribute("aria-pressed")).toBe("false")
  })

  test("切分段 ⇒ 按新类重拉，表格换成新类的行（旧行不留）", async () => {
    const { api, 记录 } = 假后端({
      list: (kind) => ({ kind: "ok", value: [行(`t-${kind}`, { kind, name: `${kind} 模板` })] }),
    })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-kind'][data-kind='graph']")
    await 等到(() => 记录.list.length === 2)
    await 等到(() => 行们().length === 1 && 行们()[0]?.dataset.id === "t-graph")

    expect(记录.list).toEqual(["report", "graph"])
    expect(分段("graph")?.getAttribute("aria-pressed")).toBe("true")
    expect(行内("t-graph", "template-name")?.textContent).toContain("graph 模板")
  })

  test("表格四列逐字：名称 / 适用范围 / 更新人（警号）/ 更新时间；范围为空写 —", async () => {
    const { api } = 假后端({
      list: () => ({
        kind: "ok",
        value: [
          行("t1", { name: "资金分析报告", scope: "经侦支队", updatedByName: "甲专家", updatedByPoliceNo: "940001" }),
          行("t2", { name: "话单分析报告", scope: "", updatedByName: "", updatedByPoliceNo: "" }),
        ],
      }),
    })
    挂上(api)
    await 等到(() => 行们().length === 2)

    expect(行内("t1", "template-name")?.textContent).toBe("资金分析报告")
    expect(行内("t1", "template-scope")?.textContent).toBe("经侦支队")
    expect(行内("t1", "template-updated-by")?.textContent).toBe("甲专家（940001）")
    expect(行内("t1", "template-updated-at")?.textContent).toBeTruthy()

    expect(行内("t2", "template-scope")?.textContent).toBe("—")
    // 账号已清理：写「已注销用户（id 前 8 位）」，不留空白格。
    expect(行内("t2", "template-updated-by")?.textContent).toBe("已注销用户（u-甲）")
  })

  test("空态：文案说清楚「不预置假模板」；空态里的新建按钮能开抽屉", async () => {
    const { api } = 假后端({ list: () => ({ kind: "ok", value: [] }) })
    挂上(api)
    await 等到(() => 槽("template-empty") !== null)

    expect(槽("template-empty")?.textContent).toContain("还没有配置模板")
    expect(槽("template-empty")?.textContent).toContain("不预置")
    点明("[data-slot='template-empty-create']")
    await 等到(() => 浮层开着("governance-drawer"))
    expect(槽("template-form")?.textContent).toContain("报告模板")
  })

  test("错误态：role=alert ＋ 重试会再拉一次", async () => {
    let 第几次 = 0
    const { api, 记录 } = 假后端({
      list: () => {
        第几次++
        return 第几次 === 1 ? { kind: "rejected", message: "没有模板库管理权限" } : { kind: "ok", value: [行("t1")] }
      },
    })
    挂上(api)
    await 等到(() => 槽("template-error") !== null)
    expect(槽("template-error")?.getAttribute("role")).toBe("alert")
    expect(槽("template-error")?.textContent).toContain("没有模板库管理权限")

    点明("[data-slot='template-retry']")
    await 等到(() => 行们().length === 1)
    expect(记录.list.length).toBe(2)
    expect(槽("template-error")).toBeNull()
  })

  test("先发的旧回包后到时被丢掉（代次守卫）", async () => {
    let 放旧: ((out: TemplateOutcome<readonly TemplateRow[]>) => void) | undefined
    const { api } = 假后端({
      list: (kind, 序号) => {
        if (序号 === 1) return new Promise((resolve) => (放旧 = resolve))
        return { kind: "ok", value: [行(`t-${kind}`, { kind })] }
      },
    })
    挂上(api)
    点明("[data-slot='template-kind'][data-kind='metric']")
    await 等到(() => 行们().length === 1 && 行们()[0]?.dataset.id === "t-metric")

    放旧?.({ kind: "ok", value: [行("t-report", { kind: "report" })] })
    await 歇一拍()
    expect(行们().map((el) => el.dataset.id)).toEqual(["t-metric"])
  })
})

describe("模板库 · 新建与编辑", () => {
  test("新建：抽屉写出当前类型；提交时 kind 取当前分段，三个字段原样交出；成功后关框并重拉", async () => {
    const { api, 记录 } = 假后端({ list: (kind) => ({ kind: "ok", value: [行("t1", { kind })] }) })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-kind'][data-kind='graph']")
    await 等到(() => 记录.list.length === 2)
    点明("[data-slot='template-create']")
    await 等到(() => 浮层开着("governance-drawer"))
    expect(槽("template-form-kind")?.textContent).toContain("图谱样式")

    输入("[data-slot='template-form-name']", "默认图谱样式")
    输入("[data-slot='template-form-scope']", "经侦支队")
    输入("[data-slot='template-form-content']", "节点按涉案金额着色")
    提交表单("[data-slot='template-form']")

    await 等到(() => 记录.create.length === 1)
    expect(记录.create[0]).toEqual({
      kind: "graph",
      name: "默认图谱样式",
      scope: "经侦支队",
      content: "节点按涉案金额着色",
    })
    await 等到(() => !浮层开着("governance-drawer"))
    // 成功后按**当时那一类**重拉（分段没有被改动）。
    expect(记录.list).toEqual(["report", "graph", "graph"])
  })

  test("编辑：表单预填原值；提交只带三个可改字段与 id", async () => {
    const { api, 记录 } = 假后端({
      list: () => ({ kind: "ok", value: [行("t1", { name: "旧名", scope: "旧范围", content: "旧正文" })] }),
    })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-edit']")
    await 等到(() => 浮层开着("governance-drawer"))
    expect(字段值("[data-slot='template-form-name']")).toBe("旧名")
    expect(字段值("[data-slot='template-form-content']")).toBe("旧正文")

    输入("[data-slot='template-form-name']", "新名")
    提交表单("[data-slot='template-form']")

    await 等到(() => 记录.update.length === 1)
    expect(记录.update[0]).toEqual({
      id: "t1",
      patch: { name: "新名", scope: "旧范围", content: "旧正文" },
    })
  })

  test("保存被拒（409 判重）⇒ 抽屉不关、错误留在抽屉里", async () => {
    const { api } = 假后端({
      create: () => ({ kind: "rejected", message: "该类模板下已有同名模板「甲」" }),
    })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-create']")
    await 等到(() => 槽("template-form") !== null)
    输入("[data-slot='template-form-name']", "甲")
    提交表单("[data-slot='template-form']")

    await 等到(() => 槽("template-form-error") !== null)
    expect(槽("template-form-error")?.textContent).toContain("已有同名模板")
    expect(浮层开着("governance-drawer")).toBe(true)
  })

  test("保存被拒且带 field ⇒ 对应输入框标 invalid", async () => {
    const { api } = 假后端({
      create: () => ({ kind: "rejected", message: "模板名称不能为空", field: "name" }),
    })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-create']")
    await 等到(() => 槽("template-form") !== null)
    提交表单("[data-slot='template-form']")

    await 等到(() => 槽("template-form-error") !== null)
    expect(
      document.querySelector("[data-slot='template-form-name'] input")?.getAttribute("aria-invalid"),
    ).toBe("true")
  })
})

describe("模板库 · 停用", () => {
  test("确认框把「无法恢复启用」说出来；确认后按 id 停用、关框、重拉", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-disable']")
    await 等到(() => 浮层开着("governance-confirm"))
    const 文案 = 槽("governance-confirm-text")?.textContent ?? ""
    expect(文案).toContain("资金分析报告")
    expect(文案).toContain("无法恢复启用")

    const 重拉前 = 记录.list.length
    点明("[data-slot='governance-confirm-submit']")
    await 等到(() => 记录.disable.length === 1)
    expect(记录.disable).toEqual(["t1"])
    await 等到(() => !浮层开着("governance-confirm"))
    await 等到(() => 记录.list.length === 重拉前 + 1)
  })

  test("停用被拒 ⇒ 确认框不关、错误留在框里", async () => {
    const { api } = 假后端({ disable: () => ({ kind: "rejected", message: "模板不存在或已停用" }) })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-disable']")
    await 等到(() => 浮层开着("governance-confirm"))
    点明("[data-slot='governance-confirm-submit']")

    await 等到(() => 槽("governance-confirm-error") !== null)
    expect(槽("governance-confirm-error")?.textContent).toContain("不存在或已停用")
    expect(浮层开着("governance-confirm")).toBe(true)
  })

  test("取消 ⇒ 不调停用接口", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='template-disable']")
    await 等到(() => 浮层开着("governance-confirm"))
    const 取消 = [...document.querySelectorAll<HTMLElement>("[data-slot='governance-confirm'] button")].find(
      (el) => el.textContent === "取消",
    )
    取消?.click()
    await 等到(() => !浮层开着("governance-confirm"))
    expect(记录.disable).toEqual([])
  })
})
