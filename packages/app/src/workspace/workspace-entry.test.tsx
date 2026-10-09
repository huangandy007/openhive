import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createSignal, For, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { useModuleAction, type ModuleAction } from "@/center/module-actions"
import { useCenterTabs } from "@/center/tab-context"
import { type ContentTab } from "@/center/tab-store"
import { currentProject, setCurrentProject } from "@/project/current-project"
import type { MemberEntry } from "@/project/member-panel"
import { setMinioBackups } from "@/project/minio-backups"
import { type ProjectData } from "@/project/project-data"
import { setProjectFiles } from "@/project/project-files"
import { projectList, setProjectList } from "@/project/project-list"
import { setProjectMembers } from "@/project/project-members"
import { type NewProjectInput, type ProjectEntry } from "@/project/project-panel"
import { setCurrentUser } from "./current-user"
import { WorkspaceEntry } from "./workspace-entry"

/**
 * **夹具：把文档挂到一个 http 源上。** 本文件只有末尾那一节（cookie）需要它。
 *
 * ⚠️ 少了这一句，那节测的就是 happy-dom 而不是产品：`happydom.ts` 只 `register()`、没设 URL，
 * 文档是 **`about:blank`**，而 happy-dom 会**正确地**拒收 `Path=/` 的 cookie 写（整条被丢弃、
 * 读回空串）⇒「清掉 cookie」那条断言在**任何**实现下都绿。
 * 完整机制与对照探针写在 `packages/app/src/project/current-project.test.ts` 的文件头——**同一句
 * 夹具的两个落点**，那里也解释了为什么补 URL 而不是把 `Path=/` 从被测字符串里删掉。
 *
 * ⚠️ 只影响**本文件**：`bun test` 里每个测试文件有独立的全局域（`LEARNINGS #004-11`）。
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具，不是产品码：`happyDOM` 长在 happy-dom 自己的 `Window` 上（`DetachedWindowAPI`），而 TS 的全局 `window` 是 lib.dom 那个 `Window`——没有可收窄的交集（理由与取数方式同 `current-project.test.ts` 那一句）。
;(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL("http://localhost/")

/**
 * 挂一个 `WorkspaceEntry`，并把卸载函数**记账**——`afterEach` 里逐个卸载（T021 实测补上）。
 *
 * ⚠️ 这个记账**不是**洁癖，是这一组测试能不能信的前提。`render()` 返回一个 `dispose`，此前
 * 被丢掉了，于是**每个用例挂过的实例全都活着**：`currentProject` / `projectList` 是**模块级**
 * 接入缝，旧实例的 effect 照样订阅着它们 ⇒ 下一条用例 `setCurrentProject(...)` 时，
 * 前几条用例那些实例会**一起**跑起来、拿**它们自己那个替身**去取数、再往**同一个**模块级缝里写。
 *
 * 实测（2026-10-07，T021 的接线做完之后）：`项目数据接线（T018 出参） > 切当前项目 ⇒ 按新 id
 * 重新取文件` 报 `Expected to contain: "乙/话单.csv"  Received: [ "资料", "资料/话单.csv" ]`
 * ——而 `["资料/话单.csv"]` 这个体在本文件里只有一个出处（`files: async () => ["资料/话单.csv"]`，
 * **它连 id 都不看**），也就是**前面**某条用例那棵树。谁后落地谁赢，于是红成
 * 「当前项目是乙、树里是甲的文件」——**看着像产品串项目了，其实是夹具串了**。
 *
 * 为什么现在才炸：它是**竞速**，谁的 promise 最后落地谁赢。多挂一个订阅者（本 task 的名单
 * effect）就足以把胜负翻过来——不改也要在改动量再大一点时炸，所以这里一次修掉。
 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(element, host))
  return host
}

/**
 * 每条用例前把 `document.body` 清空。
 *
 * ⚠️ 这不是洁癖：**Kobalte 的右键菜单传送到 `document.body`，关掉之后也不卸载**（退场动画在
 * happy-dom 里永远不结束），于是下一条用例的 `document.querySelector` 会先命中**上一条**那个菜单
 * ——而它的菜单项处理函数绑在**上一条用例的组件实例**上。实测（2026-10-07）：T020 接线那一组里，
 * 点着「复制」的那个请求打到了上一棵树身上，`假.复制的` 恒为空；只有**第一条**用菜单的用例
 * 和**不用菜单**的那条（拖入）是绿的，其余 7 条齐刷刷红。
 * `file-tree.test.tsx` 里有一条同因的 `afterEach`（那边的注释写得更细）。
 */
