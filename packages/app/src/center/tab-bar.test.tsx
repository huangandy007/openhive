import { beforeEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { contentTabKey, type ContentTab } from "./tab-store"
import { TabBar } from "./tab-bar"
import { 当前重载代, 清空会话改过, 记会话改过 } from "./session-edits"

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

/**
 * 在**页面别处**派一次 `pointerdown`——本仓浮层收「点外面」都听这个事件
 * （`ui/src/components/popover.tsx:99`、`components/titlebar-tab-nav.tsx:163`）。
 * 取 `document.body` 当目标：它在**任何**菜单容器之外，等价于「点空白处」。
 */
const 点外面 = () =>
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "" }))

/** 在某元素上派一次 `pointerdown`——真栈里 `click` 之前总会先有它（本仓浮层听的就是它）。 */
const 按下 = (el: HTMLElement) =>
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "" }))
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

/**
 * 「中栏开着的文件被 AI 会话改了 ⇒ tab 上看得见，点一下才换新」（2026-10-13 用户实报）。
 *
 * 这一份测的是**接线**（登记处本身在 `session-edits.test.ts` 里测、中栏重挂在
 * `center-content.test.tsx` 里测）。两条判据必须分开钉：① 圆点画没画 → 看
 * `data-slot='tab-edited-dot'` 的**存在性**；② 点一下有没有请中栏重读 → 看 `当前重载代(path)`
 * 的**变化**。少了 ② 就会写出「亮着圆点、点了没反应」；少了反面那条就会写成「点谁谁重读」。
 *
 * ⚠️ 登记处是**模块级状态、跨用例活着**（同 `views/reading-size.ts` 的 `阅读字号`）⇒ 每条用例
 * 开头必须 `清空会话改过()`。
 */
