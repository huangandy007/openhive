import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { GENERIC_MODULE } from "./capabilities"
import type { ProjectedCard } from "./projection"
import { ContextCards } from "./context-cards"

/**
 * 「上下文指令」层（FR-003 / US2 / DESIGN §4.7 第二行）。
 *
 * 这一层的**判据是「出现 / 消失」**，不是「长得对不对」——长相是共享语法的事（T004 已钉过
 * §4.7.1 / §4.7.2 的每一格）。所以本文件的重点只有两条：
 * ① **有对应上下文才浮出来，且只浮出对得上的那几张**；② **没有就整段消失**（连分组标题都不留，
 * spec.md US2 场景 2 与「无上下文时，上下文指令卡消失，不占空间」）。
 *
 * ⚠️ 本文件里**没有**「这个上下文从哪来」的断言：中栏今天没有任何右栏读得到的「选中」状态
 * （`CenterTabState` 只有 `tabs` / `active` / `module` 三个字段；`project/file-tree.tsx` 的选中行是
 * **组件内部状态**），且 `MANIFESTS` 的 `cards` 全为空 ⇒ 生产里这一层今天必然不渲染。
 * 这是**缺口**，按 `LEARNINGS #002-02` 记在 `state.md`，**不写成「已覆盖」**。
 * 本文件证的是**机制**：喂一份上下文集合，它就该按契约浮出来。
 */

/** 挂过的实例，外层 `afterEach` 里统一卸载（`LEARNINGS #005-03`，顺序：先 dispose 再摘节点）。 */
const 挂过的: Array<() => void> = []

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(element, host)
  挂过的.push(() => {
    dispose()
    host.remove()
  })
  return host
}

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
})

const 槽 = (host: HTMLElement, 名: string) => [...host.querySelectorAll<HTMLElement>(`[data-slot='${名}']`)]

/**
 * 「某处没有这个元素」一律断在**布尔**上（`LEARNINGS #005-01`）：把 Solid 渲染过的**节点**当实得值，
 * 断言红了 bun 会去打印它，**整轮 `bun test` 会挂死**——看着像「还没跑完」，取不到任何结果。
 */
const 无槽 = (host: HTMLElement, 名: string) => 槽(host, 名).length === 0

/** 卡片渲染出来的文案顺序（这一层的判据全在这个序列上）。 */
const 卡面 = (host: HTMLElement) => 槽(host, "card").map((el) => el.textContent)

/**
 * 上下文键的取值。**006 不定义词表**——这里用 FR-003 自己举的那两样当夹具
 * （「选中账户/号码、上传文件」），不是 006 拍的词。真词表由各模块的内容作者定。
 */
const 选中账户 = "选中账户"
const 上传文件 = "上传文件"

const 造卡 = (label: string, prompt: string, context: string, module = "fund-analysis"): ProjectedCard => ({
  label,
  prompt,
  layer: "context",
  context,
  skill: `${module}-skill`,
  module,
})

/** 三张都要「选中账户」（甲卡 / 丙卡是模块自己的，通用上下文卡跨模块常在）。 */
const 甲卡 = 造卡("查甲的流水", "查一下甲的流水", 选中账户)
const 丙卡 = 造卡("看甲的对端", "列出甲的对端", 选中账户)
const 通用上下文卡 = 造卡("记一笔研判", "帮我记一笔研判", 选中账户, GENERIC_MODULE)
/** 要另一个上下文——用来证「只浮出对得上的」。 */
const 乙卡 = 造卡("看话单", "拉一下这个号码的话单", 上传文件)

/** 默认那一组：一张要「选中账户」、一张要「上传文件」。 */
const 甲与乙 = [甲卡, 乙卡]

function mountCards(props: {
  cards?: ProjectedCard[]
  contexts: string[]
  availableWidth?: number
  activePrompt?: string
  onPick?: (卡: ProjectedCard) => void
}) {
  return mount(() => (
    <ContextCards
      cards={props.cards ?? 甲与乙}
      contexts={props.contexts}
      availableWidth={"availableWidth" in props ? props.availableWidth : 1000}
      activePrompt={props.activePrompt}
      onPick={props.onPick}
    />
  ))
}

