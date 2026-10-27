import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { toaster } from "@opencode-ai/ui/toast"
import { createSignal, For, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import type { AssetCatalog } from "@/ai-assets/asset-catalog"
import type { AssetCategories } from "@/ai-assets/categories"
import type { 内核技能 } from "@/ai-assets/enable-api"
import type { ProjectEnablement } from "@/ai-assets/enable-state"
import { ASSET_CATEGORY_SEED } from "@opencode-ai/asset-service/categories"
import { useProjectionModule } from "@/ai-session/projection-module"
import { useModuleAction, type ModuleAction } from "@/center/module-actions"
import { useCenterTabs } from "@/center/tab-context"
import { type ContentTab } from "@/center/tab-store"
import { 取草稿, 开始编辑 } from "@/center/views/richtext/draft-store"
import { currentProject, setCurrentProject } from "@/project/current-project"
import type { MemberEntry } from "@/project/member-panel"
import {
  setBackupJob,
  setBackupSnapshotId,
  setBackupSnapshots,
  setBackupUsage,
  setMinioBackups,
} from "@/project/minio-backups"
import type { BackupJob, BackupPreview, BackupSnapshot, BackupSnapshotDetail } from "@/project/openhive-backup"
import { type ProjectData } from "@/project/project-data"
import { 请求文件清单, set文件清单请求, setProjectFiles } from "@/project/project-files"
import { projectList, projectListFailed, setProjectList, setProjectListFailed } from "@/project/project-list"
import { setProjectMembers } from "@/project/project-members"
import { type NewProjectInput, type ProjectEntry } from "@/project/project-panel"
import { ToastRegion } from "@/utils/toast"
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
 * **AI 资产网格的视口垫片**（009 T006）。
 *
 * happy-dom 没有布局，`offsetWidth/offsetHeight` 恒 0；`@tanstack/virtual-core` 首帧用它们覆盖
 * `initialRect`，不垫就会渲染 0 张卡——那会让「中栏有网格」的集成断言红得像产品坏了，
 * 其实是环境没视口（同 `asset-grid.test.tsx` 文件头那段，两处各自安装、互不影响）。
 * 只认资产网格的滚动槽，其余元素仍返回 0。
 */
for (const [属性, 尺寸] of [
  ["offsetWidth", 800],
  ["offsetHeight", 600],
] as const) {
  Object.defineProperty(HTMLElement.prototype, 属性, {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.slot === "asset-grid-viewport" ? 尺寸 : 0
    },
  })
}

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

/**
 * ⚠️ 外面套一层 `DialogProvider`（2026-10-11 起）：新建改成弹窗之后，`useDialog()` 在**没有
 * Provider 时是抛错**（`context/dialog.tsx` 刻意如此），不套这一层，凡走到「新建」的用例会当场炸，
 * 且炸的形状是「组件挂不上」而不是「弹窗没出来」——那是两回事。
 *
 * 同理 `render()` 的返回值必须留着：`useDialog().close()` 是**延迟 100ms** 才 `dispose()` 那棵
 * 弹窗树的，那条定时器挂在 **Provider 的 owner** 上（`context/dialog.tsx` 的 `onCleanup`）——
 * 所以 `afterEach` 必须先卸载、再擦 body（见下方 `afterEach`）。
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <DialogProvider>{element()}</DialogProvider>, host))
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
  // toast 的 store 是模块级的 ⇒ 不清的话上一条的提示会残到下一条（配方同 `file-tree.test.tsx`）。
  toaster.clear()
})

/**
 * 「清单取不到」也是**模块级缝**，而它比 `projectList` 更容易串味：`projectList` 几乎每个用例
 * 都会经 `拉清单` 被写一次；这一条**只有失败时才写**——留着上一条用例的 `true`，下一条
 * 「没注入数据源」（压根不发请求、也就没人再写它）的用例会读到它，面板莫名其妙多出一句话。
 * 那正是 `LEARNINGS #005-03` 的形状：缝没复位，红的/绿的是**毫不相干**的下一条。
 *
 * 只复位新加的这一条：`projectList` 今天没有泄漏症状，而顺手改一个与本轮无关的夹具行为，
 * 会让别的用例的红绿跟着变（`CLAUDE.md` 的「只动自己碰过的地方」）。
 */
beforeEach(() => {
  setProjectListFailed(undefined)
  // 「有人要过清单」也是模块级缝（`#005-03`）：上一条用例拨过的话，下一条停在「会话」页签的
  // 用例会直接取数——而它要证明的正是「不取」。放在**全局**这一处，因为本文件有 6 个 describe
  // 各自复位自己那几条缝，漏掉任何一个都会让红绿取决于用例顺序。
  set文件清单请求(0)
})

const entries = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']"),
]

const railLabels = (host: HTMLElement) => entries(host).map((el) => el.getAttribute("aria-label"))

const currentModule = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-slot='rail-entry'][aria-current='page']")?.getAttribute("aria-label")

/**
 * 「左栏还开着吗」——同时也就是「还停在项目管理上吗」。
 *
 * ⚠️ 2026-10-11 起这两件事在 DOM 上是**同一个证据**：「项目管理」那颗从模块轴挪到了开关轴
 * （它开关的是左栏，见 `rail.tsx` 的分流那段）⇒ 它读 `aria-pressed`、**不再有** `aria-current`。
 * 于是 `currentModule()` 对 project **没有答案**（这是语义真的变了，不是取数取错了），本文件里
 * 原先靠 `currentModule(host) === "项目管理"` 断「模块没被换走」的那几处一并改用本辅助
 * （`#002-06` 的另一面：同一个判断，别让它在这里多出一份**另一套读法**）。
 *
 * `aria-pressed` 为真 ⟺ `module === "project"` **且** 项目左栏开关开着，正是这几处要的那个合取。
 *
 * ⚠️ 009 T005 起它**不再等价于「左栏露着」**：AI 资产的左栏同样露着，但这颗必须灭
 * （它表示「我在项目管理」，不是「左边有栏」）。判「左栏露着」请读 `[data-slot='three-pane-left']`。
 */
const 左栏开着 = (host: HTMLElement) => 入口(host, "项目管理").getAttribute("aria-pressed") === "true"

const 入口 = (host: HTMLElement, label: string) => {
  const found = entries(host).find((el) => el.getAttribute("aria-label") === label)
  if (!found) throw new Error(`图标栏里没有「${label}」`)
  return found
}

const text = (root: HTMLElement, slot: string) => root.querySelector(`[data-slot='${slot}']`)?.textContent?.trim()

/**
 * 弹窗里的槽：`dialog.show()` 把内容 Portal 到 **`document.body`**，不在挂载 host 里
 * （结果弹窗、确认框、恢复对话框都走这条路）。按 host 查只会读到 `null`，红成「弹窗没开」。
 */
