import { describe, expect, test, vi } from "bun:test"
import { createSignal, onMount, Show, type Component, type JSX } from "solid-js"
import { Dynamic, render } from "solid-js/web"
import type { LoadFileContent } from "./file-content"
import { 加载上界, CenterContent } from "./center-content"
import type { DegradedReason } from "./degraded-view"
import { CenterTabsProvider, useCenterTabs, type CenterTabs } from "./tab-context"
import { contentTabKey, type ContentTab } from "./tab-store"
import { createViewRegistry, type ViewComponent, type ViewLoader, type ViewRegistry } from "./view-registry"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 调用方页面（生产里是上游路由页面）所在的那一层。
 * 它**常驻在树上**、靠 `display` 让位（T013 的教训：摘掉再挂回会丢整页状态），故只能读样式。
 */
const 页面层 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-slot='center-page']")

/**
 * 一张「会说话」的假视图：把拿到的入参画在 DOM 上。
 * 用假视图而不是真的 Word/PDF 视图，是因为这里要验的是**中栏的路由**——
 * 路由选错了视图，用真视图是看不出来的（两者长得一样）。
 * `名字` 用于分辨「屏幕上这张是谁」：切 tab 时旧视图会**多停留一瞬**（见下方懒加载那组），
 * 没有名字就分不清屏幕上的是新是旧。
 */
const 命名视图 = (名字: string): ViewComponent => (props) => (
  <div data-slot="视图" data-name={名字} data-path={props.path} data-has-load={String(Boolean(props.load))} />
)

const 假视图 = 命名视图("假视图")

const 注册 = (...extensions: string[]) => {
  const registry = createViewRegistry()
  registry.register({ extensions, load: async () => 假视图 })
  return registry
}

/**
 * 一个「什么时候加载完由测试说了算」的 loader：把异步加载的那一瞬钉住，
 * 好在上面断言「此刻屏幕上是什么」。`放行` / `拒绝` 只能在 loader 被调用之后使。
 */
function 可放行() {
  let 放行!: (view: ViewComponent) => void
  let 拒绝!: (error: unknown) => void
  const load: ViewLoader = () =>
    new Promise((resolve, reject) => {
      放行 = resolve
      拒绝 = reject
    })
  return { load, 放行: (view: ViewComponent) => 放行(view), 拒绝: (error: unknown) => 拒绝(error) }
}

/**
 * `页面组件` 以**组件**形式传入、经 `<Dynamic>` 渲染，而不是传一个现成的 JSX 元素——
 * 后者在 `setUp()` 时就被求值成固定 DOM 节点了，反复插入不会重跑组件体，
 * 于是「重挂」永远测不出来（这条本身踩过一次假绿，见测试内注释）。
 */
function setUp(
  options: {
    registry?: ViewRegistry
    load?: LoadFileContent
    页面组件?: Component
    /** 页面此刻露不露（`CenterContentProps.pageVisible`）。不传 = 没这个 prop。 */
    页面可见?: () => boolean
    /** 「页面不露、也没 tab」时拿什么替（`CenterContentProps.empty`）。 */
    空态?: JSX.Element
  } = {},
) {
  let center!: CenterTabs
  function Probe() {
    center = useCenterTabs()
    return null
  }
  const host = mount(() => (
    <CenterTabsProvider initialModule="project">
      <Probe />
      <CenterContent
        registry={options.registry ?? 注册(".docx")}
        load={options.load}
        pageVisible={options.页面可见?.()}
        empty={options.空态}
      >
        <Show when={options.页面组件} fallback={<div data-slot="fallback">没有内容视图</div>} keyed>
          {(component) => <Dynamic component={component} />}
        </Show>
      </CenterContent>
    </CenterTabsProvider>
  ))
  const 视图 = () => host.querySelector<HTMLElement>("[data-slot='视图']")
  /** 调用方给的页面——**没有激活 tab 时**才该在屏幕上。 */
  const 页面 = () => host.querySelector<HTMLElement>("[data-slot='fallback']")
  /** T015 的降级呈现；给了 `reason` 就只认这一种原因。 */
  const 降级 = (reason?: DegradedReason) =>
    host.querySelector<HTMLElement>(`[data-component='degraded-view']${reason ? `[data-reason='${reason}']` : ""}`)
  const 开 = async (tab: ContentTab) => {
    center.open(tab)
    await 落定()
  }
  return { host, center, 视图, 页面, 降级, 开 }
}

