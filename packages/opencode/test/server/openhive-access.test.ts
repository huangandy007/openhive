import { describe, expect, test } from "bun:test"
import { AccessRbac } from "@opencode-ai/core/access/rbac"
import { evaluate as evaluateV1 } from "../../src/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { AccessSession } from "@opencode-ai/core/access/session"

/**
 * T006 · 把 capability 翻成**链 A（v1）的会话规则集**（FR-004 / design-v2 §14.1 层②）。
 *
 * 这组测的是**纯函数**那一半：`授权行 → session.permission`。接线（取行、会话创建时写入）
 * 在 `handlers/session.ts`，它靠下面这些函数的语义；这组测试不碰 HTTP。
 *
 * ## 为什么词表又要翻一次
 *
 * v2（capability 里的）是 `{ action, resource, effect }`；v1（链 A）是
 * `{ permission, pattern, action }`（见 `packages/opencode/src/permission/index.ts` 的
 * `evaluate` / `fromConfig`）。字段名不同、**匹配语义相同**——两边都用
 * `@opencode-ai/core/util/wildcard` 的 `Wildcard.match`，且都是 `findLast`（**后者胜**）。
 *
 * ⚠️ 这条「语义相同」是**实测**不是推断：链 A 的真判决器在本文件的断言里被直接调用
 * （`evaluateV1`），不是拿一个复刻的假匹配器自证——`LEARNINGS #003-05` 的假镜像就是那么来的。
 */

const grant = (
  resourceType: AccessRbac.ResourceType,
  resourceId: string,
  perm: AccessRbac.Perm,
): AccessRbac.Grant => ({ resourceType, resourceId, perm })

describe("T006 · capability → 链 A 会话规则集", () => {
  /**
   * 形状：**先一条整体 deny，再逐条 allow**。
   *
   * 顺序不是排版，是语义——`evaluate` 取 `findLast`（后者胜）：
   * - 授过的 skill：两条都命中 ⇒ 取到后面那条 ⇒ allow；
   * - 没授的 skill：只有整体 deny 命中 ⇒ deny。
   *
   * 反过来写（allow 在前、deny 在后）会把**所有** skill 都拒掉，包括授过的。
   */
  test("① 授 skill 读 ⇒ 先整体 deny、后逐条 allow（顺序是语义）", () => {
    const ruleset = AccessSession.sessionRuleset([grant("skill", "fund-analysis", "read")])

    expect(ruleset).toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "fund-analysis", action: "allow" },
    ])
  })

  /**
   * 🔴 **零授权 ⇒ 仍然一条 deny**，绝不是空集。
   *
   * 空集意味着「没有规则 ⇒ 走上游兜底 `ask`」——而链 A 的 skill 工具**带 `always`**
   * （`src/tool/skill.ts` 的 `ctx.ask({..., always: [params.name]})`），`ask` 会在界面上
   * 给民警一个「总是允许」的按钮：**没被授予的 skill，民警可以自己把自己批进去**，
   * 而且那条 allow 会进 `approved`、压过整条会话规则集。这就是「用前端隐藏资源替代权限校验」。
   *
   * 一条 deny 把这条路堵死：deny 不会进询问，也就没有「总是允许」可点。
   */
  test("② 零授权 ⇒ 仍有一条整体 deny（不是空集，否则落回可自批的 ask）", () => {
    const ruleset = AccessSession.sessionRuleset([])

    expect(ruleset).toEqual([{ permission: "skill", pattern: "*", action: "deny" }])
  })

  /**
   * 拿**链 A 真正的判决器**验，不是逐字段对字符串（`LEARNINGS #003-05`）。
   *
   * 下半段是这条存在的理由：`resolve()` 只产出 allow，**不产出任何 deny**；
   * 若 `sessionRuleset` 忘了补那条整体 deny，未授权的 skill 会静默退化成 `ask`
   * （可自批）——而上面①②两条断言**照样绿**（它们只查 allow 在不在）。
   */
  test("③ 用链 A 真判决器验：授过的是 allow、没授的是 deny（不是 ask）", () => {
    const ruleset = AccessSession.sessionRuleset([grant("skill", "fund-analysis", "read")])

    expect(evaluateV1("skill", "fund-analysis", ruleset).action).toBe("allow")
    expect(evaluateV1("skill", "call-analysis", ruleset).action).toBe("deny")
    // 「不是 ask」要单独断：ask 与 deny 在 evaluate 的返回里长得像，但后果差一个
    // 「民警可以自己批」——退化回去时这条要红。
    expect(evaluateV1("skill", "call-analysis", ruleset).action).not.toBe("ask")
  })

  /**
   * 只敢 deny **已投影**的类型（今天只有 skill）。
   *
   * 别的工具（`bash` / `read` / `edit` …）**不进这张表**——它们不由 RBAC 管，落回
   * agent 自己的规则集（上游默认）。给它们补一条整体 deny 会让 agent 直接不能用。
   * 这条同时钉住「别顺手 deny 星号」。
   */
  test("④ 只 deny 已投影类型：非 skill 的工具不被兜底 deny 波及", () => {
    const ruleset = AccessSession.sessionRuleset([grant("skill", "fund-analysis", "read")])

    expect(ruleset.every((rule) => rule.permission === "skill")).toBe(true)
    expect(evaluateV1("bash", "rm -rf /", ruleset).action).toBe("ask")
    expect(evaluateV1("read", "/etc/passwd", ruleset).action).toBe("ask")
  })

  /**
   * 未投影的资源类型（`mcp` / `knowledge_base`）：**不产规则**——与 `resolve()` 的裁定一致。
   *
   * ⚠️ 但**那条整体 deny 仍要出**：`GOVERNED` 表说的是「哪些**资源类型**受 RBAC 管」，
   * 与「这个用户有没有该类授权」无关。今天只有 skill 一个受管类型，所以零授权也有 deny。
   * 将来接上 mcp 时，`GOVERNED` 与 `TOOL_OF` 必须**同时**改——有一条断言钉着这个同步。
   */
  test("⑤ mcp / knowledge_base 今天不投影，但受管工具的兜底 deny 不因此消失", () => {
    const ruleset = AccessSession.sessionRuleset([grant("mcp", "fund-db", "read")])

    expect(ruleset).toEqual([{ permission: "skill", pattern: "*", action: "deny" }])
  })

  /**
   * 🔗 **`GOVERNED` 必须与 `AccessRbac.TOOL_OF` 的键集一致**——这是一条「被上游变更惊醒」
   * 的断言（`LEARNINGS #003-05`：镜像要写成能被对面改动惊醒的样子）。
   *
   * 将来谁往 `TOOL_OF` 加了 `mcp`，本条立刻红，逼他回来回答一个**必须有人回答**的问题：
   * 「这个类型映射到的工具名，是不是被别的用途共用了？」——链 A 的 MCP 资源工具用的是
   * `permission: "read"`（`src/session/tools.ts` 的 `ctx.ask({permission: "read", patterns: ["mcp:<server>:*"]})`），
   * **与文件读取同名**；照抄 skill 那样给它补一条整体 `deny read:*` 会把文件读一起拒掉。
   * 那种类型不能走「整体 deny + 逐条 allow」，得另设计。
   */
  test("⑥ GOVERNED 与 core 的 TOOL_OF 键集同步（加新类型时这条会红）", () => {
    expect([...AccessSession.GOVERNED].map(String).sort()).toEqual(Object.keys(AccessRbac.TOOL_OF).sort())
  })
})