afterEach(() => {
  // **先卸载、再清 body**（顺序要紧）：卸载才是把旧实例的 effect 从模块级缝上摘下来的那一步，
  // 只清 `innerHTML` 摘不掉订阅——那一半正是本文件的假红来源（见 `mount` 的注释）。
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

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
 * ⚠️ 本文件里既有几处 `expect(...).toBeNull()`（判 `document-view` 不在的那些）是**同样
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

  /**
   * ⚠️ 原先这里有四条「顶栏注入缝」的用例（注入点缺失不渲染 / 挂进注入点 / 身份未就位 /
   * 身份就位）。**2026-10-08 顶栏改造起它们搬到了 `@/topbar/topbar-mount.test.tsx`**：
   * 顶栏不再由本组件 Portal 进上游 `#opencode-titlebar-right`，改由入口层挂进上游那条 header
   * 里**本产品自建的宿主 `span[data-slot=topbar-host]`**（2026-10-09 起；理由见
   * `@/topbar/titlebar-host`），接缝从 `WorkspaceEntry.titlebarRight` 换成了
   * `TopbarMount.host` —— 判据逐条照搬，只是换了被测组件。删掉的不是覆盖。
   */
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
const 树行 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-slot='file-tree-row']")]

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

  /**
   * 「会话」pane 的内容**由 `sessions` 这个访问器注入**（2026-10-08 接入）。
   *
   * ⚠️ 这条**取代**了此前那条「会话 pane 是显式空态（文案＝『会话列表未接入』）」：
   * 列表接上之后那句硬编码文案没有了，空态归列表自己（`@/ai-session/session-list`）。
   * 本文件要钉的是**接线**——注入的东西真的落进了那一个 pane（不落的话，「列表接上了」
   * 与「pane 里什么都没有」在屏幕上长得一样，`LEARNINGS #002-02`）。
   */
  test("「会话」pane 透传调用方注入的 `sessions`（本组件不认识会话列表）", () => {
    const host = mount(() => (
      <WorkspaceEntry sessions={() => <p data-slot="probe-sessions">注入的会话</p>}>中栏</WorkspaceEntry>
    ))

    侧栏tab(host, "session")?.click()

    expect(tabpane(host, "session")?.contains(host.querySelector("[data-slot='probe-sessions']"))).toBe(true)
    expect(text(host, "probe-sessions")).toBe("注入的会话")
  })

  /** 省略 `sessions` ⇒ pane **空着**（不假装有内容，也不白屏）。 */
  test("没注入 `sessions` ⇒ 会话 pane 里什么都没有（不是一句编出来的空态）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    侧栏tab(host, "session")?.click()

    // ⚠️ 比布尔而不是比节点（`#005-01`：`.toBeNull()` 的实得值是节点会挂死整轮）
    expect(tabpane(host, "session")?.children.length === 0).toBe(true)
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

/**
 * 等异步那一段走完。
 *
 * 用**宏任务**（`setTimeout 0`）而不是 `await Promise.resolve()`：从「叫了」到「落地」中间隔着
 * 几层微任务（接口 → 客户端 → 缝 → 渲染），几层取决于实现；微任务只让一轮，数错就是一条假红。
 */
const 冲一遍 = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 造一行项目——形状即 `ProjectEntry`。 */
const 私有 = (id: string, name: string, lastAccessedAt: number): ProjectEntry => ({
  id,
  name,
  type: "private",
  lastAccessedAt,
})

/**
 * 我建的项目（`role: "owner"`）——面板据此画「归档」（T023；判定走 `ProjectMembership.decide`）。
 * 没有 `role` 的行**不画**：缺键 = 没有成员关系，不是「默认是 owner」。
 */
const 我的 = (e: ProjectEntry): ProjectEntry => ({ ...e, role: "owner" })
/** 已归档的一行（`archived: true`）——它只在「已归档」tab 里，带「找回」。 */
const 封存 = (e: ProjectEntry): ProjectEntry => ({ ...e, archived: true })

/**
 * 一个**记账**的数据源替身。
 *
 * ⚠️ 替的是**数据源**这一个 prop（界面与外面世界之间那道缝），不是被测对象——被测的是
 * 「叫没叫、叫了几次、给的结果怎么落到界面上」，而组件、缝、渲染全是真的。
 */
function 假数据源(
  剧本: Partial<
    Pick<
      ProjectData,
      | "list"
      | "create"
      | "archive"
      | "restore"
      | "files"
      | "copy"
      | "move"
      | "upload"
      | "download"
      | "members"
      | "invite"
      | "remove"
      | "leave"
      | "touch"
    >
  > = {},
) {
  const 记 = {
    list: 0,
    files: [] as string[],
    members: [] as string[],
    建的: [] as Array<NewProjectInput>,
    归档的: [] as string[],
    找回的: [] as string[],
    复制的: [] as Array<[string, string, string]>,
    移动的: [] as Array<[string, string, string]>,
    传的: [] as Array<[string, string, string]>,
    下的: [] as Array<[string, string]>,
    邀请的: [] as Array<[string, string]>,
    移除的: [] as Array<[string, string]>,
    退的: [] as string[],
    触碰的: [] as string[],
  }
  const data: ProjectData = {
    list: async () => {
      记.list += 1
      // 没给剧本就当「一个都没有」——`[]` 是**来源明确说了空**，不是「取不到」（三态见 `listProjects`）。
      return 剧本.list ? await 剧本.list() : []
    },
    create: async (input) => {
      记.建的.push(input)
      // 没给剧本就是「没建成」：一条没接剧本的路，不该在测试里**悄悄**报成功。
      return 剧本.create ? await 剧本.create(input) : { kind: "failed", message: "没有剧本" }
    },
    archive: async (projectId) => {
      记.归档的.push(projectId)
      // 同 `create`：没给剧本就是**没办成**。默认报成功会让「接线根本没接上」看起来是绿的。
      return 剧本.archive ? await 剧本.archive(projectId) : { kind: "failed", message: "没有剧本" }
    },
    restore: async (projectId) => {
      记.找回的.push(projectId)
      return 剧本.restore ? await 剧本.restore(projectId) : { kind: "failed", message: "没有剧本" }
    },
    files: async (projectId) => {
      记.files.push(projectId)
      return 剧本.files ? await 剧本.files(projectId) : []
    },
    // T020 的四个文件动作。同上面几条：**没给剧本就是没办成**——一条没接剧本的路在测试里
    // 悄悄报成功，会让「接线根本没接上」看起来是绿的。
    copy: async (projectId, path, dir) => {
      记.复制的.push([projectId, path, dir])
      return 剧本.copy ? await 剧本.copy(projectId, path, dir) : { kind: "failed", message: "没有剧本" }
    },
    move: async (projectId, path, dir) => {
      记.移动的.push([projectId, path, dir])
      return 剧本.move ? await 剧本.move(projectId, path, dir) : { kind: "failed", message: "没有剧本" }
    },
    // 记的是**文件名**不是 `File` 对象本身：断言里要比的是名字，换成对象会让 `toEqual` 在两个
    // 内容相同的 `File` 上判假。
    upload: async (projectId, dir, file) => {
      记.传的.push([projectId, dir, file.name])
      return 剧本.upload ? await 剧本.upload(projectId, dir, file) : { kind: "failed", message: "没有剧本" }
    },
    download: async (projectId, path) => {
      记.下的.push([projectId, path])
      return 剧本.download ? await 剧本.download(projectId, path) : undefined
    },
    // T021 的四个成员动作。前三条同上面几条：**没给剧本就是没办成**——一条没接剧本的路在测试里
    // 悄悄报成功，会让「接线根本没接上」看起来是绿的。
    members: async (projectId) => {
      记.members.push(projectId)
      // 同 `list`：没给剧本就当「服务端说了这个项目没有成员」（`[]` 是**一条答案**，不是「取不到」）。
      return 剧本.members ? await 剧本.members(projectId) : []
    },
    invite: async (projectId, policeNo) => {
      记.邀请的.push([projectId, policeNo])
      return 剧本.invite ? await 剧本.invite(projectId, policeNo) : { kind: "failed", message: "没有剧本" }
    },
    remove: async (projectId, policeNo) => {
      记.移除的.push([projectId, policeNo])
      return 剧本.remove ? await 剧本.remove(projectId, policeNo) : { kind: "failed", message: "没有剧本" }
    },
    leave: async (projectId) => {
      记.退的.push(projectId)
      return 剧本.leave ? await 剧本.leave(projectId) : { kind: "failed", message: "没有剧本" }
    },
    // T024 的访问记账。⚠️ 默认是 `true`（＝记下了）而**不是**「没办成」——与上面几条**相反**，
    // 理由：这条链上没有「办没办成」要显示给谁看（返回布尔、界面上一个字都不显示），
    // 它唯一的消费者是**记账断言本身**。默认报失败只会让「接线接上了没有」这件事被搅浑。
    touch: async (projectId) => {
      记.触碰的.push(projectId)
      return 剧本.touch ? await 剧本.touch(projectId) : true
    },
  }
  return { data, 记 }
}

const 挂 = (data: ProjectData) => mount(() => <WorkspaceEntry projectData={data}>中栏</WorkspaceEntry>)

/**
 * 树里各行的 `data-path`。
 *
 * ⚠️ **一行不一定是一个文件**：目录也占一行——`乙/话单.csv` 会长出 `乙` 与 `乙/话单.csv` 两行。
 * 所以判「某个文件在不在」用 `toContain`，只有判「树里就这些」才用 `toEqual`。混用的后果是
 * 一条永远绿的软断言，或者一条莫名其妙红的硬断言（本 task 第一次跑就红在这上面）。
 */
const 路径们 = (host: HTMLElement) => 树行(host).map((el) => el.getAttribute("data-path"))

/** 面板里那一行命名输入框（点「私有 / 共享」之后才在）。 */
const 命名框 = (host: HTMLElement) => host.querySelector<HTMLInputElement>("[data-slot='project-panel-name']")

/**
 * 起个名交出去：打字 ＋ 回车。
 *
 * **回车是异步的**（要等那边的回话才知道成没成），所以调用方自己接一句 `await 冲一遍()`。
 * 走**原生派发**——组件只认 `key` 那一个字段（同 `project-panel.test.tsx` 的辅助）。
 */
function 起个名(host: HTMLElement, name: string) {
  const el = 命名框(host)
  if (!el) throw new Error("命名框不在，建不了项目")
  el.value = name
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

/**
 * 上面几节验的都是「缝里的数据画不画得出来」；这一节验的是**谁把数据写进缝里**。
 *
 * 在此之前（T006 - T019）缝里**没有写入方**——所以上面每一节的空态都是真话，也确实没什么可接。
 * T018 把三段都接上了：清单来自 `projectData.list()`、新建走 `projectData.create()`、
 * 文件走 `projectData.files(当前项目 id)`，落点全在本组件（`project-data.ts` 的接口由应用入口注入）。
 *
 * ⚠️ 数据源是 **prop**，不是模块级缝：省略时**一次请求都不发**。组件测试因此能完全离线跑
 * ——这正是 `loadFile` 那条注释防的同一件事（`useSDK()` 要六层 provider 才活得下来）。
 */
describe("项目数据接线（T018 出参）", () => {
  // 三条接入缝都是模块级的，测试之间必须复位，否则互相串味。
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectFiles(undefined)
  })

  /**
   * 没注入 ⇒ 停在 T018 之前的形态。
   *
   * 这条与下一条是**一对**：单看哪一条都证明不了「没人发请求」（前一条里没有对象可记账，
   * 后一条里本来就该发）。两条放在一起，才说明「发不发」是由**有没有数据源**决定的。
   */
  test("没注入数据源 ⇒ 面板停在 T018 之前的形态（按钮禁用，不假装能建）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    锚点按钮(host, "project-anchor-toggle")?.click()

    expect(锚点按钮(host, "project-panel-create-private")?.disabled).toBe(true)
    expect(text(host, "project-panel-empty")).toBe("还没有项目")
  })

  test("注入数据源 ⇒ 进门就拉一次清单，写进接入缝（面板里看得到）", async () => {
    const { data, 记 } = 假数据源({ list: async () => [私有("p1", "8·17专案", 1)] })
    const host = 挂(data)
    await 冲一遍()

    expect(记.list).toBe(1)
    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(text(host, "project-item-name")).toBe("8·17专案")
  })

  /**
   * **拉到清单也不自动认领当前项目**（用户 2026-10-06 裁定）。
   *
   * 理由：005 的 spec 只写了两件事——FR-003「新建后成为当前项目」与 AC4「点某项目切换」，
   * 对「打开时选谁」一个字没写，锚点行走它本来就有的「未选择项目」空态。
   *
   * ⚠️ **原文那半句「而不选的代价是零：不发 `x-openhive-project` ⇒ 后端落回沙箱根」，从
   * 2026-10-08 起不成立**（006 Step 5 ②-1 给「当前项目」加了 **cookie 通道**）：cookie 由浏览器
   * **对每一条同源请求自动附带**、且**活得比页面久** ⇒ 刷新之后信号归零、cookie 却还在
   * ——「不选」不再是自然状态，而是**要主动维持**的。维持它的地方是 `workspace-entry.tsx` 的
   * `onMount`：**有存档就还原、存档失效就清**（Task B · 2026-10-09 用户裁定 **A：跟随当前项目**；
   * 判据在本文件末尾那一节）。
   * ⚠️ **本条测的仍是「没有存档 ⇒ 不自动选」那一支**（2026-10-06 的裁定），它没有被裁定 A 动过——
   * 本条的裁定与判据一个字不变，改的只是那条已经过时的理由（`LEARNINGS #002-06`：改完一处要
   * grep 谁引用了它）。
   *
   * ⚠️ **这条理由在 T024 之前还有第二半，那半现在已经不成立了**（原文：「『自动选最近访问的
   * 那个』语义对不上——`last_accessed_at` 只在**建项目**时写，没有『选中即更新』的出口」）。
   * T024 补上了那个出口（`onOpen` → `projectData.touch()`），「最近」这才真的是「最近访问」。
   * 但**裁定不变**：依据是前半句（spec 一个字没写），不是后半句——所以这里不改行为，
   * 只把那条已经不实的记述改掉（`LEARNINGS #002-06`：改完一处要 grep 谁引用了它）。
   *
   * 这条也是**防手滑**的：将来有人图省事写成 `setCurrentProject(清单[0])`，这里会红。
   */
  test("不自动认领当前项目——清单里有项目，也等民警点一下（spec 只写了「新建」与「点」）", async () => {
    const { data } = 假数据源({ list: async () => [私有("p1", "8·17专案", 1)] })
    const host = 挂(data)
    await 冲一遍()

    // ⚠️ 前置不能省：**没有前置，这一条在「压根没接线」时也是绿的**（清单没来、当前项目没设，
    // 锚点当然显示「未选择项目」）。先证明清单真的到了面板上，那句「未选择」才是在说
    // 「到了也不自动选」，而不是在说「什么都没发生」（`#004-14`）。
    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(text(host, "project-item-name")).toBe("8·17专案")
    expect(text(host, "project-anchor-name")).toBe("未选择项目")
  })

  /**
   * **点开一个项目 ⇒ 记一次访问**（T024 · FR-008 的「3 个月无操作」）。
   *
   * 这条链的另一半在服务端（`POST /openhive/project/touch` 刷新那一列），而**触发点在界面**：
   * `onOpen` 才是「访问」这件事发生的地方。少了这次记账，「3 个月无操作」判出来的其实是
   * 「建项目后 3 个月」——一个天天在用的项目照样到期（T024 的裁定 ③）。
   */
  test("点开某个项目 ⇒ 记一次访问（超期判定的写入方，T024）", async () => {
    const { data, 记 } = 假数据源({ list: async () => [私有("p1", "8·17专案", 1)] })
    const host = 挂(data)
    await 冲一遍()

    锚点按钮(host, "project-anchor-toggle")?.click()
    host.querySelector<HTMLButtonElement>("[data-slot='project-item']")?.click()

    // 被测属性在前（`#004-14`）：记的是**哪一个**项目，不只是「记了一次」。
    expect(记.触碰的).toEqual(["p1"])
    expect(text(host, "project-anchor-name")).toBe("8·17专案")
  })

  /**
   * **拉清单不记访问**——列项目是「算超期」，不是「访问了」。
   *
   * 这条钉的是那个最省事的错法：把刷新塞进列清单那条链（或塞进「进门拉一次」的 effect）。
   * 那样一来**每打开一次界面**就把所有项目都刷成「刚访问」⇒ 超期判定恒假、提醒永远不出现，
   * 而且不报错、不变红（`LEARNINGS #004-09`：端点判据对「它拦在哪一侧」完全不敏感）。
   */
  test("进门拉清单 ⇒ 不记访问（列项目是算超期，不是访问了——塞进那条链会让提醒永不出现）", async () => {
    const { data, 记 } = 假数据源({ list: async () => [私有("p1", "8·17专案", 1)] })
    const host = 挂(data)
    await 冲一遍()

    // 前置：清单真的拉过了（否则这条在「压根没接线」时也是绿的）。
    expect(记.list).toBe(1)
    expect(记.触碰的).toEqual([])
    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(text(host, "project-item-name")).toBe("8·17专案")
  })

  test("新建成功 ⇒ 成为当前项目（FR-003），清单跟着刷新（新项目出现在面板里）", async () => {
    const 新 = 私有("p2", "9·03专案", 2)
    let 清单: readonly ProjectEntry[] = [私有("p1", "8·17专案", 1)]
    const { data, 记 } = 假数据源({
      list: async () => 清单,
      create: async () => {
        清单 = [新, ...清单]
        return { kind: "created", project: 新 }
      },
    })
    const host = 挂(data)
    await 冲一遍()
    锚点按钮(host, "project-anchor-toggle")?.click()
    锚点按钮(host, "project-panel-create-private")?.click()
    起个名(host, "9·03专案")
    await 冲一遍()

    expect(记.建的).toEqual([{ name: "9·03专案", type: "private" }])
    expect(text(host, "project-anchor-name")).toBe("9·03专案")
    // 拉第二次 = 建完刷新了一次（不是把新项目拼进旧清单——那会在「还没拉到」时说成「就这些」）。
    expect(记.list).toBe(2)
    expect(面板(host)?.textContent).toContain("9·03专案")
  })

  test("新建没成 ⇒ 那句话落在输入框下，当前项目不动（FR-003 不成立时不能装作成立）", async () => {
    const { data } = 假数据源({
      list: async () => [],
      create: async () => ({ kind: "rejected", message: "项目名已存在" }),
    })
    const host = 挂(data)
    await 冲一遍()
    锚点按钮(host, "project-anchor-toggle")?.click()
    锚点按钮(host, "project-panel-create-private")?.click()
    起个名(host, "8·17专案")
    await 冲一遍()

    expect(text(host, "project-panel-create-error")).toBe("项目名已存在")
    expect(text(host, "project-anchor-name")).toBe("未选择项目")
    expect(命名框(host)).not.toBeNull()
  })

  test("没有当前项目时不取文件——不发一个空 id 的请求（宁可空态，不发假请求）", async () => {
    const { data, 记 } = 假数据源({ files: async () => ["资料/话单.csv"] })
    const host = 挂(data)
    await 冲一遍()

    expect(记.files).toEqual([])
    // 断在自己这棵树上，不是 `document.body`：本文件每个用例都往 body 里挂一个 host 且不摘，
    // 断 body 会把**别的用例**留下的树行数进来。
    expect(树行(host).length).toBe(0)

    // 对照（`#002-02`：说「没发生」之前先证明机制是活的）：**同一个组件**给上当前项目就取。
    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()

    expect(记.files).toEqual(["p1"])
    expect(路径们(host)).toContain("资料/话单.csv")
  })

  test("切当前项目 ⇒ 按新 id 重新取文件，左栏文件树跟着换（AC4）", async () => {
    const { data, 记 } = 假数据源({
      files: async (id) => (id === "p2" ? ["乙/话单.csv"] : ["甲/资料.csv"]),
    })
    const host = 挂(data)

    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()
    expect(记.files).toEqual(["p1"])
    expect(路径们(host)).toContain("甲/资料.csv")

    setCurrentProject({ id: "p2", name: "乙" })
    await 冲一遍()

    expect(记.files).toEqual(["p1", "p2"])
    expect(路径们(host)).toContain("乙/话单.csv")
    // **旧项目那棵不能留着**：换项目时缝要先清空，否则甲的文件会在乙的树下继续显示。
    expect(路径们(host)).not.toContain("甲/资料.csv")
  })

  /**
   * 进门那一次清单**迟到**时，不许把刚建好的新项目抹掉。
   *
   * 写这个缝的有**两个出口**（进门拉一次、建完重拉一次），这条测的是两者乱序。成因不是假想的：
   * 新建入口**不依赖清单**（清单还没到，面板照样能建），所以「建完的那一刻，进门那次还没回来」
   * 是够得着的状态（`#004-01`：缺口按定义长在「谁在写这个缝」的清单里，不是「谁看起来像这一类」）。
   */
  test("进门那次清单迟到 ⇒ 丢掉，不把刚建好的项目从面板里抹掉", async () => {
    const 放进门: Array<(v: readonly ProjectEntry[]) => void> = []
    const 新 = 私有("p2", "9·03专案", 2)
    let 第几次 = 0
    const { data } = 假数据源({
      list: () => {
        第几次 += 1
        // 第一次（进门）卡住不放；第二次（建完重拉）立刻回**新清单**。
        return 第几次 === 1
          ? new Promise<readonly ProjectEntry[]>((resolve) => {
              放进门.push(resolve)
            })
          : Promise.resolve([新])
      },
      create: async () => ({ kind: "created", project: 新 }),
    })
    const host = 挂(data)
    await 冲一遍()

    // 前置：清单果然还没到（否则这一条就不是在测「迟到」了）。
    // 断**缝本身**而不是面板上的空态文案——`undefined`（还没到）与 `[]`（到了、是空的）
    // 在面板上画出来是**同一句**「还没有项目」，用文案断不出这个前提。
    expect(projectList()).toBeUndefined()

    锚点按钮(host, "project-anchor-toggle")?.click()
    锚点按钮(host, "project-panel-create-private")?.click()
    起个名(host, "9·03专案")
    await 冲一遍()
    expect(面板(host)?.textContent).toContain("9·03专案")

    // 进门那一次现在才回来——它带的是**建之前**的清单（不含新项目）。
    放进门.forEach((放) => 放([]))
    await 冲一遍()

    expect(面板(host)?.textContent).toContain("9·03专案")
    expect(projectList()).toEqual([新])
  })

  /**
   * 上一个项目的响应**迟到**时不许覆盖新的。
   *
   * 这不是假想的竞态：取文件是一层一层走的（`openhive-files.ts` 递归），大目录比小目录慢得多，
   * 民警连点两下换项目就够触发。少了这道闸，界面上会出现「当前项目是乙，树里是甲的文件」
   * ——**看着像串项目了**，而在这个产品里「串项目」是最不能容忍的那种错觉。
   */
  test("上一个项目的文件迟到 ⇒ 丢掉，不覆盖当前项目（宁可空态，不画错项目的文件）", async () => {
    let 放甲: (v: readonly string[]) => void = () => {}
    const { data } = 假数据源({
      files: (id) =>
        id === "p1"
          ? new Promise<readonly string[]>((resolve) => {
              放甲 = resolve
            })
          : Promise.resolve(["乙/话单.csv"]),
    })
    const host = 挂(data)

    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()
    setCurrentProject({ id: "p2", name: "乙" })
    await 冲一遍()
    expect(路径们(host)).toContain("乙/话单.csv")

    // 甲的文件现在才回来。
    放甲(["甲/资料.csv"])
    await 冲一遍()

    expect(路径们(host)).toContain("乙/话单.csv")
    expect(路径们(host)).not.toContain("甲/资料.csv")
  })
})

