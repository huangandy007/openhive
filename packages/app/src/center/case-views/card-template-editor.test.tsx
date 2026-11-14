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

/** 打开 `SelectV2`：Kobalte Trigger 只在 `pointerdown`（主键、非 touch）时开（`#006-37`）。 */
function 开下拉(触发器: HTMLElement) {
  触发器.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))
}

/** 菜单项在 Kobalte Portal 里（`document.body`）；Select 的选中走 `click` 分支（审查实测配方）。 */
const 菜单项们 = () => [...document.body.querySelectorAll<HTMLElement>("[data-slot='menu-v2-item-content']")]

async function 点选项(文字: string) {
  await 等(() => 菜单项们().some((项) => (项.textContent ?? "").includes(文字)))
  const 项 = 菜单项们().find((项) => (项.textContent ?? "").includes(文字))
  if (项 === undefined) throw new Error(`没找到菜单项：${文字}`)
  项.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

const 事件触发器 = () =>
  找("card-template-event-field")!.querySelector<HTMLElement>("[data-component='select-v2']")!

const 谁字段触发器 = () =>
  document.body.querySelector<HTMLElement>(
    "[data-slot='card-template-slot'][data-slot-name='谁'] [data-component='select-v2']",
  )!

const 材料触发器 = () =>
  找("card-template-preview-panel")!.querySelector<HTMLElement>("[data-component='select-v2']")!

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
    await 等(() => 找("card-template-name-field") !== null)

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

  test("单值槽可填：何时 / 何时止 / 多少钱各有一个下拉，选中的字段进保存载荷（C1）", async () => {
    const 收到: Array<Record<string, unknown>> = []
    const api = 假api({
      create: async (input) => {
        收到.push(input as unknown as Record<string, unknown>)
        return { kind: "ok", value: 有效行 }
      },
    })
    mount(() => <CardTemplateEditor projectId="p-1" api={api} 材料们={[]} onClose={() => {}} onSaved={() => {}} />)
    await 等(() => 找("card-template-name-field") !== null)
    for (const 槽名 of ["何时", "何时止", "多少钱"]) {
      const 槽 = document.body.querySelector<HTMLElement>(
        `[data-slot='card-template-slot'][data-slot-name='${槽名}']`,
      )!
      expect(槽.querySelectorAll("[data-slot='card-template-slot-row']").length).toBe(1)
      expect(槽.querySelector("[data-component='select-v2']")).not.toBeNull()
    }

    // 可操作性：真的在「何时」下拉里选「时间」，再补齐保存条件，载荷必须带 `何时`。
    // （词表里「何地」的可选字段为空集，能选到 `startedAt` 的是「何时」。）
    // 每次重新取：`写` 会换掉这一行的对象引用，`<For>` 因此重建行 DOM，旧触发器会变成游离节点。
    const 何时触发器 = () =>
      document.body.querySelector<HTMLElement>(
        "[data-slot='card-template-slot'][data-slot-name='何时'] [data-component='select-v2']",
      )!
    开下拉(何时触发器())
    await 点选项("时间")
    await 等(() => (何时触发器().textContent ?? "").includes("时间"))

    const 名称框 = 找("card-template-name-field")!.querySelector<HTMLInputElement>("input")!
    名称框.value = "话单模板"
    名称框.dispatchEvent(new Event("input", { bubbles: true }))
    开下拉(事件触发器())
    await 点选项("通话")
    开下拉(谁字段触发器())
    await 点选项("主叫号码")
    const 保存 = 找("card-template-save") as HTMLButtonElement
    await 等(() => !保存.disabled)
    保存.click()
    await 等(() => 收到.length === 1)
    expect(收到[0]?.slots).toEqual({
      谁: { 字段: "caller", 角色: "主体" },
      何时: { 字段: "startedAt" },
    })
  })

  test("修改已验证模板：常驻「改内容回未验证、只改名不影响」；保存走 update，收到定义体", async () => {
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
    // 2026-11-14 真栈实测：只改名称不重置验证态（内核 §7.3），提示必须说清「改什么才回未验证」。
    expect(找("card-template-verified-warning")!.textContent).toContain(
      "改「哪一列对应哪一项」「事件类型」或「必须填满才产卡片」再保存，会回到未验证，需重新预览并转正；只改名称不影响",
    )
    ;(找("card-template-save") as HTMLButtonElement).click()
    await 等(() => 收到.length === 1)
    expect(收到[0]).toEqual({
      projectId: "p-1",
      id: "用户:1",
      name: "通话",
      eventType: "通话",
      slots: { 谁: { 字段: "caller", 角色: "主叫" } },
      required: ["谁"],
    })
    expect("expectedVersion" in (收到[0] ?? {})).toBe(false)
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
    await 等(() => 找("card-template-name-field") !== null)
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

  test("不可选事件类型：空态点了也不落地（触发器仍占位、校验仍拦、保存仍灰）", async () => {
    mount(() => (
      <CardTemplateEditor
        projectId="p-1"
        api={假api()}
        行={{ ...有效行, event_type: "" }}
        材料们={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    ))
    await 等(() => 找("card-template-event-field") !== null)
    expect(事件触发器().textContent).toContain("请选择事件类型")
    开下拉(事件触发器())
    await 点选项("资金交易")
    // I1：`current` 若落回 undefined，Kobalte 会转非受控，这里会变成「资金交易（不可选）」。
    expect(事件触发器().textContent).toContain("请选择事件类型")
    expect(事件触发器().textContent).not.toContain("资金交易")
    expect(找("card-template-editor-validation")!.textContent).toContain("请选择事件类型")
    expect((找("card-template-save") as HTMLButtonElement).disabled).toBe(true)
  })

  test("不可选事件类型：已有值不被替换，保存载荷保持原值", async () => {
    const 收到: Array<Record<string, unknown>> = []
    const api = 假api({
      update: async (input) => {
        收到.push(input as unknown as Record<string, unknown>)
        return { kind: "ok", value: 有效行 }
      },
    })
    mount(() => (
      <CardTemplateEditor projectId="p-1" api={api} 行={有效行} 材料们={[]} onClose={() => {}} onSaved={() => {}} />
    ))
    await 等(() => 找("card-template-event-field") !== null)
    expect(事件触发器().textContent).toContain("通话")
    开下拉(事件触发器())
    await 点选项("资金交易")
    expect(事件触发器().textContent).toContain("通话")
    expect(事件触发器().textContent).not.toContain("资金交易")
    ;(找("card-template-save") as HTMLButtonElement).click()
    await 等(() => 收到.length === 1)
    expect(收到[0]?.eventType).toBe("通话")
  })

  test("脏态点 X：先二次确认，不直接调 onClose（I2）", async () => {
    let 关了 = false
    mount(() => (
      <CardTemplateEditor
        projectId="p-1"
        api={假api()}
        行={有效行}
        材料们={[]}
        onClose={() => {
          关了 = true
        }}
        onSaved={() => {}}
      />
    ))
    await 等(() => 找("card-template-name-field") !== null)
    const 名称框 = 找("card-template-name-field")!.querySelector<HTMLInputElement>("input")!
    名称框.value = "通话（改）"
    名称框.dispatchEvent(new Event("input", { bubbles: true }))
    ;(找("card-template-close") as HTMLButtonElement).click()
    expect(关了).toBe(false)
    await 等(() => 找("card-template-discard-hint") !== null)
  })

  test("换预览材料：旧结果过期并提示重新预览（I4）", async () => {
    const 第二份: 材料视图 = { ...已解析材料, id: "m-2", path: "材料/第二份.xlsx" }
    const api = 假api({
      preview: async () => ({
        kind: "ok",
        value: { 卡片数: 1, 跳过: {}, 工作表们: [{ sheet: "Sheet1", 卡片数: 1, 跳过: {} }], 卡片们: [] },
      }),
    })
    mount(() => (
      <CardTemplateEditor
        projectId="p-1"
        api={api}
        行={有效行}
        材料们={[已解析材料, 第二份]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    ))
    await 等(() => 找("card-template-preview-button") !== null)
    ;(找("card-template-preview-button") as HTMLButtonElement).click()
    await 等(() => 找("card-template-preview") !== null)
    expect(找("card-template-preview-expired")).toBeNull()
    开下拉(材料触发器())
    await 点选项("材料/第二份.xlsx")
    await 等(() => (材料触发器().textContent ?? "").includes("材料/第二份.xlsx"))
    // 过期是结果区自身的置灰态，不能只看提示文案：`data-expired` 必须落到结果区。
    expect(找("card-template-preview-expired")).not.toBeNull()
    expect(找("card-template-preview")!.hasAttribute("data-expired")).toBe(true)
    expect(找("card-template-preview-expired")!.textContent).toContain("内容已变，需重新预览")
  })

  test("多行槽：和谁可以加一行、删一行（I5）", async () => {
    mount(() => <CardTemplateEditor projectId="p-1" api={假api()} 材料们={[]} onClose={() => {}} onSaved={() => {}} />)
    await 等(() => 找("card-template-name-field") !== null)
    const 和谁 = () =>
      document.body.querySelector<HTMLElement>("[data-slot='card-template-slot'][data-slot-name='和谁']")!
    expect(和谁().querySelectorAll("[data-slot='card-template-slot-row']").length).toBe(0)
    ;(和谁().querySelector("[data-slot='card-template-slot-add']") as HTMLButtonElement).click()
    await 等(() => 和谁().querySelectorAll("[data-slot='card-template-slot-row']").length === 1)
    ;(和谁().querySelector("[data-slot='card-template-slot-remove']") as HTMLButtonElement).click()
    await 等(() => 和谁().querySelectorAll("[data-slot='card-template-slot-row']").length === 0)
  })

  test("新建保存：无 行 时走 create，载荷含名称 / 事件类型 / 槽（I5）", async () => {
    const 收到: Array<Record<string, unknown>> = []
    const api = 假api({
      create: async (input) => {
        收到.push(input as unknown as Record<string, unknown>)
        return { kind: "ok", value: 有效行 }
      },
    })
    mount(() => <CardTemplateEditor projectId="p-1" api={api} 材料们={[]} onClose={() => {}} onSaved={() => {}} />)
    await 等(() => 找("card-template-name-field") !== null)
    const 名称框 = 找("card-template-name-field")!.querySelector<HTMLInputElement>("input")!
    名称框.value = "话单模板"
    名称框.dispatchEvent(new Event("input", { bubbles: true }))
    开下拉(事件触发器())
    await 点选项("通话")
    开下拉(谁字段触发器())
    await 点选项("主叫号码")
    const 保存 = 找("card-template-save") as HTMLButtonElement
    await 等(() => !保存.disabled)
    保存.click()
    await 等(() => 收到.length === 1)
    expect(收到[0]).toEqual({
      projectId: "p-1",
      name: "话单模板",
      eventType: "通话",
      slots: { 谁: { 字段: "caller", 角色: "主体" } },
      required: ["谁"],
    })
    expect("expectedVersion" in (收到[0] ?? {})).toBe(false)
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
    const 名称框 = 找("card-template-name-field")!.querySelector<HTMLInputElement>("input")!
    名称框.value = "通话（改）"
    名称框.dispatchEvent(new Event("input", { bubbles: true }))
    await 等(() => 找("card-template-preview-expired") !== null)
    expect(找("card-template-preview-expired")!.textContent).toContain("内容已变，需重新预览")
    expect(找("card-template-preview")!.hasAttribute("data-expired")).toBe(true)
    expect((找("card-template-save") as HTMLButtonElement).disabled).toBe(false)
  })

  test("词表失败：原样展示错误，不画半张表单", async () => {
    const api = 假api({ vocab: async () => ({ kind: "error", message: "词表读取失败" }) })
    mount(() => <CardTemplateEditor projectId="p-1" api={api} 材料们={[]} onClose={() => {}} onSaved={() => {}} />)
    await 等(() => 找("card-template-vocab-error") !== null)
    expect(找("card-template-vocab-error")!.textContent).toContain("词表读取失败")
    expect(找("card-template-name-field")).toBeNull()
  })
})
