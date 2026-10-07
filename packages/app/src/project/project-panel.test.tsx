import { describe, expect, test } from "bun:test"
import { ProjectMembership } from "@opencode-ai/core/project/membership"
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

/** 新建时那一行命名输入框（点「私有 / 共享」之后才在）。写法同上面的 `按钮`——泛型取元素，
 *  不写成 `槽(...) as HTMLInputElement`（断言会被 `no-unsafe-type-assertion` 告警）。 */
const 输入框 = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>("[data-slot='project-panel-name']")

/**
 * 焦点在不在那一行输入框上？——**返回布尔，不是拿节点去比**。
 *
 * ⚠️ 写成 `expect(document.activeElement).toBe(输入框(host))` 会**把整轮测试挂死**：
 * `.toBe` 失败时要打印**实得值**，而实得值是 `document.activeElement`，一个**被渲染过的节点**
 * ——打印器停不下来（`LEARNINGS #005-01`）。本条是那条的**推广形态**：中招的不只是
 * `.toBeNull()`，而是**任何「实得值可能是节点」的断言**。判据一句话：**实得值必须是原语**。
 * 2026-10-06 实测：写成上面那种，`timeout 60` 到点被杀，`EXIT=124`、一条结果都取不到。
 */
const 焦点在输入框 = (host: HTMLElement) => document.activeElement === 输入框(host)