const 专案: ContentTab = { module: "project", title: "立项书.docx", path: "/p/立项书.docx" }
const 台账: ContentTab = { module: "project", title: "台账.xlsx", path: "/p/台账.xlsx" }
const 卷宗: ContentTab = { module: "project", title: "卷宗.pdf", path: "/p/卷宗.pdf" }

describe("中栏内容区：激活的 tab → 扩展名 → 视图注册表 → 渲染（FR-007）", () => {
  test("激活的 tab 按扩展名路由到对应视图，并拿到它的 path", async () => {
    const { 视图, 开 } = setUp()

    await 开(专案)

    expect(视图()?.getAttribute("data-path")).toBe("/p/立项书.docx")
  })

  test("中栏把取数接缝注入给视图（视图不自行去 useFile）", async () => {
    const { 视图, 开 } = setUp({ load: async () => undefined })

    await 开(专案)

    expect(视图()?.getAttribute("data-has-load")).toBe("true")
  })

  test("扩展名没有归属：不渲染视图，改成给一条说得出原因的降级提示（T015）", async () => {
    const { host, 视图, 降级, 开 } = setUp()

    await 开(台账)

    expect(视图()).toBeNull()
    expect(降级("unsupported")?.textContent ?? "").toContain("台账.xlsx") // 说得出是哪个文件看不了
    expect(页面层(host)?.style.display).toBe("none") // 内容区归降级提示，页面让位（这正是「不白屏」的前提）
  })

  test("一张 tab 都没有时不渲染任何视图，内容区仍是调用方给的页面", async () => {
    const { 视图, 页面, 降级 } = setUp()

    await 落定()

    expect(视图()).toBeNull()
    expect(降级()).toBeNull() // 没有 tab 就谈不上「降级」——降级说的是「这张 tab 的内容看不了」
    expect(页面()).not.toBeNull()
  })

  test("切到另一张 tab：视图跟着换（不是停在第一张上）", async () => {
    const { 视图, 开, center } = setUp({ registry: 注册(".docx", ".pdf") })

    await 开(专案)
    await 开({ module: "project", title: "卷宗.pdf", path: "/p/卷宗.pdf" })

    expect(视图()?.getAttribute("data-path")).toBe("/p/卷宗.pdf")
    expect(center.active()).toBe(contentTabKey({ module: "project", title: "卷宗.pdf", path: "/p/卷宗.pdf" }))
  })

  test("关掉当前激活的 tab：视图退场，内容区交还调用方的页面", async () => {
    const { 视图, 页面, 降级, 开, center } = setUp()

    await 开(专案)
    center.close(contentTabKey(专案))
    await 落定()

    expect(视图()).toBeNull()
    expect(降级()).toBeNull()
    expect(页面()).not.toBeNull()
  })

  test("关掉的是别的 tab：当前视图不动", async () => {
    const { 视图, 开, center } = setUp({ registry: 注册(".docx", ".pdf") })

    await 开(专案)
    await 开({ module: "project", title: "卷宗.pdf", path: "/p/卷宗.pdf" })
    center.close(contentTabKey(专案))
    await 落定()

    expect(视图()?.getAttribute("data-path")).toBe("/p/卷宗.pdf")
  })
})

/**
 * `children` 在生产里是**上游路由页面**，不是一块静态占位。
 * 若视图的出现/消失会把它卸载重挂，用户点一下 tab 就丢掉整页状态（滚动位置、已取的数据、
 * 表单填写），再点回来重新挂载一次。这两条把「页面常驻、只藏不卸」钉死。
 */
describe("内容区不夺走调用方的页面：常驻而非重挂", () => {
  test("视图来来去去，children 只挂载一次", async () => {
    let 挂载次数 = 0
    function 页面() {
      onMount(() => 挂载次数++)
      return <div data-slot="页面">路由页</div>
    }
    const { 开, center } = setUp({ 页面组件: 页面 })

    await 开(专案) // 视图出现
    center.close(contentTabKey(专案)) // 视图退场
    await 落定()
    await 开(台账) // 仍是未注册扩展名，再加一轮来回
    center.close(contentTabKey(台账))
    await 落定()

    expect(挂载次数).toBe(1)
  })

  test("视图在场时页面被藏起来（藏 ≠ 卸），视图退场后重新可见", async () => {
    const { host, 开, center } = setUp()
    const 页面层 = () => host.querySelector<HTMLElement>("[data-slot='center-page']")

    expect(页面层()?.style.display).toBe("contents") // 可见时用 contents：不引入多余盒，页面仍是原来的 flex 子项

    await 开(专案)
    expect(页面层()?.style.display).toBe("none")

    center.close(contentTabKey(专案))
    await 落定()
    expect(页面层()?.style.display).toBe("contents")
  })
})

