import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { EnableApi, EnableOutcome, 内核技能, 被覆盖技能 } from "@/ai-assets/enable-api"
import { createProjectEnablement } from "@/ai-assets/enable-state"
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

/**
 * 说明预览挂 `Portal` 到 `document.body` 下（见文末那一组），宿主子树里找不到它。
 *
 * 故本文件必须清 body：本文件原先一个用例都不清理，宿主会一路堆下去；预览一旦按
 * `document` 取，前一个用例没关的盒子就会被后一个用例当成自己的（同 `session-nav.test.tsx` 的收尾）。
 */
afterEach(() => {
  document.body.innerHTML = ""
})

const 槽 = (host: HTMLElement, slot: string) => [...host.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`)]
const 一 = (host: HTMLElement, slot: string) => host.querySelector<HTMLElement>(`[data-slot='${slot}']`)
const 有 = (host: HTMLElement, slot: string) => 一(host, slot) !== null
const 文 = (host: HTMLElement, slot: string) => 一(host, slot)?.textContent ?? ""

const 技能 = (over: {
  name: string
  assetId?: string
  assetName?: string
  description?: string
}): 内核技能 => ({
  name: over.name,
  location: `/w/u/p/.opencode/skill/${over.assetId ?? over.name}/SKILL.md`,
  ...(over.assetId === undefined ? {} : { assetId: over.assetId }),
  ...(over.assetName === undefined ? {} : { assetName: over.assetName }),
  ...(over.description === undefined ? {} : { description: over.description }),
})

function 面板(over: Partial<CapabilityPanelProps> = {}) {
  return mount(() => (
    <CapabilityPanel
      hasProject={over.hasProject ?? (() => true)}
      enabled={over.enabled ?? (() => new Set(["a1"]))}
      enabledCount={over.enabledCount ?? (() => 1)}
      skills={over.skills ?? (() => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })])}
      shadowed={over.shadowed ?? (() => undefined)}
      error={over.error ?? (() => undefined)}
      // 默认 `false`：本文件的夹具大多表达「还没读到」，那是「正在读取」的形状（I2）。
      readDone={over.readDone ?? (() => false)}
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

  /**
   * 组头右侧箭头（终审 M2）：展开的以 `⌄` 结尾、收起的以 `›` 结尾。
   *
   * 断的是 `textContent` 的结尾字符，**不比较节点**（`#009-01`：比节点会让整轮测试挂死）。
   */
  test("组头箭头：展开的以 ⌄ 结尾、收起的以 › 结尾", () => {
    const host = 面板()
    expect(文(host, "capability-group-skill").trimEnd().endsWith("⌄")).toBe(true)
    expect(文(host, "capability-group-knowledge").trimEnd().endsWith("›")).toBe(true)
    expect(文(host, "capability-group-mcp").trimEnd().endsWith("›")).toBe(true)

    // 换一组展开 ⇒ 箭头跟着翻转（不是写死的）。
    一(host, "capability-group-mcp")?.click()

    expect(文(host, "capability-group-mcp").trimEnd().endsWith("⌄")).toBe(true)
    expect(文(host, "capability-group-skill").trimEnd().endsWith("›")).toBe(true)
  })

  test("知识库横条不写数字，写「即将支持」", () => {
    const host = 面板()
    expect(文(host, "capability-group-knowledge")).toContain("即将支持")
    // 不光排除 `0 个`：整条横条**一个阿拉伯数字都不许有**（写成 `· 5 个` 同样是假话）。
    expect(文(host, "capability-group-knowledge")).not.toMatch(/\d/)
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

  test("② 没生效的条目恰有一个停用按钮，并给出文字指引（不给第二个按钮）", () => {
    const host = 面板({ enabled: () => new Set(["a9"]), enabledCount: () => 1, skills: () => [] })
    expect(槽(host, "capability-item-stale").length).toBe(1)
    expect(槽(host, "capability-disable").length).toBe(1)
    expect(文(host, "capability-item-stale")).toContain("停用后可在资产中心重新启用")
  })

  /**
   * ② 的第二成因：链接好好的，只是被一份同名技能盖掉了（2026-10-28 真栈现场）。
   *
   * 旧文案「项目里的快捷方式可能丢了」在那时是**诬告**，还劝用户在假故障上停用。
   * 判据落在两处：条目仍是 stale（它确实没生效），但指引说的是「被谁盖了」，
   * 且**不再出现**「快捷方式可能丢了」。槽名也分开，免得两种成因的文案互相顶替还能全绿。
   */
  test("② 被同名技能盖掉 ⇒ 文案说出赢家，不说「快捷方式可能丢了」", () => {
    const 盖: 被覆盖技能[] = [
      { assetId: "a1", name: "资金分析", location: "/w/u/p/.opencode/skill/aaa_shadow/SKILL.md" },
    ]
    const host = 面板({
      enabled: () => new Set(["a1"]),
      enabledCount: () => 1,
      skills: () => [技能({ name: "资金分析", assetId: "aaa_shadow" })],
      shadowed: () => 盖,
      readDone: () => true,
    })
    expect(槽(host, "capability-item-stale").length).toBe(1)
    const 话 = 文(host, "capability-shadowed-reason")
    expect(话).toContain("同名")
    expect(话).toContain("资金分析")
    expect(话).not.toContain("快捷方式可能丢了")
    // 两种成因不能同时出现（`Show` 的 fallback 只该落一边）。
    expect(有(host, "capability-stale-reason")).toBe(false)
  })

  test("② 链接真丢了（没有 shadowed）⇒ 仍是原来那句「快捷方式可能丢了」", () => {
    const host = 面板({ enabled: () => new Set(["a9"]), enabledCount: () => 1, skills: () => [], readDone: () => true })
    expect(文(host, "capability-stale-reason")).toContain("快捷方式可能丢了")
    expect(有(host, "capability-shadowed-reason")).toBe(false)
  })

  test("busy 指向某条时，该条的停用按钮禁用、点了不触发", () => {
    let 收到: string | undefined
    const host = 面板({ busy: () => "a1", onToggle: (id) => (收到 = id) })
    const 钮 = host.querySelector<HTMLButtonElement>("[data-slot='capability-disable']")
    expect(钮?.disabled).toBe(true)
    钮?.click()
    expect(收到).toBe(undefined)
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
    expect(文(host, "capability-out-of-scope")).toContain("项目共启用 4 个，其中 3 个不在你的授权范围。")
  })

  test("项目真相与我能用的一样多时，不出现那行", () => {
    const host = 面板({ enabled: () => new Set(["a1"]), enabledCount: () => 1 })
    expect(有(host, "capability-out-of-scope")).toBe(false)
  })

  // 两种「没有数」是两件事（`#002-02`）：从没读到 ≠ 读失败。
  test("还没读到内核数据（且没报错）⇒ 说「正在读取」，不画组头、不画重试", () => {
    const host = 面板({ skills: () => undefined })
    expect(文(host, "capability-loading")).toContain("正在读取")
    expect(有(host, "capability-unreadable")).toBe(false)
    expect(有(host, "capability-retry")).toBe(false)
    expect(有(host, "capability-group-skill")).toBe(false)
    expect(有(host, "capability-group-knowledge")).toBe(false)
    expect(有(host, "capability-group-mcp")).toBe(false)
    expect(有(host, "capability-count-skill")).toBe(false)
    expect((host.textContent ?? "")).not.toContain("0 个")
  })

  test("接口失败 ⇒ 整块换成重试，组头、计数、条目一个都不画", () => {
    const host = 面板({ error: () => "网络请求失败", skills: () => undefined })
    expect(有(host, "capability-unreadable")).toBe(true)
    expect(有(host, "capability-retry")).toBe(true)
    expect(槽(host, "capability-item-loaded").length).toBe(0)
    expect(槽(host, "capability-item-stale").length).toBe(0)
    expect(有(host, "capability-group-skill")).toBe(false)
    expect(有(host, "capability-group-knowledge")).toBe(false)
    expect(有(host, "capability-group-mcp")).toBe(false)
    expect(有(host, "capability-count-skill")).toBe(false)
  })

  test("失败但 skills 还留着上次的旧值 ⇒ 仍是重试块，不把旧数据画成自带条目", () => {
    const host = 面板({
      error: () => "网络请求失败",
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })],
    })
    expect(有(host, "capability-retry")).toBe(true)
    expect(槽(host, "capability-item-local").length).toBe(0)
    expect(槽(host, "capability-item-loaded").length).toBe(0)
    expect(有(host, "capability-count-skill")).toBe(false)
  })

  test("error 是空串也算失败（判据是 !== undefined，不是真值）⇒ 仍重试，不画旧数据", () => {
    const host = 面板({
      error: () => "",
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })],
    })
    expect(有(host, "capability-unreadable")).toBe(true)
    expect(有(host, "capability-retry")).toBe(true)
    expect(槽(host, "capability-item-loaded").length).toBe(0)
    expect(槽(host, "capability-item-stale").length).toBe(0)
    expect(槽(host, "capability-item-local").length).toBe(0)
    expect(有(host, "capability-group-skill")).toBe(false)
    expect(有(host, "capability-group-knowledge")).toBe(false)
    expect(有(host, "capability-group-mcp")).toBe(false)
    expect(有(host, "capability-count-skill")).toBe(false)
  })

  test("重试按钮把回调交出去", () => {
    let 点过 = false
    const host = 面板({ error: () => "网络请求失败", onRetry: () => (点过 = true) })
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

/**
 * **数据变了，面板要跟着重绘**（终审 C1 / I4）。
 *
 * 上一组的 props 全是「返回常量的箭头函数」——它们在结构上就表达不了「数据变了」，
 * 于是一条「`清单` 在回调里当场求值、把数组烧死」的 Critical 从这条缝里溜了过去。
 * 本组一律用 `createSignal` 驱动：先断初值，**改信号**，再断同一个 pane 跟着变。
 *
 * Solid 的更新是同步的（没有异步调度），所以改完信号立刻断言即可，不需要 `await`。
 */
describe("CapabilityPanel 跟着数据重绘（信号驱动，C1）", () => {
  test("enabled 从 {a1} 变空 ⇒ 组头计数变小、条目从「已加载」变「本项目自带」", () => {
    const [启用, 设启用] = createSignal<ReadonlySet<string>>(new Set(["a1"]))
    const host = mount(() => (
      <CapabilityPanel
        hasProject={() => true}
        enabled={启用}
        enabledCount={() => 启用().size}
        skills={() => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })]}
        shadowed={() => undefined}
        error={() => undefined}
        readDone={() => false}
        busy={() => undefined}
        onToggle={() => {}}
        onRetry={() => {}}
      />
    ))

    // 前置：初值真的按「已启用」画（否则下面的变化断不出东西）。
    expect(文(host, "capability-count-skill")).toContain("1 个")
    expect(槽(host, "capability-item-loaded").length).toBe(1)

    设启用(new Set<string>())

    expect(文(host, "capability-count-skill")).toContain("0 个")
    expect(槽(host, "capability-item-loaded").length).toBe(0)
    expect(槽(host, "capability-item-local").length).toBe(1)
  })

  /**
   * **收起状态的组头**也要跟着变。
   *
   * 展开中的那个组头由 `{组头(展开(), …)}` 画——它的外层渲染 effect 顺带读到了清单，
   * 所以「把清单烧成数组」这种改法在**它身上会被遮住**（终审修复轮实测：只拆 `组头` 的
   * 形参，其它用例全绿）。收起的组走的是 `For each={前面()}`，回调只在条目集合变化时重跑，
   * 烧死的清单在那里不会自己醒过来 ⇒ 这条是那个改法唯一会被抓到的形状。
   */
  test("收起的组头也跟着变（技能组落到「前面」里时，计数仍然是活的）", () => {
    const [启用, 设启用] = createSignal<ReadonlySet<string>>(new Set(["a1"]))
    const host = mount(() => (
      <CapabilityPanel
        hasProject={() => true}
        enabled={启用}
        enabledCount={() => 启用().size}
        skills={() => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" })]}
        shadowed={() => undefined}
        error={() => undefined}
        readDone={() => false}
        busy={() => undefined}
        onToggle={() => {}}
        onRetry={() => {}}
      />
    ))

    // 把「技能」挤进「前面」：点开知识库，技能组头就变成收起状态的那一条。
    一(host, "capability-group-knowledge")?.click()
    expect(一(host, "capability-group-skill")?.getAttribute("aria-expanded")).toBe("false")
    expect(文(host, "capability-count-skill")).toContain("1 个")

    设启用(new Set<string>())

    expect(文(host, "capability-count-skill")).toContain("0 个")
  })

  test("skills 整份换成另一组 ⇒ 条目集合跟着换（不是留在旧数组上）", () => {
    const [清单, 设清单] = createSignal<readonly 内核技能[]>([技能({ name: "甲工具" })])
    const host = mount(() => (
      <CapabilityPanel
        hasProject={() => true}
        enabled={() => new Set<string>()}
        enabledCount={() => 0}
        skills={清单}
        shadowed={() => undefined}
        error={() => undefined}
        readDone={() => false}
        busy={() => undefined}
        onToggle={() => {}}
        onRetry={() => {}}
      />
    ))

    expect(文(host, "capability-item-local")).toContain("甲工具")

    设清单([技能({ name: "乙工具" })])

    expect(文(host, "capability-item-local")).toContain("乙工具")
    expect((host.textContent ?? "").includes("甲工具")).toBe(false)
  })

  /**
   * 读完了、但内核清单还是 `undefined` ⇒ **重试视图**，不是「正在读取…」（终审 I2）。
   *
   * 「正在读取…」没有任何 UI 出口（`reload()` 在面板上只有这个重试按钮）。读不到却永远
   * 停在「正在读取」，用户除了重启应用没有别的路。
   */
  test("readDone 且 skills 仍是 undefined ⇒ 走重试视图，不写 0、不画组头/条目", () => {
    const host = 面板({ skills: () => undefined, readDone: () => true, enabled: () => new Set(["a"]), enabledCount: () => 4 })
    expect(有(host, "capability-unreadable")).toBe(true)
    expect(有(host, "capability-retry")).toBe(true)
    expect(文(host, "capability-loading")).not.toContain("正在读取")
    expect(有(host, "capability-group-skill")).toBe(false)
    expect(槽(host, "capability-item-loaded").length).toBe(0)
    expect((host.textContent ?? "").includes("0 个")).toBe(false)
    // I2 第 4 点：这一态下「其中 N 个不在你的授权范围」不可能出现——
    // 它要把 `enabledCount ?? 0` 与空集合相减，凭空造出一个「权威的 0」。
    expect(有(host, "capability-out-of-scope")).toBe(false)
  })

  test("readDone 从 false 变 true（读完了但没读到）⇒ 同一个面板从「正在读取」换成重试", () => {
    const [读完, 设读完] = createSignal(false)
    const host = mount(() => (
      <CapabilityPanel
        hasProject={() => true}
        enabled={() => new Set<string>()}
        enabledCount={() => 0}
        skills={() => undefined}
        shadowed={() => undefined}
        error={() => undefined}
        readDone={读完}
        busy={() => undefined}
        onToggle={() => {}}
        onRetry={() => {}}
      />
    ))
    expect(有(host, "capability-loading")).toBe(true)

    设读完(true)

    expect(有(host, "capability-retry")).toBe(true)
    expect(有(host, "capability-loading")).toBe(false)
  })

  /**
   * **端到端**（残余修复，复审）：好面板 → 故障期点「停用」（回包 200 但没有 `skills` 键）
   * ⇒ 清单作废 ⇒ 同一个面板换成重试块，**不留计数、不留条目**。
   *
   * 这条走 `createProjectEnablement` 真状态层，不是手搓信号：上一版「有键才覆盖」在这条路径上
   * 会把新集合配旧清单，`合并能力` 把刚停用的那条画成「📝 本项目自带」幽灵条目
   *（或把刚启用的画成「快捷方式可能丢了，停用后可在资产中心重新启用」）——I3 从侧门回来。
   *
   * ⚠️ 断言全是结构/文本，不比较节点（`#009-01`）。
   */
  test("端到端：故障期点停用（回包无 skills 键）⇒ 面板换成重试块，不写计数、不留条目", async () => {
    const 读回包: EnableOutcome[] = [
      {
        kind: "ok",
        value: {
          enabled: ["a1"],
          enabledCount: 1,
          limit: 20,
          auto: [],
          autoDelivery: true,
          skills: [技能({ name: "资金分析", assetId: "a1", assetName: "资金流向分析" })],
        },
      },
    ]
    // 停用成功，但这次后端没读到内核 ⇒ 键缺席。
    const 写回包: EnableOutcome[] = [
      { kind: "ok", value: { enabled: [], enabledCount: 0, limit: 20, auto: [], autoDelivery: true } },
    ]
    const api: EnableApi = {
      read: async () => 读回包.shift()!,
      enable: async () => 写回包.shift()!,
      disable: async () => 写回包.shift()!,
      setAutoDelivery: async () => 写回包.shift()!,
    }
    const 状态 = createProjectEnablement(api)
    const host = mount(() => (
      <CapabilityPanel
        hasProject={() => true}
        enabled={状态.enabled}
        enabledCount={状态.enabledCount}
        skills={状态.skills}
        shadowed={状态.shadowed}
        readDone={状态.readDone}
        error={状态.error}
        busy={状态.busy}
        onToggle={状态.toggle}
        onRetry={状态.reload}
      />
    ))
    状态.bind(() => "p1")
    await new Promise((r) => setTimeout(r, 0))

    // 前置：好面板（有计数、有已加载条目），否则下面「换成重试块」断不出东西。
    expect(文(host, "capability-count-skill")).toContain("1 个")
    expect(槽(host, "capability-item-loaded").length).toBe(1)

    一(host, "capability-disable")?.click()
    await new Promise((r) => setTimeout(r, 0))

    expect(有(host, "capability-unreadable")).toBe(true)
    expect(有(host, "capability-retry")).toBe(true)
    expect(有(host, "capability-count-skill")).toBe(false)
    expect(槽(host, "capability-item-loaded").length).toBe(0)
    expect(槽(host, "capability-item-stale").length).toBe(0)
    expect(槽(host, "capability-item-local").length).toBe(0)
    expect((host.textContent ?? "").includes("0 个")).toBe(false)
  })

  test("skills 从数组变 undefined（换了项目、新回包还没到）⇒ 回到「正在读取」，旧条目一个不剩", () => {
    const [清单, 设清单] = createSignal<readonly 内核技能[] | undefined>([技能({ name: "甲工具" })])
    const host = mount(() => (
      <CapabilityPanel
        hasProject={() => true}
        enabled={() => new Set<string>()}
        enabledCount={() => 0}
        skills={清单}
        shadowed={() => undefined}
        error={() => undefined}
        readDone={() => false}
        busy={() => undefined}
        onToggle={() => {}}
        onRetry={() => {}}
      />
    ))

    expect(槽(host, "capability-item-local").length).toBe(1)

    设清单(undefined)

    expect(有(host, "capability-loading")).toBe(true)
    expect(槽(host, "capability-item-local").length).toBe(0)
    expect(有(host, "capability-group-skill")).toBe(false)
  })
})

