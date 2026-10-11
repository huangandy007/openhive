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
   * 这场会话（`serverSync` 里那一条）。**用的是它的 `agent`**：
   * 右栏没有 agent 选择器，而 `agent` 的含义正是「上次用的」，与服务端缺省时的回退同源。
   * 会话还没记过（新建即提交）时是 `undefined`，此时**不传**——见下面那段让步注释。
   * 模型**不再从它身上取**（2026-10-11 改为由调用方解好、走 `model` 字段）。
   */
  session: Session | undefined
  /**
   * 本栏现在认的模型（**由调用方解好**：`model-selection.ts` 的 `当前模型键` → `从键`）。
   *
   * **必填但可为 `undefined`**（与上面的 `session` 同一个口径）：`undefined` 是「本栏一个都没认出」
   * 这个**事实**，而它不是「忘了传」——忘了传的话 typecheck 会红。
   *
   * ⚠️ 语义变更（2026-10-11 用户裁定「F3 本轮修掉」）：**旧版**本栏在会话没记过 model 时不传，
   * 把缺省交给服务端。那条路是**堵死的**——上游 `submit.ts` 的两条出口都假设 `draft.model` 必有值：
   * 命令分支直接读 `.modelID`（**F3**，当场抛），normal 分支 `{ ...input.draft.model, variant }`
   * 得 `{}`（**F4**，在服务端是**真值** ⇒ 把 `input.model ?? ag.model ?? currentModel()` 顶掉 ⇒
   * 拿空对象去解析模型 ⇒ 报错）。⇒ 本栏改为**恒给**（控件给出的那一支），认不出就不发。
   */
  model: { providerID: string; modelID: string } | undefined
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

  // ⚠️ **F3/F4 的收口**：没有模型就一个字都不发（理由见上面 `model` 那段）。
  // 位置在 `draft` 之前：这里返回 `false` ⇒ 面板把正文留在输入框里（`session-panel.tsx` 的
  // `onSubmit`），用户看得见「没发出去」，而不是收到一个 `Cannot read properties of undefined`。
  if (!input.model) return false

  /**
   * ⚠️ **F3 / F4 已修（2026-10-11 用户裁定「F3 本轮修掉」）**。
   *
   * 修法一句话：**本栏恒给模型 ＋ 认不出就不发**。模型由调用方解好（`model-selection.ts` 的
   * `当前模型键` → `从键`），这里只照 `FollowupDraft.model` 的形状原样交出去；本栏一个都
   * 认不出时，上面那句 `if (!input.model) return false` 已经拦住——**一个字都不发**，
   * 正文留在框里（面板据此回填，`session-panel.tsx` 的 `onSubmit`）。
   *
   * 修掉的两个洞**同根因**，都长在上游 `components/prompt-input/submit.ts`（两个出口各一处，
   * 都假设 `draft.model` 必有值，而旧版右栏在会话没记过 model 时不传）：
   * ① 命令分支 `submit.ts:94` 的 `model: { id: input.draft.model.modelID, … }` 直接解引用
   *    ⇒ **F3**：`Cannot read properties of undefined (reading 'modelID')`，当场抛；
   * ② normal 分支 `submit.ts:136` 的 `model: { ...input.draft.model, variant }` 对 `undefined`
   *    展开得 `{}` ⇒ **F4**：在服务端是**真值** ⇒ 把 `input.model ?? ag.model ?? currentModel()`
   *    的回退链顶掉 ⇒ 拿空对象去解析模型 ⇒ 报错。
   *
   * 两条判据钉在 `submit-prompt.test.ts`：
   * 「本栏一个模型都认不出 ⇒ **不发**（两个出口都没碰、回话是 `false`）」钉命令那一支、
   * 「本栏认不出模型时，即使正文是普通一句话也不发（不是只挡命令那一条支）」钉 normal 那一支
   * （`LEARNINGS #005-12`：一个收口落在两个出口上就写两条）。两条都断「两个出口都没被碰」，
   * 所以 F3 / F4 那个洞**连出口都到不了**——F4 的服务端解析那一下不在 `bun test` 的射程里
   * （要真服务器），据实归入 `state.md` 缺口表口径，不写成「已覆盖」。
   */
  const draft: FollowupDraft = {
    sessionID: input.sessionID,
    sessionDirectory: input.sessionDirectory,
    prompt: 一句话(input.text),
    context: [],
    // ⚠️ 下面那处 `as` 是**对上游必填类型的唯一让步**（`agent` 那一处）：右栏没有 agent 选择器，
    // 会话也没记过时运行时的值就是 `undefined`，而「不传」是本栏唯一正确的表达。
    // **模型这一处的 `as` 已删**（2026-10-11）：守卫保证到这里它必有值，类型与事实对齐了。
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `FollowupDraft.agent` 必填，而右栏没有 agent 选择器；缺省交给服务端（见上文）。
    agent: input.session?.agent as string,
    model: input.model,
  }

  return sendFollowupDraft({
    api: input.api,
    serverSync: input.serverSync,
    sync: input.sync,
    draft,
  })
}
