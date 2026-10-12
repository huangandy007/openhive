/**
 * 005 / 001 · 2026-10-12：中栏视图的**存盘出口**——把「当前项目 + 这个路径」的正文写回盘上。
 *
 * 与 `openhive-file-loader.ts`（取数那一侧）**逐条同构**，那三条理由不再重复：
 * ① 模块级常量而不是内联箭头函数（身份恒定，父组件重渲染不会换掉它）；
 * ② 项目 id 在**调用时**读 `currentProject()`；
 * ③ 导出工厂，单测把替身停在边界上（`LEARNINGS #002-02`）。
 *
 * ## 为什么要把 `FileOpOutcome` 折成 `SaveFileResult`
 *
 * 项目层那条线有三种结论（`done` / `rejected` / `failed`），视图层只要两种：**成了**与
 * **没成、为什么**。折在这一层（而不是让视图去认 `kind` 那套词汇）有两条好处：视图不必
 * import 项目层（`@/center/file-content` 文件头那条规矩），而**两种「没成」的那句原话都留着**
 * ——陈旧要重开一次、越界要换个地方存，对民警是不同的处置，折成一句兜底等于把办法吞掉。
 *
 * ⚠️ 这句话**不是给民警看的**（界面还有一层自己的说法）——它是**契约**：服务端说得出为什么时
 * 用它那句，说不出（网络断 / 内核旧版回 HTML）时才落到我们这句兜底（`WRITE_FAILED`）。
 */

import type { SaveFileContent } from "@/center/file-content"
import { currentProject } from "./current-project"
import { defaultSend } from "./openhive-fetch"
import { saveFile, type FileOpsFetch } from "./openhive-file-ops"

/**
 * 没有当前项目时那句话。
 *
 * 与取数那一侧**必须**在这里拦住的理由一字相同：带一个空项目 id 发出去，服务端会退回
 * **沙箱根**（所有项目的父目录），于是这次「存盘」写的可能是另一个项目里的同名文件。
 * 存储层那个 `undefined` 不是「先试试看」而是「本来就没得存」——四个字：不发请求。
 */
const 没项目 = "现在没有打开的项目，改动没能存回去。"

export function createSaveProjectFile(send: FileOpsFetch = defaultSend): SaveFileContent {
  return async (path, content, base) => {
    const id = currentProject()?.id
    if (id === undefined) return { ok: false, message: 没项目 }
    const 结论 = await saveFile(id, path, content, base, send)
    return 结论.kind === "done" ? { ok: true } : { ok: false, message: 结论.message }
  }
}

/** 生产那一份（`layout-new.tsx` 注入的就是它）。 */
export const SAVE_PROJECT_FILE: SaveFileContent = createSaveProjectFile()