/** 往那一行里打字。**先设 value 再派发 `input`**——Solid 的 `onInput` 靠这个事件。 */
const 输入 = (host: HTMLElement, 值: string) => {
  const el = 输入框(host)
  if (!el) throw new Error("输入框不在，打不了字")
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

/**
 * 在输入框上按一个键。
 *
 * 走**原生派发**而不是 `keyboard()` 之类：本组件只认 `key` 那一个字段，派真事件比造一串
 * 依赖更贴近浏览器里发生的事。
 */
const 按下 = (host: HTMLElement, key: string) => {
  const el = 输入框(host)
  if (!el) throw new Error("输入框不在，按不了键")
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}
const 回车 = (host: HTMLElement) => 按下(host, "Enter")

/** 失焦。`blur` **不冒泡**，所以是真派在元素自己身上——与浏览器里点别处时一样。 */
const 失焦 = (host: HTMLElement) => {
  const el = 输入框(host)
  if (!el) throw new Error("输入框不在，失不了焦")
  el.dispatchEvent(new FocusEvent("blur"))
}

/**
 * 等异步那一段走完。
 *
 * 用**宏任务**（`setTimeout 0`）而不是 `await Promise.resolve()`：提交之后要经过几个微任务
 * 才落地，取决于实现里 `await` 了几层；微任务只让一轮，数错了就会变成一条**假红**。
 * 宏任务一定排在当前所有微任务之后。
 */
const 冲一遍 = () => new Promise((resolve) => setTimeout(resolve, 0))

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
 * 带「**我**在这个项目里的角色」的一行（T023）。角色的闭集**从 core 取**、不在这里抄一份
 * （`MemberRole` 与库里 `project_member.role` 的 CHECK 已经是同一份值的两处写法，
 * `membership.ts` 文件头记着——本文件没必要成为第三处）。
 */
const 我的 = (e: ProjectEntry, role: ProjectMembership.MemberRole): ProjectEntry => ({ ...e, role })

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

  test("点私有 / 共享 ⇒ 先要一个名字，不立刻建（名字是锚点行上唯一的显示物）", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()

    expect(无槽(host, "project-panel-name")).toBe(false)
    // 关键：**还没建**。点了就建的话名字只能是编出来的，而 005 全仓没有改名入口 ⇒ 那名字是永久的。
    expect(记).toEqual([])
  })

  test("输入框出现时就拿住焦点——不然民警还得再点一下才打得出字", async () => {
    const host = mount(() => <ProjectPanel onCreate={() => {}} />)

    按钮(host, "project-panel-create-private")?.click()
    // 组件里聚焦要等一个微任务（`ref` 跑的时候节点还没进文档，见 `project-panel.tsx` 那条注）。
    await Promise.resolve()

    expect(焦点在输入框(host)).toBe(true)
  })

  test("打名字 ＋ 回车 ⇒ 报告 {name, type}，把输入框收起来（FR-003）", async () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    // 交出去是**异步**的：要等那边的回话才知道该收起还是该报错，故等回话落地再断。
    await 冲一遍()

    expect(记).toEqual([{ name: "8·17专案", type: "private" }])
    expect(无槽(host, "project-panel-name")).toBe(true)
    // 建成不等于「没有话要说」——这一槽位压根不该在（同下一条的「失败才在」）。
    expect(无槽(host, "project-panel-create-error")).toBe(true)
  })

  test("点「共享」建的共享项目，type 是 shared（两个入口各报各的）", async () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-shared")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()

    expect(记).toEqual([{ name: "8·17专案", type: "shared" }])
  })

  test("名字首尾的空格去掉（民警手滑打了尾空格，项目名不该带着它走）", async () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "  8·17专案  ")
    回车(host)
    await 冲一遍()

    expect(记).toEqual([{ name: "8·17专案", type: "private" }])
  })

  /**
   * 失败**必须看得见**。这一段是用户 2026-10-06 裁定「输入框下显示一句」的落点：
   * 交出去的名字要是没建成，而界面上一点动静都没有，民警只会以为点坏了、再点一次
   * ——而 005 全仓**没有改名、也没有删项目**，重复建出来的东西只能留着。
   *
   * 三件事一起断：① 那句话在；② 输入框**留着**（要能改个名字重来）；③ 名字还在框里
   * （不能让他重打一遍）。
   */
  test("没建成 ⇒ 输入框下显示出那句话，输入框留着、名字还在（不许悄无声息地没了）", async () => {
    const host = mount(() => <ProjectPanel onCreate={async () => "项目名已存在"} />)

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()

    expect(文本(host, "project-panel-create-error")).toBe("项目名已存在")
    expect(无槽(host, "project-panel-name")).toBe(false)
    expect(输入框(host)?.value).toBe("8·17专案")
  })

  /** 重来一次成功 ⇒ 那条文案跟着没了（不然上一次的失败会一直挂在那儿，像新的失败）。 */
  test("失败之后再建一次、这次成了 ⇒ 收起，那条文案也跟着消失", async () => {
    let 回话: string | undefined = "项目名已存在"
    const host = mount(() => <ProjectPanel onCreate={() => 回话} />)

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()
    // 前置：先证明它真的报过错，否则下面的「没了」可能只是从来没出现过。
    expect(文本(host, "project-panel-create-error")).toBe("项目名已存在")

    回话 = undefined
    回车(host)

    // **交出去的那一刻**上一条就该没了：留着的话，正在办的这一段里显示的是**上一次**的判决。
    expect(文本(host, "project-panel-create-error")).toBeUndefined()

    await 冲一遍()

    expect(无槽(host, "project-panel-create-error")).toBe(true)
    expect(无槽(host, "project-panel-name")).toBe(true)
  })

  /**
   * 失败了按 `Esc` 收起、再重开 ⇒ **没有残留文案**。
   *
   * 本条是**变异找出来的缺口补的**（`#003-03` ② 的形态）：把「收起草稿时一起清文案」那一行
   * 去掉，全组 30 条**一条都不红**。但那一行不是多余的——清的是这一条路径：收起草稿之后
   * 输入框没了，而文案信号还留着上一次那句话，重开时它就**跟着新草稿一起冒出来**，
   * 说的却是上一回的事。缺的不是代码，是没人走过这条路。
   */
  test("失败后按 Esc 收起，再重开 ⇒ 没有残留文案（上一次的判决不跟着新草稿回来）", async () => {
    const host = mount(() => <ProjectPanel onCreate={async () => "项目名已存在"} />)

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    await 冲一遍()
    // 前置：先证明它真的报过错，否则下面的「没有」可能只是从来没出现过。
    expect(文本(host, "project-panel-create-error")).toBe("项目名已存在")

    按下(host, "Escape")
    按钮(host, "project-panel-create-private")?.click()

    expect(无槽(host, "project-panel-create-error")).toBe(true)
  })

  /**
   * 「正在办」的时候回车不算数。
   *
   * 不是洁癖：005 全仓**没有删项目的入口**（`grep` 过），重复建出来的两个项目只能留着，
   * 而名字是永久的。这条路径是本 task 自己引入的——提交从同步改成异步之后，回车与回话之间
   * 才有了一段缝隙。
   */
  test("正在办的时候再按回车 ⇒ 只交一次（那段缝隙里按几下都不算）", async () => {
    let 回话: (v: string | undefined) => void = () => {}
    const 记: string[] = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input.name)
          return new Promise<string | undefined>((resolve) => {
            回话 = resolve
          })
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)
    // 前置：第一次真的交出去了（不然下面的「只一次」是废话）。
    expect(记).toEqual(["8·17专案"])

    回车(host)
    回车(host)

    expect(记).toEqual(["8·17专案"])

    // 回话之后仍然能正常收工（锁不是永久的）。
    回话(undefined)
    await 冲一遍()
    expect(无槽(host, "project-panel-name")).toBe(true)
  })

  /**
   * 正在办的时候点别处（失焦）**不收起**——与「正在办的时候回车不算数」同一条锁。
   *
   * 为什么失焦要跟回车一个待遇：收起之后那一行就没了，而**失败的话没地方落**
   * （文案槽在输入框里面）⇒ 民警看到的是「点了回车，然后什么都没发生」。这正是上一条要防的
   * 那种静默失败，只是从另一个门进来。
   */
  test("正在办的时候失焦 ⇒ 不收起（还没回话，这一行不能先没了）", async () => {
    const host = mount(() => (
      <ProjectPanel onCreate={() => new Promise<string | undefined>(() => {})} />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)

    失焦(host)

    expect(无槽(host, "project-panel-name")).toBe(false)
  })

  test("正在办的时候按 Esc ⇒ 也不收起（同上：锁是一次性的，等回话）", async () => {
    const host = mount(() => (
      <ProjectPanel onCreate={() => new Promise<string | undefined>(() => {})} />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    回车(host)

    按下(host, "Escape")

    expect(无槽(host, "project-panel-name")).toBe(false)
  })

  test("空名字回车 ⇒ 什么都不发生，输入框留着（不拿一个空名去建）", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "   ")
    回车(host)

    expect(记).toEqual([])
    expect(无槽(host, "project-panel-name")).toBe(false)
  })

  test("按 Esc ⇒ 收起，不建（改主意不用付出代价）", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    按下(host, "Escape")

    expect(记).toEqual([])
    expect(无槽(host, "project-panel-name")).toBe(true)
  })

  test("点到别处（失焦）⇒ 收起，不建", () => {
    const 记: Array<{ name: string; type: string }> = []
    const host = mount(() => (
      <ProjectPanel
        onCreate={(input) => {
          记.push(input)
        }}
      />
    ))

    按钮(host, "project-panel-create-private")?.click()
    输入(host, "8·17专案")
    失焦(host)

    expect(记).toEqual([])
    expect(无槽(host, "project-panel-name")).toBe(true)
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
    // 块体、不回话（`ProjectActionCallback` 的回话集合里没有 `number`——`push` 那个返回值
    // 不是「给民警看的一句话」，写成表达式体是拿数组长度冒充回话）。
    const host = mount(() => (
      <ProjectPanel
        projects={[封存]}
        onRestore={(p) => {
          记.push(p)
        }}
      />
    ))

    页签(host, "archived")?.click()
    组(host, "archived")?.querySelector<HTMLButtonElement>("[data-slot='project-restore']")?.click()

    expect(记.map((p) => p.id)).toEqual(["p2"])
  })

  /**
   * 「找回」是**归档区**的事（FR-009）：活跃列表里没有它。
   *
   * ⚠️ 这条原来**只查了活跃那一侧**、没切到「已归档」tab——而那条「不给回调即不画」的守卫
   * 正好长在归档组里 ⇒ 两边都没盖住。2026-10-07 席 B 审查抓出：调用方把 `onRestore` 包成
   * 一个**恒真的函数**之后，`ArchivedGroup` 的 `Show` 被永远点亮，而未接线时这里**照样全绿**。
   * 所以两侧都要断（`LEARNINGS #003-02`：修完一处要 grep 谁在按同一个前提做同一件事）。
   */
  test("「找回」只在「已归档」tab 出现，不在活跃列表里（FR-009 是归档区的事）", () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[私有("p1", "活跃专案", 2), 归档(私有("p2", "封存专案", 1))]}
        onRestore={() => {}}
      />
    ))

    expect(无槽(host, "project-restore")).toBe(true)

    页签(host, "archived")?.click()

    expect(无槽(host, "project-restore")).toBe(false)
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

