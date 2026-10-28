import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { SessionNav, type 可索引的一轮 } from "./session-nav"
import { 可读片段, 预览上限 } from "./session-nav-text"

/**
 * 索引轨 / 索引面板 / 悬停预览的规格（2026-10-14，照 DeepSeek 的做法做）。
 *
 * ## 这一份**只断结构**，不断几何
 *
 * happy-dom 不跑布局（`LEARNINGS #005-07`）⇒「轨有没有压住滚动条」「点一下真滚到那一轮」
 * 「短横间距是多少」这三件**本层一个都量不出来**，它们是真栈 `session-nav-real.spec.ts` 的判据。
 * 本层管的是**接线**：谁被画出来、**作用对象是谁**、点了回调收到什么。
 *
 * ⚠️ 「作用对象是谁」是独立的一条判据，不是「能开」的附带（`LEARNINGS #005-19`：只钉「菜单
 * 开了」，作用对象可以整段消失而测试全绿）。故**点第 2 行**这一条与「点了有反应」是分开的两条，
 * 且都要断言收到的是**第 2 条消息**。
 *
 * ## 悬停怎么模拟
 *
 * `mouseenter` / `mouseleave` 直派在元素上（它们不冒泡，本层也不需要冒泡——`onMouseEnter` 在
 * Solid 里不是委托事件、直接挂在元素上）。**不用** `:hover`：CSS 的悬停态在 happy-dom 里没有
 * 布局也没有真指针，量不到。
 */

/** 挂过的卸载函数，`afterEach` 里统一收（`LEARNINGS #005-03`）。 */
const 挂过的: Array<() => void> = []

