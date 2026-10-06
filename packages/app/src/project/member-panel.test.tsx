import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { MemberPanel, type MemberEntry } from "./member-panel"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
/**
 * 一个**输入框**——`槽` 的具名变体。
 *
 * 不写成泛型 `槽<T>`：TypeScript 说那样没问题，但 oxlint 的 `no-unnecessary-type-parameters`
 * 会报「T 只用了一次」（T 确实只用一次，规则说得对）。`as HTMLInputElement` 也不行——
 * `no-unsafe-type-assertion` 会说它比原类型窄。多一个两行的 helper 是这里最省事的干净写法。
 */
const 输入框 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLInputElement>(`[data-slot='${slot}']`)
/**
 * 某槽位的文本。
 *
 * 第一个参数收 `HTMLElement | null`（不是 `槽` 那样的非空）：这样能把 `行(…)` 的结果直接递进来
 * 取**某一行的某个格子**，而不必为了讨好类型写 `行(…)!`——那一行真不存在时也该是「文本读作
 * `undefined`（于是断言红）」，不是抛异常。
 */
const 文本 = (host: HTMLElement | null, slot: string) =>
  host?.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()
/**
 * 某槽位**不存在**吗？——返回**布尔**，不是节点。
 *
 * ⚠️ 不能写成 `expect(槽(host, "x")).toBeNull()`：那条断言红了会把整轮测试**挂死**
 * （`LEARNINGS #005-01`：bun 失败时打印实得值，而 Solid 渲染过的节点会让打印器停不下来，
 * 45s 仍不结束、被 timeout 杀掉并**一条结果都取不到**）。断在布尔上，红时打印 `false`，毫秒级。
 */
const 无槽 = (host: HTMLElement, slot: string) => 槽(host, slot) === null
const 按钮 = (host: HTMLElement, slot: string) => host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/** 一个成员行（按警号取——列表里同名的槽位有多个，只能按行锚定）。 */
const 行 = (host: HTMLElement, policeId: string) =>
  host.querySelector<HTMLElement>(`[data-slot='member-row'][data-police-id='${policeId}']`)
const 行列表 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-slot='member-row']")]

/**
 * 行**内**的某个槽位——同样返回布尔，理由同 `无槽`。
 *
 * ⚠️ 必须显式判 `row !== null`：写成 `row?.querySelector(…) !== null` 的话，**行压根不存在**时
 * `undefined !== null` 为 **true** ⇒ 这条探针会替一棵**没渲染出来的行**作证「它里面有东西」。
 * （2026-10-06 实测：骨架期正是它让「owner 看得到 [移除]」那条**假绿**，并把紧接着的
 * `按钮(行(host, "002")!, …)` 撑成 `null.querySelector` 的 TypeError——红得莫名其妙。）
 */
const 行内有 = (row: HTMLElement | null, slot: string) =>
  row !== null && row.querySelector(`[data-slot='${slot}']`) !== null

/** 行**内**的一个按钮（同 `行内有` 的锚定方式；用泛型而非 `as`，断言交给类型参数）。 */
const 行内按钮 = (row: HTMLElement | null, slot: string) =>
  row?.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * 三个成员：张三是我（owner），李四与王五是别人（member）。
 *
 * ⚠️ 名字与警号都是**编造**的（`001` 不是真警号）——它们是这里的输入，不是对真实数据的断言。
 */
const 三成员: readonly MemberEntry[] = [
  { policeId: "001", name: "张三", role: "owner" },
  { policeId: "002", name: "李四", role: "member" },
  { policeId: "003", name: "王五", role: "member" },
]

/**
 * 成员面板（FR-004 / US3 / `2026-09-11-项目管理-design.md` §4）：点锚点行的 `👥 N` 侧滑出来。
 *
 * happy-dom **没有 CSS 引擎**，量不到几何——所以这里钉的**全是结构不变量**（槽位在不在、文本是什么、
 * 点了通知谁），不是像素。「侧滑」这个形态本身（`absolute` 定位）由接线处决定，不在本组断言里。
 */
