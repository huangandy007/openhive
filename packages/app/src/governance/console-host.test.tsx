/**
 * 治理后台外壳（010 T001）：工作区 + 覆盖层。
 *
 * 钉三件事：打开时有覆盖层、背景不可被读屏/键盘够到、关闭后焦点回顶栏用户区。
 * 覆盖层内部由 `console.test.tsx` 钉，这里不重复。
 */

import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { GovernanceConsoleHost } from "./console-host"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function 挂上(open: () => boolean, onClose: () => void) {
  const root = document.createElement("div")
  document.body.appendChild(root)

  const 顶栏用户 = document.createElement("button")
  顶栏用户.dataset.slot = "topbar-user"
  顶栏用户.textContent = "用户区"
  document.body.appendChild(顶栏用户)

  挂过的.push(
    render(
      () => (
        <GovernanceConsoleHost open={open()} onClose={onClose}>
          <button data-testid="workspace-bg">工作区</button>
        </GovernanceConsoleHost>
      ),
      root,
    ),
  )

  return { root, 顶栏用户 }
}

const 覆盖层 = () => document.querySelector("[data-slot='governance-console']")
const 工作区盒 = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-slot='governance-workspace']")!

describe("治理后台 · 外壳", () => {
  test("关闭时：没有覆盖层，工作区不带 inert / aria-hidden", async () => {
    const { root } = 挂上(() => false, () => {})
    await flush()

    expect(覆盖层()).toBeNull()
    expect(工作区盒(root).hasAttribute("inert")).toBe(false)
    expect(工作区盒(root).getAttribute("aria-hidden")).toBeNull()
  })

  test("打开时：覆盖层出现，工作区被 inert + aria-hidden 关在背景里", async () => {
    const { root } = 挂上(() => true, () => {})
    await flush()

    expect(覆盖层()).not.toBeNull()
    expect(工作区盒(root).hasAttribute("inert")).toBe(true)
    expect(工作区盒(root).getAttribute("aria-hidden")).toBe("true")
  })

  test("返回工作台 ⇒ onClose；父层收起后覆盖层消失、背景解禁、焦点回顶栏用户区", async () => {
    const [open, setOpen] = createSignal(true)
    let 关闭次数 = 0
    const { root, 顶栏用户 } = 挂上(open, () => {
      关闭次数++
      setOpen(false)
    })
    await flush()

    document.querySelector<HTMLButtonElement>("[data-slot='governance-back']")?.click()
    await flush()

    expect(关闭次数).toBe(1)
    expect(覆盖层()).toBeNull()
    expect(工作区盒(root).hasAttribute("inert")).toBe(false)
    expect(工作区盒(root).getAttribute("aria-hidden")).toBeNull()
    expect(document.activeElement).toBe(顶栏用户)
  })

  test("外部直接收起（不点返回）也会解禁背景", async () => {
    const [open, setOpen] = createSignal(true)
    const { root } = 挂上(open, () => {})
    await flush()

    setOpen(false)
    await flush()

    expect(覆盖层()).toBeNull()
    expect(工作区盒(root).hasAttribute("inert")).toBe(false)
  })
})
