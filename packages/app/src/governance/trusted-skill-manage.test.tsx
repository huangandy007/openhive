import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { createTrustedSkillApi } from "./trusted-skill-api"
import { TrustedSkillManage } from "./trusted-skill-manage"

/**
 * 016 T017 · 可信技能白名单管理页。
 *
 * 权限口径：`isAdmin` 由调用方传（导航级）；**直连时服务端仍会 403**，页面按 403 显示
 * 「只有单位管理员能维护」。非管理员不渲染任何管理按钮（布尔比较，`#013-12`）。
 */

async function 等(条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
afterEach(() => {
  document.body.innerHTML = ""
})

const 回 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const 行 = { assetId: "a1", name: "资金分析", status: "published", addedBy: "u1", addedAt: 1700000000 }

function 假服务(选项: { 列表?: () => Response } = {}) {
  const 记 = { 加: [] as string[], 撤: [] as string[], 次数: 0 }
  const send = async (url: string, init?: RequestInit) => {
    记.次数 += 1
    if (url.includes("/revoke")) {
      记.撤.push(JSON.parse(String(init?.body)).assetId)
      return 回({ ok: true })
    }
    if (init?.method === "POST") {
      记.加.push(JSON.parse(String(init?.body)).assetId)
      return 回({ ok: true })
    }
    return 选项.列表?.() ?? 回({ list: [行] })
  }
  return { 记, api: createTrustedSkillApi(send) }
}

describe("可信技能白名单管理", () => {
  test("非管理员：文案可见、管理按钮不存在、一次请求都不发", () => {
    const { 记, api } = 假服务()
    const host = mount(() => <TrustedSkillManage isAdmin={false} api={api} />)
    expect(host.textContent).toContain("只有单位管理员能维护")
    expect(host.querySelector("[data-slot='trusted-skill-add']") === null).toBe(true)
    expect(host.querySelector("[data-slot='trusted-skill-revoke']") === null).toBe(true)
    expect(记.次数 === 0).toBe(true)
  })

  test("管理员：列表上屏；加入与移出发往对应出口", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => <TrustedSkillManage isAdmin={true} api={api} />)
    await 等(() => host.querySelector("[data-slot='trusted-skill-row']") !== null)
    expect(host.textContent).toContain("资金分析")

    const 输入 = host.querySelector<HTMLInputElement>("[data-slot='trusted-skill-input']")!
    输入.value = "a2"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    host.querySelector<HTMLButtonElement>("[data-slot='trusted-skill-add']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    await 等(() => 记.加.length === 1)
    expect(记.加[0]).toBe("a2")

    host.querySelector<HTMLButtonElement>("[data-slot='trusted-skill-revoke']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    await 等(() => 记.撤.length === 1)
    expect(记.撤[0]).toBe("a1")
  })

  test("状态用闭集中文标签：published ⇒ 已发布，原串不直接露出（B7）", async () => {
    const { api } = 假服务()
    const host = mount(() => <TrustedSkillManage isAdmin={true} api={api} />)
    await 等(() => host.querySelector("[data-slot='trusted-skill-row']") !== null)
    const 行格 = host.querySelector("[data-slot='trusted-skill-row']")!
    expect(行格.textContent).toContain("已发布")
    // 布尔比较（`#013-12`）：原生枚举串不该出现在界面上。
    expect((行格.textContent ?? "").includes("published")).toBe(false)
  })

  test("加入失败 asset_not_published ⇒ 「该技能未发布，不能加入」", async () => {
    const api = createTrustedSkillApi(async (url, init) => {
      if (init?.method === "POST") return 回({ error: "该技能未发布，不能加入", code: "asset_not_published" }, 409)
      return 回({ list: [行] })
    })
    const host = mount(() => <TrustedSkillManage isAdmin={true} api={api} />)
    await 等(() => host.querySelector("[data-slot='trusted-skill-row']") !== null)
    const 输入 = host.querySelector<HTMLInputElement>("[data-slot='trusted-skill-input']")!
    输入.value = "a2"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    host.querySelector<HTMLButtonElement>("[data-slot='trusted-skill-add']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    await 等(() => host.querySelector("[data-slot='trusted-skill-error']") !== null)
    expect(host.textContent).toContain("该技能未发布，不能加入")
  })

  test("直连但服务端 403 ⇒ 仍显示「只有单位管理员能维护」，不渲染管理按钮", async () => {
    const api = createTrustedSkillApi(async () =>
      回({ error: "只有单位管理员能维护可信技能白名单", code: "forbidden" }, 403),
    )
    const host = mount(() => <TrustedSkillManage isAdmin={true} api={api} />)
    await 等(() => host.querySelector("[data-slot='trusted-skill-forbidden']") !== null)
    expect(host.textContent).toContain("只有单位管理员能维护")
    expect(host.querySelector("[data-slot='trusted-skill-add']") === null).toBe(true)
  })
})
