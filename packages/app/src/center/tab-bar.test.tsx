import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { contentTabKey, type ContentTab } from "./tab-store"
import { TabBar } from "./tab-bar"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const TABS: ContentTab[] = [
  { module: "project", title: "专案A", path: "/p/a.intent" },
  { module: "cdr-analysis", title: "话单.csv", path: "/p/cdr.csv" },
  { module: "fund-analysis", title: "流水.xlsx", path: "/p/fund.xlsx" },
]

/** 分屏用例需要 4 张 tab 去凑「580 收成 3 张 / 扣 26 后收成 2 张」的边界。 */
const 四张: ContentTab[] = [...TABS, { module: "cdr-analysis", title: "第二个话单.csv", path: "/p/cdr2.csv" }]

const 歇一拍 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 轮询等到某条件成立，超时就抛。**不等固定时长**（`LEARNINGS #006-31`：`waitForTimeout`
 * 后面紧跟断言，既会假绿也会假红）。
 */
async function 等到(条件: () => boolean, 上限毫秒 = 1000) {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限毫秒) throw new Error("等到超时")
    await 歇一拍()
  }
}

const slots = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>(`[data-slot='${name}']`)]
const titles = (host: HTMLElement) => slots(host, "tab").map((el) => el.querySelector("[data-slot='tab-title']")?.textContent)

type BarProps = Partial<Parameters<typeof TabBar>[0]>

/**
 * 渲染一个可用宽度充裕的 tab 栏（溢出另用 `availableWidth` 收窄）。
 *
 * 逐个字段显式传，**不用展开覆盖**：Solid 的 spread 会跳过值为 `undefined` 的键，
 * `{...{ availableWidth: undefined }}` 覆盖不掉前面的 1000，测试就成了空转
 * （实测过：这个写法让「不传宽度」那条测试假绿）。要「不传」就写 `"availableWidth" in props`。
 */
function mountBar(props: BarProps = {}) {
  return mount(() => (
    <TabBar
      tabs={props.tabs ?? TABS}
      active={props.active}
      availableWidth={"availableWidth" in props ? props.availableWidth : 1000}
      onActivate={props.onActivate ?? (() => {})}
      onClose={props.onClose ?? (() => {})}
    />
  ))
}

