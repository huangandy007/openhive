import { useLocation } from "@solidjs/router"
import { createMemo, Show, type JSX } from "solid-js"
import { useCenterTabs } from "@/center/tab-context"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { MANIFESTS } from "./capabilities"
import { projectCapabilities } from "./projection"
import { createRightPaneSource } from "./right-pane-source"
import { SessionPanel } from "./session-panel"
import { submitRightPanePrompt } from "./submit-prompt"

/**
 * 右栏（AI 会话）的**生产组装**（T008 建、T010 接上提交）：把四份 context 接进
 * `createRightPaneSource` + `SessionPanel`。
 *
 * ## 几份 context 各自解决什么
 *
 * - `useLocation()` → **当前会话 id**。右栏在 shell 层，拿不到 `:id` 路由参数（见 `route-session.ts`
 *   文件头）。
 * - `useServerSync()` → **会话数据**。`ServerSyncProvider` 由 `app.tsx` 的 `NewAppLayout`
 *   → `SelectedServerProviders` 提供，而 `NewLayout` 是它的后代 ⇒ 这一层**取得到**
 *   （⚠️ `SDKProvider` / `SyncProvider` **不在**这一层，见 `plan.md §②` 的更正）。
 * - `useServerSDK()` → **目录作用域的 `api`**（T010）。⚠️ 与上一条的更正同理，`SDKProvider`
 *   在 shell 层取不到——但**它兜着的那两个工厂取得到**：`ensureDirSdkContext(目录)` 与
 *   `ensureDirSyncContext(目录)` 都是 `useServerSDK()` / `useServerSync()` 上的方法，而
 *   `DirectorySDK` / `DirectorySync` 这两个类型本来就是从它们反推出来的
 *   （`context/sdk.tsx` / `context/sync.tsx`）。⇒ 右栏**自己就能造出**目录作用域的 `api` / `sync`，
 *   不必等上游把 provider 提上来。
 * - `useCenterTabs()` → **当前模块**，用来算指令卡 / skill 的投影（`projectCapabilities`）。
 *   它由 `WorkspaceEntry` 自己建 ⇒ 本组件必须**创建在那个 provider 之内**（`right` 这个 prop
 *   收的是**访问器**而不是现成的元素，要的就是这条，见 `workspace-entry.tsx` 上那段注释）。
 * - `useLanguage()` / `showToast` → **提交失败时的回话**（T010）。`LanguageProvider` 在
 *   `app.tsx` 的很外层、`showToast` 是模块级函数 ⇒ 这一层都取得到。
 *
 * ## ⚠️ 两个 `ensureDir*Context` 只能在**有 owner 的计算里**取
 *
 * 它们都是 `createRefCountMap`（`utils/refcount.ts`），**释放动作写在 `onCleanup` 里**。
 * 在 `onSubmitPrompt` 那个事件处理器里现取，就是「加引用那一下没有 owner 兜住」
 * ——不报错、不变红，只是每次提交涨一份永不释放的目录上下文。所以下面那个 memo 是**必须**的，
 * 不是为了好看（`right-pane-source.ts` 文件头有同一件事的实测）。
 *
 * ## 这个文件为什么不带测试
 *
 * 它是**纯接线**（下面十几行没有分支、没有状态），而它依赖的 context 里，`useServerSync()`
 * 的 provider 要一个**活着的服务器连接**才建得起来 ⇒ 在 `bun test` 里挂不起来。按
 * `LEARNINGS #002-02`：**「测不了」要如实写成「缺口」，不能写成「覆盖」**——已记进
 * `docs/superpowers/specs/006-ai-session/state.md` 的缺口表。
 * 它里面**真正会出错**的三件事都单独抽出来测了：
 * ① 「路由 → id → 目录 → 数据」那条异步链（含竞态）＝ `right-pane-source.test.tsx`；
 * ② 投影本身 ＝ `projection.test.ts`；③ **提交那一句话** ＝ `submit-prompt.test.ts`。
 * 本文件只负责**把它们接对**。
 *
 * ⚠️ 但**不是本文件里的一切都被测到了**（原话写到「三件事都测了」为止，读起来像全覆盖）：
 * 下面这三条**只在代码上核过、没有断言守着**（`#002-02` 的口径：这就是缺口）——
 * ① `提交态` 是 `createMemo`（引用随 memo 重算释放，上面那段 refcount 讲的就是它）；
 * ② 「**点击那一刻才读**」：`态()` 是 `<Show>` 的子访问器**参数**（⚠️ 原注释把它写成了
 *    memo，名字安错了——第二轮审查核出），真正读它的时刻是 `onSubmitPrompt` 回调体内
 *    （`const 现在 = 态()`），也就是点提交那一刻；
 * ③ `Show` 非 keyed —— ⚠️ 它的作用**不是**「同会话内消息增长不重挂」（原注释因果挂错了）：
 *    消息增长压根不会让 `提交态` 重算（依赖是 `源.ready()`，只读 `sessionID` / `directory` /
 *    `data`，而 `data` 按目录缓存、引用稳）。非 keyed 真正防的是「条件**仍是真值**、
 *    但**引用变了**」——例如切目录时 `ready` 返回一个新对象。
 * 三条错了都**不报错、不变红**，只有人读代码才看得见。
 */