describe("上下文指令（FR-003 / US2 / DESIGN §4.7）", () => {
  test("有对应上下文 ⇒ 浮现：「上下文指令」分组标题 ＋ 对得上的那一张", () => {
    // 这一条同时是**「机制是活的」的对照**（`LEARNINGS #004-08`）：下面几条断的是「不渲染」，
    // 若整段根本就没在工作，它们也会绿——所以先把「该出来时真的出来了」钉住。
    const host = mountCards({ contexts: [选中账户] })

    expect(槽(host, "card-row-title").map((el) => el.textContent)).toEqual(["上下文指令"])
    expect(卡面(host)).toEqual(["查甲的流水"])
  })

  test("上下文集合为空 ⇒ 整段不渲染（连分组标题都不留；US2 场景 2）", () => {
    const host = mountCards({ contexts: [] })

    expect(无槽(host, "card-row")).toBe(true)
    expect(无槽(host, "card-row-title")).toBe(true)
  })

  test("有上下文、但都不是这几张卡要的那个 ⇒ 一样整段不渲染（不是「集合非空就渲染」）", () => {
    // 与上一条是**两个条件**：那条问「空集」，这条问「非空但不命中」。合成一条时，
    // 一个条件先红，另一个的证据就看不见了（`LEARNINGS #005-12`）。
    const host = mountCards({ contexts: [上传文件], cards: [甲卡, 通用上下文卡] })

    expect(无槽(host, "card-row")).toBe(true)
  })

  test("多张卡要同一个上下文 ⇒ 一起浮出来（触发判的是「种类」，不是「谁被选中」）", () => {
    // FR-003 的例子是「选中**若干**账户 →「关联分析/资金链追踪/标为涉案」」——三条卡，
    // 不是「每个账户三条」。所以命中按**上下文种类**，不按选中项的个数 / 身份。
    const host = mountCards({ contexts: [选中账户], cards: [甲卡, 通用上下文卡, 乙卡] })

    expect(卡面(host)).toEqual(["记一笔研判", "查甲的流水"])
  })

  test("多个上下文同时具备 ⇒ 各键的卡都浮出来", () => {
    const host = mountCards({ contexts: [上传文件, 选中账户] })

    // 两张都是模块卡（`fund-analysis`）⇒ 组内保持声明顺序：甲卡在前、乙卡在后。
    expect(卡面(host)).toEqual(["查甲的流水", "看话单"])
  })

  test("浮出来的卡沿用共享语法的次序：通用那支排模块卡前面（§4.7.1）", () => {
    const host = mountCards({ contexts: [选中账户], cards: [甲卡, 通用上下文卡] })

    expect(卡面(host)).toEqual(["记一笔研判", "查甲的流水"])
  })

  test("复用是真的，不是又画了一份：行 / 标题 / 卡面都走 §4.7.1–§4.7.2 那一串", () => {
    // 这几格 T004 已经钉过一遍——这里**再钉一遍不是重复劳动**：它证的是这一层**没绕过共享语法**
    // 自己手画（`LEARNINGS #005-07`：一个视觉约定落在 N 处就要 N 条；只钉一处时，另一处另起炉灶
    // 也全套绿）。断的是**继承来的** class，不是新口味。
    const host = mountCards({ contexts: [选中账户] })
    const 串 = [
      槽(host, "card-row")[0]?.className ?? "",
      槽(host, "card-row-title")[0]?.className ?? "",
      槽(host, "card")[0]?.className ?? "",
    ].join(" | ")

    expect(["bg-v2-background-bg-layer-01", "text-[11px]", "bg-v2-background-bg-base", "w-24"].filter((名) => !串.includes(名))).toEqual([])
  })

  test("放不下时也照 §4.7.2 溢出收「⋯」（与「常用操作」是同一副行）", () => {
    // 三张都命中（甲卡 / 丙卡 / 通用上下文卡），卡宽 96 ＋ 间距 8、溢出钮 24，
    // 可用 232 ⇒ (232-24)/104 = 2 张，第 3 张收进「⋯」。
    const host = mountCards({ contexts: [选中账户], cards: [甲卡, 丙卡, 通用上下文卡], availableWidth: 232 })

    expect(卡面(host)).toEqual(["记一笔研判", "查甲的流水"])
    expect(槽(host, "card-overflow")).toHaveLength(1)
  })

  test("点一张浮出来的卡：回调带出那一张（FR-007 的接缝，与「常用操作」同一条出口）", () => {
    const 点的: ProjectedCard[] = []
    const host = mountCards({ contexts: [选中账户], onPick: (卡) => 点的.push(卡) })

    槽(host, "card")[0]?.click()

    expect(点的.map((卡) => 卡.label)).toEqual(["查甲的流水"])
  })

  test("选中态沿用 §4.7.1：输入框那句话来自哪张卡就点亮哪张，其余**不带**浅金", () => {
    const 浅金 = "bg-[var(--v2-background-bg-accent-soft)]"
    const 串 = 槽(mountCards({ contexts: [选中账户], cards: [甲卡, 通用上下文卡], activePrompt: 甲卡.prompt }), "card").map(
      (el) => el.className ?? "",
    )

    // 三条对照缺一不可：只写正向那条的话，把整行刷成浅金也算过（`LEARNINGS #005-07`）。
    expect(串.filter((一份) => 一份.includes(浅金))).toHaveLength(1)
    expect(串[1]?.includes(浅金)).toBe(true)
    expect(串[0]?.includes(浅金)).toBe(false)
  })

  test("卡没有声明触发上下文 ⇒ **不浮出来**（fail-closed：宁可少一张，也不凭空多一张）", () => {
    // ⚠️ 「上下文层的卡却不带触发键」是个**畸形声明**，不是能落地的状态——`capabilities.test.ts`
    // 那侧的报警断言才是拦它的地方；本条钉的只是**形状不对时的兜底行为**：静默放过比静默多出
    // 一张更坏（同 `rbac.ts` 那条 fail-closed 基线的取法）。
    const 无触发: ProjectedCard = {
      label: "没写触发的卡",
      prompt: "这句话不该出现在任何一行里",
      layer: "context",
      skill: "fund-analysis-skill",
      module: "fund-analysis",
    }
    const host = mountCards({ contexts: [选中账户], cards: [无触发, 通用上下文卡] })

    expect(卡面(host)).toEqual(["记一笔研判"])
  })

  test("一张卡都没有 ⇒ 整段不渲染（空数组不该留一个光秃秃的分组标题）", () => {
    const host = mountCards({ contexts: [选中账户], cards: [] })

    expect(无槽(host, "card-row")).toBe(true)
  })
})