const 页面槽 = (slot: string) => document.body.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 文本在页 = (slot: string) => 页面槽(slot)?.textContent?.trim() ?? ""

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
    // ⚠️ 2026-10-11 起这一处的证据换成 `左栏开着()`（理由见它的注释）：`currentModule()` 读的是
    // **模块轴**的 `aria-current`，而「项目管理」已挪到开关轴 ⇒ 模块没被换走由「左栏还在」证明。
    expect(左栏开着(host)).toBe(true)
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
   * **底部「系统设置」不是模块**（2026-10-09 用户下达的 #3）。
   *
   * 期望：点它**开设置对话框**，图标栏**不高亮**（仍停在原业务模块上）。
   *
   * ⚠️ 这条钉的是**接线**：`openSettings` 由 `pages/layout-new.tsx` 注入（那里才读得到
   * Router / `useDialog`——本组件被裸挂，见 `onOpenSettings` 那个 prop 上的注释）。真对话框
   * 在这里开不出来（要 `DialogProvider` ＋ 懒加载 `settings-v2`），所以断言是「注入的入口被调了」
   * ＋「模块字符串没被换掉」——**后半才是本次要修的那一半**：旧行为下 `switchModule("settings")`
   * 会把模块换走，图标点亮、左栏（`module === "project"` 才渲染）整列消失。
   */
  test("点「系统设置」不切模块：调用注入的开设置入口，图标栏仍停在原业务模块上、设置自己不点亮", () => {
    let 开过 = 0
    const host = mount(() => (
      <WorkspaceEntry
        onOpenSettings={() => {
          开过 += 1
        }}
      >
        中栏
      </WorkspaceEntry>
    ))

    入口(host, "系统设置").click()

    expect(开过).toBe(1)
    // 「不高亮」：高亮**不动**，仍在入口那一个业务模块上（不是变成「系统设置」）
    // ⚠️ 证据同下一条换成 `左栏开着()`：模块轴对 project **没有答案**了。
    expect(左栏开着(host)).toBe(true)
    // 另一半：设置那颗自己**没有** `aria-current`（顺序按 `#004-14`：被测属性在前，伴随信号在后）
    expect(入口(host, "系统设置").getAttribute("aria-current")).toBeNull()
    // 伴随信号：左栏还在（旧行为下模块被换走 ⇒ 这一列消失）
    expect(host.querySelector("[data-slot='three-pane-left']")).not.toBeNull()
  })

  test("省略 onOpenSettings：点「系统设置」不崩、也不切模块（**不退回 switchModule**）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    入口(host, "系统设置").click()

    // ⚠️ 证据换成 `左栏开着()`（理由见它自己的注释）：模块轴对 project **没有答案**了。
    expect(左栏开着(host)).toBe(true)
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

  /**
   * 换项目清空中栏（2026-10-12 分屏追加）：左栏那棵树是**当前项目**的文件，中栏一张 tab 绑的是
   * 一个**路径**——换了项目之后旧 tab 指向另一样东西，留着就像串项目（与文件清单那份 effect 的
   * 「留着上一个项目的文件更糟」是同一个判断）。故「当前项目一变，中栏 tab 清空」与文件清单清空
   * **同拍**发生（`workspace-entry.tsx` 里那份独立的 clear effect）。
   */
  test("换项目清空中栏：当前项目一变，中栏 tab 被清空", async () => {
    setCurrentProject(undefined) // 信号与 cookie 一起归零（`current-project` 里那条注释）
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案, 话单]} />
      </WorkspaceEntry>
    ))
    await 冲一遍()
    expect(tabTitles(host)).toEqual(["专案A", "话单.csv"]) // 前置：两张 tab 确实开着

    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()

    expect(tabTitles(host)).toEqual([]) // 换项目 ⇒ 中栏清空
  })

  test("换项目也清空草稿：旧项目没保存的正文不跟着串到新项目", async () => {
    setCurrentProject(undefined)
    const host = mount(() => (
      <WorkspaceEntry>
        <OpenTabs tabs={[专案]} />
      </WorkspaceEntry>
    ))
    await 冲一遍()

    开始编辑("卷宗/纪要.md", { content: "旧项目里没保存的字", base: "旧原文" })
    expect(取草稿("卷宗/纪要.md")?.content).toBe("旧项目里没保存的字")

    setCurrentProject({ id: "p2", name: "另一个案子" })
    await 冲一遍()

    expect(取草稿("卷宗/纪要.md")).toBeUndefined()
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

  test("面板槽自带高度上限（`max-h-[calc(100%-2.5rem)]`）且是 flex 容器——上限靠它才压得下面板（用户 2026-10-11 实报）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    锚点按钮(host, "project-anchor-toggle")?.click()

    const 槽 = host.querySelector<HTMLElement>("[data-slot='project-panel-slot']")
    /*
      为什么断在这里：面板是**绝对定位的浮层**，它自己不知道屏幕到哪结束；能给出高度上限的
      只有槽（`top-10` 是槽自己写下的偏移、`100%` 解析到 `relative h-full` 的侧栏）⇒ 少了
      `max-h-[calc(100%-2.5rem)]`，列表就把面板撑破、超出部分被祖先 `overflow-y:hidden` 裁掉。
      `flex flex-col` 是让上限**真的生效**的那一步（面板是 flex 子项，配它自己的 `min-h-0`）。

      ⚠️ 断在类名 token 上、不断节点非空：happy-dom 没有布局引擎、量不出 CSS（`#005-07`），
         所以视觉约定在这里只能落到 className 上。逐 token 用 Set 成员判断、**不用**
         `toContain` 子串（`#006-22`：`flex` ⊂ `flex-col` 会假绿）。
      ⚠️ 也不用 `expect(槽).toBeNull()` 那族断言——`#005-01`：happy-dom 里它会把整轮跑挂死。
         槽取不到时下方三个 `has` 全为 false，自然会红。
    */
    const 类名集 = new Set((槽?.className ?? "").split(/\s+/).filter(Boolean))
    expect(类名集.has("flex")).toBe(true)
    expect(类名集.has("flex-col")).toBe(true)
    expect(类名集.has("max-h-[calc(100%-2.5rem)]")).toBe(true)
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
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开

    expect(树行(host).map((el) => el.getAttribute("data-path"))).toContain("资料/8·17/话单.csv")
  })

  test("缝里没数据时走空态，不伪造文件（宁缺勿假）——今天确实没有写入方", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(树行(host).length).toBe(0)
    expect(text(host, "file-tree-empty")).toBe("还没有文件")
  })

  /**
   * **没选中项目时，三个写动作仍是禁用的**（T018 起）。
   *
   * 改之前它们是因为「T007 还没接线」而禁用；现在接线了，禁用理由换成了**没有可动的项目**
   * ——三个 handler 都要 `currentProject()?.id`，没有它一个都办不成。所以 `workspace-entry`
   * 只在有项目时才把它们接给树（见那里的 `有项目`）。
   *
   * ⚠️ 红的时候别把它读成「禁用是洁癖」：不这样，树上会多出三颗**点了没反应**的按钮
   * ——`file-tree.tsx` 反复挡的正是这个形状。
   */
  test("没选中项目 ⇒ ＋ / 重命名 / 删除 是禁用的，搜索与收缩展开照常可用", () => {
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

  test("成员面板槽同样自带高度上限（`max-h-[calc(100%-2.5rem)]`）——同 `project-panel-slot` 那条的理由", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    setCurrentProject({ name: "8·17专案", memberCount: 3 })

    锚点按钮(host, "project-anchor-members")?.click()

    // 理由逐字同 `project-panel-slot` 那条：面板不知道屏幕到哪结束，能给出上限的只有槽。
    // ⚠️ 逐 token Set 判断（`#006-22`：`flex` ⊂ `flex-col` 会假绿）；不写 `toBeNull()`（`#005-01`）。
    const 槽 = host.querySelector<HTMLElement>("[data-slot='member-panel-slot']")
    const 类名集 = new Set((槽?.className ?? "").split(/\s+/).filter(Boolean))
    expect(类名集.has("flex")).toBe(true)
    expect(类名集.has("flex-col")).toBe(true)
    expect(类名集.has("max-h-[calc(100%-2.5rem)]")).toBe(true)
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

const 侧栏tab = (host: HTMLElement, key: "session" | "files" | "capability") =>
  host.querySelector<HTMLButtonElement>(`[data-slot='sidebar-tab'][data-tab='${key}']`)
const 窄条 = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-slot='minio-bar-open']")
const 双树 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-component='dual-file-tree']")
const 沙箱树 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-tree='sandbox']")
const tabpane = (host: HTMLElement, key: "session" | "files" | "capability") =>
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

  test("左栏有 [会话][文件][能力] 三个 tab，且**默认停在「文件」**（设计 §2）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

    expect(侧栏tab(host, "files")?.getAttribute("aria-selected")).toBe("true")
    expect(侧栏tab(host, "session")?.getAttribute("aria-selected")).toBe("false")
    expect(侧栏tab(host, "capability")?.getAttribute("aria-selected")).toBe("false")
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

    expect(text(host, "minio-bar-count")).toBe("· 2 个文件")
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

  test("窄条是窗口的开合钮：再点一次收起，箭头跟着翻向（2026-10-18）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    const 箭头 = () =>
      host.querySelector("[data-slot='minio-bar-chevron']")?.querySelector("use")?.getAttribute("href") ?? ""

    窄条(host)?.click()
    expect(不存在(host, "[data-tree='minio']")).toBe(false) // 前置：第一次是打开
    expect(箭头()).toContain("chevron-down")

    窄条(host)?.click()

    expect(不存在(host, "[data-tree='minio']")).toBe(true)
    expect(箭头()).toContain("chevron-right")
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

  test("下树走接入缝：缝里写进备份清单，下树才列得出来", async () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    窄条(host)?.click()
    // 前置：今天没有写入方 ⇒ 下树是「未接入」空态（不是「还没有备份」——那两句意思相反）
    expect(text(host, "minio-tree-empty")).toBe("备份清单未接入")

    setMinioBackups(["资料/话单.csv"])

    // 下树自 2026-10-18 起默认**全收缩**：深层行要等数据落地后再展开才出现——所以走
    // `等到下树行`（它把「点全部展开」放进轮询条件里），而不是同步断言那一行不存在。
    await 等到下树行(host, "资料/话单.csv")
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
      | "rename"
      | "deleteProject"
      | "files"
      | "createEntry"
      | "renameEntry"
      | "removeEntry"
      | "copy"
      | "move"
      | "upload"
      | "download"
      | "downloadArchive"
      | "members"
      | "invite"
      | "remove"
      | "leave"
      | "touch"
      | "snapshots"
      | "snapshotDetail"
      | "backup"
      | "backupStatus"
      | "previewRestore"
      | "restoreBackup"
      | "deleteSnapshot"
      | "job"
      | "cancelJob"
      | "heartbeat"
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
    改名的项目: [] as Array<[string, string]>,
    删的项目: [] as string[],
    建的条目: [] as Array<[string, string, string, string]>,
    改名的: [] as Array<[string, string, string]>,
    删的: [] as Array<[string, string]>,
    复制的: [] as Array<[string, string, string]>,
    移动的: [] as Array<[string, string, string]>,
    传的: [] as Array<[string, string, string]>,
    下的: [] as Array<[string, string]>,
    // `[项目, 选中集（原样）, 包名]`。选中集存成数组：断言要**逐项**比顺序。
    打包的: [] as Array<[string, readonly string[], string]>,
    邀请的: [] as Array<[string, string]>,
    移除的: [] as Array<[string, string]>,
    退的: [] as string[],
    触碰的: [] as string[],
    // Task 17（2026-10-18）备份 / 恢复接线的八本账。**顺序即「同一条链上的先后」**：
    // 进门心跳 → 取恢复点 → 取明细 → 起备份 / 起预览 / 起恢复 → 删恢复点 / 取消任务。
    心跳: [] as string[],
    恢复点: [] as string[],
    明细: [] as Array<[string, string]>,
    // `[项目, 路径, allowOverQuota]`——第三个量是**超限重试**那一路唯一能看出来的差别。
    起的备份: [] as Array<[string, string, boolean]>,
    预览的: [] as Array<[string, string, string]>,
    // `[项目, 恢复点, 路径, decision, JSON.stringify(decisions)]`：判据要**逐字**比对
    // 「恢复对话框交回来的两个量」，JSON 串让 `decisions` 能在 `toEqual` 里直接比。
    恢复的: [] as Array<[string, string, string, string, string]>,
    删的恢复点: [] as Array<[string, string]>,
    取消的: [] as string[],
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
    // 2026-10-16 项目改名 / 删除。同上面几条：**没给剧本就是没办成**——一条没接剧本的路在测试里
    // 悄悄报成功，会让「接线根本没接上」看起来是绿的。
    rename: async (projectId, name) => {
      记.改名的项目.push([projectId, name])
      return 剧本.rename ? await 剧本.rename(projectId, name) : { kind: "failed", message: "没有剧本" }
    },
    deleteProject: async (projectId) => {
      记.删的项目.push(projectId)
      return 剧本.deleteProject ? await 剧本.deleteProject(projectId) : { kind: "failed", message: "没有剧本" }
    },
    files: async (projectId) => {
      记.files.push(projectId)
      return 剧本.files ? await 剧本.files(projectId) : []
    },
    // T018 的建 / 改名 / 删。同上面几条：**没给剧本就是没办成**——一条没接剧本的路在测试里
    // 悄悄报成功，会让「接线根本没接上」看起来是绿的。
    createEntry: async (projectId, kind, dir, name) => {
      记.建的条目.push([projectId, kind, dir, name])
      return 剧本.createEntry
        ? await 剧本.createEntry(projectId, kind, dir, name)
        : { kind: "failed", message: "没有剧本" }
    },
    renameEntry: async (projectId, path, name) => {
      记.改名的.push([projectId, path, name])
      return 剧本.renameEntry ? await 剧本.renameEntry(projectId, path, name) : { kind: "failed", message: "没有剧本" }
    },
    removeEntry: async (projectId, path) => {
      记.删的.push([projectId, path])
      return 剧本.removeEntry ? await 剧本.removeEntry(projectId, path) : { kind: "failed", message: "没有剧本" }
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
    upload: async (projectId, dir, file, options) => {
      记.传的.push([projectId, dir, file.name])
      return 剧本.upload ? await 剧本.upload(projectId, dir, file, options) : { kind: "failed", message: "没有剧本" }
    },
    download: async (projectId, path, options) => {
      记.下的.push([projectId, path])
      return 剧本.download ? await 剧本.download(projectId, path, options) : undefined
    },
    downloadArchive: async (projectId, paths, name, options) => {
      记.打包的.push([projectId, [...paths], name])
      return 剧本.downloadArchive
        ? await 剧本.downloadArchive(projectId, paths, name, options)
        : { kind: "failed", message: "没有剧本" }
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
    // Task 13 的十个备份 / 恢复出口（Task 17 起 `workspace-entry` 必须真的调用它们）。
    // 默认值按「取不到 / 没办成」给——同上面几条的理由：一条没接剧本的路**不悄悄报成功**。
    // ⚠️ `heartbeat` 是**例外**（amend R-2）：它的返回值在界面上一个字都不显示，唯一的消费者
    // 就是记账断言本身，默认报失败只会把「接没接上」搅浑 ⇒ 默认 `true`。
    snapshots: async (projectId, path) => {
      记.恢复点.push(projectId)
      return 剧本.snapshots ? await 剧本.snapshots(projectId, path) : undefined
    },
    snapshotDetail: async (projectId, snapshotId) => {
      记.明细.push([projectId, snapshotId])
      return 剧本.snapshotDetail ? await 剧本.snapshotDetail(projectId, snapshotId) : undefined
    },
    backup: async (projectId, path, allowOverQuota) => {
      记.起的备份.push([projectId, path ?? "", allowOverQuota ?? false])
      return 剧本.backup ? await 剧本.backup(projectId, path, allowOverQuota) : undefined
    },
    backupStatus: async (projectId) => {
      return 剧本.backupStatus ? await 剧本.backupStatus(projectId) : undefined
    },
    previewRestore: async (projectId, input) => {
      记.预览的.push([projectId, input.snapshotId, input.path])
      return 剧本.previewRestore ? await 剧本.previewRestore(projectId, input) : undefined
    },
    restoreBackup: async (projectId, input) => {
      记.恢复的.push([
        projectId,
        input.snapshotId,
        input.path,
        input.decision,
        JSON.stringify(input.decisions ?? {}),
      ])
      return 剧本.restoreBackup ? await 剧本.restoreBackup(projectId, input) : undefined
    },
    deleteSnapshot: async (projectId, snapshotId) => {
      记.删的恢复点.push([projectId, snapshotId])
      return 剧本.deleteSnapshot ? await 剧本.deleteSnapshot(projectId, snapshotId) : false
    },
    job: async (jobId) => {
      return 剧本.job ? await 剧本.job(jobId) : undefined
    },
    cancelJob: async (jobId) => {
      记.取消的.push(jobId)
      return 剧本.cancelJob ? await 剧本.cancelJob(jobId) : false
    },
    heartbeat: async (projectId) => {
      记.心跳.push(projectId)
      return 剧本.heartbeat ? await 剧本.heartbeat(projectId) : true
    },
  }
  return { data, 记 }
}

const 挂 = (data: ProjectData) =>
  mount(() => (
    <>
      <ToastRegion v2={false} />
      <WorkspaceEntry projectData={data}>中栏</WorkspaceEntry>
    </>
  ))

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
 * ── 项目行 ⋯ 菜单 / 就地改名（2026-10-16 修复轮 1）────────────────
 *
 * 行内 ⋯ 菜单的「改名 / 删除」走这组辅助。照 `project-panel.test.tsx` 的 `指` / `冲刷` /
 * `行菜单钮` / `改名框` / `打字` 整段抄来（`LEARNINGS #004-12`：同族 harness 抄、只换判据点），
 * 只改两个名字：本文件的 `菜单项` 已被文件树右键菜单占掉，这里叫 `项目菜单项`；`打字` 与
 * `条里打字` 是同一件事、但查法不同（就地改名输入框不是按 slot 直接取——编辑态下名字那格被
 * 整颗换掉），各留各的。
 */

/** 点一颗钮，派真实指针序列——`pointerdown` 开菜单、`pointerup` 选中项（`#006-37`，不能用 `.click()`）。 */
const 指 = (el: HTMLElement | null | undefined) => {
  if (!el) throw new Error("指针目标不在——这条用例的前提不成立（`#004-14`）")
  for (const 类型 of ["pointerdown", "pointerup"])
    el.dispatchEvent(new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}

/**
 * 把「这几次延时都排空」——`setTimeout(0)` → `requestAnimationFrame` → `setTimeout(0)`。
 * Kobalte 菜单开那一刻的 `tryAutoFocus` 是**延迟**的，点菜单项前先冲一拍让它落地（`#006-31`）。
 */
const 冲刷 = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 某一行上那颗「⋯」（菜单触发器）。菜单 Portal 到 `document.body` ⇒ 内容查 `document`。 */
const 行菜单钮 = (host: HTMLElement, 名: string) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='project-row']")]
    .find((行) => 行.querySelector("[data-slot='project-item-name']")?.textContent?.trim() === 名)
    ?.querySelector<HTMLElement>("[data-project-action='menu']")

/** 项目行菜单里某一项（Portal 到 `document.body`，不在 host 里）。 */
const 项目菜单项 = (action: string) => document.body.querySelector<HTMLElement>(`[data-project-action='${action}']`)

/** 某一行上那个就地改名输入框（编辑态才有；同一时刻只有一行在改名）。 */
const 改名框 = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='project-row']")]
    .find((行) => 行.querySelector("[data-slot='project-rename-input']") !== null)
    ?.querySelector<HTMLInputElement>("[data-slot='project-rename-input']")

/** 往输入框里打字：Solid 的 `onInput` 读 `event.currentTarget.value` ⇒ 先落值再派事件。 */
const 打字 = (el: HTMLInputElement, 值: string) => {
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
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
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
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
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("甲/资料.csv")

    setCurrentProject({ id: "p2", name: "乙" })
    await 冲一遍()

    expect(记.files).toEqual(["p1", "p2"])
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("乙/话单.csv")
    // **旧项目那棵不能留着**：换项目时缝要先清空，否则甲的文件会在乙的树下继续显示。
    expect(路径们(host)).not.toContain("甲/资料.csv")
  })

  /**
   * 文件清单的三态（2026-10-21 用户实报：打开大项目 2.9 秒里一直显示「还没有文件」）。
   *
   * 真栈实测那两个数：`file-tree-empty` 在点击后 **6ms** 就出现，数据 **2930ms** 才到；
   * 而 `listProjectFiles` 的 314 次目录请求里 96% 花在 `.opencode\` 上（P0-② 另治）。
   * 这一组钉的是**说法**：没答案时说「正在加载」，取不到时说「取不到」并给重试。
   */
  test("清单还没回来 ⇒ 树说「正在加载文件…」，不说「还没有文件」", async () => {
    const 放行: Array<(v: readonly string[] | undefined) => void> = []
    const { data } = 假数据源({ files: () => new Promise((resolve) => 放行.push(resolve)) })
    const host = 挂(data)

    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()

    expect(text(host, "file-tree-loading")).toBe("正在加载文件…")
    // 对照（`#002-02`）：问的是同一个问题，答案必须**相反**——否则这条只证明「有个槽」。
    expect(text(host, "file-tree-empty")).toBeUndefined()

    放行.shift()?.(["资料/话单.csv"])
    await 冲一遍()
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("资料/话单.csv")
    expect(text(host, "file-tree-loading")).toBeUndefined()
  })

  test("清单取不到 ⇒ 说「文件清单加载失败」并给重试；点重试再取，回来之后树就长出来", async () => {
    let 第几次 = 0
    const { data, 记 } = 假数据源({
      files: async () => {
        第几次 += 1
        return 第几次 === 1 ? undefined : ["资料/话单.csv"]
      },
    })
    const host = 挂(data)

    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()

    expect(text(host, "file-tree-failed")).toBe("文件清单加载失败")
    expect(text(host, "file-tree-empty")).toBeUndefined()
    expect(记.files).toEqual(["p1"])

    host.querySelector<HTMLButtonElement>("[data-slot='file-tree-retry']")?.click()
    await 冲一遍()

    expect(记.files).toEqual(["p1", "p1"])
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("资料/话单.csv")
    expect(text(host, "file-tree-failed")).toBeUndefined()
  })

  /**
   * 按需取数（2026-10-21）：文件清单只在**有人要看它**的时候取。
   *
   * 默认页签是「文件」，所以这条对「打开项目」那一下没有改变；它省掉的是**停在「会话」页签
   * 切项目**那一路——那条路今天照样跑整棵文件树，而用户一眼都看不到它。
   */
  test("停在「会话」页签切项目 ⇒ 不取文件清单；切回「文件」页签 ⇒ 补取一次", async () => {
    const { data, 记 } = 假数据源({ files: async () => ["资料/话单.csv"] })
    const host = 挂(data)
    await 冲一遍()

    // 立前提：先把页签切到「会话」。找不到就**抛**——页签没切过去的话，下面那条「没取」
    // 会变成一条永远绿的空断言（`#005-38`）。
    const 会话页 = host.querySelector<HTMLElement>("[data-slot='sidebar-tab'][data-tab='session']")
    if (!会话页) throw new Error("左栏找不到「会话」页签——前提没立住")
    会话页.click()
    await 冲一遍()

    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()
    expect(记.files).toEqual([])

    host.querySelector<HTMLElement>("[data-slot='sidebar-tab'][data-tab='files']")?.click()
    await 冲一遍()

    expect(记.files).toEqual(["p1"])
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("资料/话单.csv")
  })

  /**
   * 组件外那个消费者：Markdown 的引用文件选择器（`center/views/richtext/file-picker.tsx`）。
   * 它看不见左栏页签，按需取数可能把它饿成空列表 ⇒ 它一挂载就拨 `请求文件清单()`。
   * 这里直接拨那一枚——测的是**那条缝**，不是选择器的长相。
   */
  test("组件外有人要清单 ⇒ 拨一下就把清单取来（哪怕停「会话」页签）", async () => {
    const { data, 记 } = 假数据源({ files: async () => ["资料/话单.csv"] })
    const host = 挂(data)
    await 冲一遍()

    host.querySelector<HTMLElement>("[data-slot='sidebar-tab'][data-tab='session']")?.click()
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()
    expect(记.files).toEqual([])

    请求文件清单()
    await 冲一遍()

    expect(记.files).toEqual(["p1"])
  })

  test("同一项目来回切页签 ⇒ 不重复取清单（已经取到的那份不会因为看了一眼会话就过期）", async () => {
    const { data, 记 } = 假数据源({ files: async () => ["资料/话单.csv"] })
    const host = 挂(data)

    setCurrentProject({ id: "p1", name: "甲" })
    await 冲一遍()
    expect(记.files).toEqual(["p1"])

    host.querySelector<HTMLElement>("[data-slot='sidebar-tab'][data-tab='session']")?.click()
    await 冲一遍()
    host.querySelector<HTMLElement>("[data-slot='sidebar-tab'][data-tab='files']")?.click()
    await 冲一遍()

    expect(记.files).toEqual(["p1"])
  })

  /**
   * 一条最小的 `ProjectEnablement` 替身——本组只读 `enabled` / `enabledCount` / `skills` / `error`。
   *
   * ⚠️ `skills` 留空**不是**「夹具忘了填」：`undefined` 是一个合法状态（从没读到 / 换过项目），
   * 与 `[]`（明确一条都没有）是两件事，这一组分得开正是靠它（`#002-02`）。
   */
  function 假启用(选项: {
    enabled?: readonly string[]
    enabledCount?: number
    skills?: readonly 内核技能[]
    error?: string
    /** 默认按「清单到了就算读完了」：本组夹具里 `skills` 有值都表示一次成功的读。 */
    readDone?: boolean
    toggle?: (assetId: string) => void
    reload?: () => void
  } = {}): ProjectEnablement {
    const 集合 = new Set(选项.enabled ?? [])
    return {
      projectId: () => "p1",
      enabled: () => 集合,
      enabledCount: () => 选项.enabledCount ?? 集合.size,
      limit: () => 20,
      error: () => 选项.error,
      busy: () => undefined,
      skills: () => 选项.skills,
      readDone: () => 选项.readDone ?? 选项.skills !== undefined,
      bind: () => {},
      toggle: (assetId) => 选项.toggle?.(assetId),
      reload: () => 选项.reload?.(),
    }
  }

  /**
   * Task 6：能力面板要**真的挂进左栏**。
   *
   * Task 4 的面板与 Task 5 的 tab 各有自己的组件测试，但「这两根线接上了没有」只有这一层
   * 看得见——同 T019 立下的规矩：组件绿 ≠ 接线绿。判据落在 `[data-pane='capability']` 里找
   * 技能组头，而不是断言 `SidebarTabs` 收到了某个 prop：prop 传对了、面板没渲染出来时，
   * 前者仍然红，后者会假绿。
   */
  test("切到「能力」⇒ pane 里挂的是真面板（技能组头在），不是占位空片段", () => {
    const host = mount(() => (
      <WorkspaceEntry enablement={假启用({ enabled: ["a"], skills: [] })}>中栏</WorkspaceEntry>
    ))
    setCurrentProject({ id: "p1", name: "甲" })

    侧栏tab(host, "capability")?.click()

    const 技能组头 = tabpane(host, "capability")?.querySelector("[data-slot='capability-group-skill']")
    // 断**布尔**，不拿节点去 `toBeTruthy`（`#009-01`：bun 会序列化被 Solid 渲染过的 DOM，
    // 环形引用一路涨到十几 GB，看着像挂死）。
    expect(Boolean(技能组头)).toBe(true)
  })

  test("读到清单且启用两个 ⇒ tab 上写「能力 2」，面板里两条也都加载到了", () => {
    const 启用 = 假启用({
      enabled: ["a", "b"],
      enabledCount: 2,
      skills: [
        { name: "资金分析", assetId: "a", assetName: "资金分析", location: "/skills/资金分析" },
        { name: "话单分析", assetId: "b", assetName: "话单分析", location: "/skills/话单分析" },
      ],
    })
    const host = mount(() => <WorkspaceEntry enablement={启用}>中栏</WorkspaceEntry>)
    setCurrentProject({ id: "p1", name: "甲" })

    expect(侧栏tab(host, "capability")?.textContent).toBe("能力 2")
    // 数字只是「库侧数了 2 个」；这半条才证明**清单也真的进了面板**（两条都 `loaded`）。
    // 少了它，把面板的 `skills` 焊死成 `undefined` 时这条用例仍然绿——数字走的是另一条 prop。
    expect(tabpane(host, "capability")?.querySelectorAll("[data-slot='capability-item-loaded']").length).toBe(2)
  })

  test("清单还没读到 ⇒ tab 只写「能力」，不把「不知道」画成「0」（启用集合非空也不行）", () => {
    const host = mount(() => (
      <WorkspaceEntry enablement={假启用({ enabled: ["a"] })}>中栏</WorkspaceEntry>
    ))

    expect(侧栏tab(host, "capability")?.textContent).toBe("能力")
  })

  /**
   * `skills()` 的 `undefined` 必须**原样**穿到面板里（`#002-02`）。
   *
   * 这条钉的是接线缝上最省事的那种「改错仍全绿」：把 `skills={() => …?.skills()}`
   * 写成 `… ?? []`，面板收到的就从「不知道」变成「明确没有」，于是 `正在读取…` 被换成
   * 「这个项目还没有装任何技能。」——替后端回答了它还没回答的问题。
   *
   * 为什么前三条抓不到它：(c) 只断 tab 数字，而数字走的是 `capabilityCount` 另一条 prop；
   * (a)(b) 用的都是 `skills` **有值**的状态。故判据只能落在 pane 的**文案**上。
   * 两句都去 `capability-panel.tsx` 里抄，不自己编。
   */
  test("「能力」pane：skills() 为 undefined ⇒ 说「正在读取…」，不画成「这个项目还没有装任何技能」", () => {
    // 启用集合留空是**有意的**：`?? []` 那种改法只在「库侧也空」时才会把它画成
    // 「这个项目还没有装任何技能。」——正是这句要抓的形状（启用非空时它会画成另一句
    // 「已启用但没加载到」，同样错、但不是本条钉的那个）。
    const host = mount(() => <WorkspaceEntry enablement={假启用()}>中栏</WorkspaceEntry>)
    setCurrentProject({ id: "p1", name: "甲" })

    const 文本 = tabpane(host, "capability")?.textContent ?? ""
    expect(文本).toContain("正在读取…")
    expect(文本).not.toContain("这个项目还没有装任何技能")
  })

  /**
   * **这条缝是活的**：`skills` 从 `undefined` 变成数组时，pane 要跟着换（终审 I4）。
   *
   * 上一组夹具的 `skills` 是常量访问器，它结构上表达不了「数据到了」——面板即使永远不重绘，
   * 那一组也全绿（C1 就是从这条缝里溜过去的）。这里把信号本身当访问器递进去：先断
   * 「还没到」的形状，再改信号、断同一个 pane 变了。
   */
  test("「能力」pane：接线是响应式的——skills 从 undefined 变数组，「正在读取…」当场消失", () => {
    const [清单, 设清单] = createSignal<readonly 内核技能[] | undefined>(undefined)
    // 启用集合非空：这样「到了」之后画的是 `loaded`（库内已加载）而不是「本项目自带」——
    // 两者的 data-slot 不同，断错了一个就分不出是「清单进来了」还是「清单还是空的」。
    const 启用: ProjectEnablement = { ...假启用({ enabled: ["a"] }), skills: 清单 }
    const host = mount(() => <WorkspaceEntry enablement={启用}>中栏</WorkspaceEntry>)
    setCurrentProject({ id: "p1", name: "甲" })

    const 能力页 = tabpane(host, "capability")
    expect(能力页?.textContent ?? "").toContain("正在读取…")

    设清单([{ name: "资金分析", assetId: "a", assetName: "资金分析", location: "/skills/资金分析" }])

    expect(能力页?.textContent ?? "").not.toContain("正在读取…")
    expect(能力页?.querySelectorAll("[data-slot='capability-item-loaded']").length).toBe(1)
  })

  /**
   * `error()` 这条缝也必须真的落到面板上。
   *
   * 改错形态：接成恒 `undefined` ⇒ 面板永远走不到失败态（`capability-retry` 永不出现），
   * 而其余用例全绿——它们的 `error()` 都是 `undefined`，看不出这条线断没断。
   * 失败态按设计 §8 **整块只剩重试**，连技能组头都不该在（旧 `skills` 还在时照画会把
   * 已装技能误判成「本项目自带」，见 `capability-panel.tsx` 里那段注释）。
   */
  test("「能力」pane：error() 有话说 ⇒ 失败态（重试钮在、技能组头不在）", () => {
    const host = mount(() => (
      <WorkspaceEntry enablement={假启用({ enabled: ["a"], skills: [], error: "网络不通" })}>
        中栏
      </WorkspaceEntry>
    ))
    setCurrentProject({ id: "p1", name: "甲" })

    const 能力页 = tabpane(host, "capability")
    // 前置：pane 本身在。少了它，下面「组头找不到」在 pane 不存在时也成立。
    expect(Boolean(能力页)).toBe(true)
    expect(Boolean(能力页?.querySelector("[data-slot='capability-retry']"))).toBe(true)
    expect(能力页?.querySelectorAll("[data-slot='capability-group-skill']").length).toBe(0)
  })

  /**
   * `readDone()` 这条缝同样要真的落到面板上（终审 I2）。
   *
   * 接成恒 `false`（或干脆不接）⇒「读完了但没读到」永远画成「正在读取…」，重试钮永不出现，
   * 而其余用例全绿——它们的 `skills` 都有值，走不到这一态。
   */
  test("「能力」pane：readDone() 为真而 skills 仍缺席 ⇒ 重试视图（不是「正在读取…」）", () => {
    const host = mount(() => <WorkspaceEntry enablement={假启用({ readDone: true })}>中栏</WorkspaceEntry>)
    setCurrentProject({ id: "p1", name: "甲" })

    const 能力页 = tabpane(host, "capability")
    expect(Boolean(能力页?.querySelector("[data-slot='capability-retry']"))).toBe(true)
    expect(能力页?.textContent ?? "").not.toContain("正在读取")
  })

  /**
   * 终审 I5：`onToggle` / `onRetry` / `enabledCount` 这三根线也要有钉子。
   *
   * 此前只钉了「面板挂进来了」与「正反两态的文案」——把 `onToggle` 接成空函数、
   * `onRetry` 接成 `() => {}`、`enabledCount` 接成 `enabled().size`，全部仍然绿。
   * 判据落在**面板喊出去的东西**上，不是「prop 传了没有」。
   */
  test("「能力」pane：点停用 ⇒ toggle 收到 assetId", () => {
    const 收到: string[] = []
    const host = mount(() => (
      <WorkspaceEntry
        enablement={假启用({
          enabled: ["a"],
          skills: [{ name: "资金分析", assetId: "a", assetName: "资金分析", location: "/skills/资金分析" }],
          toggle: (assetId) => 收到.push(assetId),
        })}
      >
        中栏
      </WorkspaceEntry>
    ))
    setCurrentProject({ id: "p1", name: "甲" })

    侧栏tab(host, "capability")?.click()
    tabpane(host, "capability")?.querySelector<HTMLButtonElement>("[data-slot='capability-disable']")?.click()

    expect(收到).toEqual(["a"])
  })

  test("「能力」pane：失败态点重试 ⇒ reload 被调", () => {
    let 次数 = 0
    const host = mount(() => (
      <WorkspaceEntry enablement={假启用({ enabled: ["a"], skills: [], error: "网络不通", reload: () => (次数 += 1) })}>
        中栏
      </WorkspaceEntry>
    ))
    setCurrentProject({ id: "p1", name: "甲" })

    侧栏tab(host, "capability")?.click()
    tabpane(host, "capability")?.querySelector<HTMLButtonElement>("[data-slot='capability-retry']")?.click()

    expect(次数).toBe(1)
  })

  test("「能力」pane：enabledCount 是项目真相（4/1）⇒ 出现「其中 3 个不在你的授权范围」", () => {
    const host = mount(() => (
      <WorkspaceEntry
        enablement={假启用({
          enabled: ["a"],
          enabledCount: 4,
          skills: [{ name: "资金分析", assetId: "a", assetName: "资金分析", location: "/skills/资金分析" }],
        })}
      >
        中栏
      </WorkspaceEntry>
    ))
    setCurrentProject({ id: "p1", name: "甲" })

    const 说明 = tabpane(host, "capability")?.querySelector("[data-slot='capability-out-of-scope']")
    expect(说明?.textContent ?? "").toContain("项目共启用 4 个，其中 3 个不在你的授权范围")
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
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("乙/话单.csv")

    // 甲的文件现在才回来。
    放甲(["甲/资料.csv"])
    await 冲一遍()

    expect(路径们(host)).toContain("乙/话单.csv")
    expect(路径们(host)).not.toContain("甲/资料.csv")
  })

  /**
   * ── 清单**取不到**（2026-10-11 用户实报）─────────────────────────────────
   *
   * ## 现场
   *
   * 用户报「只有一个项目时，新建会话图标与会话列表都不显示」；F12 里 `GET /openhive/project`
   * 是 500（挂具的 PGlite 撞 `42P05`，见 `LEARNINGS #005-02`——那条是夹具伪影，生产走多连接池
   * 撞不到）。但那条 500 撞出一件**真的产品行为**：
   *
   * `拉清单` 拿到 `undefined` 时**不写缝、不报错、也不重试**（`openhive-project.ts` 的
   * `listProjects` 三态里的「取不到」那一态就此消失），于是 `projectList()` 永久停在 `undefined`
   * ——左栏会话 tab 一体空白（那里要 `/session?directory=…`，而目录正是从清单推出来的），
   * 项目面板说「还没有项目」。民警能拿到的两个读数**都是假的、且都不会再变**。
   *
   * ## 判据为什么必须落在这一层
   *
   * 出错的一线是**接线**：清单怎么进缝只有 `拉清单` 一处，而它同时被进门、建完、归档、找回
   * 四个出口调用（`LEARNINGS #004-01`）。面板那一侧只认「有没有话要说、能不能再来一次」
   * （组件测试钉三态各画什么），「失败长什么样」到不到得了面板，桩看不见（同 `#006-18` 的分工）。
   */
  test("清单取不到 ⇒ 缝里记下这件事，面板说一句话 ＋ 一颗重试钮，**不**说假话「还没有项目」", async () => {
    const { data } = 假数据源({ list: async () => undefined })
    const host = 挂(data)
    await 冲一遍()

    expect(projectListFailed()).toBe(true)

    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(text(host, "project-panel-load-failed")).toBe("项目清单没取到")
    // 判「钮在不在」用**布尔**，不拿节点去 `toBeTruthy`（`LEARNINGS #005-01`：实得值是节点会挂哑）。
    expect(不存在(host, "[data-slot='project-panel-retry']")).toBe(false)
    // 这一半才是缺陷本身：清单是 `undefined`，没有这条改动时这里画的是「还没有项目」。
    expect(text(host, "project-panel-empty")).toBeUndefined()
  })

  test("点重试 ⇒ 真的再拉一次清单；这次成了 ⇒ 那句话收起来、项目行出现（缝也翻回来）", async () => {
    let 通了 = false
    const { data, 记 } = 假数据源({ list: async () => (通了 ? [私有("p1", "8·17专案", 1)] : undefined) })
    const host = 挂(data)
    await 冲一遍()
    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(text(host, "project-panel-load-failed")).toBe("项目清单没取到")

    通了 = true
    锚点按钮(host, "project-panel-retry")?.click()
    await 冲一遍()

    // 「真的再拉一次」与「只把提示抹掉」是两条独立判据（`注`：`记.list` 是前者的唯一证据）。
    expect(记.list).toBe(2)
    expect(projectListFailed()).toBe(false)
    expect(text(host, "project-item-name")).toBe("8·17专案")
    expect(text(host, "project-panel-load-failed")).toBeUndefined()
  })

  test("点重试之后、回话之前 ⇒ 那句「取不到」先收起来（「还没问回来」不是「取不到」）", async () => {
    // ⚠️ 两态在界面上**正好相反**：前者什么都不该说，后者要说一句话。留着上一句不撤，
    // 「重试了、界面毫无反应」这句话就变成假话的反面——界面在说「上一次没问到」，而问话正在路上。
    let 第几次 = 0
    let 放行: ((v: readonly ProjectEntry[] | undefined) => void) | undefined
    const { data } = 假数据源({
      list: () => {
        第几次 += 1
        if (第几次 === 1) return Promise.resolve(undefined)
        return new Promise((resolve) => {
          放行 = resolve
        })
      },
    })
    const host = 挂(data)
    await 冲一遍()
    锚点按钮(host, "project-anchor-toggle")?.click()
    expect(text(host, "project-panel-load-failed")).toBe("项目清单没取到")

    锚点按钮(host, "project-panel-retry")?.click()
    await 冲一遍()

    expect(text(host, "project-panel-load-failed")).toBeUndefined()

    // 前置：上面那一句的缺席，必须真是「在途」而不是「压根没发第二次」——第二次请求已经出发
    // （`第几次` 到 2）而回话还没来，才是这一条要说的那个中间态。
    expect(第几次).toBe(2)

    放行?.(undefined)
    await 冲一遍()

    expect(text(host, "project-panel-load-failed")).toBe("项目清单没取到")
  })
})

/** 面板里某个 tab 的页签（`data-tab` 是身份）。 */
const 面板页签 = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='project-panel-tab'][data-tab='${id}']`)

/** 面板**最底下**那句失败文案——归档与找回共用一格（`project-panel.tsx` 的 `没办成`）。 */
const 面板报错 = (host: HTMLElement) => text(host, "project-panel-action-error")

/**
 * 弹窗里那一颗键——**在 `document.body` 上找，不在 host 里**。
 *
 * 弹窗是 `dialog.show()` **传送进 `document.body`** 的（`context/dialog.tsx` 的 `Kobalte.Portal`），
 * 整个不在工作台那棵树里。照 host 选会选到 `null`，而 `?.click()` **不报错**——那这条用例就变成
 * 「点了一个不存在的东西」还全绿（`LEARNINGS #005-19` 的「开在谁身上」）。
 */
const 弹窗键 = (slot: string) => document.body.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * 点弹窗里那颗确认键（归档 / 找回共用同一个槽位——它们是同一个弹窗）。
 *
 * 打开是**异步**的（`dialog.show()` 里那层 `startTransition` 让它晚一拍落下来），所以先等条件、
 * 再点；等不到就**抛**，不写成 `?.click()`——「弹窗没开出来」必须响，不能静默变成「什么都没点」
 * （`LEARNINGS #005-38`：辅助函数回 `undefined` 会让整条判据空转）。
 */
async function 点弹窗确认(动作: string) {
  await 等到(() => 弹窗键("project-action-ok") !== null)
  const 确认键 = 弹窗键("project-action-ok")
  if (!确认键) throw new Error(`点「${动作}」之后弹窗没开出来：找不到 project-action-ok`)
  确认键.click()
}

/**
 * 走一遍归档：滑出面板 → 「全部」tab → 点那一行的「归档」→ 弹窗里点确认。
 *
 * ⚠️ 三步都要，少一步都不叫「归档过」：**点「归档」不交出去**（T023 的二次确认），
 * 少掉弹窗里那下确认，测的就是「点了个按钮」而不是归档（`#004-14`：一条用例里既钉被测属性
 * 又钉伴随信号时，被测的排前面）。
 */
async function 点归档(host: HTMLElement) {
  锚点按钮(host, "project-anchor-toggle")?.click()
  面板页签(host, "all")?.click()
  host.querySelector<HTMLButtonElement>("[data-slot='project-archive']")?.click()
  await 点弹窗确认("归档")
}

/**
 * 走一遍找回：「已归档」tab → 点那一行的「找回」→ 弹窗里点确认。
 *
 * ⚠️ 2026-10-11 起找回**也要问一句**了（用户下达：「通过弹窗进行交互，让用户选择『找回』、
 * 『取消』」）——这条注释原先写着「找回没有二次确认」，那句话已经过期。
 */
