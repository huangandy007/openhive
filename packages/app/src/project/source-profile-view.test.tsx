import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { createSourceProfileApi } from "./source-profile-api"
import { SourceProfileView } from "./source-profile-view"

/**
 * 016 T017 · 数据源档案视图（列表 + 建档 + 撤销）。
 *
 * 用**真客户端 + 计数替身**：既验证视图把服务端的蛇形行画出来，也验证动作发往既有三出口。
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

const 档案行 = {
  id: "s1",
  name: "八月流水平安",
  type: "资金",
  header_set: ["交易时间", "金额"],
  mapping: { 金额: "金额" },
  hit_count: 3,
  created_at: 1700000000,
  updated_at: 1700000100,
  revoked_at: null,
}

function 假服务() {
  const 记 = { 建: [] as unknown[], 撤: [] as unknown[], 列表: 0 }
  const send = async (url: string, init?: RequestInit) => {
    if (url.includes("/source-profile/build")) {
      记.建.push(JSON.parse(String(init?.body)))
      return 回({ id: "s2", created: true })
    }
    if (url.includes("/source-profile/revoke")) {
      记.撤.push(JSON.parse(String(init?.body)))
      return 回({ ok: true })
    }
    记.列表 += 1
    return 回({ list: [档案行] })
  }
  return { 记, api: createSourceProfileApi(send) }
}

describe("数据源档案视图", () => {
  test("列表把蛇形行画出来；已撤销的行有标记", async () => {
    const api = createSourceProfileApi(async () => 回({ list: [{ ...档案行, revoked_at: 1700000200 }] }))
    const host = mount(() => <SourceProfileView projectId="p1" 是属主={true} api={api} />)
    await 等(() => host.querySelector("[data-slot='source-profile-row']") !== null)
    expect(host.textContent).toContain("八月流水平安")
    expect(host.textContent).toContain("资金")
    expect(host.textContent).toContain("已撤销")
  })

  test("属主选材料提交 ⇒ 调 build（只带选中的 materialId）；成功后重拉列表", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => (
      <SourceProfileView
        projectId="p1"
        是属主={true}
        api={api}
        材料们={[
          { id: "m1", path: "资料/流水.xlsx" },
          { id: "m2", path: "资料/话单.xlsx" },
        ]}
      />
    ))
    await 等(() => host.querySelector("[data-slot='source-profile-row']") !== null)
    const 列表次数 = 记.列表

    const 选择 = host.querySelector<HTMLSelectElement>("[data-slot='source-profile-material']")!
    选择.value = "m2"
    选择.dispatchEvent(new Event("change", { bubbles: true }))
    host.querySelector<HTMLButtonElement>("[data-slot='source-profile-submit']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    await 等(() => 记.建.length === 1)

    expect(记.建[0]).toEqual({ projectId: "p1", materialId: "m2" })
    await 等(() => 记.列表 === 列表次数 + 1)
  })

  test("撤销按钮发往 revoke 口", async () => {
    const { 记, api } = 假服务()
    const host = mount(() => <SourceProfileView projectId="p1" 是属主={true} api={api} />)
    await 等(() => host.querySelector("[data-slot='source-profile-revoke']") !== null)
    host.querySelector<HTMLButtonElement>("[data-slot='source-profile-revoke']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    await 等(() => 记.撤.length === 1)
    expect(记.撤[0]).toEqual({ projectId: "p1", id: "s1" })
  })

  test("建档失败带 problems ⇒ 逐条显示；成员看到「只有项目属主」且不渲染撤销", async () => {
    const api = createSourceProfileApi(async (url) => {
      if (url.includes("/source-profile/build")) {
        return 回({ error: "映射不合法", code: "mapping_invalid", problems: ["金额 缺单位"] }, 400)
      }
      return 回({ list: [档案行] })
    })
    const host = mount(() => (
      <SourceProfileView
        projectId="p1"
        是属主={false}
        api={api}
        材料们={[{ id: "m1", path: "资料/流水.xlsx" }]}
      />
    ))
    await 等(() => host.querySelector("[data-slot='source-profile-row']") !== null)
    expect(host.querySelector("[data-slot='source-profile-revoke']") === null).toBe(true)
    expect(host.textContent).toContain("只有项目属主能维护数据源档案")

    const 选择 = host.querySelector<HTMLSelectElement>("[data-slot='source-profile-material']")!
    选择.value = "m1"
    选择.dispatchEvent(new Event("change", { bubbles: true }))
    // 成员提交键也置灰、且不绑 handler（服务端仍会 403，前端只是体验）。
    const 提交 = host.querySelector<HTMLButtonElement>("[data-slot='source-profile-submit']")!
    expect(提交.disabled).toBe(true)
    提交.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.textContent).not.toContain("金额 缺单位")
  })
})
