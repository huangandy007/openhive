import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { SessionList, type 会话列表行 } from "./session-list"

/**
 * 左栏「会话」tab 的列表（设计 §7）。
 *
 * happy-dom **没有 CSS 引擎**（`LEARNINGS #005-07`）⇒ 视觉约定只能断 **class 串**，而且断的是
 * **类名集合**不是子串（`#006-22`：`border-b` ⊂ `border-base`，`toContain` 等于没判）。
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()
const 各行 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-slot='session-item']")]
const 行id = (host: HTMLElement) => 各行(host).map((el) => el.getAttribute("data-session-id"))

/** 断 class 串的**唯一**正确取法（`#006-22`）。 */
const 类集 = (el: HTMLElement | null) => (el?.className ?? "").split(/\s+/)

/**
 * 选中态＝品牌浅金（与 `file-tree.tsx` 的 `ROW_SELECTED` / `sidebar-tabs.tsx` 的 `TAB_ACTIVE`
 * 同一个 token，005 Step 5 审查 X5-1：选中与 hover **必须是两种颜色**）。
 */
const 浅金 = "bg-[var(--v2-background-bg-accent-soft)]"

const 行 = (id: string, title?: string): 会话列表行 => ({ id, ...(title === undefined ? {} : { title }) })

function 挂(props: {
  directory?: string
  sessions?: readonly 会话列表行[]
  currentID?: string
  接住?: boolean
}) {
  const 选过: string[] = []
  const 新建过: string[] = []
  const 重命名过: Array<[string, string]> = []
  const 删过: string[] = []
  const host = mount(() => (
    <SessionList
      directory={props.directory}
      sessions={props.sessions}
      currentID={props.currentID}
      onSelect={(id) => 选过.push(id)}
      onNewSession={(dir) => 新建过.push(dir)}
      onRenameSession={(id, title) => 重命名过.push([id, title])}
      onDeleteSession={(id) => 删过.push(id)}
    />
  ))
  return { host, 选过, 新建过, 重命名过, 删过 }
}

/**
 * ── 右键菜单的探针（Kobalte `ContextMenu`）─────────────────────────────────────
 *
 * 与 `file-tree.test.tsx` / `workspace-entry.test.tsx` 那两套**同形**（同一件东西的第三份夹具，
 * 各写各的：`LEARNINGS #004-11`——每个测试文件有自己的全局域）。两处硬约束照抄：
 *
 * - 菜单**Portal 到 `document.body`**，不在 `host` 里 ⇒ 一律查 `document`；
 * - 关闭时**先播退场动画、动画结束才卸载**，而 happy-dom 没有 CSS 引擎 ⇒ 元素一直留着
 *   ⇒ 判断「开着」只能看 `data-expanded`，不能看「元素在不在」（查元素会读成「永远开着」）。
 * - ⚠️ **关是异步落地的**（2026-10-09 探针实测：`closeOnSelect` 为默认值的项，点击**同一刻**
 *   `data-expanded` 仍是 `true`，到 +50ms（或一次宏任务）才变 `false`）⇒ 凡是断言「**还开着**」
 *   的用例，判据一律放在一次 `await` 之后，否则它对着「关」与「不关」两态同值、毫无观测力。
 */
const 菜单内容 = () => document.querySelector<HTMLElement>("[data-component='context-menu-content']")
const 有菜单 = () => 菜单内容()?.hasAttribute("data-expanded") ?? false
const 菜单项 = (action: string) => 菜单内容()?.querySelector<HTMLElement>(`[data-action='${action}']`)
const 菜单动作 = () =>
  [...(菜单内容()?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].map((el) => el.getAttribute("data-action"))
const 菜单文案 = () =>
  [...(菜单内容()?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].map((el) => el.textContent?.trim())

/** 右键一个元素——`contextmenu` 冒泡到组件的触发器上，菜单就开在指针处。 */
const 右键 = (el: HTMLElement | undefined) =>
  el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))

/** 点一个菜单项：Kobalte 在 `pointerup` 上选中，单发 `.click()` **不够**（`file-tree.test.tsx` 实测）。 */
const 点菜单项 = (action: string) => {
  const el = 菜单项(action)
  if (!el) throw new Error(`菜单里没有「${action}」——这条用例的前提不成立（#004-14）`)
  for (const 类型 of ["pointerdown", "pointerup"])
    el.dispatchEvent(
      new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
    )
}

/** 某一行上那个就地改名输入框（编辑态才有）。 */
const 改名框 = (host: HTMLElement, index: number) =>
  host.querySelectorAll<HTMLElement>("[data-slot='session-item']")[index]?.querySelector<HTMLInputElement>(
    "[data-slot='session-rename-input']",
  )

/**
 * 那一行在编辑态吗——**返回布尔**。
 *
 * ⚠️ 不写成 `expect(那个元素).not.toBeNull()`：`LEARNINGS #005-01` —— 断言失败要把**实得值**
 * 打印出来，而被 Solid 渲染过的节点会让打印器停不下来（实测 45s 未结束、被 `timeout` 杀掉）。
 * 红了要打印的是 `false`，不是一棵树。
 */
const 在改 = (host: HTMLElement, index: number) => 改名框(host, index) != null

