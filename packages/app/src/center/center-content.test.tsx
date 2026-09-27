import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { LoadFileContent } from "./file-content"
import { CenterContent } from "./center-content"
import { CenterTabsProvider, useCenterTabs, type CenterTabs } from "./tab-context"
import { contentTabKey, type ContentTab } from "./tab-store"
import { createViewRegistry, type ViewComponent, type ViewRegistry } from "./view-registry"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 一张「会说话」的假视图：把拿到的入参画在 DOM 上。
 * 用假视图而不是真的 Word/PDF 视图，是因为这里要验的是**中栏的路由**——
 * 路由选错了视图，用真视图是看不出来的（两者长得一样）。
 */
const 假视图: ViewComponent = (props) => (
  <div data-slot="视图" data-path={props.path} data-has-load={String(Boolean(props.load))} />
)

const 注册 = (...extensions: string[]) => {
  const registry = createViewRegistry()
  registry.register({ extensions, component: 假视图 })
  return registry
}

function setUp(options: { registry?: ViewRegistry; load?: LoadFileContent } = {}) {
  let center!: CenterTabs
  function Probe() {
    center = useCenterTabs()
    return null
  }
  const host = mount(() => (
    <CenterTabsProvider initialModule="project">
      <Probe />
      <CenterContent registry={options.registry ?? 注册(".docx")} load={options.load}>
        <div data-slot="fallback">没有内容视图</div>
      </CenterContent>
    </CenterTabsProvider>
  ))
  const 视图 = () => host.querySelector<HTMLElement>("[data-slot='视图']")
  const 降级 = () => host.querySelector<HTMLElement>("[data-slot='fallback']")
  const 开 = async (tab: ContentTab) => {
    center.open(tab)
    await 落定()
  }
  return { host, center, 视图, 降级, 开 }
}

const 专案: ContentTab = { module: "project", title: "立项书.docx", path: "/p/立项书.docx" }
const 台账: ContentTab = { module: "project", title: "台账.xlsx", path: "/p/台账.xlsx" }

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

  test("扩展名没有归属：不渲染视图，落回调用方给的内容（降级提示归 T015）", async () => {
    const { 视图, 降级, 开 } = setUp()

    await 开(台账)

    expect(视图()).toBeNull()
    expect(降级()).not.toBeNull()
  })

  test("一张 tab 都没有时不渲染任何视图", async () => {
    const { 视图, 降级 } = setUp()

    await 落定()

    expect(视图()).toBeNull()
    expect(降级()).not.toBeNull()
  })

  test("切到另一张 tab：视图跟着换（不是停在第一张上）", async () => {
    const { 视图, 开, center } = setUp({ registry: 注册(".docx", ".pdf") })

    await 开(专案)
    await 开({ module: "project", title: "卷宗.pdf", path: "/p/卷宗.pdf" })

    expect(视图()?.getAttribute("data-path")).toBe("/p/卷宗.pdf")
    expect(center.active()).toBe(contentTabKey({ module: "project", title: "卷宗.pdf", path: "/p/卷宗.pdf" }))
  })

  test("关掉当前激活的 tab：视图退场，落回降级内容", async () => {
    const { 视图, 降级, 开, center } = setUp()

    await 开(专案)
    center.close(contentTabKey(专案))
    await 落定()

    expect(视图()).toBeNull()
    expect(降级()).not.toBeNull()
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
