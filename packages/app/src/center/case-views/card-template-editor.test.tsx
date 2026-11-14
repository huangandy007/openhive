import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { CardTemplateEditor } from "./card-template-editor"
import type { CaseTemplateApi, 模板行, 模板词表 } from "../../project/case-template-api"
import type { 材料视图 } from "../../project/case-materials-api"

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

/** 浮层内容在 Kobalte Portal 里 ⇒ 查 `document.body`，不是 mount 的 host（见 Task 5 的坑表）。 */
const 找 = (槽名: string) => document.body.querySelector<HTMLElement>(`[data-slot='${槽名}']`)

const 词表: 模板词表 = {
  槽们: ["谁", "和谁", "何时", "何时止", "何地", "多少钱", "其他"],
  事件类型们: [
    { 值: "通话", 可选: true },
    { 值: "资金交易", 可选: false, 原因: "资金交易由方向算法负责、住宿由区间合并负责，不能建用户模板" },
  ],
  字段们: [
    { 值: "caller", 显示名: "主叫号码", 种类: "号码" },
    { 值: "callee", 显示名: "被叫号码", 种类: "号码" },
    { 值: "startedAt", 显示名: "时间", 种类: "时间" },
  ],
  槽可选字段们: { 谁: ["caller", "callee"], 和谁: ["caller", "callee"], 何时: ["startedAt"], 何时止: ["startedAt"], 何地: [], 多少钱: [], 其他: [] },
  其他不可选种类: ["金额", "时间", "方向"],
  角色们: [{ 值: "主体", 地点类: false }, { 值: "对方", 地点类: false }],
  默认角色: { 谁: "主体", 和谁: "对方", 何地: "地点" },
  实体类型们: ["人", "号码"],
  必填恒含: "谁",
}

const 有效行: 模板行 = {
  id: "用户:1",
  name: "通话",
  event_type: "通话",
  slots: { 谁: { 字段: "caller", 角色: "主叫" } },
  required: ["谁"],
  version: 1,
  verified_at: null,
  hit_count: 0,
  disabled_at: null,
}

const 已解析材料: 材料视图 = {
  id: "m-1",
  path: "材料/话单.xlsx",
  kind: "话单",
  status: "已解析",
  detail: null,
  queueAhead: 0,
  factCount: 0,
  numberCount: 0,
  parseable: true,
}

function 假api(over: Partial<CaseTemplateApi> = {}): CaseTemplateApi {
  return {
    list: async () => ({ kind: "error", message: "本用例不列" }),
    vocab: async () => ({ kind: "ok", value: 词表 }),
    create: async () => ({ kind: "error", message: "本用例不建" }),
    update: async () => ({ kind: "error", message: "本用例不改" }),
    disable: async () => ({ kind: "error", message: "本用例不停用" }),
    restore: async () => ({ kind: "error", message: "本用例不恢复" }),
    preview: async () => ({ kind: "error", message: "本用例不预览" }),
    verify: async () => ({ kind: "error", message: "本用例不转正" }),
    ...over,
  }
}