afterEach(() => {
  // ⚠️ 顺序：**先 dispose、再清 body**（同 `session-panel.test.tsx`）。
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

function 挂(内容: () => JSX.Element): HTMLElement {
  const 宿主 = document.createElement("div")
  document.body.appendChild(宿主)
  挂过的.push(render(内容, 宿主))
  return 宿主
}

// ── 夹具 ────────────────────────────────────────────────────────────────────

const 三轮: 可索引的一轮[] = [{ id: "usr_1" }, { id: "usr_2" }, { id: "usr_3" }]

/** 一个用户打的文本块（`可读片段` 收窄到本模块真读的三样——`#004-07`）。 */
const 文本块 = (text: string): 可读片段[] => [{ type: "text", text }]

/** 三轮各自那句话：**每一轮的都不一样**，否则「作用对象是谁」那几条判不出东西来。 */
const 三句话: Record<string, 可读片段[]> = {
  usr_1: 文本块("第一问\n后面还有一行"),
  usr_2: 文本块("第二问"),
  usr_3: 文本块("第三问"),
}

interface 选项 {
  轮次?: 可索引的一轮[]
  当前轮id?: string
  片段?: (消息: 可索引的一轮) => 可读片段[] | undefined
  on选择?: (消息: 可索引的一轮) => void
}

function 挂轨(选项: 选项 = {}) {
  const 收到: 可索引的一轮[] = []
  const 宿主 = 挂(() => (
    <SessionNav
      轮次={选项.轮次 ?? 三轮}
      当前轮id={选项.当前轮id ?? "usr_3"}
      片段={选项.片段 ?? ((消息) => 三句话[消息.id])}
      右偏移={23}
      on选择={选项.on选择 ?? ((消息) => 收到.push(消息))}
    />
  ))
  return { 宿主, 收到 }
}

// ── 取件（断**布尔 / 字符串 / 个数**，不把 Solid 节点当实得值，`LEARNINGS #005-01`）────────

const 刻度们 = (宿主: HTMLElement) => [...宿主.querySelectorAll<HTMLElement>('[data-slot="session-nav-tick"]')]
const 面板个数 = (宿主: HTMLElement) => 宿主.querySelectorAll('[data-slot="session-nav-panel"]').length
const 行们 = (宿主: HTMLElement) => [...宿主.querySelectorAll<HTMLElement>('[data-slot="session-nav-row"]')]
const 行文字 = (行: HTMLElement) => 行.querySelector('[data-slot="session-nav-row-label"]')?.textContent ?? ""
// ⚠️ 预览盒按 `document` 取、**不按宿主取**：它挂 `Portal` 到 body 下（见「悬停预览」里那条结构判据），
// 宿主的子树里根本找不到它。`afterEach` 清的是 `document.body`，所以跨用例也不会串。
const 预览个数 = (_宿主: HTMLElement) => document.querySelectorAll('[data-slot="session-nav-preview"]').length
const 预览文字 = (_宿主: HTMLElement) => document.querySelector('[data-slot="session-nav-preview"]')?.textContent ?? ""

/**
 * 鼠标进 / 出。`mouseenter` / `mouseleave` 不冒泡，直派即到（Solid 把它们直接挂在元素上）。
 *
 * ⚠️ 因此**派发必须落在挂着监听器的那个元素上**：真浏览器里指针进到子元素会替我们把
 * `mouseenter` 补发给祖先，但 `dispatchEvent` 不替我们补（它只发给目标、不冒泡的事件到不了祖先）。
 */
const 进 = (元素: Element) => 元素.dispatchEvent(new MouseEvent("mouseenter"))
const 出 = (元素: Element) => 元素.dispatchEvent(new MouseEvent("mouseleave"))

/**
 * 「鼠标移进那一列」。
 *
 * 派在**整块**（`session-nav`，它与面板共同构成悬停区）上，与 `进/出` 的说明同因：监听器在那一块
 * 上，派在里面的短横上到不了它。
 */
const 打开面板 = (宿主: HTMLElement) => {
  const 块 = 宿主.querySelector<HTMLElement>('[data-slot="session-nav"]')
  if (!块) throw new Error('没找到 `[data-slot="session-nav"]`')
  进(块)
  return 块
}

describe("索引轨（右缘那一列短横）", () => {
  test("只有一轮 ⇒ 连轨都不出现（没什么可跳的）", () => {
    const { 宿主 } = 挂轨({ 轮次: [{ id: "usr_1" }] })

    expect(刻度们(宿主).length).toBe(0)
  })

  test("每一轮一枚短横，从上到下就是时间顺序", () => {
    const { 宿主 } = 挂轨()

    expect(刻度们(宿主).length).toBe(3)
  })

  test("⚠️ 轨本身一直悬着（它不许占会话的宽度）——父级 position:relative、自己 absolute", () => {
    const { 宿主 } = 挂轨()
    const 轨 = 宿主.querySelector<HTMLElement>('[data-slot="session-nav"]')

    // 断的是**两件事一起**：自己是绝对定位（脱离文档流 ⇒ 不挤会话），右缘落在一个变量上
    // （真栈实量的滚动条宽度 ＋ 缝，见 `右偏移` prop 的注释）。
    expect(轨?.style.position).toBe("absolute")
    expect(轨?.style.right).toBe("23px")
  })

  test("当前那一轮的短横带 `data-active`，别的不带", () => {
    const { 宿主 } = 挂轨({ 当前轮id: "usr_2" })

    expect(刻度们(宿主).map((枚) => 枚.getAttribute("data-active"))).toEqual([null, "true", null])
  })

  test("点某一枚短横 ⇒ 回调收到的是**那一枚**对应的那一轮（钉住作用对象，`#005-19`）", () => {
    const { 宿主, 收到 } = 挂轨()

    刻度们(宿主)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(收到.map((消息) => 消息.id)).toEqual(["usr_2"])
  })
})

describe("索引面板（鼠标移上去才出来）", () => {
  test("没悬停 ⇒ 面板不在", () => {
    const { 宿主 } = 挂轨()

    expect(面板个数(宿主)).toBe(0)
  })

  test("鼠标进轨 ⇒ 面板出来，一行一轮", () => {
    const { 宿主 } = 挂轨()

    打开面板(宿主)

    expect(面板个数(宿主)).toBe(1)
    expect(行们(宿主).length).toBe(3)
  })

  test("每行显示的是那一轮那句话的**第一行**", () => {
    const { 宿主 } = 挂轨()

    打开面板(宿主)

    expect(行们(宿主).map(行文字)).toEqual(["第一问", "第二问", "第三问"])
  })

  test("鼠标离开整块 ⇒ 面板收掉", () => {
    const { 宿主 } = 挂轨()
    打开面板(宿主)

    // 前置先钉「出来过」：不然「收掉」这条在一个从没开过的实现上照样绿。
    expect(面板个数(宿主)).toBe(1)

    出(宿主.querySelector<HTMLElement>('[data-slot="session-nav"]')!)

    expect(面板个数(宿主)).toBe(0)
  })

  test("⚠️ 面板是**挂在监听器那一块里面**的（往后代里挪鼠标不算「出去」——否则点不到任何一行）", () => {
    const { 宿主 } = 挂轨()
    打开面板(宿主)

    const 块 = 宿主.querySelector<HTMLElement>('[data-slot="session-nav"]')!
    const 板 = 宿主.querySelector<HTMLElement>('[data-slot="session-nav-panel"]')!

    // 判据是**包含关系**，不是「鼠标真的移过去了」：happy-dom 里没有真指针，「移过去会不会
    // 触发 mouseleave」量不出来。而这一步正是那条真行为（鼠标从轨滑到面板上、面板不收）的
    // **机制**——面板若是兄弟节点而不是后代，滑过去那一刻就 `mouseleave` 了（真栈可见）。
    expect(块.contains(板)).toBe(true)
  })

  test("点某一行 ⇒ 回调收到**那一行**对应的那一轮（不是第一行、也不是最后一行）", () => {
    const { 宿主, 收到 } = 挂轨()

    打开面板(宿主)
    行们(宿主)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(收到.map((消息) => 消息.id)).toEqual(["usr_2"])
  })

  test("那一轮没留下文字（只有工具块）⇒ 行还在，显示占位（它仍然是个能跳过去的目标）", () => {
    const { 宿主 } = 挂轨({
      轮次: [{ id: "usr_1" }, { id: "usr_2" }],
      片段: (消息) => (消息.id === "usr_2" ? [{ type: "tool" }] : 文本块("有字的那一轮")),
    })

    打开面板(宿主)

    expect(行们(宿主).map(行文字)).toEqual(["有字的那一轮", "（没有文字）"])
  })
})

describe("悬停预览（停在某一行上弹出的那段）", () => {
  test("没停在行上 ⇒ 没有预览", () => {
    const { 宿主 } = 挂轨()

    打开面板(宿主)

    expect(预览个数(宿主)).toBe(0)
  })

  test("停在某一行上 ⇒ 弹出那一轮的**全文**（这一处不是只取首行）", () => {
    const { 宿主 } = 挂轨()

    打开面板(宿主)
    进(行们(宿主)[0])

    expect(预览个数(宿主)).toBe(1)
    expect(预览文字(宿主)).toBe("第一问\n后面还有一行")
  })

  test("⚠️ 停在**第二行**上 ⇒ 弹的是第二行的内容（不是第一行的——「弹出来了」与「弹的是谁」是两条判据）", () => {
    const { 宿主 } = 挂轨()

    打开面板(宿主)
    进(行们(宿主)[1])

    expect(预览文字(宿主)).toBe("第二问")
  })

  test("停在超长的那一行上 ⇒ 截断 ＋「…」", () => {
    const { 宿主 } = 挂轨({
      轮次: [{ id: "usr_1" }, { id: "usr_2" }],
      片段: (消息) => 文本块(消息.id === "usr_2" ? "长".repeat(预览上限 + 40) : "短的"),
    })

    打开面板(宿主)
    进(行们(宿主)[1])

    expect(预览文字(宿主)).toBe("长".repeat(预览上限) + "…")
  })

  /**
   * ⚠️ 2026-10-28 用户实报：「完整的输入信息没有在最前端，当 AI 助手宽度不够的时候会被中栏遮挡」。
   *
   * 真栈实测的根因**不是层叠顺序**：越出右栏那一片（预览左端 155px）的 `elementsFromPoint`
   * 命中栈里**根本没有预览**，栈顶是中栏的 `center-empty` —— 它是被右栏壳
   * （`three-pane-right-card` / `aside[three-pane-right]`，两层都 `overflow: hidden`）在右栏边界
   * **裁掉了**（预览的包含块在裁剪盒内部 ⇒ CSS 规范下必被裁）。
   * ⇒ 预览必须**逃出右栏这棵裁剪树**：`Portal` 到 body 下 ＋ `position: fixed` 自定位。
   *
   * happy-dom 没有布局引擎、量不出「裁没裁」（`#005-07`），本层能钉的是机制本身：它还在不在
   * 会话树里。几何判据（越界那一点上能不能命中预览）在 `e2e/real-stack/session-nav-real.spec.ts` 的 ③b。
   */
  test("⚠️ 预览盒挂在 body 下（不在 `session-nav` 里）——逃开右栏的 overflow:hidden", () => {
    const { 宿主 } = 挂轨()

    打开面板(宿主)
    进(行们(宿主)[0])

    const 预览 = document.querySelector('[data-slot="session-nav-preview"]')
    expect(预览, "预览该画出来了").not.toBeNull()
    // ⚠️ 不断「父节点 === body」：Solid 的 `Portal` 会先建一层自己的包裹 div 再插进 body
    // （`solid-js/web` 的 `Portal` 实现），断那个只会钉住它的内部形状。要钉的是**机制**：
    // 预览已经离开宿主子树、落在 body 下。
    expect(宿主.contains(预览), "预览不该还在宿主（会话树）里——它的祖先右栏有 overflow:hidden").toBe(false)
    expect(document.body.contains(预览), "预览该挂在 body 下（Portal）").toBe(true)
    expect(
      预览!.closest('[data-slot="session-nav"]'),
      "预览不该还挂在会话树里——右栏那两层 overflow:hidden 会在右栏边界把它裁掉",
    ).toBeNull()
  })

  test("那一轮没有文字 ⇒ 不弹预览（不给一个空盒子）", () => {
    const { 宿主 } = 挂轨({
      轮次: [{ id: "usr_1" }, { id: "usr_2" }],
      片段: (消息) => (消息.id === "usr_2" ? [{ type: "tool" }] : 文本块("有字")),
    })

    打开面板(宿主)
    进(行们(宿主)[1])

    expect(预览个数(宿主)).toBe(0)
  })
})
