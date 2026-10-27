import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { 内核技能 } from "@/ai-assets/enable-api"
import { CapabilityPanel, type CapabilityPanelProps } from "./capability-panel"

/**
 * happy-dom 没有 CSS 引擎 ⇒ 判据全是**结构与文本**，不是像素（同 `sidebar-tabs.test.tsx`）。
 * ⚠️ 断言一律断布尔 / 字符串，**不比较节点**（`#009-01`：比节点会让整轮 `bun test` 挂死）。
 */
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const 槽 = (host: HTMLElement, slot: string) => [...host.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`)]
const 一 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 有 = (host: HTMLElement, slot: string) => 一(host, slot) !== null
const 文 = (host: HTMLElement, slot: string) => 一(host, slot)?.textContent ?? ""

const 技能 = (over: { name: string; assetId?: string; assetName?: string }): 内核技能 => ({
  name: over.name,
  location: `/w/u/p/.opencode/skill/${over.assetId ?? over.name}/SKILL.md`,
  ...(over.assetId === undefined ? {} : { assetId: over.assetId }),
  ...(over.assetName === undefined ? {} : { assetName: over.assetName }),
})

function 面板(over: Partial<CapabilityPanelProps> = {}) {
  return mount(() => (
    <CapabilityPanel
      hasProject={over.hasProject ?? (() => true)}
      enabled={over.enabled ?? (() => new Set(["a1"]))}
      enabledCount={over.enabledCount ?? (() => 1)}
      skills={over.skills ?? (() => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })])}
      error={over.error ?? (() => undefined)}
      busy={over.busy ?? (() => undefined)}
      onToggle={over.onToggle ?? (() => {})}
      onRetry={over.onRetry ?? (() => {})}
    />
  ))
}

describe("CapabilityPanel 三档手风琴（设计 §3）", () => {
  test("默认技能展开，另外两组收起", () => {
    const host = 面板()
    expect(一(host, "capability-group-skill")?.getAttribute("aria-expanded")).toBe("true")
    expect(一(host, "capability-group-knowledge")?.getAttribute("aria-expanded")).toBe("false")
    expect(一(host, "capability-group-mcp")?.getAttribute("aria-expanded")).toBe("false")
  })

  test("点知识库 ⇒ 技能收起、知识库展开", () => {
    const host = 面板()
    一(host, "capability-group-knowledge")?.click()
    expect(一(host, "capability-group-skill")?.getAttribute("aria-expanded")).toBe("false")
    expect(一(host, "capability-group-knowledge")?.getAttribute("aria-expanded")).toBe("true")
  })

  test("点已展开的知识库 ⇒ 回到技能展开（不会三组全收起）", () => {
    const host = 面板()
    一(host, "capability-group-knowledge")?.click()
    一(host, "capability-group-knowledge")?.click()
    expect(一(host, "capability-group-skill")?.getAttribute("aria-expanded")).toBe("true")
    expect(一(host, "capability-group-knowledge")?.getAttribute("aria-expanded")).toBe("false")
  })

  test("知识库横条不写数字，写「即将支持」", () => {
    const host = 面板()
    expect(文(host, "capability-group-knowledge")).toContain("即将支持")
    expect(文(host, "capability-group-knowledge")).not.toContain("0 个")
  })

  test("MCP 是明确 0 个 ⇒ 写出数字", () => {
    const host = 面板()
    expect(文(host, "capability-group-mcp")).toContain("0 个")
  })

  test("三种条目同屏：正常 / 没生效 / 自带 各一条", () => {
    const host = 面板({
      enabled: () => new Set(["a1", "a2"]),
      enabledCount: () => 2,
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" }), 技能({ name: "我的小工具" })],
    })
    expect(槽(host, "capability-item").length).toBe(0)
    expect(槽(host, "capability-item-loaded").length).toBe(1)
    expect(槽(host, "capability-item-stale").length).toBe(1)
    expect(槽(host, "capability-item-local").length).toBe(1)
  })

  test("自带的条目没有停用按钮、也没有第二个操作", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: () => [技能({ name: "我的小工具" })] })
    expect(槽(host, "capability-item-local").length).toBe(1)
    expect(槽(host, "capability-disable").length).toBe(0)
  })

  test("库内条目有停用按钮，点了把 assetId 交出去", () => {
    let 收到: string | undefined
    const host = 面板({ onToggle: (id) => (收到 = id) })
    一(host, "capability-disable")?.click()
    expect(收到).toBe("a1")
  })

  test("技能组头的数字 = 我能用的条数（含没生效的）", () => {
    const host = 面板({
      enabled: () => new Set(["a1", "a2"]),
      enabledCount: () => 2,
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })],
    })
    expect(文(host, "capability-count-skill")).toContain("2 个")
  })

  test("项目真相多于我能用时，补一行说明（设计 §6）", () => {
    const host = 面板({ enabled: () => new Set(["a1"]), enabledCount: () => 4 })
    expect(有(host, "capability-out-of-scope")).toBe(true)
    expect(文(host, "capability-out-of-scope")).toContain("3")
  })

  test("项目真相与我能用的一样多时，不出现那行", () => {
    const host = 面板({ enabled: () => new Set(["a1"]), enabledCount: () => 1 })
    expect(有(host, "capability-out-of-scope")).toBe(false)
  })

  test("没有内核数据 ⇒ 说「暂时读不到」并给重试，不列空", () => {
    const host = 面板({ skills: () => undefined })
    expect(有(host, "capability-unreadable")).toBe(true)
    expect(槽(host, "capability-item-loaded").length).toBe(0)
    expect(槽(host, "capability-item-stale").length).toBe(0)
  })

  test("没有内核数据时，技能组头也不写 0 个（「读不到」不是「0 个」）", () => {
    const host = 面板({ skills: () => undefined })
    expect(文(host, "capability-group-skill")).not.toContain("0 个")
    expect(有(host, "capability-count-skill")).toBe(false)
  })

  test("重试按钮把回调交出去", () => {
    let 点过 = false
    const host = 面板({ skills: () => undefined, onRetry: () => (点过 = true) })
    一(host, "capability-retry")?.click()
    expect(点过).toBe(true)
  })

  test("没有项目 ⇒ 说「先选一个项目」，三个组都不画", () => {
    const host = 面板({ hasProject: () => false })
    expect(有(host, "capability-no-project")).toBe(true)
    expect(有(host, "capability-group-skill")).toBe(false)
  })

  test("接口报错（含 403「不是该项目成员」）⇒ 原样显示服务端那句", () => {
    const host = 面板({ error: () => "不是该项目成员" })
    expect(文(host, "capability-error")).toContain("不是该项目成员")
  })
})
