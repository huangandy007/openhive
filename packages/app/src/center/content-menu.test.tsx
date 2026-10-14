import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { 内容菜单 } from "./content-menu"
import { 订阅会话输入 } from "@/ai-session/send-to-session"

const 挂过的: Array<() => void> = []
afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
  // 接线盒是模块级状态 ⇒ 谁登记谁收回（同 Task 1 那条口径）。
  订阅会话输入(undefined)
})

function 挂(取选区: () => string) {
  const 宿主 = document.createElement("div")
  document.body.appendChild(宿主)
  挂过的.push(render(() => <内容菜单 取选区={取选区}><div data-slot="内容区">正文</div></内容菜单>, 宿主))
  return 宿主
}

const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))
/** 菜单渲染在 Portal 里（`document.body`），不在宿主里。 */
const 菜单 = () => document.querySelector("[data-component='context-menu-content']")

/** 在内容区上派一次右键。happy-dom 没有真实指针，直接派事件。 */
function 右键(宿主: HTMLElement) {
  const 目标 = 宿主.querySelector("[data-slot='内容区']")!
  目标.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }))
}

/** 点菜单里叫这个名字的那一项。找不到就抛——`find` 返回 `undefined` 时静默下去就是空转（`#005-38`）。 */
function 点项(名: string) {
  // ⚠️ `querySelectorAll<HTMLElement>`：不写 `as HTMLElement`——oxlint 的 `no-unsafe-type-assertion`
  // 会记一笔（同 `session-list.test.tsx` 那条口径）。
  const 项 = [...document.querySelectorAll<HTMLElement>("[data-slot='context-menu-item']")].find((el) =>
    el.textContent?.includes(名),
  )
  if (!项) throw new Error(`菜单里没有「${名}」这一项`)
  // ⚠️ Kobalte 的选择发生在 `pointerup`（`menu-item-base` 的 `onPointerUp`：`e.button === 0`
  // ⇒ `onSelect()`），`.click()` 触发不到 ⇒ 走真实指针序列（同 `file-tree.test.tsx` 的 `点菜单项`）。
  for (const 类型 of ["pointerdown", "pointerup"])
    项.dispatchEvent(new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}

describe("中栏右键菜单", () => {
  test("没选中 ⇒ 不接管，菜单不出来（放行浏览器原生菜单）", async () => {
    const 宿主 = 挂(() => "   ")
    右键(宿主)
    await 落定()
    expect(菜单() === null).toBe(true)
  })

  test("有选中 ⇒ 菜单出来，且有两项", async () => {
    const 宿主 = 挂(() => "张三\t1200")
    右键(宿主)
    await 落定()
    // ⚠️ 别把 DOM 节点直接喂给 `expect(...)`：`expect(节点).toBeNull()` 一旦红了会把整轮
    // `bun test` 挂死（不是红，是哑，`LEARNINGS #005-01`）⇒ 一律比较**布尔**。
    const 面板 = 菜单()
    expect(面板 === null).toBe(false)
    const 文案 = 面板?.textContent ?? ""
    expect(文案).toContain("复制")
    expect(文案).toContain("发送到会话")
  })

  test("点「发送到会话」⇒ 选中的那段进了接线盒那头的收件口", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 宿主 = 挂(() => "张三\t1200")
    右键(宿主)
    await 落定()
    点项("发送到会话")
    expect(收到).toEqual(["张三\t1200"])
  })

  /** 判据 8 的右键那一支：超限**一个字都不发**（拖拽那一支在 Task 3 的 (b)）。 */
  test("选中超过 50 行 ⇒ 一个字都不发", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => 收到.push(文本))
    const 五十一行 = Array.from({ length: 51 }, (_, i) => `第${i}行`).join("\n")
    const 宿主 = 挂(() => 五十一行)
    右键(宿主)
    await 落定()
    点项("发送到会话")
    expect(收到.length).toBe(0)
  })

  /**
   * 判据 7 的**前半**（不插入）已由 Task 1 的单测钉住（`发送到会话` 无收件口 ⇒
   * `{ok:false, 原因:"没有会话"}`，且收件口一次都没被调）。
   *
   * ⚠️ **这里刻意不写用例**：本来想加一条「右栏没开会话 ⇒ 点下去不抛」，但那是一条
   * **没有任何断言**的用例 —— 它不会红、不会绿出信息，只是"跑过了"。本 skill 的评审规则
   * 点名这种形状是缺陷（a test that asserts nothing），本轮 plan 预检时按规则删掉了它。
   * 判据 7 的**后半**（那句提示文案）本机测不了，如实进缺口表 §8：真栈人眼确认（Task 6 Step 3）。
   */
})
