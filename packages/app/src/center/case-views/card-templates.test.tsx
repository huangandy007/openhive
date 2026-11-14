import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { CardTemplates } from "./card-templates"
import type { CaseTemplateApi, 模板行, 模板词表 } from "../../project/case-template-api"
import type { CaseMaterialsApi } from "../../project/case-materials-api"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
afterEach(() => {
  document.body.innerHTML = ""
})

async function 等(条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}

/** 让 promise 的微任务落地：用于断言「迟到的响应不得改写界面」。 */
const 让一拍 = () => new Promise((resolve) => setTimeout(resolve, 30))

/** 浮层内容在 Kobalte Portal 里 ⇒ 查 `document.body`。 */
const 找 = (槽名: string) => document.body.querySelector<HTMLElement>(`[data-slot='${槽名}']`)

/** 打开 `SelectV2`：Kobalte Trigger 只在 `pointerdown`（主键、非 touch）时开（`#006-37`）。 */
function 开下拉(触发器: HTMLElement) {
  触发器.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))
}

const 菜单项们 = () => [...document.body.querySelectorAll<HTMLElement>("[data-slot='menu-v2-item-content']")]

async function 点选项(文字: string) {
  await 等(() => 菜单项们().some((项) => (项.textContent ?? "").includes(文字)))
  const 项 = 菜单项们().find((项) => (项.textContent ?? "").includes(文字))
  if (项 === undefined) throw new Error(`没找到菜单项：${文字}`)
  项.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

const 行们: 模板行[] = [
  { id: "用户:1", name: "通话模板", event_type: "通话", slots: {}, required: ["谁"], version: 1, verified_at: 100, hit_count: 12, disabled_at: null },
  { id: "用户:2", name: "订餐模板", event_type: "消费", slots: {}, required: ["谁"], version: 1, verified_at: null, hit_count: 0, disabled_at: null },
  { id: "内置:资金/v1", name: "资金（内置）", event_type: "资金交易", slots: {}, required: ["谁"], version: 1, verified_at: 100, hit_count: 3, disabled_at: null },
  { id: "用户:3", name: "旧模板", event_type: "见面", slots: {}, required: ["谁"], version: 1, verified_at: null, hit_count: 0, disabled_at: 200 },
]

/**
 * 忠实服务端语义：`含停用 !== true` 时不回停用行
 * （`case-card-template-store.ts` 的 `and (含停用 is true or disabled_at is null)`）。
 * 替身必须这样，否则「列表忘了传 true」的缺陷在用例里是假绿（C1）。
 */
const 按含停用 = (行: readonly 模板行[], 含停用?: boolean): 模板行[] =>
  含停用 === true ? [...行] : 行.filter((项) => 项.disabled_at === null)

function 假api(over: Partial<CaseTemplateApi> = {}): CaseTemplateApi {
  return {
    list: async (_projectId, 含停用) => ({ kind: "ok", value: 按含停用(行们, 含停用) }),
    vocab: async () => ({ kind: "error", message: "本用例不取词表" }),
    create: async () => ({ kind: "error", message: "本用例不建" }),
    update: async () => ({ kind: "error", message: "本用例不改" }),
    disable: async () => ({ kind: "ok", value: { ok: true } }),
    restore: async () => ({ kind: "ok", value: { ok: true } }),
    preview: async () => ({ kind: "error", message: "本用例不预览" }),
    verify: async () => ({ kind: "error", message: "本用例不转正" }),
    ...over,
  }
}

const 材料api: CaseMaterialsApi = {
  read: async () => ({
    kind: "ok",
    value: {
      materials: [
        { id: "m-1", path: "材料/话单.xlsx", kind: "话单", status: "已解析", detail: null, queueAhead: 0, factCount: 0, numberCount: 0, parseable: true },
        { id: "m-2", path: "材料/未解析.xlsx", kind: "话单", status: "有问题", detail: null, queueAhead: 0, factCount: 0, numberCount: 0, parseable: true },
      ],
      parseableExtensions: [".xlsx"],
    },
  }),
  parse: async () => ({ kind: "error", message: "本用例不解析" }),
}

const 无材料api: CaseMaterialsApi = {
  read: async () => ({ kind: "ok", value: { materials: [], parseableExtensions: [".xlsx"] } }),
  parse: async () => ({ kind: "error", message: "本用例不解析" }),
}

const 词表: 模板词表 = {
  槽们: ["谁", "和谁", "何时", "何时止", "何地", "多少钱", "其他"],
  事件类型们: [{ 值: "通话", 可选: true }],
  字段们: [
    { 值: "caller", 显示名: "主叫号码", 种类: "号码" },
    { 值: "callee", 显示名: "被叫号码", 种类: "号码" },
  ],
  槽可选字段们: { 谁: ["caller", "callee"], 和谁: ["caller", "callee"], 何时: [], 何时止: [], 何地: [], 多少钱: [], 其他: [] },
  其他不可选种类: [],
  角色们: [{ 值: "主体", 地点类: false }, { 值: "对方", 地点类: false }],
  默认角色: { 谁: "主体", 和谁: "对方", 何地: "地点" },
  实体类型们: ["人", "号码"],
  必填恒含: "谁",
}

const 新行: 模板行 = {
  id: "用户:9",
  name: "新模板",
  event_type: "通话",
  slots: { 谁: { 字段: "caller", 角色: "主体" } },
  required: ["谁"],
  version: 1,
  verified_at: null,
  hit_count: 0,
  disabled_at: null,
}

describe("卡片模板列表", () => {
  test("分组：我的 / 内置（内置只读，只有「查看」）；停用默认折叠；列表请求必须含停用", async () => {
    const 列表参数: Array<boolean | undefined> = []
    const api = 假api({
      list: async (_projectId, 含停用) => {
        列表参数.push(含停用)
        return { kind: "ok", value: 按含停用(行们, 含停用) }
      },
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    // C1：不带 `含停用: true` 时服务端不回停用行，恢复入口在生产上永远不可达。
    expect(列表参数[0]).toBe(true)

    const 我的 = host.querySelector("[data-slot='card-templates-group'][data-group='mine']")!
    const 内置 = host.querySelector("[data-slot='card-templates-group'][data-group='builtin']")!
    expect(我的.textContent).toContain("通话模板")
    expect(我的.textContent).not.toContain("资金（内置）")
    expect(内置.textContent).toContain("资金（内置）")
    // 精确断言状态文字：`toContain("内置")` 会被分组标题「内置模板（只读）」满足。
    const 内置状态 = 内置.querySelector("[data-slot='card-template-item'] [data-slot='card-template-status']")!
    expect(内置状态.textContent).toBe("内置")
    expect(内置状态.getAttribute("data-state")).toBe("内置")
    expect(内置.querySelector("[data-slot='card-template-edit']")).toBeNull()
    expect(内置.querySelector("[data-slot='card-template-disable']")).toBeNull()
    expect(内置.querySelector("[data-slot='card-template-verify']")).toBeNull()
    expect(内置.querySelector("[data-slot='card-template-view']")).not.toBeNull()

    const 状态们 = [...我的.querySelectorAll("[data-slot='card-template-status']")].map((项) => 项.textContent)
    expect(状态们).toContain("已验证")
    expect(状态们).toContain("未验证")

    expect(host.querySelector("[data-slot='card-templates-disabled']")).toBeNull()
    ;(host.querySelector("[data-slot='card-templates-disabled-toggle']") as HTMLButtonElement).click()
    await 等(() => host.querySelector("[data-slot='card-templates-disabled']") !== null)
    expect(host.querySelector("[data-slot='card-templates-disabled']")!.textContent).toContain("旧模板")
  })

  test("转正：确认框带材料（只列已解析），400 原样展示 error 与跳过；成功后刷新列表", async () => {
    const 调用: Array<{ projectId: string; id: string; materialId: string }> = []
    let 列表次数 = 0
    let 次数 = 0
    const api = 假api({
      list: async (_projectId, 含停用) => {
        列表次数 += 1
        return { kind: "ok", value: 按含停用(行们, 含停用) }
      },
      verify: async (input) => {
        调用.push(input)
        次数 += 1
        return 次数 === 1
          ? {
              kind: "error",
              message: "预览没有产出任何卡片：请检查必填槽与数据",
              code: "preview_failed",
              跳过: { "缺少「谁」": 20 },
            }
          : { kind: "ok", value: { verified_at: 123, 卡片数: 3, 跳过: {} } }
      },
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    ;(host.querySelector("[data-slot='card-template-verify']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    // 材料下拉只该含「已解析」那一份（值由 confirm 里 SelectV2 的 current 决定）
    expect(找("card-template-confirm")!.textContent).toContain("话单.xlsx")
    expect(找("card-template-confirm")!.textContent).not.toContain("未解析.xlsx")
    // 触发器只显示 current，选项表要展开才看得见——只断言触发器文字会漏掉「已停用材料仍在选项里」。
    const 材料触发器 = 找("card-template-confirm")!.querySelector<HTMLElement>("[data-component='select-v2']")!
    开下拉(材料触发器)
    await 等(() => 菜单项们().length > 0)
    const 选项文字们 = 菜单项们().map((项) => 项.textContent ?? "")
    expect(选项文字们.some((文字) => 文字.includes("话单.xlsx"))).toBe(true)
    expect(选项文字们.some((文字) => 文字.includes("未解析.xlsx"))).toBe(false)
    // 再点一次关下拉：Kobalte 的 `toggle` 已把逻辑状态置为 closed（触发器带 `data-closed`），
    // 但 happy-dom 里 Presence 不卸载菜单节点——**不能**等 `menu-v2-item-content` 消失（会超时）。
    开下拉(材料触发器)
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm-error") !== null)
    expect(找("card-template-confirm-error")!.textContent).toContain("预览没有产出任何卡片")
    expect(找("card-template-confirm-skip")!.textContent).toContain("缺少「谁」 20")
    expect(调用).toEqual([{ projectId: "p-1", id: "用户:2", materialId: "m-1" }])

    const 前 = 列表次数
    // 第二次确认：仍是一次请求（不是把上次的请求重放）。
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") === null)
    await 等(() => 列表次数 > 前)
    expect(调用.length).toBe(2)
    expect(host.querySelector("[data-slot='card-templates-notice']")!.textContent).toContain("已转正")
  })

  test("停用 → 恢复：二次确认原文里说「可随时恢复」；恢复冲突原样展示内核中文", async () => {
    const 停用: string[] = []
    const 恢复: string[] = []
    const api = 假api({
      disable: async (input) => {
        停用.push(input.id)
        return { kind: "ok", value: { ok: true } }
      },
      restore: async (input) => {
        恢复.push(input.id)
        return { kind: "error", message: "同类型下已有启用中的用户模板；请先停用旧模板再恢复", code: "conflict" }
      },
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)

    ;(host.querySelector("[data-slot='card-template-disable']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    expect(找("card-template-confirm")!.textContent).toContain("可随时恢复")
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") === null)
    expect(停用).toEqual(["用户:1"])

    ;(host.querySelector("[data-slot='card-templates-disabled-toggle']") as HTMLButtonElement).click()
    await 等(() => host.querySelector("[data-slot='card-template-restore']") !== null)
    ;(host.querySelector("[data-slot='card-template-restore']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm-error") !== null)
    expect(找("card-template-confirm-error")!.textContent).toContain("请先停用旧模板再恢复")
    expect(恢复).toEqual(["用户:3"])
  })

  test("新建：抽屉打开；词表失败原样展示（列表不替它编）", async () => {
    const host = mount(() => <CardTemplates projectId="p-1" api={假api()} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    ;(host.querySelector("[data-slot='card-templates-create']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-vocab-error") !== null)
    expect(找("card-template-vocab-error")!.textContent).toContain("本用例不取词表")
  })

  test("保存成功：提示出现、列表重拉，不抛 Stale read（C2）", async () => {
    let 列表次数 = 0
    const api = 假api({
      list: async (_projectId, 含停用) => {
        列表次数 += 1
        return { kind: "ok", value: 按含停用(行们, 含停用) }
      },
      vocab: async () => ({ kind: "ok", value: 词表 }),
      create: async () => ({ kind: "ok", value: 新行 }),
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    ;(host.querySelector("[data-slot='card-templates-create']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-name-field") !== null)

    const 名称框 = 找("card-template-name-field")!.querySelector<HTMLInputElement>("input")!
    名称框.value = "新模板"
    名称框.dispatchEvent(new Event("input", { bubbles: true }))
    const 事件触发器 = () => 找("card-template-event-field")!.querySelector<HTMLElement>("[data-component='select-v2']")!
    开下拉(事件触发器())
    await 点选项("通话")
    await 等(() => (事件触发器().textContent ?? "").includes("通话"))
    const 谁触发器 = () =>
      document.body.querySelector<HTMLElement>(
        "[data-slot='card-template-slot'][data-slot-name='谁'] [data-component='select-v2']",
      )!
    开下拉(谁触发器())
    await 点选项("主叫号码")

    await 等(() => !(找("card-template-save") as HTMLButtonElement).disabled)
    const 前 = 列表次数
    ;(找("card-template-save") as HTMLButtonElement).click()
    // 旧写法在 `设抽屉(undefined)` 之后读 `状()` → `Stale read from <Show>.`，这两条都会超时。
    await 等(() => host.querySelector("[data-slot='card-templates-notice']") !== null)
    expect(host.querySelector("[data-slot='card-templates-notice']")!.textContent).toContain("已新建")
    await 等(() => 列表次数 > 前)
  })

  test("乱序读：慢的旧响应不得覆盖新列表（I1）", async () => {
    type 列表回包 = Awaited<ReturnType<CaseTemplateApi["list"]>>
    const 等待们: Array<(回: 列表回包) => void> = []
    let 列表次数 = 0
    const api = 假api({
      list: async (_projectId, 含停用) => {
        列表次数 += 1
        if (列表次数 === 1) return { kind: "ok", value: 按含停用(行们, 含停用) }
        return new Promise<列表回包>((resolve) => {
          等待们.push(resolve)
        })
      },
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    const 我的区 = () => host.querySelector("[data-slot='card-templates-group'][data-group='mine']")!

    // 第一次停用（用户:1）成功后触发慢读 #2。
    ;(host.querySelector("[data-slot='card-template-disable']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 等待们.length === 1)

    // 慢读在途时再停用用户:2（列表还是旧的，两条都在「我的」），触发快读 #3。
    const 停用按钮们 = [...host.querySelectorAll<HTMLButtonElement>("[data-slot='card-template-disable']")]
    停用按钮们[1]!.click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 等待们.length === 2)

    const 只停了一 = 行们.map((行) => (行.id === "用户:1" ? { ...行, disabled_at: 300 } : 行))
    const 两个都停 = 只停了一.map((行) => (行.id === "用户:2" ? { ...行, disabled_at: 300 } : 行))
    // 快读先回：两条都不在「我的」。
    等待们[1]!({ kind: "ok", value: 按含停用(两个都停, true) })
    await 等(() => !(我的区().textContent ?? "").includes("订餐模板"))
    // 慢读后回（旧快照）：若无代次守卫，会把用户:2 塞回「我的」。
    等待们[0]!({ kind: "ok", value: 按含停用(只停了一, true) })
    await 让一拍()
    expect(我的区().textContent).not.toContain("订餐模板")
  })

  test("在途确认换了目标：旧响应不得写进新确认框（I1）", async () => {
    type 转正回包 = Awaited<ReturnType<CaseTemplateApi["verify"]>>
    const 转正等待: Array<(回: 转正回包) => void> = []
    const api = 假api({
      verify: async () =>
        new Promise<转正回包>((resolve) => {
          转正等待.push(resolve)
        }),
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)

    ;(host.querySelector("[data-slot='card-template-verify']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 转正等待.length === 1)
    // 取消在途的转正，改开「停用」确认框。
    ;(找("card-template-confirm-cancel") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") === null)
    ;(host.querySelector("[data-slot='card-template-disable']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)

    转正等待[0]!({ kind: "error", message: "旧响应不该写进新框", code: "conflict" })
    await 让一拍()
    expect(找("card-template-confirm")).not.toBeNull()
    expect(找("card-template-confirm")!.textContent).not.toContain("旧响应不该写进新框")
  })

  test("取消确认不发任何请求（I2）", async () => {
    const 调用: string[] = []
    const api = 假api({
      disable: async () => {
        调用.push("disable")
        return { kind: "ok", value: { ok: true } }
      },
      restore: async () => {
        调用.push("restore")
        return { kind: "ok", value: { ok: true } }
      },
      verify: async () => {
        调用.push("verify")
        return { kind: "ok", value: { verified_at: 1, 卡片数: 0, 跳过: {} } }
      },
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)

    // 转正
    ;(host.querySelector("[data-slot='card-template-verify']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-cancel") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") === null)
    // 停用
    ;(host.querySelector("[data-slot='card-template-disable']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-cancel") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") === null)
    // 恢复
    ;(host.querySelector("[data-slot='card-templates-disabled-toggle']") as HTMLButtonElement).click()
    await 等(() => host.querySelector("[data-slot='card-template-restore']") !== null)
    ;(host.querySelector("[data-slot='card-template-restore']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-cancel") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") === null)

    expect(调用).toEqual([])
  })

  test("停用成功后行从「我的」迁到「已停用」（I2，替身随操作变化）", async () => {
    let 当前行们 = 行们
    const api = 假api({
      list: async (_projectId, 含停用) => ({ kind: "ok", value: 按含停用(当前行们, 含停用) }),
      disable: async (input) => {
        当前行们 = 当前行们.map((行) => (行.id === input.id ? { ...行, disabled_at: 999 } : 行))
        return { kind: "ok", value: { ok: true } }
      },
    })
    const host = mount(() => <CardTemplates projectId="p-1" api={api} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    const 我的区 = () => host.querySelector("[data-slot='card-templates-group'][data-group='mine']")!
    expect(我的区().textContent).toContain("通话模板")

    ;(host.querySelector("[data-slot='card-template-disable']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    ;(找("card-template-confirm-ok") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") === null)
    await 等(() => !(我的区().textContent ?? "").includes("通话模板"))
    expect(host.querySelector("[data-slot='card-templates-notice']")!.textContent).toContain("已停用")

    ;(host.querySelector("[data-slot='card-templates-disabled-toggle']") as HTMLButtonElement).click()
    await 等(() => host.querySelector("[data-slot='card-templates-disabled']") !== null)
    expect(host.querySelector("[data-slot='card-templates-disabled']")!.textContent).toContain("通话模板")
  })

  test("无已解析材料：转正确认给出提示，确认按钮置灰（Minor）", async () => {
    const host = mount(() => <CardTemplates projectId="p-1" api={假api()} 材料api={无材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    ;(host.querySelector("[data-slot='card-template-verify']") as HTMLButtonElement).click()
    await 等(() => 找("card-template-confirm") !== null)
    expect(找("card-template-confirm-nomaterial")!.textContent).toContain("先导入并解析材料")
    expect((找("card-template-confirm-ok") as HTMLButtonElement).disabled).toBe(true)
  })
})
