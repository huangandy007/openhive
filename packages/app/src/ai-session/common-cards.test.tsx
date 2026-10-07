import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { GENERIC_MODULE } from "./capabilities"
import type { ProjectedCard } from "./projection"
import { CommonCards } from "./common-cards"

/**
 * 顶部「常用操作」指令卡（FR-002 / DESIGN §4.7.1 + §4.7.2）。
 *
 * 这个文件测三件事，都不是「好看不好看」：**排哪些、排成什么序、放不下时谁进「⋯」**。
 * 视觉值只能断 `className` 串（happy-dom 不跑布局、不解析 CSS，`getComputedStyle` 拿不到真值，
 * `LEARNINGS #005-07`），所以 §4.7.1 / §4.7.2 的每一格都得有一条对得上的断言——
 * **同一个视觉约定落在 N 处就写 N 条**，只在其中一处钉钉子的话，另几处改回旧 token 也全套绿。
 */

/** 挂过的实例，外层 `afterEach` 里统一卸载。 */
const 挂过的: Array<() => void> = []

/**
 * 挂一个组件，并**记下它的卸载**（`LEARNINGS #005-03`：丢掉 `render()` 的 dispose，旧实例会一直
 * 订阅模块级接缝，后面每个用例改接缝时它都用**自己那份**回写同一条缝，谁最后落地谁赢）。
 *
 * ⚠️ 顺序要紧：**先 `dispose()` 再 `host.remove()`**（反过来的话 dispose 要去碰已经不在文档里的节点）。
 * 本文件比 `center/tab-bar.test.tsx` 更非做不可：溢出菜单走 `MenuV2` 的 **Portal，渲染进
 * `document.body` 而不是 host**（实测），不 dispose 就会把上一个用例的菜单项留在 body 里，
 * 下一个用例一查 body 就看见**别人的数据**。
 */
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
/** 溢出菜单在 Portal 里，落在 `document.body`（`MenuV2` 的行为，实测过；host 里查不到）。 */
const 体槽 = (名: string) => [...document.body.querySelectorAll<HTMLElement>(`[data-slot='${名}']`)]

/**
 * 开「⋯」菜单。
 *
 * ⚠️ **不能用 `.click()`**：Kobalte 的 Trigger 只在 `pointerdown`（主键、非 touch）时开，
 * `click` 那条分支**只服务 touch**（上游 `menu-trigger.tsx` 的 `onClick` 里判 `pointerType === "touch"`）。
 * 用 `.click()` 的话菜单不开，现场看着像「组件坏了」，实际是**探针发错了事件**（`LEARNINGS #003-01`：
 * 先怀疑测量，再怀疑被测物）。
 */
const 开菜单 = (钮: HTMLElement) =>
  钮.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "" }))

/**
 * 点菜单里的一项：Kobalte 的 Item 在 **`pointerup`（主键）**时选中（上游 `menu-item-base.tsx`
 * 的 `onPointerUp` 里 `if (e.button === 0) onSelect()`），`pointerdown`／`click` 都不触发它。
 *
 * ⚠️ happy-dom 里菜单**不会**因选中而从 DOM 消失（`Presence` 等不到 exit 动画，实测 200ms 后仍在，
 * 与 `#005-07` 同族：happy-dom 没有 CSS 引擎）⇒ **「选完菜单收起」这条在本环境不可断言**，
 * 已按 `LEARNINGS #002-02` 记进 `state.md` 的缺口表，不写成「已覆盖」。
 */
const 点菜单项 = (项: HTMLElement) =>
  项.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))

const 造卡 = (label: string, prompt: string, module: string): ProjectedCard => ({
  label,
  prompt,
  layer: "common",
  skill: `${module}-skill`,
  module,
})

