/**
 * 数据源配置页（010 T012 / FR-011 / US6）。
 *
 * 判据只钉**界面这一层答应的事**：表格六列、最近同步恒「—」（connector 未落地）、
 * 抽屉里**没有口令框也没有「测试连接」**、注册与编辑交出去的东西、
 * 编辑没动上游就不发 `upstreamIds`、血缘浮层的三段（上游 / 本数据源 / 下游）与空态。
 *
 * 「撞名、成环、谁有权限」的真判据在服务端（`openhive-governance-data-source.test.ts`
 * 与 `packages/auth/src/data-source.test.ts`）——这里不重测。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { DataSource } from "./data-source"
import type {
  DataSourceApi,
  DataSourceLineage,
  DataSourceOutcome,
  DataSourcePatch,
  DataSourceRow,
  NewDataSource,
} from "./data-source-api"

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

const 行 = (id: string, overrides: Partial<DataSourceRow> = {}): DataSourceRow => ({
  id,
  name: "话单库",
  kind: "database",
  endpoint: "pg://10.0.0.8:5432/cdr",
  frequency: "daily",
  owner: "科信支队 张三",
  status: "active",
  lastSyncedAt: null,
  createdBy: "u-甲",
  createdAt: 1_700_000_000,
  updatedBy: "u-甲",
  updatedAt: 1_700_003_600,
  ...overrides,
})

interface 记录 {
  list: number
  readonly create: NewDataSource[]
  readonly update: Array<{ id: string; patch: DataSourcePatch }>
  readonly lineage: string[]
}

function 假后端(
  应答: {
    list?: (序号: number) => DataSourceOutcome<readonly DataSourceRow[]> | Promise<DataSourceOutcome<readonly DataSourceRow[]>>
    create?: (input: NewDataSource) => DataSourceOutcome<DataSourceRow>
    update?: (id: string, patch: DataSourcePatch) => DataSourceOutcome<DataSourceRow>
    lineage?: (id: string) => DataSourceOutcome<DataSourceLineage> | Promise<DataSourceOutcome<DataSourceLineage>>
  } = {},
  初始行: readonly DataSourceRow[] = [行("s1")],
) {
  const 记录: 记录 = { list: 0, create: [], update: [], lineage: [] }
  const api: DataSourceApi = {
    list: async () => {
      记录.list += 1
      return 应答.list ? await 应答.list(记录.list) : { kind: "ok", value: 初始行 }
    },
    create: async (input) => {
      记录.create.push(input)
      return 应答.create ? 应答.create(input) : { kind: "ok", value: 行("s-new", input) }
    },
    update: async (id, patch) => {
      记录.update.push({ id, patch })
      return 应答.update ? 应答.update(id, patch) : { kind: "ok", value: 行(id, patch) }
    },
    lineage: async (id) => {
      记录.lineage.push(id)
      const 源 = 初始行.find((row) => row.id === id) ?? 行(id)
      return 应答.lineage ? await 应答.lineage(id) : { kind: "ok", value: { source: 源, upstream: [], downstream: [] } }
    },
  }
  return { api, 记录 }
}

function 挂上(api: DataSourceApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <DataSource api={api} />, root))
  return root
}

const 槽 = (slot: string) => document.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 全 = (slot: string) => [...document.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`)]
const 行们 = () => 全("data-source-row")
const 行元素 = (id: string) => document.querySelector<HTMLElement>(`[data-slot='data-source-row'][data-id='${id}']`)
const 行内 = (id: string, slot: string) => 行元素(id)?.querySelector<HTMLElement>(`[data-slot='${slot}']`)

/** 浮层开着的判据 = 节点在 **且** 带 `data-expanded`（Kobalte 关掉后节点留在 DOM，同 T011）。 */
const 浮层开着 = (slot: string) => document.querySelector(`[data-slot='${slot}'][data-expanded]`) !== null

function 点明(selector: string) {
  const 目标 = document.querySelector<HTMLElement>(selector)
  if (!目标) throw new Error(`没找到 ${selector}`)
  目标.click()
}

/** `data-slot` 挂在 `<label>` 上（`TextInputV2` 会覆写内层 `data-slot`），所以往里找。 */
function 输入(selector: string, 值: string) {
  const 目标 = document.querySelector<HTMLInputElement>(`${selector} input`)
  if (!目标) throw new Error(`没找到 ${selector}`)
  目标.value = 值
  目标.dispatchEvent(new Event("input", { bubbles: true }))
}

