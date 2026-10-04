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
 * ⚠️ 出口是 `Permission.Ruleset`（用户 2026-10-04 裁定），且**词表必须是执行断言那一套**
 * （用户同日第二次裁定）——见下方「词表」一节。执行器仍然只认 capability、不回查角色表（FR-002）。
 *
 * ## 词表（2026-10-04 T006 侦察实测后修正）
 *
 * 本文件第一版把规则写成 `{action: <perm>, resource: "<类型>:<id>"}`，**那是错的**：
 * 所有消费者读的都是 `{action: <工具名>, resource: <工具实参>}`——
 *
 *   packages/core/src/plugin/agent.ts:109-140   { action: "read", resource: "*.env", effect: "ask" }
 *   packages/core/src/permission/saved.ts:62    「总是允许」存的就是这两列
 *   packages/core/src/tool/registry.ts:113      whollyDisabled(permission(tool, name), permissions)
 *   packages/core/src/tool/skill.ts:76          permission.assert({ action: "skill", resources: [skill.name] })
 *   packages/opencode/src/tool/skill.ts:28      ctx.ask({ permission: "skill", patterns: [params.name] })
 *
 * `Wildcard.match` 是**全串锚定**（`^…$`），两边字段都对不上 ⇒ 第一版产出的 ruleset
 * **一条都命中不了、全部落回 ask**：不报错、不变红、typecheck 照绿。`LEARNINGS #003-05` 的假镜像形状。
 */

const grant = (resourceType: AccessRbac.ResourceType, resourceId: string, perm: AccessRbac.Perm): AccessRbac.Grant => ({
  resourceType,
  resourceId,
  perm,
})