async function 点找回(host: HTMLElement) {
  锚点按钮(host, "project-anchor-toggle")?.click()
  面板页签(host, "archived")?.click()
  host.querySelector<HTMLButtonElement>("[data-slot='project-restore']")?.click()
  await 点弹窗确认("找回")
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

    await 点归档(host)
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

    await 点归档(host)
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
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("甲/资料.csv")

    await 点归档(host)
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

    await 点归档(host)
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

    await 点归档(host)
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

    await 点归档(host)
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

    await 点找回(host)
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

    await 点找回(host)
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
    await 点找回(host)
    await 冲一遍()

    expect(text(host, "project-anchor-name")).toBe("9·03专案")
  })
})

/**
 * 改名 / 删除接进工作台（2026-10-16 修复轮 1）。
 *
 * 归档 / 找回那一节验的是「办成之后做什么」；这一节验的是**改名这条链上的另一半**——
 * 改名**当前项目**之后，锚点行（读 `currentProject()?.name`）也要跟着变新名。
 *
 * 根因（评审 Important）：`拉清单` 只写 `projectList` / `projectListFailed`，**从不写
 * `currentProject`**；唯一「按清单回灌 currentProject」的机制是 `还原启动项目`，它只被
 * `拉清单并还原` 调用。改名当前项目后若只 `拉清单`，面板显示新名、锚点行永久停在旧名。
 */
