import { spawn } from "node:child_process"
import { join } from "node:path"

/**
 * 夹具：装作内核里的监督器。
 *
 * 拉法和 `governance-mcp-supervisor.ts` / `case-mcp-supervisor.ts` **逐字一致**：
 * 命令名是 `bun`（走 PATH 上的 shim，所以真实进程链是 父 → cmd.exe → bun.exe），
 * stdin 开成 `pipe`。父进程被硬杀时，这条 `pipe` 的写端随进程一起消失 ⇒ 孙进程读到 EOF。
 */
const 子进程 = spawn("bun", ["run", join(import.meta.dir, "mcp-watch-child.ts")], {
  env: { ...process.env, OPENHIVE_MCP_PARENT_WATCH: "1" },
  stdio: ["pipe", "pipe", "pipe"],
})
子进程.stdout?.on("data", (块: Buffer) => process.stdout.write(块))
子进程.stderr?.on("data", (块: Buffer) => process.stderr.write(块))
process.stdout.write(`PARENT_READY ${process.pid}\n`)
setInterval(() => {}, 1000)
