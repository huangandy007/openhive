import { beforeEach, describe, expect, test } from "bun:test"
import { For, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { useModuleAction, type ModuleAction } from "@/center/module-actions"
import { useCenterTabs } from "@/center/tab-context"
import { type ContentTab } from "@/center/tab-store"
import { setCurrentProject } from "@/project/current-project"
import { setMinioBackups } from "@/project/minio-backups"
import { setProjectFiles } from "@/project/project-files"
import { setProjectList } from "@/project/project-list"
import { setProjectMembers } from "@/project/project-members"
import { setCurrentUser } from "./current-user"
import { WorkspaceEntry } from "./workspace-entry"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 上游 `Titlebar` 的顶栏右侧注入点；测试里造一个同用途的容器代替真顶栏。 */
function titlebarSlot() {
  const slot = document.createElement("div")
  document.body.appendChild(slot)
  return slot
}

const entries = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']"),
]

const railLabels = (host: HTMLElement) => entries(host).map((el) => el.getAttribute("aria-label"))

const currentModule = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-slot='rail-entry'][aria-current='page']")?.getAttribute("aria-label")

const 入口 = (host: HTMLElement, label: string) => {
  const found = entries(host).find((el) => el.getAttribute("aria-label") === label)
  if (!found) throw new Error(`图标栏里没有「${label}」`)
  return found
}

const text = (root: HTMLElement, slot: string) => root.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

/**
 * 某选择器**不存在**吗？——返回**布尔**，不是节点。
 *
 * ⚠️ 不能图省事写成 `expect(host.querySelector("[data-…]")).toBeNull()`：**那条断言红了会把整轮
 * 测试挂死**。机制（2026-10-06 实测，bun 1.3.14 + happy-dom）：断言失败时 bun 打印**实得值**，
 * 而**被 Solid 渲染过的节点**会让打印器停不下来——同一条断言，实得值换成手搓的
 * `document.createElement("button")`（挂进文档、带子节点）是 **133ms** 出结果，换成 `render()`
 * 出来的元素则 **45s 仍未结束、被 `timeout` 杀掉**（脱离文档也一样）；进程内存同时涨到 ~375MB。
 * 挂死时**一条结果都拿不到**：不是红，是哑——比红更坏，看着像「还没跑完」。
 * 断在这个布尔上，红的时候打印的是 `false`，毫秒级。
 *
 * ⚠️ 本文件里既有几处 `expect(...).toBeNull()`（判 `topbar` / `document-view` 不在的那些）是**同样
 * 形状**、同样会挂哑，但不是 005 加的，按「只动自己碰过的地方」留原样，只在 state.md 里挂账。
 */
const 不存在 = (root: HTMLElement, selector: string) => root.querySelector(selector) === null

describe("WorkspaceEntry 进入三栏工作台的入口", () => {
  // 身份是模块级接入缝（F2 才写），测试之间必须复位，否则互相串味。
  beforeEach(() => setCurrentUser(undefined))

  test("进入后落在三栏工作台：图标栏 + 中栏都就位，默认停在第一个入口", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <div data-slot="center-content">中栏内容</div>
      </WorkspaceEntry>
    ))

    expect(railLabels(host)).toEqual(["项目管理", "AI 资产", "AI 会话", "话单分析", "资金分析", "系统设置"])
    expect(host.querySelector("[data-slot='three-pane-center']")).not.toBeNull()
    expect(text(host, "center-content")).toBe("中栏内容")
    expect(currentModule(host)).toBe("项目管理")
  })

  test("图标栏在三栏左侧（DESIGN §4.1：图标栏 → 三栏）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    const 工作台 = host.querySelector("[data-component='workspace-entry']")

    expect(工作台?.firstElementChild?.getAttribute("data-component")).toBe("rail")
  })

  test("点图标栏入口切换当前停留的模块", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    入口(host, "资金分析").click()

    expect(currentModule(host)).toBe("资金分析")
  })

  test("没有注入点时顶栏不渲染（不存在的挂载点不该被硬塞进中栏）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(host.querySelector("[data-component='topbar']")).toBeNull()
  })

  test("顶栏挂进上游注入点，而不是留在工作台里（DESIGN §4.4）", () => {
    const slot = titlebarSlot()
    const host = mount(() => <WorkspaceEntry titlebarRight={() => slot}>中栏</WorkspaceEntry>)

    expect(slot.querySelector("[data-slot='topbar-brand-name']")).not.toBeNull()
    expect(host.querySelector("[data-component='topbar']")).toBeNull()
  })

  test("身份未就位时顶栏照常，但不给用户区（宁缺勿假）", () => {
    const slot = titlebarSlot()
    mount(() => <WorkspaceEntry titlebarRight={() => slot}>中栏</WorkspaceEntry>)

    expect(text(slot, "topbar-brand-name")).toBe("OpenHive")
    expect(slot.querySelector("[data-slot='topbar-user']")).toBeNull()
  })

  test("身份就位后顶栏显示用户区（F2 的接入点）", () => {
    const slot = titlebarSlot()
    mount(() => <WorkspaceEntry titlebarRight={() => slot}>中栏</WorkspaceEntry>)

    setCurrentUser({ name: "张三", policeId: "012345" })

    expect(text(slot, "topbar-user-name")).toBe("张三")
    expect(text(slot, "topbar-user-police-id")).toBe("警号: 012345")
  })
})

