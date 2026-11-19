import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { CaseSkillHint, 技能提示键前缀, 该提醒 } from "./case-skill-hint"

/**
 * 016 T017 · 三时刻技能提醒。
 *
 * 「稍后」写 `localStorage["openhive.case.skill-hint.snoozed.<时刻>"]`，此后**该时刻**不再弹；
 * 换一个时刻仍出现。`happy-dom` 有 localStorage 实现，用例按真实键断言。
 */

let 卸载: (() => void) | undefined
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  卸载 = render(element, host)
  return host
}
/** 经函数读 `卸载`：直接 `卸载?.()` 会被 TS 的控制流窄化成 `never`（mount 的副作用它看不见）。 */
function 卸载当前() {
  const 当前 = 卸载
  卸载 = undefined
  当前?.()
}
beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  卸载当前()
  document.body.innerHTML = ""
})

describe("三时刻判据（该提醒）", () => {
  test("未识别：份数 > 0 且已启用案件技能数 === 0 才提醒", () => {
    expect(该提醒("未识别", { 未识别份数: 2, 已启用案件技能数: 0 })).toBe(true)
    expect(该提醒("未识别", { 未识别份数: 0, 已启用案件技能数: 0 })).toBe(false)
    expect(该提醒("未识别", { 未识别份数: 2, 已启用案件技能数: 1 })).toBe(false)
  })

  test("旁路：报告结论恰为「旁路」才提醒", () => {
    expect(该提醒("旁路", { 报告结论: "旁路" })).toBe(true)
    expect(该提醒("旁路", { 报告结论: null })).toBe(false)
    expect(该提醒("旁路", { 报告结论: "准入" })).toBe(false)
  })

  test("白名单：新增数 > 0 才提醒", () => {
    expect(该提醒("白名单", { 白名单新增数: 1 })).toBe(true)
    expect(该提醒("白名单", { 白名单新增数: 0 })).toBe(false)
  })
})

describe("三时刻技能提醒", () => {
  test("首次渲染出现；点「稍后」后消失并写入该时刻的 localStorage 键", () => {
    const host = mount(() => <CaseSkillHint 时刻="未识别" now={() => 1234} />)
    const 提示 = host.querySelector("[data-slot='case-skill-hint']")
    expect(提示 === null).toBe(false)
    expect(host.textContent).toContain("未识别")

    host.querySelector<HTMLElement>("[data-slot='case-skill-hint-snooze']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    expect(host.querySelector("[data-slot='case-skill-hint']") === null).toBe(true)
    expect(localStorage.getItem(`${技能提示键前缀}未识别`)).toBe("1234")
  })

  test("重新渲染：同一时刻不再出现；换一个时刻仍出现", () => {
    // 先让「未识别」被稍后过。
    const 首 = mount(() => <CaseSkillHint 时刻="未识别" now={() => 1} />)
    首.querySelector<HTMLElement>("[data-slot='case-skill-hint-snooze']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    卸载当前()
    document.body.innerHTML = ""

    const 同一时刻 = mount(() => <CaseSkillHint 时刻="未识别" />)
    expect(同一时刻.querySelector("[data-slot='case-skill-hint']") === null).toBe(true)
    卸载当前()
    document.body.innerHTML = ""

    const 另一时刻 = mount(() => <CaseSkillHint 时刻="旁路" />)
    expect(另一时刻.querySelector("[data-slot='case-skill-hint']") === null).toBe(false)
    expect(另一时刻.textContent).toContain("旁路")
  })

  test("触发条件不成立（开启=false）⇒ 不出现", () => {
    const host = mount(() => <CaseSkillHint 时刻="白名单" 开启={false} />)
    expect(host.querySelector("[data-slot='case-skill-hint']") === null).toBe(true)
  })
})
