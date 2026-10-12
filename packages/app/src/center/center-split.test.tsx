/**
 * 两栏几何的**结构**判据。宽高、位置、缝在哪 —— 一律**真栈**量（`LEARNINGS #005-07` /
 * `#006-33`：happy-dom 没有 CSS 引擎，`clientWidth` 恒 0）。
 * 这里只断：几条 bar、几个内容区、有没有手柄、手柄朝哪儿、哪一栏带受焦指示。
 */

import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { CenterSplit } from "./center-split"
import { CenterTabsProvider, useCenterTabs } from "./tab-context"
import { type ContentTab } from "./tab-store"
import { createViewRegistry, type ViewComponent, type ViewRegistry } from "./view-registry"

// 夹具：`<CenterTabsProvider>` ＋ 一份最小 registry（照 `center-content.test.tsx` 的挂法）。
// `mount(element) => host` / 空注册表 整段抄那个文件（`LEARNINGS #004-12`）。
// ⚠️ 那个文件里「歇一拍」叫 `落定`（本 package 没有叫 `歇一拍` 的定义）⇒ 本文件里一行定出沿用名即可。
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))
const 歇一拍 = 落定

/** 本文件只断结构，不打开真视图——空注册表里没有任何扩展名，loader 不会被调到。 */
const 假视图: ViewComponent = () => <div data-slot="视图" />

/** 空注册表：一个扩展名都不认领（照 `center-content.test.tsx` 的 `注册` 工厂，`注册()` 即空表）。 */
const 注册 = (...extensions: string[]) => {
  const registry = createViewRegistry()
  registry.register({ extensions, load: async () => 假视图 })
  return registry
}
const 空注册表: ViewRegistry = 注册()

const 甲: ContentTab = { module: "project", title: "甲.txt", path: "资料/甲.txt" }
const 乙: ContentTab = { module: "project", title: "乙.txt", path: "资料/乙.txt" }

/**
 * 备好一个「已经分屏」的现场：甲开在左栏、乙开在右栏、按 `排列` 分屏，
 * 最后在**左栏**上按一下鼠标（于是受焦在 0，与真上手顺序一致——用户是先在左栏点开文件、
 * 再从那条栏上点分屏钮的）。
 *
 * `读` 是可选的旁听口：把 `center` 交给用例，好让它直接读状态（判据不能只有 DOM 那一半）。
 */
async function 备好(排列: "左右" | "上下", 读?: (center: ReturnType<typeof useCenterTabs>) => void) {
  function 现场() {
    const center = useCenterTabs()
    读?.(center)
    return (
      <>
        <button
          data-slot="备"
          onClick={() => {
            center.open(甲, 0)
            center.open(乙, 1)
            center.splitPane(排列)
          }}
        />
        <CenterSplit registry={空注册表} />
      </>
    )
  }
  const 宿主 = mount(() => (
    <CenterTabsProvider initialModule="project">
      <现场 />
    </CenterTabsProvider>
  ))
  宿主.querySelector<HTMLElement>("[data-slot='备']")!.click()
  await 歇一拍()
  const 左栏 = 宿主.querySelector<HTMLElement>("[data-slot='center-pane'][data-pane='0']")!
  左栏.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
  await 歇一拍()
  return 宿主
}

