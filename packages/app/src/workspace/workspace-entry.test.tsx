import { beforeEach, describe, expect, test } from "bun:test"
import { onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { useCenterTabs } from "@/center/tab-context"
import { type ContentTab } from "@/center/tab-store"
import { setCurrentUser } from "./current-user"
import { WorkspaceEntry } from "./workspace-entry"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 上游 `Titlebar` 的顶栏右侧注入点；测试里造一个同用途的容器代替真顶栏。 */
function titlebarSlot() {
  const slot = document.createElement("div")
  document.body.appendChild(slot)
  return slot
}

const entries = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']"),
]

const railLabels = (host: HTMLElement) => entries(host).map((el) => el.getAttribute("aria-label"))

const currentModule = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-slot='rail-entry'][aria-current='page']")?.getAttribute("aria-label")

const 入口 = (host: HTMLElement, label: string) => {
  const found = entries(host).find((el) => el.getAttribute("aria-label") === label)
  if (!found) throw new Error(`图标栏里没有「${label}」`)
  return found
}

const text = (root: HTMLElement, slot: string) => root.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

describe("WorkspaceEntry 进入三栏工作台的入口", () => {
  // 身份是模块级接入缝（F2 才写），测试之间必须复位，否则互相串味。
  beforeEach(() => setCurrentUser(undefined))

  test("进入后落在三栏工作台：图标栏 + 中栏都就位，默认停在第一个入口", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <div data-slot="center-content">中栏内容</div>
      </WorkspaceEntry>
    ))

    expect(railLabels(host)).toEqual(["项目管理", "AI 资产", "AI 会话", "话单分析", "资金分析", "系统设置"])
    expect(host.querySelector("[data-slot='three-pane-center']")).not.toBeNull()
    expect(text(host, "center-content")).toBe("中栏内容")
    expect(currentModule(host)).toBe("项目管理")
  })

  test("图标栏在三栏左侧（DESIGN §4.1：图标栏 → 三栏）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    const 工作台 = host.querySelector("[data-component='workspace-entry']")

    expect(工作台?.firstElementChild?.getAttribute("data-component")).toBe("rail")
  })

  test("点图标栏入口切换当前停留的模块", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    入口(host, "资金分析").click()

    expect(currentModule(host)).toBe("资金分析")
  })

  test("没有注入点时顶栏不渲染（不存在的挂载点不该被硬塞进中栏）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(host.querySelector("[data-component='topbar']")).toBeNull()
  })

  test("顶栏挂进上游注入点，而不是留在工作台里（DESIGN §4.4）", () => {
    const slot = titlebarSlot()
    const host = mount(() => <WorkspaceEntry titlebarRight={() => slot}>中栏</WorkspaceEntry>)

    expect(slot.querySelector("[data-slot='topbar-brand-name']")).not.toBeNull()
    expect(host.querySelector("[data-component='topbar']")).toBeNull()
  })

  test("身份未就位时顶栏照常，但不给用户区（宁缺勿假）", () => {
    const slot = titlebarSlot()
    mount(() => <WorkspaceEntry titlebarRight={() => slot}>中栏</WorkspaceEntry>)

    expect(text(slot, "topbar-brand-name")).toBe("OpenHive")
    expect(slot.querySelector("[data-slot='topbar-user']")).toBeNull()
  })

  test("身份就位后顶栏显示用户区（F2 的接入点）", () => {
    const slot = titlebarSlot()
    mount(() => <WorkspaceEntry titlebarRight={() => slot}>中栏</WorkspaceEntry>)

    setCurrentUser({ name: "张三", policeId: "012345" })

    expect(text(slot, "topbar-user-name")).toBe("张三")
    expect(text(slot, "topbar-user-police-id")).toBe("警号: 012345")
  })
})

const 专案: ContentTab = { module: "project", title: "专案A", path: "/p/a.intent" }
const 话单: ContentTab = { module: "cdr-analysis", title: "话单.csv", path: "/p/cdr.csv" }

/**
 * 中栏里替模块开 tab 的消费者——写法与 T011 的「模块动作」同构（`useCenterTabs().open`），
 * 不是测试专用后门。001 尚无模块动作，故这条通路由测试直接驱动。
 */
function OpenTabs(props: { tabs: ContentTab[] }) {
  const center = useCenterTabs()
  onMount(() => props.tabs.forEach((tab) => center.open(tab)))
  return null
}

const tabTitles = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-slot='tab-title']"),
].map((el) => el.textContent)

describe("中栏 tab 与左栏模块切换的联动（FR-006）", () => {
  test("中栏顶部挂着 tab 栏，模块开的 tab 显示在里面", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))

    const bar = host.querySelector("[data-component='tab-bar']")
    expect(bar).not.toBeNull()
    expect(bar?.closest("[data-slot='three-pane-center']")).not.toBeNull()
    expect(tabTitles(host)).toEqual(["专案A", "话单.csv"])
  })

  test("左栏切模块后，中栏已有 tab 仍在、激活态不变（FR-006 出参）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))
    const 激活 = () =>
      host.querySelector<HTMLElement>("[data-slot='tab'][aria-selected='true']")?.getAttribute("data-module")

    入口(host, "资金分析").click()

    expect(currentModule(host)).toBe("资金分析")
    expect(tabTitles(host)).toEqual(["专案A", "话单.csv"])
    expect(激活()).toBe("cdr-analysis")
  })

  test("点 tab 栏上的关闭：这张 tab 真的从状态里消失（挂载不是摆设）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))

    host.querySelector<HTMLElement>("[data-slot='tab'] [data-slot='tab-close']")?.click()

    expect(tabTitles(host)).toEqual(["话单.csv"])
  })

  test("点非激活的 tab：切过去（激活态跟着走）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))
    const 激活模块 = () =>
      host.querySelector<HTMLElement>("[data-slot='tab'][aria-selected='true']")?.getAttribute("data-module")

    // 后打开的那张是激活的（打开即切过去），随后点第一张应当把激活态挪过去
    expect(激活模块()).toBe("cdr-analysis")

    host.querySelectorAll<HTMLElement>("[data-slot='tab']")[0]?.click()

    expect(激活模块()).toBe("project")
  })
})
