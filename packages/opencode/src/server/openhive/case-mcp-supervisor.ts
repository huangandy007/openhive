import { join } from "node:path"
import { Cause, Effect, Layer } from "effect"
import { CASE_MCP_SERVER as AUTH_CASE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { Config } from "@/config/config"
import { MCP_PATH, PORT_ENV, READY_PREFIX } from "./case-mcp-http"
import { 串行写Effect } from "./mcp-config-writer"
import { START_TIMEOUT_MS, spawnGovernanceMcp, startSupervision } from "./governance-mcp-supervisor"

/**
 * 【这是要保留的定制】openhive 模块：**案件情报 MCP 内核侧监督器**（计划 6 / Task 6）。
 *
 * 进程树收尾、退避、首次就绪等待全部复用 `governance-mcp-supervisor.ts`——这里只提供
 * 三样案子自己的东西：命令三态、配置补丁、READY 前缀。**不要**复制那段进程树逻辑
 *（`LEARNINGS #005-04`：同一件事只有一份实现）。
 *
 * ## 起不来的前提
 *
 * `connect()` 的五个必需项（`PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` /
 * `PG_DATABASE`）任一为空 ⇒ `{ kind: "off" }`：不带坏配置进「起—崩—起」循环
 *（少配一个也会在 `connect()` 构造期抛错、退出，监督器只能永久退避）。
 * 显式 `OPENHIVE_CASE_MCP_CMD` 与 `OPENHIVE_CASE_MCP=off` 的优先级见 `caseCommand`。
 *
 * ## 配置写入
 *
 * 就绪后写 `mcp["openhive-case"]`。**必须**走 `mcp-config-writer.ts` 的串行写者：
 * 治理监督器与 MCP 配置同步器也在写同一份全局配置，直接 `yield* config.updateGlobal(...)`
 * 会让一方的条目整段丢失。失败只记 `error.name`，不回显配置原文（`mcp` 段含凭据）。
 *
 * ⚠️ **内核挂载层无单测**（需要真进程 + 真 PG）；HTTP 入口本身已有 4 条真服务用例。
 */
// 名字只在 `@opencode-ai/auth/builtin-mcp` 定义一次：capability 的 builtin 名单也从那里读，
// 两处各写一份字符串迟早漂移（`LEARNINGS #002-06`）。
export const CASE_MCP_SERVER = AUTH_CASE_MCP_SERVER
/** JSON 数组，覆盖默认命令（镜像里 bun 不在 PATH 时用）。 */
export const COMMAND_ENV = "OPENHIVE_CASE_MCP_CMD"
/** `off` ⇒ 显式关掉（即使 PG 齐全）。 */
export const DISABLE_ENV = "OPENHIVE_CASE_MCP"

export type CommandPlan =
  | { readonly kind: "off" }
  | { readonly kind: "command"; readonly command: readonly string[] }
  | { readonly kind: "invalid"; readonly reason: string }

export function caseCommand(env: Record<string, string | undefined>): CommandPlan {
  if (env[DISABLE_ENV] === "off") return { kind: "off" }

  const explicit = env[COMMAND_ENV]
  if (explicit !== undefined && explicit.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(explicit)
      if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every((item) => typeof item === "string")) {
        return { kind: "invalid", reason: `${COMMAND_ENV} 必须是长度 ≥ 2 的字符串数组` }
      }
      return { kind: "command", command: parsed }
    } catch {
      return { kind: "invalid", reason: `${COMMAND_ENV} 不是合法 JSON` }
    }
  }

  // 五连全查（复审 M-1）：与 `@opencode-ai/auth/db` 的 `REQUIRED` 对齐——缺任一都不起；
  // 少配 `PG_PORT` / `PG_PASSWORD` 时 `connect()` 会在构造期抛错，监督器只会无限退避重启。
  if (!env.PG_HOST || !env.PG_PORT || !env.PG_USER || !env.PG_PASSWORD || !env.PG_DATABASE) {
    return { kind: "off" }
  }
  // 统一用 `/`：win32 的 `join` 给 `\`，而命令数组里习惯正斜杠（`#006-23`）。
  return {
    kind: "command",
    command: ["bun", "run", join(import.meta.dir, "case-mcp-main.ts").replaceAll("\\", "/")],
  }
}

/** 就绪后写进全局配置的补丁（单独导出以便钉住形状）。 */
export function readyConfigPatch(port: number) {
  return {
    mcp: {
      [CASE_MCP_SERVER]: { type: "remote" as const, url: `http://127.0.0.1:${port}${MCP_PATH}` },
    },
  }
}

/**
 * 就绪回调：写全局配置。与治理侧 `readyHandler` 同构——`updateGlobal` 写盘走
 * `Effect.orDie`（defect，错误通道是 `never`），必须 `catchCause`；否则配置目录只读时
 * 监督纤维整个死掉，子进程再也不会被拉起。
 */
function readyHandler(config: Pick<Config.Interface, "updateGlobal">, port: number): Effect.Effect<boolean> {
  return 串行写Effect(config.updateGlobal(readyConfigPatch(port))).pipe(
    Effect.tap((result) => Effect.logInfo("案件 MCP 就绪", { port, configChanged: result.changed })),
    Effect.map(() => true),
    Effect.catchCause((cause) =>
      // 只记类型名：全局 `mcp` 段含业务 server 的 headers / environment，失败消息会整段
      // 嵌入配置原文（`src/config/parse.ts`）——回显它等于把凭据写进内核日志。
      Effect.logError("案件 MCP 配置写入失败", {
        port,
        error: Cause.prettyErrors(cause).map((error) => error.name),
      }).pipe(Effect.map(() => false)),
    ),
  )
}

/**
 * 首启端口：缺省 / 非整数 / 越界 ⇒ 0（系统分配）。之后的轮次沿用上一轮**回报**的端口。
 *（与治理侧 `firstPortOf` 同形，但那个读的是治理的 `PORT_ENV`，不能共用。）
 */
function firstPortOf(env: Record<string, string | undefined>): number {
  const raw = env[PORT_ENV]
  if (raw === undefined || raw.trim() === "") return 0
  const port = Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0
}

/** 进程级「已挂载」标记，随作用域收尾复位（同治理侧：两份 routes 图不能起两个进程）。 */
let mounted = false

/** 生产层：读 env 决定起不起、把就绪端口写进全局配置。 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const plan = caseCommand(process.env)
    if (plan.kind === "off") return
    if (plan.kind === "invalid") {
      yield* Effect.logWarning(`案件 MCP 未启动：${plan.reason}`)
      return
    }
    if (mounted) return
    mounted = true
    yield* Effect.addFinalizer(() => Effect.sync(() => void (mounted = false)))

    const config = yield* Config.Service
    const firstPort = firstPortOf(process.env)

    yield* startSupervision({
      launch: (port) =>
        spawnGovernanceMcp({
          command: plan.command,
          port: port ?? firstPort,
          readyPrefix: READY_PREFIX,
          portEnv: PORT_ENV,
        }),
      onReady: (port) => readyHandler(config, port),
      onFailure: (reason) => Effect.logWarning(reason),
      sleep: (ms) => Effect.sleep(ms),
      startTimeoutMs: START_TIMEOUT_MS,
      // 故障日志别串成「治理 MCP」——运维会去查错服务（复审 I-2）。
      label: "案件 MCP",
    })
  }),
)

export const OpenhiveCaseMcp = { layer }
