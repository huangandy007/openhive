import { useLocation, useNavigate } from "@solidjs/router"
import { createMemo, Show, type JSX } from "solid-js"
import { useCenterTabs } from "@/center/tab-context"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { downloadSessionExport } from "@/utils/session-export"
import { showToast } from "@/utils/toast"
import { MANIFESTS } from "./capabilities"
import { projectCapabilities } from "./projection"
import { createRightPaneSource } from "./right-pane-source"
import { 删除后去哪, 在途守卫, 导出会话, 建会话, 删会话, 会话路径 } from "./session-actions"
import { SessionDocks } from "./session-docks"
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
 * 它里面**真正会出错**的四件事都单独抽出来测了：
 * ① 「路由 → id → 目录 → 数据」那条异步链（含竞态）＝ `right-pane-source.test.tsx`；
 * ② 投影本身 ＝ `projection.test.ts`；③ **提交那一句话** ＝ `submit-prompt.test.ts`；
 * ④ **会话动作里有判断的那一半** ＝ `session-actions.test.ts`（T015：目录参数怎么传、
 *    删完去哪一场、切会话的 URL 怎么拼；T016：导出取的是哪一场、拼成什么、文件名叫什么）。
 *    本文件只负责**把它们接对**。
 *
 * ⚠️ 但**不是本文件里的一切都被测到了**（「四件事都测了」读起来仍像全覆盖）：
 * 下面这几条**只在代码上核过、没有断言守着**（`#002-02` 的口径：这就是缺口）——
 * ① `提交态` 是 `createMemo`（引用随 memo 重算释放，上面那段 refcount 讲的就是它）；
 * ② 「**点击那一刻才读**」：`态()` 是 `<Show>` 的子访问器**参数**（⚠️ 原注释把它写成了
 *    memo，名字安错了——第二轮审查核出），真正读它的时刻是回调体内（`const 现在 = 态()`），
 *    也就是点下去那一刻；
 * ③ `Show` 非 keyed —— ⚠️ 它的作用**不是**「同会话内消息增长不重挂」（原注释因果挂错了）：
 *    消息增长压根不会让 `提交态` 重算（依赖是 `源.ready()`，只读 `sessionID` / `directory` /
 *    `data`，而 `data` 按目录缓存、引用稳）。非 keyed 真正防的是「条件**仍是真值**、
 *    但**引用变了**」——例如切目录时 `ready` 返回一个新对象。
 * ④ **T015 的三根线**：`onSelectSession` / `onNewSession` / `onDeleteSession` 各自那一句
 *    `navigate(...)`（含「一场都不剩 ⇒ `/new-session`」那条分支）没有断言守着——它要一个
 *    活的路由器与活服务器才跑得起来。**有判断的那一半**（拼哪个 URL、删完去哪一场）已经抽到
 *    `session-actions.ts` 并单测覆盖，所以这里剩下的**只是「调它、把结果交给 navigate」**。
 * ⑤ **`建在途` / `删在途` 这两份守卫的接线**（Step 5 的 R-01）——同上：`在途守卫` 本身有
 *    四条单测，而「有没有把它套在那两根线上」只有人读代码看得见。
 * ⑥ **T016 导出那一句落盘**（`.then((导出物) => downloadSessionExport(...))`）——同上：
 *    `导出会话` 有四条单测、上游 `downloadSessionExport` 有上游的单测，而「有没有把**这一份**
 *    交给它」只有人读代码看得见（同文件 `session-panel.test.tsx` 钉的是「点导出交出哪一场」，
 *    钉不到这一句）。⚠️ 它旁边那句 `.catch(报错)` 同理——报不报得出来，要靠人在浏览器里拉一次
 *    网络失败才看得见。
 * ⑦ **待答闸门的接线**（`dock={…}` 那一段，本次新增）——`SessionDocks` 自己有 8 条单测
 *    （`session-docks.test.tsx`：筛法 / 挑哪一场 / 回话三字段 / 在途），而「这三样东西有没有
 *    真的喂给它」只有人读代码看得见：`permission={态().data.permission}` 那张表要是喂错、
 *    `autoResponds` 忘了传目录、或 `reply` 接成了 `api.session` 而不是 `api.permission`
 *    （**两个不同命名空间**，接错了是 `undefined.reply` 那种运行时报错，也可能被 lazy Proxy
 *    安静吞掉——见 `LEARNINGS #006-01`），界面上都只是「闸门不弹」或「点了没反应」。
 *    ⚠️ 这条**不能**用 E2E 兜底：要弹一条真闸门得让真模型跑一次真工具调用
 *    （`Permission.ask`），成本与不确定性都不合适。
 * 这几条错了都**不报错、不变红**，只有人读代码才看得见。
 */