describe("改名 / 删除接进工作台（2026-10-16 修复轮 1）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectFiles(undefined)
  })

  test("改名当前项目 ⇒ 锚点行跟着变新名（不靠整页刷新）", async () => {
    let 清单: readonly ProjectEntry[] = [我的(私有("p1", "8·17专案", 1))]
    const { data, 记 } = 假数据源({
      list: async () => 清单,
      // 改名成功：把清单换成**新名**的行，再回 `done`——「还原」要从这份新清单里重导当前项目。
      rename: async () => {
        清单 = [我的(私有("p1", "8·17专案（改）", 2))]
        return { kind: "done" }
      },
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()

    // 前置（`#002-02`）：先证明它挂上去过——否则「变了」在压根没接线时无从谈起。
    expect(text(host, "project-anchor-name")).toBe("8·17专案")

    锚点按钮(host, "project-anchor-toggle")?.click()
    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 项目菜单项("rename") !== null)
    await 冲刷()
    指(项目菜单项("rename"))
    await 冲刷()
    const 框 = 改名框(host)
    if (!框) throw new Error("改名框不在——前提不成立")
    打字(框, "8·17专案（改）")
    框.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await 冲一遍()

    // 被测属性在前（`#004-14`）：既钉「交给了数据源」，也钉「锚点行跟着变」。
    expect(记.改名的项目).toEqual([["p1", "8·17专案（改）"]])
    expect(text(host, "project-anchor-name")).toBe("8·17专案（改）")
  })

  /**
   * 删除**当前项目** ⇒ 锚点变「未选择项目」（关闭变异 ② 的缺口：`onDelete` 里那句
   * `setCurrentProject(undefined)` 此前没有任何组件用例钉住）。
   */
  test("删除当前项目 ⇒ 锚点变「未选择项目」（不可恢复，清了才回得来）", async () => {
    const { data, 记 } = 假数据源({
      list: async () => [我的(私有("p1", "8·17专案", 1))],
      deleteProject: async () => ({ kind: "done" }),
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()

    // 前置（`#002-02`）：先证明它挂上去过。
    expect(text(host, "project-anchor-name")).toBe("8·17专案")

    锚点按钮(host, "project-anchor-toggle")?.click()
    指(行菜单钮(host, "8·17专案"))
    await 等到(() => 项目菜单项("delete") !== null)
    await 冲刷()
    指(项目菜单项("delete"))
    await 点弹窗确认("删除")
    await 冲一遍()

    expect(记.删的项目).toEqual(["p1"])
    expect(text(host, "project-anchor-name")).toBe("未选择项目")
  })
})

/**
 * 右键菜单在**传送门**里（Kobalte 的 `ContextMenu.Portal` 把内容挂到 `document.body`），
 * 所以这一节的菜单探针一律查 `document`，不是 `host`——同 `file-tree.test.tsx` 那几条。
 */
const 菜单项 = (action: string) =>
  document.querySelector<HTMLElement>(`[data-component='context-menu-content'] [data-action='${action}']`)

/**
 * 右键树里某一行（按名字找：同层顺序随 locale 变，见 `file-tree-v2-model` 那条注释）。
 * 「哪一行叫这个名字」只在 `找行` 里写一遍——两处各写一份，迟早只改一处（`#002-06`）。
 */
function 右键行(host: HTMLElement, name: string) {
  找行(host, name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
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

/** 那台隐藏的**文件夹**选择器：与文件选择器是两台（`webkitdirectory`），按 `data-slot` 找。 */
const 文件夹选择器 = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>("input[data-slot='file-op-folder-input']")

/** 让一个 `File` 带上浏览器给的相对路径（happy-dom 的 `File` 没有这个字段）。 */
function 带相对路径(name: string, 相对: string): File {
  const file = new File(["甲"], name)
  Object.defineProperty(file, "webkitRelativePath", { value: 相对 })
  return file
}

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
    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host)).toContain("资料/话单.csv")

    右键行(host, "话单.csv")
    点菜单项("copy")
    目标按钮(host, "档案")?.click()
    await 冲一遍()

    expect(假.files.length).toBe(搬前 + 1)
  })

  /**
   * `开()` ＋ **全展开**：本节新用例一律用它。
   *
   * ⚠️ 树默认全收缩（用户第 5 条）⇒ 不展开的话 `资料/话单.csv` 这一行压根不在树上，
   * `行按路径` 会**抛**（那正是它的用处，`#005-38`）。**不许靠静默兜底蒙过去。**
   */
  async function 开全(剧本: Parameters<typeof 假数据源>[0] = {}) {
    const r = await 开(剧本)
    全展开(r.host)
    return r
  }

  /** 同 Task 3 的辅助：happy-dom 没有 `DragEvent` ⇒ 裸 `Event` 顶着派。 */
  function 同树拖(el: HTMLElement | null | undefined, type: "dragstart" | "dragover" | "drop" | "dragend") {
    if (!el) throw new Error("拖拽落点不在——这条用例的前提不成立（`#004-14`）")
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
  }

  /**
   * 按**路径**取树里的一行。找不到就**抛**。
   *
   * ⚠️ 名字**不能**叫 `树行`——`:660` 那个 `树行` 是**同名的数组版**（`(host) => ...[]`），
   * 覆盖它会把整个文件里十余处既有调用一起改掉。也别用 `找行`（那个按**名字**找，
   * 而名字在同一棵树里可能重名）。
   */
  const 行按路径 = (host: HTMLElement, path: string) => {
    const 找到 = 树行(host).find((el) => el.getAttribute("data-path") === path)
    if (!找到) throw new Error(`树里没有 ${path} 这一行——这条用例的前提不成立（#004-14）`)
    return 找到
  }

  /** 点树里某一行，带修饰键（`.click()` 交不出 ctrlKey / shiftKey）。 */
  const 点树行 = (host: HTMLElement, path: string, 修饰: { ctrl?: boolean } = {}) => {
    行按路径(host, path).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: 修饰.ctrl === true }),
    )
  }

  /** 从某一行拖到某一行松手。 */
  const 拖某行 = (host: HTMLElement, 起: string, 落: string) => {
    同树拖(行按路径(host, 起), "dragstart")
    同树拖(行按路径(host, 落), "dragover")
    同树拖(行按路径(host, 落), "drop")
    同树拖(行按路径(host, 起), "dragend")
  }

  /**
   * 报告弹窗在不在。
   *
   * ⚠️ **它传送到 `document.body`，不在 `host` 里** ⇒ 不能用既有的 `不存在(host, …)`
   * （那个查的是 `root`，恒 `true` —— 一条**恒绿空转**的判据，`#005-47` 的形状）。
   * 返回**布尔**（`#005-01`：节点喂给 `expect` 红了会把整轮 `bun test` 挂死）。
   */
  const 有报告弹窗 = () => document.querySelector("[data-slot='file-move-report-dialog']") !== null

  /** 弹窗里那两段列表的文字（弹窗传送到 `document.body`）。 */
  const 报告文字 = () => document.body.textContent ?? ""

  test("拖两行到一个文件夹 ⇒ 发了 2 次 move，参数逐条对得上", async () => {
    const { host, 假 } = await 开全({
      files: async () => ["资料/话单.csv", "资料/旧件.csv", "档案/占位.txt"],
      move: async (_id, path, dir) => ({ kind: "done", path: `${dir}/${path.split("/").pop()}` }),
    })

    点树行(host, "资料/话单.csv")
    点树行(host, "资料/旧件.csv", { ctrl: true })
    拖某行(host, "资料/话单.csv", "档案")
    await 冲一遍()

    expect(假.移动的).toEqual([
      ["p1", "资料/话单.csv", "档案"],
      ["p1", "资料/旧件.csv", "档案"],
    ])
  })

  test("全部成功 ⇒ 没有弹窗，且清单被重取一次", async () => {
    const { host, 假 } = await 开全({
      files: async () => ["资料/话单.csv", "档案/占位.txt"],
      move: async () => ({ kind: "done", path: "档案/话单.csv" }),
    })
    const 搬前 = 假.files.length

    拖某行(host, "资料/话单.csv", "档案")
    await 冲一遍()

    expect(有报告弹窗()).toBe(false)
    expect(假.files.length).toBe(搬前 + 1)
  })

  test("一个成一个没成 ⇒ 弹窗同时列出两边", async () => {
    const { host, 假 } = await 开全({
      files: async () => ["资料/话单.csv", "资料/旧件.csv", "档案/占位.txt"],
      move: async (_id, path) =>
        path.endsWith("话单.csv") ? { kind: "done", path: "档案/话单.csv" } : { kind: "rejected", message: "目标已存在同名文件" },
    })
    const 搬前 = 假.files.length

    点树行(host, "资料/话单.csv")
    点树行(host, "资料/旧件.csv", { ctrl: true })
    拖某行(host, "资料/话单.csv", "档案")
    await 冲一遍()

    expect(有报告弹窗()).toBe(true)
    expect(报告文字()).toContain("资料/旧件.csv")
    expect(报告文字()).toContain("目标已存在同名文件")
    expect(报告文字()).toContain("档案/话单.csv")
    expect(假.files.length, "部分成功也要重取清单——盘上真变了").toBe(搬前 + 1)
  })

  test("全都没成 ⇒ 弹窗出现，且清单没被重取", async () => {
    const { host, 假 } = await 开全({
      move: async () => ({ kind: "rejected", message: "目标已存在同名文件" }),
    })
    const 搬前 = 假.files.length

    拖某行(host, "资料/话单.csv", "档案")
    await 冲一遍()

    expect(有报告弹窗()).toBe(true)
    expect(假.files.length).toBe(搬前)
  })

  test("弹窗关掉之后再拖一次 ⇒ 弹窗重新出现", async () => {
    const { host } = await 开全({ move: async () => ({ kind: "rejected", message: "目标已存在同名文件" }) })

    拖某行(host, "资料/话单.csv", "档案")
    await 冲一遍()
    document.body.querySelector<HTMLElement>("[data-slot='file-move-report-close']")!.click()
    await 冲一遍()

    // F1（最终评审 #1）：`dialog.close()` 是**两步**——状态立刻变、节点 100ms 后才 `dispose`
    // （`context/dialog.tsx:57`）。只 `await 冲一遍()` 等不到它，旧弹窗的节点还挂在 `document.body`
    // 里 ⇒ `有报告弹窗()` 恒 true，这条判据**空转**（拖② 开没开新弹窗都回 true）。把「旧弹窗真的
    // 消失了」变成可等的条件并断成前提（等条件不等时间，`#006-31`）。
    await 等到(() => !有报告弹窗())
    expect(有报告弹窗(), "前提：这一步真的把旧弹窗关掉了").toBe(false)

    拖某行(host, "资料/话单.csv", "档案")
    await 冲一遍()

    expect(有报告弹窗()).toBe(true)
  })

  test("移动进行中再发起一次 ⇒ 第二次一个请求都不发", async () => {
    let 放行: (() => void) | undefined
    const { host, 假 } = await 开全({
      move: async () => {
        await new Promise<void>((resolve) => (放行 = resolve))
        return { kind: "done", path: "档案/话单.csv" }
      },
    })

    拖某行(host, "资料/话单.csv", "档案")   // 挂在 await 上，`搬忙` 还没落回
    拖某行(host, "资料/话单.csv", "档案")   // 第二次
    放行?.()
    await 冲一遍()

    expect(假.移动的.length).toBe(1)
  })

  /** 被拒（目标已存在之类）⇒ 报告弹窗里出现服务端那句话，**且不重取**——什么都没变，重取是空跑。 */
  test("被拒 ⇒ 弹窗里出现服务端那句话，且不重取清单", async () => {
    const { host, 假 } = await 开全({ copy: async () => ({ kind: "rejected", message: "目标已存在同名文件" }) })
    const 搬前 = 假.files.length

    右键行(host, "话单.csv")
    点菜单项("copy")
    目标按钮(host, "档案")?.click()
    await 冲一遍()

    expect(有报告弹窗()).toBe(true)
    expect(document.body.textContent ?? "").toContain("目标已存在同名文件")
    // 反面断言**继续留着**：盘上没变，清单就不该重取
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
   * 上传文件夹（2026-10-24 用户下达：右键上传只能选文件，不能选文件夹）。
   *
   * 判据分三截，缺一不可：
   * ① 打开的是**另一台** `webkitdirectory` 选择器；
   * ② 服务端不递归建目录 ⇒ 相对路径里的子目录**先建、浅的在前**；
   * ③ 每个文件按相对路径落到各自目录（不是全塞进落点）。
   */
  test("点「上传文件夹」⇒ 打开目录选择器；按相对路径先建目录、再逐个上传", async () => {
    const { host, 假 } = await 开({
      createEntry: async () => ({ kind: "done", path: "" }),
      upload: async (_id, _dir, file) => ({ kind: "done", path: file.name }),
    })
    const 器 = 文件夹选择器(host)
    if (!器) throw new Error("文件夹选择器不在——这条用例的前提不成立")
    expect(器.hasAttribute("webkitdirectory")).toBe(true)
    let 打开了 = 0
    器.addEventListener("click", () => (打开了 += 1))

    右键行(host, "资料") // 右键一个**目录** ⇒ 传到它自己
    点菜单项("upload-folder")

    expect(打开了).toBe(1)

    Object.defineProperty(器, "files", {
      value: [带相对路径("账单.xlsx", "卷宗/账单.xlsx"), 带相对路径("说明.docx", "卷宗/附件/说明.docx")],
    })
    器.dispatchEvent(new Event("change", { bubbles: true }))
    await 等到(() => 假.传的.length === 2)

    // 浅的在前：父目录必须先存在（服务端 create 不递归）
    expect(假.建的条目).toEqual([
      ["p1", "directory", "资料", "卷宗"],
      ["p1", "directory", "资料/卷宗", "附件"],
    ])
    expect(假.传的).toEqual([
      ["p1", "资料/卷宗", "账单.xlsx"],
      ["p1", "资料/卷宗/附件", "说明.docx"],
    ])
  })

  test("上传文件夹：清单里已有的子目录不再新建（重复上传同一文件夹不该被「已有同名」挡住）", async () => {
    const { host, 假 } = await 开({
      // 「资料/卷宗」由这一条子路径带出来 —— 它已经存在
      files: async () => ["资料/卷宗/旧件.pdf"],
      createEntry: async () => ({ kind: "done", path: "" }),
      upload: async (_id, _dir, file) => ({ kind: "done", path: file.name }),
    })
    const 器 = 文件夹选择器(host)
    if (!器) throw new Error("文件夹选择器不在——这条用例的前提不成立")

    右键行(host, "资料")
    点菜单项("upload-folder")

    Object.defineProperty(器, "files", { value: [带相对路径("账单.xlsx", "卷宗/账单.xlsx")] })
    器.dispatchEvent(new Event("change", { bubbles: true }))
    await 等到(() => 假.传的.length === 1)

    expect(假.建的条目).toEqual([])
    expect(假.传的).toEqual([["p1", "资料/卷宗", "账单.xlsx"]])
  })

  test("上传文件夹：取不到文件清单 ⇒ 留一句话，一个请求都不发", async () => {
    const { host, 假 } = await 开({
      files: async () => undefined,
      createEntry: async () => ({ kind: "done", path: "" }),
      upload: async () => ({ kind: "done", path: "" }),
    })
    const 器 = 文件夹选择器(host)
    if (!器) throw new Error("文件夹选择器不在——这条用例的前提不成立")

    // 清单取不到 ⇒ 树是空的，右键空白处（落点＝根）；这条判的是「没清单就不动手」
    const 区域 = host.querySelector<HTMLElement>("[data-slot='file-tree-region']")
    if (!区域) throw new Error("文件树区域不在——这条用例的前提不成立")
    区域.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    点菜单项("upload-folder")

    Object.defineProperty(器, "files", { value: [带相对路径("账单.xlsx", "卷宗/账单.xlsx")] })
    器.dispatchEvent(new Event("change", { bubbles: true }))
    await 等到(() => 文本在页("file-op-message").includes("取不到文件清单"))

    expect(假.建的条目).toEqual([])
    expect(假.传的).toEqual([])
  })

  test("上传文件夹：空文件夹（浏览器一个文件都不给）⇒ 留一句话，一个请求都不发", async () => {
    const { host, 假 } = await 开({
      createEntry: async () => ({ kind: "done", path: "" }),
      upload: async () => ({ kind: "done", path: "" }),
    })
    const 器 = 文件夹选择器(host)
    if (!器) throw new Error("文件夹选择器不在——这条用例的前提不成立")

    右键行(host, "资料")
    点菜单项("upload-folder")

    Object.defineProperty(器, "files", { value: [] as File[] })
    器.dispatchEvent(new Event("change", { bubbles: true }))
    await 等到(() => 文本在页("file-op-message").includes("空文件夹"))

    expect(假.建的条目).toEqual([])
    expect(假.传的).toEqual([])
  })

  test("上传文件夹：建目录失败 ⇒ 就地报那句话，一个文件都不上传", async () => {
    const { host, 假 } = await 开({
      createEntry: async () => ({ kind: "rejected", message: "目标位置已经有同名的东西了" }),
      upload: async () => ({ kind: "done", path: "" }),
    })
    const 器 = 文件夹选择器(host)
    if (!器) throw new Error("文件夹选择器不在——这条用例的前提不成立")

    右键行(host, "资料")
    点菜单项("upload-folder")

    Object.defineProperty(器, "files", { value: [带相对路径("账单.xlsx", "卷宗/账单.xlsx")] })
    器.dispatchEvent(new Event("change", { bubbles: true }))
    await 等到(() => 文本在页("file-op-message").includes("建不出文件夹"))

    expect(文本在页("file-op-message")).toContain("资料/卷宗")
    expect(假.传的).toEqual([])
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

  /**
   * 传输弹窗（2026-10-18 用户裁定）。这一组钉的是**接线**：
   * `onProgress` 真的被交到了数据源手里、结果真的落到弹窗上、取消真的中断了那一枪。
   * 弹窗自己的画法在 `file-transfer-dialog.test.tsx` 里钉（那边裸挂在真壳上）。
   */
  test("上传：弹窗显示字节进度；成功后停在「上传完成」，点「关闭」才收", async () => {
    let 放行: (() => void) | undefined
    const { host } = await 开({
      upload: async (_id, _dir, file, options) => {
        options?.onProgress?.({ loaded: 1, total: 4 })
        await new Promise<void>((resolve) => (放行 = resolve))
        return { kind: "done", path: file.name }
      },
    })
    const 落点 = 树行(host).find((el) => el.getAttribute("data-path") === "资料") ?? null

    拖入(落点, [new File(["abcd"], "话单.csv")])
    await 等到(() => 文本在页("file-transfer-percent") === "25%")

    expect(文本在页("file-transfer-title")).toBe("正在上传")
    expect(文本在页("file-transfer-name")).toBe("话单.csv")

    放行?.()
    await 等到(() => 文本在页("file-transfer-title") === "上传完成")

    // 成功**不自动关**（用户裁定）：摘要留在屏幕上，点「关闭」才收。
    expect(页面槽("file-transfer-dialog") !== null).toBe(true)
    expect(文本在页("file-transfer-summary")).toBe("1 个文件 · 4 B")

    页面槽("file-transfer-close")?.click()
    expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
  })

  test("上传中点「取消」⇒ 打断这一枪、关窗、不报错；已经传完的那个留在清单里", async () => {
    let 第二枪: AbortSignal | undefined
    // 起过几枪：取消之后**不许再起下一枪**（第三件还在队列里）。
    const 起过: string[] = []
    const { host, 假 } = await 开({
      upload: async (_id, _dir, file, options) => {
        起过.push(file.name)
        if (file.name !== "乙.csv") return { kind: "done", path: file.name }
        第二枪 = options?.signal
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
        return { kind: "failed", message: "上传文件失败" }
      },
    })
    const 落点 = 树行(host).find((el) => el.getAttribute("data-path") === "资料") ?? null
    const 重取前 = 假.files.length

    拖入(落点, [new File(["a"], "甲.csv"), new File(["b"], "乙.csv"), new File(["c"], "丙.csv")])
    await 等到(() => 第二枪 !== undefined)

    页面槽("file-transfer-cancel")?.click()

    expect(第二枪?.aborted).toBe(true)
    expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
    // 取消不是失败：内联红字一个字都不出现。
    expect(text(host, "file-op-message")).toBeUndefined()
    // 队列里剩下的那个一个字都没发（取消是「停下」，不是「跳过这一个」）。
    expect(起过).toEqual(["甲.csv", "乙.csv"])
    // 已传完的那个要出现在树里——服务端一次一个，中断只作用于正在飞的那一枪。
    await 等到(() => 假.files.length > 重取前)
  })

  test("Esc 与「取消」同一条语义：中断那一枪并关窗", async () => {
    let 信号: AbortSignal | undefined
    const { host } = await 开({
      upload: async (_id, _dir, _file, options) => {
        信号 = options?.signal
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
        return { kind: "failed", message: "上传文件失败" }
      },
    })
    const 落点 = 树行(host).find((el) => el.getAttribute("data-path") === "资料") ?? null

    拖入(落点, [new File(["a"], "话单.csv")])
    await 等到(() => 信号 !== undefined)

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))

    expect(信号?.aborted).toBe(true)
    expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
    expect(text(host, "file-op-message")).toBeUndefined()
  })

  test("上传失败 ⇒ 关窗、落回内联红字（失败不在弹窗里另弹一张脸）", async () => {
    const { host } = await 开({ upload: async () => ({ kind: "rejected", message: "磁盘满了" }) })
    const 落点 = 树行(host).find((el) => el.getAttribute("data-path") === "资料") ?? null

    拖入(落点, [new File(["a"], "话单.csv")])
    await 等到(() => text(host, "file-op-message") !== undefined)

    expect(text(host, "file-op-message")).toContain("磁盘满了")
    expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
  })

  test("下载：弹窗显示字节进度；完成后停在「下载完成」", async () => {
    let 放行: (() => void) | undefined
    const { host } = await 开({
      download: async (_id, _path, options) => {
        options?.onProgress?.({ loaded: 2, total: 8 })
        await new Promise<void>((resolve) => (放行 = resolve))
        return new Blob(["abcd"])
      },
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同上面两条：只替换与还原。
    const 原create = URL.createObjectURL
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同上。
    const 原click = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => "blob:openhive-test"
    HTMLAnchorElement.prototype.click = () => {}
    try {
      右键行(host, "话单.csv")
      点菜单项("download")
      await 等到(() => 文本在页("file-transfer-percent") === "25%")

      expect(文本在页("file-transfer-title")).toBe("正在下载")

      放行?.()
      await 等到(() => 文本在页("file-transfer-title") === "下载完成")
      expect(文本在页("file-transfer-summary")).toBe("1 个文件 · 4 B")
    } finally {
      URL.createObjectURL = 原create
      HTMLAnchorElement.prototype.click = 原click
    }
  })

  test("下载中点「取消」⇒ 中断、不存盘、不报错", async () => {
    let 信号: AbortSignal | undefined
    const { host } = await 开({
      download: async (_id, _path, options) => {
        信号 = options?.signal
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
        return undefined
      },
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原create = URL.createObjectURL
    let 存了 = 0
    URL.createObjectURL = () => {
      存了 += 1
      return "blob:openhive-test"
    }
    try {
      右键行(host, "话单.csv")
      点菜单项("download")
      await 等到(() => 信号 !== undefined)

      页面槽("file-transfer-cancel")?.click()

      expect(信号?.aborted).toBe(true)
      expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
      expect(text(host, "file-op-message")).toBeUndefined()
      expect(存了).toBe(0)
    } finally {
      URL.createObjectURL = 原create
    }
  })

  /**
   * 打包下载（2026-10-20）。
   *
   * 两条判据缺一不可：**交给数据源的是什么**（项目 id / 选中集 / 包名）与**结果怎么落到界面**。
   * 只验后者的话，一个「包名算错、zip 内容也对不上」的实现照样绿。
   */
  test("右键文件夹点「下载」⇒ 打包下载：包名、选中集、落盘与完成摘要都对", async () => {
    const { host, 假 } = await 开({
      downloadArchive: async () => ({
        kind: "done",
        blob: new Blob(["abcd"]),
        files: 2,
        bytes: 4,
      }),
    })
    const 存下来的: Array<{ href: string; download: string }> = []
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 只替换与还原，不调用原函数。
    const 原create = URL.createObjectURL
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同上；`click` 靠 `this`。
    const 原click = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => "blob:openhive-test"
    HTMLAnchorElement.prototype.click = function () {
      存下来的.push({ href: this.href, download: this.download })
    }
    try {
      右键行(host, "资料")
      点菜单项("download")

      // 前置：这一枪真的走到了数据源（否则后面的摘要可能在「没发请求」的实现上也绿）。
      await 等到(() => 假.打包的.length === 1)
      await 等到(() => 文本在页("file-transfer-title") === "下载完成")

      expect(假.打包的).toEqual([["p1", ["资料"], "资料.zip"]])
      expect(存下来的).toEqual([{ href: "blob:openhive-test", download: "资料.zip" }])
      expect(文本在页("file-transfer-summary")).toBe("2 个文件 · 4 B")
    } finally {
      URL.createObjectURL = 原create
      HTMLAnchorElement.prototype.click = 原click
    }
  })

  test("Ctrl 选中两项后右键已选中的行 ⇒ 交出去的是整个选中集，包名是项目名+时间戳", async () => {
    const { host, 假 } = await 开全({
      downloadArchive: async () => ({ kind: "done", blob: new Blob(["a"]), files: 2, bytes: 1 }),
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原create = URL.createObjectURL
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原click = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => "blob:openhive-test"
    HTMLAnchorElement.prototype.click = () => {}
    try {
      // `开全` 已展开整棵树；`点树行` 是本节既有助手（`行按路径` 找不到会抛）。
      点树行(host, "资料/话单.csv")
      点树行(host, "档案/旧件.csv", { ctrl: true })

      右键行(host, "话单.csv")
      expect(菜单项("download")?.textContent?.trim()).toBe("下载选中的 2 项")
      点菜单项("download")

      await 等到(() => 假.打包的.length === 1)
      // 等这一次真的走完（落盘 + 完成态）再收尾：`打包的` 在数据源**入口**就记下了，
      // 抢在续跑之前结束会把一次真实的 `<a>.click()` 漏到后面的用例里（本文件按顺序跑）。
      await 等到(() => 文本在页("file-transfer-title") === "下载完成")
      // `等到` 超时只返回、不抛：不等式断言钉住完成态，回归时这里先红，
      // 而不是让一次真实的 `<a>.click()` 静默漏到后面的用例里。
      expect(文本在页("file-transfer-title")).toBe("下载完成")
      const [项目, 选中集, 名] = 假.打包的[0]
      expect(项目).toBe("p1")
      expect(选中集).toEqual(["资料/话单.csv", "档案/旧件.csv"])
      expect(名).toMatch(/^8·17专案-\d{8}-\d{4}\.zip$/)
    } finally {
      URL.createObjectURL = 原create
      HTMLAnchorElement.prototype.click = 原click
    }
  })

  test("整包被拒 ⇒ 关窗、服务端那句话落到内联红字、一个文件都不落盘", async () => {
    const { host } = await 开({
      downloadArchive: async () => ({
        kind: "rejected",
        message: "「资料/链到密件.txt」不是普通文件或文件夹（链接、设备文件不进包）",
      }),
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原create = URL.createObjectURL
    let 存了 = 0
    URL.createObjectURL = () => {
      存了 += 1
      return "blob:openhive-test"
    }
    try {
      右键行(host, "资料")
      点菜单项("download")
      await 等到(() => text(host, "file-op-message") !== undefined)

      expect(text(host, "file-op-message")).toContain("链到密件.txt")
      expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
      expect(存了).toBe(0)
    } finally {
      URL.createObjectURL = 原create
    }
  })

  test("打包中点「取消」⇒ 中断、不存盘、不报错", async () => {
    let 信号: AbortSignal | undefined
    const { host } = await 开({
      downloadArchive: async (_id, _paths, _name, options) => {
        信号 = options?.signal
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
        return { kind: "failed", message: "打包下载失败" }
      },
    })
    // oxlint-disable-next-line typescript-eslint/unbound-method -- 同前。
    const 原create = URL.createObjectURL
    let 存了 = 0
    URL.createObjectURL = () => {
      存了 += 1
      return "blob:openhive-test"
    }
    try {
      右键行(host, "资料")
      点菜单项("download")
      await 等到(() => 信号 !== undefined)

      页面槽("file-transfer-cancel")?.click()

      expect(信号?.aborted).toBe(true)
      expect(await 等弹窗没("file-transfer-dialog")).toBe(true)
      expect(text(host, "file-op-message")).toBeUndefined()
      expect(存了).toBe(0)
    } finally {
      URL.createObjectURL = 原create
    }
  })
})

/**
 * 点上树（`FileTree`）的「全部展开」——**默认全收缩**之下的还原动作（2026-10-11，用户第 5 条）。
 *
 * ⚠️ 只有**这个文件**需要它：本文件 16 条用例引用的都是深一层的行（`甲/资料.csv`、
 * `乙/话单.csv` 这些）——它们判的是**接线与取数**，一条都不判「默认展开几层」。默认值一翻，
 * 它们的前提就没了（`#006-17`：为被测属性搭的前置条件会随产品改）。
 *
 * ⚠️ **不能**在挂载那一刻点：挂载时清单还没回来、树是空的 ⇒ `节点表` 空 ⇒ 点了等于没点。
 * 必须在**行已经渲染出来之后**点（`找行` 的兜底因此是「找不到才点」，而不是提前点）。
 *
 * ⚠️ **变异记录（据实记，`#003-03` 第 ③ 类）**：把 `file-tree.tsx` 的第 5 条**整份撤回**之后，
 * 本文件 111 条**全绿** ⇒ 这 8 处调用**不是**那个改动的守护者（它们守的是**本文件自己的前提**：
 * 深一层的行要看得见）。**别把这 111 条绿读成「默认全收缩有防护」**——钉它的是
 * `file-tree.test.tsx` 里那 6 条。
 */
const 全展开 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-action='expand-all']")?.click()

/**
 * 点下树（MinIO）的「全部展开」。
 *
 * 下树自 2026-10-18 起**默认全收缩**（用户下达，与上树对齐）⇒ 备份清单里深一层的行
 * （`资料/甲.txt`）挂载时看不见。同 `全展开`：这是补**前提**，不是判据——默认值那件事由
 * `dual-file-tree.test.tsx` 的「下树的展开态」一组守着。
 */
const 全展开下树 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-slot='minio-tree-expand-all']")?.click()

/**
 * 等下树某一行出现。
 *
 * 两个前提叠在一起，所以**不能**写成「先等一下、再点一次展开」：① 备份明细是异步来的；
 * ② 展开集合按路径记，数据还没到时点「全部展开」等于展开一棵空树。把点击放进轮询条件里，
 * 数据一到、下一次轮询就展开得动了。
 */
async function 等到下树行(host: HTMLElement, path: string) {
  const 树行按 = () =>
    host.querySelector<HTMLElement>(
      `[data-tree='minio'] [data-slot='file-tree-row'][data-path='${path}']`,
    )
  await 等到(() => {
    全展开下树(host)
    return 树行按() !== null
  })
}

/** 树里某一行（按名字找）。找不到就**抛**——找不到还往下走，红会落在断言上（`#004-14`）。 */
function 找行(host: HTMLElement, name: string) {
  const 找一遍 = () =>
    树行(host).find((el) => el.querySelector("[data-slot='file-tree-name']")?.textContent?.trim() === name)
  let 行 = 找一遍()
  if (!行) {
    // 兜底：默认全收缩（用户第 5 条）之下，深一层的行挂载时看不见 ⇒ 先全打开，再找一次。
    // 这个兜底**不会掩盖本文件要测的东西**：本文件没有一条用例把「某行看不见」当判据。
    全展开(host)
    行 = 找一遍()
  }
  if (!行) throw new Error(`树里没有「${name}」这一行——这条用例的前提不成立（#004-14）`)
  return 行
}

/**
 * 树上的**内联输入条**（2026-10-11 起只剩重命名那一根——新建已改弹窗，见下方 `弹窗框` 一组）。
 *
 * 与 `file-tree.test.tsx` 里的同名辅助**刻意各写一份**：`LEARNINGS #004-11` —— 每个测试文件有
 * 自己的全局域，夹具不跨文件共享；跨文件 import 一个测试辅助反而会让两处的改动互相绊住。
 */
const 输入条 = (host: HTMLElement, slot: string) => {
  const el = host.querySelector<HTMLInputElement>(`[data-slot='${slot}']`)
  if (!el) throw new Error(`输入条 ${slot} 不在——这条用例的前提不成立（#004-14）`)
  return el
}

/** 往输入条里打字（`InlineInput` 的 `onInput` 读 `event.currentTarget.value`，先落值再派事件）。 */
const 条里打字 = (host: HTMLElement, slot: string, 值: string) => {
  const el = 输入条(host, slot)
  el.value = 值
  el.dispatchEvent(new Event("input", { bubbles: true }))
  return el
}

/** 对输入条按一个键（Enter ＝ 交 / Escape ＝ 撤）。 */
const 条里敲 = (el: HTMLElement, key: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))

/**
 * ── 新建弹窗的探针（2026-10-11：新建从行内输入条改成弹窗）──────────────────
 *
 * 与右键菜单同理：弹窗是 `dialog.show()` 经 `Kobalte.Portal` 传送到 **`document.body`** 的
 * （`context/dialog.tsx`），**不在** host 里 ⇒ 一律查 `document`。
 *
 * ⚠️ `dialog.show()` 里包着 `startTransition` ⇒ 弹窗**晚一拍**才落下来：点完入口要先
 * `await 冲一遍()`（≥ 一拍）再查，同步查必然读到「还没有弹窗」。
 *
 * ⚠️ 输入框按 `TextInputV2` **自己的**槽位查，不按调用方传的 `data-slot`——它把
 * `data-slot="text-input-v2-input"` 写在 `{...inputProps}` **之后**，调用方传的名字被静默覆盖
 * （`LEARNINGS #005-22` 的 `ContextMenuTrigger` 同病）。
 */
const 弹窗框 = () => {
  const el = document.body.querySelector<HTMLInputElement>("[data-slot='file-create-dialog'] input")
  if (!el) throw new Error("新建弹窗没开——这条用例的前提不成立（`#004-14`：先立前提再判果）")
  return el
}

/** 在弹窗的输入框里填一个名字。 */
const 弹窗填 = (名: string) => {
  const el = 弹窗框()
  el.value = 名
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

/** 提交弹窗（`ButtonV2 type="submit"` 在 happy-dom 里点不出一条 `submit`，故直接派发）。 */
const 弹窗提交 = () => {
  const form = document.body.querySelector<HTMLFormElement>("[data-slot='file-create-dialog']")
  if (!form) throw new Error("新建弹窗没开——这条用例的前提不成立（`#004-14`）")
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

/** 点弹窗里的「取消」。 */
const 弹窗取消 = () =>
  document.body.querySelector<HTMLButtonElement>("[data-slot='file-create-cancel']")?.click()

/**
 * ── 删除弹窗的探针（2026-10-11，⑦-③：删除二次确认从内联条改成弹窗）────────────
 *
 * 与新建弹窗同一套（`document` 而非 host、`startTransition` 晚一拍）。**不并进上面那几个
 * 辅助函数**：它们查的是 `file-create-dialog`，删的那条查 `file-delete-dialog`——
 * 合成一个「查哪个都行」的助手，会让「弹窗开的是**哪一个**」这条判据消失。
 */
const 删弹窗钮 = (slot: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * `useDialog().close()` 是两步：状态**立刻**变、节点 **~100ms 后**才 `dispose()`
 * （`context/dialog.tsx:57` 的 `setTimeout`，`LEARNINGS #005-33`）。
 * ⇒ 「弹窗在不在」在 `setTimeout 0` 的窗里恒真，只看那个窗**什么也判不出**。
 * 这个助手一直等到它**不见**为止（有界上限）；`true` = 它在窗口内消失了。
 * （照抄 `file-delete-dialog.test.tsx` 里那个同名助手，`#004-12`。）
 *
 * ⚠️ `slot` **必填、不给默认值**：上面 `弹窗探针` 那段注释刚论证过「别做『查哪个都行』的助手，
 * 那会让『弹窗开的是哪一个』这条判据消失」。给了默认值，将来某个新建弹窗的调用点漏传就会
 * **静默地去等删除弹窗**（等错 ⇒ 立刻回 `true` ⇒ 判据红得莫名其妙）。必填则漏传是 typecheck 红。
 */
const 等弹窗没 = async (slot: string, 上限 = 25) => {
  for (let i = 0; i < 上限 && document.querySelector(`[data-slot='${slot}']`); i++) {
    await new Promise((r) => setTimeout(r, 20))
  }
  return !document.querySelector(`[data-slot='${slot}']`)
}

/** 树上的一个按钮槽位（`file-tree-action-*` / `file-tree-create-*` / `file-tree-delete-*`）。 */
const 树按钮 = (host: HTMLElement, slot: string) =>
  host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

/**
 * 右键菜单「刷新」接进工作台（2026-10-10 用户下达）。
 *
 * ## 它接的是**现成的那道闸门**
 *
 * `workspace-entry.tsx` 的 `清单重取` 今天只由**我们自己的**文件动作拨（建/改名/删/复制/移动办成、
 * 上传成功）——AI 在沙箱里建了删了文件、别的进程动了盘，界面**永远不会自己变**。
 * 这一节验两件事：① 右键「刷新」**真的拨到了那道闸门上**（不是只画了个菜单项）；
 * ② 顺带修掉的那个**闪烁**（同项目重取时不清空树）。
 *
 * ⚠️ 必须带当前项目的 id：服务端拿它定位沙箱目录（T017 的中间件），没有它就一个请求都不发
 * ——那样「取了几次」这条判据会读成「一直是 0」，绿得没有信息。
 */
describe("「刷新」接进工作台（2026-10-10 用户下达）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectFiles(undefined)
  })

  /** 挂一个已选定项目的左栏。与上一节那个 `开` **同形、各写一份**（`#004-11`：夹具不跨节共享）。 */
  async function 开(剧本: Parameters<typeof 假数据源>[0] = {}) {
    const { data, 记 } = 假数据源({ files: async () => ["资料/话单.csv"], ...剧本 })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()
    return { host, 假: 记 }
  }

  test("右键「刷新」⇒ 真的重新取了一次清单（闸门拨到了）", async () => {
    const { host, 假 } = await 开()
    const 刷前 = 假.files.length

    右键行(host, "话单.csv")
    点菜单项("refresh")
    await 冲一遍()

    expect(假.files.length, "取清单的次数要多一次——这就是「刷新」的全部作用").toBe(刷前 + 1)
  })

  /**
   * **刷新时不清空树**（2026-10-10 用户裁定）。
   *
   * 改之前 effect 是**无条件**先 `setProjectFiles(undefined)`——那是给**换项目**用的（免得看见
   * 上一个项目的文件，那看起来像「串项目」）。但同一句落在**同项目重取**上就有代价了：
   * 用户会先看见树整片变成「还没有文件」空态、再长回来；对刚被 AI 改过文件的人，
   * 那一下**看着像「文件全没了」**。
   *
   * ⚠️ 判据必须**在取数挂起的那一刻**读（`#005-26`：被观测对象会被这次动作本身改掉时，
   * 取数时机就是判据本身）。等新清单回来再读的话，清没清空**都看不见了**——这条用例会退化成
   * 「树最终有行」，那是另一回事。
   *
   * 对照组：同一份 effect 里「**换项目**要清空」那一半由前一节（`左栏（项目侧栏）`／
   * `文件树接进左栏` 里那几条切项目的用例）守着——别把这一条读成「清空被整个删了」。
   */
  test("刷新时树**不清空**：新清单回来之前，旧行还留在屏幕上", async () => {
    let 放行: (() => void) | undefined
    const 等着的 = new Promise<void>((resolve) => {
      放行 = resolve
    })
    let 第几趟 = 0
    const { host } = await 开({
      files: async () => {
        第几趟 += 1
        // 第二趟（＝「刷新」那一趟）挂住不返回，把判据停在「取数进行中」这一刻。
        if (第几趟 > 1) await 等着的
        return ["资料/话单.csv"]
      },
    })

    全展开(host) // 默认全收缩（用户第 5 条）⇒ 深一层的行要先打开
    expect(路径们(host), "前置：旧清单已经在屏幕上，否则下面那句证明不了任何事").toContain("资料/话单.csv")

    右键行(host, "话单.csv")
    点菜单项("refresh")
    await 冲一遍()

    expect(路径们(host), "取数还没回来，旧行必须还在——清空的话这里读成 []").toContain("资料/话单.csv")

    放行?.() // 别把挂起的 promise 留给下一条用例
    await 冲一遍()
    expect(路径们(host)).toContain("资料/话单.csv")
  })

  /**
   * 刷新**失败** ⇒ 旧清单留着（2026-10-21）。
   *
   * 与上一条同因：失败也只是「再取一遍」的一趟，不该因为这一趟没成，就把已经看得见的树抹掉、
   * 改说「还没有文件」。**没有旧清单**时失败才说「取不到」并给重试——那一条在
   * 「三态」那一节（`清单取不到 ⇒ …`）。两条合起来才是完整的分支：成 / 失败 × 有 / 无旧清单。
   */
  test("刷新失败 ⇒ 旧清单留着，树不变成空态、也不报「加载失败」", async () => {
    let 第几趟 = 0
    const { host } = await 开({
      files: async () => {
        第几趟 += 1
        return 第几趟 === 1 ? ["资料/话单.csv"] : undefined
      },
    })
    全展开(host)
    expect(路径们(host), "前置：旧清单已经在屏幕上").toContain("资料/话单.csv")

    右键行(host, "话单.csv")
    点菜单项("refresh")
    await 冲一遍()

    expect(路径们(host), "刷新没成，旧行必须还在").toContain("资料/话单.csv")
    expect(text(host, "file-tree-failed")).toBeUndefined()
    expect(text(host, "file-tree-empty")).toBeUndefined()
  })
})

/**
 * 建 / 改名 / 删接进工作台（T018 出参）。
 *
 * 上一节（T020）验的是四个「拿一个已有文件去搬」的动作；这一节验三个**改变树本身**的动作：
 * ① 树上那根输入条**敲完 Enter 才真的发请求**（不是点一下菜单就发——T018 之前正是这么错的，
 *    而服务端的 `name` 是必填，那个形状根本交不出名字）；
 * ② 三个动作**各走各的出口**——`renameEntry` 与 `removeEntry` 只差一个字段，接反了是「点重命名、
 *    文件没了」，所以两条各钉一条、且都钉到「另一个动作一次都没调」；
 * ③ 办成 ⇒ **清单重取**（树上的真相是重取那一份，不是本地拼的新行）；
 * ④ 被拒 ⇒ 服务端那句**原话**留在界面上（这一组的拒绝理由民警得看得懂，如「项目根不能删」）。
 *
 * ⚠️ 三项都**必须带当前项目的 id**：服务端拿它定位沙箱目录（T017 的中间件）。
 */
describe("建 / 改名 / 删接进工作台（T018 出参）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectFiles(undefined)
  })

  /** 挂一个已经选定项目的左栏：树里一个目录一个文件。 */
  async function 开(剧本: Parameters<typeof 假数据源>[0] = {}) {
    const { data, 记 } = 假数据源({
      files: async () => ["资料/话单.csv"],
      ...剧本,
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: "p1", name: "8·17专案" })
    await 冲一遍()
    return { host, 假: 记 }
  }

  /**
   * 对照组（`#003-03` 第②类）：上一节那条「没选中项目 ⇒ 三个动作禁用」不能退化成「**永远**禁用」
   * ——同一棵树上选中项目之后，＋ 必须亮起来，否则那条断言什么也没钉住。
   *
   * 同一条里再钉一问：**接线**与**有作用对象**是两条独立的理由（FR-006「未选中置灰」）——
   * 有项目但没选中任何一行时，✏️ 仍该是灰的。
   */
  test("选中项目 ⇒ ＋ 亮起来；✏️ 要选了一行才亮（接线与有对象是两条理由）", async () => {
    const { host } = await 开()

    expect(树按钮(host, "file-tree-action-create")?.disabled).toBe(false)
    expect(树按钮(host, "file-tree-action-rename")?.disabled).toBe(true)

    找行(host, "话单.csv").click()

    expect(树按钮(host, "file-tree-action-rename")?.disabled).toBe(false)
  })

  test("右键目录「新建文件夹」⇒ 弹窗里敲名字才走 createEntry，带 kind / 落点 / 名字", async () => {
    const { host, 假 } = await 开({ createEntry: async () => ({ kind: "done", path: "资料/子目录" }) })

    右键行(host, "资料")
    点菜单项("create-dir")

    // 点了菜单还不够——名字还没问（T018：这一步改之前就发请求了，而那时它交不出 name）
    expect(假.建的条目).toEqual([])

    await 冲一遍()
    弹窗填("子目录")
    弹窗提交()
    await 冲一遍()

    expect(假.建的条目).toEqual([["p1", "directory", "资料", "子目录"]])
  })

  test("新建办成 ⇒ 清单重取一次（树上的真相是重取那一份）", async () => {
    const { host, 假 } = await 开({ createEntry: async () => ({ kind: "done", path: "资料/新.md" }) })
    const 建前 = 假.files.length

    右键行(host, "资料")
    点菜单项("create-file")
    await 冲一遍()
    弹窗填("新.md")
    弹窗提交()
    await 冲一遍()

    expect(假.files.length).toBe(建前 + 1)
  })

  /**
   * 重命名走**工具栏**那一条路（选中项 ⇒ ✏️）：与菜单那条走的是同一对 prop，但作用对象来源不同
   * （工具栏取选中项、菜单取右键那一项）——`LEARNINGS #005-12`：落在 N 个入口上的同一个修法，
   * 写 N 条用例。
   */
  test("选中一行点 ✏️ ⇒ 走 renameEntry，带上项目 id、**旧路径**与新名字", async () => {
    const { host, 假 } = await 开({ renameEntry: async () => ({ kind: "done", path: "资料/旧名.csv" }) })

    找行(host, "话单.csv").click()
    树按钮(host, "file-tree-action-rename")?.click()
    条里敲(条里打字(host, "file-tree-rename-input", "旧名.csv"), "Enter")
    await 冲一遍()

    expect(假.改名的).toEqual([["p1", "资料/话单.csv", "旧名.csv"]])
    // 改名**不是**删除：两个方法只差一个参数，接反了文件直接没了
    expect(假.删的).toEqual([])
  })

  test("右键「删除」⇒ 先过二次确认，确认后才走 removeEntry（只带路径）", async () => {
    const { host, 假 } = await 开({ removeEntry: async () => ({ kind: "done", path: "资料/话单.csv" }) })

    右键行(host, "话单.csv")
    点菜单项("delete")
    await 冲一遍()

    // 二次确认（FR-006）：点到菜单那一刻，一个请求都还没发——这条先钉，红的时候读到的才是
    // 「它已经动手了」这条证据本身（`#004-14`）
    expect(假.删的).toEqual([])

    删弹窗钮("file-delete-ok")?.click()
    await 冲一遍()

    expect(假.删的).toEqual([["p1", "资料/话单.csv"]])
    // 删除**不是**改名：同一条理由
    expect(假.改名的).toEqual([])
  })

  /**
   * ⚠️ **本条 2026-10-16 改写过**：改之前它断的是「那句话落在 `file-op-message`（工具栏下方）」，
   * 与新行为**正好相反**（载体从内联句改成弹窗里的提示）。`LEARNINGS #005-36`：改一个行为之前，
   * 先 `grep` 出**断言了这个旧行为**的既有用例，逐条明说去向——这里是**改写**，不是删。
   *
   * 反面断言（清单不重取）**继续留着**：盘上没变，重取是空跑。
   */
  test("删除被拒（项目根不能删）⇒ 弹窗**不关**、原话在弹窗里，且不重取清单", async () => {
    const { host, 假 } = await 开({ removeEntry: async () => ({ kind: "rejected", message: "项目根不能删" }) })
    const 删前 = 假.files.length

    右键行(host, "话单.csv")
    点菜单项("delete")
    await 冲一遍()
    删弹窗钮("file-delete-ok")?.click()
    await 冲一遍()

    // 主判据：原话在**弹窗**里（不是工具栏下方那行内联）——落到 `file-delete-dialog` 里
    // `file-op-error` 那一件上（弹窗传送到 `document.body`，用 `document.querySelector`，`#004-03`）。
    const 弹窗话 = document.querySelector("[data-slot='file-delete-dialog'] [data-slot='file-op-error']")?.textContent ?? ""
    expect(弹窗话).toContain("项目根不能删")
    // 「弹窗不关」这条承诺的证据：有界轮询扛过 dispose 窗再判（旧实现——接线丢回话、弹窗照关——
    // 在 500ms 上限内节点会消失，`等弹窗没()` 回 `true`，恰红）。
    expect(await 等弹窗没("file-delete-dialog")).toBe(false)
    // 反面断言
    expect(假.files.length, "没成的事不该刷成「好像变了」").toBe(删前)
  })

  /**
   * 新建失败 ⇒ 弹窗**不关**、服务端原话在**弹窗里**、名字草稿还在。
   *
   * ⚠️ **两条判据的写法被控制器在派单前改过**（裁定 R10 / R12）：
   * ① 原计划写 `document.body.textContent` —— 那是**整页**文本，弹窗就算关了也可能命中别处的字，
   *    等于没有射程（`#004-03` / `#005-44`）。改成落到**弹窗里 `file-op-error` 那一件**上。
   * ② 原计划写 `不存在(document.body, "[data-slot='file-create-dialog']")` —— 它在 `冲一遍()`
   *    （≈0ms）那一刻判，而 `close()` 是**两步**的、节点 ~100ms 后才 `dispose()`（`#005-33`）
   *    ⇒ **旧实现（提交即关）在那个窗里也满足**，这条断言恒绿空转（`#005-47` 同族）。
   *    改用有界轮询 `等弹窗没`，它扛过 dispose 窗再判。
   * ③ 「名字草稿还在」原计划只写在**标题**里、代码里没有 —— 标题比断言强就是一句不实的话
   *    （`#004-03`）。补上断言。
   */
  test("新建没办成 ⇒ 弹窗**不关**、原话在弹窗里、名字草稿还在", async () => {
    const { host, 假 } = await 开({ createEntry: async () => ({ kind: "rejected", message: "目标目录不存在" }) })

    右键行(host, "资料")
    点菜单项("create-file")
    await 冲一遍()
    弹窗填("新.md")
    弹窗提交()
    await 冲一遍()

    // 主判据①：原话在**弹窗里那一件**上（弹窗传送到 `document.body` ⇒ 用 `document` 查）
    const 弹窗话 = document.querySelector("[data-slot='file-create-dialog'] [data-slot='file-op-error']")?.textContent ?? ""
    expect(弹窗话).toContain("目标目录不存在")
    // 主判据②：「不关」的证据 = 扛过那 ~100ms 的 dispose 窗之后它还开着。
    // ⚠️ 布尔，不是节点断言（`#005-01`：`expect(<节点>).toBeNull()` 红了会把整轮挂死）。
    expect(await 等弹窗没("file-create-dialog")).toBe(false)
    // 主判据③：名字草稿留着 —— 改一处就能再交，不必重开重敲
    expect(弹窗框().value).toBe("新.md")
    // ⚠️ **这一句只是前提、不是守护者**：把接线处的 `return` 拆掉（Step 4）它**不会红**
    //    —— `void` 掉回话之后 `建条` 照样执行、请求照样发。见 Step 4 的据实记录。
    expect(假.建的条目.length, "第一趟确实发出去了（前提，不是本改动的守护者）").toBe(1)
  })

  /**
   * 失败之后再交一次 ⇒ **会再发**。这条守的是「弹窗没关」的下游后果：链路还活着。
   *
   * ⚠️ 与 `file-create-dialog.test.tsx:239` 那条同款、同**局限**：happy-dom 里旧实现（提交即
   * `close()`）在 dispose 窗内节点仍在 DOM，二次提交照样喊到回调（`#005-33`）——它钉的是
   * **行为本身**，不是本改动的守护者。留着，但别让后来人高估它。
   */
  test("新建没办成之后改个名字再交 ⇒ **会再发一次**（弹窗没关，这条链还在）", async () => {
    const { host, 假 } = await 开({ createEntry: async () => ({ kind: "rejected", message: "目标目录不存在" }) })

    右键行(host, "资料")
    点菜单项("create-file")
    await 冲一遍()
    弹窗填("新.md")
    弹窗提交()
    await 冲一遍()
    弹窗填("改过的.md")
    弹窗提交()
    await 冲一遍()

    expect(假.建的条目).toEqual([
      ["p1", "file", "资料", "新.md"],
      ["p1", "file", "资料", "改过的.md"],
    ])
  })

  /**
   * 重命名失败 ⇒ 原话落在**被改名的那一行**上，工具栏下方那行内联**不出现**。
   *
   * ⚠️ 剧本那句拒绝话被控制器改过（裁定 R13）：原计划抄的是 `"项目根不能删"`——那是**删除**的
   * 专有话（服务端 `ROOT_UNDELETABLE`，`openhive/file.ts:300`）。重命名真正会拒它的只有
   * `NAME_ALIASED`（`file.ts:778` 的 `if (!usableName(name)) return badRequest(NAME_ALIASED)`）。
   * 一句「重命名失败」配一句「根不能删」的话，读者判不出是**接线接反了**还是**随手写的**。
   */
  test("重命名没办成 ⇒ 原话落在**那一行**上，工具栏下方那行内联**不出现**", async () => {
    const { host, 假 } = await 开({
      renameEntry: async () => ({ kind: "rejected", message: "文件名里不能含 `:`（win32 会把它当作盘符或数据流分隔符，落成另一个名字）" }),
    })

    找行(host, "话单.csv").click()
    树按钮(host, "file-tree-action-rename")?.click()
    条里敲(条里打字(host, "file-tree-rename-input", "旧名.csv"), "Enter")
    await 冲一遍()

    // 主判据：话在**那一行**里（行元素带 `data-path`，`file-tree.tsx` 的 `file-tree-row`）
    const 行 = host.querySelector<HTMLElement>("[data-slot='file-tree-row'][data-path='资料/话单.csv']")
    expect(行?.querySelector("[data-slot='file-op-error']")?.textContent ?? "").toContain("文件名里不能含")
    // 旧载体确实退场了（不是「两处都画」）。`file-op-message` 只在有话说时渲染 ⇒ 此处应为 `undefined`
    expect(text(host, "file-op-message")).toBe(undefined)
    expect(假.改名的.length).toBe(1)
  })

  /**
   * 重命名办成 ⇒ 清单重取，那一行上**没有**话。
   *
   * ⚠️ 最后那句「清单重取」是控制器加上的（裁定 R14）：本节文件头 ③ 写着「办成 ⇒ 清单重取」，
   * 而重命名这一支至今没有一条钉它（新建那条在 `:2594`）。不加的话本条与本文件 `:2613` 那条
   * （同样断 `假.改名的`）几乎重复。
   */
  test("重命名办成 ⇒ 清单重取，行话不留在屏幕上", async () => {
    const { host, 假 } = await 开({ renameEntry: async () => ({ kind: "done", path: "资料/新名.csv" }) })
    const 改前 = 假.files.length

    找行(host, "话单.csv").click()
    树按钮(host, "file-tree-action-rename")?.click()
    条里敲(条里打字(host, "file-tree-rename-input", "新名.csv"), "Enter")
    await 冲一遍()

    expect(假.改名的).toEqual([["p1", "资料/话单.csv", "新名.csv"]])
    expect(假.files.length).toBe(改前 + 1)
    // 办成 ⇒ 那一行干净。⚠️ 这是**伴随信号**，不是守护者：`行话` 只在失败支被设过，
    // 所以它红不了（`#004-14`：一用例多断言时，安全/主属性排在前面）。
    expect(text(host, "file-op-error")).toBe(undefined)
  })

  test("新建弹窗点「取消」⇒ 一个请求都不发", async () => {
    const { host, 假 } = await 开({ createEntry: async () => ({ kind: "done", path: "资料/新.md" }) })

    右键行(host, "资料")
    点菜单项("create-file")
    await 冲一遍()
    弹窗填("建了一半")
    弹窗取消()
    await 冲一遍()

    expect(假.建的条目).toEqual([])
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
 * 右栏（AI 会话）的**乒乓开关**（2026-10-10 用户下达）。
 *
 * 用户原话：「点击『AI 会话』图标（高亮），右栏的 AI 会话界面会出现，再次点击（高亮消失），
 * 右栏隐藏，中栏的宽度自动适应屏幕大小」——判断依据在设计文档里，不在本次对话里：
 * `docs/superpowers/specs/2026-09-11-项目管理-design.md:25`「**AI 会话** ｜ 呼出/收起右栏 ｜ 💬」、
 * `archive/2026-08-17-openhive-design-v1.md:229`「点图标呼出/收起对应侧栏；**高亮 = 当前展开**」。
 *
 * ⚠️ 这条链上**两半都要钉**，缺一半都过得去：
 * ① 右栏真的**整根不在**——`three-pane-right` **与** `three-pane-right-group` 都要断（前者是栏本身、
 *    后者是连 `ResizeHandle` 一起的包裹；只断前者的写法在「栏还在、只是空了」时照样绿）；
 * ② 收起时**模块一个字都不动**——只断 ① 的话，「借切模块实现收起」也能过，而那正是本次要拆掉的
 *    旧路（`module` 变成 `"ai-session"` ⇒ `left` 只在 `module === "project"` 时渲染 ⇒ 左栏整列消失，
 *    用户报的症状正是它）。
 *
 * ⚠️ 2026-10-11 起 ② 那一半的**证据**换成 `左栏开着()`：`currentModule()` 读的是模块轴的
 * `aria-current`，而「项目管理」那颗已挪到开关轴（开关的是左栏）⇒ 模块没被换走这件事，由
 * 「左栏还在」直接证明（见下面那组的说明）。
 *
 * 「中栏自动适应」不在这里断：中栏是 `flex-1 min-w-0`，右栏那块不渲染就自然吃满，属
 * `three-pane.test.tsx` 的几何（happy-dom 没有 CSS 引擎，量不出来）。
 */
describe("右栏（AI 会话）的乒乓开关（2026-10-10 用户下达）", () => {
  /** 本页不可能撞车的标记（同上面那组的理由：别拿「会话」这种会出现在侧栏 tab 里的词）。 */
  const 标记 = "右栏内容-开关标记-2c91"

  const 开 = () =>
    mount(() => <WorkspaceEntry right={() => <div data-testid="右栏内容">{标记}</div>}>中栏</WorkspaceEntry>)

  test("默认展开：进门右栏就在（2026-10-10 用户裁定「默认展开」）", () => {
    const host = 开()

    expect(host.querySelector("[data-slot='three-pane-right']")?.textContent).toContain(标记)
    expect(不存在(host, "[data-slot='three-pane-right-group']")).toBe(false)
  })

  test("点「AI 会话」⇒ 右栏连手柄一起收起；再点 ⇒ 回来。全程模块一个字不动", () => {
    const host = 开()
    expect(左栏开着(host)).toBe(true)

    入口(host, "AI 会话").click()

    expect(不存在(host, "[data-slot='three-pane-right']")).toBe(true)
    expect(不存在(host, "[data-slot='three-pane-right-group']")).toBe(true)
    // 右栏轴与模块轴**互不干扰**：收起不该顺手把左栏也弄没（旧路就是这么弄没的）
    expect(左栏开着(host)).toBe(true)
    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(false)

    入口(host, "AI 会话").click()

    expect(host.querySelector("[data-slot='three-pane-right']")?.textContent).toContain(标记)
    expect(左栏开着(host)).toBe(true)
  })

  test("点别的业务入口不影响右栏开合（2026-10-10 用户裁定「不动」）", () => {
    const host = 开()

    入口(host, "话单分析").click()

    expect(currentModule(host)).toBe("话单分析")
    expect(host.querySelector("[data-slot='three-pane-right']")?.textContent).toContain(标记)
  })
})

/**
 * 左栏（项目管理）的**乒乓开关**（2026-10-11 用户下达）。
 *
 * 用户原话：「点击『AI 会话』图标（高亮），右栏的 AI 会话界面会出现，再次点击（高亮消失），
 * 右栏隐藏，中栏的宽度自动适应屏幕大小……我现在需要你实现图标栏的『项目管理』图标也实现这种
 * 乒乓开关，控制显示或隐藏的是左栏，隐藏时中栏自动适应屏幕大小」。依据同样在设计文档里，不在
 * 这次对话里：`docs/superpowers/specs/2026-09-11-项目管理-design.md:23`「**项目管理** ｜ **呼出左栏**
 * （项目列表 / 会话 / 文件树 / MinIO）｜ 📁」、`archive/2026-08-17-openhive-design-v1.md:229`
 * 「点图标呼出/收起对应侧栏；**高亮 = 当前展开**」——补的是**从没接上的那根线**：`ThreePane` 的
 * `leftCollapsed` 在此之前**没有任何生产调用方**（与 `rightCollapsed` 在 2026-10-10 之前一样）。
 *
 * ⚠️ 这条链上**三半都要钉**，缺一半都过得去：
 * ① 左栏真的**整根不在**——`three-pane-left` **与** `three-pane-left-group` 都要断（前者是栏本身、
 *    后者是连 `ResizeHandle` 一起的包裹；只断前者的写法在「栏还在、只是空了」时照样绿）；
 * ② 收起时**模块一个字都不动**（旧路的反例是「借切模块实现收起」）；
 * ③ **从别的模块点它必须把模块切回来、且左栏一次到位地开着**——这颗与「AI 会话」那颗唯一的实质
 *    差别就在这里：那颗不动模块轴，这颗**同时还是「进 project 模块」的入口**。少了 ③，一个
 *    「只翻开关、不切模块」或「先关一次再关一次」的实现（点一下反而没把左栏叫出来）照样能过上前两条。
 *
 * 「中栏自动适应」不在这里断：中栏是 `flex-1 min-w-0`，左栏那块不渲染就自然吃满，属
 * `three-pane.test.tsx` 的几何（happy-dom 没有 CSS 引擎，量不出来）；真几何证据在真栈
 * `e2e/real-stack/sidebar-project-toggle-real.spec.ts`（量左栏盒宽与中栏宽）。
 */
describe("左栏（项目管理）的乒乓开关（2026-10-11 用户下达）", () => {
  const 开 = () => mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)

  test("默认展开：进门左栏就在（与改动前看到的样子一致）", () => {
    const host = 开()

    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(false)
    expect(不存在(host, "[data-slot='three-pane-left-group']")).toBe(false)
    expect(左栏开着(host)).toBe(true)
  })

  test("点「项目管理」⇒ 左栏连手柄一起收起；再点 ⇒ 回来。全程模块一个字不动", () => {
    const host = 开()
    expect(左栏开着(host)).toBe(true)

    入口(host, "项目管理").click()

    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(true)
    expect(不存在(host, "[data-slot='three-pane-left-group']")).toBe(true)
    expect(左栏开着(host)).toBe(false)
    // 模块轴**一个字不动**：中栏页没被换走（图标栏上「资金分析」那颗本来就不该亮）
    expect(入口(host, "资金分析").getAttribute("aria-current")).toBeNull()

    入口(host, "项目管理").click()

    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(false)
    expect(不存在(host, "[data-slot='three-pane-left-group']")).toBe(false)
    expect(左栏开着(host)).toBe(true)
  })

  test("从别的模块点「项目管理」：模块切回 project 且左栏**一次到位地开着**（不是先关一次）", () => {
    const host = 开()

    入口(host, "资金分析").click()
    expect(currentModule(host)).toBe("资金分析")
    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(true)
    expect(左栏开着(host)).toBe(false)

    入口(host, "项目管理").click()

    // 三条都是「切回来了」的证据：模块轴让位 ＋ 左栏在 DOM 里 ＋ 它那颗开关亮着
    expect(入口(host, "资金分析").getAttribute("aria-current")).toBeNull()
    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(false)
    expect(左栏开着(host)).toBe(true)

    // 再点一下是**收起**——「切回来」那一支只该在别的模块上生效，不能在 project 上再来一次
    入口(host, "项目管理").click()
    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(true)
  })

  test("切到别的模块：左栏让位，且「项目管理」那颗跟着灭（它亮 = 左栏开着）", () => {
    const host = 开()

    入口(host, "话单分析").click()

    expect(currentModule(host)).toBe("话单分析")
    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(true)
    expect(左栏开着(host)).toBe(false)
  })

  /**
   * 「先切回来」那一支**必须顺手把开关置真**（不是取反）。
   *
   * 走法：在 project 上收起（开关 = 关）→ 切到别的模块（此刻模块轴、开关轴**两轴都不满足**）
   * → 再点「项目管理」。用户点它的意思是「我要左栏」；取反或干脆不动开关的实现，会让这一下
   * 看上去「什么都没发生」（左栏本该回来却没回来）。
   */
  test("收起之后再离开模块、再点它：左栏照样回来（「先切回来」那一支顺手把开关置真）", () => {
    const host = 开()

    入口(host, "项目管理").click()
    expect(左栏开着(host)).toBe(false)

    入口(host, "资金分析").click()
    expect(左栏开着(host)).toBe(false)

    入口(host, "项目管理").click()

    expect(不存在(host, "[data-slot='three-pane-left']")).toBe(false)
    expect(左栏开着(host)).toBe(true)
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

  /**
   * **第一次没拉到、点重试拉到了 ⇒ 还原照样发生**（2026-10-11）。
   *
   * 这条钉的是「那颗钮只用一半力气」那种半坏状态：还原挂在 `拉清单` 的**回话之后**，
   * 而清单第一次是 `undefined` ⇒ `if (清单)` 不成立 ⇒ **那一步从来没执行过**。若重试只补拉清单、
   * 不补还原，民警点完钮会看到「项目行回来了、锚点行还写着『未选择项目』、左栏会话 tab 空的」
   * ——而左栏会话 tab 空正是用户实报的那个现象。
   *
   * ⚠️ 这一条与上面「存档那个项目还在 ⇒ 恢复」是**两条**，不是一条：那一条的清单**第一次就到位**，
   * 所以它**测不出**「重试补没补」（`LEARNINGS #005-12`：同一个修法落在几个动作上就写几条）。
   */
  test("第一次没拉到、点重试拉到了 ⇒ 存档照样还原（那颗钮不能只用一半力气）", async () => {
    摆出存档("prj_retry_0001")
    expect(读cookie()).toBe("prj_retry_0001") // 前置：存档摆上了

    let 通 = false
    const { data, 记 } = 假数据源({
      list: async () => (通 ? [私有("prj_retry_0001", "8·17专案", 1)] : undefined),
    })
    const host = 挂(data)
    await 冲一遍()

    // 前置：第一次真的失败了（否则下面那句「还原」可能只是进场那次做的）。
    expect(projectListFailed()).toBe(true)
    expect(currentProject()).toBeUndefined()

    通 = true
    锚点按钮(host, "project-anchor-toggle")?.click()
    锚点按钮(host, "project-panel-retry")?.click()
    await 冲一遍()

    expect(记.list).toBe(2)
    expect(currentProject()?.id).toBe("prj_retry_0001")
    expect(text(host, "project-anchor-name")).toBe("8·17专案")
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

/**
 * 备份 / 恢复接线（Task 17，2026-10-18）。
 *
 * 上一节（T012）验的是**双树组件自己**会拖、会显示；这一节验的是**那根线**：
 * `workspace-entry` 有没有把 Task 13 的十个 HTTP 出口、Task 15 的双树、Task 16 的恢复对话框
 * 接到一起——也就是用户最初实报的那个缺陷（「备份到 MinIO / 从 MinIO 拉回」永远是灰的）修没修掉。
 *
 * 判据一律落在**数据源收到了什么**（`记.*`）与**界面上看得见什么**（行 / 槽 / 对话框）上，
 * 不落在「代码写了没有」上：接线这类事，代码看着像接上了、实际参数错一位，界面照样安静。
 *
 * ⚠️ 每条用例前都把**五个备份信号清空**（`@/project/minio-backups`）：它们是模块级的，
 * 上一个实例 / 上一条用例的货会漏进来（`LEARNINGS #005-03`）。`setCurrentProject(undefined)`
 * 同时清 cookie——`onMount` 的「按存档还原」才不会把上一条的项目认领回来。
 */
describe("备份 / 恢复接线（Task 17）", () => {
  beforeEach(() => {
    setCurrentProject(undefined)
    setProjectList(undefined)
    setProjectFiles(undefined)
    setMinioBackups(undefined)
    setBackupSnapshots(undefined)
    setBackupSnapshotId(undefined)
    setBackupUsage(undefined)
    setBackupJob(undefined)
  })

  /** 指定那棵树里的一行（`data-tree` 把两棵树的同名行分开）。 */
  const 树行按 = (host: HTMLElement, 哪棵: "sandbox" | "minio", path: string) =>
    host.querySelector<HTMLElement>(
      `[data-tree='${哪棵}'] [data-slot='file-tree-row'][data-path='${path}']`,
    )

  const 槽 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)

  /**
   * 下树的恢复点选择器（2026-10-18 起是**通栏胶囊 ＋ 下拉**，不是原生 `<select>`）。
   *
   * ⚠️ 记号是 `data-snapshot-picker`，不是 `data-slot`：`DropdownMenu.Trigger` 会把调用方的
   * `data-slot` 覆盖成 `dropdown-menu-trigger`（`LEARNINGS #005-22`）。
   */
  const 快照选择器 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-snapshot-picker]")

  /**
   * 当前选中的恢复点 id（`""` ＝ 还没选）——原生 `<select>` 的 `.value` 的替代读数。
   * ⚠️ 触发器上的记号是 `data-current-snapshot`，**不是** `data-snapshot-id`：后者是菜单项的
   * 记号，两者会同时存在于 `document.body` 里（`#005-22` 同族）。
   */
  const 当前恢复点 = (host: HTMLElement) => 快照选择器(host)?.getAttribute("data-current-snapshot") ?? ""

  /**
   * 下拉里的某一项（菜单 Portal 到 `document.body`）。
   * 必须限定在菜单内容里取——触发器也带着同一份 id 概念，未限定的查询会先命中它。
   */
  const 快照项 = (id: string) =>
    document.body
      .querySelector<HTMLElement>("[data-slot='minio-tree-snapshot-menu']")
      ?.querySelector<HTMLElement>(`[data-snapshot-id='${id}']`) ?? null

  /**
   * 点开恢复点下拉：Kobalte 的菜单触发器认 **`pointerdown`**（`LEARNINGS #006-37`），
   * `.click()` 不够。菜单内容渲染在 Portal 里，要等一拍才查得到。
   */
  async function 点开快照下拉(host: HTMLElement) {
    const 触发器 = 快照选择器(host)
    if (!触发器) throw new Error("下树里没有恢复点选择器——这条用例的前提不成立（#004-14）")
    for (const 类型 of ["pointerdown", "pointerup"] as const)
      触发器.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
    await 冲一遍()
  }

  /** 选一个恢复点：菜单项的选择发生在 **`pointerup`**（`#006-37`）。 */
  async function 选恢复点(host: HTMLElement, id: string) {
    await 点开快照下拉(host)
    const 项 = 快照项(id)
    if (!项) throw new Error(`下拉里没有恢复点 ${id}——这条用例的前提不成立（#004-14）`)
    for (const 类型 of ["pointerdown", "pointerup"] as const)
      项.dispatchEvent(
        new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }),
      )
    await 冲一遍()
  }

  /**
   * 点某一项里的 🗑（删的是**那一项**，2026-10-18 起不再挂在标题行）。
   * 删除接在 `click` 上；`stopPropagation` 保证这一下不会顺带选中该项。
   */
  async function 点删恢复点(host: HTMLElement, id = "s-1") {
    await 点开快照下拉(host)
    const 删 = 快照项(id)?.querySelector<HTMLElement>("[data-slot='minio-tree-delete']")
    if (!删) throw new Error(`恢复点 ${id} 那一项里没有删除钮——前提不成立（#004-14）`)
    删.click()
    await 冲一遍()
  }

  /**
   * 屏幕上那一类提示的全文（`success` / `error`），没有就 `null`。
   *
   * 断在**字符串**上、不把节点交给 `expect`（`#005-01`）；配方同 `file-tree.test.tsx` 的
   * `提示文本`——`挂` 已经并排挂了真 `<ToastRegion>`，`showToast` 走的是真那条路。
   */
  const 提示文本 = (variant: "success" | "error") =>
    document.body.querySelector<HTMLElement>(`[data-variant='${variant}']`)?.textContent ?? null

  /**
   * 框**真的开着**（用户还看得见）。
   *
   * ⚠️ 不能只数节点：Kobalte 在退场动画期间把内容留在 DOM 里，而 happy-dom 永远等不到动效结束
   * （同 `afterEach` 注释里的右键菜单）⇒ 「已经 `dialog.close()`、正在退场」会被数成「还开着」。
   * 判据落在 Content 的 `data-closed` 上（Kobalte 在 `open=false` 的**同一拍**写的）。
   */
  const 框开着 = (kind: string) => {
    const 内容 = document.body
      .querySelector<HTMLElement>(`[data-kind='${kind}']`)
      ?.closest("[data-slot='dialog-content']")
    return 内容 !== null && 内容 !== undefined && !内容.hasAttribute("data-closed")
  }

  /**
   * 跨树拖一个文件。
   *
   * happy-dom 没有 `DragEvent`，而 `DualFileTree` 的委托**只看冒泡的事件与落点**（它不读
   * `dataTransfer`，那是给树以外的消费者看的）⇒ 裸 `Event` 足够。`dragover` 不能省：
   * 组件不 `preventDefault` 就不认「可以放」，后面那条 `drop` 也不会有接收方。
   */
  function 拖到(源: HTMLElement | null, 目标: HTMLElement | null) {
    for (const [el, type] of [
      [源, "dragstart"],
      [目标, "dragover"],
      [目标, "drop"],
    ] as const)
      el?.dispatchEvent(new Event(type, { bubbles: true }))
  }

  /** 点 ④ 窄条展开下树（MinioBar 的 `onOpen` 只做这一件事之外还切 tab，两件一起做）。 */
  const 开双树 = (host: HTMLElement) => 槽(host, "minio-bar-open")?.click()

  /** 等一段**真实时间**——只给「终态不轮询」那条用（理由写在那条用例里）。 */
  const 睡 = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  /**
   * 等一个条件成立，最多 `次`×10ms（默认 3 秒）。
   *
   * ⚠️ 普通的 `等到` 上限只有 1 秒，覆盖不了「1 秒轮询跨两次 tick」的用例（F-4）与
   * 「job 先回 running、1 秒后才 succeeded」的用例（F-7）——它们**必须**跨过真实的轮询周期，
   * 而判据仍落在条件上、不落在一段固定睡眠上（`#006-31`）。
   */
  const 等到慢 = async (条件: () => boolean, 次 = 300) => {
    for (let i = 0; i < 次; i++) {
      if (条件()) return
      await 睡(10)
    }
  }

  /** 对话框里把某一条冲突行改判（`<select>` 的 `change` 是 `onChange` 的唯一入口）。 */
  const 改判 = (path: string, 值: "keep-both" | "overwrite" | "skip") => {
    const 行 = document.body.querySelector<HTMLSelectElement>(
      `[data-slot='restore-entry'][data-path='${path}']`,
    )
    if (!行) throw new Error(`对话框里没有 ${path} 那一行——这条用例的前提不成立（#004-14）`)
    行.value = 值
    行.dispatchEvent(new Event("change", { bubbles: true }))
  }

  const 快照 = (id: string, kind: "manual" | "auto" = "manual", files = 1): BackupSnapshot => ({
    id,
    kind,
    scope: "",
    createdAt: 1_765_000_000_000,
    status: "complete",
    totals: { files, bytes: 10, uploadedBytes: 10, skipped: 0 },
  })

  const 明细 = (snapshot: BackupSnapshot, paths: readonly string[]): BackupSnapshotDetail => ({
    ...snapshot,
    projectId: "p-42",
    ownerId: "u-1",
    files: paths.map((path) => ({ path, hash: "h", size: 10, mtimeMs: 1 })),
    dirs: [],
    skipped: [],
  })

  const 任务 = (id: string, state: BackupJob["state"], extra: Partial<BackupJob> = {}): BackupJob => ({
    id,
    kind: "backup",
    state,
    progress: { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 },
    ...extra,
  })

  const 状态 = (activeJob: BackupJob | null = null, usageBytes = 0) => ({
    activeJob,
    lastSnapshot: null,
    usageBytes,
    limitBytes: 10 * 1024 ** 3,
    autoPaused: false,
  })

  /** 一份预览——`entries` 是唯一输入，四个计数**由它算**，不手写（手写就会与条目对不上）。 */
  const 预览 = (
    entries: BackupPreview["entries"],
    localOnly: readonly string[] = [],
    gitAffected = false,
  ): BackupPreview => {
    const 数 = (status: string) => entries.filter((entry) => entry.status === status).length
    return {
      snapshotId: "s-1",
      scope: "",
      counts: {
        missing: 数("missing"),
        same: 数("same"),
        different: 数("different"),
        "type-mismatch": 数("type-mismatch"),
      },
      entries,
      truncated: false,
      gitAffected,
      localOnly,
      localOnlyTruncated: false,
    }
  }

  const 恢复结果 = (
    restored: readonly string[],
    extra: {
      overwritten?: readonly string[]
      dirsCreated?: readonly string[]
      failed?: readonly { path: string; reason: string }[]
      cancelled?: boolean
    } = {},
  ) => ({
    restored,
    keptBoth: [],
    overwritten: [],
    skipped: [],
    dirsCreated: [],
    failed: [],
    cancelled: false,
    ...extra,
  })

  /**
   * 把一条完整的「进项目 → 开双树 → 上树已经有行」前置铺好。
   *
   * 剧本里没写的那几本账，用**与产品同一套三态**的默认值：`snapshots` / `snapshotDetail` /
   * `backupStatus` 都是「取不到」（`undefined`），`heartbeat` 是 `true`（见 `假数据源` 的注释）。
   */
  async function 开备份(剧本: Parameters<typeof 假数据源>[0] = {}, 项目id = "p-42") {
    const { data, 记 } = 假数据源({
      list: async () => [私有(项目id, "8·17专案", 1)],
      files: async () => ["资料/甲.txt", "报告.docx"],
      ...剧本,
    })
    const host = 挂(data)
    await 冲一遍()
    setCurrentProject({ id: 项目id, name: "8·17专案" })
    await 冲一遍()
    开双树(host)
    await 等到(() => 树行按(host, "sandbox", "报告.docx") !== null)
    全展开(host)
    return { host, 假: 记 }
  }

  test("进门：发一次心跳 ＋ 取恢复点，下树显示最新恢复点的文件", async () => {
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
    })

    await 等到下树行(host, "资料/甲.txt")

    expect(假.心跳).toEqual(["p-42"])
    expect(假.恢复点).toEqual(["p-42"])
    // 选中项落在**第一条**恢复点上（右键「从 MinIO 拉回」要靠它），所以明细也取了它。
    expect(假.明细).toEqual([["p-42", "s-1"]])
  })

  test("拖沙箱文件到下树 ⇒ backup(项目, \"\", false)——一律整项目，选中项不收窄快照范围", async () => {
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      backup: async () => ({ jobId: "j-1" }),
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))

    await 等到(() => 假.起的备份.length === 1)
    expect(假.起的备份).toEqual([["p-42", "", false]])
  })

  test("起完备份立刻重取状态 ⇒ 进度接进窄条（不靠 1 秒轮询）", async () => {
    // ⚠️ 这条钉的是 `备份` 成功支里那句 `await 重取备份状态()`：只清 `文件话` 的话，
    // `backupJob` 永远空着、1 秒轮询的 `在跑` 守卫永远进不去 ⇒ 窄条永远停在空闲态。
    let 起过 = false
    const 运行中 = 任务("j-1", "uploading", {
      progress: { filesTotal: 2, filesDone: 1, bytesTotal: 10, bytesDone: 5 },
    })
    const { host } = await 开备份({
      snapshots: async () => [],
      backup: async () => {
        起过 = true
        return { jobId: "j-1" }
      },
      backupStatus: async () => 状态(起过 ? 运行中 : null),
    })

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))

    await 等到(() => 槽(host, "minio-bar-progress") !== null)
    expect(槽(host, "minio-bar-progress") === null).toBe(false)
  })

  test("预检期（backup 还没回包）就能看到进度与取消钮；回包后仍选中新恢复点（F-1）", async () => {
    // `POST /backup` 在回 202 之前同步跑完扫描 + 哈希 + blob 枚举（大项目几十秒到数分钟）。
    // 这段时间客户端没有 jobId，但任务已在服务端跑 ⇒ 不抢读的话窄条一直空着：没进度、没取消。
    let 放回请求: (值: { jobId: string }) => void = () => {}
    const 请求 = new Promise<{ jobId: string }>((resolve) => {
      放回请求 = resolve
    })
    let 起过 = false
    const 运行中 = 任务("j-1", "hashing")
    const { host, 假 } = await 开备份({
      snapshots: async () => (起过 ? [快照("s-new"), 快照("s-old")] : [快照("s-old")]),
      snapshotDetail: async (_projectId, snapshotId) =>
        明细(快照(snapshotId), snapshotId === "s-new" ? ["资料/新.txt"] : ["资料/老.txt"]),
      backup: async () => {
        起过 = true
        return 请求
      },
      backupStatus: async () => 状态(起过 ? 运行中 : null),
      job: async (jobId) => 任务(jobId, "succeeded", { result: { snapshotId: "s-new" } }),
    })
    await 等到(() => 当前恢复点(host) === "s-old")

    右键行(host, "报告.docx")
    点菜单项("backup")

    // 请求还挂着（没有 202、没有 jobId）——进度与取消钮必须已经出现。
    await 等到(() => 槽(host, "minio-bar-progress") !== null)
    expect(槽(host, "minio-bar-progress") === null).toBe(false)
    expect(text(host, "minio-bar-stage")).toBe("正在校验…")
    const 取消 = 槽(host, "minio-bar-cancel")
    if (!取消) throw new Error("预检期没有取消钮——这条用例的前提不成立（#004-14）")
    取消.click()
    await 等到(() => 假.取消的.length === 1)
    expect(假.取消的).toEqual(["j-1"])

    // 回包 202 之后既有行为照旧：跟进任务、选中新恢复点。
    放回请求({ jobId: "j-1" })
    await 等到慢(() => 当前恢复点(host) === "s-new")
    expect(当前恢复点(host)).toBe("s-new")
  })

  test("状态取不到（undefined）不清空进行中的任务：一次抖动后进度条仍在（F-4）", async () => {
    // `backupStatus` 的 `undefined` 是「这次没问出来」，不是「服务端说没有任务」。把它当成后者
    // 会把 `backupJob` 清掉 ⇒ 1 秒轮询的 `在跑` 守卫当场失败、进度条消失且**再也不会回来**。
    // 四次状态调用：① 进门（空闲）、② 起完备份（running）、③ 第一次轮询（取不到）、④ 第二次轮询（succeeded）。
    let 起过 = false
    let 状态调用 = 0
    const 运行中 = 任务("j-1", "uploading", {
      progress: { filesTotal: 2, filesDone: 1, bytesTotal: 10, bytesDone: 5 },
    })
    const { host } = await 开备份({
      snapshots: async () => [],
      backup: async () => {
        起过 = true
        return { jobId: "j-1" }
      },
      backupStatus: async () => {
        状态调用 += 1
        if (!起过) return 状态(null)
        if (状态调用 === 2) return 状态(运行中)
        if (状态调用 === 3) return undefined
        return 状态(任务("j-1", "succeeded"))
      },
    })

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))
    await 等到慢(() => 状态调用 >= 2)
    await 等到(() => 槽(host, "minio-bar-progress") !== null)

    // ③ 取不到 ⇒ 任务必须**还在**（清掉的话下一拍轮询直接短路，④ 永远不来）。
    await 等到慢(() => 状态调用 >= 3)
    await 冲一遍()
    expect(槽(host, "minio-bar-progress") === null).toBe(false)

    // ④ 拿到终态 ⇒ 回到空闲态（三态里「取不到」只影响中间那一拍，不影响终态落地）。
    await 等到慢(() => 状态调用 >= 4)
    await 等到(() => 槽(host, "minio-bar-progress") === null)
    expect(槽(host, "minio-bar-progress") === null).toBe(true)
  })

  test("手动备份成功 ⇒ 选中新的恢复点并显示它的文件（spec §11.5 / F-7）", async () => {
    // 服务端把新快照 id 写在终态 job 的 `result.snapshotId` 里。备份成功之后光刷新清单不够：
    // 选中项规则会**保留**上一次选中的旧恢复点（旧 id 还在清单里），用户看到的仍是旧快照。
    let 备份过 = false
    let 轮 = 0
    const { host, 假 } = await 开备份({
      // 进门只有旧恢复点；备份之后新恢复点出现在清单最前。
      snapshots: async () => (备份过 ? [快照("s-new"), 快照("s-old")] : [快照("s-old")]),
      snapshotDetail: async (_projectId, snapshotId) =>
        明细(快照(snapshotId), snapshotId === "s-new" ? ["资料/新.txt"] : ["资料/老.txt"]),
      backup: async () => {
        备份过 = true
        return { jobId: "j-1" }
      },
      job: async (jobId) => {
        if (jobId !== "j-1") return undefined
        轮 += 1
        return 轮 === 1
          ? 任务("j-1", "uploading", {
              progress: { filesTotal: 2, filesDone: 1, bytesTotal: 10, bytesDone: 5 },
            })
          : 任务("j-1", "succeeded", { result: { snapshotId: "s-new" } })
      },
    })
    await 等到(() => 当前恢复点(host) === "s-old")
    // 前置：进门选中旧恢复点。下树默认全收缩 ⇒ 深层行要展开才在 DOM 里（`等到下树行` 会点）。
    await 等到下树行(host, "资料/老.txt")

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))

    // job 第一轮 running（进度进窄条）⇒ 1 秒后 succeeded；随后应选中 s-new 并取它的明细。
    await 等到慢(() => 当前恢复点(host) === "s-new")
    await 等到下树行(host, "资料/新.txt")
    expect(当前恢复点(host)).toBe("s-new")
    expect(树行按(host, "minio", "资料/老.txt") === null).toBe(true)
    // 前置：快照 id 真的来自终态 job（不是碰巧清单第一项被默认选中）——进门时它选的是 s-old。
    expect(假.起的备份).toEqual([["p-42", "", false]])
  })

  test("手动备份到终态 ⇒ 弹窗报「备份完成」与文件数（2026-10-18 用户下达）", async () => {
    const { host } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      backup: async () => ({ jobId: "j-1" }),
      job: async (jobId) =>
        jobId === "j-1"
          ? 任务("j-1", "succeeded", {
              kind: "backup",
              progress: { filesTotal: 3, filesDone: 3, bytesTotal: 2048, bytesDone: 2048 },
              result: { snapshotId: "s-1" },
            })
          : undefined,
    })
    await 等到(() => 当前恢复点(host) === "s-1")

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))

    // 结果走**弹窗**（Portal 到 document.body），不再在底栏内联。
    await 等到(() => 文本在页("task-result-title") === "备份完成")
    expect(文本在页("task-result-text")).toBe("3 个文件 · 2.0 KB")
    expect(页面槽("task-result")?.closest("[data-slot='dialog-content']") !== null).toBe(true)
    expect(text(host, "file-op-message") === undefined).toBe(true)

    页面槽("task-result-close")?.click()
    await 等到(() => 页面槽("task-result") === null)
    expect(页面槽("task-result") === null).toBe(true)
  })

  test("手动备份失败 ⇒ 弹窗说「备份失败」与服务端给的原因", async () => {
    const { host } = await 开备份({
      snapshots: async () => [],
      backup: async () => ({ jobId: "j-1" }),
      job: async (jobId) =>
        jobId === "j-1"
          ? 任务("j-1", "failed", {
              kind: "backup",
              error: { code: "upload_failed", message: "对象存储连不上", retryable: true },
            })
          : undefined,
    })
    await 等到(() => 树行按(host, "sandbox", "报告.docx") !== null)
    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))

    await 等到(() => 文本在页("task-result-title") === "备份失败")
    expect(文本在页("task-result-text")).toBe("对象存储连不上")
    expect(页面槽("task-result")?.getAttribute("role")).toBe("alert")
  })

  test("起备份后切项目：旧任务的终态不会把新恢复点写进新项目（N-1）", async () => {
    // 窗口在 `备份` 的两个 await 之间：发起时是 p-1，但成功支那次 `重取备份状态` 还没回来
    // 用户就切走了。修复前 `跟备份任务` 在这两个 await **之后**才读 `currentProject()` ⇒ 它会
    // 以 p-2 的身份跟进 p-1 的任务，终态把 p-1 的 `s-new` 选中到 p-2 上。
    let 放回清单: (清单: readonly BackupSnapshot[]) => void = () => {}
    const 备份后清单 = new Promise<readonly BackupSnapshot[]>((resolve) => {
      放回清单 = resolve
    })
    let 清单次 = 0
    let 放回任务: (job: BackupJob) => void = () => {}
    const 任务终态 = new Promise<BackupJob>((resolve) => {
      放回任务 = resolve
    })
    const { host, 假 } = await 开备份(
      {
        list: async () => [私有("p-1", "甲", 1), 私有("p-2", "乙", 2)],
        snapshots: async (projectId) => {
          if (projectId === "p-2") return [快照("s-2")]
          清单次 += 1
          // 进门那次立刻给；备份成功后的那次**挂着**——切项目的窗口就在这里。
          return 清单次 === 1 ? [快照("s-old")] : 备份后清单
        },
        snapshotDetail: async (_projectId, snapshotId) =>
          明细(快照(snapshotId), snapshotId === "s-2" ? ["资料/新项目.txt"] : ["资料/老.txt"]),
        backup: async () => ({ jobId: "j-1" }),
        job: async () => 任务终态,
      },
      "p-1",
    )
    await 等到(() => 当前恢复点(host) === "s-old")

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))
    // 正向前提：备份真的以 p-1 身份起了。少了这一句，「备份进门就 return」的变异下
    // 整条用例会空转（后面的「没有 s-new」因为什么都没发生而恒真）（S-2）。
    await 等到(() => 假.起的备份.length === 1)
    expect(假.起的备份).toEqual([["p-1", "", false]])
    await 等到(() => 清单次 >= 2) // 备份已发起，成功支的重取挂住了

    setCurrentProject({ id: "p-2", name: "乙" })
    await 冲一遍()
    await 等到(() => 当前恢复点(host) === "s-2")

    // 旧项目那次重取这时才回来；`备份` 继续走到 `跟备份任务`（修复前会在这里读成 p-2）。
    放回清单([快照("s-old")])
    await 冲一遍()
    // 任务终态：成功并带 `s-new`。修复后 `等任务` 的守卫在**进循环前**就发现项目换了，
    // 根本不会去问 job；所以这里只等数据落定，不等「job 被问过」。
    放回任务(任务("j-1", "succeeded", { result: { snapshotId: "s-new" } }))
    await 睡(50)
    await 冲一遍()
    await 冲一遍()

    // 新项目仍是它自己的 s-2：旧任务的新恢复点既没被取明细、也没被选中。
    // 先钉「明细没被取」——那是写入发生的**直接证据**；选中项在清单里没有 s-new 时会被
    // `<select>` 记成空串，单独看它读不出「写没写」。
    expect(假.明细.some(([, snapshotId]) => snapshotId === "s-new")).toBe(false)
    expect(当前恢复点(host)).toBe("s-2")
    expect(树行按(host, "minio", "资料/老.txt") === null).toBe(true)
  })

  test("拖下树文件回上树 ⇒ 先起预览；有冲突时弹恢复对话框", async () => {
    const 有冲突 = 预览([{ path: "资料/甲.txt", status: "different" }])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      // 第一轮就回终态：`等任务` 不必等真实 1 秒（amend S-4）。
      job: async (jobId) =>
        jobId === "job-preview"
          ? 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 有冲突 } })
          : undefined,
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))

    await 等到(() => document.body.querySelector("[data-component='backup-restore-dialog']") !== null)
    /*
     * **结构守卫**（Task 18 fix round 1 的 N-1）：恢复框必须长在可交互的弹窗壳里。
     *
     * `dialog.show()` 挂出的层是 `pointer-events: none`；可交互面是 `DialogV2` 的
     * `[data-slot='dialog-content']` 槽（`pointer-events: auto` 挂在它的祖先
     * `[data-slot='dialog-container']` 上、由它继承，见 `dialog-v2.css:29`）。裸挂在层里的
     * 弹窗在真浏览器里点不到——那正是本 fix round 修掉的产品缺陷。
     *
     * ⚠️ happy-dom 判不了 `pointer-events`（`#005-07`），这条**只守「壳还在」**；
     * 「点得到」由真栈 e2e（`backup-snapshot-real.spec.ts`）守。
     * ⚠️ 不写 `expect(节点).toBeNull()`（`#005-01`：红了会把整轮 `bun test` 挂死），
     * 这里断布尔值。
     */
    const 恢复框 = document.body.querySelector<HTMLElement>("[data-component='backup-restore-dialog']")
    if (!恢复框) throw new Error("恢复对话框没挂上——这条用例的前提不成立（#004-14）")
    expect(
      恢复框.closest("[data-slot='dialog-content']") !== null,
      "恢复框必须在 DialogV2 的可交互壳里（拆掉 <DialogV2> ⇒ 这条应当红）",
    ).toBe(true)
    expect(假.预览的).toEqual([["p-42", "s-1", "资料/甲.txt"]])
  })

  test("恢复对话框点确认 ⇒ restoreBackup 收到逐条改判后的 {snapshotId, path, decision, decisions}（逐字）", async () => {
    const 有冲突 = 预览([{ path: "资料/甲.txt", status: "different" }])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 有冲突 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"]) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")
    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))
    await 等到(() => document.body.querySelector("[data-slot='restore-confirm']") !== null)

    // ⚠️ 必须**逐条改判**：不改的话期望值是 `keep-both` ＋ `{}`，恰好等于对话框默认值——
    // 那种断言在「确认支把参数写死成默认值」的变异下依然绿（`#005-47` 的空转）。
    改判("资料/甲.txt", "skip")
    document.body.querySelector<HTMLElement>("[data-slot='restore-confirm']")!.click()

    await 等到(() => 假.恢复的.length === 1)
    // 全局仍是「保留两者」，但这一条被改成跳过 ⇒ 逐条表里必须只有这一条的显式选择。
    expect(假.恢复的).toEqual([
      ["p-42", "s-1", "资料/甲.txt", "keep-both", '{"资料/甲.txt":"skip"}'],
    ])
  })

  test("全局决策透传：对话框里选「跳过」⇒ restoreBackup 收到 decision: \"skip\"（N-3）", async () => {
    // 上一条只钉了逐条 `decisions`；接线层若把 `decision` 写死成默认的 `keep-both`，那条仍绿。
    // 这里把**全局**拨到 skip（与默认值不同），判据直接落在传给接口的第一个决策量上。
    const 有冲突 = 预览([{ path: "资料/甲.txt", status: "different" }])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 有冲突 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"]) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")
    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))
    await 等到(() => document.body.querySelector("[data-slot='restore-confirm']") !== null)

    const 全局 = document.body.querySelector<HTMLInputElement>(
      "[data-slot='restore-decision'][value='skip']",
    )
    if (!全局) throw new Error("对话框里没有全局决策的 skip 单选项——这条用例的前提不成立（#004-14）")
    全局.checked = true
    全局.dispatchEvent(new Event("change", { bubbles: true }))
    document.body.querySelector<HTMLElement>("[data-slot='restore-confirm']")!.click()

    await 等到(() => 假.恢复的.length === 1)
    expect(假.恢复的).toEqual([["p-42", "s-1", "资料/甲.txt", "skip", "{}"]])
  })

  test("type-mismatch 的默认 skip 由对话框补进 decisions，接线层原样透传（不再补一份）", async () => {
    // `type-mismatch` 没有「保留两者」；对话框默认把它记成 `skip` 并**显式**写进 `decisions`。
    // 这条钉的是**接线层没有二次加工**：改成 overwrite 之后，收到的就是 overwrite。
    const 类型冲突 = 预览([{ path: "资料/甲.txt", status: "type-mismatch" }])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 类型冲突 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"]) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")
    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))
    await 等到(() => document.body.querySelector("[data-slot='restore-confirm']") !== null)

    改判("资料/甲.txt", "overwrite")
    document.body.querySelector<HTMLElement>("[data-slot='restore-confirm']")!.click()

    await 等到(() => 假.恢复的.length === 1)
    expect(假.恢复的).toEqual([
      ["p-42", "s-1", "资料/甲.txt", "keep-both", '{"资料/甲.txt":"overwrite"}'],
    ])
  })

  test("预览里含 .git 内部路径（即使全 same）⇒ 拖拽入口也弹框，且出现 .git 警告（spec §6.4）", async () => {
    const 含git = 预览([{ path: ".git/config", status: "same" }])
    const { host } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      job: async (jobId) =>
        jobId === "job-preview"
          ? 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 含git } })
          : undefined,
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))

    await 等到(() => document.body.querySelector("[data-slot='restore-git-warning']") !== null)
    expect(
      document.body.querySelector("[data-component='backup-restore-dialog']") === null,
    ).toBe(false)
  })

  test("预览 entries 里看不到 .git、但 gitAffected 为真 ⇒ 拖拽入口同样弹框并警告（整支复审 F-6）", async () => {
    // `entries` 上限 2000 条：`.git/config` 排在第 2001 位时界面上看不到它，只有服务端按
    // **完整目标集合**判的 `gitAffected` 记得住。旧实现只看 `entries` ⇒ 直接恢复，绕过确认。
    const 截断的 = 预览([{ path: "资料/甲.txt", status: "missing" }], [], true)
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 截断的 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"]) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))

    await 等到(() => document.body.querySelector("[data-slot='restore-git-warning']") !== null)
    // 弹了框、出现了 `.git` 警告，且**没有**直接起恢复（旧实现实得 `假.恢复的` 已有一条；RED）。
    expect(document.body.querySelector("[data-component='backup-restore-dialog']") === null).toBe(false)
    expect(假.恢复的).toEqual([])
  })

  test("预览全是 missing / same ⇒ 不弹对话框、直接恢复（spec §6.1 拖拽入口）", async () => {
    const 无冲突 = 预览([{ path: "资料/甲.txt", status: "missing" }])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 无冲突 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"]) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))

    await 等到(() => 假.恢复的.length === 1)
    expect(假.恢复的[0]).toEqual(["p-42", "s-1", "资料/甲.txt", "keep-both", "{}"])
    // 反向对照：这条链**不该**冒出确认框（「直接恢复」这四个字就是判据）。
    expect(document.body.querySelector("[data-component='backup-restore-dialog']") === null).toBe(true)
  })

  /**
   * 拖**目录** ＝ 按目录路径整棵子树拉回（2026-10-18 用户下达）。
   *
   * 与上面那条文件用例成对：若下树把目录行的路径写错（例如退化成目录里某个文件），
   * 预览与恢复都只会覆盖一份——而这在界面上看不出来（结果条照样说「恢复完成」）。
   */
  test("拖下树的**目录**回上树 ⇒ 预览与恢复拿到的都是目录自身路径", async () => {
    const 无冲突 = 预览([{ path: "资料/甲.txt", status: "missing" }])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 无冲突 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"]) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料"), 树行按(host, "sandbox", "资料"))

    await 等到(() => 假.恢复的.length === 1)
    expect(假.预览的).toEqual([["p-42", "s-1", "资料"]])
    expect(假.恢复的[0]).toEqual(["p-42", "s-1", "资料", "keep-both", "{}"])
  })

  test("恢复完成文案分列替换目录与新建空目录（F-2）", async () => {
    // 服务端 `runRestore` 早已返回 `overwritten` / `dirsCreated`；客户端类型与文案漏了它们，
    // 于是「目录被文件替换」这类结果被说成「恢复 0 失败 0」——用户看不出发生了什么。
    const 无冲突 = 预览([{ path: "资料/甲.txt", status: "missing" }])
    const { host } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 无冲突 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"], { overwritten: ["x"], dirsCreated: ["y"] }) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))

    // 结果走**弹窗**（2026-10-18 用户下达）：它被 Portal 到 `document.body`，不在 host 里。
    await 等到(() => 文本在页("task-result-title") === "恢复完成")
    expect(文本在页("task-result-text")).toBe("恢复 1 个文件 · 替换 1 个目录 · 新建 1 个空目录")
    // 成功走 `role="status"`；**不进**那条恒红、`role="alert"` 的失败通道
    // （2026-10-18 之前正是后者：一次完全成功的恢复长得像报错）。
    expect(页面槽("task-result")?.getAttribute("role")).toBe("status")
    expect(页面槽("task-result")?.closest("[data-slot='dialog-content']") !== null).toBe(true)
    expect(text(host, "file-op-message") === undefined).toBe(true)

    // 关掉结果弹窗再收尾：留到下一条用例会让它残在 `document.body` 里，也会让 Provider 卸载时
    // 对已被 Kobalte 摘走的节点再 `removeChild`（`LEARNINGS #005-27` 的同族噪声）。
    页面槽("task-result-close")?.click()
    await 等到(() => 页面槽("task-result") === null)
    expect(页面槽("task-result") === null).toBe(true)
  })

  test("恢复有失败：弹窗只把**失败计数**标红，失败项直接列 path / reason", async () => {
    const 无冲突 = 预览([{ path: "资料/甲.txt", status: "missing" }])
    const { host } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 无冲突 } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: {
              restore: 恢复结果([], { failed: [{ path: "资料/甲.txt", reason: "permission denied" }] }),
            },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))

    await 等到(() => 文本在页("task-result-failed-count") === "1 项失败")
    expect(页面槽("task-result")?.getAttribute("role")).toBe("alert")
    // 「只红计数」：计数转危险色，整句不转（旧实现整句都红，成功失败长得一样）。
    expect(页面槽("task-result-failed-count")?.className).toContain("text-v2-state-fg-danger")
    expect(页面槽("task-result-text")?.className ?? "").not.toContain("text-v2-state-fg-danger")

    // 失败项**不用再点「详情」**：弹窗里直接摊开（2026-10-18 用户下达）。
    expect(文本在页("task-result-detail-path")).toBe("资料/甲.txt")
    expect(文本在页("task-result-detail-reason")).toBe("permission denied")

    页面槽("task-result-close")?.click()
    await 等到(() => 页面槽("task-result") === null)
    expect(页面槽("task-result") === null).toBe(true)
  })

  test("全 same ＋ localOnly 里只有 .git ⇒ 直接恢复、不弹框（localOnly 不会被恢复，spec §6.6）", async () => {
    // `需确认` 的 `.git` 判据只能看 `entries`：`localOnly` 是「只在本地」的那一份，永远不会被
    // 恢复覆盖 ⇒ 只含它的 `.git` 不该拦下这次拖拽（F-6）。对话框本身仍会对 localOnly 显示警告
    // ——那是 Task 16 已审的保守行为，本层不分叉。
    const 只有本地git = 预览([{ path: "资料/甲.txt", status: "same" }], [".git/config"])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      restoreBackup: async () => "job-restore",
      job: async (jobId) => {
        if (jobId === "job-preview")
          return 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 只有本地git } })
        if (jobId === "job-restore")
          return 任务("job-restore", "succeeded", {
            kind: "restore",
            result: { restore: 恢复结果(["资料/甲.txt"]) },
          })
        return undefined
      },
    })
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))

    await 等到(() => 假.恢复的.length === 1)
    expect(假.恢复的[0]).toEqual(["p-42", "s-1", "资料/甲.txt", "keep-both", "{}"])
    expect(document.body.querySelector("[data-component='backup-restore-dialog']") === null).toBe(true)
  })

  test("切恢复点 ⇒ 重取那个恢复点的明细，下树换成它的文件", async () => {
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1"), 快照("s-2")],
      snapshotDetail: async (_projectId, snapshotId) =>
        明细(快照(snapshotId), snapshotId === "s-1" ? ["资料/甲.txt"] : ["资料/乙.txt"]),
    })
    await 等到下树行(host, "资料/甲.txt")

    await 选恢复点(host, "s-2")

    await 等到下树行(host, "资料/乙.txt")
    expect(树行按(host, "minio", "资料/甲.txt") === null).toBe(true)
    expect(假.明细).toEqual([
      ["p-42", "s-1"],
      ["p-42", "s-2"],
    ])
  })

  test("切换项目那一刻就清空：新项目的恢复点还没回来时，旧项目的行不残留", async () => {
    const { host, 假 } = await 开备份(
      {
        // ⚠️ 必须**覆盖** `开备份` 的默认清单：不包含 p-2 的话，下面那个「项目从清单里消失」的
        // 守卫会立刻把信号清掉——那是另一条链，会把这条的判据搅成「怎么清都对」。
        list: async () => [私有("p-1", "甲", 1), 私有("p-2", "乙", 2)],
        // p-2 的清单**永远不回来**：判据只能由「切换那一刻清空」达成，不能被新数据覆盖掉。
        snapshots: async (projectId) =>
          projectId === "p-1" ? [快照("s-1")] : new Promise<never>(() => {}),
        snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
        // 用量给到 **90%**：自 2026-10-18 起低于 80% 不显示（用户的裁定），而这条用例拿
        // 「用量确实画出来了」当前置——喂 100 字节会让前置恒假、红在前提上（`#006-17`）。
        backupStatus: async (projectId) => (projectId === "p-1" ? 状态(null, 9 * 1024 ** 3) : undefined),
      },
      "p-1",
    )
    await 等到下树行(host, "资料/甲.txt")
    expect(槽(host, "minio-tree-usage") === null).toBe(false) // 前置：旧项目的用量确实在

    setCurrentProject({ id: "p-2", name: "乙" })
    await 冲一遍()

    // 瞬时判据：不等 p-2 的清单（它永远不来），旧项目的行必须已经不在。
    expect(host.querySelectorAll("[data-tree='minio'] [data-slot='file-tree-row']").length).toBe(0)
    // 前置：p-2 的重取**确实发起了**（不是「什么都没问所以看着干净」）。
    await 等到(() => 假.恢复点.includes("p-2"))
    expect(假.心跳).toEqual(["p-1", "p-2"])
  })

  test("上一个项目的恢复点清单迟到 ⇒ 丢掉，不画进新项目（代次守卫）", async () => {
    let 放回: (清单: readonly BackupSnapshot[] | undefined) => void = () => {}
    const 旧的清单 = new Promise<readonly BackupSnapshot[] | undefined>((resolve) => {
      放回 = resolve
    })
    const { host, 假 } = await 开备份(
      {
        list: async () => [私有("p-1", "甲", 1), 私有("p-2", "乙", 2)],
        snapshots: async (projectId) => (projectId === "p-1" ? 旧的清单 : []),
        snapshotDetail: async () => 明细(快照("s-旧"), ["资料/旧.txt"]),
      },
      "p-1",
    )
    await 等到(() => 假.恢复点.includes("p-1")) // p-1 的请求发出去了，但清单还挂着

    setCurrentProject({ id: "p-2", name: "乙" })
    await 冲一遍()
    expect(text(host, "minio-tree-empty")).toBe("还没有备份") // p-2 明确说了空

    // 旧项目那份迟到：它既不能把清单写回来，也不能把文件画回下树。
    放回([快照("s-旧")])
    await 冲一遍()
    await 冲一遍()

    expect(树行按(host, "minio", "资料/旧.txt") === null).toBe(true)
    expect(text(host, "minio-tree-empty")).toBe("还没有备份")
    expect(当前恢复点(host)).toBe("")
  })

  test("当前项目从清单里消失（被删 / 归档）⇒ 清空信号并作废在飞请求：迟到的旧恢复点不写回", async () => {
    // R-4.6 的第二条触发：`currentProject` **没变**，变的是「它还在不在清单里」。
    // 删项目那条链只重拉清单、不保证先清当前项目 ⇒ 少了这份守卫，界面会一直挂着已删项目的恢复点。
    //
    // ⚠️ 这里必须让**在飞的请求迟到**：只判「清空后界面空」的话，删掉守卫、甚至删掉代次递增都
    // 仍绿——清空本身就把行抹掉了。真正会残留的是「清空之后，旧回包把清单又写回来」。
    let 放回: (清单: readonly BackupSnapshot[] | undefined) => void = () => {}
    const 旧的清单 = new Promise<readonly BackupSnapshot[] | undefined>((resolve) => {
      放回 = resolve
    })
    const { host, 假 } = await 开备份({
      snapshots: async () => 旧的清单,
      snapshotDetail: async () => 明细(快照("s-旧"), ["资料/旧.txt"]),
    })
    await 等到(() => 假.恢复点.includes("p-42")) // 请求已发出、清单挂着

    setProjectList([])
    await 冲一遍()

    await 等到(() => text(host, "minio-tree-empty") === "备份清单未接入")
    expect(树行按(host, "minio", "资料/旧.txt") === null).toBe(true)

    // 清空之后旧回包才回：没有代次递增的话，`还有效()`（代次 ＋ 项目 id）仍成立 ⇒ 写回。
    放回([快照("s-旧")])
    await 冲一遍()
    await 冲一遍()

    expect(树行按(host, "minio", "资料/旧.txt") === null).toBe(true)
    expect(当前恢复点(host)).toBe("")
  })

  test("右键「备份到 MinIO」⇒ backup(项目, \"\", false)——菜单项不再是灰的", async () => {
    const { host, 假 } = await 开备份({
      snapshots: async () => [],
      backup: async () => ({ jobId: "j-1" }),
    })
    await 等到(() => 假.恢复点.length >= 1)

    右键行(host, "报告.docx")
    点菜单项("backup")

    await 等到(() => 假.起的备份.length === 1)
    expect(假.起的备份).toEqual([["p-42", "", false]])
  })

  test("右键「从 MinIO 拉回」：有选中恢复点 ⇒ 用当前恢复点起预览", async () => {
    const 有冲突 = 预览([{ path: "报告.docx", status: "different" }])
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      previewRestore: async () => "job-preview",
      job: async (jobId) =>
        jobId === "job-preview"
          ? 任务("job-preview", "succeeded", { kind: "preview", result: { preview: 有冲突 } })
          : undefined,
    })
    await 等到下树行(host, "资料/甲.txt")

    右键行(host, "报告.docx")
    点菜单项("restore")

    await 等到(() => 假.预览的.length === 1)
    expect(假.预览的).toEqual([["p-42", "s-1", "报告.docx"]])
  })

  test("右键「从 MinIO 拉回」：没有选中恢复点 ⇒ 说一句、一个接口都不调（amend R-4.5 的替代实现，不是菜单禁用）", async () => {
    const { host, 假 } = await 开备份({ snapshots: async () => [] })
    await 等到(() => 假.恢复点.length >= 1)

    右键行(host, "报告.docx")
    点菜单项("restore")
    await 冲一遍()

    expect(假.预览的).toEqual([])
    expect(text(host, "file-op-message")).toBe("先在下树里选一个恢复点")
  })

  test("删除恢复点：只出确认框，deleteSnapshot 还没调用", async () => {
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
    })
    await 等到(() => 当前恢复点(host) === "s-1")

    await 点删恢复点(host)
    await 等到(() => document.body.querySelector("[data-kind='delete-snapshot']") !== null)

    // 两条独立判据：① 确认框出来了；② 还没删（先确认后调用，spec §8.5）。
    expect(document.body.querySelector("[data-kind='delete-snapshot']")?.textContent ?? "").toContain(
      "删除这个恢复点？",
    )
    expect(假.删的恢复点).toEqual([])

    // 收尾：把框关掉。留着它会在卸载时与 Kobalte 的退场计时器打架（下一条用例开头会读到
    // happy-dom 的 `removeChild` DOMException，是**上一条**的残留、不是产品行为）。
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-cancel']")?.click()
    await 冲一遍()
  })

  test("删除恢复点：回包之前确认框不关，主按钮显示「正在删除…」", async () => {
    // 2026-10-21 用户真栈反馈：「点了删除没变化也没提示，不知道是没删还是还在跑」。
    // DELETE 在服务端同步跑 GC（实测 500 个文件 806ms，真 MinIO 更久）⇒ 回包前若把框一关、
    // 清单原样留在屏幕上，「还在删」与「压根没删」长得一模一样。
    let 放回删: (成: boolean) => void = () => {}
    const 挂起的删 = new Promise<boolean>((resolve) => {
      放回删 = resolve
    })
    const { host, 假 } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      deleteSnapshot: async () => 挂起的删,
    })
    await 等到(() => 当前恢复点(host) === "s-1")

    await 点删恢复点(host)
    await 等到(
      () => document.body.querySelector("[data-kind='delete-snapshot'] [data-slot='backup-confirm-ok']") !== null,
    )
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()
    await 冲一遍()

    // ① 框还开着（不是「节点还在退场」）；② 按钮说得出「正在删」；③ 再点不会发第二次。
    expect(框开着("delete-snapshot")).toBe(true)
    const 钮 = document.body.querySelector<HTMLButtonElement>("[data-slot='backup-confirm-ok']")
    expect(钮?.textContent ?? "").toContain("正在删除…")
    expect(钮?.disabled).toBe(true)
    钮?.click()
    await 冲一遍()
    expect(假.删的恢复点.length).toBe(1)

    放回删(true)
    await 等到(() => document.body.querySelector("[data-kind='delete-snapshot']") === null)
  })

  test("删除恢复点：办成后先刷新清单再关框，并弹「恢复点已删除」", async () => {
    // 关框那一刻清单必须已经刷新——否则框没了、那一行还在，用户看到的仍是「没变化」。
    let 放回清单: (清单: readonly BackupSnapshot[]) => void = () => {}
    const 慢清单 = new Promise<readonly BackupSnapshot[]>((resolve) => {
      放回清单 = resolve
    })
    let 清单次 = 0
    const { host, 假 } = await 开备份({
      snapshots: async () => {
        清单次 += 1
        return 清单次 === 1 ? [快照("s-1")] : 慢清单
      },
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      deleteSnapshot: async () => true,
    })
    await 等到(() => 当前恢复点(host) === "s-1")

    await 点删恢复点(host)
    await 等到(
      () => document.body.querySelector("[data-kind='delete-snapshot'] [data-slot='backup-confirm-ok']") !== null,
    )
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()
    await 等到(() => 假.删的恢复点.length === 1)
    await 等到(() => 清单次 === 2) // 删除已回包，重取清单还挂着

    // RED（修前）：实现在回包前就 `dialog.close()` ⇒ 这里框已经关了，屏幕上清单还停在旧的。
    expect(框开着("delete-snapshot")).toBe(true)
    // 还没刷新完，先别宣布「已删除」（`#006-29`：状态文案不能跑在事实前面）。
    expect(提示文本("success")).toBeNull()

    放回清单([])
    await 等到(() => document.body.querySelector("[data-kind='delete-snapshot']") === null)
    await 等到(() => text(host, "minio-tree-empty") === "还没有备份")
    expect(提示文本("success") ?? "").toContain("恢复点已删除")
  })

  test("删除恢复点：失败要当场说清（error 提示），不只写在中栏那行", async () => {
    // 失败原因客户端只拿到布尔值（409 / 503 / 网络都折成 `false`），说不了细节，但**必须**
    // 在动作点上吭声——中栏那行离 MinIO 窗口很远，用户根本不知道刚才那一下怎么了。
    const { host } = await 开备份({
      snapshots: async () => [快照("s-1")],
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      deleteSnapshot: async () => false,
    })
    await 等到(() => 当前恢复点(host) === "s-1")

    await 点删恢复点(host)
    await 等到(
      () => document.body.querySelector("[data-kind='delete-snapshot'] [data-slot='backup-confirm-ok']") !== null,
    )
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()

    await 等到(() => 提示文本("error") !== null)
    expect(提示文本("error") ?? "").toContain("恢复点没删掉")
    // 一次动作一条反馈：框要收回，不叠两层。
    await 等到(() => document.body.querySelector("[data-kind='delete-snapshot']") === null)
  })

  test("删除恢复点：确认后才调用，并把恢复点清单重取一遍（项目文件清单不跟着拨）", async () => {
    let 删过 = false
    const { host, 假 } = await 开备份({
      snapshots: async () => (删过 ? [] : [快照("s-1")]),
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      deleteSnapshot: async () => {
        删过 = true
        return true
      },
    })
    await 等到(() => 当前恢复点(host) === "s-1")
    expect(假.files.length).toBe(1) // 前置：项目文件清单只取过一次

    await 点删恢复点(host)
    await 等到(
      () => document.body.querySelector("[data-kind='delete-snapshot'] [data-slot='backup-confirm-ok']") !== null,
    )
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()

    await 等到(() => 假.删的恢复点.length === 1)
    expect(假.删的恢复点).toEqual([["p-42", "s-1"]])
    // 删除后的重取是**备份状态**那条链：恢复点清单再取一次（初始 1 ＋ 删后 1）。
    await 等到(() => 假.恢复点.length === 2)
    await 等到(() => text(host, "minio-tree-empty") === "还没有备份")
    // 反向对照：它**不能**拨 `清单重取`（那条是项目文件清单）——拨了就等于每次删恢复点都重取一遍文件树。
    expect(假.files.length).toBe(1)
  })

  test("删除请求回包前切走项目 ⇒ 失败文案不落到新项目（整支复审 F-4）", async () => {
    // `deleteSnapshot` 跨了 await：切走项目之后，旧项目那次删除的失败结果不能把
    // 「恢复点没删掉」写到新项目的中栏上（与 `跑恢复` / `备份` 同形，进门捕获 `{ id, 代 }`）。
    let 放回删: (成: boolean) => void = () => {}
    const 挂起的删 = new Promise<boolean>((resolve) => {
      放回删 = resolve
    })
    const { host, 假 } = await 开备份(
      {
        list: async () => [私有("p-1", "甲", 1), 私有("p-2", "乙", 2)],
        snapshots: async () => [快照("s-1")],
        snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
        deleteSnapshot: async () => 挂起的删,
      },
      "p-1",
    )
    await 等到(() => 当前恢复点(host) === "s-1")

    await 点删恢复点(host)
    await 等到(
      () => document.body.querySelector("[data-kind='delete-snapshot'] [data-slot='backup-confirm-ok']") !== null,
    )
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()
    await 等到(() => 假.删的恢复点.length === 1)

    setCurrentProject({ id: "p-2", name: "乙" })
    await 冲一遍()
    放回删(false)
    await 冲一遍()
    await 冲一遍()

    // 无守卫时实得一条「恢复点没删掉」的 error 提示（RED）——用户已经切走，说什么都不属于这里。
    expect(提示文本("error")).toBeNull()
    // 框也得收回：不能把一个「正在删除…」的框晾在已经切走的项目上。
    await 等到(() => document.body.querySelector("[data-kind='delete-snapshot']") === null)
  })

  test("同项目两次重取乱序：旧回包不覆盖新清单（N-2）", async () => {
    // 删除恢复点后的重取（#2）慢、`job_running` 支的重取（#3）后发先至。没有 `代 === 重取代次`
    // 的话，#2 回来时会把已经不在的 s-1 清单写回去，连选中项都跳回去。
    let 放回清单: (清单: readonly BackupSnapshot[]) => void = () => {}
    const 慢清单 = new Promise<readonly BackupSnapshot[]>((resolve) => {
      放回清单 = resolve
    })
    let 清单次 = 0
    const { host, 假 } = await 开备份({
      snapshots: async () => {
        清单次 += 1
        if (清单次 === 1) return [快照("s-1")]
        // #2（删完的重取）挂着；#3（job_running 的重取）直接给新清单。
        return 清单次 === 2 ? 慢清单 : [快照("s-2")]
      },
      snapshotDetail: async (_projectId, snapshotId) =>
        明细(快照(snapshotId), snapshotId === "s-2" ? ["资料/乙.txt"] : ["资料/甲.txt"]),
      deleteSnapshot: async () => true,
      backup: async () => ({ code: "job_running", jobId: "j-9" }),
    })
    await 等到(() => 当前恢复点(host) === "s-1")

    await 点删恢复点(host)
    await 等到(
      () => document.body.querySelector("[data-kind='delete-snapshot'] [data-slot='backup-confirm-ok']") !== null,
    )
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()
    await 等到(() => 清单次 >= 2) // #2 已发出、清单挂着
    expect(假.删的恢复点).toEqual([["p-42", "s-1"]]) // 前置：删除确实办成了，重取才有意义

    右键行(host, "报告.docx")
    点菜单项("backup") // `job_running` 支 ⇒ 再取一次状态（#3）
    await 等到(() => 当前恢复点(host) === "s-2")

    // #2 这时才回来：它的清单已经过期，不得覆盖 #3 的 s-2。
    放回清单([快照("s-1")])
    await 冲一遍()
    await 冲一遍()

    expect(当前恢复点(host)).toBe("s-2")
    // 先等新清单那一行出现（`等到下树行` 会点「全部展开」）：树默认全收缩，不展开的话
    // 「甲.txt 不在」是被**折叠**满足的，不是被「旧回包没覆盖」满足的（`#006-17`）。
    await 等到下树行(host, "资料/乙.txt")
    expect(树行按(host, "minio", "资料/甲.txt") === null).toBe(true)
  })

  test("预览还没回来就切走项目 ⇒ 回包不落进新项目：不弹框、也不写文件话（F-8）", async () => {
    // 「等任务」与「拉回」跨了 await；切项目（以及卸载）之后，旧项目的预览结果既不能开对话框，
    // 也不能把「预览没取到」之类的话写到新项目的中栏上。
    let 放回任务: (job: BackupJob | undefined) => void = () => {}
    const 挂起的任务 = new Promise<BackupJob | undefined>((resolve) => {
      放回任务 = resolve
    })
    const { host, 假 } = await 开备份(
      {
        list: async () => [私有("p-1", "甲", 1), 私有("p-2", "乙", 2)],
        snapshots: async () => [快照("s-1")],
        snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
        previewRestore: async () => "job-preview",
        job: async (jobId) => (jobId === "job-preview" ? 挂起的任务 : undefined),
      },
      "p-1",
    )
    await 等到下树行(host, "资料/甲.txt")

    拖到(树行按(host, "minio", "资料/甲.txt"), 树行按(host, "sandbox", "资料/甲.txt"))
    await 等到(() => 假.预览的.length === 1)

    setCurrentProject({ id: "p-2", name: "乙" })
    await 冲一遍()
    放回任务(
      任务("job-preview", "succeeded", {
        kind: "preview",
        // 有冲突 ⇒ 若守卫失效，这里**一定**会弹框（判据因此不是「碰巧没弹」）。
        result: { preview: 预览([{ path: "资料/甲.txt", status: "different" }]) },
      }),
    )
    await 冲一遍()
    await 冲一遍()

    expect(document.body.querySelector("[data-component='backup-restore-dialog']") === null).toBe(true)
    expect(text(host, "file-op-message") === undefined).toBe(true)
  })

  test("终态任务不轮询：1 秒后再不重取恢复点", async () => {
    // ⚠️ 这条是**唯一**一条按真实时间等的用例：轮询间隔就是 1 秒，而判据是「1 秒之后**没有**
    // 发生第二件事」——没有可等的「条件」，只能等时间（`#006-31` 的例外，理由就写在判据本身）。
    // 终态任务会在注册表里留 10 分钟，所以「任务存在 ≠ 在跑」：`在跑()` 才是守卫。
    const { 假 } = await 开备份({
      snapshots: async () => [],
      backupStatus: async () => 状态(任务("j-done", "succeeded")),
    })
    await 等到(() => 假.恢复点.length >= 1)
    const 初 = 假.恢复点.length

    await 睡(1_300)

    expect(假.恢复点.length).toBe(初)
  })

  test("起备份撞上已在跑的任务（job_running）⇒ 说「正在备份」并把状态取回来（spec §11.6）", async () => {
    const { host, 假 } = await 开备份({
      snapshots: async () => [],
      backup: async () => ({ code: "job_running", jobId: "j-9" }),
    })
    await 等到(() => 假.恢复点.length >= 1)
    const 初 = 假.恢复点.length

    右键行(host, "报告.docx")
    点菜单项("backup")

    await 等到(() => text(host, "file-op-message")?.includes("正在备份") === true)
    // 同一分支必须**再取一次状态**：起没起来是一回事，界面上要接上那个已在跑的任务。
    await 等到慢(() => 假.恢复点.length > 初)
    expect(假.起的备份).toEqual([["p-42", "", false]])
  })

  test("删除占位 409（不带 jobId）⇒ 说「项目正在删除」，不冒充备份、也不重取（整支复审 F-5）", async () => {
    // 409 有两个来源：已有任务在跑（带 jobId，可接上进度）与项目删除占位（不带 jobId）。
    // 旧实现一律说「这个项目正在备份」并重取——对删除占位是句假话，还白取一遍清单。
    const { host, 假 } = await 开备份({
      snapshots: async () => [],
      backup: async () => ({ code: "job_running" }),
    })
    await 等到(() => 假.恢复点.length >= 1)
    const 初 = 假.恢复点.length

    右键行(host, "报告.docx")
    点菜单项("backup")

    await 等到(() => text(host, "file-op-message") === "项目正在删除，请稍后重试")
    // 旧实现实得「这个项目正在备份，已接上当前进度」（RED）——删除占位不是一次备份。
    expect(text(host, "file-op-message")).toBe("项目正在删除，请稍后重试")
    await 冲一遍()
    await 冲一遍()
    // 没有任务可接 ⇒ 不该为这件事再取一遍恢复点。
    expect(假.恢复点.length).toBe(初)
  })

  test("点窄条「取消」⇒ 对当前任务调 cancelJob(job.id)", async () => {
    const 运行中 = 任务("j-1", "uploading", {
      progress: { filesTotal: 2, filesDone: 1, bytesTotal: 10, bytesDone: 5 },
    })
    const { host, 假 } = await 开备份({
      snapshots: async () => [],
      backupStatus: async () => 状态(运行中),
    })

    await 等到(() => 槽(host, "minio-bar-cancel") !== null)
    槽(host, "minio-bar-cancel")?.click()

    await 等到(() => 假.取消的.length === 1)
    expect(假.取消的).toEqual(["j-1"])
  })

  test("删除后恢复点清单取不到 ⇒ 旧选中项也清掉（不能让恢复打到一个界面上已没有的恢复点）", async () => {
    // F-5：`清单 === undefined` 时若只清「下树的文件」、留着 `backupSnapshotId`，右键「从 MinIO
    // 拉回」仍会拿那个 id 起预览——界面上它已经不存在了。
    let 删过 = false
    const { host, 假 } = await 开备份({
      snapshots: async () => (删过 ? undefined : [快照("s-1")]),
      snapshotDetail: async () => 明细(快照("s-1"), ["资料/甲.txt"]),
      deleteSnapshot: async () => {
        删过 = true
        return true
      },
    })
    await 等到(() => 当前恢复点(host) === "s-1")

    await 点删恢复点(host)
    await 等到(
      () => document.body.querySelector("[data-kind='delete-snapshot'] [data-slot='backup-confirm-ok']") !== null,
    )
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()
    await 等到(() => 假.删的恢复点.length === 1)
    await 等到(() => text(host, "minio-tree-empty") === "备份清单未接入")

    右键行(host, "报告.docx")
    点菜单项("restore")
    await 冲一遍()

    // 选中项已清 ⇒ 只说话、不起预览（留着旧 id 的话这里会打 `previewRestore(p-42, s-1, …)`）。
    expect(假.预览的).toEqual([])
    expect(text(host, "file-op-message")).toBe("先在下树里选一个恢复点")
  })

  test("超限 409 ⇒ 弹确认框；确认后带 allowOverQuota=true 重试", async () => {
    const { host, 假 } = await 开备份({
      snapshots: async () => [],
      backup: async (_projectId, _path, allowOverQuota) =>
        allowOverQuota ? { jobId: "j-1" } : { code: "quota_exceeded" },
    })

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))

    await 等到(() => document.body.querySelector("[data-kind='quota'] [data-slot='backup-confirm-ok']") !== null)
    expect(假.起的备份).toEqual([["p-42", "", false]])
    expect(document.body.querySelector("[data-kind='quota']")?.textContent ?? "").toContain("10 GB")

    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()

    await 等到(() => 假.起的备份.length === 2)
    expect(假.起的备份).toEqual([
      ["p-42", "", false],
      ["p-42", "", true],
    ])
  })

  test("超限重试（手动备份第二入口）预检期同样有进度、可取消；回包后正常跟进（G-1）", async () => {
    // `备份越限` 同样 `await projectData.backup(..., true)`，超限确认后大项目的预检也在 HTTP
    // 请求内。F-1 只接了 `备份()` 这个入口；同一个修法落在两个动作上，要两条用例（`#005-12`）。
    let 放回请求: (值: { jobId: string }) => void = () => {}
    const 请求 = new Promise<{ jobId: string }>((resolve) => {
      放回请求 = resolve
    })
    let 重试过 = false
    const 运行中 = 任务("j-2", "hashing")
    const { host, 假 } = await 开备份({
      snapshots: async () => [],
      backup: async (_projectId, _path, allowOverQuota) => {
        if (!allowOverQuota) return { code: "quota_exceeded" }
        重试过 = true
        return 请求
      },
      backupStatus: async () => 状态(重试过 ? 运行中 : null),
      job: async (jobId) => 任务(jobId, "succeeded", { result: { snapshotId: "s-new" } }),
    })

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))
    await 等到(() => document.body.querySelector("[data-kind='quota'] [data-slot='backup-confirm-ok']") !== null)
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()

    // 第二次请求还挂着（没有 202、没有 jobId）——进度与取消钮必须已经出现。
    await 等到(() => 槽(host, "minio-bar-progress") !== null)
    expect(槽(host, "minio-bar-progress") === null).toBe(false)
    expect(text(host, "minio-bar-stage")).toBe("正在校验…")
    const 取消 = 槽(host, "minio-bar-cancel")
    if (!取消) throw new Error("超限重试的预检期没有取消钮——这条用例的前提不成立（#004-14）")
    取消.click()
    await 等到(() => 假.取消的.length === 1)
    expect(假.取消的).toEqual(["j-2"])

    // 回包 202 之后既有行为照旧：重取状态、跟进任务。
    放回请求({ jobId: "j-2" })
    await 等到(() => 假.起的备份.length === 2)
    await 等到慢(() => 假.恢复点.length >= 2)
    expect(假.起的备份).toEqual([
      ["p-42", "", false],
      ["p-42", "", true],
    ])
  })

  test("超限框开在 p-1、切到 p-2 再点确认 ⇒ 不以新项目身份重试（S-1）", async () => {
    // 框是 p-1 的；点确认时若现读 `currentProject()`，就会以 p-2 身份备份 p-1 的旧路径。
    const { host, 假 } = await 开备份(
      {
        list: async () => [私有("p-1", "甲", 1), 私有("p-2", "乙", 2)],
        snapshots: async () => [],
        backup: async (_projectId, _path, allowOverQuota) =>
          allowOverQuota ? { jobId: "j-1" } : { code: "quota_exceeded" },
      },
      "p-1",
    )

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))
    await 等到(() => document.body.querySelector("[data-kind='quota'] [data-slot='backup-confirm-ok']") !== null)
    expect(假.起的备份).toEqual([["p-1", "", false]])

    setCurrentProject({ id: "p-2", name: "乙" })
    await 冲一遍()
    document.body.querySelector<HTMLElement>("[data-slot='backup-confirm-ok']")!.click()
    await 冲一遍()
    await 冲一遍()

    // 只有 p-1 那一次；任何以 p-2 身份起来的备份（尤其带 `true` 的）都是这条守的失败。
    expect(假.起的备份).toEqual([["p-1", "", false]])
  })

  test("backup() 在飞时切项目，回包 quota_exceeded 不弹框、不写文案（S-1）", async () => {
    type 备份回包 = Awaited<ReturnType<ProjectData["backup"]>>
    let 放回: (回包: 备份回包) => void = () => {}
    const 挂起的备份 = new Promise<备份回包>((resolve) => {
      放回 = resolve
    })
    const { host, 假 } = await 开备份(
      {
        list: async () => [私有("p-1", "甲", 1), 私有("p-2", "乙", 2)],
        snapshots: async () => [],
        backup: async () => 挂起的备份,
      },
      "p-1",
    )

    拖到(树行按(host, "sandbox", "报告.docx"), 槽(host, "minio-tree"))
    await 等到(() => 假.起的备份.length === 1)

    setCurrentProject({ id: "p-2", name: "乙" })
    await 冲一遍()
    放回({ code: "quota_exceeded" })
    await 冲一遍()
    await 冲一遍()

    // 回包属于 p-1：既不能在 p-2 上开超限框，也不能写一句不属于这里的话。
    expect(document.body.querySelector("[data-kind='quota']") === null).toBe(true)
    expect(text(host, "file-op-message") === undefined).toBe(true)
  })
})

