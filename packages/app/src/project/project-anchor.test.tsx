import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { ProjectAnchor } from "./project-anchor"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本 = (host: HTMLElement, slot: string) => 槽(host, slot)?.textContent?.trim()
const 根 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='project-anchor']")
/** 三个动作都是 `<button>`，断言 `disabled` 要的是 `HTMLButtonElement`（`HTMLElement` 上没这个属性）。 */
const 按钮 = (host: HTMLElement, slot: string) => host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * 某槽位**不存在**吗？——返回**布尔**，不是节点。
 *
 * ⚠️ 不能图省事写成 `expect(槽(host, "x")).toBeNull()`：**这条断言红了会把整轮测试挂死**。
 * 机制（2026-10-06 实测，bun 1.3.14 + happy-dom）：断言失败时 bun 会把**实得值**原样打印出来，
 * 而**被 Solid 渲染过的节点**会让打印器停不下来——同一个 `bun test`、同一条断言，实得值换成
 * 手搓的 `document.createElement("button")`（挂进文档、带子节点）是 **133ms** 出结果，换成
 * `render()` 出来的元素则 **45s 仍未结束、被 `timeout` 杀掉**（脱离文档也一样，挂不挂进文档不是条件）；
 * 进程内存同时涨到 ~375MB。挂死时**一条结果都拿不到**：不是红，是哑——比红更坏，
 * 因为它看着像「还没跑完」。断在上面这个布尔上，红的时候打印的是 `false`，毫秒级。
 *
 * ⚠️ 只有 `.toBeNull()` 这一类**失败时实得值是节点**的断言中招：`.not.toBeNull()` 失败时实得值是
 * `null`（原语），照打印不误，故本文件里那两条保持原样。
 */
const 无槽 = (host: HTMLElement, slot: string) => 槽(host, slot) === null

/**
 * 项目锚点行（FR-001 / DESIGN §4.1）：`项目名 + 成员数 + ▾ + ＋`。
 *
 * happy-dom **没有 CSS 引擎**，量不到几何、也读不到 computed style——所以这里钉的
 * **全是结构不变量**（槽位在不在、文本是什么、点了通知谁），不是像素。
 */