/** 面板里某个 tab 的页签（`data-tab` 是身份）。 */
const 面板页签 = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='project-panel-tab'][data-tab='${id}']`)

/** 面板**最底下**那句失败文案——归档与找回共用一格（`project-panel.tsx` 的 `没办成`）。 */
const 面板报错 = (host: HTMLElement) => text(host, "project-panel-action-error")

/**
 * 走一遍归档：滑出面板 → 「全部」tab → 点那一行的「归档」→ 点确认。
 *
 * ⚠️ 四步都要，少一步都不叫「归档过」：**点「归档」不交出去**（T023 的二次确认），
 * 少掉最后那下确认，测的就是「点了个按钮」而不是归档（`#004-14`：一条用例里既钉被测属性
 * 又钉伴随信号时，被测的排前面）。
 */
function 点归档(host: HTMLElement) {
  锚点按钮(host, "project-anchor-toggle")?.click()
  面板页签(host, "all")?.click()
  host.querySelector<HTMLButtonElement>("[data-slot='project-archive']")?.click()
  host.querySelector<HTMLButtonElement>("[data-slot='project-archive-ok']")?.click()
}

/** 走一遍找回：「已归档」tab → 点那一行的「找回」。**找回没有二次确认**（不是破坏性动作）。 */
function 点找回(host: HTMLElement) {
  锚点按钮(host, "project-anchor-toggle")?.click()
  面板页签(host, "archived")?.click()
  host.querySelector<HTMLButtonElement>("[data-slot='project-restore']")?.click()
}