/**
 * 说明不再占卡片一行（2026-10-28 用户裁定：「卡片上 名称／来源／说明／停用 四行太挤」）。
 *
 * 改成**悬停 / 聚焦时从卡片右侧弹出**的预览；并且必须画在**顶层**——左栏 `aside` 与三层卡片壳
 * 都是 `overflow: hidden`（`three-pane.tsx`），留在左栏这棵裁剪树里的预览会在栏边被裁掉。
 * 这条与 `session-nav` 的悬停预览同因（那里的实测见 `e2e/real-stack/session-nav-real.spec.ts` ③b），
 * 解法也同一条：`Portal` 到 body 下 ＋ `position: fixed`。
 *
 * happy-dom 不跑布局（`#005-07`）⇒「有没有被裁」「位置对不对」本层量不出来，那是真栈的判据。
 * 本层钉的是**结构、作用对象与机制**：卡片里还有没有那行字、弹的是**这一张**的说明、
 * 盒子挂在哪里、用的是哪个图标。
 */
describe("技能说明：卡片里不显示，悬停 / 聚焦时右侧预览（2026-10-28）", () => {
  const 甲说 = "甲的说明：按对手方聚合近三个月流水"
  const 乙说 = "乙的说明：把话单按时间段切片"

  /** 两张**说明不同**的自带条目：作用对象判据靠这个分得开（`#005-19`）。 */
  const 两只 = () => [技能({ name: "甲", description: 甲说 }), 技能({ name: "乙", description: 乙说 })]

  // ⚠️ 预览按 `document` 取、不按宿主取：它挂在 body 下（见下面那条机制判据）。
  const 预览个数 = () => document.querySelectorAll('[data-slot="capability-hover-preview"]').length
  const 预览文字 = () => document.querySelector('[data-slot="capability-hover-preview"]')?.textContent ?? ""

  const 进 = (元素: Element) => 元素.dispatchEvent(new MouseEvent("mouseenter"))
  const 出 = (元素: Element) => 元素.dispatchEvent(new MouseEvent("mouseleave"))

  // 焦点事件走冒泡的 `focusin` / `focusout`（Solid 的 onFocusIn/onFocusOut 就挂这两个），
  // 所以可以直接派在卡里的按钮上，处理器拿到的 `currentTarget` 仍是卡片。
  const 聚焦进 = (元素: Element) => 元素.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
  const 聚焦出 = (元素: Element, relatedTarget: EventTarget | null) =>
    元素.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget }))

  test("卡片里不再有说明那一段——说明只剩给读屏的那一份", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: () => [技能({ name: "甲", description: 甲说 })] })
    const 卡 = 一(host, "capability-item-local")!

    // 判据是「卡片里没有说明的可见段落」，不是「看不看得见」——CSS 藏起来也算藏错方向：
    // 用户要的是**省掉这一行**，不是留着占位。
    expect(卡.querySelector("p"), "说明不该再是卡片里的一行").toBeNull()
    const 读屏 = 卡.querySelector<HTMLElement>('[data-slot="capability-desc-sr"]')
    expect(读屏?.textContent, "说明要留给读屏").toBe(甲说)
    // 「读屏看得见、眼睛看不见」全靠 `sr-only` 这一个类（happy-dom 不跑 CSS，量不出实际渲染，
    // 所以钉的是机制本身）。拆掉它，下面这条就是最后一道闸——实际变异验证过。
    expect(读屏?.classList.contains("sr-only"), "那份说明必须真的只在读屏里").toBe(true)
  })

  test("没有说明的条目 ⇒ 什么都不留（不留一个空的读屏节点）", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: () => [技能({ name: "甲" })] })
    const 卡 = 一(host, "capability-item-local")!

    expect(卡.querySelector('[data-slot="capability-desc-sr"]')).toBeNull()
  })

  test("悬停第一张 ⇒ 弹出**这一张**的说明（作用对象判据）", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: 两只 })
    const 卡们 = 槽(host, "capability-item-local")

    进(卡们[0])

    expect(预览个数()).toBe(1)
    expect(预览文字()).toBe(甲说)
  })

  test("悬停第二张 ⇒ 弹的是第二张的（不是第一张的，也不是两张堆在一起）", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: 两只 })
    const 卡们 = 槽(host, "capability-item-local")

    进(卡们[0])
    进(卡们[1])

    expect(预览个数()).toBe(1)
    expect(预览文字()).toBe(乙说)
  })

  test("库内（资产库）条目也照样弹——两个来源的说明都走同一条路", () => {
    const host = 面板({
      enabled: () => new Set(["a1"]),
      enabledCount: () => 1,
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析", description: 甲说 })],
    })

    进(一(host, "capability-item-loaded")!)

    expect(预览文字()).toBe(甲说)
  })

  test("条目没有说明 ⇒ 悬停不弹（不给一个空盒子）", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: () => [技能({ name: "甲" })] })

    进(一(host, "capability-item-local")!)

    expect(预览个数()).toBe(0)
  })

  test("鼠标移出卡片 ⇒ 预览收掉", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: 两只 })
    const 卡 = 槽(host, "capability-item-local")[0]
    进(卡)
    // 前置先钉「出来过」：不然「收掉」这条在一个从没弹过的实现上照样绿。
    expect(预览个数()).toBe(1)

    出(卡)

    expect(预览个数()).toBe(0)
  })

  /**
   * ⚠️ 机制判据：预览逃出了左栏这棵裁剪树。
   *
   * 与 `session-nav.test.tsx` 同一条：不断「父节点 === body」（`Portal` 会自建一层包裹 div，
   * 断那个只钉住它的内部形状），断的是**它已经不在宿主子树里、且自己是 `fixed` 定位**
   * ——两件缺一不可：只 Portal 不 fixed，位置仍按裁剪盒算；只 fixed 不 Portal，祖先照样裁它。
   */
  test("⚠️ 预览挂在 body 下 ＋ position:fixed——两件一起才逃得开左栏的 overflow:hidden", () => {
    const host = 面板({ enabled: () => new Set(), enabledCount: () => 0, skills: 两只 })

    进(槽(host, "capability-item-local")[0])

    const 预览 = document.querySelector<HTMLElement>('[data-slot="capability-hover-preview"]')!
    expect(预览, "预览该画出来了").not.toBeNull()
    expect(host.contains(预览), "预览不该还在左栏（宿主）子树里").toBe(false)
    expect(document.body.contains(预览), "预览该挂在 body 下（Portal）").toBe(true)
    expect(预览.style.position, "fixed 才会按视口定位、不参与祖先的裁剪盒").toBe("fixed")
  })

  test("键盘：焦点进卡片（落在停用按钮上）⇒ 弹；焦点离开卡片 ⇒ 收", () => {
    const host = 面板({
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析", description: 甲说 })],
    })
    const 卡 = 一(host, "capability-item-loaded")!
    const 钮 = 卡.querySelector<HTMLElement>('[data-slot="capability-disable"]')!

    聚焦进(钮)

    expect(预览文字()).toBe(甲说)

    聚焦出(钮, document.body)

    expect(预览个数()).toBe(0)
  })

  test("焦点在卡片**内部**挪动（卡片 → 停用按钮）⇒ 不收", () => {
    const host = 面板({
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析", description: 甲说 })],
    })
    const 卡 = 一(host, "capability-item-loaded")!
    const 钮 = 卡.querySelector<HTMLElement>('[data-slot="capability-disable"]')!

    聚焦进(卡)
    expect(预览个数()).toBe(1)

    聚焦出(卡, 钮) // relatedTarget 仍在卡内

    expect(预览个数(), "焦点还在卡里，预览不该闪一下就没").toBe(1)
  })

  /**
   * 悬停灰底（2026-10-28 用户要求）。happy-dom 不跑 CSS ⇒ 量不出「灰没灰」，钉的是**机制**：
   * 两类卡片都挂的是项目统一的那一枚 hover 覆盖层令牌（与组头、资产卡同一档），不另造色。
   */
  test("两类卡片都带同一枚悬停灰底令牌", () => {
    const host = 面板({
      enabled: () => new Set(["a1"]),
      enabledCount: () => 1,
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" }), 技能({ name: "甲" })],
    })
    const 令牌 = "hover:bg-v2-overlay-simple-overlay-hover"

    expect(一(host, "capability-item-loaded")!.classList.contains(令牌), "库内卡片要有悬停灰底").toBe(true)
    expect(一(host, "capability-item-local")!.classList.contains(令牌), "自带卡片要有悬停灰底").toBe(true)
  })

  test("来源标记换成官方 archive 图标 ＋「资产库」，不再用 📦", () => {
    const host = 面板()
    const 来源 = 一(host, "capability-source")!

    expect(来源.querySelector('[data-component="icon"] use')?.getAttribute("href")).toBe("#opencode-icon-archive")
    expect(来源.textContent).toContain("资产库")
    expect(来源.textContent).not.toContain("📦")
  })
})

