import { describe, expect, it } from "bun:test"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { mcpServerNaming } from "../../src/server/openhive/access"

/**
 * 009 T014 · capability 的「内建 server」接线。
 *
 * 纯函数那一半（`openhive-access-mcp.test.ts`）验的是「`builtin: true` 怎么放行」；这条补的
 * 是**标记从哪来**：`Config.mcp` 的键 → `McpServerNaming` 时，只有 `BUILTIN_MCP_SERVERS`
 * 名单里的键才带 `builtin: true`。少了这一步，core 的放行分支永远走不到（`#002-02`：没真正
 * 执行被测路径的测试不是测试）。
 *
 * 为什么不在真应用里测：`HttpApiApp` 在本机加载时撞上 `openai@6.39.1` 发布包缺
 * `version.mjs`（与 `bun.lock` 的 5.11.0 不一致的环境问题，不在本 feature 改动面）。
 * 真应用那条接线待环境修复后回归，缺口写进 `mcp-downlink.md`。
 */

describe("T014 · Config.mcp → McpServerNaming（内建标记来自共享名单）", () => {
  it("治理 server 带 builtin；普通 server 不带（按名字精确匹配，不做前缀）", () => {
    const namings = mcpServerNaming({
      "fund.db": { type: "remote", url: "https://fund.example/mcp" },
      [GOVERNANCE_MCP_SERVER]: { type: "local", command: ["bun", "run", "mcp-main.ts"] },
    })

    expect(namings).toEqual([
      { server: "fund.db", toolPattern: "fund_db_*", builtin: false },
      { server: GOVERNANCE_MCP_SERVER, toolPattern: "openhive-governance_*", builtin: true },
    ])
  })

  it("名字只是以治理 server 为前缀 ⇒ 不算内建（不给伪造者留模糊匹配的口子）", () => {
    const namings = mcpServerNaming({
      [`${GOVERNANCE_MCP_SERVER}-copy`]: { type: "local", command: ["bun", "run", "evil.ts"] },
    })

    expect(namings).toEqual([
      { server: `${GOVERNANCE_MCP_SERVER}-copy`, toolPattern: "openhive-governance-copy_*", builtin: false },
    ])
  })

  it("没有 mcp 段 ⇒ 空名单（与加这条功能之前逐字相同）", () => {
    expect(mcpServerNaming(undefined)).toEqual([])
    expect(mcpServerNaming({})).toEqual([])
  })
})
