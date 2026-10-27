import { describe, expect, test } from "bun:test"
// ⚠️ 用 `solid-js/web` 的 `render`：本仓**没有** `@solidjs/testing-library`
// （`src/project/backup-restore-dialog.test.tsx:6` 明确写着那是别的仓的写法）
import { render } from "solid-js/web"
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
})