const 字段值 = (selector: string) => document.querySelector<HTMLInputElement>(`${selector} input`)?.value

function 选下拉(slot: string, 值: string) {
  const 目标 = document.querySelector<HTMLSelectElement>(`[data-slot='${slot}'] select`)
  if (!目标) throw new Error(`没找到 ${slot} 的下拉`)
  目标.value = 值
  目标.dispatchEvent(new Event("change", { bubbles: true }))
}

function 提交表单() {
  const 表单 = document.querySelector<HTMLFormElement>("[data-slot='data-source-form']")
  if (!表单) throw new Error("没找到表单")
  表单.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

const 上游勾选 = (id: string) =>
  document.querySelector<HTMLInputElement>(
    `[data-slot='data-source-upstream-option'][data-id='${id}'] input[type='checkbox']`,
  )

describe("数据源 · 列表", () => {
  test("挂载即拉一次；表头七列逐字；类型 / 频率 / 状态用中文，最近同步恒「—」", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 行们().length === 1)

    expect(记录.list).toBe(1)
    expect([...document.querySelectorAll<HTMLElement>("[data-slot='data-source-table'] th")].map((el) => el.textContent?.trim())).toEqual([
      "名称",
      "类型",
      "更新频率",
      "负责人",
      "状态",
      "最近同步",
      "操作",
    ])
    expect(行内("s1", "data-source-name")?.textContent).toBe("话单库")
    expect(行内("s1", "data-source-kind")?.textContent).toBe("数据库")
    expect(行内("s1", "data-source-frequency")?.textContent).toBe("每天")
    expect(行内("s1", "data-source-owner")?.textContent).toBe("科信支队 张三")
    expect(行内("s1", "data-source-status")?.textContent).toBe("启用")
    // connector 未落地：没有同步过，必须显示「—」，不能编一个时间。
    expect(行内("s1", "data-source-last-synced")?.textContent).toBe("—")
  })

  test("负责人为空写「—」；有 lastSyncedAt 才格式化成时间", async () => {
    const { api } = 假后端({}, [行("s1", { owner: "", lastSyncedAt: 1_700_003_600 }), 行("s2", { name: "话单二" })])
    挂上(api)
    await 等到(() => 行们().length === 2)

    expect(行内("s1", "data-source-owner")?.textContent).toBe("—")
    expect(行内("s1", "data-source-last-synced")?.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(行内("s2", "data-source-last-synced")?.textContent).toBe("—")
  })

  test("空态：说清「不预置假数据源」；空态按钮能开注册抽屉", async () => {
    const { api } = 假后端({ list: () => ({ kind: "ok", value: [] }) })
    挂上(api)
    await 等到(() => 槽("data-source-empty") !== null)

    expect(槽("data-source-empty")?.textContent).toContain("还没有登记数据源")
    expect(槽("data-source-empty")?.textContent).toContain("不预置")
    点明("[data-slot='data-source-empty-create']")
    await 等到(() => 浮层开着("governance-drawer"))
    expect(槽("data-source-form")?.textContent).toContain("账号、口令、密钥一律不保存")
  })

  test("错误态：role=alert ＋ 重试会再拉一次", async () => {
    let 第几次 = 0
    const { api, 记录 } = 假后端({
      list: () => {
        第几次++
        return 第几次 === 1 ? { kind: "rejected", message: "没有数据源配置权限" } : { kind: "ok", value: [行("s1")] }
      },
    })
    挂上(api)
    await 等到(() => 槽("data-source-error") !== null)
    expect(槽("data-source-error")?.getAttribute("role")).toBe("alert")
    expect(槽("data-source-error")?.textContent).toContain("没有数据源配置权限")

    点明("[data-slot='data-source-retry']")
    await 等到(() => 行们().length === 1)
    expect(记录.list).toBe(2)
    expect(槽("data-source-error")).toBeNull()
  })
})

