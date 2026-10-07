import { createSignal } from "solid-js"

/**
 * 当前项目的文件路径清单——左栏文件树（`file-tree.tsx`）的**数据接入缝**。
 *
 * 与 `project-list.ts` 同型同因：`workspace-entry.tsx` 是唯一接线处，但它**拿不到文件列表**
 * （那要 `useSDK()`，六层 provider 之下才有），所以由缝在中间转一手——组件只认缝，
 * 应用入口（或以后的模块动作）往缝里写。
 *
 * `| undefined` 与 `[]` 说的**不是**一件事，别合并：
 * - `undefined` = 取不到（还没选项目，或那一趟取数失败了）；
 * - `[]` = 取到了，这个项目一个文件都没有。
 *
 * 写入方只有一个：`workspace-entry.tsx` 的 `拉清单`（T018 落地，走 `ProjectData.files`）。
 * 文件动作办成之后（复制 / 移动 / 上传）它会被**再拨一次**——见那里的 `清单重取`
 * （T020）：树上的位置换了靠的是重取，不是就地改这份数组。
 */
export const [projectFiles, setProjectFiles] = createSignal<readonly string[] | undefined>()
