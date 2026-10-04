import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Project } from "@opencode-ai/schema/project"
import { AccessCapability } from "@opencode-ai/core/access/capability"
import { PermissionV2 } from "@opencode-ai/core/permission"

/**
 * T002 · capability scope 结构（FR-001 / FR-002 / FR-008 / FR-009）。
 *
 * 本文件测的是**结构定义**，不是签发（T003）也不是守卫（T005/T006）。结构定义能测的
 * 只有「形状」，所以三条用例**刻意都是「canary」**——它们钉的不是「现在跑得通」，
 * 而是**三条会被后来的改动悄悄破坏、且不会自己变红的性质**：
 *
 * ① `dataScope` 里**放不进一份冻结的项目 id 列表**（FR-008）。
 * ② `dataScope` 里**不含工作空间项目**（FR-009 两轴不绑定）。
 * ③ capability 的 `permissions` **直接就是上游 `PermissionV2.evaluate` 吃的 ruleset**，
 *    且**「没命中」必须仍是 `ask` 而不是 `allow`**（FR-002 + D0-1 裁定）。
 *
 * 为什么 canary 值得写：三条性质都是**「多写一个字段就没了」**的形态——加个
 * `projectIds?: string[]` 或把 `project` 塞进 `dataScope`，代码照跑、typecheck 照绿、
 * 只有这三条会红。判据见 `LEARNINGS #003-03`（变异验证的三类结论）。
 */

const decode = Schema.decodeUnknownSync(AccessCapability.Capability)

/**
 * `Project.ID` 是 brand 过的字符串，**`toBe` 的期望值也得是 brand 过的**——
 * 直接写 `"proj_x"` 过不了 typecheck。所以期望值一律走一遍 decode 造出来，
 * 而不是 `as` 强转或 `String()` 抹平（后者会把「类型对不对」这件事一起抹掉）。
 */
const projectID = (value: string) => Schema.decodeUnknownSync(Project.ID)(value)

/** 一份结构完整的 capability，供各条用例改造。 */
const valid = {
  id: "cap_01J0000000000000000000000",
  scope: {
    user: "0f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b",
    project: "proj_01J0000000000000000000001",
    dataScope: { subject: "0f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b", rule: "project-membership" },
  },
  permissions: [{ action: "bash", resource: "*", effect: "allow" }],
}

describe("capability 结构（T002）", () => {
  /**
   * canary ① —— FR-008：数据范围「运行时实时算出、不提前落库、非手动勾选」。
   *
   * 这条性质**只能靠「栏里没有那份清单」来体现**：一旦 `dataScope` 能装下
   * `projectIds: ["p1","p2"]`，那份清单就在**会话生命周期内冻住**了——用户事后被加进
   * 新项目，他手里的 capability 仍然只认旧的几个项目，而**没有任何报错**。
   * 所以这里显式断言「传进去也被剔除」。
   *
   * ⚠️ 这条红 = 有人往 `DataScope` 里加了字段，**不是** Effect 的 `Schema` 变了行为。
   * （Effect 的 `Schema` 默认忽略多余字段；若哪天它改成报错，这条会红在 `decode` 抛异常。）
   */
  test("dataScope 里放不进冻结的项目 id 列表（FR-008：数据范围不提前落库）", () => {
    const decoded = decode({
      ...valid,
      scope: {
        ...valid.scope,
        dataScope: { subject: "u1", rule: "project-membership", projectIds: ["p1", "p2"] },
      },
    })
    expect(decoded.scope.dataScope).toEqual({ subject: "u1", rule: "project-membership" })
    expect(Object.keys(decoded.scope.dataScope).sort()).toEqual(["rule", "subject"])
  })

  /**
   * canary ② —— FR-009：数据轴与工作空间轴**两套独立、不互相绑定**。
   *
   * 绑定会怎么发生：dataScope 里多一个 `project` / `workspace` 字段（「顺手把当前
   * 工作空间也带上」），于是「能看哪些数据」就跟着「会话在哪个项目里」走了——
   * 正是 FR-008 明令禁止的「随会话项目变化」。这里断言 dataScope 的键**恰好**是
   * subject + rule 两个，多一个就红。
   *
   * 注意 `scope.project` 本身是**允许且必需**的（会话锚定、产物落哪个工作空间）——
   * 被禁的是**它出现在数据范围里**，不是它存在。
   */
  test("dataScope 里不含工作空间项目（FR-009：两轴不绑定）", () => {
    const decoded = decode({
      ...valid,
      scope: {
        ...valid.scope,
        project: "proj_should_not_leak_into_dataScope",
        dataScope: { subject: "u1", rule: "project-membership", project: "proj_should_not_leak_into_dataScope" },
      },
    })
    expect(Object.keys(decoded.scope.dataScope).sort()).toEqual(["rule", "subject"])
    expect(decoded.scope.project).toBe(projectID("proj_should_not_leak_into_dataScope"))
  })

  /**
   * canary ③ —— FR-002 + D0-1 裁定：判定**写一份**（这是 ruleset），按链注入。
   *
   * 断言两件事，第二件比第一件更要紧：
   * - 证里的 ruleset 就是上游 `evaluate` 直接吃的形状 ⇒ 两条链不需要各自的翻译层。
   * - **没被列到的动作 = `ask`，不是 `allow`**。这是上游 `evaluate` 的兜底值，
   *   也是整套授权的安全底线：一旦有人为了「省事」把 capability 的 ruleset 补成
   *   全量 allow，越权就从**「弹窗问一下」变成「静默放行」**，而代码照跑。
   */
  test("permissions 直接就是 PermissionV2 吃的 ruleset；未命中仍是 ask 不是 allow（FR-002）", () => {
    const cap = decode({
      ...valid,
      permissions: [
        { action: "bash", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "deny" },
      ],
    })
    expect(PermissionV2.evaluate("bash", "ls -la", cap.permissions).effect).toBe("allow")
    expect(PermissionV2.evaluate("edit", "/tmp/x", cap.permissions).effect).toBe("deny")
    // 安全底线：证里没写到的工具既不是 allow 也不是 deny，而是 ask（上游兜底）。
    expect(PermissionV2.evaluate("write", "/tmp/x", cap.permissions).effect).toBe("ask")
  })

  test("id 是 cap_ 前缀（出事了能按 id 查到是哪张证）", () => {
    const generated = AccessCapability.ID.create()
    expect(generated.startsWith("cap_")).toBe(true)
    expect(AccessCapability.ID.create("cap_explicit")).toBe(
      Schema.decodeUnknownSync(AccessCapability.ID)("cap_explicit"),
    )
    expect(() => Schema.decodeUnknownSync(AccessCapability.ID)("per_01J0000000000000000000000")).toThrow()
  })
})
