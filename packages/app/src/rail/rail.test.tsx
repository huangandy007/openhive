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

/**
 * 提示壳内的按钮名单（`TooltipV2` 的触发层）。
 *
 * 取名单而不是取布尔：失败时打印的是**实得的整串名单**，一眼看出是哪一个入口漏了、
 * 还是顺序/数量变了（同 `labels()` 的口径）。壳的 `data-component` 是实测值——2026-10-09 探针
 * 拿到的 outerHTML 是 `<div data-closed="" data-component="tooltip-v2-trigger"><button …></div>`。
 */
const 壳内入口 = (host: HTMLElement) =>
  [...host.querySelectorAll("[data-component='tooltip-v2-trigger']")].map((el) =>
    el.querySelector("[data-slot='rail-entry']")?.getAttribute("aria-label"),
  )

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

  /**
   * 图标颜色**只能**靠祖先注入 `--icon-base`，父级按钮上的 `text-v2-icon-*` 到不了图标：
   * `packages/ui/src/components/icon.css` 给图标自身写了 `color: var(--icon-base)`，直接盖过继承来的色。
   * 不注入的后果不是报错，是**静默恒灰**——`--icon-base` 在主题里的兜底是上游硬编码的一档灰，
   * 于是默认 / 悬停 / 选中三档一并失效，选中入口的图标根本不显浅金（DESIGN §1.3 的违规）。
   * 同一坑 T009 在 `tab-bar` 踩过一次，做法照抄（`tab-bar.tsx:52-56`）。
   */
  test("图标颜色由祖先注入 --icon-base：选中档浅金、其余走 muted（DESIGN §1.3 / §4.1）", () => {
    const host = mount(() => <Rail active="fund-analysis" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 当前 = entries.find((el) => el.getAttribute("aria-label") === "资金分析")
    const 其余 = entries.filter((el) => el.getAttribute("aria-label") !== "资金分析")
    const 图标层 = (el: HTMLElement | undefined) =>
      el?.querySelector<HTMLElement>("[data-slot='rail-icon']") ?? undefined

    // happy-dom 没有 CSS 引擎，解析不了 var()——能断言的正是「注入的是不是一个 token」
    expect(图标层(当前)?.style.getPropertyValue("--icon-base")).toBe("var(--v2-icon-icon-accent)")
    // 未选中的那档写在类名里、不走内联：内联会压过 hover 的提亮（选中档才需要压过 hover）
    expect(图标层(其余[0])?.className ?? "").toContain("[--icon-base:var(--v2-icon-icon-muted)]")
    expect(其余.every((el) => 图标层(el)?.style.getPropertyValue("--icon-base") !== "var(--v2-icon-icon-accent)")).toBe(
      true,
    )
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

  /**
   * 悬停提示（FR-002 的补充规格）：每个入口都套在 `TooltipV2` 的触发壳里。
   *
   * ⚠️ 这条钉的是**接线**，不是「悬停会显示」——happy-dom 里 hover 与 focus **都打不开**浮层
   * （2026-10-09 探针实测：`pointerenter` / `focus()` 之后 0 / 500 / 1000ms 均查不到文案；
   * `LEARNINGS #006-18` 的「消费者在本测试层里是惰性的」）。文案与提示的显示行为要在真浏览器里看。
   * 文案本身仍由本文件上面的 `labels()` 那几条钉着（提示与 `aria-label` 同源，见 `rail.tsx`）。
   */
  test("每个入口都在 tooltip 触发壳内（五入口 + 系统设置，共 6 颗）", () => {
    const host = mount(() => <Rail onSelect={() => {}} />)

    expect(壳内入口(host)).toEqual([
      "项目管理",
      "AI 资产",
      "AI 会话",
      "话单分析",
      "资金分析",
      "系统设置",
    ])
  })
})
