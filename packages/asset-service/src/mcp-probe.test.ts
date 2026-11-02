import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import type { Socket } from "node:net"
import { tmpdir } from "node:os"
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { probeMcpConnection } from "./mcp-probe"

/**
 * 试连模块的用例（设计 §5.4）。
 *
 * 覆盖：remote 正常 / remote 连不上 / remote 错误体回显凭据 / remote 不响应 / remote 超时上限 /
 * local 正常 / local 命令不存在 / local 超时杀进程树。
 */

const 服务器: Server[] = []
const 套接字 = new Set<Socket>()

function 记服务器(server: Server): Server {
  服务器.push(server)
  server.on("connection", (socket) => {
    套接字.add(socket)
    socket.on("close", () => 套接字.delete(socket))
  })
  return server
}

afterEach(() => {
  // 先断开连接再关监听：不响应服务器会一直挂着 socket，只关监听等不到 close。
  for (const socket of 套接字) socket.destroy()
  套接字.clear()
  for (const server of 服务器.splice(0)) server.close()
})

async function 监听(httpServer: Server): Promise<string> {
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
  const address = httpServer.address()
  if (address === null || typeof address === "string") throw new Error("没有端口")
  return `http://127.0.0.1:${address.port}`
}

/** 每请求一套 transport（无状态模式），满足 SDK 的 streamable HTTP 契约。 */
async function 起远程工具服务器(): Promise<string> {
  const server = 记服务器(
    createServer((req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const mcp = new McpServer(
        { name: "probe-fixture", version: "1.0.0" },
        { capabilities: { tools: {} } },
      )
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: "ping", inputSchema: { type: "object" } }],
      }))
      void mcp
        .connect(transport)
        .then(() => transport.handleRequest(req, res))
        .catch(() => {
          if (!res.headersSent) res.statusCode = 500
          res.end()
        })
    }),
  )
  return `${await 监听(server)}/mcp`
}

/**
 * 回显 Authorization 原文的 401 服务器：驱动异常带着请求头原文出来，
 * 用来证明探针的错误脱敏真的生效（不是「错误里本来就没有」）。
 */
async function 起回显凭据服务器(): Promise<string> {
  const server = 记服务器(
    createServer((req, res) => {
      res.writeHead(401, { "content-type": "text/plain" })
      res.end(`拒绝访问：${req.headers.authorization ?? "无凭据"}`)
    }),
  )
  return `${await 监听(server)}/mcp`
}

async function 起不响应服务器(): Promise<string> {
  const server = 记服务器(createServer(() => { /* 永不响应 */ }))
  return `${await 监听(server)}/mcp`
}

function 还活着(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function 等待进程消失(pid: number, 时限: number): Promise<void> {
  const 截止 = Date.now() + 时限
  while (Date.now() < 截止) {
    if (!还活着(pid)) return
    await Bun.sleep(100)
  }
}

/** 等 fixture 把孙进程 pid 写进文件（进程启动有先后，不能假设回来就到）。 */
async function 等pid文件(path: string, 时限: number): Promise<number> {
  const 截止 = Date.now() + 时限
  while (Date.now() < 截止) {
    const file = Bun.file(path)
    if (await file.exists()) {
      const pid = Number((await file.text()).trim())
      if (Number.isInteger(pid) && pid > 0) return pid
    }
    await Bun.sleep(50)
  }
  return Number.NaN
}

describe("probeMcpConnection", () => {
  test("remote 正常 ⇒ ok 且工具数正确", async () => {
    const url = await 起远程工具服务器()
    const 结果 = await probeMcpConnection({ transport: "remote", url }, { timeoutMs: 3000 })
    expect(结果).toEqual({ ok: true, toolCount: 1 })
  })

  test("remote 连不上 ⇒ ok:false，错误不含请求头原文", async () => {
    const 结果 = await probeMcpConnection(
      { transport: "remote", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer s3cret" } },
      { timeoutMs: 1000 },
    )
    expect(结果.ok).toBe(false)
    if (!结果.ok) {
      expect(结果.error).not.toContain("Bearer s3cret")
      expect(结果.error).not.toContain("s3cret")
      expect(结果.error.length).toBeGreaterThan(0)
    }
  })

  test("remote 服务端回显请求头 ⇒ 错误里原文被脱敏", async () => {
    const url = await 起回显凭据服务器()
    const 结果 = await probeMcpConnection(
      { transport: "remote", url, headers: { Authorization: "Bearer s3cret" } },
      { timeoutMs: 3000 },
    )
    expect(结果.ok).toBe(false)
    if (!结果.ok) {
      // 先证明驱动错误确实带着原文（否则这条用例对脱敏没有证明力）
      expect(结果.error).not.toContain("s3cret")
      expect(结果.error).toContain("拒绝访问")
    }
  })

  test("remote 不响应 ⇒ 超时", async () => {
    const url = await 起不响应服务器()
    const 结果 = await probeMcpConnection({ transport: "remote", url }, { timeoutMs: 300 })
    expect(结果).toEqual({ ok: false, error: expect.stringContaining("超时") })
  })

  test(
    "remote 请求 60000ms ⇒ 被截到 30000ms",
    async () => {
      const url = await 起不响应服务器()
      const 结果 = await probeMcpConnection({ transport: "remote", url }, { timeoutMs: 60_000 })
      expect(结果.ok).toBe(false)
      if (!结果.ok) {
        expect(结果.error).toContain("30000ms")
        expect(结果.error).not.toContain("60000ms")
      }
    },
    45_000,
  )

  test("local 正常 ⇒ ok", async () => {
    const 结果 = await probeMcpConnection(
      { transport: "local", command: ["bun", `${import.meta.dir}/fixtures/mcp-probe-server.ts`] },
      { timeoutMs: 5000 },
    )
    expect(结果).toEqual({ ok: true, toolCount: 1 })
  })

  test("local 命令不存在 ⇒ ok:false", async () => {
    const 结果 = await probeMcpConnection(
      { transport: "local", command: ["openhive-no-such-command-xyz"] },
      { timeoutMs: 2000 },
    )
    expect(结果.ok).toBe(false)
    if (!结果.ok) expect(结果.error.length).toBeGreaterThan(0)
  })

  test(
    "local 超时 ⇒ 杀掉整个进程树",
    async () => {
      // fixture 参数 --spawn-child --pid-file <tmp>：自己起一个孙进程并写 pid 文件，然后永不响应
      const pidFile = `${tmpdir()}/mcp-probe-tree-${process.pid}-${Date.now()}.txt`
      const 结果 = await probeMcpConnection(
        {
          transport: "local",
          command: [
            "bun",
            `${import.meta.dir}/fixtures/mcp-probe-server.ts`,
            "--spawn-child",
            "--pid-file",
            pidFile,
          ],
        },
        { timeoutMs: 800 },
      )
      expect(结果).toEqual({ ok: false, error: expect.stringContaining("超时") })
      const 孙pid = await 等pid文件(pidFile, 5000)
      expect(Number.isInteger(孙pid) && 孙pid > 0).toBe(true)
      // 给 taskkill 一点时间，再轮询最多 5 秒
      await 等待进程消失(孙pid, 5000)
      expect(还活着(孙pid)).toBe(false)
      await Bun.file(pidFile).delete().catch(() => {})
    },
    20_000,
  )
})