/** 通用卡故意夹在两张模块卡**中间**——不夹在中间的话，「通用优先」这条排序断言不成立。 */
const 通用卡 = 造卡("记一笔研判", "帮我记一笔研判", GENERIC_MODULE)
const 甲卡一 = 造卡("查甲的流水", "查一下甲的流水", "fund-analysis")
const 甲卡二 = 造卡("看甲的对端", "列出甲的对端", "fund-analysis")
const 三张 = [甲卡一, 通用卡, 甲卡二]

interface 行入参 {
  cards?: ProjectedCard[]
  availableWidth?: number
  activePrompt?: string
  onPick?: (卡: ProjectedCard) => void
}

/**
 * 逐个字段显式传，**不用展开覆盖**：Solid 的 spread 跳过值为 `undefined` 的键，
 * `{...{ availableWidth: undefined }}` 覆盖不掉前面的 1000，那条测试就成了空转
 * （`center/tab-bar.test.tsx` 实测过这个坑）。要「不传」就写 `"availableWidth" in props`。
 */
function mountCards(props: 行入参 = {}) {
  return mount(() => (
    <CommonCards
      cards={props.cards ?? 三张}
      availableWidth={"availableWidth" in props ? props.availableWidth : 1000}
      activePrompt={props.activePrompt}
      onPick={props.onPick}
    />
  ))
}

/** 缺哪几个 class 名就报哪几个（逐段 `for` 里 `expect` 的话，失败只会说「这条红了」，不说是哪个值）。 */
const 缺哪些 = (串: string, 应当有: string[]) => 应当有.filter((名) => !串.includes(名))

