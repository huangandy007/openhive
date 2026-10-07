import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { GENERIC_MODULE, type CapabilityManifest } from "./capabilities"
import { skillCommands } from "./command-palette"
import { ContextCards } from "./context-cards"
import { projectCapabilities } from "./projection"
import { SkillDrawer } from "./skill-drawer"

/**
 * **指令卡四层投影 → 渲染组件**的整条链（T013 / FR-001 / FR-006 / SC-002）。
 *
 * ## 这条测试为什么单独存在
 *
 * T004–T007 各自钉过自己那一层，但每一条喂进去的都是**那个文件自己的夹具**：
 * `common-cards.test.tsx` / `context-cards.test.tsx` 手写 `ProjectedCard[]` 直接塞给组件
 * （本文件里那句 `造卡(...)`，**不过 `projectCapabilities`**）；`skill-drawer.test.tsx` 手写
 * `SkillGroup[]`。也就是说「带卡的清单 → 投影 → 组件」这条链**今天没有一次被走完过**——
 * `projection.context → ContextCards` 与 `projection.drawer → SkillDrawer` 这两条缝**零覆盖**：
 * 投影少过滤一层、或组件读错一个字段，两侧的用例都照样全绿。
 *
 * 这正是 `tasks.md` 在 T005 / T006 / T007 三条下面各插一句「T013 收」的用意——
 * **别把那 12 / 12 / 11 条再写一遍**，把「**换一份注入的清单跑**」这件事补上。
 *
 * ## 本文件刻意不做的事（做了就是重复劳动，且会稀释证据）
 *
 * - **不重测**「空集 / 非空但不命中 / 溢出收 ⋯ / 选中态浅金 / 缺触发键 fail-closed」——那是 T005 的
 *   12 条，判据是**组件自身的筛选逻辑**，与投影怎么来的无关。
 * - **不重测** ① 常用操作（`projection.common → CommonCards → 右栏`）——`session-panel.test.tsx`
 *   已用真 `projectCapabilities` 覆盖，且带「换清单 ⇒ 张数跟着变」的对照。
 * - **不重测** ④ 命令池的**端到端**接线（→ 原生 `/` 弹层）——`session-panel.test.tsx` 那条
 *   「打 `/` ⇒ 弹层列出**注入给它的** skill 全集」已经钉了。这里只补它没有的那条：
 *   **池子跟着模块换**（下面 §C）。
 *
 * ## 为什么注入清单是**第二份**
 *
 * `capabilities.ts` 的 `MANIFESTS` 是**真**清单，但它的 `cards` 全为空（**有意**：006 只造机制，
 * 卡文案随模块，是 F6/F7 的内容）⇒ 拿它写「卡浮出来了」是**空断言**（`LEARNINGS #004-13`）。
 * 所以这里自己造一份**带卡**的清单，且刻意满足三件事：
 *
 * 1. **两组模块清单 ＋ 一份通用清单**——「换模块，四层跟着换」才动得起来（FR-006 的判据）；
 * 2. 上下文键（`选中资金账户` / `选中通话号码`）**与 T005 夹具那两个键不同值**（那边是
 *    `选中账户` / `上传文件`）——证这一层认的是「喂进来的那个词」，不是某个写死的词；
 * 3. 「显示名 ≠ 连接键」（`research-note` / 「研判记录」）——让「`/` 池取连接键、抽屉取显示名」
 *    这两条断言**今天就有牙**（生产里两者同值，差别要到 009 才显形，同 `command-palette.test.tsx`
 *    的夹具取法）。
 *
 * ⚠️ 两个 `module` 取值（`资金分析` / `话单分析`）是**本文件的夹具**，拼写由 F6 / F7 落地时定
 * （`capabilities.ts` 只钉「不等于 `GENERIC_MODULE`」）。别把这里当权威。
 *
 * ## SC-002 的「浮现 / 换 / 消失」怎么落
 *
 * 用 `createSignal` 控**模块**与**上下文集合**，`ContextCards` / `SkillDrawer` 拿到的都是
 * **同一个实例**上实时重算的投影 ⇒ 下面那几条断的是「跟着换 / 跟着没了」，**不是**「换个夹具
 * 重新挂一次」——后者证不出 FR-006 要的「机制通用」。
 *
 * ⚠️ `contexts` 由本文件提供：生产里**今天没有任何东西喂它**（中栏没有右栏读得到的「选中」状态，
 * T008 裁定不接线）——那是**缺口**，按 `LEARNINGS #002-02` 记在 `state.md`；
 * 本文件证的是**接上之后这条链是通的**。
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

/** 某个 data-slot 的文案序列（本文件的判据全在这些序列上）。 */
const 文案 = (host: HTMLElement, 名: string) => 槽(host, 名).map((el) => el.textContent)

