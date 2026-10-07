import { afterEach, describe, expect, test } from "bun:test"
import type { Message, Part, Session } from "@opencode-ai/sdk/v2"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { SessionPanel, type SessionPanelData } from "./session-panel"
import { GENERIC_MODULE, type CapabilityManifest, type SkillCapability } from "./capabilities"
import { projectCapabilities } from "./projection"

/**
 * 右栏「最小可用会话」（T008 / FR-010 / DESIGN §4.7.5）。
 *
 * ## 这一条的第一件事是「证伪一个错觉」
 *
 * 计划 §② 的裁定 U1(c) 说右栏要**自挂一份 `DataProvider``**，理由那节写着「路由的 `DataProvider`
 * 是 `WorkspaceEntry` 的**后代**、不是祖先」。这是一条**推断**——推断要落地成**会红的对照**才算数
 * （`LEARNINGS #003-04`：推断落笔前先复现）。所以本文件的第一组就是那条对照：**不挂**时
 * `SessionTurn` 当场抛错（它 `useData()`，而 `createSimpleContext` 的 `use()` 在无 provider 时
 * `throw new Error("Data context must be used within a context provider")`）。
 *
 * ⚠️ 顺带记一笔：`SessionTurn` 只用**两个** provider——`useData()` 与 `useFileComponent()`。
 * `useI18n()` 不在此列：`@opencode-ai/ui/context/i18n` 的 `createContext` 带一份 `fallback`
 * （`locale: () => "en"`）⇒ **不挂也不抛**。夹具因此只需包 `FileComponentProvider`。
 */

/** 挂过的卸载函数，`afterEach` 里统一收（`LEARNINGS #005-03`：谁建的响应式作用域谁收）。 */
const 挂过的: Array<() => void> = []

afterEach(() => {
  // ⚠️ 顺序：**先 dispose、再清 body**。反过来的话 dispose 会去碰已经摘掉的节点。
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

/** 挂一棵树，返回宿主（本文件所有判据都在它上面取）。 */
function 挂(内容: () => JSX.Element): HTMLElement {
  const 宿主 = document.createElement("div")
  document.body.appendChild(宿主)
  挂过的.push(render(内容, 宿主))
  return 宿主
}

/** `FileComponentProvider` 要一个 `ValidComponent`；夹具塞个空组件即可（本文件不渲染文件）。 */
const 假文件 = () => <div data-component="fake-file" />

/**
 * 会话原语链上要的那几个 provider，**除 `DataProvider` 之外**全在这儿——
 * 它是被测项（右栏要不要自挂），不能被夹具预先满足，否则第一条对照就失去意义。
 *
 * 清单是**跑出来的**，不是猜的：先只挂 `FileComponentProvider`，红出 `useDialog`；
 * 补上 `DialogProvider` 才过。`useI18n()` 不在列表里——`ui/context/i18n` 的 `createContext`
 * 带 `fallback`（`locale: () => "en"`），不挂也不抛（`#004-13`：能一次解释掉全部现象的说法才是根因）。
 */
const 原语环境 = (内容: () => JSX.Element) => (
  <DialogProvider>
    <FileComponentProvider component={假文件}>{内容()}</FileComponentProvider>
  </DialogProvider>
)

// ── 夹具：最小可渲染的会话数据 ───────────────────────────────────────────────
// 形状照 `packages/app/src/context/global-sync/event-reducer.test.ts` 的仓库惯例写
// （`({…最小字段}) as Session`）——sdk 那两个类型字段多，逐字段填是给夹具加噪音。

// ⚠️ 这一条断言就地关掉，理由写在这儿（`lint:openhive` 的判据是「**本次新增/改动文件 0 命中**」）：
// 夹具只需要 `id` / `title` / `time` 三个字段，逐字段填是给夹具加噪音，且**上游给 `Session` 加一个
// 必填字段就红**——红的还是我们这条夹具。同族写法（同样触发这条规则、上游未关）见
// `context/global-sync/event-reducer.test.ts`。
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具，不是产品码；见上三行。
const 造会话 = (id: string, title: string) => ({ id, title, time: { created: 1, updated: 1 } }) as Session

const 造消息 = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt" },
  }) as Message

