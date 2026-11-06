import { describe, expect, test } from "bun:test"
import { caseCommand, readyConfigPatch } from "@/server/openhive/case-mcp-supervisor"
import { parseReadyLine } from "@/server/openhive/governance-mcp-supervisor"

/**
 * 计划 6 · Task 6：案件情报 MCP 的 HTTP 入口与监督器。
 *
 * 这里只钉**不依赖真进程 / 真 PG** 的那一层：命令三态、配置补丁形状、READY 行前缀。
 * HTTP 入口与挂载需要真进程 + 真 PG，记缺口表（`case-mcp-supervisor.ts` 文件头），不算已覆盖。
 *
 * 最后两条是本Task改 `parseReadyLine` 的**回归网**：加第二参数时默认值必须保留，
 * 否则治理 MCP 的既有行为会被悄悄改掉。
 */
describe("caseCommand", () => {
  test("默认命令：PG_* 齐了才起，entry 指向 case-mcp-main.ts", () => {
    expect(caseCommand({ PG_HOST: "h", PG_DATABASE: "d", PG_USER: "u" })).toEqual({
      kind: "command",
      command: ["bun", "run", expect.stringContaining("case-mcp-main.ts")],
    })
  })

  test("缺任一 PG_* ⇒ off（不带着坏配置崩溃循环）", () => {
    expect(caseCommand({ PG_HOST: "h", PG_DATABASE: "d" })).toEqual({ kind: "off" })
  })

  test("OPENHIVE_CASE_MCP=off ⇒ off（即使 PG 齐全）", () => {
    expect(caseCommand({ PG_HOST: "h", PG_DATABASE: "d", PG_USER: "u", OPENHIVE_CASE_MCP: "off" })).toEqual({
      kind: "off",
    })
  })

  test("显式 CMD 覆盖默认；非法 JSON ⇒ invalid 且说清", () => {
    expect(caseCommand({ OPENHIVE_CASE_MCP_CMD: '["bun","run","x.ts"]' })).toEqual({
      kind: "command",
      command: ["bun", "run", "x.ts"],
    })
    expect(caseCommand({ OPENHIVE_CASE_MCP_CMD: "bun run x" })).toMatchObject({ kind: "invalid" })
  })

  test("配置补丁形状与治理条目同构", () => {
    expect(readyConfigPatch(41234)).toEqual({
      mcp: { "openhive-case": { type: "remote", url: "http://127.0.0.1:41234/mcp" } },
    })
  })
})

describe("parseReadyLine（案件侧前缀）", () => {
  test("READY 行用 CASE_MCP_READY 前缀解析", () => {
    expect(parseReadyLine('CASE_MCP_READY {"port":41234}', "CASE_MCP_READY")).toBe(41234)
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":1}', "CASE_MCP_READY")).toBeUndefined()
  })

  test("治理侧的默认前缀不受影响（加参数不改变旧行为）", () => {
    expect(parseReadyLine('GOVERNANCE_MCP_READY {"port":7}')).toBe(7)
    expect(parseReadyLine('CASE_MCP_READY {"port":7}')).toBeUndefined()
  })
})
