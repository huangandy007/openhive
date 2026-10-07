// @ts-nocheck
import { MemberPanel, type MemberEntry } from "./member-panel"

/**
 * 成员管理面板（005 T010 / T021 · 设计 §4）——锚点行 `👥` 滑出来的那一块。
 *
 * ## 这一组 story 的**中心**是 `selfPoliceId`
 *
 * 面板不自己判断「我能不能移除这个人」——它把 `selfPoliceId` 反查成 `decide` 的 `actor`，
 * 由 core 那份**唯一实现**（`ProjectMembership.decide`）决定每个动作画不画。于是：
 *
 * - **`selfPoliceId` 省略 / 查不到** ⇒ `actor` 为 `null` ⇒ **动作一个都不画**。这是有意的
 *   fail-closed：身份没到之前宁少勿假，而不是先按「大概能行」把按钮画出来。**这条必须进审计面**，
 *   因为「一个动作都没有」与「动作齐全」是两套完全不同的 DOM。
 * - **owner 视角 vs member 视角** ⇒ 同一个人、同一张表，可点的东西不同。
 * - **`archived`**（FR-010 归档 = 冻结）⇒ 整块被 `decide` 冻掉。
 *
 * 四个状态各写一个 story，就是「让 axe 把每种按钮组合都照一遍」。
 */
export default {
  title: "App/OpenHive/MemberPanel",
  id: "app-openhive-member-panel",
  component: MemberPanel,
}

const 成员: MemberEntry[] = [
  { policeId: "85001", name: "张警官", role: "owner" },
  { policeId: "85002", name: "李警官", role: "member" },
  { policeId: "85003", name: "王警官", role: "member" },
]

/** 没有成员：走空态（与列表是两条分支）。 */
export const Empty = {
  render: () => (
    <div class="w-72">
      <MemberPanel projectName="8·17 专案" members={[]} />
    </div>
  ),
}

/** **owner 视角**（我是 85001）：邀请 / 移除他人 / 退群都画得出来。 */
export const AsOwner = {
  render: () => (
    <div class="w-72">
      <MemberPanel
        projectName="8·17 专案"
        members={成员}
        selfPoliceId="85001"
        onInvite={() => {}}
        onRemove={() => {}}
        onLeave={() => {}}
      />
    </div>
  ),
}

/** **member 视角**（我是 85002）：同一张表，能点的是另一套（移除他人不在其中）。 */
export const AsMember = {
  render: () => (
    <div class="w-72">
      <MemberPanel
        projectName="8·17 专案"
        members={成员}
        selfPoliceId="85002"
        onInvite={() => {}}
        onRemove={() => {}}
        onLeave={() => {}}
      />
    </div>
  ),
}

/**
 * 身份还没到（`selfPoliceId` 省略）：**动作一个都不画**——fail-closed。
 *
 * 这一档最容易在审计里被漏掉：它长成「什么都没接线的面板」，而少了它就看不出
 * 「身份缺失」与「接线缺失」是两种状态。
 */
export const NoIdentity = {
  render: () => (
    <div class="w-72">
      <MemberPanel projectName="8·17 专案" members={成员} onInvite={() => {}} onRemove={() => {}} onLeave={() => {}} />
    </div>
  ),
}

/** 项目已归档（FR-010 归档 = 冻结）：交给 `decide` 判，本组件不另写判断。 */
export const Archived = {
  render: () => (
    <div class="w-72">
      <MemberPanel
        projectName="8·17 专案"
        members={成员}
        selfPoliceId="85001"
        archived
        onInvite={() => {}}
        onRemove={() => {}}
        onLeave={() => {}}
      />
    </div>
  ),
}
