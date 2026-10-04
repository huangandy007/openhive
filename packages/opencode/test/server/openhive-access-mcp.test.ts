import { describe, expect, it } from "bun:test"
import { AccessRbac } from "@opencode-ai/core/access/rbac"
import { AccessSession } from "@opencode-ai/core/access/session"
import { evaluate as evaluateV1, Permission } from "../../src/permission"

/**
 * T007（FR-005 / FR-006 的连接级那一半）：**`mcp` 授权行 → 链 A 会话规则集**。
 *
 * ## 这条补的是哪个洞
 *
 * T006 的 `sessionRuleset` 只投影 `skill`：给一条 `mcp` 授权行，它**产不出任何规则**
 * （`AccessRbac.TOOL_OF` 里没有 `mcp`）。后果是**两个方向同时漏**：
 * - **授过的 server**：没有任何 allow ⇒ 落回上游 `ask` ⇒ 界面上给民警一个「总是允许」按钮
 *   （`always: ["*"]`，`packages/opencode/src/session/tools.ts` 的 MCP 工具循环）；
 * - **没授的 server**：一样落回 `ask` ⇒ **民警自己把自己批进去**。这正是 T006 用一条整体
 *   `deny skill:*` 堵掉的那个形状（宪法反模式「用前端隐藏资源替代权限校验」），只是换了资源类型。
 *
 * ## 为什么 MCP 要**两套形状**（同一个 server 出两条规则）
 *
 * 因为它的两个出口在链 A 里是**两条不同的权限通道**（`src/session/tools.ts` 实测）：
 *
 * | 出口 | `ask({permission, patterns})` | 可隐藏？ |
 * |---|---|---|
 * | **server 工具**（`tools/call`） | `{ permission: "<工具名>", patterns: ["*"] }` —— 工具名是 `sanitize(server) + "_" + sanitize(name)`（`McpCatalog.toolName`） | ✅ `Permission.disabled` 认工具名 |
 * | **资源工具**（`resources/read`） | `{ permission: "read", patterns: ["mcp:<server>:*"] }` | ❌ **与文件读取同名** |
 *
 * 资源那一半**不能**隐藏：`Permission.disabled` 把三个 `*_mcp_resource*` 工具名先归一成 `read`
 * 再判（`src/permission/index.ts:206`），给它一条整体 `deny read:*` 会**把民警读文件一起拒掉**。
 * 所以：资源那一半只有**执行期**的 `deny` 兜底，**看不见那一层做不到**——这是本 feature 的
 * 一处已知不对称，③ 用断言把它钉在明面上（不是漏了，是确认过做不到）。
 *
 * ## 为什么两套名字要分别翻译
 *
 * 工具前缀要用 **sanitize 过**的名字（`fund.db` → `fund_db_*`），资源 pattern 要用**原样**名字
 * （`mcp:fund.db:*`）。而 `sanitize` 住在 `packages/opencode/src/mcp/catalog.ts`——**core 够不着它**
 * （core 不依赖 opencode）。所以 core 里**绝不复制一份 sanitize**：调用方把**算好的名字**传进来，
 * core 只拼规则形状（`LEARNINGS #003-05`：镜像的两侧只要有一条不覆盖的写法，这个镜像就是假的）。
 * 本文件的 `FUND_DB` 就照这个契约手写「已翻译」的两个名字——翻译本身由接线测试盯着
 * （`packages/opencode/test/server/openhive-access-mcp-wiring.test.ts`）。
 *
 * ## 判据用**真**判决器
 *
 * `evaluateV1` / `Permission.disabled` 都是生产函数（`src/permission/index.ts`），
 * 不是这里复刻的镜像——断言写成「链 A 到底放不放」，而不是「列表里有没有某条字符串」。
 */

const grant = (resourceType: string, resourceId: string, perm: string): AccessRbac.Grant => ({
  resourceType,
  resourceId,
  perm,
})

/** 一个配好的 server：`server` 原样（资源 pattern 用）、`toolPattern` 已翻译（工具名用）。 */
const FUND_DB: AccessSession.McpServerNaming = { server: "fund.db", toolPattern: "fund_db_*" }

