import { createEffect, createMemo, onCleanup } from "solid-js"
import { 当前项目目录 } from "@/ai-session/session-actions"
import { useServerSDK } from "@/context/server-sdk"
import { currentProject } from "@/project/current-project"
import { projectList } from "@/project/project-list"
import { 事件改动, 清空会话改过, 记会话改过 } from "./session-edits"
import { 清空表格缓存 } from "./views/sheet/sheet-state-cache"

/**
 * 把「内核说这个文件被改了」接进登记处（2026-10-13 用户实报）。
 *
 * ## 两个信号源，缺一不可
 *
 * ① **`file.edited`**：`edit` / `write` / `apply_patch` 在**写盘成功后**主动
 *    `events.publish(FileSystem.Event.Edited, …)`（三个文件各一处，`grep -rn
 *    "FileSystem.Event.Edited" packages/opencode/src/tool/`）。它只覆盖这三个工具写的**文本**。
 *
 * ② **`message.part.updated` 里的 `patch` 分片**（2026-10-23 用户实报「Excel 改完连圆点都没有」
 *    之后补的）：每条助手消息收尾时，内核用 git 快照算出「这一轮盘上到底变了哪些文件」
 *    （`session/processor.ts` 的 cleanup → `snapshot.patch()`），与**用什么工具写的无关**
 *    ——`bash` ＋ python 改的 xlsx、脚本生成的 docx/pdf 都在里面。openhive 建项目时必
 *    `git init`（`server/openhive/project.ts`），故这条信号每个项目都有。
 *    只在**一轮 AI 干完活**时来一次（不是每次写），对「改完一段再来看」的用法正合适。
 *
 * 两者走**同一个**归一（`事件改动` → `归一事件路径`）：patch 分片里的路径也是绝对、`/` 分隔的。
 *
 * ⚠️ **不要改用 `file.watcher.updated`**：那个同源事件除了三个工具会发，OS watcher 也会发
 * （`packages/opencode/src/tool/edit.ts:116` 与它并列的那条就是），两者在前端**分不出来**
 * ⇒ 用户自己在编辑器里存一下也会亮圆点，那是「本平台 AI 改的」之外的话。而且它受
 * `OPENCODE_EXPERIMENTAL_FILEWATCHER` 开关（默认 false）与「项目是 git 仓库」两个前提约束。
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
    if (上一个目录 !== undefined && 上一个目录 !== 目录) {
      清空会话改过()
      // 表格缓存键里含项目身份，换项目后本来就不会误命中；但换**回**旧项目时，
      // 旧键仍会指向上次落盘的内容（可能已被另一个会话改过）⇒ 换项目一律清掉，
      // 让下一次打开重新解析，而不是拿换项目前的数据冒充当前项目的字节。
      清空表格缓存()
    }
    return 目录
  })

  /**
   * 订上事件流。`createEffect` 读 `serverSDK()`：换服务器会重订一次，`onCleanup` 摘掉上一轮的
   * （监听挂在全局总线上，不摘就会跨用例 / 跨连接残留——`#005-27` 那一族的收尾纪律）。
   */
  createEffect(() => {
    const stop = serverSDK().event.listen((e) => {
      if (!e.details) return
      // ⚠️ `本目录()` 在这个异步回调里读是**有意的**：读到的是**此刻**的项目目录（不进依赖图 ⇒
      //    不会因为换项目就重订一次事件流）。判「是不是本项目的文件」在 `归一事件路径` 里，
      //    与本模块的清除判据同一个值来源。
      //
      // 两种信号源（详见 `事件改动`）：`file.edited` 只覆盖三个文本工具；`patch` 分片
      // 覆盖一整轮里盘上的**所有**变化（脚本改 xlsx / docx / pdf 也算）。
      for (const 相对 of 事件改动(e.name, 本目录(), e.details)) 记会话改过(相对)
    })
    onCleanup(stop)
  })
}
