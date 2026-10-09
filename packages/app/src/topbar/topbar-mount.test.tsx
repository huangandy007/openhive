import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { currentUser, setCurrentUser } from "@/workspace/current-user"
import { TopbarMount } from "./topbar-mount"

/**
 * 挂过的一律记账、`afterEach` 里卸载（`LEARNINGS #005-03`）。
 *
 * 这一组**咬得到**那条教训：`currentUser` 是**模块级**信号，而顶栏的 `user` 是按它的
 * getter 传进来的 ⇒ 旧实例只要还活着，下一条用例里 `setCurrentUser(...)` 就会把它一起唤醒。
 * 顺序要紧：**先卸载、再清 `document.body`**（反了的话 dispose 会去碰已经摘掉的节点）。
 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(element, host))
  return host
}

/** 上游那条 v2 标题栏的替身：一个真的容器元素（生产里是 `header[data-slot="titlebar-v2"]`）。 */
function 宿主() {
  const slot = document.createElement("div")
  document.body.appendChild(slot)
  return slot
}

/**
 * 「某处没有元素」**断在布尔上**，不要把节点当实得值——失败时 bun 要打印那个节点，
 * 而被 Solid 渲染过的节点会让打印器停不下来（`LEARNINGS #005-01`：不是红，是哑）。
 */
const 无 = (根: ParentNode, 选择器: string) => 根.querySelector(选择器) === null

const text = (根: ParentNode, slot: string) =>
  根.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

afterEach(() => {
  while (挂过的.length > 0) 挂过的.pop()!()
  document.body.innerHTML = ""
  setCurrentUser(undefined)
})

describe("顶栏的挂载（TopbarMount）", () => {
  test("没给宿主时：一条顶栏都不渲染（不存在的挂载点不该被硬塞进工作台）", () => {
    const host = mount(() => <TopbarMount host={undefined} user={undefined} />)

    expect(无(host, "[data-component='topbar']")).toBe(true)
    expect(无(document.body, "[data-component='topbar']")).toBe(true)
  })

  test("顶栏挂进宿主元素里，而不是留在自己那一层（DESIGN §4.4）", () => {
    const slot = 宿主()
    const host = mount(() => <TopbarMount host={slot} user={undefined} />)

    expect(slot.querySelector("[data-slot='topbar-brand-name']")).not.toBeNull()
    expect(无(host, "[data-component='topbar']")).toBe(true)
  })

  test("身份未就位时顶栏照常，但不给用户区（宁缺勿假）", () => {
    const slot = 宿主()
    mount(() => <TopbarMount host={slot} user={currentUser()} />)

    expect(text(slot, "topbar-brand-name")).toBe("OpenHive")
    expect(无(slot, "[data-slot='topbar-user']")).toBe(true)
  })

  test("身份就位后顶栏显示用户区（F2 的接入点，按模块级信号走）", () => {
    const slot = 宿主()
    mount(() => <TopbarMount host={slot} user={currentUser()} />)

    setCurrentUser({ name: "张三", policeId: "012345" })

    expect(text(slot, "topbar-user-name")).toBe("张三")
    expect(text(slot, "topbar-user-police-id")).toBe("警号: 012345")
  })

  test("主页按钮的按下态由外部给（判据属于路由，不在这层算）", () => {
    const slot = 宿主()
    mount(() => <TopbarMount host={slot} user={undefined} homeActive />)

    expect(slot.querySelector<HTMLElement>("[data-slot='topbar-home']")?.getAttribute("aria-pressed")).toBe("true")
  })
})
