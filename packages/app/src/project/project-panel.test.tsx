import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { ProjectPanel, type ProjectEntry } from "./project-panel"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 全槽 = (host: HTMLElement, slot: string) =>
  [...host.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`)]
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()
const 按钮 = (host: HTMLElement, slot: string) => host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * 某槽位**不存在**吗？——返回**布尔**，不是节点。
 *
 * ⚠️ 不能图省事写成 `expect(槽(host, "x")).toBeNull()`：**那条断言红了会把整轮测试挂死**
 * （机制与四条探针实测见 `project-anchor.test.tsx` 同名辅助函数、`LEARNINGS #005-01`）。
 */
const 无槽 = (host: HTMLElement, slot: string) => 槽(host, slot) === null

/** 三 tab 之一（`data-tab` 是它的身份，`data-slot` 是它的种类）。 */
const 页签 = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='project-panel-tab'][data-tab='${id}']`)

/**
 * 一组项目。**用 `data-group` 选，不是用三个不同的 `data-slot`**——三组是同一种东西，
 * 差别只在分组键；分成三个槽位名会让「同一种行」在断言里长得像三种东西。
 */
const 组 = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLElement>(`[data-slot='project-group'][data-group='${key}']`)

/** 一行项目。 */
const 行 = (host: HTMLElement) => 全槽(host, "project-item")
/** 一行项目显示的名字，**按渲染顺序**——「最近」的倒序判据就断在这个顺序上。 */
const 项目名 = (host: HTMLElement) =>
  行(host).map((el) => el.querySelector("[data-slot='project-item-name']")?.textContent?.trim())
/** 某一行的成员徽章里的数字。 */
const 行成员 = (el: HTMLElement) =>
  el.querySelector("[data-slot='project-item-member-count']")?.textContent?.trim()

/** 造数据——形状即 `ProjectEntry`，不经过任何后端（本 task 刻意没有落库）。 */
const 私有 = (id: string, name: string, lastAccessedAt: number): ProjectEntry => ({
  id,
  name,
  type: "private",
  lastAccessedAt,
})
const 共享 = (id: string, name: string, lastAccessedAt: number, memberCount: number): ProjectEntry => ({
  id,
  name,
  type: "shared",
  memberCount,
  lastAccessedAt,
})
const 归档 = (e: ProjectEntry): ProjectEntry => ({ ...e, archived: true })

/**
 * 项目面板（FR-002 / FR-003 / `2026-09-11-项目管理-design.md` §3）：
 * 「＋新建项目（私有 / 共享）」置顶 +「最近 / 全部 / 已归档」三 tab。
 *
 * 与 `ProjectAnchor` 同口径——**受控组件**：数据由 `projects` prop 给、动作只喊回调，
 * 故能脱离六层 provider 单独渲染（本文件正是这么跑的）。happy-dom **没有 CSS 引擎**，
 * 所以钉的全是**结构不变量**（槽位、文本、顺序、点了通知谁），不是像素。
 *
 * ⚠️ 本 task **刻意不落库**（用户 2026-10-06 裁定：范围 = 前端面板 ＋ 接缝）：
 * 新建 / 列表接口的落库缺口由 **T018** 认领，「新建项目成功」这条出参**不在本 task 交付**。
 */
describe("ProjectPanel 项目面板（FR-002）", () => {
  test("置顶是「＋新建项目」，分私有 / 共享两个入口（设计 §3）", () => {
    const host = mount(() => <ProjectPanel />)

    expect(槽(host, "project-panel-create")).not.toBeNull()
    expect(按钮(host, "project-panel-create-private")?.textContent?.trim()).toBe("私有")
    expect(按钮(host, "project-panel-create-shared")?.textContent?.trim()).toBe("共享")
  })

  test("点私有 / 共享，各报告各的类型（FR-003）", () => {
    const 记: string[] = []
    const host = mount(() => <ProjectPanel onCreate={(type) => 记.push(type)} />)

    按钮(host, "project-panel-create-private")?.click()
    按钮(host, "project-panel-create-shared")?.click()

    expect(记).toEqual(["private", "shared"])
  })

  test("未接线时新建按钮是禁用态——不假装能点（本 task 确实没有接收方）", () => {
    const host = mount(() => <ProjectPanel />)

    expect(按钮(host, "project-panel-create-private")?.disabled).toBe(true)
    expect(按钮(host, "project-panel-create-shared")?.disabled).toBe(true)
  })

  test("三 tab 齐备且顺序固定：最近 → 全部 → 已归档（FR-002）", () => {
    const host = mount(() => <ProjectPanel />)

    const 名字 = 全槽(host, "project-panel-tab").map((el) => el.textContent?.trim())

    expect(名字).toEqual(["最近", "全部", "已归档"])
  })

  test("三 tab 是真正的 tab 语义（可访问性：不只靠颜色，DESIGN §4.3）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 1)]} />)

    expect(槽(host, "project-panel-tabs")?.getAttribute("role")).toBe("tablist")
    for (const id of ["recent", "all", "archived"]) {
      expect(页签(host, id)?.getAttribute("role")).toBe("tab")
    }
    expect(页签(host, "recent")?.getAttribute("aria-selected")).toBe("true")
    expect(槽(host, "project-panel-body")?.getAttribute("role")).toBe("tabpanel")
  })

  test("默认停在「最近」（设计 §3 的第一个 tab）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 1)]} />)

    expect(页签(host, "recent")?.getAttribute("aria-selected")).toBe("true")
    expect(页签(host, "all")?.getAttribute("aria-selected")).toBe("false")
  })

  test("点 tab 真的切换内容，不是只换高亮（出参：三 tab 可切换）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "活跃专案", 2), 归档(私有("p2", "封存专案", 1))]} />
    ))

    expect(项目名(host)).toEqual(["活跃专案"])

    页签(host, "archived")?.click()

    expect(页签(host, "archived")?.getAttribute("aria-selected")).toBe("true")
    expect(项目名(host)).toEqual(["封存专案"])

    页签(host, "recent")?.click()

    expect(项目名(host)).toEqual(["活跃专案"])
  })

  test("「最近」按 lastAccessedAt 倒序，与传入顺序无关（FR-002）", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[私有("a", "A", 100), 私有("b", "B", 300), 私有("c", "C", 200)]}
      />
    ))

    expect(项目名(host)).toEqual(["B", "C", "A"])
  })

  test("「最近」不含已归档项目——归档后它就只在「已归档」里了（§8）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "活跃专案", 2), 归档(私有("p2", "封存专案", 99))]} />
    ))

    expect(项目名(host)).toEqual(["活跃专案"])
  })

  test("「全部」下分「我的项目 / 共享项目」两组（设计 §3）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "8·17专案", 3), 共享("p2", "串并案", 2, 3)]} />
    ))

    页签(host, "all")?.click()

    const 分组 = 全槽(host, "project-group").map((el) => el.getAttribute("data-group"))
    expect(分组).toEqual(["mine", "shared"])

    const 我的 = 组(host, "mine")
    const 共享组 = 组(host, "shared")
    expect(我的?.textContent).toContain("8·17专案")
    expect(共享组?.textContent).toContain("串并案")
  })

  test("共享项目带 👥 成员数，私有项目不带（设计 §3 / FR-015）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "8·17专案", 3), 共享("p2", "串并案", 2, 3)]} />
    ))

    页签(host, "all")?.click()

    const [我的行, 共享行] = [组(host, "mine"), 组(host, "shared")].map(
      (g) => g?.querySelector<HTMLElement>("[data-slot='project-item']") ?? null,
    )

    expect(共享行 && 行成员(共享行)).toBe("3")
    expect(我的行 && 行成员(我的行)).toBeUndefined()
  })

  test("当前项目在列表里带（当前）标记（设计 §3 的「8·17专案（当前）」）", () => {
    const host = mount(() => (
      <ProjectPanel
        currentId="p2"
        projects={[私有("p1", "8·17专案", 3), 共享("p2", "串并案", 2, 3)]}
      />
    ))

    const 标了 = 行(host).filter((el) => el.getAttribute("data-current") === "true")

    expect(标了).toHaveLength(1)
    expect(标了[0]?.textContent).toContain("串并案")
    expect(标了[0]?.textContent).toContain("当前")
  })

  test("点某个项目：报告该项目本身（FR-003 / AC4 的落点）", () => {
    const 记: ProjectEntry[] = []
    const 甲 = 私有("p1", "8·17专案", 3)
    const host = mount(() => <ProjectPanel projects={[甲, 共享("p2", "串并案", 2, 3)]} onOpen={(p) => 记.push(p)} />)

    行(host)[0]?.click()

    expect(记.map((p) => p.id)).toEqual(["p1"])
    expect(记[0]).toEqual(甲)
  })

  test("未接线时项目行不可点（宁缺勿假：点不动的行不该像能点）", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} />)

    expect(按钮(host, "project-item")?.disabled).toBe(true)
  })

  test("「已归档」tab 的项目带「找回」入口（设计 §3 / FR-009）", () => {
    const 记: ProjectEntry[] = []
    const 封存 = 归档(私有("p2", "封存专案", 1))
    const host = mount(() => <ProjectPanel projects={[封存]} onRestore={(p) => 记.push(p)} />)

    页签(host, "archived")?.click()
    组(host, "archived")?.querySelector<HTMLButtonElement>("[data-slot='project-restore']")?.click()

    expect(记.map((p) => p.id)).toEqual(["p2"])
  })

  test("「找回」只在「已归档」tab 出现，不在活跃列表里（FR-009 是归档区的事）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "活跃专案", 2), 归档(私有("p2", "封存专案", 1))]} />
    ))

    expect(无槽(host, "project-restore")).toBe(true)
  })

  test("没有项目时三 tab 都走空态，不伪造项目名（宁缺勿假）", () => {
    const host = mount(() => <ProjectPanel />)

    expect(项目名(host)).toEqual([])
    expect(文本(host, "project-panel-empty")).toBe("还没有项目")

    页签(host, "archived")?.click()

    expect(文本(host, "project-panel-empty")).toBe("没有已归档的项目")
  })

  test("「已归档」tab 空态与「最近」空态不是同一句——两者说的不是一件事", () => {
    const host = mount(() => <ProjectPanel projects={[私有("p1", "活跃专案", 2)]} />)

    // 活跃列表非空 ⇒ **没有空态节点**（不是「空态里没字」）——缺的槽位读作 `undefined`。
    expect(文本(host, "project-panel-empty")).toBeUndefined()

    页签(host, "archived")?.click()

    expect(文本(host, "project-panel-empty")).toBe("没有已归档的项目")
  })
})