export function AiSessionSlot(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const center = useCenterTabs()
  const language = useLanguage()
  // 待答闸门的「自动放行」筛法（`SessionDocks` 的 `autoResponds`）。`PermissionProvider` 挂在
  // `app.tsx` 里、**在所有栏之上** ⇒ 右栏这一层拿得到（与 `useServerSync()` 同一层）。
  const permission = usePermission()

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
    // 目录作用域那一份**只取一次**，两个属性各要一个（`createDirSdkContext` 同时给 `api` 与 `client`）：
    // `api.session` 给会话动作（新建 / 删除），`client`（**legacy** 客户端）给导出
    // ——`fetchSessionExport` 要的就是后者，上游三处传的也是 `sdk().client`（见 `导出会话` 的注释）。
    const 出口 = serverSDK().ensureDirSdkContext(三样.directory)
    return {
      ...三样,
      sync: serverSync().ensureDirSyncContext(三样.directory),
      api: 出口.api.session,
      client: 出口.client,
      // 待答权限的回话出口（`SessionDocks` 的 `reply`）。**与 `api` 分开取**：`api` 那一份是
      // `出口.api.session`（会话动作），权限在**另一个命名空间**上——同 `导出会话` 那条注释里
      // 说的「右栏那个会话出口上没有 `messages`」，这里只是同一件事的另一个命名空间。
      permissionApi: 出口.api.permission,
    }
  })

  /** 投影**只算一份**：四层内容同出一次投影，不给「模块 A 的卡 ＋ 模块 B 的命令」留缝。 */
  const 投影 = createMemo(() => projectCapabilities(MANIFESTS, center.module()))

  /**
   * 失败那一句话。**只有一处**——提交 / 新建 / 删除三条路都要说同一句
   * （`LEARNINGS #002-06`：同一个判断两处各写一份是缺陷的温床）。
   * 形状照上游 `open-in-app.tsx` 的 `notifyError`。
   */
  const 报错 = (err: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  /**
   * 两根线各一份**在途守卫**（`session-actions.ts` 的 `在途守卫`，Step 5 的 R-01）。
   *
   * 各配一份、不共用一份：建与删是两件不相干的事，共用一份会让「建会话还没回来时删不了」
   * ——那不是这道守卫要管的事。**切换那条不配**：它是**同步**的（只 `navigate`），
   * 没有在途窗口，连点两下最多是导航两次同一个地址。守卫本身有单元测试
   * （`session-actions.test.ts` 三条）；**下面这处接线没有**（同本文件头那条口径）。
   */
  const 建在途 = 在途守卫()
  const 删在途 = 在途守卫()

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
              报错(err)
              return false
            })
          }}
          // ── T015：会话管理三件事的**接线**（有判断的那一半在 `session-actions.ts`，有单测）──
          //
          // 三件事的落点**都是改路由**：右栏的会话 id 只有一个产地，就是 URL
          // （`route-session.ts` 文件头）。所以「切会话」不必自己维护状态——`源` 会跟着
          // `location.pathname` 重算（它的依赖就是它）。
          onSelectSession={(id) => {
            const 去 = 会话路径(location.pathname, id)
            if (去) navigate(去)
          }}
          onNewSession={() => {
            const 现在 = 态()
            // ⚠️ 建在**有目录作用域的那份 api** 上（`现在.api`），目录取自当前这场会话
            // （`建会话` 把它带进 `location.directory`）。
            //
            // ⚠️ **目录这一半曾经不生效，现在是「有条件生效」**（006 Step 5 · ②-1，2026-10-07 已修）：
            // 服务端的锚定（`anchor-workspace.ts`）把 `POST /api/session` 体里的 `location.directory`
            // **无条件**改写成沙箱根，而项目那一层（`project-location.ts`）只在拿到「当前项目」时
            // 才往上推进一段。SDK 这条链不发 `x-openhive-project` 头（带头的只有 005 那四个裸路由）
            // ⇒ 那条链**靠 cookie**：`setCurrentProject` 把当前项目写进 `openhive_project` cookie，
            // 浏览器自动带上它（`current-project.ts` 的 `writeProjectCookie`）。
            // ⇒ **当前项目选中了一个活跃项目时，会话落在它的目录里**；未选中 ⇒ 落沙箱根；
            // 选中的项目**已归档** ⇒ 当作没带、也落沙箱根（环境信号不构成归档意向，见那边文件头
            // 「第四笔裁定」）。⚠️ 别把上面那句读成「一律生效」——它的前提是**用户确实选了项目**。
            建在途(() => 建会话({ api: 现在.api, directory: 现在.directory }))
              ?.then((id) => {
                const 去 = 会话路径(location.pathname, id)
                if (去) navigate(去)
              })
              .catch(报错)
          }}
          onDeleteSession={(sessionID) => {
            const 现在 = 态()
            删在途(() => 删会话({ api: 现在.api, sessionID }))
              ?.then(() => {
                const 下一场 = 删除后去哪(现在.data.session ?? [], sessionID)
                const 去 = 下一场 === undefined ? undefined : 会话路径(location.pathname, 下一场)
                // 一场都不剩时落到**草稿页**——蓝本 `pages/session/session-archive.ts:35-38`
                // （那边是 `tabs.newDraft(...)`）。⚠️ 不能留在原地：URL 会继续指着一场已经不存在的
                // 会话，而右栏那条解析链是拿它去问服务器的（`right-pane-source.ts`）。
                navigate(去 ?? "/new-session")
              })
              .catch(报错)
          }}
          // ── T016：导出会话的**接线**（判据在 `session-actions.ts` 的 `导出会话`，有单测）──
          //
          // ⚠️ **它不在这段「落点都是改路由」的注释里**（上面那三件才是改路由）：导出的落点在
          // **文件系统**——取数回来交给上游 `downloadSessionExport`（blob ＋ `<a download>`）。
          // 这里只写「调它、把结果交给落盘」；**取的是哪一场、拼出来是什么、文件名叫什么**三件事
          // 都在单测里钉着（`session-actions.test.ts`）。
          //
          // ⚠️ 失败必须接住：`导出会话` 在「会话取不到」时**抛**（`fetchSessionExport` 那一支），
          // 不接就是一条没人看的 unhandled rejection，而界面上只是「点了导出，什么都没发生」
          // ——没有文件、也没有报错。走的是全右栏唯一那处 `报错`。
          //
          // ⚠️ 传的是 `现在.client`（**legacy**），不是 `现在.api`：右栏那个「会话出口」上
          // **没有 `messages`**（新协议的消息在另一个命名空间里）——tsgo 实测抓的，不是推断。
          onExportSession={(sessionID) => {
            const 现在 = 态()
            void 导出会话({ client: 现在.client, sessionID })
              .then((导出物) => downloadSessionExport(导出物.文件名, 导出物.数据))
              .catch(报错)
          }}
          // ── 待答闸门（权限 / 提问）的接线（本次新增）──
          //
          // ⚠️ **为什么闸门的宿主必须搬进右栏**：全仓唯一回话权限的地方是会话页级的
          // `session-composer-state.ts`，而它只被 `pages/session.tsx` 用；本次三栏改造把中栏
          // 那页在会话路由下**藏掉了**（`center-content.tsx` 的 `pageVisible`）⇒ 那两个 dock 还在
          // DOM 里但**没人点得到** ⇒ `Permission.ask` 会永远挂在 `Deferred` 上。
          // 判据与实现都在 `session-docks.tsx`；这里只负责把**三样取不到的东西**喂给它
          // （`autoResponds` 要 `usePermission()`、`reply` 要目录作用域的 api、`data` 三张表）。
          //
          // ⚠️ `sessions` / `permission` / `question` 取自 `态().data`——与右栏消息流**同一份数据**
          // （同一目录的 `DirectorySync.data`），不是另开一路取数。
          dock={
            <SessionDocks
              directory={态().directory}
              sessionID={态().sessionID}
              sessions={态().data.session}
              permission={态().data.permission}
              question={态().data.question}
              autoResponds={(请求) => permission.autoResponds(请求, 态().directory)}
              reply={(input) => 态().permissionApi.reply(input)}
            />
          }
        />
      )}
    </Show>
  )
}
