import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { contentTabKey, type ContentTab } from "./tab-store"
import { TabBar } from "./tab-bar"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const TABS: ContentTab[] = [
  { module: "project", title: "专案A", path: "/p/a.intent" },
  { module: "cdr-analysis", title: "话单.csv", path: "/p/cdr.csv" },
  { module: "fund-analysis", title: "流水.xlsx", path: "/p/fund.xlsx" },
]

const slots = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>(`[data-slot='${name}']`)]
const titles = (host: HTMLElement) => slots(host, "tab").map((el) => el.querySelector("[data-slot='tab-title']")?.textContent)

type BarProps = Partial<Parameters<typeof TabBar>[0]>

/**
 * 渲染一个可用宽度充裕的 tab 栏（溢出另用 `availableWidth` 收窄）。
 *
 * 逐个字段显式传，**不用展开覆盖**：Solid 的 spread 会跳过值为 `undefined` 的键，
 * `{...{ availableWidth: undefined }}` 覆盖不掉前面的 1000，测试就成了空转
 * （实测过：这个写法让「不传宽度」那条测试假绿）。要「不传」就写 `"availableWidth" in props`。
 */
function mountBar(props: BarProps = {}) {
  return mount(() => (
    <TabBar
      tabs={props.tabs ?? TABS}
      active={props.active}
      availableWidth={"availableWidth" in props ? props.availableWidth : 1000}
      onActivate={props.onActivate ?? (() => {})}
      onClose={props.onClose ?? (() => {})}
    />
  ))
}

describe("TabBar 中栏 tab 栏（FR-005 / DESIGN §4.5）", () => {
  test("按顺序渲染每个 tab：文件名在、各带一个关闭按钮", () => {
    const host = mountBar()

    expect(titles(host)).toEqual(["专案A", "话单.csv", "流水.xlsx"])
    expect(slots(host, "tab-close")).toHaveLength(3)
  })

  test("激活的 tab：aria-selected 为 true，且带顶边条；其余都不带（DESIGN §3.2 / §4.3）", () => {
    const host = mountBar({ active: contentTabKey(TABS[1]) })
    const [项目, 话单, 资金] = slots(host, "tab")

    expect(话单?.getAttribute("aria-selected")).toBe("true")
    expect(话单?.querySelector("[data-slot='tab-active-bar']")).not.toBeNull()
    expect([项目, 资金].map((el) => el?.getAttribute("aria-selected"))).toEqual(["false", "false"])
    expect([项目, 资金].some((el) => el?.querySelector("[data-slot='tab-active-bar']") != null)).toBe(false)
  })

  test("点 tab：回调带出该 tab 的 key（= 来源模块 + 内容路径）", () => {
    const picked: string[] = []
    const host = mountBar({ onActivate: (key) => picked.push(key) })

    slots(host, "tab")[2]?.click()

    expect(picked).toEqual([contentTabKey(TABS[2])])
  })

  test("点关闭按钮：只回调 onClose（带 key），不会连带把这张 tab 也激活", () => {
    const closed: string[] = []
    const activated: string[] = []
    const host = mountBar({ onActivate: (key) => activated.push(key), onClose: (key) => closed.push(key) })

    slots(host, "tab")[1]?.querySelector<HTMLElement>("[data-slot='tab-close']")?.click()

    expect(closed).toEqual([contentTabKey(TABS[1])])
    expect(activated).toEqual([])
  })

  test("按来源模块着色：模块图标取该模块的身份色，tab 上标出 data-module（FR-005）", () => {
    const host = mountBar()
    const [项目, 话单] = slots(host, "tab")

    expect(项目?.getAttribute("data-module")).toBe("project")
    expect(话单?.getAttribute("data-module")).toBe("cdr-analysis")
    // Icon 的着色来自继承的 --icon-base（见 icon.css），故由外层 wrapper 提供
    expect(项目?.querySelector<HTMLElement>("[data-slot='tab-icon']")?.style.getPropertyValue("--icon-base")).toBe(
      "var(--v2-avatar-bg-gray)",
    )
    expect(话单?.querySelector<HTMLElement>("[data-slot='tab-icon']")?.style.getPropertyValue("--icon-base")).toBe(
      "var(--v2-avatar-bg-blue)",
    )
  })

  test("放不下：尾部 tab 不渲染，行末出现「⋯」（FR-005）", () => {
    const host = mountBar({ availableWidth: 400 })

    expect(titles(host)).toEqual(["专案A", "话单.csv"])
    expect(slots(host, "tab-overflow")).toHaveLength(1)
  })

  test("点「⋯」：列出被收走的 tab；点其中一项就切过去并收起菜单（FR-005）", () => {
    const picked: string[] = []
    const host = mountBar({ availableWidth: 400, onActivate: (key) => picked.push(key) })

    slots(host, "tab-overflow")[0]?.click()
    const 收走的 = slots(host, "tab-overflow-item")

    expect(收走的.map((el) => el.textContent)).toEqual(["流水.xlsx"])

    收走的[0]?.click()

    expect(picked).toEqual([contentTabKey(TABS[2])])
    expect(slots(host, "tab-overflow-menu")).toHaveLength(0)
  })

  test("放得下：没有「⋯」，也不多渲染", () => {
    const host = mountBar()

    expect(slots(host, "tab-overflow")).toHaveLength(0)
    expect(titles(host)).toEqual(["专案A", "话单.csv", "流水.xlsx"])
  })

  test("还没量到可用宽度（首帧 / 无 CSS 引擎）时先全显示：不凭空把 tab 藏进「⋯」", () => {
    const host = mountBar({ availableWidth: undefined })

    expect(titles(host)).toEqual(["专案A", "话单.csv", "流水.xlsx"])
    expect(slots(host, "tab-overflow")).toHaveLength(0)
  })
})