describe("ProjectAnchor 项目锚点行（FR-001）", () => {
  test("显示当前项目名", () => {
    const host = mount(() => <ProjectAnchor name="8·17专案" />)

    expect(文本(host, "project-anchor-name")).toBe("8·17专案")
    expect(槽(host, "project-anchor-name")?.getAttribute("data-state")).toBe("filled")
  })

  test("没有当前项目时走空态，不伪造项目名（宁缺勿假）", () => {
    const host = mount(() => <ProjectAnchor />)

    expect(文本(host, "project-anchor-name")).toBe("未选择项目")
    expect(槽(host, "project-anchor-name")?.getAttribute("data-state")).toBe("empty")
  })

  test("共享项目显示成员数（设计 §4：共享项目在项目名旁显示 👥 N）", () => {
    const host = mount(() => <ProjectAnchor name="8·17专案" memberCount={3} />)

    expect(文本(host, "project-anchor-member-count")).toBe("3")
  })

  test("没有成员数就不渲染徽章（私有项目不显示成员，设计 §4）", () => {
    const host = mount(() => <ProjectAnchor name="我的专案" />)

    expect(无槽(host, "project-anchor-members")).toBe(true)
  })

  test("锚点四件套齐备且顺序固定：项目名 → 成员数 → ▾ → ＋", () => {
    const host = mount(() => <ProjectAnchor name="8·17专案" memberCount={3} />)

    // 项目名直接挂在根上；后三个自 2026-10-09 起各套了一层 `TooltipV2` 的触发壳（`<div>`，
    // 不带 `data-slot`）⇒ 取「这一层自己的 slot，没有就取它里面那颗按钮的」，顺序仍是四件套的顺序。
    const 顺序 = [...(根(host)?.children ?? [])].map(
      (el) => el.getAttribute("data-slot") ?? el.querySelector("[data-slot]")?.getAttribute("data-slot"),
    )

    expect(顺序).toEqual([
      "project-anchor-name",
      "project-anchor-members",
      "project-anchor-toggle",
      "project-anchor-create",
    ])
  })

  test("▾ 与 ＋ 恒在——锚点行是常驻的，空态也在（FR-001）", () => {
    const host = mount(() => <ProjectAnchor />)

    expect(槽(host, "project-anchor-toggle")).not.toBeNull()
    expect(槽(host, "project-anchor-create")).not.toBeNull()
  })

  test("点 ▾ / ＋ / 成员数，各触发各的回调", () => {
    const 记 = { 列表: 0, 新建: 0, 成员: 0 }
    const host = mount(() => (
      <ProjectAnchor
        name="8·17专案"
        memberCount={3}
        onToggleList={() => 记.列表++}
        onCreate={() => 记.新建++}
        onOpenMembers={() => 记.成员++}
      />
    ))

    按钮(host, "project-anchor-members")?.click()
    按钮(host, "project-anchor-toggle")?.click()
    按钮(host, "project-anchor-create")?.click()

    expect(记).toEqual({ 列表: 1, 新建: 1, 成员: 1 })
  })

  test("未接线时 ▾ / ＋ / 成员数是禁用态——不假装能点（本 task 是真的没接线）", () => {
    const host = mount(() => <ProjectAnchor name="8·17专案" memberCount={3} />)

    expect(按钮(host, "project-anchor-toggle")?.disabled).toBe(true)
    expect(按钮(host, "project-anchor-create")?.disabled).toBe(true)
    expect(按钮(host, "project-anchor-members")?.disabled).toBe(true)
  })

  test("三个按钮都有可访问名称（图标不能是它们唯一的名字）", () => {
    const host = mount(() => <ProjectAnchor name="8·17专案" memberCount={3} />)

    for (const slot of ["project-anchor-members", "project-anchor-toggle", "project-anchor-create"]) {
      expect(槽(host, slot)?.getAttribute("aria-label")).toBeTruthy()
    }
  })
})

/**
 * 悬停提示：三颗**图形按钮**各套一层 `TooltipV2` 触发壳（`👥 N` 里的数字不构成说明，故也在内）。
 *
 * ⚠️ 同 `rail.test.tsx`：本层钉的是**接线**。happy-dom 里 hover / focus 都打不开浮层
 * （2026-10-09 探针实测），「悬停会显示什么」不在单测可证范围内（`LEARNINGS #006-18`）。
 *
 * ⚠️ 起初担心「未接线时按钮是 `disabled` ⇒ 提示弹不出来」，**真浏览器实测推翻了这个担心**：
 * `disabled` 只是让指针穿透那颗按钮、落到包着它的触发壳 `<div>` 上，Kobalte 收到的是那一层的
 * `pointerenter`，提示照常出现（同日实测 `file-tree.tsx` 工具栏的禁用键 ⇒ 浮层正常弹出）。
 * 故这里**不记缺口**；三颗按钮真浏览器实测见收尾报告。
 */
describe("ProjectAnchor 的悬停提示", () => {
  /** 触发壳里装着哪个 `data-slot` 的按钮——按 `data-component` 数。 */
  const 壳内 = (host: HTMLElement, slot: string) =>
    [...host.querySelectorAll("[data-component='tooltip-v2-trigger']")].filter(
      (el) => el.querySelector(`[data-slot='${slot}']`) != null,
    ).length

  test("成员徽章 / ▾ / ＋ 都在提示壳内", () => {
    const host = mount(() => <ProjectAnchor name="8·17专案" memberCount={3} />)

    expect(["project-anchor-members", "project-anchor-toggle", "project-anchor-create"].map((slot) => 壳内(host, slot))).toEqual([1, 1, 1])
  })

  test("私有项目（无成员数）时 ▾ / ＋ 仍在壳内、且不多出成员徽章", () => {
    const host = mount(() => <ProjectAnchor name="我的专案" />)

    expect([壳内(host, "project-anchor-toggle"), 壳内(host, "project-anchor-create"), 壳内(host, "project-anchor-members")]).toEqual([1, 1, 0])
  })
})