const 造文本块 = (id: string, messageID: string, 文本: string) =>
  ({
    id,
    messageID,
    sessionID: "ses_1",
    type: "text",
    text: 文本,
  }) as Part

const 夹具数据 = (条数 = 1): SessionPanelData => ({
  session: [造会话("ses_1", "资金分析会话")],
  session_status: {},
  session_diff: {},
  message: {
    ses_1: Array.from({ length: 条数 }, (_, i) => 造消息(`msg_${i + 1}`, "ses_1")),
  },
  part: { msg_1: [造文本块("prt_1", "msg_1", "帮我看看这个账户")] },
})

/** 当前会话里 `session-turn` 根节点的个数。 */
const 数turn = (宿主: HTMLElement) => 宿主.querySelectorAll('[data-component="session-turn"]').length

/**
 * 一份**四层都空**的投影，给不关心能力清单的用例用。
 *
 * `projection` 是**必填**的（理由同 `commands` 曾经那条：可选就等于「忘了传也没人红」，
 * 而忘传的表现是「右栏空着」，与「这个模块还没有 skill」在界面上分不开）。
 */
const 空投影 = projectCapabilities([], undefined)

describe("右栏会话的 `DataProvider`（FR-010 / 计划 §② 的那道接线）", () => {
  test("对照：`SessionTurn` 不挂 `DataProvider` 直接渲染 ⇒ 当场抛错", () => {
    // 这一条**不测产品码**，它测的是一条**事实**（也是 T008 的第一条 RED）：会话原语要
    // `DataProvider`，而中栏那份挂不到右栏。把它写成断言的理由是——它是「右栏为什么要自挂」
    // 的**唯一证据**，将来谁把 `DataProvider` 摘了，这条会先红（哨兵，`LEARNINGS #005-15`）。
    expect(() =>
      挂(() => 原语环境(() => <SessionTurn sessionID="ses_1" messageID="msg_1" />)),
    ).toThrow()
  })

  test("`SessionPanel` 自挂 `DataProvider` ⇒ 同样的 `SessionTurn` 渲染得出来", () => {
    const 宿主 = 挂(() =>
      原语环境(() => (
        <SessionPanel data={夹具数据()} directory="/tmp/openhive-test" sessionID="ses_1" projection={空投影} />
      )),
    )

    expect(宿主.querySelectorAll('[data-component="session-turn"]').length).toBe(1)
  })
})

describe("消息流（FR-010）", () => {
  const 挂会话 = (data: SessionPanelData, sessionID = "ses_1") =>
    挂(() =>
      原语环境(() => (
        <SessionPanel data={data} directory="/tmp/openhive-test" sessionID={sessionID} projection={空投影} />
      )),
    )

  test("条数跟着会话走：3 条消息 ⇒ 3 个 turn（不是恒一个）", () => {
    // 上一条只钉了「1 条 ⇒ 1 个」，**恒渲染一个 turn 也能过**。这一条才是把「跟着数据走」钉住的那条
    // ——两条一起才有牙（同 `#005-07`：一个约定写正反两面，别只写正向）。
    expect(数turn(挂会话(夹具数据(3)))).toBe(3)
  })

  test("空会话 ⇒ 一个 turn 都没有（不占位、不抛错）", () => {
    expect(数turn(挂会话({ ...夹具数据(), message: { ses_1: [] } }))).toBe(0)
  })

  test("别会话的消息不进这一栏（本栏只认传进来的 `sessionID`）", () => {
    // 「切换会话」的**底层性质**就靠这条钉着：同一份 data 里有两场会话，右栏只渲染当前那一场。
    // 若哪天实现改成「把所有 session 的消息拼起来」（或忘了按 id 取），这条会红。
    const 两场: SessionPanelData = {
      ...夹具数据(),
      session: [造会话("ses_1", "资金分析会话"), 造会话("ses_2", "话单分析会话")],
      message: { ses_1: [造消息("msg_1", "ses_1")], ses_2: [造消息("msg_9", "ses_2")] },
    }

    expect(数turn(挂会话(两场))).toBe(1)
    expect(数turn(挂会话(两场, "ses_2"))).toBe(1)
  })
})