/**
 * AI 资产工作台（009 T005 / D0-3 / D0-6）。
 *
 * 三条轴各钉一次：**左栏换内容**（不是换模块就整列消失）、**中栏走模块级视图**（文件 tab 保留
 * 在状态里但不可见）、**右栏投影不换**（仍停在进入前的业务模块）。
 */
/**
 * 左栏分类夹具（需求 4，2026-10-27）。
 *
 * 分类的唯一来源是服务端，`WorkspaceEntry` 只认**注入的**访问器（见它 `categories` prop）。
 * 这里拿 seed 的九类当替身——**这不是生产读法**，生产实现是 `ai-assets/categories.ts`
 * 走 `GET /openhive/categories`；组件测试里注入替身才保持离线。
 */
const 分类夹具 = [...ASSET_CATEGORY_SEED].map(({ id, name }) => ({ id, name }))

/** 每次挂载给一份新的（不共享模块级对象，`LEARNINGS #005-03`）。 */
const 假分类 = (): AssetCategories => ({ rows: () => 分类夹具, error: () => undefined, reload: () => {} })

describe("AI 资产工作台（009 T005）", () => {
  const 进入 = (host: HTMLElement) => 入口(host, "AI 资产").click()

  test("点「AI 资产」⇒ 左栏换成纯导航；项目侧栏让位、左栏仍在、项目管理那颗不高亮", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    expect(host.querySelector("[data-component='project-sidebar']")).not.toBeNull()

    进入(host)

    expect(currentModule(host)).toBe("AI 资产")
    expect(host.querySelector("[data-component='asset-nav']")).not.toBeNull()
    expect(不存在(host, "[data-component='project-sidebar']")).toBe(true)
    expect(host.querySelector("[data-slot='three-pane-left']")).not.toBeNull()
    // 「项目管理」那颗只代表项目左栏的开关 ⇒ AI 资产下必须灭（左栏开着不代表项目左栏开着）。
    expect(左栏开着(host)).toBe(false)
  })

  test("左栏导航三组齐备，且**不列资产行**", () => {
    const host = mount(() => <WorkspaceEntry categories={假分类()}>中栏</WorkspaceEntry>)
    进入(host)

    // 空间筛选项 = 可见范围档数（需求 3b 起四档），与「三组」无关。
    expect(host.querySelectorAll("[data-slot='asset-space']").length).toBe(4)
    expect(host.querySelectorAll("[data-slot='asset-type-tab']").length).toBe(3)
    expect(host.querySelectorAll("[data-slot='asset-category']").length).toBe(9)
    expect(host.querySelectorAll("[data-slot='asset-item']").length).toBe(0)
  })

  test("中栏走模块级视图：注入的页面让位；切回项目后它回来（状态没被清空）", () => {
    const host = mount(() => (
      <WorkspaceEntry>
        <div data-slot="center-content">中栏内容</div>
      </WorkspaceEntry>
    ))
    expect(text(host, "center-content")).toBe("中栏内容")

    进入(host)

    expect(host.querySelector("[data-slot='asset-center']")).not.toBeNull()
    expect(不存在(host, "[data-slot='center-content']")).toBe(true)

    // 点「项目管理」= 切回 project 并开左栏（既有语义）⇒ 中栏的注入页面照旧可用。
    入口(host, "项目管理").click()
    expect(text(host, "center-content")).toBe("中栏内容")
  })

  test("进入 AI 资产不换右栏投影：停在进入前的业务模块，离开后继续跟随", () => {
    const 投影探针 = () => {
      const 投影 = useProjectionModule()
      return <div data-slot="projection-probe">{投影() ?? "无"}</div>
    }
    const host = mount(() => <WorkspaceEntry right={() => <投影探针 />}>中栏</WorkspaceEntry>)
    const 读 = () => text(host, "projection-probe")

    expect(读()).toBe("project")

    入口(host, "资金分析").click()
    expect(读()).toBe("fund-analysis")

    进入(host)
    expect(读()).toBe("fund-analysis")

    入口(host, "话单分析").click()
    expect(读()).toBe("cdr-analysis")
  })
})

