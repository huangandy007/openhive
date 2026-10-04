import { describe, expect, test } from "bun:test"
import { AccessRbac } from "@opencode-ai/core/access/rbac"
import { PermissionV2 } from "@opencode-ai/core/permission"
import type { Permission } from "@opencode-ai/schema/permission"

/**
 * T004 · RBAC 判定（FR-007 / FR-002）。
 *
 * 这一组测的是**「角色授予的行 → ruleset」这一步**，不是表（那半在 `packages/auth/src/rbac.test.ts`）、
 * 也不是接线（T005/T006）。
 *
 * ⚠️ 为什么判定是**纯函数**：表建在 auth 的 PG（D0-3 裁定①），而这段逻辑落在 core（D0-2 裁定）。
 * core **不依赖 auth**（实测：`packages/auth/package.json` 的 deps 只有 drizzle-orm / hono），
 * 所以 core 侧**碰不到库**——它只认「已经取出来的授权行」。取行那一步（user → 角色 → 授权 的 join）
 * 归 **T005/T006**：那两处住在 `packages/opencode`，而**只有它同时依赖 auth 与 core**（实测）。
 *
 * ⚠️ 出口是 `Permission.Ruleset`（用户 2026-10-04 裁定）——直接喂 T003 的 `AccessIssue.issue`，
 * 形成「角色表 → ruleset → capability」一条直线。**执行器仍然只认 capability**（FR-002）。
 */

const grant = (resourceType: AccessRbac.ResourceType, resourceId: string, perm: AccessRbac.Perm): AccessRbac.Grant => ({
  resourceType,
  resourceId,
  perm,
})

