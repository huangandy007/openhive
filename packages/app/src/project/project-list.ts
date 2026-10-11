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

/**
 * 「**上一次**拉清单没拉到」（2026-10-11 用户实报）。`undefined` ＝ 还没问过 / 没失败
 * ——与 `RightPaneSource.failure` 同一口径（那里写着：`undefined` **也包括**「还没问回来」，
 * 那是 `pending`，与「失败」在界面上正好相反）。
 *
 * ## 为什么它是**第二个信号**，不是把 `projectList` 改成三态联合
 *
 * `undefined` 那条口径（还没有来源）在上面已经立住了，而且**别处在读它**（左栏会话 tab 的
 * 目录就是从它推的）。把它换成一个联合类型，等于**逼所有读取点都改口**——「一份东西两个形状」
 * 正是本仓反复记下的那种分叉（`LEARNINGS #004-02`）。多一个信号只多一个读者，谁需要谁读。
 *
 * ## 为什么必须有它（缺陷本体）
 *
 * 失败此前**没有任何出口**：`拉清单` 拿到 `undefined` 时不写缝、不报错、也不重试 ⇒
 * `projectList()` 永久停在 `undefined`，左栏会话 tab 一体空白（它靠清单推目录），
 * 而项目面板说「还没有项目」。用户能拿到的两个读数**都是假的、而且都不会再变**。
 */
export const [projectListFailed, setProjectListFailed] = createSignal<boolean | undefined>()
