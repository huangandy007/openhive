import { describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import { Rail } from "./rail"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

const labels = (host: HTMLElement) =>
  [...host.querySelectorAll("[data-slot='rail-entry']")].map((el) => el.getAttribute("aria-label"))

/**
 * 提示壳内的按钮名单（`TooltipV2` 的触发层）。
 *
 * 取名单而不是取布尔：失败时打印的是**实得的整串名单**，一眼看出是哪一个入口漏了、
 * 还是顺序/数量变了（同 `labels()` 的口径）。壳的 `data-component` 是实测值——2026-10-09 探针
 * 拿到的 outerHTML 是 `<div data-closed="" data-component="tooltip-v2-trigger"><button …></div>`。
 */
const 壳内入口 = (host: HTMLElement) =>
  [...host.querySelectorAll("[data-component='tooltip-v2-trigger']")].map((el) =>
    el.querySelector("[data-slot='rail-entry']")?.getAttribute("aria-label"),
  )

/**
 * 按 `aria-label` 找入口；找不到**抛**。
 *
 * ⚠️ 不用 `?.click()`：元素缺失时那条用例会**空过**（`#004-14`），而这里「找得到」正是前置条件。
 * 与 `workspace-entry.test.tsx` 的同名辅助同形。
 */
const 入口 = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")].find(
    (el) => el.getAttribute("aria-label") === label,
  )
  if (!found) throw new Error(`图标栏里没有「${label}」`)
  return found
}

/**
 * 此刻**亮着**的入口名单（按 DOM 次序）——按**长相**取（选中态那条左侧竖条），不按 ARIA 属性。
 *
 * ⚠️ 刻意不按 `[aria-current='page']` 取（那是本文件别处的取法）：两条轴的长相是一样的，**读法
 * 不一样**（模块轴 `aria-current`、右栏开关 `aria-pressed`，见 `rail.tsx` 的 `toggle` 那段），
 * 按 ARIA 取会漏掉一半——而用户要的「高亮」正是长相这一半。
 *
 * ⚠️ 用 `querySelectorAll` 而不是 `querySelector`：**会有两颗同时亮**（模块轴上的一颗 ＋ 右栏轴上
 * 的「AI 会话」），单数选择器只能看见第一颗。取名单而不是取布尔，失败时打印的也是实得的整串名单。
 */
const 亮着的 = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    .filter((el) => el.querySelector("[data-slot='rail-entry-bar']") !== null)
    .map((el) => el.getAttribute("aria-label"))