describe("RBAC 判定：授权行 → 工具断言 ruleset", () => {
  /**
   * 映射约定（用户 2026-10-04 裁定后定义，T005/T006 照此接线）：
   * `{ resourceType: "skill", resourceId: "fund-analysis", perm: "read" }`
   *   ⇒ `{ action: "skill", resource: "fund-analysis", effect: "allow" }`
   *
   * 拿**下游真正吃这条 ruleset 的那个调用形状**验，不是逐字段对字符串
   * （`#003-05`：镜像要对着下游那一侧的行为写）。
   */
  test("① 授 skill 读 ⇒ 一条 allow，且能被执行断言那条 evaluate 命中", () => {
    const ruleset = AccessRbac.resolve([grant("skill", "fund-analysis", "read")])

    expect(ruleset).toEqual([{ action: "skill", resource: "fund-analysis", effect: "allow" }])

    // 下游是这么问的：evaluate(<工具名>, <实参>, ruleset)。
    // 链 B 的 skill 工具断言 action="skill"、resources=[技能名]；链 A 改名为 permission/pattern。
    expect(PermissionV2.evaluate("skill", "fund-analysis", ruleset)).toEqual({
      action: "skill",
      resource: "fund-analysis",
      effect: "allow",
    })
  })

  /**
   * **只有 `read` 进 ruleset**（用户 2026-10-04 裁定）。
   *
   * `perm` 的四个值仍然存在表里（§11.2：读 / 写 / 审 / 管），但**「调用一个工具」只对应「使用」**——
   * 写 / 审 / 管是管理动作（改内容、批上线、上下架），不是工具调用，今天也没有承载它们的工具。
   * 把它们也翻成工具断言，等于凭空发明一条没人请求的权限。
   *
   * ⚠️ 这条同时钉住「别顺手把四个都放进去」：把 `perm !== "read"` 那行删掉，本条即红。
   */
  test("② 只有 read 产生规则：写 / 审 / 管一律不产", () => {
    const ruleset = AccessRbac.resolve([
      grant("skill", "a", "write"),
      grant("skill", "b", "review"),
      grant("skill", "c", "admin"),
    ])

    expect(ruleset).toEqual([])

    // 单独再来一遍「read 在、其余也在」：read 那条要出，另三条不许跟着出。
    const mixed = AccessRbac.resolve([
      grant("skill", "keep", "read"),
      grant("skill", "drop-write", "write"),
      grant("skill", "drop-review", "review"),
      grant("skill", "drop-admin", "admin"),
    ])
    expect(mixed).toEqual([{ action: "skill", resource: "keep", effect: "allow" }])
  })

  /**
   * 🔴 **未投影的资源类型：显式缺口，不是「已覆盖」**（用户 2026-10-04 裁定）。
   *
   * 实测今天两条投不到任何能命中的工具断言：
   * - `mcp`：链 A 的 MCP 资源工具用 `{permission:"read", pattern:"mcp:<server>:*"}`
   *   （`packages/opencode/src/session/tools.ts:172-179` / `:346-347`）——与 skill 那条**不是同一个投影**；
   *   链 B 侧的 MCP 尚无落点。归 **T007**（FR-005）。
   * - `knowledge_base`：全仓 `packages/` 下**零命中**，没有对应工具。
   *
   * ⇒ 不产规则，落回上游兜底 `ask`（保守：不会误放行，但**也不会生效**）。
   *
   * ⚠️ 这条断言的存在意义是**把缺口钉在明面上**：将来谁接上 mcp，必须同时改
   * `rbac.ts` 的 `TOOL_OF` 表和**这一条断言**——否则「mcp 授权到今天还没生效」会被
   * 悄悄读成「已经生效了」（`LEARNINGS #002-02`）。
   */
  test("③ 未投影类型（mcp / knowledge_base）不产规则 —— 这里不产，不等于没人产", () => {
    expect(AccessRbac.resolve([grant("mcp", "fund-db", "read")])).toEqual([])
    expect(AccessRbac.resolve([grant("knowledge_base", "kb-1", "read")])).toEqual([])

    // 且表里那张「资源类型 → 工具名」的对照今天只认 skill 一行。
    expect(Object.keys(AccessRbac.TOOL_OF)).toEqual(["skill"])

    // ⚠️ `mcp` 从 T007 起**已经投影**，但不在这条 v2 出口上：它的形状要一对规则、两套名字，
    // 且名字由调用方给 ⇒ 落在 `AccessSession.sessionRuleset` 的第二段（`McpServerNaming`）。
    // 这条断言钉的是「`resolve()` 这条 v2 出口仍然只认 skill」——别把上面那句读成「mcp 没人管」。
    // 链 B（v2 / CLI）的 MCP 至今没有消费者，那一半仍是缺口。
  })

  /**
   * 资源 id 是**判定的一个轴**，不是装饰：授了 `skill:X` 不得让人用 `skill:Y`。
   *
   * ⚠️ **两个方向都要断**（这半是 T004 第一轮变异验证补出来的，换词表后照旧成立）：
   * 只断「X 的授权不落到 Y」时，一个把 resource 写死的实现照样全绿——它确实不会落到 Y 上，
   * 它只是**也**落不到别处该到的地方。反向断言（Y 的授权**必须**命中 Y）才照得出那一支。
   */
  test("④ 资源 id 是一个轴：授了 X 不得用 Y，且各自命中各自", () => {
    const onlyX = AccessRbac.resolve([grant("skill", "X", "read")])
    expect(PermissionV2.evaluate("skill", "X", onlyX).effect).toBe("allow")
    expect(PermissionV2.evaluate("skill", "Y", onlyX).effect).toBe("ask")

    // 反向：Y 的授权必须命中 Y——否则「写死 resource」那类实现会漏过去。
    const onlyY = AccessRbac.resolve([grant("skill", "Y", "read")])
    expect(PermissionV2.evaluate("skill", "Y", onlyY).effect).toBe("allow")
    expect(PermissionV2.evaluate("skill", "X", onlyY).effect).toBe("ask")
  })

  /**
   * 同一个授权由**两个角色**各给一次 ⇒ 只出一条。
   * 不去重也不影响 `evaluate`（它取 `findLast`），但 ruleset 是**对两条链的契约**：
   * 同一条授权重复出现会让「这条证里到底授了什么」没法直读，审计和测试都要先归约一遍。
   */
  test("⑤ 两个角色授予同一条 ⇒ 去重后只出一条", () => {
    const ruleset = AccessRbac.resolve([grant("skill", "fund-analysis", "read"), grant("skill", "fund-analysis", "read")])

    expect(ruleset).toEqual([{ action: "skill", resource: "fund-analysis", effect: "allow" }])
  })

  /**
   * **没有授权 ⇒ 空 ruleset**，绝不能是「全 allow」。
   *
   * 把空输入兜底成一条 `{action:"*", resource:"*", effect:"allow"}` 会让**每个没被授权的工具
   * 都静默放行**，而且形状是对的、typecheck 照绿、别的用例全过。
   * 「没授权」与「授权全部」在代码上只差一行，在安全上是全部。
   */
  test("⑥ 没有任何授权 ⇒ 空 ruleset（不是全 allow）", () => {
    expect(AccessRbac.resolve([])).toEqual([])
  })

  /**
   * 接上环路：resolve 的产物交给 `evaluate` 之后，
   * **授过的**是 allow、**没授的**仍是上游兜底 `ask`。
   *
   * 第二半才是这条存在的理由——它证明 resolve **没有**顺手把未授权的也变成 allow
   * （FR-002 的分工：证里没有的东西，就该落回上游的默认，不是落回「允许」）。
   */
  test("⑦ 授过的是 allow，没授的仍是上游兜底 ask", () => {
    const ruleset = AccessRbac.resolve([grant("skill", "fund-analysis", "read")])

    expect(PermissionV2.evaluate("skill", "fund-analysis", ruleset).effect).toBe("allow")
    expect(PermissionV2.evaluate("skill", "call-analysis", ruleset).effect).toBe("ask")
    // 别的工具（不是被授权的那个）同样不许被带出来。
    expect(PermissionV2.evaluate("bash", "rm -rf /", ruleset).effect).toBe("ask")
  })

  /**
   * 出口形状必须**真是** `Permission.Ruleset`——不是「长得像」。
   * T005/T006 要把这个数组直接塞进 `AccessIssue.issue`，形状对不上应当在**类型**上就红。
   */
  test("⑧ 出口就是 Permission.Ruleset（编译期可赋给 issue 的入参）", () => {
    const ruleset: Permission.Ruleset = AccessRbac.resolve([grant("skill", "fund-analysis", "read")])

    expect(ruleset).toHaveLength(1)
  })
})
