import { DataProvider } from "@opencode-ai/session-ui/context"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import {
  PromptInputV2,
  type PromptInputV2PersistedState,
  type PromptInputV2Suggestion,
} from "@opencode-ai/session-ui/v2/prompt-input"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { skillCommands } from "./command-palette"
import { CommonCards } from "./common-cards"
import { projectCapabilities } from "./projection"
import { SkillDrawer } from "./skill-drawer"

/**
 * 右栏会话槽收到的**会话数据**（计划 §「② 右栏会话的真实接入面」）。
 *
 * 形状**从被调方推**（`LEARNINGS #004-07`：按被调方的签名打勾，不按调用方的直觉）：
 * `DataProvider` 的入参 `data` 就是 `@opencode-ai/session-ui` 会话原语全体的取数口，
 * 而它的类型 `Data` **没有导出** ⇒ 用 `Parameters<typeof DataProvider>[0]` 反取，
 * 不自己复写一份（复写就是同一件事的两处写法，`LEARNINGS #002-06`）。
 */
export type SessionPanelData = Parameters<typeof DataProvider>[0]["data"]

export interface SessionPanelProps {
  /** 会话数据。生产由 `workspace-entry.tsx` 的 `useSync()` 注入，测试喂夹具。 */
  data: SessionPanelData
  /** 工作目录。`DataProvider` 要它（会话里的文件引用按它解析）。 */
  directory: string
  /** 当前会话 id。 */
  sessionID: string
  /**
   * 四层内容的**投影结果**（`ai-session/projection.ts` 的纯函数）。生产由 `workspace-entry.tsx`
   * 传 `projectCapabilities(清单, 当前模块)`。
   *
   * **一份，不是三份**。四层同出一次投影：分开传 `commands` / `commonCards` / `skillGroups`
   * 就给「模块 A 的卡 ＋ 模块 B 的命令」这种不一致组合留了缝，而那种缝**不报错、不变红**
   * （`LEARNINGS #002-06`：同一个判断不要两处各写一份——这里是它的反面：一处算、一处用）。
   *
   * **必填**。可选就等于「忘了传也没人红」，而忘传的表现是「右栏空着」，与「这个模块还没有
   * skill」在界面上分不开（`LEARNINGS #005-11`：横切机制在新出口上没人验）。
   *
   * ⚠️ `/` 的**唤起走 `onInput`、不是 `onKeyDown`**（T007 实测：`machine.ts` 里 `/` 那一支只有
   * `input.changed`）——本组件把 `PromptInputV2` 原样挂上，这条约束由原生件承担，不在这里重写。
   */
  projection: ReturnType<typeof projectCapabilities>
  /** 提交一句话。**真正发出去的是调用方**（T010 接 SDK `session.prompt`）；本轮右栏只负责把它交出去。 */
  onSubmitPrompt?: (text: string) => void
  /**
   * 切到另一场会话。**本组件不自己改 `sessionID`**——它是受控的，生产里由
   * `workspace-entry.tsx` 改（同 `skill-drawer.tsx` 的 `open` / `onClose` 那对受控接缝）。
   */
  onSelectSession?: (sessionID: string) => void
  /** 新建一场会话。真正调 SDK `session.create` 的是生产侧，不是这里。 */
  onNewSession?: () => void
}

/**
 * 右栏「最小可用会话」（T008 / FR-010 / DESIGN §4.7.5）。
 *
 * 消息流用 `SessionTurn` 逐条渲染——**不是** `MessageTimeline`：后者有 20 个 props 且内部
 * 直接用页面级 context（`useSessionKey()` / `useSync()` / `useSDK()`），搬进右栏等于把会话页
 * 整个搬过来（T001 出参已实测）。在仓的唯一先例是 `enterprise/routes/share/[shareID].tsx`。
 *
 * ⚠️ **`DataProvider` 由本组件自己挂**（计划 §② 的裁定 U1(c)）。理由是一条**实测**而非推断：
 * 路由那份 `DataProvider` 挂在 `pages/directory-layout.tsx` 里、渲染进**中栏**，而本组件落在
 * `ThreePane` 的 `right` 槽——与它**平级**，不在其子树内 ⇒ 不自己挂，`SessionTurn` 当场抛
 * `Data context must be used within a context provider`。这条对照写在 `session-panel.test.tsx` 里。
 */
