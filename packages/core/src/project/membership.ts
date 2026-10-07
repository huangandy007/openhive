export * as ProjectMembership from "./membership"

/**
 * 005 T004 · **微信群模型的项目成员判定**（FR-004 / FR-010）。
 *
 * ## 这个文件是什么、不是什么
 *
 * 三条分工（`plan.md` 的「与现有系统集成点」＋ U5 裁定，2026-10-06）：
 *
 * | 层 | 落点 | 回答什么 |
 * |---|---|---|
 * | **判定**（本文件） | `packages/core/src/project/membership.ts` | 「这个身份 ＋ 这个动作 ⇒ 能不能」 |
 * | 存储 | `packages/auth/src/migrations/0005_project_member.sql` ＋ 同目录的 drizzle 模型 | 「库里有什么」 |
 * | 接线 | `packages/opencode/src/server/openhive/archive.ts`（归档/找回，`decide`，T013）＋ `packages/opencode/src/server/openhive/member.ts`（名单 / 邀请 / 移除 / 退群，`decide`，T021）＋ `packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts`（「已归档 ⇒ 拒」两道门，`frozen`，T015） | 「取身份 → 问判定 → 执行」 |
 *
 * 本文件**不读库、不抛错、不碰 Effect**——纯函数，所以它能在 core 里（core **不依赖 auth**，
 * 见 `packages/auth/package.json` 的 deps）。取身份那一步归 `packages/opencode`：
 * 全仓只有它同时依赖 auth 与 core。
 *
 * 🔴 **不接 `core/access` capability**（U5 裁定）——那是**数据轴**（资金 / 话单的 `dataScope`），
 * 004 裁定 ④ 明说「契约零消费者，留给 F6/F7 由消费者来钉形状」。本项目是**工作空间轴**，
 * 两轴不绑定（FR-009）。把两轴接起来 = 把「加不加入一个共享项目」变成「能不能看资金数据」，
 * 而 FR-009 要的恰恰是它们互不影响。
 *
 * ## 规则（FR-004 逐字，一行一条）
 *
 * - 谁建谁 owner —— 建项目**不在这里**（那是写入侧，T006 的新建面板）；
 *   本模块的输入里没有「建」这个动作，owner 身份由写入侧产生。
 * - **owner 与 member 均可邀请**（被邀者 role=member）⇒ `invite` 两者皆可。
 * - **仅 owner 能移除成员** ⇒ `remove` 只认 owner，且**目标必须是 member**。
 * - **member 可退群、owner 不能退群** ⇒ `leave` 只认 member。
 * - **不设只读角色** ⇒ `MEMBER_ROLES` 里**没有**第三档；加一档要改迁移的 CHECK（见下「镜像」）。
 *
 * ## 一条不变量：项目**永远有一个 owner**
 *
 * `leave` 拒 owner、`remove` 拒 owner 目标——这两条是**同一条**不变量的两面：
 * 前者管「自己走」，后者管「被别人弄走」。少任何一条，共享项目都能变成**无主项目**：
 * 没人能归档（FR-008）、没人能找回（FR-009），而库里那行 `project_member` 看起来完全正常
 * ——静默、且事后无从判断该由谁收场。
 *
 * ## 归档态（FR-010）的读法：**归档 = 冻结**
 *
 * FR-010 的字面是「归档后**成员**失权，owner 保留**找回**权」。本模块把整条读成：
 * **归档后除 owner 的 `restore` 之外，任何动作都不成立**（含 owner 自己的 `invite` /
 * `remove` / 再来一次 `archive`）。理由：归档的动作里沙箱文件已上传 MinIO、本地已删，
 * 此时「邀请谁进来」「成员退群」都没有可作用的实体；而唯一有意义的出口是找回。
 *
 * ⚠️ 这是**一次裁定**（2026-10-06，T004，已记 `state.md`），不是顺手写的：方向是**收紧**
 * （比字面更严），不会放走任何一次越权。若本意是「owner 归档后仍可邀请」，那是一次**放宽**，
 * 要有据再改（`LEARNINGS #002-02` 的取向：没覆盖的要写成缺口，不是写成已覆盖）。
 *
 * 这条读法有**两个出口**：动作闭集内由 `decide` 回答（上表那五条），闭集**外**的那半个
 * ——「已经归档的项目上还能不能在里头干活（建会话 / 读文件）」——由 `frozen` 回答（T015）。
 * 两者是同一条规则的两处投影，由测试锁死，理由写在 `frozen` 的注释里。
 *
 * ## 镜像：`MEMBER_ROLES` ⇔ 迁移里 `project_member.role` 的 CHECK
 *
 * 同一份值是**两处写法**（TS 数组 / SQL 的 IN 闭集）。改一边不改另一边时，**库会接受一个
 * 判定函数不认识的 role**——那一行的权限判定会走到「不是 owner 也不是 member」的分支，
 * 静默地少掉全部权限，且不报错、不变红（`LEARNINGS #003-05`：假镜像）。
 *
 * ⇒ 由 `packages/opencode/test/server/openhive-project-member-closed-set.test.ts` **逐值双向**
 * 比对这个数组与 `pg_get_constraintdef` 抠出来的闭集（同 `openhive-rbac-closed-set.test.ts`
 * 的先例）。那条断言**住在 opencode**：它要同时看得见 auth 的真库与 core 的值，
 * 而 auth 不依赖 core、core 不依赖 auth，全仓只有 opencode 两边都够得着。
 * 本文件这一侧另有一条**取值断言**（`packages/core/test/project-membership.test.ts` 末组）。
 */

