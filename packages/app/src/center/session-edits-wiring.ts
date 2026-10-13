import { createEffect, createMemo, onCleanup } from "solid-js"
import { 当前项目目录 } from "@/ai-session/session-actions"
import { useServerSDK } from "@/context/server-sdk"
import { currentProject } from "@/project/current-project"
import { projectList } from "@/project/project-list"
import { 归一事件路径, 清空会话改过, 记会话改过 } from "./session-edits"

/**
 * 把「内核说这个文件被改了」接进登记处（2026-10-13 用户实报）。
 *
 * ## 信号源：`file.edited`，**只有**三个工具发
 *
 * `edit` / `write` / `apply_patch` 在**写盘成功后**主动 `events.publish(FileSystem.Event.Edited, …)`
 * （三个文件各一处，`grep -rn "FileSystem.Event.Edited" packages/opencode/src/tool/`）。它们**不**依赖
 * `OPENCODE_EXPERIMENTAL_FILEWATCHER`（那是 OS watcher 的开关，本机未开、包内默认 false）——所以
 * 用户选定的「**只认本平台 AI 会话的改动**」这个口径，恰好就是这一条事件的自然边界。
 *
 * ⚠️ **不要改用 `file.watcher.updated`**：那个同源事件除了三个工具会发，OS watcher 也会发
 * （`packages/opencode/src/tool/edit.ts:116` 与它并列的那条就是），两者在前端**分不出来**
 * ⇒ 用户自己在编辑器里存一下也会亮圆点，那是「本平台 AI 改的」之外的话。
 *
 * ## 为什么在这一层挂
 *
 * 它要 `useServerSDK()`（目录作用域的 SDK 由上游造，够不着事件总线）＋ 「当前项目目录」两个信号，
 * 而 `WorkspaceEntry` 是被组件测试**裸挂**的（不挂任何 provider，见它 `loadFile` 那段注释）
 * ⇒ 只能挂在它之上、且落在 `ServerSDKProvider` 之内的那一层（`pages/layout-new.tsx`）。
 * 同一个范式在 `pages/layout.tsx:389` 已有一处（worktree 事件）。
 *
 * ⚠️ 这个模块**只在这一层 import**（`layout-new.tsx`）——它把 SDK 拖进来，别让中栏的组件测试
 * （`tab-bar` / `center-content`）经 `session-edits.ts` 间接吃到它（那些测试是裸挂的）。
 */
export function 监听会话改过() {
  const serverSDK = useServerSDK()
  /** 当前项目的目录——与左栏会话列表用的是**同一个**函数（`当前项目目录`），不另写一份判据。 */
  const 本目录 = createMemo(() => 当前项目目录(currentProject()?.id, projectList()))

  /**
   * 换项目 ⇒ 清掉上一份登记。
   *
   * 相对路径在两个项目里会重名（甲项目有 `黄怡群/123.md`，乙项目也有）⇒ 不清的话，新项目一打开
   * 就顶着一个属于旧项目的圆点，而用户在新项目里什么都没改过。判据是**目录变了**（不是「id 变了」），
   * 与上面那条「事件属不属于本项目」用的是同一个值。
   */
  createEffect<string | undefined>((上一个目录) => {
    const 目录 = 本目录()
    if (上一个目录 !== undefined && 上一个目录 !== 目录) 清空会话改过()
    return 目录
  })

  /**
   * 订上事件流。`createEffect` 读 `serverSDK()`：换服务器会重订一次，`onCleanup` 摘掉上一轮的
   * （监听挂在全局总线上，不摘就会跨用例 / 跨连接残留——`#005-27` 那一族的收尾纪律）。
   */
  createEffect(() => {
    const stop = serverSDK().event.listen((e) => {
      if (e.details?.type !== "file.edited") return
      // ⚠️ `本目录()` 在这个异步回调里读是**有意的**：读到的是**此刻**的项目目录（不进依赖图 ⇒
      //    不会因为换项目就重订一次事件流）。判「是不是本项目的文件」在 `归一事件路径` 里，
      //    与本模块的清除判据同一个值来源。
      const 相对 = 归一事件路径(e.name, 本目录(), e.details.properties.file)
      if (相对) 记会话改过(相对)
    })
    onCleanup(stop)
  })
}
