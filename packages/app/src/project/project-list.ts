import { createSignal } from "solid-js"
import type { ProjectEntry } from "./project-panel"

/**
 * 项目面板要列的那些项目——**唯一读取点**（T006 建立的接入缝，仿 `@/workspace/current-user`
 * 与 `./current-project`）。
 *
 * ## 为什么是 `| undefined`，不是空数组
 *
 * `undefined` = **还没有来源**，`[]` = **来源说了「一个项目都没有」**——这是两件事。
 * 今天前端两个都读不到（后端没有任何出口），所以缝里就是 `undefined`；等到 T018 接上真数据，
 * 一个新建用户会拿到 `[]`（合法的空），那时的空态才是「你还没有项目」。
 * 现在就把默认写成 `[]`，等于替后端**声称**了「查询成功且结果为空」——`LEARNINGS #003-04`
 * 的那类不实记述正是这么来的，而它在这里表现为：界面上一句笃定的「还没有项目」。
 *
 * ## 为什么单开一个文件，而不是塞进 `./current-project`
 *
 * `current-project.ts` 的文件头明写「只放**显示所需**的字段：项目的 id / 类型 / 共享目录等
 * 一概不进这里（那些是 T006 项目面板…要用的）」——T005 刻意把那批字段挡在缝外。本文件就是
 * 那批字段的落点：**一个缝只承载它当下要喂的那一件事**（那条注释的另一半）。
 *
 * ## 今天没有写入方（这不是缺陷，是本 task 的裁定）
 *
 * 用户 2026-10-06 裁定 T006 范围 = **前端面板 ＋ 接缝**：不新增后端 API、不真落库。
 * 「谁把真数据写进来」的落库缺口由 **T018** 认领（`tasks.md`），本 task 只把缝立起来、
 * 让面板与接线**今天就能被测试驱动**（`workspace-entry.test.tsx` 正是这么验的）。
 */
export const [projectList, setProjectList] = createSignal<readonly ProjectEntry[] | undefined>()
