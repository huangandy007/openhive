import { useLocation, useNavigate } from "@solidjs/router"
import { createMemo, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { currentProject } from "@/project/current-project"
import { projectList } from "@/project/project-list"
import { sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"
import { routeSessionID } from "./route-session"
import { 删除后去哪, 当前项目目录, 在途守卫, 建会话, 删会话, 重命名会话 } from "./session-actions"
import { SessionList } from "./session-list"

/**
 * 左栏「会话」tab 的**生产组装**（2026-10-08）：把两份 context ＋ 两个信号接进 `SessionList`。
 *
 * ## 目录从哪儿来——**只有这一条路**
 *
 * `当前项目 → 项目清单里那一行的 directory`（`当前项目目录` 那条纯判断，有单测）。
 *
 * ⚠️ **不走「会话自己身上的 directory」**（右栏那条路，`right-pane-source.ts` 的 `directoryOf`
 * 是「拿 id 问服务器」）：左栏要列的是一个目录下的**会话表**，而它手上还没有任何一场会话
 * ——用它去问目录是循环的。项目那一行上的 `directory` 是服务端**算出来的**
 * （`{沙箱根}/{userId}/{projectId}`，见 `packages/opencode/src/server/openhive/project.ts`
 * 的出参说明与 `auth/workspace.ts` 的 `projectDirectory`）。
 *
 * ## 左右栏必须落在**同一个目录缓存槽**上
 *
 * 两边都调 `useServerSync().ensureDirSyncContext(目录)`，而它是 `createRefCountMap`（按目录字符串
 * 认槽）⇒ 同一个目录天然是同一份 `DirectorySync`（同一份 `data.session`），不必也不该再开一路取数。
 * 这条是**接线**、没有断言守着（下面「这个文件不带测试」那条）；能钉的是**判据**那一半
 * （`当前项目目录` 有单测）。
 *
 * ## ⚠️ 切会话的 URL **不走 `会话路径`**（2026-10-09 修，别改回去）
 *
 * `session-actions.ts` 的 `会话路径(pathname, id)` 开口第一句是
 * `if (routeSessionID(pathname) === undefined) return undefined`——**「当前已经在会话路由上」**。
 * 那条前提对**右栏**成立（右栏整根只在会话路由下渲染，见 `ai-session-slot.tsx` 的
 * `<Show when={提交态()}>`），对**左栏**恰恰不成立：左栏常驻，用户正是在**项目页**（URL = `/`）
 * 上点它。⇒ `"/"` 解不出会话 id ⇒ 返回 `undefined` ⇒ 调用点那句 `if (去) navigate(去)`
 * **静默跳过**：点击成功、不报错、URL 一个字不动（用户 2026-10-09 实报：「可以显示会话的名称
 * 列表，但是点击……无法打开其对应的 AI 会话界面」）。
 *
 * 左栏与右栏缺的那一半不同：右栏只有 `useLocation().pathname`，所以它只能**从路径推路径**；
 * 左栏手上有**真连接**（`useServerSDK()`）⇒ 服务器 key 直接向它要，走
 * `sessionHref(ServerConnection.key(serverSDK().server), id)`——与 `context/prompt.tsx:104`
 * 那个既有写法同源。⚠️ **别把 `会话路径` 改宽松**：它对右栏是对的，而且
 * `session-actions.test.ts` 用例③ 已把「非会话路由 ⇒ `undefined`、一个字都不拼」钉成**契约**。
 * 这条缺陷的判据在 `e2e/real-stack/sidebar-session-nav-real.spec.ts`（那里必须**从项目页点**）。
 *
 * ## 这个文件为什么不带测试（`LEARNINGS #002-02`：测不了要写成缺口，不是写成覆盖）
 *
 * 它依赖 `useServerSync()`，而那个 provider 要一个**活着的服务器连接**才建得起来
 * ⇒ 在 `bun test` 里挂不起来（同 `ai-session-slot.tsx` 文件头那条）。**有判断的那一半都抽出去
 * 单测了**：① 目录从哪来 ＝ `session-actions.test.ts` 的 `当前项目目录` 七条；
 * ② 切会话的 URL ＝ `utils/session-route.test.ts` 的 `sessionHref`（**左栏走的这条**，
 *    不是 `会话路径`——理由见上面那一段）；③ 新建会话的形状 ＝ 同文件 `建会话`；
 * ④ 列哪几场 ＝ `session-list.test.tsx`（筛法复用右栏的 `可列出的会话`）。
 *
 * **本文件剩下的、没有断言守着的**（这就是缺口，不是「已覆盖」）：
 * ① 「两个 `ensureDir*Context` 是在**有 owner 的 `createMemo` 里**取的」（`createRefCountMap`
 *    的释放走 `onCleanup`；在点击回调里现取就是每次涨一份永不释放的目录上下文，不报错、不变红
 *    ——与 `ai-session-slot.tsx` 那条同因）；
 * ② 「左右栏落在同一个缓存槽」（上面那段）——只有人读代码看得见；
 * ③ 四根线各自的 `navigate(...)`，以及「建会话落在**有目录作用域的那份 api** 上」；
 * ④ `新建` / `删除` 那两份 `在途守卫` 的接线（守门本身有四条单测，套没套上去看不见）；
 * ⑤ **`新建` 失败仍然静默**（与 `重命名` / `删除` 那两条**不一致**）：原先的理由是「左栏没有
 *    一句话可说的地方」——2026-10-09 实测**证伪**（`showToast` 是模块级的、`LanguageProvider`
 *    在很外层 ⇒ 左栏取得到，`报错` 就在本文件里）。没顺手改是因为那是本次任务之外的既有行为。
 *    后果如实记：点了＋没反应时，用户仍然只看到「没反应」。
 * ⑥ `重命名` / `删除` 这两条**新接线**本身（判据全在 `session-actions.ts`，有单测；本处只是
 *    「调它、把结果交给 navigate / 报错」）——与 `ai-session-slot.tsx` 文件头 ④ / ⑧ 同口径。
 */
export function SidebarSessions(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const language = useLanguage()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()

  /**
   * 该去哪个目录取会话——**判断全在 `当前项目目录` 里**（含「已归档 ⇒ 没有目录」那条）。
   * 这里只负责把两个信号喂进去。
   */
  const 目录 = createMemo(() => 当前项目目录(currentProject()?.id, projectList()))

  /**
   * 会话表。⚠️ **读 `ensureDirSyncContext` 必须落在有 owner 的计算里**（见文件头 ①）
   * ⇒ 包 `createMemo`，不是为了好看。
   *
   * `undefined` ＝ 还没取到（`SessionList` 那一侧据此**不画空态**：说「暂无会话」等于把
   * 「还没问到」说成「问到了，一场都没有」）。
   */
  const 表 = createMemo(() => {
    const 现在 = 目录()
    if (现在 === undefined) return undefined
    const 槽 = serverSync().ensureDirSyncContext(现在)
    // ⚠️ **第三态**：目录已知、可它的表**还没问到** ⇒ 交 `undefined`，**不是** store 里那个 `[]`。
    // 新目录的 `session` 一建出来就是 `[]`（`global-sync/child-store.ts` 的初值），原样交出去，
    // 下游那道空态守卫就会把「还没问到」画成「暂无会话」——2026-10-09 用户实报的正是它（切到
    // 第一次访问的项目，左栏先空几秒、显示「暂无会话」，之后才列出）。
    // 判据是 `sessionsLoaded`（`global-sync/types.ts`）：`session` 的初值分不出「没有」与「没问到」，
    // 而 `status` 在慢批开始前就翻成 `partial`，同样分不出。它俩都是 store 上的字段 ⇒ 在同一个
    // memo 里读，两件事都会驱动这一次重算。
    return 槽.data.sessionsLoaded ? 槽.data.session : undefined
  })

  /**
   * 建会话要用的那一份 `api`（目录作用域）。**同样必须取在 memo 里**（文件头 ①）——
   * 与右栏那条对称：`出口.api.session` 给会话动作。
   */
  const 出口 = createMemo(() => {
    const 现在 = 目录()
    return 现在 === undefined ? undefined : serverSDK().ensureDirSdkContext(现在).api.session
  })

  /**
   * 切会话要去的 URL（见文件头「切会话的 URL **不走 `会话路径`**」那一段）。
   *
   * **服务器 key 向手上的真连接要**（`serverSDK().server`），不从 pathname 里认——左栏在
   * 项目页 / 首页上也渲染，那时 pathname 里根本没有服务器段。三根线（切 / 新建后 / 删完去哪）
   * 共用这一处（`LEARNINGS #002-06`：同一个判断两处各写一份，早晚不等）。
   */
  const 会话URL = (id: string) => sessionHref(ServerConnection.key(serverSDK().server), id)

  /** 新建那一根线的在途守卫（文件头 ④）。**切换那条不配**——它是同步的，没有在途窗口。 */
  const 建在途 = 在途守卫()
  /**
   * 删除那一根线的在途守卫——**与新建各一份、不共用**（同右栏那处的理由：两件不相干的事，
   * 共用一份会让「新建还没回来时删不了」）。
   *
   * 删除在左栏是**新增**的动作（2026-10-09 用户下达），所以这一份是新的接线、**没有断言守着**
   * （文件头 ④ 的口径）。
   */
  const 删在途 = 在途守卫()

  /**
   * 失败那一句话。**形状与右栏那处逐字同源**（`ai-session-slot.tsx` 的 `报错`），而 `showToast`
   * 是**模块级函数**、`LanguageProvider` 也在很外层 ⇒ 左栏取得到（这一点原先的文件注释说反了，
   * 见下面 `onNewSession` 那处更正的注释）。
   *
   * ⚠️ 仓里这个形状有 ~20 处先例（`grep 'common.requestFailed'`）⇒ 每个文件各写一份是**既有
   * 惯例**，不是「同一个判断两处各写一份」（`LEARNINGS #002-06` 讲的是同一件事的**判据**——
   * 例如 trim / 比较 / 请求形状，那些都在 `session-actions.ts` 里各只有一份）。
   */
  const 报错 = (err: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  return (
    <SessionList
      directory={目录()}
      sessions={表()}
      // 当前会话 id 只有一个产地，就是 URL（同 `route-session.ts` 文件头）。
      currentID={routeSessionID(location.pathname)}
      // 切会话 ＝ 改路由：右栏的解析链跟着 `location.pathname` 重算（`创建` 那句注释）。
      // 目标 URL 的拼法见 `会话URL`（**不是** `会话路径`——那条要求「已经在会话路由上」）。
      onSelect={(id) => navigate(会话URL(id))}
      onNewSession={(directory) => {
        const api = 出口()
        if (api === undefined) return
        建在途(() => 建会话({ api, directory }))
          ?.then((id) => {
            navigate(会话URL(id))
          })
          .catch(() => {
            // ⚠️ **这一处仍然静默**（与下面两条**不一致**，如实记着、不顺手改）：原注释写「左栏
            // 没有一句话可说的地方（那两处 `showToast` 都在右栏）」——**已实测证伪**：`showToast` 是
            // 模块级函数、`LanguageProvider` 在 `app.tsx` 很外层，左栏取得到（`报错` 就在上面）。
            // 不改它是因为那是**本次任务之外**的既有行为（改了会动到用户没点名的那条线）；本处只保证
            // **不产生一条没人看的 unhandled rejection**，并把它记进文件头缺口表的 ⑤。
          })
      }}
      // ── 重命名 / 删除：右栏那两条线的**第二个入口**（2026-10-09 用户下达）──
      //
      // ⚠️ 判据**一行都不在这里**：改名的 trim / 比较走 `改名草稿`，请求走 `重命名会话`；
      // 删除走 `删会话`，「删完去哪」走 `删除后去哪`——与右栏调的是**同一批函数**（用户原话：
      // 「与 1 中的功能一致，直接复用，不要重复造轮子」）。本文件只负责「调它、把结果交给 navigate」。
      onRenameSession={(sessionID, title) => {
        const api = 出口()
        if (api === undefined) return
        // 不配在途守卫：改名只写一场会话的标题，且提交那一刻输入框就卸载了 ⇒ 界面上没有第二次
        // 点击可发（与右栏同一条理由，`LEARNINGS #006-16`：别写走不到的守卫）。
        void 重命名会话({ api, sessionID, title }).catch(报错)
      }}
      onDeleteSession={(sessionID) => {
        const api = 出口()
        if (api === undefined) return
        删在途(() => 删会话({ api, sessionID }))
          ?.then(() => {
            // 「删完去哪」与右栏**同一处判断**（`删除后去哪`）。⚠️ 一场都不剩时要落到草稿页，
            // 理由同右栏那段：URL 会继续指着一场已经不存在的会话，而右栏那条解析链是拿它去问
            // 服务器的（`right-pane-source.ts`）。
            const 下一场 = 删除后去哪(表() ?? [], sessionID)
            navigate(下一场 === undefined ? "/new-session" : 会话URL(下一场))
          })
          .catch(报错)
      }}
    />
  )
}
