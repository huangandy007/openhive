import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { GOVERNANCE_TOOL_NAMES } from "./governance"
import { startGovernanceHttp } from "./mcp-http"

/**
 * 治理 MCP 的 HTTP 传输（单进程形态）。
 *
 * 判据只两条：① 真端口上三个工具可列可调（说明 transport 接对了，不是「handler 直调」的假覆盖）；
 * ② `/healthz` 与 `/mcp` 之外一律 404（监督器只会探 `/mcp`，多开出口就是多一个攻击面）。
 */
const databases: ProductionDb[] = []
const tempDirs: string[] = []
const stops: Array<() => void> = []

afterEach(async () => {
  for (const stop of stops.splice(0)) stop()
  await Promise.all(databases.splice(0).map((database) => database.stop()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function start() {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  const root = await mkdtemp(join(tmpdir(), "http-assets-"))
  const workspaceRoot = await mkdtemp(join(tmpdir(), "http-workspace-"))
  tempDirs.push(root, workspaceRoot)
  const server = startGovernanceHttp({ db: database.db, root, workspaceRoot })
  stops.push(() => server.stop())
  return { server, connectUrl: `http://127.0.0.1:${server.port}/mcp` }
}

async function client(url: string): Promise<Client> {
  const instance = new Client({ name: "http-test", version: "0" }, { capabilities: {} })
  await instance.connect(new StreamableHTTPClientTransport(new URL(url)))
  return instance
}

describe("HTTP 传输", () => {
  test("真端口列出三个治理工具，且能真的调一次（缺身份 ⇒ identity_required）", async () => {
    const { connectUrl } = await start()
    const instance = await client(connectUrl)
    try {
      const { tools } = await instance.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([...GOVERNANCE_TOOL_NAMES].sort())

      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- SDK 的 callTool 入参是联合类型
      const result = (await instance.callTool({
        name: "create_skill_draft",
        arguments: { name: "x", description: "x", category: "intelligence", sourceDirectory: "." },
      } as never)) as { isError?: boolean; content: Array<{ type: string; text?: string }> }

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text ?? "").toContain("identity_required")
    } finally {
      await instance.close()
    }
  })

  test("/healthz 回 ok；其它路径 404", async () => {
    const { server } = await start()
    expect(await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).text()).toBe("ok")
    expect((await fetch(`http://127.0.0.1:${server.port}/nope`)).status).toBe(404)
  })
})