const 专案: ContentTab = { module: "project", title: "专案A", path: "/p/a.intent" }
const 话单: ContentTab = { module: "cdr-analysis", title: "话单.csv", path: "/p/cdr.csv" }

/**
 * 中栏里替模块开 tab 的消费者——写法与 T011 的「模块动作」同构（`useCenterTabs().open`），
 * 不是测试专用后门。001 尚无模块动作，故这条通路由测试直接驱动。
 */
function OpenTabs(props: { tabs: ContentTab[] }) {
  const center = useCenterTabs()
  onMount(() => props.tabs.forEach((tab) => center.open(tab)))
  return null
}

const tabTitles = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-slot='tab-title']"),
].map((el) => el.textContent)

describe("中栏 tab 与左栏模块切换的联动（FR-006）", () => {
  test("中栏顶部挂着 tab 栏，模块开的 tab 显示在里面", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))

    const bar = host.querySelector("[data-component='tab-bar']")
    expect(bar).not.toBeNull()
    expect(bar?.closest("[data-slot='three-pane-center']")).not.toBeNull()
    expect(tabTitles(host)).toEqual(["专案A", "话单.csv"])
  })

  test("左栏切模块后，中栏已有 tab 仍在、激活态不变（FR-006 出参）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))
    const 激活 = () =>
      host.querySelector<HTMLElement>("[data-slot='tab'][aria-selected='true']")?.getAttribute("data-module")

    入口(host, "资金分析").click()

    expect(currentModule(host)).toBe("资金分析")
    expect(tabTitles(host)).toEqual(["专案A", "话单.csv"])
    expect(激活()).toBe("cdr-analysis")
  })

  test("点 tab 栏上的关闭：这张 tab 真的从状态里消失（挂载不是摆设）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))

    host.querySelector<HTMLElement>("[data-slot='tab'] [data-slot='tab-close']")?.click()

    expect(tabTitles(host)).toEqual(["话单.csv"])
  })

  test("点非激活的 tab：切过去（激活态跟着走）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))
    const 激活模块 = () =>
      host.querySelector<HTMLElement>("[data-slot='tab'][aria-selected='true']")?.getAttribute("data-module")

    // 后打开的那张是激活的（打开即切过去），随后点第一张应当把激活态挪过去
    expect(激活模块()).toBe("cdr-analysis")

    host.querySelectorAll<HTMLElement>("[data-slot='tab']")[0]?.click()

    expect(激活模块()).toBe("project")
  })
})

const 明细动作: ModuleAction = { title: "明细 - 广州××公司", content: "detail:acct-4419" }
const 图谱动作: ModuleAction = { title: "资金流转图谱", content: "graph:acct-4419" }

/** 中栏里的模块 UI：按钮即模块动作（`useModuleAction()` 的既定用法，见 T011）。 */
function 动作面板(props: { actions: ModuleAction[] }) {
  const run = useModuleAction()
  return (
    <For each={props.actions}>
      {(action) => (
        <button type="button" data-slot="module-action" onClick={() => run(action)}>
          {action.title}
        </button>
      )}
    </For>
  )
}

const 触发 = (host: HTMLElement, action: ModuleAction) => {
  const button = [...host.querySelectorAll<HTMLElement>("[data-slot='module-action']")].find(
    (el) => el.textContent === action.title,
  )
  if (!button) throw new Error(`面板里没有动作「${action.title}」`)
  button.click()
}

/**
 * 集成守卫（非 RED 驱动，实现已就绪后补）：T011 的单测已证「动作 → 中栏状态」、
 * T010 已证「状态 → tab 栏」，本条只是把两段接起来，在**看得见的层面**兑一遍 FR-010 的出参。
 */
