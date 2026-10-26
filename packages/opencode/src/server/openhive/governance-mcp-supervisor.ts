import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"

/**
 * 【这是要保留的定制】openhive 模块：**治理 MCP 单进程形态**（009 T014 的替代形态，2026-10-26）。
 *
 * ## 为什么内核自己拉起
 *
 * 旧形态是「每用户每项目一份 stdio 子进程 + 一份手写 `opencode.json`」：进程数随人数线性涨
 *（实测单实例 ≈ 90MB），配置要有人逐个铺。改成内核启动时 spawn **一份**本地 HTTP MCP，
 * 把 `mcp.openhive-governance` 写进**全局**配置——容器内恒定 2 进程，运维零额外步骤。
 *
 * ## 身份与目录不靠进程边界
 *
 * 一份进程服务所有人，所以「是谁、在哪个沙箱」只能按调用带：内核注入
 * `_meta{openhive/user, openhive/directory}`（`@/mcp/openhive-identity`），服务端独立校验
 * 目录必须落在 `<workspaceRoot>/<user>/` 内。进程边界不再是安全边界，这是本形态成立的前提。
 *
 * ## 失败语义（见 spec §6）
 *
 * - 起不来 / 反复崩 / 15s 没就绪 ⇒ WARN 日志 + 1s/2s/4s…60s 退避重启；
 *   治理工具对模型**不可见**，会话本身照常可用；
 * - 内核退出 ⇒ 作用域收尾把子进程按进程树收掉（`#010-03`：只杀包装进程会留下占端口的子进程）；
 * - 重启时**沿用上一次的端口**，已下发的配置就不会指向死端口。
 *
 * ⚠️ 已知边界：子进程重启后，**已建立的实例**（`InstanceState` 里缓存的 MCP state）不会重建
 * 客户端——新会话正常，老会话要等下次实例初始化。记在 `docs/superpowers/specs/009-ai-assets/state.md`。
 */
export const READY_PREFIX = "GOVERNANCE_MCP_READY"
/** asset-service 包目录；**没设就不起进程**（dev/测试默认不受影响，路径也不靠猜）。 */
export const ENTRY_DIR_ENV = "OPENHIVE_ASSET_SERVICE_DIR"
/** JSON 数组，覆盖默认命令（镜像里 bun 不在 PATH 时用）。 */
export const COMMAND_ENV = "OPENHIVE_GOVERNANCE_MCP_CMD"
/** `off` ⇒ 显式关掉（`ENTRY_DIR_ENV` 已能关，这个给「设了目录但这次不想起」用）。 */
export const DISABLE_ENV = "OPENHIVE_GOVERNANCE_MCP"
export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"
export const START_TIMEOUT_MS = 15_000
export const MAX_BACKOFF_MS = 60_000
/** 稳定跑过这么久再崩 ⇒ 退避计数归零（否则「起—崩—起」永远是 1s）。 */
export const RESET_BACKOFF_AFTER_MS = 60_000

export function parseReadyLine(line: string): number | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(READY_PREFIX)) return undefined
  const rest = trimmed.slice(READY_PREFIX.length).trim()
  try {
    const value: unknown = JSON.parse(rest)
    if (typeof value !== "object" || value === null || !("port" in value)) return undefined
    const port = value.port
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
    return port
  } catch {
    return undefined
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt, 0), MAX_BACKOFF_MS)
}

export type CommandPlan =
  | { readonly kind: "off" }
  | { readonly kind: "command"; readonly command: readonly string[] }
  | { readonly kind: "invalid"; readonly reason: string }

export function governanceCommand(env: Record<string, string | undefined>): CommandPlan {
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

  const dir = env[ENTRY_DIR_ENV]
  if (dir === undefined || dir.trim() === "") return { kind: "off" }
  // 统一用 `/`：win32 的 `join` 给 `\`，而命令数组与配置里的 URL/路径习惯正斜杠，
  // 两种分隔符 bun 与 node 都能跑（`#006-23`：别让路径形状在接缝两侧各说各话）。
  const entry = join(dir, "src", "mcp-http.ts").replaceAll("\\", "/")
  return { kind: "command", command: ["bun", "run", entry] }
}

export interface Launched {
  readonly ready: Promise<number>
  readonly exited: Promise<void>
  stop(): void
}

