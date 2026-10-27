/**
 * 【保留的定制 · 同步上游时不要丢】治理后台 · 业务分类维护（需求 4）。
 *
 * 判据只钉界面这一层答应的事：
 * ① 列表**含停用项**并标出来（停用过的分类在后台要看得见，否则再也启不回来）；
 * ② 新建：空名当场拦下、不停服务端；成功后清空输入并重读；
 * ③ 编辑：只发**真的改了**的字段；没有改动只提示一句、**不发请求**（服务端对空补丁回 400）；
 * ④ 启停：一次 `update({enabled})`，成功后重读；
 * ⑤ **没有删除按钮**。
 *
 * 「谁能写」的真门在服务端（`packages/opencode/test/server/openhive-categories.test.ts`）——
 * 这里只是防误点（宪法 §IV）。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { CategoryAdminApi, CategoryAdminOutcome, CategoryAdminRow, CategoryPatch } from "./category-api"
import { CategoryManage } from "./category-manage"

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

const 行 = (id: string, name: string, overrides: Partial<CategoryAdminRow> = {}): CategoryAdminRow => ({
  id,
  name,
  sortOrder: 10,
  enabled: true,
  builtin: true,
  ...overrides,
})

const 样本: readonly CategoryAdminRow[] = [
  行("intelligence", "情报研判", { sortOrder: 10 }),
  行("supervision", "督导考核", { sortOrder: 80, enabled: false }),
]

interface 记录 {
  readonly create: Array<{ readonly name: string; readonly sortOrder?: number }>
  readonly update: Array<{ readonly id: string; readonly patch: CategoryPatch }>
  listCount: number
}

function 假后端(覆写: Partial<CategoryAdminApi> = {}, 行们: readonly CategoryAdminRow[] = 样本) {
  const 记录: 记录 = { create: [], update: [], listCount: 0 }
  const api: CategoryAdminApi = {
    list: async (): Promise<CategoryAdminOutcome<readonly CategoryAdminRow[]>> => {
      记录.listCount += 1
      return { kind: "ok", value: 行们 }
    },
    create: async (input) => {
      记录.create.push(input)
      return { kind: "ok", value: 行(`cat_${记录.create.length}`, input.name, { builtin: false }) }
    },
    update: async (id, patch) => {
      记录.update.push({ id, patch })
      const 原行 = 行们.find((row) => row.id === id) ?? 行(id, "未命名")
      return { kind: "ok", value: { ...原行, ...patch } }
    },
    ...覆写,
  }
  return { api, 记录 }
}

function 挂上(api: CategoryAdminApi) {
  const root = document.createElement("div")
  document.body.appendChild(root)
  挂过的.push(render(() => <CategoryManage api={api} />, root))
  return root
}

const 有 = (selector: string) => document.querySelector<HTMLElement>(selector)
const 全部 = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
const 输入 = (selector: string) => document.querySelector<HTMLInputElement>(selector)!
const 按钮 = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!

/** happy-dom 里直接 `el.value = x` 不会触发 `onInput`，要派发一次。 */
function 打字(el: HTMLInputElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("分类维护（需求 4）", () => {
  test("列表含停用项并标出来；没有删除按钮", async () => {
    挂上(假后端().api)
    await 等到(() => 全部("[data-slot='category-row']").length === 2)

    expect(全部("[data-slot='category-name']").map((el) => el.textContent?.trim())).toEqual(["情报研判", "督导考核"])
    expect(全部("[data-slot='category-row']").map((el) => el.dataset.enabled)).toEqual(["true", "false"])
    expect(有("[data-slot='category-disabled-badge']")?.textContent?.trim()).toBe("已停用")
    expect(document.body.querySelector("[data-slot='category-delete']")).toBeNull()
    expect(全部("button").some((el) => el.textContent?.trim() === "删除")).toBe(false)
  })

  test("新建：空名当场拦下、不发请求；成功后清空输入并重读", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 记录.listCount === 1)

    按钮("[data-slot='category-create-submit']").click()
    await 歇一拍()
    expect(有("[data-slot='category-create-error']")?.textContent?.trim()).toBe("请填写分类名称")
    expect(记录.create).toEqual([])

    打字(输入("[data-slot='category-create-name']"), "  资金分析 ")
    按钮("[data-slot='category-create-submit']").click()
    await 等到(() => 记录.create.length === 1)

    expect(记录.create[0]).toEqual({ name: "资金分析" })
    await 等到(() => 记录.listCount === 2)
    expect(输入("[data-slot='category-create-name']").value).toBe("")
    expect(有("[data-slot='category-notice']")?.textContent).toContain("资金分析")
  })

  test("排序不是整数 ⇒ 拦下（与内核同一条口径）", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 记录.listCount === 1)

    打字(输入("[data-slot='category-create-name']"), "资金分析")
    打字(输入("[data-slot='category-create-sort']"), "1.5")
    按钮("[data-slot='category-create-submit']").click()
    await 歇一拍()

    expect(有("[data-slot='category-create-error']")?.textContent?.trim()).toBe("排序必须是整数")
    expect(记录.create).toEqual([])
  })

  test("编辑：只发改了的字段；没改就只提示一句、不发请求", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 全部("[data-slot='category-row']").length === 2)

    全部("[data-slot='category-edit']")[0]!.click()
    await 歇一拍()

    // 什么都没改 ⇒ 不发请求。
    按钮("[data-slot='category-edit-save']").click()
    await 歇一拍()
    expect(有("[data-slot='category-edit-error']")?.textContent?.trim()).toBe("没有改动")
    expect(记录.update).toEqual([])

    // 只改名字 ⇒ 载荷里只有 name（排序原样不动，不该出现在补丁里）。
    打字(输入("[data-slot='category-edit-name']"), "情报研判（改）")
    按钮("[data-slot='category-edit-save']").click()
    await 等到(() => 记录.update.length === 1)

    expect(记录.update[0]).toEqual({ id: "intelligence", patch: { name: "情报研判（改）" } })
    await 等到(() => 有("[data-slot='category-edit-name']") === null)
    expect(有("[data-slot='category-notice']")?.textContent).toContain("情报研判（改）")
  })

  test("启停：一次 update({enabled})，成功后重读", async () => {
    const { api, 记录 } = 假后端()
    挂上(api)
    await 等到(() => 全部("[data-slot='category-row']").length === 2)

    // 第二行是停用的 ⇒ 按钮文案是「启用」。
    const 按钮们 = 全部("[data-slot='category-toggle']")
    expect(按钮们.map((el) => el.textContent?.trim())).toEqual(["停用", "启用"])

    按钮们[1]!.click()
    await 等到(() => 记录.update.length === 1)

    expect(记录.update[0]).toEqual({ id: "supervision", patch: { enabled: true } })
    await 等到(() => 记录.listCount === 2)
  })

  test("服务端拒绝（409 重名）⇒ 那句原话留在页上，输入框不清空", async () => {
    const { api } = 假后端({
      create: async () => ({ kind: "rejected", message: "已有同名分类「情报研判」", field: "name" }),
    })
    挂上(api)
    await 等到(() => 有("[data-slot='category-row']") !== null)

    打字(输入("[data-slot='category-create-name']"), "情报研判")
    按钮("[data-slot='category-create-submit']").click()
    await 等到(() => 有("[data-slot='category-create-error']") !== null)

    expect(有("[data-slot='category-create-error']")?.textContent?.trim()).toBe("已有同名分类「情报研判」")
    expect(输入("[data-slot='category-create-name']").value).toBe("情报研判")
  })
})