describe("模块动作开出的特有 tab（FR-010 出参）", () => {
  test("模块动作开出的 tab 显示在中栏 tab 栏里，跨模块累积", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <动作面板 actions={[明细动作, 图谱动作]} />
      </WorkspaceEntry>
    ))

    触发(host, 明细动作) // 进门停在第一个入口「项目管理」
    入口(host, "资金分析").click()
    触发(host, 图谱动作)

    expect(tabTitles(host)).toEqual(["明细 - 广州××公司", "资金流转图谱"])
    expect(currentModule(host)).toBe("资金分析")
  })
})

/**
 * 等到 `条件` 成立（最多等约 1 秒）。
 *
 * 加载链现在**以动态 import 起头**——视图是懒加载的，第一个 chunk 要读盘 + 编译，耗时看机器，
 * 固定「睡一个 0ms」等不到（这正是原来那句 `await 落定()` 的假设）。轮询只负责给足时间，
 * **断言仍由调用方自己下**：等不到就是断言失败，不会静默放过。
 */
async function 等到(条件: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const 立项书: ModuleAction = { title: "立项书.docx", content: "/p/立项书.docx" }

/**
 * 集成守卫（非 RED 驱动，通路就绪后补）：T012 的注册表 / 渲染器已由各自单测证明，
 * 本条只证它们**真的挂进了工作台**——不是又一堆「组件齐备、没接进应用」的文件
 * （T006/T007 就栽在这上面，见 `workspace-entry.tsx` 头注）。
 */
describe("中栏内容区接进工作台（FR-007 出参）", () => {
  test("模块动作打开的 .docx tab：中栏长出 Word 预览视图", async () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <动作面板 actions={[立项书]} />
      </WorkspaceEntry>
    ))

    触发(host, 立项书)
    await 等到(() => host.querySelector("[data-component='document-view']") !== null)

    expect(host.querySelector("[data-component='document-view']")).not.toBeNull()
  })

  test("一张 tab 都没有时，中栏仍是应用自己的页面内容（内容区不夺位）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <div data-slot="page">页面内容</div>
      </WorkspaceEntry>
    ))

    expect(host.querySelector("[data-component='document-view']")).toBeNull()
    expect(text(host, "page")).toBe("页面内容")
  })

  test("应用入口注入的取数接缝一路走到视图（load 不是断在中间）", async () => {
    const 取过的: string[] = []
    const host = mount(() => (
      <WorkspaceEntry
        loadFile={async (path) => {
          取过的.push(path)
          return undefined
        }}
      >
        <动作面板 actions={[立项书]} />
      </WorkspaceEntry>
    ))

    触发(host, 立项书)
    await 等到(() => 取过的.length > 0)

    expect(取过的).toEqual(["/p/立项书.docx"])
  })
})

/**
 * 左栏（项目侧栏）接进工作台（FR-001 出参）。
 *
 * `ThreePane` 早有可用的 `left` 槽，但**一直没人传**——本组件（`workspace-entry.tsx`）是它的
 * 唯一接线处，`workspace-entry.tsx` 头注里那句「图标栏与顶栏此前都只是『组件齐备、没接进应用』」
 * 说的就是这个坑，而 005 的锚点行正是踩在同一格上：组件写好了不接线，等于没做。
 */
describe("左栏（项目侧栏）接进工作台（FR-001 出参）", () => {
  // 「当前项目」是模块级接入缝（T006 才写），测试之间必须复位，否则互相串味（同 `currentUser`）。
  beforeEach(() => setCurrentProject(undefined))

  test("进门停在「项目管理」，左栏就位、锚点行在它顶部", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    const 左栏 = host.querySelector("[data-slot='three-pane-left']")
    expect(左栏).not.toBeNull()
    // T005 时断言的是「锚点行是左栏的**第一个孩子**」；T006 给左栏加了一层定位容器
    // （`project-sidebar`，面板要靠它当定位祖先），故改成「锚点在左栏里、且是侧栏的第一个孩子」——
    // 断言的是**同一件事**（锚点占据顶部），只是不再把容器的存在与否写进判据。
    const 侧栏 = 左栏?.querySelector("[data-component='project-sidebar']")
    expect(侧栏?.firstElementChild?.getAttribute("data-component")).toBe("project-anchor")
  })

  test("当前项目还没来源时，锚点行走空态、不伪造项目名（宁缺勿假）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(text(host, "project-anchor-name")).toBe("未选择项目")
  })

  test("接入缝写进项目后锚点跟着显示（T006 的落点）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    setCurrentProject({ name: "8·17专案", memberCount: 3 })

    expect(text(host, "project-anchor-name")).toBe("8·17专案")
    expect(text(host, "project-anchor-member-count")).toBe("3")
  })

  test("切到别的模块，左栏让位（左栏是「项目管理」这个模块的）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    入口(host, "资金分析").click()

    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(true)
    expect(不存在(host, "[data-component='project-anchor']")).toBe(true)
  })

  test("切回来左栏回来——让位不是一次性的", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    入口(host, "资金分析").click()
    入口(host, "项目管理").click()

    expect(host.querySelector("[data-component='project-anchor']")).not.toBeNull()
  })
})

