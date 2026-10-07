import { useLocation } from "@solidjs/router"
import { createMemo, Show, type JSX } from "solid-js"
import { useCenterTabs } from "@/center/tab-context"
import { useServerSync } from "@/context/server-sync"
import { MANIFESTS } from "./capabilities"
import { projectCapabilities } from "./projection"
import { createRightPaneSource } from "./right-pane-source"
import { SessionPanel } from "./session-panel"

/**
 * 右栏（AI 会话）的**生产组装**（T008 / FR-010）：把三份 context 接进
 * `createRightPaneSource` + `SessionPanel`。
 *
 * ## 三份 context 各自解决什么
 *
 * - `useLocation()` → **当前会话 id**。右栏在 shell 层，拿不到 `:id` 路由参数（见 `route-session.ts`
 *   文件头）。
 * - `useServerSync()` → **会话数据**。`ServerSyncProvider` 由 `app.tsx` 的 `NewAppLayout`
 *   → `SelectedServerProviders` 提供，而 `NewLayout` 是它的后代 ⇒ 这一层**取得到**
 *   （⚠️ `SDKProvider` / `SyncProvider` **不在**这一层，见 `plan.md §②` 的更正）。
 * - `useCenterTabs()` → **当前模块**，用来算指令卡 / skill 的投影（`projectCapabilities`）。
 *   它由 `WorkspaceEntry` 自己建 ⇒ 本组件必须**创建在那个 provider 之内**（`right` 这个 prop
 *   收的是**访问器**而不是现成的元素，要的就是这条，见 `workspace-entry.tsx` 上那段注释）。
 *
 * ## 这个文件为什么不带测试
 *
 * 它是**纯接线**（下面十几行没有分支、没有状态），而它依赖的三份 context 里，`useServerSync()`
 * 的 provider 要一个**活着的服务器连接**才建得起来 ⇒ 在 `bun test` 里挂不起来。按
 * `LEARNINGS #002-02`：**「测不了」要如实写成「缺口」，不能写成「覆盖」**——已记进
 * `docs/superpowers/specs/006-ai-session/state.md` 的缺口表。
 * 它里面**真正会出错**的两件事都单独抽出来测了：
 * ① 「路由 → id → 目录 → 数据」那条异步链（含竞态）＝ `right-pane-source.test.tsx`；
 * ② 投影本身 ＝ `projection.test.ts`。本文件只负责**把它们接对**。
 */
export function AiSessionSlot(): JSX.Element {
  const location = useLocation()
  const serverSync = useServerSync()
  const center = useCenterTabs()

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

  /** 投影**只算一份**：四层内容同出一次投影，不给「模块 A 的卡 ＋ 模块 B 的命令」留缝。 */
  const 投影 = createMemo(() => projectCapabilities(MANIFESTS, center.module()))

  // 三样齐了才渲染（`ready` 由 `right-pane-source` 守着），省得在这里写三个 `!`
  // ——那种 `!` 没有东西守着，改了 `data` 的来历就会悄悄说谎。
  // 没有会话（首页 / 草稿页）时这里什么都不渲染，`ThreePane` 那边因此**整根右栏都不在**
  // （它判的是 `props.right !== undefined`）。
  return (
    <Show when={源.ready()}>
      {(就绪的) => (
        <SessionPanel
          data={就绪的().data}
          directory={就绪的().directory}
          sessionID={就绪的().sessionID}
          projection={投影()}
        />
      )}
    </Show>
  )
}