export function SessionPanel(props: SessionPanelProps): JSX.Element {
  /** 会话列表是否展开。**局部的开合状态**——它不跨栏、不跨路由，所以不上升成 prop。 */
  const [展开, set展开] = createSignal(false)
  /**
   * 「更多 skill」抽屉的开合。**开合状态归本组件**（T006 📥 ③：`SkillDrawer` 是受控面板，
   * `open` / `onClose` 那两颗接缝就是给它留的），而**入口钮坐在哪归本组件决定**——
   * design-v2 §8.2 与 `2026-09-12-AI资产-design.md` 都把它画在**输入框旁边**。
   */
  const [抽屉开, set抽屉开] = createSignal(false)

  /** 当前那条会话。找不到（如 data 还没同步到）时退回显示 id，别渲染成空白。 */
  const 当前会话 = () => props.data.session.find((会话) => 会话.id === props.sessionID)

  // ── Hero 输入（§4.7.5）─────────────────────────────────────────────────────
  //
  // 外壳用**原生** `PromptInputV2`（§4.7.5：`rounded-xl` ＋ `min-h-[96px]` ＋ 白底 ＋ 柔和阴影
  // 全在原生件里，**不新增 app 级 CSS 覆盖**——少一处将来会漂的联姻）。
  //
  // controller 由**本组件自己造**，不是从外面收一个现成的：外面那份是
  // `components/prompt-input-v2.tsx` 的 `usePromptInputV2Controller`，它要 SDK / sync / file /
  // layout / comments / dialog / command / permission / language **九个**页面级 context，
  // 还要 `onSuggestionSelect → command.trigger` 那套会话页语义——搬进右栏等于把会话页搬过来
  // （与 `SessionTurn` 同一回事，见上面那段）。所以这里用**最小 controller**：只填
  // `createPromptInputV2Controller` 的**必填项**，`context` / `searchContextFiles` 给空集
  // （右栏本轮不做 `@` 提及；它是另一条产源，与 T005 的上下文指令不是一回事）。
  // ⚠️ **不要解构**：`PromptInputV2StoreInput` 收的是 `createStore` 返回的**整个 tuple**
  // （`store.ts` 的 `createPromptInputV2Store` 取 `tuple()[0]` 当 store、`tuple()[1]` 当 setter）。
  // 解构出 `[store]` 传进去 ⇒ 控制器拿到的是裸 store、取不到 setter，报
  // `undefined is not an object (evaluating 'draft.state.prompt')`。
  const 草稿 = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })

  /**
   * `/` 面板的数据源（T007 📤 的那一根线）：**投影的 `all` 那一支**再经 `skillCommands` 适配。
   *
   * 用 `createMemo` 而不是裸箭头：适配每次会**新造一个数组**，而 controller 底下是
   * `useFilteredList`（`createResource`）——每次读都换新引用会把它的依赖搅乱。
   */
  const 命令集 = createMemo<PromptInputV2Suggestion[]>(() => skillCommands(props.projection.all))

  const controller = createPromptInputV2Controller({
    store: 草稿,
    commands: 命令集,
    context: () => [],
    searchContextFiles: () => [],
    view: {
      submit: {
        stopping: () => false,
        // `view.submit.onSubmit` 的签名是 `() => void`（**不收正文**）⇒ 正文得自己取。
        // 取法只有一种是对的：`controller.value()`——别在这里重写一遍「哪些 part 算正文」
        // （那就是同一件事的第二处写法，`LEARNINGS #002-06`）。
        onSubmit: () => props.onSubmitPrompt?.(取正文()),
        onStop: () => {},
      },
    },
  })

  /** 草稿正文。定义在 `controller` **之后**只为避开 TS 的循环推断；只在 `onSubmit` 被调时才求值。 */
  const 取正文 = () => controller.value()

  return (
    <DataProvider data={props.data} directory={props.directory} sessionID={props.sessionID}>
      {/* ⚠️ `relative` 不是装饰：`SkillDrawer` 是 `absolute inset-0`，它盖的是**右栏这个容器**
          （§4.7.3 明写「右栏容器 `relative`」）。少这一个类，抽屉会去盖离它最近的那个定位祖先
          ——那是**中栏**，也就是 §4.7.3 特意不要的「把民警正在看的东西盖住」。 */}
      <div data-component="session-panel" class="relative flex h-full w-full flex-col">
        {/* 会话行（2026-10-07 裁定：做在右栏内，不新增全局浮层）。视觉照 §4.7.0 的 token 纪律，
            底色取 `layer-01` 与指令卡行（§4.7.1）同一档，避免同白相叠。 */}
        <div
          data-slot="session-row"
          class="flex w-full shrink-0 items-center gap-2 bg-v2-background-bg-layer-01 px-3 py-2"
        >
          {/* 名字与 ▾ 是**同一颗钮**：点名字就是展开（「当前会话名 ▾」是一个动作，不是一个标签）
              ⇒ `session-toggle` 是钮、`session-current` 是钮里的名字。 */}
          <button
            data-slot="session-toggle"
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-start hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => set展开((上一态) => !上一态)}
          >
            <span data-slot="session-current" class="min-w-0 truncate text-[13px] text-v2-text-text-base">
              {当前会话()?.title ?? props.sessionID}
            </span>
            <span class="shrink-0 text-[11px] text-v2-icon-icon-muted">▾</span>
          </button>
          <button
            data-slot="session-new"
            class="shrink-0 cursor-pointer rounded px-1 py-0.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => props.onNewSession?.()}
          >
            ＋ 新会话
          </button>
        </div>

        {/* 列表用 `Show`（展开才在 DOM 里），不是 `hidden`——收起时它整段不存在，占位也为零。 */}
        <Show when={展开()}>
          <div data-slot="session-list" class="flex w-full shrink-0 flex-col bg-v2-background-bg-base p-2">
            <For each={props.data.session}>
              {(会话) => (
                <button
                  data-slot="session-option"
                  class="flex w-full min-w-0 cursor-pointer items-center rounded-md px-2 py-1 text-start text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => props.onSelectSession?.(会话.id)}
                >
                  <span class="min-w-0 truncate">{会话.title}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* ① 顶部常驻「常用操作」（FR-002 / T004 📥 ①）。
            ⚠️ 宽度**不用传**：`InstructionCardRow` 自己挂 `ResizeObserver` 量自己
            （`instruction-cards.tsx` 的 `onMount`）——一挂进右栏它就在量了，生产里会真的溢出。
            本组件只负责把它放进 DOM，**不**再转一手宽度（转一手就多一个会漂的来源）。

            `activePrompt` / `onPick` 是 **T004 📥 交来的那一笔**（T009 / FR-007 / §4.7.1）：

            - `onPick`：点一张卡 ⇒ 把**那张卡**的句子填进输入框。走的是**状态机自己那条程序化
              改文的道**——`input.changed` ⇒ `draft.setText`（`machine.ts` 的 `inputChanged`；
              `/` 与 `@` 两个入口用的就是它）。**不**自己拼 `PromptInputV2Prompt` 的 part 形状：
              那是把「一段文字长什么样」在第二处再写一份（`LEARNINGS #002-06`），而 store 的
              `setText` 连游标都替我们摆好了。
            - `activePrompt`：选中态的产源**就是输入框当下的那句话**，不另立一个「点过哪张」的信号
              ——立了就有两处写法在说同一件事，且用户改一个字之后卡还亮着、而输入框里已经不是那张
              卡的句子了。§4.7.1 给的判据本就是**相等**（「输入框里那句话来自这张卡」）。
              ⇒ 它是 `controller.value()`（读 store 的响应式表达式），不是 `createSignal`。
              代价是「一改就掉」——§4.7.1 那句 ⚠️ 点名的就是它，本处按设计原文落地。 */}
        <CommonCards
          cards={props.projection.common}
          activePrompt={controller.value()}
          onPick={(卡) => controller.dispatch({ type: "input.changed", value: 卡.prompt })}
        />

        <div data-slot="session-turns" class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
          <For each={props.data.message[props.sessionID] ?? []}>
            {(消息) => <SessionTurn sessionID={props.sessionID} messageID={消息.id} />}
          </For>
        </div>

        {/* ③ 抽屉入口（T006 📥 ③）。坐在**输入框旁边**——design-v2 §8.2 与
            `2026-09-12-AI资产-design.md` 都这么画；`skill-drawer.tsx` 的文件头也写着
            「钮的位置由容器决定，不是由面板决定」。 */}
        <div data-slot="session-tools" class="flex w-full shrink-0 items-center px-3 pt-2">
          <button
            data-slot="drawer-entry"
            class="cursor-pointer rounded px-1 py-0.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => set抽屉开(true)}
          >
            ▸ 更多 skill
          </button>
        </div>

        {/* Hero 输入：钉在底部（`shrink-0`）——「对话优先」的视觉中心，§4.7.5 的表就这一条。 */}
        <div data-slot="session-hero" class="w-full shrink-0 p-3">
          <PromptInputV2 controller={controller} />
        </div>

        {/* ③ 抽屉本体放在最后：它是 `absolute inset-0`，DOM 顺序决定同层级的覆盖先后。 */}
        <SkillDrawer groups={props.projection.drawer} open={抽屉开()} onClose={() => set抽屉开(false)} />
      </div>
    </DataProvider>
  )
}