/**
 * 归档 / 找回接进工作台（T023 出参）。
 *
 * 这一节验的是**办成之后做什么**——面板那一侧只负责「问一句、把回话显示出来」，
 * 「重拉清单 / 清当前项目」是接线的事，因为只有接线知道清单和当前项目在哪儿。
 *
 * ⚠️ 归档**破坏性**（沙箱文件先备份进 MinIO、本地这份删掉），所以「归档掉的项目别留在
 * 「全部」里 ／ 它要是当前项目就把当前项目清掉」不是收拾现场，是**不让界面显示一个已经不存在
 * 的沙箱**：留着它，民警点进去看到的是空目录，而文件其实在 MinIO 上。
 */
describe("归档 / 找回接进工作台（T023 出参）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectFiles(undefined)
  })

  test("归档成功 ⇒ 把 id 交给数据源，并重拉清单（归档掉的行走掉，不留在「全部」里）", async () => {
    let 清单: readonly ProjectEntry[] = [我的(私有("p1", "8·17专案", 1))]
    const { data, 记 } = 假数据源({
      list: async () => 清单,
      archive: async () => {
        清单 = []
        return { kind: "done" }
      },
    })
    const host = 挂(data)
    await 冲一遍()

    点归档(host)
    await 冲一遍()

    expect(记.归档的).toEqual(["p1"])
    // 拉第二次 = 归档完重拉了一次（不是把那一行从旧清单里抠掉——「抠掉」在这个组件里做不了，
    // 清单是缝里的只读数据，而重拉还能顺带把**别人**的改动带回来）。
    expect(记.list).toBe(2)
    expect(面板(host)?.textContent).not.toContain("8·17专案")
  })

  test("归档的是**当前项目** ⇒ 当前项目清掉（锚点行不挂着一个已经归档的项目）", async () => {
    const { data } = 假数据源({
      list: async () => [我的(私有("p1", "8·17专案", 1))],
      archive: async () => ({ kind: "done" }),
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()

    // 前置（`#002-02`：说「清掉了」之前先证明它**挂上去过**）——否则「未选择项目」在
    // 压根没接线时也是绿的。
    expect(text(host, "project-anchor-name")).toBe("8·17专案")

    点归档(host)
    await 冲一遍()

    expect(text(host, "project-anchor-name")).toBe("未选择项目")
  })

  /**
   * 归档当前项目 ⇒ **左栏那棵文件树也跟着清**（别留着一个已归档项目的文件树）。
   *
   * 上一条只断锚点行；「清文件」是 `createEffect` 顺带做的（当前项目变成 `undefined` 触发），
   * 于是「只清锚点、忘了清文件」这种改法**没有任何断言拦得住**（2026-10-07 席 C 审查的变异盲区）。
   * 这不是收拾现场：归档会把沙箱那份**删掉**，留着树 = 让民警点进一个空目录，而文件其实在 MinIO 上
   * ——正是本节开头那句「不让界面显示一个已经不存在的沙箱」的另一半。
   */
  test("归档的是当前项目 ⇒ 左栏文件树跟着清（不留一个已归档项目的文件树）", async () => {
    const { data } = 假数据源({
      list: async () => [我的(私有("p1", "8·17专案", 1))],
      files: async () => ["甲/资料.csv"],
      archive: async () => ({ kind: "done" }),
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()

    // 前置（`#002-02`）：树真的长出来过——否则「它没了」在压根没接线时也是绿的。
    expect(路径们(host)).toContain("甲/资料.csv")

    点归档(host)
    await 冲一遍()

    expect(路径们(host)).not.toContain("甲/资料.csv")
  })

  test("归档的是**别的**项目 ⇒ 当前项目不动（清的是被归档那一个，不是「有归档就清」）", async () => {
    const { data, 记 } = 假数据源({
      list: async () => [我的(私有("p1", "8·17专案", 1)), 我的(私有("p2", "9·03专案", 2))],
      archive: async () => ({ kind: "done" }),
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p2", name: "9·03专案" })
    await 冲一遍()

    点归档(host)
    await 冲一遍()

    // 前置：归档的确实是**另一个**项目（默认点的是「我的项目」组里第一行 = p1）。
    expect(记.归档的).toEqual(["p1"])
    expect(text(host, "project-anchor-name")).toBe("9·03专案")
  })

  /**
   * **没办成的时候，当前项目也不动**——失败路径别顺手清。
   *
   * 本节所有「没办成」用例的 `beforeEach` 都把当前项目清成 `undefined`、用例里也没设过 ⇒
   * 在失败分支里补一句 `setCurrentProject(undefined)` **全绿**（2026-10-07 席 C 审查的变异盲区 ②）。
   * 它与成功路径是两件事：清当前项目的依据是「**它真的被归档了**」，而拒绝根本没归档——
   * 顺手清掉等于替后端宣布一个它没说过、也没发生的结果（同上面「没办成不重拉清单」那条一条心）。
   */
  test("归档没办成 ⇒ 当前项目也不动（失败路径别顺手清）", async () => {
    const { data } = 假数据源({
      list: async () => [我的(私有("p1", "8·17专案", 1))],
      archive: async () => ({ kind: "rejected", message: "无权归档该项目" }),
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()

    // 前置（`#002-02`）：挂上去了。
    expect(text(host, "project-anchor-name")).toBe("8·17专案")

    点归档(host)
    await 冲一遍()

    expect(text(host, "project-anchor-name")).toBe("8·17专案")
  })

  test("归档没办成 ⇒ 那句话回到面板上，且**不重拉清单**（没成的事不该刷成「好像变了」）", async () => {
    const { data, 记 } = 假数据源({
      list: async () => [我的(私有("p1", "8·17专案", 1))],
      archive: async () => ({ kind: "rejected", message: "无权归档该项目" }),
    })
    const host = 挂(data)
    await 冲一遍()

    点归档(host)
    await 冲一遍()

    expect(面板报错(host)).toBe("无权归档该项目")
    expect(记.list).toBe(1)
    // 那一行还在——没办成却把它从画面上抹掉，等于替后端宣布了一个它没说过的结果。
    expect(面板(host)?.textContent).toContain("8·17专案")
  })

  /**
   * ⚠️ 「归档 / 找回回话的那句话」与「面板本来就有的失败文案」是**同一个槽**
   * （`project-panel-action-error`）：面板不认识 HTTP，它只把接线交回来的一句话显示出来。
   * 这一条钉的就是那根线——接线**把 `rejected.message` 原样交回去**，不自己改写措辞
   * （它不知道是哪一条规则挡下的，同 T018 的 400 那条）。
   */
  test("找回没办成 ⇒ 那句话回到面板上（接线把服务端那句话原样交回去）", async () => {
    const { data } = 假数据源({
      list: async () => [封存(我的(私有("p1", "8·17专案", 1)))],
      restore: async () => ({ kind: "failed", message: "找回项目失败" }),
    })
    const host = 挂(data)
    await 冲一遍()

    点找回(host)
    await 冲一遍()

    expect(面板报错(host)).toBe("找回项目失败")
  })

  test("找回成功 ⇒ 重拉清单（项目从「已归档」回到「全部」，不是留在原地）", async () => {
    let 清单: readonly ProjectEntry[] = [封存(我的(私有("p1", "8·17专案", 1)))]
    const { data, 记 } = 假数据源({
      list: async () => 清单,
      restore: async () => {
        清单 = [我的(私有("p1", "8·17专案", 1))]
        return { kind: "done" }
      },
    })
    const host = 挂(data)
    await 冲一遍()

    点找回(host)
    await 冲一遍()

    expect(记.找回的).toEqual(["p1"])
    expect(记.list).toBe(2)
    expect(面板(host)?.textContent).not.toContain("8·17专案")

    面板页签(host, "all")?.click()
    expect(面板(host)?.textContent).toContain("8·17专案")
  })

  /**
   * **找回不碰当前项目**（用户裁定 2026-10-07）——「点一下直达」是 `onOpen` 的事，
   * 找回只把清单重拉一次，**不切、也不清**。
   *
   * 为什么单开一条：本节所有「找回」用例的 `beforeEach` 都把当前项目清成 `undefined`、
   * 「找回成功」那条也没设过 ⇒ 给 `onRestore` 里补一句 `setCurrentProject(undefined)`
   * （看着像「与归档对齐」的无害改动）**全绿**（2026-10-07 席 C 审查的变异盲区 ①）。
   * 对民警的后果是真的：他找回的是**另一个**项目，正在看的那一份上下文却被清掉了。
   */
  test("找回**不碰**当前项目（找回 ≠ 切到它）", async () => {
    const { data } = 假数据源({
      list: async () => [封存(我的(私有("p1", "8·17专案", 1))), 我的(私有("p2", "9·03专案", 2))],
      restore: async () => ({ kind: "done" }),
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p2", name: "9·03专案" })
    await 冲一遍()

    // 前置（`#002-02`）：挂上去了，最后那句才有意义。
    expect(text(host, "project-anchor-name")).toBe("9·03专案")

    // 「已归档」tab 里只有 p1（p2 是活跃的）⇒ 找回的是**另一个**项目。
    点找回(host)
    await 冲一遍()

    expect(text(host, "project-anchor-name")).toBe("9·03专案")
  })
})

/**
 * 右键菜单在**传送门**里（Kobalte 的 `ContextMenu.Portal` 把内容挂到 `document.body`），
 * 所以这一节的菜单探针一律查 `document`，不是 `host`——同 `file-tree.test.tsx` 那几条。
 */
const 菜单项 = (action: string) =>
  document.querySelector<HTMLElement>(`[data-component='context-menu-content'] [data-action='${action}']`)

/** 右键树里某一行（按名字找：同层顺序随 locale 变，见 `file-tree-v2-model` 那条注释）。 */
function 右键行(host: HTMLElement, name: string) {
  const 行 = 树行(host).find((el) => el.querySelector("[data-slot='file-tree-name']")?.textContent?.trim() === name)
  if (!行) throw new Error(`树里没有「${name}」这一行——这条用例的前提不成立（#004-14）`)
  行.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
}

/** 点一个菜单项：Kobalte 在 `pointerup` 上选中，单发 `.click()` **不够**（`file-tree.test.tsx` 实测）。 */
function 点菜单项(action: string) {
  const el = 菜单项(action)
  if (!el) throw new Error(`菜单里没有「${action}」`)
  for (const 类型 of ["pointerdown", "pointerup"])
    el.dispatchEvent(
      new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
    )
}

/** 目标选择器上某一个目标按钮（`data-dir` 是**契约本身那个值**——`""` ＝ 项目根）。 */
const 目标按钮 = (host: HTMLElement, dir: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='target-picker-target'][data-dir='${dir}']`)

/** 那台隐藏的文件选择器。 */
const 文件选择器 = (host: HTMLElement) => host.querySelector<HTMLInputElement>("input[type='file']")

/**
 * 从桌面拖一批文件到某个元素上。
 *
 * ⚠️ happy-dom **没有 `DragEvent`**，而这一路**非得**有个交得出 `File` 的 `dataTransfer` 不可
 * （判据要从 `dataTransfer.files` 里读文件）⇒ 拿裸 `Event` 顶着再挂一个替身。
 * `file-tree.test.tsx` 里有一份同形的（那边验的是树自己的落点规则，这边验的是**线接上了**）——
 * 不合并的原因见 `LEARNINGS #004-11`：每个测试文件有自己的全局域，夹具一律各写各的。
 */
function 拖入(el: HTMLElement | null, files: readonly File[]) {
  if (!el) throw new Error("拖拽落点不在——这条用例的前提不成立")
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } })
  el.dispatchEvent(event)
}

/**
 * 文件动作接进工作台（T020 出参）。
 *
 * 上一节（T018）验的是「数据源的三个方法接对了」；这一节验**另外四件事**：
 * ① 右键菜单那四项**真的**能走到 `projectData` 那四个方法上（不是只画了个菜单项）；
 * ② 复制 / 移动是**先选目标、后发请求**（用户 2026-10-06 裁定①）——点菜单那一刻一个请求都不发；
 * ③ 办成之后**清单重取**（树的位置换了，真相是重取那一份，不是本地拼的）；
 * ④ 上传的两条入口（右键菜单的文件选择器 ＋ 从桌面拖进来）都能把**文件**交出去。
 *
 * ⚠️ 四项都**必须带当前项目的 id**：服务端拿它定位沙箱目录（T017 的中间件），
 * 所以每一条都先 `setCurrentProject`。
 */
describe("文件动作接进工作台（T020 出参）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectFiles(undefined)
  })

  /** 挂一个已经选定项目的左栏：树里两个目录各一个文件（目标选择器因此有三个可选项）。 */
  async function 开(剧本: Parameters<typeof 假数据源>[0] = {}) {
    const { data, 记 } = 假数据源({
      files: async () => ["资料/话单.csv", "档案/旧件.csv"],
      ...剧本,
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()
    return { host, 假: 记 }
  }

  /**
   * 「先选目标、后发请求」——**这条用例的被测属性是「一个请求都没发」**，不是「面板出现了」。
   *
   * 为什么把「没发请求」排在前面（`#004-14`）：一个「点复制就直接复制到根」的实现照样会弹面板，
   * 只有先钉「此刻 `复制的` 是空的」，红的时候读到的才是「它已经动手了」这条证据本身。
   */
  test("右键点「复制」⇒ 先出目标选择器，此刻**一个请求都不发**", async () => {
    const { host, 假 } = await 开()

    右键行(host, "话单.csv")
    点菜单项("copy")

    expect(假.复制的).toEqual([])
    expect(text(host, "target-picker-title")).toContain("话单.csv")
    // 目标清单来自树里现有的目录（＋ 项目根），不是空的
    const 目标们 = [...host.querySelectorAll("[data-slot='target-picker-target']")].map((el) =>
      el.getAttribute("data-dir"),
    )
    expect(目标们).toEqual(["", "档案", "资料"])
  })

  test("选一个目标目录 ⇒ 走 copy 那条出口，带上项目 id、被搬的文件与那个目录", async () => {
    const { host, 假 } = await 开({ copy: async () => ({ kind: "done", path: "档案/话单.csv" }) })

    右键行(host, "话单.csv")
    点菜单项("copy")
    目标按钮(host, "档案")?.click()
    await 冲一遍()

    expect(假.复制的).toEqual([["p1", "资料/话单.csv", "档案"]])
    // 选完就收起来——留着它挡在树前面，正是「直达」的反面
    expect(不存在(host, "[data-slot='target-picker-target']")).toBe(true)
  })

  /**
   * 复制与移动的**签名一模一样**，接反了不报错、不变红，后果是**原文件被搬走**。
   * 所以这一条不验「移动也能用」，而是验**它走的是哪条出口**。
   */
  test("「移动」走的是 move，不是 copy", async () => {
    const { host, 假 } = await 开({ move: async () => ({ kind: "done", path: "档案/话单.csv" }) })

    右键行(host, "话单.csv")
    点菜单项("move")
    目标按钮(host, "档案")?.click()
    await 冲一遍()

    expect(假.移动的).toEqual([["p1", "资料/话单.csv", "档案"]])
    expect(假.复制的).toEqual([])
  })

  /**
   * 办成之后**重取清单**：界面上的真相是服务端给的那一份，不是本地拼的
   * （服务端回的新路径只用来报一句话，不用来改树——同 T018 的「清单重拉，不把新行拼进旧清单」）。
   */
  test("搬完之后清单重取一次 —— 树上的位置换了，靠的是重取", async () => {
    const { host, 假 } = await 开({ copy: async () => ({ kind: "done", path: "档案/话单.csv" }) })
    const 搬前 = 假.files.length

    // 前置：树上是「旧的」那份，搬过之后的位置还不在（`#002-02`：先证明机制是活的）
    expect(路径们(host)).toContain("资料/话单.csv")

    右键行(host, "话单.csv")
    点菜单项("copy")
    目标按钮(host, "档案")?.click()
    await 冲一遍()

    expect(假.files.length).toBe(搬前 + 1)
  })

  /** 被拒（目标已存在之类）⇒ 把服务端那句话留在界面上，**且不重取**——什么都没变，重取是空跑。 */
  test("被拒 ⇒ 留下服务端那句话，且不重取清单", async () => {
    const { host, 假 } = await 开({ copy: async () => ({ kind: "rejected", message: "目标已存在同名文件" }) })
    const 搬前 = 假.files.length

    右键行(host, "话单.csv")
    点菜单项("copy")
    目标按钮(host, "档案")?.click()
     await 冲一遍()

    expect(text(host, "file-op-message")).toBe("目标已存在同名文件")
    expect(假.files.length).toBe(搬前)
  })

  /**
   * 上传第一条入口：右键菜单 → 文件选择器。
   *
   * ⚠️ 两条断言缺一不可——「选择器被打开了」与「选中的文件去了正确的落点」。
   * 只验后者的话，一个**根本不打开选择器**的实现照样绿。
   */
  test("点「上传」⇒ 打开文件选择器；选中的文件传到被右键那一项的**落点目录**", async () => {
    const { host, 假 } = await 开({ upload: async () => ({ kind: "done", path: "资料/话单.csv" }) })
    const 器 = 文件选择器(host)
    if (!器) throw new Error("文件选择器不在——这条用例的前提不成立")
    let 打开了 = 0
    器.addEventListener("click", () => (打开了 += 1))

    右键行(host, "资料") // 右键一个**目录** ⇒ 传到它自己
    点菜单项("upload")

    expect(打开了).toBe(1)

    // happy-dom 里 `input.files` 是只读的 ⇒ 挂一个替身再派发 `change`
    Object.defineProperty(器, "files", { value: [new File(["甲"], "话单.csv")] })
    器.dispatchEvent(new Event("change", { bubbles: true }))
    await 冲一遍()

    expect(假.传的).toEqual([["p1", "资料", "话单.csv"]])
  })

  /**
   * 上传第二条入口：从桌面拖进树里。
   *
   * 这一条同时钉住**接线**——`workspace-entry` → `DualFileTree` → `FileTree` 三跳的 prop 透传
   * （`DualFileTree` 靠 `rest` 整份 spread，一个 prop 都不必新增，而「不必新增」正是最容易在
   * 下次改动里被破坏的那种约定）。一次拖一批 ⇒ **逐个**发请求（服务端一次只收一个）。
   */
  test("从桌面拖一批文件进树里 ⇒ 逐个上传到落点目录", async () => {
    const { host, 假 } = await 开({ upload: async (_id, _dir, file) => ({ kind: "done", path: file.name }) })
    const 落点 = 树行(host).find((el) => el.getAttribute("data-path") === "资料") ?? null

    拖入(落点, [new File(["甲"], "甲.csv"), new File(["乙"], "乙.csv")])
    await 冲一遍()

    expect(假.传的).toEqual([
      ["p1", "资料", "甲.csv"],
      ["p1", "资料", "乙.csv"],
    ])
  })

  /**
   * 下载：取字节 → 存到本地。
   *
   * 存盘是 DOM 的事（`<a download>` 那条链），本层只到字节为止（`project-data.ts` 的 `download`
   * 注释）。所以判据分两截：**取**（数据源被叫对）与**存**（那个 `<a>` 带着原名被点了一下）
   * ——只验前者的话，一个「取回来就扔掉」的实现照样绿。
   */
  test("点「下载」⇒ 取字节，并以原文件名存到本地", async () => {
    const { host, 假 } = await 开({ download: async () => new Blob(["甲"], { type: "text/csv" }) })
    const 存下来的: Array<{ href: string; download: string }> = []
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 存回去的就是同一个函数，这里只做替换与还原、不调用它。
    const 原create = URL.createObjectURL
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同上；`click` 靠 `this`，而这里只是把它换掉再换回来。
    const 原click = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => "blob:openhive-test"
    HTMLAnchorElement.prototype.click = function () {
      存下来的.push({ href: this.href, download: this.download })
    }
    try {
      右键行(host, "话单.csv")
      点菜单项("download")
      await 冲一遍()
    } finally {
      URL.createObjectURL = 原create
      HTMLAnchorElement.prototype.click = 原click
    }

    expect(假.下的).toEqual([["p1", "资料/话单.csv"]])
    expect(存下来的).toEqual([{ href: "blob:openhive-test", download: "话单.csv" }])
  })

  /** 取不到（没挂上 / 被拒 / 网络错）⇒ 留一句话，且**一个文件都不落盘**。 */
  test("取不到字节 ⇒ 留一句话，不存盘", async () => {
    const { host } = await 开({ download: async () => undefined })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前一条用例。
    const 原create = URL.createObjectURL
    let 存了 = 0
    URL.createObjectURL = () => {
      存了 += 1
      return "blob:openhive-test"
    }
    try {
      右键行(host, "话单.csv")
      点菜单项("download")
      await 冲一遍()
    } finally {
      URL.createObjectURL = 原create
    }

    expect(text(host, "file-op-message")).toContain("话单.csv")
    expect(存了).toBe(0)
  })
})

/** 成员面板里某个 `data-slot` 的按钮（面板自己那几个 `data-slot` 名见 `member-panel.tsx`）。 */
const 成员按钮 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)
/** 名单**某一行里**的按钮（行按警号认——`member-row` 上有 `data-police-id`）。 */
const 行内按钮 = (host: HTMLElement, policeId: string, slot: string) =>
  host.querySelector<HTMLButtonElement>(
    `[data-slot='member-row'][data-police-id='${policeId}'] [data-slot='${slot}']`,
  )

/**
 * 成员动作接进工作台（T021 出参）。
 *
 * 上面「成员面板接进左栏」那一节（T010）验的是**缝里的名单画不画得出来**；这一节验
 * **谁把名单写进缝里、三颗按钮真的能走到数据源上**——在那之前缝里没有写入方、三个回调
 * 没接（⇒ 渲染成 `disabled`），这是 T005 起的老口径「未接线即禁用」。
 *
 * ⚠️ 每一条都先 `setCurrentUser`：面板的 `decide` 拿 `selfPoliceId` 在名单里反查 role，
 * 查不到 ⇒ `actor` 为 `null` ⇒ **三颗按钮一个都不画**（T010 的有意 fail-closed）。
 * 忘了这一步，用例会红在「按钮不在」，而真正的原因是身份没给——那是一条**误导的红**。
 */
describe("成员动作接进工作台（T021 出参）", () => {
  const 名册: MemberEntry[] = [
    { policeId: "020601", name: "张三", role: "owner" },
    { policeId: "020602", name: "李四", role: "member" },
  ]

  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectMembers(undefined)
    // 我是 owner 张三：能邀请（FR-004：owner 与 member **都能**邀请）、能移除 member（李四那一行）。
    setCurrentUser({ name: "张三", policeId: "020601" })
  })
  // 身份是模块级接入缝，别把它留给后面的用例。
  afterEach(() => setCurrentUser(undefined))

  /** 挂一个**已选定共享项目**、且成员面板已经滑出来的左栏。 */
  async function 开(剧本: Parameters<typeof 假数据源>[0] = {}) {
    const { data, 记 } = 假数据源({ members: async () => 名册, ...剧本 })
    const host = 挂(data)
    await 冲一遍() // 进门拉清单（`archived` 从那一份里来）
    setCurrentProject({ id: "p1", name: "8·17专案", memberCount: 名册.length })
    await 冲一遍() // 选定项目 ⇒ 拉名单
    锚点按钮(host, "project-anchor-members")?.click()
    return { host, 假: 记 }
  }

  /** 在邀请框里填一个警号再点「邀请」（面板自己会 trim 并把输入框清空）。 */
  function 邀请(host: HTMLElement, 警号: string) {
    const 框 = host.querySelector<HTMLInputElement>("[data-slot='member-panel-invite-input']")
    if (!框) throw new Error("邀请框不在——这条用例的前提不成立")
    框.value = 警号
    框.dispatchEvent(new Event("input", { bubbles: true }))
    成员按钮(host, "member-panel-invite-ok")?.click()
  }

  test("选定项目 ⇒ 拉一次名单，写进接入缝（面板里看得到）", async () => {
    const { host, 假 } = await 开()

    expect(假.members).toEqual(["p1"])
    expect(text(host, "member-name")).toBe("张三")
  })

  /**
   * 切项目要**换一份**名单，而不是把上一个项目的人留在界面上（`projectMembers` 是模块级的
   * 一条缝，不是按项目分区的）。判据两条：新项目的人**在**、上一个项目的人**不在**
   * ——只看前一条的话，一个「两份名单叠着画」的实现在「新人画得出来」这件事上照样绿。
   */
  test("切项目 ⇒ 换一份名单（不把上一个项目的人留在界面上）", async () => {
    const { host, 假 } = await 开({
      members: async (id) => (id === "p1" ? 名册 : [{ policeId: "020603", name: "王五", role: "member" }]),
    })
    // 前置：换之前张三是画得出来的——否则下面那个「不在」在面板**压根是空**的时候也绿。
    expect(text(host, "member-name")).toBe("张三")

    setCurrentProject({ id: "p2", name: "另一案", memberCount: 1 })
    await 冲一遍()

    expect(假.members).toEqual(["p1", "p2"])
    expect(text(host, "member-name")).toBe("王五")
    expect(不存在(host, "[data-slot='member-row'][data-police-id='020601']")).toBe(true)
  })

  /**
   * 换项目**那一瞬间**就先清空，不等新名单回来。
   *
   * 与上面两条判的不是同一段：那两条判「新名单落地之后，旧的人不在」，这一条判**中间那一小段**
   * ——新名单卡着没回来时（乙的名单故意让它永不落地），界面不能还挂着上一个项目的人。
   * 少了那次清空，这个窗口里就是「当前项目是乙、名单里是甲的人」：两句都对不上，
   * 而**端点**判据看不见它（`#004-09`）。
   */
  test("换项目那一刻就先清空：新名单还没回来时，不显示上一个项目的人", async () => {
    const { data } = 假数据源({
      members: (id) => (id === "p1" ? Promise.resolve(名册) : new Promise(() => {})),
    })
    const host = 挂(data)

    setCurrentProject({ id: "p1", name: "甲", memberCount: 2 })
    await 冲一遍()
    锚点按钮(host, "project-anchor-members")?.click()
    // 前置：甲的名单真的画出来了——否则下面那个「不在」在面板压根是空的时候也成立（`#004-14`）。
    expect(text(host, "member-name")).toBe("张三")

    setCurrentProject({ id: "p2", name: "乙", memberCount: 1 })
    // 乙那一份**永不落地** ⇒ 这一等仍然停在那个窗口里（不是「等新名单回来再看」）。
    await 冲一遍()

    expect(不存在(host, "[data-slot='member-row'][data-police-id='020601']")).toBe(true)
    expect(text(host, "member-panel-count")).toBe("成员（0）")
  })

  /**
   * 上一个项目的名单**迟到**时不许覆盖新的（同上面文件清单那条，同一个成因）。
   *
   * 这一条钉的是 effect 里那道 `onCleanup` 作废闸：少了它，慢的那一份会**后**落地、
   * 把当前项目的名单顶掉——界面上就成了「当前项目是乙、名单里是甲的人」，
   * 而那正是这个产品最不能容忍的错觉（`#004-09`：端点判据对**顺序**完全不敏感，
   * 所以「有闸」这件事必须单独一条）。
   */
  test("上一个项目的名单迟到 ⇒ 丢掉，不覆盖当前项目（宁可空态，不画错项目的人）", async () => {
    let 放甲: (v: readonly MemberEntry[]) => void = () => {}
    const { data } = 假数据源({
      members: (id) =>
        id === "p1"
          ? new Promise<readonly MemberEntry[]>((resolve) => {
              放甲 = resolve
            })
          : Promise.resolve([{ policeId: "020603", name: "王五", role: "member" }]),
    })
    const host = 挂(data)

    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()
    setCurrentProject({ id: "p2", name: "乙", memberCount: 1 })
    await 冲一遍()
    锚点按钮(host, "project-anchor-members")?.click()
    // 前置：乙的名单真的画出来了——否则下面那两个「不是甲的人」在面板空白时也成立（`#004-14`）。
    expect(text(host, "member-name")).toBe("王五")

    // 甲的名单现在才回来。
    放甲(名册)
    await 冲一遍()

    expect(text(host, "member-name")).toBe("王五")
    expect(不存在(host, "[data-slot='member-row'][data-police-id='020601']")).toBe(true)
  })

  /**
   * 没注入数据源 ⇒ 三颗按钮**渲染成禁用**（T005 起的老口径：未接线即禁用）。
   *
   * 名单是**直接写进缝里**的（不经过数据源）：这样「禁用」只能归因于「没接线」，而不是
   * 「缝里没数据 ⇒ `decide` 把按钮整个去掉了」。两件事长得一样，混在一起看不出是哪种。
   *
   * ⚠️ **顺序要紧**：缝要**在挂载之后**才写。本层是那条缝唯一的写入方，而它「换项目就先清空
   * 再取」——没有数据源时清完就返回（取不了）。先写后挂的话，那一下挂载会把名单当场清掉，
   * 于是这条用例红在「按钮不在」（`我()` 反查不到 ⇒ `decide` 落空），而不是红在「能点」
   * ——那是一条**归因错了的红**。顺序与 T010 那条「缝里没数据时走空态」一致（它也是挂载后写）。
   *
   * 这条同时钉住了「未接线即禁用」：把回调写成不带 `projectData ?` 的直连，
   * `disabled` 就不再成立（`?.disabled` 拿到的是 `false`）——而**按钮不在**时它拿到的是
   * `undefined`，同样不成立 ⇒ 两种坏法都躲不过去。
   */
  test("没注入数据源 ⇒ 邀请 / 移除渲染成**禁用**，且一个请求都不发", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setCurrentProject({ id: "p1", name: "8·17专案", memberCount: 2 })
    setProjectMembers(名册)
    锚点按钮(host, "project-anchor-members")?.click()

    expect(成员按钮(host, "member-panel-invite-ok")?.disabled).toBe(true)
    expect(行内按钮(host, "020602", "member-remove")?.disabled).toBe(true)
  })

  test("点「邀请」⇒ 走 invite 那条出口（带当前项目 id 与警号）；办成 ⇒ 名单重取一次", async () => {
    const { host, 假 } = await 开({ invite: async () => ({ kind: "done" }) })
    const 拉前 = 假.members.length

    邀请(host, "020603")
    await 冲一遍()

    expect(假.邀请的).toEqual([["p1", "020603"]])
    expect(假.members.length).toBe(拉前 + 1)
    // 办成了就**不留话**：名单自己会变（重取），再补一句「邀请成功」是给屏幕加噪音
    // （同 T018/T020 的「`undefined` = 收工」）。
    expect(text(host, "member-op-message")).toBeUndefined()
  })

  /** 被拒 ⇒ 把服务端那句话留在界面上（前端不自己改写措辞），**且不重取**——什么都没变。 */
  test("邀请被拒 ⇒ 留下服务端那句话，且**不**重取名单", async () => {
    const { host, 假 } = await 开({ invite: async () => ({ kind: "rejected", message: "查无此警号" }) })
    const 拉前 = 假.members.length

    邀请(host, "029999")
    await 冲一遍()

    expect(text(host, "member-op-message")).toBe("查无此警号")
    expect(假.members.length).toBe(拉前)
  })

  /**
   * `remove` 与 `invite` 的方法签名**一模一样**（`(projectId, policeNo)`），接错了不报错、
   * 不变红（`project-data.test.ts` 钉的是**绑定**那一层，这里钉的是**界面这一路**）。
   *
   * 带的是**那一行**的警号，不是「名单第一行」：`MemberPanel` 的 `onRemove` 回传的是**整行**，
   * 而本层要从那一行里取出警号（`remove` 这条出口说的是警号）。
   */
  test("点「移除」⇒ 走 remove 那条出口，带的是**那一行**的警号", async () => {
    const { host, 假 } = await 开({ remove: async () => ({ kind: "done" }) })
    // 前置：owner 自己那一行**没有**「移除」（目标须是 member，否则项目会无主）。
    expect(不存在(host, "[data-slot='member-row'][data-police-id='020601'] [data-slot='member-remove']")).toBe(true)

    行内按钮(host, "020602", "member-remove")?.click()
    await 冲一遍()

    expect(假.移除的).toEqual([["p1", "020602"]])
    expect(假.邀请的).toEqual([])
  })

  /**
   * 退群是**独立的一条**（不与「移除」合并）：体里不带警号——退的永远是自己。
   *
   * 我是 member 李四（owner 看不到「退出项目」）。办成之后**收起面板**：退群之后
   * 「这个项目的成员管理」跟我没关系了，留着它只会让下一次重取（此时必然 403）把
   * 「还没有成员」当结论画出来。
   */
  test("点「退出项目」⇒ 走 leave 那条出口；办成 ⇒ 面板收起", async () => {
    setCurrentUser({ name: "李四", policeId: "020602" })
    const { host, 假 } = await 开({ leave: async () => ({ kind: "done" }) })
    // 前置：member 看不到任何「移除」——按钮真的按身份画出来了，才说明反查是活的。
    expect(不存在(host, "[data-slot='member-remove']")).toBe(true)

    成员按钮(host, "member-panel-leave")?.click()
    await 冲一遍()

    expect(假.退的).toEqual(["p1"])
    expect(成员面板开着(host)).toBe(false)
  })

  /**
   * 当前项目已归档 ⇒ 三颗动作**一个都不画**（FR-010：归档 = 冻结），而名单**照样在**
   * ——「冻结的是动作不是看见」是 BE 的裁定（`openhive/member.ts` 文件头整节），
   * 这里钉的是它在界面上也成立。
   *
   * 归档态从**清单**里取（`ProjectEntry.archived`），不从 `currentProject()` 取——那个形状
   * 只有 id / name / memberCount（T005 定的）。故这一条用改清单的方式翻转归档态，
   * **同一个挂载**上前后对照（`#004-14`：先证明它是画的，再说它不画了）。
   */
  test("当前项目已归档 ⇒ 三颗动作一个都不画；对照：不归档时是画的", async () => {
    const { host } = await 开()

    expect(不存在(host, "[data-slot='member-panel-invite-ok']")).toBe(false)
    expect(text(host, "member-name")).toBe("张三")

    setProjectList([封存(私有("p1", "8·17专案", 1))])

    expect(不存在(host, "[data-slot='member-panel-invite-ok']")).toBe(true)
    expect(不存在(host, "[data-slot='member-remove']")).toBe(true)
    // 名单还在——归档 ≠ 看不见
    expect(text(host, "member-name")).toBe("张三")
  })
})

