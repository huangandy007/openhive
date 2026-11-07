import { connect } from "@opencode-ai/auth/db"
import { followParentDeath } from "@opencode-ai/auth/parent-watch"
import { workspaceRoot } from "@opencode-ai/auth/workspace"
import { readyLine, startCaseMcpHttp } from "./case-mcp-http"

/**
 * 案件情报 MCP server 的进程入口（计划 6 / Task 6）。
 *
 * 由 `case-mcp-supervisor.ts` 以 `["bun", "run", "<repo>/.../case-mcp-main.ts"]` 拉起**一份**：
 * 就绪后向 **stdout** 打一行 `CASE_MCP_READY {"port":N}`，其它输出一律走 stderr。
 *
 * 为什么这层不写测试：它只做三件事——读 env、建连接、起 HTTP。协议与工具语义在
 * `case-mcp-server.ts` 测（in-memory transport，真 MCP 握手）；这层需要真进程 + 真 PG，
 * 记缺口表，**不算已覆盖**。
 */
if (import.meta.main) {
  try {
    const { port, stop } = await startCaseMcpHttp({
      db: connect(process.env),
      workspaceRoot: workspaceRoot(process.env),
    })
    process.stdout.write(`${readyLine(port)}\n`)
    // 监督器收尾时先 SIGTERM（POSIX）再按需 SIGKILL；没有这段，子进程是被硬杀的，
    // 在途请求来不及收尾。win32 侧 `taskkill /T /F` 仍是立即的（没有可捕获的 SIGTERM）。
    const shutdown = async () => {
      await stop()
      process.exit(0)
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
    // 内核被硬杀时上面两个信号都到不了（win32 上 `taskkill /T` 也随父进程一起没了）⇒ 自己看父死。
    followParentDeath(() => void shutdown())
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        事件: "case-mcp 启动失败",
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    )
    process.exit(1)
  }
}
