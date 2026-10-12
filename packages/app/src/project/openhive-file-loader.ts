/**
 * 005 / 001 · 2026-10-12：中栏视图的**取数出口**——把「当前项目 + 这个路径」读成内容。
 *
 * ## 为什么单独一个模块，而不是在 `layout-new.tsx` 里写个箭头函数
 *
 * `load` 会一路传进视图组件（`<Dynamic ... load={props.load} />`）。写成内联箭头 ⇒ **每次
 * 父组件重渲染都换一个新函数身份** ⇒ 视图那一层每重渲染就可能重新取一次文件（PDF 回到
 * 第一页、表格重建）。一个**模块级常量**身份恒定，重渲染不触发任何重取。
 *
 * ## 为什么项目 id 在**调用时**读，而不是在造这个函数时读
 *
 * 与 `listProjectFiles` 的调用侧同一时刻：左栏那棵树就是按 `currentProject()` 建的，
 * 树里的路径只在那一个项目里有意义。换项目时 `workspace-entry` 会把中栏两栏一起清空
 * （见那边「换项目就清空中栏」那条），所以这里读到的一定还是同一份。
 *
 * ## 为什么导出 `create` 这个工厂
 *
 * `LOAD_PROJECT_FILE` 用真 `defaultSend`（真打接口）；单测要注入替身，就得有个口子。
 * 与 `listProjectFiles(projectId, send = defaultSend)` 同一个范式：**替身停在边界上**
 * （`LEARNINGS #002-02`）。
 */

import type { LoadFileContent } from "@/center/file-content"
import { currentProject } from "./current-project"
import { defaultSend } from "./openhive-fetch"
import { readProjectFile, type ProjectFilesFetch } from "./openhive-files"

export function createLoadProjectFile(send: ProjectFilesFetch = defaultSend): LoadFileContent {
  return async (path) => {
    const id = currentProject()?.id
    // 没有当前项目就没有可读的文件：**一个请求都不发**。带一个空项目 id 发出去，
    // 服务端会退回沙箱根（所有项目的父目录）——那正是 `PROJECT_HEADER` 那条注释防的同一件事。
    if (id === undefined) return undefined
    return readProjectFile(id, path, send)
  }
}

/** 生产那一份（`layout-new.tsx` 注入的就是它）。 */
export const LOAD_PROJECT_FILE: LoadFileContent = createLoadProjectFile()