/**
 * 右栏（AI 会话）接进工作台（FR-010 出参 / T008 的第一半）。
 *
 * 本文件只验**转发**这一段：`WorkspaceEntry` 把注入的 `right` 交给 `ThreePane`。
 * `ThreePane` 自己的几何与「不传就不渲染」在 `three-pane.test.tsx` 里，别在这儿重写一遍。
 *
 * 为什么右栏是**注入**（`right?: () => JSX.Element`）而不是本组件自己 import 生产实现：
 * 与 `loadFile` / `projectData` 同因——生产那份要 `useServerSync()`（右栏的会话数据按目录取），
 * 组件自己去 context 里拿，组件测试就再也跑不成离线（本文件全程**不挂任何 provider**）。
 */
describe("右栏（AI 会话）接进工作台（FR-010 出参）", () => {
  test("对照：不传 `right` ⇒ 右栏（含手柄）整根不渲染", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(不存在(host, "[data-slot='three-pane-right']")).toBe(true)
    expect(不存在(host, "[data-slot='three-pane-right-group']")).toBe(true)
  })

  test("传了 `right` ⇒ 内容落在右栏里，且**中栏 / 左栏都没有它**", () => {
    // 用一个**本页不可能撞车的标记**来找它，而不是拿「会话」这种会出现在侧栏 tab 里的词
    // ——否则「不在左栏」那条会因为左栏本来就有「会话」两个字而假红。
    const 标记 = "右栏内容-唯一标记-8f3a"
    const host = mount(() => (
      <WorkspaceEntry right={() => <div data-testid="右栏内容">{标记}</div>}>中栏</WorkspaceEntry>
    ))

    // 判据一律取**字符串**（`?.textContent ?? ""`），不取节点：`#005-01` 实测——断言失败时
    // 若实得值是**被 Solid 渲染过的节点**，bun 的打印器会停不下来，整轮测试**挂死**而不是变红。
    const 文本 = (sel: string) => host.querySelector(sel)?.textContent ?? ""
    expect(文本("[data-slot='three-pane-right']")).toContain(标记)
    // 「各归其位」这一半必须单独钉：只断「它渲染出来了」的话，一个把 right 塞进中栏的写法照样过。
    expect(文本("[data-slot='three-pane-center']")).not.toContain(标记)
    expect(文本("[data-slot='three-pane-left']")).not.toContain(标记)
  })

  /**
   * 注入的内容必须**创建在 `CenterTabsProvider` 之内**——这是「注入一个访问器」而不是
   * 「注入一个现成的元素」的真正理由（同 `right` 那一槽的形状）。
   * `AiSessionSlot` 要按当前模块算投影（`useCenterTabs()`），而那个 provider 是
   * `WorkspaceEntry` 自己建的 ⇒ 内容若在**外面**被创建，它当场抛
   * 「... must be used within a context provider」，而右栏整栏消失、**不报错在右栏上**。
   */
  test("注入的内容读得到工作台的模块状态（证明它创建在 provider 之内）", () => {
    const 探针 = () => {
      const center = useCenterTabs()
      return <div data-testid="模块">{center.module()}</div>
    }

    const host = mount(() => <WorkspaceEntry right={() => <探针 />}>中栏</WorkspaceEntry>)

    expect(host.querySelector("[data-slot='three-pane-right']")?.textContent).toBe("project")
  })
})