const 面板 = (host: HTMLElement) => host.querySelector("[data-component='project-panel']")
/** 面板开着吗？——返回**布尔**（`#005-01`：断节点会把整轮测试挂哑）。 */
const 开着 = (host: HTMLElement) => 面板(host) !== null
const 锚点按钮 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)
/** 侧栏里各层的顺序（用 `data-` 名标识，因为既有 `data-component` 也有 `data-slot`）。 */
const 侧栏层级 = (host: HTMLElement) =>
  [...(host.querySelector("[data-component='project-sidebar']")?.children ?? [])].map(
    (el) => el.getAttribute("data-component") ?? el.getAttribute("data-slot"),
  )

/**
 * 项目面板接进左栏（FR-002 / FR-003 出参）。
 *
 * 这一节验的是**接线**（T005 立下的那条规矩：组件写好不接线，等于没做）：
 * 面板的数据来自 `@/project/project-list` 那条接入缝、开关来自锚点行、点一行会回流到
 * `@/project/current-project`——三段都在真实组件树上，不是各自单测里。
 */
describe("项目面板接进左栏（FR-002 出参）", () => {
  // 两条接入缝都是模块级的（T006 才写），测试之间必须复位，否则互相串味（同 `currentUser`）。
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
  })

  test("没点 ▾ 之前面板不占位——它是滑出的浮层，不是常驻的一栏（设计 §3）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(开着(host)).toBe(false)
  })

  test("点 ▾ 滑出项目面板：在左栏里，且排在锚点行之后", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    锚点按钮(host, "project-anchor-toggle")?.click()

    expect(开着(host)).toBe(true)
    expect(面板(host)?.closest("[data-slot='three-pane-left']")).not.toBeNull()
    // `sidebar-tabs` 是 T019 加的左栏 ②③（tab 容器 ＋ 主体）；面板是 `absolute` 浮层，
    // 排在它前面只是 DOM 顺序，视觉上仍压在文件树之上。
    expect(侧栏层级(host)).toEqual([
      "project-anchor",
      "project-panel-slot",
      "sidebar-tabs",
      "minio-bar",
    ])
  })

  test("再点 ▾ 收起——它是开关，不是单程票", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    锚点按钮(host, "project-anchor-toggle")?.click()
    // ⚠️ 这行**前置**不是废话：缺了它，本条在「面板压根不存在」时也全绿（两个 `false` 相等），
    // 而那种绿什么也没证明——本 task 第一次跑 RED 时它就是这样混过去的（`#004-14`）。
    expect(开着(host)).toBe(true)

    锚点按钮(host, "project-anchor-toggle")?.click()

    expect(开着(host)).toBe(false)
  })

  test("面板列的项目来自接入缝；缝里没数据时走空态，不伪造项目（宁缺勿假）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    锚点按钮(host, "project-anchor-toggle")?.click()

    expect(text(host, "project-panel-empty")).toBe("还没有项目")

    setProjectList([{ id: "p1", name: "8·17专案", type: "private", lastAccessedAt: 1 }])

    expect(text(host, "project-item-name")).toBe("8·17专案")
    expect(text(host, "project-panel-empty")).toBeUndefined()
  })

  // 本条是**变异 M7 找出来的缺口补的**（`project-panel.tsx` 那侧的「当前标记」早有覆盖，
  // 缺的是「接线把 `currentProject()?.id` 传进 `currentId`」这一根线）：把 `<ProjectPanel>` 的
  // `currentId` 换成 `undefined` 时，全文件 27 条一条都不红。这不是死代码——面板标出当前项目
  // 是设计 §3 明写的用户可见行为——所以处理是**补断言**，不是删代码（`#003-03` ③ 的形态、
  // 但落点不同：死的那段是**接线**，活的是组件）。
  test("面板里「当前项目」那行带标记——接线真的把 currentId 传下去了（设计 §3 的「（当前）」）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setCurrentProject({ id: "p1", name: "8·17专案" })
    setProjectList([
      { id: "p1", name: "8·17专案", type: "private", lastAccessedAt: 2 },
      { id: "p2", name: "旧案", type: "private", lastAccessedAt: 1 },
    ])

    锚点按钮(host, "project-anchor-toggle")?.click()

    const 行 = [...host.querySelectorAll("[data-slot='project-item']")]
    expect(行.length).toBe(2)
    const 当前行 = 行.filter((el) => el.getAttribute("data-current") === "true")
    expect(当前行.length).toBe(1)
    expect(当前行[0]?.textContent).toContain("8·17专案")
  })

  test("点面板里的一行：锚点行跟着变（US1 AC4），面板同时收起（设计 §3「点一下直达」）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    锚点按钮(host, "project-anchor-toggle")?.click()
    setProjectList([
      { id: "p1", name: "8·17专案", type: "shared", memberCount: 3, lastAccessedAt: 1 },
    ])

    host.querySelector<HTMLButtonElement>("[data-slot='project-item']")?.click()

    expect(text(host, "project-anchor-name")).toBe("8·17专案")
    expect(text(host, "project-anchor-member-count")).toBe("3")
    expect(开着(host)).toBe(false)
  })

  test("锚点行的 ＋ 已接线（不再是禁用态）——它今天打开面板，面板置顶就是新建入口", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(锚点按钮(host, "project-anchor-create")?.disabled).toBe(false)

    锚点按钮(host, "project-anchor-create")?.click()

    expect(开着(host)).toBe(true)
    // 但「新建」本身仍无接收方（T006 不落库）⇒ 面板里那两个按钮是禁用的。两条一起断，
    // 才不会把「打开了面板」误读成「能建项目了」。
    expect(锚点按钮(host, "project-panel-create-private")?.disabled).toBe(true)
  })

  test("切到别的模块，面板跟左栏一起让位", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(开着(host)).toBe(true) // 前置：先证明它开着，否则「关着」什么也没证明（同上）

    入口(host, "资金分析").click()

    expect(开着(host)).toBe(false)
  })
})

