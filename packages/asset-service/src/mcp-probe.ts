import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { spawnSync } from "node:child_process"
import type { McpConnectionInput } from "./mcp-connection"

/**
 * MCP 连接试连（设计 §5.4）。
 *
 * 试连只回答两个问题：**能不能连上**、**能看到几个工具**。它必须短、必须自己收尾——
 * 一次失败的 remote 探测可能永远挂着，一次失败的 local 探测可能留下子进程，所以：
 * 超时兜底（`Promise.race`）、任何失败都收成 `ok:false`（不把异常抛给出口）、
 * 结束前关掉客户端并杀掉 local 子进程树。
 *
 * 错误文本要能回给界面：它**不能**带请求头 / 环境变量的原文（那些是凭据），也不能太长。
 */

export const PROBE_DEFAULT_TIMEOUT_MS = 5_000
/** ⚠️ 与 `mcp-connection.ts` 的 `MCP_TIMEOUT_MAX_MS` 必须同值；改一处必须改另一处。 */
export const PROBE_MAX_TIMEOUT_MS = 30_000

export type McpProbeResult =
  | { readonly ok: true; readonly toolCount: number }
  | { readonly ok: false; readonly error: string }

export type McpProbe = (
  input: McpConnectionInput,
  options?: { readonly timeoutMs?: number },
) => Promise<McpProbeResult>

/** 试连：真连一次、列一次工具、立刻关掉。任何失败都收成 `ok:false`，不抛。 */
export async function probeMcpConnection(
  input: McpConnectionInput,
  options: { readonly timeoutMs?: number } = {},
): Promise<McpProbeResult> {
  const 超时 = Math.min(
    options.timeoutMs ?? input.timeoutMs ?? PROBE_DEFAULT_TIMEOUT_MS,
    PROBE_MAX_TIMEOUT_MS,
  )
  if (!Number.isInteger(超时) || 超时 <= 0) return { ok: false, error: "试连超时必须为正整数（毫秒）" }

  const transport = input.transport === "remote" ? 远程传输(input) : 本地传输(input)
  if (typeof transport === "string") return { ok: false, error: transport }

  const client = new Client({ name: "openhive-asset-probe", version: "1.0.0" }, { capabilities: {} })
  let 计时: ReturnType<typeof setTimeout> | undefined
  try {
    const listed = await Promise.race([
      (async () => {
        await client.connect(transport)
        return client.listTools()
      })(),
      new Promise<never>((_, reject) => {
        计时 = setTimeout(() => reject(new Error(`试连超时（${超时}ms）`)), 超时)
      }),
    ])
    return { ok: true, toolCount: Array.isArray(listed.tools) ? listed.tools.length : 0 }
  } catch (error) {
    return { ok: false, error: 脱敏(错误文本(error), input) }
  } finally {
    if (计时 !== undefined) clearTimeout(计时)
    // pid 必须**在 close 之前**取：close 之后 SDK 会把内部进程引用置空。
    // 用结构化读取而不是 `instanceof`：模块被加载两份时 instanceof 会为 false，
    // 杀树就静默失效了。
    const pid = 读pid(transport)
    // 杀树也必须在 close **之前**：SDK 的 close 先 SIGTERM 直接子进程，Windows 上那等于
    // TerminateProcess——子进程一死，`taskkill /T` 就找不到 pid，孙进程成了孤儿、杀不掉。
    // 先按 pid 杀整棵树，再 close 收尾（此时子进程已退出，close 很快返回）。
    if (typeof pid === "number") 杀进程树(pid)
    try {
      await client.close()
    } catch {
      /* 关不掉不影响结论 */
    }
  }
}

function 远程传输(input: McpConnectionInput): StreamableHTTPClientTransport | string {
  if (input.url === undefined || input.url === "") return "remote 缺少服务地址"
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return "remote 的服务地址不是合法 URL"
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "remote 只支持 http / https"
  return new StreamableHTTPClientTransport(url, {
    requestInit: input.headers === undefined ? undefined : { headers: input.headers },
  })
}

function 本地传输(input: McpConnectionInput): StdioClientTransport | string {
  if (input.command === undefined || input.command.length === 0) return "local 缺少命令"
  const [cmd, ...args] = input.command
  return new StdioClientTransport({
    command: cmd!,
    args,
    // `"pipe"` 会造一条没人读的管道：verbose 的服务写满约 80KB 后自己阻塞，
    // 表现成「试连超时」。不需要子进程的 stderr，直接丢弃。
    stderr: "ignore",
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: 合并环境(input.environment),
  })
}

/**
 * 只继承 SDK 认定的安全环境变量（win32 白名单含 PATH / SYSTEMROOT / TEMP 等），
 * 再叠加连接配置；凭据（PG / MinIO 等）不随子进程走。
 */
function 合并环境(extra: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return { ...getDefaultEnvironment(), ...extra }
}

/**
 * 结构化读取传输上的子进程 pid：只有 stdio 传输有 `pid`，streamable HTTP 没有。
 * 不依赖 `instanceof`，跨模块副本也可用。
 */
function 读pid(transport: unknown): number | undefined {
  if (typeof transport !== "object" || transport === null || !("pid" in transport)) return undefined
  const pid: unknown = transport.pid
  return typeof pid === "number" ? pid : undefined
}

/**
 * 超时后连子进程一起杀：Windows 用 `taskkill /T`（带走整棵树）；
 * 其它平台没有进程组（fixture 没走 `detached`），只能杀直接子进程——孙进程会成为孤儿。
 * 这条差异只影响「杀得干净不干净」，不影响试连结论。
 */
function 杀进程树(pid: number) {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
    } else {
      process.kill(pid, "SIGKILL")
    }
  } catch {
    /* 已经退出 */
  }
}

function 错误文本(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 错误消息里不得带凭据原文：命中就把出现处换成 `***`，再截断。
 *
 * 驱动错误可能回显响应体（streamable HTTP 的 `Error POSTing to endpoint: <body>`），
 * 而某些服务端会把认证头写进错误响应；`environment` 也可能出现在子进程的启动错误里。
 */
function 脱敏(text: string, input: McpConnectionInput): string {
  const 秘密 = [...Object.values(input.headers ?? {}), ...Object.values(input.environment ?? {})]
  let out = text
  for (const value of 秘密) {
    if (value !== "") out = out.split(value).join("***")
  }
  return out.slice(0, 500)
}