describe("TabBar 中栏 tab 栏（FR-005 / DESIGN §4.5）", () => {
  test("按顺序渲染每个 tab：文件名在、各带一个关闭按钮", () => {
    const host = mountBar()

    expect(titles(host)).toEqual(["专案A", "话单.csv", "流水.xlsx"])
    expect(slots(host, "tab-close")).toHaveLength(3)
  })

  test("激活的 tab：aria-selected 为 true，且带顶边条；其余都不带（DESIGN §3.2 / §4.3）", () => {
    const host = mountBar({ active: contentTabKey(TABS[1]) })
    const [项目, 话单, 资金] = slots(host, "tab")

    expect(话单?.getAttribute("aria-selected")).toBe("true")
    expect(话单?.querySelector("[data-slot='tab-active-bar']")).not.toBeNull()
    expect([项目, 资金].map((el) => el?.getAttribute("aria-selected"))).toEqual(["false", "false"])
    expect([项目, 资金].some((el) => el?.querySelector("[data-slot='tab-active-bar']") != null)).toBe(false)
  })

  test("点 tab：回调带出该 tab 的 key（= 来源模块 + 内容路径）", () => {
    const picked: string[] = []
    const host = mountBar({ onActivate: (key) => picked.push(key) })

    slots(host, "tab")[2]?.click()

    expect(picked).toEqual([contentTabKey(TABS[2])])
  })

  test("点关闭按钮：只回调 onClose（带 key），不会连带把这张 tab 也激活", () => {
    const closed: string[] = []
    const activated: string[] = []
    const host = mountBar({ onActivate: (key) => activated.push(key), onClose: (key) => closed.push(key) })

    slots(host, "tab")[1]?.querySelector<HTMLElement>("[data-slot='tab-close']")?.click()

    expect(closed).toEqual([contentTabKey(TABS[1])])
    expect(activated).toEqual([])
  })

  test("按来源模块着色：模块图标取该模块的身份色，tab 上标出 data-module（FR-005）", () => {
    const host = mountBar()
    const [项目, 话单] = slots(host, "tab")

    expect(项目?.getAttribute("data-module")).toBe("project")
    expect(话单?.getAttribute("data-module")).toBe("cdr-analysis")
    // Icon 的着色来自继承的 --icon-base（见 icon.css），故由外层 wrapper 提供
    expect(项目?.querySelector<HTMLElement>("[data-slot='tab-icon']")?.style.getPropertyValue("--icon-base")).toBe(
      "var(--v2-avatar-bg-gray)",
    )
    expect(话单?.querySelector<HTMLElement>("[data-slot='tab-icon']")?.style.getPropertyValue("--icon-base")).toBe(
      "var(--v2-avatar-bg-blue)",
    )
  })

  /**
   * 关闭按钮里的图标也走同一条规矩：`icon.css` 给图标自身写了 `color: var(--icon-base)`，
   * **写在按钮上的 `text-v2-icon-*` 到不了它**——不注入就静默恒灰（兜底是上游硬编码的一档灰），
   * 连 `hover:text-v2-icon-icon-base` 也一并失效。上面那条只钉了模块图标，这一条补上关闭按钮。
   *
   * 未选中档走 class、`group-hover:` 才有提亮的空间，故这里断言的是类名而不是内联值。
   */
  test("关闭按钮的图标颜色也由祖先注入 --icon-base：默认 muted、悬停提亮到 base", () => {
    const host = mountBar()
    const 图标层 = slots(host, "tab")[0]?.querySelector<HTMLElement>("[data-slot='tab-close-icon']")

    expect(图标层?.className ?? "").toContain("[--icon-base:var(--v2-icon-icon-muted)]")
    expect(图标层?.className ?? "").toContain("group-hover:[--icon-base:var(--v2-icon-icon-base)]")
    expect(图标层?.querySelector("svg") != null).toBe(true)
  })

  /**
   * 关闭钮的**形状**：小号 × ＋ 够大的命中区（2026-10-12 用户裁定，参考图
   * `images/screen/2026-10-12_170529.png`）。
   *
   * 判据取「用的是哪一枚图标」而不是类名子串——`LEARNINGS #006-22` 记着 `toContain("border-b")`
   * 会被 `border-base` 满足那类假绿；图标身份写在 `<use>` 的 `href` 上（`opencode-icon-<name>`，
   * `ui/src/components/icon.tsx:110`），是一条**整值**判据。
   * `size-5` 同理按**整词**比：`size-5` 是 `size-50` 的子串。
   *
   * ⚠️ 这条**量不到**「× 真的变小了」——那是一条几何，happy-dom 没有布局引擎
   * （`#005-07` / `#006-33`）。真实渲染尺寸由真栈那条几何核对管，别把这条读成已验证视觉。
   */
  test("关闭钮：图标是 close-small（小号 ×），按钮命中区 20px（size-5）", () => {
    const host = mountBar()
    const 按钮 = slots(host, "tab")[0]?.querySelector<HTMLElement>("[data-slot='tab-close']")
    const 图标 = 按钮?.querySelector<HTMLElement>("[data-slot='tab-close-icon']")

    expect(图标?.querySelector("use")?.getAttribute("href")).toBe("#opencode-icon-close-small")
    expect((按钮?.className ?? "").split(/\s+/)).toContain("size-5")
  })

  test("放不下：尾部 tab 不渲染，行末出现「⋯」（FR-005）", () => {
    const host = mountBar({ availableWidth: 400 })

    expect(titles(host)).toEqual(["专案A", "话单.csv"])
    expect(slots(host, "tab-overflow")).toHaveLength(1)
  })

  test("点「⋯」：列出被收走的 tab；点其中一项就切过去并收起菜单（FR-005）", () => {
    const picked: string[] = []
    const host = mountBar({ availableWidth: 400, onActivate: (key) => picked.push(key) })

    slots(host, "tab-overflow")[0]?.click()
    const 收走的 = slots(host, "tab-overflow-item")

    expect(收走的.map((el) => el.textContent)).toEqual(["流水.xlsx"])

    收走的[0]?.click()

    expect(picked).toEqual([contentTabKey(TABS[2])])
    expect(slots(host, "tab-overflow-menu")).toHaveLength(0)
  })

  test("放得下：没有「⋯」，也不多渲染", () => {
    const host = mountBar()

    expect(slots(host, "tab-overflow")).toHaveLength(0)
    expect(titles(host)).toEqual(["专案A", "话单.csv", "流水.xlsx"])
  })

  test("还没量到可用宽度（首帧 / 无 CSS 引擎）时先全显示：不凭空把 tab 藏进「⋯」", () => {
    const host = mountBar({ availableWidth: undefined })

    expect(titles(host)).toEqual(["专案A", "话单.csv", "流水.xlsx"])
    expect(slots(host, "tab-overflow")).toHaveLength(0)
  })
})

/**
 * 悬停提示：两颗**纯图标**按钮各套一层 `TooltipV2` 触发壳。
 *
 * ⚠️ 与 `rail.test.tsx` 同：本层钉的是**接线**。happy-dom 里 hover / focus **都打不开**浮层
 * （2026-10-09 探针实测），所以「悬停会显示什么」不在单测可证范围内（`LEARNINGS #006-18`）。
 * 文案与同一颗按钮的 `aria-label` 同源，故文案仍由上面那些 `aria-label` 断言替它守着。
 */