describe("CenterSplit", () => {
  test("未分屏 ⇒ 一条 tab 栏、一个内容区、没有手柄；右栏节点**压根不挂**", () => {
    const 宿主 = mount(() => (
      <CenterTabsProvider>
        <CenterSplit registry={空注册表} />
      </CenterTabsProvider>
    ))
    expect(宿主.querySelectorAll("[data-component='tab-bar']").length).toBe(1)
    expect(宿主.querySelectorAll("[data-slot='center-page']").length).toBe(1)
    expect(宿主.querySelector("[data-component='resize-handle']") === null).toBe(true)
    expect(宿主.querySelector("[data-slot='center-pane'][data-pane='1']") === null).toBe(true)
  })

  test("分屏（左右）⇒ 两条 tab 栏、两个内容区、一个 horizontal 手柄", async () => {
    // open(甲, 0) ＋ open(乙, 1) ＋ splitPane("左右") 之后
    const 宿主 = await 备好("左右")
    const 柄 = 宿主.querySelector<HTMLElement>("[data-component='resize-handle']")!
    expect(柄.getAttribute("data-direction")).toBe("horizontal")
    expect(柄.getAttribute("data-edge")).toBe("end")
    expect(宿主.querySelectorAll("[data-component='tab-bar']").length).toBe(2)
    expect(宿主.querySelectorAll("[data-slot='center-page']").length).toBe(2)
  })

  test("上下分屏 ⇒ 手柄是 vertical（术语只在这里翻一次）", async () => {
    const 宿主 = await 备好("上下")
    const 柄 = 宿主.querySelector<HTMLElement>("[data-component='resize-handle']")!
    expect(柄.getAttribute("data-direction")).toBe("vertical")
    expect(柄.getAttribute("data-edge")).toBe("end")
  })

  test("收起之后右栏**节点还在**（只是不露）——它那些 tab 不许被重读", async () => {
    const 宿主 = await 备好("左右")
    const 右栏 = () => 宿主.querySelector<HTMLElement>("[data-slot='center-pane'][data-pane='1']")
    expect(右栏()).not.toBe(null)
    expect(右栏()!.style.display).toBe("")          // 分屏时露着

    // 点右栏那条栏上的「收起」
    右栏()!.querySelector<HTMLElement>("[data-slot='unsplit-button']")!.click()
    await 歇一拍()

    // 节点**还在**（`display:none` 藏着），它那张 tab 也还在 —— 这一条就是
    // 「不许重读文件」那个决定的守护者：真摘了节点，再分屏回来 PDF 会回到第一页。
    expect(右栏()).not.toBe(null)
    expect(右栏()!.style.display).toBe("none")
    expect(右栏()!.textContent).toContain("乙.txt")
  })

  test("受焦栏带 data-focused，另一栏不带；单栏时一栏都不带", async () => {
    const 未分 = mount(() => (
      <CenterTabsProvider>
        <CenterSplit registry={空注册表} />
      </CenterTabsProvider>
    ))
    await 歇一拍()
    // 单栏时一个受焦条都没有（没有别处可选，画它是噪音）
    expect(未分.querySelectorAll("[data-slot='tab-bar-focus-bar']").length).toBe(0)

    const 宿主 = await 备好("左右")   // 备好里最后一步是点左栏（mousedown ⇒ focusPane(0)）
    const 栏 = (p: 0 | 1) => 宿主.querySelector<HTMLElement>(`[data-slot='center-pane'][data-pane='${p}']`)!
    // 分屏时恰好一条受焦条，且长在**受焦那一栏**的 tab 栏上
    expect(宿主.querySelectorAll("[data-slot='tab-bar-focus-bar']").length).toBe(1)
    expect(栏(0).querySelector("[data-slot='tab-bar-focus-bar']")).not.toBe(null)
    expect(栏(1).querySelector("[data-slot='tab-bar-focus-bar']") === null).toBe(true)
    expect(栏(0).querySelector<HTMLElement>("[data-component='tab-bar']")!.getAttribute("data-focused")).toBe("true")

    // 点右栏任意处 ⇒ 受焦条跟着搬过去
    栏(1).querySelector<HTMLElement>("[data-component='tab-bar']")!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    )
    await 歇一拍()
    expect(栏(0).querySelector("[data-slot='tab-bar-focus-bar']") === null).toBe(true)
    expect(栏(1).querySelector("[data-slot='tab-bar-focus-bar']")).not.toBe(null)
  })

  test("点右栏任意处 ⇒ 受焦切到右栏（`activePane` 的唯一写入口）", async () => {
    // 与上一条同一个手势，但读的是**状态**而不是 DOM：两处都要钉，因为 `activePane` 决定
    // 「下一个文件开进哪一栏」，而受焦条只是它的可见投影（判据不能只有投影那一半）。
    let 读: (() => 0 | 1) | undefined
    const 宿主 = await 备好("左右", (center) => {
      读 = () => center.activePane()
    })
    expect(读!()).toBe(0)
    const 右 = 宿主.querySelector<HTMLElement>("[data-slot='center-pane'][data-pane='1']")!
    右.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    await 歇一拍()
    expect(读!()).toBe(1)
  })
})
