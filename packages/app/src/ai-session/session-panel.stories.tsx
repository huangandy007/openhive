// @ts-nocheck
import type { Message, Part, Session } from "@opencode-ai/sdk/v2"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import type { JSX } from "solid-js"
import { projectCapabilities } from "./projection"
import { SessionPanel, type SessionPanelData } from "./session-panel"

/**
 * 右栏「最小可用会话」（006 T008 / FR-010 / DESIGN §4.7.5）——**整个右栏的生产组装**。
 *
 * ## 为什么要给它写 story
 *
 * 理由与 `instruction-cards.stories.tsx` 逐字相同（让 `@storybook/addon-a11y` 照得到 ⇒
 * 这一层才有 a11y 审计）。但这一条**尤其**该有：它是右栏**最大的**一块，内部挂了
 * `PromptInputV2`（输入框）、`SessionTurn`（消息流）、卡行与抽屉——**卡行单独有 story**
 * 只覆盖了「卡本身」，覆盖不了「卡长在会话里、下面是消息流、右上是会话列表」这层组合。
 *
 * ## 夹具从哪来（别从零搭）
 *
 * 逐字照 `session-panel.test.tsx` 的 harness（`#004-12`：新出口的第一动作是抄同族 harness）：
 * ① provider 清单**除 `DataProvider` 之外**全给（`SessionPanel` **自挂** `DataProvider`，
 * 那是它的被测属性、不能被夹具预先满足）；② `useI18n()` **不在**清单里——`ui/context/i18n`
 * 的 `createContext` 带 `fallback`（`locale: () => "en"`），不挂也不抛；
 * ③ 数据形状照 `({…最小字段}) as Session` 的仓库惯例（sdk 类型字段多，逐字段填是噪音）。
 *
 * ⚠️ 这条 provider 清单是**跑出来的**，不是猜的（先只挂 `FileComponentProvider`，红出
 * `useDialog`，补上 `DialogProvider` 才过）——`#004-13`：能一次解释掉全部现象的说法才是根因。
 */

/** `FileComponentProvider` 要一个 `ValidComponent`；夹具塞个空组件即可（本用例不渲染文件）。 */
const 假文件 = () => <div data-component="fake-file" />

/** 会话原语链上要的那几个 provider（`DataProvider` 除外，见上）。 */
const 原语环境 = (内容: () => JSX.Element) => (
  <DialogProvider>
    <FileComponentProvider component={假文件}>{内容()}</FileComponentProvider>
  </DialogProvider>
)

// ⚠️ 这两条 `oxlint-disable-next-line` 的理由**逐字同 `session-panel.test.tsx`**（那里写得更全）：
// 夹具只需要几个字段，sdk 类型字段多、逐字段填是给夹具加噪音，且**上游给 `Session` 加一个必填
// 字段就红**——红的还是我们这条夹具。`lint:openhive` 的判据是「**本次新增/改动文件 0 命中**」，
// 所以就地关掉、理由写在这儿（`#003-04`：位置类的事落笔前先量——disable 要贴着**断言那一行**）。
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具，不是产品码；理由见上。
const 造会话 = (id: string, title: string) => ({ id, title, time: { created: 1, updated: 1 } }) as Session

const 造消息 = (id: string, sessionID: string, role: "user" | "assistant" = "user") =>
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具，不是产品码；理由见上。
  ({
    id,
    sessionID,
    role,
    time: { created: 1 },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt" },
  }) as Message

const 造文本块 = (id: string, messageID: string, 文本: string, 角色 = "user") =>
  ({ id, messageID, sessionID: "ses_1", type: "text", text: 文本, role: 角色 }) as Part

/**
 * 最小可渲染的会话数据。`轮数` 控消息条数——**多于一条**才照得到 `SessionTurn` 的列表语义
 * （只有一条时「消息流」与「一条消息」在 axe 眼里分不开）。
 */
const 夹具数据 = (轮数 = 1): SessionPanelData => ({
  session: [造会话("ses_1", "资金分析会话")],
  session_status: {},
  session_diff: {},
  message: {
    ses_1: Array.from({ length: 轮数 }, (_, i) => 造消息(`msg_${i + 1}`, "ses_1", i % 2 === 0 ? "user" : "assistant")),
  },
  part: Object.fromEntries(
    Array.from({ length: 轮数 }, (_, i) => [
      `msg_${i + 1}`,
      [造文本块(`prt_${i + 1}`, `msg_${i + 1}`, i % 2 === 0 ? "帮我看看这个账户的流水" : "已按账户聚合，共 3 笔可疑往来。")],
    ]),
  ),
})

/** 一份**四层都空**的投影（`projection` 是必填——可选就等于「忘传也没人红」，而忘传的表现是「右栏空着」，与「这个模块还没有 skill」在界面上分不开）。 */
const 空投影 = projectCapabilities([], undefined)

export default {
  title: "App/OpenHive/AiSession/SessionPanel",
  id: "app-openhive-ai-session-session-panel",
}

/**
 * 空投影 ＋ 一轮对话：**民警点开右栏时的常态**。输入框、消息流、会话列表都在，
 * 但**没有指令卡**（006 的 `MANIFESTS` 的 `cards` 全为空 ⇒ 生产里就是这一态）。
 * 这是最该进审计面的一格：它才是生产里真正会渲染出来的那个组合。
 */
export const Default = {
  render: () => (
    <div style={{ width: "420px" }}>
      {原语环境(() => (
        <SessionPanel data={夹具数据(1)} directory="/tmp/openhive-storybook" sessionID="ses_1" projection={空投影} />
      ))}
    </div>
  ),
}

/**
 * 多轮：消息流**多于一条**。`SessionTurn` 的列表语义（分隔、滚动区）只在多轮下才存在
 * ——只画一条就等于放弃这一半审计面（同 `skill-drawer.stories.tsx` 的 `LongList` 的理由）。
 */
export const MultiTurn = {
  render: () => (
    <div style={{ width: "420px" }}>
      {原语环境(() => (
        <SessionPanel data={夹具数据(6)} directory="/tmp/openhive-storybook" sessionID="ses_1" projection={空投影} />
      ))}
    </div>
  ),
}