const 树 = (host: HTMLElement) => host.querySelector("[data-component='file-tree']")
/** 左栏里有文件树吗？——返回**布尔**（`#005-01`）。 */
const 有树 = (host: HTMLElement) => 树(host) !== null
const 树行 = (host: HTMLElement) => [...host.querySelectorAll("[data-slot='file-tree-row']")]

/**
 * 文件树接进左栏（FR-005 出参）。
 *
 * 与上一节同因（T005 立下的规矩）：组件单测里全绿，不等于**接线接上了**。
 * 这一节验的正是那根线——数据来自 `@/project/project-files` 这条缝、落在左栏 ③ 的位置、
 * 且**今天没有写入方**（缝恒空 ⇒ 走空态）。T007 时它直接挂在锚点行下；T019 把它**整体搬进**
 * 了 ② 的「文件」pane（`sidebar-tabs.tsx` 的 `file-tree-slot`），组件本身一行未改。
 */
describe("文件树接进左栏（FR-005 出参）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectFiles(undefined)
  })

  test("左栏里有一棵文件树，排在锚点行之后", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(有树(host)).toBe(true)
    expect(树(host)?.closest("[data-slot='three-pane-left']")).not.toBeNull()
    // T019 之后树不再挂在侧栏直接孩子上，而是**搬进** ② 的「文件」pane（左栏 ③）——
    // 位置变了，身份没变：它仍然是 `file-tree-slot`（`sidebar-tabs.tsx` 里那个 pane 的 `data-slot`）。
    expect(侧栏层级(host)).toEqual(["project-anchor", "sidebar-tabs", "minio-bar"])
    expect(树(host)?.closest("[data-slot='file-tree-slot']")).not.toBeNull()
  })

  test("缝里写进路径，树里就长出来——接线真的把 projectFiles() 传下去了", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    setProjectFiles(["资料/8·17/话单.csv", "笔记.md"])

    expect(树行(host).map((el) => el.getAttribute("data-path"))).toContain("资料/8·17/话单.csv")
  })

  test("缝里没数据时走空态，不伪造文件（宁缺勿假）——今天确实没有写入方", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(树行(host).length).toBe(0)
    expect(text(host, "file-tree-empty")).toBe("还没有文件")
  })

  test("三个动作今天都没接线 ⇒ ＋ / 重命名 / 删除 是禁用的，搜索与收缩展开照常可用", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    const 按钮 = (slot: string) => host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)
    expect(按钮("file-tree-action-create")?.disabled).toBe(true)
    expect(按钮("file-tree-action-rename")?.disabled).toBe(true)
    expect(按钮("file-tree-action-delete")?.disabled).toBe(true)
    expect(按钮("file-tree-action-collapse-all")?.disabled).toBe(false)
    expect(按钮("file-tree-action-expand-all")?.disabled).toBe(false)
  })

  test("切到别的模块，文件树跟左栏一起让位", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    expect(有树(host)).toBe(true) // 前置：先证明它在，否则「不在」什么也没证明（`#004-14`）

    入口(host, "资金分析").click()

    expect(有树(host)).toBe(false)
  })
})