describe("TabBar 的悬停提示", () => {
  /** 触发壳里装着哪个 `data-slot` 的按钮——按 `data-component` 数，不按按钮数（按钮本来就在）。 */
  const 壳内 = (host: HTMLElement, slot: string) =>
    [...host.querySelectorAll("[data-component='tooltip-v2-trigger']")].filter(
      (el) => el.querySelector(`[data-slot='${slot}']`) != null,
    ).length

  test("每张 tab 的关闭按钮都在提示壳内（3 张 tab → 3 颗，不是只包了第一颗）", () => {
    const host = mountBar()

    expect(壳内(host, "tab-close")).toBe(3)
  })

  test("行末「⋯」也在提示壳内（FR-005 的溢出钮）", () => {
    const host = mountBar({ availableWidth: 400 })

    expect(壳内(host, "tab-overflow")).toBe(1)
  })
})

/**
 * 标题的悬停提示（2026-10-13 用户实报：「文件名较长时会被截断显示，用『…』」⇒ 悬停要能看到全名）。
 * 用户同日裁定：**只在被截断时弹**，且**只给文件名、不带目录**。
 *
 * ⚠️ 本层能钉的到此为止：happy-dom **没有排版引擎**，`scrollWidth` / `clientWidth` 恒为 0
 * （`LEARNINGS #006-06`），真实几何量不出来。所以这里把几何**喂**进去（`Object.defineProperty`
 * 盖住那两个数）——钉的是「判定 ＋ 接线」；「真被截断时会弹、放得下时不弹」由真栈
 * `e2e/real-stack/tab-title-tooltip-real.spec.ts` 钉（那里量的是真盒子）。
 *
 * 三条用例是一组：单看「没壳」那两条，在本层与「还没量到」长得一样（都回 0），
 * 只有第二条先证明「壳能出现」，另两条的 0 才是在说「不该出现」（`LEARNINGS #005-47` 那族的反面）。
 */
describe("TabBar 的标题提示（只在被截断时弹）", () => {
  /** 提示壳里装着标题的 tab 有几张——按 `data-component` 数，不按标题数（标题本来就在）。 */
  const 标题在壳内 = (host: HTMLElement) =>
    [...host.querySelectorAll("[data-component='tooltip-v2-trigger']")].filter(
      (el) => el.querySelector("[data-slot='tab-title']") != null,
    ).length

  /**
   * 给第 `序` 张 tab 的标题喂一组几何：`看得见` 与 `内容` 两个宽度（真环境里由排版引擎给，
   * 本环境恒 0——所以只能自己定义上去）。
   */
  const 喂几何 = (host: HTMLElement, 序: number, 看得见: number, 内容: number) => {
    const 标题 = slots(host, "tab-title")[序]
    if (!标题) throw new Error(`没有第 ${序} 张 tab 的标题`)
    Object.defineProperty(标题, "clientWidth", { value: 看得见, configurable: true })
    Object.defineProperty(标题, "scrollWidth", { value: 内容, configurable: true })
  }

  const 喂给全部 = (host: HTMLElement, 看得见: number, 内容: number) => {
    for (const 序 of [0, 1, 2]) 喂几何(host, 序, 看得见, 内容)
  }

  test("量不到几何（本环境就是 0/0）⇒ 一张都不给壳：「不知道」当「没截断」，不猜", async () => {
    const host = mountBar()
    await 歇一拍()

    expect(标题在壳内(host)).toBe(0)
  })

  test("标题真的放不下 ⇒ 只有那一张套进壳（放得下的两张不套）", async () => {
    const host = mountBar()
    喂几何(host, 0, 80, 80)
    喂几何(host, 1, 100, 260)
    喂几何(host, 2, 80, 80)
    await 歇一拍()

    expect(标题在壳内(host)).toBe(1)
  })

  test("标题放得下 ⇒ 一张都不给壳（「只在被截断时弹」的守护者）", async () => {
    const host = mountBar()
    // 等宽的边界也算放得下：`scrollWidth === clientWidth` 是「正好装下」，不是「被截掉一点」。
    喂给全部(host, 100, 100)
    await 歇一拍()

    expect(标题在壳内(host)).toBe(0)
  })
})

