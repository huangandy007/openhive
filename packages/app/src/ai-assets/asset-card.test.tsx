import { describe, expect, test } from "bun:test"
// ⚠️ 用 `solid-js/web` 的 `render`：本仓**没有** `@solidjs/testing-library`
// （`src/project/backup-restore-dialog.test.tsx:6` 明确写着那是别的仓的写法）
import { render } from "solid-js/web"
import type { UsageStats } from "./asset-catalog-api"
import { AssetCard } from "./asset-card"
import { 样例资产 } from "./asset-story-fixtures"

/**
 * 卡片上的启用按钮（Task 6）。
 *
 * 断言纪律（`#009-01`）：元素不存在一律用布尔式 `node === null`——happy-dom 节点直断
 * （`toBeNull()`）会让 bun 序列化环形引用，16 GiB 分配失败、看着像挂死。
 */
const 资产 = 样例资产({ id: "a1", name: "资金分析", status: "published", visibility: "global" })

function 挂(props: Parameters<typeof AssetCard>[0]) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <AssetCard {...props} />, host)
  // 卸载时连 host 一起摘：只 dispose 会把节点留在 document.body 里，污染后续全局查询
  return { host, dispose: () => { dispose(); host.remove() } }
}

describe("AssetCard 的启用按钮", () => {
  test("不给 onToggleEnabled ⇒ 卡片上没有启用按钮（storybook / 旧测试不受影响）", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {} })
    // ⚠️ 布尔断言，不要 `expect(节点).toBeNull()`：happy-dom 节点直断会让 bun 序列化环形引用，
    // 16 GiB 分配失败、看着像挂死（`LEARNINGS #009-01`，实测 31ms vs 爆炸）。
    expect(host.querySelector('[data-slot="asset-card-enable"]') === null).toBe(true)
    dispose()
  })

  test("不给 onToggleEnabled ⇒ 打开按钮不为启用按钮让位（pr-16 只在有启用按钮时加）", () => {
    const 无 = 挂({ asset: 资产, onOpen: () => {} })
    const 无按钮 = 无.host.querySelector<HTMLButtonElement>('[data-slot="asset-card-open"]')!
    // 没有启用按钮时正文不该被白吃掉右侧 64px（约束 6：不传新 prop 时与今天一致）。
    expect(无按钮.classList.contains("pr-16")).toBe(false)
    无.dispose()

    const 有 = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {} })
    const 有按钮 = 有.host.querySelector<HTMLButtonElement>('[data-slot="asset-card-open"]')!
    expect(有按钮.classList.contains("pr-16")).toBe(true)
    有.dispose()
  })

  test("给了就渲染，文案随 enabled 变", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {} })
    const 按钮 = host.querySelector('[data-slot="asset-card-enable"]')!
    expect(按钮.getAttribute("aria-pressed")).toBe("false")
    // 精确断言，不用 `toContain`：那对「已启用」也成立，恒回「已启用」的变异体会假绿（`#006-22`）
    expect(按钮.textContent?.trim()).toBe("启用")
    // 一屏多卡时当前名字全是「启用/已启用」，列表导航分不清是哪张 ⇒ 无障碍名带上资产名。
    expect(按钮.getAttribute("aria-label")).toBe("启用资产：资金分析")
    dispose()
  })

  test("已启用态：aria-pressed=true、文案是「已启用」", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {}, enabled: true })
    const 按钮 = host.querySelector('[data-slot="asset-card-enable"]')!
    expect(按钮.getAttribute("aria-pressed")).toBe("true")
    expect(按钮.textContent?.trim()).toBe("已启用")
    expect(按钮.getAttribute("aria-label")).toBe("停用资产：资金分析")
    dispose()
  })

  test("点启用不会顺带打开详情（两个按钮是 sibling，不是嵌套）", () => {
    let 打开 = 0
    let 切换 = 0
    const { host, dispose } = 挂({
      asset: 资产,
      onOpen: () => (打开 += 1),
      onToggleEnabled: () => (切换 += 1),
    })
    host.querySelector<HTMLButtonElement>('[data-slot="asset-card-enable"]')!.click()
    expect(切换).toBe(1)
    expect(打开).toBe(0)
    dispose()
  })

  test("被禁用时按钮 disabled 且把原因写在 title 上", () => {
    const { host, dispose } = 挂({
      asset: 资产,
      onOpen: () => {},
      onToggleEnabled: () => {},
      enableHint: "请先在左侧选择项目",
    })
    const 按钮 = host.querySelector<HTMLButtonElement>('[data-slot="asset-card-enable"]')!
    expect(按钮.disabled).toBe(true)
    expect(按钮.title).toBe("请先在左侧选择项目")
    dispose()
  })

  test("enableHint 是空串 ⇒ 不算禁用理由（禁用却不写原因是最糟的）", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {}, enableHint: "" })
    const 按钮 = host.querySelector<HTMLButtonElement>('[data-slot="asset-card-enable"]')!
    expect(按钮.disabled).toBe(false)
    expect(按钮.getAttribute("title")).toBe(null)
    dispose()
  })

  test("busy：按钮 disabled、aria-busy=true", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {}, busy: true })
    const 按钮 = host.querySelector<HTMLButtonElement>('[data-slot="asset-card-enable"]')!
    expect(按钮.disabled).toBe(true)
    expect(按钮.getAttribute("aria-busy")).toBe("true")
    dispose()
  })

  // 2026-11-03：服务端对非 skill 直接 409（只有 skill 能装进项目）。照画按钮 = 死按钮。
  test("MCP 就算接了 onToggleEnabled ⇒ 卡片上没有启用按钮、也不为它让位", () => {
    const { host, dispose } = 挂({
      asset: 样例资产({ id: "a1", name: "GoNavi", type: "mcp" }),
      onOpen: () => {},
      onToggleEnabled: () => {},
    })
    expect(host.querySelector('[data-slot="asset-card-enable"]') === null).toBe(true)
    expect(host.querySelector<HTMLElement>('[data-slot="asset-card-open"]')?.classList.contains("pr-16")).toBe(false)
    dispose()
  })

  test("知识库同理：没有启用按钮（同一个服务端判据，别只修 MCP）", () => {
    const { host, dispose } = 挂({
      asset: 样例资产({ id: "a1", name: "案情知识库", type: "knowledge_base" }),
      onOpen: () => {},
      onToggleEnabled: () => {},
    })
    expect(host.querySelector('[data-slot="asset-card-enable"]') === null).toBe(true)
    dispose()
  })
})