const 成员面板 = (host: HTMLElement) => host.querySelector("[data-component='member-panel']")
/** 成员面板开着吗？——返回**布尔**（`#005-01`：断节点会把整轮测试挂哑）。 */
const 成员面板开着 = (host: HTMLElement) => 成员面板(host) !== null

/**
 * 成员面板接进左栏（FR-004 / US3 出参）。
 *
 * 与上两节同因（T005 立下的规矩）：组件单测里全绿，不等于**接线接上了**。
 * 这一节验的正是那根线——`👥 N` 徽章是入口（`ProjectAnchor` 早在 T005 就预留了
 * `onOpenMembers`，注释点名「接的是 T010 的成员面板」）、数据来自 `@/project/project-members`
 * 这条缝、面板落在左栏里。
 *
 * ⚠️ **今天没有写入方**（缝恒空 ⇒ 走空态），三个动作回调也没接线（⇒ 禁用）——
 * 那两笔是 T021 的账（邀请/移除/退群的落库 ＋ HTTP 出口），见 `tasks.md`。
 */
describe("成员面板接进左栏（FR-004 / US3 出参）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectMembers(undefined)
  })

  test("项目是共享的（有 `👥 N`）时，点徽章滑出成员面板：在左栏里，且排在锚点行之后", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    // 徽章只在有 `memberCount` 时存在（`ProjectAnchor` 的 `<Show when={props.memberCount}>`），
    // 所以先给当前项目一个共享项目的形状——私有项目**不该**有成员管理入口。
    setCurrentProject({ name: "8·17专案", memberCount: 3 })

    锚点按钮(host, "project-anchor-members")?.click()

    expect(成员面板开着(host)).toBe(true)
    expect(成员面板(host)?.closest("[data-slot='three-pane-left']")).not.toBeNull()
  })

  test("再点徽章收起——它是开关，不是单程票", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setCurrentProject({ name: "8·17专案", memberCount: 3 })

    锚点按钮(host, "project-anchor-members")?.click()
    // ⚠️ 前置不是废话（同上一节那条）：缺了它，本条在「面板压根不存在」时也全绿，
    // 而那种绿什么也没证明（`#004-14`）。
    expect(成员面板开着(host)).toBe(true)

    锚点按钮(host, "project-anchor-members")?.click()

    expect(成员面板开着(host)).toBe(false)
  })

  test("私有项目（没有 `memberCount`）连徽章都没有——没有成员管理这回事，就不给入口", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    setCurrentProject({ name: "我的项目" })

    expect(不存在(host, "[data-slot='project-anchor-members']")).toBe(true)
    // 对照：同一个位置上，给了 `memberCount` 徽章就在——否则上面那条在「徽章从来就不渲染」时也绿。
    setCurrentProject({ name: "8·17专案", memberCount: 1 })
    expect(不存在(host, "[data-slot='project-anchor-members']")).toBe(false)
  })

  test("面板里的成员来自接入缝；缝里没数据时走空态，不伪造成员（宁缺勿假）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setCurrentProject({ name: "8·17专案", memberCount: 2 })

    锚点按钮(host, "project-anchor-members")?.click()

    expect(text(host, "member-panel-empty")).toBe("还没有成员")

    setProjectMembers([{ policeId: "001", name: "张三", role: "owner" }])

    expect(text(host, "member-name")).toBe("张三")
    expect(text(host, "member-panel-empty")).toBeUndefined()
  })

  test("两个浮层不叠着：开成员面板会把项目面板收掉（左栏只有一列宽）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setCurrentProject({ name: "8·17专案", memberCount: 3 })

    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(开着(host)).toBe(true) // 前置：项目面板真的开了，否则下面那个 `false` 什么也没证明

    锚点按钮(host, "project-anchor-members")?.click()

    expect(成员面板开着(host)).toBe(true)
    expect(开着(host)).toBe(false)
  })

  test("标题用的是**当前项目**的名字，不是硬编码（设计 §4：`成员管理 · 8·17 专案`）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setCurrentProject({ name: "8·17专案", memberCount: 1 })

    锚点按钮(host, "project-anchor-members")?.click()

    expect(text(host, "member-panel-title")).toBe("成员管理 · 8·17专案")
  })
})