describe("抽屉编辑器", () => {
  test("新建空态：保存置灰 + 三条即时校验；「谁」勾死不可取消；不可选类型带原因", async () => {
    mount(() => <CardTemplateEditor projectId="p-1" api={假api()} 材料们={[]} onClose={() => {}} onSaved={() => {}} />)
    await 等(() => 找("card-template-name") !== null)

    expect((找("card-template-save") as HTMLButtonElement).disabled).toBe(true)
    const 校验 = 找("card-template-editor-validation")!
    expect(校验.textContent).toContain("请填写模板名称")
    expect(校验.textContent).toContain("请选择事件类型")
    expect(校验.textContent).toContain("「谁」必须选一个字段")

    const 谁框 = document.body.querySelector<HTMLInputElement>(
      "[data-slot='card-template-required'][data-slot-name='谁'] input",
    )!
    expect(谁框.checked).toBe(true)
    expect(谁框.disabled).toBe(true)
    expect(找("card-template-event-hint")!.textContent).toContain("不能建用户模板")
  })

  test("修改已验证模板：常驻「回到未验证」；保存走 update，收到定义体", async () => {
    const 收到: Array<Record<string, unknown>> = []
    let 已保存 = false
    const api = 假api({
      update: async (input) => {
        收到.push(input as unknown as Record<string, unknown>)
        return { kind: "ok", value: { ...有效行, verified_at: null } }
      },
    })
    mount(() => (
      <CardTemplateEditor
        projectId="p-1"
        api={api}
        行={{ ...有效行, verified_at: 100 }}
        材料们={[]}
        onClose={() => {}}
        onSaved={() => {
          已保存 = true
        }}
      />
    ))
    await 等(() => 找("card-template-verified-warning") !== null)
    expect(找("card-template-verified-warning")!.textContent).toContain("回到未验证")
    ;(找("card-template-save") as HTMLButtonElement).click()
    await 等(() => 收到.length === 1)
    expect(收到[0]?.id).toBe("用户:1")
    expect(收到[0]?.eventType).toBe("通话")
    expect(收到[0]?.required).toEqual(["谁"])
    await 等(() => 已保存)
  })

  test("只读查看内置模板：没有保存 / 预览按钮", async () => {
    mount(() => (
      <CardTemplateEditor
        projectId="p-1"
        api={假api()}
        行={{ ...有效行, id: "内置:资金/v1", name: "资金（内置）" }}
        只读
        材料们={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    ))
    await 等(() => 找("card-template-name") !== null)
    expect(找("card-template-save")).toBeNull()
    expect(找("card-template-preview-button")).toBeNull()
  })

  test("无已解析材料：预览置灰并说下一步；保存失败原样展示服务端中文 + 可去列表", async () => {
    const api = 假api({
      update: async () => ({
        kind: "error",
        message: "同类型下已有启用中的用户模板；请先停用旧模板再新建",
        code: "conflict",
      }),
    })
    mount(() => (
      <CardTemplateEditor projectId="p-1" api={api} 行={有效行} 材料们={[]} onClose={() => {}} onSaved={() => {}} />
    ))
    await 等(() => 找("card-template-preview-button") !== null)
    expect((找("card-template-preview-button") as HTMLButtonElement).disabled).toBe(true)
    expect(找("card-template-preview-nomaterial")!.textContent).toContain("先导入并解析材料")
    ;(找("card-template-save") as HTMLButtonElement).click()
    await 等(() => 找("card-template-editor-error") !== null)
    expect(找("card-template-editor-error")!.textContent).toContain("同类型下已有启用中的用户模板")
    expect(找("card-template-editor-goto-list")).not.toBeNull()
  })

  test("预览草稿：不必先保存；结果区出现，卡片数/跳过原样", async () => {
    const 收到: Array<Record<string, unknown>> = []
    const api = 假api({
      preview: async (input) => {
        收到.push(input as unknown as Record<string, unknown>)
        return {
          kind: "ok",
          value: {
            卡片数: 1,
            跳过: { "缺少「谁」": 2 },
            工作表们: [{ sheet: "Sheet1", 卡片数: 1, 跳过: {} }],
            卡片们: [
              {
                id: "预览:1",
                type: "通话",
                摘要: "通话：13800000001",
                occurredAt: null,
                occurredRaw: null,
                precision: "日",
                occurredEnd: null,
                amount: null,
                currency: "CNY",
                attrs: {},
                参与者们: [],
                出处: { sheet: "Sheet1", rowNo: 2 },
              },
            ],
          },
        }
      },
    })
    mount(() => (
      <CardTemplateEditor
        projectId="p-1"
        api={api}
        行={有效行}
        材料们={[已解析材料]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    ))
    await 等(() => 找("card-template-preview-button") !== null)
    ;(找("card-template-preview-button") as HTMLButtonElement).click()
    await 等(() => 找("card-template-preview") !== null)
    expect(收到[0]?.materialId).toBe("m-1")
    expect((收到[0]?.template as { name: string }).name).toBe("通话")
    expect(找("card-template-preview-summary")!.textContent).toContain("缺少「谁」 2")
  })

  test("预览后改名称：结果区置灰并提示重新预览；保存仍可用（预览不是保存前置）", async () => {
    const api = 假api({
      preview: async () => ({
        kind: "ok",
        value: {
          卡片数: 1,
          跳过: { "缺少「谁」": 2 },
          工作表们: [{ sheet: "Sheet1", 卡片数: 1, 跳过: {} }],
          卡片们: [],
        },
      }),
    })
    mount(() => (
      <CardTemplateEditor
        projectId="p-1"
        api={api}
        行={有效行}
        材料们={[已解析材料]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    ))
    await 等(() => 找("card-template-preview-button") !== null)
    ;(找("card-template-preview-button") as HTMLButtonElement).click()
    await 等(() => 找("card-template-preview") !== null)
    expect(找("card-template-preview-expired")).toBeNull()

    // `data-slot` 挂在包住输入框的 `<label>` 上（`TextInputV2` 会覆写内层 `data-slot`），往 input 里填。
    const 名称框 = 找("card-template-name")!.querySelector<HTMLInputElement>("input")!
    名称框.value = "通话（改）"
    名称框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(() => 找("card-template-preview-expired") !== null)
    expect(找("card-template-preview-expired")!.textContent).toContain("需重新预览")
    expect(找("card-template-preview")!.hasAttribute("data-expired")).toBe(true)
    expect((找("card-template-save") as HTMLButtonElement).disabled).toBe(false)
  })

  test("词表失败：原样展示错误，不画半张表单", async () => {
    const api = 假api({ vocab: async () => ({ kind: "error", message: "词表读取失败" }) })
    mount(() => <CardTemplateEditor projectId="p-1" api={api} 材料们={[]} onClose={() => {}} onSaved={() => {}} />)
    await 等(() => 找("card-template-vocab-error") !== null)
    expect(找("card-template-vocab-error")!.textContent).toContain("词表读取失败")
    expect(找("card-template-name")).toBeNull()
  })
})
