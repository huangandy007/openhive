import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import {
  ASSET_TYPE_LABELS,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  ASSET_VISIBILITY_LABELS,
} from "@opencode-ai/asset-service/metadata"
import { AssetNav } from "./asset-nav"
import type { AssetCategoryRow } from "./category-api"
import { createAssetFilter } from "./filter"

/**
 * AI 资产左栏纯导航（009 T005 / DESIGN §4.8）。
 *
 * 守三件事：**分组齐备**（空间 / 类型 / 分类）、**状态可达**（多选、单开手风琴）、
 * **左栏永不列资产**（design §1.1）。
 *
 * 需求 4 起分类是**注入的**（服务端来），所以这里的夹具故意**不是** seed 的顺序与名字：
 * 若组件偷偷按 seed 排或补自家名字，这两条会当场红。
 */
const 挂过的: Array<() => void> = []

/** 夹具：故意把「资金分析」放第一、且它不是 seed 里的任何一项。 */
const 分类: readonly AssetCategoryRow[] = [
  { id: "finance", name: "资金分析" },
  { id: "intelligence", name: "情报研判" },
  { id: "supervision", name: "督导考核" },
]

function mount(
  filter = createAssetFilter(),
  options: {
    categories?: readonly AssetCategoryRow[]
    error?: string
  } = {},
) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const rows = options.categories ?? 分类
  挂过的.push(
    render(
      () => (
        <AssetNav
          filter={filter}
          categories={() => rows}
          categoriesError={() => options.error}
        />
      ),
      host,
    ),
  )
  return host
}

afterEach(() => {
  挂过的.splice(0).forEach((卸载) => 卸载())
  document.body.innerHTML = ""
})

const 槽 = (root: HTMLElement, slot: string) => [
  ...root.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`),
]

/**
 * 图标名：`Icon` 今天把名字编进 `<use href="#opencode-icon-…">`，没有 `data-name`。
 * 配方同 `project/minio-bar.test.tsx`（先读 `data-name`，读不到退回图标容器的 HTML）。
 */
const 箭名 = (el: HTMLElement) =>
  el.querySelector("[data-name]")?.getAttribute("data-name") ??
  el.querySelector("[data-component='icon']")?.innerHTML ??
  ""

describe("AI 资产左栏导航", () => {
  test("空间筛选：全局 / 部门 / 个人三项，默认全选", () => {
    const host = mount()
    const 空间 = 槽(host, "asset-space")

    expect(空间.map((el) => el.textContent?.trim())).toEqual(
      ASSET_VISIBILITIES.map((value) => ASSET_VISIBILITY_LABELS[value]),
    )
    expect(空间.map((el) => el.getAttribute("aria-pressed"))).toEqual(["true", "true", "true"])
  })

  test("空间是多选：点「个人」只取消它，其余不动；再点恢复", () => {
    const filter = createAssetFilter()
    const host = mount(filter)
    const 个人 = 槽(host, "asset-space").find((el) => el.textContent?.trim() === "个人")!

    个人.click()

    expect(个人.getAttribute("aria-pressed")).toBe("false")
    expect(filter.spaces()).toEqual(["global", "department"])

    个人.click()

    expect(个人.getAttribute("aria-pressed")).toBe("true")
    expect(filter.spaces()).toEqual([...ASSET_VISIBILITIES])
  })

  test("类型 Tab：Skill / MCP / 知识库，默认选中 Skill", () => {
    const host = mount()
    const tabs = 槽(host, "asset-type-tab")

    expect(host.querySelector("[role='tablist']")).not.toBeNull()
    expect(tabs.map((el) => el.textContent?.trim())).toEqual(
      ASSET_TYPES.map((type) => ASSET_TYPE_LABELS[type]),
    )
    expect(tabs.map((el) => el.getAttribute("aria-selected"))).toEqual(["true", "false", "false"])
  })

  test("点 MCP：选中态换过去，Skill 让出", () => {
    const filter = createAssetFilter()
    const host = mount(filter)
    const [Skill, MCP] = 槽(host, "asset-type-tab")

    MCP.click()

    expect(Skill.getAttribute("aria-selected")).toBe("false")
    expect(MCP.getAttribute("aria-selected")).toBe("true")
    expect(filter.type()).toBe("mcp")
  })

  test("业务分类：**按喂进来的顺序原样渲染**（不排序、不补名字），默认一个都不展开", () => {
    const host = mount()
    const 分类按钮 = 槽(host, "asset-category")

    // 与注入的顺序逐项相等：组件若按 seed 排或补自家名字，这里当场红。
    expect(分类按钮.map((el) => el.textContent?.trim())).toEqual(分类.map((行) => 行.name))
    expect(分类按钮.map((el) => el.getAttribute("data-category"))).toEqual(分类.map((行) => 行.id))
    // 默认「不筛分类」：一进来就收窄到第一类，会把落在别类的已发布资产全藏起来——
    // 那正是用户报「AI 资产里面看不到」的现场。
    expect(分类按钮.map((el) => el.getAttribute("aria-expanded"))).toEqual(分类.map(() => "false"))
    expect(分类按钮.every((el) => 箭名(el).includes("chevron-right"))).toBe(true)

    // 点一项才收窄；箭头跟着翻。
    分类按钮[0]?.click()
    expect(分类按钮[0]?.getAttribute("aria-expanded")).toBe("true")
    expect(箭名(分类按钮[0])).toContain("chevron-down")
  })

  test("停用的分类服务端就不给了：访问器换成两项，左栏只剩两项（不缓存旧行）", () => {
    const [行, set行] = createSignal<readonly AssetCategoryRow[]>(分类)
    const host = document.createElement("div")
    document.body.appendChild(host)
    挂过的.push(render(() => <AssetNav filter={createAssetFilter()} categories={行} />, host))

    expect(槽(host, "asset-category").length).toBe(3)

    set行([分类[0]!])

    expect(槽(host, "asset-category").map((el) => el.textContent?.trim())).toEqual(["资金分析"])
  })

  test("拉分类失败：左栏显示那句人话，而不是空无一人", () => {
    const host = mount(createAssetFilter(), { categories: [], error: "连接服务失败，请检查网络后重试" })

    expect(槽(host, "asset-category")).toEqual([])
    expect(host.querySelector("[data-slot='asset-category-error']")?.textContent).toBe(
      "连接服务失败，请检查网络后重试",
    )
  })

  test("单开手风琴：点第二项 ⇒ 第一项收起、第二项展开；再点它 ⇒ 全部收起", () => {
    const host = mount()
    const [第一, 第二] = 槽(host, "asset-category")

    第二.click()

    expect(第一.getAttribute("aria-expanded")).toBe("false")
    expect(第二.getAttribute("aria-expanded")).toBe("true")
    expect(箭名(第二)).toContain("chevron-down")

    第二.click()

    expect(第一.getAttribute("aria-expanded")).toBe("false")
    expect(第二.getAttribute("aria-expanded")).toBe("false")
  })

  test("左栏不列资产：分类展开也不出现资产行", () => {
    const host = mount()

    expect(槽(host, "asset-item")).toEqual([])
    // 展开另一项再确认一次：判据不能只在「默认那一项」上成立。
    槽(host, "asset-category")[2].click()
    expect(槽(host, "asset-item")).toEqual([])
  })
})