export function AiSessionSlot(): JSX.Element {
  const location = useLocation()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const center = useCenterTabs()
  const language = useLanguage()

  const 源 = createRightPaneSource({
    pathname: () => location.pathname,
    // 目录**向会话要**，不是从 URL 解——新布局下 URL 里没有目录（`plan.md §②` 的更正）。
    directoryOf: (id) =>
      serverSync()
        .session.lineage.resolve(id)
        .then((血缘) => 血缘.session.directory),
    // `data` 就是 `DataProvider` 要的那一份（`session-panel.tsx` 的 `SessionPanelData` 同源）。
    // ⚠️ 这里必须在**有 owner 的计算里**被调用——`ensureDirSyncContext` 的释放走 `onCleanup`
    // ⇒ 由 `createRightPaneSource` 用 `createMemo` 兜住（那文件头写明了实测）。
    dataFor: (目录) => serverSync().ensureDirSyncContext(目录).data,
  })

  /**
   * 回话那一手要用的两件东西（`sync` 供乐观插入、`api` 供 `session.prompt`），
   * 外加那场会话自己（`agent` / `model` 从它身上取，见 `submit-prompt.ts`）。
   *
   * ⚠️ `session` 在这里**取态**（memo 里），但真正读它的时刻是**点提交那一刻**——所以整份
   * 返回值存进 memo、回调里再从 memo 的返回值里读，而不是把 `session.get(id)` 的**结果**
   * 冻进 memo：会话的 `agent` / `model` 会随会话里第一条消息落库而出现，冻住了就用不上。
   */
  const 提交态 = createMemo(() => {
    const 三样 = 源.ready()
    if (!三样) return undefined
    return {
      ...三样,
      sync: serverSync().ensureDirSyncContext(三样.directory),
      api: serverSDK().ensureDirSdkContext(三样.directory).api.session,
    }
  })

  /** 投影**只算一份**：四层内容同出一次投影，不给「模块 A 的卡 ＋ 模块 B 的命令」留缝。 */
  const 投影 = createMemo(() => projectCapabilities(MANIFESTS, center.module()))

  // 三样齐了才渲染（`ready` 由 `right-pane-source` 守着），省得在这里写三个 `!`
  // ——那种 `!` 没有东西守着，改了 `data` 的来历就会悄悄说谎。
  // 没有会话（首页 / 草稿页）时这里什么都不渲染，`ThreePane` 那边因此**整根右栏都不在**
  // （它判的是 `props.right !== undefined`）。
  return (
    <Show when={提交态()}>
      {(态) => (
        <SessionPanel
          data={态().data}
          directory={态().directory}
          sessionID={态().sessionID}
          projection={投影()}
          // T010 / FR-007：Hero 输入框那一行正文，交给 `submit-prompt.ts`（它再交给
          // 上游的 `sendFollowupDraft`）。`sendFollowupDraft` **失败时会把异常抛回来**
          // ⇒ 这里必须接住：不接就是一条没人看的 unhandled rejection，而界面上只是
          // 「消息闪了一下又没了」——按上游同款（`open-in-app.tsx` 的 `notifyError`）给一句回话。
          onSubmitPrompt={(text) => {
            const 现在 = 态()
            // ⚠️ 返回这个承诺（不 `void` 掉）：右栏按它的回话决定**要不要清空输入框**
            // ——`false` 时正文留着（`session-panel.tsx` 的 `onSubmit`）。`catch` 里回 `false`
            // 正是「抛了 ＝ 没发出去」这一支：toast 报完错，用户那句话还在框里，可以直接重试。
            return submitRightPanePrompt({
              text,
              sessionID: 现在.sessionID,
              sessionDirectory: 现在.directory,
              session: 现在.sync.session.get(现在.sessionID),
              api: 现在.api,
              serverSync: serverSync(),
              sync: 现在.sync,
            }).catch((err: unknown) => {
              showToast({
                variant: "error",
                title: language.t("common.requestFailed"),
                description: err instanceof Error ? err.message : String(err),
              })
              return false
            })
          }}
        />
      )}
    </Show>
  )
}
