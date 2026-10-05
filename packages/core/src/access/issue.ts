export * as AccessIssue from "./issue"

/**
 * capability **签发**（T003）——**openhive 定制文件，不是上游文件**。
 *
 * 落点与 T002 同因（见 `./capability.ts` 顶部）：两条链要共用一份判定，而 core 不能 import
 * opencode ⇒ 只能放 core。
 *
 * ⚠️ **本文件不接线**（裁定：用户 2026-10-04，见 `004/state.md` 的 D0-5）。实测仓库里
 * **没有「会话启动」这个可挂的时刻**：创建会话只发 `Created` 事件、不启动执行；真正跑起来是
 * 首次 prompt；也没有「执行已启动」事件。而且链 B 连一个可写的「每会话槽位」都没有
 * （`SessionStore` 只读），core 的会话/runner 层也拿不到 `User.Service`。所以「把证挂到会话上」
 * 这件事本身是个未定的设计决策，归 **T005/T006**（那两条本来就是「把 ruleset 注入既有钩子」）。
 *
 * 本文件只回答一个问题：**给定「谁、哪个项目、什么权限」，怎么开出一张证。**
 */

import { Permission } from "@opencode-ai/schema/permission"
import { Project } from "@opencode-ai/schema/project"
import { AccessCapability } from "./capability"
import { User } from "../user"

export interface Input {
  /**
   * **已验签**的用户身份。
   *
   * 刻意收 `User.Info` 而**不是** `string`：`User.Info` 的唯一合法来源是
   * `packages/auth/src/token.ts` 的 `verifyToken` 返回（见 `../user.ts`），而明文头
   * `X-User-ID` 只是个字符串。收字符串 = 让「明文头冒充身份」在**类型上**进得来；
   * 收 `User.Info` = 调用方**必须**手里先有一个验签结果才能来签发。
   */
  readonly user: User.Info
  /** 工作空间轴的项目 id（会话的 `projectID`）——证锚定在此项目，产物落在这里。 */
  readonly project: Project.ID
  /**
   * 签发时从 RBAC 算好的 ruleset，**焊进证里**。
   *
   * 为什么作为入参而不是在这里现查 RBAC：T003 的依赖只有 T002（RBAC 是并行的 T004），
   * 证里要的 ruleset 由**调用方**决定，本函数不认识角色表——这也正是 FR-002 的分工
   * （执行器只认证、不回查角色表）。
   */
  readonly permissions: Permission.Ruleset
}

/**
 * 开一张证。
 *
 * **唯一不许调用方插手的东西是「以谁为主体」**：`scope.user` 与 `dataScope.subject`
 * **一律从 `input.user.id` 推出**，不接受任何独立入参。理由是这个模型的根——
 * 一旦签发方能单独指定数据范围主体，**任何够得着 `issue` 的地方都能替别人签证**
 * （拿张三的身份、开以李四为主体的数据范围），而且代码照跑、typecheck 照绿。
 * 已有一条 canary 钉着（`packages/core/test/access-issue.test.ts` 第 ① 条）。
 *
 * `permissions` 原样焊进证里，不做增删：**未命中的动作保持上游兜底值 `ask`**，
 * 「顺手补一条全量 allow」会让越权从「问一下」退化成「静默放行」。
 *
 * ⚠️ 但**别把「兜底 `ask`」当成安全底线**（2026-10-05 补）：`ask` 可被弹窗里的「总是允许」批掉。
 * 所以**受管的动作必须由 `permissions` 自己带一条整体 deny**——那一条由 `AccessRbac.resolve()` ①
 * 产出（说明见 `capability.ts` 与 `rbac.ts` 的同款段落）。
 */
export function issue(input: Input): AccessCapability.Capability {
  return {
    id: AccessCapability.ID.create(),
    scope: {
      user: input.user.id,
      project: input.project,
      dataScope: {
        subject: input.user.id,
        rule: "project-membership",
      },
    },
    permissions: input.permissions,
  }
}