describe("T006 · 把 prompt 带来的工具开关并进会话规则集", () => {
  const clientRule = (permission: string, action: "allow" | "deny"): PermissionV1.Rule => ({
    permission,
    pattern: "*",
    action,
  })

  /**
   * 🔴 **capability 必须是最后的话事人。**
   *
   * `packages/opencode/src/session/prompt.ts` 原先在 `input.tools` 非空时**整体覆盖**
   * `session.permission`。`input.tools` 是**客户端**发来的（`PromptInput.tools`），
   * 于是 `tools: { skill: true }` 就能把 capability 整个抹掉——**一次请求绕过 RBAC**。
   * 并入时客户端规则必须排在 capability **前面**（`findLast` 后者胜）。
   */
  test("⑦ 客户端 tools 里的 allow 不得压过 capability 的 deny", () => {
    const capability = AccessSession.sessionRuleset([grant("skill", "fund-analysis", "read")])
    const merged = AccessSession.mergeClientRules([clientRule("skill", "allow")], capability)

    // 客户端想把所有 skill 打开——但 capability 没授 call-analysis。
    expect(evaluateV1("skill", "call-analysis", merged).action).toBe("deny")
    // 授过的那条照样是 allow（并入不是覆盖）。
    expect(evaluateV1("skill", "fund-analysis", merged).action).toBe("allow")
  })

  /**
   * 客户端可以对**不受 RBAC 管**的工具表态（那正是 `input.tools` 原本的用途）——
   * 并入不得把它吃掉。
   */
  test("⑧ 客户端对非受管工具的开关照样生效", () => {
    const capability = AccessSession.sessionRuleset([])
    const merged = AccessSession.mergeClientRules([clientRule("bash", "deny")], capability)

    expect(evaluateV1("bash", "ls", merged).action).toBe("deny")
  })

  /**
   * **幂等**：第二次 prompt 再并一次，结果不变。
   *
   * 并入是「客户端规则 + 既有规则」拼接；每来一次 prompt 就拼一次会**无限增长**
   * （`session.permission` 会被逐次写回）。规则集是**持久化在会话上**的，长成一条
   * 每 prompt 翻倍的列表既是存储泄漏、也让「这条会话到底有什么规则」没法直读。
   * 判据：`merge(客户端, merge(客户端, 既有)) == merge(客户端, 既有)`。
   */
  test("⑨ 并入是幂等的（同一份客户端规则并两次不增长）", () => {
    const capability = AccessSession.sessionRuleset([grant("skill", "fund-analysis", "read")])
    const client = [clientRule("bash", "deny")]
    const once = AccessSession.mergeClientRules(client, capability)

    expect(AccessSession.mergeClientRules(client, once)).toEqual(once)
  })
})
