import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { CardTemplates } from "./card-templates"
import type { CaseTemplateApi, 模板行 } from "../../project/case-template-api"
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

const 行们: 模板行[] = [
  { id: "用户:1", name: "通话模板", event_type: "通话", slots: {}, required: ["谁"], version: 1, verified_at: 100, hit_count: 12, disabled_at: null },
  { id: "用户:2", name: "订餐模板", event_type: "消费", slots: {}, required: ["谁"], version: 1, verified_at: null, hit_count: 0, disabled_at: null },
  { id: "内置:资金/v1", name: "资金（内置）", event_type: "资金交易", slots: {}, required: ["谁"], version: 1, verified_at: 100, hit_count: 3, disabled_at: null },
  { id: "用户:3", name: "旧模板", event_type: "见面", slots: {}, required: ["谁"], version: 1, verified_at: null, hit_count: 0, disabled_at: 200 },
]

function 假api(over: Partial<CaseTemplateApi> = {}): CaseTemplateApi {
  return {
    list: async () => ({ kind: "ok", value: 行们 }),
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

describe("卡片模板列表", () => {
  test("分组：我的 / 内置（内置只读，只有「查看」）；停用默认折叠", async () => {
    const host = mount(() => <CardTemplates projectId="p-1" api={假api()} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    const 我的 = host.querySelector("[data-slot='card-templates-group'][data-group='mine']")!
    const 内置 = host.querySelector("[data-slot='card-templates-group'][data-group='builtin']")!
    expect(我的.textContent).toContain("通话模板")
    expect(我的.textContent).not.toContain("资金（内置）")
    expect(内置.textContent).toContain("资金（内置）")
    expect(内置.textContent).toContain("内置")
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
      list: async () => {
        列表次数 += 1
        return { kind: "ok", value: 行们 }
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
    await 等(() => document.body.querySelector("[data-slot='card-template-confirm']") !== null)
    // 材料下拉只该含「已解析」那一份（值由 confirm 里 SelectV2 的 current 决定）
    expect(document.body.querySelector("[data-slot='card-template-confirm']")!.textContent).toContain("话单.xlsx")
    expect(document.body.querySelector("[data-slot='card-template-confirm']")!.textContent).not.toContain("未解析.xlsx")
    // 触发器只显示 current，选项表要展开才看得见——只断言触发器文字会漏掉「已停用材料仍在选项里」。
    const 材料触发器 = document.body.querySelector<HTMLElement>(
      "[data-slot='card-template-confirm'] [data-component='select-v2']",
    )!
    材料触发器.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))
    await 等(() => document.body.querySelectorAll("[data-slot='menu-v2-item-content']").length > 0)
    const 选项文字们 = [...document.body.querySelectorAll("[data-slot='menu-v2-item-content']")].map((项) => 项.textContent ?? "")
    expect(选项文字们.some((文字) => 文字.includes("话单.xlsx"))).toBe(true)
    expect(选项文字们.some((文字) => 文字.includes("未解析.xlsx"))).toBe(false)
    // 再点一次关下拉：Kobalte 的 `toggle` 已把逻辑状态置为 closed（触发器带 `data-closed`），
    // 但 happy-dom 里 Presence 不卸载菜单节点——**不能**等 `menu-v2-item-content` 消失（会超时）。
    材料触发器.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))
    ;(document.body.querySelector("[data-slot='card-template-confirm-ok']") as HTMLButtonElement).click()
    await 等(() => document.body.querySelector("[data-slot='card-template-confirm-error']") !== null)
    expect(document.body.querySelector("[data-slot='card-template-confirm-error']")!.textContent).toContain("预览没有产出任何卡片")
    expect(document.body.querySelector("[data-slot='card-template-confirm-skip']")!.textContent).toContain("缺少「谁」 20")
    expect(调用).toEqual([{ projectId: "p-1", id: "用户:2", materialId: "m-1" }])

    const 前 = 列表次数
    ;(document.body.querySelector("[data-slot='card-template-confirm-ok']") as HTMLButtonElement).click()
    await 等(() => document.body.querySelector("[data-slot='card-template-confirm']") === null)
    await 等(() => 列表次数 > 前)
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
    await 等(() => document.body.querySelector("[data-slot='card-template-confirm']") !== null)
    expect(document.body.querySelector("[data-slot='card-template-confirm']")!.textContent).toContain("可随时恢复")
    ;(document.body.querySelector("[data-slot='card-template-confirm-ok']") as HTMLButtonElement).click()
    await 等(() => document.body.querySelector("[data-slot='card-template-confirm']") === null)
    expect(停用).toEqual(["用户:1"])

    ;(host.querySelector("[data-slot='card-templates-disabled-toggle']") as HTMLButtonElement).click()
    await 等(() => host.querySelector("[data-slot='card-template-restore']") !== null)
    ;(host.querySelector("[data-slot='card-template-restore']") as HTMLButtonElement).click()
    await 等(() => document.body.querySelector("[data-slot='card-template-confirm']") !== null)
    ;(document.body.querySelector("[data-slot='card-template-confirm-ok']") as HTMLButtonElement).click()
    await 等(() => document.body.querySelector("[data-slot='card-template-confirm-error']") !== null)
    expect(document.body.querySelector("[data-slot='card-template-confirm-error']")!.textContent).toContain(
      "请先停用旧模板再恢复",
    )
    expect(恢复).toEqual(["用户:3"])
  })

  test("新建：抽屉打开；词表失败原样展示（列表不替它编）", async () => {
    const host = mount(() => <CardTemplates projectId="p-1" api={假api()} 材料api={材料api} />)
    await 等(() => host.querySelectorAll("[data-slot='card-template-item']").length > 0)
    ;(host.querySelector("[data-slot='card-templates-create']") as HTMLButtonElement).click()
    await 等(() => document.body.querySelector("[data-slot='card-template-vocab-error']") !== null)
    expect(document.body.querySelector("[data-slot='card-template-vocab-error']")!.textContent).toContain("本用例不取词表")
  })
})
