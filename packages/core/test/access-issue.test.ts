import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Project } from "@opencode-ai/schema/project"
import { AccessCapability } from "@opencode-ai/core/access/capability"
import { AccessIssue } from "@opencode-ai/core/access/issue"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { User } from "@opencode-ai/core/user"

/**
 * T003 · capability 签发（FR-001 / FR-002 / FR-009）。
 *
 * 这一组测的是**签发这个动作**，不是结构（T002 已测）、也不是守卫（T005/T006）。
 * 签发能测的核心性质只有一条、但它有三个面：**证里的东西必须由「已验签的用户」推出，
 * 不能由调用方随便填**。三个面各钉一条：
 *
 * ① `dataScope.subject` 由 `user.id` 派生 —— 调用方**塞不进别人的主体**。
 * ② 两个不同用户 ⇒ 两张不同的证（US1 场景 2 的机器版）。
 * ③ `permissions` **原样焊进证里**（FR-002：执行器只认证、不回查角色表）。
 *
 * ⚠️ **裁定（用户 2026-10-04）**：本任务**不接线**——仓库里没有「会话启动」可挂的时刻
 * （创建不启动、启动在首次 prompt、无 started 事件），挂证的活归 T005/T006。裁定与实测见
 * `docs/superpowers/specs/004-access-control/state.md` 的 D0-5。
 */

/** `Project.ID` 是 brand 过的字符串，期望值也得是 brand 过的（照 T002 的做法，不用 `as`）。 */
const projectID = (value: string) => Schema.decodeUnknownSync(Project.ID)(value)

const project = projectID("proj_01J0000000000000000000001")

const userA: User.Info = {
  id: "0f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b",
  policeNo: "010001",
  name: "甲民警",
  isAdmin: false,
}

const userB: User.Info = {
  id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
  policeNo: "020002",
  name: "乙民警",
  isAdmin: true,
}

const rulesetA: AccessCapability.Capability["permissions"] = [
  { action: "bash", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "deny" },
]

const rulesetB: AccessCapability.Capability["permissions"] = [{ action: "read", resource: "/data/*", effect: "allow" }]

describe("capability 签发（T003）", () => {
  /**
   * canary ① —— 这条是整个授权模型的**根**：数据范围以谁为主体查，只能由
   * 「这个人是谁」推出，不能由调用方填。
   *
   * 会怎么坏：`issue` 的入参里多一个 `subject` / `dataScope` 参数（「方便上游传」），
   * 于是**任何一个能调 `issue` 的地方都能替别人签一张证**——拿着张三的身份、开着以李四
   * 为主体的数据范围。代码照跑、typecheck 照绿，因为形状是对的。
   *
   * 这里显式地**塞一个别人的 subject 进去**，断言它被无视。（入参对象先声明成变量再传，
   * 是为了绕过 TS 对「对象字面量的多余属性」检查——这条测的就是「多塞也没用」，不是「不让塞」。）
   */
  test("dataScope.subject 由 user 派生 —— 调用方塞不进别人的主体", () => {
    const sneaky = {
      user: userA,
      project,
      permissions: rulesetA,
      dataScope: { subject: "someone-else", rule: "project-membership" },
    }
    const cap = AccessIssue.issue(sneaky)

    expect(cap.scope.user).toBe(userA.id)
    expect(cap.scope.dataScope).toEqual({ subject: userA.id, rule: "project-membership" })
  })

  /**
   * US1 验收场景 2 的机器版：「两个不同权限的用户各自启动会话 ⇒ 两者 capability 的工具
   * 与数据范围不同」。**证必须不同**——如果 `issue` 不小心返回了共享的常量（或 id 是写死的），
   * 两个用户就会拿到同一张证，越权与审计都会串。
   */
  test("两个不同权限的用户 ⇒ 两张不同的证（US1 场景 2）", () => {
    const a = AccessIssue.issue({ user: userA, project, permissions: rulesetA })
    const b = AccessIssue.issue({ user: userB, project, permissions: rulesetB })

    expect(a.id.startsWith("cap_")).toBe(true)
    expect(a.id).not.toBe(b.id)
    expect(a.scope.user).not.toBe(b.scope.user)
    expect(a.scope.dataScope.subject).not.toBe(b.scope.dataScope.subject)
    expect(a.permissions).not.toEqual(b.permissions)
  })

  /**
   * canary ③ —— FR-002：`permissions` 是**签发时焊进证里**的 ruleset，执行器直接吃它、
   * 不回查角色表。所以「传进去什么，证里就是什么」，且证里的 ruleset 必须**直接是**上游
   * `PermissionV2.evaluate` 认的形状（不需要翻译层）。
   *
   * 第二段断言（未命中的动作 = `ask`）钉的是安全底线：证里没写到的工具既不放行也不拒绝。
   * 一旦 `issue` 「顺手补一条全量 allow」，越权就从「弹窗问一下」退化成「静默放行」。
   */
  test("permissions 原样焊进证里，执行器直接吃它（FR-002）", () => {
    const cap = AccessIssue.issue({ user: userA, project, permissions: rulesetB })

    expect(cap.permissions).toEqual([{ action: "read", resource: "/data/*", effect: "allow" }])
    expect(PermissionV2.evaluate("read", "/data/2024", cap.permissions).effect).toBe("allow")
    // 证里没写到的动作 → 上游兜底 ask，不是 allow 也不是 deny。
    expect(PermissionV2.evaluate("bash", "rm -rf /", cap.permissions).effect).toBe("ask")
  })

  /**
   * canary ④ —— FR-009：工作空间项目落 `scope.project`（会话锚定），**不进 `dataScope`**。
   * 两轴一旦绑上，「能看哪些数据」就跟着「会话开在哪个项目里」走了，正是 FR-008 明令禁止的。
   */
  test("工作空间项目只落 scope.project，不进 dataScope（FR-009 两轴不绑定）", () => {
    const cap = AccessIssue.issue({ user: userA, project, permissions: [] })

    expect(cap.scope.project).toBe(project)
    expect(Object.keys(cap.scope.dataScope).sort()).toEqual(["rule", "subject"])
  })
})
