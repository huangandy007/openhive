import { describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { 会话重命名输入 } from "./session-rename"

/**
 * 会话重命名的**就地编辑器**——左栏右键菜单与右栏顶栏**共用这一个**。
 *
 * ## 它只剩「包装器契约」这五条；交互语义不在这里
 *
 * 「改名字那一下」的全部判据（三条键盘语义、**一次性结算**守卫、中文输入法里那个 Enter、
 * `trim()` 之后算不算改过）都长在 `components/inline-rename-input.tsx`，那 14 条用例也在那儿。
 *
 * ⚠️ **这里不再重复那 14 条**（2026-10-10 收缩）：交互只有一份实现，就不该有两份断言盯着它
 * ——否则改一次交互会同时红两个文件，下一个人多半会去改**错的那个副本**（`LEARNINGS #002-06`
 * 同族：同一个判断两处各写一份）。本文件只钉「这个包装器**选对了哪三样**」。
 *
 * ## 三样里每一样都有人依赖，红了别当成洁癖
 *
 * | 选的是 | 谁在依赖 |
 * |---|---|
 * | `槽位="session-rename-input"` | `session-list.test.tsx` / `session-panel.test.tsx` 的选择器、`session-list.test.tsx` 的焦点断言（`INPUT[session-rename-input]`） |
 * | `可访问名称="会话名称"` | 编辑态与展示态**同名**（DESIGN §4.3）：屏幕阅读器读到的都是「会话名称」 |
 * | **不传占位** | 占位是**新建**那一支唯一的提示（没有原名可预填）；会话这一支总有名字可预填，不该跟文件树抢那句提示 |
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  return { host, dispose: render(element, host) }
}

const 输入框 = (host: HTMLElement) => host.querySelector<HTMLInputElement>("[data-slot='session-rename-input']")

/** 往输入框里打字：Solid 的 `onInput` 读的是 `event.currentTarget.value`，所以先落值再派事件。 */
function 打字(el: HTMLInputElement | null, 值: string) {
  if (!el) throw new Error("输入框不在——这条用例的前提不成立（#004-14）")
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function 挂(props: { 原名?: string }) {
  const 提交过: string[] = []
  const 取消过: number[] = []
  const { host, dispose } = mount(() => (
    <会话重命名输入 原名={props.原名} on提交={(新名) => 提交过.push(新名)} on取消={() => 取消过.push(1)} />
  ))
  return { host, 提交过, 取消过, dispose }
}

describe("会话重命名输入（左栏 ＋ 右栏共用）：包装器契约", () => {
  /**
   * 槽位名**逐字**是 `session-rename-input`——两个调用点的选择器与两处外部用例都按它查。
   * 用 `toBe` 而不是 `toBeTruthy()`：后者连「换了个名字」都拦不住（`#006-22` 同族：串匹配要盯真值）。
   */
  test("槽位名是 `session-rename-input`（两处调用点与外部用例按它查）", () => {
    const { host } = 挂({ 原名: "甲" })

    const el = host.querySelector("input")
    expect(el?.getAttribute("data-slot")).toBe("session-rename-input")
  })

  /** 编辑态与展示态**同名**——屏幕阅读器读到的都是「会话名称」（DESIGN §4.3）。 */
  test("可访问名称是「会话名称」（与展示态同名）", () => {
    const { host } = 挂({ 原名: "甲" })

    expect(输入框(host)?.getAttribute("aria-label")).toBe("会话名称")
  })

  /**
   * 原名**透传**：有名字就预填，没有（左栏 `title` 是可选的）就空串，**不预填 id**
   * ——id 是机器读的，「改个名」不该先从一串字母数字里删起。
   */
  test("原名透传：有就预填，`undefined` ⇒ 空串", () => {
    expect(输入框(挂({ 原名: "8·17 资金梳理" }).host)?.value).toBe("8·17 资金梳理")
    expect(输入框(挂({}).host)?.value).toBe("")
  })

  /**
   * 两个回调**透传**（各钉一条，`#005-12`：两个落点写两条）：Enter 交出去、Escape 什么都不交。
   * 「交的是什么、算不算改过」是唯一实现那一侧的判据，这里只看这条线通不通。
   */
  test("`on提交` 透传：Enter ⇒ 交出新名字", () => {
    const { host, 提交过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "新名字")
    输入框(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))

    expect(提交过).toEqual(["新名字"])
  })

  test("`on取消` 透传：Escape ⇒ 什么都不交，喊取消", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "改了一半")
    输入框(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))

    expect(提交过).toEqual([])
    expect(取消过).toEqual([1])
  })

  /**
   * **不传占位**——属性整个不出现。
   *
   * 判据用 `hasAttribute` 而不是 `getAttribute(...) toBeNull()`：后者在 happy-dom 里一旦红了
   * 会把整轮 `bun test` **挂死**（不是红，是哑），`LEARNINGS #005-01`。
   */
  test("不传占位 ⇒ 输入框上没有 `placeholder` 属性", () => {
    const { host } = 挂({ 原名: "旧名字" })

    expect(输入框(host)?.hasAttribute("placeholder")).toBe(false)
  })
})