describe("数据源 · 注册", () => {
  test("抽屉里没有密码框、没有「测试连接」；提交把非秘密字段与上游列表都交出去", async () => {
    const { api, 记录 } = 假后端({}, [行("s1", { name: "话单库" }), 行("s2", { name: "资金库" })])
    挂上(api)
    await 等到(() => 行们().length === 2)

    点明("[data-slot='data-source-create']")
    await 等到(() => 浮层开着("governance-drawer"))

    // 秘密字段不落库：抽屉里连口子都不开。
    expect(document.querySelector("[data-slot='governance-drawer'] input[type='password']")).toBeNull()
    // connector 未落地：不存在点了必然骗人的「测试连接」。
    const 按钮 = [...document.querySelectorAll<HTMLElement>("[data-slot='governance-drawer'] button")].map((el) =>
      el.textContent?.trim(),
    )
    expect(按钮).not.toContain("测试连接")

    输入("[data-slot='data-source-form-name']", "资金库")
    选下拉("data-source-form-kind", "file")
    选下拉("data-source-form-frequency", "weekly")
    输入("[data-slot='data-source-form-endpoint']", "/data/funds")
    输入("[data-slot='data-source-form-owner']", "经侦支队 李四")
    提交表单()

    await 等到(() => 记录.create.length === 1)
    expect(记录.create[0]).toEqual({
      name: "资金库",
      kind: "file",
      frequency: "weekly",
      owner: "经侦支队 李四",
      endpoint: "/data/funds",
      status: "active",
      upstreamIds: [],
    })
    await 等到(() => !浮层开着("governance-drawer"))
    await 等到(() => 记录.list === 2)
  })

  test("注册时勾上游 ⇒ upstreamIds 就是勾上的那个", async () => {
    const { api, 记录 } = 假后端({}, [行("s1", { name: "话单库" })])
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='data-source-create']")
    await 等到(() => 浮层开着("governance-drawer"))
    输入("[data-slot='data-source-form-name']", "资金库")

    const 勾 = 上游勾选("s1")
    if (!勾) throw new Error("没找到 s1 的上游勾选")
    勾.click()
    提交表单()

    await 等到(() => 记录.create.length === 1)
    expect(记录.create[0]?.upstreamIds).toEqual(["s1"])
  })

  test("保存被拒（409 撞名）⇒ 抽屉不关、错误留在抽屉里", async () => {
    const { api } = 假后端({ create: () => ({ kind: "rejected", message: "已有同名数据源「话单库」" }) })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='data-source-create']")
    await 等到(() => 浮层开着("governance-drawer"))
    输入("[data-slot='data-source-form-name']", "话单库")
    提交表单()

    await 等到(() => 槽("data-source-form-error") !== null)
    expect(槽("data-source-form-error")?.textContent).toContain("已有同名数据源")
    expect(浮层开着("governance-drawer")).toBe(true)
  })

  test("被拒且带 field ⇒ 对应输入框标 invalid", async () => {
    const { api } = 假后端({ create: () => ({ kind: "rejected", message: "数据源名称不能为空", field: "name" }) })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='data-source-create']")
    await 等到(() => 浮层开着("governance-drawer"))
    提交表单()

    await 等到(() => 槽("data-source-form-error") !== null)
    expect(document.querySelector("[data-slot='data-source-form-name'] input")?.getAttribute("aria-invalid")).toBe("true")
  })
})