describe("tab 上的「会话改过」圆点（2026-10-13 用户实报）", () => {
  beforeEach(() => 清空会话改过())

  const 圆点 = (host: HTMLElement) => slots(host, "tab-edited-dot")

  test("正在看着的这张 tab 被会话改了 ⇒ 当场长出圆点；没被改的没有", () => {
    const host = mountBar()

    记会话改过(TABS[1].path)

    expect(圆点(host)).toHaveLength(1)
    expect(slots(host, "tab")[1]?.querySelector("[data-slot='tab-edited-dot']")).not.toBeNull()
    expect(slots(host, "tab")[0]?.querySelector("[data-slot='tab-edited-dot']")).toBeNull()
  })

  test("点那张带圆点的 tab ⇒ 圆点消失，并且请中栏重读一次（重载代 +1），激活回调照常", () => {
    const picked: string[] = []
    const host = mountBar({ onActivate: (key) => picked.push(key) })
    记会话改过(TABS[1].path)
    const 前 = 当前重载代(TABS[1].path)

    slots(host, "tab")[1]?.click()

    expect(圆点(host)).toHaveLength(0)
    expect(当前重载代(TABS[1].path)).toBe(前 + 1)
    expect(picked).toEqual([contentTabKey(TABS[1])])
  })

  test("点一张没被改过的 tab ⇒ 不重读（重载代不动，别写成无条件重载）", () => {
    const host = mountBar()
    const 前 = 当前重载代(TABS[1].path)

    slots(host, "tab")[0]?.click()

    expect(当前重载代(TABS[1].path)).toBe(前)
  })
})

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

  test("按来源模块着色：tab 上标出 data-module，图标层取该模块的身份色（FR-005）", () => {
    const host = mountBar()
    const [项目, 话单] = slots(host, "tab")

    expect(项目?.getAttribute("data-module")).toBe("project")
    expect(话单?.getAttribute("data-module")).toBe("cdr-analysis")
    // ⚠️ 2026-10-13：写的是 `color` 而**不是** `--icon-base`。图标从 v1 `Icon` 换成了 `FileIcon`
    //    （见下面两条用例），而 `FileIcon` 的 mono 变体画的是 `fill="currentColor"` 的遮罩矩形
    //    ——它**不读** `--icon-base`（那是 `icon.css` 给 v1 `Icon` 定的规矩）。身份色改由这一层
    //    的 `color` 直接给，见 `tab-bar.tsx` 里那段注释。
    expect(项目?.querySelector<HTMLElement>("[data-slot='tab-icon']")?.style.getPropertyValue("color")).toBe(
      "var(--v2-avatar-bg-gray)",
    )
    expect(话单?.querySelector<HTMLElement>("[data-slot='tab-icon']")?.style.getPropertyValue("color")).toBe(
      "var(--v2-avatar-bg-blue)",
    )
  })

  /**
   * 2026-10-13 用户实报：「在中栏打开的（左栏文件树里的）文件，其 tab 前面是个**文件夹**图标。」
   *
   * **根因**（读代码定的，不是猜）：tab 的图标取的是**来源模块**的图标（`tab-bar.tsx` 原来的
   * `MODULE_ICONS` ← `RAIL_ENTRIES`），而「项目管理」那颗入口的图标正是 `folder`
   * （`rail/entries.ts`）⇒ 用户停在项目管理模块，**每一张文件 tab 前面就都是一个文件夹**。
   *
   * 这不是代码写错——`openhive-DESIGN.md` §4.5 原来就写着「tab 结构 ＝ **模块图标** + 文件名」，
   * 代码与规格是一致的。**是那条规格被用户改掉**：图标改按**文件类型**选（与左栏文件树用同一个
   * `FileIcon`），颜色仍按来源模块（用户 2026-10-13 裁定）。
   *
   * 判据取「用的是哪一枚图标」——`FileIcon` 把文件类型编进 `<use>` 的 `href` 尾段
   * （`ui/src/components/file-icon.tsx`，`${sprite}#${name}`），是一条**整值**判据；
   * 不用类名子串（`LEARNINGS #006-22`：`toContain` 会被同名后缀满足）。
   */
  test("tab 的图标按**文件类型**选（与左栏文件树同一个 FileIcon），不再是来源模块的 folder", () => {
    const 三种: ContentTab[] = [
      { module: "project", title: "报告.md", path: "/p/报告.md" },
      { module: "cdr-analysis", title: "话单.json", path: "/p/话单.json" },
      { module: "project", title: "老卷宗.intent", path: "/p/老卷宗.intent" },
    ]
    const host = mountBar({ tabs: 三种 })
    const 图标名 = (el?: HTMLElement) =>
      el?.querySelector("[data-slot='tab-icon'] use")?.getAttribute("href")?.split("#").pop()

    // `.md` / `.json` 都在 `FileIcon` 的登记表里，各得各的；`.intent` 没登记 ⇒ 落到通用文件图标。
    expect([...slots(host, "tab")].map(图标名)).toEqual(["Markdown", "Json", "Document"])
    // ⚠️ 两条**跨模块**的（project 与 cdr-analysis 各一）都在里面：这一条恰恰证明图标不再随模块走。
    expect(slots(host, "tab").some((el) => 图标名(el)?.startsWith("Folder"))).toBe(false)
  })

  /**
   * 用户裁定的**另一半**：形状换成文件类型，颜色仍按来源模块（FR-005 的着色不能丢）。
   *
   * ⚠️ 这里钉的是「喂给 FileIcon 的那个颜色」。**颜色真的落到像素上没有**是本条量**不到**的
   * ——`FileIcon` 的 mono 变体画的是 `fill="currentColor"` 的遮罩矩形，`currentColor` 的解析
   * 要 CSS 引擎，而 happy-dom 没有（`LEARNINGS #005-07` / `#006-33`）。那一条由真栈规格量
   * （`e2e/real-stack/center-tab-icon-real.spec.ts`），别把本条读成已验证视觉。
   */
  test("文件图标按**单色**渲染（mono ⇒ currentColor），颜色仍取来源模块的身份色", () => {
    const host = mountBar({ tabs: [{ module: "cdr-analysis", title: "话单.json", path: "/p/话单.json" }] })
    const 图标层 = slots(host, "tab")[0]?.querySelector<HTMLElement>("[data-slot='tab-icon']")

    expect(图标层?.style.getPropertyValue("color")).toBe("var(--v2-avatar-bg-blue)")
    // mono 那一支的标记：`FileIcon` 画一个 `fill="currentColor"` 的遮罩矩形（见其源码）。
    expect(图标层?.querySelector("svg[data-component='file-icon'] rect")?.getAttribute("fill")).toBe("currentColor")
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

  /**
   * 2026-10-13 用户实报：「点分屏列表以外的区域，列表不消失」（同一缺陷也长在「⋯」菜单上）。
   * 修法是给两个菜单都补上「点外面就收」——两条用例各钉一个菜单（`LEARNINGS #005-12`）。
   */
  test("点「⋯」菜单**以外**的任意位置 ⇒ 菜单收起（此前点外面不消失）", async () => {
    const host = mountBar({ availableWidth: 400 })
    slots(host, "tab-overflow")[0]?.click()
    await 等到(() => slots(host, "tab-overflow-menu").length > 0)

    点外面()

    await 等到(() => slots(host, "tab-overflow-menu").length === 0)
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

  /**
   * 「点外面就收」（2026-10-13 用户实报：分屏菜单点列表以外任何地方都不消失）。
   *
   * 下面是**三条一组**：
   * - ① 点外面 ⇒ 收（这条是本次的 RED 驱动，改之前必红）；
   * - ② 点**里面** ⇒ 不收（守卫：别收得过头，把「外面」的边界划到菜单自己身上）；
   * - ③ 再点一次**触发钮** ⇒ 收（守卫 `#005-35` 那条取舍：触发钮所在那一区算「里面」）。
   *   ②③ 改之前是**绿的**（那时根本没有监听）——它们的牙由变异验证给（见收尾记录），
   *   不是 RED 驱动出来的，故照本文件既有写法标注（同 §「需求守卫」）。
   */
  const 开分屏菜单 = async (宿主: HTMLElement) => {
    宿主.querySelector<HTMLElement>("[data-slot='split-button']")!.click()
    await 等到(() => 宿主.querySelector("[data-slot='split-menu']") !== null)
  }
  const 二张带分屏 = () =>
    mount(() => <TabBar tabs={[甲, 乙]} onActivate={() => {}} onClose={() => {}} availableWidth={1000} onSplit={() => {}} />)

  test("点分屏菜单**以外**的任意位置 ⇒ 菜单收起（用户实报：此前点外面不消失）", async () => {
    const 宿主 = 二张带分屏()
    await 开分屏菜单(宿主)

    点外面()

    await 等到(() => 宿主.querySelector("[data-slot='split-menu']") === null)
  })

  test("需求守卫（非 RED 驱动）：点分屏菜单**里面**不收起——「外面」的边界是菜单与触发钮那一区", async () => {
    const 宿主 = 二张带分屏()
    await 开分屏菜单(宿主)

    按下(宿主.querySelector<HTMLElement>("[data-slot='split-menu']")!)
    await 歇一拍()

    expect(宿主.querySelector("[data-slot='split-menu']")).not.toBeNull()
  })

  test("需求守卫（非 RED 驱动）：再点一次分屏钮 ⇒ 收起（触发钮不算外面，否则 pointerdown 关+click 开=关不掉）", async () => {
    const 宿主 = 二张带分屏()
    const 钮 = 宿主.querySelector<HTMLElement>("[data-slot='split-button']")!
    await 开分屏菜单(宿主)

    // 真栈里「点一下」＝ pointerdown ＋ 紧随的 click；两条都要派，才验得出「关不掉」那类缺陷。
    按下(钮)
    钮.click()

    await 等到(() => 宿主.querySelector("[data-slot='split-menu']") === null)
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