/**
 * 启动（挂载）时**还原**上次的「当前项目」（Task B · 2026-10-09，用户裁定 **A：跟随当前项目**）。
 *
 * ## 为什么必须由**启动**来做
 *
 * 005 定下「打开时**不自动选**项目」（`workspace-entry.tsx` 的 `onMount` 那两段注释；spec 只写了
 * 「新建后成为当前项目」与「点某项目切换」）。006 Step 5 ②-1 之后「当前项目」多了一条 **cookie
 * 通道**：浏览器对每一条同源请求自动附带它，而 cookie **活得比页面久**。两条一撞就分叉——
 * **刷新之后**信号回到 `undefined`（界面说「未选择项目」），cookie 却还指着上次那个项目
 * ⇒ **界面说没有项目、请求落在旧项目目录里**（三席独立审查命中同一处，`LEARNINGS #003-02`）。
 *
 * 006 第二轮审查当时的处置（裁定 **B**）是**启动即清**；用户 2026-10-09 改判 **A：跟随当前项目**
 * ——把存档**读回来还原**（左栏会话 tab 于是列的是这个项目自己的会话）。「清」那一支没消失，
 * 它缩到「存档**失效**」那一支（项目没了 / 已归档）；「**没有**存档」仍是**什么都不做**
 * （2026-10-06 那条裁定不变，本组最后一条正是它的正面钉法）。
 *
 * ⚠️ **裁定 A 顺带收掉了裁定 B 的多标签页残余**（cookie 全浏览器共享）：B 下「甲在用、乙一启动
 * 就把 cookie 清掉 ⇒ 甲下次请求落回沙箱根」不再发生——A 不写 cookie。真正的残余变成
 * 「甲切了项目、乙的**信号**还停在旧项目直到它自己下次挂载」（`006/state.md` 缺口表），别把本节
 * 读成「分叉已根除」。
 *
 * ⚠️ 「挂载 ⇒ 还原」也**只在 `WorkspaceEntry` 每次启动只挂一次时才是「启动」**，而那条是一条
 * **上游事实**：`NewAppLayout` 落在**路由根**里（`app.tsx` 那一段的注释写着「lives in the router
 * root so it remains mounted across route changes」）⇒ SPA 里换路由**不重挂**。
 * 与裁定 B 不同，这条假设**不再危险**：民警选了项目 ⇒ `setCurrentProject` 会**同时**写 cookie，
 * 于是即便将来它被挪进某个 `<Route>` 之下、每次导航都重挂，读回的也是**刚刚写进去的**同一个
 * 项目（结果幂等），只是白一次 `list()` 请求。但那条假设今天仍**没有**断言钉着（`LEARNINGS
 * #005-15`：注释不许比断言强），已记在缺口表。
 */
