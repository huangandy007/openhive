import { describe, expect, test } from "bun:test"
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
  const host = mount(() => (
    <SessionList
      directory={props.directory}
      sessions={props.sessions}
      currentID={props.currentID}
      onSelect={(id) => 选过.push(id)}
      onNewSession={(dir) => 新建过.push(dir)}
    />
  ))
  return { host, 选过, 新建过 }
}

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
   * 空态。**三种「什么都没列出来」不是一回事**，屏幕上却长得一样（`#002-02`）：
   *
   * - 目录未知（没选项目）⇒ 什么都不画：上面的锚点行已经说了「未选择项目」，这里再写一句是重复;
   * - 数据还没到（`sessions === undefined`）⇒ **也不画**：说「暂无会话」等于把「还没问到」
   *   说成「问到了，一场都没有」；
   * - 目录和在手的表都有、就是空的 ⇒ 「暂无会话」，这一句是真的。
   */
  test("目录已知但一场会话都没有 ⇒ 「暂无会话」", () => {
    const { host } = 挂({ directory: "/workspaces/u1/p1", sessions: [] })

    expect(文本(host, "session-empty")).toBe("暂无会话")
  })

  test("数据还没到（undefined）⇒ 不画空态（「还没问到」不是「没有」）", () => {
    const { host } = 挂({ directory: "/workspaces/u1/p1", sessions: undefined })

    expect(槽(host, "session-empty") === null).toBe(true)
  })

  test("目录未知 ⇒ 不画空态（锚点行已经说了「未选择项目」）", () => {
    const { host } = 挂({ sessions: [] })

    expect(槽(host, "session-empty") === null).toBe(true)
  })

  /**
   * 左栏**只放高频的「新增」**——重命名 / 删除 / 导出在右栏「⋯」菜单里（设计 §7 原文），
   * 左栏会话列表**不重复放每行的图标**。
   */
  test("行上不放重命名 / 删除 / 导出的图标（设计 §7：那些在右栏「⋯」里）", () => {
    const { host } = 挂({ directory: "/workspaces/u1/p1", sessions: [行("s1", "甲")] })

    expect(各行(host)[0]?.querySelectorAll("button").length).toBe(0)
    expect(各行(host).filter((el) => el.querySelector("[aria-label='删除']") !== null).length).toBe(0)
  })
})