describe("会话行：新建与切换（FR-010 / 2026-10-07 裁定：做在右栏内）", () => {
  const 两场 = (): SessionPanelData => ({
    ...夹具数据(),
    session: [造会话("ses_1", "资金分析会话"), 造会话("ses_2", "话单分析会话")],
    message: { ses_1: [造消息("msg_1", "ses_1")], ses_2: [造消息("msg_9", "ses_2")] },
  })

  /** 造一次「点了哪个槽」。返回 `[宿主, 记下的动作]`。 */
  const 摆好 = (sessionID = "ses_1") => {
    const 事件: string[] = []
    const 宿主 = 挂(() =>
      原语环境(() => (
        <SessionPanel
          data={两场()}
          directory="/tmp/openhive-test"
          sessionID={sessionID}
          projection={空投影}
          onSelectSession={(id) => 事件.push(`切到 ${id}`)}
          onNewSession={() => 事件.push("新建")}
        />
      )),
    )
    const 点 = (选择器: string) => {
      const 元素 = 宿主.querySelector<HTMLElement>(选择器)
      if (!元素) throw new Error(`没找到 ${选择器}`)
      元素.click()
    }
    return { 宿主, 事件, 点 }
  }

  const 列出的会话 = (宿主: HTMLElement) =>
    [...宿主.querySelectorAll('[data-slot="session-option"]')].map((元素) => 元素.textContent)

  test("收起时：行上写着**当前**会话名，但不展开列表（也不占位）", () => {
    const { 宿主 } = 摆好()

    expect(宿主.querySelector('[data-slot="session-current"]')?.textContent).toContain("资金分析会话")
    expect(列出的会话(宿主)).toEqual([])
  })

  test("点 ▾ ⇒ 展开列出**全部**会话（含当前那条）", () => {
    const { 宿主, 点 } = 摆好()

    点('[data-slot="session-toggle"]')

    expect(列出的会话(宿主)).toEqual(["资金分析会话", "话单分析会话"])
  })

  test("点列表里的一条 ⇒ `onSelectSession` 收到**那一条**的 id（不是当前那条）", () => {
    // 钉的是「点到谁就切到谁」：夹具里第二条与第一条**不同名不同 id**，所以索引写错会红。
    const { 点, 事件, 宿主 } = 摆好()

    点('[data-slot="session-toggle"]')
    const 第二条 = 宿主.querySelectorAll<HTMLElement>('[data-slot="session-option"]')[1]
    第二条.click()

    expect(事件).toEqual(["切到 ses_2"])
  })

  test("点「＋ 新会话」⇒ `onNewSession` 被调（且不误报成切换）", () => {
    const { 点, 事件 } = 摆好()

    点('[data-slot="session-new"]')

    expect(事件).toEqual(["新建"])
  })

  // ── 视觉约定（节奏铁律 #2：happy-dom **无 CSS 引擎**，颜色量不出来，只能钉 `className` 串）──
  //
  // 「右栏的行底色 = `layer-01`，不是白」这条约定在本 feature **已有两处**断言
  // （`common-cards.test.tsx` / `context-cards.test.tsx` 各一条）。会话行是**第三处**，
  // 按 `LEARNINGS #005-07`「一个约定落 N 处就写 N 条」补齐——不是凑数：这条约定在这栏里
  // 是按「行」数的，少钉一处就等于把那一处留给下一个人随手改回白底（§4.7.1 给的理由：
  // 白卡片叠白底，`--v2-elevation-raised` 那点阴影**无处着力**，卡片与底面糊成一片）。
  //
  // ⚠️ 这条是**实现之后**补的（不是先红后绿）⇒ 它的牙靠**变异**证（摘成白底应当恰红一条）。
  test("会话行取 `layer-01`（与卡行同档），且**展开的列表**才是白底——两处底色必须不同", () => {
    const { 宿主, 点 } = 摆好()
    const 行 = 宿主.querySelector('[data-slot="session-row"]')!
    const 行串 = 行.className

    expect(行串).toContain("bg-v2-background-bg-layer-01")
    // 对照（同一条断言的反面）：行**不能**是白底。只写正向那条时，把行刷成白底也算过。
    expect(行串).not.toContain("bg-v2-background-bg-base")

    点('[data-slot="session-toggle"]')

    // 另半条对照：列表是**浮层**、取白底；与行不同色才叫「分层」。
    // 两条一起才有牙——反过来说，两处写成同一个色也能过其中任意一条。
    expect(宿主.querySelector('[data-slot="session-list"]')!.className).toContain("bg-v2-background-bg-base")
  })
})