/**
 * T017 接线：**进入** AI 资产视图才通知外面拉取，且每次进入都通知。
 *
 * 为什么不是「挂载时拉一次」：用户刚发布完就切过来，挂载时拉的清单里没有它——
 * 「刚发布却看不见」正是本轮要修的病；换成「刷新页面才看得见」等于没修。
 */
describe("AI 资产取数接线（T017）", () => {
  test("挂在项目管理时不通知；点「AI 资产」通知一次；切走再切回来再通知一次", () => {
    const 次数: number[] = []
    const host = mount(() => <WorkspaceEntry onAssetsOpen={() => 次数.push(次数.length)}>中栏</WorkspaceEntry>)

    // 默认停在项目管理：没人要资产，就不该有请求。
    expect(次数.length).toBe(0)

    入口(host, "AI 资产").click()
    expect(次数.length).toBe(1)

    入口(host, "项目管理").click()
    expect(次数.length).toBe(1)

    入口(host, "AI 资产").click()
    expect(次数.length).toBe(2)
  })

  test("省略 onAssetsOpen：点「AI 资产」不崩（注入缝是可选的）", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    expect(() => 入口(host, "AI 资产").click()).not.toThrow()
  })
})

/**
 * AI 资产中栏（009 T006 / T007）：搜索 + 卡片网格 + 详情面板，左栏与中栏**共享同一份筛选**。
 *
 * 数据走 `assets` 注入缝（`/assets` 接口未落，见 `state.md`）——这里注入夹具，
 * 顺带钉住「不注入时不造假数据」。
 */
