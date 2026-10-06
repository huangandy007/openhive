import { createSignal } from "solid-js"

/**
 * 当前项目的文件路径清单——左栏文件树（`file-tree.tsx`）的**数据接入缝**。
 *
 * 与 `project-list.ts` 同型同因：`workspace-entry.tsx` 是唯一接线处，但它**拿不到文件列表**
 * （那要 `useSDK()`，六层 provider 之下才有），所以由缝在中间转一手——组件只认缝，
 * 应用入口（或以后的模块动作）往缝里写。
 *
 * `| undefined` 与 `[]` 说的**不是**一件事，别合并：
 * - `undefined` = 还没有来源（今天就是这一态）；
 * - `[]` = 来源明确说了「这个项目一个文件都没有」。
 *
 * ⚠️ 今天**没有写入方**：把文件列表接进来（`GET /file` 或项目沙箱目录）是
 * `005/tasks.md` 的 **T018**（项目落库 ＋ HTTP 出口）之后的欠账，已在 `state.md` 挂账。
 * 在那之前左栏文件树恒走空态——**这是据实显示，不是占位**。
 */
export const [projectFiles, setProjectFiles] = createSignal<readonly string[] | undefined>()
