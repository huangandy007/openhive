import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { Rail } from "./rail"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const labels = (host: HTMLElement) =>
  [...host.querySelectorAll("[data-slot='rail-entry']")].map((el) => el.getAttribute("aria-label"))

describe("Rail 图标栏", () => {
  test("未传能力位时，五入口 + 底部系统设置全部渲染（FR-002）", () => {
    const host = mount(() => <Rail onSelect={() => {}} />)

    expect(labels(host)).toEqual(["项目管理", "AI 资产", "AI 会话", "话单分析", "资金分析", "系统设置"])
  })

  test("点某个入口：回调带出该入口的 id（不是显示名）", () => {
    const picked: string[] = []
    const host = mount(() => <Rail onSelect={(id) => picked.push(id)} />)

    const 资金 = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")].find(
      (el) => el.getAttribute("aria-label") === "资金分析",
    )
    资金?.click()

    expect(picked).toEqual(["fund-analysis"])
  })

  test("会话只签到部分能力位时：无能力的入口不渲染，系统设置仍在（出参：无权限入口隐藏）", () => {
    const host = mount(() => <Rail capabilities={new Set(["project"])} onSelect={() => {}} />)

    expect(labels(host)).toEqual(["项目管理", "系统设置"])
  })

  test("图标栏宽 56px（DESIGN.md §4.1）", () => {
    const host = mount(() => <Rail onSelect={() => {}} />)

    const rail = host.querySelector<HTMLElement>("[data-component='rail']")
    expect(rail?.style.width).toBe("56px")
  })

  test("当前模块的入口带左侧竖条与 aria-current，其余入口都没有（DESIGN §4.1 / §4.3）", () => {
    const host = mount(() => <Rail active="fund-analysis" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 当前 = entries.find((el) => el.getAttribute("aria-label") === "资金分析")
    const 其余 = entries.filter((el) => el.getAttribute("aria-label") !== "资金分析")

    expect(当前?.querySelector("[data-slot='rail-entry-bar']")).not.toBeNull()
    expect(当前?.getAttribute("aria-current")).toBe("page")
    expect(其余.some((el) => el.querySelector("[data-slot='rail-entry-bar']") !== null)).toBe(false)
    expect(其余.some((el) => el.getAttribute("aria-current") !== null)).toBe(false)
  })

  test("选中底是浅金 token，不再是中性灰（DESIGN §1.3 / T017 换皮）", () => {
    const host = mount(() => <Rail active="fund-analysis" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 当前 = entries.find((el) => el.getAttribute("aria-label") === "资金分析")
    const 其余 = entries.filter((el) => el.getAttribute("aria-label") !== "资金分析")

    // happy-dom 没有 CSS 引擎，能断言的只有「用的哪个 token」——正是换皮要守住的那一点
    expect(当前?.className ?? "").toContain("bg-[var(--v2-background-bg-accent-soft)]")
    expect(当前?.className ?? "").not.toContain("overlay-simple-overlay-pressed")
    expect(其余.every((el) => !(el.className ?? "").includes("accent-soft"))).toBe(true)
  })

  test("系统设置同样能是当前入口：停在设置上时竖条落在底部那一项，五个业务入口都不带", () => {
    const host = mount(() => <Rail active="settings" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 设置 = entries.find((el) => el.getAttribute("aria-label") === "系统设置")
    const 业务 = entries.filter((el) => el.getAttribute("aria-label") !== "系统设置")

    expect(设置?.querySelector("[data-slot='rail-entry-bar']")).not.toBeNull()
    expect(设置?.getAttribute("aria-current")).toBe("page")
    expect(业务.some((el) => el.getAttribute("aria-current") !== null)).toBe(false)
  })
})