describe("Rail 图标栏", () => {
  test("未传能力位时，五入口 + 底部系统设置全部渲染（FR-002）", () => {
    const host = mount(() => <Rail onSelect={() => {}} />)

    expect(labels(host)).toEqual(["项目管理", "AI 资产", "AI 会话", "话单分析", "资金分析", "系统设置"])
  })

  test("点某个入口：回调带出该入口的 id（不是显示名）", () => {
    const picked: string[] = []
    const host = mount(() => <Rail onSelect={(id) => picked.push(id)} />)

    const 资金 = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")].find(
      (el) => el.getAttribute("aria-label") === "资金分析",
    )
    资金?.click()

    expect(picked).toEqual(["fund-analysis"])
  })

  /**
   * **「系统设置」不是模块**（FR-002 的补充规格 / 2026-10-09 用户下达）。
   *
   * 它曾经和五个业务入口走同一条出口（`onSelect(id)` ⇒ `center.switchModule(id)`），而
   * `center-content.tsx` **没有任何按 module 的分支** ⇒ `switchModule("settings")` 只把那个字符串
   * 换掉：图标点亮、左栏（`module === "project"` 才渲染）消失、**什么都不打开**。
   * 故底部这颗改走 `onOpenSettings`——判据同时钉两半：**它调了 opener** 且
   * **`onSelect` 一个 id 都没收到**（后半才是「不再切模块」的那一半，只断前半会漏掉「两个都调」）。
   */
  test("点「系统设置」走 onOpenSettings，不走 onSelect——设置不是模块（#3）", () => {
    const picked: string[] = []
    let 开过 = 0
    const host = mount(() => (
      <Rail
        onSelect={(id) => picked.push(id)}
        onOpenSettings={() => {
          开过 += 1
        }}
      />
    ))

    入口(host, "系统设置").click()

    expect(开过).toBe(1)
    // 反证：`onSelect` 必须**一个都没收到**——尤其不是 "settings"（旧行为就是它）
    expect(picked).toEqual([])
  })

  test("省略 onOpenSettings：点「系统设置」什么都不做——**不退回 onSelect**", () => {
    const picked: string[] = []
    const host = mount(() => <Rail onSelect={(id) => picked.push(id)} />)

    入口(host, "系统设置").click()

    // 退回 onSelect 的后果不是「没反应」，是「模块被改成 settings、左栏消失」（见上一条的注释）。
    expect(picked).toEqual([])
  })

  test("会话只签到部分能力位时：无能力的入口不渲染，系统设置仍在（出参：无权限入口隐藏）", () => {
    const host = mount(() => <Rail capabilities={new Set(["project"])} onSelect={() => {}} />)

    expect(labels(host)).toEqual(["项目管理", "系统设置"])
  })

  test("图标栏宽 56px（DESIGN.md §4.1）", () => {
    const host = mount(() => <Rail onSelect={() => {}} />)

    const rail = host.querySelector<HTMLElement>("[data-component='rail']")
    expect(rail?.style.width).toBe("56px")
  })

  test("当前模块的入口带左侧竖条与 aria-current，其余入口都没有（DESIGN §4.1 / §4.3）", () => {
    const host = mount(() => <Rail active="fund-analysis" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 当前 = entries.find((el) => el.getAttribute("aria-label") === "资金分析")
    const 其余 = entries.filter((el) => el.getAttribute("aria-label") !== "资金分析")

    expect(当前?.querySelector("[data-slot='rail-entry-bar']")).not.toBeNull()
    expect(当前?.getAttribute("aria-current")).toBe("page")
    expect(其余.some((el) => el.querySelector("[data-slot='rail-entry-bar']") !== null)).toBe(false)
    expect(其余.some((el) => el.getAttribute("aria-current") !== null)).toBe(false)
  })

  test("选中底是浅金 token，不再是中性灰（DESIGN §1.3 / T017 换皮）", () => {
    const host = mount(() => <Rail active="fund-analysis" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 当前 = entries.find((el) => el.getAttribute("aria-label") === "资金分析")
    const 其余 = entries.filter((el) => el.getAttribute("aria-label") !== "资金分析")

    // happy-dom 没有 CSS 引擎，能断言的只有「用的哪个 token」——正是换皮要守住的那一点
    expect(当前?.className ?? "").toContain("bg-[var(--v2-background-bg-accent-soft)]")
    expect(当前?.className ?? "").not.toContain("overlay-simple-overlay-pressed")
    expect(其余.every((el) => !(el.className ?? "").includes("accent-soft"))).toBe(true)
  })

  /**
   * 图标颜色**只能**靠祖先注入 `--icon-base`，父级按钮上的 `text-v2-icon-*` 到不了图标：
   * `packages/ui/src/components/icon.css` 给图标自身写了 `color: var(--icon-base)`，直接盖过继承来的色。
   * 不注入的后果不是报错，是**静默恒灰**——`--icon-base` 在主题里的兜底是上游硬编码的一档灰，
   * 于是默认 / 悬停 / 选中三档一并失效，选中入口的图标根本不显浅金（DESIGN §1.3 的违规）。
   * 同一坑 T009 在 `tab-bar` 踩过一次，做法照抄（`tab-bar.tsx:52-56`）。
   */
  test("图标颜色由祖先注入 --icon-base：选中档浅金、其余走 muted（DESIGN §1.3 / §4.1）", () => {
    const host = mount(() => <Rail active="fund-analysis" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 当前 = entries.find((el) => el.getAttribute("aria-label") === "资金分析")
    const 其余 = entries.filter((el) => el.getAttribute("aria-label") !== "资金分析")
    const 图标层 = (el: HTMLElement | undefined) =>
      el?.querySelector<HTMLElement>("[data-slot='rail-icon']") ?? undefined

    // happy-dom 没有 CSS 引擎，解析不了 var()——能断言的正是「注入的是不是一个 token」
    expect(图标层(当前)?.style.getPropertyValue("--icon-base")).toBe("var(--v2-icon-icon-accent)")
    // 未选中的那档写在类名里、不走内联：内联会压过 hover 的提亮（选中档才需要压过 hover）
    expect(图标层(其余[0])?.className ?? "").toContain("[--icon-base:var(--v2-icon-icon-muted)]")
    expect(其余.every((el) => 图标层(el)?.style.getPropertyValue("--icon-base") !== "var(--v2-icon-icon-accent)")).toBe(
      true,
    )
  })

  test("系统设置同样能是当前入口：停在设置上时竖条落在底部那一项，五个业务入口都不带", () => {
    const host = mount(() => <Rail active="settings" onSelect={() => {}} />)
    const entries = [...host.querySelectorAll<HTMLElement>("[data-slot='rail-entry']")]
    const 设置 = entries.find((el) => el.getAttribute("aria-label") === "系统设置")
    const 业务 = entries.filter((el) => el.getAttribute("aria-label") !== "系统设置")

    expect(设置?.querySelector("[data-slot='rail-entry-bar']")).not.toBeNull()
    expect(设置?.getAttribute("aria-current")).toBe("page")
    expect(业务.some((el) => el.getAttribute("aria-current") !== null)).toBe(false)
  })

  /**
   * 悬停提示（FR-002 的补充规格）：每个入口都套在 `TooltipV2` 的触发壳里。
   *
   * ⚠️ 这条钉的是**接线**，不是「悬停会显示」——happy-dom 里 hover 与 focus **都打不开**浮层
   * （2026-10-09 探针实测：`pointerenter` / `focus()` 之后 0 / 500 / 1000ms 均查不到文案；
   * `LEARNINGS #006-18` 的「消费者在本测试层里是惰性的」）。文案与提示的显示行为要在真浏览器里看。
   * 文案本身仍由本文件上面的 `labels()` 那几条钉着（提示与 `aria-label` 同源，见 `rail.tsx`）。
   */
  test("每个入口都在 tooltip 触发壳内（五入口 + 系统设置，共 6 颗）", () => {
    const host = mount(() => <Rail onSelect={() => {}} />)

    expect(壳内入口(host)).toEqual([
      "项目管理",
      "AI 资产",
      "AI 会话",
      "话单分析",
      "资金分析",
      "系统设置",
    ])
  })

  /**
   * **「AI 会话」不是模块，是右栏的开关**（2026-10-10 用户下达）。
   * 这不是新需求——设计文档早写死了：
   * `docs/superpowers/specs/2026-09-11-项目管理-design.md:25`「**AI 会话** ｜ 呼出/收起右栏 ｜ 💬」、
   * `archive/2026-08-17-openhive-design-v1.md:229`「点图标呼出/收起对应侧栏；**高亮 = 当前展开**」。
   *
   * 它此前和另外四颗走同一条出口（`onSelect(id)` ⇒ `center.switchModule(id)`），而 `module` 从
   * 此停在 `"ai-session"`：图标点亮、**左栏（只在 `module === "project"` 时渲染）整列消失**、
   * 右栏一动不动——「点了没反应，还顺手弄没了左栏」。
   *
   * 判据与「系统设置」那条**逐字同形**，两半都要断：**它调了开关** 且
   * **`onSelect` 一个 id 都没收到**（后半才是「不再切模块」的那一半，只断前半会漏掉「两个都调」）。
   */
  test("点「AI 会话」走 onToggleAiSession，不走 onSelect——它不是模块", () => {
    const picked: string[] = []
    let 拨过 = 0
    const host = mount(() => (
      <Rail
        onSelect={(id) => picked.push(id)}
        onToggleAiSession={() => {
          拨过 += 1
        }}
      />
    ))

    入口(host, "AI 会话").click()

    expect(拨过).toBe(1)
    // 反证：`onSelect` 必须**一个都没收到**——尤其不是 "ai-session"（旧行为就是它）
    expect(picked).toEqual([])
  })

  test("省略 onToggleAiSession：点「AI 会话」什么都不做——**不退回 onSelect**", () => {
    const picked: string[] = []
    const host = mount(() => <Rail onSelect={(id) => picked.push(id)} />)

    入口(host, "AI 会话").click()

    // 退回 onSelect 的后果不是「没反应」，是「模块被改成 ai-session、左栏消失」（见上一条的注释）。
    expect(picked).toEqual([])
  })

  /**
   * 高亮走**另一条轴**：它跟 `aiSessionOpen`（右栏在不在）走，**不跟 `active`（当前模块）走**。
   *
   * 于是屏幕上**两颗同时亮**是常态、不是画错了：模块轴上的「项目管理」＋ 右栏轴上的「AI 会话」
   * ——设计文档那句「高亮 = 当前展开」管的是**各自那一栏**，两条轴本就独立。
   */
  test("「AI 会话」的高亮跟 aiSessionOpen 走，与 active 无关；其余四颗不受它影响", () => {
    // 对照（右栏收起）＝ 省略 `aiSessionOpen`：五颗业务入口里只有模块轴那一颗亮
    const 收起 = mount(() => <Rail active="project" onSelect={() => {}} />)
    expect(亮着的(收起)).toEqual(["项目管理"])

    // 右栏展开 ⇒ 多亮一颗，且**只有**那一颗——其余四颗的分支没被这条链带偏
    const 展开 = mount(() => <Rail active="project" aiSessionOpen onSelect={() => {}} />)
    expect(亮着的(展开)).toEqual(["项目管理", "AI 会话"])

    // 反证（旧路径已断）：`active` 传 "ai-session" **再也点不亮它**——`module` 不会、也不该
    // 再变成 "ai-session"。少了这一条，一个「两个条件都读」的写法照样能过上两条。
    const 旧路 = mount(() => <Rail active="ai-session" onSelect={() => {}} />)
    expect(亮着的(旧路)).toEqual([])
  })

  /**
   * 两条轴的长相一样、**读法必须不一样**（`rail.tsx` 的 `toggle` 那段讲了为什么）。
   *
   * 这条不是洁癖：第一版把两颗都写成 `aria-current="page"`，实测**当场弄红了 4 条既有断言**
   * ——`workspace-entry.test.tsx` 的 `currentModule()` 按它取「当前模块」，而亮着的两颗里
   * 「AI 会话」在 DOM 里排在「话单分析 / 资金分析」**前面** ⇒ 切到资金分析之后它读回 `"AI 会话"`。
   * 对屏幕阅读器那一半同样成立：一个按钮不该说自己是「当前页」，它说的是「我按下了」。
   */
  test("两条轴长相一样、读法不同：模块轴 aria-current，右栏开关 aria-pressed", () => {
    const host = mount(() => <Rail active="project" aiSessionOpen onSelect={() => {}} />)
    const 模块 = 入口(host, "项目管理")
    const 开关 = 入口(host, "AI 会话")

    // 长相：两颗**都**亮（同一套选中态），别把「读法分开」读成「长相也分开了」
    expect(亮着的(host)).toEqual(["项目管理", "AI 会话"])
    // 读法
    expect(模块.getAttribute("aria-current")).toBe("page")
    expect(模块.getAttribute("aria-pressed")).toBeNull()
    expect(开关.getAttribute("aria-current")).toBeNull()
    expect(开关.getAttribute("aria-pressed")).toBe("true")

    // 收起时真假都要读得出来（`false` 也是信息：这一栏现在是关着的）
    const 收起 = mount(() => <Rail active="project" onSelect={() => {}} />)
    expect(入口(收起, "AI 会话").getAttribute("aria-pressed")).toBe("false")
    expect(入口(收起, "AI 会话").getAttribute("aria-current")).toBeNull()
  })
})
