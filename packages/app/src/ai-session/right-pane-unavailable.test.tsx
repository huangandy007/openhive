import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { 右栏打不开 } from "./right-pane-unavailable"
import type { 打不开的说法 } from "./right-pane-failure"

/**
 * 右栏「这一场打不开」那张卡片（`right-pane-unavailable.tsx`）。
 *
 * 本文件只钉**渲染**：给了说法就画出来、没详情就不留空行、没给关闭回调就不画那颗钮。
 * 「什么错 ⇒ 什么说法」在 `right-pane-failure.test.ts` 里钉；「右栏有没有把它画出来」
 * 在假后端 spec 里钉（本文件挂的是裸组件，没有 provider 链，量不到那条接线）。
 *
 * ⚠️ 两条本仓的测试纪律，本次都踩在脚下：
 * - 查「有没有某个节点」**不用** `expect(节点).toBeNull()`——`LEARNINGS #005-01`：
 *   那写法红了会把整轮 `bun test` **挂死**（不是红，是哑）。这里一律数 `querySelectorAll(...).length`。
 * - 挂过的**必须卸载**（`#005-03`：谁建的响应式作用域谁收），且卸载在清 body **之前**。
 */
const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

function 挂(内容: () => JSX.Element): HTMLElement {
  const 宿主 = document.createElement("div")
  document.body.appendChild(宿主)
  挂过的.push(render(内容, 宿主))
  return 宿主
}

const 说 = (值: Partial<打不开的说法> = {}): 打不开的说法 => ({
  标题: "找不到此会话",
  关闭标签文案: "关闭标签页",
  ...值,
})

const 取 = (宿主: HTMLElement, 记号: string) => 宿主.querySelector(`[data-slot='${记号}']`)

describe("右栏打不开那张卡片", () => {
  test("标题与详情都上屏（两句都能读得到）", () => {
    const 宿主 = 挂(() => <右栏打不开 说法={说({ 详情: "此标签页指向的会话已不存在于此服务器上。" })} />)

    expect(取(宿主, "unavailable-title")?.textContent).toBe("找不到此会话")
    expect(取(宿主, "unavailable-detail")?.textContent).toBe("此标签页指向的会话已不存在于此服务器上。")
  })

  test("没有详情 ⇒ **不画**那一行（别留一个空 div 把版式撑乱）", () => {
    const 宿主 = 挂(() => <右栏打不开 说法={说()} />)

    expect(取(宿主, "unavailable-title")?.textContent).toBe("找不到此会话")
    expect(宿主.querySelectorAll("[data-slot='unavailable-detail']").length).toBe(0)
  })

  test("给了「关闭标签」⇒ 画那颗钮，点一下**只调一次**", () => {
    let 点过 = 0
    const 宿主 = 挂(() => <右栏打不开 说法={说()} 关闭标签={() => (点过 += 1)} />)

    const 钮 = 取(宿主, "unavailable-close") as HTMLButtonElement | null
    expect(钮?.textContent).toContain("关闭标签页")

    钮?.click()
    expect(点过).toBe(1)
  })

  test("没给「关闭标签」⇒ 一颗钮都不画（例如这个会话压根没有标签可关）", () => {
    const 宿主 = 挂(() => <右栏打不开 说法={说()} />)

    // 「点了也没用」的钮比没有钮更糟：它把「没路走」伪装成「可以点一下试试」。
    expect(宿主.querySelectorAll("[data-slot='unavailable-close']").length).toBe(0)
  })
})
