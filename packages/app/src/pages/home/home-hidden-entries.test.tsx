import { afterEach, describe, expect, test } from "bun:test"
import { createResource, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { HomeProjectSelection } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { displayName } from "@/pages/layout/helpers"
import type { ServerHealth } from "@/utils/server-health"
import { HomeProjectsView, type HomeProjectsViewProps } from "./home-projects-view"
import type { HomeSessionGroup } from "./home-sessions-controller"
import { HomeSessionsView, type HomeSessionsViewProps } from "./home-sessions-view"

/**
 * 主页**按用户下达藏起来的入口**（截图 `images/screen/2026-10-09_201017.png` 的 ①②③④）；
 * ⑤「设置」行原先不属本文（「归 #3」），**2026-10-09 #3 落地后已并入本文**——它是「设置功能迁到
 * 图标栏那颗 `settings-gear`」的**连带结果**：功能迁走，主页不再留第二个入口。
 *
 * ## 为什么这份用例值得存在
 *
 * 四处全是**删 JSX**——删错了不会报错、不会变红，而且删除比新增更容易「顺手多删一点」：
 * ③ 那颗 `data-action="home-new-session"` 在同一个文件里有**两处**（空态 `:530` 与表头 `:87`），
 * 只要删的是「所有 home-new-session」而不是「空态那一处」，界面上就少了一个**正常态**该有的入口，
 * 且没有任何东西会红。故本文件每条「不再渲染」都配一条**对照**（同一选择器在另一支上必须仍在），
 * 独删不动的坏法才会被抓住（`LEARNINGS #006-22` 的配套：一个约定落在 N 处时每处各写一条 ＋ 对照）。
 *
 * ## 语言桩
 *
 * 两个组件都把 `language` 当**入参**（内部不调 `useLanguage()`）⇒ 不必挂 `LanguageProvider`。
 * 桩的 `t()` 把**键名原样返回**，于是断言既能钉住 `data-action`、也能钉住文案归属的键，
 * 且与词典语言无关（本文件的判据里没有一个中文字面量）。
 *
 * ⚠️ `ReturnType<typeof useLanguage>` 是巨型对象（`t` / `locale` / `dict` …），本文件只用到 `t`
 * ⇒ 按仓里惯例 `as unknown as X` 并就地点掉那条规则（形状同 `ai-session/session-docks.test.tsx`
 * 的 `假平台`）。
 *
 * ## ⚠️ 挂账：这次删除**打断了一条既有的 e2e 用户故事**
 *
 * `packages/app/e2e/user-story/model-selection-flow.spec.ts` 的入场路径正是 ① 与 ③ 的两颗锚点
 * （`locator('[data-action="home-add-project-row"]')` ＋ `locator('[data-action="home-new-session"]')`，
 * 那时会话列表为空 ⇒ 它点的是**空态**那颗）。两处锚点按用户下达删掉后，那条 spec 会在第一步
 * `expectAppVisible(addProject)` 超时——**本文件不修它**（改 e2e 的入场路径是产品决定，不在
 * 「删 JSX」这轮口径内），据实记进交付报告的待裁定项（`LEARNINGS #002-02`：测不了的/没做的
 * 都写清，不写成已覆盖）。
 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 见上，本文件只用到 `t` 一个字段
const 语言 = { t: (键: string) => 键 } as unknown as ReturnType<typeof useLanguage>

/**
 * 挂过的卸载函数，`afterEach` 里统一收（`LEARNINGS #005-03`）。
 * ⚠️ 顺序：**先卸载、再清 `document.body`**——反了的话 dispose 会去碰已经摘掉的节点。
 */
const 挂过的: Array<() => void> = []

afterEach(() => {
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(element, host))
  return host
}

/**
 * 数命中**个数**（数字），不是取节点。
 * `LEARNINGS #005-01`：把 Solid 渲染过的节点当实得值，断言红的当场会把整轮 `bun test` 挂死。
 */
const 个数 = (host: HTMLElement, 选择器: string) => host.querySelectorAll(选择器).length

/** 单服务器 ＋ 空列表：①② 两条的**前置条件正是这一支**（② 只在 `servers().length === 1` 时出现）。 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 同上：`ServerConnection.Any` 是联合类型，夹具只要 `type` 与 `http.url` 两个字段。
const 服务器 = { type: "http", http: { url: "http://127.0.0.1:4711" } } as unknown as ServerConnection.Any

/** 第二台：为进**多服务器**那一支（`HomeServerRow` 的 hover 簇只在 `servers().length > 1` 时渲染）。 */
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 同上，夹具只用到 `type` 与 `http.url`
const 第二台 = { type: "http", http: { url: "http://127.0.0.1:4712" } } as unknown as ServerConnection.Any

function 项目栏(覆盖: Partial<HomeProjectsViewProps> = {}): HomeProjectsViewProps {
  return {
    language: 语言,
    servers: () => [服务器],
    projects: () => [],
    recentlyClosed: () => [],
    selection: () => ({ server: ServerConnection.key(服务器) }) as HomeProjectSelection,
    homedir: () => "",
    serverHealth: () => ({ healthy: true }) as ServerHealth,
    projectsForServer: () => [],
    collapsed: () => false,
    canDefaultServer: () => false,
    defaultServerKey: () => undefined,
    canRevealProject: () => false,
    unseenCount: () => 0,
    onWheel: () => {},
    onFocusServer: () => {},
    onToggleCollapsed: () => {},
    onEditServer: () => {},
    onSetDefaultServer: () => {},
    onRemoveServer: () => {},
    onMoveProject: () => {},
    onSelectProject: () => {},
    onAddProjects: () => {},
    onOpenProjectNewSession: () => {},
    onEditProject: () => {},
    onRevealProject: () => {},
    onClearNotifications: () => {},
    onCloseProject: () => {},
    ...覆盖,
  }
}

function 会话栏(覆盖: Partial<HomeSessionsViewProps> = {}): HomeSessionsViewProps {
  return {
    language: 语言,
    groups: () => [],
    showProjectName: () => false,
    server: () => ServerConnection.key(服务器),
    canCreateSession: () => true,
    searchValue: () => "",
    searchPlaceholder: () => "home.sessions.search.placeholder",
    searchOpen: () => false,
    searchLoading: () => false,
    searchResults: () => [],
    searchActive: () => "",
    searchNoResultsLabel: () => "home.sessions.search.noResults",
    titleOpacity: () => 1,
    isOpenTab: () => false,
    onCreateSession: () => {},
    onOpenSession: () => {},
    onArchiveSession: () => Promise.resolve(),
    onSetHoverTarget: () => {},
    onSetThumbTrack: () => {},
    onSetContent: () => {},
    onSetHeader: () => {},
    onWheel: () => {},
    onSetSearchRoot: () => {},
    onSetSearchInput: () => {},
    onSetSearchList: () => {},
    onSearchFocus: () => {},
    onSearchInput: () => {},
    onSearchClose: () => {},
    onSearchMove: () => {},
    onSearchSelectActive: () => {},
    onSearchHighlight: () => {},
    onSearchSelect: () => {},
    ...覆盖,
  }
}

describe("主页：藏起来的四处入口", () => {
  test("① 空项目列表里的「添加项目」整行不再渲染（data-action=home-add-project-row）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏()} />)

    expect(个数(host, "[data-action='home-add-project-row']")).toBe(0)
  })

  test("② 「项目」表头那颗「添加项目」图标按钮不再渲染（data-action=home-add-project）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏()} />)

    expect(个数(host, "[data-action='home-add-project']")).toBe(0)
  })

  test("② 多服务器态里那颗**同族**「添加项目」图标也不再渲染（HomeServerRow 的 hover 簇）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏({ servers: () => [服务器, 第二台] })} />)

    expect(个数(host, "[data-action='home-add-project']")).toBe(0)
  })

  test("对照：多服务器那一支确实渲染了，且同簇的服务器菜单「⋯」仍在（别把整簇一起删掉）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏({ servers: () => [服务器, 第二台] })} />)

    // 前置：多服务器分支真的渲染了——否则上面那条 `count 0` 是**空过**的（`#004-14`）。
    expect(host.textContent).toContain("127.0.0.1:4712")
    // 同簇那颗服务器菜单（edit / 默认 / 删除）是**另一件事**，只删添加项目那颗、它必须留着。
    expect(个数(host, "[aria-label='common.moreOptions']")).toBeGreaterThan(0)
  })

  test("对照：项目栏的骨架没被一起删掉——表头行与滚动区仍在（只删入口，不删容器）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏()} />)

    // 「项目」表头 = 那颗图标所在的**那一行**，它必须留着（只删按钮、不删行）。
    expect(host.textContent).toContain("home.projects")
    // 滚动区仍在。
    expect(个数(host, "[data-slot='home-projects-scroll']")).toBe(1)
  })

  /**
   * ⚠️ **这条对照原先是断 `个数(host, "button") > 0`，它钉不住自己标题里那句话**——
   * 「单服务器 ＋ 空列表」这一支**本来就没有任何业务按钮**（①② 已删、服务器菜单只在多服务器态
   * 出现），当时让它为真的是**⑤ 那颗设置按钮**；也就是说把表头那一行整行删掉，它照样绿
   * （`LEARNINGS #006-22` 的同族：子串/宽口径断言被别的东西满足）。#3 删掉 ⑤ 之后它当场归零，
   * 才把这个空口径暴露出来 ⇒ 改成锚**表头 / 滚动区自己**（上面那条）。
   */
  test("对照：单服务器 ＋ 空列表这一支确实一个按钮都没有（上面那条为什么不能断 button 计数）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏()} />)

    expect(个数(host, "button")).toBe(0)
  })

  test("对照：① 删掉后，「最近关闭」那一块照旧渲染（只删添加入口，不删整块空态）", () => {
    const 项目 = { worktree: "C:/proj/甲", expanded: true }
    const host = mount(() => <HomeProjectsView {...项目栏({ recentlyClosed: () => [项目] })} />)

    expect(host.textContent).toContain("home.recentlyClosed")
    expect(host.textContent).toContain(displayName(项目))
    expect(个数(host, "[data-action='home-add-project-row']")).toBe(0)
  })

  test("④ 帮助行不再渲染（桌面落点：HomeProjectsView 里那一层）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏()} />)

    expect(host.textContent).not.toContain("sidebar.help")
  })

  /**
   * **⑤ 的设置行 2026-10-09 随 #3 一起藏掉**——不是「恰好没删」，是「设置功能已迁到 rail 那颗
   * `settings-gear` 图标按钮上，主页不再留第二个入口」（用户 2026-10-09 下达的 #3）。
   *
   * ⚠️ 这一条**只在桌面落点量**：窄屏那个落点（`pages/home.tsx` 渲染的 `HomeUtilityNav`）随
   * 「④⑤ 两行删完、组件整个变空」一起**连组件一起删了**（CLAUDE.md §3：清理自己造成的孤儿）
   * ⇒ 那一处**没有可量的东西了**，是**结构性事实**（写进交付报告的 ⑥ 落点清单），不是本文的覆盖。
   */
  test("⑤ 「设置」行不再渲染（桌面落点：HomeProjectsView 里那一层）", () => {
    const host = mount(() => <HomeProjectsView {...项目栏()} />)

    expect(host.textContent).not.toContain("sidebar.settings")
  })

  test("③ 中栏空态的文案与「新建会话」按钮不再渲染", () => {
    const host = mount(() => <HomeSessionsView {...会话栏()} />)

    expect(host.textContent).not.toContain("home.sessions.empty")
    expect(个数(host, "[data-action='home-new-session']")).toBe(0)
  })

  test("对照：会话列表非空时，表头那颗「新建会话」仍在（别把 :87 那处一起删了）", () => {
    const groups: HomeSessionGroup[] = [{ id: "today", title: "today", sessions: [] }]
    const host = mount(() => <HomeSessionsView {...会话栏({ groups: () => groups })} />)

    expect(个数(host, "[data-action='home-new-session']")).toBe(1)
  })

  test("③ 加载态保留：数据还没到时兜底仍是骨架条，不是空态", () => {
    /**
     * ⚠️ **测法有讲究，别改成「手抛一个 promise」**：Solid 的 `Suspense` **不接**同步抛出的 promise
     * ——2026-10-09 探针实测（`<Suspense fallback>` 里放 `<Show when={炸()}>`，`炸` 当场 `throw new
     * Promise(() => {})`）：兜底**不出现**，直接冒 `Unknown error`。它认的是 **`createResource` 记的
     * 那笔账**（同一探针里换成 `createResource(() => new Promise(() => {}))` ⇒ 兜底当场渲染 `骨架`）。
     * 故这里用**永不 resolve 的资源**驱动挂起，而不是手抛 promise。
     */
    const host = mount(() => {
      const [资源] = createResource(() => new Promise<HomeSessionGroup[]>(() => {}))
      return <HomeSessionsView {...会话栏({ groups: () => 资源() ?? [] })} />
    })

    expect(host.textContent).toContain("common.loading")
    expect(host.textContent).not.toContain("home.sessions.empty")
  })
})
