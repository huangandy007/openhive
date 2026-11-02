/**
 * 试连测试用的 stdio MCP server（fixture）。
 *
 * - 默认：暴露一个 `ping` 工具，正常应答 `tools/list`。
 * - `--spawn-child --pid-file <path>`：先起一个孙进程并把 pid 写进文件，然后**永不响应**；
 *   用来验证试连超时后杀的是整棵进程树，而不只是直接子进程。
 *
 * 孙进程刻意保留 stdout/stderr 管道（不写任何东西）：这两个打开的句柄让 fixture 自己
 * 一直活着，直到被 `taskkill /T`（Windows）连树带走——否则子进程先退出会把孙进程变成孤儿，
 * 杀树用例就测不到东西了。
 */
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"

const argv = process.argv.slice(2)

if (argv.includes("--spawn-child")) {
  // 这里刻意**不**静态导入 SDK：杀树用例的试连超时只有几百毫秒，
  // 先把孙进程和 pid 文件做出来，别把时间花在加载 SDK 上。
  //
  // 孙进程用 cmd/sh 而不是 `process.execPath`（bun）：本机实测 bun.exe 的 spawn
  // 要 ~3.2 秒才返回（Defender 扫描），会直接吃掉试连超时窗口。
  const 长命 = process.platform === "win32"
    ? { command: process.env.ComSpec ?? "cmd.exe", args: ["/c", "ping", "-n", "60", "127.0.0.1"] }
    : { command: "/bin/sh", args: ["-c", "sleep 60"] }
  const 孙 = spawn(长命.command, 长命.args, {
    stdio: ["ignore", "pipe", "pipe"],
  })
  const pidFile = argv[argv.indexOf("--pid-file") + 1]
  if (pidFile !== undefined && 孙.pid !== undefined) writeFileSync(pidFile, String(孙.pid))
  await new Promise(() => {})
} else {
  const [{ Server }, { StdioServerTransport }, { ListToolsRequestSchema }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ])
  const server = new Server(
    { name: "mcp-probe-fixture", version: "1.0.0" },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ping", inputSchema: { type: "object" } }],
  }))
  await server.connect(new StdioServerTransport())
}
