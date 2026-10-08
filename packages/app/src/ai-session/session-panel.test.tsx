import { afterEach, describe, expect, test } from "bun:test"
import type { Message, Part, Session } from "@opencode-ai/sdk/v2"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import { createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
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
//
// ⚠️ `oxlint-disable-next-line` **必须贴着断言那一行**（不是贴着 `const`）：Step 5 的 D1 给
// `造会话` 加了 `额外` 展开之后，这条命中的报告节点从左值那一行挪到了**断言表达式**那一行
// ——实测同一个文件、HEAD 版本 0 warnings、加了展开就 1 warning（`LEARNINGS #003-04`：
// 位置类的事落笔前先量）。贴在 `const` 上时它挡的是**前一行的隔壁**，看着像在关、其实没关。
const 造会话 = (id: string, title: string, 额外: Partial<Session> = {}) =>
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具，不是产品码；理由见上。
  ({ id, title, time: { created: 1, updated: 1 }, ...额外 }) as Session

/**
 * 造一条消息。
 *
 * ⚠️ 第二版才长出 `角色` 这个参数（缺陷修复那条线）。第一版把 `role` **写死成 `"user"`**
 * ⇒ 本文件全部既有用例喂的都是 user ⇒ 「喂一条 assistant 会怎样」**在测试里压根不存在**
 * （而生产里 `message[]` 是一场对话的两倍长：user 与 assistant 各占一半）。这正是那条缺陷
 * 能一路绿到真栈才现形的原因——`LEARNINGS #006-08` 的同型：**夹具喂给被测组件的那一支
 * 只覆盖了一半，另一支没有观测面**。默认值保持 `"user"`，既有 40 余条用例逐字不变。
 */
const 造消息 = (id: string, sessionID: string, 角色: Message["role"] = "user") =>
  ({
    id,
    sessionID,
    role: 角色,
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

/**
 * 一场**真实形状**的对话：`message[]` 里 user 与 assistant **各占一半**，交替落下。
 *
 * ⚠️ 上面那份 `夹具数据(条数)` 是「N 条全是 user」——它造不出这条缺陷（`LEARNINGS #006-08`：
 * 夹具绕开了那一支，于是那一支没有观测面）。上游 SSE 落的正是这一份形状：
 * 用户一问、助手一答，`message[]` 长度是**轮数的两倍**。真栈实测的现场是 4 轮 ⇒ `message[]` 8 条
 * ⇒ 屏上 8 格、其中 4 格是空壳（`session-turn` 的根 div 无条件渲染，见 `数容器` 的注释）。
 */
const 对话 = (轮数: number): SessionPanelData => {
  const 消息: Message[] = []
  const 块: Record<string, Part[]> = {}
  for (let i = 1; i <= 轮数; i++) {
    消息.push(造消息(`usr_${i}`, "ses_1", "user"), 造消息(`ast_${i}`, "ses_1", "assistant"))
    块[`usr_${i}`] = [造文本块(`prt_${i}`, `usr_${i}`, `第 ${i} 问`)]
  }
  return {
    session: [造会话("ses_1", "资金分析会话")],
    session_status: {},
    session_diff: {},
    message: { ses_1: 消息 },
    part: 块,
  }
}

/** 当前会话里 `session-turn` 根节点的个数。 */
const 数turn = (宿主: HTMLElement) => 宿主.querySelectorAll('[data-component="session-turn"]').length

/**
 * 当前会话里**真装进了内容**的 turn 个数。
 *
 * ⚠️ 为什么要有第二个数量：`session-turn` 的根 div 是**无条件渲染**的
 * （`session-turn.tsx` 的 `return <div data-component="session-turn">…`），而里面那层
 * `[data-slot="session-turn-message-container"]` 走在 `<Show when={message()}>` 之下
 * ——`message()` 对非 user 消息恒为 `undefined`（同一文件两处 `msg.role !== "user"`）。
 * ⇒ **光数根节点分不出「4 格真的」与「8 格其中 4 格是空壳」**，那是这条缺陷的原始症状。
 * `数turn` 钉的是「渲染了几格」，`数容器` 钉的是「几格真的有东西」——两条都要。
 */
const 数容器 = (宿主: HTMLElement) =>
  宿主.querySelectorAll('[data-slot="session-turn-message-container"]').length

/**
 * 每格**实际渲的是哪条**消息（`session-turn.tsx` 在容器上写着 `data-message={message()!.id}`）。
 *
 * 比数个数更硬的一层：只数个数的话，「多渲了两格 assistant 空壳」与「漏渲了两格 user」
 * 在数字上**长得一样**（8 ＝ 6＋2 也 ＝ 6＋2）。列出 id 才能把两个方向分开。
 */
const 渲出的消息 = (宿主: HTMLElement) =>
  [...宿主.querySelectorAll('[data-slot="session-turn-message-container"]')].map((节点) =>
    节点.getAttribute("data-message"),
  )

/**
 * 往 Hero 的编辑器里打一段字。
 *
 * 走的是**真实那条链**（`index.tsx` 的 `onInput`）：`parsePromptInputV2Editor` 读 DOM
 * → `controller.onInput(...)` → 状态机。**不**绕过组件直接调 controller —— 那样测的是
 * 「controller 能用」（T007 已经证过），不是「右栏把它接上了」。
 *
 * 定义在**模块级**（T009 起两组用例都要用它）：留一份、别抄第二份——两处各写一遍
 * 「打字怎么打」就会在有人改一处时静默分家（`LEARNINGS #002-06` 的同型）。
 */
const 打字 = (宿主: HTMLElement, 串: string) => {
  const 编辑器 = 宿主.querySelector<HTMLElement>('[data-component="prompt-input"]')
  if (!编辑器) throw new Error("没找到 Hero 输入的编辑器（`[data-component=\"prompt-input\"]`）")
  编辑器.textContent = 串
  编辑器.dispatchEvent(new Event("input", { bubbles: true }))
}

/** Hero 编辑器当下**真的**装着什么文字（读 DOM，不读 store）。 */
const 输入框里的话 = (宿主: HTMLElement) =>
  宿主.querySelector('[data-component="prompt-input"]')?.textContent ?? undefined

/**
 * 在 Hero 编辑器里按回车。
 *
 * 挂点就是 `打字` 用的那个编辑器：`index.tsx` 的 `onKeyDown` 在它身上，且弹层没开时
 * `controller.onKeyDown` 不消费这个键（用例都不打 `/`）。走的是真实那条链，与 `打字` 同理。
 *
 * 定义在**模块级**：提交组与自动跟随组都要用它（`LEARNINGS #002-06`——两处各写一遍
 * 「回车怎么按」，改一处就静默分家）。
 */
const 回车 = (宿主: HTMLElement) => {
  const 编辑器 = 宿主.querySelector<HTMLElement>('[data-component="prompt-input"]')
  if (!编辑器) throw new Error("没找到 Hero 输入的编辑器（`[data-component=\"prompt-input\"]`）")
  编辑器.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

/** 让提交收尾那几条微任务跑完（`onSubmit` 里没有 `await`，只挂了 `.then` 与一处副作用）。 */
const 歇 = () => new Promise((r) => setTimeout(r, 0))

/** 指令卡行的卡（`data-slot="card"` 是共用语法的卡面）。 */
const 卡们 = (宿主: HTMLElement) => [...宿主.querySelectorAll<HTMLElement>('[data-slot="card"]')]

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

  test("每格 turn 外面包着一层「高度 auto ＋ 不许收缩」的盒子（「没有垂直滚动」的修复面）", () => {
    // ⚠️ **这条断的是结构，不是几何**——happy-dom 不跑布局，量不出「容器能不能滚」
    // （`LEARNINGS #005-07`：视觉约定在组件测试里只能退化成 class 串）。几何判据在真栈 E2E
    // 那条「turn 高度 ≠ 容器高 / 条数」。**但结构这条不是凑数的**：它是修复的**必需条件**，
    // 且是唯一能在单测里挡住回归的那个条件。
    //
    // 修的是什么（2026-10-08 真栈肉眼报，根因实测）：`SessionTurn` 自带
    // `[data-component="session-turn"]{height:100%}`，设计前提是**父层高度 auto**。而列表
    // （`[data-slot="session-turns"]`）是限高的 flex 容器 ⇒ turn 直接当它的 flex item 时，
    // `height:100%` 解析成**容器全高** ⇒ n 条 `flex-basis` 全等 ⇒ 被压成 `容器高 / n`
    // （实测 637÷6＝106.17、637÷3＝212.33，精确吻合）⇒ 长内容在格内滚（`content` 那条
    // `overflow-y:auto`）、外层 `scrollHeight` 恒等于 `clientHeight` ⇒ **永远没有滚动条**。
    // 包一层有两个作用，**实测缺一不可**（只治 `content` 那侧不够，turn 仍被压成 `容器高/n`）：
    // ① 它高度 auto ⇒ 内层 `height:100%` 相对它解析为 auto；② `shrink-0` 让它不被收缩。
    //
    // 变异（两条各自有牙）：去掉包层 ⇒ 父层变成列表本身（第一组断言红）；包层留着但去掉
    // `shrink-0` ⇒ 第二组断言红。
    const 格子 = [...挂会话(夹具数据(3)).querySelectorAll('[data-component="session-turn"]')]
    expect(格子.length).toBe(3)

    const 包层 = 格子.map((格) => 格.parentElement)
    // 父层存在、且**不是列表本身**（中间真的隔了一层）。
    // ⚠️ 读出来的是字符串 / `null`（原语）——别把节点当实得值，`toBeNull` 失败时打印 Solid
    // 节点会把整轮 `bun test` 挂哑（`LEARNINGS #005-01`）。
    expect(包层.map((层) => 层?.getAttribute("data-slot") ?? "（无 data-slot）")).toEqual([
      "（无 data-slot）",
      "（无 data-slot）",
      "（无 data-slot）",
    ])
    expect(包层.every((层) => 层?.classList.contains("shrink-0") === true)).toBe(true)
    // 对照：列表自己**不带** `shrink-0`——否则上面那条可能是在断一个恒真的东西。
    expect(
      挂会话(夹具数据(3)).querySelector('[data-slot="session-turns"]')?.classList.contains("shrink-0"),
    ).toBe(false)
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

  /**
   * 「展示过程」的**动态**那一半（T010 / FR-007 的出参）。
   *
   * 上面三条喂的都是**进栏那一刻的静态夹具**，所以「首屏渲染对了」就全绿——而「过程」这个词
   * 指的就是**后来才写进去的那些**：用户自己那条（乐观插入）、助手的回复与工具调用（SSE）。
   * 右栏手里那份 `data` 是一个**身份稳定**的 store（生产里是 `directory-sync.ts` 的 Proxy，
   * `server-session.ts` 的 `optimistic.add` 落的也是 `setData("message", …)`，SSE 走同一处）
   * ⇒ 判据是：**同一次挂载里**往 `data` 里再写一条，消息流当场长一个 turn。
   *
   * ⚠️ **这一条今天就是绿的，所以它是回归网，不是缺陷探测器**（`LEARNINGS #005-15`：
   * 「这条拦住了 X」要靠变异去证，不能靠「它看起来会红」）。它拦的是「有人把 `data`
   * 冻成一份快照 / 深拷贝一次」这一类改法——那时右栏**只显示进栏那一刻的历史**，新消息
   * 再也不出现，而本文件所有静态用例照旧全绿。冻快照那种改法本文件**造不出来**
   * （要么改产品码、要么改成断言一个别的机制），故不写变异，只如实标注它是回归网。
   */
  test("写了新消息就跟着长：往 `data` 里再加一条 ⇒ 当场多一个 turn（不重挂、不刷新）", () => {
    const [数据, 改数据] = createStore<SessionPanelData>(夹具数据(1))
    const 宿主 = 挂(() =>
      原语环境(() => (
        <SessionPanel data={数据} directory="/tmp/openhive-test" sessionID="ses_1" projection={空投影} />
      )),
    )

    expect(数turn(宿主)).toBe(1)

    改数据("message", "ses_1", (旧) => [...旧, 造消息("msg_2", "ses_1")])

    expect(数turn(宿主)).toBe(2)
  })
})

/**
 * 一「轮」＝ 一条 **user** 消息（缺陷修复 · 右栏空壳，2026-10-08 真栈上肉眼报出）。
 *
 * ## 症状与根因
 *
 * 真栈：一场 4 轮对话的右栏有 **8 格**，其中 4 格是**空壳**（无 `session-turn-message-container`）。
 * 根因是渲染那条 `<For>` 喂错了东西——它喂 `data.message[sessionID]` 的**每一条**
 * （user 与 assistant 各占一半），而 `SessionTurn` 只接受 user 的 id，根节点却无条件渲染。
 *
 * ## 这几条判据各自拦什么（变异能证的）
 *
 * - 把过滤摘掉（退回 `props.data.message[sessionID] ?? []`）⇒ ① 当场红成 **8 格 / 4 容器**、
 *   id 列成 `['usr_1','ast_1',…]`。⚠️ 这就是**修之前**那条代码，所以 ① 是缺陷探测器、不是回归网
 *   （`LEARNINGS #005-15`：这条要拿变异去证，不是靠「它看着会红」）。
 * - 把判据换成「只留最后一条」「按别的字段筛」这类**过度过滤** ⇒ ① 的 id 列短了，红。
 * - ② 是 ① 的**反向对照**（`LEARNINGS #005-07`）：只有 assistant 的会话必须 **0 格**。
 *   少了它，一个「恒留一格」的实现也能让 ① 过。
 *
 * ⚠️ `data-message` 这个锚点来自上游 `session-turn.tsx` 的容器元素，**不是我们加的**
 * （同 `#005-15`：注释别比断言强——这里的锚点是什么、不是什么是查过的）。
 */
describe("消息流：一「轮」＝ 一条 user 消息（缺陷修复 · 右栏空 turn）", () => {
  const 挂对话 = (data: SessionPanelData) =>
    挂(() =>
      原语环境(() => (
        <SessionPanel data={data} directory="/tmp/openhive-test" sessionID="ses_1" projection={空投影} />
      )),
    )

  test("① 4 轮对话（4 user ＋ 4 assistant）⇒ 恰好 4 格，渲的是那 4 条 user，assistant 一条都不在", () => {
    const 宿主 = 挂对话(对话(4))

    expect(数turn(宿主)).toBe(4)
    expect(数容器(宿主)).toBe(4)
    expect(渲出的消息(宿主)).toEqual(["usr_1", "usr_2", "usr_3", "usr_4"])
  })

  test("② 对照：只有 assistant 的会话 ⇒ 一格都没有（防「恒留一格」也能过 ①）", () => {
    const 只有答: SessionPanelData = {
      ...对话(2),
      message: { ses_1: [造消息("ast_1", "ses_1", "assistant"), 造消息("ast_2", "ses_1", "assistant")] },
    }

    expect(数turn(挂对话(只有答))).toBe(0)
    expect(数容器(挂对话(只有答))).toBe(0)
  })

  test("③ 对照：全是 user（3 条）⇒ 3 格全装内容——筛的是 assistant，不是「把一半滤掉」", () => {
    // 上面两条合起来只证明「assistant 不进」。这一条说的是**另一半没被误伤**：
    // 一场只有 user 的会话（`夹具数据` 那份形状）必须一条不少地渲出来。
    const 宿主 = 挂对话(夹具数据(3))

    expect(数turn(宿主)).toBe(3)
    expect(数容器(宿主)).toBe(3)
  })
})

/**
 * 自动跟随底部（缺陷修复 · 2026-10-08 真栈肉眼报的）。
 *
 * 现场：**发完问题之后，AI 的回答不在视野里**，要用鼠标往上滚才看得见。根因是右栏这个滚动容器
 * （`session-panel.tsx` 的 `[data-slot="session-turns"]`）是个**裸 `overflow-y-auto`**，全仓在它上面
 * 没有任何自动滚动逻辑；上游会话页则一直有（`createAutoScroll` ＋ 虚拟化时间线的 `scrollToEnd`）。
 *
 * ⚠️ 判据是几何的，而 happy-dom **不跑布局**——`scrollHeight` / `clientHeight` / `scrollTop` 恒为 0
 * （`LEARNINGS #005-07` / `#006-15`：几何约定在 happy-dom 里量不出）。本组因此分两层下判：
 *
 * - **①② 断结构**：钉住「让几何判据能成立的两个前提」，各配一条变异。
 * ① `overflow-anchor: none` 是 `createAutoScroll` **在 `scrollRef` 真接上之后**才写上去的
 *    （`create-auto-scroll.tsx` 的 `createEffect` 里 `if (!el) return`）⇒ 它非空就等于
 *    「`ref={自动跟随.scrollRef}` 真接上了」。摘掉那个 `ref` ⇒ 本文件其余用例一条都不红
 *    （`#005-11`：接线只写不测，红不了），**只有这一条红**。
 * ② turn **不是**滚动容器的直接子元素——中间隔着一层内容包裹层。这不是排版癖好：`contentRef`
 *    必须是那个**随内容长高**的元素（`createResizeObserver` 观测它），而容器是 `flex-1`
 *    （高度确定）⇒ 把 `contentRef` 挂到容器上，容器在内容增长时**根本不会 resize**，
 *    自动跟随静默失效（`#006-15` 的同型：上游 CSS 的前提被自己的容器违背）。这一条钉住那个前提。
 *
 * - **③④ 断几何**：给容器装一副**假几何**（`装假几何`），让原语在 happy-dom 里真跑起来。
 *   假的是它拿来算的**输入**，不是它算的**东西**——原语的数学、以及提交那条真实链路
 *   （`打字` → 回车 → controller → `view.submit.onSubmit`）一行都没假（`#006-08`：某条支路在某个
 *   测试层里没有观测面时，是**给它开一个观测面**，不是把断言换弱）。
 *
 * ⚠️ ③④ **仍然观测不到**的那一半：「内容长高 ⇒ 自动跟随」（`ResizeObserver` 那条支路）。
 * 2026-10-08 实测（happy-dom 20.12.0）：`typeof ResizeObserver` **是 `function`**，但 `observe()`
 * 之后、动过 DOM 与几何之后，回调次数**恒为 0**——`#006-08` 那句「happy-dom 里 ResizeObserver
 * 不存在」在 20.12.0 上已不准，**不触发**才是事实（`#003-04`：数字与机制落笔前先复现）。
 * ⇒ 这一半只能靠真栈 E2E（`packages/app/e2e/real-stack/ai-session-real.spec.ts`）。本组**不假装**
 * 覆盖了它。
 */
describe("自动跟随底部（缺陷修复 · 2026-10-08 真栈肉眼报的）", () => {
  const 挂对话 = (data: SessionPanelData) =>
    挂(() =>
      原语环境(() => (
        <SessionPanel data={data} directory="/tmp/openhive-test" sessionID="ses_1" projection={空投影} />
      )),
    )

  const 滚动容器 = (宿主: HTMLElement) => 宿主.querySelector<HTMLElement>('[data-slot="session-turns"]')
  const 内容包裹层 = (宿主: HTMLElement) =>
    宿主.querySelector<HTMLElement>('[data-slot="session-turns"] > [data-slot="session-turns-content"]')
  /** 断言断**布尔**：把 Solid 渲染过的节点当实得值，失败时 bun 的打印器会挂死（`LEARNINGS #005-01`）。 */
  const turn直接挂在容器下 = (宿主: HTMLElement) =>
    宿主.querySelector('[data-slot="session-turns"] > [data-component="session-turn"]') !== null

  test("① 滚动容器接上了自动滚动原语（`overflow-anchor: none` 是它自己写上去的）", () => {
    const 容器 = 滚动容器(挂对话(对话(1)))

    expect(容器?.style.overflowAnchor).toBe("none")
  })

  test("② turn 不直接挂在滚动容器下——中间那层才是 `contentRef`（容器自己不长高，观测它没用）", () => {
    const 宿主 = 挂对话(对话(2))

    expect(内容包裹层(宿主) !== null).toBe(true)
    expect(turn直接挂在容器下(宿主)).toBe(false)
  })

  // ── ③④ 的夹具 ──────────────────────────────────────────────────────────
  //
  // 与 `挂对话` 只差 `onSubmitPrompt`（③ 要真提交，④ 要「没接回调」那一支）。两处各自最小。
  const 挂提交对话 = (onSubmitPrompt?: (text: string) => Promise<boolean> | void) =>
    挂(() =>
      原语环境(() => (
        <SessionPanel
          data={夹具数据()}
          directory="/tmp/openhive-test"
          sessionID="ses_1"
          projection={空投影}
          onSubmitPrompt={onSubmitPrompt}
        />
      )),
    )

  const 取容器 = (宿主: HTMLElement) => {
    const 容器 = 滚动容器(宿主)
    if (!容器) throw new Error('没找到 `[data-slot="session-turns"]`（滚动容器换地方了？）')
    return 容器
  }

  /**
   * 给滚动容器装一副**假几何**。
   *
   * 只假三样读法：`scrollHeight` / `clientHeight` / `scrollTop`。`scrollTop` 的 setter **按真浏览器
   * 的语义夹进 `[0, 可滚量]`**——原语正是靠 `el.scrollTop = el.scrollHeight` 这个**越界赋值**来
   * 「到底」的（`create-auto-scroll.tsx` 的 `scrollToBottomNow`），不夹的话它的产物与真栈不同型。
   *
   * 开局在**最底**：真栈里首屏本来就在底部（下面那条前置的比较基准就是它）。
   */
  const 装假几何 = (容器: HTMLElement, 内容高: number, 视口高: number) => {
    const 可滚量 = Math.max(0, 内容高 - 视口高)
    let 位置 = 可滚量
    Object.defineProperty(容器, "scrollHeight", { get: () => 内容高, configurable: true })
    Object.defineProperty(容器, "clientHeight", { get: () => 视口高, configurable: true })
    Object.defineProperty(容器, "scrollTop", {
      get: () => 位置,
      set: (值: number) => {
        位置 = Math.min(Math.max(0, 值), 可滚量)
      },
      configurable: true,
    })
    return { 可滚量: () => 可滚量, 位置: () => 位置, 距底: () => 可滚量 - 位置 }
  }

  /**
   * 模拟「用户往上滚」：把容器挪到顶部，再派发一个**滚轮**事件。
   *
   * ⚠️ 为什么用滚轮，而**不**用真栈 E2E 那条写法（改 `scrollTop` 再派发 `scroll`）——
   * 原语里「用户往上滚」有**两个**入口：`handleWheel`（滚轮，直接 `stop()`）与 `handleScroll`
   * （滚动事件，要先过一道「这次滚动是不是我们自己干的」的判据）。那道判据是**时间窗 ＋ 数值**的：
   * `isAuto(el)` ＝「记账在 1500ms 内」**且** `|el.scrollTop - 记下的 maxScroll| < 2`。
   * 而本层里那个「记下的 maxScroll」**恰好是 0**：挂载时几何还是 0（happy-dom 不跑布局），原语
   * 内部那个 `on(options.working)` 副作用**却在 ref 接上之后才跑**（2026-10-08 探针实测：它跑了，
   * 且那一刻 `scrollHeight - clientHeight` ＝ 0 ⇒ 记账 0）。⇒ 我把 `scrollTop` 置 0 正落在它 ±2 里
   * ⇒ `handleScroll` 把这次置 0 认成「它自己刚滚到底」⇒ **当场把视野弹回底部**，`userScrolled`
   * 一直是假，用例会「绿得毫无观测力」。**这正是 `LEARNINGS #006-17` 记的那个坑**（上一轮在真栈
   * 上踩过一次，那次靠「等 2 秒让时间窗过期」绕开）。⇒ 本层改走**滚轮**：它是原语里专为「用户意图」
   * 设的入口，不经时间窗，确定、不需要 sleep。
   *
   * ⚠️ 真栈 E2E 那边用「改 `scrollTop` 再派发 `scroll`」是**对的**，别照抄这条改过去：那边几何是真的，
   * 记下的 maxScroll 与 0 必然不等（E2E ⑥ 的前置就在证明这一点）。
   */
  const 上滚 = (容器: HTMLElement) => {
    容器.scrollTop = 0
    容器.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }))
  }

  test("③ 用户滚上去之后再提交 ⇒ 视野回到底部（`resume()` 那一句的正解）", async () => {
    const 宿主 = 挂提交对话(async () => true)
    const 容器 = 取容器(宿主)
    const 尺 = 装假几何(容器, 1000, 400)

    上滚(容器)
    // 前置：**真的滚上去了**。少了这一条，「回到 0」在「本来就在底部」时也一样算过
    // （`#006-17`：先在**缺陷态**下证明那个破坏动作成立，否则这条用例对缺陷毫无观测力）。
    expect(尺.位置()).toBe(0)
    expect(尺.距底()).toBe(600)

    打字(宿主, "查一下这个账户的资金流向")
    回车(宿主)
    await 歇()

    expect(尺.距底()).toBe(0)
  })

  test("④ 对照：没接 `onSubmitPrompt` ⇒ 回车**不动视野**（触发条件是「交出去了」，与清空同一条判据）", async () => {
    const 宿主 = 挂提交对话()
    const 容器 = 取容器(宿主)
    const 尺 = 装假几何(容器, 1000, 400)

    上滚(容器)
    expect(尺.位置()).toBe(0)

    打字(宿主, "查一下这个账户的资金流向")
    回车(宿主)
    await 歇()

    // 一个字都没发出去 ⇒ 没有「新的」可看，把视野拽到底只是莫名其妙。
    // 这条同时是 ③ 的对照：它证明 ③ 里那次移动是**提交**带来的，不是「回车这个键」带来的。
    expect(尺.位置()).toBe(0)
    expect(输入框里的话(宿主)).toBe("查一下这个账户的资金流向")
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

  test("列表只列**顶层且未归档**的会话：子会话与已归档的不出现（筛法与 `session-actions.ts` 同一份）", () => {
    // 「列表里点得进去的那几场」与「删完该跳到哪一场」是**同一个判断**
    // （`session-actions.ts` 的 `可列出的会话`）。两处各写一遍，这两个集合就会分家
    // （`LEARNINGS #002-06`）——而右边那个集合今天**没有**筛（本组 ②③ 两条用例里
    // 两场都是顶层会话，分辨不出来）。
    //
    // 今天这两类真的点得进去：点进子会话，右栏就换成一条带 `parentID` 的会话的时间线；
    // 点进已归档的，等于把「归档＝冻结」绕过——那道门住在 `project-location.ts` 的路径前缀
    // 中间件上，管的是**请求**，而这里只是从一份已经取回来的清单里点一下（`#005-11` 同族）。
    const 混杂: SessionPanelData = {
      ...夹具数据(),
      session: [
        造会话("ses_1", "资金分析会话"),
        造会话("ses_子", "子会话", { parentID: "ses_1" }),
        造会话("ses_档", "已归档会话", { time: { created: 1, updated: 1, archived: 1 } }),
        造会话("ses_2", "话单分析会话"),
      ],
    }
    const 宿主 = 挂(() =>
      原语环境(() => (
        <SessionPanel data={混杂} directory="/tmp/openhive-test" sessionID="ses_1" projection={空投影} />
      )),
    )

    宿主.querySelector<HTMLElement>('[data-slot="session-toggle"]')!.click()

    // 顺序也要与表一致：这里断的是**筛选后**的全表，不是「筛掉的那几个不在」——
    // 后者在「顺序被换过」时照样绿（`LEARNINGS #003-03` ②：集合对了、形态不一定对）。
    expect(列出的会话(宿主)).toEqual(["资金分析会话", "话单分析会话"])
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

describe("点指令卡 ＝ 填入一句话（T009 / FR-007；T004 📥 那一笔的产源）", () => {
  // 这一组钉的是 **T004 📥 交来的那一笔**：`InstructionCardRow` 的 `activePrompt` 与 `onPick`
  // 两个接缝在 T004/T005 就已经在了（组件层的断言在 `common-cards.test.tsx` / `context-cards.test.tsx`），
  // 缺的**不是接缝本身**，是**右栏把不把它接上**——今天两个 prop 生产里都是空的，
  // 即 §4.7.1 的选中态**在生产里看不见**（`state.md` 缺口表那一行）。
  //
  // 所以本组的判据一律取**右栏这一层**的实得值：① 编辑器 DOM 里的字（不是 store、不是 prop）；
  // ② 卡面的 `className` 串（happy-dom 没有 CSS 引擎 ⇒ 量不出颜色，只能钉 class，`LEARNINGS #005-07`）。

  const 造清单 = (capabilities: SkillCapability[]): CapabilityManifest => ({
    module: GENERIC_MODULE,
    capabilities,
  })

  const 两张卡 = {
    skill: "analysis-common",
    name: "通用分析",
    description: "通用",
    group: "业务研判",
    cards: [
      { label: "资金穿透", prompt: "帮我做资金穿透", layer: "common" },
      { label: "关系图谱", prompt: "帮我画关系图谱", layer: "common" },
    ],
  } satisfies SkillCapability

  const 摆好 = () =>
    挂(() =>
      原语环境(() => (
        <SessionPanel
          data={夹具数据()}
          directory="/tmp/openhive-test"
          sessionID="ses_1"
          projection={projectCapabilities([造清单([两张卡])], undefined)}
        />
      )),
    )

  /** §4.7.1 的选中态底色。任意值写法——`--v2-background-bg-accent-soft` **没有** Tailwind 孪生（§4.7.0）。 */
  const 浅金 = "bg-[var(--v2-background-bg-accent-soft)]"

  /** 每张卡亮不亮，按 DOM 顺序。 */
  const 亮着的 = (宿主: HTMLElement) => 卡们(宿主).map((卡) => 卡.className.includes(浅金))

  /**
   * 点**第二张**卡。
   *
   * ⚠️ 不写成 `卡们(宿主)[1].click()` 三遍：那三遍里每一遍都要在「恒点第一张」的实现上过得去
   * ——而这条正是本组第一句断言要打的东西。收成一个点了名说「第二张」的动作，读的时候
   * 就不必再逐句确认「这处点的是第几张」（`LEARNINGS #005-12`：一条断言要能与「只做了这一个」相区别）。
   */
  const 点第二张卡 = (宿主: HTMLElement) => 卡们(宿主)[1].click()

  test("点卡 ⇒ 输入框里出现**那张卡**的句子（点第二张，不是第一张、也不是空）", () => {
    // 点**第二张**是故意的：只点第一张时，「填了第一张」与「填了任意一张 / 填了第一张写死」
    // 在实得值上分不开（`LEARNINGS #005-12`：一条断言要能把「整组都做了」与「只做了这一个」分开）。
    const 宿主 = 摆好()

    expect(输入框里的话(宿主)).toBe("")

    点第二张卡(宿主)

    expect(输入框里的话(宿主)).toBe("帮我画关系图谱")
  })

  test("点卡 ⇒ **那张**亮浅金、其余不亮（§4.7.1 选中态；负向对照）", () => {
    // 初始态先断一次「一张都不亮」：少了这半条，一个「恒全亮」的实现也能过
    // （`LEARNINGS #005-07` ③：只写正向那条时，把整行刷成浅金也算过）。
    const 宿主 = 摆好()

    expect(亮着的(宿主)).toEqual([false, false])

    点第二张卡(宿主)

    expect(亮着的(宿主)).toEqual([false, true])
  })

  test("点卡是**替换**、不是追加（先打过字 ⇒ 只剩卡片的句子，先打的半句不在了）", () => {
    // 这一条盯的是**「写入语义」这一轴**，是 T009 审查（R1）补的：前面三条都从**空输入框**起手，
    // 而空框下「替换」与「追加」的实得值**逐字相同** ⇒ 三条合起来也分辨不出这两种实现。
    // 实测（2026-10-07 审查）：把 `onPick` 换成在游标处 `addText` 的写法 ⇒ 旧三条 **全绿**
    // （`LEARNINGS #005-12`：同一轴上两种实现要各有一条用例，别指望一组合起来就认得出）。
    //
    // 判据必须是**恰好相等**（`toBe`）——用 `toContain` 的话「先打的半句＋卡片句子」照样通过，
    // 那就把这条又变回一条认不出追加的断言了。
    //
    // 顺序按 `LEARNINGS #004-14`：先钉**被测属性**（输入框里到底剩下什么，用户看得见的那份），
    // 再钉**伴随信号**（选中态）——后面半条是反证：选中态的判据是「输入框那句话 == 卡片句子」
    // （§4.7.1），所以它能一并证明「替换」不是只换了个 DOM 样子、store 里也只留了卡片那一句。
    //
    // ⚠️ **一条已知的脆性依赖**（T009 审查第二轮 F3 实测，**不修**、只记）：本用例读的是**编辑器 DOM**，
    // 而它要靠上游 `prompt-input/index.tsx` 那个 `localInput` 守卫（**一次性**：DOM input 置位、
    // effect 命中后即清）在 `打字` 这一步**被消费掉**——否则点卡的程序化改文不会重渲染 DOM。
    // 两个探针各测了一遍：**把守卫整段删掉 ⇒ 照样 22 pass**（说明绿不是守卫给的，是「store 变 ⇒
    // 重渲染」这条真链）；**把守卫改成不复位 ⇒ 恰好本用例红**（`Received: "先打的半句"`）。
    // ⇒ 判据一句话：它**脆**（上游改守卫语义会误红）但**不瞎**（不会掩盖被测语义——守卫滞留时
    // DOM 停在 `"先打的半句"`，仍 ≠ 卡片句子，照样红）。上游若真动了那个守卫，先怀疑这条的**测量**，
    // 别去改 `onPick`（`LEARNINGS #003-01`：先怀疑测量，再怀疑被测物）。
    const 宿主 = 摆好()

    打字(宿主, "先打的半句")

    点第二张卡(宿主)

    expect(输入框里的话(宿主)).toBe("帮我画关系图谱")
    expect(亮着的(宿主)).toEqual([false, true])
  })

  test("改输入框 ⇒ 选中态灭（产源是输入框的**实时那句话**，不是点击时记下的一份）", () => {
    // 这一条是**变异探测器**：若把 `activePrompt` 实现成「点击时 set 一个信号」，前两条照样绿、
    // 只有这条红。它同时是 §4.7.1 那句 ⚠️（「若哪天判定这个态不稳定（输入框一改就掉）…」）
    // 的**落点**——本实现就是「一改就掉」，因为选中态的判据按 §4.7.1 的定义是
    // 「输入框里那句话来自这张卡」，句子改了就不再是那张卡的句子。
    // ⇒ 这条把「掉」写成**期望**（设计侧若要改成「填过就一直亮」，红的就是它）。
    const 宿主 = 摆好()

    点第二张卡(宿主)
    expect(输入框里的话(宿主)).toBe("帮我画关系图谱")

    打字(宿主, "帮我画关系图谱，按近一个月")

    expect(亮着的(宿主)).toEqual([false, false])
  })
})

/**
 * 提交一句话（T010 / FR-007 / US4 场景 1）——**右栏这一半**。
 *
 * ⚠️ 这一组测不到「AI 真的跑起来了」：`bun test` 里起不了 opencode 服务器（T008 已实测），
 * 那一半在 `packages/opencode/test/server/openhive-prompt-minimal.test.ts`（假模型回真 SSE ＋ 真库）。
 * 本组钉的是**收官那一下**：交出去的正文取自输入框，且**交出去之后**输入框才清空。
 *
 * 宿主与 Hero 组那份只差投影（本组不关心 `/` 面板，用 `空投影`）——两处各自最小，不抽公共层。
 */
describe("提交一句话（T010 / FR-007 / US4 场景 1）", () => {
  const 摆好 = (onSubmitPrompt?: (text: string) => Promise<boolean> | void) =>
    挂(() =>
      原语环境(() => (
        <SessionPanel
          data={夹具数据()}
          directory="/tmp/openhive-test"
          sessionID="ses_1"
          projection={空投影}
          onSubmitPrompt={onSubmitPrompt}
        />
      )),
    )

  test("回车 ⇒ 交出去的是**输入框里那句话**，交出去之后输入框才清空", async () => {
    const 收到: string[] = []
    const 宿主 = 摆好(async (text) => {
      收到.push(text)
      return true
    })

    打字(宿主, "查一下这个账户的资金流向")
    expect(输入框里的话(宿主)).toBe("查一下这个账户的资金流向")

    回车(宿主)
    await 歇()

    // 先钉「交出去的是哪句」：它是下面那条清空的**前置条件**——没交出去就清空才是错的
    // （`LEARNINGS #004-14`：一条用例里，书写顺序决定你拿到哪条证据）。
    expect(收到).toEqual(["查一下这个账户的资金流向"])
    expect(输入框里的话(宿主)).toBe("")
  })

  test("提交回话 `false`（没发出去）⇒ 正文**留在**输入框里", async () => {
    const 宿主 = 摆好(async () => false)

    打字(宿主, "查一下这个账户的资金流向")
    回车(宿主)
    await 歇()

    expect(输入框里的话(宿主)).toBe("查一下这个账户的资金流向")
  })

  test("对照：没接 `onSubmitPrompt` ⇒ 回车一个字都不动（清空的含义是「已经交出去了」）", async () => {
    const 宿主 = 摆好()

    打字(宿主, "查一下这个账户的资金流向")
    回车(宿主)
    await 歇()

    expect(输入框里的话(宿主)).toBe("查一下这个账户的资金流向")
  })

  test("回话**迟迟不来**，用户先打了新的一句 ⇒ 老正文不回填（不吃掉新输入）", async () => {
    let 回话!: (值: boolean) => void
    const 宿主 = 摆好(
      () =>
        new Promise<boolean>((resolve) => {
          回话 = resolve
        }),
    )

    打字(宿主, "查一下这个账户的资金流向")
    回车(宿主)
    await 歇()
    // 清空是**当时**就发生的（不等回话）——这一条同时钉住「清空不是等回话才做」。
    expect(输入框里的话(宿主)).toBe("")

    打字(宿主, "再查一下这个人的通话记录")
    回话(false)
    await 歇()

    // 老那句失败回来了，但用户已经在写新的 ⇒ 回填会把新输入**当场吃掉**。
    expect(输入框里的话(宿主)).toBe("再查一下这个人的通话记录")
  })
})

/**
 * 删除会话（T015 / FR-010 / US4 场景 2）。
 *
 * ## 为什么要二次确认（2026-10-07 用户裁定：**就地**二次确认）
 *
 * 删会话是**不可逆**的（上游文案：「Delete a session and permanently remove all associated data,
 * including messages and history」）。执行层的 `permission.bash` 那道闸门**管不到**它——那道门
 * 筛的是 shell 命令的 pattern，而这条走的是 `api.session.remove` 这条 HTTP 出口（F4 的裁定：
 * 闸门住在执行层、按 pattern 匹配）⇒ **要拦只能在前端拦**，形态由用户定为「就地」：不弹窗、
 * 不新增全局浮层，钮自己改成「确认删除？」再点一下才真删。
 *
 * ## 确认态为什么挂在**会话 id** 上、而不是一个 `boolean`
 *
 * 这是本组最重要的一条：用户点过删除（钮已变成「确认删除？」）之后，完全可能去点列表里**另一场**
 * 会话——此时如果确认态只是一个 `boolean`，钮上那句「确认删除？」**还在**，而下一次点击删掉的
 * 是**新那场**——用户从没想过要删的那场。`LEARNINGS #004-02` 的同款：两个投影（钮上的文案 与
 * 它真会删的那一场）必须**按构造**一致，不能靠注释约定同步。把「待删的是哪一场」存成 id，
 * 判据写 `待删() === props.sessionID`，这条一致性就是结构性的：④ 那条用例钉的就是它。
 */
describe("删除会话（T015 / FR-010 / US4 场景 2·二次确认）", () => {
  const 两场 = (): SessionPanelData => ({
    ...夹具数据(),
    session: [造会话("ses_1", "资金分析会话"), 造会话("ses_2", "话单分析会话")],
    message: { ses_1: [造消息("msg_1", "ses_1")], ses_2: [造消息("msg_9", "ses_2")] },
  })

  /** 摆一棵树。`sessionID` 传访问器时是**活**的（④ 那条要切换它）。 */
  const 摆好 = (sessionID: string | (() => string) = "ses_1") => {
    const 事件: string[] = []
    const 宿主 = 挂(() =>
      原语环境(() => (
        <SessionPanel
          data={两场()}
          directory="/tmp/openhive-test"
          sessionID={typeof sessionID === "function" ? sessionID() : sessionID}
          projection={空投影}
          onDeleteSession={(id) => 事件.push(id)}
        />
      )),
    )
    const 删除钮 = () => {
      const 钮 = 宿主.querySelector<HTMLElement>('[data-slot="session-delete"]')
      if (!钮) throw new Error('没找到删除钮（`[data-slot="session-delete"]`）')
      return 钮
    }
    return { 宿主, 事件, 删除钮, 点删除: () => 删除钮().click() }
  }

  test("① 第一下**不删**：钮自己改成「确认删除？」（`onDeleteSession` 一次都没被调）", () => {
    const { 事件, 删除钮, 点删除 } = 摆好()

    expect(删除钮().textContent).toBe("删除")

    点删除()

    // 被测属性（`LEARNINGS #004-14`：被测的那条写在伴随信号前）——**一个字节的数据都没动**。
    // 没有这条，「点了就删」的实现照样能过 ②（它只是少一次点击）。
    expect(事件).toEqual([])
    expect(删除钮().textContent).toBe("确认删除？")
  })

  test("② 第二下才删：收到**当前**会话 id，且钮回到「删除」（不给下一场留一个已确认的钮）", () => {
    const { 事件, 删除钮, 点删除 } = 摆好()

    点删除()
    点删除()

    expect(事件).toEqual(["ses_1"])
    expect(删除钮().textContent).toBe("删除")
  })

  test("③ 问的是**当前那一场**：当前是 ses_2 ⇒ 收到 ses_2（不是列表第一条 ses_1）", () => {
    // 夹具里两场**不同名不同 id**，所以「删列表第一条」与「删当前那场」在实得值上分得开。
    const { 事件, 点删除 } = 摆好("ses_2")

    点删除()
    点删除()

    expect(事件).toEqual(["ses_2"])
  })

  test("④ 确认态挂在**哪一场**上：确认到一半切换会话 ⇒ 钮当场回到「删除」，且不会顺手删掉新那场", () => {
    // 这一条是本组的**数据丢失守卫**（见上面「为什么挂在会话 id 上」）。写成 `boolean` 的实现
    // 在这一条上红：切过去之后钮**仍写着「确认删除？」**，再点一下就删掉了 ses_2。
    const [id, setId] = createSignal("ses_1")
    const { 事件, 删除钮, 点删除 } = 摆好(id)

    点删除()
    expect(删除钮().textContent).toBe("确认删除？")

    setId("ses_2")

    expect(删除钮().textContent).toBe("删除")
    点删除()
    // 切过来之后这一下只是**重新问一次**，不是「把上一条确认带过来」。
    expect(事件).toEqual([])
  })

  test("⑤ 视觉：确认态取 `danger` 前景色，平时不取（负向对照；happy-dom 量不出色 ⇒ 钉 `className`）", () => {
    // `text-v2-state-fg-danger` 是仓里现成的语义 token（`auth/change-password.tsx` 的报错行、
    // `dialog-connect-provider.tsx` 同款）——**不是**随手挑的颜色。
    // 只写正向那条时，把「删除」也刷成红色照样过（`LEARNINGS #005-07` ③）。
    const { 删除钮, 点删除 } = 摆好()

    expect(删除钮().className).not.toContain("text-v2-state-fg-danger")

    点删除()

    expect(删除钮().className).toContain("text-v2-state-fg-danger")
  })
})

/**
 * 导出会话（T016 / FR-010 · [出参：右栏能把当前会话导出成 JSON 落盘]）。
 *
 * ## 本组件这一侧只管什么
 *
 * 上游三件套（取数 / 起名 / 落盘）与「有判断的那一半」在 `session-actions.ts`（`导出会话`，
 * 那边 4 条单测）。本组件这一侧只有**一件事**要钉：**入口坐在哪、点下去交出哪一场**。
 *
 * ## 为什么入口与「删除」同居会话行（不许发明的第一条）
 *
 * 判据与 T015 给「删除」的那条**同**：它是**对当前会话**的动作（不是「切到哪一场」），
 * ⇒ 放会话行。列表里那些行是「切到哪一场」，动作自然不挂在那儿——② 就是这条的判据。
 *
 * ## 与「导出」有关的另外两条边界（写在这里免得下一个人当成漏做）
 *
 * - **失败回话不在这里**：本组件接的是 `void`（和 `onSelectSession` / `onNewSession` 一样，
 *   不回话），生产侧 `.catch(报错)` —— 全右栏只有那一处 `报错`（`#002-06`）。
 * - **不配在途守卫**：导出是可重复的读操作（连点两下最多下载两个文件），不是 T015 那两根
 *   「不可重入的写」；`在途守卫` 的注释里点名它守的是**新建 / 删除两根线**。
 */
describe("导出会话（T016 / FR-010）", () => {
  const 两场 = (): SessionPanelData => ({
    ...夹具数据(),
    session: [造会话("ses_1", "资金分析会话"), 造会话("ses_2", "话单分析会话")],
    message: { ses_1: [造消息("msg_1", "ses_1")], ses_2: [造消息("msg_9", "ses_2")] },
  })

  const 摆好 = (sessionID = "ses_1") => {
    const 事件: string[] = []
    const 宿主 = 挂(() =>
      原语环境(() => (
        <SessionPanel
          data={两场()}
          directory="/tmp/openhive-test"
          sessionID={sessionID}
          projection={空投影}
          onExportSession={(id) => 事件.push(id)}
        />
      )),
    )
    const 导出钮 = () => {
      const 钮 = 宿主.querySelector<HTMLElement>('[data-slot="session-export"]')
      if (!钮) throw new Error('没找到导出钮（`[data-slot="session-export"]`）')
      return 钮
    }
    return { 宿主, 事件, 导出钮, 点导出: () => 导出钮().click() }
  }

  test("① 点了才交出去，交的是**当前**那一场（不是列表第一条）", () => {
    const { 事件, 点导出 } = 摆好("ses_2")

    // 被测属性：点之前**一次都没调**。少了这一半，「挂载即导出」的实现也能过下面那条。
    expect(事件).toEqual([])

    点导出()

    // 夹具里两场不同名不同 id ⇒「导出列表第一条」与「导出当前那场」实得值分得开。
    expect(事件).toEqual(["ses_2"])
  })

  test("② 入口坐在**会话行**上：展开列表之后，导出钮仍然只有一颗", () => {
    // 它是**对当前会话**的动作，所以与「删除」同居会话行；列表里那些行只做「切到哪一场」。
    // 变异：把导出钮渲染进列表的每一行 ⇒ 下面是红的（实得 3，期望 1）。
    const { 宿主 } = 摆好()

    宿主.querySelector<HTMLElement>('[data-slot="session-toggle"]')!.click()

    const 数 = (名: string) => 宿主.querySelectorAll(`[data-slot="${名}"]`).length
    // 对照：列表**确实**展开了（两场都在）——没有这一条，「压根没展开」也让上面那个 1 成立。
    expect(数("session-option")).toBe(2)
    expect(数("session-export")).toBe(1)
  })
})

/**
 * hover 面：**每一处各钉一条**（Step 5 · F-01）。
 *
 * ## 补的是什么
 *
 * `hover:bg-v2-overlay-simple-overlay-hover` 在本 feature 的源码里落在 **8 处**
 * （`instruction-cards.tsx` 2 处 ＋ `session-panel.tsx` **6** 处），而 Step 5 清点时**只有 1 处**
 * 有断言守着（`common-cards.test.tsx` 的溢出钮那条）。另 7 处**改回旧 token 也全套绿**
 * ——`LEARNINGS #005-07` 的老形状：一个视觉约定落 N 处，只钉一处等于没钉。
 * 本文件这 6 处 ＋ `common-cards.test.tsx` 那 2 处（卡面与溢出钮）＝ 8 处齐。
 *
 * ⚠️ 数字是 **2026-10-08 T016 落地时**重数的（`grep -rn 'hover:bg-v2-overlay-simple-overlay-hover'
 * packages/app/src --include=*.tsx` 去掉 `*.test.*`）：本组的第 ⑥ 条就是 T016 新加的那颗导出钮
 * ——**加了出口就要回来补一条**，别让「7 处齐」这句话在新出口上悄悄失效（`LEARNINGS #005-11`）。
 *
 * ## 为什么是 6 条、不是 1 条遍历
 *
 * `LEARNINGS #005-12`：约定落在 N 个动作上就写 N 条用例。合成一条「把这 6 个槽过一遍」时，
 * 摘掉其中一处的 token 只会让**那一条**红，而红的集合读不出「是哪个落点漏了」——这条纪律要的
 * 正是那个信息。6 条各查自己的槽 ⇒ **摘哪处、红哪条**。
 *
 * ## 判据的边界（`LEARNINGS #002-02` / `#005-15`：注解不许比断言强）
 *
 * - 只断 `className` **串**：happy-dom 不跑布局、不解析 CSS（`#005-07`）⇒ **hover 真的会不会
 *   变色量不出来**，这里证的是「那串类名还在」。它因此是**弱判据**（token 改名就失效）——
 *   每处注释里写清它守的是哪一条设计约定，免得下一个人当成随手挑的颜色改掉。
 * - 每条的**对照**是「那一处的**容器**不带 hover」：判的是「hover 落在**可点的那个叶子**上，
 *   不落在它所在的容器上」。⚠️ 它**不**防「容器与叶子同时带上」——那种改法两条都还是绿的。
 * - ⚠️ 这 5 条有一处**不是**先红后绿（实现早就在，缺的是断言）⇒ 牙靠**变异**证：
 *   逐个摘掉某一处的 token，应当**恰红那一条**（账记在 `state.md` 的 Step 5 一节）。
 */
describe("hover 面：每一处各钉一条（Step 5 · F-01）", () => {
  const HOVER = "hover:bg-v2-overlay-simple-overlay-hover"

  /** 摆一棵右栏（默认一场会话）。5 条各自摆自己的，互不借状态 ⇒ 变异时归属干净。 */
  const 摆右栏 = () =>
    挂(() =>
      原语环境(() => (
        <SessionPanel data={夹具数据()} directory="/tmp/openhive-test" sessionID="ses_1" projection={空投影} />
      )),
    )

  /** 某个槽**自己**的 `className` 串（不是它的子孙的）。 */
  const 串 = (宿主: HTMLElement, 名: string) => {
    const 元素 = 宿主.querySelector<HTMLElement>(`[data-slot="${名}"]`)
    if (!元素) throw new Error(`没找到 [data-slot="${名}"]`)
    return 元素.className
  }

  test("① `session-toggle`：会话名那颗钮（名字与 ▾ 是**同一颗钮**，不是一个标签）", () => {
    const 宿主 = 摆右栏()

    expect(串(宿主, "session-toggle")).toContain(HOVER)
    // 对照：`session-row` 是整行**容器**（底色 layer-01），hover 不在它身上。
    expect(串(宿主, "session-row")).not.toContain(HOVER)
  })

  test("② `session-new`：`＋ 新会话`（与同栏 `session-delete` 取同一档 token）", () => {
    const 宿主 = 摆右栏()

    expect(串(宿主, "session-new")).toContain(HOVER)
    expect(串(宿主, "session-row")).not.toContain(HOVER)
  })

  test("③ `session-delete`：确认态换的是**前景色**，hover 底色两态都在", () => {
    const 宿主 = 摆右栏()

    // 第一态（「删除」）。
    expect(串(宿主, "session-delete")).toContain(HOVER)
    // ⚠️ 第二态（「确认删除？」）也要有——`classList` 里那两项只换**前景色**，
    // 若改成「确认态顺手把 hover 也摘了」，下面是红的那一条。
    宿主.querySelector<HTMLElement>('[data-slot="session-delete"]')!.click()
    expect(串(宿主, "session-delete")).toContain(HOVER)
    expect(串(宿主, "session-row")).not.toContain(HOVER)
  })

  test("④ `session-option`：列表里能切过去的那一场（展开之后才在 DOM 里）", () => {
    const 宿主 = 摆右栏()

    // 列表用 `Show`（收起时整段不在 DOM 里），所以先展开——**不是**为了让选择器找得到而放宽判据。
    宿主.querySelector<HTMLElement>('[data-slot="session-toggle"]')!.click()

    expect(串(宿主, "session-option")).toContain(HOVER)
    // 对照：`session-list` 是浮层**容器**（白底），hover 不在它身上。
    expect(串(宿主, "session-list")).not.toContain(HOVER)
  })

  test("⑤ `drawer-entry`：`▸ 更多 skill`（输入框旁边那颗）", () => {
    const 宿主 = 摆右栏()

    expect(串(宿主, "drawer-entry")).toContain(HOVER)
    // 对照：`session-tools` 是那一行**容器**，hover 不在它身上。
    expect(串(宿主, "session-tools")).not.toContain(HOVER)
  })

  test("⑥ `session-export`：`导出`（T016 新加的那颗，与同栏 `session-new` / `session-delete` 同档 token）", () => {
    const 宿主 = 摆右栏()

    expect(串(宿主, "session-export")).toContain(HOVER)
    // 对照同上：`session-row` 是整行**容器**，hover 不在它身上。
    expect(串(宿主, "session-row")).not.toContain(HOVER)
  })
})
