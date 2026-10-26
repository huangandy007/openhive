import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { connect } from "@opencode-ai/auth/db"
import { workspaceRoot } from "@opencode-ai/auth/workspace"
import { createGovernanceServer } from "./governance"
import { assetsRoot } from "./storage"

/**
 * 资产治理 MCP server 的 stdio 入口（009 T012）。
 *
 * 由 opencode 以 local MCP server 拉起（T014 负责把这条命令拼进每个用户的配置）：
 *
 *     ["bun", "run", "<repo>/packages/asset-service/src/mcp-main.ts"]
 *
 * ## 三个环境输入
 *
 * - `PG_*`：`connect(process.env)` 的必需项；缺失时这里是**启动即失败**，不是带着坏配置跑；
 * - `OPENHIVE_ASSETS_ROOT`：资产共享根（省略 = `/assets`）；
 * - `OPENHIVE_WORKSPACE_ROOT`：沙箱根的上级（省略 = `/workspaces`）。沙箱边界不再靠 cwd
 *   判定：每次调用的目录由内核注入 `_meta["openhive/directory"]`，服务端校验它落在
 *   `<workspaceRoot>/<userId>/` 之内（`sandboxDirectoryOf`）。
 *
 * ## 为什么这层不写测试
 *
 * 它只做三件事：读 env、建连接、挂 stdio。协议与工具语义在 `governance.ts` 测
 * （in-memory transport，真 MCP 客户端/服务器握手）。这层需要真进程 + 真 PG 才能验，
 * 本机夹具（PGlite）不允许同一实例开第二个客户端（`auth/test-support.ts` 的实测约束），
 * 故记入缺口表，**不算已覆盖**。
 */
const server = createGovernanceServer({
  db: connect(process.env),
  root: assetsRoot(process.env),
  workspaceRoot: workspaceRoot(process.env),
})

await server.connect(new StdioServerTransport())
