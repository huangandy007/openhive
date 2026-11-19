import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { CaseSkillHint, 技能提示键前缀, 稍后键, 该提醒 } from "./case-skill-hint"

/**
 * 016 T018 · 三时刻技能提醒（FR-043/044/045/046）。
 *
 * 「稍后」键＝前缀 ＋ projectId ＋ 时刻 ＋ 文件路径：同一份文件只沉默一次，
 * **不跨项目、不跨文件**。DOM「不存在」断言一律布尔比较（`#013-12`）。
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

const 点稍后 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-slot='case-skill-hint-snooze']")!.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  )

describe("三时刻判据（该提醒）", () => {
  test("零数据技能：材料数 0 且已启用案件技能数 0 才提醒", () => {
    expect(该提醒("零数据技能", { 材料数: 0, 已启用案件技能数: 0 })).toBe(true)
    expect(该提醒("零数据技能", { 材料数: 1, 已启用案件技能数: 0 })).toBe(false)
    expect(该提醒("零数据技能", { 材料数: 0, 已启用案件技能数: 1 })).toBe(false)
    // 缺省字段按「条件不成立」：未知数据不弹。
    expect(该提醒("零数据技能", { 已启用案件技能数: 0 })).toBe(false)
    expect(该提醒("零数据技能", { 材料数: 0 })).toBe(false)
  })

  test("上传未识别：本次上传有未识别才提醒", () => {
    expect(该提醒("上传未识别", { 未识别份数: 1 })).toBe(true)
    expect(该提醒("上传未识别", { 未识别份数: 0 })).toBe(false)
    expect(该提醒("上传未识别", {})).toBe(false)
  })

  test("启用后扫描：可重跑数量 > 0 才提醒", () => {
    expect(该提醒("启用后扫描", { 可重跑数: 3 })).toBe(true)
    expect(该提醒("启用后扫描", { 可重跑数: 0 })).toBe(false)
    expect(该提醒("启用后扫描", {})).toBe(false)
  })
})

describe("三时刻技能提醒（组件）", () => {
  test("上传未识别：文案指出文件、格式与技能名（不是泛泛的「请先启动技能」）", () => {
    const host = mount(() => (
      <CaseSkillHint
        时刻="上传未识别"
        projectId="p1"
        文件="材料/流水.xlsx"
        未识别格式="xlsx"
        技能名="流水转换"
      />
    ))
    expect(host.textContent).toContain("材料/流水.xlsx")
    expect(host.textContent).toContain("xlsx")
    expect(host.textContent).toContain("流水转换")
    expect(host.textContent).not.toContain("请先启动技能")
  })

  test("无权限：启用并解析置灰，原因「需要项目属主启用」可见", () => {
    const host = mount(() => (
      <CaseSkillHint 时刻="上传未识别" projectId="p1" 文件="材料/流水.xlsx" 技能名="流水转换" 能启用={false} />
    ))
    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='case-skill-hint-enable']")
    expect(按钮 === null).toBe(false)
    expect(按钮!.disabled).toBe(true)
    expect(host.textContent).toContain("需要项目属主启用")
  })

  test("有权限：启用并解析可点，不显示置灰原因", () => {
    const host = mount(() => (
      <CaseSkillHint 时刻="上传未识别" projectId="p1" 文件="材料/流水.xlsx" 技能名="流水转换" 能启用={true} />
    ))
    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='case-skill-hint-enable']")
    expect(按钮 === null).toBe(false)
    expect(按钮!.disabled).toBe(false)
    expect(host.textContent).not.toContain("需要项目属主启用")
  })

  test("系统无对应技能：暂无可用的解析技能 ＋ 提交格式需求入口", () => {
    const host = mount(() => <CaseSkillHint 时刻="上传未识别" projectId="p1" 文件="材料/神秘.xyz" />)
    expect(host.textContent).toContain("暂无可用的解析技能")
    expect(host.querySelector("[data-slot='case-skill-hint-format-request']") === null).toBe(false)
    expect(host.querySelector("[data-slot='case-skill-hint-enable']") === null).toBe(true)
  })

  test("启用后扫描：文案带可重跑数量", () => {
    const host = mount(() => <CaseSkillHint 时刻="启用后扫描" projectId="p1" 可重跑数={7} />)
    expect(host.textContent).toContain("7")
    expect(host.textContent).toContain("重跑")
  })

  test("稍后：同一文件不再弹，换一份文件仍弹", () => {
    const 首 = mount(() => <CaseSkillHint 时刻="上传未识别" projectId="p1" 文件="材料/甲.xlsx" 技能名="s" now={() => 1234} />)
    点稍后(首)
    expect(首.querySelector("[data-slot='case-skill-hint']") === null).toBe(true)
    // 键至少包含项目与文件两个维度。
    expect(localStorage.getItem(稍后键("p1", "上传未识别", "材料/甲.xlsx"))).toBe("1234")
    卸载当前()
    document.body.innerHTML = ""

    const 同文件 = mount(() => <CaseSkillHint 时刻="上传未识别" projectId="p1" 文件="材料/甲.xlsx" 技能名="s" />)
    expect(同文件.querySelector("[data-slot='case-skill-hint']") === null).toBe(true)
    卸载当前()
    document.body.innerHTML = ""

    const 换文件 = mount(() => <CaseSkillHint 时刻="上传未识别" projectId="p1" 文件="材料/乙.xlsx" 技能名="s" />)
    expect(换文件.querySelector("[data-slot='case-skill-hint']") === null).toBe(false)
  })

  test("稍后：换项目仍弹（键不跨项目）", () => {
    const 首 = mount(() => <CaseSkillHint 时刻="上传未识别" projectId="p1" 文件="材料/甲.xlsx" 技能名="s" />)
    点稍后(首)
    卸载当前()
    document.body.innerHTML = ""

    const 别的项目 = mount(() => <CaseSkillHint 时刻="上传未识别" projectId="p2" 文件="材料/甲.xlsx" 技能名="s" />)
    expect(别的项目.querySelector("[data-slot='case-skill-hint']") === null).toBe(false)
  })

  test("零数据技能：按项目一次性——同项目再挂不再弹", () => {
    const 首 = mount(() => <CaseSkillHint 时刻="零数据技能" projectId="p1" />)
    expect(首.querySelector("[data-slot='case-skill-hint']") === null).toBe(false)
    点稍后(首)
    卸载当前()
    document.body.innerHTML = ""

    const 同项目 = mount(() => <CaseSkillHint 时刻="零数据技能" projectId="p1" />)
    expect(同项目.querySelector("[data-slot='case-skill-hint']") === null).toBe(true)
    // 前缀本身没变：键仍以导出的前缀开头（口径单一出处）。
    expect(localStorage.getItem(稍后键("p1", "零数据技能"))!.length).toBeGreaterThan(0)
    expect(稍后键("p1", "零数据技能").startsWith(技能提示键前缀)).toBe(true)
  })

  test("触发条件不成立（开启=false）⇒ 不出现", () => {
    const host = mount(() => <CaseSkillHint 时刻="启用后扫描" projectId="p1" 可重跑数={2} 开启={false} />)
    expect(host.querySelector("[data-slot='case-skill-hint']") === null).toBe(true)
  })
})
