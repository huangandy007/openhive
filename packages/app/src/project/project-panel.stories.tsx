// @ts-nocheck
import { ProjectPanel, type ProjectEntry } from "./project-panel"

/**
 * 项目列表面板（005 T006 / T023 / T024 · 设计 §3）——锚点行 `▾` 展开的那一块。
 *
 * ## story 覆盖的是**四种行的形状**，不是四种配色
 *
 * 面板的每一行由 `ProjectEntry` 的字段决定长什么样（`LEARNINGS #004-07`：形状由被调方定义）：
 * 共享项目带 `👥 N`、当前项目带「（当前）」、`stale` 带超期标记、`archived` 决定在哪个 tab。
 * **归档行的「归档」尾巴由 `decide` 判、不由本组件判**——但画不画「找回」是两种 DOM，
 * axe 要各照一遍。所以这一组 story 把**每一种行**都摆出来。
 *
 * ## 为什么把「空态」也写进来
 *
 * 空态与列表是两条不同的渲染分支（`没办成的那句话` ＋ `role="alert"` 只在前者附近出现）。
 * 只写有数据的那一支，等于放弃另一半的审计面。
 */
export default {
  title: "App/OpenHive/ProjectPanel",
  id: "app-openhive-project-panel",
  component: ProjectPanel,
}

/** 固定时点，避免 story 每次跑都长不一样（视觉走查时才可比）。 */
const 现在 = 1_700_000_000_000
const 一天 = 86_400_000

const 全部: ProjectEntry[] = [
  // 共享 ＋ 当前 ＋ owner ⇒ 带 👥 4、「（当前）」、且 decide 允许它在行尾长「归档」
  { id: "p-817", name: "8·17 专案", type: "shared", memberCount: 4, lastAccessedAt: 现在, role: "owner" },
  // 私有 ⇒ **不画**成员徽章（不给 0、不给假数）
  { id: "p-tax", name: "涉税案", type: "private", lastAccessedAt: 现在 - 一天, role: "owner" },
  // 超期未归档 ⇒ 行尾一条提醒（`stale` 只认 `true`，判定在服务端 `isStale`）
  { id: "p-cold", name: "老旧线索", type: "private", lastAccessedAt: 现在 - 100 * 一天, role: "owner", stale: true },
  // member 角色 ⇒ decide 在「归档」上拒 ⇒ 这一行**不长归档尾巴**（与上面三行是不同 DOM）
  { id: "p-join", name: "别人建的共享专案", type: "shared", memberCount: 3, lastAccessedAt: 现在 - 2 * 一天, role: "member" },
  // 已归档 ⇒ 只出现在「已归档」tab，行尾长「找回」
  { id: "p-done", name: "已结专案", type: "shared", memberCount: 2, lastAccessedAt: 现在 - 200 * 一天, archived: true },
]

/** 没有任何项目：面板走空态（与列表是两条分支）。 */
export const Empty = {
  render: () => (
    <div class="w-80">
      <ProjectPanel projects={[]} />
    </div>
  ),
}

/** 全部接线：五种行形状齐备，「归档 / 找回」都点得动。 */
export const Wired = {
  render: () => (
    <div class="w-80">
      <ProjectPanel
        projects={全部}
        currentId="p-817"
        onOpen={() => {}}
        onCreate={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
      />
    </div>
  ),
}

/**
 * 未接线（T006 落地前的画法）：只给数据、不给回调 ⇒ 两个新建按钮与行尾动作都不画 / 禁用。
 * 「看起来能点」比「少个按钮」更难查，所以这一档必须单独进审计面。
 */
export const NotWired = {
  render: () => (
    <div class="w-80">
      <ProjectPanel projects={全部} currentId="p-817" />
    </div>
  ),
}
