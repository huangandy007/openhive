import { createSignal } from "solid-js"

/**
 * 「当前项目」的形状——左栏锚点行要显示的那两样。
 *
 * 只放**显示所需**的字段：项目的 id / 类型 / 共享目录等一概不进这里（那些是 T006 项目面板
 * 与文件树要用的），理由与 `current-user.ts` 同——**接入缝只承载它当下要喂的那一件事**，
 * 塞进来的每个字段都是将来没人负责的接口。
 */
export interface CurrentProject {
  /** 项目名（左栏锚点行显示的就是它）。 */
  name: string
  /**
   * 成员数。**私有项目读作 `undefined`**——设计 §4 只给共享项目画 `👥 N`。
   * 别把私有项目写成 `0`：那会让锚点行长出一个「成员 0」的徽章。
   */
  memberCount?: number
}

/**
 * 「当前项目」的**唯一读取点**（T005 建立的接入缝）。
 *
 * 005 落地锚点行时，**项目数据还没有来源**：后端没有「当前项目」这个接口，`project_ext`
 * 只暴露 core 的 `findByProjectID`（T003），成员数在 PG 的 `project_member` 里（T004），
 * 前端一个都读不到。所以这一版**只立缝、不填数**：写入方是 T006（项目面板：切项目 / 新建项目），
 * 届时**只改本文件**之外的那一处调用，`ProjectAnchor` 一个字不动。
 *
 * 未选中项目时读作 `undefined`，锚点行走空态「未选择项目」——**宁缺勿假**：塞一个占位项目名，
 * 等于把假数据放进 DOM，等 T006 接上真数据时没人分得清哪个是真的（同 `@/workspace/current-user`）。
 */
export const [currentProject, setCurrentProject] = createSignal<CurrentProject | undefined>()