/** 该 server 的一个工具在链 A 里的名字（`McpCatalog.toolName("fund.db", "query")`）。 */
const FUND_QUERY = "fund_db_query"

const rulesetOf = (grants: readonly AccessRbac.Grant[], servers?: readonly AccessSession.McpServerNaming[]) =>
  AccessSession.sessionRuleset(grants, servers)

describe("T007 · mcp 授权行 → 会话规则集（连接级，FR-005/FR-006）", () => {
  /**
   * 🔴 **没授的 server：工具与资源都拒。**
   *
   * 两条规则缺一不可：只有工具那条 ⇒ 资源工具照样能列、能读（`read` + `mcp:<server>:*` 落回 `ask`）；
   * 只有资源那条 ⇒ server 工具落回 `ask`。
   */
  it("未授权的 server ⇒ 工具被拒、资源被拒（各一条 deny）", () => {
    const ruleset = rulesetOf([], [FUND_DB])

    expect(evaluateV1(FUND_QUERY, "*", ruleset).action).toBe("deny")
    expect(evaluateV1("read", "mcp:fund.db:ledger", ruleset).action).toBe("deny")
  })

  /** **对照**：授过 `read` ⇒ 两边都放行，且**不是**靠 `ask` 过的（`allow` 才不给民警自批的机会）。 */
  it("授过 read 的 server ⇒ 工具与资源都放行", () => {
    const ruleset = rulesetOf([grant("mcp", "fund.db", "read")], [FUND_DB])

    expect(evaluateV1(FUND_QUERY, "*", ruleset).action).toBe("allow")
    expect(evaluateV1("read", "mcp:fund.db:ledger", ruleset).action).toBe("allow")
  })

  /**
   * 🔴 **不误伤文件读取**——这是「资源那一半为什么不能整体 deny read」的对照：
   * 同一个规则集下，读文件仍然是上游的 `ask`（**不是** `deny`）。
   *
   * 少了这条，把资源规则偷懒写成 `{ permission: "read", pattern: "*", deny }` 也能让上面
   * 那条「资源被拒」的用例绿——而那样民警连 `Read` 工具都用不了了。
   */
  it("对照：资源 deny 不会误伤文件读取（读文件仍是上游的 ask）", () => {
    const ruleset = rulesetOf([], [FUND_DB])

    expect(evaluateV1("read", "/etc/passwd", ruleset).action).not.toBe("deny")
    expect(evaluateV1("read", "src/index.ts", ruleset).action).not.toBe("deny")
    expect(evaluateV1("read", "mcp:other-db:ledger", ruleset).action).not.toBe("deny")
  })

  /**
   * **「看不见」那一层：server 工具能被隐藏，资源工具不能。**
   *
   * 两个断言一起看才有意义：前者是 T005 那套「看不见」在 mcp 上的延续；后者是**已知不对称**的
   * 记录——`read_mcp_resource` 归一成 `read` 之后与文件读取同命，隐藏它就等于隐藏文件的读。
   * 所以未授权 server 的资源**可见但不可用**（执行期 `deny`）。这是取舍，不是遗漏。
   */
  it("未授权 server 的工具不出现在模型侧清单里；资源工具做不到这一点（已知不对称）", () => {
    const ungranted = rulesetOf([], [FUND_DB])

    expect(Permission.disabled([FUND_QUERY], ungranted).has(FUND_QUERY)).toBe(true)
    // 资源工具**不**被隐藏（隐藏它就会把文件读取一起隐藏——同一个 permission 名）。
    expect(Permission.disabled(["read_mcp_resource"], ungranted).has("read_mcp_resource")).toBe(false)
    // 但真去读就被拒——可见 ≠ 可用。
    expect(evaluateV1("read", "mcp:fund.db:ledger", ungranted).action).toBe("deny")
  })

  /** 授过 `read` ⇒ 两边的 deny 都不该冒出来（并入不是覆盖）。 */
  it("授过 read ⇒ 工具照旧可见", () => {
    const granted = rulesetOf([grant("mcp", "fund.db", "read")], [FUND_DB])

    expect(Permission.disabled([FUND_QUERY], granted).has(FUND_QUERY)).toBe(false)
  })

  /**
   * ⚠️ **别的动作不算数**：`write` / `review` / `admin` 是管理动作（改内容 / 批上线 / 上下架），
   * 不是「能不能调这个 server」。有行 ≠ 放行——与 `AccessRbac.resolve` 的 `perm === "read"`
   * 同一条裁定（用户 2026-10-04）。
   */
  it("只授了 write（不是 read）⇒ 照旧拒", () => {
    const ruleset = rulesetOf([grant("mcp", "fund.db", "write")], [FUND_DB])

    expect(evaluateV1(FUND_QUERY, "*", ruleset).action).toBe("deny")
    expect(evaluateV1("read", "mcp:fund.db:ledger", ruleset).action).toBe("deny")
  })

  /**
   * **多 server 是个矩阵、不是一个例子**：授 A 不授 B ⇒ 同一条规则集里两边方向相反。
   * 单例测试挑不出「把整批 server 一起 allow/deny」这种错。
   */
  it("矩阵：授 A 不授 B ⇒ A 放行、B 拒绝，互不影响", () => {
    const CALL_DB: AccessSession.McpServerNaming = { server: "call-db", toolPattern: "call_db_*" }
    const ruleset = rulesetOf([grant("mcp", "fund.db", "read")], [FUND_DB, CALL_DB])

    expect(evaluateV1(FUND_QUERY, "*", ruleset).action).toBe("allow")
    expect(evaluateV1("read", "mcp:fund.db:ledger", ruleset).action).toBe("allow")
    expect(evaluateV1("call_db_ledger", "*", ruleset).action).toBe("deny")
    expect(evaluateV1("read", "mcp:call-db:ledger", ruleset).action).toBe("deny")
  })

  /**
   * 🔴 **零回归**：不给 server 名单时，行为与 T006 逐字相同——一条 `mcp` 授权行仍然产不出任何
   * 规则（今天所有既有调用点都是这个形状，包括 `src/session/prompt.ts` 那条）。
   *
   * 这条同时钉住「不许拿 `Config.mcp` 去猜」：名单是**调用方给的**，不是 core 自己去哪读的。
   */
  it("不给 server 名单 ⇒ 与 T006 逐字相同（mcp 授权行产不出规则）", () => {
    expect(rulesetOf([grant("mcp", "fund.db", "read")])).toEqual([{ permission: "skill", pattern: "*", action: "deny" }])
    expect(rulesetOf([])).toEqual([{ permission: "skill", pattern: "*", action: "deny" }])
  })

  /**
   * **skill 与 mcp 互不干扰**（顺序即语义：链 A 取 `findLast`）。
   *
   * 两种资源类型的规则在同一个数组里共存时，各自仍要拿到自己的判决——skill 那条整体 deny
   * 绝不能被 mcp 的 allow 顶掉（或反过来）。这条是「加 mcp 时没把 skill 弄坏」的守门。
   */
  it("skill 与 mcp 共存时各判各的（整体 deny 不被 mcp 的 allow 顶掉）", () => {
    const ruleset = rulesetOf(
      [grant("skill", "fund-analysis", "read"), grant("mcp", "fund.db", "read")],
      [FUND_DB],
    )

    expect(evaluateV1("skill", "call-analysis", ruleset).action).toBe("deny")
    expect(evaluateV1("skill", "fund-analysis", ruleset).action).toBe("allow")
    expect(evaluateV1(FUND_QUERY, "*", ruleset).action).toBe("allow")
    expect(evaluateV1("read", "mcp:fund.db:ledger", ruleset).action).toBe("allow")
  })

  /** 资源 pattern 要用**原样** server 名：`mcp:fund.db:*`（不是 sanitize 后的 `mcp:fund_db:*`）。 */
  it("资源 pattern 用原样 server 名（`mcp:fund.db:*`），工具前缀用翻译后的名字", () => {
    const ruleset = rulesetOf([], [FUND_DB])

    expect(evaluateV1("read", "mcp:fund.db:ledger", ruleset).action).toBe("deny")
    expect(evaluateV1("read", "mcp:fund_db:ledger", ruleset).action).not.toBe("deny")
    expect(evaluateV1(FUND_QUERY, "*", ruleset).action).toBe("deny")
  })
})