/**
 * 中栏在**会话路由**上让位（2026-10-08 缺陷修复 · 中栏错显上游会话页）。
 *
 * `children` 在生产里是**上游路由自己的页面**——在 `/server/:key/session/:id` 上就是
 * `pages/session.tsx`（一页完整的 AI 会话：消息流 ＋ composer）。中栏把它露出来，屏幕上就有
 * **两个输入框、两条消息流**，且两个 composer 都在真的发消息。判据（当前路由是不是会话页）
 * 由**壳层**算好传进来（`pages/layout-new.tsx`），本组件只认那个布尔。
 *
 * ⚠️ **接线本身（`layout-new.tsx` 那一行）在这里看不见**——那要一个真路由器才求值得了。
 * 它由真栈 E2E 钉住（`e2e/real-stack/ai-session-real.spec.ts` 测试 ③）。本条与那条各管一半，
 * 谁都不能顶替谁（`LEARNINGS #005-11`：机制「对不对」与「在这条出口上有没有生效」是两个事实）。
 */
describe("中栏让位：页面不露时不卸、改由 `empty` 说话", () => {
  const 空态 = <div data-slot="center-empty">从左侧选择文件查看，或在右栏让 AI 生成成果</div>
  /** 有没有空态。判**布尔**不判节点（`LEARNINGS #005-01`：节点当实得值会把整轮挂哑）。 */
  const 有 = (host: HTMLElement) => host.querySelector("[data-slot='center-empty']") !== null

  test("对照：不传 `pageVisible` ⇒ 与引入本 prop 之前逐字同行为（页面照旧露、不该凭空冒空态）", () => {
    const { host } = setUp({ 空态 })

    expect(页面层(host)?.style.display).toBe("contents")
    expect(有(host)).toBe(false)
  })

  test("`pageVisible={false}` ⇒ 页面改 `display:none`、同一时刻空态露出来", () => {
    const { host } = setUp({ 页面可见: () => false, 空态 })

    expect(页面层(host)?.style.display).toBe("none")
    expect(有(host)).toBe(true)
  })

  test("藏 ≠ 卸：翻的是 `display`，页面**从不重挂**（切走再切回不丢整页状态）", async () => {
    // 与上面「视图来来去去，children 只挂载一次」同一条纪律（T013 的教训），
    // 只是这次的触发者从「tab 开关」换成了「路由判定」——后者**每次导航都会变**，
    // 一旦写成卸载重挂，民警每点一次会话列表就会丢掉中栏那一页的全部状态。
    let 挂载次数 = 0
    function 页面() {
      onMount(() => 挂载次数++)
      return <div data-slot="页面">路由页</div>
    }
    const [露, set露] = createSignal(true)
    const { host } = setUp({ 页面组件: 页面, 页面可见: 露, 空态 })

    expect(页面层(host)?.style.display).toBe("contents")

    set露(false)
    await 落定()
    expect(页面层(host)?.style.display).toBe("none")

    set露(true)
    await 落定()
    expect(页面层(host)?.style.display).toBe("contents")

    expect(挂载次数).toBe(1)
  })

  test("tab 优先：`pageVisible={false}` 时开一个 tab ⇒ 视图照常看得到，空态**不**露", async () => {
    // 少了这条，「`!内容() && !露页()` 写成了 `!露页()`」这种坏法照样绿——
    // 那会让「路由判定为假」时**连文件内容也一起吞掉**（tab 开着却只看见一句提示）。
    const { host, 视图, 开 } = setUp({ 页面可见: () => false, 空态 })

    await 开(专案)

    expect(视图()?.getAttribute("data-path")).toBe("/p/立项书.docx")
    expect(页面层(host)?.style.display).toBe("none")
    expect(有(host)).toBe(false)
  })

  test("`empty` 省略 ⇒ 页面不露时中栏就是空的（不在这里凭空造一个通用空态）", () => {
    // 「空态」是**调用方**给的（生产里由 `workspace-entry.tsx` 提供文案），本组件不内置。
    const { host } = setUp({ 页面可见: () => false })

    expect(页面层(host)?.style.display).toBe("none")
    expect(有(host)).toBe(false)
  })
})

/**
 * 视图是**懒加载**的（注册表存的是 `load: () => Promise<组件>`），于是「中栏拿到视图」不再是一瞬的事，
 * 多出一个「上一个视图已退场、下一个还没加载完」的空档。这组把空档里该发生什么钉死——
 * 空档只有一次 chunk 拉取那么长，但**用户感觉得到**：闪一下调用方的路由页会像是「点错了」。
 */