/**
 * 自动送达标记（需求 5a，2026-10-27）：自动装进项目的 skill 要**一眼看出来它不是我装的选择**，
 * 按钮也改名「固定安装」——那一下才会写进手动启用（此后不再随自动送达增减）。
 */
describe("AssetCard 的自动送达标记", () => {
  test("auto ⇒ 徽章「自动」、按钮文案「固定安装」", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {}, auto: true })
    expect(host.querySelector('[data-slot="asset-card-auto"]')?.textContent).toBe("自动")
    const 按钮 = host.querySelector('[data-slot="asset-card-enable"]')!
    // 精确断言（`#006-22`）：`toContain("安装")` 对「启用」不成立，但恒回「固定安装」的变异体也绿不了
    expect(按钮.textContent?.trim()).toBe("固定安装")
    expect(按钮.getAttribute("aria-pressed")).toBe("false")
    expect(按钮.getAttribute("aria-label")).toBe("固定安装资产：资金分析")
    dispose()
  })

  test("不是 auto ⇒ 不画徽章、文案仍是「启用」（加它之前逐字相同）", () => {
    const { host, dispose } = 挂({ asset: 资产, onOpen: () => {}, onToggleEnabled: () => {} })
    // 布尔断言避开 `#009-01`
    expect(host.querySelector('[data-slot="asset-card-auto"]') === null).toBe(true)
    expect(host.querySelector('[data-slot="asset-card-enable"]')?.textContent?.trim()).toBe("启用")
    dispose()
  })
})

/**
 * 卡片描述去格式（2026-10-31）：详情页渲染 Markdown，卡片那两行预览**仍是纯文字**
 * ——作者在 description 里写 `**加粗**`，卡片上不能露出星号。
 */
