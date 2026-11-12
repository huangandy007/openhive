import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { PORT_ENV, startCaseMcpHttp } from "../../src/server/openhive/case-mcp-http"
import { 工具名 } from "../../src/server/openhive/case-mcp-server"
import type { Queryable } from "../../src/server/openhive/case-store"

/**
 * 计划 6 · Task 6（复审 I-3）：HTTP 入口的真服务覆盖。
 *
 * 复审推翻了「只能真进程 + 真 PG」：用桩 `Queryable` 起一份真 `Bun.serve`，
 * 协议握手走 SDK 的真 HTTP 客户端。这里不碰数据库（`initialize` / `tools/list`
 * 都不查库），所以桩永远不该被调用。
 *
 * ⚠️ 不覆盖「>10s 的 tools/call 不被掐」：那要真等 10 秒以上，拖垮测试时长；
 * 本轮复审已用探针验过（Bun 默认 10s ⇒ ECONNRESET），`startCaseMcpHttp` 已设
 * `idleTimeout: 255`，记缺口表，**不算自动化已覆盖**。
 */
const 桩库: Queryable = {
  execute: () => Promise.reject(new Error("HTTP 入口用例不该查库")),
}

const deps = { db: 桩库, workspaceRoot: "/tmp/openhive-case-mcp-http-测试" }

const 基址 = (port: number) => `http://127.0.0.1:${port}`

describe("startCaseMcpHttp", () => {
  test("健康检查与路由：/healthz 200 ok、/nope 404、GET /mcp 405 + allow POST", async () => {
    const server = await startCaseMcpHttp(deps)
    try {
      const health = await fetch(`${基址(server.port)}/healthz`)
      expect(health.status).toBe(200)
      expect(await health.text()).toBe("ok")

      const nope = await fetch(`${基址(server.port)}/nope`)
      expect(nope.status).toBe(404)

      const getMcp = await fetch(`${基址(server.port)}/mcp`)
      expect(getMcp.status).toBe(405)
      expect(getMcp.headers.get("allow")?.toLowerCase()).toBe("post")
    } finally {
      await server.stop()
    }
  })

  test("POST /mcp：真客户端握手成功，tools/list 与 工具名 清单一致", async () => {
    const server = await startCaseMcpHttp(deps)
    const client = new Client({ name: "案件 MCP 测试", version: "0.1.0" })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${基址(server.port)}/mcp`)))
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([...工具名].sort())
    } finally {
      await client.close()
      await server.stop()
    }
  })

  test("stop() 之后再连 ⇒ 连接被拒", async () => {
    const server = await startCaseMcpHttp(deps)
    const base = 基址(server.port)
    // 先确认它确实活着，否则「拒绝」可能只是因为一开始就没起来。
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
    await server.stop()
    // 不依赖具体错误文案：只断言「连不上」这件事。
    const 连接被拒 = await fetch(`${base}/healthz`).then(
      () => false,
      () => true,
    )
    expect(连接被拒).toBe(true)
  })

  test("OPENHIVE_CASE_MCP_PORT 非法 ⇒ 系统分配（实际端口 > 0）", async () => {
    const previous = process.env[PORT_ENV]
    try {
      for (const 值 of ["abc", "70000", "-1", ""]) {
        process.env[PORT_ENV] = 值
        const server = await startCaseMcpHttp(deps)
        try {
          expect(server.port).toBeGreaterThan(0)
        } finally {
          await server.stop()
        }
      }
    } finally {
      if (previous === undefined) delete process.env[PORT_ENV]
      else process.env[PORT_ENV] = previous
    }
  })
})