describe("RBAC 判定：授权行 → ruleset", () => {
  /**
   * 映射约定（本任务定义，T005/T006 照此接线）：
   * `{ resourceType: "skill", resourceId: "fund-analysis", perm: "read" }`
   *   ⇒ `{ action: "read", resource: "skill:fund-analysis", effect: "allow" }`
   * 即 **action = perm、resource = `<类型>:<id>`**。拿真实的 Wildcard 匹配器验，
   * 不是逐字段对字符串（`#003-05`：镜像要对着下游那一侧的行为写）。
   */
  test("① 单条授权 ⇒ 一条 allow 规则，且能被执行器那条匹配器命中", () => {
    const ruleset = AccessRbac.resolve([grant("skill", "fund-analysis", "read")])

    expect(ruleset).toEqual([{ action: "read", resource: "skill:fund-analysis", effect: "allow" }])

    // 用下游真正吃这条 ruleset 的那个函数验一遍：命中 ⇒ 返回的就是这条 allow。
    expect(PermissionV2.evaluate("read", "skill:fund-analysis", ruleset)).toEqual({
      action: "read",
      resource: "skill:fund-analysis",
      effect: "allow",
    })
  })

  /**
   * 四条 perm（读 / 写 / 审 / 管，design-v2 §11.2）逐个钉：**存的是 ASCII、
   * 不是中文**。中文只出现在设计文档的散文中——它要跨语言、进 DB、进规则字符串，
   * 编码成 `读/写/审/管` 是在每个边界上都要多一层转换。
   */
  test("② 四条 perm 各自原样映射（存 ASCII，不存中文）", () => {
    const ruleset = AccessRbac.resolve([
      grant("skill", "a", "read"),
      grant("skill", "b", "write"),
      grant("skill", "c", "review"),
      grant("skill", "d", "admin"),
    ])

    expect(ruleset.map((rule) => rule.action)).toEqual(["read", "write", "review", "admin"])
  })

  /**
   * 资源类型是**判定的一个轴**，不是装饰：`skill:X` 的读授权**不得**让人读 `mcp:X`。
   * 两者 id 相同、perm 相同——只有类型不同，正是最容易串味的一条。
   *
   * ⚠️ **两个方向都要断**（这半是变异验证补出来的）：只断「skill 的授权不落到 mcp」时，
   * 一个把类型**写死**成 `skill:` 的实现照样全绿——因为它确实不会落到 mcp 上，
   * 它只是**也**落不到别的类型该到的地方。反向断言（mcp 的授权**必须**命中 mcp）
   * 才照得出这一支。
   */
  test("③ 资源类型是判定的一个轴：不同类型互不串、且各自命中各自", () => {
    const skillOnly = AccessRbac.resolve([grant("skill", "X", "read")])
    expect(PermissionV2.evaluate("read", "skill:X", skillOnly).effect).toBe("allow")
    expect(PermissionV2.evaluate("read", "mcp:X", skillOnly).effect).toBe("ask")

    // 反向：mcp 的授权必须命中 mcp——否则「写死类型」那类实现会漏过去。
    const mcpOnly = AccessRbac.resolve([grant("mcp", "X", "read")])
    expect(PermissionV2.evaluate("read", "mcp:X", mcpOnly).effect).toBe("allow")
    expect(PermissionV2.evaluate("read", "skill:X", mcpOnly).effect).toBe("ask")
  })

  /**
   * 同一个授权由**两个角色**各给一次 ⇒ 只出一条。
   * 不去重也不影响 `evaluate`（它取 `findLast`），但 ruleset 是**对两条链的契约**：
   * 同一条授权重复出现会让「这条证里到底授了什么」没法直读，审计和测试都要先归约一遍。
   */
  test("④ 两个角色授予同一条 ⇒ 去重后只出一条", () => {
    const ruleset = AccessRbac.resolve([
      grant("skill", "fund-analysis", "read"),
      grant("skill", "fund-analysis", "read"),
    ])

    expect(ruleset).toEqual([{ action: "read", resource: "skill:fund-analysis", effect: "allow" }])
  })

  /**
   * **没有授权 ⇒ 空 ruleset**，绝不能是「全 allow」。
   *
   * 这条是整组里最该防退化的一条：把空输入兜底成一条 `{action:"*", resource:"*", effect:"allow"}`
   * 会让**每个没被授权的资源都静默放行**，而且形状是对的、typecheck 照绿、别的用例全过。
   * 「没授权」与「授权全部」在代码上只差一行，在安全上是全部。
   */
  test("⑤ 没有任何授权 ⇒ 空 ruleset（不是全 allow）", () => {
    expect(AccessRbac.resolve([])).toEqual([])
  })

  /**
   * 接上环路：resolve 的产物交给 `evaluate` 之后，
   * **授过的**是 allow、**没授的**仍是上游兜底 `ask`。
   *
   * 第二半才是这条存在的理由——它证明 resolve **没有**顺手把未授权的东西也变成 allow，
   * 也证明「未命中 = ask」这个上游语义在 RBAC 这条路上没有被改写（FR-002 的分工：
   * 执行器只认证；而证里没有的东西，就该落回上游的默认，不是落回「允许」）。
   */
  test("⑥ 授权命中的是 allow，没授的仍是上游兜底 ask", () => {
    const ruleset = AccessRbac.resolve([grant("skill", "fund-analysis", "read")])

    expect(PermissionV2.evaluate("read", "skill:fund-analysis", ruleset).effect).toBe("allow")
    expect(PermissionV2.evaluate("read", "skill:call-analysis", ruleset).effect).toBe("ask")
    expect(PermissionV2.evaluate("admin", "skill:fund-analysis", ruleset).effect).toBe("ask")
  })

  /**
   * 出口形状必须**真是** `Permission.Ruleset`——不是「长得像」。
   * 编译期把它交给那个类型的解码器验一遍：T005/T006 要把这个数组直接塞进
   * `AccessIssue.issue`，形状对不上应当在**类型**上就红，不要等到运行时。
   */
  test("⑦ 出口就是 Permission.Ruleset（编译期可赋给 issue 的入参）", () => {
    const ruleset: Permission.Ruleset = AccessRbac.resolve([grant("mcp", "fund-db", "admin")])

    expect(ruleset).toHaveLength(1)
  })
})