/**
 * 项目成员的身份闭集（**没有只读角色**，FR-004 末句）。
 *
 * ⚠️ 与迁移里的 CHECK 是同一份值的两处写法；见文件头「镜像」。
 */
export const MEMBER_ROLES = ["owner", "member"] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

/** 需要判定的动作闭集。加一个动作 = 归档态的「冻结」也自动覆盖它（测试按本数组遍历）。 */
export const PROJECT_ACTIONS = ["invite", "remove", "leave", "archive", "restore"] as const
export type ProjectAction = (typeof PROJECT_ACTIONS)[number]

export interface DecisionInput {
  /** 发起人在这条链上的身份；`null` = **不是成员**（或那条链上没有身份）。 */
  readonly actor: MemberRole | null
  readonly action: ProjectAction
  /**
   * 被操作对象的身份——**只有 `remove` 用得上**，其余动作传 `null`。
   *
   * ⚠️ **刻意是必填而不是可选**（可选字段会被「忘了传」悄悄当成 `null`，
   * 而 `null` 在 `remove` 上恰好是「拒」——一旦将来某个动作的默认值反过来，
   * 漏传就从「保守」变成「放行」，且**没有任何测试会红**）。
   */
  readonly target: MemberRole | null
  /** 项目是否已归档（FR-010）。归档状态是**项目级共享态**，落业务 PG 的 `project_archive`（Q3 裁定）。 */
  readonly archived: boolean
}

/**
 * 每个动作的规则。写成**映射表**而不是 `switch`，两个理由都是实的：
 *
 * ① `Record<ProjectAction, …>` 让「加一个动作却忘了写规则」变成**编译错误**（少一个键就红）。
 *    `switch` 做不到这件事：它要靠 `default` 兜底，而 `default` 一加，漏掉的分支就从
 *    「编译不过」降级成「静默拒」——正是本仓最防的那类失败（`LEARNINGS #003-05` 的假镜像）。
 * ② 每个动作是独立的一个表达式，不存在「有的分支有 return、有的没有」这种形状
 *    （oxlint 的 `consistent-return` 会对穷尽 switch 报这个——TS 知道它穷尽、linter 不知道）。
 */
const RULES: Record<ProjectAction, (input: DecisionInput) => boolean> = {
  // FR-004：owner 与 member **均可**邀请。非成员在这里落空——`null` 与两个 role 都不相等。
  invite: (input) => input.actor === "owner" || input.actor === "member",
  // FR-004：仅 owner 能移除，且**目标是 member**（目标是 owner ⇒ 项目会无主，见文件头）。
  remove: (input) => input.actor === "owner" && input.target === "member",
  // FR-004：member 可退群、owner 不能退群。
  leave: (input) => input.actor === "member",
  // FR-008：owner 归档。
  archive: (input) => input.actor === "owner",
  // FR-009 的入口：只有**已归档**的项目才谈得上找回，而 `decide` 上面那层已经把「未归档」挡掉了
  // （走得到这里 = 未归档）⇒ 恒不成立，由归档那一支独占。
  restore: () => false,
}

/**
 * 判定的**唯一**实现。
 *
 * 写成「先归档、后动作」两层而不是每个动作里各带一句 `!archived`：
 * 后者要写五个地方，**加第六个动作时没人会回来补**（`LEARNINGS #002-06` 的形状）。
 * 这里只有一处，而 `RULES` 的键集由类型钉住。
 */
export function decide(input: DecisionInput): boolean {
  // 归档 = 冻结：唯一的出口是 owner 的找回（见文件头「归档态的读法」）。
  if (input.archived) return input.action === "restore" && input.actor === "owner"
  return RULES[input.action](input)
}

/**
 * 「这个项目冻住了吗」——归档分支的**第二个出口**（005 T015，FR-010）。
 *
 * ## 为什么不能借 `decide` 现成的某个动作来问
 *
 * 中间件要问的不是「**这个动作**能不能」，而是「**这个项目上还能不能干活**」——建会话、读文件
 * （判据落在 `middleware/project-location.ts`，那是两道门：**带了项目头**的那条链，与**目录来自
 * 会话行**的那条链）。而动作闭集里
 * **没有「干活」这个动作**：`PROJECT_ACTIONS` 是邀请 / 移除 / 退群 / 归档 / 找回，五条都是
 * 项目**管理**。借 `archive` 来问会把「归档后 owner 还能不能再归档」混进来（那条今天不成立，
 * 但它是**另一条**规则，将来可能单独放宽），借 `invite` 来问同理。
 *
 * ## 今天它长得像 `identity`，而那个形状是**刻意的**
 *
 * 函数体一句话就写完，判据的全部内容在 `decide` 上面那条归档分支里——本函数是它的**读法出口**，
 * 不是它的第二份实现。真正的守卫在测试那一侧：`packages/core/test/project-membership.test.ts`
 * 的 T015 组遍历 `PROJECT_ACTIONS`，断言
 * 「`frozen(archived)` ⟺ 归档态下**没有任何**非 `restore` 动作成立」。
 *
 * ⇒ 谁**放宽** `decide` 的归档分支（例如让 owner 在归档项目上还能邀请），那条断言立刻红，
 * 逼人回来回答「那 `frozen` 还该不该为真」（`LEARNINGS #004-02`：两个投影之间必须有一条
 * **故意会红**的相等断言，不能靠注释约定同步）。所以本函数**不要**改写成「照着 `decide` 现算
 * 一遍」——那样两个投影就并成了一个，警报也随之消失。
 */
export function frozen(archived: boolean): boolean {
  return archived
}