const 侧栏tab = (host: HTMLElement, key: "session" | "files") =>
  host.querySelector<HTMLButtonElement>(`[data-slot='sidebar-tab'][data-tab='${key}']`)
const 窄条 = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-component='minio-bar']")
const 双树 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-component='dual-file-tree']")
const 沙箱树 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-tree='sandbox']")
const tabpane = (host: HTMLElement, key: "session" | "files") =>
  host.querySelector<HTMLElement>(`[role='tabpanel'][data-pane='${key}']`)
/** 这个 pane 被藏起来了吗？——返回**布尔**（`#005-01`：断节点会把整轮测试挂哑）。 */
const 藏起来了 = (el: HTMLElement | null) => el !== null && el.hasAttribute("hidden")

/**
 * 左栏外壳接进左栏（T019 出参：**左栏能切「会话/文件」、MinIO 窄条常驻**）。
 *
 * 与上几节同因（T005 立下的规矩）：组件单测里全绿，不等于**接线接上了**。
 * 这一节验的正是那几根线——两块外壳落在左栏 ②③④ 的位置、文件树**搬进了**「文件」pane、
 * 窄条的数字来自 `@/project/minio-backups` 那条缝、点窄条回到「文件」tab（设计 §5.1①）。
 *
 * ⚠️ **今天没有写入方**：`minioBackups` 恒空（T011 的 `core/minio` 没有 HTTP 出口，
 * 见 `@/project/minio-backups` 文件头），所以窄条恒走「不知道几项」态。
 */
describe("左栏外壳（② tab 容器 ＋ ④ MinIO 窄条）接进左栏（T019 出参）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectFiles(undefined)
    setMinioBackups(undefined)
  })

  test("左栏有 [会话][文件] 两个 tab，且**默认停在「文件」**（设计 §2）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(侧栏tab(host, "files")?.getAttribute("aria-selected")).toBe("true")
    expect(侧栏tab(host, "session")?.getAttribute("aria-selected")).toBe("false")
  })

  test("点「会话」切过去：会话 pane 露出来、文件 pane 藏起来", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    // 前置：默认在「文件」——否则下面那个「藏起来了」在「压根没接线」时也成立（`#004-14`）
    expect(藏起来了(tabpane(host, "files"))).toBe(false)

    侧栏tab(host, "session")?.click()

    expect(藏起来了(tabpane(host, "session"))).toBe(false)
    expect(藏起来了(tabpane(host, "files"))).toBe(true)
  })

  test("「会话」pane 是显式空态——设计 §7 的会话列表不在本 feature，就明说没接入", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    侧栏tab(host, "session")?.click()

    expect(text(host, "session-empty")).toBe("会话列表未接入")
  })

  test("切到「会话」再切回来，**文件树还是同一棵**（选中/折叠/搜索不会因为看眼会话就没了）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setProjectFiles(["笔记.md"])
    const 前 = 树(host)
    expect(前).not.toBeNull() // 前置：先有一棵树可比

    侧栏tab(host, "session")?.click()
    // ⚠️ 中段这条**不是**装饰：缺了它，本条在「压根没有 tab 容器」的旧结构上也全绿
    // （树从不卸载，「同一棵树」自然成立）——那就成了一条不区分实现、只跟着代码走的断言。
    expect(藏起来了(tabpane(host, "files"))).toBe(true)
    侧栏tab(host, "files")?.click()

    // ⚠️ 比布尔而不是比节点（`#005-01`：节点当实得值，红了会把整轮 `bun test` 崩掉）
    expect(树(host) === 前).toBe(true)
    expect(树行(host).map((el) => el.getAttribute("data-path"))).toEqual(["笔记.md"])
  })

  test("MinIO 窄条常驻左栏底部：切到哪个 tab 都在，且排在 tab 容器之后", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(窄条(host)).not.toBeNull()

    侧栏tab(host, "session")?.click()

    expect(窄条(host)).not.toBeNull()
    expect(侧栏层级(host)).toEqual(["project-anchor", "sidebar-tabs", "minio-bar"])
  })

  test("点窄条：在「会话」tab 时自动切回「文件」（设计 §5.1 步骤 2①）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    侧栏tab(host, "session")?.click()
    expect(藏起来了(tabpane(host, "files"))).toBe(true) // 前置：确实停在「会话」

    窄条(host)?.click()

    expect(侧栏tab(host, "files")?.getAttribute("aria-selected")).toBe("true")
    expect(藏起来了(tabpane(host, "files"))).toBe(false)
  })

  test("已经在「文件」时点窄条不会把它切走——它不是开关，是「带我去文件」", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    窄条(host)?.click()

    expect(侧栏tab(host, "files")?.getAttribute("aria-selected")).toBe("true")
  })

  test("窄条的数字走接入缝：缝里写进清单才显示项数", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    // 前置：今天没有写入方 ⇒ 不显示数字（不是「· 0 项」）
    expect(不存在(host, "[data-slot='minio-bar-count']")).toBe(true)

    setMinioBackups(["笔记.md", "资料/话单.csv"])

    expect(text(host, "minio-bar-count")).toBe("· 2 项")
  })
})