describe("启动（挂载）时**还原**上次的「当前项目」（Task B · 2026-10-09 用户裁定 A）", () => {
  /**
   * jar 里那条 cookie 的**值**；没有它、或被 `Max-Age=0` 置空，都读作 `undefined` / `""`。
   *
   * ⚠️ 名字**写字面量、不 import 生产常量**：与 `current-project.test.ts` 那个同名助手同因
   * （`LEARNINGS #003-05`：import 过来就成了假镜像——生产改什么、测试跟着改什么，改名也测不出来）。
   * ⚠️ 它读的是**真 `document.cookie`**，不是替身：stub 掉它等于把「浏览器认不认这段字符串」
   * 换成「我自己的假实现认不认」（同 `#005-07` 的取向）。
   */
  const 读cookie = (): string | undefined => {
    for (const part of document.cookie.split(";")) {
      const 分隔 = part.indexOf("=")
      if (分隔 === -1) continue
      if (part.slice(0, 分隔).trim() !== "openhive_project") continue
      return part.slice(分隔 + 1).trim()
    }
    return undefined
  }

  /**
   * 摆出「刷新那一刻的真实状态」：**信号是空的（内存），cookie 里还留着存档（活得比页面久）**。
   *
   * ⚠️ cookie 这里走**裸 `document.cookie`**，不用产品的写入点：产品那个写入点**同时写信号**，
   * 而这条链要的恰恰是「只有 cookie 有」——用产品写入点**摆不出**这个状态。这与旧版那条
   * 「清掉」用例的摆法相反（那边用产品写入点是对的，它要的就是「两处都有」）。
   */
  function 摆出存档(id: string) {
    setCurrentProject(undefined) // 信号归零（顺带把 cookie 清干净）
    document.cookie = `openhive_project=${id}; Path=/`
  }

  beforeEach(() => {
    // 两条接入缝都是模块级的，测试之间必须复位（同本文件其余各节）。
    setCurrentProject(undefined)
    setProjectList(undefined)
  })

  /**
   * 主判据（裁定 A）：**存档那个项目还在 ⇒ 恢复成当前项目**。
   *
   * ⚠️ 前置两条缺一不可（`LEARNINGS #004-08`：判「发生」之前先证明现场摆好了）：少了它们，
   * 在「cookie 写入被夹具吃掉」的场合（文档 URL 还是 `about:blank` 时正是如此）end 断言照样绿
   * ——而那种绿什么也没证明。
   */
  test("存档那个项目还在清单里 ⇒ 恢复成当前项目（cookie 不动、锚点行显示它）", async () => {
    摆出存档("prj_stale_0001")
    expect(读cookie()).toBe("prj_stale_0001") // 前置①：存档真的摆上了
    expect(currentProject()).toBeUndefined() // 前置②：信号确实是空的（不然这条测不出「还原」）

    const { data } = 假数据源({ list: async () => [私有("prj_stale_0001", "8·17专案", 1)] })
    const host = 挂(data)
    await 冲一遍()

    expect(currentProject()?.id).toBe("prj_stale_0001")
    expect(读cookie()).toBe("prj_stale_0001")
    expect(text(host, "project-anchor-name")).toBe("8·17专案")
  })

  /**
   * 存档**失效**（那个项目没了）⇒ **清掉**，不挂着它。
   *
   * 判据分两半（同旧版那条的理由）：cookie 与信号**一起**回到「未选择」。只手搓一句
   * `document.cookie = "openhive_project=; …"` 也能让 cookie 那半绿，但会**留着信号** ⇒
   * 「界面还显示着上次那个项目、而请求已经落回沙箱根」——换了个方向的分叉（`LEARNINGS #002-06`）。
   * 另一半（已归档）在 `current-project.test.ts` 里有独立一条。
   */
  test("存档那个项目已经不在清单里 ⇒ 信号与 cookie 一起回到「未选择」", async () => {
    摆出存档("prj_gone_0009")
    expect(读cookie()).toBe("prj_gone_0009") // 前置：存档摆上了

    const { data } = 假数据源({ list: async () => [私有("prj_alpha_0001", "8·17专案", 1)] })
    const host = 挂(data)
    await 冲一遍()

    // 判据写成「**空的或不存在**」，不写死形态：happy-dom 的 `Max-Age=0` **不删条目**、只把值置空，
    // 真实浏览器会整条删掉——两种形态在服务端读取器（`cookieValue` 的 `if (!raw) return undefined`）
    // 眼里等价（`current-project.test.ts` 的 `等于没有` 同因）。
    expect(读cookie() ?? "").toBe("")
    expect(currentProject()).toBeUndefined()
    expect(text(host, "project-anchor-name")).toBe("未选择项目")
  })

  /**
   * **没有存档 ⇒ 不自动选**（2026-10-06 那条裁定的正面钉法，裁定 A 没有动它）。
   *
   * 与下面 T018 那节的「不自动认领当前项目」是**同一件事的两面**：那边从面板角度看，这边
   * 紧挨着「有存档就还原」摆着当**对照**——少了它，「还原」与「无条件认领」在测试里长得一样。
   */
  test("没有存档 ⇒ 保持「未选择项目」，不自动选（清单里有项目也不认领）", async () => {
    const { data } = 假数据源({ list: async () => [私有("prj_alpha_0001", "8·17专案", 1)] })
    const host = 挂(data)
    await 冲一遍()

    expect(currentProject()).toBeUndefined()
    expect(text(host, "project-anchor-name")).toBe("未选择项目")
    // 前置：清单真的到了面板上——否则上面那两条在「压根没接线」时也是绿的（`#004-14`）。
    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(text(host, "project-item-name")).toBe("8·17专案")
  })
})