describe("Hero 输入（FR-010 / §4.7.5 / T007 📤 的那一根线）", () => {
  // 这一组**不复写 T007 的断言**（`tasks.md` 的 T013 📤 也这么要求）：`skillCommands` 的适配形状
  // 由 `command-palette.test.tsx` 钉着。这里钉的是**最后一公里**——右栏真的把注入进来的
  // `commands` 交到了原生 controller 手上、且打 `/` 真的会开那个弹层。
  const 两条能力: SkillCapability[] = [
    造能力("fund-link-analysis", "资金关联分析", "按账户拉资金往来的关联图"),
    造能力("call-record-analysis", "话单关联分析", "按号码拉通话频次的关联图"),
  ]
  /**
   * 喂给面板的**投影结果**——走的是生产那条路（`projectCapabilities` → 面板内部再
   * `skillCommands(投影.all)`）。
   *
   * ⚠️ 期望值**不是**由实现算出来的：下面那两条 id 是**字面量**。若实现里把喂给 controller 的
   * 那一支换掉（比如换成 `drawer` 或 `common`），断言会红（`LEARNINGS #004-02`：两个投影要有
   * 一条故意会红的相等断言，别让两边各自长）。
   */
  const 命令投影 = projectCapabilities([{ module: GENERIC_MODULE, capabilities: 两条能力 }], undefined)

  /** 一条能力。`capabilities.ts` 的形状，只填本组用得着的字段。 */
  function 造能力(skill: string, name: string, description: string): SkillCapability {
    return { skill, name, description, group: "业务研判", cards: [] }
  }

  /** `useFilteredList` 底下是 `createResource`——结果**不是同步**就绪的。 */
  const 歇 = () => new Promise((r) => setTimeout(r, 10))

  /**
   * 往 Hero 的编辑器里打一段字。
   *
   * 走的是**真实那条链**（`index.tsx` 的 `onInput`）：`parsePromptInputV2Editor` 读 DOM
   * → `controller.onInput(...)` → 状态机。**不**绕过组件直接调 controller —— 那样测的是
   * 「controller 能用」（T007 已经证过），不是「右栏把它接上了」。
   */
  const 打字 = (宿主: HTMLElement, 串: string) => {
    const 编辑器 = 宿主.querySelector<HTMLElement>('[data-component="prompt-input"]')
    if (!编辑器) throw new Error("没找到 Hero 输入的编辑器（`[data-component=\"prompt-input\"]`）")
    编辑器.textContent = 串
    编辑器.dispatchEvent(new Event("input", { bubbles: true }))
  }

  /** 弹层里列出的建议 id。原生浮层的条目是 `[data-suggestion-id]`。 */
  const 列出的建议 = (宿主: HTMLElement) =>
    [...宿主.querySelectorAll<HTMLElement>("[data-suggestion-id]")].map((元素) => 元素.dataset.suggestionId)

  const 摆好 = () =>
    挂(() =>
      原语环境(() => (
        <SessionPanel
          data={夹具数据()}
          directory="/tmp/openhive-test"
          sessionID="ses_1"
          projection={命令投影}
          onSubmitPrompt={() => {}}
        />
      )),
    )

  test("右栏带 Hero 输入（原生 `v2/prompt-input` 外壳）", () => {
    const 宿主 = 摆好()

    expect(宿主.querySelector('[data-component="prompt-input-v2"]')).not.toBeNull()
    // 外壳的 class 是原生的实况（§4.7.5：**原样**沿用，不新增 app 级 CSS 覆盖）。
    expect(宿主.querySelector('[data-component="prompt-input-v2"]')!.className).toContain("rounded-xl")
  })

  test("打 `/` ⇒ 弹层列出**注入给它的** skill 全集（T007 那根线接上了）", async () => {
    const 宿主 = 摆好()

    打字(宿主, "/")
    await 歇()

    expect(列出的建议(宿主)).toEqual(["skill.fund-link-analysis", "skill.call-record-analysis"])
  })

  test("对照：打普通字 ⇒ 弹层**不开**（证明上一条不是「浮层恒开」也能过）", async () => {
    const 宿主 = 摆好()

    打字(宿主, "帮我看看这个账户")
    await 歇()

    expect(列出的建议(宿主)).toEqual([])
  })

  test("继续打字真的在**筛**（打中文显示名命中一条，不是把全集一直列着）", async () => {
    const 宿主 = 摆好()

    打字(宿主, "/话单")
    await 歇()

    expect(列出的建议(宿主)).toEqual(["skill.call-record-analysis"])
  })
})

