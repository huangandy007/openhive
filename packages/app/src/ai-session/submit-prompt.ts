import type { Session } from "@opencode-ai/sdk/v2"
import { sendFollowupDraft, type FollowupDraft } from "@/components/prompt-input/submit"
import type { Prompt } from "@/context/prompt"
import type { ServerSync } from "@/context/server-sync"
import type { DirectorySDK } from "@/context/sdk"
import type { DirectorySync } from "@/context/sync"

/**
 * 右栏「提交一句话」——T010 / FR-007 / US4 场景 1 的**接收方**。
 *
 * `session-panel.tsx` 的 `onSubmitPrompt?: (text: string) => Promise<boolean> | void` 只把正文交
 * 出来，注释写着「**真正发出去的是调用方**」。本文件就是那个调用方：把正文交给**既有会话执行链**
 * （`components/prompt-input/submit.ts` 的 `sendFollowupDraft`）。
 *
 * ⚠️ 那个 `Promise<boolean>` 的**回话语义正好同形**，所以这里是 `return` 原样透出去、不翻译：
 * 上游 `false` = 「**没发出去**」（`before` 钩子拦下、或乐观插入失败回滚那两支），
 * 而右栏 `false` 的语义正是「没发出去 ⇒ 正文留在输入框里」。
 *
 * ## 为什么是复用，不是重写（2026-10-07 裁定 U5）
 *
 * 那条链里有一堆**只在真跑时才会疼**的东西：`Identifier.ascending("message")` 的消息号、
 * `buildRequestParts` 把正文 / 文件 / agent 提及拆成 part、
 * **v1 / v2 双协议的字段分流**、乐观插入与它的失败回滚、`/` 命令分支。自己写一遍等于把这些
 * 各踩一遍，而且是**同一件事的第二处写法**（`LEARNINGS #002-06`）。
 * 代价只有一处：`FollowupDraft` 把 `agent` / `model` 声明成**必填**（见下面的让步注释）。
 *
 * ## 依赖全部由参数注入，本模块**不碰任何 context**
 *
 * 这是它能被 `bun test` 测到的全部原因：`useSDK()` / `useSync()` / `useServerSync()` 都要
 * provider 在场，而右栏挂在 `pages/directory-layout.tsx` 的 `LocalProvider` **外侧**
 * （实测：右栏取不到 `useLocal()`）。取 context 的那一步留在 `ai-session-slot.tsx`
 * ——那里是响应式 owner，也是**必须**在 owner 里取 `DirectorySDK` / `DirectorySync` 的地方
 * （`utils/refcount.ts` 的 `createRefCountMap` 释放走 `onCleanup`）。
 *
 * ⚠️ **本模块证不了「AI 真的跑了」**：它止步于 `api.session.prompt` 那一下。真的执行链由
 * `packages/opencode/test/server/openhive-prompt-minimal.test.ts` 用假模型回真 SSE ＋ 真库跑。
 * 两半都在，才是「AI 执行 ＋ 过程展示」这条出参（`LEARNINGS #005-12` 的同一精神：
 * 落点在哪，判据就写到哪）。
 */

/** 右栏提交所需的全部外部输入。 */
export interface RightPaneSubmitInput {
  /** 输入框里那一行正文（原样，不做任何改写）。 */
  text: string
  sessionID: string
  /** 会话所在目录 —— 既是 `api` 的作用域，也是乐观插入要记的那个 `directory`。 */
  sessionDirectory: string
  /**
   * 这场会话（`serverSync` 里那一条）。**用的是它的 `agent` / `model`**：
   * 右栏没有选择器，而这两个字段的含义正是「上次用的」，与服务端缺省时的回退同源。
   * 会话还没记过（新建即提交）时是 `undefined`，此时**不传**——见下面那段让步注释。
   */
  session: Session | undefined
  api: DirectorySDK["api"]["session"]
  serverSync: ServerSync
  sync: DirectorySync
}

/** 一句话 → `Prompt`（`context/prompt-state.ts` 的 `DEFAULT_PROMPT` 同形）。 */
const 一句话 = (text: string): Prompt => [{ type: "text", content: text, start: 0, end: text.length }]

/**
 * 把右栏那一行正文交给会话执行链。返回 `false` = **没发**（空白正文、或被 `before` 拦下）。
 *
 * 空白正文在这里拦，不在调用方：`sendFollowupDraft` 自己不看空（它的 `buildRequestParts`
 * 只是让 `requestParts` 变成空数组），放进去会发出一条**没有任何 part** 的 prompt，
 * 而服务器那边是一条真的 user 消息 —— 「点了没反应」和「点出一条空消息」是两种坏法。
 */
