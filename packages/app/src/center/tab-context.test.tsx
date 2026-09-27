import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { CenterTabsProvider, useCenterTabs, type CenterTabs } from "./tab-context"
import { contentTabKey, type ContentTab } from "./tab-store"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 专案: ContentTab = { module: "project", title: "专案A", path: "/p/a.intent" }
const 话单: ContentTab = { module: "cdr-analysis", title: "话单.csv", path: "/p/cdr.csv" }

/**
 * 挂一个 provider，并把 context 抓出来给测试直接驱动。
 * 消费者写法与 T011 的「模块动作」完全同构——不是测试专用后门。
 */
function mountProvider(initialModule?: string) {
  let tabs!: CenterTabs
  function Probe() {
    tabs = useCenterTabs()
    return null
  }
  mount(() => (
    <CenterTabsProvider initialModule={initialModule}>
      <Probe />
    </CenterTabsProvider>
  ))
  return tabs
}

describe("中心 tab 响应式状态（FR-004 / FR-006）", () => {
  test("在 provider 外用 useCenterTabs：直接抛错，不静默返回 undefined", () => {
    expect(() => useCenterTabs()).toThrow()
  })

  test("进门时的当前模块由 initialModule 决定", () => {
    expect(mountProvider("cdr-analysis").module()).toBe("cdr-analysis")
  })

  test("open：新 tab 追加到末尾并成为激活项", () => {
    const tabs = mountProvider()

    tabs.open(专案)
    tabs.open(话单)

    expect(tabs.tabs().map((tab) => tab.title)).toEqual(["专案A", "话单.csv"])
    expect(tabs.active()).toBe(contentTabKey(话单))
  })

  test("activate / close 经 context 生效并驱动视图", () => {
    const tabs = mountProvider()
    tabs.open(专案)
    tabs.open(话单)

    tabs.activate(contentTabKey(专案))
    expect(tabs.active()).toBe(contentTabKey(专案))

    tabs.close(contentTabKey(专案))
    expect(tabs.tabs().map((tab) => tab.title)).toEqual(["话单.csv"])
  })

  test("switchModule：只换当前模块，tabs 与激活态原样不动（FR-006 的单元级证据）", () => {
    const tabs = mountProvider("project")
    tabs.open(专案)
    tabs.open(话单)
    tabs.activate(contentTabKey(专案))

    tabs.switchModule("fund-analysis")

    expect(tabs.module()).toBe("fund-analysis")
    expect(tabs.tabs().map((tab) => tab.title)).toEqual(["专案A", "话单.csv"])
    expect(tabs.active()).toBe(contentTabKey(专案))
  })
})
