import { describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { 会话重命名输入 } from "./session-rename"

/**
 * 会话重命名的**就地编辑器**——左栏右键菜单与右栏顶栏**共用这一个**。
 *
 * ## 为什么单独一个文件
 *
 * 用户对这个功能的要求是「两个入口，功能一致，直接复用，不要重复造轮子」。两个入口共用的东西
 * 只有两样：`session-actions.ts` 的 `重命名会话`（发请求）与**本组件**（改名字那一下的交互）。
 * 发请求那一半已经由 `session-actions.test.ts` 钉住（`改动` 只带 `{ sessionID, title }`）。
 * 这一半——**预填什么、什么时候算「改完了」、Ctrl/中文输入法下那个 Enter 算不算**——如果两个入口
 * 各写一遍，就正好是 `LEARNINGS #002-06` 那类「同一个判断两处各写一份」：改一处忘一处，
 * 而且**不报错、不变红**。
 *
 * ## 键盘语义的蓝本
 *
 * 上游 `pages/session/timeline/message-timeline.tsx` 的 `saveTitleEditor` / `InlineInput` 那一段
 * （同一个仓库里**已经在用**的「点标题就地改名」）——本组件是它的**收窄版**：去掉 mutation 与
 * 乐观更新，只留交互。三条语义逐条对齐：
 *
 * 1. Enter ⇒ 交出去；Escape ⇒ 什么都不交；
 * 2. `trim()` 之后为空、或与原样相同 ⇒ **不算一次改动**（清空标题不是重命名）；
 * 3. `event.isComposing || keyCode === 229` 时的 Enter **不交**——中文输入法里那个 Enter 是**选字**，
 *    不是「改完了」。放在本产品上这条不是洁癖：民警用中文输入法是常态。
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

/** 敲一个键。`合成中` 用来复现中文输入法里那个「选字」的 Enter。 */
function 敲(el: HTMLElement | null, key: string, 合成中 = false) {
  if (!el) throw new Error("输入框不在——这条用例的前提不成立（#004-14）")
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, isComposing: 合成中 }))
}

function 挂(props: { 原名?: string }) {
  const 提交过: string[] = []
  const 取消过: number[] = []
  const { host, dispose } = mount(() => (
    <会话重命名输入 原名={props.原名} on提交={(新名) => 提交过.push(新名)} on取消={() => 取消过.push(1)} />
  ))
  return { host, 提交过, 取消过, dispose }
}

