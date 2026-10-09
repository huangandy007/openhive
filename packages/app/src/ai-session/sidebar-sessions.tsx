import { useLocation, useNavigate } from "@solidjs/router"
import { createMemo, type JSX } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { currentProject } from "@/project/current-project"
import { projectList } from "@/project/project-list"
import { routeSessionID } from "./route-session"
import { 当前项目目录, 在途守卫, 建会话, 会话路径 } from "./session-actions"
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
 * ## 这个文件为什么不带测试（`LEARNINGS #002-02`：测不了要写成缺口，不是写成覆盖）
 *
 * 它依赖 `useServerSync()`，而那个 provider 要一个**活着的服务器连接**才建得起来
 * ⇒ 在 `bun test` 里挂不起来（同 `ai-session-slot.tsx` 文件头那条）。**有判断的那一半都抽出去
 * 单测了**：① 目录从哪来 ＝ `session-actions.test.ts` 的 `当前项目目录` 七条；
 * ② 切会话的 URL ＝ 同文件 `会话路径`；③ 新建会话的形状 ＝ 同文件 `建会话`；
 * ④ 列哪几场 ＝ `session-list.test.tsx`（筛法复用右栏的 `可列出的会话`）。
 *
 * **本文件剩下的、没有断言守着的**（这就是缺口，不是「已覆盖」）：
 * ① 「两个 `ensureDir*Context` 是在**有 owner 的 `createMemo` 里**取的」（`createRefCountMap`
 *    的释放走 `onCleanup`；在点击回调里现取就是每次涨一份永不释放的目录上下文，不报错、不变红
 *    ——与 `ai-session-slot.tsx` 那条同因）；
 * ② 「左右栏落在同一个缓存槽」（上面那段）——只有人读代码看得见；
 * ③ 两根线各自的 `navigate(...)`，以及「建会话落在**有目录作用域的那份 api** 上」；
 * ④ `新建` 那份 `在途守卫` 的接线（守门本身有四条单测，套没套上去看不见）。
 */
export function SidebarSessions(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
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
    return 现在 === undefined ? undefined : serverSync().ensureDirSyncContext(现在).data.session
  })

  /**
   * 建会话要用的那一份 `api`（目录作用域）。**同样必须取在 memo 里**（文件头 ①）——
   * 与右栏那条对称：`出口.api.session` 给会话动作。
   */
  const 出口 = createMemo(() => {
    const 现在 = 目录()
    return 现在 === undefined ? undefined : serverSDK().ensureDirSdkContext(现在).api.session
  })

  /** 新建那一根线的在途守卫（文件头 ④）。**切换那条不配**——它是同步的，没有在途窗口。 */
  const 建在途 = 在途守卫()

  return (
    <SessionList
      directory={目录()}
      sessions={表()}
      // 当前会话 id 只有一个产地，就是 URL（同 `route-session.ts` 文件头）。
      currentID={routeSessionID(location.pathname)}
      // 切会话 ＝ 改路由：右栏的解析链跟着 `location.pathname` 重算（`创建` 那句注释）。
      onSelect={(id) => {
        const 去 = 会话路径(location.pathname, id)
        if (去) navigate(去)
      }}
      onNewSession={(directory) => {
        const api = 出口()
        if (api === undefined) return
        建在途(() => 建会话({ api, directory }))
          ?.then((id) => {
            const 去 = 会话路径(location.pathname, id)
            if (去) navigate(去)
          })
          .catch(() => {
            // 失败**不在这里回话**：左栏没有一句话可说的地方（那两处 `showToast` 都在右栏）。
            // 后果如实记：用户看到的是「点了＋，没反应」。新建的真实报错路径由右栏那条线覆盖
            // （`ai-session-slot.tsx` 的 `报错`），本处只保证**不产生一条没人看的
            // unhandled rejection**。
          })
      }}
    />
  )
}
