import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { useTitlebarHostMount } from "./titlebar-host"
import { TopbarMount } from "./topbar-mount"

/**
 * 顶栏的**宿主**（`useTitlebarHostMount`）——2026-10-09 修「主界面顶栏一个元素都看不到」。
 *
 * ## 这一组要钉的那条不变量
 *
 * `pages/layout-new.tsx` 上那条 `[&_header[data-slot=titlebar-v2]>div]:hidden` 按
 * **header 的直接 `div` 子元素**隐掉上游那条带子（标签页条 / DEV 徽标 / 上游主页按钮）。
 * 而 `<Portal>` **必然**往宿主里塞一个**无名 `div`**（solid-js 1.9.10
 * `web/dist/web.js:731` `createElement("div")` ＋ `:742 el.appendChild(container)`；
 * 真浏览器实测同一形状）⇒ 宿主若是 **header 自己**，我们整棵顶栏就落进那个 div 里、
 * 被这条规则一起隐掉：顶栏 / 品牌 / 动作全是 **0×0**，而 header 本身 1438×36 可见。
 * 症状是「顶栏空白」，不是报错、不变红（`LEARNINGS #006-21` 那一族：判据写下来的前提
 * **没有量过**——`topbar-mount.tsx` 里那句「宿主是 span 所以规则吃不到」正是这句假前提）。
 *
 * 判据取**不变量本身**（顶栏不在 header 的直接 `div` 子元素里），不取实现细节
 * （「宿主是 span」是实现，不是性质——`LEARNINGS #006-18`：别断言「我传对了参数」）。
 * happy-dom 量不到布局与 CSS，所以这里只能钉**结构**；「它真的有面积」那一半在真浏览器上
 * 由探针量（本文件头这段数字就是那次实测的）。
 *
 * 挂过的记账 ＋ `afterEach` 先卸载再清 body（`LEARNINGS #005-03`：先清 body 会让 dispose
 * 去碰已经摘掉的节点）。
 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(element, host))
  return host
}

/** 上游那条 v2 标题栏的替身：**真的 `header`**，且带一个 `div` 子元素（上游那条带子）。 */
function 标题栏() {
  const header = document.createElement("header")
  header.setAttribute("data-slot", "titlebar-v2")
  const 带子 = document.createElement("div")
  带子.textContent = "DEV"
  header.appendChild(带子)
  document.body.appendChild(header)
  return header
}

/** header 的**直接 `div` 子元素**里，装着顶栏的那几个——判据是「个数为 0」。 */
const 直接div子元素里含顶栏的 = (header: HTMLElement) =>
  [...header.children].filter((c) => c.tagName === "DIV" && c.querySelector("[data-component='topbar']") !== null).length

/** 「某处没有元素」断在布尔上（`LEARNINGS #005-01`：把节点当实得值会让打印器停不下来）。 */
const 无 = (根: ParentNode, 选择器: string) => 根.querySelector(选择器) === null

/** 生产里的组装：宿主从 `useTitlebarHostMount()` 来，顶栏投进去。 */
function 工作台() {
  const host = useTitlebarHostMount()
  return <TopbarMount host={host()} user={undefined} />
}

afterEach(() => {
  while (挂过的.length > 0) 挂过的.pop()!()
  document.body.innerHTML = ""
})

describe("顶栏的宿主（useTitlebarHostMount）", () => {
  test("顶栏不能落在 header 的直接 div 子元素里（那条 >div 的隐藏规则够不着它）", () => {
    const header = 标题栏()
    mount(() => <工作台 />)

    // 前置：顶栏**确实渲染了**（否则「0 个」是空对空，`LEARNINGS #005-13`）。
    expect(无(header, "[data-component='topbar']")).toBe(false)
    // 被测属性：它不在 header 的直接 div 子元素里。
    expect(直接div子元素里含顶栏的(header)).toBe(0)
  })

  test("页面上没有 v2 标题栏时：不给宿主，顶栏一条都不渲染（宁缺勿假）", () => {
    const host = mount(() => <工作台 />)

    expect(无(host, "[data-component='topbar']")).toBe(true)
    expect(无(document.body, "[data-component='topbar']")).toBe(true)
  })

  test("卸载后不留下自建的宿主（挂载点若是我们造的，就得我们收）", () => {
    const header = 标题栏()
    mount(() => <工作台 />)

    挂过的.pop()!()

    expect(header.children.length).toBe(1)
    expect(无(header, "[data-slot='topbar-host']")).toBe(true)
  })
})