describe("会话重命名输入（左栏 ＋ 右栏共用）", () => {
  test("是个真输入框，且**预填着当前的名字**（点开就能改，不用先把原名删掉）", () => {
    const { host } = 挂({ 原名: "8·17 资金梳理" })

    const el = 输入框(host)
    expect(el?.tagName).toBe("INPUT")
    expect(el?.value).toBe("8·17 资金梳理")
  })

  /**
   * 还没有名字的会话（左栏 `title` 是可选的）⇒ 预填空串，**不预填 id**。
   *
   * 预填 id 会让「改个名」变成「先把那串字母数字删掉」——而 id 是**机器读的**，画在输入框里
   * 会让人以为那就是名字。
   */
  test("原名还没有（`undefined`）⇒ 预填空串", () => {
    const { host } = 挂({})

    expect(输入框(host)?.value).toBe("")
  })

  test("输入框有可访问名称——不只靠上下文猜（DESIGN §4.3）", () => {
    const { host } = 挂({ 原名: "甲" })

    expect(输入框(host)?.getAttribute("aria-label")).toBeTruthy()
  })

  /**
   * 点开就**全选**原名（用户 2026-10-09 下达：「会话标题文字全部选中」）——一进来直接打新名字即可，
   * 不用先 Ctrl+A 或拖选。
   *
   * ⚠️ 全选发生在 `requestAnimationFrame` 里（`session-rename.tsx` 的 `ref`）⇒ 判据**必须**落在
   * 一次冲刷之后：同一刻读是 `0/0`。这不是「顺手 await」，是这条判据成立的前提（`LEARNINGS #006-19`
   * 同族：机制是「异步落地」，不是「不落地」）。探针实测（happy-dom 20.12.0）：`requestAnimationFrame`
   * 存在，且**一次 macrotask 内**回调完 ⇒ 一次 `setTimeout(0)` 就够。
   *
   * ⚠️ 判据取 `selectionStart/End`，**不取 `document.activeElement`**：同一次探针实测 `focus()` 之后
   * `activeElement` **不是**这个 input（happy-dom 里焦点不落地），而全选是**真的**——这条链上真的会变
   * 的只有 selection 那两个数（`#004-09`：判据要锚在「做那件事的那一行」）。
   */
  test("点开就全选原名（`selectionStart=0`、`selectionEnd`=名字长度）", async () => {
    const { host } = 挂({ 原名: "8·17 资金梳理" })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const el = 输入框(host)
    expect(el?.selectionStart).toBe(0)
    expect(el?.selectionEnd).toBe("8·17 资金梳理".length)
  })

  test("Enter ⇒ 交出**这一份新名字**，并且只交一次", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "新名字")
    敲(输入框(host), "Enter")

    expect(提交过).toEqual(["新名字"])
    expect(取消过).toEqual([])
  })

  /**
   * **Enter 之后紧接着失焦 ⇒ 仍然只交一次**（2026-10-09 真栈实测钉的这条）。
   *
   * 上面的「只交一次」只敲了 Enter、**没跟失焦**，所以它一直是绿的——而真栈上那一下会发**两条** PATCH。
   * 机制：Enter 里 `提交()` 一交出，调用方（左栏 `交改名` / 右栏）就 `set改名的(undefined)` 把**仍聚焦的**
   * 输入框**卸载**掉，Chromium 因此**补发一次 `blur`** ⇒ `onBlur={提交}` 又交一次。
   *
   * ⚠️ 本组件原先的注释断言「卸载一个仍聚焦的元素**不会**触发 blur（规范如此）」——**被实测证伪**：
   * 同一次改名在真栈上是两条同款 `PATCH`（body 逐字相同），而「只失焦、不按 Enter」只发一条。
   * happy-dom 里没有「卸载触发 blur」这回事（焦点不落地），所以这条用例**手动补一次 blur**来表示它——
   * 判据落在本组件真正做的那件事上：**一次编辑最多交一次**。
   */
  test("Enter 之后紧接着失焦 ⇒ 仍然只交一次（真栈上那一下会补发 blur）", () => {
    const { host, 提交过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "新名字")
    敲(输入框(host), "Enter")
    输入框(host)?.dispatchEvent(new FocusEvent("blur", { bubbles: false }))

    expect(提交过).toEqual(["新名字"])
  })

  /** 右栏顶栏那一下带得进空格（用户手打的），`trim` 是这里唯一的把关处。 */
  test("前后空白被 trim 掉再交出去", () => {
    const { host, 提交过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "  新名字  ")
    敲(输入框(host), "Enter")

    expect(提交过).toEqual(["新名字"])
  })

  test("Escape ⇒ **什么都不交**，喊取消（改到一半反悔了）", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "改了一半")
    敲(输入框(host), "Escape")

    expect(提交过).toEqual([])
    expect(取消过).toEqual([1])
  })

  /**
   * **Escape 之后紧接着失焦 ⇒ 依然什么都不交**——「取消」要真的取消。
   *
   * 与上面那条 Enter 同因：Escape 里喊了取消，调用方把输入框卸载掉，`blur` 随即补发 ⇒ `onBlur={提交}`
   * 会把**用户刚反悔掉的那份草稿**交出去。这比双发更坏：用户按了 Escape，名字却改了。
   * 「一次编辑只结一次账」的守卫必须把这条也罩住。
   */
  test("Escape 之后紧接着失焦 ⇒ 依然什么都不交（反悔了就是反悔了）", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "改了一半")
    敲(输入框(host), "Escape")
    输入框(host)?.dispatchEvent(new FocusEvent("blur", { bubbles: false }))

    expect(提交过).toEqual([])
    expect(取消过).toEqual([1])
  })

  /**
   * 走开（失焦）＝「我改完了」——蓝本 `message-timeline.tsx` 的 `onBlur={saveTitleEditor}`
   * 就是这个意思。少了这一支，用户点别处再点回来会发现改动没了。
   */
  test("失焦 ⇒ 与 Enter 同一条路：交出去", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "新名字")
    输入框(host)?.dispatchEvent(new FocusEvent("blur", { bubbles: false }))

    expect(提交过).toEqual(["新名字"])
    expect(取消过).toEqual([])
  })

  /**
   * 两条「不算一次改动」的情形，都走**取消**这一支（＝把编辑态收掉，什么请求都不发）。
   *
   * 不说「不发请求」而说「喊取消」：本组件手里没有请求，判据只能落在它真正做的那件事上。
   * 真正「不发请求」由 `改名草稿` 与 `重命名会话` 两层各钉一条（`session-actions.test.ts`）。
   */
  test("空草稿 ⇒ 不算改动：不交，喊取消（把标题清空不是一次重命名）", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "   ")
    敲(输入框(host), "Enter")

    expect(提交过).toEqual([])
    expect(取消过).toEqual([1])
  })

  test("与原名相同 ⇒ 不算改动：不交，喊取消（点开又原样关掉）", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "旧名字")
    敲(输入框(host), "Enter")

    expect(提交过).toEqual([])
    expect(取消过).toEqual([1])
  })

  /**
   * 中文输入法里**选字**那个 Enter 与**确认输入**那个 Enter 长得一模一样。
   * 不带这一条，民警每敲一个候选字就会被当成「改完了」。
   */
  test("输入法合成中的 Enter ⇒ 不交（那是选字，不是「改完了」）", () => {
    const { host, 提交过, 取消过 } = 挂({ 原名: "旧名字" })

    打字(输入框(host), "新名字")
    敲(输入框(host), "Enter", true)

    expect(提交过).toEqual([])
    expect(取消过).toEqual([])
  })
})
