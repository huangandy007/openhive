import { createSignal } from "solid-js"
import type { MemberEntry } from "./member-panel"

/**
 * 当前项目的成员表——成员面板（`member-panel.tsx`）的**数据接入缝**（T010 建立，仿
 * `./project-list` 与 `./project-files`）。
 *
 * 与那两个同型同因：`workspace-entry.tsx` 是唯一接线处，但它**拿不到成员表**
 * （那要 `packages/auth` 的 `project-member` 读函数 ＋ 一条 HTTP 出口，六层 provider 之下才有），
 * 所以由缝在中间转一手——组件只认缝，应用入口（或以后的模块动作）往缝里写。
 *
 * `| undefined` 与 `[]` 说的**不是**一件事，别合并：
 * - `undefined` = 还没有来源（今天就是这一态）；
 * - `[]` = 来源明确说了「这个项目没有成员」。
 *
 * 今天写成 `[]` 等于替后端**声称**了「查询成功且一个成员都没有」——而共享项目至少有一个
 * owner（FR-004：谁建谁是），所以那句话在共享项目上**必是假的**（`LEARNINGS #003-04` 的
 * 不实记述在这里表现为界面上一句笃定的「还没有成员」）。
 *
 * ## 今天没有写入方（这不是缺陷，是本 task 的裁定）
 *
 * 用户 2026-10-06 裁定 T010 范围 = **前端面板 ＋ 接缝**：不新增后端 API、不真落库。
 * 读（`packages/auth/src/project-member.ts` 已有）与写（邀请/移除/退群的落库 ＋ HTTP 出口）
 * 都还没有前端读得到的出口；「谁把真数据写进来」由 **T021** 认领（`tasks.md`），
 * 本 task 只把缝立起来、让面板与接线**今天就能被测试驱动**（`workspace-entry.test.tsx` 正是这么验的）。
 */
export const [projectMembers, setProjectMembers] = createSignal<readonly MemberEntry[] | undefined>()