/**
 * 中栏在**会话路由**上让位（2026-10-08 缺陷修复 · 中栏错显上游会话页）。
 *
 * `children` 在生产里是**上游路由自己的页面**——在 `/server/:key/session/:id` 上就是
 * `pages/session.tsx`（一页完整的 AI 会话：消息流 ＋ composer）。中栏把它露出来，屏幕上就有
 * **两个输入框、两条消息流**，且两个 composer 都在真的发消息，用户当场肉眼报出。
 *
 * 本组件**不读 Router**（本文件的 96 条用例都裸挂它，无 Router；在里面 `useLocation()` 会当场抛），
 * 判定由壳层算好、当作访问器传进来（生产入口是 `pages/layout-new.tsx` 那一行）。所以这一组量的是
 * 「拿到判定之后中栏怎么摆」，**不是**「那一行接线有没有接上」——后者只有真路由下才求得了值，
 * 由真栈 E2E 钉住（`e2e/real-stack/ai-session-real.spec.ts` 测试 ③）。
 * 两条各管一半，谁也不能顶替谁（`LEARNINGS #005-11`）。
 */
describe("中栏让位：`routePageVisible` 决定 children 露不露", () => {
  const 页面层 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-slot='center-page']")
  /** 有没有那句提示。判**布尔**不判节点（`LEARNINGS #005-01`：节点当实得值会挂哑整轮）。 */
  const 有提示 = (host: HTMLElement) => host.querySelector("[data-slot='center-empty']") !== null
  const 中栏内容 = <div data-slot="center-content">中栏内容</div>

  test("对照：不传 ⇒ children 照旧露、不凭空冒提示（与加这个 prop 之前逐字同行为）", () => {
    const host = mount(() => <WorkspaceEntry>{中栏内容}</WorkspaceEntry>)

    expect(页面层(host)?.style.display).toBe("contents")
    expect(text(host, "center-content")).toBe("中栏内容")
    expect(有提示(host)).toBe(false)
  })

  test("`() => false`（会话路由）⇒ children 不露、改由一句提示说话", () => {
    const host = mount(() => <WorkspaceEntry routePageVisible={() => false}>{中栏内容}</WorkspaceEntry>)

    // 被测属性：页面让位。
    expect(页面层(host)?.style.display).toBe("none")
    // 同一时刻不能只剩一片空白——那读起来像「坏了」，而不是「去右栏干活」。
    expect(text(host, "center-empty")).toContain("右栏")
  })

  test("`() => true`（其余路由）⇒ 提示不出现（反向对照，防「恒藏」也能过上面那条）", () => {
    const host = mount(() => <WorkspaceEntry routePageVisible={() => true}>{中栏内容}</WorkspaceEntry>)

    expect(页面层(host)?.style.display).toBe("contents")
    expect(有提示(host)).toBe(false)
  })

  test("判定是**访问器**：它变了中栏跟着变（传现成 boolean 会把中栏冻在首次渲染那一刻）", async () => {
    const [会话路由, set会话路由] = createSignal(false)
    const host = mount(() => <WorkspaceEntry routePageVisible={() => !会话路由()}>{中栏内容}</WorkspaceEntry>)

    expect(页面层(host)?.style.display).toBe("contents")

    set会话路由(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(页面层(host)?.style.display).toBe("none")
    expect(text(host, "center-empty")).toContain("右栏")
  })
})