// ── 注入的那份清单（第二份，带卡） ──────────────────────────────────────────────

const 资金 = "资金分析"
const 话单 = "话单分析"

/** 上下文键。**与 T005 夹具的 `选中账户` / `上传文件` 不同值**——见文件头第 2 条。 */
const 选中资金账户 = "选中资金账户"
const 选中通话号码 = "选中通话号码"
const 选中研判对象 = "选中研判对象"

/** 跨模块常在那一份（`GENERIC_MODULE`）：一张常驻卡 ＋ 一张上下文卡。 */
const 通用清单: CapabilityManifest = {
  module: GENERIC_MODULE,
  capabilities: [
    {
      skill: "research-note",
      name: "研判记录",
      description: "把当前这一步研判记成一笔",
      group: "通用",
      cards: [
        { label: "记一笔研判", prompt: "帮我记一笔研判", layer: "common" },
        { label: "通用研判模板", prompt: "按通用模板起一份研判", layer: "context", context: 选中研判对象 },
      ],
    },
  ],
}

const 资金清单: CapabilityManifest = {
  module: 资金,
  capabilities: [
    {
      skill: "fund-link-analysis",
      name: "资金关联分析",
      description: "按账户拉资金往来的关联图",
      group: "资金研判",
      cards: [
        { label: "资金穿透", prompt: "帮我做一次资金穿透", layer: "common" },
        { label: "查资金链", prompt: "帮我查一下这条资金链", layer: "context", context: 选中资金账户 },
      ],
    },
  ],
}

const 话单清单: CapabilityManifest = {
  module: 话单,
  capabilities: [
    {
      skill: "call-record-analysis",
      name: "话单关联分析",
      description: "按号码拉通话频次的关联图",
      group: "话单研判",
      cards: [
        { label: "通话频次", prompt: "帮我统计通话频次", layer: "common" },
        { label: "查通话对象", prompt: "列出这个号码的通话对象", layer: "context", context: 选中通话号码 },
      ],
    },
  ],
}

/**
 * 注入清单。⚠️ **通用那份刻意排在最后声明**——这不是随手排的：
 * `projectCapabilities` 按清单顺序拍平，所以「通用卡在前」的**声明序**＝模块卡在前；
 * 而 §4.7.1 要求渲染时把通用那支**翻到前面**。两条**方向相反**时，排序才是活的
 * ——把通用排在最前的话，「排不排都一样」，那条断言就空了（`LEARNINGS #005-15`：
 * 「我这条断言拦住了 X」要靠拆掉那一行去证，不能靠「它看起来会红」）。
 *
 * 代价是抽屉那两组也按**首次出现序**（`分组()` 不排序）：模块组在前、通用组在后。
 */
const 注入清单: CapabilityManifest[] = [资金清单, 话单清单, 通用清单]

/**
 * 真装配：`清单 → projectCapabilities(清单, 模块()) → 两层真组件`。
 *
 * 两层都从**同一次投影**派生——模块一变，两层 DOM 一起动，这就是 SC-002 与 FR-006 要的「跟着换」。
 * ④ 那一支（`all`）**不走 DOM**：`skillCommands` 是纯函数，它的断言直接比返回值（下面 §C），
 * 不必为了「也在树里」给它挂一层壳。
 */
function 摆好(选项: { 模块: () => string | undefined; 上下文: () => string[] }) {
  return mount(() => {
    const 投影 = () => projectCapabilities(注入清单, 选项.模块())
    return (
      <div>
        <ContextCards cards={投影().context} contexts={选项.上下文()} />
        <SkillDrawer groups={投影().drawer} open={true} />
      </div>
    )
  })
}