describe("AI 资产中栏（009 T006 / T007）", () => {
  const 进入 = (host: HTMLElement) => 入口(host, "AI 资产").click()

  function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
    return {
      id: "asset-1",
      name: "资金流向研判",
      type: "skill",
      description: "按账户汇总资金往来",
      icon: "skill",
      category: 分类夹具[0].id,
      tags: ["资金"],
      ownerId: "u1",
      ownerName: "张三",
      department: "经侦支队",
      visibility: "global",
      version: 1,
      status: "published",
      favoriteCount: 0,
      usageCount: 0,
      rating: 0,
      ratingCount: 0,
      feedbackCount: 0,
      createdAt: 1,
      updatedAt: 1,
      publishedAt: 1,
      archivedAt: null,
      ...over,
    }
  }

  /**
   * 服务端替身（需求 6）：筛选与分页都已下推服务端，组件只负责**把条件交出去、把回包画出来**。
   * 这里按条件在测试里筛一遍，代替那条 WHERE——本层要证明的是接线，不是筛选口径
   * （口径在 `packages/asset-service/src/asset.ts` 的 `search` 条件与 `readable-sql.ts`）。
   *
   * ⚠️ **必须在 JSX 外先造好再传**（`const 目录 = 假目录([...])`）：Solid 的组件 props 是
   * getter，`catalog={假目录([...])}` 会被**每次读取都重跑一遍**——于是 `AssetCenter` 取数
   * effect 写的信号与网格读的信号不是同一份（实测一次用例新建 5 份），数据一变网格就不跟。
   */
  function 假目录(rows: readonly AssetMetadata[]): AssetCatalog {
    const [清单, set清单] = createSignal<readonly AssetMetadata[]>(rows)
    return {
      assets: 清单,
      total: () => 清单().length,
      page: () => 1,
      pageSize: () => 20,
      // 需求 2：本夹具不覆盖「其他」桶的原分类标注，空表即可（卡片不画那枚徽章）。
      categoryNames: () => ({}),
      error: () => undefined,
      load: (query) => {
        const 词 = (query.q ?? "").trim().toLowerCase()
        const 过滤 = rows.filter(
          (asset) =>
            (query.type === undefined || asset.type === query.type) &&
            (query.spaces === undefined || query.spaces.includes(asset.visibility)) &&
            (query.category === undefined || asset.category === query.category) &&
            (词 === "" ||
              [asset.name, asset.description, ...asset.tags].some((文本) => 文本.toLowerCase().includes(词))),
        )
        set清单(过滤)
      },
      goPage: () => {},
      setPageSize: () => {},
      reload: () => {},
    }
  }

  /**
   * 等效果跑一趟（需求 6）：查询由 `AssetCenter` 的 effect 交给数据源，不在点击的那一拍照完；
   * 搜索框还有 250ms 防抖（`asset-center.tsx` 的 `搜索防抖ms`）。
   */
  const 等一拍 = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

  const 卡片 = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-slot='asset-card']")]
  const 卡片名 = (host: HTMLElement) => 卡片(host).map((card) => card.textContent ?? "")

  test("中栏是搜索框 + 网格：注入的资产按默认筛选出现在卡片里", () => {
    const 目录 = 假目录([资产({ id: "a", name: "技能甲" }), 资产({ id: "b", name: "技能乙" })])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录}>中栏</WorkspaceEntry>
    ))
    进入(host)

    expect(host.querySelector("[data-slot='asset-search']")).not.toBeNull()
    expect(host.querySelector("[data-slot='asset-search-input']")?.getAttribute("aria-label")).toBe("搜索资产")
    expect(host.querySelector("[data-slot='asset-grid']")).not.toBeNull()
    expect(卡片(host)).toHaveLength(2)
    expect(卡片名(host).join()).toContain("技能甲")
  })

  test("左栏点类型 ⇒ 中栏跟着换（同一份筛选，不是各建一份）", async () => {
    const 目录 = 假目录([
      资产({ id: "a", name: "技能甲", type: "skill" }),
      资产({ id: "b", name: "MCP 乙", type: "mcp" }),
    ])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录}>中栏</WorkspaceEntry>
    ))
    进入(host)
    expect(卡片名(host)).toHaveLength(1)
    expect(卡片名(host)[0]).toContain("技能甲")

    host.querySelector<HTMLElement>("[data-slot='asset-type-tab'][data-type='mcp']")!.click()
    await 等一拍()

    expect(卡片(host)).toHaveLength(1)
    expect(卡片名(host)[0]).toContain("MCP 乙")
  })

  test("左栏换分类 ⇒ 中栏只剩该分类", async () => {
    const 目录 = 假目录([
      资产({ id: "a", name: "第一类", category: 分类夹具[0].id }),
      资产({ id: "b", name: "第二类", category: 分类夹具[1].id }),
    ])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录} categories={假分类()}>中栏</WorkspaceEntry>
    ))
    进入(host)
    // 默认**不筛分类**（T017 裁定）：两类都在，第一屏就是「我能用的东西」。
    expect(卡片(host)).toHaveLength(2)

    const 第二类 = host.querySelector<HTMLElement>(
      `[data-slot='asset-category'][data-category='${分类夹具[1].id}']`,
    )!
    第二类.click()
    await 等一拍()

    expect(卡片(host)).toHaveLength(1)
    expect(卡片名(host)[0]).toContain("第二类")

    // 再点一次 ⇒ 收起分类、回到全部（与空间全选、搜索留空同一种姿态）。
    第二类.click()
    await 等一拍()
    expect(卡片(host)).toHaveLength(2)
  })

  test("搜索框过滤中栏（防抖后发查询）；清空恢复全部", async () => {
    const 目录 = 假目录([
      资产({ id: "a", name: "FundFlow", description: "账户汇总", tags: [] }),
      资产({ id: "b", name: "话单分析", description: "通话记录", tags: [] }),
    ])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录}>中栏</WorkspaceEntry>
    ))
    进入(host)
    const 输入 = host.querySelector<HTMLInputElement>("[data-slot='asset-search-input']")!

    输入.value = "fund"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await 等一拍(300)
    expect(卡片(host)).toHaveLength(1)
    expect(卡片名(host)[0]).toContain("FundFlow")

    host.querySelector<HTMLButtonElement>("[data-slot='asset-search-clear']")!.click()
    await 等一拍(300)
    expect(卡片(host)).toHaveLength(2)
  })

  test("不注入数据源 ⇒ 空态，不造假卡", () => {
    const host = mount(() => <WorkspaceEntry>中栏</WorkspaceEntry>)
    进入(host)

    expect(卡片(host)).toHaveLength(0)
    expect(text(host, "asset-empty")).toBe("没有符合条件的资产")
  })

  const 浏览区 = (host: HTMLElement) =>
    host.querySelector<HTMLElement>("[data-slot='asset-center-browse']")!
  const 打开卡 = (host: HTMLElement, 名称: string) => {
    const card = 卡片(host).find((el) => el.textContent?.includes(名称))
    expect(card).toBeDefined()
    card!.querySelector<HTMLButtonElement>("[data-slot='asset-card-open']")!.click()
  }

  test("点卡片 ⇒ 详情面板替换网格，头部与四 tab 就位，焦点落在返回", () => {
    const 目录 = 假目录([资产({ id: "a", name: "技能甲", description: "甲的做法", tags: ["甲"] })])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录}>中栏</WorkspaceEntry>
    ))
    进入(host)
    expect(浏览区(host).classList.contains("hidden")).toBe(false)

    打开卡(host, "技能甲")

    expect(浏览区(host).classList.contains("hidden")).toBe(true)
    expect(text(host, "asset-detail-name")).toBe("技能甲")
    expect(text(host, "asset-detail-description")).toBe("甲的做法")
    expect(host.querySelectorAll("[data-slot='asset-detail-tab']")).toHaveLength(4)
    expect(document.activeElement).toBe(host.querySelector("[data-slot='asset-detail-back']"))
  })

  test("详情切 tab：注意事项带不确定性标注，评价 / 版本各有内容", () => {
    const 目录 = 假目录([资产({ id: "a", name: "技能甲", version: 2 })])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录}>中栏</WorkspaceEntry>
    ))
    进入(host)
    打开卡(host, "技能甲")

    host.querySelector<HTMLButtonElement>("[data-slot='asset-detail-tab'][data-tab='precautions']")!.click()
    expect(text(host, "asset-detail-uncertainty")).toContain("必须经过人工复核")

    host.querySelector<HTMLButtonElement>("[data-slot='asset-detail-tab'][data-tab='reviews']")!.click()
    expect(text(host, "asset-detail-review-summary")).toContain("暂无评分")

    host.querySelector<HTMLButtonElement>("[data-slot='asset-detail-tab'][data-tab='versions']")!.click()
    expect(text(host, "asset-detail-version")).toBe("v2")
  })

  test("点第二张卡打开的是第二张，不是第一张", () => {
    const 目录 = 假目录([资产({ id: "a", name: "技能甲" }), 资产({ id: "b", name: "技能乙" })])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录}>中栏</WorkspaceEntry>
    ))
    进入(host)
    打开卡(host, "技能乙")
    expect(text(host, "asset-detail-name")).toBe("技能乙")
  })

  /**
   * Task 7：`enablement` 这条注入缝必须**真的落到中栏**上——只加 prop 不往下传时，
   * 计数条与卡片按钮都不出现，而本组件自己的其它用例全绿（新缝没人读，等于没接）。
   */
  test("注入启用状态 ⇒ 中栏显示「已启用 N/20」，卡片按钮点得动", () => {
    const 目录 = 假目录([资产({ id: "a", name: "技能甲" })])
    const 切换: string[] = []
    const 启用: ProjectEnablement = {
      projectId: () => "p1",
      enabled: () => new Set(["a"]),
      enabledCount: () => 1,
      limit: () => 20,
      error: () => undefined,
      busy: () => undefined,
      skills: () => undefined,
      readDone: () => true,
      bind: () => {},
      toggle: (id) => 切换.push(id),
      reload: () => {},
    }
    const host = mount(() => (
      <WorkspaceEntry catalog={目录} enablement={启用}>中栏</WorkspaceEntry>
    ))
    进入(host)

    expect(text(host, "asset-enable-count")).toContain("已启用 1/20")
    const 按钮 = host.querySelector<HTMLButtonElement>("[data-slot='asset-card-enable']")!
    expect(按钮.getAttribute("aria-pressed")).toBe("true")
    按钮.click()
    expect(切换).toEqual(["a"])
  })

  test("返回 ⇒ 网格回来、搜索词保留、焦点归还原卡片", async () => {
    const 目录 = 假目录([
      资产({ id: "a", name: "FundFlow", description: "账户汇总", tags: [] }),
      资产({ id: "b", name: "话单分析", description: "通话记录", tags: [] }),
    ])
    const host = mount(() => (
      <WorkspaceEntry catalog={目录}>中栏</WorkspaceEntry>
    ))
    进入(host)
    const 输入 = host.querySelector<HTMLInputElement>("[data-slot='asset-search-input']")!
    输入.value = "fund"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    await 等一拍(300)
    expect(卡片(host)).toHaveLength(1)

    打开卡(host, "FundFlow")
    host.querySelector<HTMLButtonElement>("[data-slot='asset-detail-back']")!.click()
    // 焦点归还排在微任务里（等 Solid 把浏览区重新显示出来），等一拍再看。
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(浏览区(host).classList.contains("hidden")).toBe(false)
    expect(host.querySelector("[data-slot='asset-detail']")).toBeNull()
    expect(输入.value).toBe("fund")
    expect(卡片(host)).toHaveLength(1)
    expect(document.activeElement).toBe(
      卡片(host)[0].querySelector("[data-slot='asset-card-open']"),
    )
  })
})