describe("视图按需加载：空档期不闪页面、失败要收手、迟到的不能盖新的", () => {
  test("新视图还在加载时：旧视图留在原位，调用方的页面不会被翻出来闪一下", async () => {
    const 慢 = 可放行()
    const registry = createViewRegistry()
    registry.register({ extensions: [".docx"], load: async () => 命名视图("第一张") })
    registry.register({ extensions: [".pdf"], load: 慢.load })
    const { host, 视图, 开 } = setUp({ registry })

    await 开(专案)
    expect(视图()?.getAttribute("data-name")).toBe("第一张")

    await 开(卷宗) // .pdf 的库还悬着没加载完

    expect(视图()?.getAttribute("data-name")).toBe("第一张")
    expect(页面层(host)?.style.display).toBe("none") // 页面**始终**藏着：空档期不能把它翻出来

    慢.放行(命名视图("第二张"))
    await 落定()

    expect(视图()?.getAttribute("data-name")).toBe("第二张")
  })

  test("新视图加载失败：不能拿旧文件冒充新 tab 的内容，要收手说清是预览组件没加载出来", async () => {
    const 坏的 = 可放行()
    const registry = createViewRegistry()
    registry.register({ extensions: [".docx"], load: async () => 命名视图("第一张") })
    registry.register({ extensions: [".pdf"], load: 坏的.load })
    const { host, 视图, 降级, 开 } = setUp({ registry })

    await 开(专案)
    await 开(卷宗)
    expect(视图()?.getAttribute("data-name")).toBe("第一张") // 还悬着，此刻留旧的是对的（上一条）

    坏的.拒绝(new Error("chunk 拉不下来"))
    await 落定()

    // 但**加载不出来**时就不能再留着旧文件了：那会让民警对着「卷宗.pdf」这个标题看立项书的内容。
    expect(视图()).toBeNull()
    // 并说清是哪一种「看不了」：chunk 挂了是**预览组件**没到位，不是这个 PDF 坏了（两者说法必须不同）
    expect(降级("load-failed")?.textContent ?? "").toContain("卷宗.pdf")
    expect(页面层(host)?.style.display).toBe("none") // 也不能翻回调用方的页面——tab 还开着，内容区得说话
  })

  test("迟到的加载结果不能盖掉后选中的文件", async () => {
    const 慢 = 可放行()
    const registry = createViewRegistry()
    registry.register({ extensions: [".docx"], load: 慢.load })
    registry.register({ extensions: [".pdf"], load: async () => 命名视图("卷宗") })
    const { 视图, 开 } = setUp({ registry })

    await 开(专案) // .docx 的库悬着（还没加载完）
    await 开(卷宗) // 用户等不及切走了；.pdf 的库先加载完
    expect(视图()?.getAttribute("data-name")).toBe("卷宗")

    慢.放行(命名视图("立项书")) // .docx 这时才迟到地加载完
    await 落定()

    expect(视图()?.getAttribute("data-name")).toBe("卷宗")
  })
})

/**
 * 「一直加载不出来」与「加载失败」对民警是同一件事：**内容区不说话**。
 *
 * `load()` 悬着不 settle（网络卡在半路、请求被网关吃掉）时，上面那条「留着旧视图」的规矩
 * 会变成最糟的结果——民警对着「卷宗.pdf」的标题看立项书的内容，**而且永远等不到头**：
 * 失败至少还有个说法，悬挂连说法都没有。到点就得按「预览组件没到位」收手。
 *
 * 假时钟：`加载上界` 是秒级的，真等一遍没有意义。故这里一切都得手动推——`落定` 本身就是
 * `setTimeout`，假时钟下永远不走，所以连 `开()`（内含 `落定`）都不能用，改成直接 `center.open`
 * 再手动跑微任务。
 */