describe("常用操作行 + 更多 skill 抽屉（T004 📥 / T006 📥 交来的两笔）", () => {
  const 造能力 = (
    skill: string,
    name: string,
    description: string,
    cards: SkillCapability["cards"] = [],
  ): SkillCapability => ({ skill, name, description, group: "业务研判", cards })

  /** 一份清单。`module` 用 `GENERIC_MODULE`——它**永远算数**（`projection.ts` 的取清单规则）。 */
  const 造清单 = (capabilities: SkillCapability[]): CapabilityManifest => ({ module: GENERIC_MODULE, capabilities })

  const 通用两张卡 = 造能力("analysis-common", "通用分析", "通用", [
    { label: "资金穿透", prompt: "帮我做资金穿透", layer: "common" },
    { label: "关系图谱", prompt: "帮我画关系图谱", layer: "common" },
  ])
  const 第二份 = 造能力("call-record", "话单分析", "话单", [
    { label: "通话频次", prompt: "帮我统计通话频次", layer: "common" },
  ])

  const 投影 = (能力集: CapabilityManifest[]) => projectCapabilities(能力集, undefined)

  const 摆好 = (能力集: CapabilityManifest[] = [造清单([通用两张卡])]) =>
    挂(() =>
      原语环境(() => (
        <SessionPanel
          data={夹具数据()}
          directory="/tmp/openhive-test"
          sessionID="ses_1"
          projection={投影(能力集)}
        />
      )),
    )

  test("常用操作行接进右栏了：标题「常用操作」＋ 卡的张数跟着投影走（T004 📥 ①）", () => {
    expect(摆好().querySelectorAll('[data-slot="card-row"]').length).toBe(1)
    expect(摆好().querySelector('[data-slot="card-row-title"]')?.textContent).toBe("常用操作")

    // 换一份注入的清单 ⇒ 张数跟着变。只钉「有卡行」的话，写死一张卡也能过。
    expect(摆好().querySelectorAll('[data-slot="card"]').length).toBe(2)
    expect(摆好([造清单([通用两张卡, 第二份])]).querySelectorAll('[data-slot="card"]').length).toBe(3)
  })

  test("卡行的宽度**真的量得到**：装得上 `ResizeObserver` 时它观察的是卡行自己（T004 📥 ①）", () => {
    // 这条钉的是 T004 📥 写的那个后果——「本行自己会量，但没接进右栏就量不到 ⇒ 生产里永远不溢出」。
    // happy-dom **没有** `ResizeObserver`（行内那句 `typeof … === "undefined"` 就是为它写的），
    // 所以这里**换上一个会记账的**：它观察到的元素 = 卡行 ⇒ 在真浏览器里 `量到的()` 会拿到真宽。
    // 不断言「量到了几 px」（happy-dom 拿不到布局）——只断言**观察发生了、且对象是卡行**
    // （`LEARNINGS #004-13`：「没有现成观测面」≠「没有观测面」）。
    const 被观察的: Element[] = []
    class 记账观察器 {
      // ⚠️ **故意不写 `constructor(回调)`**：它是空体，而 oxlint 的 `no-useless-constructor` 会红。
      // 删掉不欠任何东西——本类是从 `unknown` 槽位塞进 `globalThis` 的，构造签名不在任何检查里；
      // 而运行时 `new ResizeObserver(回调)` 多传的那个实参 JS 本来就忽略（被调的只有 `observe`）。
      observe(元素: Element) {
        被观察的.push(元素)
      }
      // 三个方法都给全：只给 `observe` 时，链上别的 usages 会去调 `unobserve` / `disconnect`，
      // 报出来的是一句与本用例无关的 `undefined is not an object`（实测踩到）。
      unobserve() {}
      disconnect() {}
    }
    const 原物 = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = 记账观察器
    try {
      const 宿主 = 摆好()

      // 断「**卡行在其中、且恰好被观察一次**」，不断「只有它一个」——实测这棵树里
      // `SessionTurn` 自己也挂了一个 `ResizeObserver`（观察的是
      // `session-turn-message-container`）。把「只有它一个」写死，等于把**上游**的内部实现
      // 变成我们这条断言的一部分：上游哪天多挂一个观察器，红的是我们（第一号约束：
      // 与上游的冲突面越小越好）。断「它在、且一次」既够证据，也不绑上游。
      const 卡行 = 宿主.querySelector('[data-slot="card-row"]')
      expect(被观察的.filter((元素) => 元素 === 卡行).length).toBe(1)
    } finally {
      // ⚠️ 还原：`ResizeObserver` 是**全局**的，留在这儿会污染同一进程里后面的用例。
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = 原物
    }
  })

  test("抽屉入口：默认不渲染抽屉；点 ▸ ⇒ 开，且列出**注入的**分组（T006 📥 ③）", () => {
    const 宿主 = 摆好()

    expect(宿主.querySelector('[data-slot="skill-drawer"]')).toBeNull()

    宿主.querySelector<HTMLElement>('[data-slot="drawer-entry"]')!.click()

    expect(宿主.querySelector('[data-slot="skill-drawer"]')).not.toBeNull()
    const 组名 = [...宿主.querySelectorAll('[data-slot="group-title"]')].map((元素) => 元素.textContent)
    expect(组名).toEqual(["业务研判"])
  })

  test("抽屉的关闭钮 ⇒ 收起（`SkillDrawer.onClose` 那个受控接缝接上了）", () => {
    const 宿主 = 摆好()

    宿主.querySelector<HTMLElement>('[data-slot="drawer-entry"]')!.click()
    expect(宿主.querySelector('[data-slot="skill-drawer"]')).not.toBeNull()

    宿主.querySelector<HTMLElement>('[aria-label="关闭更多 skill"]')!.click()

    expect(宿主.querySelector('[data-slot="skill-drawer"]')).toBeNull()
  })
})