/**
 * 归档 / 找回的**接线与呈现**（T023 · FR-008 / FR-009）。
 *
 * 本 task 只做接线与呈现：判定（谁能归档、归档态下能做什么）**一份都不在这里**，
 * 全部走 `ProjectMembership.decide`（`project-panel.tsx` 的 `canArchive`）。
 * 所以这组用例钉的是**范围**（画在哪个 tab、哪一行画）与**流程**（二次确认、失败落到哪）。
 *
 * ⚠️ 二次确认是本组最要紧的一条：归档**是破坏性操作**（沙箱文件先备份进 MinIO、本地那份删掉），
 * 而 005 全仓**没有「取消归档」**——误触之后只能等文件搬回来。所以「点一下就直接归档」这件事
 * 必须有一条用例明确地说不允许（`记` 在确认之前是空的）。
 */
describe("归档 / 找回的接线（T023）", () => {
  /** 切到「全部」再点那一行尾巴上的「归档」——面板上的归档动作**只**画在那儿（设计 §8.1）。 */
  const 点归档 = (host: HTMLElement) => {
    页签(host, "all")?.click()
    按钮(host, "project-archive")?.click()
  }

  test("「全部」tab 上，owner 那一行带「归档」，且写明是归档哪一个（FR-008 的入口）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(文本(host, "project-archive")).toBe("归档")
    expect(按钮(host, "project-archive")?.getAttribute("aria-label")).toBe("归档 8·17专案")
  })

  test("「最近」tab 不画「归档」——归档动作只画在「全部」里（设计 §8.1）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    expect(无槽(host, "project-archive")).toBe(true)
  })

  test("member 的行不画「归档」（owner 才行——判定走 `decide`，组件零规则复述）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(共享("p2", "串并案", 2, 3), "member")]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-archive")).toBe(true)
  })

  /**
   * 缺 `role` = **没有成员关系**（不是 member）⇒ fail-closed。
   *
   * 这条与上一条分开，因为它们是两件事：上一条是「判定说不行」，这条是「**没有授权依据**」。
   * 后者最危险的写法是给个默认角色（`?? "owner"` 会立刻放行，`?? "member"` 则把「不知道」
   * 说成「知道他不是 owner」）——两种都不报错、不变红（`LEARNINGS #004-07`）。
   */
  test("没有 role 的行不画「归档」（缺键 = 没有授权依据，不倒向任何角色）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[私有("p1", "8·17专案", 3)]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-archive")).toBe(true)
  })

  test("没接线（没传 onArchive）⇒ 谁都不画「归档」（不画一个点了没用的按钮）", () => {
    const host = mount(() => <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} />)

    页签(host, "all")?.click()

    expect(无槽(host, "project-archive")).toBe(true)
  })

  /**
   * 上一条的**第二个出口**（FR-009）。两条分开写，因为守卫长在两个不同的组里——归档那条读
   * `props.onAskArchive`，找回这条读 `props.onRestore`（在 `ArchivedGroup` 内部）。
   *
   * ⚠️ 必须**切到「已归档」tab**才测得到：守卫在归档组里，不切过去它压根不渲染，这条就退化成
   * 一句废话（原来的「找回只在已归档 tab」那条正是这么退化的）。
   */
  test("没接线（没传 onRestore）⇒ 「已归档」tab 上谁都不画「找回」（同一个约定的第二个出口）", () => {
    const host = mount(() => <ProjectPanel projects={[归档(私有("p2", "封存专案", 1))]} />)

    页签(host, "archived")?.click()

    expect(无槽(host, "project-restore")).toBe(true)
  })

  test("点「归档」是先问一句，**不立刻交出去**（破坏性操作要二次确认）", () => {
    const 记: ProjectEntry[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(私有("p1", "8·17专案", 3), "owner")]}
        onArchive={(p) => {
          记.push(p)
        }}
      />
    ))

    点归档(host)

    expect(记).toEqual([])
    expect(无槽(host, "project-archive-confirm")).toBe(false)
  })

  test("确认条上写出归档的是哪一个项目（点确认前得看清对象）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    点归档(host)

    expect(文本(host, "project-archive-name")).toBe("8·17专案")
  })

  /**
   * 确认文案必须说清**三步**（用户 2026-10-06 裁定）——这不是措辞洁癖：民警要据此判断
   * 「我点下去会失去什么、还能不能拿回来」。三件事各对应实现里一个真实的事实：
   * 备份先发生（T013 的次序保证）、本地那份真的没了、之后能找回（FR-009 存在）。
   */
  test("确认文案说清三件事：先备份进 MinIO、本地这份删掉、之后能找回", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    点归档(host)

    const 文案 = 文本(host, "project-archive-confirm") ?? ""
    expect(文案).toContain("MinIO")
    expect(文案).toContain("删掉")
    expect(文案).toContain("找回")
  })

  test("取消 ⇒ 确认条收掉，什么都不发（改主意不用付出代价）", () => {
    const 记: ProjectEntry[] = []
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(私有("p1", "8·17专案", 3), "owner")]}
        onArchive={(p) => {
          记.push(p)
        }}
      />
    ))

    点归档(host)
    按钮(host, "project-archive-cancel")?.click()

    expect(无槽(host, "project-archive-confirm")).toBe(true)
    expect(记).toEqual([])
  })

  test("确认 ⇒ 交出去的是那一行项目本身，确认条同时收掉（不留一条挡住第二次点）", async () => {
    const 记: ProjectEntry[] = []
    const 甲 = 我的(私有("p1", "8·17专案", 3), "owner")
    const host = mount(() => (
      <ProjectPanel
        projects={[甲]}
        onArchive={(p) => {
          记.push(p)
        }}
      />
    ))

    点归档(host)
    按钮(host, "project-archive-ok")?.click()
    await 冲一遍()

    expect(记).toEqual([甲])
    expect(无槽(host, "project-archive-confirm")).toBe(true)
  })

  /**
   * 没办成必须有回音。**点了归档却什么都没发生**是最坏的一种静默：民警会以为归档好了，
   * 而项目还在「全部」里（同 `project-panel-create-error` 那条「失败的话没地方落」）。
   */
  test("归档没办成 ⇒ 面板底下那句话，`role=alert`（点了什么都不发生是最坏的静默）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => "无权归档该项目"} />
    ))

    点归档(host)
    按钮(host, "project-archive-ok")?.click()
    await 冲一遍()

    expect(文本(host, "project-panel-action-error")).toBe("无权归档该项目")
    expect(槽(host, "project-panel-action-error")?.getAttribute("role")).toBe("alert")
  })

  test("归档办成了（回调不回话）⇒ 一句错误文案都不留", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    点归档(host)
    按钮(host, "project-archive-ok")?.click()
    await 冲一遍()

    expect(无槽(host, "project-panel-action-error")).toBe(true)
  })

  /** 下一次动作开始时上一句话就该消失——留着它，民警分不清那是新结果还是旧结果。 */
  test("再办一次 ⇒ 上一次那句话先清掉（不把旧结论挂在新动作上）", async () => {
    let 这次: string | undefined = "第一次没办成"
    const host = mount(() => (
      <ProjectPanel
        projects={[我的(私有("p1", "8·17专案", 3), "owner")]}
        onArchive={() => {
          const 回话 = 这次
          这次 = undefined
          return 回话
        }}
      />
    ))

    点归档(host)
    按钮(host, "project-archive-ok")?.click()
    await 冲一遍()
    expect(文本(host, "project-panel-action-error")).toBe("第一次没办成")

    点归档(host)
    按钮(host, "project-archive-ok")?.click()
    await 冲一遍()

    expect(无槽(host, "project-panel-action-error")).toBe(true)
  })

  test("找回没办成 ⇒ 同一处报错（两个动作共一格，不各报一半）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[归档(私有("p2", "封存专案", 1))]} onRestore={() => "找回项目失败"} />
    ))

    页签(host, "archived")?.click()
    按钮(host, "project-restore")?.click()
    await 冲一遍()

    expect(文本(host, "project-panel-action-error")).toBe("找回项目失败")
  })

  test("找回的回话是异步的（Promise）也等得到（同 onCreate 那条）", async () => {
    const host = mount(() => (
      <ProjectPanel
        projects={[归档(私有("p2", "封存专案", 1))]}
        onRestore={() => Promise.resolve("还是不行")}
      />
    ))

    页签(host, "archived")?.click()
    按钮(host, "project-restore")?.click()
    await 冲一遍()

    expect(文本(host, "project-panel-action-error")).toBe("还是不行")
  })

  test("找回办成了 ⇒ 不留错误文案（同一格的另一半）", async () => {
    const host = mount(() => (
      <ProjectPanel projects={[归档(私有("p2", "封存专案", 1))]} onRestore={() => {}} />
    ))

    页签(host, "archived")?.click()
    按钮(host, "project-restore")?.click()
    await 冲一遍()

    expect(无槽(host, "project-panel-action-error")).toBe(true)
  })
})