describe("视图 chunk 悬着不回来：到点必须收手（挂起比失败更糟）", () => {
  /** 假时钟下把微任务队列跑干净——Solid 的 effect 与 loader 都在微任务里推进。 */
  const 跑微任务 = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  test("chunk 悬过加载上界：落 load-failed，收掉旧视图，不让内容区无限停在旧画面上", async () => {
    const 悬挂: ViewLoader = () => new Promise(() => {}) // 永不 settle
    const registry = createViewRegistry()
    registry.register({ extensions: [".docx"], load: async () => 命名视图("第一张") })
    registry.register({ extensions: [".pdf"], load: 悬挂 })

    vi.useFakeTimers()
    try {
      const { 视图, 降级, center } = setUp({ registry })

      center.open(专案)
      await 跑微任务()
      center.open(卷宗)
      await 跑微任务()
      expect(视图()?.getAttribute("data-name")).toBe("第一张") // 还没到点，此刻留旧的是对的

      vi.advanceTimersByTime(加载上界)
      await 跑微任务()

      expect(视图()).toBeNull() // 到点收手：旧文件不能再冒充「卷宗.pdf」的内容
      expect(降级("load-failed")?.textContent ?? "").toContain("卷宗.pdf") // 且说得出是哪个文件
    } finally {
      vi.useRealTimers()
    }
  })

  test("悬着的 chunk 到点后才回来：内容照常补上（提示不是终点，只是不让它无限等）", async () => {
    const 慢 = 可放行()
    const registry = createViewRegistry()
    registry.register({ extensions: [".pdf"], load: 慢.load })

    vi.useFakeTimers()
    try {
      const { 视图, 降级, center } = setUp({ registry })

      center.open(卷宗)
      await 跑微任务()
      vi.advanceTimersByTime(加载上界)
      await 跑微任务()
      expect(降级("load-failed")).not.toBeNull()

      慢.放行(命名视图("卷宗"))
      await 跑微任务()

      expect(视图()?.getAttribute("data-name")).toBe("卷宗")
      expect(降级()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * FR-006 的验收场景是「切到项目管理 → 中栏已有 tab 不清空、**不打扰**」，SC-002 更是点名了
 * 「选中状态与**内容**不丢失」。tab 列表与激活态由 `tab-store.ts` 保住了（见上一组「关掉的是别的
 * tab」），但那两条**只断言了 `data-path`**——没有一条盯着视图组件自己会不会被重建。
 *
 * 重建的代价不是「多跑一次渲染」：`BinaryView` 的取数 effect 以 `props.path` 为依赖，重挂 = 文件字节
 * **重新从服务端拉一遍** + `pending` 闪一下 + 渲染器重跑（pdfjs 重解析、docx 重排版），`code-view` 的
 * 编辑器状态、PDF 的滚动位置一并归零。这些全都**静默**发生，测试看得见、民警只是觉得「卡了一下」。
 *
 * 触发源很隐蔽：`CenterTabsProvider` 每个动作都 `setState` 一个**新对象**，于是 `center-content.tsx`
 * 里那个读了 `center.tabs()` 的 effect 会为**任何**动作重跑，而 effect 里的 `set内容({...})` 写的是
 * 新字面量、`<Show keyed>` 又按引用比较 → 卸载重挂。下面三条按三种触发源分别钉住「内容没变就不许重建」。
 */
describe("内容没变就不重建视图：切模块 / 关别的 tab / 重激活都打断不了它（FR-006 / SC-002）", () => {
  /** 一个会计数的假视图：`onMount` 每次挂载都跑，重挂必然现形。 */
  const 计数视图 = () => {
    const 计数 = { n: 0 }
    const View: ViewComponent = () => {
      onMount(() => 计数.n++)
      return <div data-slot="视图" />
    }
    return { View, 计数 }
  }

  test("切模块：tab 没被清，当前视图也不许重建", async () => {
    const { View, 计数 } = 计数视图()
    const registry = createViewRegistry()
    registry.register({ extensions: [".docx"], load: async () => View })
    const { 开, center } = setUp({ registry })

    await 开(专案)
    expect(计数.n).toBe(1)

    center.switchModule("cdr-analysis")
    await 落定()

    expect(center.tabs()).toHaveLength(1) // FR-006：切模块不动已有 tab
    expect(计数.n).toBe(1) // 且当前视图不该被打断——内容一字未变，没有任何理由重挂
  })

  test("关掉别的 tab：当前视图不许重建", async () => {
    const { View, 计数 } = 计数视图()
    const registry = createViewRegistry()
    registry.register({ extensions: [".docx", ".pdf"], load: async () => View })
    const { 开, center } = setUp({ registry })

    await 开(专案)
    await 开(卷宗)
    expect(计数.n).toBe(2) // 换了文件时重建是**对的**：视图要按新 path 重新取数（上一组的 keyed 语义）

    center.close(contentTabKey(专案))
    await 落定()

    expect(计数.n).toBe(2) // 但关的既然不是当前那张，视图就不该重建
  })

  test("再点一次当前 tab：重激活同一个 key 不是「换内容」", async () => {
    const { View, 计数 } = 计数视图()
    const registry = createViewRegistry()
    registry.register({ extensions: [".docx"], load: async () => View })
    const { 开, center } = setUp({ registry })

    await 开(专案)
    center.activate(contentTabKey(专案))
    await 落定()

    expect(计数.n).toBe(1)
  })
})