describe("数据源 · 编辑", () => {
  const 两条上游 = () => [
    行("s1", { name: "话单库", kind: "database" }),
    行("s2", { name: "资金库", kind: "file" }),
  ]

  test("编辑：预填原值与已登记的上游；没动勾选 ⇒ patch 里没有 upstreamIds", async () => {
    const { api, 记录 } = 假后端(
      {
        lineage: (id) => ({
          kind: "ok",
          value: {
            source: 行(id),
            upstream: [{ id: "s1", name: "话单库", kind: "database", status: "active" }],
            downstream: [],
          },
        }),
      },
      两条上游(),
    )
    挂上(api)
    await 等到(() => 行们().length === 2)

    点明("[data-slot='data-source-row'][data-id='s2'] [data-slot='data-source-edit']")
    await 等到(() => 浮层开着("governance-drawer"))
    expect(字段值("[data-slot='data-source-form-name']")).toBe("资金库")
    await 等到(() => 上游勾选("s1")?.checked === true)
    // 自己不在可选上游里。
    expect(上游勾选("s2")).toBeNull()

    输入("[data-slot='data-source-form-owner']", "经侦支队 王五")
    提交表单()

    await 等到(() => 记录.update.length === 1)
    expect(记录.update[0]).toEqual({
      id: "s2",
      patch: {
        name: "资金库",
        kind: "file",
        frequency: "daily",
        owner: "经侦支队 王五",
        endpoint: "pg://10.0.0.8:5432/cdr",
        status: "active",
      },
    })
  })

  test("编辑：取消勾选后提交 ⇒ upstreamIds 为空数组（清空）", async () => {
    const { api, 记录 } = 假后端(
      {
        lineage: (id) => ({
          kind: "ok",
          value: {
            source: 行(id),
            upstream: [{ id: "s1", name: "话单库", kind: "database", status: "active" }],
            downstream: [],
          },
        }),
      },
      两条上游(),
    )
    挂上(api)
    await 等到(() => 行们().length === 2)

    点明("[data-slot='data-source-row'][data-id='s2'] [data-slot='data-source-edit']")
    await 等到(() => 上游勾选("s1")?.checked === true)
    上游勾选("s1")!.click()
    提交表单()

    await 等到(() => 记录.update.length === 1)
    expect(记录.update[0]?.patch.upstreamIds).toEqual([])
  })

  test("旧的预填回包晚到时不覆盖用户已改的勾选（代次守卫）", async () => {
    let 放旧: ((out: DataSourceOutcome<DataSourceLineage>) => void) | undefined
    const { api, 记录 } = 假后端(
      {
        lineage: () => new Promise((resolve) => (放旧 = resolve)),
      },
      两条上游(),
    )
    挂上(api)
    await 等到(() => 行们().length === 2)

    点明("[data-slot='data-source-row'][data-id='s2'] [data-slot='data-source-edit']")
    await 等到(() => 浮层开着("governance-drawer"))
    上游勾选("s1")?.click()
    await 等到(() => 上游勾选("s1")?.checked === true)

    放旧?.({
      kind: "ok",
      value: {
        source: 行("s2"),
        upstream: [{ id: "s9", name: "旧上游", kind: "api", status: "active" }],
        downstream: [],
      },
    })
    await 歇一拍()

    // 用户已经动过勾选：晚到的预填整包丢掉——交出去的只能是用户勾的 s1，不能掺进 s9、也不能被冲回空。
    expect(上游勾选("s1")?.checked).toBe(true)
    提交表单()
    await 等到(() => 记录.update.length === 1)
    expect(记录.update[0]?.patch.upstreamIds).toEqual(["s1"])
  })
})

describe("数据源 · 血缘", () => {
  test("打开即按 id 拉血缘：上游 / 本数据源 / 下游三段都在", async () => {
    const { api, 记录 } = 假后端({
      lineage: (id) => ({
        kind: "ok",
        value: {
          source: 行(id, { name: "话单汇总" }),
          upstream: [{ id: "s1", name: "话单库", kind: "database", status: "active" }],
          downstream: [{ id: "s3", name: "研判看板", kind: "api", status: "disabled" }],
        },
      }),
    })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='data-source-lineage']")
    await 等到(() => 槽("lineage-body") !== null)

    expect(记录.lineage).toEqual(["s1"])
    expect(槽("lineage-source")?.textContent).toContain("话单汇总")
    expect(槽("lineage-upstream-node")?.textContent).toContain("话单库")
    expect(槽("lineage-upstream-node")?.textContent).toContain("数据库")
    expect(槽("lineage-downstream-node")?.textContent).toContain("研判看板")
    expect(槽("lineage-downstream-node")?.textContent).toContain("接口")
    expect(槽("lineage-empty")).toBeNull()
  })

  test("上游、下游都为空 ⇒ 明说「尚未登记血缘」", async () => {
    const { api } = 假后端()
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='data-source-lineage']")
    await 等到(() => 槽("lineage-body") !== null)

    expect(槽("lineage-empty")?.textContent).toContain("尚未登记血缘")
    expect(槽("lineage-upstream")).toBeNull()
    expect(槽("lineage-downstream")).toBeNull()
  })

  test("血缘拉取失败 ⇒ 错误留在框里，重试能再拉", async () => {
    let 第几次 = 0
    const { api } = 假后端({
      lineage: (id) => {
        第几次++
        return 第几次 === 1
          ? { kind: "rejected", message: "数据源不存在" }
          : { kind: "ok", value: { source: 行(id), upstream: [], downstream: [] } }
      },
    })
    挂上(api)
    await 等到(() => 行们().length === 1)

    点明("[data-slot='data-source-lineage']")
    await 等到(() => 槽("lineage-error") !== null)
    expect(槽("lineage-error")?.getAttribute("role")).toBe("alert")
    expect(槽("lineage-error")?.textContent).toContain("数据源不存在")

    点明("[data-slot='lineage-retry']")
    await 等到(() => 槽("lineage-body") !== null)
    expect(槽("lineage-empty")?.textContent).toContain("尚未登记血缘")
  })
})