describe("常用操作指令卡（FR-002 / DESIGN §4.7.1–§4.7.2）", () => {
  test("渲染分组标题「常用操作」：11px 的 muted（§4.7.2）", () => {
    const 标题 = 槽(mountCards(), "card-row-title")

    expect(标题.map((el) => el.textContent)).toEqual(["常用操作"])
    expect(缺哪些(标题[0]?.className ?? "", ["text-[11px]", "text-v2-text-text-muted"])).toEqual([])
  })

  test("「通用」的卡排在模块自己的卡前面，组内保持声明顺序（§4.7.1 行内排序）", () => {
    // 入参是 [甲卡一, 通用卡, 甲卡二] ⇒ 出来的必须是 [通用卡, 甲卡一, 甲卡二]。
    // 「常数在前才形成肌肉记忆：第一张卡永远在同一位置」——顺序错了这条就红。
    expect(槽(mountCards(), "card").map((el) => el.textContent)).toEqual(["记一笔研判", "查甲的流水", "看甲的对端"])
  })

  test("卡面取 §4.7.1 那一串：白底 + 柔和阴影 + 描边 + 96×32 + 8px 圆角", () => {
    // ⚠️ `shadow-[var(--v2-elevation-raised)]` 是**任意值**写法：`--v2-elevation-*` 没有
    // Tailwind 孪生（§4.7.0），写成 `shadow-v2-elevation-raised` 会被 `design-token-refs.test.ts` 判红。
    const 串 = 槽(mountCards(), "card")[0]?.className ?? ""

    expect(
      缺哪些(串, [
        "w-24",
        "h-8",
        "rounded-lg",
        "bg-v2-background-bg-base",
        "border-v2-border-border-muted",
        "shadow-[var(--v2-elevation-raised)]",
      ]),
    ).toEqual([])
  })

  test("卡面文字取 §4.7.1：13px、正文色、单行截断", () => {
    const 串 = 槽(mountCards(), "card-label")[0]?.className ?? ""

    expect(缺哪些(串, ["text-[13px]", "text-v2-text-text-base", "truncate"])).toEqual([])
  })

  test("整行取右栏底面 layer-01（§4.7.1：卡片是白底，同白相叠时阴影无处着力）", () => {
    const 串 = 槽(mountCards(), "card-row")[0]?.className ?? ""

    expect(缺哪些(串, ["bg-v2-background-bg-layer-01"])).toEqual([])
  })

  test("点一张卡：回调带出那一张，且只带出它（FR-007 的接缝，填入输入框是 T009 的活）", () => {
    const 点的: ProjectedCard[] = []
    const host = mountCards({ onPick: (卡) => 点的.push(卡) })

    槽(host, "card")[1]?.click()

    expect(点的.map((卡) => 卡.label)).toEqual(["查甲的流水"])
  })

  test("选中态：输入框那句话来自哪张卡就点亮哪张（浅金）；其余两张**不带**（§4.7.1）", () => {
    // 贪金是**任意值**写法（`--v2-background-bg-accent-soft` 无孪生，§4.7.0）。
    // 三条对照缺一不可：只写正向那条的话，把整行刷成浅金也算过（`LEARNINGS #005-07`）。
    const 浅金 = "bg-[var(--v2-background-bg-accent-soft)]"
    const 串 = 槽(mountCards({ activePrompt: 甲卡二.prompt }), "card").map((el) => el.className ?? "")

    expect(串.filter((一份) => 一份.includes(浅金))).toHaveLength(1)
    expect(串[2]?.includes(浅金)).toBe(true)
    expect([串[0]?.includes(浅金), 串[1]?.includes(浅金)]).toEqual([false, false])
  })

  test("放不下：尾部卡不渲染，行末出现「⋯」（FR-002 的「溢出收⋯」）", () => {
    // 卡宽 96 + 间距 8，溢出钮 24；可用 232 ⇒ (232-24)/104 = 2 张，第 3 张收进「⋯」。
    const host = mountCards({ availableWidth: 232 })

    expect(槽(host, "card").map((el) => el.textContent)).toEqual(["记一笔研判", "查甲的流水"])
    expect(槽(host, "card-overflow")).toHaveLength(1)
  })

  test("点「⋯」：菜单列出被收走的那几张（且只有被收走的）", () => {
    const host = mountCards({ availableWidth: 232 })

    开菜单(槽(host, "card-overflow")[0])

    expect(体槽("card-overflow-item").map((el) => el.textContent)).toEqual(["看甲的对端"])
  })

  test("点菜单里一项：回调带出那一张（溢出里的卡和行内的卡走同一条出口）", () => {
    const 点的: ProjectedCard[] = []
    const host = mountCards({ availableWidth: 232, onPick: (卡) => 点的.push(卡) })

    开菜单(槽(host, "card-overflow")[0])
    点菜单项(体槽("card-overflow-item")[0])

    expect(点的.map((卡) => 卡.label)).toEqual(["看甲的对端"])
  })

  test("放得下：没有「⋯」，也不多不少", () => {
    const host = mountCards()

    expect(槽(host, "card-overflow")).toHaveLength(0)
    expect(槽(host, "card").map((el) => el.textContent)).toEqual(["记一笔研判", "查甲的流水", "看甲的对端"])
  })

  test("还没量到可用宽度（首帧 / 无 CSS 引擎）⇒ 先全显示，不凭空把卡藏进「⋯」", () => {
    // 判成 0 会把整行一股脑塞进「⋯」——凭空隐藏比暂时多显示更糟（同 `center/tab-bar.tsx`）。
    const host = mountCards({ availableWidth: undefined })

    expect(槽(host, "card")).toHaveLength(3)
    expect(槽(host, "card-overflow")).toHaveLength(0)
  })

  test("溢出钮取 §4.7.2 那颗：字形 ⋯（U+22EF）、size-6、4px 圆角、muted 图标色 + 无障碍标签", () => {
    const 钮 = 槽(mountCards({ availableWidth: 232 }), "card-overflow")[0]

    expect(
      缺哪些(钮?.className ?? "", [
        "size-6",
        "rounded",
        "text-v2-icon-icon-muted",
        "hover:bg-v2-overlay-simple-overlay-hover",
      ]),
    ).toEqual([])
    expect(钮?.textContent?.trim()).toBe("⋯")
    expect(钮?.getAttribute("aria-label")).toBe("还有 1 张卡片")
  })
})
