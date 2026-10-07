import { afterEach, describe, expect, test } from "bun:test"
import { type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { SkillGroup } from "./projection"
import { SkillDrawer } from "./skill-drawer"

/**
 * 「更多 skill」抽屉（FR-004 / US3 场景 1 / DESIGN §4.7.3）。
 *
 * 本条的**出参是「抽屉按 skill 分组」**——所以判据全在**分组**上：组标题是什么、组里挂着谁、
 * 组与组的先后。长相那一半只钉 §4.7.3 表里逐格写死的那几样（底面 / 圆角 / 阴影 / 组标题字号 /
 * 条目两行 / 行高 / 无图标），**不钉表里没写的东西**。
 *
 * ⚠️ **happy-dom 量不出任何尺寸**（无 CSS 引擎）⇒ 「行高 ≥ 40px」只能断**类名**（`min-h-10`＝2.5rem
 * ＝40px），断不了真的量出来的高度。这是 `LEARNINGS #005-07` 那条：视觉约定一律落成 `className`
 * 串断言 ＋ 一条对照，**别用「我看了觉得对」当判据**。
 *
 * ⚠️ **入口不在这里**（2026-10-07 裁定）：本组件是**受控面板**（`open` / `onClose` / `groups`）。
 * 「▸ 按钮 + 开关状态」归 T008——design-v2 §8.2 与 `2026-09-12-AI资产-design.md` 都把这颗钮写在
 * **输入框旁边**，而输入框是 §4.7.5 的 Hero 输入（T008 的 `session-panel.tsx`）。所以本文件里
 * 也没有「点 ▸ 会打开」的断言——**那个判据属于 T008**，写在 `state.md` 的缺口表与 `tasks.md` 的 T008 条。
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

/** 一串 class 里缺了哪些（缺的为空数组就算过；把「缺什么」打出来，红了能一眼看出缺哪一格）。 */
const 缺哪些 = (串: string, 全是: readonly string[]) => 全是.filter((名) => !串.split(/\s+/).includes(名))

/**
 * 造一个 skill 条目。
 *
 * ⚠️ `id`（连接键）与 `显示名` **在夹具里刻意不同**，而**生产里今天两者同值**
 * （`capabilities.ts` 的 `MANIFESTS` 两条都是 `skill: "effect" / name: "effect"`）。
 * 这么做只有一个目的：让「条目读的是显示名、不是连接键」这条断言**今天就有牙**
 * ——把渲染里的 `条.name` 换成 `条.skill`，下面的断言**当场红**；若夹具让两者同值，
 * 那个变异**摘不出来**，那条断言就是空的（`LEARNINGS #004-13`）。
 * `capabilities.ts` 明写「009 落地后 ID 可能与显示名分家（如 `fund-link-analysis` /
 * 「资金关联分析」）」——**生产里它变成一条真断言的那天是 009**，今天它是一条探测器 ＋ 哨兵
 * （`#005-15`：不让注释比断言强）。
 */
const 造skill = (id: string, 显示名: string, description: string, group: string) => ({
  skill: id,
  name: 显示名,
  description,
  group,
  cards: [],
})

const 组 = (group: string, ...条: Array<[string, string, string]>): SkillGroup => ({
  group,
  skills: 条.map(([id, 显示名, 描述]) => 造skill(id, 显示名, 描述, group)),
})

/** 默认那一组：一个组两条 skill（两条是为了证「组里挂着谁」不是「只挂第一条」）。 */
const 开发工具组 = 组(
  "开发工具",
  ["effect", "effect 编程", "Work with Effect v4 TypeScript code in this repo"],
  ["rtl-aware-development", "RTL 与 LTR", "RTL / LTR behavior in the web app, CSS, menus, scrolling"],
)
const 研判组 = 组("业务研判", ["fund-link-analysis", "资金关联分析", "按账户拉资金往来的关联图"])

const 默认两组 = [开发工具组, 研判组]

function mountDrawer(props: { groups?: SkillGroup[]; open?: boolean; onClose?: () => void } = {}) {
  return mount(() => (
    <SkillDrawer
      groups={props.groups ?? 默认两组}
      open={"open" in props ? !!props.open : true}
      onClose={props.onClose}
    />
  ))
}

/** 面板根节点（下面几乎每条都要它的 class 串）。 */
const 面板 = (host: HTMLElement) => 槽(host, "skill-drawer")[0]

describe("更多 skill 抽屉（FR-004 / US3 场景 1 / DESIGN §4.7.3）", () => {
  test("打开时面板在、且**只盖右栏**（`absolute inset-0`），不是全屏遮罩（不带 `fixed`）", () => {
    // 这一条同时是**「机制是活的」的对照**（`LEARNINGS #004-08`）：下面有一条断「关着时不渲染」，
    // 若这个组件压根没在渲染，那条也会绿——所以先把「该出来时真的出来了」钉住。
    //
    // ⚠️ `absolute` 与「不带 `fixed`」是**两个条件**：`absolute inset-0` 盖上的是**右栏那个容器**
    // （§4.7.3 要求右栏 `relative`），`fixed inset-0` 盖的是**整个视口**。§4.7.3 明写「不做全屏遮罩」
    // ——民警用抽屉时多半在看着中栏选中的东西，带 scrim 的 modal 会把它盖住。
    const host = mountDrawer()
    const 串 = 面板(host).className

    expect(缺哪些(串, ["absolute", "inset-0"])).toEqual([])
    expect(串.split(/\s+/)).not.toContain("fixed")
  })

  test("底面 / 圆角 / 阴影取 §4.7.3 那三格", () => {
    // 圆角 10px 走**任意值**写法：它是「右栏内浮层唯一的一档」（§4.7.3 末条），与 §3.1 的
    // 「弹窗 16px」（应用级对话框）是两档，别混。阴影走任意值是因为 `--v2-elevation-*`
    // **没有 Tailwind 孪生**（§4.7.0 那张表）。
    const host = mountDrawer()

    expect(
      缺哪些(面板(host).className, [
        "bg-v2-background-bg-base",
        "rounded-[10px]",
        "shadow-[var(--v2-elevation-overlay)]",
      ]),
    ).toEqual([])
  })

  test("`open === false` ⇒ 整块不渲染（不是「渲染了但看不见」）", () => {
    const host = mountDrawer({ open: false })

    expect(无槽(host, "skill-drawer")).toBe(true)
  })

  test("按 skill 分组：一组一个 `skill-group`，组标题就是 `group` 名", () => {
    const host = mountDrawer()

    expect(槽(host, "skill-group").length).toBe(2)
    expect(槽(host, "group-title").map((el) => el.textContent)).toEqual(["开发工具", "业务研判"])
  })

  test("组标题取 §4.7.2 / §4.7.3 共用的那一串（11px muted，与卡行标题同源）", () => {
    const host = mountDrawer()

    expect(缺哪些(槽(host, "group-title")[0].className, ["text-[11px]", "text-v2-text-text-muted"])).toEqual([])
  })

  test("组标题的顺序 = 清单给的顺序，**不做任何排序**（2026-10-07 裁定，接 T003 的挂账）", () => {
    // 夹具刻意用 ASCII 且**逆序**（`zz-` 在 `aa-` 前面）：真要有人加一句 `localeCompare`／字母序，
    // 这条立刻红。中文的 `localeCompare` 顺序不好在用例里写死（依赖 ICU 数据），而这条要钉的
    // 恰恰是「**不排序**」——用 ASCII 才让「排了」与「没排」在实得值上真的长得不一样。
    // 判据来源：T003 的 `projection.ts` 里那个私有 `分组()` 明写「不排序是有意的」，并把
    // 「抽屉要不要换个顺序」留给了 T006；T006 的裁定是**保持首次出现顺序**。
    const host = mountDrawer({ groups: [组("zz-工具"), 组("aa-研判")] })

    expect(槽(host, "group-title").map((el) => el.textContent)).toEqual(["zz-工具", "aa-研判"])
  })

  test("组里的条目：一条一个，两行文字取**显示名** `name` 与 `description`", () => {
    // ⚠️ 这里是 `name`（009 §11 的「名称」）**不是** `skill`（连接键）：夹具让两者不同值，
    // 渲染里写错字段当场红。见上面 `造skill` 的注释。
    const host = mountDrawer()

    expect(槽(host, "skill-entry").length).toBe(3)
    expect(槽(host, "skill-entry-name").map((el) => el.textContent)).toEqual(["effect 编程", "RTL 与 LTR", "资金关联分析"])
    expect(槽(host, "skill-entry-description").map((el) => el.textContent)).toEqual([
      "Work with Effect v4 TypeScript code in this repo",
      "RTL / LTR behavior in the web app, CSS, menus, scrolling",
      "按账户拉资金往来的关联图",
    ])
  })

  test("条目两行的字号：名 13px base、描述 11px muted（§4.7.3）", () => {
    const host = mountDrawer()

    expect(缺哪些(槽(host, "skill-entry-name")[0].className, ["text-[13px]", "text-v2-text-text-base"])).toEqual([])
    expect(
      缺哪些(槽(host, "skill-entry-description")[0].className, ["text-[11px]", "text-v2-text-text-muted"]),
    ).toEqual([])
  })

  test("两行都**单行截断**（`truncate` 挂在内层 `span`，不挂外层容器）", () => {
    // 同 T004 那条：`truncate` 要块级／内联块子元素上才生效，挂在 `flex` 容器上是白挂
    // （先例 `center/tab-bar.tsx` 的 `tab-title`）。
    const host = mountDrawer()

    expect(缺哪些(槽(host, "skill-entry-name")[0].className, ["truncate"])).toEqual([])
    expect(缺哪些(槽(host, "skill-entry-description")[0].className, ["truncate"])).toEqual([])
  })

  test("行高 ≥ 40px —— 落成 `min-h-10`（happy-dom 量不出高度，只能断类名，`#005-07`）", () => {
    const host = mountDrawer()

    expect(缺哪些(槽(host, "skill-entry")[0].className, ["min-h-10"])).toEqual([])
  })

  test("条目**不带图标**（§4.7 开篇：skill 的图标今天没有客观来源，配图标就是造数据）", () => {
    // 断在**布尔**上（`#005-01`）：这条红的时候实得值若是节点，bun 打印它会挂死整轮。
    const host = mountDrawer()
    const 条目里有图 = 槽(host, "skill-entry").some((条) => 条.querySelector("svg") !== null)

    expect(条目里有图).toBe(false)
  })

  test("关闭钮带着得见的无障碍标签，点它回调 `onClose`（对照：没点之前一次都没调）", () => {
    let 关了几次 = 0
    const host = mountDrawer({ onClose: () => 关了几次++ })
    const 钮 = host.querySelector<HTMLElement>("[aria-label='关闭更多 skill']")

    expect(钮).not.toBeNull()
    expect(关了几次).toBe(0)
    钮!.click()
    expect(关了几次).toBe(1)
  })
})