describe("MemberPanel 成员面板（FR-004 / US3 / 设计 §4）", () => {
  describe("版面（设计 §4 的那张图逐行）", () => {
    test("标题写清是**哪个项目**的成员管理（设计 §4：`👥 成员管理 · 8·17 专案`）", () => {
      const host = mount(() => <MemberPanel projectName="8·17专案" members={三成员} />)

      expect(文本(host, "member-panel-title")).toBe("成员管理 · 8·17专案")
    })

    test("成员数与**实际行数**一致（设计 §4：`── 成员（3）──`）", () => {
      const host = mount(() => <MemberPanel members={三成员} />)

      expect(文本(host, "member-panel-count")).toBe("成员（3）")
      expect(行列表(host).length).toBe(3)
    })

    test("每行给出名字与角色——光有名字分不出谁是 owner（US3 AC1）", () => {
      const host = mount(() => <MemberPanel members={三成员} />)

      expect(文本(行(host, "002"), "member-name")).toBe("李四")
      expect(文本(行(host, "001"), "member-role")).toBe("owner")
      expect(文本(行(host, "002"), "member-role")).toBe("member")
    })

    test("只给**本人**那一行加「本人」标记——自己也得认得出自己（设计 §4：`张三（本人）`）", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="002" />)

      expect(行内有(行(host, "002"), "member-self")).toBe(true)
      expect(行内有(行(host, "001"), "member-self")).toBe(false)
      expect(行内有(行(host, "003"), "member-self")).toBe(false)
    })

    test("没有成员时走空态，不画一副空壳", () => {
      const host = mount(() => <MemberPanel members={[]} />)

      expect(文本(host, "member-panel-empty")).toBe("还没有成员")
      expect(行列表(host).length).toBe(0)
    })
  })

  describe("权限：一律问 ProjectMembership.decide，不在本组件里重写规则（FR-004）", () => {
    test("owner 看得到别人（member）那一行的 [移除]", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="001" onRemove={() => {}} />)

      expect(行内有(行(host, "002"), "member-remove")).toBe(true)
      expect(行内有(行(host, "003"), "member-remove")).toBe(true)
    })

    test("member **看不到**别人的 [移除]——FR-004「仅 owner 能移除成员」（US3 场景 3）", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="002" onRemove={() => {}} />)

      expect(行内有(行(host, "001"), "member-remove")).toBe(false)
      expect(行内有(行(host, "003"), "member-remove")).toBe(false)
    })

    test("owner 自己那一行也**没有** [移除]——移除目标必须是 member，否则项目会无主", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="001" onRemove={() => {}} />)

      // 同一个 owner 看自己的行：`decide({actor:"owner", action:"remove", target:"owner"})` ⇒ false
      expect(行内有(行(host, "001"), "member-remove")).toBe(false)
    })

    test("member 看得到 [退出项目]", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="002" onLeave={() => {}} />)

      expect(无槽(host, "member-panel-leave")).toBe(false)
    })

    test("owner **看不到** [退出项目]——FR-004「owner 不能退群」", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="001" onLeave={() => {}} />)

      expect(无槽(host, "member-panel-leave")).toBe(true)
    })

    test("项目**已归档**时三条动作一个都不画——FR-010 的「归档 = 冻结」在面板上一样成立", () => {
      const host = mount(() => (
        <MemberPanel
          members={三成员}
          selfPoliceId="001"
          archived
          onInvite={() => {}}
          onRemove={() => {}}
          onLeave={() => {}}
        />
      ))

      expect(无槽(host, "member-panel-invite-input")).toBe(true)
      expect(行内有(行(host, "002"), "member-remove")).toBe(false)
      expect(无槽(host, "member-panel-leave")).toBe(true)
    })

    test("认不出「我是谁」时 fail-closed：动作一个都不画、邀请入口也没有（宁缺勿假）", () => {
      const host = mount(() => (
        <MemberPanel members={三成员} onInvite={() => {}} onRemove={() => {}} onLeave={() => {}} />
      ))

      expect(无槽(host, "member-panel-invite-input")).toBe(true)
      expect(无槽(host, "member-panel-leave")).toBe(true)
      expect(行列表(host).every((row) => !行内有(row, "member-remove"))).toBe(true)
    })
  })

  describe("动作：只喊回调", () => {
    test("输入警号点「邀请」⇒ 原样喊出去（设计 §4：`＋ 邀请成员（输入警号）`）", () => {
      const 收到: string[] = []
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="001" onInvite={(id) => 收到.push(id)} />)

      const 输入 = 输入框(host, "member-panel-invite-input")
      if (!输入) throw new Error("邀请框没渲染出来")
      输入.value = "066123"
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      按钮(host, "member-panel-invite-ok")?.click()

      expect(收到).toEqual(["066123"])
    })

    test("点 [移除] ⇒ 喊的是**那一行**的人（不是「当前选中」那一套——列表里没有选中态）", () => {
      const 收到: string[] = []
      const host = mount(() => (
        <MemberPanel members={三成员} selfPoliceId="001" onRemove={(m) => 收到.push(m.policeId)} />
      ))

      行内按钮(行(host, "003"), "member-remove")?.click()

      expect(收到).toEqual(["003"])
    })

    test("点 [退出项目] ⇒ 喊 onLeave（它不带参数——退的永远是**自己**）", () => {
      let 喊了几次 = 0
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="002" onLeave={() => 喊了几次++} />)

      按钮(host, "member-panel-leave")?.click()

      expect(喊了几次).toBe(1)
    })

    test("空警号点邀请：一个字都不喊（不能把空字符串当成一个人去邀请）", () => {
      const 收到: string[] = []
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="001" onInvite={(id) => 收到.push(id)} />)

      按钮(host, "member-panel-invite-ok")?.click()

      expect(收到).toEqual([])
    })
  })

  describe("未接线即禁用（同 T005／T006／T007／T008／T009 的口径）", () => {
    test("权限够、但**没接线**时动作仍是禁用态——「没接线」与「没权限」是两条**独立**的理由", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="001" />)

      // 权限侧：owner 对 member 是有权的（上一条用例已证）⇒ 这里红的原因只可能是「没接线」
      expect(行内有(行(host, "002"), "member-remove")).toBe(true)
      expect(行内按钮(行(host, "002"), "member-remove")?.disabled).toBe(true)
    })

    test("member 视角：[退出项目] 画出来了，但没接线 ⇒ 禁用", () => {
      const host = mount(() => <MemberPanel members={三成员} selfPoliceId="002" />)

      expect(按钮(host, "member-panel-leave")?.disabled).toBe(true)
    })
  })
})