/**
 * 超期提醒的呈现（T024 · FR-008 的下半条：3 个月无操作 ⇒ **提醒 owner** 确认后归档）。
 *
 * ## 本 task 只做「呈现」，判定一条都不在这里
 *
 * `stale` 是**服务端算好的**（`project_ext.last_accessed_at` ＋ 一次 `Date.now()`，
 * 见 `core/src/project/ext.ts` 的 `isStale`）——本面板不碰时钟、不碰「90 天」那个数。
 * 谁该被提醒则复用现成的 `canArchive`（`ProjectMembership.decide` 那一份实现），
 * 所以本组钉的是**范围**：提醒跟着「能归档」那一行走，且**不跟着归档按钮一起被限制在「全部」tab**。
 *
 * ## 提醒与动作是两件事（用户 2026-10-07 裁定的范围）
 *
 * `行` 上出现「超期未归档」**只说明事实**（这个项目 3 个月没人动过），它不是一个按钮：
 * 归档那个动作仍只在「全部」tab 的那一行上（设计 §8.1）。所以下面有一条用例专门钉
 * 「最近 tab 有提醒、却没有归档按钮」——这两件事混起来（把提醒挂在按钮的守卫上）会让
 * 民警在「最近」里看不到任何提醒，而那正是他每天会打开的那个 tab。
 */