describe("指令卡投影链 · ② 上下文指令（projection.context → ContextCards / FR-003 / SC-002）", () => {
  test("带卡的清单走完投影 ⇒ 这一层真的浮出来，且通用那支排在模块卡前面（§4.7.1）", () => {
    const host = 摆好({ 模块: () => 资金, 上下文: () => [选中资金账户, 选中研判对象] })

    expect(文案(host, "card-row-title")).toEqual(["上下文指令"])
    // 顺序**不是本文件摆的**：通用那份是**最后**声明的（见 `注入清单` 那条注释），投影拍平后的
    // 自然序是 `查资金链` 在前；翻过来的是共享语法那层的 `通用优先()`，它按
    // `卡.module === GENERIC_MODULE` 排——而那个 `module` 字段**只能由投影补上**
    // （`projection.ts` 的 `ProjectedCard`：卡在 `SkillCapability.cards` 里时「属于哪份清单」
    // 是结构性的，拍平成一层卡片就丢了）。摘掉投影里那句 `module: 清单.module`、或拆掉渲染层的
    // `通用优先()`，这条都会当场红 —— 这就是「两层缝」被接上的证据。
    expect(文案(host, "card-label")).toEqual(["通用研判模板", "查资金链"])
  })

  test("换模块 ⇒ 这一层换成话单那张，通用那张**留**（同一个实例，不重挂）", () => {
    const [模块, 设模块] = createSignal<string | undefined>(资金)
    const host = 摆好({ 模块, 上下文: () => [选中资金账户, 选中通话号码, 选中研判对象] })

    expect(文案(host, "card-label")).toEqual(["通用研判模板", "查资金链"])

    设模块(话单)

    // 换的是**模块自己的那一张**；通用那张横跨两个模块都在——FR-006「机制通用、内容随模块」
    // 在这一层的实况。
    expect(文案(host, "card-label")).toEqual(["通用研判模板", "查通话对象"])
  })

  test("取消选中 ⇒ 整段消失，连分组标题都不留（SC-002 第三步）", () => {
    const [上下文, 设上下文] = createSignal([选中资金账户])
    const host = 摆好({ 模块: () => 资金, 上下文 })

    // 对照**在前**：先证「有」时真的在，再断「没了」（`LEARNINGS #004-08`）——只断「不渲染」的话，
    // 整段根本没在工作也会绿。T005 那条空集断言喂的是手写夹具的空集，这条喂的是**真投影 ＋
    // 同一个实例**从有到无，是这条链上才有的性质。
    expect(无槽(host, "card-row")).toBe(false)

    设上下文([])

    expect(无槽(host, "card-row")).toBe(true)
    expect(无槽(host, "card-row-title")).toBe(true)
  })
})

describe("指令卡投影链 · ③ 更多 skill 抽屉（projection.drawer → SkillDrawer / FR-004）", () => {
  test("带卡的清单走完投影 ⇒ 抽屉按投影分好的组渲染（组序 = 首次出现序，不排序）", () => {
    const host = 摆好({ 模块: () => 资金, 上下文: () => [] })

    // 组序逐字等于 `注入清单` 的声明序（模块在前、通用在后）——`分组()` **不排序**，
    // 所以这条同时钉住了「抽屉没有偷偷加一层排序」。
    expect(文案(host, "group-title")).toEqual(["资金研判", "通用"])
    // 条目读的是**显示名**（`SkillCapability.name`）——夹具刻意让显示名与连接键不同值，
    // 所以「把 `条.name` 换成 `条.skill`」这种变异在这条上有牙（同 `skill-drawer.test.tsx` 的取法）。
    expect(文案(host, "skill-entry-name")).toEqual(["资金关联分析", "研判记录"])
  })

  test("换模块 ⇒ 抽屉内容跟着换，通用那组留下（同一个实例）", () => {
    const [模块, 设模块] = createSignal<string | undefined>(资金)
    const host = 摆好({ 模块, 上下文: () => [] })

    expect(文案(host, "group-title")).toEqual(["资金研判", "通用"])

    设模块(话单)

    expect(文案(host, "group-title")).toEqual(["话单研判", "通用"])
    expect(文案(host, "skill-entry-name")).toEqual(["话单关联分析", "研判记录"])
  })
})

describe("指令卡投影链 · ④ `/` 命令池（projection.all → skillCommands / FR-005）", () => {
  /**
   * 端到端那一段（→ 原生 `/` 弹层）**已在 `session-panel.test.tsx` 钉过**，这里不重写。
   * 本组只补它没有的那条：**池子跟着模块换**，且通用那份一直在。
   * `skillCommands` 是纯函数 ⇒ 直接比返回值。
   */
  const 池 = (模块: string) =>
    skillCommands(projectCapabilities(注入清单, 模块).all).map((条) => `${条.label} → ${条.title}`)

  test("池子 = 当前模块 ＋ 通用：换模块只换模块那一半（FR-006）", () => {
    expect(池(资金)).toEqual(["/fund-link-analysis → 资金关联分析", "/research-note → 研判记录"])
    expect(池(话单)).toEqual(["/call-record-analysis → 话单关联分析", "/research-note → 研判记录"])
  })
})