/**
 * 上下双树接进左栏（T012 出参：**点窄条 → 展开双树**，设计 §5.1 步骤 2②）。
 *
 * 与上几节同因（T005 立下的规矩）：组件单测全绿 ≠ 接线接上了。这一节验的正是那根线——
 * 「文件」pane 里装的是 `DualFileTree`（不再是裸 `FileTree`），而 ④ 窄条点下去除了
 * 切回「文件」tab（T019 已验），还要**展开双树**。
 *
 * ⚠️ **生产里 `onBackup` / `onRestore` 不接**（MinIO 的 HTTP 出口还不存在，归 T022）⇒
 * 双树的行**不可拖**。这是刻意的「未接线即禁用」，与本节的断言不冲突：本节只验
 * 「能展开 / 能收起 / 下树走哪条缝」。
 */
describe("上下双树接进左栏（T012 出参）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectFiles(undefined)
    setMinioBackups(undefined)
  })

  test("「文件」pane 里装的是双树容器，上树仍是**那棵**文件树（设计 §5.2 上树）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(双树(host)?.closest("[data-slot='file-tree-slot']")).not.toBeNull()
    expect(沙箱树(host)?.closest("[data-component='dual-file-tree']")).not.toBeNull()
  })

  test("**默认收起**：没有 MinIO 树（设计 §5.1 步骤 1「不常驻双树，避免挤占文件区」）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(不存在(host, "[data-tree='minio']")).toBe(true)
  })

  test("点窄条 ⇒ 展开双树（设计 §5.1 步骤 2②）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    // 前置对照（`#002-02`）：先证明「点了才有」——否则「有」在一个恒展开的实现上也成立
    expect(不存在(host, "[data-tree='minio']")).toBe(true)

    窄条(host)?.click()

    expect(沙箱树(host)).not.toBeNull()
    expect(不存在(host, "[data-tree='minio']")).toBe(false)
  })

  test("点下树标题的 ✕ ⇒ 收回默认窄条态（设计 §5.1 步骤 4）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    窄条(host)?.click()
    expect(不存在(host, "[data-tree='minio']")).toBe(false) // 前置：确实展开了

    host.querySelector<HTMLElement>("[data-slot='minio-tree-collapse']")?.click()

    expect(不存在(host, "[data-tree='minio']")).toBe(true)
  })

  test("在「会话」tab 点窄条：一步做两件事——切回「文件」**并**展开双树（设计 §5.1 步骤 2①②）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    侧栏tab(host, "session")?.click()

    窄条(host)?.click()

    expect(藏起来了(tabpane(host, "files"))).toBe(false)
    expect(不存在(host, "[data-tree='minio']")).toBe(false)
  })

  test("下树走接入缝：缝里写进备份清单，下树才列得出来", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    窄条(host)?.click()
    // 前置：今天没有写入方 ⇒ 下树是「未接入」空态（不是「还没有备份」——那两句意思相反）
    expect(text(host, "minio-tree-empty")).toBe("备份清单未接入")

    setMinioBackups(["资料/话单.csv"])

    expect(
      不存在(host, "[data-tree='minio'] [data-slot='file-tree-row'][data-path='资料/话单.csv']"),
    ).toBe(false)
  })
})