describe("超期提醒的呈现（T024）", () => {
  /** 一个「超期」的行（服务端说这一行的 `stale` 为真）。 */
  const 超期 = (e: ProjectEntry): ProjectEntry => ({ ...e, stale: true })

  test("「全部」tab：owner 那一行带「超期未归档」（FR-008 的提醒）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(我的(私有("p1", "8·17专案", 3), "owner"))]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(文本(host, "project-stale")).toBe("超期未归档")
  })

  /** 不超期 ⇒ 什么都不画（缺的槽位读作 `undefined`，不是「空字」）。 */
  test("没过 3 个月的行不带提醒（`stale` 缺键 = 不提醒）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[我的(私有("p1", "8·17专案", 3), "owner")]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /**
   * **提醒只给能归档的那个人**（owner）——判定复用 `canArchive`，组件零规则复述。
   * member 看得见项目，但归档不是他能做的（`decide` 拒）⇒ 提醒他也不该看到：
   * 一条他无法处置的提醒只是噪音（`§3` 那句「提醒 owner 确认」的「owner」就是这个意思）。
   */
  test("member 的行不带提醒（提醒的是能处置它的那个人）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(我的(共享("p2", "串并案", 2, 3), "member"))]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /** 缺 `role` = 没有成员关系 ⇒ 同 `canArchive`：fail-closed，不提醒。 */
  test("没有 role 的行不带提醒（缺键 = 没有授权依据，不倒向 owner）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(私有("p1", "8·17专案", 3))]} onArchive={() => {}} />
    ))

    页签(host, "all")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /** 已归档的行不带提醒——归档就是这条提醒的**结果**（`canArchive` 对归档态拒）。 */
  test("已归档的行不带提醒（归档正是这条提醒要办的事，办完了就不提醒）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(归档(我的(私有("p1", "8·17专案", 3), "owner")))]} onRestore={() => {}} />
    ))

    页签(host, "archived")?.click()

    expect(无槽(host, "project-stale")).toBe(true)
  })

  /**
   * **「最近」tab 也画提醒**，但**不画**归档按钮——这两件事在 T024 被刻意拆开
   * （`onArchive` 只喂给「全部」那一组，而提醒跟着 `canArchive` 走）。
   *
   * 一条用例同时钉住两半：少了后半句，把提醒挂在 `onAskArchive` 上的写法会绿；少了前半句，
   * 提醒只活在用户不常打开的 tab 里（每天打开的是「最近」）。
   */
  test("「最近」tab 也画提醒，但不画「归档」（提醒只说明事实，动作仍在「全部」）", () => {
    const host = mount(() => (
      <ProjectPanel projects={[超期(我的(私有("p1", "8·17专案", 3), "owner"))]} onArchive={() => {}} />
    ))

    expect(文本(host, "project-stale")).toBe("超期未归档")
    expect(无槽(host, "project-archive")).toBe(true)
  })
})
