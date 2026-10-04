export * as AccessCapability from "./capability"

/**
 * capability（会话通行证）——**openhive 定制文件，不是上游文件**。
 *
 * 落点是 `packages/core` 而不是 `plan.md` 原写的 `packages/opencode/src/authz/`：
 * D0-2 裁定（2026-10-04）——工具执行有**两条独立主链**（A = opencode v1 / web UI，
 * B = core v2 / CLI·sdk-next，互不 import），而证明逻辑要两条链共用一份；core 不能
 * import opencode（`packages/core/package.json` 无该依赖）⇒ 只能放两者共同依赖的 core。
 * 先例：`packages/core/src/quota/session-quota.ts`，同一裁定思路。
 *
 * 本文件**只放结构定义**（T002），不放签发（T003）、不放守卫（T005/T006）。
 * 结构里每个字段为什么长这样，见各自注释——那些注释是这个文件的主要价值。
 */

import { Schema } from "effect"
import { ascending } from "@opencode-ai/schema/identifier"
import { Permission } from "@opencode-ai/schema/permission"
import { Project } from "@opencode-ai/schema/project"
import { statics } from "@opencode-ai/schema/schema"

/**
 * 通行证编号。前缀 `cap_` 照 `Permission.ID` 的 `per_` 先例（`packages/schema/src/permission.ts`）。
 *
 * 为什么要编号：FR-010 要求越权「100% 被拒**并留审计**」，FR-004 要求 AccessDenied 留痕。
 * 审计记录只写「张三被拒了」是不够的——同一用户可能同时握着好几张证（多个会话、
 * 切换过项目），出事要能回答「**是哪一张证**在那一刻做的判定」。`cap_` 前缀也让审计
 * 检索能一眼区分「证编号」与「用户 id」（UUID）。
 */
export const ID = Schema.String.check(Schema.isStartsWith("cap_")).pipe(
  Schema.brand("AccessCapability.ID"),
  statics((schema) => ({ create: (id?: string) => schema.make(id ?? "cap_" + ascending()) })),
)
export type ID = typeof ID.Type

/**
 * 数据范围的**解析规矩**（FR-008 / design-v2 §14.1）。
 *
 * 今天只有一条规矩：**按数据项目成员关系**（`fund_project_member` 等，由 F7 落地）。
 * 写成字面量而不是自由字符串，是为了让 F7 的解析器**必须**对着一个确切的词实现——
 * 两边各写一个差不多的字符串，就是 `LEARNINGS #003-05` 说的「假镜像」：
 * 看着一样、实际不等价，而且不报错。
 */
export const DataScopeRule = Schema.Literal("project-membership")
export type DataScopeRule = typeof DataScopeRule.Type

/**
 * 数据范围 —— **只记「按谁、按哪条规矩查」，刻意不记「查出来的清单」**。
 *
 * 这一栏是 D0-4 裁定后 004 交给 F7 的**唯一接口**（T010/T011 整条已移交
 * `007-fund-analysis`），所以它的形状要能被 F7 直接实现、也要能被今天的测试钉住。
 * 用户 2026-10-04 从三个方案里选定了这一版（另两个：把设计文档的「两个来源」都做成
 * 字段 / 干脆不要这一栏）。
 *
 * ⚠️ **`DataScope` 里不许出现项目 id 列表，这是安全要求不是风格偏好**：
 * FR-008 明写数据范围「**运行时**由 MCP 查询 join 实时算出、**不提前落库**、非手动勾选」。
 * 一份写进证里的 `projectIds: ["p1","p2"]` 会在**整个会话生命周期内冻住**——用户事后
 * 被加进 p3，他手里的证仍然只认 p1/p2，**而且没有任何报错**。数据范围必须随授权实时变，
 * 所以证里只带「以谁为主体去查」，解析本身留在数据轴（MCP 层）做。
 *
 * ⚠️ **同样不许把工作空间项目塞进来**（FR-009 两轴不绑定）：数据轴权限（能查哪些数据行）
 * 与工作空间轴权限（产物落哪个工作空间）是**两套独立的权限**，`scope.project` 只属于后者。
 * 把 `project` 落进 `dataScope`，数据访问就跟着「会话在哪个项目里」走了——恰是 FR-008
 * 禁止的「随会话项目变化」。
 *
 * 上面两条各有一条 canary 测试钉着（`packages/core/test/access-capability.test.ts`）。
 */