/**
 * 拖技能卡片到右栏输入框（2026-10-29 用户提出）。
 *
 * 本组件只交出「这张卡能不能拖、拖出去带什么」；放下以后插什么、插在哪儿，归右栏
 * （`session-panel` 那一侧收货）。两侧的 MIME 型与句子都从 `@/ai-session/skill-drop` 取，
 * 这里仍按**字面量**断——断的是跨栏契约本身，不是「函数调了函数」（`#003-05`）。
 */
describe("技能卡片是拖拽源（2026-10-29）", () => {
  /** 起一次 `dragstart`，把 `setData` 写进来的载荷收下来。happy-dom 不造真 DataTransfer。 */
  const 拖起 = (卡: HTMLElement) => {
    const 存 = new Map<string, string>()
    const 事件 = new Event("dragstart", { bubbles: true, cancelable: true })
    Object.defineProperty(事件, "dataTransfer", {
      value: {
        effectAllowed: "",
        setData: (型: string, 值: string) => void 存.set(型, 值),
      },
    })
    卡.dispatchEvent(事件)
    return 存
  }

  const 两张 = () => [
    技能({ name: "fund", assetId: "a1", assetName: "资金流向分析" }),
    技能({ name: "话单分析" }),
  ]

  test("能用的才可拖：库内已加载 ＋ 自带", () => {
    const host = 面板({ enabled: () => new Set(["a1"]), enabledCount: () => 1, skills: 两张 })

    expect(一(host, "capability-item-loaded")?.getAttribute("draggable")).toBe("true")
    expect(一(host, "capability-item-local")?.getAttribute("draggable")).toBe("true")
  })

  test("没生效的库内卡（② 已启用但内核没加载到）不能拖", () => {
    // `enabled` 有 a1，但内核清单里没有它 ⇒ `loaded: false`。
    const host = 面板({ enabled: () => new Set(["a1"]), enabledCount: () => 1, skills: () => [] })
    const 卡 = 一(host, "capability-item-stale")!

    expect(卡.getAttribute("draggable") === "true", "拖了也只会得到一句「请使用…」，AI 那边没有这个技能").toBe(false)
    // 起拖也带不出任何载荷（处理器根本没挂）。
    expect(拖起(卡).size).toBe(0)
  })

  test("拖出去带两种载荷：自定义型给右栏认，text/plain 给别的应用看人话", () => {
    const host = 面板({ enabled: () => new Set(["a1"]), enabledCount: () => 1, skills: 两张 })

    const 存 = 拖起(一(host, "capability-item-loaded")!)

    expect(存.get("application/x-openhive-skill")).toBe("skill:资金流向分析")
    // 拖进记事本时落下的是这句话，而不是 `skill:资金流向分析`。
    expect(存.get("text/plain")).toBe("请使用“资金流向分析”技能帮我")
  })

  test("自带卡片带的是它自己的名字（不是库里的资产名）", () => {
    const host = 面板({ enabled: () => new Set(["a1"]), enabledCount: () => 1, skills: 两张 })

    const 存 = 拖起(一(host, "capability-item-local")!)

    expect(存.get("application/x-openhive-skill")).toBe("skill:话单分析")
  })

  test("起拖时收掉悬停预览（拖拽期间没有 mouseleave，不收就孤零零留在屏上）", () => {
    const host = 面板({
      enabled: () => new Set(["a1"]),
      enabledCount: () => 1,
      skills: () => [技能({ name: "fund", assetId: "a1", assetName: "资金流向分析", description: "甲说" })],
    })
    const 卡 = 一(host, "capability-item-loaded")!
    卡.dispatchEvent(new MouseEvent("mouseenter"))
    expect(document.querySelector('[data-slot="capability-hover-preview"]') !== null, "前置：预览要先出来").toBe(true)

    拖起(卡)

    expect(document.querySelector('[data-slot="capability-hover-preview"]')).toBeNull()
  })
})