export function spawnGovernanceMcp(input: {
  readonly command: readonly string[]
  readonly cwd?: string
  readonly port?: number
}): Launched {
  const child: ChildProcess = spawn(input.command[0]!, input.command.slice(1), {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: {
      ...process.env,
      ...(input.port === undefined ? {} : { [PORT_ENV]: String(input.port) }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  let settleReady: ((port: number) => void) | undefined
  let failReady: ((error: Error) => void) | undefined
  const ready = new Promise<number>((resolve, reject) => {
    settleReady = resolve
    failReady = reject
  })
  // 没人 await 时别让它变成 unhandled rejection（supervise 会 await）。
  ready.catch(() => undefined)

  let buffer = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const port = parseReadyLine(line)
      if (port !== undefined) settleReady?.(port)
    }
  })
  // 子进程的日志直接进内核日志（不带就完全看不见它为什么起不来）。
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => process.stderr.write(chunk))

  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      failReady?.(new Error("治理 MCP 在就绪前退出"))
      resolve()
    })
  })

  return {
    ready,
    exited,
    stop: () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
      child.once("exit", () => clearTimeout(timer))
    },
  }
}

async function waitReady(child: Launched, timeoutMs: number): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })
  try {
    return await Promise.race([child.ready.catch(() => undefined), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface SupervisionDeps {
  readonly launch: (port: number | undefined) => Launched
  readonly onReady: (port: number) => Effect.Effect<void, never, never>
  readonly onFailure: (reason: string) => Effect.Effect<void, never, never>
  readonly sleep: (ms: number) => Effect.Effect<void, never, never>
  readonly startTimeoutMs: number
  readonly now?: () => number
}

/**
 * 主循环：起 → 等就绪 → 通知 → 等退出 → 退避 → 再起。永不返回，靠中断收尾。
 *
 * **每一轮各自 `Effect.scoped`**：子进程的 `acquireRelease` 只活在那一轮里——不这样的话，
 * 每次重启都往同一个长命作用域里挂一份收尾器（本轮已退出的进程也一直挂着）。
 * 定时器（`setTimeout`）与停止（SIGTERM→5s 后 SIGKILL）都在 `stop()`/`exited` 里，不占 Effect 的作用域。
 */
export const supervise = (deps: SupervisionDeps): Effect.Effect<never, never, never> =>
  Effect.gen(function* () {
    const now = deps.now ?? Date.now
    let attempt = 0
    let port: number | undefined

    while (true) {
      const startedAt = now()
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Effect.acquireRelease(
            Effect.sync(() => deps.launch(port)),
            (handle) =>
              Effect.promise(async () => {
                handle.stop()
                await handle.exited
              }),
          )

          const readyPort = yield* Effect.promise(() => waitReady(child, deps.startTimeoutMs))
          if (readyPort === undefined) {
            child.stop()
            yield* Effect.promise(() => child.exited)
            return { kind: "timeout" as const }
          }
          yield* deps.onReady(readyPort)
          yield* Effect.promise(() => child.exited)
          return { kind: "exited" as const, port: readyPort }
        }),
      )

      if (outcome.kind === "timeout") {
        yield* deps.onFailure(`治理 MCP 就绪超时（${deps.startTimeoutMs}ms 内未就绪），准备重启`)
      } else {
        port = outcome.port
        yield* deps.onFailure(`治理 MCP 退出（端口 ${outcome.port}），准备重启`)
        if (now() - startedAt >= RESET_BACKOFF_AFTER_MS) attempt = 0
      }

      yield* deps.sleep(backoffMs(attempt))
      attempt += 1
    }
  })

/** 生产层：读 env 决定起不起、把就绪端口写进全局配置。 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const plan = governanceCommand(process.env)
    if (plan.kind === "off") return
    if (plan.kind === "invalid") {
      yield* Effect.logWarning(`治理 MCP 未启动：${plan.reason}`)
      return
    }

    const config = yield* Config.Service
    // 先读一次：`updateGlobal` 只写不改目录，首次启动要确保全局配置文件已存在。
    yield* config.get()

    yield* Effect.forkScoped(
      supervise({
        launch: (port) =>
          spawnGovernanceMcp({
            command: plan.command,
            cwd: process.env[ENTRY_DIR_ENV],
            ...(port === undefined ? {} : { port }),
          }),
        onReady: (port) =>
          config
            .updateGlobal({
              mcp: {
                [GOVERNANCE_MCP_SERVER]: { type: "remote", url: `http://127.0.0.1:${port}/mcp` },
              },
            })
            .pipe(
              Effect.tap((result) => Effect.logInfo("治理 MCP 就绪", { port, configChanged: result.changed })),
              Effect.catch((error) => Effect.logError("治理 MCP 配置写入失败", { error: String(error) })),
            ),
        onFailure: (reason) => Effect.logWarning(reason),
        sleep: (ms) => Effect.sleep(ms),
        startTimeoutMs: START_TIMEOUT_MS,
      }),
    )
  }),
)

export const OpenhiveGovernanceMcp = { layer }