export const DataScope = Schema.Struct({
  /** 解析主体 —— 运行时 join「数据项目 ↔ 用户」的用户侧键（`auth.user.id`，UUID）。 */
  subject: Schema.String,
  rule: DataScopeRule,
}).annotate({ identifier: "AccessCapability.DataScope" })
export type DataScope = typeof DataScope.Type

/**
 * 证的生效范围：**用户 + 项目 + 数据范围**（FR-001 原文三件）。
 *
 * `project` 取的是**工作空间轴**的 opencode 项目 id（`ProjectV2.ID`，即会话的
 * `projectID`，见 `packages/core/src/session/info.ts`）——会话锚定在此项目、产物落在这里。
 * **不是**数据轴的资金/话单项目 id：那个由 `dataScope` 那一栏按规矩在运行时解析，
 * 两者不绑定（FR-009）。
 */
export const Scope = Schema.Struct({
  /**
   * 用户 id（`auth.user.id`）。
   *
   * ⚠️ **只能来自已验签的身份**：`packages/core/src/user.ts` 的 `User.Info`，
   * 其唯一合法来源是 `packages/auth/src/token.ts` 的 `verifyToken` 返回。明文头
   * `X-User-ID` **MUST NOT** 被当作来源（003 裁定【甲】，2026-09-29）。
   *
   * 只留 id、不搬 `User.Info` 的 `policeNo` / `name` / `isAdmin`：执行层要的是
   * 「这人是谁」（db 路由键 / MCP 身份 / 配额归属），不是「这人叫什么」；而名字这类
   * 会变的字段一旦进了证，就变成一份「会话期间可能过期的快照」。`isAdmin` 的判定
   * 归 RBAC（T004），不在这里抄一份。
   */
  user: Schema.String,
  project: Project.ID,
  dataScope: DataScope,
}).annotate({ identifier: "AccessCapability.Scope" })
export type Scope = typeof Scope.Type

/**
 * 会话通行证：**执行层唯一认的凭证**（FR-002）。
 *
 * `permissions` 是**签发时从 RBAC 算好、焊进证里**的 ruleset，而不是一张「等执行时
 * 再回查 RBAC 表」的欠条 —— 这是 FR-002「工具执行器入口 MUST 只认 capability，
 * **不认角色表**」的直接含义：执行器每次还要回查角色表，它就在认角色表了。
 *
 * 焊进去的另一个好处是它**正好是上游两条链已经在吃的形状**（D0-1 裁定「判定写一份，
 * 按链注入 ruleset」）：上游 `PermissionV2.evaluate(action, resource, ...rulesets)`
 * 直接吃它，不需要任何翻译层。`Rule` / `Ruleset` 因此直接复用
 * `@opencode-ai/schema/permission`，**不自造一份平行类型**（`#003-05`）。
 *
 * ⚠️ 上游兜底值是 `ask` 而**不是** `allow`：证里没写到的动作既不放行也不拒绝，而是
 * 弹窗问人。这条是整套授权的安全底线，已用测试钉死——补成「全量 allow」会让越权从
 * 「问一下」退化成「静默放行」，而代码照跑、门禁照绿。
 */
export const Capability = Schema.Struct({
  id: ID,
  scope: Scope,
  permissions: Permission.Ruleset,
}).annotate({ identifier: "AccessCapability.Capability" })
export type Capability = typeof Capability.Type