describe("分屏钮 / 收起钮", () => {
  const [甲, 乙] = 四张

  test("不接 onSplit / onUnsplit ⇒ 栏尾一个钮都没有（DOM 与今天逐字相同）", () => {
    const 宿主 = mount(() => <TabBar tabs={四张} onActivate={() => {}} onClose={() => {}} availableWidth={580} />)
    expect(宿主.querySelector("[data-slot='split-button']") === null).toBe(true)
    expect(宿主.querySelector("[data-slot='unsplit-button']") === null).toBe(true)
  })

  test("栏尾钮占的宽度真的被扣掉了：同样 4 张、同样 580px，接了分屏钮就少显示一张", () => {
    // 580 - 40(⋯) = 540 ⇒ 3 张；接分屏钮后 580 - 26 - 40 = 514 ⇒ 2 张。
    const 不接 = mount(() => <TabBar tabs={四张} onActivate={() => {}} onClose={() => {}} availableWidth={580} />)
    expect(不接.querySelectorAll("[data-slot='tab']").length).toBe(3)
    const 接 = mount(() => (
      <TabBar tabs={四张} onActivate={() => {}} onClose={() => {}} availableWidth={580} onSplit={() => {}} />
    ))
    expect(接.querySelectorAll("[data-slot='tab']").length).toBe(2)
  })

  /**
   * 2026-10-13 用户裁定：**取消「至少两个文件才能分屏」这道闸**。
   *
   * 依据是产品实际形态——分屏**不会**把某个 tab 搬到右栏（`tab-store.ts` 的 `splitPane`
   * 「不动任何 tab，只把右栏露出来」），右栏初来就是一个空栏、由用户自己切过去开文件。
   * 于是「先有两个 tab」这个前提不成立：只有一张、甚至一张没有，也照样能先把栏劈开。
   * 悬停提示随之收成一句「分屏」（原先是「至少打开两个文件才能分屏」）。
   */
  test("只有一张 tab 也能点开分屏菜单（不再置灰／不再有前提提示）", async () => {
    const 宿主 = mount(() => <TabBar tabs={[甲]} onActivate={() => {}} onClose={() => {}} onSplit={() => {}} />)
    const 钮 = 宿主.querySelector<HTMLElement>("[data-slot='split-button']")!
    expect(钮.getAttribute("aria-disabled") === null).toBe(true)
    expect(钮.getAttribute("aria-label")).toBe("分屏")
    钮.click()
    await 等到(() => 宿主.querySelector("[data-slot='split-menu']") !== null)
    expect(宿主.querySelectorAll("[data-slot='split-menu-item']").length).toBe(2)
  })

  test("分屏钮用的是原生 v2 的 `split` 图标（不再是字面字形 ▫）", () => {
    const 宿主 = mount(() => <TabBar tabs={[甲]} onActivate={() => {}} onClose={() => {}} onSplit={() => {}} />)
    const 钮 = 宿主.querySelector<HTMLElement>("[data-slot='split-button']")!
    expect(钮.querySelector("svg use")?.getAttribute("href")).toBe("#opencode-v2-icon-split")
  })

  test("两张以上 ⇒ 点开菜单，两项，选「上下」⇒ onSplit('上下')", async () => {
    const 选过: string[] = []
    const 宿主 = mount(() => (
      <TabBar tabs={[甲, 乙]} onActivate={() => {}} onClose={() => {}} onSplit={(排列) => 选过.push(排列)} />
    ))
    宿主.querySelector<HTMLElement>("[data-slot='split-button']")!.click()
    await 等到(() => 宿主.querySelector("[data-slot='split-menu']") !== null)
    const 项 = 宿主.querySelectorAll("[data-slot='split-menu-item']")
    expect(项.length).toBe(2)
    expect(Array.from(项).map((n) => n.getAttribute("data-split"))).toEqual(["左右", "上下"])
    宿主.querySelector<HTMLElement>("[data-slot='split-menu-item'][data-split='上下']")!.click()
    await 等到(() => 宿主.querySelector("[data-slot='split-menu']") === null)
    expect(选过).toEqual(["上下"])
  })

  test("接 onUnsplit ⇒ 出现收起钮，点它 ⇒ onUnsplit()", () => {
    let 次数 = 0
    const 宿主 = mount(() => <TabBar tabs={[甲]} onActivate={() => {}} onClose={() => {}} onUnsplit={() => 次数++} />)
    宿主.querySelector<HTMLElement>("[data-slot='unsplit-button']")!.click()
    expect(次数).toBe(1)
  })

  test("focused ⇒ 根带 data-focused ＋ 一条受焦条；不传 ⇒ 两样都没有", () => {
    const 受 = mount(() => <TabBar tabs={[甲]} onActivate={() => {}} onClose={() => {}} focused />)
    expect(受.firstElementChild!.getAttribute("data-focused")).toBe("true")
    expect(受.querySelector("[data-slot='tab-bar-focus-bar']")).not.toBe(null)
    const 未 = mount(() => <TabBar tabs={[甲]} onActivate={() => {}} onClose={() => {}} />)
    expect(未.firstElementChild!.getAttribute("data-focused") === null).toBe(true)
    expect(未.querySelector("[data-slot='tab-bar-focus-bar']") === null).toBe(true)
  })
})