/** 往改名框里打字：Solid 的 `onInput` 读 `event.currentTarget.value`，先落值再派事件。 */
function 打字(el: HTMLInputElement | null | undefined, 值: string) {
  if (!el) throw new Error("改名框不在——这条用例的前提不成立（#004-14）")
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function 敲(el: HTMLElement | null | undefined, key: string) {
  if (!el) throw new Error("改名框不在——这条用例的前提不成立（#004-14）")
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
}

/**
 * 焦点此刻落在谁身上——**返回字符串**。
 *
 * ⚠️ 不返回节点：`LEARNINGS #005-01` —— 断言失败要打印实得值，而被 Solid 渲染过的节点会让 bun 的
 * 打印器停不下来（实测 45s 未结束、被 `timeout` 杀掉）。字符串红了打印的就是「BODY」这种一眼可读的东西。
 */
const 焦点 = () => {
  // 不写成 `as HTMLElement`：`tagName` 与 `getAttribute` 在 `Element` 上就有，
  // 而那句断言会被 oxlint 的 `no-unsafe-type-assertion` 记一笔（本次实测命中 1 条）。
  const el = document.activeElement
  if (!el) return "(null)"
  const slot = el.getAttribute("data-slot")
  return el.tagName + (slot ? `[${slot}]` : "")
}

/** 让 `requestAnimationFrame` 与菜单那边的 `setTimeout(0)` 都跑完（真实节奏：宏任务 → 帧 → 宏任务）。 */
const 冲刷 = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 菜单 Portal 到 `document.body` 且关闭后**不卸载**（见上）⇒ 不清就会串到下一条用例，
 * 而上面那些探针查的是**整个 document**。同 `file-tree.test.tsx` 的 `afterEach`。
 */
afterEach(() => {
  document.body.innerHTML = ""
})

describe("SessionList 左栏会话列表（设计 §7）", () => {
  test("列出会话，用 title 渲染（没有 title 就退回 id，不画一个空行）", () => {
    const { host } = 挂({
      directory: "/workspaces/u1/p1",
      sessions: [行("s1", "8·17 资金梳理"), 行("s2")],
    })

    expect(行id(host)).toEqual(["s1", "s2"])
    expect(各行(host).map((el) => el.textContent?.trim())).toEqual(["8·17 资金梳理", "s2"])
  })

  /**
   * **筛法与右栏共用同一份**（`session-actions.ts` 的 `可列出的会话`，006 Step 5 的 D1）：
   * 子会话（`parentID`）不是一个能切过去的对等会话；归档（`time.archived`）＝冻结，切过去是只读。
   *
   * ⚠️ 本组件**不许**自己写一遍 `filter`：两处各写一份时，「左栏列出的」与「右栏能点的」会分家，
   * 而且**不报错、不变红**（`LEARNINGS #002-06`）。
   */
  test("子会话与归档的**不列**（筛法是右栏那一份，不是这里另写一遍）", () => {
    const { host } = 挂({
      directory: "/workspaces/u1/p1",
      sessions: [
        { id: "父", title: "父会话" },
        { id: "子", title: "子会话", parentID: "父" },
        { id: "归档", title: "归档会话", time: { archived: 1_759_600_000_000 } },
      ],
    })

    expect(行id(host)).toEqual(["父"])
  })

  test("点一行只喊 `onSelect(id)`，自己不切（受控组件：同 `ProjectAnchor` / `FileTree` 的口径）", () => {
    const { host, 选过 } = 挂({
      directory: "/workspaces/u1/p1",
      sessions: [行("s1", "甲"), 行("s2", "乙")],
    })

    各行(host)[1]?.click()

    expect(选过).toEqual(["s2"])
  })

  /**
   * 当前会话那一行是**品牌浅金**，别的行**不是**（设计 §7「当前会话浅金高亮」）。
   *
   * 负向那一半不是装饰（`#005-07`：只写正向那条时，把整个列表刷成浅金也算过）。
   */
  test("当前会话那一行是浅金，其余行不是（正向 ＋ 负向对照）", () => {
    const { host } = 挂({
      directory: "/workspaces/u1/p1",
      sessions: [行("s1", "甲"), 行("s2", "乙")],
      currentID: "s2",
    })

    expect(类集(各行(host)[1])).toContain(浅金)
    expect(类集(各行(host)[0])).not.toContain(浅金)
    // X5-1 真正要的那件事：**选中与 hover 是两个不同的 token**（改之前两者都是 `layer-03`，
    // 同一个值 ⇒ 鼠标移开后分不清哪一行还选着）。判法是让「不选的那一行确实带着 hover」——
    // 这样两边一比就比出来了。（**不断「选中行不许有 hover」**：选中行带着 hover 是本仓既有的
    // 写法，`file-tree.tsx` 的 `classList={{ [ROW]: true, [ROW_SELECTED]: selected() }}` 正是如此，
    // 两个 token 同时在场时谁生效由 CSS 先后决定。断言「不许有」是在发明一条仓库里没有的规则。）
    expect(类集(各行(host)[0])).toContain("hover:bg-v2-overlay-simple-overlay-hover")
    expect(浅金).not.toBe("hover:bg-v2-overlay-simple-overlay-hover")
  })

  test("当前会话在 DOM 上也说得出来（`aria-current`）——不只是颜色", () => {
    const { host } = 挂({
      directory: "/workspaces/u1/p1",
      sessions: [行("s1", "甲"), 行("s2", "乙")],
      currentID: "s2",
    })

    expect(各行(host)[1]?.getAttribute("aria-current")).toBe("true")
    expect(各行(host)[0]?.hasAttribute("aria-current")).toBe(false)
  })

  /**
   * 「＋」＝新增会话（设计 §7：会话 tab 标题行右侧那个）。**只在目录已知时画**——
   * 没有目录时建出来的会话不属于任何项目（掉进 SDK 的默认目录），界面看着像建成了。
   *
   * 回调**把目录原样带回去**：判据只有这一处读，调用方不必再判一次「目录有没有」。
   */
  test("目录未知 ⇒ 不画「＋」（建出来的会话不属于任何项目）", () => {
    const { host, 新建过 } = 挂({ sessions: [行("s1", "甲")] })

    expect(槽(host, "session-new") === null).toBe(true)
    expect(新建过).toEqual([])
  })

  test("目录已知 ⇒ 画「＋」，落在标题行里；点它回调**带着那个目录**", () => {
    const { host, 新建过 } = 挂({ directory: "/workspaces/u1/p1", sessions: [] })

    const 按钮 = 槽(host, "session-new")
    expect(按钮 === null).toBe(false)
    // 位置判据：它在**这个 pane 自己的标题行**里，不在 `role=tablist` 里
    //（tablist 里只许有 tab，塞个按钮进去屏幕阅读器读到的是「第三个 tab」）
    expect(槽(host, "session-list-bar")?.contains(按钮)).toBe(true)

    按钮?.click()

    expect(新建过).toEqual(["/workspaces/u1/p1"])
  })

  /**
   * 「＋」这颗钮的**视觉规格**（2026-10-10 用户下达；参考材料 `images/screen/2026-10-10_192112.png`）。
   *
   * 用户原话：「左栏"会话"Tab页面的"新建会话"图标按钮不明显，我担心初始用户难以找到，为了突出，
   * 我希望把这里的图标设计成〈截图〉这种样式」——截图是一颗**深色实心圆角矩形 ＋ 白字**的钮。
   *
   * 落点取仓里**现成的设计系统件**，不手搓颜色：`ButtonV2 variant="contrast"`。`contrast` 的底/字
   * 正是 `--v2-background-bg-contrast`（浅色主题 grey-1000 近黑、深色主题 grey-700）
   * ＋ `--v2-text-text-contrast`（浅色 near-white、深色 grey-100），并且自带
   * hover / pressed / focus-visible / disabled 四态 ⇒ **不新增 app 级 CSS**，也不落一组只在本地成立的色值。
   *
   * ⚠️ 判据的**分工**（别把这一条读成「外观已经验过了」）：happy-dom **没有 CSS 引擎**
   *（`#005-07`）⇒ 这里能钉的只有「**用了哪一档**」——设计系统钮 ＋ `contrast` 档 ＋ 带字；
   * 「**真的是深色实心、字真的看得清**」要真栈量（`e2e/real-stack/session-new-button-real.spec.ts`
   * 量盒子的底色/字色与对比度）。两层各钉一半，谁都替代不了谁（同 `#004-02`：一份东西两个投影）。
   */
  test("「＋」＝设计系统那颗**深色实心**钮（`contrast`），并且带「新建会话」四个字与 plus 图标", () => {
    const { host } = 挂({ directory: "/workspaces/u1/p1", sessions: [] })

    const 钮 = 槽(host, "session-new")
    expect(钮 === null).toBe(false)

    // ① 它是**仓里现成那颗设计系统钮**，不是我手搓的一颗 —— 换回手搓按钮这条就红。
    expect(钮?.getAttribute("data-component")).toBe("button-v2")
    // ② 深色实心那一档（截图那个底/字就是 `contrast`，见文件头：token 在两套主题下都成立）。
    expect(钮?.getAttribute("data-variant")).toBe("contrast")
    // ③ 它是**带字**的钮：「不明显」这件事的正面解药就是这四个字。
    //  ⚠️ 用**全等**不用包含（`#006-22`：`toContain` 是子串匹配）——顺带钉住「旧那个全角『＋』字符
    //  没有被留成第二个加号」（`icon="plus"` 已经画了一个）。
    expect(钮?.textContent?.trim()).toBe("新建会话")
    // ④ 图标走设计系统的 plus，不是全角字符（全角「＋」在不同字体下宽度会歪）。
    expect(钮?.querySelector("[data-slot='icon-svg']") === null).toBe(false)

    // ⑤ 负向：**旧钮那两个记号一个都不该在**——`text-v2-text-text-muted`（无底色的小灰字）与
    //  `hover:bg-v2-overlay-simple-overlay-hover`（hover 才现形的幽灵钮）。
    //  ⚠️ 按 `#006-22` 取**类名集合**取，不取子串。据实记它的**射程**：它只咬得住
    //  「新钮上又被贴回旧 token」，**咬不住**「整个钮被换回手搓版」——那一半归 ①② 条。
    expect(类集(钮)).not.toContain("text-v2-text-text-muted")
    expect(类集(钮)).not.toContain("hover:bg-v2-overlay-simple-overlay-hover")
  })

  /**
   * 空态。**三种「什么都没列出来」不是一回事**，屏幕上却长得一样（`#002-02`）：
   *
   * - 目录未知（没选项目）⇒ 什么都不画：上面的锚点行已经说了「未选择项目」，这里再写一句是重复;
   * - 数据还没到（`sessions === undefined`）⇒ **也不画**：说「暂无会话」等于把「还没问到」
   *   说成「问到了，一场都没有」；
   * - 目录和在手的表都有、就是空的 ⇒ 「暂无会话」，这一句是真的。
   */
  test("目录已知但一场会话都没有 ⇒ 「暂无会话」，且**不**画「加载中…」", () => {
    const { host } = 挂({ directory: "/workspaces/u1/p1", sessions: [] })

    expect(文本(host, "session-empty")).toBe("暂无会话")
    // 对照（`#006-22` 的口径：一个视觉/文案约定要配一条「另一边不带」的负向断言，
    // 否则「两个都画」也过）。
    expect(槽(host, "session-loading") === null).toBe(true)
  })

  /**
   * 「还没问到」是**第三态**，不是「没有」——2026-10-09 用户实报：切到没访问过的项目后，
   * 左栏先显示「暂无会话」、几秒后才列出新项目的会话。
   *
   * ⚠️ 这一条钉的是**组件**那一半（三态各画什么）；「接线层有没有把在途错传成空表」是另一
   * 半，组件测试够不着（`sidebar-sessions.tsx` 的文件头写着它为什么不带测试），由真栈
   * `e2e/real-stack/sidebar-project-switch-real.spec.ts` 钉住（`#006-18` 的分工）。
   */
  test("数据还没到（undefined）⇒ 画「加载中…」，**不**画空态（「还没问到」不是「没有」）", () => {
    const { host } = 挂({ directory: "/workspaces/u1/p1", sessions: undefined })

    // 被测属性在前（`#004-14`）：这条用例红的时候，要红在「说了假话」那一条上。
    expect(槽(host, "session-empty") === null).toBe(true)
    expect(文本(host, "session-loading")).toBe("加载中…")
  })

  test("目录未知 ⇒ 两个都不画（锚点行已经说了「未选择项目」）", () => {
    const { host } = 挂({ sessions: [] })

    expect(槽(host, "session-empty") === null).toBe(true)
    expect(槽(host, "session-loading") === null).toBe(true)
  })

  /**
   * 左栏**不放每行的常驻图标**——重命名 / 删除走**右键菜单**。
   *
   * ## 这条用例的来历（自我描述改过一次，改的是描述不是判据）
   *
   * 原注释写的是「重命名 / 删除 / 导出在右栏『⋯』菜单里（设计 §7 原文），左栏不重复放图标」。
   * 前半句**已经过期**：2026-10-09 用户下达了「左栏会话 tab 右键有重命名 / 删除」——
   * 这些动作左栏也够得着了（而且右栏那个「⋯」菜单**全仓根本不存在**，那句话从一开始就是
   * 一条没核过的记述）。后半句「不重复放图标」**没变**，本用例守的就是它：行上不许长出一排
   * 常驻图标——那会变成 `ProjectAnchor` 那种每行带图标的列表，属过度实现。
   *
   * ⚠️ `querySelectorAll("button").length === 0` 这一半还有一条**结构**上的理由，比样式重要：
   * `<button>` 里再嵌一个 `<button>` 是非法 HTML（浏览器会把结构拆掉），所以「改名时要换成输入框
   * 而不是往里塞一个」不是审美选择。编辑态那条结构判据在下面那组里。
   */
  test("行上不放常驻图标：没有标着「重命名」/「删除」的钮", () => {
    const { host } = 挂({ directory: "/workspaces/u1/p1", sessions: [行("s1", "甲")] })

    expect(各行(host)[0]?.querySelectorAll("button").length).toBe(0)
    expect(host.querySelectorAll("[aria-label='删除'], [aria-label='重命名']").length).toBe(0)
  })
})

/**
 * 左栏右键菜单（用户 2026-10-09 下达）。
 *
 * ## 两个入口、一份实现
 *
 * 「重命名」与右栏顶栏那个是**同一件事**：交互都由 `session-rename.tsx` 的 `会话重命名输入`
 * 承担（它的键盘语义在 `session-rename.test.tsx` 里钉过一遍，**不在这里再钉一遍**，
 * `LEARNINGS #002-06`），请求都走 `session-actions.ts` 的 `重命名会话`。本组只钉
 * **这一层真正做的事**：菜单里有什么、**作用对象是哪一行**、什么时候进编辑态、什么时候才算删。
 *
 * 「删除」走**菜单项就地二次确认**（用户选的那条）：点一下那项变成「确认删除？」，再点才删。
 */
describe("SessionList 右键菜单（左栏）", () => {
  const 造 = () =>
    挂({ directory: "/workspaces/u1/p1", sessions: [行("s1", "甲"), 行("s2", "乙")], currentID: "s1" })

  test("右键某一行 ⇒ 菜单开出来，里面正好两项：重命名 → 删除", () => {
    const { host } = 造()

    右键(各行(host)[1])

    expect(有菜单()).toBe(true)
    expect(菜单动作()).toEqual(["rename", "delete"])
    expect(菜单文案()).toEqual(["重命名", "删除"])
  })

  /**
   * 「作用对象是哪一行」是这类菜单**最常坏**的一处，而且坏了不报错：`file-tree.tsx` 那条长注释
   * 记着同一个坑（`onContextMenu` 挂错层 ⇒ 菜单照开、作用对象永远是「没有」）。
   * 所以断言必须落在**第二行**上——右键第一行的话，「取了第一行」与「取对了」两种实现都对得上。
   */
  test("作用对象是**右键那一行**：改的是 s2，s1 一个字段都没动", () => {
    const { host, 重命名过 } = 造()

    右键(各行(host)[1])
    点菜单项("rename")
    打字(改名框(host, 1), "乙改")
    敲(改名框(host, 1), "Enter")

    expect(重命名过).toEqual([["s2", "乙改"]])
    // 对照：第一行仍在展示态（它的名字没被拿去改）
    expect(各行(host)[0]?.tagName).toBe("BUTTON")
    expect(各行(host)[0]?.textContent?.trim()).toBe("甲")
  })

  /**
   * 编辑态**换掉**那个 `<button>`，不是往里塞一个 `<input>`——`<button>` 里放 `<input>` 是非法
   * 嵌套（浏览器会把 DOM 拆开，Solid 的 `ref` 与事件随后全落在错位的节点上）。
   *
   * ⚠️ 行**本身**还在（`data-session-id` 没变）：换的是「把这一行画成什么样」，不是「这一行是谁」。
   */
  test("点「重命名」⇒ 那一行换成输入框，预填它自己的名字；`data-session-id` 不变", () => {
    const { host } = 造()

    右键(各行(host)[1])
    点菜单项("rename")

    const 行们 = 各行(host)
    // 判据是**结构**不是标签名：它不再是个 `<button>`，而且里头**没有** `<button>`。
    expect(行们[1]?.tagName).not.toBe("BUTTON")
    expect(行们[1]?.querySelectorAll("button").length).toBe(0)
    expect(在改(host, 1)).toBe(true)
    expect(改名框(host, 1)?.value).toBe("乙")
    // 行**本身**还在：换的是「这一行画成什么样」，不是「这一行是谁」
    expect(行们[1]?.getAttribute("data-session-id")).toBe("s2")
    // 对照：别的行照旧是按钮
    expect(行们[0]?.tagName).toBe("BUTTON")
  })

  /**
   * 点完「重命名」**真等它一拍**之后，输入框还活着、而且**焦点在它身上**。
   *
   * ## 上面那条为什么一直是绿的（而真栈上是坏的）
   *
   * 上一条在**同一刻**读——`点菜单项` 是同步的，`会话重命名输入` 那个 `requestAnimationFrame(…)`
   * 与 Kobalte 菜单那边的 `setTimeout(0)` 都还没跑。判据落在机制**落地之前**，对着「好」与「坏」
   * 两态同值 ⇒ 毫无观测力（`LEARNINGS #006-17` 同族）。真栈上是「等了 30ms 到 1000ms」读的，所以
   * 那里看得见坏；这里必须补一次冲刷才看得到同一件事。
   *
   * ## 机制（2026-10-09 探针实测，两层）
   *
   * ① **焦点被菜单的陷阱抢回去**：`@kobalte/core/dist/chunk/ISKHZMHS.js` 的 `onFocusOut` 挂在
   *    **document** 上，判据是 `!contains(container, target)` ⇒ 拉回 `lastFocusedElement`。我们的
   *    输入框在菜单**外**（它在列表那一行里）⇒ 那次 `el.focus()` **在同一调用栈里**就被抢走。
   * ② 抢走 ⇒ 输入框失焦 ⇒ `onBlur={提交}` ⇒ 草稿没改 ⇒ `on取消` ⇒ 调用方收掉编辑态 ⇒ 组件卸载。
   *
   * 真浏览器上还有第三层（菜单卸载时把焦点丢回 `document.body`），且 `focusin` 从未派发到输入框，
   * 所以那边表现为「框还在、但 `activeElement` 是 `BODY`」——两层症状同源，见 `state.md` 的实测记录。
   *
   * ## 为什么这里要「点之前先冲刷一拍」
   *
   * 这不是为了把用例凑绿，是**真实节奏**：菜单开出来之后，它自己那记延迟自动聚焦
   * （`H6DSIDEC.js:438` 的 `tryAutoFocus`，`deferAutoFocus` ⇒ `setTimeout(0)`）先把焦点收进菜单，
   * 人**看得见**这一项了才去点它。少了这一拍，测的就变成「右键与点菜单项落在**同一个 tick**」——
   * 那个窗口里站起来的是**菜单挂载时**那记延迟自动聚焦（`ISKHZMHS.js:97`），与鼠标 / 键盘 / 长按
   * 任何一条真人路径都无关（那记是 `setTimeout(0)`，真人交互必然晚于它）。2026-10-09 实测：这一拍
   * 补上之后绿、去掉就红——但**去掉时的红是 `#006-17` 那一类**（前提不成立），不是产品缺陷
   * （判据同 `#006-16`：那条路径在界面上走不到）。
   */
  test("点「重命名」之后等一拍：输入框还在，焦点也在它身上（不被菜单的焦点陷阱抢走）", async () => {
    const { host } = 造()

    右键(各行(host)[1])
    await 冲刷()
    点菜单项("rename")
    await 冲刷()

    // 被测属性：焦点归这次编辑所有。断言比的是**字符串**，红了读得到「实得 BODY / DIV」（`#005-01`）。
    expect(焦点()).toBe("INPUT[session-rename-input]")
    // 伴随：那一行还得在编辑态——它今天会自己关掉，是上面那条焦点断言红了的**原因**，不是它的重复。
    expect(在改(host, 1)).toBe(true)
  })

  test("编辑态里按 Enter ⇒ 喊 `onRenameSession(id, 新名)`，那一行回到按钮", () => {
    const { host, 重命名过 } = 造()

    右键(各行(host)[1])
    点菜单项("rename")
    打字(改名框(host, 1), "新名字")
    敲(改名框(host, 1), "Enter")

    expect(重命名过).toEqual([["s2", "新名字"]])
    expect(各行(host)[1]?.tagName).toBe("BUTTON")
  })

  test("编辑态里按 Escape ⇒ **什么都不喊**，那一行回到按钮、文本还是原名", () => {
    const { host, 重命名过 } = 造()

    右键(各行(host)[1])
    点菜单项("rename")
    打字(改名框(host, 1), "改到一半")
    敲(改名框(host, 1), "Escape")

    expect(重命名过).toEqual([])
    expect(各行(host)[1]?.tagName).toBe("BUTTON")
    expect(各行(host)[1]?.textContent?.trim()).toBe("乙")
  })

  /** 同一时刻只开一行（右键第二行改名时，第一行必须退回去）。 */
  test("改名只开一行：先改 s1，再右键 s2 改名 ⇒ s1 退回按钮", () => {
    const { host } = 造()

    右键(各行(host)[0])
    点菜单项("rename")
    expect(在改(host, 0)).toBe(true)
    // s1 是当前会话（`造()` 里 `currentID: "s1"`）——编辑态里它**仍然**是「当前」那一个：
    // 换的是「画成什么样」，不是「哪一行选着」。少了这一条，改名时选中态会看着跳走。
    expect(各行(host)[0]?.getAttribute("aria-current")).toBe("true")

    右键(各行(host)[1])
    点菜单项("rename")

    expect(在改(host, 0)).toBe(false)
    expect(各行(host)[0]?.tagName).toBe("BUTTON")
    expect(在改(host, 1)).toBe(true)
  })

  test("点「删除」**第一次不删**：那一项当场变成「确认删除？」，回调一次都没喊", () => {
    const { host, 删过 } = 造()

    右键(各行(host)[1])
    点菜单项("delete")

    expect(删过).toEqual([])
    expect(菜单内容()?.textContent).toContain("确认删除")
  })

  /**
   * 「就地」＝人不挪窝：第一次点完之后菜单**还开着**、那个项**还点得到**。
   *
   * ⚠️ **判据必须落在一次冲刷之后**（2026-10-09 变异实测）。原先这条在点击**同一刻**读
   * `有菜单()`，而把 `closeOnSelect={false}` 摘掉（＝本该关）之后它**照样绿**——探针实测两态：
   * 真实码（不关）「同步 `true` → +50ms `true`」；摘掉那一项（该关）「同步 `true` → +50ms **`false`**」
   * ⇒ 关的动作是**异步**的（Kobalte 把 `close()` 排到后面），同一刻读看不出分别
   * （`LEARNINGS #006-19` 同族：**机制**是「异步关」，不是「不关」）。
   * 一条判据在同一刻对两态同值 ＝ 它**没有任何观测力**（`LEARNINGS #006-06`）。
   */
  test("点完第一下菜单还开着，那个项还能再点（就地二次确认的前提）", async () => {
    const { host } = 造()

    右键(各行(host)[1])
    点菜单项("delete")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(有菜单()).toBe(true)
    expect(菜单项("delete") !== null).toBe(true)
  })

  test("再点一次 ⇒ 才真的删，喊的就是那一个 id", () => {
    const { host, 删过 } = 造()

    右键(各行(host)[1])
    点菜单项("delete")
    点菜单项("delete")

    expect(删过).toEqual(["s2"])
  })

  /**
   * 确认之后菜单**要收掉**——不收的话它就悬在列表上，还指着一条**已经被删掉**的会话
   * （2026-10-09 **真栈实测**：删完菜单原样开着，两项都还在，只是作用对象已经不存在了）。
   *
   * 根因在实现侧：`closeOnSelect={false}` 是给「**第一下**不关」用的，而它一挂上去就**永远**
   * 不关 ⇒ 第二下（真正执行删除的那一下）也就没人收场。判据因此要写成**两态同时钉住**：
   * 上一条钉「第一下还开着」、这条钉「第二下关掉了」——只留任何一条，把 `closeOnSelect`
   * 恒设成 `true`（第一下就关）或恒设成 `false`（永远不关）都能蒙过去。
   *
   * ⚠️ 判据同样落在一次冲刷之后（`#006-19`：Kobalte 的关是**异步**落地的，同一刻读两态同值）。
   */
  test("确认删除之后菜单收掉（不留一个指着已删会话的空菜单）", async () => {
    const { host, 删过 } = 造()

    右键(各行(host)[1])
    点菜单项("delete")
    点菜单项("delete")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(有菜单()).toBe(false)
    // 伴随信号放后面（`#004-14`：一用例多断言时，被测属性在前，红了才读得到它）——
    // 它同时证明「菜单是**因为确认删除**才关的」，而不是因为别的什么把菜单弄没了。
    expect(删过).toEqual(["s2"])
  })

  /**
   * 确认态**不许跟着人到别的行**：在 s1 上点出「确认删除？」之后改右键 s2，菜单必须回到
   * 「重命名 / 删除」两态——否则下一步那一点会在 s2 头上执行一次**没人确认过**的删除。
   *
   * ⚠️ **它的牙对着一对机制、不是一条**（2026-10-09 变异实测）：单独拆任何**一处**都**全绿**
   * ——① 只摘 `点删` 里的 `待删() !== sessionID` 判据（差、不再同形）⇒ 绿；② 只摘 `记行` 里的
   * `set待删(undefined)`（换行不清确认态）⇒ 绿。**两处一起拆**（判据退化成「问过没有」的布尔
   * ＋ 换行不清）才恰红这一条（`LEARNINGS #003-03` 第 ② 类：红得不够也要据实记，但要据此看清
   * 它守的是**合取**）。⇒ 下一个人动这两处中的任何一处时，这条**不会**拦你；动**两处**才拦。
   */
  test("在 s1 上点了「确认删除？」再右键 s2 ⇒ 确认态收掉（不然那一点删的是没确认过的行）", () => {
    const { host, 删过 } = 造()

    右键(各行(host)[0])
    点菜单项("delete")
    右键(各行(host)[1])

    expect(菜单文案()).toEqual(["重命名", "删除"])
    点菜单项("delete")
    expect(删过).toEqual([])
  })

  /**
   * 两个回调都是**可选**的（同 `FileTree` 的口径）。省略 ＝ 没接线，这时两项**禁用**——
   * 「未接线」与「没有作用对象」是两条**独立**的禁用理由（`file-tree.tsx` 那条注释），
   * 混成一个就看不出来了。禁用的意义是**看得出来**：点一个没反应的菜单项比灰着更让人以为坏了。
   */
  test("没接线（省略两个回调）⇒ 两项都禁用", () => {
    const host = mount(() => (
      <SessionList
        directory="/workspaces/u1/p1"
        sessions={[行("s1", "甲")]}
        onSelect={() => {}}
        onNewSession={() => {}}
      />
    ))

    右键(各行(host)[0])

    expect(菜单项("rename")?.getAttribute("aria-disabled")).toBe("true")
    expect(菜单项("delete")?.getAttribute("aria-disabled")).toBe("true")
  })

  /**
   * 右键落在**列表空白处**（不在任何一行上）⇒ 没有作用对象，于是不动作、也不乱删。
   *
   * ## ⚠️ 这一条在 2026-10-10 之前是**空转**的（当场取证：注入临时日志，实得
   * `[取证] 身子 = null ； region存在 = true`、29 pass / 0 fail）
   *
   * 它查的 `[data-slot='session-list-body']` 在 DOM 里**从来不存在**：`packages/ui` 的
   * `ContextMenuTrigger` 把 `data-slot="context-menu-trigger"` 硬写在 `{...rest}` **之后**，
   * 调用方传的值被**静默覆盖**。于是 `身子 = null` ⇒ `右键(undefined)` 一个事件都没发
   * ⇒ 两个 `if (菜单项(...))` 都不进 ⇒ 两条断言度量的是**什么都没做**（`#004-14` 的同族）。
   * 改查**真正挂着 `记行` 的那一层**（`session-list-region`），并把「菜单确实开了」写成**前提**：
   * 前提不成立要当场炸，不能默默空转。
   *
   * ## 它钉什么、不钉什么
   *
   * 钉**行为**（空白 ⇒ 作用对象为空 ⇒ 点两次删除也不误删）。**「空白究竟归谁」是几何问题**，
   * happy-dom 量不出来（`#005-07`）⇒ 那一半归 `e2e/real-stack/session-pane-blank-menu-real.spec.ts`
   * （`#004-02`：同一件事的两个投影各钉一条）。
   */
  test("右键空白处（不在任何一行上）⇒ 不动作、不误删", () => {
    const { host, 删过, 重命名过 } = 造()

    const 域 = host.querySelector<HTMLElement>("[data-slot='session-list-region']")
    // ⚠️ 判据写成布尔、不做节点匹配：`expect(<节点>).toBeNull()` 这类断言红了会把整轮
    // `bun test` **挂死**（`#005-01`：不是红，是哑）。
    expect(域 !== null, "前提：挂 `记行` 的那一层要在（旧名 session-list-body 在 DOM 里从不存在）").toBe(true)

    右键(域 ?? undefined)
    expect(有菜单(), "前提：右键必须真的把菜单开出来——否则下面两条是空转").toBe(true)

    点菜单项("delete")
    点菜单项("delete")
    点菜单项("rename")

    expect(删过).toEqual([])
    expect(重命名过).toEqual([])
  })

  /**
   * 右键作用面的**盒子构成**（2026-10-10 加固）：region 必须是撑满触发器的那一层。
   *
   * 为什么值得单写一条：`flex-1` 没接上时**症状极其安静**——菜单照开、`记行` 不跑，
   * 作用对象停在上一次的残留（真栈实测见 `session-pane-blank-menu-real.spec.ts` 的变异记录）。
   * happy-dom 量不出几何（`#005-07`）⇒ 这里只能钉**类名集合**；真几何归那条真栈 spec。
   * 它的价值是「同步上游时被改回去，在本机立刻红」。
   */
  test("右键作用面：region 是撑满的那一层（flex-1 / min-h-0），触发器是 flex 容器", () => {
    const { host } = 造()

    const 域类 = 类集(host.querySelector<HTMLElement>("[data-slot='session-list-region']"))
    expect(域类, "region 要能撑满（flex-1）").toContain("flex-1")
    expect(域类, "region 要能在 flex 容器里收缩（min-h-0）").toContain("min-h-0")
    expect(域类, "region 自己就是滚动容器（标题行不该被滚走）").toContain("overflow-y-auto")

    // ⚠️ 这个名字是 `packages/ui` **硬写**的：调用方传的 `data-slot` 会被它覆盖（见上一条注释）
    // ⇒ 只能按它查。它同时也是「别指望用自定义 `data-slot` 找到触发壳」那条教训的现场。
    const 触类 = 类集(host.querySelector<HTMLElement>("[data-slot='context-menu-trigger']"))
    expect(触类, "触发器要当 flex 容器，region 的 flex-1 才**有剩余空间可分**").toContain("flex")
    expect(触类).toContain("flex-col")
  })
})

/**
 * 用户第 4 条（2026-10-11）：「右键后呼出右键弹窗，但是不选择对应的选项，弹窗不消失。
 * 我希望的是 windows 风格，鼠标左键单击弹窗以外的地方时，弹窗消失。」
 *
 * ## 为什么这里也有一条（同一个修法落在**两个落点**上）
 *
 * 缺陷在 Kobalte 的 `DismissableLayer`：它默认把**触发器**排除在「外面」之外
 * （`chunk/LEK3K6R3.jsx:700` 的 `excludedElements={[context.triggerRef]}`）。本组件与
 * `file-tree.tsx` 都把**整块区域**当触发器（见上一条「右键作用面」）⇒ 在同一块区域里左键
 * **一律不算点外面**。两处各传一次 `excludedElements={[]}`，也各有自己的一条用例
 * （`LEARNINGS #005-12`：同一个修法落在 N 个落点上，就写 N 条用例——不是写一条把两处都过一遍）。
 *
 * 真栈读数（`file-tree` 那一侧的探针，`context-menu-dismiss-probe.spec.ts`）＝ 菜单开在
 * `{左:201,上:478}`，左键点同一块区域里的另一行 ⇒ **菜单还开着**（缺陷）；点到区域之外才关。
 *
 * ⚠️ 判据读**状态属性** `data-expanded`，不读「节点在不在」——菜单关闭时 happy-dom 里
 * 退场动画永不结束 ⇒ 节点一直在（`LEARNINGS #005-29`）。
 *
 * ## 变异记录（2026-10-11，拆掉本文件 `ContextMenu.Content excludedElements={[]}`，据实记三类）
 *
 * 实得：第一条红、第二条绿（`1 pass / 1 fail`）。⇒ 第二条**不是这条修复的守护者**
 * （`LEARNINGS #003-03` 第 ③ 类）：它在修复前后都绿，守的是**过度关闭**那条独立失效路径。
 * 与 `file-tree.test.tsx` 同组同形（同一条修法落两个落点 ⇒ 两处各一条有牙的用例，`#005-12`）。
 */
describe("SessionList 左键点菜单以外（用户第 4 条：Windows 习惯）", () => {
  const 造 = () =>
    挂({ directory: "/workspaces/u1/p1", sessions: [行("s1", "甲"), 行("s2", "乙")], currentID: "s1" })

  /**
   * 左键点一个元素——**必须发 `pointerdown`**，`.click()` 不够。
   *
   * Kobalte 判「点没点在外面」认的是 `document` 上 capture 的 `pointerdown`
   * （`chunk/MGQGUY64.jsx:41-46`），合成一个 `.click()` 它收不到。
   * ⚠️ 只发 `pointerdown`/`pointerup`、**不发 `click`**：这一组量的是「收不收菜单」这一件事，
   * 别把「左键点了那一行 ⇒ 会话被选中」也搅进来（那是另一条判据，混在一起红了读不出是谁）。
   */
  const 左键点 = (el: HTMLElement | null | undefined) => {
    if (!el) throw new Error("要左键点的那个元素不在——前提不成立（`#004-14`：先立前提再判果）")
    for (const 类型 of ["pointerdown", "pointerup"])
      el.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
  }

  test("左键点列表里**另一行** ⇒ 菜单收掉——它就在触发器之内，正是缺陷那一处", async () => {
    const { host } = 造()

    右键(各行(host)[1])
    await 冲刷()
    // 前提先立住：不然下面读到的 `false` 可能是「菜单压根没开」而不是「点外面收掉了」（`#004-14`）。
    expect(有菜单(), "前提：右键之后菜单得先开着").toBe(true)

    左键点(各行(host)[0])
    await 冲刷()

    expect(有菜单(), "在列表里左键点一下，菜单就该收掉（Windows 习惯）").toBe(false)
  })

  /**
   * 对照：**过度关闭**与「不关闭」是两条独立的失效路径，一条用例只能钉一条。
   *
   * 点在菜单**自己**（内容框，不是某个菜单项）上必须留着——把「任何左键都关」当成修法
   * （例如直接监听 `document` 的 `pointerdown`）时，红的只有这一条。
   */
  test("左键点菜单**自己** ⇒ **不许**收掉——防「任何左键都关」的过度关闭", async () => {
    const { host } = 造()

    右键(各行(host)[1])
    await 冲刷()
    expect(有菜单()).toBe(true)

    左键点(菜单内容())
    await 冲刷()

    expect(有菜单(), "点在菜单里面不是「点外面」").toBe(true)
  })
})

/**
 * 行视觉规格（用户 2026-10-09 下达）：**行高 32px**、**文字垂直居中**、**编辑态整行灰底**。
 *
 * happy-dom 没有 CSS 引擎（`LEARNINGS #005-07`）⇒ 只能断 **类名集合**，而且要先 `split` 再判
 * （`#006-22`：`toContain` 直接判字符串会被同类名的后缀满足）。真栈上 32px 的实测记录落在
 * `006-ai-session/state.md`。
 */
describe("SessionList 行视觉规格（32px / 居中 / 编辑态灰底）", () => {
  const 高 = "h-8"
  const 居中 = "items-center"
  /**
   * 编辑态那一行的灰底。取 `overlay-pressed`：实测落在容器上是 `#E6E6E6`，与容器底 `#FAFAFA`
   * 差 20 级；备选的 `bg-layer-02` 只差 8 级。⚠️ 而 **`bg-layer-01` 是陷阱**——实测它就是
   * `#FAFAFA`、**等于容器底**，选了等于没选（这三个值都是真栈量出来的，不是推的）。
   */
  const 灰 = "bg-v2-overlay-simple-overlay-pressed"

  const 造 = () =>
    挂({ directory: "/workspaces/u1/p1", sessions: [行("s1", "甲"), 行("s2", "乙")], currentID: "s1" })

  /**
   * 行高与居中**两个落点各一条**（`LEARNINGS #005-12`：同一个修法落在 N 处就写 N 条，别把 N 处
   * 折成一条）：展示态是 `<button>`、编辑态是 `<div>`，两条 class 串**各自独立**（见 `ITEM` /
   * `ITEM_EDIT` 的注释）——只钉其中一条时，另一条退回 `h-6` 不会被发现。
   *
   * `items-center` 那一条是「垂直居中」在 happy-dom 里**唯一**能钉的形态：量不出几何（`#005-07`），
   * 量不到 `flex` 的居中效果，只能钉「居中那条规则还在」。
   */
  test("行高 32px：展示态那一行 `h-8` ＋ 垂直居中，且不再带 `h-6`", () => {
    const { host } = 造()

    const 类 = 类集(各行(host)[0])
    expect(类).toContain(高)
    expect(类).toContain(居中)
    expect(类).not.toContain("h-6")
  })

  test("行高 32px：编辑态那一行同样 `h-8` ＋ 垂直居中（换行不换高，改名时文字不跳）", () => {
    const { host } = 造()

    右键(各行(host)[0])
    点菜单项("rename")

    const 类 = 类集(各行(host)[0])
    expect(类).toContain(高)
    expect(类).toContain(居中)
    expect(类).not.toContain("h-6")
  })

  /**
   * 编辑态**整行灰底**。
   *
   * `not.toContain(浅金)` 那一半不是装饰：两个同权重的 `bg-*` 同时在场上时谁生效看 **CSS 先后**，
   * 不看 class 属性顺序 ⇒ 叠加写法（`${ITEM_EDIT} ${ITEM_ACTIVE}`）会是个「看着该灰、实际可能还是
   * 金」的假象（`LEARNINGS #003-05`，本文件 `ITEM` 那段注释记着同一件事）。用户选的正是「**灰 > 金**」
   * ——编辑当前会话时金让位：同一行不能同时说「这是当前会话」和「这行在编辑」。
   */
  test("编辑**当前会话**那一行 ⇒ 整行灰底，浅金让位；别的行不带灰", () => {
    const { host } = 造()

    右键(各行(host)[0])
    点菜单项("rename")

    const 类 = 类集(各行(host)[0])
    expect(类).toContain(灰)
    expect(类).not.toContain(浅金)
    // 负向对照（`#005-07`：只写正向那条时，把整个列表刷成灰也算过）
    expect(类集(各行(host)[1])).not.toContain(灰)
  })

  /** 编辑**别的行** ⇒ 一样是灰。灰不是「当前会话」的另一种画法，是「**这一行在编辑**」。 */
  test("编辑**非当前**那一行 ⇒ 也是整行灰底；当前会话那一行照旧是浅金", () => {
    const { host } = 造()

    右键(各行(host)[1])
    点菜单项("rename")

    expect(类集(各行(host)[1])).toContain(灰)
    expect(类集(各行(host)[1])).not.toContain(浅金)
    expect(类集(各行(host)[0])).toContain(浅金)
    expect(类集(各行(host)[0])).not.toContain(灰)
  })
})
