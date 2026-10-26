import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { Cause, Effect, Layer } from "effect"
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
 * - 内核退出 ⇒ 收尾**整棵进程树**：POSIX 用 `detached` 进程组 + `kill(-pid)`（SIGTERM→5s→
 *   SIGKILL），win32 用 `taskkill /PID <pid> /T /F`；另有 `process.on("exit")` 里的同步兜底
 *   （内核顶层 `index.ts` 无条件 `process.exit()`，作用域 finalizer 不保证跑完）。
 *   `#010-03`：只杀包装进程会留下占端口的子进程。**注意**：本机（win32）实测 `bun` 是包装器、
 *   脚本在孙进程；Linux 上的进程形态**未验证**，别把「单进程」当结论。
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
/** SIGTERM 之后等这么久再 SIGKILL（仅 POSIX；win32 的 `taskkill /F` 是立即的）。 */
export const KILL_GRACE_MS = 5_000

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

/** 定时器句柄；`clear()` 用于撤掉尚未触发的 SIGKILL。 */
export interface ScheduleHandle {
  clear(): void
}

export interface ProcessTreeDeps {
  readonly platform?: NodeJS.Platform
  /** 等价于 `process.kill(pid, signal)`；测试注入用。 */
  readonly kill?: (pid: number, signal: NodeJS.Signals) => unknown
  /** win32 整树强杀；测试注入用。 */
  readonly taskkill?: (pid: number) => void
  readonly graceMs?: number
  readonly schedule?: (callback: () => void, ms: number) => ScheduleHandle
}

export interface TreeStopper {
  /** 幂等：重复调用只发一次信号。 */
  stop(): void
  /** 立即强杀（`process.on("exit")` 同步兜底用；可与 `stop()` 叠加）。 */
  force(): void
  /** 子进程已退出：撤掉待发的 SIGKILL，避免 pid 复用后误杀。 */
  cancel(): void
}

const defaultSchedule = (callback: () => void, ms: number): ScheduleHandle => {
  const timer = setTimeout(callback, ms)
  timer.unref()
  return { clear: () => clearTimeout(timer) }
}

const taskkillTree = (pid: number) => {
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  } catch {
    // 进程已退出 / taskkill 不可用：没有可收的东西。
  }
}

/**
 * 进程树收尾器（`#010-03`）：本机实测 `bun` 是包装器，脚本跑在孙进程——只 kill 直接子进程
 * 会留下「孙进程活着、端口仍应答」的下一次 EADDRINUSE。
 *
 * - POSIX：spawn 时 `detached: true` 让子进程成为进程组组长，信号发 `-pid` 打整组；
 *   SIGTERM 后 `graceMs` 再 SIGKILL（定时器 `unref()`，不拖住事件循环）。
 * - win32：没有可捕获的 SIGTERM，直接 `taskkill /PID <pid> /T /F`。
 */
export function createTreeStopper(pid: number | undefined, deps: ProcessTreeDeps = {}): TreeStopper {
  const platform = deps.platform ?? process.platform
  const kill = deps.kill ?? ((target: number, signal: NodeJS.Signals) => process.kill(target, signal))
  const taskkill = deps.taskkill ?? taskkillTree
  const schedule = deps.schedule ?? defaultSchedule
  const signal = (target: number, sig: NodeJS.Signals) => {
    try {
      kill(target, sig)
    } catch {
      // 已退出 / 进程组已不存在。
    }
  }
  let stopped = false
  let forced = false
  let timer: ScheduleHandle | undefined
  const cancel = () => {
    timer?.clear()
    timer = undefined
  }
  return {
    stop: () => {
      if (stopped || pid === undefined) return
      stopped = true
      if (platform === "win32") {
        taskkill(pid)
        return
      }
      signal(-pid, "SIGTERM")
      timer = schedule(() => {
        timer = undefined
        signal(-pid, "SIGKILL")
      }, deps.graceMs ?? KILL_GRACE_MS)
    },
    force: () => {
      if (forced || pid === undefined) return
      // `force()` 是 `process.on("exit")` 的同步兜底：`stop()` 那次 `taskkill` 若静默失败，
      // 这里**总是**再发一次最强杀（win32 再来一遍 `/T /F`），不因已 stop 就跳过。
      if (platform === "win32") {
        forced = true
        taskkill(pid)
        return
      }
      forced = true
      cancel()
      signal(-pid, "SIGKILL")
    },
    cancel,
  }
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
      // 首次启动显式给 0（系统分配）：不把父进程里残留的值当成「上次的端口」。
      [PORT_ENV]: String(input.port ?? 0),
    },
    stdio: ["ignore", "pipe", "pipe"],
    // POSIX 下让子进程当进程组组长，收尾时才能 `kill(-pid)` 打整组。
    detached: process.platform !== "win32",
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

  const stopper = createTreeStopper(child.pid)
  let settled = false
  let resolveExit: (() => void) | undefined
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  // 内核顶层无条件 `process.exit()`：作用域 finalizer 不保证跑完，这里同步兜底强杀整棵树。
  const onProcessExit = () => stopper.force()
  process.once("exit", onProcessExit)
  const settleExit = () => {
    if (settled) return
    settled = true
    process.off("exit", onProcessExit)
    stopper.cancel()
    failReady?.(new Error("治理 MCP 在就绪前退出"))
    resolveExit?.()
  }
  // spawn 失败（命令不存在 / cwd 写错）只发 `error` + `close`，**不发 `exit`**：
  // 不监听 `error` 就是未捕获异常（直接打死内核），且 `exited` 永不兑现。
  child.on("error", (error) => {
    failReady?.(error instanceof Error ? error : new Error(String(error)))
    settleExit()
  })
  child.once("exit", settleExit)
  child.once("close", settleExit)

  return {
    ready,
    exited,
    stop: () => {
      if (settled) return
      stopper.stop()
    },
  }
}