describe("AssetCard 的描述去 Markdown（2026-10-31）", () => {
  test("描述里的 **加粗** ⇒ 卡片显示「加粗」，不带星号", () => {
    const { host, dispose } = 挂({
      asset: 样例资产({ id: "a1", name: "资金分析", description: "**加粗**说明" }),
      onOpen: () => {},
    })
    const 描述 = host.querySelector<HTMLElement>('[data-slot="asset-card-description"]')
    expect(描述?.textContent?.trim()).toBe("加粗说明")
    expect((描述?.textContent ?? "").includes("*")).toBe(false)
    dispose()
  })
})

/**
 * 卡片上的收藏数 + 近 N 天使用次数（2026-10-30）：不进详情页也能看见。
 *
 * 卡片是定高 132px 的（见 `grid-model.ts`）：两者只占徽章行右端，不加行。
 * `favoriteCount` 设成 3 而不是默认 0，避免「默认值刚好满足断言」（`#005-47`）；
 * title 用全等，不用 `toContain`（`#006-22`）。
 */
describe("AssetCard 的收藏与使用统计（2026-10-30）", () => {
  const 带收藏 = () => 样例资产({ id: "a1", name: "资金分析", favoriteCount: 3 })
  const 用量: UsageStats = { days: 30, stats: { a1: { users: 3, calls: 12 } } }

  test("传 usage ⇒ 收藏段「3」、使用段「12次」、title 写清人数与次数", () => {
    const { host, dispose } = 挂({ asset: 带收藏(), onOpen: () => {}, usage: 用量 })
    const 统计块 = host.querySelector<HTMLElement>('[data-slot="asset-card-meta"]')
    if (!统计块) throw new Error("卡片上没有统计块")
    expect(统计块.getAttribute("title")).toBe("收藏：3 人；使用：最近 30 天 · 3 人用过 · 共 12 次")
    expect(host.querySelector('[data-slot="asset-card-meta-favorites"]')?.textContent?.trim()).toBe("3")
    expect(host.querySelector('[data-slot="asset-card-meta-usage"]')?.textContent?.trim()).toBe("12次")
    dispose()
  })

  test("不传 usage ⇒ 只有收藏段，没有使用段（旧调用方 / storybook 不受影响）", () => {
    const { host, dispose } = 挂({ asset: 带收藏(), onOpen: () => {} })
    expect(host.querySelector('[data-slot="asset-card-meta-favorites"]')?.textContent?.trim()).toBe("3")
    // 布尔断言避开 `#009-01`
    expect(host.querySelector('[data-slot="asset-card-meta-usage"]') === null).toBe(true)
    expect(host.querySelector('[data-slot="asset-card-meta"]')?.getAttribute("title")).toBe("收藏：3 人")
    dispose()
  })

  // 2026-11-03：MCP 的使用痕迹已落库（`kind='mcp'`），卡片照常显示；知识库仍不显示
  // ——抽取器不统计它，写 0 等于替后端回答一个它回答不了的问题（`#002-02`）。
  test("mcp ＋ usage ⇒ 有使用段（与 skill 同一档）", () => {
    const { host, dispose } = 挂({
      asset: 样例资产({ id: "a1", name: "话单碰撞", type: "mcp", favoriteCount: 3 }),
      onOpen: () => {},
      usage: 用量,
    })
    expect(host.querySelector('[data-slot="asset-card-meta-usage"]')?.textContent?.trim()).toBe("12次")
    expect(host.querySelector('[data-slot="asset-card-meta"]')?.getAttribute("title")).toBe(
      "收藏：3 人；使用：最近 30 天 · 3 人用过 · 共 12 次",
    )
    dispose()
  })

  test("知识库 ＋ usage ⇒ 没有使用段（抽取器不统计它）", () => {
    const { host, dispose } = 挂({
      asset: 样例资产({ id: "a1", name: "案情知识库", type: "knowledge_base", favoriteCount: 3 }),
      onOpen: () => {},
      usage: 用量,
    })
    expect(host.querySelector('[data-slot="asset-card-meta-usage"]') === null).toBe(true)
    expect(host.querySelector('[data-slot="asset-card-meta"]')?.getAttribute("title")).toBe("收藏：3 人")
    dispose()
  })
})
