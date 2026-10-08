import { DataProvider } from "@opencode-ai/session-ui/context"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import {
  PromptInputV2,
  type PromptInputV2PersistedState,
  type PromptInputV2Suggestion,
} from "@opencode-ai/session-ui/v2/prompt-input"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import { createPromptInputV2Store } from "@opencode-ai/session-ui/v2/prompt-input/store"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { skillCommands } from "./command-palette"
import { CommonCards } from "./common-cards"
import { projectCapabilities } from "./projection"
import { 可列出的会话 } from "./session-actions"
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
  /** 会话数据。生产由 `ai-session-slot.tsx` 从 `useServerSync()` 取、经 `dataFor` 注入，测试喂夹具。 */
  data: SessionPanelData
  /** 工作目录。`DataProvider` 要它（会话里的文件引用按它解析）。 */
  directory: string
  /** 当前会话 id。 */
  sessionID: string
  /**
   * 四层内容的**投影结果**（`ai-session/projection.ts` 的纯函数）。生产由 `ai-session-slot.tsx`
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
  /**
   * 提交一句话。**真正发出去的是调用方**（T010 的 `submit-prompt.ts` 交给会话执行链）；
   * 本组件只负责交出去、并按回话决定**要不要清空输入框**。
   *
   * ⚠️ 回话（`Promise<boolean>`）不是装饰：`false` ＝「没发出去」⇒ 正文**留**在输入框里。
   * 不接（`undefined`）＝ 一个字都不动——**清空的含义是「已经交出去了」**，没交出去就不能清
   * （见 `onSubmit` 里那三条用例钉的三个分支）。
   */
  onSubmitPrompt?: (text: string) => Promise<boolean> | void
  /**
   * 切到另一场会话。**本组件不自己改 `sessionID`**——它是受控的，生产里由
   * `ai-session-slot.tsx` 改（它改的是**路由**，右栏的会话 id 只有一个产地、
   * 就是 URL；同 `skill-drawer.tsx` 的 `open` / `onClose` 那对受控接缝）。
   */
  onSelectSession?: (sessionID: string) => void
  /** 新建一场会话。真正调 SDK `session.create` 的是生产侧，不是这里。 */
  onNewSession?: () => void
  /**
   * 删除**当前**那场会话（T015 / US4 场景 2）。生产由 `ai-session-slot.tsx` 接上
   * （调 `session-actions.ts` 的 `删会话`，成功后再按 `删除后去哪` 跳走）。
   *
   * ⚠️ **失败归调用方**（与 `onSelectSession` / `onNewSession` 同一个 `void` 签名）：本组件不接
   * 回话，也就不可能在「删没删掉」这件事上撒谎。生产那边 `.catch` 里弹 toast——与它接
   * `onSubmitPrompt` 同款，只是那边需要回话（决定要不要清空输入框），这边不需要。
   *
   * ⚠️ **不可逆动作**（上游：删会话会连带消息与历史一起永久删掉），而执行层的
   * `permission.bash` 闸门筛的是 shell 命令 pattern，**管不到**这条 HTTP 出口 ⇒ 要拦只能在前端拦。
   * 形态由 2026-10-07 用户裁定：**就地二次确认**（见 `确认中`）。
   */
  onDeleteSession?: (sessionID: string) => void
  /**
   * 导出**当前**那场会话（T016 / FR-010）。生产由 `ai-session-slot.tsx` 接上：调
   * `session-actions.ts` 的 `导出会话`，回来了再把文件名与内容交给上游 `downloadSessionExport` 落盘。
   *
   * ⚠️ **失败归调用方**（与另外三颗钮同一个 `void` 签名）：本组件不接回话，也就不可能在
   * 「导没导出去」这件事上撒谎。生产那边 `.catch(报错)`——全右栏只有那一处报错
   * （`LEARNINGS #002-06`）。
   *
   * ⚠️ **不配在途守卫**（与删除**不同**）：导出是可重复的**读**动作，连点两下最多下载两个文件；
   * `在途守卫` 守的是「不可重入的**写**」（`session-actions.ts` 里点名是新建 / 删除两根线）。
   */
  onExportSession?: (sessionID: string) => void
  /**
   * 坐在**消息流与工具栏之间**的那一块（今天只有一样东西：待答的权限 / 提问闸门）。
   *
   * **为什么是注入而不是本组件自己渲染**：闸门那两件要 `usePermission()`（问「这条请求是不是
   * 已经被自动放行规则吃掉了」）与目录作用域的 `api.permission.reply`，两者都长在
   * `ai-session-slot.tsx` 才够得着的 context 上（`PermissionProvider` 在 `app.tsx` 里、
   * 在所有栏之上）。本组件是**受控**的：它只决定「坐在哪」，不决定「由谁答」
   * ——同 `onSelectSession` 那条（右栏的会话 id 只有一个产地，就是 URL）。
   *
   * ⚠️ **位置是有讲究的**：`session-turns` 与 `session-tools` 之间，即「消息流之下、输入框之上」
   * ——与中栏那页上游会话页里 dock 的位置一致（`session-composer-region.tsx` 把它排在
   * `promptInput` 之上），也是「闸门挡着你，先答再输入」这个意思该有的次序。
   */
  dock?: JSX.Element
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

  /**
   * 「待删的是**哪一场**」——存 id，不存 `boolean`（T015）。
   *
   * 用户点过「删除」（钮已变成「确认删除？」）之后，完全可能去点列表里**另一场**会话。
   * 若确认态是一个 `boolean`，钮上那句「确认删除？」**还亮着**，而下一次点击删掉的是**新那场**
   * ——用户从没想过要删的那场，且不可逆。判据写成 `待删() === props.sessionID`，「钮上的文案」
   * 与「它真会删的那一场」就**按构造**一致（`LEARNINGS #004-02`：两个投影要靠会红的相等断言
   * 同步，别靠注释约定）。用例见 `session-panel.test.tsx` 的 ④。
   *
   * ⚠️ **一条已知的残留（不修，只记）**：`待删` 是**粘**的——点过「删除」之后切到别场、再切回来，
   * 钮上那句「确认删除？」**还在**（那确实是「这场会话有一条待确认」），于是一下点击就删了。
   * 不修的理由：要消掉它得再加一条过期/复位规则，而钮上的字**始终如实**写着它要干什么，
   * 用户不必猜。⚠️ 这条**没有断言守着**（用例 ④ 钉的是「切走之后归位」，不是「切回来」）。
   */
  const [待删, set待删] = createSignal<string | undefined>(undefined)
  /** 此刻这个钮是「问」还是「做」:问的是**当前**这场会话。 */
  const 确认中 = () => 待删() === props.sessionID

  /** 当前那条会话。找不到（如 data 还没同步到）时退回显示 id，别渲染成空白。 */
  const 当前会话 = () => props.data.session.find((会话) => 会话.id === props.sessionID)

  /**
   * 要渲染成「一轮」的消息。
   *
   * ⚠️ **这不是过滤噪音，是 `SessionTurn` 的入参契约**：它只接受 **user** 消息的 id
   * （`session-turn.tsx` 的 `messageIndex` / `message` 两处都写着 `msg.role !== "user"` ⇒ 返回
   * `-1` / `undefined`），而它的根 `<div data-component="session-turn">` 是**无条件渲染**的
   * ⇒ 喂一条 assistant 消息进去，屏幕上是**一个空壳**（无 `session-turn-message-container`）。
   * 一场 4 轮对话的 `message[]` 是 8 条（4 user ＋ 4 assistant）⇒ 在此之前右栏是 8 格、4 格是空的。
   *
   * 判据与仓里既有两处**逐字相同**：`enterprise/routes/share/[shareID].tsx`、
   * `session-ui/.../timeline-playground.stories.tsx` 都是「先筛 user、再交给 `SessionTurn`」。
   * （`pages/session/timeline/model.ts` 的 `selectUserMessages` 是同一条判据的另一处写法；这里
   * **不 import 它**——那是一页页面级的模块，右栏引它等于把会话页那条取数链拽进右栏的依赖图，
   * 而这条判据只有一行。`LEARNINGS #002-06` 说的是「同一个判断别两处各写一份**同一个对象的
   * 状态**」，不是「一行谓词也得共享」。）
   *
   * ⚠️ 与「同一场会话里消息增长」无关的那份注意：本 memo 只依赖 `props.data` 与 `props.sessionID`，
   * 两者引用都稳（`data` 按目录缓存）⇒ 它不是每一帧都重算。
   */
  const 轮次 = createMemo(() => (props.data.message[props.sessionID] ?? []).filter((消息) => 消息.role === "user"))

  // ── 自动跟随底部（缺陷修复 · 2026-10-08）────────────────────────────────────
  //
  // 现场：**发完问题之后，AI 的回答不在视野里**，要用鼠标往上滚才看得见。根因是这个滚动容器
  // 当年就没接过任何自动滚动——`[data-slot="session-turns"]` 是个裸 `overflow-y-auto`，
  // 全仓在它上面没有一条 `scrollTop` / `scrollIntoView`（上游会话页则一直有）。
  //
  // 修法是**复用上游那件现成的东西**，不自己写第二份：`@opencode-ai/ui/hooks` 的
  // `createAutoScroll`（`packages/ui/src/hooks/create-auto-scroll.tsx`，全仓唯一一处），
  // 参数与上游会话页**逐字同源**（`pages/session.tsx:1499`）。
  //
  // ⚠️ `working: () => true` 是**照抄上游**的，不是偷懒：上游那边这个位置本来是「AI 正在答」，
  // 它传的却是**常量真**——因为 `userScrolled` 那条粘性标志已经管住了「用户滚上去就别再拽他」
  // 这一半，剩下的「内容长高就跟随」不需要业务信号。自己另立一个「在不在生成中」的判据
  // 就是把同一件事在第二处再写一份，且那一份**不会随上游一起改**（`LEARNINGS #002-06` / `#003-05`）。
  //
  // ⚠️ `overflowAnchor: "none"` 同样照抄：浏览器自己的 scroll anchoring 会和这套跟随打架。
  const 自动跟随 = createAutoScroll({ working: () => true, overflowAnchor: "none" })

  /**
   * 换会话 ⇒ 恢复跟随。
   *
   * ⚠️ **这一步不能省**，而它之所以容易漏，是因为「切会话会重建组件」是个**看着很对、其实不对**
   * 的推断：本面板外面是 `ai-session-slot.tsx` 的 `<Show when={提交态()}>`，**非 keyed** ⇒ 换会话时
   * 那个 `<Show>` 一直为真，`SessionPanel` **不重挂**，滚动容器元素被跨会话复用
   * （`LEARNINGS #004-13`：能一次解释掉全部现象的说法才是根因——这里是它的反面，一个解释不掉的推断）。
   *
   * 不恢复的后果：在 A 会话往上滚过（`userScrolled` 变真）之后切到 B，B 从第一屏起就**不跟随**，
   * 且界面上没有任何东西说明为什么。上游同一位置也是这么做的（`pages/session.tsx:1501-1509`）。
   *
   * `defer: true` ＝ 首次挂载不跑：挂载那一刻 `scrollRef` 还没接上（`createAutoScroll` 内部
   * `if (!el) return`），跟随由内容包裹层的 `ResizeObserver` 首次触发兜住，这里只管**切换**。
   */
  createEffect(
    on(
      () => props.sessionID,
      () => 自动跟随.resume(),
      { defer: true },
    ),
  )

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
   * 草稿的门面（`store.ts` 的 `createPromptInputV2Store`），本组件只用它的 `reset()` 与
   * `setText()` —— 提交的**收官动作**（见下面 `onSubmit`）。
   *
   * 不手写 `草稿[1]("prompt", …)`：清空这一步上游已经有一份实现，手写第二份就是同一件事的
   * 两处写法（`LEARNINGS #002-06`）。
   *
   * ⚠️ **别把 `reset()` 说成「顺手归零 cursor，所以更好」**：那是**推断**，且**已实测证伪到
   * 「无断言守着」**——把上游 `store.ts` 的 `reset()` 里那行 `setStore()("cursor", 0)` 拆掉，
   * 本组 **27 条全绿、一条都不红**（2026-10-07 变异 M8）。原先那句「漏了它，下次打字的光标
   * 位置会落在旧位置」已删（`LEARNINGS #005-15`：别让注释比断言强）。真正成立的事实只有两条：
   * ① 用 `reset()` 省得写第二份清空逻辑；② `reset()` 的实现里确实带 `cursor: 0`。
   * 「不归零会怎样」**没有断言守着 ⇒ 已挂账**（缺口表），别读成已验证的收益。
   * ⚠️ 传**整个 tuple**，别解构（同下面 `controller` 那条注释）。
   */
  const 草稿操作 = createPromptInputV2Store(草稿)

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
        //
        // ⚠️ **清空是收尾、不是开场**（原生件自己不清草稿：`interaction.ts` 的 `submit()` 只调
        // `onSubmit`，**外加关一下弹层**，草稿一个字都不动——清空是调用方的责任；上游
        // `prompt-input.stories.tsx` 正是在 `onSubmit` 里调 `store.reset()`）。三个分支各有一条
        // 用例钉着（`session-panel.test.tsx`）：
        // 没接回调 ⇒ 一个字都不动；回话 `false` ⇒ 正文留着；回话 `true` ⇒ 清空。
        onSubmit: () => {
          const 正文 = 取正文()
          const 回话 = props.onSubmitPrompt?.(正文)
          // 没接回调（`undefined`）就到此为止：**清空的含义是「已经交出去了」**，
          // 没有接收方就不存在「交出去」。（`Promise<boolean> | void` 里非 `void` 的那一支
          // 恒是真值，所以这个判据实际只筛掉「回调没回话」。）
          if (!回话) return
          草稿操作.reset()
          void 回话.then((发了) => {
            if (发了) return
            // 没发出去 ⇒ 把正文还回输入框。⚠️ 只在**用户还没打新字**时还：否则一次网络抖动
            // 会连带吃掉用户刚敲的半句（上游 `submit.ts` 的 `restoreInput` 是同一条判据——
            // 回填前先比一次当前正文）。
            if (草稿操作.state.prompt.some((part) => part.type === "text" && part.content !== "")) return
            草稿操作.setText(正文)
          })
        },
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
          {/* 删除**当前**这场（T015）。坐在行上、不坐在列表的每一行里：详情列表是「切到哪一场」，
              而删除是一个**对当前**的动作（上游 `message-timeline` 把删除放在会话列表行里，那边一行
              就是一场；右栏这一行说的是「当前会话」，动作自然也挂在这儿）。

              ⚠️ **视觉是本处自定的**：`DESIGN.md` §4.7.5 的会话管理那一格只写了「新建 / 切换走
              SDK `session.create` / `session.list`」，**没有**删除、更没有它的样子。本处按同栏的
              「＋ 新会话」取同一档 token（`text-v2-text-text-muted` ＋ hover 同底色），确认态改用
              仓里现成的语义色 `text-v2-state-fg-danger`（`auth/change-password.tsx` 的报错行、
              `dialog-connect-provider.tsx` 同款，**不是**随手挑的颜色）。已记进 `state.md` 的缺口表。 */}
          {/* 导出**当前**这场（T016）。与「删除」同居会话行的判据**同**：它是**对当前会话**的动作
              （不是「切到哪一场」）⇒ 坐在这一行上，不坐进列表的每一行里。

              ⚠️ **视觉同「删除」那笔账**：`DESIGN.md` §4.7.5 的会话管理只写了「新建 / 切换」，
              导出与删除都**没有**样子 ⇒ 取同栏「＋ 新会话」那一档 token（不新增 app 级 CSS）。
              已记进 `state.md` 的缺口表。 */}
          <button
            data-slot="session-export"
            class="shrink-0 cursor-pointer rounded px-1 py-0.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
            onClick={() => props.onExportSession?.(props.sessionID)}
          >
            导出
          </button>
          <button
            data-slot="session-delete"
            class="shrink-0 cursor-pointer rounded px-1 py-0.5 text-[11px] hover:bg-v2-overlay-simple-overlay-hover"
            classList={{
              "text-v2-state-fg-danger": 确认中(),
              "text-v2-text-text-muted": !确认中(),
            }}
            onClick={() => {
              // 第一下只问、不删（不可逆动作 ⇒ 2026-10-07 裁定的就地二次确认）。
              if (!确认中()) {
                set待删(props.sessionID)
                return
              }
              // 第二下：先收起确认态再交出去——不留一个「已确认」的钮给下一场会话。
              set待删(undefined)
              props.onDeleteSession?.(props.sessionID)
            }}
          >
            {确认中() ? "确认删除？" : "删除"}
          </button>
        </div>

        {/* 列表用 `Show`（展开才在 DOM 里），不是 `hidden`——收起时它整段不存在，占位也为零。 */}
        <Show when={展开()}>
          <div data-slot="session-list" class="flex w-full shrink-0 flex-col bg-v2-background-bg-base p-2">
            <For each={可列出的会话(props.data.session)}>
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

        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 这两条只对 **DOM 元素上的 JSX 事件属性**生效，而 `onClick` 在这里不是「点击动作」、是**观察**（`handleInteraction` 内部只在 `window.getSelection()` 非空时才 `stop()`，即「用户正在选文本 ⇒ 别再抢他的视野」），**没有**可键盘触发的动作，补一个空 `onKeyDown` 只是哄门。上游把同一个回调挂在 `<ScrollView onClick>`（组件）上、经 `{...rest}` 落到 div —— DOM 形状与这里逐字相同，只是 jsx-a11y **看不见跨组件的那一跳**，所以上游不报。我们用的是裸 div，报得对，故按本仓 `oxlint-disable-next-line -- 理由` 的惯例据实标注（`LEARNINGS #001-05` 同族：门的判据要据实，别为了让门闭嘴去改行为）。 */}
        <div
          ref={自动跟随.scrollRef}
          data-slot="session-turns"
          class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto"
          onScroll={自动跟随.handleScroll}
          onClick={自动跟随.handleInteraction}
        >
          {/* 这一层是**自动跟随的观测面**，与下面那层（修「没有垂直滚动」的）是两件事，别合并。

              `createAutoScroll` 靠 `createResizeObserver(contentRef)` 在**内容长高时**跟到底部，
              而 `ResizeObserver` 观测的是**元素自己的盒子**：本容器是 `flex-1`（高度确定）
              ⇒ 内容长高时**它自己不变**（变的是 `scrollHeight`）⇒ 把 `contentRef` 挂在容器上，
              观测器一次都不会因为内容增长而触发，自动跟随**静默失效**（不报错、不变红）。

              所以中间必须有一个**高度随内容长高**的元素，`contentRef` 挂它。上游同一个原语的挂法
              就是分两处的：`scrollRef` 在滚动根、`contentRef` 在 `[data-timeline-virtual-content]`
              （`message-timeline.tsx` :572 / :1826）。

              `shrink-0` 在这里也不是装饰：它是容器的 flex 项，默认 `flex-shrink: 1` ⇒ 内容超高时
              它会被压到**容器高**，那一瞬间 `contentRef` 的高度不再等于内容高，观测面就失真了
              （同族：`#006-15` 的「格子高 = 容器高 ÷ 条数」正是这么来的）。

              ⚠️ 它**不加** `flex flex-col`：里面那层是有意让 `<For>` 生成的块级 div 自然堆叠的；
              多引入一个 flex 格式化上下文，等于给下面那段注释里已经量过的几何再加一个变量。
              本层对版面无影响（`w-full` 的块级 div 在 `w-full` 的块级父层里，宽度与之前逐字相同）。 */}
          <div ref={自动跟随.contentRef} data-slot="session-turns-content" class="w-full shrink-0">
            <For each={轮次()}>
              {(消息) => (
                /* 这一层 `<div>` **不是装饰**，是修「没有垂直滚动」的那一半（2026-10-08 真栈肉眼报的）。

                   `SessionTurn` 自带两条 CSS（在 `session-ui` 的样式表里，按属性选择器写，不是
                   Tailwind 类，所以从源码里看不见）：

                       [data-component="session-turn"]          { height: 100%; display: flex; … }
                       [data-slot="session-turn-content"]       { height: 100%; overflow-y: auto; … }

                   它的设计前提是**父层高度 auto**：内容把那一层撑开，滚动交给外层。上游两处权威用法
                   都在这个前提下用它——`timeline-playground.stories.tsx` 包一层
                   `<div style={{ width: "100%" }}>`，`enterprise/routes/share/[shareID].tsx` 靠外层
                   `flex flex-col` 的高度 auto。

                   本容器（`flex-1`，高度确定）违背了这个前提：`height:100%` 会解析成**容器全高**
                   ⇒ n 条 turn 的 `flex-basis` 全等 ⇒ 被 flex-shrink 按比例压成 `容器高 / n`。
                   2026-10-08 实测两次，精确吻合：6 条各 **106.17px**（637÷6）、3 条各 **212.33px**
                   （637÷3），而它们的内容真实需要 139 / 340 / 269px。后果有两个，**都不报错**：
                   ① 长回答被压进那一条里、由 `content` 那条 `overflow-y:auto` **在格内滚**；
                   ② 外层 `scrollHeight` 恒等于 `clientHeight` ⇒ **永远不出现滚动条**，且内容叠在一起。
                   用户报的「没有垂直滚动」就是这个——不是滚不动，是**滚动被藏在每一格内部**。

                   包这一层的两个作用，**缺一不可**（实测：只改 `content` 那侧不够，turn 仍被压成
                   `容器高/n`）：① 它的高度是 auto ⇒ 内层 `height:100%` 相对它解析为 auto；
                   ② `shrink-0` 让它自己不被 flex 收缩。撑高一条到 1500px 的对照实测：容器
                   `scrollHeight` 637 → **1876**、`maxScroll` **1239**（精确 = 1876-637）⇒ 真能滚。

                   ⚠️ **不传 `classes`**（上游那两处都传了 `content: "… !overflow-visible"`）：实测
                   **不需要**——内层高度一变成 auto，它的 `height:100%` 也跟着 auto，内容自然撑开、
                   不溢出，那条 `overflow-y:auto` 就此惰性。少传一个 prop 就少一份与上游漂移的面。
                   （另记一笔：`!overflow-visible` 这个类**当前是查不到的**——Tailwind v4 按需生成，
                   实测 `.overflow-visible` 在、带 `!` 的变体不在 ⇒ 写了也未必生效。）

                   ⚠️ 几何判据**单测断不了**（happy-dom 不跑布局，`LEARNINGS #005-07`）——真判据在
                   真栈 E2E：「turn 高度 ≠ 容器高 / 条数」。本处只能断结构。 */
                <div class="w-full shrink-0">
                  <SessionTurn sessionID={props.sessionID} messageID={消息.id} />
                </div>
              )}
            </For>
          </div>
        </div>

        {/* 待答的闸门（权限 / 提问）。位置与理由见 prop 上那段注释。 */}
        <Show when={props.dock}>{props.dock}</Show>

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
