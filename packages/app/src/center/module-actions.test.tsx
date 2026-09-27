import { describe, expect, test } from "bun:test"
import { For, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { useModuleAction, type ModuleAction } from "./module-actions"
import { CenterTabsProvider, useCenterTabs, type CenterTabs } from "./tab-context"
import { contentTabKey } from "./tab-store"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 明细: ModuleAction = { title: "明细 - 广州××公司", content: "detail:acct-4419" }
const 图谱: ModuleAction = { title: "资金流转图谱", content: "graph:acct-4419" }

/**
 * 一个模块自己的面板：按钮就是「模块动作」，点了就触发。
 * F2+ 的模块 UI 就是这么用 `useModuleAction()` 的——001 尚无模块 UI，故由本探针驱动这条通路。
 * 探针**不是**测试专用后门，它就是模块动作的既定用法（对照 T010 的 `OpenTabs`）。
 */
function 动作面板(props: { actions: readonly ModuleAction[] }) {
  const run = useModuleAction()
  return (
    <For each={props.actions}>
      {(action) => (
        <button type="button" data-slot="module-action" onClick={() => run(action)}>
          {action.title}
        </button>
      )}
    </For>
  )
}

function mountCenter(initialModule?: string, actions: readonly ModuleAction[] = [明细, 图谱]) {
  let center!: CenterTabs
  function Probe() {
    center = useCenterTabs()
    return null
  }
  const host = mount(() => (
    <CenterTabsProvider initialModule={initialModule}>
      <Probe />
      <动作面板 actions={actions} />
    </CenterTabsProvider>
  ))
  return { center, host }
}

const 触发 = (host: HTMLElement, action: ModuleAction) => {
  const button = [...host.querySelectorAll<HTMLElement>("[data-slot='module-action']")].find(
    (el) => el.textContent === action.title,
  )
  if (!button) throw new Error(`面板里没有动作「${action.title}」`)
  button.click()
}

describe("模块动作打开中栏特有 tab（FR-010）", () => {
  /**
   * 需求守卫（非 RED 驱动）：这条断言在实现前就成立——`CenterTabsProvider` 初始就是空 tab。
   * 它守的是 FR-010 的「非预置常驻」：动作按钮先在，tab 不在；**不谎称它抓过 bug**。
   */
  test("进门时中栏一张 tab 都没有：特有 tab 由模块动作打开，非预置常驻", () => {
    const { center, host } = mountCenter("fund-analysis")

    expect(host.querySelectorAll("[data-slot='module-action']").length).toBe(2)
    expect(center.tabs()).toEqual([])
  })

  test("点模块动作：中栏打开该动作的 tab 并成为激活项", () => {
    const { center, host } = mountCenter("fund-analysis")

    触发(host, 明细)

    expect(center.tabs()).toEqual([
      { module: "fund-analysis", title: 明细.title, path: 明细.content },
    ])
    expect(center.active()).toBe(contentTabKey(center.tabs()[0]))
  })

  test("当前模块未定时不凭空开 tab：宁可不响应，也不给 tab 安一个假来源（FR-005）", () => {
    const { center, host } = mountCenter()

    触发(host, 明细)

    expect(center.tabs()).toEqual([])
  })

  /** 需求守卫（非 RED 驱动）：去重是 `openContentTab` 的既有语义（T005 循环 2），此处只证它经动作这条路也成立。 */
  test("同一动作连点两次：只切过去，不重复开", () => {
    const { center, host } = mountCenter("fund-analysis")

    触发(host, 明细)
    触发(host, 图谱)
    触发(host, 明细)

    expect(center.tabs().map((tab) => tab.title)).toEqual([明细.title, 图谱.title])
    expect(center.active()).toBe(contentTabKey(center.tabs()[0]))
  })

  /** 需求守卫（非 RED 驱动）：跨模块累积是 `openContentTab` + `switchModule` 的既有语义（T005/T010），此处只证来源模块跟着**触发时**的模块走。 */
  test("各模块的动作各自累积，每张 tab 带各自动作时的来源模块（FR-005 着色的前提）", () => {
    const { center, host } = mountCenter("fund-analysis")

    触发(host, 明细)
    center.switchModule("cdr-analysis")
    触发(host, 图谱)

    expect(center.tabs().map((tab) => [tab.module, tab.title])).toEqual([
      ["fund-analysis", 明细.title],
      ["cdr-analysis", 图谱.title],
    ])
  })
})