export async function submitRightPanePrompt(input: RightPaneSubmitInput): Promise<boolean> {
  if (input.text.trim() === "") return false

  /**
   * ⚠️ **两处 `as` 是对上游必填类型的唯一让步，不是数据**：运行时的值就是 `undefined`。
   *
   * `FollowupDraft` 要求 `agent: string` / `model: {providerID, modelID}`，而右栏**没有**
   * agent / model 选择器（这是裁定：本轮不新增选择器）。有两条路：
   *
   * 1. 编一个值填上 —— **不行**。空 `model` 对象 `{providerID:"",modelID:""}` 在服务端
   *    `input.model ?? ag.model ?? currentModel(sessionID)` 里是**真值**，会拿它去解析模型、
   *    当场报错；只有 `undefined` 才会走回退链。**空对象比不传更坏。**
   * 2. 前端自己跑一遍那条回退链填上 —— **也不行**，那就是同一个判断的第二处写法
   *    （`LEARNINGS #002-06`），而且会把「这场会话上次用的模型」悄悄换成全局默认。
   *
   * ⇒ 取会话的；会话没有就**不传**，把缺省交给服务端（`packages/opencode/src/session/prompt.ts`
   * 的 `createUserMessage`：`agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()`，
   * 以及 `input.model ?? ag.model ?? (yield* currentModel(input.sessionID))`）。
   * 「本栏不自选」的唯一正确表达就是**不传**。
   *
   * ⚠️ 上面那个第一句**原来是错的**（写成 `input.agent ?? agents.defaultInfo()`，那个 `??` 表达式
   * 在 `prompt.ts` 里根本不存在——第二轮审查核出、我复跑确认）。落地前已按真身逐字改；
   * 模型那一句原本就是逐字精确的（同在那个函数里，紧跟其后）。
   *
   * ⚠️ **已挂账**（`state.md` 缺口表，且**有哨兵守着**）：`sendFollowupDraft` 的 `/` 命令分支会
   * **解引用** `draft.model.modelID`（`submit.ts` 里 `api.command({… model: { id: input.draft.model.modelID, … }})`
   * 那一处）。于是「会话没记过 model」＋「正文第一段恰好命中一个**服务端真命令**」这一组合会抛
   * `Cannot read properties of undefined`——`submit-prompt.test.ts` 有一条**哨兵**钉着它，
   * 用例名是「**⚠️ 已知缺陷：会话没记过 model ＋ 正文命中命令名 ⇒ 当场抛（F3，挂账中）**」
   * （断 `.rejects.toThrow(/modelID/)`）。
   *
   * ⚠️ **`/` 这一支今天真的会走**（T010 审查的实测**推翻了我原写在这儿的推断**）：skill 在服务端
   * **就是命令**（`command/index.ts` 把 `skill.all()` 注册成 `source:"skill"` 的命令），
   * `bootstrap.ts` 的 `loadCommands` 又把 `GET /command` 全量装进 `sync.data.command`，
   * 而 `command-palette.ts` 插入的 token 与命令名同值 ⇒ **从 `/` 面板选一个 skill，走的正是这条
   * 分支**，不是「原样当正文发」。2026-10-07 用户裁定**保持既有链行为**（不为它改产品码）
   * ⇒ 这个崩溃作为**已知缺陷挂账**，只钉哨兵、不修补。
   *
   * ⚠️ **它何时才触发，我没实测过**：原先这儿写着「右栏展示的会话都已有 model」，那是**推断**，
   * 已删（`LEARNINGS #003-04`：复现不了的别写成实测）。⇒ 右栏接上 `onNewSession` 那天，
   * 第一件事就是去验「新会话的第一次提交，`session.model` 在不在」。
   */
  const draft: FollowupDraft = {
    sessionID: input.sessionID,
    sessionDirectory: input.sessionDirectory,
    prompt: 一句话(input.text),
    context: [],
    // ⚠️ 下面两处断言是**对上游必填类型的唯一让步**（理由见上面那段）：运行时的值就是
    // `undefined`，而「不传」是本栏唯一正确的表达。**这里没有值可收窄**——不是想省事才用 `as`，
    // 仓里那条纪律（能收窄就收窄）在这种「类型说必填、事实是缺席」的形状上不适用。
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `FollowupDraft.agent` 必填，而右栏没有 agent 选择器；缺省交给服务端（见上文）。
    agent: input.session?.agent as string,
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 同理：会话没记过 model 时就是要传 `undefined`（编空对象在服务端是真值，会当场报错）。
    model: (input.session?.model
      ? { providerID: input.session.model.providerID, modelID: input.session.model.id }
      : undefined) as FollowupDraft["model"],
  }

  return sendFollowupDraft({
    api: input.api,
    serverSync: input.serverSync,
    sync: input.sync,
    draft,
  })
}
