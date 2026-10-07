import { describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { SidebarTabs, type SidebarTabKey } from "./sidebar-tabs"

/**
 * 左栏 tab 容器（005 T019 / 设计 §2 ②）：`[会话] [文件]`，默认「文件」。
 *
 * happy-dom **没有 CSS 引擎**——判据全是**结构不变量**（槽位在不在、属性对不对、点了通知谁），
 * 不是像素。**`hidden` 属性**是本文件的中心：它既是「哪一个 pane 此刻该显示」的唯一真源，
 * 也是「另一个 pane 并没有被卸载」的证据。
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()
const tab = (host: HTMLElement, key: SidebarTabKey) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='sidebar-tab'][data-tab='${key}']`)
const 各tab = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-slot='sidebar-tab']")]
const pane = (host: HTMLElement, key: SidebarTabKey) =>
  host.querySelector<HTMLElement>(`[role='tabpanel'][data-pane='${key}']`)

/**
 * 这个 pane 被藏起来了吗？——返回**布尔**，不是节点。
 *
 * ⚠️ 不能写成 `expect(槽(host, "x")).toBeNull()`：断言红了会把整轮 `bun test` **挂死**
 * （`LEARNINGS #005-01`：被 Solid 渲染过的节点会让 bun 的实得值打印器停不下来，45s 仍在跑）。
 * 断在布尔上，红的时候打印的是 `false`，毫秒级。
 */
const 隐藏了 = (el: HTMLElement | null) => el !== null && el.hasAttribute("hidden")

/**
 * 一个**有内部状态**的假 body，用来量「切 tab 有没有把它卸载重挂」。
 *
 * 刻意不用真 `FileTree`：本文件的判据应当只依赖 `SidebarTabs` 自己的契约（body 由调用方注入），
 * 不该跟着文件树的 DOM 走。真树的那条在 `workspace-entry.test.tsx`。
 */
function 探针() {
  const [次数, set次数] = createSignal(0)
  return (
    <button type="button" data-slot="probe" onClick={() => set次数((n) => n + 1)}>
      {次数()}
    </button>
  )
}

/**
 * `接住` = 调用方是否把 `onSelect` 回写进 `active`。
 * 传 `false` 是为了量**受控性**：组件不该有自己的 tab 状态。
 */
function 挂(初始: SidebarTabKey = "files", 接住 = true) {
  const [active, setActive] = createSignal<SidebarTabKey>(初始)
  const 喊过: SidebarTabKey[] = []
  const host = mount(() => (
    <SidebarTabs
      active={active()}
      onSelect={(key) => {
        喊过.push(key)
        if (接住) setActive(key)
      }}
      files={<探针 />}
    />
  ))
  return { host, 喊过 }
}

const 敲 = (el: HTMLElement | null, key: string) =>
  el?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

describe("SidebarTabs 左栏 tab 容器（设计 §2 ②）", () => {
  test("两个 tab 齐备、顺序固定：会话 → 文件（设计 §2：只有这两个）", () => {
    const { host } = 挂()

    expect(各tab(host).map((el) => el.getAttribute("data-tab"))).toEqual(["session", "files"])
    expect(各tab(host).map((el) => el.textContent?.trim())).toEqual(["会话", "文件"])
  })

  test("tablist 有可访问名称——两个裸词不足以说明这排东西是什么", () => {
    const { host } = 挂()

    const 列表 = host.querySelector("[role='tablist']")

    expect(列表?.getAttribute("aria-label")).toBeTruthy()
  })

  test("激活的那个 tab 带 aria-selected=true，另一个 false", () => {
    const { host } = 挂("files")

    expect(tab(host, "files")?.getAttribute("aria-selected")).toBe("true")
    expect(tab(host, "session")?.getAttribute("aria-selected")).toBe("false")
  })

  /**
   * 选中态＝品牌浅金（005 Step 5 审查 **X5-1**；第二轮补这条断言，**R2-03**）。
   *
   * 为什么非钉不可：`aria-selected` 只说明**谁是激活的**，不说明**它长什么样**。把 `TAB_ACTIVE`
   * 整体改回中性 `layer-03`（＝改之前的样子：选中与 hover 同一个底，鼠标一移开就分不清
   * 哪行还选着），**上面那条照样绿**（`#004-02`：两个投影各长各的，没有相等断言把他们钉在一起）。
   * 实得值取 **`className` 字符串**（不是节点），红了毫秒级出结果（`#005-01`）。
   */
  test("选中态走品牌浅金，未选中的不带；两个 tab 的 hover 都是 house 标准", () => {
    const { host } = 挂("files")
    const 金 = "bg-[var(--v2-background-bg-accent-soft)]"
    const hover = "hover:bg-v2-overlay-simple-overlay-hover"

    // 被测属性：激活的那个是浅金
    expect(tab(host, "files")?.className).toContain(金)
    // 对照：另一个**不是**——只写上面那条的话，把浅金加到两个 tab 上也算「过」
    expect(tab(host, "session")?.className).not.toContain(金)
    // 未选中的那个 hover 走 house 标准；**选中的那个不带 hover**——本组件的选中态是
    // **另一条整串**（`TAB_ACTIVE`），不是叠加：两条同权重的底同时挂着时谁生效只看 CSS 先后，
    // 所以这里刻意不给它 hover 底。这条断的就是「选中项划过去不变色」，将来要改先回答
    // 「选中 ＋ hover 该长什么样」。
    expect(tab(host, "session")?.className).toContain(hover)
    expect(tab(host, "files")?.className).not.toContain(hover)
  })

  test("只有激活的 pane 可见；另一个带 hidden（不是「仍在屏幕上」）", () => {
    const { host } = 挂("files")

    expect(隐藏了(pane(host, "files"))).toBe(false)
    expect(隐藏了(pane(host, "session"))).toBe(true)
  })

  test("受控：点另一个 tab 只喊回调，自己不切（接不住的调用方看到的 DOM 一动不动）", () => {
    const { host, 喊过 } = 挂("files", false)

    tab(host, "session")?.click()

    expect(喊过).toEqual(["session"])
    expect(tab(host, "files")?.getAttribute("aria-selected")).toBe("true")
    expect(隐藏了(pane(host, "session"))).toBe(true)
  })

  test("「文件」pane 的 body 由调用方注入——组件不认识文件树", () => {
    const { host } = 挂("files")

    expect(pane(host, "files")?.contains(槽(host, "probe"))).toBe(true)
  })

  test("「会话」pane 是**显式空态**，不是白板——说清「没接入」而不是「没有会话」", () => {
    const { host } = 挂("session")

    expect(文本(host, "session-empty")).toBe("会话列表未接入")
    expect(槽(host, "session-empty")?.getAttribute("data-state")).toBe("empty")
  })

  test("← / → 把焦点与选中一起移到另一个 tab（本 task 的「外壳自己的键盘」）", () => {
    const { host, 喊过 } = 挂("files")
    tab(host, "files")?.focus()

    敲(tab(host, "files"), "ArrowLeft")

    expect(喊过).toEqual(["session"])
    expect(隐藏了(pane(host, "files"))).toBe(true)
    // 焦点要**跟着**走：只切内容不动焦点，键盘用户下一次 Tab 会从自己站的地方跳走。
    // ⚠️ 断在**布尔**上，不写成 `.toBe(tab(host, "session"))`——实得值若是被 Solid 渲染过的
    // 节点，红了会把整轮 `bun test` **崩掉**（`#005-01` 的第二次实证：变异验证时写成节点比较，
    // 红出来是 Bun internal assertion failure ＋ panic，29s、峰值 4.68GB、**一条结果都取不到**）。
    // 断在布尔上，红时打印的是 `false`。
    expect(document.activeElement === tab(host, "session")).toBe(true)
  })

  test("← 与 → 都能切（只有两个 tab，两个方向等价但不该有一个是死的）", () => {
    const { host, 喊过 } = 挂("files")

    敲(tab(host, "files"), "ArrowRight")

    expect(喊过).toEqual(["session"])
  })

  test("别的键不管事——不把 ↑↓ 顺手吃掉（↑↓ 是树里的，归 T007 的挂账）", () => {
    const { host, 喊过 } = 挂("files")

    // 对照先行（`LEARNINGS #002-02`）：先证明这套机制是活的，否则「按了没反应」在
    // 一个什么都没实现的组件上也成立——那条断言就是空的
    敲(tab(host, "files"), "ArrowLeft")
    expect(喊过).toEqual(["session"])
    喊过.length = 0

    敲(tab(host, "session"), "ArrowDown")
    敲(tab(host, "session"), "Enter")

    expect(喊过).toEqual([])
  })

  test("roving tabindex：只有激活的那个 tab 在 Tab 顺序里", () => {
    const { host } = 挂("files")

    expect(tab(host, "files")?.getAttribute("tabindex")).toBe("0")
    expect(tab(host, "session")?.getAttribute("tabindex")).toBe("-1")
  })

  test("切到「会话」再切回来，「文件」pane 里的东西**没有被重建**（两件事都钉：同节点 ＋ 状态还在）", () => {
    const { host } = 挂("files")
    const 前 = 槽(host, "probe")
    槽(host, "probe")?.click()
    槽(host, "probe")?.click()
    expect(文本(host, "probe")).toBe("2")

    tab(host, "session")?.click()
    tab(host, "files")?.click()

    // 同节点＝没被卸载重挂；「2」＝内部信号也确实活着。
    // ⚠️ 比布尔而不是比节点：理由同上（`#005-01`，两边都是被渲染过的节点）。
    expect(槽(host, "probe") === 前).toBe(true)
    expect(文本(host, "probe")).toBe("2")
  })

  test("tab ↔ tabpanel 的 ARIA 关系接对了（aria-controls 指得到、aria-labelledby 回得来）", () => {
    const { host } = 挂("files")

    for (const key of ["session", "files"] as const) {
      const 目标 = tab(host, key)?.getAttribute("aria-controls")

      expect(目标).toBeTruthy()
      // ⚠️ 比布尔而不是比节点（同上 `#005-01`：两边都是节点）
      expect(host.querySelector(`[id='${目标}']`) === pane(host, key)).toBe(true)
      expect(pane(host, key)?.getAttribute("aria-labelledby")).toBe(tab(host, key)?.id)
    }
  })
})
