import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import {
  ASSET_TYPE_LABELS,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  ASSET_VISIBILITY_LABELS,
} from "@opencode-ai/asset-service/metadata"
import { AssetNav } from "./asset-nav"
import { ASSET_CATEGORY_ROWS, createAssetFilter } from "./filter"

/**
 * AI 资产左栏纯导航（009 T005 / DESIGN §4.8）。
 *
 * 守三件事：**分组齐备**（空间 / 类型 / 分类）、**状态可达**（多选、单开手风琴）、
 * **左栏永不列资产**（design §1.1）。
 */
const 挂过的: Array<() => void> = []

function mount(filter = createAssetFilter()) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <AssetNav filter={filter} />, host))
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

  test("业务分类：按 seed 顺序渲染，**默认一个都不展开**（T017 裁定，见 `filter.ts` 的头注）", () => {
    const host = mount()
    const 分类 = 槽(host, "asset-category")

    expect(分类.map((el) => el.textContent?.trim())).toEqual(ASSET_CATEGORY_ROWS.map((行) => 行.name))
    // 默认「不筛分类」：一进来就收窄到第一类，会把落在别类的已发布资产全藏起来——
    // 那正是用户报「AI 资产里面看不到」的现场。
    expect(分类.map((el) => el.getAttribute("aria-expanded"))).toEqual(ASSET_CATEGORY_ROWS.map(() => "false"))
    expect(分类.every((el) => 箭名(el).includes("chevron-right"))).toBe(true)

    // 点一项才收窄；箭头跟着翻。
    分类[0]?.click()
    expect(分类[0]?.getAttribute("aria-expanded")).toBe("true")
    expect(箭名(分类[0])).toContain("chevron-down")
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