export type ReadyOutcome =
  | { readonly kind: "ready"; readonly port: number }
  | { readonly kind: "exited" }
  | { readonly kind: "timeout" }

async function waitReady(child: Launched, timeoutMs: number): Promise<ReadyOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ReadyOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  // 就绪前退出（含 spawn 失败）与就绪超时是**两件事**：前者通常缺 PG_* 等配置、立刻返回，
  // 报成「15s 超时」会把真正的死因藏起来。
  const ready = child.ready.then(
    (port): ReadyOutcome => ({ kind: "ready", port }),
    (): ReadyOutcome => ({ kind: "exited" }),
  )
  const exited = child.exited.then((): ReadyOutcome => ({ kind: "exited" }))
  try {
    return await Promise.race([ready, exited, timeout])
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
 * 定时器（`setTimeout`）与停止（整树收尾）都在 `stop()`/`exited` 里，不占 Effect 的作用域。
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

          const first = yield* Effect.promise(() => waitReady(child, deps.startTimeoutMs))
          if (first.kind === "timeout") {
            child.stop()
            yield* Effect.promise(() => child.exited)
            return { kind: "timeout" as const }
          }
          if (first.kind === "exited") return { kind: "exited-before-ready" as const }
          yield* deps.onReady(first.port)
          yield* Effect.promise(() => child.exited)
          return { kind: "exited" as const, port: first.port }
        }),
      )

      if (outcome.kind === "timeout") {
        yield* deps.onFailure(`治理 MCP 就绪超时（${deps.startTimeoutMs}ms 内未就绪），准备重启`)
      } else if (outcome.kind === "exited-before-ready") {
        yield* deps.onFailure("治理 MCP 在就绪前退出（检查 PG_* 等启动配置），准备重启")
      } else {
        port = outcome.port
        yield* deps.onFailure(`治理 MCP 退出（端口 ${outcome.port}），准备重启`)
        if (now() - startedAt >= RESET_BACKOFF_AFTER_MS) attempt = 0
      }

      yield* deps.sleep(backoffMs(attempt))
      attempt += 1
    }
  })

/** 就绪后写进全局配置的补丁（单独导出以便钉住形状）。 */
export function readyConfigPatch(port: number) {
  return {
    mcp: {
      [GOVERNANCE_MCP_SERVER]: { type: "remote" as const, url: `http://127.0.0.1:${port}/mcp` },
    },
  }
}

/**
 * 就绪回调：写全局配置。`updateGlobal` 写盘走 `Effect.orDie`（**defect**，错误通道是 `never`），
 * 普通 `catch` 收不到——必须 `catchCause`，否则配置目录只读（容器常见）时监督器纤维整个死掉，
 * 子进程再也不会被拉起。抽成函数是为了能用「updateGlobal 直接 die」的桩钉住这一点。
 */
export function readyHandler(
  config: Pick<Config.Interface, "updateGlobal">,
  port: number,
): Effect.Effect<void> {
  return config.updateGlobal(readyConfigPatch(port)).pipe(
    Effect.tap((result) => Effect.logInfo("治理 MCP 就绪", { port, configChanged: result.changed })),
    Effect.catchCause((cause) =>
      Effect.logError("治理 MCP 配置写入失败", { port, error: Cause.pretty(cause) }),
    ),
  )
}

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
    // 全局配置目录由 `@opencode-ai/core/global` 在加载时建好；配置文件由 `updateGlobal` 自己创建。

    yield* Effect.forkScoped(
      supervise({
        launch: (port) =>
          spawnGovernanceMcp({
            command: plan.command,
            cwd: process.env[ENTRY_DIR_ENV],
            ...(port === undefined ? {} : { port }),
          }),
        onReady: (port) => readyHandler(config, port),
        onFailure: (reason) => Effect.logWarning(reason),
        sleep: (ms) => Effect.sleep(ms),
        startTimeoutMs: START_TIMEOUT_MS,
      }),
    )
  }),
)

export const OpenhiveGovernanceMcp = { layer }
